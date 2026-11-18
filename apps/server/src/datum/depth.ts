/**
 * Monocular depth for the spatial reconstruction: Depth Anything V2 Small (Apache-2.0), ONNX export
 * `onnx-community/depth-anything-v2-small`, run in-process on onnxruntime through
 * `@huggingface/transformers`.
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
import { AutoModel, Tensor, env } from '@huggingface/transformers';
import { config } from '../config.js';

export const depthModelId = 'onnx-community/depth-anything-v2-small';

type DepthDtype = 'fp32' | 'fp16' | 'q8';

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

/** ImageNet normalisation (preprocessor_config.json of the model). */
const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;
const PATCH = 14;

interface DepthSession {
  (inputs: Record<string, unknown>): Promise<Record<string, Tensor | undefined>>;
}

let sessionPromise: Promise<DepthSession> | null = null;
/** Inference is serialised: one onnxruntime session, all cores per run. */
let queue: Promise<unknown> = Promise.resolve();

function devicesToTry(): string[] {
  if (config.device === 'cpu') return ['cpu'];
  if (config.device === 'auto') {
    if (process.platform === 'win32') return ['dml', 'cpu'];
    if (process.platform === 'linux' && process.arch === 'x64') return ['cuda', 'cpu'];
    return ['cpu'];
  }
  return [config.device, 'cpu'];
}

async function loadSession(dtype: DepthDtype = depthDtype()): Promise<DepthSession> {
  env.cacheDir = config.modelCacheDir;
  env.allowRemoteModels = !config.offline;
  env.allowLocalModels = true;
  let lastError: unknown = null;
  for (const device of devicesToTry()) {
    try {
      const model = await AutoModel.from_pretrained(depthModelId, {
        dtype,
        ...(device === 'cpu' ? {} : { device: device as 'cuda' }),
        session_options: { intraOpNumThreads: config.threads, interOpNumThreads: 1 },
      });
      return model as unknown as DepthSession;
    } catch (err: unknown) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function session(): Promise<DepthSession> {
  sessionPromise ??= loadSession().catch((err: unknown) => {
    sessionPromise = null;
    throw err;
  });
  return sessionPromise;
}

/** Fetches the depth model into the model cache (for the download script); loads it once. */
export async function ensureDepthModel(): Promise<void> {
  await session();
}

/** Input size for an image: longer side `size`, both sides multiples of 14, aspect kept. */
export function depthInputDims(width: number, height: number, size = depthInputSize()): { w: number; h: number } {
  const scale = size / Math.max(width, height);
  const w = Math.max(PATCH, Math.round((width * scale) / PATCH) * PATCH);
  const h = Math.max(PATCH, Math.round((height * scale) / PATCH) * PATCH);
  return { w, h };
}

async function preprocess(jpegPath: string): Promise<{ tensor: Tensor; w: number; h: number }> {
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
  const plane = w * h;
  const data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let c = 0; c < 3; c++) {
      data[c * plane + i] = ((raw[i * 3 + c] as number) / 255 - (MEAN[c] as number)) / (STD[c] as number);
    }
  }
  return { tensor: new Tensor('float32', data, [1, 3, h, w]), w, h };
}

/**
 * Relative inverse depth of a picture at the network's resolution (longer side 518 px by
 * default). `data` is row-major from the top-left, larger = nearer, arbitrary scale and offset.
 */
export async function estimateDisparity(
  jpegPath: string,
): Promise<{ width: number; height: number; data: Float32Array; ms: number }> {
  const model = await session();
  const { tensor, w, h } = await preprocess(jpegPath);
  const job = queue.then(async () => {
    const started = performance.now();
    const output = await model({ pixel_values: tensor });
    const depth = output['predicted_depth'] ?? Object.values(output).find((t) => t !== undefined);
    if (!depth) throw new Error('depth: model returned no output');
    const dims = depth.dims;
    const outH = dims.length >= 2 ? (dims[dims.length - 2] as number) : h;
    const outW = dims.length >= 1 ? (dims[dims.length - 1] as number) : w;
    const src = depth.data as Float32Array | Uint16Array;
    let data: Float32Array;
    if (src instanceof Float32Array) {
      data = new Float32Array(src);
    } else {
      // A half-precision export may hand back float16 bits; the Tensor knows how to widen them.
      data = new Float32Array((depth.to('float32').data as Float32Array).buffer.slice(0));
    }
    for (let i = 0; i < data.length; i++) if (!Number.isFinite(data[i] as number)) data[i] = 0;
    return { width: outW, height: outH, data, ms: performance.now() - started };
  });
  queue = job.catch(() => undefined);
  return job;
}

/** For measurements only: loads the model in another precision without touching the shared one. */
export async function benchmarkDepthDtype(
  dtype: DepthDtype,
  jpegPaths: string[],
): Promise<{ dtype: DepthDtype; loadMs: number; perFrameMs: number[]; outputs: Float32Array[] }> {
  const t0 = performance.now();
  const model = await loadSession(dtype);
  const loadMs = performance.now() - t0;
  const perFrameMs: number[] = [];
  const outputs: Float32Array[] = [];
  for (const p of jpegPaths) {
    const { tensor } = await preprocess(p);
    const t = performance.now();
    const out = await model({ pixel_values: tensor });
    perFrameMs.push(performance.now() - t);
    const d = out['predicted_depth'];
    outputs.push(d ? new Float32Array(d.to('float32').data as Float32Array) : new Float32Array(0));
  }
  const dispose = (model as unknown as { dispose?: () => Promise<unknown> }).dispose;
  if (typeof dispose === 'function') await dispose.call(model).catch(() => undefined);
  return { dtype, loadMs, perFrameMs, outputs };
}
