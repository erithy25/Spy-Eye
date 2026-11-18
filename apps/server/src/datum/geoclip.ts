/**
 * GeoCLIP as a worldwide region model for DATUM.
 *
 * GeoCLIP (Vivanco Cepeda, Nayak, Shah, NeurIPS 2023; code and weights under the MIT licence)
 * aligns a CLIP ViT-L/14 image tower with a location encoder (random Fourier features of the
 * Equal Earth projection at three scales, then an MLP). A picture is placed by comparing its
 * embedding with the embeddings of a gallery of 100 000 GPS points (Flickr positions shipped with
 * the model): logits = exp(logit_scale) · cos(image, location), softmax over the gallery.
 *
 * ONNX export used: Xenova/geoclip-large-patch14 (onnx/vision_model.onnx, fp32, 1.22 GB, or
 * onnx/vision_model_int8.onnx, 307 MB; onnx/location_model.onnx, 38 MB; gps_gallery/
 * coordinates_100K.bin, float32 lat/lon pairs). The files live under
 * <MODEL_CACHE_DIR>/Xenova/geoclip-large-patch14 and are never fetched at run time; without them
 * `available()` is false and the engine goes on without GeoCLIP.
 *
 * The 100 000 location embeddings are computed once with the location encoder and cached as
 * float16 under .cache/datum (102 MB); the country of every gallery point is cached next to them.
 *
 * The model runs in a worker thread of its own (geoclipWorker.ts, started by geoclipService.ts).
 * onnxruntime is imported here only when a session is created, so that the main thread can use
 * the pure functions of this module (massWithin, compactPrediction, ...) without loading it.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type * as Ort from 'onnxruntime-node';
import sharp from 'sharp';
import { config, repoRoot } from '../config.js';
import type { CountryProb, GeoPoint } from './contract.js';
import { greatCircleKm, type World } from './world.js';

/**
 * An error whose message (German, as the node's log) has an English twin. The world model's
 * failures end up in a fix's trace, which the console shows in either language; this carries the
 * English text along, also across the thread boundary (geoclipService.ts serializeError).
 */
export class NamedError extends Error {
  constructor(
    de: string,
    readonly en: string,
  ) {
    super(de);
    this.name = 'NamedError';
  }
}

let ortModule: Promise<typeof Ort> | null = null;

/** onnxruntime, loaded on first use (only the thread that runs the model ever needs it). */
function onnx(): Promise<typeof Ort> {
  ortModule ??= import('onnxruntime-node');
  return ortModule;
}

export const GEOCLIP_MODEL_ID = 'Xenova/geoclip-large-patch14';
/**
 * Commit of the Hugging Face repository the files are fetched from (pinned, so that a later
 * upload under the same name cannot change what the node runs), with the SHA-256 and size of
 * every file the node uses (the LFS object ids of that commit, checked against the local copies).
 */
export const GEOCLIP_REVISION = 'ae27bf552f1bdbfce265b813f5c2901aea336d37';
export const GEOCLIP_REMOTE_FILES: Readonly<Record<string, { sha256: string; bytes: number }>> = {
  'onnx/vision_model_int8.onnx': { sha256: 'ce2a0aa90833e4b6c67a2e06464acce0d70183ae3b8443ac13e4f9d14853023a', bytes: 306_961_304 },
  'onnx/vision_model.onnx': { sha256: 'be5e445d71789363360e94657263e077ebbc21111526209707c31ff61c2acfaa', bytes: 1_220_407_251 },
  'onnx/location_model.onnx': { sha256: 'b6f75032491fd06e9d37d4d0353e5904c96edd49ee2858358644829a408a0269', bytes: 37_808_863 },
  'gps_gallery/coordinates_100K.bin': { sha256: '428bce04a09f854bbd4c09b97b7cabccda9cc9d2debc073145e10ccab228979f', bytes: 800_000 },
};
/** Input side of the image tower (CLIPImageProcessor of openai/clip-vit-large-patch14). */
export const GEOCLIP_IMAGE_SIZE = 224;
export const GEOCLIP_MEAN: readonly [number, number, number] = [0.48145466, 0.4578275, 0.40821073];
export const GEOCLIP_STD: readonly [number, number, number] = [0.26862954, 0.26130258, 0.27577711];
/** exp(logit_scale) of the trained model (config.json: logit_scale = 3.681034803390503). */
export const GEOCLIP_LOGIT_SCALE = Math.exp(3.681034803390503);
/** Width of the shared embedding space. */
export const GEOCLIP_DIM = 512;

export type GeoclipPrecision = 'fp32' | 'int8';

/**
 * How the frames of a video are combined over the gallery.
 *   sum        per-frame logits summed (identical to summing the per-frame log-probabilities: the
 *              per-frame normaliser does not depend on the gallery point), a product of experts;
 *   mean       per-frame logits averaged (a tempered product: as sharp as one frame);
 *   mixture    per-frame probabilities averaged (one frame that sees a landmark can carry it);
 *   embedding  image embeddings averaged and renormalised, then one softmax.
 */
export type GeoclipAggregation = 'sum' | 'mean' | 'mixture' | 'embedding';

export const GEOCLIP_FILES = {
  vision: { fp32: 'onnx/vision_model.onnx', int8: 'onnx/vision_model_int8.onnx' },
  location: 'onnx/location_model.onnx',
  gallery: 'gps_gallery/coordinates_100K.bin',
} as const;

export interface GeoclipOptions {
  precision?: GeoclipPrecision;
  /** Directory holding onnx/ and gps_gallery/. Default: <modelCacheDir>/Xenova/geoclip-large-patch14. */
  modelDir?: string;
  /** Where the gallery embeddings and countries are cached. Default: <repo>/.cache/datum. */
  cacheDir?: string;
  /** onnxruntime intra-op threads. Default: config.threads (all cores). */
  threads?: number;
  /** Frames per inference batch of the image tower. Default 4. */
  batchSize?: number;
  /**
   * Whether onnxruntime's pool threads spin while they wait for work (its default). Off in the
   * node, where the model shares the cores with the image model's thread: spinning threads would
   * take cores from it between the runs.
   */
  spin?: boolean;
}

export interface PredictOptions {
  aggregation?: GeoclipAggregation;
  /** Number of best gallery points returned in `top`. Default 20. */
  topK?: number;
  /** Gallery points within this distance of a mode's seed join the mode (km). Default 25. */
  modeKm?: number;
  maxModes?: number;
  /** Local grid refinement with the location encoder around the best modes. Default true. */
  refine?: boolean;
  /** Modes refined. Default 3. */
  refineModes?: number;
  /** Country distribution (needs the world data). */
  world?: World;
}

export interface GeoclipPoint extends GeoPoint {
  /** Probability of the gallery point (or mass of the mode). */
  p: number;
}

export interface GeoclipMode extends GeoPoint {
  /** Summed probability of the gallery points of the mode. */
  p: number;
  /** Best single gallery point of the mode. */
  peak: GeoclipPoint;
  /** Probability-weighted RMS distance of the members from the mode centre (km). */
  spreadKm: number;
}

export interface GeoclipPrediction {
  frames: number;
  aggregation: GeoclipAggregation;
  /** Gallery probabilities (sum 1), one per gallery point, order of `coords`. */
  probs: Float32Array;
  /** Gallery coordinates, lat/lon pairs (shared, do not modify). */
  coords: Float32Array;
  /** Gallery rows carrying the probability mass, most probable first (density queries). */
  support: Uint32Array;
  top: GeoclipPoint[];
  modes: GeoclipMode[];
  /** Best point of the local refinement and its log-score gain over the best gallery point. */
  refined: (GeoPoint & { gain: number }) | null;
  /** The answer: the refined point if refinement ran and found a better one, else the best gallery point. */
  best: GeoPoint;
  /** Probability per country (gallery mass per country, renormalised); empty without world. */
  countries: CountryProb[];
  timing: { embedMs: number; scoreMs: number; refineMs: number };
}

/** Gallery of GPS points with their location embeddings (L2-normalised rows). */
export interface GeoclipGallery {
  coords: Float32Array;
  embeds: Float32Array;
  size: number;
}

// ------------------------------------------------------------------ preprocessing

/**
 * Output size of CLIPImageProcessor's resize: the shortest side becomes `size`, the other keeps
 * the aspect, truncated like transformers' get_resize_output_image_size (int()).
 */
export function clipResizeSize(width: number, height: number, size = GEOCLIP_IMAGE_SIZE): { width: number; height: number } {
  if (width <= height) return { width: size, height: Math.max(size, Math.trunc((size * height) / width)) };
  return { width: Math.max(size, Math.trunc((size * width) / height)), height: size };
}

/**
 * A JPEG (or any picture sharp reads) as the image tower's input, written as CHW floats into
 * `out` at `offset`: RGB, shortest side resized to 224 (bicubic), centre crop 224 x 224
 * (top = (h - 224) // 2, left = (w - 224) // 2), rescaled by 1/255 and normalised with the CLIP
 * mean and std; the steps of CLIPImageProcessor (openai/clip-vit-large-patch14).
 */
export async function preprocessImage(
  image: Buffer,
  out: Float32Array = new Float32Array(3 * GEOCLIP_IMAGE_SIZE * GEOCLIP_IMAGE_SIZE),
  offset = 0,
): Promise<Float32Array> {
  const size = GEOCLIP_IMAGE_SIZE;
  const base = sharp(image, { failOn: 'none' }).toColourspace('srgb').removeAlpha();
  const meta = await base.clone().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = meta.info;
  const target = clipResizeSize(width, height, size);
  const left = Math.floor((target.width - size) / 2);
  const top = Math.floor((target.height - size) / 2);
  const raw = await sharp(meta.data, { raw: { width, height, channels: 3 } })
    .resize(target.width, target.height, { fit: 'fill', kernel: 'cubic', fastShrinkOnLoad: false })
    .extract({ left, top, width: size, height: size })
    .raw()
    .toBuffer();
  const plane = size * size;
  if (raw.length !== plane * 3) throw new NamedError(`GeoCLIP: Bild hat ${raw.length} Bytes statt ${plane * 3}.`, `GeoCLIP: picture has ${raw.length} bytes instead of ${plane * 3}.`);
  for (let c = 0; c < 3; c++) {
    const k = 1 / (255 * (GEOCLIP_STD[c] as number));
    const b = (GEOCLIP_MEAN[c] as number) / (GEOCLIP_STD[c] as number);
    const o = offset + c * plane;
    for (let i = 0, j = c; i < plane; i++, j += 3) out[o + i] = (raw[j] as number) * k - b;
  }
  return out;
}

// ------------------------------------------------------------------ float16 cache

/** IEEE 754 half precision, round to nearest even (no Float16Array in Node 22). */
export function float32ToFloat16(src: Float32Array): Uint16Array {
  const out = new Uint16Array(src.length);
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  for (let i = 0; i < src.length; i++) {
    f[0] = src[i] as number;
    const x = u[0] as number;
    const sign = (x >>> 16) & 0x8000;
    const exp = (x >>> 23) & 0xff;
    let mant = x & 0x7fffff;
    if (exp === 0xff) {
      out[i] = sign | 0x7c00 | (mant ? 0x200 : 0);
      continue;
    }
    let e = exp - 127 + 15;
    if (e >= 0x1f) {
      out[i] = sign | 0x7c00;
      continue;
    }
    if (e <= 0) {
      if (e < -10) {
        out[i] = sign;
        continue;
      }
      mant |= 0x800000;
      const shift = 14 - e;
      let half = mant >>> shift;
      const rest = mant & ((1 << shift) - 1);
      const mid = 1 << (shift - 1);
      if (rest > mid || (rest === mid && (half & 1))) half++;
      out[i] = sign | half;
      continue;
    }
    let half = (e << 10) | (mant >>> 13);
    const rest = mant & 0x1fff;
    if (rest > 0x1000 || (rest === 0x1000 && (half & 1))) half++;
    e = half >>> 10;
    out[i] = sign | (e >= 0x1f ? 0x7c00 : half);
  }
  return out;
}

let halfTable: Float32Array | null = null;

/** All 65 536 half-precision values, so that decoding is one table lookup per value. */
function float16Table(): Float32Array {
  if (halfTable) return halfTable;
  const t = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const sign = h & 0x8000 ? -1 : 1;
    const exp = (h >>> 10) & 0x1f;
    const mant = h & 0x3ff;
    if (exp === 0) t[h] = sign * mant * 2 ** -24;
    else if (exp === 0x1f) t[h] = mant ? NaN : sign * Infinity;
    else t[h] = sign * (1 + mant / 1024) * 2 ** (exp - 15);
  }
  halfTable = t;
  return t;
}

export function float16ToFloat32(src: Uint16Array): Float32Array {
  const table = float16Table();
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = table[src[i] as number] as number;
  return out;
}

const CACHE_MAGIC = 'GCL1';

/** Writes embeddings (rows x dim) as float16 with a small header: "GCL1", uint32 rows, uint32 dim. */
export async function writeEmbeddingCache(file: string, embeds: Float32Array, rows: number, dim: number): Promise<void> {
  if (embeds.length !== rows * dim) throw new NamedError(`GeoCLIP-Cache: ${embeds.length} Werte statt ${rows * dim}.`, `GeoCLIP cache: ${embeds.length} values instead of ${rows * dim}.`);
  const half = float32ToFloat16(embeds);
  const header = Buffer.alloc(12);
  header.write(CACHE_MAGIC, 0, 'ascii');
  header.writeUInt32LE(rows, 4);
  header.writeUInt32LE(dim, 8);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, Buffer.concat([header, Buffer.from(half.buffer, half.byteOffset, half.byteLength)]));
  await fs.rename(tmp, file);
}

/** Reads a cache written by writeEmbeddingCache; null when missing or not of the expected shape. */
export async function readEmbeddingCache(file: string, rows: number, dim: number): Promise<Float32Array | null> {
  let buf: Buffer;
  try {
    buf = await fs.readFile(file);
  } catch {
    return null;
  }
  if (buf.length !== 12 + rows * dim * 2 || buf.toString('ascii', 0, 4) !== CACHE_MAGIC) return null;
  if (buf.readUInt32LE(4) !== rows || buf.readUInt32LE(8) !== dim) return null;
  const half = new Uint16Array(rows * dim);
  Buffer.from(half.buffer).set(buf.subarray(12));
  return float16ToFloat32(half);
}

// ------------------------------------------------------------------ scoring (pure)

/** L2-normalises every row in place. */
export function normaliseRows(v: Float32Array, dim: number): Float32Array {
  for (let o = 0; o < v.length; o += dim) {
    let s = 0;
    for (let d = 0; d < dim; d++) s += (v[o + d] as number) ** 2;
    const inv = 1 / Math.sqrt(s || 1);
    for (let d = 0; d < dim; d++) v[o + d] = (v[o + d] as number) * inv;
  }
  return v;
}

/** Cosines of every frame (rows of `images`) with every gallery row: frames x n, row-major. */
export function cosines(images: Float32Array, frames: number, gallery: Float32Array, n: number, dim: number): Float32Array {
  const out = new Float32Array(frames * n);
  // Gallery outside, frames inside: the frame block stays in cache while the gallery streams once.
  // Four frames share each gallery value read (four independent sums instead of one chain); every
  // sum still runs over d in order, so the result is bit for bit that of one frame at a time. On
  // 100 000 points and 12 frames this halves the time (about 1.2 s to 0.6 s on the 4-core test
  // machine).
  for (let g = 0; g < n; g++) {
    const go = g * dim;
    let f = 0;
    for (; f + 3 < frames; f += 4) {
      const o0 = f * dim;
      const o1 = o0 + dim;
      const o2 = o1 + dim;
      const o3 = o2 + dim;
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let s3 = 0;
      for (let d = 0; d < dim; d++) {
        const x = gallery[go + d] as number;
        s0 += (images[o0 + d] as number) * x;
        s1 += (images[o1 + d] as number) * x;
        s2 += (images[o2 + d] as number) * x;
        s3 += (images[o3 + d] as number) * x;
      }
      out[f * n + g] = s0;
      out[(f + 1) * n + g] = s1;
      out[(f + 2) * n + g] = s2;
      out[(f + 3) * n + g] = s3;
    }
    for (; f < frames; f++) {
      const fo = f * dim;
      let s = 0;
      for (let d = 0; d < dim; d++) s += (images[fo + d] as number) * (gallery[go + d] as number);
      out[f * n + g] = s;
    }
  }
  return out;
}

function logSumExp(v: Float64Array): number {
  let max = -Infinity;
  for (let i = 0; i < v.length; i++) if ((v[i] as number) > max) max = v[i] as number;
  let s = 0;
  for (let i = 0; i < v.length; i++) s += Math.exp((v[i] as number) - max);
  return max + Math.log(s);
}

/**
 * Length of the mean of the (unit) frame rows. The cosine of the renormalised mean embedding with
 * a location is the mean of the frame cosines divided by this length, so the 'embedding'
 * aggregation is the 'mean' one with a sharper scale and needs no second pass over the gallery.
 */
export function meanEmbeddingNorm(images: Float32Array, frames: number, dim: number): number {
  if (frames === 0) return 1;
  let s = 0;
  for (let d = 0; d < dim; d++) {
    let m = 0;
    for (let f = 0; f < frames; f++) m += images[f * dim + d] as number;
    m /= frames;
    s += m * m;
  }
  return Math.sqrt(s) || 1;
}

/**
 * Turns per-frame cosines into one unnormalised log-score per point. Returns the scores and, for
 * 'mixture', the per-frame log-normalisers needed to score further points on the same scale.
 * `embeddingNorm` (meanEmbeddingNorm of the frames) is used by the 'embedding' aggregation.
 */
export function aggregateScores(
  cos: Float32Array,
  frames: number,
  n: number,
  aggregation: GeoclipAggregation,
  scale = GEOCLIP_LOGIT_SCALE,
  frameLogZ?: Float64Array,
  embeddingNorm = 1,
): { scores: Float64Array; frameLogZ: Float64Array | null } {
  const scores = new Float64Array(n);
  if (frames === 0) return { scores, frameLogZ: null };
  if (aggregation === 'mixture') {
    let logZ = frameLogZ ?? null;
    if (!logZ) {
      logZ = new Float64Array(frames);
      const row = new Float64Array(n);
      for (let f = 0; f < frames; f++) {
        for (let g = 0; g < n; g++) row[g] = scale * (cos[f * n + g] as number);
        logZ[f] = logSumExp(row);
      }
    }
    const terms = new Float64Array(frames);
    for (let g = 0; g < n; g++) {
      for (let f = 0; f < frames; f++) terms[f] = scale * (cos[f * n + g] as number) - (logZ[f] as number);
      scores[g] = logSumExp(terms) - Math.log(frames);
    }
    return { scores, frameLogZ: logZ };
  }
  const k = aggregation === 'sum' ? scale : aggregation === 'mean' ? scale / frames : scale / (frames * embeddingNorm);
  for (let f = 0; f < frames; f++) {
    for (let g = 0; g < n; g++) scores[g] = (scores[g] as number) + k * (cos[f * n + g] as number);
  }
  return { scores, frameLogZ: null };
}

/** Softmax of log-scores (float64 accumulation). */
export function softmax(scores: Float64Array): Float32Array {
  let max = -Infinity;
  for (let i = 0; i < scores.length; i++) if ((scores[i] as number) > max) max = scores[i] as number;
  const out = new Float32Array(scores.length);
  let s = 0;
  for (let i = 0; i < scores.length; i++) {
    const e = Math.exp((scores[i] as number) - max);
    out[i] = e;
    s += e;
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) / s;
  return out;
}

/** Mean of the frame rows, renormalised (one row). */
export function meanEmbedding(images: Float32Array, frames: number, dim: number): Float32Array {
  const out = new Float32Array(dim);
  for (let f = 0; f < frames; f++) for (let d = 0; d < dim; d++) out[d] = (out[d] as number) + (images[f * dim + d] as number);
  return normaliseRows(out, dim);
}

/** Indices of the rows carrying `mass` of the probability (at most `max`), most probable first. */
export function supportOf(probs: Float32Array, mass = 0.999, max = 20_000): Uint32Array {
  const order = Array.from({ length: probs.length }, (_, i) => i);
  order.sort((a, b) => (probs[b] as number) - (probs[a] as number));
  const out: number[] = [];
  let s = 0;
  for (const i of order) {
    out.push(i);
    s += probs[i] as number;
    if (s >= mass || out.length >= max) break;
  }
  return Uint32Array.from(out);
}

/**
 * Greedy clustering of the support: the most probable unassigned point seeds a mode, every point
 * within `modeKm` of the seed joins it. Modes by mass, largest first.
 */
export function modesOf(coords: Float32Array, probs: Float32Array, support: Uint32Array, modeKm = 25, maxModes = 10): GeoclipMode[] {
  const seeds: { lat: number; lon: number; peak: GeoclipPoint; members: number[] }[] = [];
  for (const i of support) {
    const lat = coords[2 * i] as number;
    const lon = coords[2 * i + 1] as number;
    let joined = false;
    for (const s of seeds) {
      if (greatCircleKm(s.lat, s.lon, lat, lon) <= modeKm) {
        s.members.push(i);
        joined = true;
        break;
      }
    }
    if (!joined && seeds.length < maxModes * 4) seeds.push({ lat, lon, peak: { lat, lon, p: probs[i] as number }, members: [i] });
  }
  const modes = seeds.map((s) => {
    let w = 0;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const i of s.members) {
      const p = probs[i] as number;
      const la = ((coords[2 * i] as number) * Math.PI) / 180;
      const lo = ((coords[2 * i + 1] as number) * Math.PI) / 180;
      w += p;
      x += p * Math.cos(la) * Math.cos(lo);
      y += p * Math.cos(la) * Math.sin(lo);
      z += p * Math.sin(la);
    }
    const lat = (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI;
    const lon = (Math.atan2(y, x) * 180) / Math.PI;
    let spread = 0;
    for (const i of s.members) spread += (probs[i] as number) * greatCircleKm(lat, lon, coords[2 * i] as number, coords[2 * i + 1] as number) ** 2;
    return { lat, lon, p: w, peak: s.peak, spreadKm: w > 0 ? Math.sqrt(spread / w) : 0 };
  });
  modes.sort((a, b) => b.p - a.p);
  return modes.slice(0, maxModes);
}

/** GeoCLIP density at a point: sum of p · exp(-d² / 2σ²) over the support. */
export function densityAt(pred: Pick<GeoclipPrediction, 'probs' | 'coords' | 'support'>, lat: number, lon: number, sigmaKm: number): number {
  let s = 0;
  const cut = 4 * sigmaKm;
  for (const i of pred.support) {
    const d = greatCircleKm(lat, lon, pred.coords[2 * i] as number, pred.coords[2 * i + 1] as number);
    if (d > cut) continue;
    s += (pred.probs[i] as number) * Math.exp(-(d * d) / (2 * sigmaKm * sigmaKm));
  }
  return s;
}

/** Probability mass of the gallery points within `km` of a point. */
export function massWithin(pred: Pick<GeoclipPrediction, 'probs' | 'coords' | 'support'>, lat: number, lon: number, km: number): number {
  let s = 0;
  for (const i of pred.support) {
    if (greatCircleKm(lat, lon, pred.coords[2 * i] as number, pred.coords[2 * i + 1] as number) <= km) s += pred.probs[i] as number;
  }
  return s;
}

/** Country probabilities from the gallery mass per country (points without a country dropped). */
export function countryDistribution(world: World, probs: Float32Array, countryOf: Int16Array, isos: readonly string[]): CountryProb[] {
  const sums = new Float64Array(isos.length);
  let total = 0;
  for (let i = 0; i < probs.length; i++) {
    const c = countryOf[i] as number;
    if (c < 0) continue;
    sums[c] = (sums[c] as number) + (probs[i] as number);
    total += probs[i] as number;
  }
  const out: CountryProb[] = [];
  isos.forEach((iso, c) => {
    const p = total > 0 ? (sums[c] as number) / total : 0;
    if (p > 0) out.push({ iso, name: world.country(iso)?.name_de ?? iso, p });
  });
  out.sort((a, b) => b.p - a.p);
  return out;
}

/**
 * Best mode of the prediction inside a country: the mode seeded by the most probable gallery
 * point of that country (clustered like modesOf). Null when the country has no gallery mass.
 */
export function bestInCountry(
  pred: Pick<GeoclipPrediction, 'probs' | 'coords' | 'support'>,
  countryOf: Int16Array,
  isos: readonly string[],
  iso: string,
  modeKm = 25,
): GeoclipMode | null {
  const c = isos.indexOf(iso);
  if (c < 0) return null;
  const inside = pred.support.filter((i) => countryOf[i] === c);
  if (inside.length === 0) return null;
  return modesOf(pred.coords, pred.probs, inside, modeKm, 1)[0] ?? null;
}

/**
 * The prediction reduced to its support: `coords` and `probs` hold only the points that carry the
 * probability mass (`support` becomes 0..m-1 over them), the full gallery arrays are dropped. This
 * is what crosses from the model's thread to the main thread (at most 20 000 points, about 0.3 MB,
 * instead of 1.2 MB of gallery arrays per call); massWithin and densityAt give the same answers on
 * it, because they only ever read the support. (bestInCountry needs the gallery rows: not on it.)
 */
export function compactPrediction(pred: GeoclipPrediction): GeoclipPrediction {
  const m = pred.support.length;
  const coords = new Float32Array(2 * m);
  const probs = new Float32Array(m);
  for (let k = 0; k < m; k++) {
    const i = pred.support[k] as number;
    coords[2 * k] = pred.coords[2 * i] as number;
    coords[2 * k + 1] = pred.coords[2 * i + 1] as number;
    probs[k] = pred.probs[i] as number;
  }
  const support = new Uint32Array(m);
  for (let k = 0; k < m; k++) support[k] = k;
  return { ...pred, probs, coords, support };
}

/** Points of a square grid of (2·half + 1)² around a centre, `stepDeg` apart (longitude scaled). */
export function localGrid(center: GeoPoint, stepDeg: number, half: number): Float32Array {
  const out = new Float32Array((2 * half + 1) ** 2 * 2);
  const lonStep = stepDeg / Math.max(0.2, Math.cos((center.lat * Math.PI) / 180));
  let o = 0;
  for (let i = -half; i <= half; i++) {
    for (let j = -half; j <= half; j++) {
      const lat = Math.max(-89.9, Math.min(89.9, center.lat + i * stepDeg));
      let lon = center.lon + j * lonStep;
      if (lon > 180) lon -= 360;
      if (lon < -180) lon += 360;
      out[o++] = lat;
      out[o++] = lon;
    }
  }
  return out;
}

// ------------------------------------------------------------------ the model

export function defaultGeoclipDir(): string {
  return path.join(config.modelCacheDir, ...GEOCLIP_MODEL_ID.split('/'));
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** Relative paths (inside the model directory) of the files a precision needs. */
export function geoclipFilesFor(precision: GeoclipPrecision): string[] {
  return [GEOCLIP_FILES.vision[precision], GEOCLIP_FILES.location, GEOCLIP_FILES.gallery];
}

/**
 * Whether the files of a precision are on disk with the size of the pinned revision. Cheap (no
 * hashing): the download step checks the SHA-256; this catches a missing or cut-off file.
 */
export async function geoclipFilesPresent(precision: GeoclipPrecision, modelDir: string = defaultGeoclipDir()): Promise<{ ok: boolean; missing: string[] }> {
  const missing: string[] = [];
  for (const rel of geoclipFilesFor(precision)) {
    const expected = GEOCLIP_REMOTE_FILES[rel]?.bytes;
    try {
      const st = await fs.stat(path.join(modelDir, ...rel.split('/')));
      if (expected !== undefined && st.size !== expected) missing.push(rel);
    } catch {
      missing.push(rel);
    }
  }
  return { ok: missing.length === 0, missing };
}

/** SHA-256 of a file (hex), streamed. */
export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export interface GeoclipDownloadOptions {
  precision?: GeoclipPrecision;
  modelDir?: string;
  /** Hash files that are already there (default true); false trusts a file of the right size. */
  verifyExisting?: boolean;
  /** Where the files come from (tests); default the pinned revision on huggingface.co. */
  baseUrl?: string;
  /** fetch to use (tests). */
  fetchImpl?: typeof fetch;
  /** Pinned size and SHA-256 per file (tests); default GEOCLIP_REMOTE_FILES. */
  pinned?: Readonly<Record<string, { sha256: string; bytes: number }>>;
  onProgress?: (file: string, loaded: number, total: number) => void;
  /** Timeout without any data (ms); default 60 s. */
  stallMs?: number;
}

export interface GeoclipDownloadReport {
  fetched: string[];
  present: string[];
}

/**
 * Brings the GeoCLIP files of a precision into the model directory: every file that is missing, of
 * the wrong size or (with verifyExisting) of the wrong SHA-256 is fetched from the pinned revision
 * into a temporary file next to it, checked against the pinned size and SHA-256, and only then
 * renamed into place; a failed or wrong download leaves nothing behind. Idempotent. Throws when a
 * file cannot be had (the node then runs without the world model).
 */
export async function ensureGeoclipFiles(opts: GeoclipDownloadOptions = {}): Promise<GeoclipDownloadReport> {
  const precision = opts.precision ?? 'int8';
  const modelDir = opts.modelDir ?? defaultGeoclipDir();
  const baseUrl = opts.baseUrl ?? `https://huggingface.co/${GEOCLIP_MODEL_ID}/resolve/${GEOCLIP_REVISION}`;
  const doFetch = opts.fetchImpl ?? fetch;
  const report: GeoclipDownloadReport = { fetched: [], present: [] };
  const table = opts.pinned ?? GEOCLIP_REMOTE_FILES;
  for (const rel of geoclipFilesFor(precision)) {
    const pinned = table[rel];
    if (!pinned) throw new Error(`GeoCLIP: keine Prüfsumme für ${rel} hinterlegt.`);
    // Path segments joined with the platform separator (Windows-safe).
    const dest = path.join(modelDir, ...rel.split('/'));
    const size = await fs.stat(dest).then((s) => s.size).catch(() => -1);
    if (size === pinned.bytes && (opts.verifyExisting === false || (await sha256File(dest)) === pinned.sha256)) {
      report.present.push(rel);
      continue;
    }
    if (config.offline && !opts.fetchImpl) throw new Error(`GeoCLIP: ${rel} fehlt, und der Offline-Modus ist aktiv (SICHT_OFFLINE).`);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.${process.pid}.part`;
    const controller = new AbortController();
    // Aborts a download that delivers nothing for stallMs; re-armed with every chunk, and always
    // cleared (a pending timer would keep a finished script alive).
    let timer = setTimeout(() => controller.abort(), opts.stallMs ?? 60_000);
    try {
      const response = await doFetch(`${baseUrl}/${rel}`, { signal: controller.signal, headers: { 'user-agent': 'datum-node' } });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const hash = createHash('sha256');
      const out = await fs.open(tmp, 'w');
      let loaded = 0;
      try {
        for await (const chunk of Readable.fromWeb(response.body as WebReadableStream<Uint8Array>)) {
          const bytes = chunk as Buffer;
          clearTimeout(timer);
          timer = setTimeout(() => controller.abort(), opts.stallMs ?? 60_000);
          hash.update(bytes);
          await out.write(bytes);
          loaded += bytes.length;
          opts.onProgress?.(rel, loaded, pinned.bytes);
        }
      } finally {
        await out.close();
      }
      const digest = hash.digest('hex');
      if (loaded !== pinned.bytes) throw new Error(`${loaded} Bytes statt ${pinned.bytes}`);
      if (digest !== pinned.sha256) throw new Error('Prüfsumme (SHA-256) stimmt nicht');
      // On Windows a rename onto an existing file fails: the wrong copy goes first.
      await fs.rm(dest, { force: true });
      await fs.rename(tmp, dest);
      report.fetched.push(rel);
    } catch (err: unknown) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      const reason = err instanceof Error ? (err.name === 'AbortError' ? 'Zeitüberschreitung' : err.message) : String(err);
      throw new Error(`GeoCLIP: ${rel} nicht geladen (${reason}).`);
    } finally {
      clearTimeout(timer);
    }
  }
  return report;
}

/**
 * GeoCLIP on onnxruntime (CPU). Sessions are created on first use, one per tower, and runs are
 * serialised (each run uses all configured threads).
 */
export class GeoClip {
  readonly precision: GeoclipPrecision;
  readonly modelDir: string;
  readonly cacheDir: string;
  readonly threads: number;
  readonly batchSize: number;
  readonly spin: boolean;
  private vision: Promise<Ort.InferenceSession> | null = null;
  private location: Promise<Ort.InferenceSession> | null = null;
  private galleryLoad: Promise<GeoclipGallery> | null = null;
  private countryLoad: Promise<{ countryOf: Int16Array; isos: string[] }> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: GeoclipOptions = {}) {
    this.precision = options.precision ?? 'fp32';
    this.modelDir = options.modelDir ?? defaultGeoclipDir();
    this.cacheDir = options.cacheDir ?? path.join(repoRoot, '.cache', 'datum');
    this.threads = options.threads ?? config.threads;
    this.batchSize = options.batchSize ?? 4;
    this.spin = options.spin ?? true;
  }

  files(): { vision: string; location: string; gallery: string } {
    return {
      vision: path.join(this.modelDir, ...GEOCLIP_FILES.vision[this.precision].split('/')),
      location: path.join(this.modelDir, ...GEOCLIP_FILES.location.split('/')),
      gallery: path.join(this.modelDir, ...GEOCLIP_FILES.gallery.split('/')),
    };
  }

  /** True when the three model files of this precision are on disk. */
  async available(): Promise<boolean> {
    const f = this.files();
    return (await Promise.all([exists(f.vision), exists(f.location), exists(f.gallery)])).every(Boolean);
  }

  /** Set by stop(): no session is created and no run is started any more. */
  private stopped = false;

  /**
   * Lets the run under way finish and refuses every later one (and every new session), so that
   * the thread that owns this model reaches a point without a run soon: a run cannot be
   * interrupted, and a thread torn down inside one aborts the whole process (see
   * geoclipWorker.ts close). Calls that would start a run fail with a NamedError instead.
   */
  stop(): void {
    this.stopped = true;
  }

  private stoppedError(): NamedError {
    return new NamedError('GeoCLIP wird beendet.', 'GeoCLIP is shutting down.');
  }

  private async session(file: string): Promise<Ort.InferenceSession> {
    const ort = await onnx();
    // Checked after the import: stop() may have come while onnxruntime was loading.
    if (this.stopped) throw this.stoppedError();
    return ort.InferenceSession.create(file, {
      intraOpNumThreads: this.threads,
      interOpNumThreads: 1,
      executionMode: 'sequential',
      graphOptimizationLevel: 'all',
      // Flattened by the Node binding into the session config entry
      // "session.intra_op.allow_spinning".
      ...(this.spin ? {} : { extra: { session: { intra_op: { allow_spinning: '0' } } } }),
    });
  }

  private serial<T>(job: () => Promise<T>): Promise<T> {
    // The check runs when the job's turn comes, not when it was queued: a run queued before
    // stop() but not started yet is refused as well.
    const run = this.queue.then(() => {
      if (this.stopped) throw this.stoppedError();
      return job();
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private visionSession(): Promise<Ort.InferenceSession> {
    if (!this.vision) {
      this.vision = this.session(this.files().vision);
      this.vision.catch(() => (this.vision = null));
    }
    return this.vision;
  }

  private locationSession(): Promise<Ort.InferenceSession> {
    if (!this.location) {
      this.location = this.session(this.files().location);
      this.location.catch(() => (this.location = null));
    }
    return this.location;
  }

  /** Creates the image tower's session now (instead of on the first picture). */
  async loadVision(): Promise<void> {
    await this.visionSession();
  }

  /** Whether the gallery embeddings are cached on disk (then loading takes about a second). */
  async galleryCached(): Promise<boolean> {
    try {
      const st = await fs.stat(await this.galleryCacheFile());
      return st.size > 12;
    } catch {
      return false;
    }
  }

  /** Image embeddings (count x 512, L2-normalised) of preprocessed pixels (count x 3 x 224 x 224). */
  async embedPixels(pixels: Float32Array, count: number): Promise<Float32Array> {
    const session = await this.visionSession();
    const ort = await onnx();
    const plane = 3 * GEOCLIP_IMAGE_SIZE * GEOCLIP_IMAGE_SIZE;
    const out = new Float32Array(count * GEOCLIP_DIM);
    for (let i = 0; i < count; i += this.batchSize) {
      const n = Math.min(this.batchSize, count - i);
      const input = new ort.Tensor('float32', pixels.subarray(i * plane, (i + n) * plane), [n, 3, GEOCLIP_IMAGE_SIZE, GEOCLIP_IMAGE_SIZE]);
      const result = await this.serial(() => session.run({ pixel_values: input }));
      const embeds = result['image_embeds'];
      if (!embeds || embeds.dims[1] !== GEOCLIP_DIM) throw new NamedError('GeoCLIP: unerwartete Ausgabe des Bildmodells.', 'GeoCLIP: unexpected output of the image model.');
      out.set(embeds.data as Float32Array, i * GEOCLIP_DIM);
    }
    return normaliseRows(out, GEOCLIP_DIM);
  }

  /** Image embeddings of encoded pictures (JPEG frames), L2-normalised rows. */
  async embedImages(images: readonly Buffer[]): Promise<Float32Array> {
    const plane = 3 * GEOCLIP_IMAGE_SIZE * GEOCLIP_IMAGE_SIZE;
    const pixels = new Float32Array(images.length * plane);
    await Promise.all(images.map((img, i) => preprocessImage(img, pixels, i * plane)));
    return this.embedPixels(pixels, images.length);
  }

  /** Location embeddings (n x 512, L2-normalised) of lat/lon pairs in degrees. */
  async embedLocations(coords: Float32Array, chunk = 4096): Promise<Float32Array> {
    const session = await this.locationSession();
    const ort = await onnx();
    const n = coords.length / 2;
    const out = new Float32Array(n * GEOCLIP_DIM);
    for (let i = 0; i < n; i += chunk) {
      const m = Math.min(chunk, n - i);
      const input = new ort.Tensor('float32', coords.slice(2 * i, 2 * (i + m)), [m, 2]);
      const result = await this.serial(() => session.run({ location: input }));
      const embeds = result['location_embeds'];
      if (!embeds || embeds.dims[1] !== GEOCLIP_DIM) throw new NamedError('GeoCLIP: unerwartete Ausgabe des Ortsmodells.', 'GeoCLIP: unexpected output of the location model.');
      out.set(embeds.data as Float32Array, i * GEOCLIP_DIM);
    }
    return normaliseRows(out, GEOCLIP_DIM);
  }

  /** Cache file of the gallery embeddings: keyed by the location model and the gallery bytes. */
  async galleryCacheFile(): Promise<string> {
    const f = this.files();
    const [model, gallery] = await Promise.all([fs.stat(f.location), fs.readFile(f.gallery)]);
    const key = createHash('sha256').update(`${GEOCLIP_MODEL_ID}:${model.size}:`).update(gallery).digest('hex').slice(0, 16);
    return path.join(this.cacheDir, `geoclip-gallery-${key}.f16`);
  }

  /** The 100 000 gallery points with their embeddings; computed once, then read from the cache. */
  gallery(onProgress?: (done: number, total: number) => void): Promise<GeoclipGallery> {
    if (!this.galleryLoad) {
      this.galleryLoad = this.loadGallery(onProgress);
      this.galleryLoad.catch(() => (this.galleryLoad = null));
    }
    return this.galleryLoad;
  }

  private async loadGallery(onProgress?: (done: number, total: number) => void): Promise<GeoclipGallery> {
    const buf = await fs.readFile(this.files().gallery);
    const coords = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const size = coords.length / 2;
    const file = await this.galleryCacheFile();
    const cached = await readEmbeddingCache(file, size, GEOCLIP_DIM);
    if (cached) return { coords, embeds: normaliseRows(cached, GEOCLIP_DIM), size };
    const embeds = new Float32Array(size * GEOCLIP_DIM);
    const step = 8192;
    for (let i = 0; i < size; i += step) {
      const m = Math.min(step, size - i);
      embeds.set(await this.embedLocations(coords.subarray(2 * i, 2 * (i + m))), i * GEOCLIP_DIM);
      onProgress?.(i + m, size);
    }
    try {
      await writeEmbeddingCache(file, embeds, size, GEOCLIP_DIM);
      this.cacheProblem = null;
    } catch (err: unknown) {
      // A full or read-only disk costs the next start the 40 s again, not this gallery.
      this.cacheProblem = err instanceof Error ? err.message : String(err);
    }
    return { coords, embeds, size };
  }

  /** Why the last gallery build could not be cached, if it could not. */
  cacheProblem: string | null = null;

  /**
   * Country of every gallery point (index into `isos`, -1 over sea or unknown), computed once with
   * the world shapes (countryNear: shape, 10 km edge tolerance, nearest city within 30 km), cached.
   */
  galleryCountries(world: World): Promise<{ countryOf: Int16Array; isos: string[] }> {
    if (!this.countryLoad) {
      this.countryLoad = this.loadCountries(world);
      this.countryLoad.catch(() => (this.countryLoad = null));
    }
    return this.countryLoad;
  }

  private async loadCountries(world: World): Promise<{ countryOf: Int16Array; isos: string[] }> {
    const { coords, size } = await this.gallery();
    const isos = world.countries().map((c) => c.iso);
    const galleryFile = await this.galleryCacheFile();
    const key = createHash('sha256').update(galleryFile).update(JSON.stringify(isos)).update(String(world.countries().reduce((s, c) => s + c.polygons.length, 0))).digest('hex').slice(0, 16);
    const file = path.join(this.cacheDir, `geoclip-countries-${key}.bin`);
    try {
      const buf = await fs.readFile(file);
      if (buf.length === size * 2) {
        const countryOf = new Int16Array(size);
        Buffer.from(countryOf.buffer).set(buf);
        return { countryOf, isos };
      }
    } catch {
      // not cached yet
    }
    const index = new Map(isos.map((iso, i) => [iso, i]));
    const countryOf = new Int16Array(size);
    for (let i = 0; i < size; i++) {
      const c = world.countryNear(coords[2 * i] as number, coords[2 * i + 1] as number);
      countryOf[i] = c ? (index.get(c.iso) ?? -1) : -1;
    }
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      await fs.writeFile(tmp, Buffer.from(countryOf.buffer));
      await fs.rename(tmp, file);
    } catch (err: unknown) {
      // Computed again at the next start; the countries themselves are fine.
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      this.cacheProblem = err instanceof Error ? err.message : String(err);
    }
    return { countryOf, isos };
  }

  /** Where were these frames (encoded pictures of one video) taken? */
  async predict(frames: readonly Buffer[], opts: PredictOptions = {}): Promise<GeoclipPrediction> {
    const t0 = performance.now();
    const embeds = await this.embedImages(frames);
    const embedMs = performance.now() - t0;
    const pred = await this.predictFromEmbeddings(embeds, frames.length, opts);
    pred.timing.embedMs = embedMs;
    return pred;
  }

  /** Cosines of the frames (frames x 512, L2-normalised) with every gallery point: frames x 100 000. */
  async galleryCosines(images: Float32Array, frames: number): Promise<Float32Array> {
    const gallery = await this.gallery();
    return cosines(images, frames, gallery.embeds, gallery.size, GEOCLIP_DIM);
  }

  /**
   * The prediction from image embeddings already computed (frames x 512, L2-normalised).
   * `galleryCos` (galleryCosines of the same frames) spares the pass over the gallery when several
   * aggregations are compared.
   */
  async predictFromEmbeddings(
    images: Float32Array,
    frames: number,
    opts: PredictOptions & { galleryCos?: Float32Array } = {},
  ): Promise<GeoclipPrediction> {
    const aggregation = opts.aggregation ?? 'sum';
    const gallery = await this.gallery();
    const t0 = performance.now();
    const norm = meanEmbeddingNorm(images, frames, GEOCLIP_DIM);
    const cos = opts.galleryCos ?? cosines(images, frames, gallery.embeds, gallery.size, GEOCLIP_DIM);
    const { scores, frameLogZ } = aggregateScores(cos, frames, gallery.size, aggregation, GEOCLIP_LOGIT_SCALE, undefined, norm);
    const probs = softmax(scores);
    const support = supportOf(probs);
    const top: GeoclipPoint[] = [...support.subarray(0, opts.topK ?? 20)].map((i) => ({
      lat: gallery.coords[2 * i] as number,
      lon: gallery.coords[2 * i + 1] as number,
      p: probs[i] as number,
    }));
    const modes = modesOf(gallery.coords, probs, support, opts.modeKm ?? 25, opts.maxModes ?? 10);
    const scoreMs = performance.now() - t0;

    // Coarse-to-fine: around the best modes, a 0.05° grid (± 0.25°), then a 0.01° grid (± 0.05°)
    // around the best point, scored with the location encoder on the gallery's scale.
    let refined: (GeoPoint & { gain: number }) | null = null;
    const t1 = performance.now();
    const first = support[0];
    if ((opts.refine ?? true) && first !== undefined && modes.length > 0) {
      const scoreOf = async (points: Float32Array): Promise<Float64Array> => {
        const loc = await this.embedLocations(points);
        const c = cosines(images, frames, loc, points.length / 2, GEOCLIP_DIM);
        return aggregateScores(c, frames, points.length / 2, aggregation, GEOCLIP_LOGIT_SCALE, frameLogZ ?? undefined, norm).scores;
      };
      const baseline = scores[first] as number;
      let best: (GeoPoint & { score: number }) | null = null;
      const consider = (points: Float32Array, s: Float64Array): void => {
        for (let i = 0; i < s.length; i++) {
          if (!best || (s[i] as number) > best.score) best = { lat: points[2 * i] as number, lon: points[2 * i + 1] as number, score: s[i] as number };
        }
      };
      const coarse = modes.slice(0, opts.refineModes ?? 3).map((m) => localGrid(m.peak, 0.05, 5));
      const all = new Float32Array(coarse.reduce((s, g) => s + g.length, 0));
      let o = 0;
      for (const g of coarse) {
        all.set(g, o);
        o += g.length;
      }
      consider(all, await scoreOf(all));
      const coarseBest = best as (GeoPoint & { score: number }) | null;
      if (coarseBest) {
        const fine = localGrid(coarseBest, 0.01, 5);
        consider(fine, await scoreOf(fine));
      }
      const final = best as (GeoPoint & { score: number }) | null;
      if (final) refined = { lat: final.lat, lon: final.lon, gain: final.score - baseline };
    }
    const refineMs = performance.now() - t1;

    let countries: CountryProb[] = [];
    if (opts.world) {
      const { countryOf, isos } = await this.galleryCountries(opts.world);
      countries = countryDistribution(opts.world, probs, countryOf, isos);
    }
    // Without a refinement gain the answer is the best gallery point (the 'refined' answer of
    // scripts/datum/evaluateGeoclip.ts, which the fusion weights were tuned with).
    const first0 = top[0] ?? { lat: 0, lon: 0 };
    return {
      frames,
      aggregation,
      probs,
      coords: gallery.coords,
      support,
      top,
      modes,
      refined,
      best: refined && refined.gain > 0 ? { lat: refined.lat, lon: refined.lon } : { lat: first0.lat, lon: first0.lon },
      countries,
      timing: { embedMs: 0, scoreMs, refineMs },
    };
  }

  /** Frees both sessions (the fp32 image tower holds about 1.3 GB). */
  async release(): Promise<void> {
    const sessions = [this.vision, this.location];
    this.vision = null;
    this.location = null;
    for (const s of sessions) {
      if (!s) continue;
      try {
        await (await s).release();
      } catch {
        // a session that failed to load holds nothing
      }
    }
  }
}

/** Distance (km) between the GeoCLIP answer and a point; convenience for evaluation and tests. */
export function errorKm(pred: Pick<GeoclipPrediction, 'best'>, truth: GeoPoint): number {
  return greatCircleKm(pred.best.lat, pred.best.lon, truth.lat, truth.lon);
}
