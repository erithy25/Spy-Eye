/**
 * DATUM: test regions and elevation tiles.
 *
 *   tsx src/scripts/datum/fetchTerrain.ts                  regions from the test manifest, then elevation
 *   tsx src/scripts/datum/fetchTerrain.ts --regions-only   only (re)write datasets/datum/regions.json
 *   tsx src/scripts/datum/fetchTerrain.ts --fallback       regions for 20 reference cities instead of the manifest
 *
 * 1. Regions. Every test location of datasets/datum/manifest.json gets a box of ±6 km; boxes that
 *    overlap are merged. The result is written to datasets/datum/regions.json:
 *      { "version": 1, "source", "regions": [ { "id", "name", "bbox": [w,s,e,n], "videos": [id…], "points": [{lat,lon}…] } ] }
 *    Names come from the nearest large place of apps/server/assets/datum/cities.json. Without a
 *    manifest the existing regions.json is kept, or the 20 reference cities are used.
 *    The map extraction (src/scripts/map/extractTiles.ts) reads regions.json for its detail tiles.
 *
 * 2. Elevation. Mapzen Terrarium tiles (256 px PNG, height = R*256 + G + B/256 - 32768 m) are stored
 *    in datasets/datum/terrain/{z}/{x}/{y}.png:
 *      zoom 11 and 12 for ±15 km around each test location (enough to compute horizons),
 *      zoom 13 for the ±4 km core, zoom 4 for the whole world (coarse relief).
 *    Tiles already cached by the map extraction (.cache/map/terrain) are copied, not downloaded;
 *    the cached Koblenz tiles of zooms 11-13 are copied in any case. Existing tiles are kept, so the
 *    script can be re-run at any time.
 *
 * Elevation: Mapzen terrain tiles on AWS Open Data (SRTM, GMTED, ETOPO1, EU-DEM and others).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from '../../config.js';

const DATASET = path.join(repoRoot, 'datasets', 'datum');
const MANIFEST_FILE = path.join(DATASET, 'manifest.json');
const REGIONS_FILE = path.join(DATASET, 'regions.json');
const TERRAIN_DIR = path.join(DATASET, 'terrain');
const MAP_CACHE = path.join(repoRoot, '.cache', 'map', 'terrain');
const CITIES_FILE = path.join(repoRoot, 'apps', 'server', 'assets', 'datum', 'cities.json');

/** Region box around a test location (km either side). */
const REGION_KM = 6;
/** Elevation at zooms 11 and 12 (km either side): far enough for the horizon. */
const HORIZON_KM = 15;
/** Elevation at zoom 13 (km either side). */
const CORE_KM = 4;
const WORLD_ZOOM = 4;
const CONCURRENCY = 6;
const ATTEMPTS = 5;

type BBox = [number, number, number, number];

interface Point {
  lat: number;
  lon: number;
}

interface Region {
  id: string;
  name: string;
  bbox: BBox;
  videos: string[];
  points: Point[];
}

interface RegionsFile {
  version: 1;
  source: 'manifest' | 'fallback';
  regions: Region[];
}

interface City {
  name: string;
  name_de: string | null;
  lat: number;
  lon: number;
  pop: number;
}

const FALLBACK: { name: string; lat: number; lon: number }[] = [
  { name: 'Berlin', lat: 52.52, lon: 13.405 },
  { name: 'Hamburg', lat: 53.5511, lon: 9.9937 },
  { name: 'München', lat: 48.1374, lon: 11.5755 },
  { name: 'Köln', lat: 50.9413, lon: 6.9583 },
  { name: 'Frankfurt', lat: 50.1109, lon: 8.6821 },
  { name: 'Dresden', lat: 51.0504, lon: 13.7373 },
  { name: 'Paris', lat: 48.8566, lon: 2.3522 },
  { name: 'London', lat: 51.5074, lon: -0.1278 },
  { name: 'Rome', lat: 41.9028, lon: 12.4964 },
  { name: 'Barcelona', lat: 41.3874, lon: 2.1686 },
  { name: 'Vienna', lat: 48.2082, lon: 16.3738 },
  { name: 'Prague', lat: 50.0755, lon: 14.4378 },
  { name: 'Amsterdam', lat: 52.3676, lon: 4.9041 },
  { name: 'New York', lat: 40.7128, lon: -74.006 },
  { name: 'San Francisco', lat: 37.7749, lon: -122.4194 },
  { name: 'Rio de Janeiro', lat: -22.9068, lon: -43.1729 },
  { name: 'Tokyo', lat: 35.6762, lon: 139.6503 },
  { name: 'Sydney', lat: -33.8688, lon: 151.2093 },
  { name: 'Cape Town', lat: -33.9249, lon: 18.4241 },
  { name: 'Istanbul', lat: 41.0082, lon: 28.9784 },
];

// ------------------------------------------------------------------ geometry

const lon2x = (lon: number, z: number): number => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat: number, z: number): number => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

function boxAround(p: Point, km: number): BBox {
  const dLat = km / 111.32;
  const dLon = km / (111.32 * Math.cos((p.lat * Math.PI) / 180));
  return [p.lon - dLon, p.lat - dLat, p.lon + dLon, p.lat + dLat];
}

const overlaps = (a: BBox, b: BBox): boolean => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const union = (a: BBox, b: BBox): BBox => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const round5 = (v: number): number => Math.round(v * 1e5) / 1e5;

function distanceKm(a: Point, b: Point): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Tiles covering a box at zoom z, as "z/x/y". */
function tilesOf(bbox: BBox, z: number): string[] {
  const n = 2 ** z;
  const clamp = (v: number): number => Math.max(0, Math.min(n - 1, v));
  const out: string[] = [];
  for (let x = clamp(Math.floor(lon2x(bbox[0], z))); x <= clamp(Math.floor(lon2x(bbox[2], z))); x++) {
    for (let y = clamp(Math.floor(lat2y(bbox[3], z))); y <= clamp(Math.floor(lat2y(bbox[1], z))); y++) out.push(`${z}/${x}/${y}`);
  }
  return out;
}

// ------------------------------------------------------------------ regions

interface Location extends Point {
  video: string | null;
  label: string | null;
}

/** Reads test locations from the manifest; tolerant about its exact shape. */
function locationsOf(manifest: unknown): Location[] {
  const root = manifest as Record<string, unknown>;
  const list = (Array.isArray(manifest) ? manifest : (root['videos'] ?? root['items'] ?? root['clips'] ?? root['entries'] ?? [])) as Record<string, unknown>[];
  const out: Location[] = [];
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const candidates = [entry, entry['truth'], entry['location'], entry['gps'], entry['position'], entry['geo']].filter(
      (c): c is Record<string, unknown> => !!c && typeof c === 'object',
    );
    let point: Point | null = null;
    for (const c of candidates) {
      const lat = num(c['lat'] ?? c['latitude']);
      const lon = num(c['lon'] ?? c['lng'] ?? c['longitude']);
      if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        point = { lat, lon };
        break;
      }
    }
    if (!point) continue;
    const id = entry['id'] ?? entry['videoId'] ?? entry['slug'] ?? entry['file'];
    const label = entry['label'] ?? entry['place'] ?? entry['city'] ?? entry['name'] ?? (entry['truth'] as Record<string, unknown> | undefined)?.['label'];
    out.push({ ...point, video: id === undefined ? null : String(id), label: typeof label === 'string' ? label : null });
  }
  return out;
}

function slug(name: string): string {
  return name
    .replace(/ä/gi, 'ae')
    .replace(/ö/gi, 'oe')
    .replace(/ü/gi, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Name of a region: the largest place the centre lies in (within 5 km of a place of 50 000, up
 * to about 10 km of a city of millions), else the label of its first test video, else the
 * nearest place within 40 km.
 */
function nameOf(centre: Point, cities: City[], label: string | null): string {
  let best: City | null = null;
  let nearest: { c: City; d: number } | null = null;
  for (const c of cities) {
    const d = distanceKm(centre, c);
    const reach = 5 + 2.5 * Math.log10(Math.max(1, c.pop / 50_000));
    if (d <= reach && (!best || c.pop > best.pop)) best = c;
    if (d <= 40 && (!nearest || d < nearest.d)) nearest = { c, d };
  }
  if (best) return best.name_de ?? best.name;
  if (label) return label;
  if (nearest) return nearest.c.name_de ?? nearest.c.name;
  return `${centre.lat.toFixed(3)}, ${centre.lon.toFixed(3)}`;
}

function buildRegions(locations: Location[], cities: City[], fixedNames: Map<Location, string> | null): Region[] {
  // Start with one box per location; merge overlapping boxes until none overlap.
  let groups = locations.map((l) => ({ bbox: boxAround(l, REGION_KM), members: [l] }));
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i] as (typeof groups)[number];
        const b = groups[j] as (typeof groups)[number];
        if (!overlaps(a.bbox, b.bbox)) continue;
        groups[i] = { bbox: union(a.bbox, b.bbox), members: [...a.members, ...b.members] };
        groups = groups.filter((_, k) => k !== j);
        merged = true;
        break outer;
      }
    }
  }
  const used = new Set<string>();
  const regions: Region[] = [];
  for (const g of groups) {
    const centre = { lat: g.members.reduce((a, m) => a + m.lat, 0) / g.members.length, lon: g.members.reduce((a, m) => a + m.lon, 0) / g.members.length };
    const name = fixedNames?.get(g.members[0] as Location) ?? nameOf(centre, cities, g.members.find((m) => m.label)?.label ?? null);
    let id = slug(name) || 'region';
    for (let k = 2; used.has(id); k++) id = `${slug(name) || 'region'}-${k}`;
    used.add(id);
    const points: Point[] = [];
    for (const m of g.members) if (!points.some((p) => p.lat === m.lat && p.lon === m.lon)) points.push({ lat: round5(m.lat), lon: round5(m.lon) });
    regions.push({
      id,
      name,
      bbox: g.bbox.map(round5) as BBox,
      videos: [...new Set(g.members.map((m) => m.video).filter((v): v is string => v !== null))],
      points,
    });
  }
  // West to east within bands of latitude keeps the file easy to scan; north first.
  return regions.sort((a, b) => b.bbox[3] - a.bbox[3]);
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function regions(fallback: boolean): Promise<RegionsFile> {
  const cities = (await readJson<City[]>(CITIES_FILE)) ?? [];
  if (cities.length === 0) process.stdout.write('cities.json missing: region names fall back to coordinates (run src/scripts/map/extractTiles.ts --only=countries)\n');
  const manifest = fallback ? null : await readJson<unknown>(MANIFEST_FILE);
  let file: RegionsFile;
  if (manifest !== null) {
    const locations = locationsOf(manifest);
    if (locations.length === 0) throw new Error(`${path.relative(repoRoot, MANIFEST_FILE)} lists no test location with lat/lon`);
    file = { version: 1, source: 'manifest', regions: buildRegions(locations, cities, null) };
    process.stdout.write(`${locations.length} test locations in the manifest\n`);
  } else {
    const existing = fallback ? null : await readJson<RegionsFile>(REGIONS_FILE);
    if (existing && existing.source === 'manifest') {
      process.stdout.write(`No manifest; keeping ${path.relative(repoRoot, REGIONS_FILE)} (${existing.regions.length} regions)\n`);
      return existing;
    }
    process.stdout.write('No test manifest: regions for the 20 reference cities\n');
    const locations: Location[] = FALLBACK.map((c) => ({ lat: c.lat, lon: c.lon, video: null, label: c.name }));
    const names = new Map<Location, string>(locations.map((l) => [l, l.label as string]));
    file = { version: 1, source: 'fallback', regions: buildRegions(locations, cities, names) };
  }
  await fs.mkdir(DATASET, { recursive: true });
  const body = `{\n  "version": 1,\n  "source": ${JSON.stringify(file.source)},\n  "regions": [\n${file.regions.map((r) => `    ${JSON.stringify(r)}`).join(',\n')}\n  ]\n}\n`;
  await fs.writeFile(REGIONS_FILE, body);
  process.stdout.write(`${path.relative(repoRoot, REGIONS_FILE)}: ${file.regions.length} regions (${file.source})\n`);
  for (const r of file.regions) process.stdout.write(`  ${r.id.padEnd(22)} ${r.name.padEnd(24)} ${r.videos.length} videos  [${r.bbox.join(', ')}]\n`);
  return file;
}

// ------------------------------------------------------------------ elevation tiles

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const isPng = (b: Buffer): boolean => b.length > 8 && b.subarray(0, 4).equals(PNG);

/** An existing tile counts when it is a PNG of plausible size (Terrarium tiles are never this small). */
async function fileOk(file: string): Promise<boolean> {
  try {
    const handle = await fs.open(file, 'r');
    try {
      const { size } = await handle.stat();
      const head = Buffer.alloc(4);
      await handle.read(head, 0, 4, 0);
      return size > 100 && head.equals(PNG);
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

async function writeAtomic(file: string, bytes: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, file);
}

async function download(key: string): Promise<Buffer | null> {
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`;
  let last = '';
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'datum-terrain/1.0 (one-time offline extract)' }, signal: AbortSignal.timeout(30_000) });
      if (response.status === 404 || response.status === 403) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!isPng(bytes)) throw new Error('not a PNG');
      return bytes;
    } catch (err: unknown) {
      last = err instanceof Error ? err.message : String(err);
      await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** attempt));
    }
  }
  throw new Error(`${url}: ${last}`);
}

async function terrain(file: RegionsFile): Promise<void> {
  const wanted = new Set<string>();
  for (const region of file.regions) {
    for (const p of region.points) {
      for (const z of [11, 12]) for (const k of tilesOf(boxAround(p, HORIZON_KM), z)) wanted.add(k);
      for (const k of tilesOf(boxAround(p, CORE_KM), 13)) wanted.add(k);
    }
  }
  for (const k of tilesOf([-180, -85.0511, 180, 85.0511], WORLD_ZOOM)) wanted.add(k);
  // Koblenz: whatever the map extraction already cached at the zooms DATUM reads.
  for (const z of [11, 12, 13]) {
    const dir = path.join(MAP_CACHE, String(z));
    for (const x of await fs.readdir(dir).catch(() => [] as string[])) {
      for (const f of await fs.readdir(path.join(dir, x)).catch(() => [] as string[])) if (f.endsWith('.png')) wanted.add(`${z}/${x}/${f.slice(0, -4)}`);
    }
  }

  const keys = [...wanted].sort();
  const counts = { present: 0, copied: 0, downloaded: 0, missing: 0, failed: 0 };
  const failures: string[] = [];
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < keys.length) {
      const key = keys[next++] as string;
      const target = path.join(TERRAIN_DIR, `${key}.png`);
      try {
        if (await fileOk(target)) counts.present++;
        else {
          const local = await fs.readFile(path.join(MAP_CACHE, `${key}.png`)).catch(() => null);
          if (local && isPng(local)) {
            await writeAtomic(target, local);
            counts.copied++;
          } else {
            const bytes = await download(key);
            if (bytes) {
              await writeAtomic(target, bytes);
              counts.downloaded++;
            } else counts.missing++;
          }
        }
      } catch (err: unknown) {
        counts.failed++;
        failures.push(err instanceof Error ? err.message : String(err));
      }
      if (++done % 250 === 0) process.stdout.write(`  ${done} of ${keys.length} tiles\n`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Summary per zoom from what is on disk.
  const perZoom = new Map<number, { tiles: number; bytes: number }>();
  for (const key of keys) {
    const stat = await fs.stat(path.join(TERRAIN_DIR, `${key}.png`)).catch(() => null);
    if (!stat) continue;
    const z = Number(key.split('/')[0]);
    const s = perZoom.get(z) ?? { tiles: 0, bytes: 0 };
    s.tiles++;
    s.bytes += stat.size;
    perZoom.set(z, s);
  }
  process.stdout.write(
    `${path.relative(repoRoot, TERRAIN_DIR)}: ${keys.length} tiles wanted; ${counts.present} already there, ${counts.copied} copied from .cache/map, ` +
      `${counts.downloaded} downloaded, ${counts.missing} not available, ${counts.failed} failed\n`,
  );
  let total = 0;
  for (const [z, s] of [...perZoom.entries()].sort((a, b) => a[0] - b[0])) {
    total += s.bytes;
    process.stdout.write(`  z${z}: ${s.tiles} tiles, ${(s.bytes / 1e6).toFixed(1)} MB\n`);
  }
  process.stdout.write(`  total ${(total / 1e6).toFixed(1)} MB\n`);
  if (failures.length > 0) {
    process.stdout.write(`Failed (re-run to retry):\n  ${failures.slice(0, 10).join('\n  ')}\n`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const file = await regions(args.includes('--fallback'));
  if (args.includes('--regions-only')) return;
  await terrain(file);
}

await main();
process.exit(process.exitCode ?? 0);
