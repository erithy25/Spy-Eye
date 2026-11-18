/**
 * DATUM localisation: where was this video recorded?
 *
 * Three sources, strongest first:
 *   1. GPS stored in the file (ISO 6709 tags) — taken as it is.
 *   2. Landmark retrieval — every frame is compared with the geotagged reference gallery; the
 *      nearest pictures vote for their positions with geodesic kernels of 2, 25 and 250 km, and
 *      the densest places become candidates.
 *   3. Zero-shot country prior — the text tower is asked which country the frames look like; it
 *      weighs the candidates softly and carries the answer alone when retrieval finds nothing.
 *
 * The confidence is meant literally: the estimated probability that the true place lies within
 * the stated radius. It is a logistic function of the match strength and the margin to the
 * second-best place, fitted on one half of the DATUM test videos and checked on the other.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';
import { decodeFrame, tileLayout, writeTile, type PixelRect } from '../ml/preprocess.js';
import type { DetailLevel } from '../types.js';
import type { CountryProb, Evidence, FixCandidate, FixLocation } from './contract.js';
import { galleryImageUrl, type Gallery, type GalleryNeighbour, type ImageEmbedder } from './gallery.js';
import { filenameHints, readMetadata, type FilenameHints, type VideoMetadata } from './metadata.js';
import { DEFAULT_PRIOR_PARAMS, greatCircleKm, loadWorld, type CountryPriorParams, type EmbedTexts, type World } from './world.js';

export interface LocateParams {
  /** Gallery neighbours per frame. */
  k: number;
  /** Similarity weight exp((s - simOffset) / simTemperature). */
  simOffset: number;
  simTemperature: number;
  /** Kernel widths (sigma, km) and their mixing weights. */
  kernelsKm: readonly number[];
  kernelMix: readonly number[];
  /** References closer than this to a mode belong to it. */
  mergeKm: number;
  /** Candidate score is multiplied by p(country)^priorExponent. */
  priorExponent: number;
  /** Below this best similarity, retrieval is not trusted and the answer is a country. */
  regionThreshold: number;
  /**
   * Retrieval is also not trusted when the best match does not stand out from the next ones:
   * gap = best similarity of a frame minus the mean of its 2nd..10th neighbours (max over frames).
   */
  gapThreshold: number;
  /**
   * Recognition: when the best single match stands out by at least this gap, its place wins
   * over the kernel vote (a known landmark must not be outvoted by many look-alikes elsewhere).
   */
  recognitionGap: number;
  /** Best similarity from which the evidence text calls a reference a recognition. */
  landmarkSimilarity: number;
  /** Weight of the retrieval votes in the country posterior (0: zero-shot prior only). */
  countryVoteWeight: number;
  /** Where the country-level answer is placed: the country's centroid or the neighbours in it. */
  regionAnchor: 'centroid' | 'neighbours';
  /**
   * Without a usable landmark: below this probability of the best country the answer is the
   * continent (radius >= 1500 km), below continentMinP for the best continent there is none.
   */
  countryMinP: number;
  continentMinP: number;
  maxCandidates: number;
  /**
   * How the crops of a frame (tiles: tile 0 is the whole frame, the others square crops) enter
   * retrieval: 'whole' uses the whole frame only; 'frame' gives every reference the best
   * similarity over all tiles of a frame (a landmark that fills a part of the picture is found by
   * its crop); 'rows' lets every tile vote as a frame of its own.
   */
  tilePooling: 'whole' | 'frame' | 'rows';
  /** A reference's weight over the frames: the mean of its per-frame weights, or the best one. */
  frameAggregation: 'mean' | 'max';
  /**
   * Radius tiers: 'strong' when the best match stands out by at least strongGap and at least
   * agreementMin of the frames (query rows) have their best match within 25 km of the answer;
   * 'recognised' for any other recognition (recognitionGap); 'similar' for the rest.
   */
  strongGap: number;
  agreementMin: number;
  /**
   * Stated radius per evidence tier, calibrated on the training half so that the true place lies
   * inside the circle in about 70 % of the training cases of each tier: the minimum radius of a
   * landmark-level answer (the spread of the supporting references can widen it) and the factor
   * on the country or continent radius.
   */
  radiusKm: { strong: number; recognised: number; similar: number; countryFactor: number; continentFactor: number };
  prior: CountryPriorParams;
  /**
   * Logistic model of P(error <= radius) over the best similarity, the margin to the second
   * mode, the share of the best mode, indicators of a country- or continent-level answer and the
   * probability of the chosen country (or continent).
   */
  confidence: {
    bias: number;
    topSim: number;
    gap: number;
    margin: number;
    share: number;
    region: number;
    continent: number;
    countryP: number;
    agreement: number;
  };
}

/**
 * Tuned on the even-indexed half of the DATUM test videos (scripts/datum/evaluate.ts); the odd
 * half was only used to report the result. See docs/measurements/datum-geolocation.json.
 */
export const DEFAULT_LOCATE_PARAMS: LocateParams = {
  k: 30,
  simOffset: 0.6,
  simTemperature: 0.05,
  kernelsKm: [2, 25, 250],
  kernelMix: [0.2, 0.3, 0.5],
  mergeKm: 5,
  priorExponent: 0.5,
  regionThreshold: 0.55,
  gapThreshold: 0.02,
  recognitionGap: 0.06,
  landmarkSimilarity: 0.75,
  countryVoteWeight: 0.5,
  regionAnchor: 'neighbours',
  countryMinP: 0.25,
  continentMinP: 0.05,
  maxCandidates: 8,
  tilePooling: 'whole',
  frameAggregation: 'mean',
  strongGap: 0.1,
  agreementMin: 0.5,
  radiusKm: { strong: 0.5, recognised: 0.5, similar: 25, countryFactor: 1, continentFactor: 1 },
  prior: DEFAULT_PRIOR_PARAMS,
  confidence: { bias: -1.832, topSim: 0.304, gap: 0.188, margin: -0.24, share: 0.534, region: 0.881, continent: 0, countryP: 0.921, agreement: 0 },
};

export interface LocateInput {
  videoPath: string;
  /** n x dim, L2-normalised, one row per sampled frame. */
  frameVectors: Float32Array;
  dim: number;
  /** Frame number in the video for each row. */
  frameNumbers: number[];
  /**
   * Optional crops: m x dim, L2-normalised tile vectors of the same frames (tile 0 of a frame is
   * the whole frame), with the frame row (index into frameVectors) and the tile index of each.
   * Used for retrieval unless params.tilePooling is 'whole'.
   */
  tiles?: { vectors: Float32Array; frameRow: number[]; tile: number[] };
  embedTexts: EmbedTexts;
  gallery: Gallery;
  /** Wikidata items to leave out of the gallery (evaluation of unknown places). */
  excludeWikidata?: string[];
  /** Defaults to the node's world data (assets/datum). */
  world?: World;
  params?: Partial<LocateParams>;
  /** Display name of the file (for file-name hints); defaults to the basename of videoPath. */
  fileName?: string;
}

export interface LocateResult {
  location: FixLocation | null;
  candidates: FixCandidate[];
  countries: CountryProb[];
  evidence: Evidence[];
  /** Diagnostics for evaluation and the console. */
  diagnostics: LocateDiagnostics;
}

export interface LocateDiagnostics {
  features: ConfidenceFeatures;
  /** Granularity of the visual answer; null when there is none. */
  level: 'landmark' | 'country' | 'continent' | null;
  /** Evidence tier that sets the radius (see LocateParams.radiusKm); null without an answer. */
  radiusTier: RadiusTier | null;
  /** The evidence-based part of the radius: spread of the supporting references (landmark
   * tiers) or the country / continent radius before the calibrated factor. */
  radiusBaseKm: number;
  /** Best country and continent of the posterior (zero-shot prior times retrieval votes). */
  countryTop: { iso: string; p: number } | null;
  continentTop: { code: string; p: number } | null;
  topSimilarity: number;
  margin: number;
  share: number;
  method: 'metadata' | 'landmark' | 'region' | 'none';
  /** The visual estimate, also when metadata decided the location. */
  visual: FixLocation | null;
  zeroShotTop: CountryProb[];
}

/** One gallery reference with the evidence the frames give it. */
export interface WeightedRef {
  id: string;
  label: string;
  lat: number;
  lon: number;
  country: string | null;
  weight: number;
  bestSimilarity: number;
  /** Row (frame index) of the best similarity. */
  bestRow: number;
}

export interface VoteMode {
  lat: number;
  lon: number;
  /** Kernel density at the mode's seed. */
  density: number;
  /** Indices into the refs array, strongest first. */
  members: number[];
  /** Sum of the member weights. */
  mass: number;
}

const FRAME_WIDTH = 640;

function kernel(dKm: number, params: Pick<LocateParams, 'kernelsKm' | 'kernelMix'>): number {
  let k = 0;
  for (let m = 0; m < params.kernelsKm.length; m++) {
    const s = params.kernelsKm[m] as number;
    k += (params.kernelMix[m] ?? 0) * Math.exp(-(dKm * dKm) / (2 * s * s));
  }
  return k;
}

/** Collapses the neighbours of all frames to one weighted entry per reference picture. */
export function weightNeighbours(
  rows: readonly GalleryNeighbour[][],
  params: Pick<LocateParams, 'simOffset' | 'simTemperature'> & Partial<Pick<LocateParams, 'frameAggregation'>>,
): WeightedRef[] {
  const byId = new Map<string, WeightedRef>();
  const frames = Math.max(1, rows.length);
  if (params.frameAggregation === 'max') {
    // Every reference counts once, with the weight of its best frame.
    rows.forEach((row, r) => {
      for (const n of row) {
        const ref = byId.get(n.id);
        if (!ref) {
          byId.set(n.id, { id: n.id, label: n.label, lat: n.lat, lon: n.lon, country: n.country, weight: 0, bestSimilarity: n.similarity, bestRow: r });
        } else if (n.similarity > ref.bestSimilarity) {
          ref.bestSimilarity = n.similarity;
          ref.bestRow = r;
        }
      }
    });
    for (const ref of byId.values()) ref.weight = Math.exp((ref.bestSimilarity - params.simOffset) / params.simTemperature);
    return [...byId.values()].sort((a, b) => b.weight - a.weight);
  }
  rows.forEach((row, r) => {
    for (const n of row) {
      const w = Math.exp((n.similarity - params.simOffset) / params.simTemperature) / frames;
      const ref = byId.get(n.id);
      if (!ref) {
        byId.set(n.id, {
          id: n.id,
          label: n.label,
          lat: n.lat,
          lon: n.lon,
          country: n.country,
          weight: w,
          bestSimilarity: n.similarity,
          bestRow: r,
        });
      } else {
        ref.weight += w;
        if (n.similarity > ref.bestSimilarity) {
          ref.bestSimilarity = n.similarity;
          ref.bestRow = r;
        }
      }
    }
  });
  return [...byId.values()].sort((a, b) => b.weight - a.weight);
}

/**
 * Geodesic kernel voting: the density at every reference position is the weighted sum of the
 * kernels of all references; modes are taken greedily from the densest position, and every
 * reference within `mergeKm` of a mode joins it. Returns modes, densest first.
 */
export function voteModes(refs: readonly WeightedRef[], params: Pick<LocateParams, 'kernelsKm' | 'kernelMix' | 'mergeKm'>): VoteMode[] {
  const n = refs.length;
  if (n === 0) return [];
  const density = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = refs[i] as WeightedRef;
    let d = 0;
    for (let j = 0; j < n; j++) {
      const b = refs[j] as WeightedRef;
      d += b.weight * kernel(i === j ? 0 : greatCircleKm(a.lat, a.lon, b.lat, b.lon), params);
    }
    density[i] = d;
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => (density[b] as number) - (density[a] as number));
  const assigned = new Int32Array(n).fill(-1);
  const modes: VoteMode[] = [];
  for (const seed of order) {
    if ((assigned[seed] as number) >= 0) continue;
    const s = refs[seed] as WeightedRef;
    const members: number[] = [];
    for (const j of order) {
      if ((assigned[j] as number) >= 0) continue;
      const r = refs[j] as WeightedRef;
      if (j === seed || greatCircleKm(s.lat, s.lon, r.lat, r.lon) <= params.mergeKm) {
        members.push(j);
        assigned[j] = modes.length;
      }
    }
    // Weighted centre of the members (small areas: plain averaging of degrees is fine).
    let wSum = 0;
    let lat = 0;
    let lon = 0;
    for (const j of members) {
      const r = refs[j] as WeightedRef;
      wSum += r.weight;
      lat += r.weight * r.lat;
      lon += r.weight * (r.lon + (Math.abs(r.lon - s.lon) > 180 ? (r.lon < s.lon ? 360 : -360) : 0));
    }
    lon /= wSum;
    if (lon > 180) lon -= 360;
    if (lon < -180) lon += 360;
    modes.push({ lat: lat / wSum, lon, density: density[seed] as number, members, mass: wSum });
  }
  modes.sort((a, b) => b.density - a.density);
  return modes;
}

/** Largest margin, over frames, between the best neighbour and the mean of the 2nd..10th. */
export function similarityGap(rows: readonly GalleryNeighbour[][]): number {
  let best = 0;
  for (const row of rows) {
    const first = row[0];
    const rest = row.slice(1, 10);
    if (!first || rest.length === 0) continue;
    const mean = rest.reduce((s, n) => s + n.similarity, 0) / rest.length;
    best = Math.max(best, first.similarity - mean);
  }
  return best;
}

/** Weighted RMS distance (km) of the references around a point, counting those within maxKm. */
export function weightedSpreadKm(refs: readonly WeightedRef[], lat: number, lon: number, maxKm: number): number {
  let w = 0;
  let s = 0;
  for (const r of refs) {
    const d = greatCircleKm(lat, lon, r.lat, r.lon);
    if (d > maxKm) continue;
    w += r.weight;
    s += r.weight * d * d;
  }
  return w > 0 ? Math.sqrt(s / w) : maxKm;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export type RadiusTier = 'strong' | 'recognised' | 'similar' | 'country' | 'continent';

/** Share of the rows whose best match lies within `km` of a point. */
export function frameAgreement(rows: readonly GalleryNeighbour[][], lat: number, lon: number, km = 25): number {
  let n = 0;
  let agree = 0;
  for (const row of rows) {
    const best = row[0];
    if (!best) continue;
    n++;
    if (greatCircleKm(lat, lon, best.lat, best.lon) <= km) agree++;
  }
  return n > 0 ? agree / n : 0;
}

export interface ConfidenceFeatures {
  topSim: number;
  /** How far the best match stands out from the next neighbours (see gapThreshold). */
  gap: number;
  margin: number;
  share: number;
  /** 1 for a country-level answer. */
  region: number;
  /** 1 for a continent-level answer. */
  continent: number;
  /** Probability of the best country (continent for a continent-level answer). */
  countryP: number;
  /** Share of the frames whose best match lies within 25 km of the answer. */
  agreement: number;
}

/** P(true place within the radius), clamped: nothing visual is ever certain. */
export function confidenceFrom(f: ConfidenceFeatures, c: LocateParams['confidence']): number {
  const z =
    c.bias +
    c.topSim * f.topSim +
    c.gap * f.gap +
    c.margin * f.margin +
    c.share * f.share +
    c.region * f.region +
    c.continent * f.continent +
    c.countryP * f.countryP +
    c.agreement * f.agreement;
  return Math.min(0.95, Math.max(0.02, sigmoid(z)));
}

const fmt = (v: number, digits = 2): string => v.toFixed(digits).replace('.', ',');
const pct = (p: number): string => `${Math.round(p * 100)} %`;

function formatCoord(lat: number, lon: number): string {
  return `${fmt(Math.abs(lat), 4)}° ${lat >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(lon), 4)}° ${lon >= 0 ? 'O' : 'W'}`;
}

/** Everything locate() needs, already computed; the pure part, used directly by the evaluation. */
export interface LocateEvidence {
  /** Gallery neighbours per query row (a frame, or a tile of a frame when rowFrame is given). */
  neighbours: GalleryNeighbour[][];
  /** Frame index (into frameNumbers) of each neighbour row; absent: row r is frame r. */
  rowFrame?: readonly number[];
  /** Tile index of each neighbour row (0 = whole frame); absent: every row is a whole frame. */
  rowTile?: readonly number[];
  /** Mean cosine per country, order of world.countries(). */
  countryCosines: Float32Array;
  frameNumbers: readonly number[];
  metadata: VideoMetadata | null;
  hints: FilenameHints | null;
}

/** ISO code of a reference: the gallery's own code if it is one, else from the coordinates. */
function refIso(world: World, r: { country: string | null; lat: number; lon: number }): string | null {
  if (r.country && /^[A-Z]{2}$/.test(r.country)) return r.country;
  return world.countryNear(r.lat, r.lon)?.iso ?? null;
}

/** Country posterior: zero-shot prior times the (smoothed) retrieval votes per country. */
function countryPosterior(world: World, zeroShot: CountryProb[], refs: readonly WeightedRef[], params: LocateParams): CountryProb[] {
  if (params.countryVoteWeight <= 0 || refs.length === 0) return zeroShot;
  const votes = new Map<string, number>();
  let total = 0;
  for (const r of refs) {
    const iso = refIso(world, r);
    if (!iso) continue;
    votes.set(iso, (votes.get(iso) ?? 0) + r.weight);
    total += r.weight;
  }
  if (total <= 0) return zeroShot;
  const n = zeroShot.length;
  const out = zeroShot.map((c) => {
    const share = (votes.get(c.iso) ?? 0) / total;
    // Votes are smoothed so a country without neighbours keeps a chance.
    return { ...c, p: c.p * Math.pow(share + 0.5 / n + 0.02, params.countryVoteWeight) };
  });
  const sum = out.reduce((s, c) => s + c.p, 0);
  for (const c of out) c.p /= sum;
  out.sort((a, b) => b.p - a.p);
  return out;
}

/** Mainland anchor of a country: the given centroid if it lies inside, else the biggest city. */
function countryAnchor(world: World, iso: string): { lat: number; lon: number } | null {
  const c = world.country(iso);
  if (!c) return null;
  const [lon, lat] = c.centroid;
  if (world.countryAt(lat, lon)?.iso === iso) return { lat, lon };
  const city = world.biggestCity(iso);
  return city ? { lat: city.lat, lon: city.lon } : { lat, lon };
}

/** A country-level answer covers at least the country: radius >= sqrt(area), never under 50 km. */
function regionRadiusKm(world: World, iso: string): number {
  const area = world.country(iso)?.areaKm2 ?? 250_000;
  return Math.max(50, Math.sqrt(area));
}

/** Country probabilities summed per continent, best first. */
function continentPosterior(world: World, countries: readonly CountryProb[]): { code: string; p: number }[] {
  const sums = new Map<string, number>();
  for (const c of countries) {
    const code = world.continentOf(c.iso);
    if (code) sums.set(code, (sums.get(code) ?? 0) + c.p);
  }
  return [...sums.entries()].map(([code, p]) => ({ code, p })).sort((a, b) => b.p - a.p);
}

function placeLabel(world: World, lat: number, lon: number, landmark: string | null): string {
  const city = world.nearestCity(lat, lon, { maxKm: 60 });
  if (landmark && city) return landmark.includes(city.name) ? landmark : `${landmark}, ${city.name}`;
  if (landmark) return landmark;
  if (city) return city.distanceKm < 5 ? city.name : `bei ${city.name}`;
  const country = world.countryNear(lat, lon);
  return country ? country.name_de : formatCoord(lat, lon);
}

/**
 * Turns per-tile neighbour rows into the rows the vote works on. 'whole' keeps the whole-frame
 * rows, 'frame' merges the tiles of each frame (every reference keeps its best similarity over
 * the tiles, the best k stay), 'rows' keeps every tile row. Returns the rows and, for each, the
 * frame index it belongs to.
 */
export function poolTileRows(
  rows: readonly GalleryNeighbour[][],
  rowFrame: readonly number[] | undefined,
  rowTile: readonly number[] | undefined,
  mode: LocateParams['tilePooling'],
  k: number,
): { rows: GalleryNeighbour[][]; frameOfRow: number[] } {
  if (!rowFrame || !rowTile) return { rows: rows.map((r) => r.slice(0, k)), frameOfRow: rows.map((_, i) => i) };
  if (mode === 'rows') return { rows: rows.map((r) => r.slice(0, k)), frameOfRow: [...rowFrame] };
  if (mode === 'whole') {
    const out: GalleryNeighbour[][] = [];
    const frameOfRow: number[] = [];
    rows.forEach((r, i) => {
      if (rowTile[i] !== 0) return;
      out.push(r.slice(0, k));
      frameOfRow.push(rowFrame[i] as number);
    });
    return { rows: out, frameOfRow };
  }
  const byFrame = new Map<number, Map<string, GalleryNeighbour>>();
  rows.forEach((r, i) => {
    const f = rowFrame[i] as number;
    let best = byFrame.get(f);
    if (!best) {
      best = new Map();
      byFrame.set(f, best);
    }
    for (const n of r.slice(0, k)) {
      const seen = best.get(n.id);
      if (!seen || n.similarity > seen.similarity) best.set(n.id, n);
    }
  });
  const frames = [...byFrame.keys()].sort((a, b) => a - b);
  return {
    rows: frames.map((f) => [...(byFrame.get(f) as Map<string, GalleryNeighbour>).values()].sort((a, b) => b.similarity - a.similarity).slice(0, k)),
    frameOfRow: frames,
  };
}

/** The pure decision: candidates, location and evidence from precomputed neighbours and prior. */
export function decideLocation(world: World, ev: LocateEvidence, partial: Partial<LocateParams> = {}): LocateResult {
  const params: LocateParams = { ...DEFAULT_LOCATE_PARAMS, ...partial };
  const evidence: Evidence[] = [];
  const zeroShot = world.priorFromCosines(ev.countryCosines, params.prior);
  const pooled = poolTileRows(ev.neighbours, ev.rowFrame, ev.rowTile, params.tilePooling, params.k);
  const neighbours = pooled.rows;
  const refs = weightNeighbours(neighbours, params);
  const countries = countryPosterior(world, zeroShot, refs, params);
  const pCountry = new Map(countries.map((c) => [c.iso, c.p]));
  const countryName = (iso: string | null): string | null => (iso ? (world.country(iso)?.name_de ?? iso) : null);

  // ---- metadata
  const meta = ev.metadata;
  let metaLocation: FixLocation | null = null;
  if (meta?.location) {
    const { lat, lon } = meta.location;
    const country = world.countryNear(lat, lon);
    metaLocation = {
      lat,
      lon,
      radiusKm: 0.05,
      confidence: 0.98,
      method: 'metadata',
      label: placeLabel(world, lat, lon, null),
      country: country?.iso ?? null,
      countryName: country?.name_de ?? null,
    };
    evidence.push({
      kind: 'metadata',
      label: `GPS in der Datei: ${formatCoord(lat, lon)}`,
      detail: `Die Videodatei trägt eine Positionsangabe (ISO 6709${meta.altitude !== null ? `, Höhe ${Math.round(meta.altitude)} m` : ''}${meta.device ? `, Gerät ${meta.device}` : ''}); sie wird als Ort übernommen, sofern sie nicht nachträglich verändert wurde.`,
      weight: 0.98,
    });
  }
  if (meta && (meta.creationUtc !== null || meta.creationRejected)) {
    evidence.push(
      meta.creationUtc !== null
        ? {
            kind: 'metadata',
            label: `Aufnahmezeit laut Datei: ${new Date(meta.creationUtc).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
            detail: `Zeitstempel aus den Container-Angaben${meta.device ? ` (${meta.device})` : ''}; er trägt nicht zum Ort bei.`,
            weight: 0,
          }
        : {
            kind: 'metadata',
            label: 'Zeitstempel der Datei verworfen',
            detail: `Der eingetragene Zeitpunkt ist unplausibel: ${meta.creationRejected}.`,
            weight: 0,
          },
    );
  }

  // ---- landmark retrieval
  const modes = voteModes(refs, params);
  const scored = modes.map((m) => {
    // The member with the most weight names the mode.
    const lead = m.members.map((j) => refs[j] as WeightedRef).reduce((a, b) => (b.weight > a.weight ? b : a));
    const iso = refIso(world, lead);
    const p = iso ? (pCountry.get(iso) ?? 1 / Math.max(1, countries.length)) : 1 / Math.max(1, countries.length);
    return { mode: m, lead, iso, score: m.density * Math.pow(p, params.priorExponent) };
  });
  scored.sort((a, b) => b.score - a.score);
  const topSimilarity = refs.reduce((s, r) => Math.max(s, r.bestSimilarity), -1);
  const topGap = similarityGap(neighbours);
  // A clearly recognised reference: its mode goes first, whatever the vote says.
  const recognised = topGap >= params.recognitionGap;
  if (recognised) {
    const bestRef = refs.reduce((a, b) => (b.bestSimilarity > a.bestSimilarity ? b : a));
    const at = scored.findIndex((c) => c.mode.members.some((j) => refs[j] === bestRef));
    if (at > 0) {
      const [mode] = scored.splice(at, 1);
      const lead = scored[0];
      if (mode && lead) {
        // It takes at least the vote winner's score, so the normalised scores stay ordered.
        mode.score = Math.max(mode.score, lead.score);
        scored.unshift(mode);
      }
    }
  }
  const totalScore = scored.reduce((s, c) => s + c.score, 0);
  const first = scored[0];
  const second = scored[1];
  const margin = first ? (second ? 1 - second.score / first.score : 1) : 0;
  const share = first && totalScore > 0 ? first.score / totalScore : 0;

  const candidates: FixCandidate[] = scored.slice(0, params.maxCandidates).map((c) => {
    const spread = weightedSpreadKm(
      c.mode.members.map((j) => refs[j] as WeightedRef),
      c.mode.lat,
      c.mode.lon,
      params.mergeKm,
    );
    return {
      lat: c.mode.lat,
      lon: c.mode.lon,
      label: placeLabel(world, c.mode.lat, c.mode.lon, c.lead.label),
      country: c.iso,
      score: totalScore > 0 ? c.score / totalScore : 0,
      radiusKm: Math.max(0.5, spread),
    };
  });

  const continents = continentPosterior(world, countries);
  let agreement = 0;
  const features = (level: 'landmark' | 'country' | 'continent'): ConfidenceFeatures => ({
    topSim: topSimilarity,
    gap: topGap,
    margin,
    share,
    region: level === 'country' ? 1 : 0,
    continent: level === 'continent' ? 1 : 0,
    countryP: level === 'continent' ? (continents[0]?.p ?? 0) : (countries[0]?.p ?? 0),
    agreement,
  });
  let radiusTier: RadiusTier | null = null;
  let radiusBaseKm = 0;
  let level: 'landmark' | 'country' | 'continent' = 'landmark';
  const confidenceOf = (l: typeof level): number => confidenceFrom(features(l), params.confidence);

  let visual: FixLocation | null = null;
  let method: LocateDiagnostics['method'] = 'none';
  if (first && topSimilarity >= params.regionThreshold && topGap >= params.gapThreshold) {
    // Radius: spread of the references that support the mode; a strong single landmark keeps
    // half a kilometre, weaker matches widen with the similarity gap.
    const support = weightedSpreadKm(refs, first.mode.lat, first.mode.lon, Math.max(...params.kernelsKm));
    const local = weightedSpreadKm(
      first.mode.members.map((j) => refs[j] as WeightedRef),
      first.mode.lat,
      first.mode.lon,
      params.mergeKm,
    );
    // With SigLIP 2 nearly every picture of a built place scores 0.7-0.85 against some
    // reference, so the absolute similarity does not mean recognition; only a match that stands
    // out from its neighbours (the gap) earns a landmark-sized radius. Everything else is a
    // regional guess and says so: at least 25 km, or the spread of the supporting references.
    // How sure the radius is, is calibrated per tier: a recognition that most frames confirm,
    // one that they do not, and a mere similarity.
    agreement = frameAgreement(neighbours, first.mode.lat, first.mode.lon);
    radiusTier = topGap >= params.strongGap && agreement >= params.agreementMin ? 'strong' : recognised ? 'recognised' : 'similar';
    radiusBaseKm = radiusTier === 'similar' ? support : local;
    const radiusKm = Math.max(params.radiusKm[radiusTier], radiusBaseKm, 0.5);
    visual = {
      lat: first.mode.lat,
      lon: first.mode.lon,
      radiusKm,
      confidence: confidenceOf('landmark'),
      method: 'landmark',
      label: placeLabel(world, first.mode.lat, first.mode.lon, first.lead.label),
      country: first.iso,
      countryName: countryName(first.iso),
    };
    method = 'landmark';
  } else if (countries[0] && countries[0].p >= params.countryMinP) {
    const best = countries[0];
    let anchor = countryAnchor(world, best.iso);
    if (params.regionAnchor === 'neighbours') {
      const inCountry = refs.filter((r) => refIso(world, r) === best.iso);
      if (inCountry.length > 0) {
        const m = voteModes(inCountry, { kernelsKm: [250], kernelMix: [1], mergeKm: params.mergeKm })[0];
        if (m) anchor = { lat: m.lat, lon: m.lon };
      }
    }
    if (anchor) {
      level = 'country';
      radiusTier = 'country';
      radiusBaseKm = regionRadiusKm(world, best.iso);
      visual = {
        lat: anchor.lat,
        lon: anchor.lon,
        radiusKm: regionRadiusKm(world, best.iso) * params.radiusKm.countryFactor,
        confidence: confidenceOf('country'),
        method: 'region',
        label: world.country(best.iso)?.name_de ?? best.name,
        country: best.iso,
        countryName: best.name,
      };
      method = 'region';
    }
  } else if (continents[0] && continents[0].p >= params.continentMinP) {
    // No country stands out: only the continent is claimed, with a matching radius.
    const info = world.continent(continents[0].code);
    if (info) {
      level = 'continent';
      radiusTier = 'continent';
      radiusBaseKm = info.radiusKm;
      visual = {
        lat: info.lat,
        lon: info.lon,
        radiusKm: info.radiusKm * params.radiusKm.continentFactor,
        confidence: confidenceOf('continent'),
        method: 'region',
        label: info.name_de,
        country: null,
        countryName: null,
      };
      method = 'region';
    }
  }

  // ---- evidence: reference matches
  const topRefs = [...refs].sort((a, b) => b.bestSimilarity - a.bestSimilarity).slice(0, 3);
  const totalWeight = refs.reduce((s, r) => s + r.weight, 0);
  for (const r of topRefs) {
    const distance = visual ? greatCircleKm(visual.lat, visual.lon, r.lat, r.lon) : null;
    const frame = ev.frameNumbers[pooled.frameOfRow[r.bestRow] ?? r.bestRow];
    evidence.push({
      kind: 'landmark',
      label: `Referenzbild: ${r.label} (${fmt(r.bestSimilarity)})`,
      detail: `Bild ${frame ?? r.bestRow + 1} gleicht dem Referenzbild mit Kosinus ${fmt(r.bestSimilarity)}${
        distance !== null ? `; ${distance < 1 ? 'am Ergebnisort' : `${Math.round(distance)} km vom Ergebnis`}` : ''
      }. ${r.bestSimilarity >= params.landmarkSimilarity ? 'Das ist eine Wiedererkennung.' : r.bestSimilarity >= params.regionThreshold ? 'Ähnlichkeit, keine sichere Wiedererkennung.' : 'Schwache Ähnlichkeit, zählt kaum.'}`,
      weight: totalWeight > 0 ? r.weight / totalWeight : 0,
      ...(frame !== undefined ? { frame } : {}),
      refImage: galleryImageUrl(r.id),
      refLabel: r.label,
      refLat: r.lat,
      refLon: r.lon,
      similarity: r.bestSimilarity,
    });
  }

  // ---- evidence: zero-shot country prior
  const top3 = zeroShot.slice(0, 3);
  if (top3.length > 0) {
    evidence.push({
      kind: 'region',
      label: `Länderschätzung: ${top3.map((c) => `${c.name} ${pct(c.p)}`).join(', ')}`,
      detail: `Zero-shot-Vergleich der Bilder mit Beschreibungen aller Länder (Straßen, Landschaft, Gebäude), mit einem milden Bevölkerungsprior. Zusammen mit den Ländern der ähnlichsten Referenzbilder: ${countries
        .slice(0, 3)
        .map((c) => `${c.name} ${pct(c.p)}`)
        .join(', ')}. Wirkt als weiche Gewichtung der Kandidaten; ohne passendes Referenzbild trägt es das Ergebnis allein (Land nur ab ${pct(params.countryMinP)}, sonst Kontinent oder kein Ort).`,
      weight: method === 'region' ? (top3[0] as CountryProb).p : (top3[0] as CountryProb).p * 0.3,
    });
  }

  // ---- evidence: file name
  const hints = ev.hints;
  if (hints && (hints.date || hints.place)) {
    const parts = [hints.date ? `Datum ${hints.date}` : null, hints.place ? `„${hints.place}“` : null].filter(Boolean);
    evidence.push({
      kind: 'filename',
      label: `Dateiname: ${parts.join(', ')}`,
      detail: 'Angaben im Dateinamen können vom Absender stammen und falsch sein; sie fließen nicht in die Ortsbestimmung ein.',
      weight: 0.05,
    });
  }

  const location = metaLocation ?? visual;
  return {
    location,
    candidates,
    countries,
    evidence,
    diagnostics: {
      features: features(level),
      level: visual ? level : null,
      radiusTier: visual ? radiusTier : null,
      radiusBaseKm,
      countryTop: countries[0] ? { iso: countries[0].iso, p: countries[0].p } : null,
      continentTop: continents[0] ?? null,
      topSimilarity,
      margin,
      share,
      method: metaLocation ? 'metadata' : method,
      visual,
      zeroShotTop: zeroShot.slice(0, 5),
    },
  };
}

/** Determines where a video was recorded from its frames, its file tags and its name. */
export async function locate(input: LocateInput): Promise<LocateResult> {
  const params: LocateParams = { ...DEFAULT_LOCATE_PARAMS, ...input.params };
  const world = input.world ?? (await loadWorld());
  const [metadata, countryCosines] = await Promise.all([
    readMetadata(input.videoPath).catch(() => null),
    world.countryCosines(input.frameVectors, input.dim, input.embedTexts),
  ]);
  const search = { ...(input.excludeWikidata ? { excludeWikidata: input.excludeWikidata } : {}) };
  const hints = filenameHints(input.fileName ?? path.basename(input.videoPath));
  const tiles = params.tilePooling !== 'whole' ? input.tiles : undefined;
  if (tiles && tiles.frameRow.length > 0) {
    const neighbours = input.gallery.search(tiles.vectors, params.k, search);
    return decideLocation(
      world,
      { neighbours, rowFrame: tiles.frameRow, rowTile: tiles.tile, countryCosines, frameNumbers: input.frameNumbers, metadata, hints },
      params,
    );
  }
  const neighbours = input.gallery.search(input.frameVectors, params.k, search);
  return decideLocation(world, { neighbours, countryCosines, frameNumbers: input.frameNumbers, metadata, hints }, params);
}

// ------------------------------------------------------------------ frame sampling

export interface SampledFrames {
  vectors: Float32Array;
  dim: number;
  frameNumbers: number[];
  times: number[];
  /** Tile vectors with the pipeline's tiling (only when opts.detail is not 'fast'). */
  tiles?: { vectors: Float32Array; frameRow: number[]; tile: number[] };
}

function runFfmpeg(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (c: string) => {
      if (stderr.length < 20_000) stderr += c;
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`ffmpeg timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg: ${stderr.trim().split('\n').slice(-2).join(' | ') || `exit ${code}`}`));
    });
  });
}

/**
 * Takes `count` evenly spaced frames (at the middle of equal segments), embeds the whole frame
 * with the same preprocessing as the pipeline and the gallery, and returns the vectors.
 */
export async function sampleAndEmbedFrames(
  videoPath: string,
  model: ImageEmbedder,
  opts: { count?: number; durationSec?: number | null; fps?: number | null; tmpDir?: string; detail?: DetailLevel } = {},
): Promise<SampledFrames> {
  const detail = opts.detail ?? 'fast';
  const count = opts.count ?? 6;
  let duration = opts.durationSec ?? null;
  let fps = opts.fps ?? null;
  if (duration === null || fps === null) {
    const meta = await readMetadata(videoPath).catch(() => null);
    duration ??= meta?.durationSec ?? null;
    fps ??= meta?.fps ?? null;
  }
  const times = Array.from({ length: count }, (_, i) => (duration !== null ? (duration * (i + 0.5)) / count : i));
  const dir = await fs.mkdtemp(path.join(opts.tmpDir ?? os.tmpdir(), 'datum-frames-'));
  try {
    const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y'];
    for (const t of times) args.push('-ss', t.toFixed(3), '-protocol_whitelist', 'file', '-i', videoPath);
    times.forEach((_, i) => {
      args.push(
        '-map', `${i}:v:0`,
        '-frames:v', '1',
        '-an', '-sn',
        '-vf', `scale=w='min(${FRAME_WIDTH},iw)':h=-2:flags=bicubic`,
        '-pix_fmt', 'yuvj420p',
        '-q:v', '3',
        path.join(dir, `f${i}.jpg`),
      );
    });
    await runFfmpeg(args, 120_000);
    const size = model.imageSize;
    const plane = 3 * size * size;
    const kept: number[] = [];
    // Every tile of every readable frame, whole frame first (the pipeline's layout).
    const rects: { frameRow: number; tile: number; pixels: Float32Array }[] = [];
    for (let i = 0; i < count; i++) {
      try {
        const decoded = await decodeFrame(path.join(dir, `f${i}.jpg`));
        const layout: PixelRect[] = tileLayout(decoded.width, decoded.height, detail);
        for (const [t, rect] of layout.entries()) {
          const px = new Float32Array(plane);
          await writeTile(decoded, rect, size, model.imageMean, model.imageStd, px, 0);
          rects.push({ frameRow: kept.length, tile: t, pixels: px });
        }
        kept.push(i);
      } catch {
        // A seek past the last frame writes no picture.
      }
    }
    if (kept.length === 0) throw new Error('Aus dem Video konnten keine Bilder gelesen werden.');
    const all = new Float32Array(rects.length * plane);
    rects.forEach((r, j) => all.set(r.pixels, j * plane));
    const tileVectors = await model.embedPixels(all, rects.length);
    const dim = model.dim;
    const vectors = new Float32Array(kept.length * dim);
    rects.forEach((r, j) => {
      if (r.tile === 0) vectors.set(tileVectors.subarray(j * dim, (j + 1) * dim), r.frameRow * dim);
    });
    return {
      vectors,
      dim,
      frameNumbers: kept.map((i) => (fps !== null ? Math.round((times[i] as number) * fps) : i)),
      times: kept.map((i) => times[i] as number),
      ...(detail !== 'fast'
        ? { tiles: { vectors: tileVectors, frameRow: rects.map((r) => r.frameRow), tile: rects.map((r) => r.tile) } }
        : {}),
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
