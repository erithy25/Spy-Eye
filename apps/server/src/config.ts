import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repository root: this file lives in apps/server/{src,dist}. */
export const repoRoot = path.resolve(here, '..', '..', '..');

function envString(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value.trim() !== '' ? value.trim() : fallback;
}

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid ${name}="${raw}": expected a number between ${min} and ${max}.`);
  }
  return value;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function resolveFromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(repoRoot, p);
}

export type ModelDtype = 'fp32' | 'fp16' | 'q8';

function parseDtype(raw: string): ModelDtype {
  if (raw === 'fp32' || raw === 'fp16' || raw === 'q8') return raw;
  throw new Error(`Invalid MODEL_DTYPE="${raw}": expected fp32, fp16 or q8.`);
}

/**
 * SigLIP 2 (Google, Apache-2.0): free for commercial use, multilingual text encoder (German
 * queries work), and with 32-pixel patches fast enough for processors without a graphics card.
 * MobileCLIP remains selectable but its weights are licensed for research only.
 */
const DEFAULT_MODEL_ID = 'onnx-community/siglip2-base-patch32-256-ONNX';

export const config = {
  host: envString('HOST', '127.0.0.1'),
  port: envNumber('PORT', 8787, 1, 65535),
  dataDir: resolveFromRoot(envString('DATA_DIR', 'data')),
  modelCacheDir: resolveFromRoot(envString('MODEL_CACHE_DIR', '.models')),
  webDistDir: resolveFromRoot(envString('WEB_DIST_DIR', 'apps/web/dist')),
  /** Exercise scenario definitions (scenario.json plus a clips/ folder each). */
  scenariosDir: resolveFromRoot(envString('SCENARIOS_DIR', 'scenarios')),
  /** Static assets shipped with the server (trained heads, place index). */
  assetsDir: resolveFromRoot(envString('ASSETS_DIR', 'apps/server/assets')),
  /**
   * Days after which a recording is deleted unless a case holds evidence from it. 0 disables
   * automatic deletion. The default follows the two-month limit that disaster-control law in
   * Rhineland-Palatinate sets for drone footage (§ 60 LBKG).
   */
  retentionDays: envNumber('SICHT_RETENTION_DAYS', 60, 0, 3650),
  /** Password of the seeded demonstration accounts (first start only). */
  demoPassword: envString('SICHT_DEMO_PASSWORD', 'lagebild'),
  /** Hugging Face model id (ONNX export) of a CLIP- or SigLIP-style dual encoder. */
  modelId: envString('MODEL_ID', DEFAULT_MODEL_ID),
  modelDtype: parseDtype(envString('MODEL_DTYPE', 'fp32')),
  /**
   * Precision of the text encoder; defaults to the image encoder's. Multilingual text encoders
   * carry a large vocabulary table, so half precision roughly halves the download and the memory
   * while the query embeddings stay practically unchanged.
   */
  modelTextDtype: parseDtype(
    envString('MODEL_TEXT_DTYPE', /siglip2/i.test(envString('MODEL_ID', DEFAULT_MODEL_ID)) ? 'fp16' : envString('MODEL_DTYPE', 'fp32')),
  ),
  /** When true the model must already be in the local cache; no network access at all. */
  offline: envBool('SICHT_OFFLINE', envBool('SPY_EYE_OFFLINE', false)),
  /**
   * onnxruntime execution provider: cpu, dml (DirectML, any DirectX 12 GPU on Windows),
   * cuda (Linux, NVIDIA) or auto (try the GPU provider of this platform, fall back to cpu).
   */
  device: envString('ML_DEVICE', 'cpu').toLowerCase(),
  threads: envNumber('ML_THREADS', os.availableParallelism(), 1, 256),
  /** Number of image tiles per inference batch. */
  batchSize: envNumber('ML_BATCH_SIZE', 8, 1, 64),
  maxUploadBytes: envNumber('MAX_UPLOAD_GB', 20, 0.01, 2000) * 1024 ** 3,
  ffmpegPath: envString('FFMPEG_PATH', 'ffmpeg'),
  /** Width (px) of the extracted analysis frames. */
  frameWidth: envNumber('FRAME_WIDTH', 640, 224, 1920),
} as const;

export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  '.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.mpg', '.mpeg', '.ts', '.mts', '.m2ts',
  '.wmv', '.flv', '.3gp', '.ogv',
]);
