/**
 * Terrain horizon and skyline matching.
 *
 * `horizonProfile` marches rays over the local elevation tiles (terrain.ts) and records, per
 * azimuth, the largest elevation angle of the terrain seen from eye height, with earth curvature
 * and standard atmospheric refraction (k = 0.13): apparent drop = d² · (1 − k) / (2R).
 *
 * `matchSkyline` compares the sky boundary of a frame (space.ts) with such a profile: for a
 * candidate horizontal field of view and pitch every image column becomes an (azimuth offset,
 * elevation) pair under a pinhole camera without roll; the heading that makes the columns agree
 * best with the profile (median absolute difference, columns on building edges excluded) wins.
 */
import type { GeoPoint } from './contract.js';
import { loadHeightField, offsetPoint, type HeightSampler } from './terrain.js';

const EARTH_RADIUS = 6_371_008.8;
const REFRACTION_K = 0.13;
const DEG = Math.PI / 180;
/** Coarsest elevation data (m per sample) a horizon is computed from. */
const MAX_HORIZON_CELL_M = 200;

export interface HorizonOptions {
  eyeHeightM?: number;
  radiusKm?: number;
  stepDeg?: number;
}

// ---------------------------------------------------------------------------------------------
// Horizon profile
// ---------------------------------------------------------------------------------------------

/**
 * Horizon profile from any height sampler (tests use synthetic terrain): elevation angle in
 * degrees of the highest terrain per azimuth, `360 / stepDeg` values starting at north.
 * `cellM` is the resolution of the sampler (sets the marching step near the observer).
 */
export function horizonProfileFromSampler(
  sample: HeightSampler,
  lat: number,
  lon: number,
  opts: HorizonOptions & { cellM?: number } = {},
): number[] | null {
  const eye = opts.eyeHeightM ?? 1.7;
  const radius = (opts.radiusKm ?? 15) * 1000;
  const stepDeg = opts.stepDeg ?? 1;
  const cell = Math.max(5, opts.cellM ?? 30);
  const ground = sample(lat, lon);
  if (ground === null) return null;
  const h0 = ground + eye;
  const count = Math.max(1, Math.round(360 / stepDeg));
  const out = new Array<number>(count);
  const mPerDegLat = (EARTH_RADIUS * DEG);
  const mPerDegLon = EARTH_RADIUS * DEG * Math.cos(lat * DEG);
  let missing = 0;
  for (let k = 0; k < count; k++) {
    const az = k * (360 / count) * DEG;
    const sn = Math.sin(az);
    const cs = Math.cos(az);
    let best = -Infinity;
    let d = Math.max(cell * 0.75, 10);
    while (d <= radius) {
      const h = sample(lat + (d * cs) / mPerDegLat, lon + (d * sn) / mPerDegLon);
      if (h !== null) {
        const drop = ((d * d) * (1 - REFRACTION_K)) / (2 * EARTH_RADIUS);
        const angle = Math.atan2(h - drop - h0, d);
        if (angle > best) best = angle;
      }
      d += Math.max(cell * 0.6, d * 0.008);
    }
    if (best === -Infinity) {
      out[k] = Number.NaN;
      missing++;
    } else {
      out[k] = best / DEG;
    }
  }
  if (missing > count / 2) return null;
  if (missing > 0) {
    // Fill gaps (no data in that direction) from the nearest known azimuths.
    for (let k = 0; k < count; k++) {
      if (!Number.isNaN(out[k] as number)) continue;
      for (let s = 1; s < count; s++) {
        const a = out[(k + s) % count] as number;
        const b = out[(k - s + count) % count] as number;
        if (!Number.isNaN(a) || !Number.isNaN(b)) {
          out[k] = Number.isNaN(a) ? b : Number.isNaN(b) ? a : (a + b) / 2;
          break;
        }
      }
    }
  }
  return out.map((v) => Math.round(v * 1000) / 1000);
}

/**
 * Terrain horizon at a place from the local elevation tiles: 360 / stepDeg values (default 360,
 * azimuth 0..359), elevation angle in degrees. Null when the tiles do not cover the place.
 */
export async function horizonProfile(lat: number, lon: number, opts: HorizonOptions = {}): Promise<number[] | null> {
  const radiusKm = opts.radiusKm ?? 15;
  const field = await loadHeightField({ lat, lon }, radiusKm + 0.5, Math.max(10, (radiusKm * 1000) / 500));
  // Coarser than ~200 m per sample (world overview tiles) says nothing about the local horizon.
  if (!field || field.metresPerPixel > MAX_HORIZON_CELL_M) return null;
  return horizonProfileFromSampler(field.sample, lat, lon, { ...opts, cellM: field.metresPerPixel });
}

// ---------------------------------------------------------------------------------------------
// Camera model
// ---------------------------------------------------------------------------------------------

/**
 * Viewing ray of a point in the image under a pinhole camera without roll.
 * @param u horizontal position 0..1 (left to right)
 * @param y vertical position 0..1 (top to bottom)
 * @param aspect image width / height
 * @returns azimuth offset from the heading and elevation above the horizon, degrees
 */
export function imageRay(
  u: number,
  y: number,
  aspect: number,
  fovDeg: number,
  pitchDeg: number,
): { azOffDeg: number; elevDeg: number } {
  const f = 0.5 / Math.tan((fovDeg * DEG) / 2);
  const X = (u - 0.5) / f;
  const Y = (y - 0.5) / (aspect * f);
  const p = pitchDeg * DEG;
  const sp = Math.sin(p);
  const cp = Math.cos(p);
  const fwd = Y * sp + cp;
  const up = sp - Y * cp;
  return {
    azOffDeg: Math.atan2(X, fwd) / DEG,
    elevDeg: Math.atan2(up, Math.hypot(X, fwd)) / DEG,
  };
}

function profileAt(profile: number[], azDeg: number): number {
  const n = profile.length;
  const step = 360 / n;
  let pos = (azDeg / step) % n;
  if (pos < 0) pos += n;
  const i = Math.floor(pos);
  const t = pos - i;
  const a = profile[i % n] as number;
  const b = profile[(i + 1) % n] as number;
  return a + (b - a) * t;
}

/** Below this rise and fall of the terrain horizon inside the view, a match says nothing (degrees). */
const MIN_RELIEF_DEG = 1;
/** Relief at which a match counts fully (degrees). */
const FULL_RELIEF_DEG = 4;
/** Floor for the typical error a heading is compared against (degrees). */
const MIN_TYPICAL_ERROR_DEG = 0.5;

/** Range (max − min) of the horizon profile across a view of `fovDeg` centred on `headingDeg`. */
export function profileRelief(profile: number[], headingDeg: number, fovDeg: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  const half = fovDeg / 2;
  for (let a = -half; a <= half + 1e-9; a += 0.5) {
    const v = profileAt(profile, headingDeg + a);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi > lo ? hi - lo : 0;
}

function median(values: Float64Array, count: number): number {
  const a = values.subarray(0, count).slice().sort();
  if (count === 0) return Number.NaN;
  const mid = count >> 1;
  return count % 2 === 1 ? (a[mid] as number) : ((a[mid - 1] as number) + (a[mid] as number)) / 2;
}

// ---------------------------------------------------------------------------------------------
// Skyline matching
// ---------------------------------------------------------------------------------------------

export interface SkylineMatch {
  /** Viewing direction of the image centre (azimuth, degrees). */
  headingDeg: number;
  /** Horizontal field of view (degrees). */
  fovDeg: number;
  /** Camera pitch (degrees, positive = up). */
  pitchDeg: number;
  /** Median absolute angular difference between skyline and terrain horizon (degrees). */
  errorDeg: number;
  /** 0..1: how well and how distinctly the skyline fits (0 = no information). */
  score: number;
}

/**
 * Columns that can stand for terrain: the sky boundary lies inside the frame and does not jump
 * (building edges, poles, trees standing against the sky produce near-vertical steps).
 */
export function terrainColumns(skyline: number[], imageAspect: number): boolean[] {
  const n = skyline.length;
  const ok = skyline.map((y) => Number.isFinite(y) && y > 0.01 && y < 0.97);
  // Slope in pixels per pixel: Δy (fraction of height) · H / (W / n).
  const slopeLimit = 0.9;
  const bad = new Array<boolean>(n).fill(false);
  for (let i = 0; i + 1 < n; i++) {
    const slope = (Math.abs((skyline[i + 1] as number) - (skyline[i] as number)) * n) / imageAspect;
    if (slope > slopeLimit) {
      for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 3); j++) bad[j] = true;
    }
  }
  return ok.map((v, i) => v && !bad[i]);
}

interface Hypothesis {
  heading: number;
  fov: number;
  pitch: number;
  error: number;
}

/** Exact evaluation of one (heading, fov) with the pitch solved by two fixed-point steps. */
function evaluate(
  cols: { u: number; y: number }[],
  aspect: number,
  profile: number[],
  heading: number,
  fov: number,
  pitchStart: number,
  buf: Float64Array,
): Hypothesis {
  let pitch = pitchStart;
  let error = Infinity;
  for (let iter = 0; iter < 3; iter++) {
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i] as { u: number; y: number };
      const ray = imageRay(c.u, c.y, aspect, fov, pitch);
      buf[i] = profileAt(profile, heading + ray.azOffDeg) - ray.elevDeg;
    }
    const shift = median(buf, cols.length);
    if (iter < 2) {
      pitch = Math.max(-35, Math.min(35, pitch + shift));
      continue;
    }
    for (let i = 0; i < cols.length; i++) buf[i] = Math.abs((buf[i] as number) - shift);
    error = median(buf, cols.length);
  }
  return { heading: ((heading % 360) + 360) % 360, fov, pitch, error };
}

/**
 * Finds heading, horizontal field of view and pitch under which the skyline of a frame best
 * agrees with a terrain horizon profile.
 * @param skyline per image column the normalised y of the sky boundary (0 = top)
 * @param imageAspect width / height of the frame
 * @param profile terrain horizon, elevation angle per azimuth (360 / step values from north)
 */
export function matchSkyline(
  skyline: number[],
  imageAspect: number,
  profile: number[],
  opts: { fovRange?: [number, number] } = {},
): SkylineMatch {
  const [fovMin, fovMax] = opts.fovRange ?? [45, 80];
  const n = skyline.length;
  const valid = terrainColumns(skyline, imageAspect);
  const cols: { u: number; y: number }[] = [];
  for (let i = 0; i < n; i++) if (valid[i]) cols.push({ u: (i + 0.5) / n, y: skyline[i] as number });
  const none: SkylineMatch = { headingDeg: 0, fovDeg: (fovMin + fovMax) / 2, pitchDeg: 0, errorDeg: 90, score: 0 };
  if (cols.length < Math.max(8, n * 0.15) || profile.length < 8) return none;

  const m = cols.length;
  const buf = new Float64Array(m);
  // The coarse search uses at most 64 evenly spread columns; the refinement uses all of them.
  const stride = Math.max(1, Math.ceil(m / 64));
  const coarseCols = cols.filter((_, i) => i % stride === 0);
  const mc = coarseCols.length;
  const azOff = new Float64Array(mc);
  const elev0 = new Float64Array(mc);

  // Coarse search: fov in 2° steps, heading in 1° steps, pitch as the median offset
  // (small-angle approximation: pitching shifts all elevations alike).
  const coarse: Hypothesis[] = [];
  let bestCurve: { fov: number; errors: Float64Array } | null = null;
  let bestCoarse = Infinity;
  const fovSteps = Math.max(1, Math.round((fovMax - fovMin) / 2));
  for (let s = 0; s <= fovSteps; s++) {
    const fov = fovMin + ((fovMax - fovMin) * s) / fovSteps;
    for (let i = 0; i < mc; i++) {
      const c = coarseCols[i] as { u: number; y: number };
      const ray = imageRay(c.u, c.y, imageAspect, fov, 0);
      azOff[i] = ray.azOffDeg;
      elev0[i] = ray.elevDeg;
    }
    const errors = new Float64Array(360);
    for (let h = 0; h < 360; h++) {
      for (let i = 0; i < mc; i++) buf[i] = profileAt(profile, h + (azOff[i] as number)) - (elev0[i] as number);
      const shift = median(buf, mc);
      for (let i = 0; i < mc; i++) buf[i] = Math.abs((buf[i] as number) - shift);
      const err = median(buf, mc);
      errors[h] = err;
      coarse.push({ heading: h, fov, pitch: Math.max(-35, Math.min(35, shift)), error: err });
      if (err < bestCoarse) {
        bestCoarse = err;
        bestCurve = { fov, errors };
      }
    }
  }
  coarse.sort((a, b) => a.error - b.error);

  // Refine the best few distinct hypotheses with the exact camera model.
  const seeds: Hypothesis[] = [];
  for (const h of coarse) {
    if (seeds.length >= 6) break;
    if (seeds.some((s) => Math.abs(((h.heading - s.heading + 540) % 360) - 180) < 4 && Math.abs(h.fov - s.fov) < 4)) continue;
    seeds.push(h);
  }
  let best: Hypothesis | null = null;
  for (const seed of seeds) {
    let local = evaluate(cols, imageAspect, profile, seed.heading, seed.fov, seed.pitch, buf);
    for (const [span, step] of [
      [2, 0.5],
      [0.5, 0.25],
    ] as const) {
      const centre = local;
      for (let dh = -span; dh <= span + 1e-9; dh += step) {
        for (let df = -span * 2; df <= span * 2 + 1e-9; df += step * 2) {
          const fov = centre.fov + df;
          if (fov < fovMin || fov > fovMax) continue;
          const cand = evaluate(cols, imageAspect, profile, centre.heading + dh, fov, centre.pitch, buf);
          if (cand.error < local.error) local = cand;
        }
      }
    }
    if (!best || local.error < best.error) best = local;
  }
  if (!best || !bestCurve) return none;

  // Distinctiveness: the best heading must stand out against the typical heading. Over flat
  // ground every heading fits about equally well; tiny typical errors carry no information, so
  // the comparison never goes below a floor.
  const sorted = Float64Array.from(bestCurve.errors).sort();
  const typical = sorted[180] as number;
  const distinct = Math.max(0, (typical - best.error) / Math.max(typical, MIN_TYPICAL_ERROR_DEG));
  const fit = 1 / (1 + (best.error / 0.75) ** 2);
  const coverage = Math.min(1, m / (n * 0.5));
  // Relief: the terrain horizon inside the matched view must rise and fall noticeably, otherwise
  // a flat skyline (roofs, a plain, the sea) fits any heading and says nothing about direction.
  const relief = profileRelief(profile, best.heading, best.fov);
  const reliefFactor = relief < MIN_RELIEF_DEG ? 0 : Math.min(1, relief / FULL_RELIEF_DEG);
  const score = Math.round(distinct * fit * coverage * reliefFactor * 1000) / 1000;
  return {
    headingDeg: Math.round(best.heading * 100) / 100,
    fovDeg: Math.round(best.fov * 100) / 100,
    pitchDeg: Math.round(best.pitch * 100) / 100,
    errorDeg: Math.round(best.error * 1000) / 1000,
    score,
  };
}

/**
 * Searches a square grid of `steps × steps` positions within ±radiusKm of a centre for the place
 * whose terrain horizon fits the skyline best (lowest error). Null when no elevation data covers
 * the area.
 */
export async function refinePosition(
  skyline: number[],
  imageAspect: number,
  center: GeoPoint,
  opts: { radiusKm?: number; steps?: number; horizonRadiusKm?: number; fovRange?: [number, number] } = {},
): Promise<{ point: GeoPoint; match: SkylineMatch } | null> {
  const radiusKm = opts.radiusKm ?? 2;
  const steps = Math.max(1, Math.round(opts.steps ?? 5));
  const horizonKm = opts.horizonRadiusKm ?? 15;
  const field = await loadHeightField(center, radiusKm + horizonKm + 0.5, Math.max(10, (horizonKm * 1000) / 500));
  if (!field || field.metresPerPixel > MAX_HORIZON_CELL_M) return null;
  let best: { point: GeoPoint; match: SkylineMatch } | null = null;
  for (let r = 0; r < steps; r++) {
    for (let c = 0; c < steps; c++) {
      // Each profile is some 80 ms of arithmetic; the 25 of a search would hold the node's only
      // thread for two seconds, and the console's requests with it.
      await new Promise((resolve) => setImmediate(resolve));
      const north = steps === 1 ? 0 : radiusKm * 1000 * (1 - (2 * r) / (steps - 1));
      const east = steps === 1 ? 0 : radiusKm * 1000 * (-1 + (2 * c) / (steps - 1));
      const point = offsetPoint(center, north, east);
      const profile = horizonProfileFromSampler(field.sample, point.lat, point.lon, {
        radiusKm: horizonKm,
        cellM: field.metresPerPixel,
      });
      if (!profile) continue;
      const match = matchSkyline(skyline, imageAspect, profile, opts.fovRange ? { fovRange: opts.fovRange } : {});
      if (match.score <= 0) continue;
      if (!best || match.errorDeg < best.match.errorDeg) best = { point, match };
    }
  }
  return best;
}
