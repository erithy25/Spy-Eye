/**
 * Monocular depth for the spatial reconstruction: Depth Anything V2 Small (Apache-2.0), ONNX export
 * `onnx-community/depth-anything-v2-small`, run in-process on onnxruntime through
 * `@huggingface/transformers`, in an inference thread of its own (ml/depthService.ts): a run takes
 * the calling thread for up to a second, which on the main thread held every request.
 *
 * The network returns relative inverse depth ("disparity"): larger values are nearer, the scale and
 * offset are unknown (affine-invariant). `space.ts` turns it into metres.
 *
 * The weights are fetched once into the shared model cache (`config.modelCacheDir`) like the
 * other models and are read from there afterwards; with `SICHT_OFFLINE=1` nothing is fetched.
 *
 * Settings (read from the environment here until they move to config.ts):
 *   DATUM_DEPTH_DTYPE  fp32 | fp16 | q8   (default fp32: fastest on CPU, see below)
 *   DATUM_DEPTH_SIZE   longer input side in pixels, multiple of 14 (default 518, the training size)
 *
 * Measured on a 4-core x86 CPU at 518 × 294 input (640 × 360 frame), idle machine: fp32 0.23–0.34 s,
 * q8 0.30–0.39 s, fp16 0.29–0.60 s per frame (fp16 runs through casts on CPU; q8 correlates 0.998
 * with fp32 but is not faster). With other heavy processes running, fp32 took 0.7–1.3 s.
 */
import sharp from 'sharp';
import { config } from '../config.js';
import type { DepthDtype, DepthOps, DepthOptions, DisparityMap } from '../ml/depthService.js';
import { InferenceThread } from '../ml/workerHost.js';

export const depthModelId = 'onnx-community/depth-anything-v2-small';

function depthDtype(): DepthDtype {
  const raw = (process.env['DATUM_DEPTH_DTYPE'] ?? '').trim().toLowerCase();
  if (raw === 'fp16' || raw === 'q8' || raw === 'fp32') return raw;
  return 'fp32';
}

function depthInputSize(): number {
  const raw = Number(process.env['DATUM_DEPTH_SIZE'] ?? '');
  if (!Number.isFinite(raw) || raw < 140 || raw > 1400) return 518;
  return Math.round(raw / 14) * 14;
}

const PATCH = 14;

type DepthThread = InferenceThread<DepthOps, DepthOptions, Record<string, never>>;

/** The shared thread with the model in the configured precision; started on first use. */
let threadPromise: Promise<DepthThread> | null = null;

function devicesToTry(): string[] {
  if (config.device === 'cpu') return ['cpu'];
  if (config.device === 'auto') {
    if (process.platform === 'win32') return ['dml', 'cpu'];
    if (process.platform === 'linux' && process.arch === 'x64') return ['cuda', 'cpu'];
    return ['cpu'];
  }
  return [config.device, 'cpu'];
}

/** Starts an inference thread with the model; one session, all cores per run. */
async function startThread(dtype: DepthDtype): Promise<DepthThread> {
  const thread: DepthThread = new InferenceThread({
    name: 'Tiefenmodell',
    service: 'depth',
    options: {
      modelId: depthModelId,
      dtype,
      devices: devicesToTry(),
      threads: config.threads,
      cacheDir: config.modelCacheDir,
      offline: config.offline,
    },
  });
  try {
    await thread.start();
  } catch (err: unknown) {
    await thread.close();
    throw err;
  }
  return thread;
}

function session(): Promise<DepthThread> {
  threadPromise ??= startThread(depthDtype()).catch((err: unknown) => {
    threadPromise = null;
    throw err;
  });
  return threadPromise;
}

/** Fetches the depth model into the model cache (for the download script); loads it once. */
export async function ensureDepthModel(): Promise<void> {
  await session();
}

/** Stops the depth model's inference thread; the next estimate starts it again. */
export async function disposeDepthModel(): Promise<void> {
  const pending = threadPromise;
  threadPromise = null;
  if (!pending) return;
  const thread = await pending.catch(() => null);
  await thread?.close();
}

/** Input size for an image: longer side `size`, both sides multiples of 14, aspect kept. */
export function depthInputDims(width: number, height: number, size = depthInputSize()): { w: number; h: number } {
  const scale = size / Math.max(width, height);
  const w = Math.max(PATCH, Math.round((width * scale) / PATCH) * PATCH);
  const h = Math.max(PATCH, Math.round((height * scale) / PATCH) * PATCH);
  return { w, h };
}

/**
 * The picture resized to the network input, RGB bytes. sharp works on its own threads; the
 * normalisation to the network's value range happens in the inference thread.
 */
async function preprocess(jpegPath: string): Promise<{ rgb: Uint8Array<ArrayBuffer>; w: number; h: number }> {
  const meta = await sharp(jpegPath).metadata();
  const srcW = meta.autoOrient?.width ?? meta.width ?? 0;
  const srcH = meta.autoOrient?.height ?? meta.height ?? 0;
  if (srcW <= 0 || srcH <= 0) throw new Error(`depth: unreadable image ${jpegPath}`);
  const { w, h } = depthInputDims(srcW, srcH);
  const raw = await sharp(jpegPath)
    .rotate()
    .removeAlpha()
    .toColourspace('srgb')
    .resize(w, h, { fit: 'fill', kernel: 'cubic' })
    .raw()
    .toBuffer();
  // A copy (a few hundred kB): sharp's output lives in memory its native code owns, which cannot
  // be moved to another thread.
  return { rgb: new Uint8Array(raw), w, h };
}

/**
 * Relative inverse depth of a picture at the network's resolution (longer side 518 px by
 * default). `data` is row-major from the top-left, larger = nearer, arbitrary scale and offset.
 */
export async function estimateDisparity(jpegPath: string): Promise<DisparityMap> {
  const thread = await session();
  const { rgb, w, h } = await preprocess(jpegPath);
  // Runs are serialised with those of the other models (workerHost.ts), in call order.
  return thread.call('run', { rgb, width: w, height: h, finite: true }, { transfer: [rgb.buffer] });
}

/** For measurements only: loads the model in another precision without touching the shared one. */
export async function benchmarkDepthDtype(
  dtype: DepthDtype,
  jpegPaths: string[],
): Promise<{ dtype: DepthDtype; loadMs: number; perFrameMs: number[]; outputs: Float32Array[] }> {
  const t0 = performance.now();
  const thread = await startThread(dtype);
  const loadMs = performance.now() - t0;
  const perFrameMs: number[] = [];
  const outputs: Float32Array[] = [];
  try {
    for (const p of jpegPaths) {
      const { rgb, w, h } = await preprocess(p);
      const out = await thread.call('run', { rgb, width: w, height: h, finite: false }, { transfer: [rgb.buffer] });
      perFrameMs.push(out.ms);
      outputs.push(out.data);
    }
  } finally {
    await thread.close();
  }
  return { dtype, loadMs, perFrameMs, outputs };
}
