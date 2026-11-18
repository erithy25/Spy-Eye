/**
 * Builds the offline base map of the console.
 *
 *   tsx src/scripts/map/extractTiles.ts
 *
 * Downloads OpenStreetMap vector tiles (OpenFreeMap, OpenMapTiles schema) and elevation tiles
 * (Mapzen Terrarium on AWS) for the configured areas once, reduces them to what the console
 * draws, derives contour lines from the elevation, and writes compact JSON tiles to
 * apps/web/public/map plus a place index for the server. At run time the console only reads
 * these local files; no map service is contacted.
 *
 * Map data © OpenStreetMap contributors (ODbL). Tile schema © OpenMapTiles (CC BY 4.0).
 * Elevation: Mapzen terrain tiles (SRTM, EU-DEM and others; see the Mapzen attribution list).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { repoRoot } from '../../config.js';
import { decodeTile, type MvtFeature, type MvtLayer } from './mvt.js';

interface Area {
  zooms: number[];
  /** west, south, east, north */
  bbox: [number, number, number, number];
}

const AREAS: Area[] = [
  { zooms: [5, 6, 7], bbox: [5.5, 47.0, 15.5, 55.2] },
  { zooms: [8], bbox: [5.8, 49.0, 10.2, 51.6] },
  { zooms: [9, 10], bbox: [6.3, 49.6, 8.6, 50.8] },
  { zooms: [11], bbox: [7.0, 50.15, 7.95, 50.6] },
  { zooms: [12, 13], bbox: [7.42, 50.28, 7.72, 50.44] },
  { zooms: [14], bbox: [7.52, 50.32, 7.66, 50.4] },
];

const EXTENT = 4096;
const OUT_DIR = path.join(repoRoot, 'apps', 'web', 'public', 'map');
const CACHE_DIR = path.join(repoRoot, '.cache', 'map');
const PLACES_FILE = path.join(repoRoot, 'apps', 'server', 'assets', 'places.json');

const lon2x = (lon: number, z: number): number => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat: number, z: number): number => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const x2lon = (x: number, z: number): number => (x / 2 ** z) * 360 - 180;
const y2lat = (y: number, z: number): number => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

async function cached(file: string, url: string): Promise<Buffer | null> {
  const target = path.join(CACHE_DIR, file);
  try {
    return await fs.readFile(target);
  } catch {
    // not cached yet
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'map-extract/1.0 (one-time offline extract)' } });
      if (response.status === 404 || response.status === 204) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes);
      return bytes;
    } catch (err: unknown) {
      if (attempt === 3) throw new Error(`${url}: ${err instanceof Error ? err.message : String(err)}`);
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
  return null;
}

// ------------------------------------------------------------------ geometry helpers

/** Douglas-Peucker on a flat [x0,y0,x1,y1,…] path. */
function simplify(path: number[], tolerance: number): number[] {
  const n = path.length / 2;
  if (n <= 2) return path;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number];
    const ax = path[a * 2] as number;
    const ay = path[a * 2 + 1] as number;
    const bx = path[b * 2] as number;
    const by = path[b * 2 + 1] as number;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstDist = tol2;
    for (let i = a + 1; i < b; i++) {
      const px = (path[i * 2] as number) - ax;
      const py = (path[i * 2 + 1] as number) - ay;
      let dist: number;
      if (len2 === 0) dist = px * px + py * py;
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        dist = (px - t * dx) ** 2 + (py - t * dy) ** 2;
      }
      if (dist > worstDist) {
        worstDist = dist;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(path[i * 2] as number, path[i * 2 + 1] as number);
  return out;
}

function ringArea(ring: number[]): number {
  let area = 0;
  for (let i = 0; i + 3 < ring.length; i += 2) {
    area += (ring[i] as number) * (ring[i + 3] as number) - (ring[i + 2] as number) * (ring[i + 1] as number);
  }
  return Math.abs(area) / 2;
}

/** Delta-encodes a path of integers: first vertex absolute, then differences. */
function pack(path: number[]): number[] {
  const out: number[] = [];
  let px = 0;
  let py = 0;
  for (let i = 0; i < path.length; i += 2) {
    const x = Math.round(path[i] as number);
    const y = Math.round(path[i + 1] as number);
    if (i > 0 && x === px && y === py) continue;
    out.push(x - px, y - py);
    px = x;
    py = y;
  }
  return out;
}

function lines(features: MvtFeature[], tolerance: number, minLength: number): number[][] {
  const out: number[][] = [];
  for (const f of features) {
    for (const g of f.geometry) {
      const s = simplify(g, tolerance);
      let length = 0;
      for (let i = 2; i < s.length; i += 2) {
        length += Math.hypot((s[i] as number) - (s[i - 2] as number), (s[i + 1] as number) - (s[i - 1] as number));
      }
      if (s.length >= 4 && length >= minLength) out.push(pack(s));
    }
  }
  return out;
}

function rings(features: MvtFeature[], tolerance: number, minArea: number): number[][] {
  const out: number[][] = [];
  for (const f of features) {
    for (const g of f.geometry) {
      if (ringArea(g) < minArea) continue;
      const s = simplify(g, tolerance);
      if (s.length >= 8) out.push(pack(s));
    }
  }
  return out;
}

// ------------------------------------------------------------------ contours

function contourInterval(z: number): number {
  if (z <= 9) return 100;
  if (z <= 11) return 50;
  if (z <= 13) return 20;
  return 10;
}

async function elevation(z: number, x: number, y: number): Promise<Float32Array | null> {
  const n = 2 ** z;
  if (y < 0 || y >= n) return null;
  const wrapped = ((x % n) + n) % n;
  const png = await cached(`terrain/${z}/${wrapped}/${y}.png`, `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${wrapped}/${y}.png`);
  if (!png) return null;
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== 256 || info.height !== 256) return null;
  const out = new Float32Array(256 * 256);
  for (let i = 0; i < 256 * 256; i++) {
    out[i] = (data[i * 3] as number) * 256 + (data[i * 3 + 1] as number) + (data[i * 3 + 2] as number) / 256 - 32768;
  }
  return out;
}

/** Elevation grid of one tile with a one-pixel border taken from its neighbours (258 x 258). */
async function paddedElevation(z: number, x: number, y: number): Promise<Float32Array | null> {
  const centre = await elevation(z, x, y);
  if (!centre) return null;
  const size = 258;
  const grid = new Float32Array(size * size);
  const neighbours = new Map<string, Float32Array | null>();
  const get = async (dx: number, dy: number): Promise<Float32Array | null> => {
    const key = `${dx},${dy}`;
    if (!neighbours.has(key)) neighbours.set(key, dx === 0 && dy === 0 ? centre : await elevation(z, x + dx, y + dy));
    return neighbours.get(key) ?? null;
  };
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      const px = gx - 1;
      const py = gy - 1;
      const dx = px < 0 ? -1 : px > 255 ? 1 : 0;
      const dy = py < 0 ? -1 : py > 255 ? 1 : 0;
      const tile = await get(dx, dy);
      if (tile) grid[gy * size + gx] = tile[(py - dy * 256) * 256 + (px - dx * 256)] as number;
      else grid[gy * size + gx] = centre[Math.min(255, Math.max(0, py)) * 256 + Math.min(255, Math.max(0, px))] as number;
    }
  }
  return grid;
}

/** Marching squares; returns polylines in tile units per elevation level. */
function contours(grid: Float32Array, interval: number): { h: number; l: number[] }[] {
  const size = 258;
  const unit = EXTENT / 256;
  // Grid index g is the centre of pixel g-1, i.e. tile coordinate (g - 0.5) * unit.
  const coord = (g: number): number => (g - 0.5) * unit;
  const segments = new Map<number, { a: string; b: string; ax: number; ay: number; bx: number; by: number }[]>();

  for (let j = 0; j < size - 1; j++) {
    for (let i = 0; i < size - 1; i++) {
      const v0 = grid[j * size + i] as number;
      const v1 = grid[j * size + i + 1] as number;
      const v2 = grid[(j + 1) * size + i + 1] as number;
      const v3 = grid[(j + 1) * size + i] as number;
      const lo = Math.min(v0, v1, v2, v3);
      const hi = Math.max(v0, v1, v2, v3);
      for (let h = Math.ceil(lo / interval) * interval; h <= hi; h += interval) {
        if (h === lo && h === hi) continue;
        // Shift exact hits so the level never passes exactly through a corner.
        const level = h + 1e-4;
        const idx = (v0 > level ? 1 : 0) | (v1 > level ? 2 : 0) | (v2 > level ? 4 : 0) | (v3 > level ? 8 : 0);
        if (idx === 0 || idx === 15) continue;
        const top = (): [string, number, number] => [`h${i},${j}`, coord(i + (level - v0) / (v1 - v0)), coord(j)];
        const right = (): [string, number, number] => [`v${i + 1},${j}`, coord(i + 1), coord(j + (level - v1) / (v2 - v1))];
        const bottom = (): [string, number, number] => [`h${i},${j + 1}`, coord(i + (level - v3) / (v2 - v3)), coord(j + 1)];
        const left = (): [string, number, number] => [`v${i},${j}`, coord(i), coord(j + (level - v0) / (v3 - v0))];
        const pairs: [[string, number, number], [string, number, number]][] = [];
        switch (idx) {
          case 1: case 14: pairs.push([left(), top()]); break;
          case 2: case 13: pairs.push([top(), right()]); break;
          case 3: case 12: pairs.push([left(), right()]); break;
          case 4: case 11: pairs.push([right(), bottom()]); break;
          case 6: case 9: pairs.push([top(), bottom()]); break;
          case 7: case 8: pairs.push([left(), bottom()]); break;
          case 5:
          case 10: {
            const centre = (v0 + v1 + v2 + v3) / 4 > level;
            if ((idx === 5) === centre) pairs.push([left(), bottom()], [top(), right()]);
            else pairs.push([left(), top()], [right(), bottom()]);
            break;
          }
        }
        let list = segments.get(h);
        if (!list) {
          list = [];
          segments.set(h, list);
        }
        for (const [p, q] of pairs) list.push({ a: p[0], b: q[0], ax: p[1], ay: p[2], bx: q[1], by: q[2] });
      }
    }
  }

  const out: { h: number; l: number[] }[] = [];
  for (const [h, list] of segments) {
    // Chain segments that share an edge crossing.
    const byPoint = new Map<string, number[]>();
    list.forEach((s, n) => {
      for (const key of [s.a, s.b]) {
        const arr = byPoint.get(key);
        if (arr) arr.push(n);
        else byPoint.set(key, [n]);
      }
    });
    const used = new Uint8Array(list.length);
    const extend = (line: number[], key: string, forward: boolean): void => {
      let current = key;
      for (;;) {
        const next = (byPoint.get(current) ?? []).find((n) => !used[n]);
        if (next === undefined) return;
        used[next] = 1;
        const s = list[next] as (typeof list)[number];
        const fromA = s.a === current;
        const x = fromA ? s.bx : s.ax;
        const y = fromA ? s.by : s.ay;
        if (forward) line.push(x, y);
        else line.unshift(x, y);
        current = fromA ? s.b : s.a;
      }
    };
    for (let n = 0; n < list.length; n++) {
      if (used[n]) continue;
      used[n] = 1;
      const s = list[n] as (typeof list)[number];
      const line = [s.ax, s.ay, s.bx, s.by];
      extend(line, s.b, true);
      extend(line, s.a, false);
      const simple = simplify(line, 3);
      let length = 0;
      for (let i = 2; i < simple.length; i += 2) {
        length += Math.hypot((simple[i] as number) - (simple[i - 2] as number), (simple[i + 1] as number) - (simple[i - 1] as number));
      }
      if (length >= 120) out.push({ h, l: pack(simple) });
    }
  }
  return out;
}

// ------------------------------------------------------------------ tile conversion

const ROAD_CLASS: Record<string, string> = {
  motorway: 'm',
  trunk: 't',
  primary: 'p',
  secondary: 's',
  tertiary: 'e',
  minor: 'n',
  service: 'n',
  rail: 'r',
};
const PLACE_RANK: Record<string, number> = { city: 1, town: 2, village: 3, suburb: 4, quarter: 5, hamlet: 5, neighbourhood: 6 };

interface PlaceOut {
  n: string;
  c: string;
  r: number;
  p: [number, number];
}

interface TileOut {
  water?: number[][];
  urban?: number[][];
  wood?: number[][];
  bld?: number[][];
  ww?: Record<string, { n?: string; l: number[] }[]>;
  rd?: Record<string, number[][]>;
  br?: number[][];
  bd?: Record<string, number[][]>;
  pl?: PlaceOut[];
  pk?: { n: string; h: number; p: [number, number] }[];
  poi?: { k: string; n: string; p: [number, number] }[];
  ct?: { h: number; l: number[] }[];
}

const nameOf = (f: MvtFeature): string => String(f.properties['name:de'] ?? f.properties['name'] ?? f.properties['name:latin'] ?? '').trim();

function convert(layers: Map<string, MvtLayer>, z: number): TileOut {
  const out: TileOut = {};
  const scale = (layer: MvtLayer | undefined): number => (layer ? EXTENT / layer.extent : 1);
  const rescale = (layer: MvtLayer): MvtFeature[] => {
    const k = scale(layer);
    if (k === 1) return layer.features;
    return layer.features.map((f) => ({ ...f, geometry: f.geometry.map((g) => g.map((v) => v * k)) }));
  };
  const tolerance = z >= 14 ? 3 : 5;

  const water = layers.get('water');
  if (water) {
    const r = rings(rescale(water).filter((f) => f.type === 3), tolerance, 400);
    if (r.length > 0) out.water = r;
  }

  const landuse = layers.get('landuse');
  if (landuse && z <= 13) {
    const urban = rescale(landuse).filter(
      (f) => f.type === 3 && ['residential', 'commercial', 'industrial', 'retail'].includes(String(f.properties['class'])),
    );
    const r = rings(urban, 8, z >= 12 ? 1500 : 3000);
    if (r.length > 0) out.urban = r;
  }

  const landcover = layers.get('landcover');
  if (landcover && z >= 9) {
    const wood = rescale(landcover).filter((f) => f.type === 3 && String(f.properties['class']) === 'wood');
    const r = rings(wood, 10, 6000);
    if (r.length > 0) out.wood = r;
  }

  const building = layers.get('building');
  if (building && z >= 13) {
    const r = rings(rescale(building).filter((f) => f.type === 3), 2, z >= 14 ? 60 : 200);
    if (r.length > 0) out.bld = r;
  }

  const waterway = layers.get('waterway');
  if (waterway) {
    const groups: Record<string, { n?: string; l: number[] }[]> = {};
    for (const f of rescale(waterway)) {
      if (f.type !== 2) continue;
      const cls = String(f.properties['class']);
      const key = cls === 'river' ? 'r' : cls === 'canal' ? 'c' : 's';
      if (key === 's' && z < 12) continue;
      for (const g of f.geometry) {
        const s = simplify(g, tolerance);
        if (s.length < 4) continue;
        const name = nameOf(f);
        (groups[key] ??= []).push(name && key !== 's' ? { n: name, l: pack(s) } : { l: pack(s) });
      }
    }
    if (Object.keys(groups).length > 0) out.ww = groups;
  }

  const transportation = layers.get('transportation');
  if (transportation) {
    const groups: Record<string, MvtFeature[]> = {};
    const bridges: MvtFeature[] = [];
    for (const f of rescale(transportation)) {
      if (f.type !== 2) continue;
      const key = ROAD_CLASS[String(f.properties['class'])];
      if (!key) continue;
      if (key === 'n' && z < 13) continue;
      if (key === 'e' && z < 11) continue;
      if (key === 'r' && (z < 9 || String(f.properties['subclass'] ?? 'rail') !== 'rail')) continue;
      if (String(f.properties['brunnel']) === 'tunnel') continue;
      (groups[key] ??= []).push(f);
      if (String(f.properties['brunnel']) === 'bridge' && key !== 'n' && z >= 11) bridges.push(f);
    }
    const rd: Record<string, number[][]> = {};
    for (const [key, features] of Object.entries(groups)) {
      const l = lines(features, tolerance, key === 'n' ? 40 : 20);
      if (l.length > 0) rd[key] = l;
    }
    if (Object.keys(rd).length > 0) out.rd = rd;
    const br = lines(bridges, 2, 10);
    if (br.length > 0) out.br = br;
  }

  const boundary = layers.get('boundary');
  if (boundary) {
    const bd: Record<string, number[][]> = {};
    for (const level of [2, 4, 6]) {
      if (level === 6 && z < 9) continue;
      const features = rescale(boundary).filter(
        (f) => f.type === 2 && Number(f.properties['admin_level']) === level && Number(f.properties['maritime'] ?? 0) !== 1,
      );
      const l = lines(features, tolerance, 30);
      if (l.length > 0) bd[String(level)] = l;
    }
    if (Object.keys(bd).length > 0) out.bd = bd;
  }

  const place = layers.get('place');
  if (place) {
    const k = scale(place);
    const pl: PlaceOut[] = [];
    for (const f of place.features) {
      const cls = String(f.properties['class']);
      const rank = PLACE_RANK[cls];
      const name = nameOf(f);
      const point = f.geometry[0];
      if (!rank || !name || !point) continue;
      const x = Math.round((point[0] as number) * k);
      const y = Math.round((point[1] as number) * k);
      if (x < 0 || y < 0 || x >= EXTENT || y >= EXTENT) continue;
      pl.push({ n: name, c: cls, r: Number(f.properties['rank'] ?? 10) + rank * 10, p: [x, y] });
    }
    if (pl.length > 0) out.pl = pl;
  }

  const peaks = layers.get('mountain_peak');
  if (peaks && z >= 11) {
    const k = scale(peaks);
    const pk: NonNullable<TileOut['pk']> = [];
    for (const f of peaks.features) {
      const point = f.geometry[0];
      const name = nameOf(f);
      const ele = Number(f.properties['ele'] ?? NaN);
      if (!point || !name || !Number.isFinite(ele)) continue;
      const x = Math.round((point[0] as number) * k);
      const y = Math.round((point[1] as number) * k);
      if (x < 0 || y < 0 || x >= EXTENT || y >= EXTENT) continue;
      pk.push({ n: name, h: Math.round(ele), p: [x, y] });
    }
    if (pk.length > 0) out.pk = pk;
  }

  const poi = layers.get('poi');
  if (poi && z >= 13) {
    const k = scale(poi);
    const kinds: Record<string, string> = { hospital: 'h', fire_station: 'f', police: 'p' };
    const list: NonNullable<TileOut['poi']> = [];
    for (const f of poi.features) {
      const kind = kinds[String(f.properties['subclass'])] ?? kinds[String(f.properties['class'])];
      const point = f.geometry[0];
      if (!kind || !point) continue;
      const x = Math.round((point[0] as number) * k);
      const y = Math.round((point[1] as number) * k);
      if (x < 0 || y < 0 || x >= EXTENT || y >= EXTENT) continue;
      list.push({ k: kind, n: nameOf(f), p: [x, y] });
    }
    if (list.length > 0) out.poi = list;
  }
  return out;
}

// ------------------------------------------------------------------ main

async function main(): Promise<void> {
  const tilejson = JSON.parse((await cached('tilejson.json', 'https://tiles.openfreemap.org/planet'))?.toString('utf8') ?? '{}') as { tiles?: string[] };
  const template = tilejson.tiles?.[0];
  if (!template) throw new Error('Could not read the OpenFreeMap tile URL');
  const version = /planet\/([^/]+)\//.exec(template)?.[1] ?? 'planet';

  await fs.rm(OUT_DIR, { recursive: true, force: true });
  const manifest: { minZoom: number; maxZoom: number; extent: number; tiles: Record<string, [number, number][]>; attribution: string; source: string } = {
    minZoom: 5,
    maxZoom: 14,
    extent: EXTENT,
    tiles: {},
    attribution: '© OpenStreetMap-Mitwirkende (ODbL) · OpenMapTiles · Höhendaten: Mapzen Terrain Tiles',
    source: `OpenFreeMap ${version}`,
  };
  const places = new Map<string, { name: string; lat: number; lon: number; rank: number }>();
  const sizes: Record<number, number> = {};
  let count = 0;

  for (const area of AREAS) {
    for (const z of area.zooms) {
      const [w, s, e, n] = area.bbox;
      const x0 = Math.floor(lon2x(w, z));
      const x1 = Math.floor(lon2x(e, z));
      const y0 = Math.floor(lat2y(n, z));
      const y1 = Math.floor(lat2y(s, z));
      const list: [number, number][] = [];
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const url = template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
          const bytes = await cached(`osm/${version}/${z}/${x}/${y}.pbf`, url);
          if (!bytes || bytes.length === 0) continue;
          const tile = convert(decodeTile(bytes), z);
          if (z >= 9) {
            const grid = await paddedElevation(z, x, y);
            if (grid) {
              const ct = contours(grid, contourInterval(z));
              if (ct.length > 0) tile.ct = ct;
            }
          }
          for (const p of tile.pl ?? []) {
            const lon = x2lon(x + p.p[0] / EXTENT, z);
            const lat = y2lat(y + p.p[1] / EXTENT, z);
            const key = `${p.n}|${lat.toFixed(2)}|${lon.toFixed(2)}`;
            const rank = PLACE_RANK[p.c] ?? 6;
            const existing = places.get(key);
            if (!existing || rank < existing.rank) {
              places.set(key, { name: p.n, lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, rank });
            }
          }
          const json = JSON.stringify(tile);
          const file = path.join(OUT_DIR, String(z), String(x), `${y}.json`);
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, json);
          sizes[z] = (sizes[z] ?? 0) + json.length;
          list.push([x, y]);
          count++;
        }
      }
      manifest.tiles[String(z)] = (manifest.tiles[String(z)] ?? []).concat(list);
      process.stdout.write(`z${z}: ${list.length} tiles, ${((sizes[z] ?? 0) / 1e6).toFixed(2)} MB\n`);
    }
  }
  await fs.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest));
  // Places inside the detailed areas are enough for naming incidents.
  const index = [...places.values()].filter((p) => p.lon >= 6.3 && p.lon <= 8.6 && p.lat >= 49.6 && p.lat <= 50.8);
  await fs.mkdir(path.dirname(PLACES_FILE), { recursive: true });
  await fs.writeFile(PLACES_FILE, JSON.stringify(index));
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  process.stdout.write(`${count} tiles, ${(total / 1e6).toFixed(1)} MB; ${index.length} places indexed\n`);
}

await main();
process.exit(0);
