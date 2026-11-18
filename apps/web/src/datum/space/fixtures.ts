/**
 * Synthetic data for the development harness: a ray-traced street scene with its DSG1 grid (both
 * from the same scene, so picture and geometry agree), a hilly terrain grid, the sun's path over a
 * day, the terrain horizon around the camera and the skyline the video would show.
 *
 * Development only; nothing here is used by the console itself.
 */

import type { SunPathPoint, TerrainGrid } from '../../../../server/src/datum/contract';
import { encodeSpaceGrid, vec3, type SpaceGrid, type Vec3 } from './gl';

/* ------------------------------------------------------------------ noise */

function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * (valueNoise(x * f, y * f) * 2 - 1);
    f *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

/* -------------------------------------------------------------------- sun */

/** Low-precision solar position (about 0.1°): azimuth from north clockwise, elevation. */
export function solarPosition(epochMs: number, lat: number, lon: number): { az: number; el: number } {
  const rad = Math.PI / 180;
  const d = epochMs / 86_400_000 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = ((gmst + lon / 15) * 15) * rad - ra;
  const phi = lat * rad;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { az: ((az / rad) % 360 + 360) % 360, el: el / rad };
}

export function sunPath(dateUtcMidnight: number, lat: number, lon: number): SunPathPoint[] {
  const start = dateUtcMidnight - (lon / 15) * 3_600_000;
  const out: SunPathPoint[] = [];
  for (let i = 0; i <= 144; i++) {
    const t = start + i * 600_000;
    const p = solarPosition(t, lat, lon);
    out.push({ t, az: p.az, el: p.el });
  }
  return out;
}

/* ---------------------------------------------------------------- terrain */

export function makeTerrain(lat: number, lon: number, size = 181, cell = 30): TerrainGrid {
  const half = ((size - 1) / 2) * cell;
  const gauss = (x: number, z: number, s: number): number => Math.exp(-(x * x + z * z) / (2 * s * s));
  const heights: number[] = [];
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = -half + i * cell; // east
      const z = -half + j * cell; // south (row 0 is the north edge)
      let h = 560;
      h += 330 * gauss(x - 1500, z + 1500, 620);
      h += 420 * gauss(x + 1800, z - 1500, 760);
      h += 260 * gauss(x - 700, z - 2100, 480);
      h += 240 * gauss(x + 2100, z + 1900, 650);
      h += 150 * Math.exp(-(((x * 0.8 + z * 0.6 - 1900) / 480) ** 2));
      h -= 60 * Math.exp(-(((x - 750) / 420) ** 2)) * (1 - gauss(x, z + 2400, 900));
      h += 55 * fbm(x / 900 + 3.1, z / 900 - 1.7, 5);
      h += 6 * fbm(x / 240, z / 240, 2);
      // The camera stands on a low, flat rise above the valley.
      h += 45 * Math.exp(-(((x * x + z * z) / (2 * 260 * 260)) ** 2));
      heights.push(Math.round(h * 10) / 10);
      minHeight = Math.min(minHeight, h);
      maxHeight = Math.max(maxHeight, h);
    }
  }
  const dLat = half / 110_540;
  const dLon = half / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    center: { lat, lon },
    bbox: [lon - dLon, lat - dLat, lon + dLon, lat + dLat],
    size,
    heights,
    minHeight,
    maxHeight,
    cellMetres: cell,
    sourceZoom: 12,
  };
}

function terrainHeight(t: TerrainGrid, x: number, z: number): number | null {
  const half = ((t.size - 1) / 2) * t.cellMetres;
  const gx = (x + half) / t.cellMetres;
  const gz = (z + half) / t.cellMetres;
  if (gx < 0 || gz < 0 || gx > t.size - 1 || gz > t.size - 1) return null;
  const i = Math.min(t.size - 2, Math.floor(gx));
  const j = Math.min(t.size - 2, Math.floor(gz));
  const fx = gx - i;
  const fz = gz - j;
  const at = (a: number, b: number): number => t.heights[b * t.size + a] ?? 0;
  return (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fz) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fz;
}

/** Terrain horizon around the centre: elevation angle for azimuth 0..359. */
export function horizonProfile(t: TerrainGrid, eyeHeight = 1.7): number[] {
  const h0 = (terrainHeight(t, 0, 0) ?? 0) + eyeHeight;
  const out: number[] = [];
  for (let az = 0; az < 360; az++) {
    const a = (az * Math.PI) / 180;
    const dx = Math.sin(a);
    const dz = -Math.cos(a);
    let best = -10;
    for (let r = t.cellMetres; ; r += t.cellMetres / 2) {
      const h = terrainHeight(t, dx * r, dz * r);
      if (h === null) break;
      best = Math.max(best, (Math.atan2(h - h0, r) * 180) / Math.PI);
    }
    out.push(Math.round(best * 100) / 100);
  }
  return out;
}

function profileAt(profile: number[], az: number): number {
  const a = ((az % 360) + 360) % 360;
  const i = Math.floor(a);
  const f = a - i;
  return (profile[i % 360] ?? 0) * (1 - f) + (profile[(i + 1) % 360] ?? 0) * f;
}

/**
 * The skyline a camera with this heading, field of view, aspect and pitch (degrees, positive =
 * up) would see: per column the normalised y of the topmost terrain point. Uses the camera model
 * of the server's skyline match (horizon.ts `imageRay`) and its column centres (c + 0.5) / n; with
 * a pitched camera a column does not hold one azimuth, so each column is searched from the top.
 */
export function skylineFromProfile(profile: number[], headingDeg: number, hfovDeg: number, aspect = 16 / 9, columns = 160, pitchDeg = 0): number[] {
  const rad = Math.PI / 180;
  const f = 0.5 / Math.tan((hfovDeg / 2) * rad);
  const sp = Math.sin(pitchDeg * rad);
  const cp = Math.cos(pitchDeg * rad);
  // Elevation of the ray through (u, y) above the terrain horizon in its direction.
  const above = (u: number, y: number): number => {
    const X = (u - 0.5) / f;
    const Y = (y - 0.5) / (aspect * f);
    const forward = Y * sp + cp;
    const up = sp - Y * cp;
    const az = headingDeg + Math.atan2(X, forward) / rad;
    return Math.atan2(up, Math.hypot(X, forward)) / rad - profileAt(profile, az);
  };
  const out: number[] = [];
  for (let c = 0; c < columns; c++) {
    const u = (c + 0.5) / columns;
    let y = 1;
    const steps = 200;
    for (let r = 1; r <= steps; r++) {
      if (above(u, r / steps) > 0) continue;
      let lo = (r - 1) / steps;
      let hi = r / steps;
      for (let k = 0; k < 20; k++) {
        const mid = (lo + hi) / 2;
        if (above(u, mid) > 0) lo = mid;
        else hi = mid;
      }
      y = hi;
      break;
    }
    if (above(u, 0) <= 0) y = 0;
    out.push(Math.max(0, Math.min(1, y + (hash(c, 7) - 0.5) * 0.004)));
  }
  return out;
}

/* ----------------------------------------------------------- street scene */

type Material = 'beige' | 'grey' | 'blue' | 'brick' | 'car' | 'glass' | 'pole' | 'shelter';

interface Box {
  min: Vec3;
  max: Vec3;
  mat: Material;
}

const GROUND = -1.6;

const BOXES: Box[] = [
  { min: [-16, GROUND, -42], max: [-5.6, 17, -7], mat: 'beige' },
  { min: [-19, GROUND, -78], max: [-6.2, 11, -44], mat: 'grey' },
  { min: [5.6, GROUND, -24], max: [14, 12.5, -5], mat: 'blue' },
  { min: [6.6, GROUND, -60], max: [16, 24, -28], mat: 'brick' },
  { min: [2.3, GROUND + 0.25, -15.2], max: [4.1, -0.35, -10.6], mat: 'car' },
  { min: [2.45, -0.35, -14.2], max: [3.95, 0.3, -11.3], mat: 'glass' },
  { min: [-4.95, GROUND, -12.1], max: [-4.75, 4.6, -11.9], mat: 'pole' },
  { min: [-4.95, GROUND, -31.1], max: [-4.75, 4.6, -30.9], mat: 'pole' },
  { min: [4.75, GROUND, -36.1], max: [4.95, 4.6, -35.9], mat: 'pole' },
  { min: [-5.4, GROUND, -21.5], max: [-4.4, 0.9, -18.5], mat: 'shelter' },
];

const ALBEDO: Record<Material, Vec3> = {
  beige: [0.8, 0.71, 0.57],
  grey: [0.6, 0.6, 0.6],
  blue: [0.58, 0.64, 0.72],
  brick: [0.62, 0.36, 0.28],
  car: [0.5, 0.08, 0.07],
  glass: [0.12, 0.14, 0.17],
  pole: [0.24, 0.25, 0.26],
  shelter: [0.35, 0.38, 0.4],
};

interface Hit {
  t: number;
  normal: Vec3;
  box: Box | null;
}

function hitBox(o: Vec3, d: Vec3, b: Box): Hit | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  let axis = 0;
  for (let a = 0; a < 3; a++) {
    const inv = 1 / (d[a] as number);
    let t0 = ((b.min[a] as number) - (o[a] as number)) * inv;
    let t1 = ((b.max[a] as number) - (o[a] as number)) * inv;
    if (t0 > t1) [t0, t1] = [t1, t0];
    if (t0 > tmin) {
      tmin = t0;
      axis = a;
    }
    tmax = Math.min(tmax, t1);
    if (tmax < tmin) return null;
  }
  if (tmin <= 1e-4) return null;
  const normal: Vec3 = [0, 0, 0];
  normal[axis] = (d[axis] as number) > 0 ? -1 : 1;
  return { t: tmin, normal, box: b };
}

function traceScene(o: Vec3, d: Vec3): Hit | null {
  let best: Hit | null = null;
  for (const b of BOXES) {
    const h = hitBox(o, d, b);
    if (h && (!best || h.t < best.t)) best = h;
  }
  if (d[1] < -1e-6) {
    const t = (GROUND - o[1]) / d[1];
    if (t > 0 && (!best || t < best.t)) best = { t, normal: [0, 1, 0], box: null };
  }
  return best;
}

function facade(mat: Material, s: number, y: number, base: Vec3): Vec3 {
  if (mat === 'car' || mat === 'glass' || mat === 'pole' || mat === 'shelter') return base;
  const floor = 3.3;
  const level = y - GROUND;
  const f = level % floor;
  const col = ((s % 2.8) + 2.8) % 2.8;
  let c: Vec3 = [...base];
  const grain = 0.94 + 0.06 * valueNoise(s * 3, y * 3);
  c = vec3.scale(c, grain);
  if (level < 3.6) {
    // Ground floor: wide shop windows.
    const shop = ((s % 6) + 6) % 6;
    if (level > 0.5 && level < 3.0 && shop > 0.6 && shop < 5.4) {
      const r = 0.14 + 0.08 * (level / 3);
      return [r * 0.85, r * 0.95, r * 1.1];
    }
    return vec3.scale(c, 0.82);
  }
  if (f < 0.18) return vec3.scale(c, 0.78);
  if (f > 0.95 && f < 2.55 && col > 0.75 && col < 2.05) {
    const frame = f < 1.03 || f > 2.47 || col < 0.83 || col > 1.97 || Math.abs(col - 1.4) < 0.03;
    if (frame) return [0.86, 0.86, 0.84];
    const refl = 0.12 + 0.1 * (1 - (f - 0.95) / 1.6) + 0.05 * hash(Math.floor(s / 2.8), Math.floor(level / floor));
    return [refl * 0.9, refl, refl * 1.12];
  }
  return c;
}

function groundColour(x: number, z: number): Vec3 {
  const ax = Math.abs(x);
  const n = valueNoise(x * 4, z * 4) * 0.5 + valueNoise(x * 19, z * 19) * 0.5;
  if (ax < 4.2) {
    let g = 0.2 + 0.05 * n;
    if (ax < 0.07 && ((-z % 6) + 6) % 6 < 3) g = 0.82;
    if (Math.abs(ax - 3.75) < 0.06) g = 0.78;
    if (z < -17 && z > -20.5 && ((x + 10) % 1.1 + 1.1) % 1.1 < 0.55) g = 0.8;
    return [g, g, g * 1.02];
  }
  if (ax < 4.35) return [0.72, 0.72, 0.7];
  const tx = ((x % 0.6) + 0.6) % 0.6;
  const tz = ((z % 0.6) + 0.6) % 0.6;
  const seam = tx < 0.025 || tz < 0.025 ? 0.82 : 1;
  const g = (0.5 + 0.06 * n) * seam;
  return [g * 1.02, g, g * 0.96];
}

export interface StreetScene {
  imageUrl: string;
  gridUrl: string;
  headingDeg: number;
  fovDeg: number;
  /** Pitch the camera was held at (degrees, positive = up); the grid's rays are the pitched ones. */
  pitchDeg: number;
  sun: { azimuthDeg: number; elevationDeg: number };
  width: number;
  height: number;
}

/**
 * Renders the street and its grid. The camera looks along -z at eye height 1.6 m, pitched by
 * `pitchDeg` as a hand-held phone is; mountains far behind follow the terrain horizon in the
 * direction of view, so both viewers tell one story. Like a DSG1 grid from the server, the grid
 * holds distances along the rays of the pitched camera.
 */
export async function makeStreetScene(options: {
  headingDeg: number;
  sun: { azimuthDeg: number; elevationDeg: number };
  profile: number[];
  fovDeg?: number;
  pitchDeg?: number;
  width?: number;
  height?: number;
  gridWidth?: number;
  gridHeight?: number;
  far?: number;
}): Promise<StreetScene> {
  const fov = options.fovDeg ?? 72;
  const W = options.width ?? 1280;
  const H = options.height ?? 720;
  const gw = options.gridWidth ?? 256;
  const gh = options.gridHeight ?? 144;
  const far = options.far ?? 110;
  const tx = Math.tan(((fov / 2) * Math.PI) / 180);
  const ty = tx / (W / H);
  const L = vec3.fromAzEl(options.sun.azimuthDeg - options.headingDeg, options.sun.elevationDeg);
  const MOUNTAIN = 1600;

  const classify = (dir: Vec3): { kind: 'hit'; hit: Hit } | { kind: 'mountain'; el: number } | { kind: 'sky' } => {
    const hit = traceScene([0, 0, 0], dir);
    if (hit && hit.t < MOUNTAIN) return { kind: 'hit', hit };
    const azRel = (Math.atan2(dir[0], -dir[2]) * 180) / Math.PI;
    const elev = (Math.asin(dir[1]) * 180) / Math.PI;
    const mountain = profileAt(options.profile, options.headingDeg + azRel) + 0.6;
    if (elev < mountain) return { kind: 'mountain', el: elev / Math.max(0.5, mountain) };
    return { kind: 'sky' };
  };

  // Camera-frame ray turned about x by the pitch into the level world frame (contract.ts,
  // `Keyframe.pitchDeg`).
  const pitchDeg = options.pitchDeg ?? 0;
  const cp = Math.cos((pitchDeg * Math.PI) / 180);
  const sp = Math.sin((pitchDeg * Math.PI) / 180);
  const rayDir = (u: number, v: number): Vec3 => {
    const [x, y, z] = vec3.normalize([(2 * u - 1) * tx, (1 - 2 * v) * ty, -1]);
    return [x, y * cp - z * sp, y * sp + z * cp];
  };

  // Picture.
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  const img = ctx.createImageData(W, H);
  for (let py = 0; py < H; py++) {
    if (py % 90 === 0) await new Promise((r) => setTimeout(r, 0));
    for (let px = 0; px < W; px++) {
      const dir = rayDir((px + 0.5) / W, (py + 0.5) / H);
      const c = classify(dir);
      let col: Vec3;
      if (c.kind === 'sky') {
        const e = Math.max(0, dir[1]);
        col = vec3.lerp([0.86, 0.9, 0.95], [0.42, 0.58, 0.82], Math.min(1, e * 2.4));
      } else if (c.kind === 'mountain') {
        const shade = 0.55 + 0.15 * valueNoise(px / 40, py / 30) + 0.12 * c.el;
        col = vec3.lerp([0.62, 0.68, 0.76], [0.5, 0.56, 0.66], c.el);
        col = vec3.scale(col, shade + 0.25);
      } else {
        const { hit } = c;
        const p = vec3.scale(dir, hit.t);
        let albedo: Vec3;
        if (!hit.box) albedo = groundColour(p[0], p[2]);
        else if (hit.normal[1] > 0.5) albedo = vec3.scale(ALBEDO[hit.box.mat], 0.7);
        else albedo = facade(hit.box.mat, hit.normal[0] !== 0 ? p[2] : p[0], p[1], ALBEDO[hit.box.mat]);
        const lambert = Math.max(0, vec3.dot(hit.normal, L));
        const shadow = lambert > 0 && traceScene(vec3.add(p, vec3.scale(hit.normal, 0.01)), L) !== null;
        const light = 0.42 + 0.95 * lambert * (shadow ? 0 : 1);
        col = vec3.scale(albedo, light);
        // Air between the camera and distant surfaces.
        const haze = Math.min(0.55, hit.t / 260);
        col = vec3.lerp(col, [0.78, 0.83, 0.9], haze);
      }
      const o = (py * W + px) * 4;
      img.data[o] = Math.min(255, col[0] * 255);
      img.data[o + 1] = Math.min(255, col[1] * 255);
      img.data[o + 2] = Math.min(255, col[2] * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.92));

  // Grid: rays through (i / (w - 1), j / (h - 1)), exactly as the viewer casts them.
  const distance = new Float32Array(gw * gh);
  const sky = new Uint8Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const k = j * gw + i;
      const c = classify(rayDir(i / (gw - 1), j / (gh - 1)));
      if (c.kind === 'sky') {
        sky[k] = 1;
        distance[k] = far;
      } else if (c.kind === 'mountain') distance[k] = far;
      else {
        // A depth estimator is never exact: a little multiplicative noise.
        const noise = 1 + (hash(i * 1.3, j * 0.7) - 0.5) * 0.005;
        distance[k] = Math.min(far, c.hit.t * noise);
      }
    }
  }
  const grid: SpaceGrid = { width: gw, height: gh, fovDeg: fov, near: 0.5, far, distance, sky };
  const gridBlob = new Blob([encodeSpaceGrid(grid)], { type: 'application/octet-stream' });

  return {
    imageUrl: URL.createObjectURL(blob),
    gridUrl: URL.createObjectURL(gridBlob),
    headingDeg: options.headingDeg,
    fovDeg: fov,
    pitchDeg,
    sun: options.sun,
    width: W,
    height: H,
  };
}

/* ---------------------------------------------------------------- bundle */

export interface Fixtures {
  street: StreetScene;
  terrain: TerrainGrid;
  camera: { lat: number; lon: number; headingDeg: number; fovDeg: number; pitchDeg: number; aspect: number };
  sun: { azimuthDeg: number; elevationDeg: number };
  sunPath: SunPathPoint[];
  horizonProfile: number[];
  skyline: number[];
}

export async function makeFixtures(): Promise<Fixtures> {
  const lat = 47.4921;
  const lon = 11.0956;
  const fovDeg = 72;
  const terrain = makeTerrain(lat, lon);
  const profile = horizonProfile(terrain);
  const path = sunPath(Date.UTC(2026, 9, 14), lat, lon);
  // The determined time: afternoon, the sun about 14° high; the camera looks 24° left of it.
  const noon = path.reduce((a, b) => (b.el > a.el ? b : a));
  let at = noon;
  for (const p of path) if (p.t > noon.t && Math.abs(p.el - 14) < Math.abs(at.el - 14)) at = p;
  const sun = { azimuthDeg: at.az, elevationDeg: at.el };
  const headingDeg = Math.round(at.az - 24);
  // Held a little downwards, as phones usually are: the space and the skyline must be levelled.
  const pitchDeg = -8;
  const aspect = 16 / 9;
  const street = await makeStreetScene({ headingDeg, sun, profile, fovDeg, pitchDeg });
  return {
    street,
    terrain,
    camera: { lat, lon, headingDeg, fovDeg, pitchDeg, aspect },
    sun,
    sunPath: path,
    horizonProfile: profile,
    skyline: skylineFromProfile(profile, headingDeg, fovDeg, aspect, 160, pitchDeg),
  };
}
