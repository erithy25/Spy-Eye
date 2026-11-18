/**
 * A service without a model, for checking the thread machinery itself (test/inference-worker.test.ts):
 * it moves buffers back, blocks its thread like a session run does, throws, and can end its
 * thread the way a crash would. Never started by the node.
 */
import { threadId } from 'node:worker_threads';
import type { InferenceService, Reply } from './workerProtocol.js';

export interface CheckOptions {
  /** Makes init throw with this message. */
  failInit: string | null;
}

export interface CheckInfo {
  threadId: number;
}

export type CheckOps = {
  /** Doubles every value and moves the result back. */
  double: { args: { values: Float32Array }; result: Float32Array };
  /** Keeps the thread busy for `ms`, as a synchronous onnxruntime run does; times in epoch ms. */
  block: { args: { ms: number; tag: string }; result: { tag: string; start: number; end: number } };
  /** Rejects with `message`. */
  fail: { args: { message: string }; result: never };
  /** Ends the thread with exit code 1 in the middle of the call. */
  crash: { args: null; result: never };
};

export function createCheckService(): InferenceService {
  return {
    async init(options): Promise<CheckInfo> {
      const { failInit } = options as CheckOptions;
      if (failInit !== null) throw new Error(failInit);
      return { threadId };
    },
    async call(op, args): Promise<Reply<unknown>> {
      switch (op) {
        case 'double': {
          const { values } = args as CheckOps['double']['args'];
          const out = Float32Array.from(values, (v) => v * 2);
          return { value: out, transfer: [out.buffer] };
        }
        case 'block': {
          const { ms, tag } = args as CheckOps['block']['args'];
          // Date.now() for the reported times: it is the one clock all threads read alike
          // (performance.now() counts from each thread's own start).
          const start = Date.now();
          const began = performance.now();
          while (performance.now() - began < ms) {
            // Busy on purpose: this is what a session run does to its thread.
          }
          return { value: { tag, start, end: Date.now() }, transfer: [] };
        }
        case 'fail':
          throw new Error((args as CheckOps['fail']['args']).message);
        case 'crash':
          process.exit(1);
        default:
          throw new Error(`check: unknown operation ${op}`);
      }
    },
    async dispose(): Promise<void> {},
  };
}
