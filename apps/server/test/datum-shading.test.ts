import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { estimateLight, sunAgreement, type LightEstimate } from '../src/datum/shading.js';
import { encodeSpaceGrid } from '../src/datum/space.js';

const DEG = Math.PI / 180;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'datum-shading-'));

type V3 = [number, number, number];

interface Box {
  /** Centre of the footprint (world x, z), size (x, height, z), yaw about the vertical axis (deg), base albedo. */
  cx: number;
  cz: number;
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  albedo: number;
}

interface Light {
  /** Relative azimuth (clockwise from forward, seen from above) and elevation of the sun, degrees. */
  az: number;
  el: number;
  /** Direct / ambient irradiance; 0 = diffuse only. */
  direct: number;
}

const EYE = 1.6;
/** Amplitude of the smooth relative depth error of the synthetic grids. */
const DEPTH_ERROR = Number(process.env.DEPTH_ERROR ?? 0.006);
const FOV = 62;

/** Street-like scene: blocks and walls at several orientations on flat ground. */
const SCENE: Box[] = [
  { cx: -6, cz: -18, sx: 6, sy: 8, sz: 6, yaw: 20, albedo: 0.45 },
  { cx: 7, cz: -24, sx: 8, sy: 10, sz: 5, yaw: -35, albedo: 0.4 },
  { cx: 0, cz: -42, sx: 10, sy: 6, sz: 8, yaw: 60, albedo: 0.5 },
  { cx: -15, cz: -34, sx: 5, sy: 12, sz: 5, yaw: 0, albedo: 0.35 },
  { cx: 11, cz: -11, sx: 3, sy: 3, sz: 3, yaw: 45, albedo: 0.55 },
  { cx: 4, cz: -62, sx: 30, sy: 7, sz: 1, yaw: 10, albedo: 0.4 },
  { cx: -3, cz: -9, sx: 1.2, sy: 2.2, sz: 1.2, yaw: 15, albedo: 0.5 },
];

/** Deterministic value noise in [-1, 1] from a quantised position. */
function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(Math.floor(x) | 0, 73856093) ^ Math.imul(Math.floor(y) | 0, 19349663) ^ Math.imul(Math.floor(z) | 0, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

interface Hit {
  t: number;
  n: V3;
  albedo: number;
}

/** Ray against an upright, yawed box (slab test in the box frame). */
function hitBox(o: V3, d: V3, b: Box): Hit | null {
  const c = Math.cos(b.yaw * DEG);
  const s = Math.sin(b.yaw * DEG);
  // World → box frame (rotation about y by −yaw).
  const ox = c * (o[0] - b.cx) - s * (o[2] - b.cz);
  const oz = s * (o[0] - b.cx) + c * (o[2] - b.cz);
  const oy = o[1] + EYE - b.sy / 2;
  const dx = c * d[0] - s * d[2];
  const dz = s * d[0] + c * d[2];
  const dy = d[1];
  const half = [b.sx / 2, b.sy / 2, b.sz / 2];
  const oo = [ox, oy, oz];
  const dd = [dx, dy, dz];
  let tmin = -Infinity;
  let tmax = Infinity;
  let axis = -1;
  let sign = 1;
  for (let k = 0; k < 3; k++) {
    const dk = dd[k] as number;
    const ok = oo[k] as number;
    const hk = half[k] as number;
    if (Math.abs(dk) < 1e-12) {
      if (Math.abs(ok) > hk) return null;
      continue;
    }
    let t1 = (-hk - ok) / dk;
    let t2 = (hk - ok) / dk;
    let sg = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      sg = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      axis = k;
      sign = sg;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmin <= 1e-4 || axis < 0) return null;
  // Local normal → world (rotation about y by +yaw).
  const nl: V3 = [0, 0, 0];
  nl[axis] = sign;
  const n: V3 = [c * nl[0] + s * nl[2], nl[1], -s * nl[0] + c * nl[2]];
  return { t: tmin, n, albedo: b.albedo };
}

function trace(o: V3, d: V3, boxes: Box[]): Hit | null {
  let best: Hit | null = null;
  for (const b of boxes) {
    const h = hitBox(o, d, b);
    if (h && (!best || h.t < best.t)) best = h;
  }
  if (d[1] < -1e-6) {
    const t = (-EYE - o[1]) / d[1];
    if (t > 0 && t < 400 && (!best || t < best.t)) best = { t, n: [0, 1, 0], albedo: 0.3 };
  }
  return best;
}

/** Renders the scene for a camera pitched by `pitchDeg`; returns the DSG1 grid and a JPEG. */
async function render(light: Light, opts: { pitchDeg?: number; gw?: number; gh?: number; boxes?: Box[] } = {}): Promise<{ grid: Buffer; jpeg: string }> {
  const gw = opts.gw ?? 192;
  const gh = opts.gh ?? 108;
  const boxes = opts.boxes ?? SCENE;
  const pitch = (opts.pitchDeg ?? -4) * DEG;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const camToWorld = (v: V3): V3 => [v[0], cp * v[1] - sp * v[2], sp * v[1] + cp * v[2]];
  const ce = Math.cos(light.el * DEG);
  const L: V3 = [Math.sin(light.az * DEG) * ce, Math.sin(light.el * DEG), -Math.cos(light.az * DEG) * ce];
  const origin: V3 = [0, 0, 0];
  const ray = (u: number, v: number, w: number, h: number): V3 => {
    const f = w / 2 / Math.tan((FOV * DEG) / 2);
    const c: V3 = [(u - w / 2) / f, -(v - h / 2) / f, -1];
    const l = Math.hypot(c[0], c[1], c[2]);
    return camToWorld([c[0] / l, c[1] / l, c[2] / l]);
  };
  // Grid: distance along the ray through each cell centre, with a smooth depth error of up to
  // about 2 % (a monocular depth network errs smoothly, not cell by cell).
  const n = gw * gh;
  const distance = new Float32Array(n);
  const sky = new Uint8Array(n);
  let near = Infinity;
  for (let r = 0; r < gh; r++) {
    for (let c = 0; c < gw; c++) {
      const i = r * gw + c;
      const hit = trace(origin, ray(c + 0.5, r + 0.5, gw, gh), boxes);
      if (!hit) {
        sky[i] = 1;
        distance[i] = 2000;
        continue;
      }
      const noise = 1 + DEPTH_ERROR * (Math.sin(c / 9 + 1.3) * Math.cos(r / 7 + 0.4) + 0.5 * Math.sin((c + 2 * r) / 5));
      distance[i] = Math.min(1999, hit.t * noise);
      near = Math.min(near, distance[i] as number);
    }
  }
  const grid = encodeSpaceGrid({ width: gw, height: gh, fovDeg: FOV, near, far: 2000, distance, sky });
  // Image at twice the grid resolution.
  const w = gw * 2;
  const h = gh * 2;
  const rgb = Buffer.alloc(w * h * 3);
  const ambient = 1;
  const enc = (x: number): number => {
    const v = Math.max(0, Math.min(1, x));
    const s = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.round(s * 255);
  };
  const exposure = 0.75 / (0.6 * (ambient + light.direct));
  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      const d = ray(u + 0.5, v + 0.5, w, h);
      const hit = trace(origin, d, boxes);
      const o = (v * w + u) * 3;
      if (!hit) {
        rgb[o] = 150;
        rgb[o + 1] = 190;
        rgb[o + 2] = 240;
        continue;
      }
      const p: V3 = [d[0] * hit.t, d[1] * hit.t, d[2] * hit.t];
      // Texture: lognormal albedo noise on 0.4 m cells plus finer grain.
      const tex = Math.exp(0.22 * hash3(p[0] / 0.4, p[1] / 0.4, p[2] / 0.4) + 0.08 * hash3(p[0] / 0.1, p[1] / 0.1, p[2] / 0.1));
      const albedo = hit.albedo * tex;
      // Sky light on the upper hemisphere of the normal, light reflected from the (partly
      // sunlit) ground (albedo 0.3) on the lower one.
      const bounce = 0.3 * ambient * (1 + light.direct * Math.sin(light.el * DEG));
      let e = 0.5 * (1 + hit.n[1]) * ambient + 0.5 * (1 - hit.n[1]) * bounce;
      const ndl = hit.n[0] * L[0] + hit.n[1] * L[1] + hit.n[2] * L[2];
      if (light.direct > 0 && ndl > 0) {
        const q: V3 = [p[0] + hit.n[0] * 1e-3, p[1] + hit.n[1] * 1e-3, p[2] + hit.n[2] * 1e-3];
        const blocked = boxes.some((b) => hitBox(q, L, b) !== null);
        if (!blocked) e += light.direct * ndl;
      }
      const lin = albedo * e * exposure;
      rgb[o] = enc(lin * 1.02);
      rgb[o + 1] = enc(lin);
      rgb[o + 2] = enc(lin * 0.95);
    }
  }
  const jpeg = path.join(tmp, `scene-${light.az}-${light.el}-${light.direct}-${opts.pitchDeg ?? -4}.jpg`);
  writeFileSync(jpeg, await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 88 }).toBuffer());
  return { grid, jpeg };
}

const azErr = (a: number, b: number): number => Math.abs(((((a - b + 180) % 360) + 360) % 360) - 180);

const SUNNY: Array<{ az: number; el: number; pitchDeg?: number }> = [
  { az: 50, el: 35 },
  { az: -110, el: 45 },
  { az: 150, el: 25 },
  { az: -40, el: 55 },
  { az: 95, el: 20 },
  { az: -160, el: 40 },
  { az: 20, el: 30, pitchDeg: 2 },
  { az: -75, el: 30, pitchDeg: -10 },
];

test('recovers a known sun direction in synthetic sunlit scenes', async () => {
  const rows: string[] = [];
  let withinTen = 0;
  for (const c of SUNNY) {
    const { grid, jpeg } = await render({ az: c.az, el: c.el, direct: 3 }, c.pitchDeg === undefined ? {} : { pitchDeg: c.pitchDeg });
    const t0 = performance.now();
    const est = (await estimateLight(jpeg, grid)) as LightEstimate;
    const ms = performance.now() - t0;
    assert.ok(est, 'estimate expected');
    rows.push(
      `truth az ${c.az} el ${c.el} → az ${est.relAzimuthDeg} el ${est.elevationDeg} [${est.elevationBandDeg.join('–')}] ` +
        `conf ${est.confidence} ${est.method} R² ${est.explained} K ${est.directRatio} pitch ${est.pitchDeg} ${ms.toFixed(0)} ms`,
    );
    assert.equal(est.sunlit, true, rows.at(-1));
    assert.ok(azErr(est.relAzimuthDeg, c.az) <= 20, `azimuth: ${rows.at(-1)}`);
    // With the sun ahead the elevation comes only from shadow lengths and tends to come out low.
    assert.ok(Math.abs(est.elevationDeg - c.el) <= 15, `elevation: ${rows.at(-1)}`);
    if (Math.abs(est.elevationDeg - c.el) <= 10) withinTen++;
    assert.ok(est.confidence >= 0.1 && est.confidence <= 0.35, `confidence: ${rows.at(-1)}`);
    if (c.pitchDeg !== undefined) assert.ok(Math.abs((est.pitchDeg ?? 0) - c.pitchDeg) <= 1.5, `pitch: ${rows.at(-1)}`);
    assert.ok(est.notes.length >= 1 && est.notes.length <= 3);
  }
  console.log(rows.join('\n'));
  assert.ok(withinTen >= 6, `elevation within 10° in ${withinTen} of ${SUNNY.length} cases`);
});

test('reports diffuse light as not sunlit', async () => {
  const { grid, jpeg } = await render({ az: 0, el: 45, direct: 0 });
  const est = (await estimateLight(jpeg, grid)) as LightEstimate;
  assert.ok(est);
  console.log(`diffuse → sunlit ${est.sunlit} R² ${est.explained} conf ${est.confidence} az ${est.relAzimuthDeg}`);
  assert.equal(est.sunlit, false);
  assert.ok(est.confidence <= 0.1);
  assert.match(est.notes[0] ?? '', /Diffuses Licht/);
});

test('rejects malformed input and agrees with matching sun positions', async () => {
  const { jpeg } = await render({ az: 0, el: 45, direct: 0 }, { gw: 32, gh: 18 });
  assert.equal(await estimateLight(jpeg, Buffer.from('nonsense')), null);
  const est: LightEstimate = {
    relAzimuthDeg: 60,
    elevationDeg: 30,
    elevationBandDeg: [20, 40],
    azimuthSpreadDeg: 15,
    confidence: 0.6,
    method: 'both',
    sunlit: true,
    notes: [],
    residual: 0.2,
    explained: 0.4,
    directRatio: 3,
    samples: 1000,
    pitchDeg: 0,
  };
  // Camera looking south (180°): the sun 60° to the right stands in the south-west (240°).
  assert.ok(sunAgreement(est, 180, { azimuthDeg: 240, elevationDeg: 30 }) > 0.95);
  assert.ok(sunAgreement(est, 180, { azimuthDeg: 120, elevationDeg: 30 }) < 0.05);
  assert.ok(sunAgreement(est, 180, { azimuthDeg: 240, elevationDeg: 70 }) < 0.05);
});
