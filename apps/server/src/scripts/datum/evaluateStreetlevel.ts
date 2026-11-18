/**
 * Measures the street-level refinement (datum/streetlevel.ts) on the reference videos.
 *
 *   npx tsx src/scripts/datum/evaluateStreetlevel.ts [--radius 3] [--wrong-km 50] [--wrong-count 2]
 *       [--only fr-] [--limit N] [--crops] [--budget 20000] [--repeat 3] [--verbose]
 *       [--out docs/measurements/datum-streetlevel.json]
 *   npx tsx src/scripts/datum/evaluateStreetlevel.ts --from docs/measurements/datum-streetlevel.json
 *       (no network: recomputes summary and threshold sweep from recorded calls, e.g. after
 *       changing the defaults in streetlevel.ts)
 *
 * For every reference video: 12 frames (whole frame plus square crops, the pipeline's 'standard'
 * tiling, as sampleAndEmbedFrames in locate.ts; taken from the vector cache of
 * scripts/datum/evaluate.ts when it holds them) are compared with street-level pictures around
 *   true    the true place (Wikidata coordinate of the filmed object) with a radius of --radius km,
 *           simulating a good coarse estimate;
 *           With --offset-km the centre is moved that far from the truth (bearing fixed per video).
 *   wrong   --wrong-count places --wrong-km away (bearings fixed per video), where no match must
 *           be claimed.
 * Reported: whether the best picture lies within 200 m / 1 km of the truth, the gap of the best
 * picture over the typical one, how often a match is claimed at the wrong place, and the time
 * per call. The decision thresholds are swept on the videos with even index (tuning half) and the
 * odd half is reported separately. Needs network access to Panoramax (and Mapillary when
 * MAPILLARY_TOKEN is set); the model is loaded from the local cache only.
 *
 * The truth is the coordinate of the filmed object, not the camera: a camera 800 m from the
 * Eiffel Tower is right, so the 1 km figure is the meaningful one.
 */
process.env['SICHT_OFFLINE'] ??= '1';
// Moderate CPU: other work shares the machine.
process.env['ML_THREADS'] ??= '2';

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const { config, repoRoot } = await import('../../config.js');
const { EmbeddingModel } = await import('../../ml/model.js');
const { modelSlug } = await import('../../datum/gallery.js');
const { readMetadata } = await import('../../datum/metadata.js');
const { sampleAndEmbedFrames } = await import('../../datum/locate.js');
const sl = await import('../../datum/streetlevel.js');
type StreetLevelResult = import('../../datum/streetlevel.js').StreetLevelResult;
type StreetLevelStats = import('../../datum/streetlevel.js').StreetLevelStats;
type StreetLevelOptions = import('../../datum/streetlevel.js').StreetLevelOptions;

const say = (line: string): void => void process.stdout.write(`${line}\n`);

function argument(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  const value = idx >= 0 ? process.argv[idx + 1] : undefined;
  return value !== undefined && !value.startsWith('--') ? value : fallback;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

interface ManifestVideo {
  id: string;
  file: string;
  label: string;
  wikidata: string;
  lat: number;
  lon: number;
  country?: string;
}

const datasetDir = path.resolve(repoRoot, argument('dataset', 'datasets/datum'));
const radiusKm = Number(argument('radius', '3'));
const wrongKm = Number(argument('wrong-km', '50'));
const only = argument('only', '');
const limit = Number(argument('limit', '0'));
const budgetMs = Number(argument('budget', String(sl.DEFAULT_STREETLEVEL_OPTIONS.budgetMs)));
const repeat = Number(argument('repeat', '3'));
/** Wrong places per video (bearings spread by the golden angle and its opposite). */
const wrongCount = Math.max(0, Math.min(4, Number(argument('wrong-count', '2'))));
/** Moves the 'true' candidate's centre this far from the truth (a coarse estimate that is off). */
const offsetKm = Math.max(0, Number(argument('offset-km', '0')));
const crops = flag('crops');
const verbose = flag('verbose');
const outFile = path.resolve(repoRoot, argument('out', 'docs/measurements/datum-streetlevel.json'));
const evalCacheDir = path.resolve(repoRoot, '.cache/datum');
const FRAMES = 12;

const manifest = JSON.parse(await fs.readFile(path.join(datasetDir, 'manifest.json'), 'utf8')) as { videos: ManifestVideo[] };
let videos = manifest.videos.filter((v) => typeof v.lat === 'number' && typeof v.lon === 'number' && typeof v.file === 'string');
// The same split as scripts/datum/evaluate.ts: sorted by id, even index = tuning half.
videos.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const indexOf = new Map(videos.map((v, i) => [v.id, i]));
if (only !== '') videos = videos.filter((v) => only.split(',').some((p) => v.id.startsWith(p)));
if (limit > 0) videos = videos.slice(0, limit);

const fromFile = argument('from', '');
const model = new EmbeddingModel();
if (fromFile === '') {
  const tModel = performance.now();
  await model.load();
  say(`Modell ${config.modelId} (${model.state.device}, ${config.threads} Threads) in ${((performance.now() - tModel) / 1000).toFixed(1)} s geladen.`);
}
say(`Straßenbilder: ${videos.length} Videos, Radius ${radiusKm} km, falscher Ort ${wrongKm} km, Budget ${budgetMs} ms, Ausschnitte ${crops ? 'ja' : 'nein'}, Mapillary ${process.env['MAPILLARY_TOKEN'] ? 'mit Schlüssel' : 'ohne Schlüssel (nicht gefragt)'}.`);

// ---- frames: the vector cache of evaluate.ts (same sampling), else sampled here
type FrameCacheEntry = { bytes: number; frameNumbers: number[]; dim: number; vectors: string; tiles: string | null; frameRow: number[]; tile: number[] };
const frameCacheFile = path.join(evalCacheDir, `eval-frames-${modelSlug()}-${FRAMES}-standard.json`);
const frameCache: Record<string, FrameCacheEntry> = await fs
  .readFile(frameCacheFile, 'utf8')
  .then((t) => JSON.parse(t) as Record<string, FrameCacheEntry>)
  .catch(() => ({}));
const fromB64 = (t: string): Float32Array => {
  const b = Buffer.from(t, 'base64');
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-streetlevel-'));

interface Frames {
  vectors: Float32Array;
  dim: number;
  frameNumbers: number[];
  tiles: { vectors: Float32Array; frameRow: number[] } | null;
  source: 'cache' | 'sampled';
}

async function framesOf(video: ManifestVideo): Promise<Frames> {
  const file = path.join(datasetDir, video.file);
  const bytes = (await fs.stat(file)).size;
  const hit = frameCache[video.id];
  if (hit && hit.bytes === bytes && hit.dim === model.dim) {
    return {
      vectors: fromB64(hit.vectors),
      dim: hit.dim,
      frameNumbers: hit.frameNumbers,
      tiles: hit.tiles ? { vectors: fromB64(hit.tiles), frameRow: hit.frameRow } : null,
      source: 'cache',
    };
  }
  const meta = await readMetadata(file).catch(() => null);
  const sampled = await sampleAndEmbedFrames(file, model, {
    count: FRAMES,
    durationSec: meta?.durationSec ?? null,
    fps: meta?.fps ?? null,
    tmpDir,
    detail: 'standard',
  });
  return {
    vectors: sampled.vectors,
    dim: sampled.dim,
    frameNumbers: sampled.frameNumbers,
    tiles: sampled.tiles ? { vectors: sampled.tiles.vectors, frameRow: sampled.tiles.frameRow } : null,
    source: 'sampled',
  };
}

// ---- one call
interface PictureOut {
  provider: string;
  id: string;
  lat: number;
  lon: number;
  similarity: number;
  pass: 1 | 2;
  truthKm: number;
  pageUrl: string;
  license: string;
}

interface CallRecord {
  id: string;
  label: string;
  country: string | null;
  split: 'train' | 'test';
  kind: 'true' | 'wrong';
  /** Which wrong place (0, 1, ...); 0 for 'true'. */
  variant: number;
  candidate: { lat: number; lon: number; radiusKm: number };
  /** Distance of the candidate centre from the truth (0 for 'true'). */
  offsetKm: number;
  reasonCode: string;
  reason: string;
  matched: boolean;
  stats: StreetLevelStats | null;
  listed: number;
  sampled: number;
  compared: number;
  timing: StreetLevelResult['timing'];
  providers: { name: string; requests: number; errors: number; listed: number; lastError: string | null }[];
  top: PictureOut[];
  /** Best picture's distance from the truth (km), null without pictures. */
  bestKm: number | null;
  /** Refined point's distance from the truth (km), only with a match. */
  refinedKm: number | null;
  refinedRadiusKm: number | null;
  confidence: number | null;
  /** The refined point computed for every call (as if matched): distance from the truth, radius. */
  pointKm: number | null;
  pointRadiusKm: number | null;
  /** The compared picture nearest the truth: its distance and its rank by similarity (1 = best). */
  nearestKm: number | null;
  nearestRank: number | null;
  /** Compared pictures within 1 km of the truth. */
  within1km: number;
}

function pictureOut(p: { provider: string; id: string; lat: number; lon: number; similarity: number; pass: 1 | 2; pageUrl: string; license: string }, truth: { lat: number; lon: number }): PictureOut {
  // Authors are not written into the repository; the page URL leads to the picture and its credit.
  return {
    provider: p.provider,
    id: p.id,
    lat: Number(p.lat.toFixed(6)),
    lon: Number(p.lon.toFixed(6)),
    similarity: Number(p.similarity.toFixed(4)),
    pass: p.pass,
    truthKm: Number(sl.distanceKm(truth.lat, truth.lon, p.lat, p.lon).toFixed(3)),
    pageUrl: p.pageUrl,
    license: p.license,
  };
}

async function measure(video: ManifestVideo, frames: Frames, kind: 'true' | 'wrong', variant = 0, options: Partial<StreetLevelOptions> = {}): Promise<CallRecord> {
  const index = indexOf.get(video.id) ?? 0;
  const bearing = (index * 137.508 + variant * 180 + (variant >> 1) * 90) % 360;
  const centre =
    kind === 'true'
      ? offsetKm > 0
        ? sl.destinationPoint(video.lat, video.lon, (index * 97.3) % 360, offsetKm)
        : { lat: video.lat, lon: video.lon }
      : sl.destinationPoint(video.lat, video.lon, bearing, wrongKm);
  const result = await sl.refineStreetLevel({
    frameVectors: frames.vectors,
    dim: frames.dim,
    frameNumbers: frames.frameNumbers,
    ...(frames.tiles ? { tiles: frames.tiles } : {}),
    candidates: [{ ...centre, radiusKm }],
    model,
    options: { budgetMs, pictureCrops: crops, returnAll: true, ...options },
  }, verbose ? { log: (line) => say(`    ${line}`) } : {});
  const truth = { lat: video.lat, lon: video.lon };
  const all = result.all ?? [];
  const best = all[0];
  let nearestKm: number | null = null;
  let nearestRank: number | null = null;
  all.forEach((p, i) => {
    const d = sl.distanceKm(truth.lat, truth.lon, p.lat, p.lon);
    if (nearestKm === null || d < nearestKm) {
      nearestKm = d;
      nearestRank = i + 1;
    }
  });
  const cand = result.candidates[0];
  const point = all.length > 0 ? sl.refinedPoint(all, sl.DEFAULT_STREETLEVEL_OPTIONS) : null;
  return {
    id: video.id,
    label: video.label,
    country: video.country ?? null,
    split: index % 2 === 0 ? 'train' : 'test',
    kind,
    variant,
    candidate: { lat: Number(centre.lat.toFixed(6)), lon: Number(centre.lon.toFixed(6)), radiusKm },
    offsetKm: kind === 'true' ? offsetKm : wrongKm,
    reasonCode: result.reasonCode,
    reason: result.reason,
    matched: result.matched,
    stats: result.stats,
    listed: cand?.listed ?? 0,
    sampled: cand?.sampled ?? 0,
    compared: cand?.compared ?? 0,
    timing: result.timing,
    providers: result.providers.map((p) => ({ name: p.name, requests: p.requests, errors: p.errors, listed: p.listed, lastError: p.lastError })),
    top: result.top.map((p) => pictureOut(p, truth)),
    bestKm: best ? Number(sl.distanceKm(truth.lat, truth.lon, best.lat, best.lon).toFixed(3)) : null,
    refinedKm: result.location ? Number(sl.distanceKm(truth.lat, truth.lon, result.location.lat, result.location.lon).toFixed(3)) : null,
    refinedRadiusKm: result.location ? Number(result.location.radiusKm.toFixed(3)) : null,
    confidence: result.location ? Number(result.location.confidence.toFixed(3)) : null,
    pointKm: point ? Number(sl.distanceKm(truth.lat, truth.lon, point.lat, point.lon).toFixed(3)) : null,
    pointRadiusKm: point ? Number(point.radiusKm.toFixed(3)) : null,
    nearestKm: nearestKm === null ? null : Number((nearestKm as number).toFixed(3)),
    nearestRank,
    within1km: all.filter((p) => sl.distanceKm(truth.lat, truth.lon, p.lat, p.lon) <= 1).length,
  };
}

// ---- run (or read the calls of an earlier run)
const records: CallRecord[] = [];
let frameSources: Record<string, 'cache' | 'sampled'> = {};
let repeats: { id: string; firstMs: number; againMs: number; fromCache: number; requests: number }[] = [];
let measuredAt = new Date().toISOString();
if (fromFile !== '') {
  const earlier = JSON.parse(await fs.readFile(path.resolve(repoRoot, fromFile), 'utf8')) as {
    measuredAt: string;
    calls: CallRecord[];
    repeats: typeof repeats;
    setup: { frameSources: typeof frameSources };
  };
  records.push(...earlier.calls);
  repeats = earlier.repeats;
  frameSources = earlier.setup.frameSources;
  measuredAt = earlier.measuredAt;
  say(`${records.length} Aufrufe aus ${fromFile} gelesen (gemessen ${measuredAt}).`);
}
for (const [i, video] of (fromFile === '' ? videos : []).entries()) {
  let frames: Frames;
  try {
    frames = await framesOf(video);
  } catch (err) {
    say(`  ${video.id}: Bilder nicht lesbar (${err instanceof Error ? err.message : String(err)})`);
    continue;
  }
  frameSources[video.id] = frames.source;
  const plan: { kind: 'true' | 'wrong'; variant: number }[] = [{ kind: 'true', variant: 0 }, ...Array.from({ length: wrongCount }, (_, v) => ({ kind: 'wrong' as const, variant: v }))];
  for (const { kind, variant } of plan) {
    const r = await measure(video, frames, kind, variant);
    records.push(r);
    const s = r.stats;
    say(
      `${String(i + 1).padStart(2)}/${videos.length} ${video.id.padEnd(34)} ${kind === 'true' ? 'true  ' : `wrong${variant}`} ${r.reasonCode.padEnd(11)} ` +
        `n=${String(r.compared).padStart(3)}/${String(r.listed).padStart(4)} ` +
        (s ? `best ${s.best.toFixed(3)} typ ${s.typical.toFixed(3)} gap ${s.gap.toFixed(3)} z ${s.z.toFixed(1)} agr ${s.agreement.toFixed(2)} ` : '') +
        (kind === 'true' && r.bestKm !== null ? `bestKm ${r.bestKm.toFixed(2)} nearest ${r.nearestKm?.toFixed(2)} (#${r.nearestRank}) ` : '') +
        `${(r.timing.totalMs / 1000).toFixed(1)} s`,
    );
  }
}

// The same calls again for a few covered videos: listings and vectors now come from the caches.
const covered = fromFile === '' ? records.filter((r) => r.kind === 'true' && (r.stats?.spreadPictures ?? 0) >= sl.DEFAULT_STREETLEVEL_OPTIONS.minPictures) : [];
for (const first of covered.slice(0, Math.max(0, repeat))) {
  const video = videos.find((v) => v.id === first.id);
  if (!video) continue;
  const again = await measure(video, await framesOf(video), 'true');
  repeats.push({ id: video.id, firstMs: Math.round(first.timing.totalMs), againMs: Math.round(again.timing.totalMs), fromCache: again.timing.fromCache, requests: again.timing.requests });
  say(`  Wiederholung ${video.id}: ${(first.timing.totalMs / 1000).toFixed(1)} s → ${(again.timing.totalMs / 1000).toFixed(1)} s (${again.timing.fromCache} Vektoren aus dem Cache, ${again.timing.requests} Abrufe)`);
}
await fs.rm(tmpDir, { recursive: true, force: true });

// ---- summary
const share = (n: number, d: number): number | null => (d > 0 ? Number((n / d).toFixed(3)) : null);
const quantile = (values: number[], q: number): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] as number;
};
const minPictures = sl.DEFAULT_STREETLEVEL_OPTIONS.minPictures;
const hasData = (r: CallRecord): boolean => r.stats !== null && r.stats.spreadPictures >= minPictures;

function summarise(subset: CallRecord[]): Record<string, unknown> {
  const truthCalls = subset.filter((r) => r.kind === 'true');
  const wrongCalls = subset.filter((r) => r.kind === 'wrong');
  const tc = truthCalls.filter(hasData);
  const wc = wrongCalls.filter(hasData);
  // The decision as the defaults in streetlevel.ts make it now (also for calls read with --from).
  const decide = (r: CallRecord): boolean => sl.isMatch(r.stats, sl.DEFAULT_STREETLEVEL_OPTIONS);
  const matchedTrue = tc.filter(decide);
  const matchedKm = matchedTrue.map((r) => r.pointKm ?? 99).sort((a, b) => a - b);
  return {
    videos: truthCalls.length,
    trueWithPictures: tc.length,
    wrongWithPictures: wc.length,
    bestWithin200m: share(tc.filter((r) => (r.bestKm ?? 99) <= 0.2).length, tc.length),
    bestWithin1km: share(tc.filter((r) => (r.bestKm ?? 99) <= 1).length, tc.length),
    nearestComparedWithin200m: share(tc.filter((r) => (r.nearestKm ?? 99) <= 0.2).length, tc.length),
    nearestComparedWithin1km: share(tc.filter((r) => (r.nearestKm ?? 99) <= 1).length, tc.length),
    matchedAtTrue: share(matchedTrue.length, tc.length),
    matchedAtTrueBestWithin1km: share(matchedTrue.filter((r) => (r.bestKm ?? 99) <= 1).length, matchedTrue.length),
    matchedAtTrueBestWithin200m: share(matchedTrue.filter((r) => (r.bestKm ?? 99) <= 0.2).length, matchedTrue.length),
    matchedAtTrueRefinedWithin1km: share(matchedTrue.filter((r) => (r.pointKm ?? 99) <= 1).length, matchedTrue.length),
    matchedAtTrueTruthInRadius: share(
      matchedTrue.filter((r) => r.pointKm !== null && r.pointRadiusKm !== null && r.pointKm <= Math.max(r.pointRadiusKm, sl.DEFAULT_STREETLEVEL_OPTIONS.minRadiusKm)).length,
      matchedTrue.length,
    ),
    /** Refined point of the matches: distance from the truth (km), sorted; sets the minimum radius. */
    matchedPointKm: matchedKm,
    pointWithin200m: share(tc.filter((r) => (r.pointKm ?? 99) <= 0.2).length, tc.length),
    pointWithin1km: share(tc.filter((r) => (r.pointKm ?? 99) <= 1).length, tc.length),
    pointKmMedian: quantile(tc.map((r) => r.pointKm ?? 99), 0.5),
    falseMatchAtWrong: share(wc.filter(decide).length, wc.length),
    falseMatchAtWrongAllCalls: share(wrongCalls.filter(decide).length, wrongCalls.length),
    gapTrueMedian: quantile(tc.map((r) => (r.stats as StreetLevelStats).gap), 0.5),
    gapWrongMedian: quantile(wc.map((r) => (r.stats as StreetLevelStats).gap), 0.5),
    gapWrongP90: quantile(wc.map((r) => (r.stats as StreetLevelStats).gap), 0.9),
    gapWrongMax: quantile(wc.map((r) => (r.stats as StreetLevelStats).gap), 1),
    secondsMedian: quantile(subset.map((r) => r.timing.totalMs / 1000), 0.5),
    secondsP90: quantile(subset.map((r) => r.timing.totalMs / 1000), 0.9),
    secondsMedianWithPictures: quantile([...tc, ...wc].map((r) => r.timing.totalMs / 1000), 0.5),
    /** Calls with pictures whose vectors were not in the cache yet (the cost of a first query). */
    firstCalls: [...tc, ...wc].filter((r) => r.timing.fromCache === 0).length,
    secondsFirstCallMedian: quantile([...tc, ...wc].filter((r) => r.timing.fromCache === 0).map((r) => r.timing.totalMs / 1000), 0.5),
    secondsFirstCallP90: quantile([...tc, ...wc].filter((r) => r.timing.fromCache === 0).map((r) => r.timing.totalMs / 1000), 0.9),
    secondsFirstCallMax: quantile([...tc, ...wc].filter((r) => r.timing.fromCache === 0).map((r) => r.timing.totalMs / 1000), 1),
    secondsNoCoverageMedian: quantile(subset.filter((r) => r.reasonCode === 'no-coverage').map((r) => r.timing.totalMs / 1000), 0.5),
    picturesComparedMedian: quantile([...tc, ...wc].map((r) => (r.stats as StreetLevelStats).pictures), 0.5),
    embedMsPerPictureMedian: quantile(
      [...tc, ...wc].filter((r) => r.timing.downloaded > 0).map((r) => Math.round(r.timing.embedMs / r.timing.downloaded)),
      0.5,
    ),
    budgetExhausted: subset.filter((r) => r.timing.budgetExhausted).length,
  };
}

/** Decision rule swept offline over the recorded statistics. */
interface Rule {
  minGap: number;
  minZ: number;
  minSimilarity: number;
}
function ruleScore(subset: CallRecord[], rule: Rule): { correct: number; wrongPin: number; truePlaces: number; falseMatch: number; wrongPlaces: number } {
  const ok = (r: CallRecord): boolean =>
    sl.isMatch(r.stats, { minPictures, minSimilarity: rule.minSimilarity, minGap: rule.minGap, minZ: rule.minZ, minAgreement: 0 });
  const tc = subset.filter((r) => r.kind === 'true' && hasData(r));
  const wc = subset.filter((r) => r.kind === 'wrong' && hasData(r));
  return {
    correct: tc.filter((r) => ok(r) && (r.bestKm ?? 99) <= 1).length,
    wrongPin: tc.filter((r) => ok(r) && (r.bestKm ?? 99) > 1).length,
    truePlaces: tc.length,
    falseMatch: wc.filter(ok).length,
    wrongPlaces: wc.length,
  };
}
const train = records.filter((r) => r.split === 'train');
const test = records.filter((r) => r.split === 'test');
const sweep: (Rule & { train: ReturnType<typeof ruleScore>; test: ReturnType<typeof ruleScore> })[] = [];
for (const minGap of [0.04, 0.06, 0.08, 0.1, 0.12, 0.14, 0.16, 0.2]) {
  for (const minZ of [0, 2, 3, 4, 5, 6]) {
    for (const minSimilarity of [0, 0.6, 0.7]) {
      const rule = { minGap, minZ, minSimilarity };
      sweep.push({ ...rule, train: ruleScore(train, rule), test: ruleScore(test, rule) });
    }
  }
}
// Chosen on the tuning half: no false match and no wrong pin, then the most correct pins, then
// the strictest rule (largest gap) among equals.
const admissible = sweep.filter((s) => s.train.falseMatch === 0 && s.train.wrongPin === 0);
const chosen = [...admissible].sort((a, b) => b.train.correct - a.train.correct || b.minGap - a.minGap || b.minZ - a.minZ || b.minSimilarity - a.minSimilarity)[0] ?? null;

const defaults = sl.DEFAULT_STREETLEVEL_OPTIONS;
const report = {
  measuredAt,
  ...(fromFile !== '' ? { summarisedAt: new Date().toISOString() } : {}),
  script: 'apps/server/src/scripts/datum/evaluateStreetlevel.ts',
  model: config.modelId,
  threads: config.threads,
  setup: {
    frames: `${FRAMES} frames per video, whole frame plus square crops (pipeline tiling 'standard'), as sampleAndEmbedFrames in locate.ts`,
    frameSources,
    candidateRadiusKm: radiusKm,
    trueCentreOffsetKm: offsetKm,
    wrongPlaceKm: wrongKm,
    wrongPlacesPerVideo: wrongCount,
    wrongBearing: 'index × 137.508° (golden angle) plus 180° for the second place, fixed per video',
    providers: process.env['MAPILLARY_TOKEN'] ? ['panoramax', 'mapillary'] : ['panoramax'],
    mapillary: process.env['MAPILLARY_TOKEN'] ? 'used' : 'not measured: no MAPILLARY_TOKEN on the measuring machine',
    pictureCrops: crops,
    options: {
      budgetMs,
      requestTimeoutMs: defaults.requestTimeoutMs,
      concurrency: defaults.concurrency,
      maxTilesPerCandidate: defaults.maxTilesPerCandidate,
      perTileLimit: defaults.perTileLimit,
      maxPicturesPerCandidate: defaults.maxPicturesPerCandidate,
      refine: defaults.refine,
      refineRounds: defaults.refineRounds,
    },
    decision: { minPictures, minSimilarity: defaults.minSimilarity, minGap: defaults.minGap, minZ: defaults.minZ, minAgreement: defaults.minAgreement },
    truth: 'Wikidata coordinate of the filmed object, not the camera position: distances under about 1 km are not meaningful',
    split: 'videos sorted by id; even index = tuning half (train), odd = test half, as scripts/datum/evaluate.ts',
  },
  summary: { all: summarise(records), train: summarise(train), test: summarise(test) },
  chosenRule: chosen,
  sweep,
  repeats,
  calls: records,
};
await fs.mkdir(path.dirname(outFile), { recursive: true });
await fs.writeFile(outFile, `${JSON.stringify(report, null, 1)}\n`);

const s = report.summary.all as Record<string, number | null>;
const pc = (v: number | null | undefined): string => (v === null || v === undefined ? '–' : `${Math.round(v * 100)} %`);
say('');
say(`Videos ${s['videos']}, mit Straßenbildern am wahren Ort ${s['trueWithPictures']}, am falschen Ort ${s['wrongWithPictures']}.`);
say(`Bestes Bild ≤ 200 m: ${pc(s['bestWithin200m'])}, ≤ 1 km: ${pc(s['bestWithin1km'])} (verglichenes Bild nächst der Wahrheit ≤ 200 m: ${pc(s['nearestComparedWithin200m'])}, ≤ 1 km: ${pc(s['nearestComparedWithin1km'])}).`);
say(`Treffer gemeldet am wahren Ort: ${pc(s['matchedAtTrue'])}, davon bestes Bild ≤ 1 km: ${pc(s['matchedAtTrueBestWithin1km'])}; am falschen Ort: ${pc(s['falseMatchAtWrong'])}.`);
say(`Abstand (gap) Median wahr ${s['gapTrueMedian']?.toFixed(3)}, falsch ${s['gapWrongMedian']?.toFixed(3)} (90 %: ${s['gapWrongP90']?.toFixed(3)}, max ${s['gapWrongMax']?.toFixed(3)}).`);
say(`Zeit je Aufruf: Median ${s['secondsMedian']?.toFixed(1)} s, 90 % ${s['secondsP90']?.toFixed(1)} s.`);
if (chosen) say(`Regel aus der Abstimmungshälfte: gap ≥ ${chosen.minGap}, z ≥ ${chosen.minZ}, best ≥ ${chosen.minSimilarity}: train ${JSON.stringify(chosen.train)}, test ${JSON.stringify(chosen.test)}`);
say(`Geschrieben: ${path.relative(repoRoot, outFile)}`);
