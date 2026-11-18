/**
 * DATUM light direction from shading and cast shadows in one keyframe.
 *
 * Input: the keyframe JPEG and its DSG1 space grid (space.ts). Output: where the sun stands
 * relative to the camera (azimuth clockwise from the viewing direction, seen from above, and
 * elevation), or that the light is diffuse.
 *
 * 1. Geometry. Every grid cell becomes a 3-D point (camera at the origin, x right, y up,
 *    −z forward; pinhole with the grid's horizontal field of view, square cells). DSG1 carries no
 *    pitch; it is recovered as the tilt for which most of the lower cells lie on a plane
 *    EYE_HEIGHT_M below the camera (space.ts puts the ground exactly there; without such a plane
 *    the camera is taken as level). Normals from central differences of neighbouring points,
 *    skipping depth discontinuities, averaged over 5 × 5 cells; cells whose neighbourhood is not
 *    planar (foliage, clutter) are dropped. Classes: ground (normal within 20° of up), vertical
 *    (within 15° of horizontal), other.
 * 2. Photometry: linear luminance (sRGB decoded) of the frame resampled to the grid.
 * 3. Model: log I = log ρ_class + log(1 + K · max(0, n·L) · V(L)) + noise. V = 0 where the
 *    reconstructed scene blocks the ray from the cell toward the sun (screen-space ray march
 *    through the depth grid; occluders outside the frame are unknown and count as open). One
 *    albedo per class absorbs albedo and sky-light differences between ground and walls, so the
 *    direction comes from walls of different orientation and from cast shadows, the elevation
 *    mainly from where shadows fall (shading of vertical walls alone cannot separate K from the
 *    elevation). Exhaustive search over the hemisphere (6° × 5°, refined to 2°), K from a short
 *    list, Huber loss on the log residuals.
 * 4. Decision: the best direction must explain clearly more than a constant per class
 *    (pseudo-R² of the robust cost) and stand out against the other azimuths; otherwise the light
 *    counts as diffuse and no direction is claimed.
 *
 * Validation (see the report of the change and test/datum-shading.test.ts):
 *   - Synthetic scenes (boxes and walls on flat ground, textured albedo, sky and ground-bounce
 *     light, cast shadows, smooth 0.6 % depth error): azimuth within 12° in 8 of 8 sunlit cases,
 *     elevation within 10° in 6 of 8 (within 15° in all; with the sun ahead the elevation comes
 *     out too low); a diffuse render is recognised as diffuse.
 *   - Real frames (72 keyframes of the reference clips, Depth Anything grids): NOT reliable.
 *     About half of the overcast frames are reported sunlit (some with explained shares like true
 *     sun), several clearly sunny frames are reported diffuse, and the direction is right only in
 *     a few ground-level scenes with lit facades (e.g. low sun behind the camera). Monocular
 *     normals, tone mapping and albedo differences between facades dominate the signal.
 *     Confidence is therefore capped at REAL_WORLD_CAP; use the result only as weak evidence and
 *     only together with an independent sunny-light reading.
 *
 * Pure TypeScript, about 0.2–0.7 s per frame on a loaded 4-core CPU. Notes are German.
 */
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { EYE_HEIGHT_M, parseSpaceGrid, type SpaceGridData } from './space.js';

export interface LightEstimate {
  /**
   * Sun direction relative to the camera's forward axis, clockwise seen from above, −180..180:
   * 0 = sun straight ahead (camera looks into the sun), +90 = sun to the right.
   */
  relAzimuthDeg: number;
  /** Sun elevation above the horizon (degrees). */
  elevationDeg: number;
  /** Elevations that explain the picture nearly as well as the best one (degrees). */
  elevationBandDeg: [number, number];
  /** Half-width of the azimuths that explain the picture nearly as well as the best one (degrees). */
  azimuthSpreadDeg: number;
  /** 0..1, confidence in the reported direction (low when `sunlit` is false). */
  confidence: number;
  method: 'shading' | 'shadows' | 'both';
  /** Whether there is direct sun at all (false for overcast / diffuse scenes). */
  sunlit: boolean;
  /** 1–3 short German sentences. */
  notes: string[];
  /** Robust RMS of the log-luminance residual at the best fit. */
  residual: number;
  /** Share of the robust cost of a constant-per-surface model that the sun direction explains. */
  explained: number;
  /** Ratio of direct to ambient light at the best fit (K). */
  directRatio: number;
  /** Grid cells used. */
  samples: number;
  /** Camera pitch recovered from the ground plane (degrees, positive = looking up), null if level was assumed. */
  pitchDeg: number | null;
}

const DEG = Math.PI / 180;
const MAX_SAMPLES = 1300;
const MIN_SAMPLES = 80;
/** Direct / ambient ratios tried (for the ground; walls get K / AMBIENT_WALL). */
const K_COARSE = [1, 2.2, 4.6, 10] as const;
const K_FINE = [0.6, 1, 1.5, 2.2, 3.2, 4.6, 6.8, 10, 15] as const;
/**
 * Ambient (sky and bounce) light on a vertical wall relative to open ground: a wall sees half
 * the sky plus light reflected from the ground, typically 0.7–1.0 of what the ground receives.
 * Without this the walls' larger direct/ambient contrast would be read as a lower sun.
 */
const AMBIENT_WALL = 0.8;
/** Huber threshold on log-luminance residuals. */
const HUBER = 0.25;
/**
 * Upper bound of the confidence: on real frames the explained share did not separate sunny from
 * overcast scenes reliably (see the header), so no estimate claims more than this.
 */
const REAL_WORLD_CAP = 0.35;
/** Minimum share of the per-class cost the sun must explain to call the scene sunlit. */
const MIN_EXPLAINED = 0.1;
const GROUND = 0;
const VERTICAL = 1;
const OTHER = 2;

type Vec3 = [number, number, number];

interface Camera {
  w: number;
  h: number;
  f: number;
  cx: number;
  cy: number;
  dist: Float32Array;
  sky: Uint8Array;
  /** Cells that are neither sky nor clamped far content. */
  valid: Uint8Array;
  up: Vec3;
  fwd: Vec3;
  right: Vec3;
  pitchDeg: number;
  groundFound: boolean;
  /**
   * Per column: horizontal distance of the content in the top row (structure that continues
   * above the frame), −1 where the top row is sky.
   */
  topReach: Float64Array;
  /** Per column: height above the ground of that top-row content (m). */
  topHeight: Float64Array;
}

interface Samples {
  n: number;
  y: Float64Array;
  cls: Uint8Array;
  w: Float64Array;
  nx: Float64Array;
  ny: Float64Array;
  nz: Float64Array;
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
  d: Float64Array;
  /** 1 / ambient (sky-view) factor of the surface orientation, see AMBIENT_WALL. */
  invAmbient: Float64Array;
  /** Up component of the normal. */
  nUp: Float64Array;
  classCount: [number, number, number];
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const wrap180 = (a: number): number => {
  const r = (((a + 180) % 360) + 360) % 360 - 180;
  return r === -180 ? 180 : r;
};
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

/** Unit viewing ray of a cell centre (camera coordinates). */
function rayOf(c: number, r: number, cam: { f: number; cx: number; cy: number }): Vec3 {
  return normalize([(c + 0.5 - cam.cx) / cam.f, -(r + 0.5 - cam.cy) / cam.f, -1]);
}

/** Up vector in camera coordinates for a pitch θ (positive = looking up), no roll. */
const upForPitch = (theta: number): Vec3 => [0, Math.cos(theta), -Math.sin(theta)];

function buildCamera(grid: SpaceGridData): { cam: Camera; P: Float64Array } {
  const w = grid.width;
  const h = grid.height;
  const f = w / 2 / Math.tan((grid.fovDeg * DEG) / 2);
  const cx = w / 2;
  const cy = h / 2;
  const n = w * h;
  const P = new Float64Array(n * 3);
  const valid = new Uint8Array(n);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      const d = grid.distance[i] as number;
      if (grid.sky[i] || !(d > 0) || d >= grid.far * 0.99) continue;
      const ray = rayOf(c, r, { f, cx, cy });
      P[i * 3] = ray[0] * d;
      P[i * 3 + 1] = ray[1] * d;
      P[i * 3 + 2] = ray[2] * d;
      valid[i] = 1;
    }
  }
  // Pitch: the tilt for which most lower cells lie EYE_HEIGHT_M below the camera.
  const lower: number[] = [];
  for (let r = Math.floor(h * 0.4); r < h; r++) for (let c = 0; c < w; c++) if (valid[r * w + c]) lower.push(r * w + c);
  let bestTheta = 0;
  let bestScore = -1;
  let bestCount = 0;
  for (let t = -40; t <= 30; t += 0.5) {
    const up = upForPitch(t * DEG);
    let score = 0;
    let count = 0;
    for (const i of lower) {
      const x = P[i * 3] as number;
      const y = P[i * 3 + 1] as number;
      const z = P[i * 3 + 2] as number;
      const d = grid.distance[i] as number;
      const off = (up[0] * x + up[1] * y + up[2] * z + EYE_HEIGHT_M) / (0.02 * d + 0.03);
      if (Math.abs(off) < 1) {
        score += 1 - off * off;
        count++;
      }
    }
    // Prefer the level camera on ties.
    if (score > bestScore || (score === bestScore && Math.abs(t) < Math.abs(bestTheta))) {
      bestScore = score;
      bestCount = count;
      bestTheta = t;
    }
  }
  const groundFound = bestCount >= Math.max(30, lower.length * 0.06);
  const pitchDeg = groundFound ? bestTheta : 0;
  const up = upForPitch(pitchDeg * DEG);
  // Horizontal forward: the optical axis (0, 0, −1) without its component along up.
  const along = -up[2];
  const fwd = normalize([-along * up[0], -along * up[1], -1 - along * up[2]]);
  const right = cross(fwd, up);
  const topReach = new Float64Array(w).fill(-1);
  const topHeight = new Float64Array(w);
  for (let c = 0; c < w; c++) {
    // Lowest of the top two rows, so that a single noisy cell does not decide.
    for (let r = 0; r < Math.min(2, h); r++) {
      const i = r * w + c;
      if (!valid[i]) continue;
      const x = P[i * 3] as number;
      const y = P[i * 3 + 1] as number;
      const z = P[i * 3 + 2] as number;
      const along = x * up[0] + y * up[1] + z * up[2];
      topReach[c] = Math.hypot(x - along * up[0], y - along * up[1], z - along * up[2]);
      topHeight[c] = Math.max(0.5, along + EYE_HEIGHT_M);
    }
  }
  return {
    cam: { w, h, f, cx, cy, dist: grid.distance, sky: grid.sky, valid, up, fwd, right, pitchDeg, groundFound, topReach, topHeight },
    P,
  };
}

/**
 * Normals per cell (camera coordinates) from central differences, skipping depth
 * discontinuities, then averaged over 5 × 5 cells. Returns a planarity (resultant length of the
 * raw normals in the window, 0 where unusable).
 */
function normals(cam: Camera, P: Float64Array): { N: Float64Array; planarity: Float64Array } {
  const { w, h, valid } = cam;
  const n = w * h;
  const raw = new Float64Array(n * 3);
  const ok = new Uint8Array(n);
  const seg = (a: number, b: number, out: Vec3): number => {
    out[0] = (P[b * 3] as number) - (P[a * 3] as number);
    out[1] = (P[b * 3 + 1] as number) - (P[a * 3 + 1] as number);
    out[2] = (P[b * 3 + 2] as number) - (P[a * 3 + 2] as number);
    return Math.hypot(out[0], out[1], out[2]);
  };
  const a: Vec3 = [0, 0, 0];
  const b: Vec3 = [0, 0, 0];
  // Two consecutive segments must have similar length and direction (no jump, no fold).
  const smooth = (i0: number, i1: number, i2: number, t: Vec3): boolean => {
    const la = seg(i0, i1, a);
    const lb = seg(i1, i2, b);
    if (!(la > 1e-6) || !(lb > 1e-6)) return false;
    const ratio = la / lb;
    if (ratio > 3 || ratio < 1 / 3) return false;
    if (dot(a, b) / (la * lb) < 0.8) return false;
    t[0] = a[0] + b[0];
    t[1] = a[1] + b[1];
    t[2] = a[2] + b[2];
    return true;
  };
  const tu: Vec3 = [0, 0, 0];
  const tv: Vec3 = [0, 0, 0];
  for (let r = 1; r < h - 1; r++) {
    for (let c = 1; c < w - 1; c++) {
      const i = r * w + c;
      if (!valid[i] || !valid[i - 1] || !valid[i + 1] || !valid[i - w] || !valid[i + w]) continue;
      if (!smooth(i - 1, i, i + 1, tu)) continue;
      if (!smooth(i + w, i, i - w, tv)) continue;
      let nn = normalize(cross(tu, tv));
      const px = P[i * 3] as number;
      const py = P[i * 3 + 1] as number;
      const pz = P[i * 3 + 2] as number;
      if (nn[0] * px + nn[1] * py + nn[2] * pz > 0) nn = [-nn[0], -nn[1], -nn[2]];
      raw[i * 3] = nn[0];
      raw[i * 3 + 1] = nn[1];
      raw[i * 3 + 2] = nn[2];
      ok[i] = 1;
    }
  }
  const N = new Float64Array(n * 3);
  const planarity = new Float64Array(n);
  const R = 2;
  for (let r = R; r < h - R; r++) {
    for (let c = R; c < w - R; c++) {
      const i = r * w + c;
      if (!ok[i]) continue;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let cnt = 0;
      for (let dr = -R; dr <= R; dr++) {
        for (let dc = -R; dc <= R; dc++) {
          const j = i + dr * w + dc;
          if (!ok[j]) continue;
          sx += raw[j * 3] as number;
          sy += raw[j * 3 + 1] as number;
          sz += raw[j * 3 + 2] as number;
          cnt++;
        }
      }
      if (cnt < 13) continue;
      const len = Math.hypot(sx, sy, sz);
      planarity[i] = len / cnt;
      N[i * 3] = sx / len;
      N[i * 3 + 1] = sy / len;
      N[i * 3 + 2] = sz / len;
    }
  }
  return { N, planarity };
}

// ---------------------------------------------------------------------------------------------
// Photometry
// ---------------------------------------------------------------------------------------------

const srgbToLinear = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Linear luminance of the frame resampled to the grid (row-major, w × h). */
export async function gridLuminance(image: Buffer, w: number, h: number): Promise<Float64Array> {
  const rgb = await sharp(image, { failOn: 'none' })
    .rotate()
    .removeAlpha()
    .toColourspace('srgb')
    .resize(w, h, { fit: 'fill' })
    .raw()
    .toBuffer();
  const lut = new Float64Array(256);
  for (let v = 0; v < 256; v++) lut[v] = srgbToLinear(v);
  const out = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = 0.2126 * (lut[rgb[i * 3] as number] as number) + 0.7152 * (lut[rgb[i * 3 + 1] as number] as number) + 0.0722 * (lut[rgb[i * 3 + 2] as number] as number);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------------------------

function collectSamples(cam: Camera, P: Float64Array, luminance: Float64Array): Samples | null {
  const { N, planarity } = normals(cam, P);
  const { w, h, up } = cam;
  const picked: number[] = [];
  const cls: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if ((planarity[i] as number) < 0.9) continue;
    const d = cam.dist[i] as number;
    if (d > 250) continue;
    const nUp = (N[i * 3] as number) * up[0] + (N[i * 3 + 1] as number) * up[1] + (N[i * 3 + 2] as number) * up[2];
    let k: number;
    if (nUp > Math.cos(20 * DEG)) k = GROUND;
    else if (Math.abs(nUp) < Math.sin(15 * DEG)) k = VERTICAL;
    else if (nUp > -0.2) k = OTHER;
    else continue;
    picked.push(i);
    cls.push(k);
  }
  if (picked.length < MIN_SAMPLES) return null;
  const stride = Math.max(1, picked.length / MAX_SAMPLES);
  const idx: number[] = [];
  const idxCls: number[] = [];
  for (let s = 0; s < picked.length; s += stride) {
    idx.push(picked[Math.floor(s)] as number);
    idxCls.push(cls[Math.floor(s)] as number);
  }
  const n = idx.length;
  const out: Samples = {
    n,
    y: new Float64Array(n),
    cls: Uint8Array.from(idxCls),
    w: new Float64Array(n),
    nx: new Float64Array(n),
    ny: new Float64Array(n),
    nz: new Float64Array(n),
    px: new Float64Array(n),
    py: new Float64Array(n),
    pz: new Float64Array(n),
    d: new Float64Array(n),
    invAmbient: new Float64Array(n),
    nUp: new Float64Array(n),
    classCount: [0, 0, 0],
  };
  for (let k = 0; k < n; k++) {
    const i = idx[k] as number;
    out.y[k] = Math.log(Math.max(0.002, luminance[i] as number));
    out.nx[k] = N[i * 3] as number;
    out.ny[k] = N[i * 3 + 1] as number;
    out.nz[k] = N[i * 3 + 2] as number;
    out.px[k] = P[i * 3] as number;
    out.py[k] = P[i * 3 + 1] as number;
    out.pz[k] = P[i * 3 + 2] as number;
    out.d[k] = cam.dist[i] as number;
    const nUp = Math.max(-1, Math.min(1, (N[i * 3] as number) * up[0] + (N[i * 3 + 1] as number) * up[1] + (N[i * 3 + 2] as number) * up[2]));
    out.invAmbient[k] = 1 / (AMBIENT_WALL + (1 - AMBIENT_WALL) * nUp);
    out.nUp[k] = nUp;
    const cl = out.cls[k] as number;
    out.classCount[cl] = (out.classCount[cl] as number) + 1;
  }
  // Classes weigh about equally (the ground would otherwise drown the walls), within limits.
  const present = out.classCount.filter((c) => c > 0).length;
  for (let k = 0; k < n; k++) {
    const c = out.classCount[out.cls[k] as number] as number;
    out.w[k] = Math.max(0.3, Math.min(out.cls[k] === OTHER ? 1 : 3, n / (present * c)));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Light model
// ---------------------------------------------------------------------------------------------

/** Sun direction (camera coordinates) for a relative azimuth and an elevation. */
function lightVector(cam: Camera, azDeg: number, elDeg: number): Vec3 {
  const ce = Math.cos(elDeg * DEG);
  const lr = Math.sin(azDeg * DEG) * ce;
  const lu = Math.sin(elDeg * DEG);
  const lf = Math.cos(azDeg * DEG) * ce;
  return [
    lr * cam.right[0] + lu * cam.up[0] + lf * cam.fwd[0],
    lr * cam.right[1] + lu * cam.up[1] + lf * cam.fwd[1],
    lr * cam.right[2] + lu * cam.up[2] + lf * cam.fwd[2],
  ];
}

const MARCH_GROWTH = 1.35;
const MARCH_MAX_M = 120;

/**
 * Direct-light factor per sample: max(0, n·L) times visibility of the sun along a screen-space
 * ray march through the depth grid.
 */
function directFactors(cam: Camera, s: Samples, L: Vec3, withShadows: boolean, out: Float64Array): void {
  const { w, h, f, cx, cy, dist, sky, up, topReach, topHeight } = cam;
  for (let k = 0; k < s.n; k++) {
    const ndl = (s.nx[k] as number) * L[0] + (s.ny[k] as number) * L[1] + (s.nz[k] as number) * L[2];
    if (ndl <= 0) {
      out[k] = 0;
      continue;
    }
    out[k] = ndl;
    if (!withShadows) continue;
    const px = s.px[k] as number;
    const py = s.py[k] as number;
    const pz = s.pz[k] as number;
    const d0 = s.d[k] as number;
    for (let t = 0.25 + 0.02 * d0; t < MARCH_MAX_M; t *= MARCH_GROWTH) {
      const qx = px + t * L[0];
      const qy = py + t * L[1];
      const qz = pz + t * L[2];
      if (qz > -0.2) break; // behind the camera: unknown, open
      const c = Math.floor(cx + (f * qx) / -qz);
      const r = Math.floor(cy - (f * qy) / -qz);
      if (c < 0 || c >= w || r >= h) break; // left the frame sideways or below: unknown, open
      if (r < 0) {
        // Above the frame: what fills the top row continues upwards (facades, towers), to an
        // unknown height; taken to end between 1.2 and 1.6 times the height seen at the frame
        // edge (half light in between).
        const reach = topReach[c] as number;
        if (reach < 0) continue;
        const along = qx * up[0] + qy * up[1] + qz * up[2];
        const hq = Math.hypot(qx - along * up[0], qy - along * up[1], qz - along * up[2]);
        if (hq > reach + 0.04 * reach + 0.2 && hq - reach < Math.max(3, 0.6 * reach)) {
          const height = along + EYE_HEIGHT_M;
          const top = topHeight[c] as number;
          if (height < 1.2 * top) {
            out[k] = 0;
            break;
          }
          if (height < 1.6 * top) {
            out[k] = 0.5 * ndl;
            break;
          }
        }
        continue;
      }
      const j = r * w + c;
      if (sky[j]) continue;
      const lq = Math.hypot(qx, qy, qz);
      const dj = dist[j] as number;
      if (dj < lq - (0.04 * lq + 0.2) && lq - dj < Math.max(3, 0.6 * dj)) {
        out[k] = 0;
        break;
      }
    }
  }
}

interface Fit {
  cost: number;
  k: number;
}

/** Robust fit of per-class offsets (and K) for given direct factors; returns the mean Huber cost. */
function fitFactors(s: Samples, direct: Float64Array | null, kValues: readonly number[], resid?: Float64Array): Fit {
  const n = s.n;
  let best: Fit = { cost: Infinity, k: 0 };
  const e = new Float64Array(n);
  const sumW = [0, 0, 0];
  const sumE = [0, 0, 0];
  for (const K of kValues) {
    sumW[0] = sumW[1] = sumW[2] = 0;
    sumE[0] = sumE[1] = sumE[2] = 0;
    for (let i = 0; i < n; i++) {
      const g = direct ? (direct[i] as number) : 0;
      const v = (s.y[i] as number) - (g > 0 ? Math.log1p(K * g * (s.invAmbient[i] as number)) : 0);
      e[i] = v;
      const c = s.cls[i] as number;
      sumW[c]! += s.w[i] as number;
      sumE[c]! += (s.w[i] as number) * v;
    }
    let off = sumE.map((v, c) => (sumW[c]! > 0 ? v / sumW[c]! : 0));
    // One Huber reweighting pass for the offsets.
    for (let pass = 0; pass < 1; pass++) {
      sumW[0] = sumW[1] = sumW[2] = 0;
      sumE[0] = sumE[1] = sumE[2] = 0;
      for (let i = 0; i < n; i++) {
        const c = s.cls[i] as number;
        const r = Math.abs((e[i] as number) - off[c]!);
        const wt = (s.w[i] as number) * (r <= HUBER ? 1 : HUBER / r);
        sumW[c]! += wt;
        sumE[c]! += wt * (e[i] as number);
      }
      off = sumE.map((v, c) => (sumW[c]! > 0 ? v / sumW[c]! : 0));
    }
    let cost = 0;
    let wsum = 0;
    for (let i = 0; i < n; i++) {
      const r = Math.abs((e[i] as number) - off[s.cls[i] as number]!);
      cost += (s.w[i] as number) * (r <= HUBER ? 0.5 * r * r : HUBER * (r - 0.5 * HUBER));
      wsum += s.w[i] as number;
    }
    cost /= wsum || 1;
    if (cost < best.cost) {
      best = { cost, k: K };
      if (resid) for (let i = 0; i < n; i++) resid[i] = (e[i] as number) - off[s.cls[i] as number]!;
    }
    if (!direct) break;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Estimate
// ---------------------------------------------------------------------------------------------

const AZ_STEP = 8;
const EL_STEP = 6;
const EL_MIN = 5;
const EL_MAX = 83;

function directionText(az: number): string {
  const a = Math.abs(az);
  const side = az > 0 ? 'rechts' : 'links';
  if (a < 25) return 'von vorn (Gegenlicht)';
  if (a < 70) return `von ${side} vorn`;
  if (a <= 110) return `von ${side}`;
  if (a <= 155) return `von ${side} hinten`;
  return 'von hinten (Sonne im Rücken)';
}

/** Light estimate from a parsed grid and the frame's linear luminance at the grid resolution. */
export function analyseLight(grid: SpaceGridData, luminance: Float64Array): LightEstimate | null {
  if (luminance.length !== grid.width * grid.height || grid.width < 16 || grid.height < 9) return null;
  const { cam, P } = buildCamera(grid);
  const s = collectSamples(cam, P, luminance);
  if (!s) return null;

  // Null model: no sun, but sky light may brighten upward-facing surfaces (overcast: tree crowns,
  // slopes and roofs are brighter than walls and undersides). The sun has to beat the best of these.
  let base = fitFactors(s, null, [0]);
  const y0 = s.y;
  for (const gamma of [0.2, 0.4]) {
    const y = new Float64Array(s.n);
    for (let i = 0; i < s.n; i++) y[i] = (y0[i] as number) - Math.log(Math.max(0.1, 1 - gamma + gamma * (s.nUp[i] as number)));
    const fit = fitFactors({ ...s, y }, null, [0]);
    if (fit.cost < base.cost) base = fit;
  }
  if (!(base.cost > 1e-9)) return null;
  const direct = new Float64Array(s.n);
  const azs: number[] = [];
  for (let a = -180; a < 180; a += AZ_STEP) azs.push(a);
  const els: number[] = [];
  for (let e = EL_MIN; e <= EL_MAX; e += EL_STEP) els.push(e);
  const costs = new Float64Array(azs.length * els.length);
  let best = { az: 0, el: 45, cost: Infinity, k: 0 };
  for (let ai = 0; ai < azs.length; ai++) {
    for (let ei = 0; ei < els.length; ei++) {
      const az = azs[ai] as number;
      const el = els[ei] as number;
      directFactors(cam, s, lightVector(cam, az, el), true, direct);
      const fit = fitFactors(s, direct, K_COARSE);
      costs[ai * els.length + ei] = fit.cost;
      if (fit.cost < best.cost) best = { az, el, cost: fit.cost, k: fit.k };
    }
  }
  // Refine around the best coarse direction: 3° steps, then 1°.
  for (const step of [3, 1]) {
    const centre = { ...best };
    for (let da = -2 * step; da <= 2 * step; da += step) {
      for (let de = -2 * step; de <= 2 * step; de += step) {
        if (da === 0 && de === 0) continue;
        const az = wrap180(centre.az + da);
        const el = Math.max(2, Math.min(88, centre.el + de));
        directFactors(cam, s, lightVector(cam, az, el), true, direct);
        const fit = fitFactors(s, direct, K_FINE);
        if (fit.cost < best.cost) best = { az, el, cost: fit.cost, k: fit.k };
      }
    }
  }

  const gain = base.cost - best.cost;
  const explained = clamp01(gain / base.cost);
  const tol = best.cost + 0.25 * gain;
  // Azimuth profile: best over elevations per azimuth.
  let spread = 0;
  for (let ai = 0; ai < azs.length; ai++) {
    let m = Infinity;
    for (let ei = 0; ei < els.length; ei++) m = Math.min(m, costs[ai * els.length + ei] as number);
    if (m <= tol) spread = Math.max(spread, Math.abs(wrap180((azs[ai] as number) - best.az)));
  }
  // Elevation band at the best azimuth (± one coarse step).
  let elLo = best.el;
  let elHi = best.el;
  for (let ai = 0; ai < azs.length; ai++) {
    if (Math.abs(wrap180((azs[ai] as number) - best.az)) > AZ_STEP) continue;
    for (let ei = 0; ei < els.length; ei++) {
      if ((costs[ai * els.length + ei] as number) <= tol) {
        elLo = Math.min(elLo, els[ei] as number);
        elHi = Math.max(elHi, els[ei] as number);
      }
    }
  }
  elLo = Math.max(0, elLo - EL_STEP / 2);
  elHi = Math.min(90, elHi + EL_STEP / 2);

  // Which cue carries the fit: shading alone (no cast shadows) vs. the full model.
  const bestL = lightVector(cam, best.az, best.el);
  directFactors(cam, s, bestL, false, direct);
  const shadeOnly = fitFactors(s, direct, K_FINE);
  const shadingGain = clamp01((base.cost - shadeOnly.cost) / base.cost);
  const shadowGain = clamp01((shadeOnly.cost - best.cost) / base.cost);
  const method: LightEstimate['method'] = shadingGain >= 0.04 && shadowGain >= 0.04 ? 'both' : shadowGain > shadingGain ? 'shadows' : 'shading';

  const resid = new Float64Array(s.n);
  directFactors(cam, s, bestL, true, direct);
  fitFactors(s, direct, [best.k], resid);
  let rr = 0;
  for (let i = 0; i < s.n; i++) rr += Math.min(1, Math.abs(resid[i] as number)) ** 2;
  const residual = Math.sqrt(rr / s.n);

  const sunlit = explained >= MIN_EXPLAINED && best.k >= 1 && spread <= 75;
  const sampleFactor = clamp01(s.n / 600);
  let confidence = 0;
  if (sunlit) {
    confidence =
      REAL_WORLD_CAP *
      clamp01((explained - MIN_EXPLAINED) / 0.25 + 0.2) *
      Math.sqrt(clamp01(1 - spread / 90)) *
      Math.sqrt(sampleFactor) *
      (cam.groundFound ? 1 : 0.7);
  } else {
    confidence = Math.min(0.1, 0.5 * explained);
  }

  const notes: string[] = [];
  const elevationKnown = elHi - elLo <= 35;
  if (!sunlit) {
    notes.push('Diffuses Licht: keine Sonnenrichtung messbar.');
  } else {
    const cue = method === 'both' ? 'aus Schattierung und Schatten' : method === 'shadows' ? 'aus den Schlagschatten' : 'aus der Schattierung der Flächen';
    const elText = elevationKnown
      ? `Sonnenhöhe etwa ${Math.round(best.el)}°`
      : `Sonnenhöhe kaum bestimmbar (${Math.round(elLo)}–${Math.round(elHi)}°)`;
    notes.push(`Licht fällt ${directionText(best.az)} ein, ${elText} (${cue}).`);
    if (spread > 35) notes.push(`Richtung unsicher: Abweichungen bis etwa ${Math.round(spread)}° passen fast ebenso gut.`);
  }
  if (!cam.groundFound) notes.push('Kein Boden erkannt: Kamera waagerecht angenommen.');

  return {
    relAzimuthDeg: Math.round(wrap180(best.az) * 10) / 10,
    elevationDeg: Math.round(best.el * 10) / 10,
    elevationBandDeg: [Math.round(elLo), Math.round(elHi)],
    azimuthSpreadDeg: Math.round(spread),
    confidence: Math.round(confidence * 100) / 100,
    method,
    sunlit,
    notes: notes.slice(0, 3),
    residual: Math.round(residual * 1000) / 1000,
    explained: Math.round(explained * 1000) / 1000,
    directRatio: best.k,
    samples: s.n,
    pitchDeg: cam.groundFound ? cam.pitchDeg : null,
  };
}

/**
 * Sun direction relative to the camera from the keyframe and its DSG1 space grid; null when the
 * frame has too few usable surfaces (or cannot be read).
 */
export async function estimateLight(jpegPath: string, grid: Buffer): Promise<LightEstimate | null> {
  let parsed: SpaceGridData;
  try {
    parsed = parseSpaceGrid(grid);
  } catch {
    return null;
  }
  let luminance: Float64Array;
  try {
    // Decode from memory: libvips can keep a file handle open when it opens the path itself.
    luminance = await gridLuminance(await readFile(jpegPath), parsed.width, parsed.height);
  } catch {
    return null;
  }
  return analyseLight(parsed, luminance);
}

/**
 * Agreement (0..1) between an estimate and a sun position, given the camera heading (azimuth of
 * the viewing direction): 1 when the predicted relative azimuth and the elevation band match.
 * For the engine: weight morning / afternoon windows by the sun azimuth they imply.
 */
export function sunAgreement(est: LightEstimate, headingDeg: number, sun: { azimuthDeg: number; elevationDeg: number }): number {
  if (!est.sunlit) return 1;
  const rel = wrap180(sun.azimuthDeg - headingDeg);
  const dAz = Math.abs(wrap180(rel - est.relAzimuthDeg));
  const sigmaAz = Math.max(20, est.azimuthSpreadDeg);
  const az = Math.exp(-0.5 * (dAz / sigmaAz) ** 2);
  const [lo, hi] = est.elevationBandDeg;
  const outside = sun.elevationDeg < lo ? lo - sun.elevationDeg : sun.elevationDeg > hi ? sun.elevationDeg - hi : 0;
  const el = Math.exp(-0.5 * (outside / 10) ** 2);
  return az * el;
}
