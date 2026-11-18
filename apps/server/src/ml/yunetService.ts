/**
 * YuNet face detector (see faces.ts) on onnxruntime. Runs inside an inference thread (see
 * inferenceWorker.ts); `YunetEngine` can also be used directly on the calling thread.
 */
import * as ort from 'onnxruntime-node';
import type { FaceBox } from './faces.js';
import type { InferenceService, Reply } from './workerProtocol.js';

const INPUT = 640;
const STRIDES = [8, 16, 32] as const;
const SCORE_THRESHOLD = 0.55;
const NMS_IOU = 0.3;

export interface YunetOptions {
  /** The ONNX file in the model cache (faces.ts fetches it first). */
  file: string;
  threads: number;
}

export type YunetOps = {
  /** Face rectangles in pixel coordinates of an RGB frame (3 bytes per pixel, row-major). */
  detect: { args: { rgb: Uint8Array; width: number; height: number }; result: FaceBox[] };
};

function iou(a: FaceBox, b: FaceBox): number {
  const x1 = Math.max(a.left, b.left);
  const y1 = Math.max(a.top, b.top);
  const x2 = Math.min(a.left + a.width, b.left + b.width);
  const y2 = Math.min(a.top + a.height, b.top + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

export class YunetEngine {
  private session: ort.InferenceSession | null = null;

  async load(options: YunetOptions): Promise<Record<string, never>> {
    this.session = await ort.InferenceSession.create(options.file, { intraOpNumThreads: options.threads });
    // Fail early if the model does not behave as expected.
    await this.detect(new Uint8Array(64 * 64 * 3), 64, 64);
    return {};
  }

  async detect(src: Uint8Array, width: number, height: number): Promise<FaceBox[]> {
    const session = this.session;
    if (!session) return [];
    // Letterbox into the square network input, top-left aligned; BGR, 0..255, planar.
    const scale = Math.min(1, INPUT / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const plane = INPUT * INPUT;
    const input = new Float32Array(3 * plane);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(height - 1, Math.floor(y / scale));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(width - 1, Math.floor(x / scale));
        const o = (sy * width + sx) * 3;
        const i = y * INPUT + x;
        input[i] = src[o + 2] as number;
        input[plane + i] = src[o + 1] as number;
        input[2 * plane + i] = src[o] as number;
      }
    }
    const feeds: Record<string, ort.Tensor> = {
      [session.inputNames[0] as string]: new ort.Tensor('float32', input, [1, 3, INPUT, INPUT]),
    };
    const out = await session.run(feeds);

    const candidates: FaceBox[] = [];
    for (const stride of STRIDES) {
      const cls = out[`cls_${stride}`]?.data as Float32Array | undefined;
      const obj = out[`obj_${stride}`]?.data as Float32Array | undefined;
      const bbox = out[`bbox_${stride}`]?.data as Float32Array | undefined;
      if (!cls || !obj || !bbox) throw new Error('Unexpected face detector outputs');
      const cols = INPUT / stride;
      const rows = INPUT / stride;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const score = Math.sqrt(
            Math.min(1, Math.max(0, cls[idx] as number)) * Math.min(1, Math.max(0, obj[idx] as number)),
          );
          if (score < SCORE_THRESHOLD) continue;
          const cx = (c + (bbox[idx * 4] as number)) * stride;
          const cy = (r + (bbox[idx * 4 + 1] as number)) * stride;
          const bw = Math.exp(bbox[idx * 4 + 2] as number) * stride;
          const bh = Math.exp(bbox[idx * 4 + 3] as number) * stride;
          candidates.push({
            left: (cx - bw / 2) / scale,
            top: (cy - bh / 2) / scale,
            width: bw / scale,
            height: bh / scale,
            score,
          });
        }
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const kept: FaceBox[] = [];
    for (const cand of candidates) {
      if (kept.every((k) => iou(k, cand) < NMS_IOU)) kept.push(cand);
    }
    return kept
      .map((b) => {
        const left = Math.max(0, b.left);
        const top = Math.max(0, b.top);
        return {
          left,
          top,
          width: Math.min(width - left, b.width - (left - b.left)),
          height: Math.min(height - top, b.height - (top - b.top)),
          score: b.score,
        };
      })
      .filter((b) => b.width >= 4 && b.height >= 4);
  }

  async dispose(): Promise<void> {
    const session = this.session;
    this.session = null;
    await session?.release().catch(() => undefined);
  }
}

/** The engine as a service of an inference thread. */
export function createYunetService(): InferenceService {
  const engine = new YunetEngine();
  return {
    init: (options) => engine.load(options as YunetOptions),
    async call(op, args): Promise<Reply<unknown>> {
      if (op !== 'detect') throw new Error(`yunet: unknown operation ${op}`);
      const { rgb, width, height } = args as YunetOps['detect']['args'];
      return { value: await engine.detect(rgb, width, height), transfer: [] };
    },
    dispose: () => engine.dispose(),
  };
}
