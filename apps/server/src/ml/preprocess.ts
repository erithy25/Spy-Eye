import sharp from 'sharp';
import type { DetailLevel, NormRect } from '../types.js';

export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DecodedFrame {
  /** Interleaved RGB, 3 bytes per pixel. */
  data: Buffer;
  width: number;
  height: number;
}

export async function decodeFrame(filePath: string): Promise<DecodedFrame> {
  const { data, info } = await sharp(filePath, { failOn: 'none' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) {
    throw new Error(`Unexpected channel count ${info.channels} in frame ${filePath}`);
  }
  return { data, width: info.width, height: info.height };
}

function spread(total: number, window: number, count: number): number[] {
  if (count <= 1 || total <= window) return [Math.max(0, Math.round((total - window) / 2))];
  const step = (total - window) / (count - 1);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(Math.round(i * step));
  return out;
}

function squareGrid(width: number, height: number, side: number, maxStrideFraction: number): PixelRect[] {
  const s = Math.max(8, Math.min(side, width, height));
  const stride = s * maxStrideFraction;
  const cols = width > s ? Math.ceil((width - s) / stride) + 1 : 1;
  const rows = height > s ? Math.ceil((height - s) / stride) + 1 : 1;
  const xs = spread(width, s, cols);
  const ys = spread(height, s, rows);
  const rects: PixelRect[] = [];
  for (const top of ys) for (const left of xs) rects.push({ left, top, width: s, height: s });
  return rects;
}

/**
 * Regions of a frame that get their own embedding.
 * Tile 0 is always the whole frame. Further tiles are undistorted squares so that
 * small objects ("a cup", "a bus in the background") are represented at a usable scale.
 */
export function tileLayout(width: number, height: number, detail: DetailLevel): PixelRect[] {
  const tiles: PixelRect[] = [{ left: 0, top: 0, width, height }];
  if (detail === 'fast') return tiles;

  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const aspect = long / short;

  // Overlapping full-height squares along the long axis.
  if (aspect >= 1.15) {
    const count = Math.max(2, Math.round(aspect * 1.7));
    const positions = spread(long, short, count);
    for (const pos of positions) {
      tiles.push(
        width >= height
          ? { left: pos, top: 0, width: short, height: short }
          : { left: 0, top: pos, width: short, height: short },
      );
    }
  }

  if (detail === 'detail') {
    tiles.push(...squareGrid(width, height, Math.round(short * 0.6), 0.75));
  }
  return tiles;
}

/** Dense sliding windows used for the on-demand relevance heatmap. */
export function explainWindows(width: number, height: number): PixelRect[] {
  const short = Math.min(width, height);
  return squareGrid(width, height, Math.round(short * 0.5), 0.5);
}

export function toNormRect(rect: PixelRect, width: number, height: number): NormRect {
  return { x: rect.left / width, y: rect.top / height, w: rect.width / width, h: rect.height / height };
}

/**
 * Crops `rect` from the decoded frame, resizes it to `size`x`size` and writes normalized CHW floats
 * into `out` starting at `offset`.
 */
export async function writeTile(
  frame: DecodedFrame,
  rect: PixelRect,
  size: number,
  mean: readonly [number, number, number],
  std: readonly [number, number, number],
  out: Float32Array,
  offset: number,
): Promise<void> {
  const isFull = rect.left === 0 && rect.top === 0 && rect.width === frame.width && rect.height === frame.height;
  let pipeline = sharp(frame.data, { raw: { width: frame.width, height: frame.height, channels: 3 } });
  if (!isFull) pipeline = pipeline.extract(rect);
  const raw = await pipeline.resize(size, size, { fit: 'fill', kernel: 'cubic' }).raw().toBuffer();
  const plane = size * size;
  if (raw.length !== plane * 3) throw new Error(`Resized tile has ${raw.length} bytes, expected ${plane * 3}`);
  const [m0, m1, m2] = mean;
  const [s0, s1, s2] = std;
  const k0 = 1 / (255 * s0);
  const k1 = 1 / (255 * s1);
  const k2 = 1 / (255 * s2);
  const b0 = m0 / s0;
  const b1 = m1 / s1;
  const b2 = m2 / s2;
  const o0 = offset;
  const o1 = offset + plane;
  const o2 = offset + plane * 2;
  for (let i = 0, j = 0; i < plane; i++, j += 3) {
    out[o0 + i] = (raw[j] as number) * k0 - b0;
    out[o1 + i] = (raw[j + 1] as number) * k1 - b1;
    out[o2 + i] = (raw[j + 2] as number) * k2 - b2;
  }
}

export const SIGNATURE_SIDE = 32;

/** Tiny RGB thumbnail used to detect frames that are visually identical to the previous one. */
export async function frameSignature(frame: DecodedFrame): Promise<Uint8Array> {
  const raw = await sharp(frame.data, { raw: { width: frame.width, height: frame.height, channels: 3 } })
    .resize(SIGNATURE_SIDE, SIGNATURE_SIDE, { fit: 'fill', kernel: 'linear' })
    .raw()
    .toBuffer();
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
}

export interface SignatureDelta {
  /** Mean absolute difference per channel value (0..255). */
  mean: number;
  /** Fraction of cells whose colour changed noticeably. */
  changedFraction: number;
}

export function signatureDelta(a: Uint8Array, b: Uint8Array): SignatureDelta {
  const cells = SIGNATURE_SIDE * SIGNATURE_SIDE;
  let total = 0;
  let changed = 0;
  for (let c = 0; c < cells; c++) {
    const o = c * 3;
    const d =
      Math.abs((a[o] as number) - (b[o] as number)) +
      Math.abs((a[o + 1] as number) - (b[o + 1] as number)) +
      Math.abs((a[o + 2] as number) - (b[o + 2] as number));
    total += d;
    if (d > 36) changed++;
  }
  return { mean: total / (cells * 3), changedFraction: changed / cells };
}

/** True when two signatures show the same picture (static camera, nothing moved). */
export function isStaticDuplicate(delta: SignatureDelta): boolean {
  return delta.mean < 1.2 && delta.changedFraction < 0.004;
}
