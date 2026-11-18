import { Worker } from 'node:worker_threads';
import {
  deserializeError,
  type HostMessage,
  type OpMap,
  type ServiceName,
  type ThreadMessage,
  type WorkerBoot,
} from './workerProtocol.js';

/**
 * Inference threads, seen from the main thread.
 *
 * onnxruntime-node runs `InferenceSession.run` synchronously on the calling thread (its backend
 * only defers the native call with setImmediate). On the main thread every run held every HTTP
 * request for its full duration. Here each model lives in a worker thread; the main thread posts
 * inputs (moving their buffers, not copying them) and gets the results back the same way.
 */

/**
 * Text queries are short and somebody waits for them (a search, a watch preview); everything
 * else is analysis work that can wait a little.
 */
export type Lane = 'interactive' | 'batch';

/**
 * Admits one model run at a time, process-wide.
 *
 * Every session uses intraOpNumThreads = all cores, as it did when all inference ran on the main
 * thread (which by construction ran one model at a time). Two runs at once in two threads would
 * put twice as many busy threads on the cores; onnxruntime's pool threads also spin while they
 * wait for work, so both runs would get slower than one after the other, and the main thread
 * would compete with 2 × cores runnable threads instead of cores. The gate keeps the old
 * schedule: one run at a time with all cores, in call order, except that a waiting text query
 * goes ahead of waiting analysis batches. The old code had separate locks for the image and the
 * text tower, so a text query never waited for queued image batches either; per lane the order
 * is first come, first served.
 *
 * Loading a model is not gated: it happens once, mostly reads files, and a download can take
 * minutes, which must not hold up the other models.
 */
class InferenceGate {
  private running = false;
  private readonly waiting: Record<Lane, (() => void)[]> = { interactive: [], batch: [] };

  run<T>(lane: Lane, job: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = (): void => {
        this.running = true;
        let result: Promise<T>;
        try {
          result = job();
        } catch (err: unknown) {
          result = Promise.reject(err);
        }
        result.then(resolve, reject).finally(() => {
          this.running = false;
          const next = this.waiting.interactive.shift() ?? this.waiting.batch.shift();
          if (next) next();
        });
      };
      if (this.running) this.waiting[lane].push(start);
      else start();
    });
  }
}

const gate = new InferenceGate();

/**
 * The worker script. From the sources (tsx: tests, scripts, `pnpm dev`) this module is a .ts
 * file and so is the worker; from the build both are .js next to each other in dist/ml.
 */
const fromSource = import.meta.url.endsWith('.ts');
const workerEntry = new URL(fromSource ? './inferenceWorker.ts' : './inferenceWorker.js', import.meta.url);

/**
 * Node options of the worker. A worker inherits the parent's options, which under tsx include its
 * loader, so the .ts worker is compiled the same way. Only when the sources run without tsx's
 * options in the parent (an embedding that registered the loader by other means) is it added.
 */
function workerExecArgv(): string[] | undefined {
  if (!fromSource) return undefined;
  if (process.execArgv.some((arg) => arg.includes('tsx'))) return undefined;
  return ['--import', import.meta.resolve('tsx')];
}

type ThreadState = 'idle' | 'starting' | 'ready' | 'restarting' | 'failed' | 'closed';

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export interface ThreadSpec<Options, Info, Event> {
  /** Shown in error messages, e.g. "Bildmodell". */
  name: string;
  service: ServiceName;
  /** Structured-cloneable options for the service's init. */
  options: Options;
  /** Progress notices of the service (download progress while loading). */
  onEvent?: (event: Event) => void;
  /**
   * Receives the result of every successful init, also after a restart (`restart` true). May
   * throw to reject a restarted thread that came up different (another vector size).
   */
  onReady?: (info: Info, restart: boolean) => void;
  /** The thread died and could not be restarted: the model is gone until the process restarts. */
  onGiveUp?: (error: Error) => void;
}

/** All threads that were started and not closed, for `closeInferenceThreads`. */
const open = new Set<InferenceThread<OpMap, unknown, unknown, unknown>>();

/**
 * One inference thread running one service. Calls are serialised through the process-wide gate;
 * the worker is referenced only while it loads or computes, so an idle model never keeps a
 * process alive that has otherwise finished (a script, a stopped node).
 *
 * If the thread dies (an uncaught error, out of memory, a crash of the service), the calls that
 * were in it fail with an error, and the thread is started once more with the same options;
 * calls that were still waiting run in the new thread. If that start fails, or the new thread
 * dies before it has completed a single call, the model is given up: waiting and later calls
 * fail with the reason. A completed call restores the one restart.
 */
export class InferenceThread<Ops extends OpMap, Options, Info, Event = never> {
  private state: ThreadState = 'idle';
  private worker: Worker | null = null;
  /** Resolves with the worker that takes calls; replaced while a restart is under way. */
  private live: Promise<Worker> | null = null;
  private started: Promise<Info> | null = null;
  private failure: Error | null = null;
  private restartAllowed = true;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  /** Every worker that has not exited yet, including one that is still starting. */
  private readonly workers = new Set<Worker>();

  constructor(private readonly spec: ThreadSpec<Options, Info, Event>) {}

  /** True once started and as long as the model can take calls (also while it restarts). */
  get usable(): boolean {
    return this.state === 'ready' || this.state === 'restarting';
  }

  /** The reason the thread gave up, if it did. */
  get problem(): string | null {
    return this.failure?.message ?? null;
  }

  /** Starts the thread and loads the model; resolves with what the service's init returned. */
  start(): Promise<Info> {
    if (this.started) return this.started;
    this.state = 'starting';
    const self = this as unknown as InferenceThread<OpMap, unknown, unknown, unknown>;
    open.add(self);
    this.started = (async () => {
      try {
        const { worker, info } = await this.spawn();
        if (this.state === 'closed') {
          void stopWorker(worker);
          throw this.closedError();
        }
        try {
          this.spec.onReady?.(info, false);
        } catch (err: unknown) {
          void stopWorker(worker);
          throw err;
        }
        this.adopt(worker);
        return info;
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (this.state !== 'closed') {
          this.giveUp(error);
          open.delete(self);
        }
        throw error;
      }
    })();
    return this.started;
  }

  /**
   * Runs one operation in the thread. `transfer` lists buffers of `args` that are moved to the
   * thread: they are detached (empty) on this side once the call is posted.
   */
  async call<K extends keyof Ops & string>(
    op: K,
    args: Ops[K]['args'],
    options: { transfer?: ArrayBuffer[]; lane?: Lane } = {},
  ): Promise<Ops[K]['result']> {
    // Wait for a restart outside the gate, so that it does not hold up the other models.
    await this.current();
    return gate.run(options.lane ?? 'batch', async () => {
      const worker = await this.current();
      return new Promise<Ops[K]['result']>((resolve, reject) => {
        const id = this.nextId++;
        this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        worker.ref();
        try {
          const message: HostMessage = { type: 'call', id, op, args };
          worker.postMessage(message, options.transfer ?? []);
        } catch (err: unknown) {
          this.pending.delete(id);
          this.idle();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }

  /** Ends the thread: lets the service release its sessions, then stops it. Pending calls fail. */
  async close(): Promise<void> {
    if (this.state === 'closed') return;
    this.state = 'closed';
    open.delete(this as unknown as InferenceThread<OpMap, unknown, unknown, unknown>);
    this.rejectPending(this.closedError());
    this.live = Promise.reject(this.closedError());
    this.live.catch(() => undefined);
    this.worker = null;
    await Promise.all([...this.workers].map((worker) => stopWorker(worker)));
  }

  private closedError(): Error {
    return new Error(`${this.spec.name}: Rechenthread wurde beendet.`);
  }

  private current(): Promise<Worker> {
    if (this.state === 'closed') return Promise.reject(this.closedError());
    if (this.state === 'failed') return Promise.reject(this.failure ?? new Error(`${this.spec.name} ist nicht verfügbar.`));
    if (!this.live) return Promise.reject(new Error('Model is not loaded yet.'));
    return this.live;
  }

  private adopt(worker: Worker): void {
    this.worker = worker;
    this.state = 'ready';
    this.live = Promise.resolve(worker);
    this.idle();
  }

  private giveUp(error: Error): void {
    this.state = 'failed';
    this.failure = error;
    this.worker = null;
    this.live = Promise.reject(error);
    this.live.catch(() => undefined);
    this.rejectPending(error);
  }

  /** Lets the process end while the thread has nothing to do. */
  private idle(): void {
    if (this.pending.size === 0) this.worker?.unref();
  }

  private rejectPending(error: Error): void {
    const calls = [...this.pending.values()];
    this.pending.clear();
    for (const call of calls) call.reject(error);
  }

  private spawn(): Promise<{ worker: Worker; info: Info }> {
    return new Promise((resolve, reject) => {
      const boot: WorkerBoot = { service: this.spec.service, options: this.spec.options };
      let worker: Worker;
      try {
        const execArgv = workerExecArgv();
        worker = new Worker(workerEntry, { workerData: boot, ...(execArgv ? { execArgv } : {}) });
      } catch (err: unknown) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this.workers.add(worker);
      let ready = false;
      let lastError: Error | null = null;
      worker.on('message', (message: ThreadMessage) => {
        switch (message.type) {
          case 'ready':
            ready = true;
            resolve({ worker, info: message.info as Info });
            break;
          case 'failed':
            // The service could not load; the thread ends by itself after this message.
            lastError = deserializeError(message.error);
            void stopWorker(worker);
            break;
          case 'event':
            try {
              this.spec.onEvent?.(message.event as Event);
            } catch {
              // A listener's mistake must not end the model.
            }
            break;
          case 'result':
          case 'error': {
            const call = this.pending.get(message.id);
            if (!call) break;
            this.pending.delete(message.id);
            if (message.type === 'result') {
              this.restartAllowed = true;
              call.resolve(message.value);
            } else {
              call.reject(deserializeError(message.error));
            }
            this.idle();
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
          reject(lastError ?? new Error(`${this.spec.name}: Rechenthread endete beim Laden (Code ${code}).`));
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
    this.worker = null;
    this.rejectPending(new Error(`${this.spec.name}: Rechenthread ist ausgefallen (${reason}); der Aufruf wurde nicht beendet.`));
    if (!this.restartAllowed) {
      this.giveUp(new Error(`${this.spec.name}: Rechenthread ist erneut ausgefallen (${reason}); das Modell steht bis zum Neustart des Knotens nicht zur Verfügung.`));
      this.notifyGiveUp();
      return;
    }
    this.restartAllowed = false;
    this.state = 'restarting';
    this.live = this.spawn().then(
      ({ worker: next, info }) => {
        if (this.state === 'closed') {
          void stopWorker(next);
          throw this.closedError();
        }
        try {
          this.spec.onReady?.(info, true);
        } catch (err: unknown) {
          void stopWorker(next);
          throw err;
        }
        this.adopt(next);
        return next;
      },
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`${this.spec.name}: Neustart des Rechenthreads fehlgeschlagen (${message}).`);
      },
    );
    this.live.catch((err: unknown) => {
      if (this.state === 'closed') return;
      this.giveUp(err instanceof Error ? err : new Error(String(err)));
      this.notifyGiveUp();
    });
  }

  private notifyGiveUp(): void {
    const failure = this.failure;
    if (!failure) return;
    try {
      this.spec.onGiveUp?.(failure);
    } catch {
      // The thread is gone either way.
    }
  }
}

/** Asks the service to release its sessions, and stops the worker if it does not end by itself. */
async function stopWorker(worker: Worker): Promise<void> {
  const exited = new Promise<void>((resolve) => worker.once('exit', () => resolve()));
  try {
    const message: HostMessage = { type: 'close' };
    worker.postMessage(message);
  } catch {
    // Already gone.
  }
  const timer = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 3000).unref());
  if ((await Promise.race([exited, timer])) === 'timeout') await worker.terminate();
}

/** Stops every inference thread of this process (node shutdown, end of a script). */
export async function closeInferenceThreads(): Promise<void> {
  await Promise.all([...open].map((thread) => thread.close()));
}
