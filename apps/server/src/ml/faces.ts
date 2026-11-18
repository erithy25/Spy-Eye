import fs from 'node:fs/promises';
import path from 'node:path';
import * as ort from 'onnxruntime-node';
import { config } from '../config.js';
import { writeFileAtomic } from '../core/json.js';
import type { DecodedFrame } from './preprocess.js';

/**
 * Face detector used for one thing only: masking. It finds face rectangles so they can be
 * pixelated in every stored frame. It produces no identity features and cannot recognize anyone.
 *
 * Model: YuNet (OpenCV Zoo, MIT licence), a 75k-parameter detector that runs in a few
 * milliseconds on a CPU.
 */

const MODEL_REPO = 'opencv/face_detection_yunet';
const MODEL_FILE = 'face_detection_yunet_2023mar.onnx';
const INPUT = 640;
const STRIDES = [8, 16, 32] as const;
const SCORE_THRESHOLD = 0.55;
const NMS_IOU = 0.3;

export interface FaceBox {
  /** Pixel rectangle in the frame. */
  left: number;
  top: number;
  width: number;
  height: number;
  score: number;
}

function iou(a: FaceBox, b: FaceBox): number {
  const x1 = Math.max(a.left, b.left);
  const y1 = Math.max(a.top, b.top);
  const x2 = Math.min(a.left + a.width, b.left + b.width);
  const y2 = Math.min(a.top + a.height, b.top + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

export class FaceDetector {
  private session: ort.InferenceSession | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  /** Why masking is unavailable, when it is. */
  problem: string | null = 'not loaded';

  get ready(): boolean {
    return this.session !== null;
  }

  /** Loads the detector, downloading the weights once if they are not cached. Never throws. */
  async load(): Promise<void> {
    const file = path.join(config.modelCacheDir, MODEL_REPO, MODEL_FILE);
    try {
      try {
        await fs.access(file);
      } catch {
        if (config.offline) throw new Error('Gewichte fehlen im Cache und der Offline-Modus ist aktiv');
        const response = await fetch(`https://huggingface.co/${MODEL_REPO}/resolve/main/${MODEL_FILE}`);
        if (!response.ok) throw new Error(`Download fehlgeschlagen (HTTP ${response.status})`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length < 100_000) throw new Error('Download unvollständig');
        await writeFileAtomic(file, bytes);
      }
      this.session = await ort.InferenceSession.create(file, { intraOpNumThreads: Math.min(4, config.threads) });
      // Fail early if the model does not behave as expected.
      const blank: DecodedFrame = { data: Buffer.alloc(64 * 64 * 3), width: 64, height: 64 };
      await this.detect(blank);
      this.problem = null;
    } catch (err: unknown) {
      this.session = null;
      this.problem = err instanceof Error ? err.message : String(err);
    }
  }

  /** Returns face rectangles in pixel coordinates of the given frame. */
  detect(frame: DecodedFrame): Promise<FaceBox[]> {
    const run = this.queue.then(() => this.run(frame));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run(frame: DecodedFrame): Promise<FaceBox[]> {
    const session = this.session;
    if (!session) return [];
    // Letterbox into the square network input, top-left aligned; BGR, 0..255, planar.
    const scale = Math.min(1, INPUT / Math.max(frame.width, frame.height));
    const w = Math.max(1, Math.round(frame.width * scale));
    const h = Math.max(1, Math.round(frame.height * scale));
    const plane = INPUT * INPUT;
    const input = new Float32Array(3 * plane);
    const src = frame.data;
    for (let y = 0; y < h; y++) {
      const sy = Math.min(frame.height - 1, Math.floor(y / scale));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(frame.width - 1, Math.floor(x / scale));
        const o = (sy * frame.width + sx) * 3;
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
          width: Math.min(frame.width - left, b.width - (left - b.left)),
          height: Math.min(frame.height - top, b.height - (top - b.top)),
          score: b.score,
        };
      })
      .filter((b) => b.width >= 4 && b.height >= 4);
  }
}

/**
 * Pixelates the given rectangles in place. Each rectangle is enlarged first so that hair line,
 * chin and ears are covered as well; block size scales with the face so no features survive.
 */
export function pixelate(frame: DecodedFrame, boxes: readonly FaceBox[], grow = 0.3): void {
  const { data, width, height } = frame;
  for (const box of boxes) {
    const gx = box.width * grow;
    const gy = box.height * grow;
    const x0 = Math.max(0, Math.floor(box.left - gx));
    const y0 = Math.max(0, Math.floor(box.top - gy));
    const x1 = Math.min(width, Math.ceil(box.left + box.width + gx));
    const y1 = Math.min(height, Math.ceil(box.top + box.height + gy));
    const block = Math.max(6, Math.round(Math.max(x1 - x0, y1 - y0) / 5));
    for (let by = y0; by < y1; by += block) {
      for (let bx = x0; bx < x1; bx += block) {
        const ex = Math.min(x1, bx + block);
        const ey = Math.min(y1, by + block);
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let y = by; y < ey; y++) {
          for (let x = bx; x < ex; x++) {
            const o = (y * width + x) * 3;
            r += data[o] as number;
            g += data[o + 1] as number;
            b += data[o + 2] as number;
            n++;
          }
        }
        if (n === 0) continue;
        r = Math.round(r / n);
        g = Math.round(g / n);
        b = Math.round(b / n);
        for (let y = by; y < ey; y++) {
          for (let x = bx; x < ex; x++) {
            const o = (y * width + x) * 3;
            data[o] = r;
            data[o + 1] = g;
            data[o + 2] = b;
          }
        }
      }
    }
  }
}
