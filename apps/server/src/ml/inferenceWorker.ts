/**
 * Entry of an inference thread (started by workerHost.ts). Loads the one service named in
 * `workerData`, answers `ready` (or `failed`), then runs the calls it is sent one after another.
 * The main thread never sends more than one call at a time (the gate in workerHost.ts); the
 * chain below keeps the order even if it did.
 */
import { parentPort, workerData } from 'node:worker_threads';
import {
  THREAD_CLOSED,
  serializeError,
  type HostMessage,
  type InferenceService,
  type ServiceName,
  type ThreadMessage,
  type WorkerBoot,
} from './workerProtocol.js';

const port = parentPort;
if (!port) throw new Error('inferenceWorker.ts runs only as a worker thread.');
const boot = workerData as WorkerBoot;

/** Each service is imported on its own, so that a thread loads only the libraries it uses. */
async function loadService(name: ServiceName): Promise<InferenceService> {
  switch (name) {
    case 'siglip':
      return (await import('./siglipService.js')).createSiglipService();
    case 'yunet':
      return (await import('./yunetService.js')).createYunetService();
    case 'depth':
      return (await import('./depthService.js')).createDepthService();
    case 'check':
      return (await import('./checkService.js')).createCheckService();
  }
}

function post(message: ThreadMessage): void {
  try {
    port?.postMessage(message);
  } catch {
    // The port is closed (the host is ending this thread): nobody waits for the answer.
  }
}

/**
 * Sends a result. The host waits for exactly one answer per call (and every other model waits
 * behind it), so a result that cannot be moved is copied, and one that cannot be sent at all
 * becomes an error answer.
 */
function answer(id: number, value: unknown, transfer: ArrayBuffer[]): void {
  const message: ThreadMessage = { type: 'result', id, value };
  try {
    port?.postMessage(message, transfer);
    return;
  } catch {
    // Not transferable (memory owned by native code): try a copy.
  }
  try {
    port?.postMessage(message);
  } catch (err: unknown) {
    post({ type: 'error', id, error: serializeError(err) });
  }
}

/** Set once init has succeeded: only then are calls answered. */
let service: InferenceService | null = null;
/** Set as soon as the service module is imported, so that a failed init still releases what it holds. */
let loaded: InferenceService | null = null;
let chain: Promise<void> = Promise.resolve();
let closing = false;
/** Settles when init has (a session must not be created after the thread released its sessions). */
let initDone: Promise<unknown> = Promise.resolve();

/**
 * Finishes the call under way, releases the sessions and ends the thread. A session that is
 * still running when the process tears the thread down makes onnxruntime's binding throw a C++
 * exception during teardown, which aborts the whole process (seen as SIGABRT on node shutdown).
 */
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await initDone.catch(() => undefined);
  await chain;
  await loaded?.dispose().catch(() => undefined);
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
    if (!service || closing) {
      post({ type: 'error', id, error: serializeError(new Error('Model is not loaded yet.')) });
      return;
    }
    try {
      const reply = await service.call(op, args);
      answer(id, reply.value, reply.transfer);
    } catch (err: unknown) {
      post({ type: 'error', id, error: serializeError(err) });
    }
  });
});

try {
  loaded = await loadService(boot.service);
  const init = loaded.init(boot.options, (event) => post({ type: 'event', event }));
  initDone = init;
  const info = await init;
  service = loaded;
  post({ type: 'ready', info });
} catch (err: unknown) {
  post({ type: 'failed', error: serializeError(err) });
  await close();
}
