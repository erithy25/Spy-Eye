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
 *   4. World model (GeoCLIP, see geoclip.ts) — the frames scored against 100 000 places on Earth.
 *      Where it puts almost none of its probability near the gallery's answer (less than
 *      geoclip.minAgree within geoclip.agreeKm), its own best point becomes the answer; otherwise
 *      the gallery's answer stays and GeoCLIP confirms it. It reaches places the gallery has no
 *      picture of, which is where the gallery alone fails.
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
import { massWithin, type GeoclipPrediction } from './geoclip.js';
import { filenameHints, readMetadata, type FilenameHints, type VideoMetadata } from './metadata.js';
import { frameStatsFromJpeg, type FrameStats } from './time.js';
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
   * probability of the chosen country (or continent); with the world model also an indicator of
   * its answer, how concentrated it is, and how much of its mass confirms a gallery answer.
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
    worldModel: number;
    concentration: number;
    agreeMass: number;
  };
  /**
   * Fusion with the world model (the "agree" recipe of scripts/datum/evaluateGeoclip.ts, chosen
   * on the train half: docs/measurements/datum-geoclip.json).
   */
  geoclip: {
    /** The gallery's answer stands when GeoCLIP puts at least minAgree of its mass within agreeKm of it. */
    agreeKm: number;
    minAgree: number;
    /** Tiers of the gallery's answer that GeoCLIP may replace (no answer at all counts as 'continent'). */
    replaceTiers: readonly RadiusTier[];
    /** GeoCLIP's mass within this distance of its answer is its concentration (sets the radius). */
    concentrationKm: number;
    /** Stated radius of a GeoCLIP answer by concentration, strongest first; the last starts at 0. */
    radius: readonly { minConcentration: number; radiusKm: number }[];
    /** GeoCLIP's modes join the candidates when farther than this from every candidate (km). */
    candidateKm: number;
    /** Most GeoCLIP modes added to the candidates, and the least mass a mode needs for it. */
    candidateModes: number;
    candidateMinMass: number;
    /**
     * The confidence model used when a prediction is there (fitted on the fused train answers).
     * Without one (no weights, gallery still being built) the gallery's own model above applies,
     * which was fitted without GeoCLIP: each is calibrated for the situation it was fitted in.
     */
    confidence: LocateParams['confidence'];
  };
}

/**
 * Tuned on the even-indexed half of the DATUM test videos (scripts/datum/evaluate.ts); the odd
 * half was only used to report the result. See docs/measurements/datum-geolocation.json.
 */
export const DEFAULT_LOCATE_PARAMS: LocateParams = {
  k: 30,
  simOffset: 0.6,
  simTemperature: 0.08,
  kernelsKm: [2, 25, 250],
  kernelMix: [0.5, 0.3, 0.2],
  mergeKm: 5,
  priorExponent: 0.5,
  regionThreshold: 0.8,
  gapThreshold: 0,
  recognitionGap: 0.07,
  landmarkSimilarity: 0.75,
  countryVoteWeight: 1,
  regionAnchor: 'neighbours',
  countryMinP: 0.35,
  continentMinP: 0.05,
  maxCandidates: 8,
  tilePooling: 'rows',
  frameAggregation: 'max',
  strongGap: 0.1,
  agreementMin: 0,
  radiusKm: { strong: 3, recognised: 7500, similar: 1500, countryFactor: 3, continentFactor: 1 },
  prior: DEFAULT_PRIOR_PARAMS,
  confidence: {
    bias: 0.157,
    topSim: 0.295,
    gap: -0.077,
    margin: -0.596,
    share: 0.324,
    region: 1.086,
    continent: -0.952,
    countryP: 1.328,
    agreement: -0.119,
    worldModel: 0,
    concentration: 0,
    agreeMass: 0,
  },
  geoclip: {
    agreeKm: 200,
    minAgree: 0.05,
    replaceTiers: ['strong', 'recognised', 'similar', 'country', 'continent'],
    concentrationKm: 25,
    radius: [
      { minConcentration: 0.2, radiusKm: 25 },
      { minConcentration: 0, radiusKm: 1500 },
    ],
    candidateKm: 25,
    candidateModes: 3,
    candidateMinMass: 0.02,
    confidence: {
      bias: 1.572,
      topSim: 0.333,
      gap: -0.015,
      margin: -0.56,
      share: 0.052,
      region: 0.237,
      continent: 0,
      countryP: 0.335,
      agreement: -0.589,
      worldModel: -0.939,
      concentration: 0.123,
      agreeMass: 1.011,
    },
  },
};

/** Stated radius of a world-model answer of the given concentration (see LocateParams.geoclip). */
export function worldModelRadiusKm(tiers: LocateParams['geoclip']['radius'], concentration: number): number {
  for (const t of tiers) if (concentration >= t.minConcentration) return t.radiusKm;
  return tiers[tiers.length - 1]?.radiusKm ?? 1500;
}

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
  /** The file's tags when the caller has read them already (null: none); read from the file otherwise. */
  metadata?: VideoMetadata | null;
  /**
   * The world model's prediction for the same frames (compact, see compactPrediction), or a
   * promise of it: it is awaited only after the gallery search, so the two run side by side
   * (the world model in its thread, the search on this one). null or absent: without it.
   */
  geoclip?: GeoclipPrediction | null | Promise<GeoclipPrediction | null>;
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
  /** Granularity of the visual answer ('worldmodel': GeoCLIP's point); null when there is none. */
  level: 'landmark' | 'country' | 'continent' | 'worldmodel' | null;
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
  method: 'metadata' | 'landmark' | 'region' | 'worldmodel' | 'none';
  /** The visual estimate (after the world model), also when metadata decided the location. */
  visual: FixLocation | null;
  /** The gallery's own answer, before the world model had its say. */
  gallery: FixLocation | null;
  /** What the world model did; null without a prediction. */
  worldModel: {
    /** Whether its point replaced the gallery's answer. */
    replaced: boolean;
    /** Its mass within agreeKm of the gallery's answer (0 without one). */
    agreeMass: number;
    /** Its mass within concentrationKm of its own answer. */
    concentration: number;
    /** Mass of its strongest mode. */
    modeMass: number;
    best: { lat: number; lon: number };
  } | null;
  zeroShotTop: CountryProb[];
}

/** One gallery reference with the evidence the frames give it. */
export interface WeightedRef {
  id: string;
  /** German name of the place. */
  label: string;
  /** English name of the place (absent where the neighbour had none: then label). */
  labelEn?: string;
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
/** Pictures per call of the image model when frames are sampled (see sampleAndEmbedFrames). */
const EMBED_CHUNK = 8;

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
          byId.set(n.id, { id: n.id, label: n.label, labelEn: n.labelEn ?? n.label, lat: n.lat, lon: n.lon, country: n.country, weight: 0, bestSimilarity: n.similarity, bestRow: r });
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
          labelEn: n.labelEn ?? n.label,
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

/** Evidence tier of the stated radius; 'worldmodel' for an answer of GeoCLIP's (see LocateParams.geoclip). */
export type RadiusTier = 'strong' | 'recognised' | 'similar' | 'country' | 'continent' | 'worldmodel';

/**
 * Distance (km) within which a reference counts as being at the answer: a frame whose best match
 * lies this close agrees with it (frameAgreement, which decides the 'strong' radius tier), and the
 * evidence calls only a reference this close a recognition of the place found (referenceStrength).
 */
export const AGREEMENT_KM = 25;

/** Share of the rows whose best match lies within `km` of a point. */
export function frameAgreement(rows: readonly GalleryNeighbour[][], lat: number, lon: number, km = AGREEMENT_KM): number {
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
  /** 1 when the answer is the world model's point. */
  worldModel: number;
  /** For a world-model answer: its mass within concentrationKm of the answer; else 0. */
  concentration: number;
  /** For a gallery answer the world model confirmed: its mass within agreeKm of it; else 0. */
  agreeMass: number;
}

/** The feature names of the confidence model, in a fixed order (fit and report). */
export const CONFIDENCE_FEATURES = ['topSim', 'gap', 'margin', 'share', 'region', 'continent', 'countryP', 'agreement', 'worldModel', 'concentration', 'agreeMass'] as const;

/** P(true place within the radius), clamped: nothing visual is ever certain. */
export function confidenceFrom(f: ConfidenceFeatures, c: LocateParams['confidence']): number {
  let z = c.bias;
  for (const k of CONFIDENCE_FEATURES) z += c[k] * f[k];
  return Math.min(0.95, Math.max(0.02, sigmoid(z)));
}

// Every text of a fix is written twice, German and English (Evidence.label/labelEn and
// detail/detailEn), so that the console never mixes the two languages.
const fmt = (v: number, digits = 2): string => v.toFixed(digits).replace('.', ',');
const fmtEn = (v: number, digits = 2): string => v.toFixed(digits);
const pct = (p: number): string => `${Math.round(p * 100)} %`;
const pctEn = (p: number): string => `${Math.round(p * 100)}%`;

function formatCoord(lat: number, lon: number): string {
  return `${fmt(Math.abs(lat), 4)}° ${lat >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(lon), 4)}° ${lon >= 0 ? 'O' : 'W'}`;
}

function formatCoordEn(lat: number, lon: number): string {
  return `${fmtEn(Math.abs(lat), 4)}° ${lat >= 0 ? 'N' : 'S'}, ${fmtEn(Math.abs(lon), 4)}° ${lon >= 0 ? 'E' : 'W'}`;
}

/** A name in both languages. */
export interface Named {
  de: string;
  en: string;
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
  /** The world model's prediction for the same frames; null or absent: without it. */
  geoclip?: GeoclipPrediction | null;
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

/**
 * Name of a place in both languages: the landmark with its city, else the city, else the
 * country, else the coordinates. The landmark comes with its German and English name (the
 * reference gallery has both, see scripts/datum/fetchLabels.ts), so that a fix reads
 * "Nowodewitschi-Kloster, Moskau" and "Novodevichy Convent, Moscow" instead of mixing them; a
 * single string is used for both (a name without a translation).
 */
export function placeLabel(world: World, lat: number, lon: number, landmark: Named | string | null): Named {
  const city = world.nearestCity(lat, lon, { maxKm: 60 });
  const mark = typeof landmark === 'string' ? { de: landmark, en: landmark } : landmark;
  if (mark && city) {
    return {
      de: mark.de.includes(city.name) ? mark.de : `${mark.de}, ${city.name}`,
      en: mark.en.includes(city.nameEn) || mark.en.includes(city.name) ? mark.en : `${mark.en}, ${city.nameEn}`,
    };
  }
  if (mark) return { de: mark.de, en: mark.en };
  if (city) return city.distanceKm < 5 ? { de: city.name, en: city.nameEn } : { de: `bei ${city.name}`, en: `near ${city.nameEn}` };
  const country = world.countryNear(lat, lon);
  return country ? { de: country.name_de, en: country.name_en } : { de: formatCoord(lat, lon), en: formatCoordEn(lat, lon) };
}

/** A reference picture's place name in both languages. */
function refName(ref: Pick<WeightedRef, 'label' | 'labelEn'>): Named {
  return { de: ref.label, en: ref.labelEn ?? ref.label };
}

/**
 * How the evidence describes one reference picture: where it lies relative to the answer
 * (`where`, appended to the sentence on the similarity) and what its similarity means
 * (`strength`). Only a reference at the answer, within AGREEMENT_KM (the distance at which the
 * decision counts a match as agreeing with the answer), is called a recognition. One as similar
 * but farther away is a similar-looking place elsewhere, not a recognition of the place found:
 * "316 km vom Ergebnis. Das ist eine Wiedererkennung." contradicted the answer it stood under.
 */
export function referenceStrength(
  similarity: number,
  distanceKm: number | null,
  params: Pick<LocateParams, 'landmarkSimilarity' | 'regionThreshold'>,
  answerSure = true,
): { where: Named; strength: Named } {
  const km = distanceKm === null ? 0 : Math.round(distanceKm);
  // Decided on the distance as the text shows it: 25.3 km must not read "25 km … keine
  // Wiedererkennung" when 25.0 km reads "25 km … Das ist eine Wiedererkennung".
  const far = distanceKm !== null && km > AGREEMENT_KM;
  // "ähnlich, aber" only for a reference that is similar at all: a weak one far away is just far
  // ("ähnlich, aber 316 km … Schwache Ähnlichkeit" contradicted itself).
  const similar = similarity >= params.regionThreshold;
  const where: Named =
    distanceKm === null
      ? { de: '', en: '' }
      : distanceKm < 1
        ? { de: '; am Ergebnisort', en: '; at the place found' }
        : far && similar
          ? { de: `; ähnlich, aber ${km} km vom Ergebnis entfernt`, en: `; similar, but ${km} km from the result` }
          : { de: `; ${km} km vom Ergebnis`, en: `; ${km} km from the result` };
  // Not "keine Wiedererkennung" outright: the far reference may be the true place and the answer
  // the wrong one (seen on the reference set: "Dorfkirche Rieben", 0.87, 994 km from a wrong
  // answer). What holds either way is that it does not recognise the place found.
  const lookAlike: Named = {
    de: 'Ein ähnlich aussehender Ort anderswo, keine Wiedererkennung des gefundenen Orts.',
    en: 'A similar-looking place elsewhere, not a recognition of the place found.',
  };
  // Without a place found nothing is recognised: a recognition is one of the place found.
  const atResult = distanceKm !== null && !far;
  const strength: Named =
    similarity >= params.landmarkSimilarity
      ? atResult
        ? answerSure
          ? { de: 'Das ist eine Wiedererkennung.', en: 'That is a recognition.' }
          : // The picture that produced the answer is at the answer by construction; whether that
            // is a recognition is the decision's to say, and it did not (a wide radius).
            { de: 'Sehr ähnlich, hebt sich aber nicht deutlich genug ab: keine sichere Wiedererkennung.', en: 'Very similar, but it does not stand out clearly enough: not a sure recognition.' }
        : far
          ? lookAlike
          : { de: 'Sehr ähnlich, aber ohne gefundenen Ort keine Wiedererkennung.', en: 'Very similar, but with no place found it is not a recognition.' }
      : similar
        ? far
          ? lookAlike
          : { de: 'Ähnlichkeit, keine sichere Wiedererkennung.', en: 'A resemblance, not a sure recognition.' }
        : { de: 'Schwache Ähnlichkeit, zählt kaum.', en: 'A weak resemblance; it hardly counts.' };
  return { where, strength };
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
  const countryNameEn = (c: CountryProb): string => world.country(c.iso)?.name_en ?? c.iso;

  // ---- metadata
  const meta = ev.metadata;
  let metaLocation: FixLocation | null = null;
  if (meta?.location) {
    const { lat, lon } = meta.location;
    const country = world.countryNear(lat, lon);
    const name = placeLabel(world, lat, lon, null);
    metaLocation = {
      lat,
      lon,
      radiusKm: 0.05,
      confidence: 0.98,
      method: 'metadata',
      label: name.de,
      labelEn: name.en,
      country: country?.iso ?? null,
      countryName: country?.name_de ?? null,
    };
    evidence.push({
      kind: 'metadata',
      label: `GPS in der Datei: ${formatCoord(lat, lon)}`,
      labelEn: `GPS in the file: ${formatCoordEn(lat, lon)}`,
      detail: `Die Videodatei trägt eine Positionsangabe (ISO 6709${meta.altitude !== null ? `, Höhe ${Math.round(meta.altitude)} m` : ''}${meta.device ? `, Gerät ${meta.device}` : ''}); sie wird als Ort übernommen, sofern sie nicht nachträglich verändert wurde.`,
      detailEn: `The video file carries a position (ISO 6709${meta.altitude !== null ? `, altitude ${Math.round(meta.altitude)} m` : ''}${meta.device ? `, device ${meta.device}` : ''}); it is taken as the place unless it was altered afterwards.`,
      weight: 0.98,
    });
  }
  if (meta && (meta.creationUtc !== null || meta.creationRejected)) {
    const stamp = meta.creationUtc !== null ? new Date(meta.creationUtc).toISOString().slice(0, 16).replace('T', ' ') : '';
    evidence.push(
      meta.creationUtc !== null
        ? {
            kind: 'metadata',
            label: `Aufnahmezeit laut Datei: ${stamp} UTC`,
            labelEn: `Recording time according to the file: ${stamp} UTC`,
            detail: `Zeitstempel aus den Container-Angaben${meta.device ? ` (${meta.device})` : ''}; er trägt nicht zum Ort bei.`,
            detailEn: `Timestamp from the container tags${meta.device ? ` (${meta.device})` : ''}; it does not contribute to the place.`,
            weight: 0,
          }
        : {
            kind: 'metadata',
            label: 'Zeitstempel der Datei verworfen',
            labelEn: 'Timestamp of the file rejected',
            detail: `Der eingetragene Zeitpunkt ist unplausibel: ${meta.creationRejected}.`,
            detailEn: `The recorded moment is implausible: ${meta.creationRejectedEn ?? meta.creationRejected}.`,
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

  let candidates: FixCandidate[] = scored.slice(0, params.maxCandidates).map((c) => {
    const spread = weightedSpreadKm(
      c.mode.members.map((j) => refs[j] as WeightedRef),
      c.mode.lat,
      c.mode.lon,
      params.mergeKm,
    );
    const name = placeLabel(world, c.mode.lat, c.mode.lon, refName(c.lead));
    return {
      lat: c.mode.lat,
      lon: c.mode.lon,
      label: name.de,
      labelEn: name.en,
      country: c.iso,
      score: totalScore > 0 ? c.score / totalScore : 0,
      radiusKm: Math.max(0.5, spread),
    };
  });

  const continents = continentPosterior(world, countries);
  let agreement = 0;
  // Set by the world model below (0 without it, which leaves the model as it was before it).
  let agreeMass = 0;
  let concentration = 0;
  const features = (level: 'landmark' | 'country' | 'continent' | 'worldmodel'): ConfidenceFeatures => ({
    topSim: topSimilarity,
    gap: topGap,
    margin,
    share,
    region: level === 'country' ? 1 : 0,
    continent: level === 'continent' ? 1 : 0,
    countryP: level === 'continent' ? (continents[0]?.p ?? 0) : (countries[0]?.p ?? 0),
    agreement,
    worldModel: level === 'worldmodel' ? 1 : 0,
    concentration: level === 'worldmodel' ? concentration : 0,
    agreeMass: level === 'worldmodel' ? 0 : agreeMass,
  });
  let radiusTier: RadiusTier | null = null;
  let radiusBaseKm = 0;
  let level: 'landmark' | 'country' | 'continent' | 'worldmodel' = 'landmark';
  // The gallery's own confidence model; the fused one once the world model has had its say.
  let confidenceModel = params.confidence;
  const confidenceOf = (l: typeof level): number => confidenceFrom(features(l), confidenceModel);

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
    const name = placeLabel(world, first.mode.lat, first.mode.lon, refName(first.lead));
    visual = {
      lat: first.mode.lat,
      lon: first.mode.lon,
      radiusKm,
      confidence: confidenceOf('landmark'),
      method: 'landmark',
      label: name.de,
      labelEn: name.en,
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
        labelEn: world.country(best.iso)?.name_en ?? best.name,
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
        labelEn: info.name_en,
        country: null,
        countryName: null,
      };
      method = 'region';
    }
  }

  // ---- world model (GeoCLIP)
  const galleryAnswer = visual;
  const geo = ev.geoclip ?? null;
  let countriesOut = countries;
  let worldModel: LocateDiagnostics['worldModel'] = null;
  if (geo && geo.top.length > 0) {
    const gp = params.geoclip;
    const best = geo.best;
    const modeMass = geo.modes[0]?.p ?? 0;
    agreeMass = galleryAnswer ? massWithin(geo, galleryAnswer.lat, galleryAnswer.lon, gp.agreeKm) : 0;
    concentration = massWithin(geo, best.lat, best.lon, gp.concentrationKm);
    confidenceModel = gp.confidence;
    // No gallery answer at all is the weakest case there is ('continent' in the recipe's terms).
    const replaceable = gp.replaceTiers.includes(radiusTier ?? 'continent');
    const replaced = replaceable && (!galleryAnswer || agreeMass < gp.minAgree);
    worldModel = { replaced, agreeMass, concentration, modeMass, best: { lat: best.lat, lon: best.lon } };
    const name = placeLabel(world, best.lat, best.lon, null);
    if (replaced) {
      const at = world.countryNear(best.lat, best.lon);
      level = 'worldmodel';
      radiusTier = 'worldmodel';
      const radiusKm = worldModelRadiusKm(gp.radius, concentration);
      radiusBaseKm = radiusKm;
      method = 'worldmodel';
      // The country distribution of the answer is GeoCLIP's (gallery mass per country).
      if (geo.countries.length > 0) countriesOut = geo.countries;
      const iso = at?.iso ?? countriesOut[0]?.iso ?? null;
      visual = {
        lat: best.lat,
        lon: best.lon,
        radiusKm,
        confidence: confidenceOf('worldmodel'),
        method: 'worldmodel',
        label: name.de,
        labelEn: name.en,
        country: iso,
        countryName: iso ? (world.country(iso)?.name_de ?? iso) : null,
      };
    } else if (galleryAnswer) {
      // The gallery's answer stands; how much of GeoCLIP's mass confirms it enters its confidence.
      visual = { ...galleryAnswer, confidence: confidenceOf(level) };
    }
    candidates = withWorldModelCandidates(world, candidates, geo, params, replaced, worldModelRadiusKm(gp.radius, concentration));

    const coords: Named = { de: formatCoord(best.lat, best.lon), en: formatCoordEn(best.lat, best.lon) };
    const agreeText: Named = !galleryAnswer
      ? { de: 'Die Referenzgalerie gab keinen Ort; das Weltmodell gibt ihn.', en: 'The reference gallery gave no place; the world model gives it.' }
      : replaced
        ? {
            de: `Nur ${pct(agreeMass)} seiner Wahrscheinlichkeit liegen im Umkreis von ${gp.agreeKm} km um das Ergebnis der Referenzgalerie (${galleryAnswer.label}); es ersetzt dieses Ergebnis.`,
            en: `Only ${pctEn(agreeMass)} of its probability lies within ${gp.agreeKm} km of the reference gallery's result (${galleryAnswer.labelEn ?? galleryAnswer.label}); it replaces that result.`,
          }
        : replaceable
          ? {
              de: `${pct(agreeMass)} seiner Wahrscheinlichkeit liegen im Umkreis von ${gp.agreeKm} km um das Ergebnis der Referenzgalerie (${galleryAnswer.label}); es bestätigt dieses Ergebnis, das bestehen bleibt.`,
              en: `${pctEn(agreeMass)} of its probability lies within ${gp.agreeKm} km of the reference gallery's result (${galleryAnswer.labelEn ?? galleryAnswer.label}); it confirms that result, which stands.`,
            }
          : {
              de: `${pct(agreeMass)} seiner Wahrscheinlichkeit liegen im Umkreis von ${gp.agreeKm} km um das Ergebnis der Referenzgalerie; deren Ergebnis ist zu stark, um ersetzt zu werden, und bleibt.`,
              en: `${pctEn(agreeMass)} of its probability lies within ${gp.agreeKm} km of the reference gallery's result; that result is too strong to be replaced and stands.`,
            };
    const metaText: Named = metaLocation
      ? { de: ' Die GPS-Angabe der Datei bestimmt den Ort.', en: ' The GPS position in the file decides the place.' }
      : { de: '', en: '' };
    evidence.push({
      kind: 'worldmodel',
      label: `Weltmodell (GeoCLIP): ${name.de} (${pct(modeMass)})`,
      labelEn: `World model (GeoCLIP): ${name.en} (${pctEn(modeMass)})`,
      detail: `Die ${geo.frames} Bilder wurden mit 100 000 Orten der Erde verglichen (GeoCLIP). Bester Ort: ${name.de} (${coords.de}); seine stärkste Häufung trägt ${pct(modeMass)} der Wahrscheinlichkeit, ${pct(concentration)} liegen im Umkreis von ${gp.concentrationKm} km. ${agreeText.de}${metaText.de}`,
      detailEn: `The ${geo.frames} frames were compared with 100,000 places on Earth (GeoCLIP). Best place: ${name.en} (${coords.en}); its strongest cluster carries ${pctEn(modeMass)} of the probability, ${pctEn(concentration)} lies within ${gp.concentrationKm} km. ${agreeText.en}${metaText.en}`,
      // Its share of the decision: the answer itself when it replaced the gallery's, a
      // confirmation as strong as the mass it puts there when it agreed.
      weight: metaLocation ? 0.05 : replaced ? Math.min(0.9, 0.5 + 0.4 * Math.max(modeMass, concentration)) : Math.min(0.6, 0.1 + 0.5 * agreeMass),
      refLabel: name.de,
      refLabelEn: name.en,
      refLat: best.lat,
      refLon: best.lon,
    });
  }

  // ---- evidence: reference matches
  const topRefs = [...refs].sort((a, b) => b.bestSimilarity - a.bestSimilarity).slice(0, 3);
  const totalWeight = refs.reduce((s, r) => s + r.weight, 0);
  // Distances to the place the fix states: the GPS position of the file where it has one (it
  // decides the place, see `location` below), else the visual answer (the world model's where it
  // replaced the gallery's).
  const stated = metaLocation ?? visual;
  // A reference at the answer is a recognition only when the answer itself is sure: the file's
  // GPS, or a landmark that stands out from its neighbours ('strong'). Under a wider tier the
  // reference that produced the answer lies at it by construction, which proves nothing.
  const answerSure = metaLocation !== null || radiusTier === 'strong';
  for (const r of topRefs) {
    const distance = stated ? greatCircleKm(stated.lat, stated.lon, r.lat, r.lon) : null;
    const frame = ev.frameNumbers[pooled.frameOfRow[r.bestRow] ?? r.bestRow];
    const said = referenceStrength(r.bestSimilarity, distance, params, answerSure);
    evidence.push({
      kind: 'landmark',
      label: `Referenzbild: ${r.label} (${fmt(r.bestSimilarity)})`,
      labelEn: `Reference picture: ${r.labelEn ?? r.label} (${fmtEn(r.bestSimilarity)})`,
      detail: `Bild ${frame ?? r.bestRow + 1} gleicht dem Referenzbild mit Kosinus ${fmt(r.bestSimilarity)}${said.where.de}. ${said.strength.de}`,
      detailEn: `Frame ${frame ?? r.bestRow + 1} resembles the reference picture with a cosine of ${fmtEn(r.bestSimilarity)}${said.where.en}. ${said.strength.en}`,
      weight: totalWeight > 0 ? r.weight / totalWeight : 0,
      ...(frame !== undefined ? { frame } : {}),
      refImage: galleryImageUrl(r.id),
      refLabel: r.label,
      // The English console names the reference by this one (refLabel is the German name).
      refLabelEn: r.labelEn ?? r.label,
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
      labelEn: `Country estimate: ${top3.map((c) => `${countryNameEn(c)} ${pctEn(c.p)}`).join(', ')}`,
      detail: `Zero-shot-Vergleich der Bilder mit Beschreibungen aller Länder (Straßen, Landschaft, Gebäude), mit einem milden Bevölkerungsprior. Zusammen mit den Ländern der ähnlichsten Referenzbilder: ${countries
        .slice(0, 3)
        .map((c) => `${c.name} ${pct(c.p)}`)
        .join(', ')}. Wirkt als weiche Gewichtung der Kandidaten; ohne passendes Referenzbild trägt es das Ergebnis allein (Land nur ab ${pct(params.countryMinP)}, sonst Kontinent oder kein Ort).`,
      detailEn: `Zero-shot comparison of the frames with descriptions of every country (streets, landscape, buildings), with a mild population prior. Combined with the countries of the most similar reference pictures: ${countries
        .slice(0, 3)
        .map((c) => `${countryNameEn(c)} ${pctEn(c.p)}`)
        .join(', ')}. It weights the candidates softly; without a matching reference picture it carries the result alone (a country only from ${pctEn(params.countryMinP)}, otherwise a continent or no place).`,
      weight: method === 'region' ? (top3[0] as CountryProb).p : (top3[0] as CountryProb).p * 0.3,
    });
  }

  // ---- evidence: file name
  const hints = ev.hints;
  if (hints && (hints.date || hints.place)) {
    const parts = [hints.date ? `Datum ${hints.date}` : null, hints.place ? `„${hints.place}“` : null].filter(Boolean);
    const partsEn = [hints.date ? `date ${hints.date}` : null, hints.place ? `“${hints.place}”` : null].filter(Boolean);
    evidence.push({
      kind: 'filename',
      label: `Dateiname: ${parts.join(', ')}`,
      labelEn: `File name: ${partsEn.join(', ')}`,
      detail: 'Angaben im Dateinamen können vom Absender stammen und falsch sein; sie fließen nicht in die Ortsbestimmung ein.',
      detailEn: 'What the file name says may come from the sender and may be wrong; it does not enter the localisation.',
      weight: 0.05,
    });
  }

  const location = metaLocation ?? visual;
  return {
    location,
    candidates,
    countries: countriesOut,
    evidence,
    diagnostics: {
      features: features(level),
      level: visual ? level : null,
      radiusTier: visual ? radiusTier : null,
      radiusBaseKm,
      // The gallery's posterior: the cut-offs of country-level answers are tuned on it.
      countryTop: countries[0] ? { iso: countries[0].iso, p: countries[0].p } : null,
      continentTop: continents[0] ?? null,
      topSimilarity,
      margin,
      share,
      method: metaLocation ? 'metadata' : method,
      visual,
      gallery: galleryAnswer,
      worldModel,
      zeroShotTop: zeroShot.slice(0, 5),
    },
  };
}

/**
 * Radius of a GeoCLIP mode around its seed (km): every support point within it of the seed (the
 * mode's peak) is a member. The same value as the default `modeKm` of predict(), which the engine
 * uses; membership of GeoCLIP's answer in a mode is decided with it.
 */
const GEOCLIP_MODE_KM = 25;

/**
 * The candidates with the world model's view: GeoCLIP's strongest modes that lie farther than
 * candidateKm from every gallery candidate join the list, and the scores are mixed, half and
 * half when GeoCLIP gave the answer (its point first), a quarter for GeoCLIP when the gallery's
 * answer stood (that one stays first). Scores stay normalised (sum <= 1).
 *
 * When GeoCLIP gave the answer (`replaced`), that answer is always in the list and leads it, even
 * when its mode is small: with a diffuse prediction the single most probable point can sit in a
 * mode below candidateMinMass, or behind candidateModes larger modes elsewhere. The console
 * centres its map on candidate 0, so a list without the answer would show another place than the
 * fix states. `answerRadiusKm` is the radius stated for the answer.
 */
function withWorldModelCandidates(
  world: World,
  gallery: FixCandidate[],
  geo: GeoclipPrediction,
  params: LocateParams,
  replaced: boolean,
  answerRadiusKm: number,
): FixCandidate[] {
  const gp = params.geoclip;
  const share = replaced ? 0.5 : 0.25;
  const out: FixCandidate[] = gallery.map((c) => ({
    ...c,
    // A gallery candidate keeps its share and gains what GeoCLIP puts around it.
    score: (1 - share) * c.score + share * massWithin(geo, c.lat, c.lon, gp.candidateKm),
  }));
  const galleryLead = out[0] ?? null;
  const near = (lat: number, lon: number): boolean => out.some((c) => greatCircleKm(c.lat, c.lon, lat, lon) <= gp.candidateKm);
  /** The candidate already in the list closest to GeoCLIP's answer, within candidateKm. */
  const standingFor = (): FixCandidate | null => {
    let found: FixCandidate | null = null;
    let bestKm = gp.candidateKm;
    for (const c of out) {
      const d = greatCircleKm(c.lat, c.lon, geo.best.lat, geo.best.lon);
      if (d <= bestKm) {
        bestKm = d;
        found = c;
      }
    }
    return found;
  };
  let added = 0;
  // GeoCLIP's answer close to a gallery candidate: that candidate stands for it.
  let answer: FixCandidate | null = replaced ? standingFor() : null;
  for (const m of geo.modes) {
    // The mode holding GeoCLIP's answer: the answer is one of its members (within the mode radius
    // of its seed, the peak), or, for a refined point beside the gallery points, close to its centre.
    const holdsBest =
      greatCircleKm(m.peak.lat, m.peak.lon, geo.best.lat, geo.best.lon) <= GEOCLIP_MODE_KM ||
      greatCircleKm(m.lat, m.lon, geo.best.lat, geo.best.lon) <= gp.candidateKm;
    // The answer's mode is exempt from the cut-offs while the answer still needs a candidate.
    const exempt = replaced && answer === null && holdsBest;
    if (!exempt && (added >= gp.candidateModes || m.p < gp.candidateMinMass)) continue;
    // The mode holding GeoCLIP's answer stands for it with that point, the others with their peak.
    const at = holdsBest ? geo.best : m.peak;
    if (near(at.lat, at.lon)) continue;
    const name = placeLabel(world, at.lat, at.lon, null);
    const candidate: FixCandidate = {
      lat: at.lat,
      lon: at.lon,
      label: name.de,
      labelEn: name.en,
      country: world.countryNear(at.lat, at.lon)?.iso ?? null,
      score: share * massWithin(geo, at.lat, at.lon, gp.candidateKm),
      radiusKm: Math.max(1, Math.min(gp.candidateKm, m.spreadKm)),
    };
    out.push(candidate);
    added++;
    if (holdsBest && answer === null) answer = candidate;
  }
  if (replaced && answer === null) {
    // No mode stood for the answer (a refined point away from every mode, or a candidate added
    // from another mode lies next to it): the nearest candidate stands for it, else its own point.
    answer = standingFor();
    if (answer === null) {
      const name = placeLabel(world, geo.best.lat, geo.best.lon, null);
      answer = {
        lat: geo.best.lat,
        lon: geo.best.lon,
        label: name.de,
        labelEn: name.en,
        country: world.countryNear(geo.best.lat, geo.best.lon)?.iso ?? null,
        score: share * massWithin(geo, geo.best.lat, geo.best.lon, gp.candidateKm),
        radiusKm: Math.max(1, Math.min(gp.candidateKm, answerRadiusKm)),
      };
      out.push(answer);
    }
  }
  out.sort((a, b) => b.score - a.score);
  // The answer leads the list: GeoCLIP's point when it replaced the gallery's answer, else the
  // gallery's first candidate (which is its answer). It takes the top score, so the order holds.
  const lead = replaced ? answer : galleryLead;
  if (lead && out[0] !== lead) {
    out.splice(out.indexOf(lead), 1);
    lead.score = Math.max(lead.score, out[0]?.score ?? 0);
    out.unshift(lead);
  }
  const sum = out.reduce((s, c) => s + c.score, 0);
  if (sum > 1) for (const c of out) c.score /= sum;
  return out.slice(0, params.maxCandidates);
}

/**
 * Lets the event loop answer waiting requests between the synchronous steps of a localisation
 * (the vote takes a few milliseconds; the gallery search runs in its own thread, see
 * gallerySearch.ts); the node serves the console from the same thread.
 */
export const breathe = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** Determines where a video was recorded from its frames, its file tags and its name. */
export async function locate(input: LocateInput): Promise<LocateResult> {
  const params: LocateParams = { ...DEFAULT_LOCATE_PARAMS, ...input.params };
  const world = input.world ?? (await loadWorld());
  const [metadata, countryCosines] = await Promise.all([
    input.metadata !== undefined ? Promise.resolve(input.metadata) : readMetadata(input.videoPath).catch(() => null),
    world.countryCosines(input.frameVectors, input.dim, input.embedTexts),
  ]);
  const search = { ...(input.excludeWikidata ? { excludeWikidata: input.excludeWikidata } : {}) };
  const hints = filenameHints(input.fileName ?? path.basename(input.videoPath));
  const tiles = params.tilePooling !== 'whole' ? input.tiles : undefined;
  await breathe();
  // The world model works in its own thread meanwhile; it is awaited only now. A failure there
  // costs the fix the world model, never the fix.
  const prediction = async (): Promise<GeoclipPrediction | null> => (input.geoclip ? await Promise.resolve(input.geoclip).catch(() => null) : null);
  if (tiles && tiles.frameRow.length > 0) {
    const neighbours = await input.gallery.searchAsync(tiles.vectors, params.k, search);
    await breathe();
    const geoclip = await prediction();
    return decideLocation(
      world,
      { neighbours, rowFrame: tiles.frameRow, rowTile: tiles.tile, countryCosines, frameNumbers: input.frameNumbers, metadata, hints, geoclip },
      params,
    );
  }
  const neighbours = await input.gallery.searchAsync(input.frameVectors, params.k, search);
  await breathe();
  const geoclip = await prediction();
  return decideLocation(world, { neighbours, countryCosines, frameNumbers: input.frameNumbers, metadata, hints, geoclip }, params);
}

// ------------------------------------------------------------------ frame sampling

export interface SampledFrames {
  vectors: Float32Array;
  dim: number;
  frameNumbers: number[];
  times: number[];
  /** Tile vectors with the pipeline's tiling (only when opts.detail is not 'fast'). */
  tiles?: { vectors: Float32Array; frameRow: number[]; tile: number[] };
  /** Light statistics of every kept frame, in row order (only with opts.frameStats). */
  stats?: FrameStats[];
  /** The JPEG bytes of every kept frame, in row order: what the world model looks at. */
  jpegs: Buffer[];
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

/** Times (s) of `count` frames at the middle of equal segments, with the video's fps. */
async function frameTimes(videoPath: string, count: number, durationSec: number | null | undefined, fpsIn: number | null | undefined): Promise<{ times: number[]; fps: number | null }> {
  let duration = durationSec ?? null;
  let fps = fpsIn ?? null;
  if (duration === null || fps === null) {
    const meta = await readMetadata(videoPath).catch(() => null);
    duration ??= meta?.durationSec ?? null;
    fps ??= meta?.fps ?? null;
  }
  return { times: Array.from({ length: count }, (_, i) => (duration !== null ? (duration * (i + 0.5)) / count : i)), fps };
}

/** Writes the frames at `times` as f0.jpg, f1.jpg, ... into `dir` (one ffmpeg run). */
async function extractFrameFiles(videoPath: string, times: readonly number[], dir: string): Promise<void> {
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
}

/**
 * The frames sampleAndEmbedFrames keeps, as JPEG bytes only (same times, same scaling, the frames
 * that decode): what the world model sees, without the image model. For the evaluation.
 */
export async function sampleFrameJpegs(
  videoPath: string,
  opts: { count?: number; durationSec?: number | null; fps?: number | null; tmpDir?: string } = {},
): Promise<{ jpegs: Buffer[]; frameNumbers: number[]; times: number[] }> {
  const count = opts.count ?? 6;
  const { times, fps } = await frameTimes(videoPath, count, opts.durationSec, opts.fps);
  const dir = await fs.mkdtemp(path.join(opts.tmpDir ?? os.tmpdir(), 'datum-frames-'));
  try {
    await extractFrameFiles(videoPath, times, dir);
    const jpegs: Buffer[] = [];
    const kept: number[] = [];
    for (let i = 0; i < count; i++) {
      const file = path.join(dir, `f${i}.jpg`);
      try {
        await decodeFrame(file);
        jpegs.push(await fs.readFile(file));
        kept.push(i);
      } catch {
        // A seek past the last frame writes no picture.
      }
    }
    return { jpegs, frameNumbers: kept.map((i) => (fps !== null ? Math.round((times[i] as number) * fps) : i)), times: kept.map((i) => times[i] as number) };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * Takes `count` evenly spaced frames (at the middle of equal segments), embeds the whole frame
 * with the same preprocessing as the pipeline and the gallery, and returns the vectors and the
 * JPEG bytes of the frames. `onFrames` receives those bytes as soon as the frames are read,
 * before the image model runs, so that the world model can work on them meanwhile.
 */
export async function sampleAndEmbedFrames(
  videoPath: string,
  model: ImageEmbedder,
  opts: {
    count?: number;
    durationSec?: number | null;
    fps?: number | null;
    tmpDir?: string;
    detail?: DetailLevel;
    frameStats?: boolean;
    onFrames?: (jpegs: Buffer[]) => void;
  } = {},
): Promise<SampledFrames> {
  const detail = opts.detail ?? 'fast';
  const count = opts.count ?? 6;
  const { times, fps } = await frameTimes(videoPath, count, opts.durationSec, opts.fps);
  const dir = await fs.mkdtemp(path.join(opts.tmpDir ?? os.tmpdir(), 'datum-frames-'));
  try {
    await extractFrameFiles(videoPath, times, dir);
    const size = model.imageSize;
    const plane = 3 * size * size;
    const kept: number[] = [];
    const stats: FrameStats[] = [];
    const jpegs: Buffer[] = [];
    // Every tile of every readable frame, whole frame first (the pipeline's layout).
    const rects: { frameRow: number; tile: number; pixels: Float32Array }[] = [];
    for (let i = 0; i < count; i++) {
      const file = path.join(dir, `f${i}.jpg`);
      try {
        const decoded = await decodeFrame(file);
        const layout: PixelRect[] = tileLayout(decoded.width, decoded.height, detail);
        const frameRects: typeof rects = [];
        for (const [t, rect] of layout.entries()) {
          const px = new Float32Array(plane);
          await writeTile(decoded, rect, size, model.imageMean, model.imageStd, px, 0);
          frameRects.push({ frameRow: kept.length, tile: t, pixels: px });
        }
        // The same statistics the time engine reads from the analysis frames, so that the quick
        // stage can estimate the time before the analysis has written any frame.
        const frameStats = opts.frameStats ? await frameStatsFromJpeg(file) : null;
        const bytes = await fs.readFile(file);
        if (frameStats) stats.push(frameStats);
        jpegs.push(bytes);
        rects.push(...frameRects);
        kept.push(i);
      } catch {
        // A seek past the last frame writes no picture.
      }
    }
    if (kept.length === 0) throw new Error('Aus dem Video konnten keine Bilder gelesen werden.');
    try {
      opts.onFrames?.(jpegs);
    } catch {
      // The listener's failure must not cost the image model's vectors.
    }
    // The image model runs on the node's only thread (onnxruntime-node executes a run
    // synchronously): one call with all 48 crops would hold every request of the console for
    // seconds. Calls of EMBED_CHUNK pictures, the analysis pipeline's batch, with a turn of the
    // event loop between them, keep the node answering; the vectors agree up to rounding.
    const dim = model.dim;
    const tileVectors = new Float32Array(rects.length * dim);
    for (let start = 0; start < rects.length; start += EMBED_CHUNK) {
      const chunk = rects.slice(start, start + EMBED_CHUNK);
      const pixels = new Float32Array(chunk.length * plane);
      chunk.forEach((r, j) => pixels.set(r.pixels, j * plane));
      tileVectors.set(await model.embedPixels(pixels, chunk.length), start * dim);
      await breathe();
    }
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
      ...(opts.frameStats ? { stats } : {}),
      jpegs,
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
