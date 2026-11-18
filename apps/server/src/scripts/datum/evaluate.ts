/**
 * Measures the DATUM localisation on the reference videos with known places.
 *
 *   SICHT_OFFLINE=1 npx tsx src/scripts/datum/evaluate.ts [--dataset datasets/datum] [--frames 6]
 *       [--limit N] [--out docs/measurements/datum-geolocation.json]
 *
 * For every test video: 6 evenly spaced frames are embedded, then `locate` decides twice:
 *   open      the gallery as it is (it contains a picture of the same Wikidata item: leakage, the
 *             "known landmark" case);
 *   unknown   the same item left out of the gallery (the place is not in the reference set).
 * The error is the great-circle distance to the true position; reported are the median and the
 * share within 1, 25, 200, 750 and 2500 km (the Im2GPS thresholds).
 *
 * Thresholds and temperatures are tuned only on the videos with even index ("train"); the
 * videos with odd index ("test") are reported separately and never used for a decision.
 * The result is written to docs/measurements/datum-geolocation.json and printed as a table.
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
const { DEFAULT_LOCATE_PARAMS, decideLocation, sampleAndEmbedFrames, weightNeighbours } = await import(
  '../../datum/locate.js'
);
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
const MODES = ['open', 'unknown'] as const;
type Mode = (typeof MODES)[number];
const K_MAX = 30;

interface Prepared {
  video: ManifestVideo;
  index: number;
  split: 'train' | 'test';
  truthIso: string | null;
  frameNumbers: number[];
  neighbours: Record<Mode, GalleryNeighbour[][]>;
  cosines: Float32Array;
  hasGps: boolean;
  metadata: Awaited<ReturnType<typeof readMetadata>> | null;
  timing: { framesMs: number; locateMs: number; totalMs: number };
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
  zeroShotCountry: string | null;
  features: ConfidenceFeatures;
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
  out['regionAnswers'] = outcomes.filter((o) => o.method === 'region').length;
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

function evidenceFor(p: Prepared, mode: Mode, withMetadata: boolean): LocateEvidence {
  return {
    neighbours: p.neighbours[mode],
    countryCosines: p.cosines,
    frameNumbers: p.frameNumbers,
    metadata: withMetadata ? p.metadata : null,
    hints: filenameHints(path.basename(p.video.file)),
  };
}

function runMode(world: WorldT, p: Prepared, mode: Mode, params: LocateParams): ModeOutcome {
  // The evaluation measures the picture: GPS in the file would answer trivially, so metadata
  // is reported but the visual estimate is scored.
  const ev = evidenceFor(p, mode, true);
  const neighbours = ev.neighbours.map((row) => row.slice(0, params.k));
  const r = decideLocation(world, { ...ev, neighbours }, params);
  const loc = r.diagnostics.visual;
  const lat = loc?.lat ?? 0;
  const lon = loc?.lon ?? 0;
  const errorKm = loc ? greatCircleKm(lat, lon, p.video.lat, p.video.lon) : 20_000;
  const refs = weightNeighbours(neighbours, params);
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
    countryCorrect: p.truthIso ? (r.countries[0]?.iso ?? null) === p.truthIso : null,
    zeroShotCountry: r.diagnostics.zeroShotTop[0]?.iso ?? null,
    features: r.diagnostics.features,
  };
}

function runAll(world: WorldT, items: Prepared[], params: LocateParams): Record<Mode, ModeOutcome[]> {
  return {
    open: items.map((p) => runMode(world, p, 'open', params)),
    unknown: items.map((p) => runMode(world, p, 'unknown', params)),
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
    { name: 'regionThreshold', values: [-1, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75].map((regionThreshold) => ({ regionThreshold })) },
  ];
  for (let sweep = 0; sweep < 2; sweep++) {
    let changed = false;
    for (const g of grid) {
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

/** Temperature of the zero-shot prior: maximum likelihood of the true country on the training half. */
function tunePriorTemperature(world: WorldT, train: Prepared[], base: LocateParams): { temperature: number; logLik: number; top1: number } {
  let best = { temperature: base.prior.temperature, logLik: -Infinity, top1: 0 };
  for (const temperature of [0.002, 0.003, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.03, 0.05]) {
    let ll = 0;
    let top1 = 0;
    let n = 0;
    for (const p of train) {
      if (!p.truthIso) continue;
      const probs = world.priorFromCosines(p.cosines, { ...base.prior, temperature });
      const hit = probs.find((c) => c.iso === p.truthIso);
      ll += Math.log(hit?.p ?? 1e-9);
      if (probs[0]?.iso === p.truthIso) top1++;
      n++;
    }
    if (n > 0 && ll / n > best.logLik) best = { temperature, logLik: ll / n, top1: top1 / n };
  }
  return best;
}

/** Logistic regression (L2) of "error within the stated radius" on the confidence features. */
function fitConfidence(rows: { f: ConfidenceFeatures; hit: boolean }[]): LocateParams['confidence'] {
  const keys = ['topSim', 'margin', 'share', 'region', 'countryP'] as const;
  const w = { bias: 0, topSim: 0, margin: 0, share: 0, region: 0, countryP: 0 };
  if (rows.length < 10) return DEFAULT_LOCATE_PARAMS.confidence;
  const lr = 0.5;
  const lambda = 0.01;
  for (let iter = 0; iter < 6000; iter++) {
    const g = { bias: 0, topSim: 0, margin: 0, share: 0, region: 0, countryP: 0 };
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
  return {
    bias: round(w.bias, 3),
    topSim: round(w.topSim, 3),
    margin: round(w.margin, 3),
    share: round(w.share, 3),
    region: round(w.region, 3),
    countryP: round(w.countryP, 3),
  };
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
const frameCount = Number(argument('frames', '6'));
const limit = Number(argument('limit', '0'));
const outFile = path.resolve(repoRoot, argument('out', 'docs/measurements/datum-geolocation.json'));
const cacheDir = path.join(config.dataDir, 'datum');

const manifest = JSON.parse(await fs.readFile(path.join(datasetDir, 'manifest.json'), 'utf8')) as { videos: ManifestVideo[] };
let videos = manifest.videos.filter(
  (v) => typeof v.lat === 'number' && typeof v.lon === 'number' && typeof v.file === 'string' && typeof v.id === 'string',
);
// The split is fixed by the manifest order (sorted by id for stability), not by results.
videos.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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

const embedTexts = (texts: string[]): Promise<Float32Array> => model.embedTexts(texts);
const tText = performance.now();
await world.countryTextVectors(embedTexts);
const countryTextMs = performance.now() - tText;
say(`Ländertexte (${world.countries().length} × 5 Prompts) in ${(countryTextMs / 1000).toFixed(1)} s eingebettet.`);

// ---- per video: frames, neighbours, prior
const prepared: Prepared[] = [];
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-eval-'));
for (let i = 0; i < videos.length; i++) {
  const video = videos[i] as ManifestVideo;
  const file = path.join(datasetDir, video.file);
  const t0 = performance.now();
  try {
    const metadata = await readMetadata(file).catch(() => null);
    const frames = await sampleAndEmbedFrames(file, model, {
      count: frameCount,
      durationSec: metadata?.durationSec ?? null,
      fps: metadata?.fps ?? null,
      tmpDir,
    });
    const t1 = performance.now();
    const cosines = await world.countryCosines(frames.vectors, frames.dim, embedTexts);
    const open = gallery.search(frames.vectors, K_MAX);
    const unknown = gallery.search(frames.vectors, K_MAX, { excludeWikidata: [video.wikidata] });
    const p: Prepared = {
      video,
      index: i,
      split: i % 2 === 0 ? 'train' : 'test',
      truthIso: world.countryNear(video.lat, video.lon)?.iso ?? (typeof video.country === 'string' && /^[A-Z]{2}$/.test(video.country) ? video.country : null),
      frameNumbers: frames.frameNumbers,
      neighbours: { open, unknown },
      cosines,
      hasGps: metadata?.location != null,
      metadata,
      timing: { framesMs: t1 - t0, locateMs: 0, totalMs: 0 },
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

const train = prepared.filter((p) => p.split === 'train');
const test = prepared.filter((p) => p.split === 'test');

// ---- tuning on the training half only
const prior = tunePriorTemperature(world, train, DEFAULT_LOCATE_PARAMS);
let params: LocateParams = { ...DEFAULT_LOCATE_PARAMS, prior: { ...DEFAULT_LOCATE_PARAMS.prior, temperature: prior.temperature } };
const tuned = tune(world, train, params);
params = tuned.params;
const trainOpen = train.map((p) => runMode(world, p, 'open', params));
params = { ...params, landmarkSimilarity: landmarkThreshold(trainOpen, params.landmarkSimilarity) };
const trainRuns = runAll(world, train, params);
params = {
  ...params,
  confidence: fitConfidence([...trainRuns.open, ...trainRuns.unknown].map((o) => ({ f: o.features, hit: o.withinRadius }))),
};

// ---- final run with the tuned parameters
const final = runAll(world, prepared, params);
// Confidence is recomputed with the fitted model by decideLocation itself (params.confidence).
const bySplit = (mode: Mode, split: 'train' | 'test' | 'all'): ModeOutcome[] =>
  final[mode].filter((_, i) => split === 'all' || (prepared[i] as Prepared).split === split);

const summary: Record<string, Record<string, Record<string, number>>> = {};
for (const mode of MODES) {
  summary[mode] = {};
  for (const split of ['train', 'test', 'all'] as const) (summary[mode] as Record<string, Record<string, number>>)[split] = summarise(bySplit(mode, split));
}
// Baselines for orientation: zero-shot country only (centroid answer), on the test half.
const baseline = (() => {
  const p0: LocateParams = { ...params, regionThreshold: 2, countryVoteWeight: 0, regionAnchor: 'centroid' };
  return summarise(test.map((p) => runMode(world, p, 'unknown', p0)));
})();

const times = prepared.map((p) => p.timing.totalMs);
const report = {
  generatedAt: new Date().toISOString(),
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
    frameSampling: 'middle of equal segments, full frame resized to the model input (as the pipeline)',
    modes: {
      open: 'whole gallery, including the picture of the same Wikidata item (known-landmark case, leakage on purpose)',
      unknown: 'gallery without the same Wikidata item (excludeWikidata: [video.wikidata])',
    },
    scored: 'visual estimate (GPS in the file is reported separately and not scored)',
    thresholdsKm: THRESHOLDS_KM,
    split: 'videos sorted by id; even index = train (all tuning), odd index = test (report only)',
    trainIds: train.map((p) => p.video.id),
    testIds: test.map((p) => p.video.id),
    tuningObjective: 'mean of the five Im2GPS accuracies, averaged over both modes, train half only',
  },
  tuned: {
    params,
    priorTemperature: prior,
    log: tuned.log,
  },
  timing: {
    galleryEmbedImagesPerSec: round(galleryReport.imagesPerSec, 1),
    galleryEmbeddedThisRun: galleryReport.embedded,
    galleryRestartMs: round(reload.loadMs, 0),
    countryTextVectorsMs: round(countryTextMs, 0),
    perVideoMedianMs: round(median(times), 0),
    perVideoMeanMs: round(times.reduce((s, t) => s + t, 0) / Math.max(1, times.length), 0),
    perVideoFramesMedianMs: round(median(prepared.map((p) => p.timing.framesMs)), 0),
    perVideoLocateMedianMs: round(median(prepared.map((p) => p.timing.locateMs)), 1),
  },
  summary,
  baselineZeroShotCentroidTestUnknown: baseline,
  calibration: {
    meaning: 'confidence = estimated probability that the true place lies within radiusKm',
    test: { open: calibration(bySplit('open', 'test')), unknown: calibration(bySplit('unknown', 'test')) },
  },
  videos: prepared.map((p, i) => ({
    id: p.video.id,
    label: p.video.label,
    wikidata: p.video.wikidata,
    split: p.split,
    truth: { lat: p.video.lat, lon: p.video.lon, country: p.truthIso },
    gpsInFile: p.hasGps,
    timeMs: round(p.timing.totalMs, 0),
    open: compact(final.open[i] as ModeOutcome),
    unknown: compact(final.unknown[i] as ModeOutcome),
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
    topReference: o.topReference,
    topReferenceIsSameItem: o.topReferenceIsSameItem,
    countryCorrect: o.countryCorrect,
    zeroShotCountry: o.zeroShotCountry,
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
say('');
say('Modus     Teil    n   Median km   ≤1 km  ≤25 km  ≤200 km  ≤750 km  ≤2500 km  Land   im Radius  Konf');
for (const mode of MODES) {
  for (const split of ['train', 'test', 'all'] as const) {
    const s = (summary[mode] as Record<string, Record<string, number>>)[split] as Record<string, number>;
    const pc = (v: number | undefined): string => `${((v ?? 0) * 100).toFixed(0)} %`.padStart(7);
    say(
      `${mode.padEnd(9)} ${split.padEnd(5)} ${String(s['n']).padStart(4)} ${String(s['medianKm']).padStart(10)} ${pc(s['acc1km'])} ${pc(s['acc25km'])} ${pc(s['acc200km'])} ${pc(s['acc750km'])} ${pc(s['acc2500km'])} ${pc(s['countryAcc'])} ${pc(s['withinRadius'])}  ${(s['meanConfidence'] ?? 0).toFixed(2)}`,
    );
  }
}
say('');
say(`Zeit pro Video: Median ${(median(times) / 1000).toFixed(2)} s (Bilder ${(report.timing.perVideoFramesMedianMs / 1000).toFixed(2)} s, Entscheidung ${report.timing.perVideoLocateMedianMs} ms).`);
say(`Abgestimmte Parameter: ${JSON.stringify({ ...params, kernelsKm: undefined })}`);
say(`Geschrieben: ${path.relative(repoRoot, outFile)}`);

