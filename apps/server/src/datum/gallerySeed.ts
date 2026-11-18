/**
 * Gallery vectors shipped with the dataset, so that a fresh machine does not have to embed tens of
 * thousands of reference pictures before the first fix (about an hour on a laptop CPU).
 *
 * Files, next to gallery.json:
 *   gallery-vectors-<model>.f16   row-major IEEE 754 half floats, one row of `dim` values per id
 *   gallery-vectors-<model>.json  { version, modelId, dim, ids, sources }
 *
 * `sources` holds "<file>:<bytes>" per row, as the vector cache does: a picture replaced on disk
 * (other size) is embedded again instead of taking the shipped row. Half precision changes cosine
 * similarities of the L2-normalised 768-value rows by about 1e-4, far below anything the
 * localisation decides on.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

export interface SeedIndex {
  version: 1;
  modelId: string;
  dim: number;
  ids: string[];
  sources: string[];
}

export interface SeedRow {
  source: string;
  row: Float32Array;
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** Nearest IEEE 754 half float (round to nearest even) of a number, as its 16 bits. */
export function toHalf(value: number): number {
  f32[0] = value;
  const x = u32[0] as number;
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0); // Inf / NaN
  let e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00; // overflow: Inf
  if (e <= 0) {
    // Subnormal half (or zero).
    if (e < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - e;
    let half = mant >>> shift;
    const rest = mant & ((1 << shift) - 1);
    const midway = 1 << (shift - 1);
    if (rest > midway || (rest === midway && (half & 1) === 1)) half++;
    return sign | half;
  }
  let half = (e << 10) | (mant >>> 13);
  const rest = mant & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && (half & 1) === 1)) half++;
  // A carry out of the mantissa raises the exponent; reaching 0x7c00 is Inf, which is right.
  e = half >>> 10;
  return sign | (e >= 0x1f ? 0x7c00 : half);
}

/** Value of a half float given as its 16 bits. */
export function fromHalf(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exp = (bits >>> 10) & 0x1f;
  const mant = bits & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 0x1f) return mant ? Number.NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

export function encodeHalf(values: Float32Array): Uint16Array {
  const out = new Uint16Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = toHalf(values[i] as number);
  return out;
}

export function decodeHalf(halves: Uint16Array): Float32Array {
  const out = new Float32Array(halves.length);
  for (let i = 0; i < halves.length; i++) out[i] = fromHalf(halves[i] as number);
  return out;
}

/** Same naming as the vector cache: last segment of the model id, lower case, safe characters. */
function slug(modelId: string): string {
  return (modelId.split('/').pop() ?? modelId).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}

export function seedFiles(datasetDir: string, modelId: string): { bin: string; index: string } {
  const base = path.join(datasetDir, `gallery-vectors-${slug(modelId)}`);
  return { bin: `${base}.f16`, index: `${base}.json` };
}

/**
 * Shipped rows by id for this model and dimension; empty when there is no seed, it was written for
 * another model, or it is damaged (then everything is embedded as before).
 */
export async function readSeed(datasetDir: string, modelId: string, dim: number): Promise<Map<string, SeedRow>> {
  const out = new Map<string, SeedRow>();
  const files = seedFiles(datasetDir, modelId);
  let index: SeedIndex;
  try {
    index = JSON.parse(await fs.readFile(files.index, 'utf8')) as SeedIndex;
  } catch {
    return out;
  }
  if (
    index.version !== 1 ||
    index.modelId !== modelId ||
    index.dim !== dim ||
    !Array.isArray(index.ids) ||
    !Array.isArray(index.sources) ||
    index.ids.length !== index.sources.length
  ) {
    return out;
  }
  let buf: Buffer;
  try {
    buf = await fs.readFile(files.bin);
  } catch {
    return out;
  }
  if (buf.byteLength !== index.ids.length * dim * 2) return out;
  // Copy into an aligned buffer: a Buffer from the pool may start at an odd offset.
  const halves = new Uint16Array(index.ids.length * dim);
  new Uint8Array(halves.buffer).set(buf);
  const all = decodeHalf(halves);
  index.ids.forEach((id, i) => {
    if (typeof id !== 'string') return;
    out.set(id, { source: String(index.sources[i] ?? ''), row: all.subarray(i * dim, (i + 1) * dim) });
  });
  return out;
}

/** Writes the seed for `ids` (rows of `vectors`, `dim` values each). */
export async function writeSeed(
  datasetDir: string,
  modelId: string,
  dim: number,
  ids: readonly string[],
  sources: readonly string[],
  vectors: Float32Array,
): Promise<{ bin: string; index: string; bytes: number }> {
  if (ids.length !== sources.length) throw new Error('writeSeed: ids und sources sind verschieden lang.');
  if (vectors.length !== ids.length * dim) throw new Error('writeSeed: Anzahl der Werte passt nicht zu ids × dim.');
  const files = seedFiles(datasetDir, modelId);
  const halves = encodeHalf(vectors);
  const index: SeedIndex = { version: 1, modelId, dim, ids: [...ids], sources: [...sources] };
  await fs.mkdir(datasetDir, { recursive: true });
  await fs.writeFile(files.bin, new Uint8Array(halves.buffer, halves.byteOffset, halves.byteLength));
  await fs.writeFile(files.index, JSON.stringify(index));
  return { ...files, bytes: halves.byteLength };
}
