/**
 * Entry of the world model's thread (started by geoclipService.ts). Loads GeoCLIP's image tower,
 * answers `ready` (or `failed`), and meanwhile loads the gallery of 100 000 place embeddings from
 * its cache, or builds it once (40-50 s) when there is none. Calls run one after another.
 *
 * A prediction asked for while the gallery is still being built is answered at once with
 * 'building' (unless the caller asked to wait): the quick fix of an upload must not wait for it.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { THREAD_CLOSED } from '../ml/workerProtocol.js';
import { GeoClip, NamedError, compactPrediction, type GeoclipPrediction } from './geoclip.js';
import { World } from './world.js';
import {
  serializeError,
  type GalleryEvent,
  type HostMessage,
  type PredictReply,
  type ThreadMessage,
  type WorldModelBoot,
  type WorldModelInfo,
  type WorldModelOps,
} from './geoclipService.js';

const port = parentPort;
if (!port) throw new Error('geoclipWorker.ts runs only as a worker thread.');
const boot = workerData as WorldModelBoot;

const model = new GeoClip({ precision: boot.precision, modelDir: boot.modelDir, cacheDir: boot.cacheDir, threads: boot.threads, spin: false });
let world: World | null = null;
let galleryState: 'loading' | 'building' | 'ready' | 'failed' = 'loading';
/** The gallery's state as it is now (other calls change it while this one awaits). */
const gallery = (): typeof galleryState => galleryState;
/** Why the gallery failed, in German and English (the English twin is the message when technical). */
let galleryProblem: { de: string; en: string } | null = null;
let progress = { done: 0, total: 0 };
let galleryLoad: Promise<void> | null = null;
/** Resolves once it is known whether the gallery is read from the cache or built. */
let determined: Promise<void> | null = null;
let chain: Promise<void> = Promise.resolve();
let closing = false;

function post(message: ThreadMessage, transfer: ArrayBuffer[] = []): void {
  try {
    port?.postMessage(message, transfer);
  } catch {
    // The port is closed (the host is ending this thread): nobody waits for the answer.
  }
}

const event = (e: GalleryEvent): void => post({ type: 'event', event: e });

/** Loads the gallery (and the country of every gallery point) once; never rejects. */
function startGallery(): Promise<void> {
  let settle: () => void = () => undefined;
  determined ??= new Promise<void>((resolve) => (settle = resolve));
  galleryLoad ??= (async () => {
    const t0 = performance.now();
    try {
      const cached = await model.galleryCached();
      galleryState = cached ? 'loading' : 'building';
      settle();
      event({ kind: 'gallery', state: galleryState, done: 0, total: 0 });
      let lastSent = 0;
      // Only a build reports progress (reading the cache does not).
      await model.gallery((done, total) => {
        progress = { done, total };
        const now = performance.now();
        // A few notices per build are enough for the host's log and the progress in the trace.
        if (now - lastSent > 2000 || done === total) {
          lastSent = now;
          event({ kind: 'gallery', state: 'building', done, total });
        }
      });
      if (world) await model.galleryCountries(world);
      galleryState = 'ready';
      event({ kind: 'gallery', state: 'ready', built: !cached, ms: performance.now() - t0, cacheProblem: model.cacheProblem });
    } catch (err: unknown) {
      galleryState = 'failed';
      const message = err instanceof Error ? err.message : String(err);
      galleryProblem = { de: message, en: err instanceof NamedError ? err.en : message };
      settle();
      event({ kind: 'gallery', state: 'failed', reason: galleryProblem.de, reasonEn: galleryProblem.en });
    }
  })();
  return galleryLoad;
}

/** null when the gallery can be used now; otherwise the reply that says why not. */
async function galleryGate(wait: boolean): Promise<PredictReply | null> {
  if (gallery() === 'ready') return null;
  const load = startGallery();
  await determined;
  if (gallery() === 'building' && !wait) return { status: 'building', done: progress.done, total: progress.total };
  // Read from the cache (about a second), or the caller waits for the build.
  await load;
  if (gallery() === 'ready') return null;
  return { status: 'failed', reason: galleryProblem?.de ?? 'Ortsgalerie nicht verfügbar', reasonEn: galleryProblem?.en ?? 'place gallery not available' };
}

/** The prediction as it crosses to the main thread: its support only, buffers moved. */
function packed(pred: GeoclipPrediction): { value: PredictReply; transfer: ArrayBuffer[] } {
  const compact = compactPrediction(pred);
  return {
    value: { status: 'ok', prediction: compact },
    transfer: [compact.probs.buffer as ArrayBuffer, compact.coords.buffer as ArrayBuffer, compact.support.buffer as ArrayBuffer],
  };
}

const asBuffers = (jpegs: Uint8Array[]): Buffer[] => jpegs.map((j) => Buffer.from(j.buffer, j.byteOffset, j.byteLength));

/** The settings of the measured recipe (docs/measurements/datum-geoclip.json, "agree"). */
const PREDICT = { aggregation: 'mixture', refine: true } as const;

async function handle(op: keyof WorldModelOps, args: unknown): Promise<{ value: unknown; transfer: ArrayBuffer[] }> {
  switch (op) {
    case 'predict': {
      const { jpegs, wait } = args as WorldModelOps['predict']['args'];
      const blocked = await galleryGate(wait);
      if (blocked) return { value: blocked, transfer: [] };
      return packed(await model.predict(asBuffers(jpegs), { ...PREDICT, ...(world ? { world } : {}) }));
    }
    case 'embed': {
      const { jpegs } = args as WorldModelOps['embed']['args'];
      const value = await model.embedImages(asBuffers(jpegs));
      return { value, transfer: [value.buffer as ArrayBuffer] };
    }
    case 'predictEmbeddings': {
      const { embeds, frames, wait } = args as WorldModelOps['predictEmbeddings']['args'];
      const blocked = await galleryGate(wait);
      if (blocked) return { value: blocked, transfer: [] };
      return packed(await model.predictFromEmbeddings(embeds, frames, { ...PREDICT, ...(world ? { world } : {}) }));
    }
    case 'exit': {
      if (!boot.testOps) throw new NamedError('exit: nur im Test', 'exit: tests only');
      // Ends this thread the way an uncaught crash would (the host sees an exit while it works).
      process.exit(3);
    }
  }
}

/** Settles when start() has (it may be creating the image tower's session). */
let started: Promise<unknown> = Promise.resolve();

/**
 * Finishes the run under way, releases the sessions, sets the shared flag and ends the thread.
 * A session that is still running when the process tears the thread down makes onnxruntime's
 * binding throw a C++ exception during teardown, which aborts the whole process (SIGABRT,
 * "terminate called after throwing an instance of 'Napi::Error'"). The host waits for the flag:
 * at process exit with Atomics.wait (drainAtExitOf in ml/workerHost.ts), on close before it
 * would stop the thread by force (stopThread in geoclipService.ts).
 *
 * model.stop() makes every later run fail at once, so the prediction, the gallery build and the
 * start all end at their next run instead of computing on for seconds: what is awaited below is
 * at most the run that is executing now.
 */
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  model.stop();
  await started.catch(() => undefined);
  await chain;
  // Never rejects; with the model stopped it ends at the next run of the build.
  await galleryLoad;
  await model.release().catch(() => undefined);
  Atomics.store(boot.closed, 0, THREAD_CLOSED);
  Atomics.notify(boot.closed, 0);
  // Without the port nothing keeps this thread's event loop alive: it ends by itself.
  port?.close();
}

port.on('message', (message: HostMessage) => {
  if (message.type === 'close') {
    void close();
    return;
  }
  const { id, op, args } = message;
  chain = chain.then(async () => {
    if (closing) {
      post({ type: 'error', id, error: serializeError(new NamedError('Weltmodell wird beendet.', 'world model is shutting down.')) });
      return;
    }
    try {
      const reply = await handle(op, args);
      post({ type: 'result', id, value: reply.value }, reply.transfer);
    } catch (err: unknown) {
      post({ type: 'error', id, error: serializeError(err) });
    }
  });
});

/** Loads the image tower and starts the gallery; resolves with what the host is told. */
async function start(): Promise<WorldModelInfo> {
  if (boot.testOps) {
    // Life-cycle tests: ready at once, the model loads (and fails) only when a prediction is asked.
    return { galleryCached: false, sessionMs: 0, threads: boot.threads };
  }
  if (!(await model.available())) throw new NamedError(`GeoCLIP-Dateien fehlen unter ${model.modelDir}`, `GeoCLIP files missing under ${model.modelDir}`);
  // The country shapes give every gallery point its country (cached once per machine). Without
  // them the prediction has no country distribution, nothing else is lost.
  world = await World.load().catch(() => null);
  void startGallery();
  const t0 = performance.now();
  await model.loadVision();
  const sessionMs = performance.now() - t0;
  return { galleryCached: gallery() !== 'building', sessionMs, threads: boot.threads };
}

try {
  const starting = start();
  started = starting;
  post({ type: 'ready', info: await starting });
} catch (err: unknown) {
  post({ type: 'failed', error: serializeError(err) });
  await close();
}
