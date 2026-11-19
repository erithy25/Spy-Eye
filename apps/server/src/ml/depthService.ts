/**
 * Depth Anything V2 Small (see datum/depth.ts) on onnxruntime through transformers.js. Runs
 * inside an inference thread (see inferenceWorker.ts); `DepthEngine` can also be used directly on
 * the calling thread.
 */
import { AutoModel, Tensor, env } from '@huggingface/transformers';
import { withoutModelFileReads } from './modelFileReads.js';
import type { InferenceService, Reply } from './workerProtocol.js';

export type DepthDtype = 'fp32' | 'fp16' | 'q8';

export interface DepthOptions {
  modelId: string;
  dtype: DepthDtype;
  /** Execution providers in the order they are tried. */
  devices: string[];
  threads: number;
  cacheDir: string;
  offline: boolean;
}

export interface DisparityMap {
  width: number;
  height: number;
  data: Float32Array;
  ms: number;
}

export type DepthOps = {
  /**
   * Relative inverse depth of an RGB picture already resized to the network input (3 bytes per
   * pixel, row-major). `finite`: NaN and infinities are replaced by 0 (the node's use).
   */
  run: { args: { rgb: Uint8Array; width: number; height: number; finite: boolean }; result: DisparityMap };
};

/** ImageNet normalisation (preprocessor_config.json of the model). */
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

interface DepthSession {
  (inputs: Record<string, unknown>): Promise<Record<string, Tensor | undefined>>;
}

export class DepthEngine {
  private model: DepthSession | null = null;

  async load(options: DepthOptions): Promise<Record<string, never>> {
    env.cacheDir = options.cacheDir;
    env.allowRemoteModels = !options.offline;
    env.allowLocalModels = true;
    let lastError: unknown = null;
    for (const device of options.devices) {
      try {
        const model = await AutoModel.from_pretrained(options.modelId, {
          dtype: options.dtype,
          ...(device === 'cpu' ? {} : { device: device as 'cuda' }),
          session_options: { intraOpNumThreads: options.threads, interOpNumThreads: 1 },
        });
        this.model = model as unknown as DepthSession;
        return {};
      } catch (err: unknown) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async run(rgb: Uint8Array, w: number, h: number, finite: boolean): Promise<DisparityMap & { data: Float32Array<ArrayBuffer> }> {
    const model = this.model;
    if (!model) throw new Error('depth: model is not loaded');
    const plane = w * h;
    if (rgb.length !== 3 * plane) throw new Error(`depth: ${rgb.length} bytes for ${w} × ${h} pixels`);
    const input = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      for (let c = 0; c < 3; c++) {
        input[c * plane + i] = ((rgb[i * 3 + c] as number) / 255 - (MEAN[c] as number)) / (STD[c] as number);
      }
    }
    const tensor = new Tensor('float32', input, [1, 3, h, w]);
    const started = performance.now();
    const output = await model({ pixel_values: tensor });
    const depth = output['predicted_depth'] ?? Object.values(output).find((t) => t !== undefined);
    if (!depth) throw new Error('depth: model returned no output');
    const dims = depth.dims;
    const outH = dims.length >= 2 ? (dims[dims.length - 2] as number) : h;
    const outW = dims.length >= 1 ? (dims[dims.length - 1] as number) : w;
    const src = depth.data as Float32Array | Uint16Array;
    let data: Float32Array<ArrayBuffer>;
    if (src instanceof Float32Array) {
      data = new Float32Array(src);
    } else {
      // A half-precision export may hand back float16 bits; the Tensor knows how to widen them.
      data = new Float32Array(depth.to('float32').data as Float32Array);
    }
    if (finite) for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i] as number)) data[i] = 0;
    return { width: outW, height: outH, data, ms: performance.now() - started };
  }

  async dispose(): Promise<void> {
    const model = this.model;
    this.model = null;
    const dispose = (model as unknown as { dispose?: () => Promise<unknown> } | null)?.dispose;
    if (model && typeof dispose === 'function') await dispose.call(model).catch(() => undefined);
  }
}

/** The engine as a service of an inference thread. */
export function createDepthService(): InferenceService {
  const engine = new DepthEngine();
  return {
    // The thread does nothing but this model: the file reads transformers.js leaves running end
    // with the load (see modelFileReads.ts).
    init: (options) => withoutModelFileReads(() => engine.load(options as DepthOptions)),
    async call(op, args): Promise<Reply<unknown>> {
      if (op !== 'run') throw new Error(`depth: unknown operation ${op}`);
      const { rgb, width, height, finite } = args as DepthOps['run']['args'];
      const value = await engine.run(rgb, width, height, finite);
      return { value, transfer: [value.data.buffer] };
    },
    dispose: () => engine.dispose(),
  };
}
