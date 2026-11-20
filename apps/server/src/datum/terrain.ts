/**
 * Elevation from Mapzen Terrarium tiles stored on this node (256 × 256 PNG, Web Mercator):
 *   height (m) = R · 256 + G + B / 256 − 32768
 *
 * Tiles are read from `DATUM_TERRAIN_DIR` (default `<repo>/datasets/datum/terrain/{z}/{x}/{y}.png`)
 * and, where a tile is missing there, from the map cache `<repo>/.cache/map/terrain/{z}/{x}/{y}.png`.
 * Decoded tiles are kept in a small in-memory LRU. Nothing is fetched from the network.
 */
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { repoRoot } from '../config.js';
import type { GeoPoint, TerrainGrid } from './contract.js';

const TILE = 256;
const MAX_ZOOM = 15;
const EARTH_RADIUS = 6_371_008.8;
/** Metres per pixel at the equator for zoom 0 (Web Mercator, 256 px tiles). */
const EQUATOR_M_PER_PX = (2 * Math.PI * 6_378_137) / TILE;

export function terrainDirs(): string[] {
  const primary = process.env['DATUM_TERRAIN_DIR']?.trim();
  return [
    primary !== undefined && primary !== '' ? path.resolve(repoRoot, primary) : path.join(repoRoot, 'datasets', 'datum', 'terrain'),
    path.join(repoRoot, '.cache', 'map', 'terrain'),
  ];
}

// ---------------------------------------------------------------------------------------------
// Tile cache
// ---------------------------------------------------------------------------------------------

const LRU_CAPACITY = 192; // 192 × 256 KiB ≈ 48 MiB of decoded heights
const tiles = new Map<string, Float32Array>();
const pending = new Map<string, Promise<Float32Array | null>>();
/** Files known to exist (path) or not (null), per tile key; refreshed after a minute. */
const located = new Map<string, { file: string | null; at: number }>();
const LOCATE_TTL_MS = 60_000;

function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

async function locateTile(z: number, x: number, y: number): Promise<string | null> {
  const key = tileKey(z, x, y);
  const known = located.get(key);
  if (known && Date.now() - known.at < LOCATE_TTL_MS) return known.file;
  let file: string | null = null;
  for (const dir of terrainDirs()) {
    const candidate = path.join(dir, String(z), String(x), `${y}.png`);
    try {
      await access(candidate);
      file = candidate;
      break;
    } catch {
      // not in this directory
    }
  }
  located.set(key, { file, at: Date.now() });
  if (located.size > 20_000) located.clear();
  return file;
}

async function decodeTile(file: string): Promise<Float32Array | null> {
  try {
    const bytes = await readFile(file);
    const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== TILE || info.height !== TILE || info.channels < 3) return null;
    const out = new Float32Array(TILE * TILE);
    const ch = info.channels;
    for (let i = 0; i < out.length; i++) {
      out[i] = (data[i * ch] as number) * 256 + (data[i * ch + 1] as number) + (data[i * ch + 2] as number) / 256 - 32768;
    }
    return out;
  } catch {
    // Unreadable or still being written: treat as missing, try again later.
    return null;
  }
}

/** Decoded heights of a tile (row-major, 256 × 256), or null when the tile is not on disk. */
export async function loadTile(z: number, x: number, y: number): Promise<Float32Array | null> {
  const n = 2 ** z;
  if (y < 0 || y >= n) return null;
  x = ((x % n) + n) % n;
  const key = tileKey(z, x, y);
  const hit = tiles.get(key);
  if (hit) {
    tiles.delete(key);
    tiles.set(key, hit);
    return hit;
  }
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const job = (async () => {
    const file = await locateTile(z, x, y);
    if (file === null) return null;
    const heights = await decodeTile(file);
    if (heights === null) {
      located.delete(key);
      return null;
    }
    tiles.set(key, heights);
    while (tiles.size > LRU_CAPACITY) {
      const oldest = tiles.keys().next();
      if (oldest.done) break;
      tiles.delete(oldest.value);
    }
    return heights;
  })().finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

// ---------------------------------------------------------------------------------------------
// Web Mercator
// ---------------------------------------------------------------------------------------------

/** Global pixel coordinates (tile pixels at zoom z) of a point. */
export function lonLatToPixel(lon: number, lat: number, z: number): { px: number; py: number } {
  const scale = TILE * 2 ** z;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const phi = (clamped * Math.PI) / 180;
  const px = ((lon + 180) / 360) * scale;
  const py = ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * scale;
  return { px, py };
}

function metresPerPixel(lat: number, z: number): number {
  return (EQUATOR_M_PER_PX * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

/** Offsets a point by metres north / east (local tangent plane; fine for tens of kilometres). */
export function offsetPoint(p: GeoPoint, northM: number, eastM: number): GeoPoint {
  const lat = p.lat + (northM / EARTH_RADIUS) * (180 / Math.PI);
  const lon = p.lon + (eastM / (EARTH_RADIUS * Math.cos((p.lat * Math.PI) / 180))) * (180 / Math.PI);
  return { lat, lon };
}

// ---------------------------------------------------------------------------------------------
// Height field: a mosaic of tiles at one zoom, sampled synchronously
// ---------------------------------------------------------------------------------------------

/** Synchronous elevation sampler; null where no data. */
export type HeightSampler = (lat: number, lon: number) => number | null;

export interface HeightField {
  zoom: number;
  /** Share of the requested tiles that were found (0..1). */
  coverage: number;
  /** Ground resolution of the source (m per pixel) at the field's centre. */
  metresPerPixel: number;
  sample: HeightSampler;
}

/** Tiles (x range, y range) covering a bounding box at zoom z. */
function tileRange(
  bbox: [number, number, number, number],
  z: number,
): { x0: number; x1: number; y0: number; y1: number } {
  const [w, s, e, n] = bbox;
  const a = lonLatToPixel(w, n, z);
  const b = lonLatToPixel(e, s, z);
  // One pixel of margin for the bilinear neighbours.
  return {
    x0: Math.floor((a.px - 1) / TILE),
    x1: Math.floor((b.px + 1) / TILE),
    y0: Math.floor((a.py - 1) / TILE),
    y1: Math.floor((b.py + 1) / TILE),
  };
}

async function coverageAt(bbox: [number, number, number, number], z: number): Promise<number> {
  const r = tileRange(bbox, z);
  const count = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  if (count > 4096) return 0;
  let found = 0;
  const n = 2 ** z;
  const checks: Promise<void>[] = [];
  for (let x = r.x0; x <= r.x1; x++) {
    for (let y = r.y0; y <= r.y1; y++) {
      checks.push(
        locateTile(z, ((x % n) + n) % n, y).then((f) => {
          if (f !== null) found++;
        }),
      );
    }
  }
  await Promise.all(checks);
  return found / count;
}

function bboxAround(center: GeoPoint, radiusKm: number): [number, number, number, number] {
  const sw = offsetPoint(center, -radiusKm * 1000, -radiusKm * 1000);
  const ne = offsetPoint(center, radiusKm * 1000, radiusKm * 1000);
  return [sw.lon, sw.lat, ne.lon, ne.lat];
}

/**
 * Chooses the zoom for an area: the coarsest zoom whose pixels are at most `targetMPerPx`, or
 * the finest one present if none is that fine; zooms that cover less of the area are skipped.
 * Returns null when no zoom has any tile of the area.
 */
async function chooseZoom(
  bbox: [number, number, number, number],
  targetMPerPx: number,
  maxTiles = 256,
): Promise<{ zoom: number; coverage: number } | null> {
  const lat = (bbox[1] + bbox[3]) / 2;
  const found: { zoom: number; coverage: number }[] = [];
  for (let z = MAX_ZOOM; z >= 0; z--) {
    const r = tileRange(bbox, z);
    if ((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) > maxTiles) continue;
    const coverage = await coverageAt(bbox, z);
    if (coverage > 0) found.push({ zoom: z, coverage });
  }
  if (found.length === 0) return null;
  const best = Math.max(...found.map((f) => f.coverage));
  // Prefer complete coverage; accept a finer zoom only when it covers (almost) as much.
  const usable = found.filter((f) => f.coverage >= best - 0.02);
  const fineEnough = usable.filter((f) => metresPerPixel(lat, f.zoom) <= targetMPerPx);
  if (fineEnough.length > 0) return fineEnough[fineEnough.length - 1] as { zoom: number; coverage: number };
  return usable[0] as { zoom: number; coverage: number };
}

/**
 * Loads the tiles of an area into a height field. `resolutionM` is the sample spacing the caller
 * needs; the coarsest zoom that is at least that fine is used (fewer tiles to decode).
 */
export async function loadHeightField(
  center: GeoPoint,
  radiusKm: number,
  resolutionM: number,
): Promise<HeightField | null> {
  const bbox = bboxAround(center, radiusKm);
  const choice = await chooseZoom(bbox, resolutionM);
  if (choice === null) return null;
  const z = choice.zoom;
  const r = tileRange(bbox, z);
  const cols = r.x1 - r.x0 + 1;
  const rows = r.y1 - r.y0 + 1;
  const mosaicW = cols * TILE;
  const mosaicH = rows * TILE;
  const mosaic = new Float32Array(mosaicW * mosaicH).fill(Number.NaN);
  const jobs: Promise<void>[] = [];
  for (let tx = r.x0; tx <= r.x1; tx++) {
    for (let ty = r.y0; ty <= r.y1; ty++) {
      jobs.push(
        loadTile(z, tx, ty).then((heights) => {
          if (!heights) return;
          const ox = (tx - r.x0) * TILE;
          const oy = (ty - r.y0) * TILE;
          for (let row = 0; row < TILE; row++) {
            mosaic.set(heights.subarray(row * TILE, row * TILE + TILE), (oy + row) * mosaicW + ox);
          }
        }),
      );
    }
  }
  await Promise.all(jobs);
  const originX = r.x0 * TILE;
  const originY = r.y0 * TILE;
  const sample: HeightSampler = (lat, lon) => {
    const { px, py } = lonLatToPixel(lon, lat, z);
    // Pixel centres sit at +0.5.
    const fx = px - originX - 0.5;
    const fy = py - originY - 0.5;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    if (ix < 0 || iy < 0 || ix + 1 >= mosaicW || iy + 1 >= mosaicH) return null;
    const tx = fx - ix;
    const ty = fy - iy;
    const i = iy * mosaicW + ix;
    const h00 = mosaic[i] as number;
    const h10 = mosaic[i + 1] as number;
    const h01 = mosaic[i + mosaicW] as number;
    const h11 = mosaic[i + mosaicW + 1] as number;
    const v = (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
    return Number.isNaN(v) ? null : v;
  };
  return { zoom: z, coverage: choice.coverage, metresPerPixel: metresPerPixel(center.lat, z), sample };
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/** Finest zoom with a tile at the point, or null when no elevation data covers it. */
export async function terrainAvailable(lat: number, lon: number): Promise<number | null> {
  for (let z = MAX_ZOOM; z >= 0; z--) {
    const { px, py } = lonLatToPixel(lon, lat, z);
    if ((await locateTile(z, Math.floor(px / TILE) % 2 ** z, Math.floor(py / TILE))) !== null) return z;
  }
  return null;
}

/** Terrain height (m above sea level) at a point from the finest tile present; null if none. */
export async function heightAt(lat: number, lon: number): Promise<number | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (let z = MAX_ZOOM; z >= 0; z--) {
    const { px, py } = lonLatToPixel(lon, lat, z);
    const n = 2 ** z;
    const fx = px - 0.5;
    const fy = py - 0.5;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = fx - ix;
    const ty = fy - iy;
    const corners: number[] = [];
    let ok = true;
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      const gx = ix + dx;
      const gy = Math.min(n * TILE - 1, Math.max(0, iy + dy));
      const tileX = Math.floor(gx / TILE);
      const tileY = Math.floor(gy / TILE);
      const heights = await loadTile(z, ((tileX % n) + n) % n, tileY);
      if (!heights) {
        ok = false;
        break;
      }
      corners.push(heights[(gy - tileY * TILE) * TILE + (gx - tileX * TILE)] as number);
    }
    if (!ok) continue;
    const [h00, h10, h01, h11] = corners as [number, number, number, number];
    return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
  }
  return null;
}

/**
 * Elevation sources coarser than this (metres per pixel) say nothing about the local relief: the
 * world overview at zoom 4 (about 9 km per pixel) where no finer tile was fetched. The same limit
 * as the horizon's (horizon.ts MAX_HORIZON_CELL_M): a grid from such a source is `coarse`.
 */
export const COARSE_SOURCE_M = 200;

/** A pit this far below its neighbourhood's median (m), and a spike this far above it, is an error of the source. */
const PIT_M = 60;
const SPIKE_M = 150;
/** ... unless the neighbourhood itself varies that much (multiples of its median absolute deviation). */
const PIT_MAD = 4;
const SPIKE_MAD = 6;

/**
 * Replaces isolated pits and spikes of the elevation source by the median of their 5 × 5
 * neighbourhood, in place; returns how many cells it changed. The tiles have holes of several
 * hundred metres on some coasts (Busan: one 2 × 2 pit of −400 m among 0 to 60 m, the finer zoom
 * reads 3 m there), which set the relief range shown and a crater in the 3D terrain. A cell counts
 * as such only where it lies more than PIT_M below (SPIKE_M above) the median of the 25 around it
 * and more than PIT_MAD (SPIKE_MAD) times their median absolute deviation: steep valleys and
 * summits vary as much around them and stay. Every test reads the heights as they came, so a
 * cluster of up to 2 × 2 bad cells is found as a whole.
 */
export function despike(heights: number[], size: number): number {
  const src = Float64Array.from(heights);
  const w = size + 1;
  // Summed heights, to screen every cell against its window's mean in constant time.
  const sums = new Float64Array(w * w);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) sums[(r + 1) * w + c + 1] = (src[r * size + c] as number) + (sums[r * w + c + 1] as number) + (sums[(r + 1) * w + c] as number) - (sums[r * w + c] as number);
  }
  let changed = 0;
  const window: number[] = [];
  for (let r = 0; r < size; r++) {
    const r0 = Math.max(0, r - 2);
    const r1 = Math.min(size - 1, r + 2);
    for (let c = 0; c < size; c++) {
      const c0 = Math.max(0, c - 2);
      const c1 = Math.min(size - 1, c + 2);
      const n = (r1 - r0 + 1) * (c1 - c0 + 1);
      const sum = (sums[(r1 + 1) * w + c1 + 1] as number) - (sums[r0 * w + c1 + 1] as number) - (sums[(r1 + 1) * w + c0] as number) + (sums[r0 * w + c0] as number);
      const v = src[r * size + c] as number;
      // The bad cells pull the mean towards them: a loose screen, the median decides.
      const mean = sum / n;
      if (v > mean - PIT_M / 2 && v < mean + SPIKE_M / 2) continue;
      window.length = 0;
      for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) window.push(src[rr * size + cc] as number);
      window.sort((a, b) => a - b);
      const median = window[Math.floor(window.length / 2)] as number;
      const deviations = window.map((x) => Math.abs(x - median)).sort((a, b) => a - b);
      const mad = deviations[Math.floor(deviations.length / 2)] as number;
      if (v < median - Math.max(PIT_M, PIT_MAD * mad) || v > median + Math.max(SPIKE_M, SPIKE_MAD * mad)) {
        heights[r * size + c] = median;
        changed++;
      }
    }
  }
  return changed;
}

/**
 * Regular grid of heights around a centre (`size` × `size` samples over 2 · radiusKm, row-major
 * from the north-west corner), from the zoom that best matches the sample spacing. Null when no
 * tile covers the area. Samples without data take the nearest valid height of their row/column
 * neighbourhood (or the minimum), so the grid is always complete; isolated pits and spikes of the
 * source are smoothed out (despike), and the range is that of the cleaned grid. `coarse` says that
 * the finest source here is coarser than COARSE_SOURCE_M (the world overview): the grid is then an
 * interpolated plate, no outline of the terrain.
 */
export async function terrainGrid(center: GeoPoint, radiusKm: number, size = 129): Promise<TerrainGrid | null> {
  size = Math.max(2, Math.min(1025, Math.round(size)));
  const cellMetres = (2 * radiusKm * 1000) / (size - 1);
  const field = await loadHeightField(center, radiusKm, cellMetres);
  if (!field) return null;
  const heights = new Array<number>(size * size);
  const half = radiusKm * 1000;
  let min = Infinity;
  let max = -Infinity;
  let missing = 0;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const p = offsetPoint(center, half - row * cellMetres, -half + col * cellMetres);
      const h = field.sample(p.lat, p.lon);
      if (h === null) {
        heights[row * size + col] = Number.NaN;
        missing++;
        continue;
      }
      heights[row * size + col] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  if (!Number.isFinite(min)) return null;
  if (missing > 0) fillMissing(heights, size, min);
  if (despike(heights, size) > 0) {
    min = Infinity;
    max = -Infinity;
    for (const h of heights) {
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  const sw = offsetPoint(center, -half, -half);
  const ne = offsetPoint(center, half, half);
  return {
    center: { lat: center.lat, lon: center.lon },
    bbox: [sw.lon, sw.lat, ne.lon, ne.lat],
    size,
    heights: heights.map((h) => Math.round(h * 10) / 10),
    minHeight: Math.round(min * 10) / 10,
    maxHeight: Math.round(max * 10) / 10,
    cellMetres,
    sourceZoom: field.zoom,
    sourceMetres: Math.round(field.metresPerPixel * 10) / 10,
    coarse: field.metresPerPixel > COARSE_SOURCE_M,
  };
}

/** Fills NaN samples by repeated averaging of valid neighbours (a few sweeps), else `fallback`. */
function fillMissing(h: number[], size: number, fallback: number): void {
  for (let sweep = 0; sweep < 16; sweep++) {
    let left = 0;
    for (let i = 0; i < h.length; i++) {
      if (!Number.isNaN(h[i] as number)) continue;
      const r = Math.floor(i / size);
      const c = i % size;
      let sum = 0;
      let n = 0;
      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const v = h[rr * size + cc] as number;
        if (!Number.isNaN(v)) {
          sum += v;
          n++;
        }
      }
      if (n > 0) h[i] = sum / n;
      else left++;
    }
    if (left === 0) return;
  }
  for (let i = 0; i < h.length; i++) if (Number.isNaN(h[i] as number)) h[i] = fallback;
}
