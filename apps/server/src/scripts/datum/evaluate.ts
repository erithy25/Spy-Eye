/**
 * Measures the DATUM localisation on the reference videos with known places.
 *
 *   SICHT_OFFLINE=1 npx tsx src/scripts/datum/evaluate.ts [--dataset datasets/datum] [--frames 12]
 *       [--detail standard] [--limit N] [--out docs/measurements/datum-geolocation.json]
 *       [--no-geoclip] [--params tuned|default]
 *
 * For every test video: 12 evenly spaced frames are embedded with the pipeline's tiling (tile 0
 * is the whole frame, the others square crops; the live engine reads the same vectors from the
 * store), then `locate` decides twice:
 *   open      the gallery as it is (it contains a picture of the same Wikidata item: leakage, the
 *             "known landmark" case);
 *   unknown   the same item left out of the gallery (the place is not in the reference set).
 * The error is the great-circle distance to the true position; reported are the median and the
 * share within 1, 25, 200, 750 and 2500 km (the Im2GPS thresholds).
 *
 * Thresholds and temperatures are tuned only on the videos with even index ("train"); the
 * videos with odd index ("test") are reported separately and never used for a decision.
 * The result is written to docs/measurements/datum-geolocation.json and printed as a table.
 *
 * World model: the same frames go through GeoCLIP in its worker thread (geoclipService.ts, as in
 * the node); its image embeddings are cached per clip (.cache/datum/geoclip-eval-int8-12.json,
 * the cache of scripts/datum/evaluateGeoclip.ts). The gallery's parameters are tuned without it
 * (as before), then decideLocation fuses GeoCLIP with LocateParams.geoclip, the radius of its
 * concentrated answers is chosen on the train half and the confidence model is fitted again on
 * the fused train answers. Reported are both: the gallery alone ("before") and fused ("after").
 * --no-geoclip leaves the world model out; --params default takes DEFAULT_LOCATE_PARAMS for the
 * gallery instead of tuning them again.
 */
process.env['SICHT_OFFLINE'] ??= '1';

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const { config, repoRoot } = await import('../../config.js');
const { EmbeddingModel } = await import('../../ml/model.js');
const { Gallery, modelSlug } = await import('../../datum/gallery.js');
const { World, greatCircleKm } = await import('../../datum/world.js');
const { readMetadata, filenameHints } = await import('../../datum/metadata.js');
const { decodeFrame, writeTile } = await import('../../ml/preprocess.js');
const { CONFIDENCE_FEATURES, DEFAULT_LOCATE_PARAMS, decideLocation, poolTileRows, sampleAndEmbedFrames, sampleFrameJpegs, weightNeighbours } = await import(
  '../../datum/locate.js'
);
const { WorldModelService } = await import('../../datum/geoclipService.js');
type GeoclipPrediction = import('../../datum/geoclip.js').GeoclipPrediction;
type DetailLevel = import('../../types.js').DetailLevel;
type LocateParams = import('../../datum/locate.js').LocateParams;
type LocateEvidence = import('../../datum/locate.js').LocateEvidence;
type ConfidenceFeatures = import('../../datum/locate.js').ConfidenceFeatures;
type GalleryNeighbour = import('../../datum/gallery.js').GalleryNeighbour;
type WorldT = import('../../datum/world.js').World;

const say = (line: string): void => void process.stdout.write(`${line}\n`);

function argument(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  const value = idx >= 0 ? process.argv[idx + 1] : undefined;
  return value !== undefined && !value.startsWith('--') ? value : fallback;
}

interface ManifestVideo {
  id: string;
  file: string;
  label: string;
  wikidata: string;
  lat: number;
  lon: number;
  country?: string;
  [key: string]: unknown;
}

const THRESHOLDS_KM = [1, 25, 200, 750, 2500] as const;
/** What changed against the previous measurement (written into the report). */
const CHANGES = [
  'queries: 12 frames per video with the pipeline tiles (whole frame plus three square crops at detail "standard"); every tile row votes on its own (tilePooling "rows"), chosen on the train half among whole / frame / rows (train objective 0.373 / 0.343 / 0.403)',
  'radius: calibrated per evidence tier on the train half to cover the truth in 70 % of its cases: strong (gap >= strongGap and frame agreement >= agreementMin, both chosen on train), other recognition, similarity, country and continent (factor on their radius); frame agreement is a new confidence feature',
  'previous measurement (6 frames, whole frames only, same gallery), test half: open median 233 km, <=1 km 40 %, <=25 km 47 %, <=2500 km 80 %, within radius 43 %; unknown median 751 km, <=25 km 17 %, <=2500 km 70 %, within radius 17 %; train objective 0.377 (now 0.403); the accuracy gain on train did not carry over to the test half',
  'gallery unchanged (6 393 pictures): a broad worldwide layer to 17 945 pictures (fetchDataset.ts --extend) lowered the train objective from 0.403 to 0.283 and was not kept',
  'evaluation uses the live node vector cache (.cache/datum), caches frame vectors, one gallery search serves both modes',
];
const MODES = ['open', 'unknown'] as const;
type Mode = (typeof MODES)[number];
const K_MAX = 30;

interface Prepared {
  video: ManifestVideo;
  index: number;
  split: 'train' | 'test';
  truthIso: string | null;
  /** Codes that count as the right country: the shape the point falls in and the manifest's
   * (a dependency such as GS for South Georgia and its sovereign GB both count). */
  truthIsos: string[];
  frameNumbers: number[];
  /** Neighbour rows per tile (rowFrame / rowTile say which frame and tile). */
  neighbours: Record<Mode, GalleryNeighbour[][]>;
  rowFrame: number[];
  rowTile: number[];
  cosines: Float32Array;
  hasGps: boolean;
  metadata: Awaited<ReturnType<typeof readMetadata>> | null;
  timing: { framesMs: number; locateMs: number; totalMs: number };
  /** The world model's prediction for the same frames (compact), null without it. */
  geoclip: GeoclipPrediction | null;
}

interface ModeOutcome {
  lat: number;
  lon: number;
  method: string;
  label: string;
  country: string | null;
  radiusKm: number;
  confidence: number;
  errorKm: number;
  withinRadius: boolean;
  topSimilarity: number;
  topReference: string | null;
  topReferenceIsSameItem: boolean;
  countryCorrect: boolean | null;
  level: string | null;
  countryTopP: number;
  continentTop: string | null;
  continentTopP: number;
  continentCorrect: boolean;
  zeroShotCountry: string | null;
  features: ConfidenceFeatures;
  radiusTier: string | null;
  radiusBaseKm: number;
  /** Which source gave the answer. */
  source: 'gallery' | 'worldmodel' | 'none';
  /** GeoCLIP's mass within concentrationKm of its answer (world-model answers), else null. */
  concentration: number | null;
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

function summarise(outcomes: ModeOutcome[]): Record<string, number> {
  const errors = outcomes.map((o) => o.errorKm);
  const out: Record<string, number> = { n: outcomes.length, medianKm: round(median(errors), 1) };
  for (const t of THRESHOLDS_KM) out[`acc${t}km`] = round(errors.filter((e) => e <= t).length / Math.max(1, errors.length), 3);
  const withCountry = outcomes.filter((o) => o.countryCorrect !== null);
  out['countryAcc'] = round(withCountry.filter((o) => o.countryCorrect).length / Math.max(1, withCountry.length), 3);
  out['meanConfidence'] = round(outcomes.reduce((s, o) => s + o.confidence, 0) / Math.max(1, outcomes.length), 3);
  out['withinRadius'] = round(outcomes.filter((o) => o.withinRadius).length / Math.max(1, outcomes.length), 3);
  out['countryLevelAnswers'] = outcomes.filter((o) => o.level === 'country').length;
  out['continentLevelAnswers'] = outcomes.filter((o) => o.level === 'continent').length;
  out['worldModelAnswers'] = outcomes.filter((o) => o.level === 'worldmodel').length;
  out['noAnswer'] = outcomes.filter((o) => o.level === null).length;
  return out;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Mean of the Im2GPS accuracies: the tuning objective. */
function objective(outcomes: ModeOutcome[]): number {
  if (outcomes.length === 0) return 0;
  let s = 0;
  for (const t of THRESHOLDS_KM) s += outcomes.filter((o) => o.errorKm <= t).length / outcomes.length;
  return s / THRESHOLDS_KM.length;
}

function evidenceFor(p: Prepared, mode: Mode, withMetadata: boolean, withGeo = false): LocateEvidence {
  return {
    neighbours: p.neighbours[mode],
    rowFrame: p.rowFrame,
    rowTile: p.rowTile,
    countryCosines: p.cosines,
    frameNumbers: p.frameNumbers,
    metadata: withMetadata ? p.metadata : null,
    hints: filenameHints(path.basename(p.video.file)),
    geoclip: withGeo ? p.geoclip : null,
  };
}

function runMode(world: WorldT, p: Prepared, mode: Mode, params: LocateParams, withGeo = false): ModeOutcome {
  // The evaluation measures the picture: GPS in the file would answer trivially, so metadata
  // is reported but the visual estimate is scored.
  const ev = evidenceFor(p, mode, true, withGeo);
  const neighbours = ev.neighbours.map((row) => row.slice(0, params.k));
  const r = decideLocation(world, { ...ev, neighbours }, params);
  const loc = r.diagnostics.visual;
  const lat = loc?.lat ?? 0;
  const lon = loc?.lon ?? 0;
  const errorKm = loc ? greatCircleKm(lat, lon, p.video.lat, p.video.lon) : 20_000;
  const refs = weightNeighbours(poolTileRows(neighbours, ev.rowFrame, ev.rowTile, params.tilePooling, params.k).rows, params);
  const top = [...refs].sort((a, b) => b.bestSimilarity - a.bestSimilarity)[0];
  const sameItem = top ? top.id === p.video.wikidata || neighbours.flat().some((n) => n.id === top.id && n.wikidata === p.video.wikidata) : false;
  return {
    lat,
    lon,
    method: loc?.method ?? 'none',
    label: loc?.label ?? '',
    country: loc?.country ?? null,
    radiusKm: loc?.radiusKm ?? 20_000,
    confidence: loc?.confidence ?? 0,
    errorKm,
    withinRadius: loc ? errorKm <= loc.radiusKm : false,
    topSimilarity: r.diagnostics.topSimilarity,
    topReference: top?.label ?? null,
    topReferenceIsSameItem: sameItem,
    countryCorrect: p.truthIsos.length > 0 ? p.truthIsos.includes(r.countries[0]?.iso ?? '') : null,
    level: r.diagnostics.level,
    countryTopP: r.diagnostics.countryTop?.p ?? 0,
    continentTop: r.diagnostics.continentTop?.code ?? null,
    continentTopP: r.diagnostics.continentTop?.p ?? 0,
    continentCorrect: p.truthIsos.some((iso) => world.continentOf(iso) === (r.diagnostics.continentTop?.code ?? '-')),
    zeroShotCountry: r.diagnostics.zeroShotTop[0]?.iso ?? null,
    features: r.diagnostics.features,
    radiusTier: r.diagnostics.radiusTier,
    radiusBaseKm: r.diagnostics.radiusBaseKm,
    source: !loc ? 'none' : r.diagnostics.worldModel?.replaced ? 'worldmodel' : 'gallery',
    concentration: r.diagnostics.worldModel?.replaced ? r.diagnostics.worldModel.concentration : null,
  };
}

function runAll(world: WorldT, items: Prepared[], params: LocateParams, withGeo = false): Record<Mode, ModeOutcome[]> {
  return {
    open: items.map((p) => runMode(world, p, 'open', params, withGeo)),
    unknown: items.map((p) => runMode(world, p, 'unknown', params, withGeo)),
  };
}

function trainScore(world: WorldT, items: Prepared[], params: LocateParams): number {
  const r = runAll(world, items, params);
  return (objective(r.open) + objective(r.unknown)) / 2;
}

/** Coordinate descent over a small grid, on the training half only. */
function tune(world: WorldT, train: Prepared[], start: LocateParams): { params: LocateParams; log: string[] } {
  const log: string[] = [];
  let best = { ...start };
  let bestScore = trainScore(world, train, best);
  log.push(`start ${bestScore.toFixed(4)}`);
  const grid: { name: string; values: Partial<LocateParams>[] }[] = [
    { name: 'tilePooling', values: (['whole', 'frame', 'rows'] as const).map((tilePooling) => ({ tilePooling })) },
    { name: 'frameAggregation', values: (['mean', 'max'] as const).map((frameAggregation) => ({ frameAggregation })) },
    { name: 'k', values: [5, 10, 15, 20, 30].map((k) => ({ k })) },
    { name: 'simTemperature', values: [0.01, 0.02, 0.03, 0.05, 0.08, 0.12].map((simTemperature) => ({ simTemperature })) },
    {
      name: 'kernelMix',
      values: [
        [0.5, 0.3, 0.2],
        [0.34, 0.33, 0.33],
        [0.2, 0.3, 0.5],
        [0.7, 0.2, 0.1],
        [0.1, 0.3, 0.6],
      ].map((kernelMix) => ({ kernelMix })),
    },
    { name: 'priorExponent', values: [0, 0.25, 0.5, 1, 2].map((priorExponent) => ({ priorExponent })) },
    { name: 'countryVoteWeight', values: [0, 0.5, 1, 2].map((countryVoteWeight) => ({ countryVoteWeight })) },
    { name: 'regionAnchor', values: (['centroid', 'neighbours'] as const).map((regionAnchor) => ({ regionAnchor })) },
    { name: 'regionThreshold', values: [-1, 0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85].map((regionThreshold) => ({ regionThreshold })) },
    { name: 'recognitionGap', values: [1, 0.04, 0.05, 0.06, 0.07, 0.08, 0.1].map((recognitionGap) => ({ recognitionGap })) },
    { name: 'gapThreshold', values: [0, 0.02, 0.04, 0.06, 0.08, 0.1, 0.12].map((gapThreshold) => ({ gapThreshold })) },
  ];
  for (let sweep = 0; sweep < 2; sweep++) {
    let changed = false;
    for (const g of grid) {
      if ((g.name === 'tilePooling' && fixedPooling) || (g.name === 'frameAggregation' && fixedAggregation)) continue;
      for (const v of g.values) {
        const candidate = { ...best, ...v };
        const score = trainScore(world, train, candidate);
        if (score > bestScore + 1e-9) {
          bestScore = score;
          best = candidate;
          changed = true;
          log.push(`sweep ${sweep} ${g.name}=${JSON.stringify(Object.values(v)[0])} → ${score.toFixed(4)}`);
        }
      }
    }
    if (!changed) break;
  }
  return { params: best, log };
}

/** Zero-shot prior: temperature and population exponent by maximum likelihood of the true country (train only). */
function tunePrior(world: WorldT, train: Prepared[], base: LocateParams): { temperature: number; populationExponent: number; logLik: number; top1: number } {
  let best = { temperature: base.prior.temperature, populationExponent: base.prior.populationExponent, logLik: -Infinity, top1: 0 };
  for (const populationExponent of [0, 0.5, 1, 1.5, 2]) {
    for (const temperature of [0.003, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.03]) {
      let ll = 0;
      let top1 = 0;
      let n = 0;
      for (const p of train) {
        if (p.truthIsos.length === 0) continue;
        const probs = world.priorFromCosines(p.cosines, { ...base.prior, temperature, populationExponent });
        const pTrue = probs.filter((c) => p.truthIsos.includes(c.iso)).reduce((a, c) => a + c.p, 0);
        ll += Math.log(Math.max(1e-9, pTrue));
        if (p.truthIsos.includes(probs[0]?.iso ?? '')) top1++;
        n++;
      }
      if (n > 0 && ll / n > best.logLik) best = { temperature, populationExponent, logLik: ll / n, top1: top1 / n };
    }
  }
  return best;
}

/** Top-1 / top-5 accuracy of the zero-shot prior alone (no gallery). */
function zeroShotAccuracy(world: WorldT, items: Prepared[], prior: LocateParams['prior']): { n: number; top1: number; top5: number } {
  let top1 = 0;
  let top5 = 0;
  let n = 0;
  for (const p of items) {
    if (p.truthIsos.length === 0) continue;
    const probs = world.priorFromCosines(p.cosines, prior);
    const rank = probs.findIndex((c) => p.truthIsos.includes(c.iso));
    if (rank === 0) top1++;
    if (rank >= 0 && rank < 5) top5++;
    n++;
  }
  return { n, top1: round(top1 / Math.max(1, n), 3), top5: round(top5 / Math.max(1, n), 3) };
}

/**
 * Smallest probability from which the best country (continent) is right in at least `target`
 * of the training cases at or above it: the cut-off for country- and continent-level answers.
 */
function precisionThreshold(rows: { p: number; correct: boolean }[], target: number, fallback: number): number {
  const candidates = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6, 0.7, 0.8];
  for (const t of candidates) {
    const above = rows.filter((r) => r.p >= t);
    if (above.length >= 4 && above.filter((r) => r.correct).length / above.length >= target) return t;
  }
  return fallback;
}

/** Logistic regression (L2) of "error within the stated radius" on the confidence features. */
function fitConfidence(rows: { f: ConfidenceFeatures; hit: boolean }[]): LocateParams['confidence'] {
  const keys = CONFIDENCE_FEATURES;
  const zero = (): LocateParams['confidence'] => ({ bias: 0, topSim: 0, gap: 0, margin: 0, share: 0, region: 0, continent: 0, countryP: 0, agreement: 0, worldModel: 0, concentration: 0, agreeMass: 0 });
  const w = zero();
  if (rows.length < 10) return DEFAULT_LOCATE_PARAMS.confidence;
  const lr = 0.5;
  const lambda = 0.01;
  for (let iter = 0; iter < 6000; iter++) {
    const g = zero();
    for (const r of rows) {
      let z = w.bias;
      for (const k of keys) z += w[k] * r.f[k];
      const err = 1 / (1 + Math.exp(-z)) - (r.hit ? 1 : 0);
      g.bias += err;
      for (const k of keys) g[k] += err * r.f[k];
    }
    w.bias -= (lr * g.bias) / rows.length;
    for (const k of keys) w[k] -= lr * (g[k] / rows.length + lambda * w[k]);
  }
  const out = zero();
  out.bias = round(w.bias, 3);
  for (const k of keys) out[k] = round(w[k], 3);
  return out;
}

/** Log-loss and Brier score of the stated confidence against "truth within the radius". */
function calibrationScore(outcomes: ModeOutcome[]): { n: number; logLoss: number; brier: number; meanConfidence: number; hitRate: number } {
  const n = Math.max(1, outcomes.length);
  let ll = 0;
  let brier = 0;
  for (const o of outcomes) {
    const p = Math.min(1 - 1e-6, Math.max(1e-6, o.confidence));
    ll -= o.withinRadius ? Math.log(p) : Math.log(1 - p);
    brier += (p - (o.withinRadius ? 1 : 0)) ** 2;
  }
  return {
    n: outcomes.length,
    logLoss: round(ll / n, 4),
    brier: round(brier / n, 4),
    meanConfidence: round(outcomes.reduce((s, o) => s + o.confidence, 0) / n, 3),
    hitRate: round(outcomes.filter((o) => o.withinRadius).length / n, 3),
  };
}

const RADIUS_TARGET = 0.7;
const RADIUS_GRID_KM = [0.5, 1, 2, 3, 5, 10, 25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500];
const FACTOR_GRID = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6];

/**
 * Radius per evidence tier, on the training half only (both modes pooled): the smallest grid
 * value with which the truth lies inside the stated circle in at least RADIUS_TARGET of the cases
 * of that tier. Tiers with fewer than four cases fall back to the next weaker tier's value.
 */
function calibrateRadii(rows: ModeOutcome[]): LocateParams['radiusKm'] & { counts: Record<string, number> } {
  const inTier = (t: string): ModeOutcome[] => rows.filter((o) => o.radiusTier === t);
  const pickMin = (cases: ModeOutcome[], fallback: number): number => {
    if (cases.length < 4) return fallback;
    for (const r of RADIUS_GRID_KM) {
      if (cases.filter((o) => o.errorKm <= Math.max(r, o.radiusBaseKm, 0.5)).length / cases.length >= RADIUS_TARGET) return r;
    }
    return RADIUS_GRID_KM[RADIUS_GRID_KM.length - 1] as number;
  };
  const pickFactor = (cases: ModeOutcome[]): number => {
    if (cases.length < 4) return 1;
    for (const f of FACTOR_GRID) {
      if (cases.filter((o) => o.errorKm <= o.radiusBaseKm * f).length / cases.length >= RADIUS_TARGET) return f;
    }
    return FACTOR_GRID[FACTOR_GRID.length - 1] as number;
  };
  const similar = pickMin(inTier('similar'), 25);
  const recognised = pickMin(inTier('recognised'), similar);
  const strong = pickMin(inTier('strong'), recognised);
  const counts: Record<string, number> = {};
  for (const t of ['strong', 'recognised', 'similar', 'country', 'continent']) counts[t] = inTier(t).length;
  return {
    strong,
    recognised,
    similar,
    countryFactor: pickFactor(inTier('country')),
    continentFactor: pickFactor(inTier('continent')),
    counts,
  };
}

/** Within-radius share per tier (for the report). */
function coverageByTier(outcomes: ModeOutcome[]): Record<string, { n: number; withinRadius: number; medianRadiusKm: number }> {
  const out: Record<string, { n: number; withinRadius: number; medianRadiusKm: number }> = {};
  for (const t of ['strong', 'recognised', 'similar', 'country', 'continent', 'worldmodel']) {
    const c = outcomes.filter((o) => o.radiusTier === t);
    if (c.length === 0) continue;
    out[t] = { n: c.length, withinRadius: round(c.filter((o) => o.withinRadius).length / c.length, 3), medianRadiusKm: round(median(c.map((o) => o.radiusKm)), 1) };
  }
  return out;
}

/** Smallest similarity from which the open-gallery top match lies within 1 km in >= 80 % (train). */
function landmarkThreshold(train: ModeOutcome[], fallback: number): number {
  for (const t of [0.6, 0.65, 0.7, 0.72, 0.75, 0.78, 0.8, 0.85, 0.9]) {
    const above = train.filter((o) => o.topSimilarity >= t);
    if (above.length >= 5 && above.filter((o) => o.errorKm <= 1).length / above.length >= 0.8) return t;
  }
  return fallback;
}

function calibration(outcomes: ModeOutcome[]): { bin: string; n: number; meanConfidence: number; hitRate: number }[] {
  const bins = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  const out = [];
  for (let b = 0; b < bins.length - 1; b++) {
    const lo = bins[b] as number;
    const hi = bins[b + 1] as number;
    const inBin = outcomes.filter((o) => o.confidence >= lo && o.confidence < hi);
    if (inBin.length === 0) continue;
    out.push({
      bin: `${lo.toFixed(1)}-${Math.min(1, hi).toFixed(1)}`,
      n: inBin.length,
      meanConfidence: round(inBin.reduce((s, o) => s + o.confidence, 0) / inBin.length, 3),
      hitRate: round(inBin.filter((o) => o.withinRadius).length / inBin.length, 3),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

const datasetDir = path.resolve(repoRoot, argument('dataset', 'datasets/datum'));
const frameCount = Number(argument('frames', '12'));
const detail = argument('detail', 'standard') as DetailLevel;
/** Frames actually used of the sampled ones (evenly spread, as the engine picks them); 0 = all. */
const useFrames = Number(argument('use-frames', '0'));
/** Structural choices fixed from the command line instead of tuned (experiments). */
const fixedPooling = argument('pooling', '') as '' | LocateParams['tilePooling'];
const fixedAggregation = argument('frame-aggregation', '') as '' | LocateParams['frameAggregation'];
const limit = Number(argument('limit', '0'));
const outFile = path.resolve(repoRoot, argument('out', 'docs/measurements/datum-geolocation.json'));
// The same vector cache as the live node (datum/shared.ts): the gallery is embedded once.
const cacheDir = path.resolve(repoRoot, argument('cache', '.cache/datum'));
const withGeoclip = !process.argv.includes('--no-geoclip');
const paramSource = argument('params', 'tuned') === 'default' ? 'default' : 'tuned';

const manifest = JSON.parse(await fs.readFile(path.join(datasetDir, 'manifest.json'), 'utf8')) as { videos: ManifestVideo[] };
let videos = manifest.videos.filter(
  (v) => typeof v.lat === 'number' && typeof v.lon === 'number' && typeof v.file === 'string' && typeof v.id === 'string',
);
// The split is fixed by the manifest order (sorted by id for stability), not by results.
videos.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const splitOf = new Map(videos.map((v, i) => [v.id, i % 2 === 0 ? ('train' as const) : ('test' as const)]));
const present: ManifestVideo[] = [];
for (const v of videos) {
  try {
    await fs.access(path.join(datasetDir, v.file));
    present.push(v);
  } catch {
    // clip not downloaded (yet)
  }
}
videos = limit > 0 ? present.slice(0, limit) : present;
say(`DATUM-Ortung: ${videos.length} Videos mit Datei (Manifest: ${manifest.videos.length}).`);

const model = new EmbeddingModel();
const tModel = performance.now();
await model.load();
say(`Modell ${config.modelId} (${model.state.device}, ${config.threads} Threads) in ${((performance.now() - tModel) / 1000).toFixed(1)} s geladen.`);

const world = await World.load();
world.textCache = { file: path.join(cacheDir, `country-text-${modelSlug()}.bin`), modelId: config.modelId };
const gallery = new Gallery(model, { datasetDir, cacheDir });
let lastNote = 0;
const galleryReport = await gallery.load((p) => {
  if (Date.now() - lastNote > 10_000) {
    lastNote = Date.now();
    say(`  Galerie: ${p.done}/${p.total} (${p.embedded} neu eingebettet)`);
  }
});
say(
  `Galerie: ${galleryReport.images} Bilder (${galleryReport.fromCache} aus dem Cache, ${galleryReport.embedded} neu, ${galleryReport.failed} unlesbar); ` +
    `${galleryReport.imagesPerSec > 0 ? `${galleryReport.imagesPerSec.toFixed(1)} Bilder/s, ` : ''}geladen in ${(galleryReport.loadMs / 1000).toFixed(1)} s.`,
);
// A second load measures the restart path (everything from the cache).
const reload = await new Gallery(model, { datasetDir, cacheDir }).load();
say(`Neustart der Galerie aus dem Cache: ${reload.loadMs.toFixed(0)} ms.`);

/** Embedding throughput on gallery thumbnails, measured afresh (the cache would hide it). */
async function measureThroughput(count: number): Promise<number> {
  const list = gallery.list().slice(0, count);
  const size = model.imageSize;
  const plane = 3 * size * size;
  const t0 = performance.now();
  for (let i = 0; i < list.length; i += config.batchSize) {
    const batch = list.slice(i, i + config.batchSize);
    const pixels = new Float32Array(batch.length * plane);
    await Promise.all(
      batch.map(async (img, j) => {
        const decoded = await decodeFrame(path.join(datasetDir, img.file));
        await writeTile(decoded, { left: 0, top: 0, width: decoded.width, height: decoded.height }, size, model.imageMean, model.imageStd, pixels, j * plane);
      }),
    );
    await model.embedPixels(pixels, batch.length);
  }
  return list.length / ((performance.now() - t0) / 1000);
}
const throughput = await measureThroughput(96);
say(`Durchsatz beim Einbetten (96 Galeriebilder, frisch gemessen): ${throughput.toFixed(1)} Bilder/s.`);

const embedTexts = (texts: string[]): Promise<Float32Array> => model.embedTexts(texts);
const tText = performance.now();
await world.countryTextVectors(embedTexts);
const countryTextMs = performance.now() - tText;
say(`Ländertexte (${world.countries().length} × 5 Prompts) in ${(countryTextMs / 1000).toFixed(1)} s eingebettet.`);

// ---- per video: frames, neighbours, prior
// Frame and tile vectors are cached per clip (keyed by size, frame count, tiling and model), so a
// rerun after a gallery change does not embed the videos again.
type FrameCacheEntry = { bytes: number; frameNumbers: number[]; dim: number; vectors: string; tiles: string | null; frameRow: number[]; tile: number[] };
const frameCacheFile = path.join(cacheDir, `eval-frames-${modelSlug()}-${frameCount}-${detail}.json`);
const frameCache: Record<string, FrameCacheEntry> = await fs
  .readFile(frameCacheFile, 'utf8')
  .then((t) => JSON.parse(t) as Record<string, FrameCacheEntry>)
  .catch(() => ({}));
const toB64 = (v: Float32Array): string => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
const fromB64 = (t: string): Float32Array => {
  const b = Buffer.from(t, 'base64');
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
let frameCacheDirty = false;
const searchMs: number[] = [];
const prepared: Prepared[] = [];
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-eval-'));
for (let i = 0; i < videos.length; i++) {
  const video = videos[i] as ManifestVideo;
  const file = path.join(datasetDir, video.file);
  const t0 = performance.now();
  try {
    const metadata = await readMetadata(file).catch(() => null);
    const bytes = (await fs.stat(file)).size;
    let cachedFrames = frameCache[video.id];
    if (!cachedFrames || cachedFrames.bytes !== bytes || cachedFrames.dim !== model.dim) {
      const sampled = await sampleAndEmbedFrames(file, model, {
        count: frameCount,
        durationSec: metadata?.durationSec ?? null,
        fps: metadata?.fps ?? null,
        tmpDir,
        detail,
      });
      cachedFrames = {
        bytes,
        frameNumbers: sampled.frameNumbers,
        dim: sampled.dim,
        vectors: toB64(sampled.vectors),
        tiles: sampled.tiles ? toB64(sampled.tiles.vectors) : null,
        frameRow: sampled.tiles?.frameRow ?? sampled.frameNumbers.map((_, r) => r),
        tile: sampled.tiles?.tile ?? sampled.frameNumbers.map(() => 0),
      };
      frameCache[video.id] = cachedFrames;
      frameCacheDirty = true;
    }
    let frames = { vectors: fromB64(cachedFrames.vectors), dim: cachedFrames.dim, frameNumbers: cachedFrames.frameNumbers };
    let tileVectors = cachedFrames.tiles ? fromB64(cachedFrames.tiles) : frames.vectors;
    let rowFrame = cachedFrames.frameRow;
    let rowTile = cachedFrames.tile;
    if (useFrames > 0 && useFrames < frames.frameNumbers.length) {
      // The engine's choice of frames: evenly spread over the sampled ones.
      const n = frames.frameNumbers.length;
      const picks = [...new Set(Array.from({ length: useFrames }, (_, i) => Math.min(n - 1, Math.round(((i + 0.5) / useFrames) * (n - 1)))))];
      const dim = frames.dim;
      const fv = new Float32Array(picks.length * dim);
      picks.forEach((f, r) => fv.set(frames.vectors.subarray(f * dim, (f + 1) * dim), r * dim));
      const keepRows = rowFrame.map((f, i) => (picks.includes(f) ? i : -1)).filter((i) => i >= 0);
      const tv = new Float32Array(keepRows.length * dim);
      keepRows.forEach((i, r) => tv.set(tileVectors.subarray(i * dim, (i + 1) * dim), r * dim));
      rowFrame = keepRows.map((i) => picks.indexOf(rowFrame[i] as number));
      rowTile = keepRows.map((i) => rowTile[i] as number);
      tileVectors = tv;
      frames = { vectors: fv, dim, frameNumbers: picks.map((f) => frames.frameNumbers[f] as number) };
    }
    const t1 = performance.now();
    const cosines = await world.countryCosines(frames.vectors, frames.dim, embedTexts);
    // One search serves both modes: every Wikidata item has one picture, so the unknown case is
    // the open list without it (a few spare neighbours keep k rows full).
    const ts = performance.now();
    const wide = gallery.search(tileVectors, K_MAX + 4);
    searchMs.push(performance.now() - ts);
    const open = wide.map((row) => row.slice(0, K_MAX));
    const unknown = wide.map((row) => row.filter((n) => n.wikidata !== video.wikidata).slice(0, K_MAX));
    const p: Prepared = {
      video,
      index: i,
      split: splitOf.get(video.id) ?? 'test',
      truthIso: world.countryNear(video.lat, video.lon)?.iso ?? (typeof video.country === 'string' && /^[A-Z]{2}$/.test(video.country) ? video.country : null),
      truthIsos: [
        ...new Set(
          [world.countryNear(video.lat, video.lon)?.iso ?? null, typeof video.country === 'string' ? video.country.toUpperCase() : null].filter(
            (x): x is string => x !== null && /^[A-Z]{2}$/.test(x),
          ),
        ),
      ],
      frameNumbers: frames.frameNumbers,
      neighbours: { open, unknown },
      rowFrame,
      rowTile,
      cosines,
      hasGps: metadata?.location != null,
      metadata,
      timing: { framesMs: t1 - t0, locateMs: 0, totalMs: 0 },
      geoclip: null,
    };
    // One full decision as the server would make it (open gallery), for the time per video.
    const t2 = performance.now();
    decideLocation(world, evidenceFor(p, 'open', true), DEFAULT_LOCATE_PARAMS);
    const t3 = performance.now();
    p.timing.locateMs = t3 - t2 + (t2 - t1);
    p.timing.totalMs = t3 - t0;
    prepared.push(p);
    if (i % 10 === 0 || i === videos.length - 1) say(`  ${i + 1}/${videos.length} ${video.id} ${(p.timing.totalMs / 1000).toFixed(2)} s`);
  } catch (err) {
    say(`  ${video.id}: übersprungen (${err instanceof Error ? err.message : String(err)})`);
  }
}
await fs.rm(tmpDir, { recursive: true, force: true });
if (frameCacheDirty) {
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(frameCacheFile, JSON.stringify(frameCache));
}

// ---- world model: GeoCLIP on the engine's frames, in its worker thread as in the node
// Image embeddings are cached per clip in the format of scripts/datum/evaluateGeoclip.ts (the
// frames are the same: sampleFrameJpegs takes them as sampleAndEmbedFrames does).
interface GeoEmbedEntry {
  bytes: number;
  frames: number;
  times: number[];
  embeds: string;
  preprocessMs: number;
  inferMs: number;
}
interface GeoEmbedCache {
  version: 1;
  precision: string;
  frames: number;
  videos: Record<string, GeoEmbedEntry>;
  stats: unknown;
}
const geoTiming = { precision: '', threads: 0, galleryReadyMs: 0, embeddedVideos: 0, cachedVideos: 0, embedMsPerFrame: [] as number[], predictMs: [] as number[] };
let geoclipUsed = false;
if (withGeoclip) {
  const worldModel = new WorldModelService({ log: (m) => say(`  ${m}`) });
  if (!(await worldModel.available())) {
    say('GeoCLIP-Gewichte fehlen (pnpm models:download): Messung ohne Weltmodell.');
  } else {
    const precision = worldModel.boot.precision;
    geoTiming.precision = precision;
    geoTiming.threads = worldModel.boot.threads;
    const geoCacheFile = path.join(cacheDir, `geoclip-eval-${precision}-${frameCount}.json`);
    const loaded = await fs
      .readFile(geoCacheFile, 'utf8')
      .then((t) => JSON.parse(t) as GeoEmbedCache)
      .catch(() => null);
    const geoCache: GeoEmbedCache = loaded && loaded.version === 1 && loaded.precision === precision && loaded.frames === frameCount ? loaded : { version: 1, precision, frames: frameCount, videos: {}, stats: null };
    let geoDirty = false;
    const tg = performance.now();
    try {
      await worldModel.ensureGallery();
      geoTiming.galleryReadyMs = performance.now() - tg;
      const geoTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-eval-geo-'));
      try {
        for (const p of prepared) {
          const file = path.join(datasetDir, p.video.file);
          const bytes = (await fs.stat(file)).size;
          let entry = geoCache.videos[p.video.id];
          if (!entry || entry.bytes !== bytes) {
            const frames = await sampleFrameJpegs(file, { count: frameCount, durationSec: p.metadata?.durationSec ?? null, fps: p.metadata?.fps ?? null, tmpDir: geoTmp });
            const t0 = performance.now();
            const embeds = await worldModel.embed(frames.jpegs);
            const ms = performance.now() - t0;
            entry = { bytes, frames: frames.jpegs.length, times: frames.times, embeds: toB64(embeds), preprocessMs: 0, inferMs: ms };
            geoCache.videos[p.video.id] = entry;
            geoDirty = true;
            geoTiming.embeddedVideos++;
            geoTiming.embedMsPerFrame.push(ms / Math.max(1, frames.jpegs.length));
          } else {
            geoTiming.cachedVideos++;
          }
          const result = await worldModel.predictEmbeddings(fromB64(entry.embeds), entry.frames);
          geoTiming.predictMs.push(result.ms);
          p.geoclip = result.prediction;
          if (!result.prediction) say(`  ${p.video.id}: kein GeoCLIP-Ergebnis (${result.reason?.de ?? result.state})`);
        }
      } finally {
        await fs.rm(geoTmp, { recursive: true, force: true });
      }
      geoclipUsed = prepared.some((p) => p.geoclip !== null);
    } catch (err: unknown) {
      say(`GeoCLIP nicht nutzbar: ${err instanceof Error ? err.message : String(err)}; Messung ohne Weltmodell.`);
    } finally {
      await worldModel.close();
    }
    if (geoDirty) {
      await fs.mkdir(cacheDir, { recursive: true });
      await fs.writeFile(geoCacheFile, JSON.stringify(geoCache));
    }
    say(
      `GeoCLIP (${precision}, ${geoTiming.threads} Threads): ${geoTiming.cachedVideos} Videos aus dem Cache, ${geoTiming.embeddedVideos} neu eingebettet; ` +
        `Galerie bereit nach ${(geoTiming.galleryReadyMs / 1000).toFixed(1)} s, Vorhersage im Median ${(median(geoTiming.predictMs) / 1000).toFixed(2)} s je Video.`,
    );
  }
}

const train = prepared.filter((p) => p.split === 'train');
const test = prepared.filter((p) => p.split === 'test');

// ---- tuning on the training half only
// The search always starts from the same hand-set values (not from the current defaults, which
// are the result of the last run), so that a rerun reproduces the tuning.
const START: LocateParams = {
  ...DEFAULT_LOCATE_PARAMS,
  k: 15,
  simTemperature: 0.03,
  kernelMix: [0.5, 0.3, 0.2],
  priorExponent: 0.5,
  regionThreshold: 0.55,
  gapThreshold: 0,
  recognitionGap: 0.06,
  landmarkSimilarity: 0.75,
  countryVoteWeight: 1,
  regionAnchor: 'neighbours',
  countryMinP: 0.3,
  continentMinP: 0.4,
  prior: { temperature: 0.01, uniformMix: 0.01, populationExponent: 1 },
  confidence: { bias: -6, topSim: 8, gap: 0, margin: 2, share: 1, region: 0, continent: 0, countryP: 1, agreement: 0, worldModel: 0, concentration: 0, agreeMass: 0 },
  strongGap: 0.1,
  agreementMin: 0.5,
  radiusKm: { strong: 0.5, recognised: 0.5, similar: 25, countryFactor: 1, continentFactor: 1 },
  ...(fixedPooling ? { tilePooling: fixedPooling } : {}),
  ...(fixedAggregation ? { frameAggregation: fixedAggregation } : {}),
};
const prior = tunePrior(world, train, START);
let params: LocateParams = {
  ...START,
  prior: { ...START.prior, temperature: prior.temperature, populationExponent: prior.populationExponent },
};
const zeroShot = {
  untuned: { all: zeroShotAccuracy(world, prepared, START.prior) },
  tuned: {
    train: zeroShotAccuracy(world, train, params.prior),
    test: zeroShotAccuracy(world, test, params.prior),
    all: zeroShotAccuracy(world, prepared, params.prior),
  },
  withoutPopulationPrior: { all: zeroShotAccuracy(world, prepared, { ...params.prior, populationExponent: 0 }) },
};
// --params default: the gallery's parameters as the engine runs them, nothing tuned again.
const tuned = paramSource === 'default' ? { params: { ...DEFAULT_LOCATE_PARAMS }, log: ['DEFAULT_LOCATE_PARAMS übernommen (--params default)'] } : tune(world, train, params);
params = tuned.params;
say(`Abstimmung (nur Abstimmungshälfte): ${tuned.log.join('; ')}`);
// Country- and continent-level answers only where the training half shows they are right at
// least half of the time (the coarse-answer cut-offs are not fitted to the Im2GPS objective).
if (paramSource === 'tuned') {
  const rows = [...train.map((p) => runMode(world, p, 'unknown', params)), ...train.map((p) => runMode(world, p, 'open', params))];
  params = {
    ...params,
    countryMinP: precisionThreshold(rows.map((o) => ({ p: o.countryTopP, correct: o.countryCorrect === true })), 0.5, params.countryMinP),
    continentMinP: precisionThreshold(rows.map((o) => ({ p: o.continentTopP, correct: o.continentCorrect })), 0.5, params.continentMinP),
  };
}
if (paramSource === 'tuned') {
  const trainOpen = train.map((p) => runMode(world, p, 'open', params));
  params = { ...params, landmarkSimilarity: landmarkThreshold(trainOpen, params.landmarkSimilarity) };
}
// Radii: the agreement cut-off that gives the smallest median stated radius on train, each tier
// calibrated to cover the truth in RADIUS_TARGET of its training cases.
let radiusCalibration: ReturnType<typeof calibrateRadii> | null = null;
if (paramSource === 'tuned') {
  let best: { median: number; strongGap: number; agreementMin: number; radii: ReturnType<typeof calibrateRadii> } | null = null;
  for (const strongGap of [params.recognitionGap, 0.1, 0.12, 0.14]) {
    for (const agreementMin of [0, 0.34, 0.5, 0.67, 0.8]) {
      const trial = { ...params, strongGap, agreementMin };
      const runs = runAll(world, train, trial);
      const radii = calibrateRadii([...runs.open, ...runs.unknown]);
      const { counts: _c, ...radiusKm } = radii;
      const again = runAll(world, train, { ...trial, radiusKm });
      // Geometric mean of the stated radii: every tier covers RADIUS_TARGET by construction, so
      // the cut-offs that keep the circles smallest overall win.
      const all = [...again.open, ...again.unknown];
      const m = all.reduce((s, o) => s + Math.log(Math.max(0.5, o.radiusKm)), 0) / Math.max(1, all.length);
      if (!best || m < best.median - 1e-9) best = { median: m, strongGap, agreementMin, radii };
    }
  }
  if (best) {
    const { counts: _c, ...radiusKm } = best.radii;
    params = { ...params, strongGap: best.strongGap, agreementMin: best.agreementMin, radiusKm };
    radiusCalibration = best.radii;
  }
}
if (paramSource === 'tuned') {
  const trainRuns = runAll(world, train, params);
  params = {
    ...params,
    confidence: fitConfidence([...trainRuns.open, ...trainRuns.unknown].map((o) => ({ f: o.features, hit: o.withinRadius }))),
  };
}
/** The gallery alone: the state before the world model ("before"). */
const galleryParams: LocateParams = params;
// Shown with the tuned parameters: the gallery's confidence model is the one runs without the
// world model use (fitted again in tuned mode, DEFAULT_LOCATE_PARAMS' otherwise).

// ---- world model: fusion recipe, radius of its answers and confidence, on the train half
// The recipe itself (agreeKm, minAgree, replaceTiers, concentrationKm) is the one chosen on the
// train half by scripts/datum/evaluateGeoclip.ts. Here the radius of concentrated answers
// (concentration >= 0.2) is chosen between 1 km and 25 km: the one whose train coverage lies
// nearer the RADIUS_TARGET (as every tier is calibrated), 25 km on a tie (five train cases cannot
// tell a 1 km circle from a 25 km one when no case lies between them). The radius of the other
// answers stays the recipe's (1500 km, calibrated by evaluateGeoclip.ts); its train coverage and
// the radius the 70 % rule would give for those cases alone are reported.
let worldModelChoice: Record<string, unknown> | null = null;
if (geoclipUsed) {
  const concentratedFrom = params.geoclip.radius[0]?.minConcentration ?? 0.2;
  const probe: LocateParams = { ...params, geoclip: { ...params.geoclip, radius: [{ minConcentration: concentratedFrom, radiusKm: 25 }, { minConcentration: 0, radiusKm: 1500 }] } };
  const probeRuns = runAll(world, train, probe, true);
  const geoTrain = [...probeRuns.open, ...probeRuns.unknown].filter((o) => o.source === 'worldmodel');
  const concentrated = geoTrain.filter((o) => (o.concentration ?? 0) >= concentratedFrom);
  const diffuse = geoTrain.filter((o) => (o.concentration ?? 0) < concentratedFrom);
  const coverage = (rows: ModeOutcome[], km: number): number => rows.filter((o) => o.errorKm <= km).length / Math.max(1, rows.length);
  const c1 = coverage(concentrated, 1);
  const c25 = coverage(concentrated, 25);
  const concentratedKm = concentrated.length >= 4 && Math.abs(c1 - RADIUS_TARGET) < Math.abs(c25 - RADIUS_TARGET) - 1e-9 ? 1 : 25;
  const diffuseKm = params.geoclip.radius[params.geoclip.radius.length - 1]?.radiusKm ?? 1500;
  const diffuseRuleKm = RADIUS_GRID_KM.find((r) => coverage(diffuse, r) >= RADIUS_TARGET) ?? (RADIUS_GRID_KM[RADIUS_GRID_KM.length - 1] as number);
  params = { ...params, geoclip: { ...params.geoclip, radius: [{ minConcentration: concentratedFrom, radiusKm: concentratedKm }, { minConcentration: 0, radiusKm: diffuseKm }] } };
  // The fused answers get a confidence model of their own (the gallery's stays for runs without
  // the world model).
  const fusedTrain = runAll(world, train, params, true);
  params = { ...params, geoclip: { ...params.geoclip, confidence: fitConfidence([...fusedTrain.open, ...fusedTrain.unknown].map((o) => ({ f: o.features, hit: o.withinRadius }))) } };
  worldModelChoice = {
    recipe: { agreeKm: params.geoclip.agreeKm, minAgree: params.geoclip.minAgree, replaceTiers: params.geoclip.replaceTiers, concentrationKm: params.geoclip.concentrationKm },
    trainWorldModelAnswers: geoTrain.length,
    concentrated: {
      minConcentration: concentratedFrom,
      trainCases: concentrated.length,
      trainCoverage1km: round(c1, 3),
      trainCoverage25km: round(c25, 3),
      trainErrorsKm: concentrated.map((o) => round(o.errorKm, 2)).sort((a, b) => a - b),
      chosenKm: concentratedKm,
      rule: `radius whose train coverage lies nearer ${RADIUS_TARGET}; 25 km on a tie or with fewer than 4 cases`,
    },
    diffuse: { trainCases: diffuse.length, chosenKm: diffuseKm, trainCoverageChosen: round(coverage(diffuse, diffuseKm), 3), radiusBy70PercentRuleKm: diffuseRuleKm },
  };
  say(`Weltmodell: Radius konzentrierter Antworten ${concentratedKm} km (Abstimmungshälfte: ${concentrated.length} Fälle, im Kreis bei 1 km ${(c1 * 100).toFixed(0)} %, bei 25 km ${(c25 * 100).toFixed(0)} %); übrige ${diffuseKm} km (${diffuse.length} Fälle).`);
}

// ---- final run with the tuned parameters
const finalGallery = runAll(world, prepared, galleryParams, false);
const final = geoclipUsed ? runAll(world, prepared, params, true) : finalGallery;
// Confidence is recomputed with the fitted model by decideLocation itself (params.confidence).
const pick = (runs: Record<Mode, ModeOutcome[]>, mode: Mode, split: 'train' | 'test' | 'all'): ModeOutcome[] =>
  runs[mode].filter((_, i) => split === 'all' || (prepared[i] as Prepared).split === split);
const bySplit = (mode: Mode, split: 'train' | 'test' | 'all'): ModeOutcome[] => pick(final, mode, split);

const summary: Record<string, Record<string, Record<string, number>>> = {};
const summaryGallery: Record<string, Record<string, Record<string, number>>> = {};
for (const mode of MODES) {
  summary[mode] = {};
  summaryGallery[mode] = {};
  for (const split of ['train', 'test', 'all'] as const) {
    (summary[mode] as Record<string, Record<string, number>>)[split] = summarise(bySplit(mode, split));
    (summaryGallery[mode] as Record<string, Record<string, number>>)[split] = summarise(pick(finalGallery, mode, split));
  }
}
// Baselines for orientation: zero-shot country only (centroid answer), on the test half.
const baseline = (() => {
  const p0: LocateParams = { ...params, regionThreshold: 2, countryVoteWeight: 0, regionAnchor: 'centroid' };
  return summarise(test.map((p) => runMode(world, p, 'unknown', p0)));
})();

const times = prepared.map((p) => p.timing.totalMs);
const report = {
  generatedAt: new Date().toISOString(),
  changes: CHANGES,
  model: config.modelId,
  modelSlug: modelSlug(),
  device: model.state.device,
  threads: config.threads,
  cpu: os.cpus()[0]?.model ?? 'unknown',
  dataset: {
    dir: path.relative(repoRoot, datasetDir),
    videosInManifest: manifest.videos.length,
    videosEvaluated: prepared.length,
    galleryImages: gallery.size,
    galleryTestItems: gallery.list().filter((g) => g.testItem).length,
  },
  protocol: {
    framesPerVideo: frameCount,
    frameSampling: `middle of equal segments; tiles as the pipeline at detail "${detail}" (tile 0 = whole frame, further tiles = square crops), each resized to the model input`,
    modes: {
      open: 'whole gallery, including the picture of the same Wikidata item (known-landmark case, leakage on purpose)',
      unknown: 'gallery without the same Wikidata item (excludeWikidata: [video.wikidata])',
    },
    scored: 'visual estimate (GPS in the file is reported separately and not scored)',
    thresholdsKm: THRESHOLDS_KM,
    split: 'manifest videos sorted by id; even index = train (all tuning), odd index = test (report only)',
    trainIds: train.map((p) => p.video.id),
    testIds: test.map((p) => p.video.id),
    tuningObjective: 'mean of the five Im2GPS accuracies, averaged over both modes, train half only',
  },
  zeroShotCountryPrior: zeroShot,
  tuned: {
    params,
    paramSource,
    prior,
    log: tuned.log,
  },
  worldModel: geoclipUsed
    ? {
        model: 'GeoCLIP (Xenova/geoclip-large-patch14, MIT), int8 image tower unless DATUM_GEOCLIP_PRECISION=fp32, in its worker thread (datum/geoclipService.ts)',
        precision: geoTiming.precision,
        threads: geoTiming.threads,
        caveat: 'the reference landmarks are likely in GeoCLIP\'s Flickr training data: the gain on landmark videos may be larger than on arbitrary footage',
        choice: worldModelChoice,
        timing: {
          galleryReadyMs: round(geoTiming.galleryReadyMs, 0),
          embeddedVideos: geoTiming.embeddedVideos,
          cachedVideos: geoTiming.cachedVideos,
          embedMsPerFrameMedian: geoTiming.embedMsPerFrame.length > 0 ? round(median(geoTiming.embedMsPerFrame), 0) : null,
          predictFromEmbeddingsMsMedian: round(median(geoTiming.predictMs), 0),
          note: 'predictFromEmbeddings = scoring against the 100 000 gallery points, modes, refinement and countries in the worker; embedding of the 12 frames comes on top in the node (embedMsPerFrame, from this run or the evaluateGeoclip cache)',
        },
      }
    : null,
  timing: {
    galleryEmbedImagesPerSec: round(galleryReport.imagesPerSec, 1),
    embedThroughputImagesPerSec: round(throughput, 1),
    embedThroughputNote: 'gallery thumbnails (~330 px), batch ' + config.batchSize + ', ' + config.threads + ' threads; machine shared with other jobs while measured',
    galleryEmbeddedThisRun: galleryReport.embedded,
    galleryRestartMs: round(reload.loadMs, 0),
    countryTextVectorsMs: round(countryTextMs, 0),
    perVideoMedianMs: round(median(times), 0),
    perVideoMeanMs: round(times.reduce((s, t) => s + t, 0) / Math.max(1, times.length), 0),
    perVideoFramesMedianMs: round(median(prepared.map((p) => p.timing.framesMs)), 0),
    perVideoLocateMedianMs: round(median(prepared.map((p) => p.timing.locateMs)), 1),
    perVideoSearchMedianMs: round(median(searchMs), 1),
    note: 'framesMs = sampling and embedding of all tiles (taken from the evaluation cache when present); the live engine reuses the stored tile vectors, so it pays only search and decision',
  },
  summary,
  summaryGalleryOnly: summaryGallery,
  baselineZeroShotCentroidTestUnknown: baseline,
  radius: {
    meaning: `stated radius per evidence tier, calibrated on the train half to cover the truth in ${RADIUS_TARGET * 100} % of its cases (both modes)`,
    calibration: radiusCalibration,
    coverageByTier: {
      train: { open: coverageByTier(bySplit('open', 'train')), unknown: coverageByTier(bySplit('unknown', 'train')) },
      test: { open: coverageByTier(bySplit('open', 'test')), unknown: coverageByTier(bySplit('unknown', 'test')) },
    },
  },
  calibration: {
    meaning: 'confidence = estimated probability that the true place lies within radiusKm',
    test: { open: calibration(bySplit('open', 'test')), unknown: calibration(bySplit('unknown', 'test')) },
    scores: {
      fused: { train: calibrationScore([...bySplit('open', 'train'), ...bySplit('unknown', 'train')]), test: calibrationScore([...bySplit('open', 'test'), ...bySplit('unknown', 'test')]) },
      galleryOnly: {
        train: calibrationScore([...pick(finalGallery, 'open', 'train'), ...pick(finalGallery, 'unknown', 'train')]),
        test: calibrationScore([...pick(finalGallery, 'open', 'test'), ...pick(finalGallery, 'unknown', 'test')]),
      },
    },
  },
  videos: prepared.map((p, i) => ({
    id: p.video.id,
    label: p.video.label,
    wikidata: p.video.wikidata,
    split: p.split,
    truth: { lat: p.video.lat, lon: p.video.lon, country: p.truthIso, countriesAccepted: p.truthIsos },
    gpsInFile: p.hasGps,
    timeMs: round(p.timing.totalMs, 0),
    open: compact(final.open[i] as ModeOutcome),
    unknown: compact(final.unknown[i] as ModeOutcome),
    ...(geoclipUsed ? { galleryOnly: { open: compact(finalGallery.open[i] as ModeOutcome), unknown: compact(finalGallery.unknown[i] as ModeOutcome) } } : {}),
  })),
};

function compact(o: ModeOutcome): Record<string, unknown> {
  return {
    lat: round(o.lat, 5),
    lon: round(o.lon, 5),
    method: o.method,
    label: o.label,
    country: o.country,
    radiusKm: round(o.radiusKm, 2),
    confidence: round(o.confidence, 3),
    errorKm: round(o.errorKm, 2),
    withinRadius: o.withinRadius,
    topSimilarity: round(o.topSimilarity, 4),
    gap: round(o.features.gap, 4),
    agreement: round(o.features.agreement, 3),
    topReference: o.topReference,
    topReferenceIsSameItem: o.topReferenceIsSameItem,
    countryCorrect: o.countryCorrect,
    level: o.level,
    radiusTier: o.radiusTier,
    countryTopP: round(o.countryTopP, 3),
    continentTop: o.continentTop,
    continentTopP: round(o.continentTopP, 3),
    zeroShotCountry: o.zeroShotCountry,
    source: o.source,
    ...(o.concentration !== null ? { concentration: round(o.concentration, 3) } : {}),
  };
}

await fs.mkdir(path.dirname(outFile), { recursive: true });
await fs.writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`);

// ---- table
say('');
say('Video                              Teil   offen: Fehler km  Methode   Konf  | unbekannt: Fehler km  Methode  Konf');
for (const [i, p] of prepared.entries()) {
  const o = final.open[i] as ModeOutcome;
  const u = final.unknown[i] as ModeOutcome;
  say(
    `${p.video.id.slice(0, 12).padEnd(12)} ${p.video.label.slice(0, 21).padEnd(21)} ${p.split.padEnd(5)}  ${o.errorKm.toFixed(1).padStart(10)}  ${o.method.padEnd(8)} ${o.confidence.toFixed(2)}  | ${u.errorKm.toFixed(1).padStart(10)}  ${u.method.padEnd(8)} ${u.confidence.toFixed(2)}`,
  );
}
const printSummary = (title: string, table: Record<string, Record<string, Record<string, number>>>): void => {
  say('');
  say(title);
  say('Modus     Teil    n   Median km   ≤1 km  ≤25 km  ≤200 km  ≤750 km  ≤2500 km  Land   im Radius  Konf');
  for (const mode of MODES) {
    for (const split of ['train', 'test', 'all'] as const) {
      const s = (table[mode] as Record<string, Record<string, number>>)[split] as Record<string, number>;
      const pc = (v: number | undefined): string => `${((v ?? 0) * 100).toFixed(0)} %`.padStart(7);
      say(
        `${mode.padEnd(9)} ${split.padEnd(5)} ${String(s['n']).padStart(4)} ${String(s['medianKm']).padStart(10)} ${pc(s['acc1km'])} ${pc(s['acc25km'])} ${pc(s['acc200km'])} ${pc(s['acc750km'])} ${pc(s['acc2500km'])} ${pc(s['countryAcc'])} ${pc(s['withinRadius'])}  ${(s['meanConfidence'] ?? 0).toFixed(2)}`,
      );
    }
  }
};
if (geoclipUsed) printSummary('Vorher: Referenzgalerie allein', summaryGallery);
printSummary(geoclipUsed ? 'Nachher: mit Weltmodell (GeoCLIP)' : 'Referenzgalerie (ohne Weltmodell)', summary);
say('');
say(`Zeit pro Video: Median ${(median(times) / 1000).toFixed(2)} s (Bilder ${(report.timing.perVideoFramesMedianMs / 1000).toFixed(2)} s, Entscheidung ${report.timing.perVideoLocateMedianMs} ms).`);
say(
  `Zero-shot-Länderprior allein (alle ${zeroShot.tuned.all.n}): Top-1 ${(zeroShot.tuned.all.top1 * 100).toFixed(0)} %, Top-5 ${(zeroShot.tuned.all.top5 * 100).toFixed(0)} % ` +
    `(ohne Bevölkerungsprior: ${(zeroShot.withoutPopulationPrior.all.top1 * 100).toFixed(0)} % / ${(zeroShot.withoutPopulationPrior.all.top5 * 100).toFixed(0)} %).`,
);
say(`Abgestimmte Parameter: ${JSON.stringify({ ...params, kernelsKm: undefined })}`);
say(`Geschrieben: ${path.relative(repoRoot, outFile)}`);

