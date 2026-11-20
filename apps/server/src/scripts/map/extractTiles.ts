/**
 * Builds the offline base map of the console.
 *
 *   tsx src/scripts/map/extractTiles.ts                  map tiles + country shapes + cities
 *   tsx src/scripts/map/extractTiles.ts --only=countries country shapes and cities only
 *   tsx src/scripts/map/extractTiles.ts --budget-mb=42   size allowed for the DATUM detail tiles (default 42)
 *   tsx src/scripts/map/extractTiles.ts --core-km=1      fixed zoom-13 radius instead of fitting the budget
 *
 * Downloads OpenStreetMap vector tiles (OpenFreeMap, OpenMapTiles schema) and elevation tiles
 * (Mapzen Terrarium on AWS) for the configured areas once, reduces them to what the console
 * draws, derives contour lines from the elevation, and writes compact JSON tiles to
 * apps/web/public/map plus a place index for the server. At run time the console only reads
 * these local files; no map service is contacted.
 *
 * Areas: the whole world at zooms 0-4 (land/water, borders, major roads, countries and big
 * cities), the Koblenz operations area at zooms 5-14, and the DATUM test regions of
 * datasets/datum/regions.json (written by src/scripts/datum/fetchTerrain.ts) at zooms 10-14.
 * The full DATUM extract is zooms 10-13 on each region box (±6 km) and zoom 14 on ±2 km around
 * each test location; when that exceeds the budget, the zoom-13 radius is reduced (and with it,
 * as a pyramid, zooms 14, 12 and 11; see regionAreas) until it fits. Zoom 10 always covers the
 * whole region box. Where detail is missing the console draws the nearest coarser tile.
 *
 * Country shapes and cities come from Natural Earth (public domain): 1:50m admin-0 countries,
 * simplified, and 1:10m populated places (>= 50 000 inhabitants and all capitals). They are
 * written to apps/server/assets/datum/{countries,cities}.json; the country shapes are also
 * copied to apps/web/public/map/countries.json.
 *
 * Map data © OpenStreetMap contributors (ODbL). Tile schema © OpenMapTiles (CC BY 4.0).
 * Elevation: Mapzen terrain tiles (SRTM, EU-DEM and others; see the Mapzen attribution list).
 * Country shapes and populated places: Natural Earth (public domain).
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

/** Whole world: Web Mercator stops at ±85.0511°. */
const WORLD: Area = { zooms: [0, 1, 2, 3, 4], bbox: [-180, -85.0511, 180, 85.0511] };

/** Koblenz operations area. */
const AREAS: Area[] = [
  { zooms: [5, 6, 7], bbox: [5.5, 47.0, 15.5, 55.2] },
  { zooms: [8], bbox: [5.8, 49.0, 10.2, 51.6] },
  { zooms: [9, 10], bbox: [6.3, 49.6, 8.6, 50.8] },
  { zooms: [11], bbox: [7.0, 50.15, 7.95, 50.6] },
  { zooms: [12, 13], bbox: [7.42, 50.28, 7.72, 50.44] },
  { zooms: [14], bbox: [7.52, 50.32, 7.66, 50.4] },
];

/** DATUM region box around each test location (km either side), as in regions.json. */
const REGION_KM = 6;
/** At most this much zoom 14 around each DATUM test location (km either side). */
const REGION_CORE_KM = 2;
/** Size the DATUM detail tiles may add to apps/web/public/map (MB); the zoom-13 radius is reduced to fit. */
const DATUM_BUDGET_MB = 42;
/** Zoom-13 radii (km) tried from the full extract downwards until the DATUM tiles fit the budget. */
const CORE_LADDER = [6, 5, 4, 3, 2.5, 2, 1.5, 1.2, 1, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2];

const EXTENT = 4096;
const OUT_DIR = path.join(repoRoot, 'apps', 'web', 'public', 'map');
const CACHE_DIR = path.join(repoRoot, '.cache', 'map');
const PLACES_FILE = path.join(repoRoot, 'apps', 'server', 'assets', 'places.json');
const REGIONS_FILE = path.join(repoRoot, 'datasets', 'datum', 'regions.json');
/** Elevation tiles fetched for DATUM (src/scripts/datum/fetchTerrain.ts); reused when present. */
const DATUM_TERRAIN_DIR = path.join(repoRoot, 'datasets', 'datum', 'terrain');
const DATUM_ASSETS = path.join(repoRoot, 'apps', 'server', 'assets', 'datum');
const NATURAL_EARTH = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';

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

const terrariumUrl = (z: number, x: number, y: number): string => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

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
  const png =
    (await fs.readFile(path.join(DATUM_TERRAIN_DIR, String(z), String(wrapped), `${y}.png`)).catch(() => null)) ??
    (await cached(`terrain/${z}/${wrapped}/${y}.png`, terrariumUrl(z, wrapped, y)));
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
const PLACE_RANK: Record<string, number> = { country: 0, city: 1, town: 2, village: 3, suburb: 4, quarter: 5, hamlet: 5, neighbourhood: 6 };
/** Country labels are kept on the small scales only. */
const COUNTRY_MAX_ZOOM = 7;
/** On the world zooms only the biggest cities are kept: OpenMapTiles rank <= this, or national capitals from zoom 3. */
const WORLD_CITY_RANK: Record<number, number> = { 0: 0, 1: 0, 2: 1, 3: 2, 4: 3 };

interface PlaceOut {
  n: string;
  /** English name (`name:en`, else the local `name`) where it differs from `n`. */
  e?: string;
  c: string;
  r: number;
  p: [number, number];
}

interface TileOut {
  water?: number[][];
  urban?: number[][];
  wood?: number[][];
  bld?: number[][];
  ww?: Record<string, { n?: string; e?: string; l: number[] }[]>;
  rd?: Record<string, number[][]>;
  br?: number[][];
  bd?: Record<string, number[][]>;
  pl?: PlaceOut[];
  pk?: { n: string; h: number; p: [number, number] }[];
  poi?: { k: string; n: string; p: [number, number] }[];
  ct?: { h: number; l: number[] }[];
}

const nameOf = (f: MvtFeature): string => String(f.properties['name:de'] ?? f.properties['name'] ?? f.properties['name:latin'] ?? '').trim();
/**
 * The English console's name of a feature whose German one is `german`: `name:en`, else the local
 * `name`, where it differs and is written in Latin letters; undefined otherwise (the German stands).
 */
const englishOf = (f: MvtFeature, german: string): string | undefined => {
  const en = String(f.properties['name:en'] ?? f.properties['name_en'] ?? f.properties['name'] ?? '').trim();
  return en !== '' && en !== german && /^[\u0000-\u024f\u1e00-\u1eff\u2000-\u206f]+$/.test(en) ? en : undefined;
};

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
    const groups: Record<string, { n?: string; e?: string; l: number[] }[]> = {};
    for (const f of rescale(waterway)) {
      if (f.type !== 2) continue;
      const cls = String(f.properties['class']);
      const key = cls === 'river' ? 'r' : cls === 'canal' ? 'c' : 's';
      if (key === 's' && z < 12) continue;
      for (const g of f.geometry) {
        const s = simplify(g, tolerance);
        if (s.length < 4) continue;
        const name = nameOf(f);
        const en = name ? englishOf(f, name) : undefined;
        (groups[key] ??= []).push(name && key !== 's' ? { n: name, ...(en ? { e: en } : {}), l: pack(s) } : { l: pack(s) });
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
      if (rank === undefined || !name) continue;
      if (cls === 'country' && z > COUNTRY_MAX_ZOOM) continue;
      const worldRank = WORLD_CITY_RANK[z];
      if (worldRank !== undefined && cls !== 'country') {
        // World zooms: countries and big cities only.
        const big = cls === 'city' && (Number(f.properties['rank'] ?? 99) <= worldRank || (z >= 3 && Number(f.properties['capital']) === 2));
        if (!big) continue;
      }
      // Low-zoom features can carry copies of the point for the neighbouring worlds; take the one in this tile.
      let found: [number, number] | null = null;
      for (const point of f.geometry) {
        const x = Math.round((point[0] as number) * k);
        const y = Math.round((point[1] as number) * k);
        if (x >= 0 && y >= 0 && x < EXTENT && y < EXTENT) {
          found = [x, y];
          break;
        }
      }
      if (!found) continue;
      const en = cls !== 'country' ? englishOf(f, name) : undefined;
      pl.push({ n: name, ...(en ? { e: en } : {}), c: cls, r: Number(f.properties['rank'] ?? 10) + rank * 10, p: found });
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

// ------------------------------------------------------------------ Natural Earth: countries and cities

type Ring = [number, number][];
type NeGeometry = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] } | { type: 'Point'; coordinates: [number, number] };
interface NeFeature {
  properties: Record<string, string | number | null>;
  geometry: NeGeometry | null;
}

interface CountryOut {
  iso: string;
  name_de: string;
  name_en: string;
  continent: string;
  /** Label point [lon, lat]. */
  centroid: [number, number];
  areaKm2: number;
  /** west, south, east, north (countries crossing 180° span -180..180) */
  bbox: [number, number, number, number];
  /** Rings [[lon, lat], …]; outer rings and holes together, to be tested with the even-odd rule. */
  polygons: Ring[];
}

interface CityOut {
  name: string;
  name_de: string | null;
  iso: string;
  lat: number;
  lon: number;
  pop: number;
}

/** Tolerance of the simplified country outlines (degrees). */
const COUNTRY_TOLERANCE = 0.05;
const CITY_MIN_POP = 50_000;

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const validIso2 = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{2}$/.test(v);

/** ISO 3166-1 alpha-2, also where Natural Earth leaves ISO_A2 at -99 (France, Norway, Kosovo, …). */
function isoOf(p: NeFeature['properties']): string {
  if (validIso2(p['ISO_A2'])) return p['ISO_A2'];
  if (validIso2(p['ISO_A2_EH'])) return p['ISO_A2_EH'];
  return String(p['ADM0_A3']);
}

/** Area of a ring on the sphere (km²), after Chamberlain & Duquette. */
function sphericalArea(ring: Ring): number {
  const R = 6371.0088;
  let sum = 0;
  for (let i = 0; i + 1 < ring.length; i++) {
    const [lon1, lat1] = ring[i] as [number, number];
    const [lon2, lat2] = ring[i + 1] as [number, number];
    sum += ((lon2 - lon1) * Math.PI) / 180 * (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
  }
  return Math.abs((sum * R * R) / 2);
}

/** Simplified, rounded and closed ring, or null when nothing of it is left. */
function simplifyRing(ring: Ring, tolerance: number): Ring | null {
  const flat = simplify(ring.flat(), tolerance);
  const out: Ring = [];
  for (let i = 0; i < flat.length; i += 2) {
    const point: [number, number] = [round3(flat[i] as number), round3(flat[i + 1] as number)];
    const last = out[out.length - 1];
    if (!last || last[0] !== point[0] || last[1] !== point[1]) out.push(point);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) out.push([first[0], first[1]]);
  return out.length >= 4 ? out : null;
}

async function naturalEarth(name: string): Promise<NeFeature[]> {
  const bytes = await cached(`naturalearth/${name}.geojson`, `${NATURAL_EARTH}/${name}.geojson`);
  if (!bytes) throw new Error(`Natural Earth ${name} not found`);
  return (JSON.parse(bytes.toString('utf8')) as { features: NeFeature[] }).features;
}

async function buildCountries(): Promise<void> {
  const features = await naturalEarth('ne_50m_admin_0_countries');
  const byIso = new Map<string, { country: CountryOut; mainArea: number }>();
  const isoByA3 = new Map<string, string>();
  for (const f of features) {
    const p = f.properties;
    const iso = isoOf(p);
    for (const key of ['ADM0_A3', 'ISO_A3', 'SOV_A3', 'GU_A3']) if (typeof p[key] === 'string' && !isoByA3.has(p[key] as string)) isoByA3.set(p[key] as string, iso);
    if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) continue;
    const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let area = 0;
    let [w, s, e, n] = [180, 90, -180, -90];
    const rings: Ring[] = [];
    for (const polygon of polygons) {
      polygon.forEach((ring, i) => {
        area += (i === 0 ? 1 : -1) * sphericalArea(ring);
        for (const [lon, lat] of ring) {
          w = Math.min(w, lon);
          e = Math.max(e, lon);
          s = Math.min(s, lat);
          n = Math.max(n, lat);
        }
        const simple = simplifyRing(ring, COUNTRY_TOLERANCE);
        if (simple) rings.push(simple);
      });
    }
    if (rings.length === 0) {
      // Small countries (Vatican, Monaco, …) vanish at the general tolerance: keep their largest ring in more detail.
      const largest = polygons.map((poly) => poly[0] as Ring).sort((a, b) => sphericalArea(b) - sphericalArea(a))[0];
      for (const tolerance of [0.01, 0.002, 0]) {
        const simple = largest ? simplifyRing(largest, tolerance) : null;
        if (simple) {
          rings.push(simple);
          break;
        }
      }
    }
    const country: CountryOut = {
      iso,
      name_de: String(p['NAME_DE'] ?? p['NAME']),
      name_en: String(p['NAME_EN'] ?? p['NAME']),
      continent: String(p['CONTINENT']),
      centroid: [round3(Number(p['LABEL_X'])), round3(Number(p['LABEL_Y']))],
      areaKm2: Math.round(area),
      bbox: [round3(w), round3(s), round3(e), round3(n)],
      polygons: rings,
    };
    const existing = byIso.get(iso);
    if (!existing) {
      byIso.set(iso, { country, mainArea: area });
      continue;
    }
    // Dependencies sharing a code (e.g. Australia's Indian Ocean Territories) join the main country.
    const target = existing.country;
    const main = area > existing.mainArea ? country : target;
    byIso.set(iso, {
      mainArea: Math.max(area, existing.mainArea),
      country: {
        ...main,
        areaKm2: target.areaKm2 + country.areaKm2,
        bbox: [
          Math.min(target.bbox[0], country.bbox[0]),
          Math.min(target.bbox[1], country.bbox[1]),
          Math.max(target.bbox[2], country.bbox[2]),
          Math.max(target.bbox[3], country.bbox[3]),
        ],
        polygons: [...target.polygons, ...country.polygons],
      },
    });
  }
  const countries = [...byIso.values()].map((c) => c.country).sort((a, b) => a.iso.localeCompare(b.iso));
  const countriesJson = `[\n${countries.map((c) => JSON.stringify(c)).join(',\n')}\n]\n`;
  await fs.mkdir(DATUM_ASSETS, { recursive: true });
  await fs.writeFile(path.join(DATUM_ASSETS, 'countries.json'), countriesJson);
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, 'countries.json'), countriesJson);

  const places = await naturalEarth('ne_10m_populated_places');
  const cities: CityOut[] = [];
  for (const f of places) {
    const p = f.properties;
    const pop = Number(p['POP_MAX'] ?? 0);
    const capital = Number(p['ADM0CAP']) === 1 || String(p['FEATURECLA'] ?? '').startsWith('Admin-0 capital');
    if (pop < CITY_MIN_POP && !capital) continue;
    const nameDe = typeof p['NAME_DE'] === 'string' && p['NAME_DE'].trim() !== '' ? p['NAME_DE'].trim() : null;
    cities.push({
      name: String(p['NAME']),
      name_de: nameDe,
      iso: validIso2(p['ISO_A2']) ? p['ISO_A2'] : (isoByA3.get(String(p['ADM0_A3'])) ?? isoByA3.get(String(p['SOV_A3'])) ?? String(p['ADM0_A3'])),
      lat: Math.round(Number(p['LATITUDE']) * 1e4) / 1e4,
      lon: Math.round(Number(p['LONGITUDE']) * 1e4) / 1e4,
      pop: Math.max(0, Math.round(pop)),
    });
  }
  cities.sort((a, b) => b.pop - a.pop || a.name.localeCompare(b.name));
  const citiesJson = `[\n${cities.map((c) => JSON.stringify(c)).join(',\n')}\n]\n`;
  await fs.writeFile(path.join(DATUM_ASSETS, 'cities.json'), citiesJson);
  process.stdout.write(
    `countries.json: ${countries.length} countries, ${countries.reduce((a, c) => a + c.polygons.length, 0)} rings, ${(Buffer.byteLength(countriesJson) / 1e6).toFixed(2)} MB\n` +
      `cities.json: ${cities.length} places, ${(Buffer.byteLength(citiesJson) / 1e6).toFixed(2)} MB\n`,
  );
}

// ------------------------------------------------------------------ DATUM test regions

interface Region {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  videos: string[];
  /** Test locations inside the region. */
  points?: { lat: number; lon: number }[];
}

/** Box of ±km around a point: west, south, east, north. */
function boxAround(lat: number, lon: number, km: number): [number, number, number, number] {
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

async function readRegions(): Promise<Region[]> {
  try {
    return (JSON.parse(await fs.readFile(REGIONS_FILE, 'utf8')) as { regions: Region[] }).regions;
  } catch {
    process.stdout.write(`No ${path.relative(repoRoot, REGIONS_FILE)}: DATUM regions skipped (run src/scripts/datum/fetchTerrain.ts first)\n`);
    return [];
  }
}

/**
 * Detail areas of the DATUM regions for a zoom-13 radius `core` (km around each test location):
 * zoom 10 always covers the whole region box (±6 km); zooms 11-13 cover `core`·2^(13-z) km, up to
 * the region box; zoom 14 covers min(2 km, core / 2). core = 6 is the full extract (zooms 10-13 on
 * the region box, zoom 14 on ±2 km); smaller values shrink zoom 13 first, then 14, 12 and 11.
 */
function regionAreas(regions: Region[], core: number): Area[] {
  const areas: Area[] = [];
  for (const region of regions) {
    const points = region.points?.length
      ? region.points
      : [{ lat: (region.bbox[1] + region.bbox[3]) / 2, lon: (region.bbox[0] + region.bbox[2]) / 2 }];
    areas.push({ zooms: [10], bbox: region.bbox });
    for (const z of [11, 12, 13]) {
      const km = core * 2 ** (13 - z);
      if (km >= REGION_KM) areas.push({ zooms: [z], bbox: region.bbox });
      else for (const p of points) areas.push({ zooms: [z], bbox: boxAround(p.lat, p.lon, km) });
    }
    const km14 = Math.min(REGION_CORE_KM, core / 2);
    for (const p of points) areas.push({ zooms: [14], bbox: boxAround(p.lat, p.lon, km14) });
  }
  return areas;
}

// ------------------------------------------------------------------ main

function tileRange(bbox: Area['bbox'], z: number): { x0: number; x1: number; y0: number; y1: number } {
  const n = 2 ** z;
  const clamp = (v: number): number => Math.max(0, Math.min(n - 1, v));
  const [w, s, e, north] = bbox;
  return {
    x0: clamp(Math.floor(lon2x(w, z))),
    x1: clamp(Math.floor(lon2x(e, z))),
    y0: clamp(Math.floor(lat2y(north, z))),
    y1: clamp(Math.floor(lat2y(s, z))),
  };
}

/** Runs `fn` over `items` with at most `concurrency` calls in flight. */
async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) await fn(items[next++] as T);
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

/** Tiles of `areas` as "z/x/y", each once, in area order. */
function keysOf(areas: Area[]): string[] {
  const out = new Set<string>();
  for (const area of areas) {
    for (const z of area.zooms) {
      const { x0, x1, y0, y1 } = tileRange(area.bbox, z);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.add(`${z}/${x}/${y}`);
    }
  }
  return [...out];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const arg = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (arg('only') === 'countries') {
    await buildCountries();
    return;
  }
  const fixedCore = arg('core-km') === undefined ? null : Number(arg('core-km'));
  const budget = Number(arg('budget-mb') ?? DATUM_BUDGET_MB) * 1e6;

  const tilejson = JSON.parse((await cached('tilejson.json', 'https://tiles.openfreemap.org/planet'))?.toString('utf8') ?? '{}') as { tiles?: string[] };
  const template = tilejson.tiles?.[0];
  if (!template) throw new Error('Could not read the OpenFreeMap tile URL');
  const version = /planet\/([^/]+)\//.exec(template)?.[1] ?? 'planet';
  const osmUrl = (z: number, x: number, y: number): string => template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

  // Plan: the world and Koblenz as configured; the DATUM regions first at their largest extent.
  const regions = await readRegions();
  const group = new Map<string, 'world' | 'koblenz' | 'datum'>();
  for (const k of keysOf([WORLD])) group.set(k, 'world');
  for (const k of keysOf(AREAS)) if (!group.has(k)) group.set(k, 'koblenz');
  const datumKeys = (core: number): string[] => keysOf(regionAreas(regions, core)).filter((k) => group.get(k) !== 'koblenz' && group.get(k) !== 'world');
  for (const k of datumKeys(fixedCore ?? (CORE_LADDER[0] as number))) group.set(k, 'datum');
  const keys = [...group.keys()];

  // Download what is missing in parallel: vector tiles, and elevation (with neighbours) for contours.
  const terrain = new Set<string>();
  for (const k of keys) {
    const [z, x, y] = k.split('/').map(Number) as [number, number, number];
    if (z < 9) continue;
    const n = 2 ** z;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (y + dy >= 0 && y + dy < n) terrain.add(`${z}/${(((x + dx) % n) + n) % n}/${y + dy}`);
  }
  let fetched = 0;
  const failures: string[] = [];
  const progress = (): void => {
    if (++fetched % 500 === 0) process.stdout.write(`  ${fetched} of ${keys.length + terrain.size} source tiles ready\n`);
  };
  await pool(keys, 6, async (k) => {
    const [z, x, y] = k.split('/').map(Number) as [number, number, number];
    await cached(`osm/${version}/${k}.pbf`, osmUrl(z, x, y)).catch((err: unknown) => failures.push(String(err)));
    progress();
  });
  await pool([...terrain], 6, async (k) => {
    const [z, x, y] = k.split('/').map(Number) as [number, number, number];
    const local = await fs.stat(path.join(DATUM_TERRAIN_DIR, `${k}.png`)).catch(() => null);
    if (!local) await cached(`terrain/${k}.png`, terrariumUrl(z, x, y)).catch((err: unknown) => failures.push(String(err)));
    progress();
  });
  if (failures.length > 0) process.stdout.write(`${failures.length} downloads failed, retried below:\n  ${failures.slice(0, 5).join('\n  ')}\n`);

  // Convert everything; tiles without data (404) are left out.
  const converted = new Map<string, string>();
  const places = new Map<string, { name: string; lat: number; lon: number; rank: number }>();
  for (const k of keys) {
    const [z, x, y] = k.split('/').map(Number) as [number, number, number];
    const bytes = await cached(`osm/${version}/${k}.pbf`, osmUrl(z, x, y));
    if (!bytes || bytes.length === 0) continue;
    const tile = convert(decodeTile(bytes), z);
    if (z >= 9) {
      const grid = await paddedElevation(z, x, y);
      if (grid) {
        const ct = contours(grid, contourInterval(z));
        if (ct.length > 0) tile.ct = ct;
      }
    }
    // The place index of the server covers the Koblenz area only.
    if (group.get(k) === 'koblenz') {
      for (const p of tile.pl ?? []) {
        if (p.c === 'country') continue;
        const lon = x2lon(x + p.p[0] / EXTENT, z);
        const lat = y2lat(y + p.p[1] / EXTENT, z);
        const key = `${p.n}|${lat.toFixed(2)}|${lon.toFixed(2)}`;
        const rank = PLACE_RANK[p.c] ?? 6;
        const existing = places.get(key);
        if (!existing || rank < existing.rank) {
          places.set(key, { name: p.n, lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, rank });
        }
      }
    }
    converted.set(k, JSON.stringify(tile));
  }

  // DATUM detail: the largest zoom-13 radius whose tiles fit the budget.
  const sizeOf = (list: string[]): number => list.reduce((a, k) => a + Buffer.byteLength(converted.get(k) ?? ''), 0);
  let core = fixedCore ?? (CORE_LADDER[CORE_LADDER.length - 1] as number);
  if (fixedCore === null && regions.length > 0) {
    const fit = CORE_LADDER.find((c) => sizeOf(datumKeys(c)) <= budget);
    if (fit === undefined) process.stdout.write(`DATUM tiles exceed ${(budget / 1e6).toFixed(0)} MB even at a zoom-13 radius of ${core} km\n`);
    core = fit ?? core;
    const full = sizeOf(datumKeys(CORE_LADDER[0] as number));
    process.stdout.write(
      `DATUM detail: full extract ${(full / 1e6).toFixed(1)} MB; zoom-13 radius ${core} km fits ${(budget / 1e6).toFixed(0)} MB ` +
        `(zoom 10: region box, ${[11, 12, 13].map((z) => `${z}: ${Math.min(REGION_KM, core * 2 ** (13 - z))} km`).join(', ')}, 14: ${Math.min(REGION_CORE_KM, core / 2)} km)\n`,
    );
  }
  const datum = new Set(regions.length > 0 ? datumKeys(core) : []);

  await fs.rm(OUT_DIR, { recursive: true, force: true });
  const manifest: { minZoom: number; maxZoom: number; extent: number; tiles: Record<string, [number, number][]>; attribution: string; source: string } = {
    minZoom: 0,
    maxZoom: 14,
    extent: EXTENT,
    tiles: {},
    attribution: '© OpenStreetMap-Mitwirkende (ODbL) · OpenMapTiles · Höhendaten: Mapzen Terrain Tiles',
    source: `OpenFreeMap ${version}`,
  };
  const stats = new Map<string, { tiles: number; bytes: number }>();
  let count = 0;
  for (const k of keys) {
    const g = group.get(k) as string;
    const json = converted.get(k);
    if (json === undefined || (g === 'datum' && !datum.has(k))) continue;
    const [z, x, y] = k.split('/').map(Number) as [number, number, number];
    const file = path.join(OUT_DIR, String(z), String(x), `${y}.json`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, json);
    (manifest.tiles[String(z)] ??= []).push([x, y]);
    for (const s of [`${g} z${z}`, `z${z}`, g]) {
      const entry = stats.get(s) ?? { tiles: 0, bytes: 0 };
      entry.tiles++;
      entry.bytes += Buffer.byteLength(json);
      stats.set(s, entry);
    }
    count++;
  }
  await fs.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest));
  // Places inside the detailed areas are enough for naming incidents.
  const index = [...places.values()].filter((p) => p.lon >= 6.3 && p.lon <= 8.6 && p.lat >= 49.6 && p.lat <= 50.8);
  await fs.mkdir(path.dirname(PLACES_FILE), { recursive: true });
  await fs.writeFile(PLACES_FILE, JSON.stringify(index));

  const line = (k: string): string => {
    const s = stats.get(k);
    return s ? `${k}: ${s.tiles} tiles, ${(s.bytes / 1e6).toFixed(2)} MB` : `${k}: -`;
  };
  for (const g of ['world', 'koblenz', 'datum']) {
    const zooms = Array.from({ length: 15 }, (_, z) => z).filter((z) => stats.has(`${g} z${z}`));
    process.stdout.write(`${line(g)}  (${zooms.map((z) => line(`${g} z${z}`).replace(`${g} `, '')).join(' · ')})\n`);
  }
  if (regions.length > 0) process.stdout.write(`DATUM regions: ${regions.map((r) => r.id).join(', ')}\n`);
  const total = [...stats.entries()].filter(([k]) => /^z\d+$/.test(k)).reduce((a, [, s]) => a + s.bytes, 0);
  process.stdout.write(`${count} tiles, ${(total / 1e6).toFixed(1)} MB; ${index.length} places indexed\n`);

  await buildCountries();
}

await main();
process.exit(0);
