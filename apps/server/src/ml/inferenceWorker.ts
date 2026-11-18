/**
 * Entry of an inference thread (started by workerHost.ts). Loads the one service named in
 * `workerData`, answers `ready` (or `failed`), then runs the calls it is sent one after another.
 * The main thread never sends more than one call at a time (the gate in workerHost.ts); the
 * chain below keeps the order even if it did.
 */
import { parentPort, workerData } from 'node:worker_threads';
import {
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

const post = (message: ThreadMessage, transfer: ArrayBuffer[] = []): void => port.postMessage(message, transfer);

/** Set once init has succeeded: only then are calls answered. */
let service: InferenceService | null = null;
/** Set as soon as the service module is imported, so that a failed init still releases what it holds. */
let loaded: InferenceService | null = null;
let chain: Promise<void> = Promise.resolve();
let closing = false;

async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await chain;
  await loaded?.dispose().catch(() => undefined);
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
      post({ type: 'result', id, value: reply.value }, reply.transfer);
    } catch (err: unknown) {
      post({ type: 'error', id, error: serializeError(err) });
    }
  });
});

try {
  loaded = await loadService(boot.service);
  const info = await loaded.init(boot.options, (event) => post({ type: 'event', event }));
  service = loaded;
  post({ type: 'ready', info });
} catch (err: unknown) {
  post({ type: 'failed', error: serializeError(err) });
  await close();
}
