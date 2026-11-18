/**
 * DATUM world data: country shapes and cities shipped with the node
 * (`assets/datum/countries.json`, `assets/datum/cities.json`), plus the zero-shot country prior
 * that asks the text tower "which country does this look like".
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { CountryProb } from './contract.js';

export type LonLat = [number, number];

export interface CountryRecord {
  iso: string;
  name_de: string;
  name_en: string;
  continent: string;
  /** [lon, lat] */
  centroid: LonLat;
  areaKm2: number;
  /** [west, south, east, north]; recomputed from the rings when missing. */
  bbox: [number, number, number, number];
  /** Rings of [lon, lat]; outer rings and holes, evaluated with the even-odd rule. */
  polygons: LonLat[][];
}

export interface CityRecord {
  name: string;
  name_de: string;
  iso: string;
  lat: number;
  lon: number;
  pop: number;
}

export interface CountryRef {
  iso: string;
  name_de: string;
  name_en: string;
}

export interface ContinentInfo {
  code: string;
  name_de: string;
  lat: number;
  lon: number;
  /** Radius (km) that covers most of the continent's population around its centre. */
  radiusKm: number;
}

const CONTINENT_NAMES: Record<string, string> = {
  EU: 'Europa', AS: 'Asien', AF: 'Afrika', NA: 'Nordamerika', SA: 'Südamerika', OC: 'Ozeanien', AN: 'Antarktis',
  Europe: 'Europa', Asia: 'Asien', Africa: 'Afrika', 'North America': 'Nordamerika', 'South America': 'Südamerika',
  Oceania: 'Ozeanien', Antarctica: 'Antarktis',
};

/** Distance (km) from a point to a ring's edges, in a local equirectangular projection. */
export function distanceToRingKm(lat: number, lon: number, ring: readonly LonLat[]): number {
  const kx = 111.32 * Math.cos(lat * RAD);
  const ky = 110.57;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j] as LonLat;
    const b = ring[i] as LonLat;
    const ax = (a[0] - lon) * kx;
    const ay = (a[1] - lat) * ky;
    const bx = (b[0] - lon) * kx;
    const by = (b[1] - lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = Math.sqrt(px * px + py * py);
    if (d < best) best = d;
  }
  return best;
}

export interface NearestCity {
  name: string;
  iso: string;
  distanceKm: number;
  pop: number;
}

/** Embeds texts with the shared model; L2-normalised rows (EmbeddingModel.embedTexts). */
export type EmbedTexts = (texts: string[]) => Promise<Float32Array>;

export interface CountryPriorParams {
  /** Softmax temperature applied to the mean image-text cosine. */
  temperature: number;
  /** Share of a uniform distribution mixed in, so that no country is ever ruled out. */
  uniformMix: number;
  /**
   * Exponent of the population prior: logits gain populationExponent * log(sqrt(pop + 1e5)),
   * pop being the summed city population of the country (cities.json). Independent of the area;
   * keeps uninhabited or tiny territories (British Indian Ocean Territory, Anguilla) from winning
   * a nearly flat distribution. 0 disables it.
   */
  populationExponent: number;
}

/**
 * Tuned on the training half of the DATUM test videos (see scripts/datum/evaluate.ts and
 * docs/measurements/datum-geolocation.json): temperature and population exponent that maximise
 * the likelihood of the true country.
 */
export const DEFAULT_PRIOR_PARAMS: CountryPriorParams = { temperature: 0.0075, uniformMix: 0.01, populationExponent: 1 };

/** Prompt ensemble for the zero-shot country classifier (English names; {name} is replaced). */
export const COUNTRY_PROMPTS: readonly string[] = [
  'a photo taken in {name}',
  'a street scene in {name}',
  'a landscape in {name}',
  'a city in {name}',
  'a building in {name}',
];

const EARTH_RADIUS_KM = 6371.0088;
const RAD = Math.PI / 180;

export function greatCircleKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Even-odd ray casting: true when (lon, lat) lies inside the closed ring. */
export function pointInRing(lon: number, lat: number, ring: readonly LonLat[]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i] as LonLat;
    const b = ring[j] as LonLat;
    const yi = a[1];
    const yj = b[1];
    if (yi > lat !== yj > lat) {
      const xCross = ((b[0] - a[0]) * (lat - yi)) / (yj - yi) + a[0];
      if (lon < xCross) inside = !inside;
    }
  }
  return inside;
}

function isLonLat(v: unknown): v is LonLat {
  return Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number';
}

/** Accepts rings ([[lon,lat],…]), polygons of rings and multipolygons; returns flat rings. */
export function flattenRings(raw: unknown): LonLat[][] {
  const rings: LonLat[][] = [];
  const walk = (node: unknown): void => {
    if (!Array.isArray(node) || node.length === 0) return;
    if (isLonLat(node[0])) {
      const ring = (node as unknown[]).filter(isLonLat).map((p) => [p[0], p[1]] as LonLat);
      if (ring.length >= 3) rings.push(ring);
      return;
    }
    for (const child of node) walk(child);
  };
  walk(raw);
  return rings;
}

function ringBbox(ring: readonly LonLat[]): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < w) w = lon;
    if (lon > e) e = lon;
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  return [w, s, e, n];
}

function inBox(lon: number, lat: number, b: readonly [number, number, number, number]): boolean {
  return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
}

interface IndexedCountry {
  record: CountryRecord;
  rings: { ring: LonLat[]; box: [number, number, number, number] }[];
  box: [number, number, number, number];
}

const GRID_DEG = 1;

function cellKey(latCell: number, lonCell: number): number {
  const wrapped = ((lonCell % 360) + 360) % 360;
  return (latCell + 90) * 360 + wrapped;
}

export class World {
  private readonly indexed: IndexedCountry[];
  private readonly byIso = new Map<string, CountryRecord>();
  private readonly grid = new Map<number, CityRecord[]>();
  private readonly biggest = new Map<string, CityRecord>();
  private readonly cityList: CityRecord[];
  /** Summed city population per country. */
  private readonly population = new Map<string, number>();
  private continentCache: Map<string, ContinentInfo> | null = null;
  /** Text vectors of the country prompts, one promise per embedding function (per process). */
  private readonly textVectors = new WeakMap<EmbedTexts, Promise<Float32Array>>();

  /**
   * Optional disk cache of the country text vectors (valid for one model id). Without it the
   * vectors are computed once per process (about a minute on four cores).
   */
  textCache: { file: string; modelId: string } | null = null;

  constructor(countries: readonly CountryRecord[], cities: readonly CityRecord[]) {
    this.indexed = countries.map((record) => {
      const rings = record.polygons.map((ring) => ({ ring, box: ringBbox(ring) }));
      const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const r of rings) {
        box[0] = Math.min(box[0], r.box[0]);
        box[1] = Math.min(box[1], r.box[1]);
        box[2] = Math.max(box[2], r.box[2]);
        box[3] = Math.max(box[3], r.box[3]);
      }
      this.byIso.set(record.iso, record);
      return { record, rings, box };
    });
    this.cityList = [...cities];
    for (const city of cities) {
      const key = cellKey(Math.floor(city.lat / GRID_DEG), Math.floor(city.lon / GRID_DEG));
      let cell = this.grid.get(key);
      if (!cell) this.grid.set(key, (cell = []));
      cell.push(city);
      const best = this.biggest.get(city.iso);
      if (!best || city.pop > best.pop) this.biggest.set(city.iso, city);
      this.population.set(city.iso, (this.population.get(city.iso) ?? 0) + Math.max(0, city.pop));
    }
  }

  /** Parses the JSON shapes written by the asset builder; tolerant of missing optional fields. */
  static fromJson(countriesRaw: unknown, citiesRaw: unknown): World {
    const countries: CountryRecord[] = [];
    if (Array.isArray(countriesRaw)) {
      for (const item of countriesRaw) {
        if (item === null || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const iso = typeof o['iso'] === 'string' ? o['iso'].toUpperCase() : '';
        if (!/^[A-Z]{2}$/.test(iso)) continue;
        const polygons = flattenRings(o['polygons']);
        const nameEn = typeof o['name_en'] === 'string' ? o['name_en'] : iso;
        const nameDe = typeof o['name_de'] === 'string' ? o['name_de'] : nameEn;
        let centroid: LonLat | null = isLonLat(o['centroid']) ? [o['centroid'][0], o['centroid'][1]] : null;
        let bbox = Array.isArray(o['bbox']) && o['bbox'].length === 4 && o['bbox'].every((v) => typeof v === 'number')
          ? (o['bbox'] as [number, number, number, number])
          : null;
        if (!bbox && polygons.length > 0) {
          bbox = polygons.map(ringBbox).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
        }
        if (!centroid && bbox) centroid = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
        if (!centroid || !bbox) continue;
        countries.push({
          iso,
          name_de: nameDe,
          name_en: nameEn,
          continent: typeof o['continent'] === 'string' ? o['continent'] : '',
          centroid,
          areaKm2: typeof o['areaKm2'] === 'number' && o['areaKm2'] > 0 ? o['areaKm2'] : 1000,
          bbox,
          polygons,
        });
      }
    }
    const cities: CityRecord[] = [];
    if (Array.isArray(citiesRaw)) {
      for (const item of citiesRaw) {
        if (item === null || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        if (typeof o['lat'] !== 'number' || typeof o['lon'] !== 'number' || typeof o['name'] !== 'string') continue;
        cities.push({
          name: o['name'],
          name_de: typeof o['name_de'] === 'string' && o['name_de'] !== '' ? o['name_de'] : o['name'],
          iso: typeof o['iso'] === 'string' ? o['iso'].toUpperCase() : '',
          lat: o['lat'],
          lon: o['lon'],
          pop: typeof o['pop'] === 'number' ? o['pop'] : 0,
        });
      }
    }
    return new World(countries, cities);
  }

  static async load(dir: string = path.join(config.assetsDir, 'datum')): Promise<World> {
    const [countries, cities] = await Promise.all([
      fs.readFile(path.join(dir, 'countries.json'), 'utf8').then((t) => JSON.parse(t) as unknown),
      fs.readFile(path.join(dir, 'cities.json'), 'utf8').then(
        (t) => JSON.parse(t) as unknown,
        () => [] as unknown,
      ),
    ]);
    return World.fromJson(countries, cities);
  }

  countries(): readonly CountryRecord[] {
    return this.indexed.map((c) => c.record);
  }

  country(iso: string): CountryRecord | undefined {
    return this.byIso.get(iso.toUpperCase());
  }

  cities(): readonly CityRecord[] {
    return this.cityList;
  }

  /**
   * Country containing the point (bounding-box prefilter, then point-in-polygon). Where simplified
   * shapes overlap (an enclave drawn without its hole: Vatican City in Italy), the smaller wins.
   */
  countryAt(lat: number, lon: number, edgeToleranceKm = 10): CountryRef | null {
    let found: CountryRecord | null = null;
    for (const c of this.indexed) {
      if (!inBox(lon, lat, c.box)) continue;
      let inside = false;
      for (const r of c.rings) {
        if (inBox(lon, lat, r.box) && pointInRing(lon, lat, r.ring)) inside = !inside;
      }
      if (inside && (!found || c.record.areaKm2 < found.areaKm2)) found = c.record;
    }
    // The shapes are simplified (0.05°): harbours, lighthouses and bridges fall just outside the
    // coast. Then the country whose border is nearest within the tolerance counts.
    if (!found && edgeToleranceKm > 0) {
      const padLat = edgeToleranceKm / 110;
      const padLon = edgeToleranceKm / (111 * Math.max(0.05, Math.cos(lat * RAD)));
      let bestKm = edgeToleranceKm;
      for (const c of this.indexed) {
        const b = c.box;
        if (lon < b[0] - padLon || lon > b[2] + padLon || lat < b[1] - padLat || lat > b[3] + padLat) continue;
        for (const r of c.rings) {
          const rb = r.box;
          if (lon < rb[0] - padLon || lon > rb[2] + padLon || lat < rb[1] - padLat || lat > rb[3] + padLat) continue;
          const d = distanceToRingKm(lat, lon, r.ring);
          if (d <= bestKm) {
            bestKm = d;
            found = c.record;
          }
        }
      }
    }
    return found ? { iso: found.iso, name_de: found.name_de, name_en: found.name_en } : null;
  }

  /** Summed population of the listed cities of a country (0 when none is listed). */
  populationOf(iso: string): number {
    return this.population.get(iso.toUpperCase()) ?? 0;
  }

  /** Continent code of a country ("EU", "AS", … as in countries.json), or null. */
  continentOf(iso: string): string | null {
    return this.byIso.get(iso.toUpperCase())?.continent || null;
  }

  /**
   * Continent centres: population-weighted mean position of the continent's cities (3-D mean, so
   * Oceania does not break at the date line), with the radius around it that holds 80 % of them.
   */
  continent(code: string): ContinentInfo | null {
    if (!this.continentCache) {
      const cache = new Map<string, ContinentInfo>();
      const groups = new Map<string, CityRecord[]>();
      for (const city of this.cityList) {
        const cont = this.continentOf(city.iso);
        if (!cont) continue;
        let g = groups.get(cont);
        if (!g) groups.set(cont, (g = []));
        g.push(city);
      }
      for (const c of this.indexed) {
        const cont = c.record.continent;
        if (cont && !groups.has(cont)) groups.set(cont, []);
      }
      for (const [code, cities] of groups) {
        let x = 0;
        let y = 0;
        let z = 0;
        const points = cities.length > 0
          ? cities.map((c) => ({ lat: c.lat, lon: c.lon, w: Math.sqrt(Math.max(1, c.pop)) }))
          : this.indexed.filter((c) => c.record.continent === code).map((c) => ({ lat: c.record.centroid[1], lon: c.record.centroid[0], w: Math.sqrt(c.record.areaKm2) }));
        for (const p of points) {
          x += p.w * Math.cos(p.lat * RAD) * Math.cos(p.lon * RAD);
          y += p.w * Math.cos(p.lat * RAD) * Math.sin(p.lon * RAD);
          z += p.w * Math.sin(p.lat * RAD);
        }
        const lat = Math.atan2(z, Math.hypot(x, y)) / RAD;
        const lon = Math.atan2(y, x) / RAD;
        const dists = points.map((p) => greatCircleKm(lat, lon, p.lat, p.lon)).sort((a, b) => a - b);
        const r80 = dists[Math.floor(dists.length * 0.8)] ?? 2000;
        cache.set(code, { code, name_de: CONTINENT_NAMES[code] ?? code, lat, lon, radiusKm: Math.max(1500, r80) });
      }
      this.continentCache = cache;
    }
    return this.continentCache.get(code) ?? null;
  }

  /**
   * Like countryAt, but a point just off a simplified coastline or border takes the country of
   * the nearest city within `toleranceKm`.
   */
  countryNear(lat: number, lon: number, toleranceKm = 30): CountryRef | null {
    const exact = this.countryAt(lat, lon);
    if (exact) return exact;
    const city = this.nearestCity(lat, lon, { maxKm: toleranceKm });
    const record = city ? this.byIso.get(city.iso) : undefined;
    return record ? { iso: record.iso, name_de: record.name_de, name_en: record.name_en } : null;
  }

  /** Nearest city (grid index of 1-degree cells, searched in growing rings). */
  nearestCity(lat: number, lon: number, opts: { maxKm?: number; minPop?: number } = {}): NearestCity | null {
    const maxKm = opts.maxKm ?? 2000;
    const minPop = opts.minPop ?? 0;
    const latCell = Math.floor(lat / GRID_DEG);
    const lonCell = Math.floor(lon / GRID_DEG);
    let best: CityRecord | null = null;
    let bestKm = Infinity;
    const maxRing = Math.min(180, Math.ceil(maxKm / 111 / GRID_DEG) + 1);
    for (let r = 0; r <= maxRing; r++) {
      // Every cell not yet visited is at least r-1 cells away in latitude or longitude.
      if (best && r > 1) {
        const nearestLat = Math.min(89.9, Math.abs(lat) + r * GRID_DEG);
        const lowerBound = (r - 1) * GRID_DEG * 111.2 * Math.max(0.02, Math.cos(nearestLat * RAD));
        if (lowerBound > bestKm) break;
      }
      for (let dy = -r; dy <= r; dy++) {
        const y = latCell + dy;
        if (y < -90 || y >= 90) continue;
        const ring = Math.abs(dy) === r;
        for (let dx = -r; dx <= r; dx += ring ? 1 : 2 * r || 1) {
          const cell = this.grid.get(cellKey(y, lonCell + dx));
          if (!cell) continue;
          for (const city of cell) {
            if (city.pop < minPop) continue;
            const d = greatCircleKm(lat, lon, city.lat, city.lon);
            if (d < bestKm) {
              bestKm = d;
              best = city;
            }
          }
        }
      }
    }
    if (!best || bestKm > maxKm) return null;
    return { name: best.name_de || best.name, iso: best.iso, distanceKm: bestKm, pop: best.pop };
  }

  /** Most populous city of a country, if the city list has one. */
  biggestCity(iso: string): CityRecord | null {
    return this.biggest.get(iso.toUpperCase()) ?? null;
  }

  /** One L2-normalised class vector per country (mean of the prompt ensemble), cached per process. */
  countryTextVectors(embedTexts: EmbedTexts): Promise<Float32Array> {
    let cached = this.textVectors.get(embedTexts);
    if (!cached) {
      cached = this.buildTextVectors(embedTexts);
      cached.catch(() => this.textVectors.delete(embedTexts));
      this.textVectors.set(embedTexts, cached);
    }
    return cached;
  }

  private async buildTextVectors(embedTexts: EmbedTexts): Promise<Float32Array> {
    const countries = this.countries();
    const prompts: string[] = [];
    // Lower case, as the search does: the SigLIP 2 text tower all but ignores capitalised names
    // ("a photo taken in Germany" scores like "… in Japan"; "… in germany" does not).
    for (const c of countries) for (const p of COUNTRY_PROMPTS) prompts.push(p.replace('{name}', c.name_en).toLowerCase());
    const cache = this.textCache;
    const key = cache ? createHash('sha256').update(JSON.stringify([cache.modelId, prompts])).digest('hex').slice(0, 16) : '';
    const cacheFile = cache ? cache.file.replace(/(\.bin)?$/, `-${key}.bin`) : null;
    if (cacheFile) {
      try {
        const buf = await fs.readFile(cacheFile);
        const v = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        if (v.length > 0 && v.length % countries.length === 0) return v;
      } catch {
        // not cached yet
      }
    }
    const vectors = await this.embedCountryPrompts(embedTexts, prompts, countries.length);
    if (cacheFile) {
      try {
        await fs.mkdir(path.dirname(cacheFile), { recursive: true });
        const tmp = `${cacheFile}.${process.pid}.tmp`;
        await fs.writeFile(tmp, new Uint8Array(vectors.buffer, vectors.byteOffset, vectors.byteLength));
        await fs.rename(tmp, cacheFile);
      } catch {
        // a read-only data directory only costs the recomputation
      }
    }
    return vectors;
  }

  private async embedCountryPrompts(embedTexts: EmbedTexts, prompts: string[], countryCount: number): Promise<Float32Array> {
    const chunks: Float32Array[] = [];
    for (let i = 0; i < prompts.length; i += 64) chunks.push(await embedTexts(prompts.slice(i, i + 64)));
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const all = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) {
      all.set(c, offset);
      offset += c.length;
    }
    const dim = total / prompts.length;
    const per = COUNTRY_PROMPTS.length;
    const out = new Float32Array(countryCount * dim);
    for (let c = 0; c < countryCount; c++) {
      let norm = 0;
      for (let d = 0; d < dim; d++) {
        let sum = 0;
        for (let p = 0; p < per; p++) sum += all[(c * per + p) * dim + d] as number;
        out[c * dim + d] = sum;
        norm += sum * sum;
      }
      const inv = 1 / Math.sqrt(norm || 1);
      for (let d = 0; d < dim; d++) out[c * dim + d] = (out[c * dim + d] as number) * inv;
    }
    return out;
  }

  /** Mean over frames of the cosine between each frame and each country (order of countries()). */
  async countryCosines(frameVectors: Float32Array, dim: number, embedTexts: EmbedTexts): Promise<Float32Array> {
    const text = await this.countryTextVectors(embedTexts);
    const countries = this.indexed.length;
    if (text.length !== countries * dim) throw new Error(`countryPrior: Textvektoren passen nicht zu dim ${dim}.`);
    const frames = Math.floor(frameVectors.length / dim);
    const out = new Float32Array(countries);
    if (frames === 0) return out;
    for (let c = 0; c < countries; c++) {
      let sum = 0;
      for (let f = 0; f < frames; f++) {
        let dot = 0;
        for (let d = 0; d < dim; d++) dot += (frameVectors[f * dim + d] as number) * (text[c * dim + d] as number);
        sum += dot;
      }
      out[c] = sum / frames;
    }
    return out;
  }

  /**
   * Softmax over the cosines with temperature plus the population prior, mixed with a uniform
   * share; all countries, most probable first.
   */
  priorFromCosines(cosines: Float32Array, params: CountryPriorParams = DEFAULT_PRIOR_PARAMS): CountryProb[] {
    const countries = this.countries();
    const n = countries.length;
    if (n === 0) return [];
    const logits = new Float64Array(n);
    let max = -Infinity;
    for (let c = 0; c < n; c++) {
      const iso = (countries[c] as CountryRecord).iso;
      const popPrior = params.populationExponent > 0 ? params.populationExponent * Math.log(Math.sqrt(this.populationOf(iso) + 1e5)) : 0;
      logits[c] = (cosines[c] as number) / params.temperature + popPrior;
      max = Math.max(max, logits[c] as number);
    }
    const exps = new Float64Array(n);
    let sum = 0;
    for (let c = 0; c < n; c++) {
      const e = Math.exp((logits[c] as number) - max);
      exps[c] = e;
      sum += e;
    }
    const mix = Math.min(1, Math.max(0, params.uniformMix));
    const out: CountryProb[] = countries.map((c, i) => ({
      iso: c.iso,
      name: c.name_de,
      p: (1 - mix) * ((exps[i] as number) / sum) + mix / n,
    }));
    out.sort((a, b) => b.p - a.p);
    return out;
  }

  /** Zero-shot country probabilities for a set of frames; all countries, most probable first. */
  async countryPrior(
    frameVectors: Float32Array,
    dim: number,
    embedTexts: EmbedTexts,
    params: CountryPriorParams = DEFAULT_PRIOR_PARAMS,
  ): Promise<CountryProb[]> {
    return this.priorFromCosines(await this.countryCosines(frameVectors, dim, embedTexts), params);
  }
}

let shared: Promise<World> | null = null;

/**
 * The node's world data, loaded once per process. The country text vectors of the shared model
 * are cached under <dataDir>/datum.
 */
export function loadWorld(): Promise<World> {
  shared ??= World.load().then((world) => {
    const slug = (config.modelId.split('/').pop() ?? config.modelId).toLowerCase();
    world.textCache = { file: path.join(config.dataDir, 'datum', `country-text-${slug}.bin`), modelId: config.modelId };
    return world;
  }).catch((err: unknown) => {
    shared = null;
    throw err;
  });
  return shared;
}
