/**
 * The world model (GeoCLIP, see geoclip.ts) seen from the main thread.
 *
 * Everything heavy runs in a worker thread of its own (geoclipWorker.ts): the image tower's
 * onnxruntime session (about 4 s of computing for 12 frames), the scoring of the frames against
 * the 100 000 gallery points and the local refinement (about 1 s of JavaScript), and, once per
 * machine, the gallery embeddings (40-50 s). The main thread posts the JPEG frames (moved, not
 * copied) and receives a compact prediction (the points carrying the probability mass, see
 * compactPrediction); what it does with it in decideLocation takes a few milliseconds.
 *
 * The thread follows the pattern of ml/workerHost.ts, which serves the models behind its gate:
 * the worker script is the .ts file under tsx and the .js file next to this module in dist;
 * a thread that dies is started once more and the calls that were in it fail with an error;
 * the worker is referenced only while it works, so an idle model never keeps a process alive.
 *
 * Threads: the image model, the face detector and the depth model run one at a time behind the
 * gate of ml/workerHost.ts, each with all cores (config.threads). The world model is not behind
 * that gate (it is no service of ml/), so it may run beside one of them: during the quick stage
 * beside the image model's crops of the same recording, otherwise beside a batch of the analysis
 * pipeline. With all cores for both, twice as many busy threads as cores would compete with the
 * node's HTTP loop. The world model therefore takes half the cores (2 of 4; DATUM_GEOCLIP_THREADS
 * overrides), so that at most 1.5 times the cores are busy, and its pool threads do not spin
 * while they wait (session.intra_op.allow_spinning = 0), so they give the cores back between runs.
 */
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { config, repoRoot } from '../config.js';
import { drainAtExitOf } from '../ml/workerHost.js';
import { FLAG_STATE, newThreadFlags, THREAD_RUNNING } from '../ml/workerProtocol.js';
import { GEOCLIP_FILES, NamedError, defaultGeoclipDir, geoclipFilesPresent, type GeoclipPrecision, type GeoclipPrediction } from './geoclip.js';
import { reportWorldModel } from './settings.js';

/** A text in both languages. */
export interface Named {
  de: string;
  en: string;
}

// ------------------------------------------------------------------ protocol (shared with the worker)

/** `workerData` of the world model's thread. */
export interface WorldModelBoot {
  precision: GeoclipPrecision;
  modelDir: string;
  cacheDir: string;
  threads: number;
  /**
   * Test seam: enables the 'exit' operation, which ends the thread as a crash would, and starts
   * the thread without loading the model (the model loads on the first prediction), so that the
   * thread's life cycle can be tested without the weights.
   */
  testOps: boolean;
  /**
   * One Int32 in shared memory, as for the inference threads (ml/workerProtocol.ts WorkerBoot):
   * THREAD_RUNNING until the thread has finished its last run and released its sessions, then
   * THREAD_CLOSED. The exiting process waits on it (drainAtExitOf in ml/workerHost.ts), and a
   * close tells by it whether the thread may be stopped by force (see stopThread).
   */
  closed: Int32Array;
}

/** The settings of the world model's thread, without the flag each started thread gets of its own. */
export type WorldModelSettings = Omit<WorldModelBoot, 'closed'>;

/** What the thread says once its image tower is loaded. */
export interface WorldModelInfo {
  galleryCached: boolean;
  sessionMs: number;
  threads: number;
}

export type PredictReply =
  | { status: 'ok'; prediction: GeoclipPrediction }
  | { status: 'building'; done: number; total: number }
  /** reason in German, reasonEn its English twin (absent when the text is technical, e.g. of onnxruntime). */
  | { status: 'failed'; reason: string; reasonEn?: string };

export interface WorldModelOps {
  /** JPEG frames of one video → the prediction (wait: also while the gallery is still built). */
  predict: { args: { jpegs: Uint8Array[]; wait: boolean }; result: PredictReply };
  /** JPEG frames → image embeddings (frames x 512), for the evaluation's cache. */
  embed: { args: { jpegs: Uint8Array[] }; result: Float32Array };
  /** Image embeddings computed before → the prediction. */
  predictEmbeddings: { args: { embeds: Float32Array; frames: number; wait: boolean }; result: PredictReply };
  /** Ends the thread like a crash (only with testOps). */
  exit: { args: Record<string, never>; result: null };
}

export type GalleryEvent =
  | { kind: 'gallery'; state: 'loading' | 'building'; done: number; total: number }
  | { kind: 'gallery'; state: 'ready'; built: boolean; ms: number; cacheProblem: string | null }
  | { kind: 'gallery'; state: 'failed'; reason: string; reasonEn?: string };

export interface SerializedError {
  name: string;
  message: string;
  stack: string | null;
  /** English twin of the message (NamedError), so that it survives the thread boundary. */
  en?: string;
}

export type HostMessage = { type: 'call'; id: number; op: keyof WorldModelOps; args: unknown } | { type: 'close' };

export type ThreadMessage =
  | { type: 'ready'; info: WorldModelInfo }
  | { type: 'failed'; error: SerializedError }
  | { type: 'event'; event: GalleryEvent }
  | { type: 'result'; id: number; value: unknown }
  | { type: 'error'; id: number; error: SerializedError };

export function serializeError(err: unknown): SerializedError {
  if (err instanceof NamedError) return { name: err.name, message: err.message, stack: err.stack ?? null, en: err.en };
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack ?? null };
  return { name: 'Error', message: String(err), stack: null };
}

function deserializeError(e: SerializedError): Error {
  const err = e.en !== undefined ? new NamedError(e.message, e.en) : new Error(e.message);
  err.name = e.name;
  if (e.stack !== null) err.stack = e.stack;
  return err;
}

/** An error in both languages: a NamedError's own twin, else the (technical) message for both. */
export function namedErrorText(err: unknown): Named {
  if (err instanceof NamedError) return { de: err.message, en: err.en };
  const message = err instanceof Error ? err.message : String(err);
  return { de: message, en: message };
}

/** The trace's reason for a failed call of the world model, in both languages. */
export function worldModelFailure(err: unknown): Named {
  const text = namedErrorText(err);
  return { de: `Weltmodell fehlgeschlagen: ${text.de}`, en: `world model failed: ${text.en}` };
}

// ------------------------------------------------------------------ the interface the engine uses

export type GalleryState = 'unknown' | 'loading' | 'building' | 'ready' | 'failed';

export interface WorldModelResult {
  /**
   * 'ok' with a prediction; otherwise why there is none. 'late' is set by the engine, never by
   * the model: no answer within the quick stage's wait (the call itself goes on).
   */
  state: 'ok' | 'unavailable' | 'building' | 'failed' | 'late';
  prediction: GeoclipPrediction | null;
  /** The reason in both languages when there is no prediction (for the fix's trace). */
  reason: Named | null;
  /** Wall time of the call, as the caller waited for it (ms). */
  ms: number;
}

/** What DatumEngine needs of the world model (tests give it a stand-in). */
export interface WorldModel {
  /** Starts the thread and loads (or, once per machine, builds) the gallery in the background. */
  warm(): void;
  /** Where these frames were taken. Never throws: without a prediction the result says why. */
  predict(jpegs: readonly Buffer[], opts?: { wait?: boolean }): Promise<WorldModelResult>;
  readonly galleryState: GalleryState;
  /**
   * Called once when the gallery is ready (true) or will not be (false: failed, thread given up
   * or closed), at once when that is already known; returns the unsubscribe.
   */
  onGallerySettled(listener: (ready: boolean) => void): () => void;
}

/** Threads of the world model's session: half the cores (see the module comment). */
export function worldModelThreads(): number {
  const raw = Number(process.env['DATUM_GEOCLIP_THREADS'] ?? '');
  if (Number.isFinite(raw) && raw >= 1 && raw <= 256) return Math.floor(raw);
  return Math.max(1, Math.floor(Math.min(config.threads, os.availableParallelism()) / 2));
}

/**
 * Precision of the image tower: DATUM_GEOCLIP_PRECISION when set; otherwise int8 (307 MB, the
 * measured default download) when its weights are there, else fp32 when those are, else int8.
 * The same rule as the settings view (datum/settings.ts), so both name the same model.
 */
export function worldModelPrecision(modelDir: string = defaultGeoclipDir()): GeoclipPrecision {
  const wanted = (process.env['DATUM_GEOCLIP_PRECISION'] ?? '').trim().toLowerCase();
  if (wanted === 'fp32' || wanted === 'int8') return wanted;
  const has = (precision: GeoclipPrecision): boolean => existsSync(path.join(modelDir, ...GEOCLIP_FILES.vision[precision].split('/')));
  if (has('int8')) return 'int8';
  return has('fp32') ? 'fp32' : 'int8';
}

// ------------------------------------------------------------------ the thread host

const fromSource = import.meta.url.endsWith('.ts');
const workerEntry = new URL(fromSource ? './geoclipWorker.ts' : './geoclipWorker.js', import.meta.url);

/** Under tsx the worker inherits the loader; only without it in the parent is it added. */
function workerExecArgv(): string[] | undefined {
  if (!fromSource) return undefined;
  if (process.execArgv.some((arg) => arg.includes('tsx'))) return undefined;
  return ['--import', import.meta.resolve('tsx')];
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout | null;
}

/** A started thread: its shared "closed" flag and its end. */
interface ThreadHandle {
  closed: Int32Array;
  exited: Promise<void>;
}

type HostState = 'idle' | 'starting' | 'ready' | 'restarting' | 'failed' | 'closed';

export interface WorldModelServiceOptions {
  precision?: GeoclipPrecision;
  modelDir?: string;
  cacheDir?: string;
  threads?: number;
  testOps?: boolean;
  /**
   * Longest a call may take before the thread is considered hung (ms). Default 180 s: a call that
   * waits for the gallery (wait: true, the scripts) may have to wait for its one-time build.
   */
  callTimeoutMs?: number;
  /**
   * The same for a prediction that does not wait for the gallery (the engine's calls, wait: false):
   * twelve frames take about 5 s of computing, so a call still running after this is hung, and
   * holding the fix of an upload for the full callTimeoutMs would be far too long. Default 60 s.
   */
  predictTimeoutMs?: number;
  log?: (message: string) => void;
}

const UNAVAILABLE: Named = {
  de: 'GeoCLIP-Gewichte fehlen auf diesem Rechner (pnpm models:download); ohne Weltmodell geortet',
  en: 'GeoCLIP weights are missing on this machine (pnpm models:download); located without the world model',
};

export class WorldModelService implements WorldModel {
  readonly boot: WorldModelSettings;
  private readonly callTimeoutMs: number;
  private readonly predictTimeoutMs: number;
  private readonly log: (message: string) => void;
  private state: HostState = 'idle';
  private worker: Worker | null = null;
  /** Resolves with the worker that takes calls; replaced while a restart is under way. */
  private live: Promise<Worker> | null = null;
  private failure: Error | null = null;
  private restartAllowed = true;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  /** Every started thread that has not exited, including one still starting or winding down. */
  private readonly workers = new Map<Worker, ThreadHandle>();
  private gallery: { state: GalleryState; done: number; total: number; reason: string | null } = { state: 'unknown', done: 0, total: 0, reason: null };
  private readonly readyListeners = new Set<(ready: boolean) => void>();
  private files: Promise<{ ok: boolean; missing: string[] }> | null = null;

  constructor(options: WorldModelServiceOptions = {}) {
    const modelDir = options.modelDir ?? defaultGeoclipDir();
    this.boot = {
      precision: options.precision ?? worldModelPrecision(modelDir),
      modelDir,
      cacheDir: options.cacheDir ?? path.join(repoRoot, '.cache', 'datum'),
      threads: options.threads ?? worldModelThreads(),
      testOps: options.testOps ?? false,
    };
    this.callTimeoutMs = options.callTimeoutMs ?? 180_000;
    this.predictTimeoutMs = Math.min(options.predictTimeoutMs ?? 60_000, this.callTimeoutMs);
    this.log = options.log ?? (() => undefined);
  }

  get galleryState(): GalleryState {
    return this.gallery.state;
  }

  /** The reason the thread gave up, if it did. */
  get problem(): string | null {
    return this.failure?.message ?? this.gallery.reason;
  }

  /** Whether the weights of the configured precision are on disk (checked once per process). */
  available(): Promise<boolean> {
    this.files ??= geoclipFilesPresent(this.boot.precision, this.boot.modelDir);
    return this.files.then((f) => f.ok);
  }

  onGallerySettled(listener: (ready: boolean) => void): () => void {
    if (this.gallery.state === 'ready' || this.gallery.state === 'failed' || this.state === 'failed' || this.state === 'closed') {
      listener(this.gallery.state === 'ready' && this.state !== 'failed' && this.state !== 'closed');
      return () => undefined;
    }
    this.readyListeners.add(listener);
    return () => this.readyListeners.delete(listener);
  }

  /** Tells every waiting listener how the gallery ended up. */
  private settleListeners(ready: boolean): void {
    const listeners = [...this.readyListeners];
    this.readyListeners.clear();
    for (const listener of listeners) {
      try {
        listener(ready);
      } catch {
        // A listener's mistake must not end the model.
      }
    }
  }

  warm(): void {
    void this.available().then((ok) => {
      if (!ok || this.state === 'closed') return;
      this.current().catch((err: unknown) => this.log(`Weltmodell nicht gestartet: ${err instanceof Error ? err.message : String(err)}`));
    });
  }

  /** Starts the thread (if needed) and waits until the gallery is ready; for scripts. */
  async ensureGallery(onProgress?: (done: number, total: number) => void): Promise<void> {
    if (!(await this.available())) throw new Error(UNAVAILABLE.de);
    await this.current();
    if (this.gallery.state === 'ready') return;
    await new Promise<void>((resolve, reject) => {
      const timer = setInterval(() => {
        if (this.gallery.state === 'building' || this.gallery.state === 'loading') onProgress?.(this.gallery.done, this.gallery.total);
        if (this.gallery.state === 'failed') {
          clearInterval(timer);
          reject(new Error(this.gallery.reason ?? 'Ortsgalerie fehlgeschlagen'));
        }
        if (this.state === 'failed' || this.state === 'closed') {
          clearInterval(timer);
          reject(this.failure ?? new Error('Weltmodell beendet'));
        }
      }, 250);
      this.onGallerySettled((ready) => {
        clearInterval(timer);
        if (ready) resolve();
        else reject(new Error(this.problem ?? 'Ortsgalerie nicht verfügbar'));
      });
    });
  }

  async predict(jpegs: readonly Buffer[], opts: { wait?: boolean } = {}): Promise<WorldModelResult> {
    const t0 = performance.now();
    const done = (state: WorldModelResult['state'], prediction: GeoclipPrediction | null, reason: Named | null): WorldModelResult => ({
      state,
      prediction,
      reason,
      ms: performance.now() - t0,
    });
    if (jpegs.length === 0) return done('failed', null, { de: 'keine Bilder für das Weltmodell', en: 'no frames for the world model' });
    if (!(await this.available())) return done('unavailable', null, UNAVAILABLE);
    // Copies with buffers of their own, which can be moved to the thread: the caller keeps its
    // frames (the full stage may need them again).
    const copies = jpegs.map((j) => new Uint8Array(j));
    const wait = opts.wait ?? false;
    try {
      const reply = await this.call('predict', { jpegs: copies, wait }, copies.map((c) => c.buffer as ArrayBuffer), wait ? this.callTimeoutMs : this.predictTimeoutMs);
      return this.fromReply(reply, done);
    } catch (err: unknown) {
      return done('failed', null, worldModelFailure(err));
    }
  }

  /** Image embeddings of JPEG frames (frames x 512); for the evaluation. Throws on failure. */
  async embed(jpegs: readonly Buffer[]): Promise<Float32Array> {
    if (!(await this.available())) throw new Error(UNAVAILABLE.de);
    const copies = jpegs.map((j) => new Uint8Array(j));
    return this.call('embed', { jpegs: copies }, copies.map((c) => c.buffer as ArrayBuffer));
  }

  /** The prediction from image embeddings; for the evaluation (waits for the gallery). */
  async predictEmbeddings(embeds: Float32Array, frames: number): Promise<WorldModelResult> {
    const t0 = performance.now();
    const done = (state: WorldModelResult['state'], prediction: GeoclipPrediction | null, reason: Named | null): WorldModelResult => ({
      state,
      prediction,
      reason,
      ms: performance.now() - t0,
    });
    if (!(await this.available())) return done('unavailable', null, UNAVAILABLE);
    const copy = embeds.slice();
    const reply = await this.call('predictEmbeddings', { embeds: copy, frames, wait: true }, [copy.buffer as ArrayBuffer]);
    return this.fromReply(reply, done);
  }

  /** Ends the thread as a crash would (tests of the restart; needs testOps). */
  async crashForTest(): Promise<void> {
    await this.call('exit', {}, []).catch(() => undefined);
  }

  /** Ends the thread: lets it release its sessions, then stops it. Pending calls fail. */
  async close(): Promise<void> {
    if (this.state === 'closed') return;
    this.state = 'closed';
    const error = new NamedError('Weltmodell: Rechenthread wurde beendet.', 'world model: its computing thread was ended.');
    this.rejectPending(error);
    this.live = Promise.reject(error);
    this.live.catch(() => undefined);
    this.worker = null;
    this.settleListeners(false);
    await Promise.all([...this.workers].map(([w, handle]) => stopThread(w, handle)));
  }

  /** Stops one thread of this service (see stopThread); a no-op for one that has exited. */
  private stop(worker: Worker): Promise<void> {
    const handle = this.workers.get(worker);
    return handle ? stopThread(worker, handle) : Promise.resolve();
  }

  private fromReply(
    reply: PredictReply,
    done: (state: WorldModelResult['state'], prediction: GeoclipPrediction | null, reason: Named | null) => WorldModelResult,
  ): WorldModelResult {
    if (reply.status === 'ok') return done('ok', reply.prediction, null);
    if (reply.status === 'building') {
      const share = reply.total > 0 ? ` (${Math.round((100 * reply.done) / reply.total)} %)` : '';
      const shareEn = reply.total > 0 ? ` (${Math.round((100 * reply.done) / reply.total)}%)` : '';
      return done('building', null, {
        de: `Ortsgalerie des Weltmodells wird einmalig berechnet${share}; diese Ortung ohne Weltmodell`,
        en: `the world model's place gallery is being computed once${shareEn}; this fix without the world model`,
      });
    }
    return done('failed', null, { de: `Weltmodell fehlgeschlagen: ${reply.reason}`, en: `world model failed: ${reply.reasonEn ?? reply.reason}` });
  }

  private current(): Promise<Worker> {
    if (this.state === 'closed') return Promise.reject(new NamedError('Weltmodell: Rechenthread wurde beendet.', 'world model: its computing thread was ended.'));
    if (this.state === 'failed') return Promise.reject(this.failure ?? new NamedError('Weltmodell nicht verfügbar.', 'world model not available.'));
    if (!this.live) {
      this.state = 'starting';
      this.live = this.spawn().then(
        (worker) => {
          this.adopt(worker);
          return worker;
        },
        (err: unknown) => {
          const error = err instanceof Error ? err : new Error(String(err));
          this.giveUp(error);
          throw error;
        },
      );
      this.live.catch(() => undefined);
    }
    return this.live;
  }

  private async call<K extends keyof WorldModelOps>(
    op: K,
    args: WorldModelOps[K]['args'],
    transfer: ArrayBuffer[],
    timeoutMs: number = this.callTimeoutMs,
  ): Promise<WorldModelOps[K]['result']> {
    const worker = await this.current();
    return new Promise<WorldModelOps[K]['result']>((resolve, reject) => {
      const id = this.nextId++;
      // A run that never answers (a hung thread) must not hold the fix: the call fails and the
      // thread is asked to end; once it has, the next call starts it again (restart path). It is
      // not terminated on the spot: a thread torn down inside a session run aborts the process.
      const timer =
        op === 'exit'
          ? null
          : setTimeout(() => {
              const call = this.pending.get(id);
              if (!call) return;
              this.pending.delete(id);
              const secs = Math.round(timeoutMs / 1000);
              call.reject(new NamedError(`keine Antwort nach ${secs} s`, `no answer after ${secs} s`));
              void this.stop(worker);
            }, timeoutMs);
      timer?.unref();
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      worker.ref();
      const message: HostMessage = { type: 'call', id, op, args };
      try {
        worker.postMessage(message, transfer);
      } catch (err: unknown) {
        this.settle(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Forgets a call and lets the process end while the thread has nothing to do. */
  private settle(id: number): PendingCall | undefined {
    const call = this.pending.get(id);
    if (call?.timer) clearTimeout(call.timer);
    this.pending.delete(id);
    this.idle();
    return call;
  }

  private adopt(worker: Worker): void {
    this.worker = worker;
    this.state = 'ready';
    this.idle();
  }

  private giveUp(error: Error): void {
    this.state = 'failed';
    this.failure = error;
    this.worker = null;
    this.live = Promise.reject(error);
    this.live.catch(() => undefined);
    this.rejectPending(error);
    this.settleListeners(false);
    reportWorldModel({ available: false, precision: this.boot.precision });
    this.log(`Weltmodell aufgegeben: ${error.message}`);
  }

  /** Unreferenced while idle, referenced while a call or the gallery is under way. */
  private idle(): void {
    const busy = this.pending.size > 0 || this.gallery.state === 'loading' || this.gallery.state === 'building';
    if (busy) this.worker?.ref();
    else this.worker?.unref();
  }

  private rejectPending(error: Error): void {
    const calls = [...this.pending.values()];
    this.pending.clear();
    for (const call of calls) {
      if (call.timer) clearTimeout(call.timer);
      call.reject(error);
    }
  }

  private onEvent(event: GalleryEvent): void {
    if (event.state === 'ready') {
      this.gallery = { state: 'ready', done: this.gallery.total, total: this.gallery.total, reason: null };
      // The settings view (GET /api/datum/settings) shows what runs, not only what is on disk.
      reportWorldModel({ available: true, precision: this.boot.precision });
      if (event.built) this.log(`Weltmodell: Ortsgalerie einmalig berechnet in ${(event.ms / 1000).toFixed(0)} s`);
      if (event.cacheProblem) this.log(`Weltmodell: Ortsgalerie nicht zwischengespeichert (${event.cacheProblem}); sie wird beim nächsten Start neu berechnet`);
      this.settleListeners(true);
    } else if (event.state === 'failed') {
      this.gallery = { state: 'failed', done: 0, total: 0, reason: event.reason };
      reportWorldModel({ available: false, precision: this.boot.precision });
      this.settleListeners(false);
      this.log(`Weltmodell: Ortsgalerie fehlgeschlagen (${event.reason}); Ortung ohne Weltmodell`);
    } else {
      if (event.state === 'building' && this.gallery.state !== 'building') this.log('Weltmodell: Ortsgalerie wird einmalig berechnet (40-50 s); bis dahin wird ohne Weltmodell geortet');
      this.gallery = { state: event.state, done: event.done, total: event.total, reason: null };
    }
    this.idle();
  }

  private spawn(): Promise<Worker> {
    return new Promise((resolve, reject) => {
      // A flag of its own per thread: a restarted thread must not inherit the state of the old one.
      const closed = newThreadFlags();
      const boot: WorldModelBoot = { ...this.boot, closed };
      let worker: Worker;
      try {
        const execArgv = workerExecArgv();
        worker = new Worker(workerEntry, { workerData: boot, ...(execArgv ? { execArgv } : {}) });
      } catch (err: unknown) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      const thread = worker;
      this.workers.set(worker, { closed, exited: new Promise<void>((resolveExit) => thread.once('exit', () => resolveExit())) });
      // A process that exits while this thread is inside a run waits for it to finish and release
      // its sessions first (the same drain as for the inference threads).
      drainAtExitOf(worker, closed);
      let ready = false;
      let lastError: Error | null = null;
      worker.on('message', (message: ThreadMessage) => {
        switch (message.type) {
          case 'ready':
            ready = true;
            resolve(worker);
            break;
          case 'failed':
            lastError = deserializeError(message.error);
            void this.stop(worker);
            break;
          case 'event':
            if (worker === this.worker || !ready) this.onEvent(message.event);
            break;
          case 'result':
          case 'error': {
            const call = this.settle(message.id);
            if (!call) break;
            if (message.type === 'result') {
              this.restartAllowed = true;
              call.resolve(message.value);
            } else {
              call.reject(deserializeError(message.error));
            }
            break;
          }
        }
      });
      worker.on('messageerror', (err: Error) => {
        lastError = err;
      });
      worker.on('error', (err: Error) => {
        lastError = err;
      });
      worker.on('exit', (code: number) => {
        this.workers.delete(worker);
        if (!ready) {
          reject(lastError ?? new NamedError(`Weltmodell: Rechenthread endete beim Laden (Code ${code}).`, `world model: the computing thread ended while loading (code ${code}).`));
          return;
        }
        this.died(worker, lastError, code);
      });
    });
  }

  /** A worker that took calls has exited: fail what was in it, restart once, or give up. */
  private died(worker: Worker, error: Error | null, code: number): void {
    if (worker !== this.worker || this.state === 'closed') return;
    const reason = error ? error.message : `Code ${code}`;
    const reasonEn = error ? namedErrorText(error).en : `code ${code}`;
    this.worker = null;
    this.rejectPending(new NamedError(`Rechenthread ist ausgefallen (${reason}); der Aufruf wurde nicht beendet`, `the computing thread failed (${reasonEn}); the call did not finish`));
    // The gallery lives in the thread: a new one loads it again (from the cache when it was built).
    if (this.gallery.state !== 'failed') this.gallery = { state: 'unknown', done: 0, total: 0, reason: null };
    if (!this.restartAllowed) {
      this.giveUp(
        new NamedError(
          `Weltmodell: Rechenthread ist erneut ausgefallen (${reason}); bis zum Neustart des Knotens ohne Weltmodell.`,
          `world model: the computing thread failed again (${reasonEn}); without the world model until the node restarts.`,
        ),
      );
      return;
    }
    this.restartAllowed = false;
    this.state = 'restarting';
    this.log(`Weltmodell: Rechenthread ausgefallen (${reason}), wird neu gestartet`);
    this.live = this.spawn().then(
      (next) => {
        if (this.state === 'closed') {
          void this.stop(next);
          throw new NamedError('Weltmodell: Rechenthread wurde beendet.', 'world model: its computing thread was ended.');
        }
        this.adopt(next);
        return next;
      },
      (err: unknown) => {
        const text = namedErrorText(err);
        const failure = new NamedError(`Weltmodell: Neustart des Rechenthreads fehlgeschlagen (${text.de}).`, `world model: restarting the computing thread failed (${text.en}).`);
        if (this.state !== 'closed') this.giveUp(failure);
        throw failure;
      },
    );
    this.live.catch(() => undefined);
  }
}

/** How long a closing thread may take to end by itself before it is looked at again. */
const STOP_GRACE_MS = 3_000;
/** After this long inside one run the thread is left alone (unreferenced): it is hung in native code. */
const STOP_PATIENCE_MS = 5 * 60_000;

/**
 * Asks the thread to finish its run, release its sessions and end. It is stopped by force only
 * once its flag says the sessions are released: terminating a thread inside an onnxruntime
 * session run aborts the whole process (the binding throws a C++ exception, Napi::Error, while
 * the thread is torn down). A thread still inside its run after the grace time is given more
 * time, unreferenced, so that it never keeps an otherwise finished process alive; if the process
 * ends meanwhile, its exit waits for the thread once more (drainAtExitOf).
 */
async function stopThread(worker: Worker, handle: ThreadHandle): Promise<void> {
  // An idle worker is unreferenced; while it winds down it must keep a waiting caller alive.
  worker.ref();
  try {
    const message: HostMessage = { type: 'close' };
    worker.postMessage(message);
  } catch {
    // Already gone.
  }
  const giveUpAt = Date.now() + STOP_PATIENCE_MS;
  for (;;) {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), STOP_GRACE_MS);
      timer.unref();
    });
    const outcome = await Promise.race([handle.exited.then(() => 'exited' as const), timeout]);
    clearTimeout(timer);
    if (outcome === 'exited') return;
    if (Atomics.load(handle.closed, FLAG_STATE) !== THREAD_RUNNING) {
      // Sessions released, yet the thread lingers (something else keeps its loop busy): safe to end.
      await worker.terminate();
      return;
    }
    worker.unref();
    if (Date.now() >= giveUpAt) return;
  }
}

// ------------------------------------------------------------------ preparation (download scripts)

/**
 * Fetches the world model's files (pinned revision, SHA-256 checked, see ensureGeoclipFiles) and
 * computes its place gallery once, so that a node never has to: for `pnpm models:download` and
 * `pnpm datum:fetch`. Never throws: false (with the reason said) leaves the node working without
 * the world model.
 */
export async function prepareWorldModel(say: (line: string) => void): Promise<boolean> {
  const { ensureGeoclipFiles } = await import('./geoclip.js');
  const modelDir = defaultGeoclipDir();
  const precision = worldModelPrecision(modelDir);
  try {
    let shown = '';
    const report = await ensureGeoclipFiles({
      precision,
      modelDir,
      onProgress: (file, loaded, total) => {
        const step = `${file} ${Math.floor((10 * loaded) / Math.max(1, total)) * 10} %`;
        if (step !== shown) {
          shown = step;
          say(`  Weltmodell: ${step}`);
        }
      },
    });
    say(`  Weltmodell GeoCLIP (${precision}): ${report.fetched.length > 0 ? `${report.fetched.length} Datei(en) geladen, ` : ''}${report.present.length} geprüft vorhanden.`);
  } catch (err: unknown) {
    say(`  Weltmodell GeoCLIP nicht geladen: ${err instanceof Error ? err.message : String(err)} Die Ortung arbeitet ohne Weltmodell.`);
    return false;
  }
  const service = new WorldModelService({ precision, modelDir });
  const t0 = performance.now();
  try {
    let shown = -1;
    await service.ensureGallery((done, total) => {
      const step = Math.floor((10 * done) / Math.max(1, total));
      if (total > 0 && step !== shown) {
        shown = step;
        say(`  Ortsgalerie des Weltmodells: ${done.toLocaleString('de-DE')}/${total.toLocaleString('de-DE')}`);
      }
    });
    say(`  Ortsgalerie des Weltmodells bereit (${((performance.now() - t0) / 1000).toFixed(1)} s).`);
    return true;
  } catch (err: unknown) {
    say(`  Ortsgalerie des Weltmodells nicht berechnet: ${err instanceof Error ? err.message : String(err)} Der Knoten berechnet sie beim ersten Start.`);
    return false;
  } finally {
    await service.close();
  }
}

// ------------------------------------------------------------------ one per process

let shared: WorldModelService | null = null;
let users = 0;

/**
 * The process-wide world model (one thread, one gallery in memory, shared by every node of the
 * process). Each DatumEngine acquires it and releases it when it stops; the thread ends with the
 * last one.
 */
export function acquireWorldModel(log?: (message: string) => void): WorldModelService {
  shared ??= new WorldModelService(log ? { log } : {});
  users++;
  return shared;
}

export function releaseWorldModel(model: WorldModelService): void {
  if (model !== shared) {
    closeTracked(model);
    return;
  }
  users = Math.max(0, users - 1);
  if (users > 0) return;
  shared = null;
  closeTracked(model);
}

/** World models being closed (their threads finishing a run and ending), see worldModelsClosed. */
const closing = new Set<Promise<void>>();

function closeTracked(model: WorldModelService): void {
  const done = model.close().catch(() => undefined);
  closing.add(done);
  void done.finally(() => closing.delete(done));
}

/**
 * Settles once every world model released so far has ended its thread (it finishes the run under
 * way first). The node's shutdown awaits this before the process exits, so that no onnxruntime
 * thread is left for the exit to stop (see drainAtExit in ml/workerHost.ts).
 */
export async function worldModelsClosed(): Promise<void> {
  await Promise.allSettled([...closing]);
}
