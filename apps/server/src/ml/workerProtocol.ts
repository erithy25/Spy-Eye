/**
 * Messages between the main thread (workerHost.ts) and an inference thread (inferenceWorker.ts).
 *
 * onnxruntime-node executes a session run synchronously on the thread that calls it, so every
 * model runs in a worker thread of its own and the main thread only posts inputs and receives
 * results. This module holds what both sides need and imports nothing heavy: the main thread must
 * not load onnxruntime or transformers.js at all.
 */

/** The model services an inference thread can run (see inferenceWorker.ts); 'check' has no model (tests). */
export type ServiceName = 'siglip' | 'yunet' | 'depth' | 'check';

/** `workerData` of an inference thread: which service to run and how to initialise it. */
export interface WorkerBoot {
  service: ServiceName;
  options: unknown;
  /**
   * The thread's flags in shared memory (see newThreadFlags): its state, whether it is inside a
   * native run, and whether the process is exiting. The main thread reads them while the process
   * exits (see drainAtExit in workerHost.ts), when no message can be received any more.
   */
  closed: Int32Array;
}

/**
 * Slot FLAG_STATE: THREAD_RUNNING until the thread has finished its last call and released its
 * sessions, then THREAD_CLOSED, and THREAD_ENDED once its event loop has run out (markEndOfThread).
 */
export const FLAG_STATE = 0;
/** Slot FLAG_IN_RUN: 1 while the thread is inside an onnxruntime call (see nativeRun), else 0. */
export const FLAG_IN_RUN = 1;
/** Slot FLAG_EXITING: set to 1 by the exiting process; from then on no native run starts. */
export const FLAG_EXITING = 2;

export const THREAD_RUNNING = 0;
export const THREAD_CLOSED = 1;
export const THREAD_ENDED = 2;

/** The shared flags of one onnxruntime thread, all zero (running, no run, not exiting). */
export function newThreadFlags(): Int32Array {
  return new Int32Array(new SharedArrayBuffer(3 * Int32Array.BYTES_PER_ELEMENT));
}

/** Thrown by nativeRun once the process is exiting. */
export class ProcessExitingError extends Error {
  constructor() {
    super('Der Prozess wird beendet.');
    this.name = 'ProcessExitingError';
  }
}

/**
 * Runs `job`, which calls into onnxruntime (a session run, a session's creation, a model's
 * load), with FLAG_IN_RUN set for its whole length. A thread that the exiting process stops while
 * it is inside such a call aborts the process (SIGABRT on Linux, 0xC0000409 on Windows); outside
 * of one, stopping it is safe, also in the middle of plain JavaScript.
 *
 * The handshake with the exiting process (drainAtExit) cannot miss: the job marks the run first
 * and then looks at FLAG_EXITING, the process sets FLAG_EXITING first and then looks at
 * FLAG_IN_RUN, both with sequentially consistent atomics. So either the job sees the exit and does
 * not start, or the process sees the run and waits for its end.
 */
export async function nativeRun<T>(flags: Int32Array, job: () => Promise<T>): Promise<T> {
  Atomics.store(flags, FLAG_IN_RUN, 1);
  if (Atomics.load(flags, FLAG_EXITING) === 1) {
    Atomics.store(flags, FLAG_IN_RUN, 0);
    Atomics.notify(flags, FLAG_IN_RUN);
    throw new ProcessExitingError();
  }
  try {
    return await job();
  } finally {
    Atomics.store(flags, FLAG_IN_RUN, 0);
    Atomics.notify(flags, FLAG_IN_RUN);
  }
}

/**
 * Called once in an onnxruntime thread: when its event loop has run out (the 'exit' event of the
 * thread, after its sessions were released), the shared flag becomes THREAD_ENDED. A process
 * that exits waits for this, not only for THREAD_CLOSED: on Windows a thread that the exiting
 * process has to stop while it is still winding down (its port closed, its loop not yet empty)
 * can take the process down with a fail-fast abort (0xC0000409) in onnxruntime's binding.
 */
export function markEndOfThread(flags: Int32Array): void {
  process.once('exit', () => {
    Atomics.store(flags, FLAG_STATE, THREAD_ENDED);
    Atomics.notify(flags, FLAG_STATE);
  });
}

/** An error as it crosses the thread boundary; structured clone would drop its class and stack. */
export interface SerializedError {
  name: string;
  message: string;
  stack: string | null;
}

/** Main thread → inference thread. */
export type HostMessage = { type: 'call'; id: number; op: string; args: unknown } | { type: 'close' };

/** Inference thread → main thread. */
export type ThreadMessage =
  | { type: 'ready'; info: unknown }
  | { type: 'failed'; error: SerializedError }
  | { type: 'event'; event: unknown }
  | { type: 'result'; id: number; value: unknown }
  | { type: 'error'; id: number; error: SerializedError };

/** What a service call answers: the value, and the buffers in it that are moved, not copied. */
export interface Reply<T> {
  value: T;
  transfer: ArrayBuffer[];
}

/** Operations of a service: argument and result type per operation name. */
export type OpMap = Record<string, { args: unknown; result: unknown }>;

/** One model's code inside an inference thread. */
export interface InferenceService {
  /** Loads the model; runs once per thread (again in a restarted thread). */
  init(options: unknown, notify: (event: unknown) => void): Promise<unknown>;
  call(op: string, args: unknown): Promise<Reply<unknown>>;
  /** Releases the sessions before the thread ends. */
  dispose(): Promise<void>;
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack ?? null };
  return { name: 'Error', message: String(err), stack: null };
}

/** Rebuilds an error with the message the model code threw, so callers see the same text as before. */
export function deserializeError(e: SerializedError): Error {
  const err = new Error(e.message);
  err.name = e.name;
  if (e.stack !== null) err.stack = e.stack;
  return err;
}

/**
 * A view whose buffer can be moved to another thread: the view itself when it spans all of an
 * ordinary ArrayBuffer, otherwise a copy of just its bytes (a slice of a larger buffer or a
 * SharedArrayBuffer must not be detached as a whole).
 */
export function movable<T extends Float32Array | Uint8Array>(view: T): T & { buffer: ArrayBuffer } {
  if (view.buffer instanceof ArrayBuffer && view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
    return view as T & { buffer: ArrayBuffer };
  }
  return view.slice() as T & { buffer: ArrayBuffer };
}
