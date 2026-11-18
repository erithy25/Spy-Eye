/**
 * Walkable space from one frame: relative disparity (depth.ts) + the picture → a grid of metric
 * distances along the viewing rays (binary DSG1, see contract.ts), the sky mask and the skyline.
 *
 * Camera model: pinhole, square pixels, no roll, horizontal field of view `fovDeg` (default 62°,
 * a typical phone/action camera in 16:9), pitch θ (positive = looking up) estimated below.
 *
 * Sky: pixels connected to the top row whose disparity is (practically) zero — Depth Anything V2
 * predicts the sky at exactly 0, distant hills at a few percent of the near end — and whose colour
 * is bright or blue-ish, cleaned with a small closing/opening and re-connected to the top. Less
 * than 0.5 % is no sky (indoor frames have none); below 3 % there is no skyline.
 *
 * Metric distance. Depth Anything predicts relative inverse depth d up to an unknown scale and
 * shift, so inverse depth is 1/Z = a·d + b. Assumptions used to fix a and b:
 *   1. The camera is EYE_HEIGHT (1.6 m) above a flat ground plane. On that plane inverse depth is
 *      linear in the image row: 1/Z = (cos θ · (v − cy)/f − sin θ) / h, and independent of the
 *      column (no roll). Ground pixels are found in the lower part of the frame as the pixels
 *      whose disparity follows one line d = α·v + β (robust fit) and grows downwards.
 *   2. Pitch: where the ground line reaches the disparity of the sky (inverse depth 0) is the
 *      horizon row. A "ground" whose horizon would cut through the sky is rejected (people or
 *      objects filling the lower frame). Without ground: level, unless the sky reaches below the
 *      centre. The horizon is kept above every ground pixel; pitch is limited to −40°..30°.
 *   3. a and b from a least-squares fit of the geometric inverse depth of the ground pixels
 *      against their disparity; the distance this implies for the farthest non-sky content is then
 *      held to a plausible range (open horizon: up to 2 km; buildings against the sky: the distance
 *      at which ~25 m of height fills the angle above the horizon; indoor / no sky: 3–15 m). If it
 *      falls outside, b is set so that the farthest content sits at the nearest plausible bound and
 *      a is refitted through that anchor.
 *   4. Without visible ground the bottom rows are taken to be 0.8–3 m away (in front of where the
 *      ground would be) and the farthest content at a typical far distance.
 * Distances are clamped to [0.5 m, 2000 m]. The result is geometrically plausible (ground flat,
 * walls upright, proportions right), not metrically exact.
 */
import sharp from 'sharp';
import { SPACE_GRID_MAGIC } from './contract.js';

export const EYE_HEIGHT_M = 1.6;
export const MIN_DISTANCE_M = 0.5;
export const MAX_DISTANCE_M = 2000;
const DEG = Math.PI / 180;

export interface SpaceGridData {
  width: number;
  height: number;
  fovDeg: number;
  near: number;
  far: number;
  /** Distance along the viewing ray (m), row-major from the top-left; >= far: sky / unknown. */
  distance: Float32Array;
  /** 1 = sky. */
  sky: Uint8Array;
}

export interface Disparity {
  width: number;
  height: number;
  data: Float32Array;
}

export interface SpaceBuildResult {
  buffer: Buffer;
  skyline: number[] | null;
  skyFraction: number;
  pitchDeg: number;
}

/** Internals exposed for diagnostics and tests. */
export interface SpaceDiagnostics {
  groundPixels: number;
  groundLine: { alpha: number; beta: number } | null;
  a: number;
  b: number;
  farDistance: number;
  horizonRow: number;
  /** Ground inlier pixels at the disparity resolution (1 = ground). */
  groundMask: Uint8Array;
  disparityWidth: number;
}

const HEADER_BYTES = 4 + 4 + 4 + 4 + 4 + 4;
/** Disparity (relative to the near end) below which a pixel can be sky. */
const SKY_DISPARITY = 0.005;

// ---------------------------------------------------------------------------------------------
// DSG1 encoding
// ---------------------------------------------------------------------------------------------

export function encodeSpaceGrid(grid: SpaceGridData): Buffer {
  const n = grid.width * grid.height;
  if (grid.distance.length !== n || grid.sky.length !== n) throw new Error('space grid: size mismatch');
  const buf = Buffer.alloc(HEADER_BYTES + n * 4 + n);
  buf.write(SPACE_GRID_MAGIC, 0, 'ascii');
  buf.writeUInt32LE(grid.width, 4);
  buf.writeUInt32LE(grid.height, 8);
  buf.writeFloatLE(grid.fovDeg, 12);
  buf.writeFloatLE(grid.near, 16);
  buf.writeFloatLE(grid.far, 20);
  let o = HEADER_BYTES;
  for (let i = 0; i < n; i++, o += 4) buf.writeFloatLE(grid.distance[i] as number, o);
  for (let i = 0; i < n; i++) buf[o + i] = grid.sky[i] as number;
  return buf;
}

export function parseSpaceGrid(buffer: Buffer | Uint8Array): SpaceGridData {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (buf.length < HEADER_BYTES || buf.toString('ascii', 0, 4) !== SPACE_GRID_MAGIC) {
    throw new Error('space grid: not a DSG1 buffer');
  }
  const width = buf.readUInt32LE(4);
  const height = buf.readUInt32LE(8);
  const n = width * height;
  if (buf.length !== HEADER_BYTES + n * 5) throw new Error('space grid: truncated');
  const distance = new Float32Array(n);
  let o = HEADER_BYTES;
  for (let i = 0; i < n; i++, o += 4) distance[i] = buf.readFloatLE(o);
  const sky = Uint8Array.from(buf.subarray(o, o + n));
  return {
    width,
    height,
    fovDeg: buf.readFloatLE(12),
    near: buf.readFloatLE(16),
    far: buf.readFloatLE(20),
    distance,
    sky,
  };
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function percentile(values: Float32Array | Float64Array | number[], p: number): number {
  const a = Float64Array.from(values as ArrayLike<number>).sort();
  if (a.length === 0) return Number.NaN;
  const pos = Math.min(a.length - 1, Math.max(0, p * (a.length - 1)));
  const i = Math.floor(pos);
  const t = pos - i;
  return (a[i] as number) * (1 - t) + (a[Math.min(a.length - 1, i + 1)] as number) * t;
}

function medianOf(values: number[]): number {
  return percentile(values, 0.5);
}

/** Binary dilation / erosion with a (2r+1)² square. */
function morph(mask: Uint8Array, w: number, h: number, r: number, dilate: boolean): Uint8Array {
  // Separable: rows then columns.
  const tmp = new Uint8Array(mask.length);
  const out = new Uint8Array(mask.length);
  const target = dilate ? 1 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        if (mask[y * w + xx] === target) {
          v = target;
          break;
        }
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = dilate ? 0 : 1;
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        if (tmp[yy * w + x] === target) {
          v = target;
          break;
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/** Pixels of `allowed` reachable from the top row (4-connected). */
function floodFromTop(allowed: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(allowed.length);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) {
    if (allowed[x]) {
      out[x] = 1;
      stack.push(x);
    }
  }
  while (stack.length > 0) {
    const i = stack.pop() as number;
    const x = i % w;
    const y = (i - x) / w;
    const next = [y > 0 ? i - w : -1, y + 1 < h ? i + w : -1, x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1];
    for (const j of next) {
      if (j >= 0 && allowed[j] && !out[j]) {
        out[j] = 1;
        stack.push(j);
      }
    }
  }
  return out;
}

/** Fills holes of the sky smaller than `maxArea` pixels (birds, wires, lamp heads). */
function fillSmallHoles(sky: Uint8Array, w: number, h: number, maxArea: number): void {
  const seen = new Uint8Array(sky.length);
  const stack: number[] = [];
  const comp: number[] = [];
  for (let s = 0; s < sky.length; s++) {
    if (sky[s] || seen[s]) continue;
    comp.length = 0;
    let touchesBottom = false;
    seen[s] = 1;
    stack.push(s);
    while (stack.length > 0) {
      const i = stack.pop() as number;
      comp.push(i);
      const x = i % w;
      const y = (i - x) / w;
      if (y === h - 1 || x === 0 || x === w - 1) touchesBottom = true;
      const next = [y > 0 ? i - w : -1, y + 1 < h ? i + w : -1, x > 0 ? i - 1 : -1, x + 1 < w ? i + 1 : -1];
      for (const j of next) {
        if (j >= 0 && !sky[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (!touchesBottom && comp.length <= maxArea) for (const i of comp) sky[i] = 1;
  }
}

// ---------------------------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------------------------

/**
 * Sky mask at the disparity resolution. `rel` is the raw disparity divided by its 99.5th
 * percentile. Depth Anything V2 ends in a ReLU and predicts the sky at (practically) exactly zero,
 * while distant hills stay at a few percent of the near end and the farthest wall of a room at
 * one percent or more; the threshold sits well below both.
 */
export function skyMask(rel: Float32Array, rgb: Uint8Array, w: number, h: number): Uint8Array {
  const dn = rel;
  const n = w * h;
  // Brightness reference: the bright end of the picture (sky is usually among the brightest).
  const lumas = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lumas[i] = 0.299 * (rgb[i * 3] as number) + 0.587 * (rgb[i * 3 + 1] as number) + 0.114 * (rgb[i * 3 + 2] as number);
  }
  const brightRef = percentile(lumas.filter((_, i) => i % 7 === 0), 0.98);
  const brightLimit = Math.max(90, 0.62 * brightRef);
  const farLimit = SKY_DISPARITY;
  const allowed = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if ((dn[i] as number) > farLimit) continue;
    const r = rgb[i * 3] as number;
    const g = rgb[i * 3 + 1] as number;
    const b = rgb[i * 3 + 2] as number;
    const luma = lumas[i] as number;
    const blueish = b > 60 && b >= r + 6 && b >= g - 12;
    const bright = luma >= brightLimit;
    if (blueish || bright) allowed[i] = 1;
  }
  let sky = floodFromTop(allowed, w, h);
  // Small closing (fills specks and thin wires) and opening (removes thin leaks), then keep only
  // what is still connected to the top.
  const r = Math.max(1, Math.round(w / 260));
  sky = morph(morph(sky, w, h, r, true), w, h, r, false);
  sky = morph(morph(sky, w, h, r, false), w, h, r, true);
  for (let i = 0; i < n; i++) if (!allowed[i] && (dn[i] as number) > farLimit * 1.5) sky[i] = 0;
  sky = floodFromTop(sky, w, h);
  fillSmallHoles(sky, w, h, Math.max(16, Math.round(n * 0.002)));
  return sky;
}

/** Per output column the normalised y below the lowest top-connected sky pixel; smoothed. */
function computeSkyline(sky: Uint8Array, w: number, h: number, columns: number): number[] {
  const perSource = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    let lowest = -1;
    for (let y = h - 1; y >= 0; y--) {
      if (sky[y * w + x]) {
        lowest = y;
        break;
      }
    }
    perSource[x] = (lowest + 1) / h;
  }
  const raw: number[] = [];
  for (let c = 0; c < columns; c++) {
    const x0 = Math.floor((c * w) / columns);
    const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * w) / columns));
    const vals: number[] = [];
    for (let x = x0; x < x1 && x < w; x++) vals.push(perSource[x] as number);
    raw.push(medianOf(vals));
  }
  // Median of 5 removes single-column spikes (poles, gaps in foliage), then a 3-tap mean.
  const med = raw.map((_, i) => medianOf(raw.slice(Math.max(0, i - 2), Math.min(columns, i + 3))));
  return med.map((_, i) => {
    const a = med[Math.max(0, i - 1)] as number;
    const b = med[i] as number;
    const c = med[Math.min(columns - 1, i + 1)] as number;
    return Math.round(((a + b + c) / 3) * 10000) / 10000;
  });
}

// ---------------------------------------------------------------------------------------------
// Ground plane and metric scale
// ---------------------------------------------------------------------------------------------

interface GroundFit {
  alpha: number;
  beta: number;
  rows: Int32Array;
  cols: Int32Array;
  values: Float32Array;
  count: number;
}

/** Weighted least-squares line y = α·x + β. */
function lineFit(xs: ArrayLike<number>, ys: ArrayLike<number>, wts: ArrayLike<number> | null): { alpha: number; beta: number } | null {
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let k = 0; k < xs.length; k++) {
    const wt = wts ? (wts[k] as number) : 1;
    if (wt <= 0) continue;
    const x = xs[k] as number;
    const y = ys[k] as number;
    sw += wt;
    sx += wt * x;
    sy += wt * y;
    sxx += wt * x * x;
    sxy += wt * x * y;
  }
  const den = sw * sxx - sx * sx;
  if (sw <= 0 || Math.abs(den) < 1e-12) return null;
  const alpha = (sw * sxy - sx * sy) / den;
  return { alpha, beta: (sy - alpha * sx) / sw };
}

/**
 * Ground plane in the lower part of the frame. On a flat ground seen without roll the disparity
 * is a line in the row, d = α·v + β, the same in every column, so its vertical gradient is α
 * everywhere. Robust fit (Tukey biweight), then only pixels that agree with the line AND have
 * the line's gradient are kept; people, cars and walls fail the gradient test. The inliers must
 * span a range of rows and a good part of the width.
 */
function fitGround(dn: Float32Array, sky: Uint8Array, w: number, h: number): GroundFit | null {
  const top = Math.floor(h * 0.5);
  const rowsArr: number[] = [];
  const colsArr: number[] = [];
  const vals: number[] = [];
  const grads: number[] = [];
  const gap = Math.max(2, Math.round(h / 100));
  for (let v = top; v < h - gap; v += 2) {
    for (let u = 1; u < w - 1; u += 2) {
      const i = v * w + u;
      if (sky[i]) continue;
      const grad = ((dn[(v + gap) * w + u] as number) - (dn[(v - gap) * w + u] as number)) / (2 * gap);
      if (grad <= 0) continue;
      rowsArr.push(v);
      colsArr.push(u);
      vals.push(dn[i] as number);
      grads.push(grad);
    }
  }
  const total = (((h - gap - top) / 2) * (w - 2)) / 2;
  if (rowsArr.length < Math.max(50, total * 0.05)) return null;
  let weights = new Float64Array(rowsArr.length).fill(1);
  let line: { alpha: number; beta: number } | null = null;
  for (let iter = 0; iter < 10; iter++) {
    line = lineFit(rowsArr, vals, weights);
    if (!line) return null;
    const { alpha, beta } = line;
    const res = rowsArr.map((x, k) => Math.abs((vals[k] as number) - (alpha * x + beta)));
    const scale = Math.max(0.004, 1.4826 * medianOf(res));
    const next = new Float64Array(rowsArr.length);
    for (let k = 0; k < res.length; k++) {
      const r = (res[k] as number) / (3 * scale);
      let wt = r < 1 ? (1 - r * r) ** 2 : 0; // Tukey biweight
      // From the third pass on, the local gradient must match the plane's.
      if (iter >= 2 && alpha > 0) {
        const ratio = (grads[k] as number) / alpha;
        if (ratio < 0.35 || ratio > 2.8) wt = 0;
      }
      next[k] = wt;
    }
    weights = next;
  }
  if (!line || !(line.alpha > 0)) return null;
  const { alpha, beta } = line;
  const inRows: number[] = [];
  const inCols: number[] = [];
  const inVals: number[] = [];
  for (let k = 0; k < rowsArr.length; k++) {
    if ((weights[k] as number) > 0.3) {
      inRows.push(rowsArr[k] as number);
      inCols.push(colsArr[k] as number);
      inVals.push(vals[k] as number);
    }
  }
  if (inRows.length < Math.max(40, total * 0.06)) return null;
  // A ground plane spans a range of rows and much of the width; a single object does not.
  const rowSpan = percentile(inRows, 0.9) - percentile(inRows, 0.1);
  const colSpan = percentile(inCols, 0.9) - percentile(inCols, 0.1);
  if (rowSpan < h * 0.08 || colSpan < w * 0.35) return null;
  return {
    alpha,
    beta,
    rows: Int32Array.from(inRows),
    cols: Int32Array.from(inCols),
    values: Float32Array.from(inVals),
    count: inRows.length,
  };
}

// ---------------------------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------------------------

export async function buildSpaceGrid(
  jpegPath: string,
  disparity: Disparity,
  opts: { fovDeg?: number; columns?: number } = {},
): Promise<SpaceBuildResult & { grid: SpaceGridData; diagnostics: SpaceDiagnostics }> {
  const fovDeg = opts.fovDeg ?? 62;
  const columns = Math.max(16, Math.round(opts.columns ?? 192));
  const w = disparity.width;
  const h = disparity.height;
  const n = w * h;
  if (disparity.data.length !== n) throw new Error('space: disparity size mismatch');

  const meta = await sharp(jpegPath).metadata();
  const imgW = meta.autoOrient?.width ?? meta.width ?? w;
  const imgH = meta.autoOrient?.height ?? meta.height ?? h;
  const rgb = new Uint8Array(
    await sharp(jpegPath).rotate().removeAlpha().toColourspace('srgb').resize(w, h, { fit: 'fill' }).raw().toBuffer(),
  );

  // Normalised disparity: 0 = farthest, 1 = nearest (robust percentiles).
  const sampleVals = disparity.data.filter((_, i) => i % 5 === 0);
  const lo = percentile(sampleVals, 0.005);
  const hi = percentile(sampleVals, 0.995);
  const span = hi - lo > 1e-6 ? hi - lo : 1;
  const dn = new Float32Array(n);
  for (let i = 0; i < n; i++) dn[i] = ((disparity.data[i] as number) - lo) / span;

  // --- sky ---------------------------------------------------------------------------------
  const rel = new Float32Array(n);
  const relScale = hi > 1e-6 ? hi : 1;
  for (let i = 0; i < n; i++) rel[i] = Math.max(0, disparity.data[i] as number) / relScale;
  let sky = skyMask(rel, rgb, w, h);
  let skyCount = 0;
  for (let i = 0; i < n; i++) skyCount += sky[i] as number;
  let skyFraction = skyCount / n;
  if (skyFraction < 0.005) {
    // A few specks are not a sky.
    sky = new Uint8Array(n);
    skyCount = 0;
    skyFraction = 0;
  }
  const hasSky = skyCount > 0;
  // Lowest sky row per disparity column (-1 where the column has no sky).
  const lowestSky = new Float64Array(w).fill(-1);
  for (let u = 0; u < w; u++) {
    for (let v = h - 1; v >= 0; v--) {
      if (sky[v * w + u]) {
        lowestSky[u] = v;
        break;
      }
    }
  }
  const skyColumns = Array.from(lowestSky).filter((v) => v >= 0);
  // Lower edge of the sky (pixel row): the horizon lies at or below it for a camera near the ground.
  const skyBottom = skyColumns.length > 0 ? percentile(skyColumns, 0.9) + 1 : -1;
  const skyline = skyFraction >= 0.03 ? computeSkyline(sky, w, h, columns) : null;

  // --- camera ----------------------------------------------------------------------------------
  const f = w / 2 / Math.tan((fovDeg * DEG) / 2);
  const cx = w / 2;
  const cy = h / 2;
  const nonSky: number[] = [];
  for (let i = 0; i < n; i += 3) if (!sky[i]) nonSky.push(dn[i] as number);
  const dnFar = nonSky.length > 0 ? percentile(nonSky, 0.01) : 0;
  const skyDn = hasSky ? medianOf(Array.from(dn.filter((_, i) => sky[i] === 1 && i % 3 === 0))) : Number.NaN;

  let ground = fitGround(dn, sky, w, h);

  // Pitch from the horizon row: where the ground line reaches the disparity of infinity (sky).
  let horizonRow = cy;
  if (ground && hasSky) {
    const fromGround = (Math.min(skyDn, dnFar) - ground.beta) / ground.alpha;
    // The sky must lie above the horizon; a "ground" whose horizon cuts through the sky is not
    // the ground (people or objects filling the lower frame).
    if (fromGround < skyBottom - h * 0.06) ground = null;
    else horizonRow = fromGround;
  }
  if (!ground && hasSky) {
    // Level camera unless the sky reaches below the centre.
    horizonRow = Math.max(cy, skyBottom);
  }
  if (ground) {
    // Every ground pixel must lie below the horizon (some margin for the nearest ones).
    const topGround = percentile(Array.from(ground.rows), 0.02);
    horizonRow = Math.min(horizonRow, topGround - h * 0.03);
  }
  let pitch = Math.atan((horizonRow - cy) / f);
  pitch = Math.max(-40 * DEG, Math.min(30 * DEG, pitch));
  horizonRow = cy + f * Math.tan(pitch);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);

  // Plausible distance of the farthest non-sky content: a room without sky, else what fills the
  // angle between the horizon and the lower edge of the sky.
  let farLo = 3;
  let farHi = 15;
  if (hasSky) {
    const elev = Math.atan((horizonRow - skyBottom) / f) / DEG;
    const dSky = elev <= 0.5 ? MAX_DISTANCE_M : Math.max(30, Math.min(MAX_DISTANCE_M, 25 / Math.tan(elev * DEG)));
    farLo = dSky / 3;
    farHi = Math.min(MAX_DISTANCE_M, dSky * 3);
  }

  let a = 0;
  let b = 0;
  let farDistance = Math.sqrt(farLo * farHi);
  const groundQ = (v: number): number => (cosP * (v + 0.5 - cy)) / f / EYE_HEIGHT_M - sinP / EYE_HEIGHT_M;
  if (ground) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let k = 0; k < ground.count; k++) {
      const q = groundQ(ground.rows[k] as number);
      if (q <= 0) continue;
      xs.push(ground.values[k] as number);
      ys.push(q);
    }
    if (xs.length >= 20) {
      let mx = 0;
      let my = 0;
      for (let k = 0; k < xs.length; k++) {
        mx += xs[k] as number;
        my += ys[k] as number;
      }
      mx /= xs.length;
      my /= xs.length;
      let sxy = 0;
      let sxx = 0;
      for (let k = 0; k < xs.length; k++) {
        sxy += ((xs[k] as number) - mx) * ((ys[k] as number) - my);
        sxx += ((xs[k] as number) - mx) ** 2;
      }
      a = sxx > 1e-12 ? sxy / sxx : 0;
      b = my - a * mx;
      const inv = a * dnFar + b;
      const implied = inv > 0 ? 1 / inv : Infinity;
      if (!(a > 0) || implied < farLo || implied > farHi) {
        farDistance = !(a > 0) ? farDistance : Math.max(farLo, Math.min(farHi, implied));
        const anchor = 1 / farDistance;
        let num = 0;
        let den = 0;
        for (let k = 0; k < xs.length; k++) {
          const dx = (xs[k] as number) - dnFar;
          num += dx * ((ys[k] as number) - anchor);
          den += dx * dx;
        }
        a = den > 1e-12 ? num / den : 0;
        b = anchor - a * dnFar;
      } else {
        farDistance = implied;
      }
    }
  }
  if (!(a > 0)) {
    // No usable ground: bottom rows ~2 m away (or on the ground for a downward pitch).
    const bottom: number[] = [];
    for (let v = Math.floor(h * 0.92); v < h; v++) for (let u = 0; u < w; u += 2) if (!sky[v * w + u]) bottom.push(dn[v * w + u] as number);
    const dnNear = bottom.length > 0 ? medianOf(bottom) : 1;
    const qBottom = groundQ(h - 1);
    // What fills the bottom rows without being ground stands in front of where the ground would be.
    const nearDistance = qBottom > 0 ? Math.max(0.8, Math.min(3, 0.6 / qBottom)) : 2;
    farDistance = Math.sqrt(farLo * farHi);
    if (dnNear - dnFar > 0.05) {
      a = (1 / nearDistance - 1 / farDistance) / (dnNear - dnFar);
      b = 1 / farDistance - a * dnFar;
    } else {
      a = 0;
      b = 1 / nearDistance;
    }
  }

  // --- distances at the disparity resolution ---------------------------------------------------
  const dist = new Float32Array(n);
  for (let v = 0; v < h; v++) {
    const y = (v + 0.5 - cy) / f;
    for (let u = 0; u < w; u++) {
      const i = v * w + u;
      if (sky[i]) {
        dist[i] = MAX_DISTANCE_M;
        continue;
      }
      const x = (u + 0.5 - cx) / f;
      const inv = a * (dn[i] as number) + b;
      const z = inv > 1 / MAX_DISTANCE_M ? 1 / inv : MAX_DISTANCE_M;
      dist[i] = Math.max(MIN_DISTANCE_M, Math.min(MAX_DISTANCE_M, z * Math.sqrt(1 + x * x + y * y)));
    }
  }

  // --- output grid -------------------------------------------------------------------------------
  const gw = columns;
  const gh = Math.max(1, Math.round((columns * imgH) / imgW));
  const gDist = new Float32Array(gw * gh);
  const gSky = new Uint8Array(gw * gh);
  let near = Infinity;
  let farthest = 0;
  const cell: number[] = [];
  for (let r = 0; r < gh; r++) {
    const v0 = Math.floor((r * h) / gh);
    const v1 = Math.max(v0 + 1, Math.floor(((r + 1) * h) / gh));
    for (let c = 0; c < gw; c++) {
      const u0 = Math.floor((c * w) / gw);
      const u1 = Math.max(u0 + 1, Math.floor(((c + 1) * w) / gw));
      cell.length = 0;
      let skyPix = 0;
      let all = 0;
      for (let v = v0; v < v1 && v < h; v++) {
        for (let u = u0; u < u1 && u < w; u++) {
          all++;
          if (sky[v * w + u]) skyPix++;
          else cell.push(dist[v * w + u] as number);
        }
      }
      const gi = r * gw + c;
      if (cell.length === 0 || skyPix * 2 > all) {
        gSky[gi] = 1;
        gDist[gi] = Number.POSITIVE_INFINITY;
        continue;
      }
      // Median, not mean: averaging across a depth edge would create points floating in between.
      const d = medianOf(cell);
      gDist[gi] = d;
      if (d < near) near = d;
      if (d > farthest) farthest = d;
    }
  }
  if (!Number.isFinite(near)) near = MIN_DISTANCE_M;
  const far = hasSky ? MAX_DISTANCE_M : Math.min(MAX_DISTANCE_M, Math.max(near * 2, farthest * 1.15, 10));
  for (let i = 0; i < gDist.length; i++) {
    if (gSky[i]) gDist[i] = far;
    else gDist[i] = Math.min(gDist[i] as number, far * 0.999);
  }
  const grid: SpaceGridData = { width: gw, height: gh, fovDeg, near: Math.max(MIN_DISTANCE_M, near), far, distance: gDist, sky: gSky };
  return {
    buffer: encodeSpaceGrid(grid),
    skyline,
    skyFraction: Math.round(skyFraction * 10000) / 10000,
    pitchDeg: Math.round((pitch / DEG) * 100) / 100,
    grid,
    diagnostics: {
      groundPixels: ground?.count ?? 0,
      groundLine: ground ? { alpha: ground.alpha, beta: ground.beta } : null,
      a,
      b,
      farDistance,
      horizonRow,
      groundMask: (() => {
        const m = new Uint8Array(n);
        if (ground) for (let k = 0; k < ground.count; k++) {
          const v = ground.rows[k] as number;
          const u = ground.cols[k] as number;
          m[v * w + u] = 1;
        }
        return m;
      })(),
      disparityWidth: w,
    },
  };
}
