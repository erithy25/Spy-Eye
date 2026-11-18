import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { writeFileAtomic } from '../core/json.js';
import type { DecodedFrame } from './preprocess.js';
import { InferenceThread } from './workerHost.js';
import type { YunetOps, YunetOptions } from './yunetService.js';

/**
 * Face detector used for one thing only: masking. It finds face rectangles so they can be
 * pixelated in every stored frame. It produces no identity features and cannot recognize anyone.
 *
 * Model: YuNet (OpenCV Zoo, MIT licence), a 75k-parameter detector that runs in a few
 * milliseconds on a CPU. It runs in an inference thread of its own (yunetService.ts), like the
 * other models, so that its runs never hold the main thread.
 */

const MODEL_REPO = 'opencv/face_detection_yunet';
const MODEL_FILE = 'face_detection_yunet_2023mar.onnx';

export interface FaceBox {
  /** Pixel rectangle in the frame. */
  left: number;
  top: number;
  width: number;
  height: number;
  score: number;
}

type YunetThread = InferenceThread<YunetOps, YunetOptions, Record<string, never>>;

export class FaceDetector {
  private thread: YunetThread | null = null;
  /** Why masking is unavailable, when it is. */
  problem: string | null = 'not loaded';

  get ready(): boolean {
    return this.thread !== null && this.thread.usable;
  }

  /** Loads the detector, downloading the weights once if they are not cached. Never throws. */
  async load(): Promise<void> {
    const file = path.join(config.modelCacheDir, MODEL_REPO, MODEL_FILE);
    const previous = this.thread;
    this.thread = null;
    await previous?.close();
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
      const thread: YunetThread = new InferenceThread({
        name: 'Gesichtsdetektor',
        service: 'yunet',
        options: { file, threads: Math.min(4, config.threads) },
        onGiveUp: (error) => {
          // Without the detector no frame is released (pipeline.ts); say why.
          this.problem = error.message;
        },
      });
      try {
        // The thread's init also runs one detection on a blank frame (fails early on a bad model).
        await thread.start();
      } catch (err: unknown) {
        await thread.close();
        throw err;
      }
      this.thread = thread;
      this.problem = null;
    } catch (err: unknown) {
      this.thread = null;
      this.problem = err instanceof Error ? err.message : String(err);
    }
  }

  /** Returns face rectangles in pixel coordinates of the given frame. */
  detect(frame: DecodedFrame): Promise<FaceBox[]> {
    const thread = this.thread;
    if (!thread) return Promise.resolve([]);
    // A copy goes to the thread: the caller pixelates `frame.data` afterwards.
    const rgb = new Uint8Array(frame.data);
    return thread.call('detect', { rgb, width: frame.width, height: frame.height }, { transfer: [rgb.buffer] });
  }

  /** Stops the detector's inference thread; `load` starts it again. */
  async dispose(): Promise<void> {
    const thread = this.thread;
    this.thread = null;
    this.problem = 'not loaded';
    await thread?.close();
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
