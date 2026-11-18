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
