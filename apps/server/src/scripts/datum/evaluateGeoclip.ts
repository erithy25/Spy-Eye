/**
 * Measures GeoCLIP as a worldwide region model on the DATUM reference videos: alone (fp32 and
 * int8 image tower) and fused with the existing decision of datum/locate.ts.
 *
 *   npx tsx src/scripts/datum/evaluateGeoclip.ts [--precision fp32,int8] [--threads 3] [--frames 12]
 *       [--dataset datasets/datum] [--out docs/measurements/datum-geoclip.json] [--limit N]
 *
 * Frames: the engine's (sampleAndEmbedFrames in datum/locate.ts, replicated here because it does
 * not hand out the pictures): `--frames` frames at the middle of equal segments of the video,
 * scaled to at most 640 px wide with the same ffmpeg arguments, JPEG. Their GeoCLIP embeddings are
 * cached per precision (.cache/datum/geoclip-eval-<precision>-<frames>.json). Each precision is
 * embedded in a child process of its own, so that its time and memory are measured cleanly.
 *
 * The existing decision ('open' gallery and 'unknown' = the video's own Wikidata item left out,
 * as in scripts/datum/evaluate.ts) is recomputed with decideLocation and the engine's current
 * DEFAULT_LOCATE_PARAMS from the SigLIP vectors that `pnpm datum:evaluate` cached
 * (.cache/datum/eval-frames-*.json); nothing in locate.ts is changed.
 *
 * Everything is chosen on the train half (even index of the manifest sorted by id): GeoCLIP's frame
 * aggregation and answer point, the fusion recipe and its weights, the radius of GeoCLIP answers.
 * The test half (odd index) is only reported. Written to docs/measurements/datum-geoclip.json.
 */
process.env['SICHT_OFFLINE'] ??= '1';

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { config, repoRoot } = await import('../../config.js');
const { Gallery, modelSlug } = await import('../../datum/gallery.js');
const { World, greatCircleKm } = await import('../../datum/world.js');
const { readMetadata, filenameHints } = await import('../../datum/metadata.js');
const { DEFAULT_LOCATE_PARAMS, decideLocation } = await import('../../datum/locate.js');
const geo = await import('../../datum/geoclip.js');
type GalleryNeighbour = import('../../datum/gallery.js').GalleryNeighbour;
type ImageEmbedder = import('../../datum/gallery.js').ImageEmbedder;
type LocateResult = import('../../datum/locate.js').LocateResult;
type CountryProb = import('../../datum/contract.js').CountryProb;
type GeoPoint = import('../../datum/contract.js').GeoPoint;
type GeoclipPrecision = import('../../datum/geoclip.js').GeoclipPrecision;
type GeoclipAggregation = import('../../datum/geoclip.js').GeoclipAggregation;
type GeoclipPrediction = import('../../datum/geoclip.js').GeoclipPrediction;

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
}

const THRESHOLDS_KM = [1, 25, 200, 750, 2500] as const;
const AGGREGATIONS: readonly GeoclipAggregation[] = ['sum', 'mean', 'embedding', 'mixture'];
const ANSWERS = ['top1', 'modePeak', 'modeCentre', 'refined'] as const;
type Answer = (typeof ANSWERS)[number];
const MODES = ['open', 'unknown'] as const;
type Mode = (typeof MODES)[number];
const K_MAX = 30;
const RADIUS_TARGET = 0.7;
const RADIUS_GRID_KM = [1, 2, 3, 5, 10, 25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500];

const datasetDir = path.resolve(repoRoot, argument('dataset', 'datasets/datum'));
const frameCount = Number(argument('frames', '12'));
const threads = Number(argument('threads', String(config.threads)));
const limit = Number(argument('limit', '0'));
const precisions = argument('precision', 'fp32,int8')
  .split(',')
  .filter((p): p is GeoclipPrecision => p === 'fp32' || p === 'int8');
const outFile = path.resolve(repoRoot, argument('out', 'docs/measurements/datum-geoclip.json'));
const cacheDir = path.resolve(repoRoot, argument('cache', '.cache/datum'));
const embedOnly = argument('embed-only', '') as '' | GeoclipPrecision;

const round = (v: number, digits: number): number => Math.round(v * 10 ** digits) / 10 ** digits;
function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}
const toB64 = (v: Float32Array): string => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
const fromB64 = (t: string): Float32Array => {
  const b = Buffer.from(t, 'base64');
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

async function loadVideos(): Promise<{ videos: ManifestVideo[]; split: Map<string, 'train' | 'test'>; total: number }> {
  const manifest = JSON.parse(await fs.readFile(path.join(datasetDir, 'manifest.json'), 'utf8')) as { videos: ManifestVideo[] };
  const all = manifest.videos
    .filter((v) => typeof v.lat === 'number' && typeof v.lon === 'number' && typeof v.file === 'string' && typeof v.id === 'string')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // The split is fixed by the manifest order (sorted by id), exactly as in evaluate.ts.
  const split = new Map(all.map((v, i) => [v.id, i % 2 === 0 ? ('train' as const) : ('test' as const)]));
  const present: ManifestVideo[] = [];
  for (const v of all) {
    try {
      await fs.access(path.join(datasetDir, v.file));
      present.push(v);
    } catch {
      // clip not downloaded
    }
  }
  return { videos: limit > 0 ? present.slice(0, limit) : present, split, total: manifest.videos.length };
}

// ------------------------------------------------------------------ frames (as the engine takes them)

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

/** The frames sampleAndEmbedFrames (datum/locate.ts) reads, as JPEG bytes; same times, same scaling. */
async function engineFrames(videoPath: string, count: number, tmpRoot: string): Promise<{ jpegs: Buffer[]; times: number[] }> {
  const meta = await readMetadata(videoPath).catch(() => null);
  const duration = meta?.durationSec ?? null;
  const times = Array.from({ length: count }, (_, i) => (duration !== null ? (duration * (i + 0.5)) / count : i));
  const dir = await fs.mkdtemp(path.join(tmpRoot, 'geoclip-frames-'));
  try {
    const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y'];
    for (const t of times) args.push('-ss', t.toFixed(3), '-protocol_whitelist', 'file', '-i', videoPath);
    times.forEach((_, i) => {
      args.push('-map', `${i}:v:0`, '-frames:v', '1', '-an', '-sn', '-vf', `scale=w='min(640,iw)':h=-2:flags=bicubic`, '-pix_fmt', 'yuvj420p', '-q:v', '3', path.join(dir, `f${i}.jpg`));
    });
    await runFfmpeg(args, 120_000);
    const jpegs: Buffer[] = [];
    const kept: number[] = [];
    for (let i = 0; i < count; i++) {
      try {
        jpegs.push(await fs.readFile(path.join(dir, `f${i}.jpg`)));
        kept.push(times[i] as number);
      } catch {
        // A seek past the last frame writes no picture (the engine skips it too).
      }
    }
    return { jpegs, times: kept };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ embedding cache (per precision)

interface EmbedEntry {
  bytes: number;
  frames: number;
  times: number[];
  embeds: string;
  preprocessMs: number;
  inferMs: number;
}
interface EmbedStats {
  precision: GeoclipPrecision;
  threads: number;
  sessionLoadMs: number;
  rssBeforeMb: number;
  rssAfterLoadMb: number;
  maxRssMb: number;
  loadAverage: number[];
  computedVideos: number;
}
interface EmbedCache {
  version: 1;
  precision: GeoclipPrecision;
  frames: number;
  videos: Record<string, EmbedEntry>;
  stats: EmbedStats | null;
}

const embedCacheFile = (precision: GeoclipPrecision): string => path.join(cacheDir, `geoclip-eval-${precision}-${frameCount}.json`);

async function readEmbedCache(precision: GeoclipPrecision): Promise<EmbedCache> {
  try {
    const c = JSON.parse(await fs.readFile(embedCacheFile(precision), 'utf8')) as EmbedCache;
    if (c.version === 1 && c.precision === precision && c.frames === frameCount) return c;
  } catch {
    // none yet
  }
  return { version: 1, precision, frames: frameCount, videos: {}, stats: null };
}

/** Child-process part: embeds the frames of every video that has no valid cache entry. */
async function embedPrecision(precision: GeoclipPrecision): Promise<void> {
  const { videos } = await loadVideos();
  const cache = await readEmbedCache(precision);
  const model = new geo.GeoClip({ precision, threads });
  if (!(await model.available())) throw new Error(`GeoCLIP ${precision}: Modelldateien fehlen unter ${model.modelDir}`);
  const rssBefore = process.memoryUsage().rss;
  const tLoad = performance.now();
  // Warm-up: creates the session (counted as load time, not per frame).
  await model.embedPixels(new Float32Array(3 * geo.GEOCLIP_IMAGE_SIZE * geo.GEOCLIP_IMAGE_SIZE), 1);
  const sessionLoadMs = performance.now() - tLoad;
  const rssAfterLoad = process.memoryUsage().rss;
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'geoclip-eval-'));
  let computed = 0;
  try {
    for (const [i, v] of videos.entries()) {
      const file = path.join(datasetDir, v.file);
      const bytes = (await fs.stat(file)).size;
      const hit = cache.videos[v.id];
      if (hit && hit.bytes === bytes) continue;
      const { jpegs, times } = await engineFrames(file, frameCount, tmpRoot);
      const plane = 3 * geo.GEOCLIP_IMAGE_SIZE * geo.GEOCLIP_IMAGE_SIZE;
      const t0 = performance.now();
      const pixels = new Float32Array(jpegs.length * plane);
      await Promise.all(jpegs.map((j, k) => geo.preprocessImage(j, pixels, k * plane)));
      const t1 = performance.now();
      const embeds = await model.embedPixels(pixels, jpegs.length);
      const t2 = performance.now();
      cache.videos[v.id] = { bytes, frames: jpegs.length, times, embeds: toB64(embeds), preprocessMs: t1 - t0, inferMs: t2 - t1 };
      computed++;
      say(`  [${precision}] ${i + 1}/${videos.length} ${v.id}: ${jpegs.length} Bilder, ${((t2 - t1) / jpegs.length).toFixed(0)} ms/Bild`);
      if (computed % 10 === 0) await fs.writeFile(embedCacheFile(precision), JSON.stringify(cache));
    }
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
  if (computed > 0 || !cache.stats) {
    cache.stats = {
      precision,
      threads,
      sessionLoadMs,
      rssBeforeMb: rssBefore / 1e6,
      rssAfterLoadMb: rssAfterLoad / 1e6,
      maxRssMb: process.resourceUsage().maxRSS / 1e3,
      loadAverage: os.loadavg(),
      computedVideos: computed,
    };
  }
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(embedCacheFile(precision), JSON.stringify(cache));
  await model.release();
}

function runChild(precision: GeoclipPrecision): Promise<void> {
  const script = fileURLToPath(import.meta.url);
  const args = [...process.execArgv, script, '--embed-only', precision, '--threads', String(threads), '--frames', String(frameCount), '--dataset', datasetDir, '--cache', cacheDir];
  if (limit > 0) args.push('--limit', String(limit));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Einbettung ${precision}: exit ${code}`))));
  });
}

if (embedOnly) {
  await embedPrecision(embedOnly);
  process.exit(0);
}

// ================================================================== main process

const { videos, split, total } = await loadVideos();
say(`GeoCLIP-Messung: ${videos.length} Videos (Manifest ${total}), ${frameCount} Bilder je Video, ${threads} Threads.`);
for (const precision of precisions) {
  const cache = await readEmbedCache(precision);
  const missing = videos.filter((v) => !cache.videos[v.id]).length;
  if (missing > 0 || !cache.stats) {
    say(`Einbettung ${precision}: ${missing} Videos fehlen im Cache.`);
    await runChild(precision);
  }
}

// ---- GeoCLIP gallery (location embeddings, cached as float16)
const geoclip = new geo.GeoClip({ precision: precisions[0] ?? 'int8', threads, cacheDir });
const galleryCacheFile = await geoclip.galleryCacheFile();
const galleryCached = await fs
  .access(galleryCacheFile)
  .then(() => true)
  .catch(() => false);
const tGallery = performance.now();
const gGallery = await geoclip.gallery();
const galleryMs = performance.now() - tGallery;
say(`GeoCLIP-Galerie: ${gGallery.size} Punkte ${galleryCached ? 'aus dem Cache' : 'neu berechnet'} in ${(galleryMs / 1000).toFixed(1)} s.`);
const world = await World.load();
const tCountries = performance.now();
const { countryOf, isos } = await geoclip.galleryCountries(world);
const countriesMs = performance.now() - tCountries;

// ---- existing decision (SigLIP retrieval + zero-shot prior), as evaluate.ts computes it
const frameCacheFile = path.join(cacheDir, `eval-frames-${modelSlug()}-${frameCount}-standard.json`);
type FrameCacheEntry = { bytes: number; frameNumbers: number[]; dim: number; vectors: string; tiles: string | null; frameRow: number[]; tile: number[] };
const frameCache = JSON.parse(await fs.readFile(frameCacheFile, 'utf8')) as Record<string, FrameCacheEntry>;
const dim = Object.values(frameCache)[0]?.dim ?? 0;
// The SigLIP vectors come from the cache: the gallery needs only the dimension, never the model.
const noModel: ImageEmbedder = {
  imageSize: 256,
  imageMean: [0.5, 0.5, 0.5],
  imageStd: [0.5, 0.5, 0.5],
  dim,
  embedPixels: () => Promise.reject(new Error('Galerie-Vektoren fehlen im Cache: zuerst pnpm datum:evaluate ausführen.')),
};
const gallery = new Gallery(noModel, { datasetDir, cacheDir });
await gallery.load();
world.textCache = { file: path.join(cacheDir, `country-text-${modelSlug()}.bin`), modelId: config.modelId };
const embedTexts = (): Promise<Float32Array> => Promise.reject(new Error('Ländertexte fehlen im Cache: zuerst pnpm datum:evaluate ausführen.'));

interface Prepared {
  video: ManifestVideo;
  split: 'train' | 'test';
  truthIsos: string[];
  existing: Record<Mode, LocateResult>;
  /** GeoCLIP predictions per precision and aggregation. */
  geo: Partial<Record<GeoclipPrecision, Record<GeoclipAggregation, GeoclipPrediction>>>;
  timing: Partial<Record<GeoclipPrecision, { preprocessMsPerFrame: number; inferMsPerFrame: number; scoreMs: number; refineMs: number }>>;
}

const prepared: Prepared[] = [];
const embedCaches = new Map<GeoclipPrecision, EmbedCache>();
for (const p of precisions) embedCaches.set(p, await readEmbedCache(p));
const tScore = performance.now();
for (const [i, video] of videos.entries()) {
  const entry = frameCache[video.id];
  if (!entry) {
    say(`  ${video.id}: keine SigLIP-Vektoren im Cache, übersprungen`);
    continue;
  }
  const frames = { vectors: fromB64(entry.vectors), dim: entry.dim, frameNumbers: entry.frameNumbers };
  const tileVectors = entry.tiles ? fromB64(entry.tiles) : frames.vectors;
  const cos = await world.countryCosines(frames.vectors, frames.dim, embedTexts);
  const wide = gallery.search(tileVectors, K_MAX + 4);
  const neighbours: Record<Mode, GalleryNeighbour[][]> = {
    open: wide.map((row) => row.slice(0, K_MAX)),
    unknown: wide.map((row) => row.filter((n) => n.wikidata !== video.wikidata).slice(0, K_MAX)),
  };
  const existing = {} as Record<Mode, LocateResult>;
  for (const mode of MODES) {
    existing[mode] = decideLocation(
      world,
      {
        neighbours: neighbours[mode].map((row) => row.slice(0, DEFAULT_LOCATE_PARAMS.k)),
        rowFrame: entry.frameRow,
        rowTile: entry.tile,
        countryCosines: cos,
        frameNumbers: frames.frameNumbers,
        // The picture is scored, not GPS in the file (as evaluate.ts does).
        metadata: null,
        hints: filenameHints(path.basename(video.file)),
      },
      DEFAULT_LOCATE_PARAMS,
    );
  }
  const truthIsos = [
    ...new Set(
      [world.countryNear(video.lat, video.lon)?.iso ?? null, typeof video.country === 'string' ? video.country.toUpperCase() : null].filter(
        (x): x is string => x !== null && /^[A-Z]{2}$/.test(x),
      ),
    ),
  ];
  const p: Prepared = { video, split: split.get(video.id) ?? 'test', truthIsos, existing, geo: {}, timing: {} };
  for (const precision of precisions) {
    const e = embedCaches.get(precision)?.videos[video.id];
    if (!e) continue;
    const embeds = fromB64(e.embeds);
    const t0 = performance.now();
    const galleryCos = await geoclip.galleryCosines(embeds, e.frames);
    const cosMs = performance.now() - t0;
    const byAgg = {} as Record<GeoclipAggregation, GeoclipPrediction>;
    for (const aggregation of AGGREGATIONS) {
      byAgg[aggregation] = await geoclip.predictFromEmbeddings(embeds, e.frames, { aggregation, galleryCos, world, refine: true });
    }
    p.geo[precision] = byAgg;
    p.timing[precision] = {
      preprocessMsPerFrame: e.preprocessMs / Math.max(1, e.frames),
      inferMsPerFrame: e.inferMs / Math.max(1, e.frames),
      scoreMs: cosMs + byAgg.sum.timing.scoreMs,
      refineMs: byAgg.sum.timing.refineMs,
    };
  }
  prepared.push(p);
  if (i % 10 === 0 || i === videos.length - 1) say(`  ${i + 1}/${videos.length} ${video.id} (${((performance.now() - tScore) / 1000).toFixed(0)} s)`);
}
const train = prepared.filter((p) => p.split === 'train');
const test = prepared.filter((p) => p.split === 'test');

// ------------------------------------------------------------------ scoring helpers

interface Outcome {
  lat: number;
  lon: number;
  errorKm: number;
  /** Top country of the method's country distribution. */
  country: string | null;
  countryCorrect: boolean | null;
  /** Country the answer point lies in. */
  answerCountryCorrect: boolean | null;
  /** Which source produced the answer (fusion). */
  source: 'existing' | 'geoclip';
  radiusKm: number | null;
  /** GeoCLIP answers: probability mass within 25 km of the answer (sets the radius tier). */
  concentration: number | null;
}

function outcome(p: Prepared, at: GeoPoint, country: string | null, source: Outcome['source'], radiusKm: number | null, concentration: number | null = null): Outcome {
  const answerIso = world.countryNear(at.lat, at.lon)?.iso ?? null;
  return {
    lat: at.lat,
    lon: at.lon,
    errorKm: greatCircleKm(at.lat, at.lon, p.video.lat, p.video.lon),
    country,
    countryCorrect: p.truthIsos.length > 0 ? country !== null && p.truthIsos.includes(country) : null,
    answerCountryCorrect: p.truthIsos.length > 0 ? answerIso !== null && p.truthIsos.includes(answerIso) : null,
    source,
    radiusKm,
    concentration,
  };
}

function summarise(outcomes: readonly Outcome[]): Record<string, number> {
  const errors = outcomes.map((o) => o.errorKm);
  const out: Record<string, number> = { n: outcomes.length, medianKm: round(median(errors), 1) };
  for (const t of THRESHOLDS_KM) out[`acc${t}km`] = round(errors.filter((e) => e <= t).length / Math.max(1, errors.length), 3);
  const c = outcomes.filter((o) => o.countryCorrect !== null);
  out['countryAcc'] = round(c.filter((o) => o.countryCorrect).length / Math.max(1, c.length), 3);
  const a = outcomes.filter((o) => o.answerCountryCorrect !== null);
  out['answerCountryAcc'] = round(a.filter((o) => o.answerCountryCorrect).length / Math.max(1, a.length), 3);
  const g = outcomes.filter((o) => o.source === 'geoclip').length;
  if (g > 0) out['geoclipAnswers'] = g;
  const r = outcomes.filter((o) => o.radiusKm !== null);
  if (r.length > 0) out['withinRadius'] = round(r.filter((o) => o.errorKm <= (o.radiusKm as number)).length / r.length, 3);
  return out;
}

/** Mean of the five Im2GPS accuracies: the tuning objective (as evaluate.ts). */
function objective(outcomes: readonly Outcome[]): number {
  if (outcomes.length === 0) return 0;
  let s = 0;
  for (const t of THRESHOLDS_KM) s += outcomes.filter((o) => o.errorKm <= t).length / outcomes.length;
  return s / THRESHOLDS_KM.length;
}

function geoAnswer(pred: GeoclipPrediction, answer: Answer): GeoPoint {
  const mode = pred.modes[0];
  const top = pred.top[0] ?? { lat: 0, lon: 0 };
  if (answer === 'top1') return top;
  if (answer === 'modePeak') return mode?.peak ?? top;
  if (answer === 'modeCentre') return mode ?? top;
  return pred.refined && pred.refined.gain > 0 ? pred.refined : top;
}

/** Sparse density and in-country search over the prediction's support. */
function density(pred: GeoclipPrediction, at: GeoPoint, sigmaKm: number): number {
  return geo.densityAt(pred, at.lat, at.lon, sigmaKm);
}

// ------------------------------------------------------------------ existing decision (baseline)

function existingOutcome(p: Prepared, mode: Mode): Outcome {
  const r = p.existing[mode];
  const v = r.diagnostics.visual;
  if (!v) return { ...outcome(p, { lat: 0, lon: 0 }, r.countries[0]?.iso ?? null, 'existing', null), errorKm: 20_000 };
  return outcome(p, v, r.countries[0]?.iso ?? null, 'existing', v.radiusKm);
}
const baseline: Record<Mode, Record<'train' | 'test' | 'all', Record<string, number>>> = {
  open: { train: summarise(train.map((p) => existingOutcome(p, 'open'))), test: summarise(test.map((p) => existingOutcome(p, 'open'))), all: summarise(prepared.map((p) => existingOutcome(p, 'open'))) },
  unknown: { train: summarise(train.map((p) => existingOutcome(p, 'unknown'))), test: summarise(test.map((p) => existingOutcome(p, 'unknown'))), all: summarise(prepared.map((p) => existingOutcome(p, 'unknown'))) },
};

// ------------------------------------------------------------------ GeoCLIP alone

function geoOutcome(p: Prepared, precision: GeoclipPrecision, aggregation: GeoclipAggregation, answer: Answer): Outcome | null {
  const pred = p.geo[precision]?.[aggregation];
  if (!pred) return null;
  return outcome(p, geoAnswer(pred, answer), pred.countries[0]?.iso ?? null, 'geoclip', null);
}
const geoAlone: Record<string, unknown>[] = [];
const selectedAlone = new Map<GeoclipPrecision, { aggregation: GeoclipAggregation; answer: Answer; trainObjective: number }>();
for (const precision of precisions) {
  for (const aggregation of AGGREGATIONS) {
    for (const answer of ANSWERS) {
      const tr = train.map((p) => geoOutcome(p, precision, aggregation, answer)).filter((o): o is Outcome => o !== null);
      const te = test.map((p) => geoOutcome(p, precision, aggregation, answer)).filter((o): o is Outcome => o !== null);
      const trainObjective = objective(tr);
      geoAlone.push({ precision, aggregation, answer, trainObjective: round(trainObjective, 4), train: summarise(tr), test: summarise(te) });
      const best = selectedAlone.get(precision);
      if (!best || trainObjective > best.trainObjective + 1e-9) selectedAlone.set(precision, { aggregation, answer, trainObjective });
    }
  }
}

// Fewer frames cost less: the selected variant with 6 and 3 of the 12 frames (evenly spread, as
// evaluate.ts --use-frames picks them), from the cached embeddings.
const frameStudy: Record<string, unknown> = {};
for (const precision of precisions) {
  const sel = selectedAlone.get(precision);
  const cache = embedCaches.get(precision);
  if (!sel || !cache) continue;
  const rows: Record<string, unknown> = {};
  for (const use of [6, 3]) {
    const outcomes = new Map<string, Outcome>();
    for (const p of prepared) {
      const e = cache.videos[p.video.id];
      if (!e) continue;
      const all = fromB64(e.embeds);
      const n = e.frames;
      const picks = [...new Set(Array.from({ length: Math.min(use, n) }, (_, i) => Math.min(n - 1, Math.round(((i + 0.5) / use) * (n - 1)))))];
      const sub = new Float32Array(picks.length * geo.GEOCLIP_DIM);
      picks.forEach((f, r) => sub.set(all.subarray(f * geo.GEOCLIP_DIM, (f + 1) * geo.GEOCLIP_DIM), r * geo.GEOCLIP_DIM));
      const pred = await geoclip.predictFromEmbeddings(sub, picks.length, { aggregation: sel.aggregation, world, refine: sel.answer === 'refined' });
      outcomes.set(p.video.id, outcome(p, geoAnswer(pred, sel.answer), pred.countries[0]?.iso ?? null, 'geoclip', null));
    }
    const of = (items: Prepared[]): Outcome[] => items.map((p) => outcomes.get(p.video.id)).filter((o): o is Outcome => o !== undefined);
    rows[`frames${use}`] = { train: summarise(of(train)), test: summarise(of(test)) };
  }
  frameStudy[precision] = { variant: sel, ...rows };
}

// Radius of a GeoCLIP answer: smallest grid value that covers the truth in RADIUS_TARGET of the
// train cases (computed per precision for the selected variant).
function calibrateRadius(errors: readonly number[]): number {
  for (const r of RADIUS_GRID_KM) if (errors.filter((e) => e <= r).length / Math.max(1, errors.length) >= RADIUS_TARGET) return r;
  return RADIUS_GRID_KM[RADIUS_GRID_KM.length - 1] as number;
}

/** Radius tiers of GeoCLIP answers by concentration (mass within 25 km of the answer). */
interface RadiusTiers {
  /** Lower bounds of the concentration, strongest tier first; the last is 0. */
  minConcentration: number[];
  radiusKm: number[];
  trainCases: number[];
}
const CONCENTRATION_BOUNDS = [0.5, 0.2, 0];

/** Per tier the smallest radius covering RADIUS_TARGET of its train cases; thin tiers (< 4) take the weaker tier's radius; never wider than the weaker tier. */
function calibrateTiers(cases: readonly { concentration: number; errorKm: number }[]): RadiusTiers {
  const radiusKm: number[] = new Array<number>(CONCENTRATION_BOUNDS.length).fill(0);
  const trainCases: number[] = new Array<number>(CONCENTRATION_BOUNDS.length).fill(0);
  let weaker = calibrateRadius(cases.map((c) => c.errorKm));
  for (let t = CONCENTRATION_BOUNDS.length - 1; t >= 0; t--) {
    const lo = CONCENTRATION_BOUNDS[t] as number;
    const hi = t === 0 ? Infinity : (CONCENTRATION_BOUNDS[t - 1] as number);
    const inTier = cases.filter((c) => c.concentration >= lo && c.concentration < hi);
    trainCases[t] = inTier.length;
    const r = inTier.length >= 4 ? Math.min(weaker, calibrateRadius(inTier.map((c) => c.errorKm))) : weaker;
    radiusKm[t] = r;
    weaker = r;
  }
  return { minConcentration: [...CONCENTRATION_BOUNDS], radiusKm, trainCases };
}

function tierRadius(t: RadiusTiers, concentration: number): number {
  for (let i = 0; i < t.minConcentration.length; i++) if (concentration >= (t.minConcentration[i] as number)) return t.radiusKm[i] as number;
  return t.radiusKm[t.radiusKm.length - 1] as number;
}

// ------------------------------------------------------------------ fusion recipes

type Tier = 'strong' | 'recognised' | 'similar' | 'country' | 'continent';
const TIERS_WEAKEST_FIRST: Tier[][] = [
  ['continent'],
  ['country', 'continent'],
  ['similar', 'country', 'continent'],
  ['recognised', 'similar', 'country', 'continent'],
  ['strong', 'recognised', 'similar', 'country', 'continent'],
];

interface FusionConfig {
  recipe: 'rescore' | 'override' | 'agree' | 'countryProduct' | 'none';
  aggregation: GeoclipAggregation;
  answer: Answer;
  /** rescore: candidate score times (density + 1e-4)^beta, kernel sigma. */
  beta?: number;
  sigmaKm?: number;
  /** override / countryProduct: tiers of the existing answer GeoCLIP may replace. */
  tiers?: Tier[];
  /** override: minimum probability mass of GeoCLIP's best mode. */
  minMass?: number;
  /** agree: GeoCLIP replaces the existing answer when less than minAgree of its mass lies within agreeKm of it. */
  agreeKm?: number;
  minAgree?: number;
  /** countryProduct: exponents of the existing posterior and of GeoCLIP's country distribution. */
  a?: number;
  b?: number;
  /** Radius stated for an answer GeoCLIP produced (calibrated on train), by concentration tier. */
  geoRadius?: RadiusTiers;
}

function fuse(p: Prepared, mode: Mode, precision: GeoclipPrecision, cfg: FusionConfig): Outcome {
  const r = p.existing[mode];
  const base = existingOutcome(p, mode);
  const pred = p.geo[precision]?.[cfg.aggregation];
  if (!pred || cfg.recipe === 'none') return base;
  const tier = (r.diagnostics.radiusTier ?? 'continent') as Tier;
  // A GeoCLIP-made answer: its radius follows how concentrated GeoCLIP's mass is around it.
  const fromGeo = (at: GeoPoint, country: string | null): Outcome => {
    const concentration = geo.massWithin(pred, at.lat, at.lon, 25);
    return outcome(p, at, country, 'geoclip', cfg.geoRadius ? tierRadius(cfg.geoRadius, concentration) : null, concentration);
  };
  if (cfg.recipe === 'rescore') {
    if (r.diagnostics.level !== 'landmark' || r.candidates.length === 0) return base;
    const beta = cfg.beta ?? 1;
    const sigma = cfg.sigmaKm ?? 100;
    let best = r.candidates[0] as (typeof r.candidates)[number];
    let bestScore = -Infinity;
    for (const c of r.candidates) {
      const s = c.score * Math.pow(density(pred, c, sigma) + 1e-4, beta);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (best === r.candidates[0]) return base;
    return outcome(p, best, r.countries[0]?.iso ?? null, 'existing', base.radiusKm);
  }
  if (cfg.recipe === 'override') {
    if (!(cfg.tiers ?? []).includes(tier)) return base;
    if ((pred.modes[0]?.p ?? 0) < (cfg.minMass ?? 0)) return base;
    return fromGeo(geoAnswer(pred, cfg.answer), pred.countries[0]?.iso ?? null);
  }
  if (cfg.recipe === 'agree') {
    // The existing answer stays where GeoCLIP puts enough mass near it (both agree); otherwise,
    // for the tiers that may be replaced, GeoCLIP answers.
    if (!(cfg.tiers ?? []).includes(tier)) return base;
    const v = r.diagnostics.visual;
    if (v && geo.massWithin(pred, v.lat, v.lon, cfg.agreeKm ?? 200) >= (cfg.minAgree ?? 0.05)) return base;
    return fromGeo(geoAnswer(pred, cfg.answer), pred.countries[0]?.iso ?? null);
  }
  // countryProduct: fused country distribution; where the existing tier may be replaced, the
  // answer is GeoCLIP's best mode inside the fused best country.
  const a = cfg.a ?? 1;
  const b = cfg.b ?? 1;
  const geoP = new Map(pred.countries.map((c) => [c.iso, c.p]));
  const fused: CountryProb[] = r.countries.map((c) => ({ ...c, p: Math.pow(c.p, a) * Math.pow((geoP.get(c.iso) ?? 0) + 1e-4, b) }));
  const sum = fused.reduce((s, c) => s + c.p, 0);
  for (const c of fused) c.p /= sum || 1;
  fused.sort((x, y) => y.p - x.p);
  const topIso = fused[0]?.iso ?? null;
  if (!(cfg.tiers ?? []).includes(tier) || !topIso) return { ...base, country: topIso, countryCorrect: p.truthIsos.length > 0 ? topIso !== null && p.truthIsos.includes(topIso) : null };
  const inCountry = geo.bestInCountry(pred, countryOf, isos, topIso);
  const at = inCountry ? (cfg.answer === 'modeCentre' ? inCountry : inCountry.peak) : geoAnswer(pred, cfg.answer);
  return fromGeo(at, topIso);
}

function fusionObjective(items: readonly Prepared[], precision: GeoclipPrecision, cfg: FusionConfig): number {
  return (objective(items.map((p) => fuse(p, 'open', precision, cfg))) + objective(items.map((p) => fuse(p, 'unknown', precision, cfg)))) / 2;
}

function grid(precision: GeoclipPrecision): FusionConfig[] {
  const sel = selectedAlone.get(precision) ?? { aggregation: 'sum' as const, answer: 'top1' as const };
  const out: FusionConfig[] = [];
  for (const aggregation of ['sum', 'mean', 'mixture'] as const) {
    for (const beta of [0.5, 1, 2]) for (const sigmaKm of [25, 100, 500]) out.push({ recipe: 'rescore', aggregation, answer: sel.answer, beta, sigmaKm });
  }
  for (const tiers of TIERS_WEAKEST_FIRST) {
    for (const minMass of [0, 0.1, 0.25, 0.5]) out.push({ recipe: 'override', aggregation: sel.aggregation, answer: sel.answer, tiers, minMass });
  }
  for (const aggregation of ['sum', 'mean', 'mixture'] as const) {
    for (const agreeKm of [25, 200]) {
      for (const minAgree of [0.01, 0.05, 0.2]) {
        for (const tiers of TIERS_WEAKEST_FIRST) out.push({ recipe: 'agree', aggregation, answer: sel.answer, tiers, agreeKm, minAgree });
      }
    }
  }
  for (const aggregation of ['sum', 'mean', 'mixture'] as const) {
    for (const a of [0.5, 1]) for (const b of [0.5, 1]) for (const tiers of TIERS_WEAKEST_FIRST.slice(0, 4)) out.push({ recipe: 'countryProduct', aggregation, answer: sel.answer, a, b, tiers });
  }
  return out;
}

const fusion: Record<string, unknown> = {};
const recommended = new Map<GeoclipPrecision, FusionConfig & { trainObjective: number }>();
for (const precision of precisions) {
  const configs = grid(precision);
  const perRecipe = new Map<string, FusionConfig & { trainObjective: number }>();
  for (const cfg of configs) {
    const score = fusionObjective(train, precision, cfg);
    const seen = perRecipe.get(cfg.recipe);
    if (!seen || score > seen.trainObjective + 1e-9) perRecipe.set(cfg.recipe, { ...cfg, trainObjective: score });
  }
  const recipes: Record<string, unknown> = {};
  let best: (FusionConfig & { trainObjective: number }) | null = null;
  for (const [recipe, cfg0] of perRecipe) {
    // Radius of GeoCLIP-made answers, calibrated on the train cases where GeoCLIP answered.
    const geoCases = train
      .flatMap((p) => MODES.map((m) => fuse(p, m, precision, cfg0)))
      .filter((o) => o.source === 'geoclip')
      .map((o) => ({ concentration: o.concentration ?? 0, errorKm: o.errorKm }));
    const cfg = { ...cfg0, ...(geoCases.length >= 4 ? { geoRadius: calibrateTiers(geoCases) } : {}) };
    const report: Record<string, unknown> = { config: cfg };
    for (const mode of MODES) {
      report[mode] = {
        train: summarise(train.map((p) => fuse(p, mode, precision, cfg))),
        test: summarise(test.map((p) => fuse(p, mode, precision, cfg))),
        all: summarise(prepared.map((p) => fuse(p, mode, precision, cfg))),
      };
    }
    recipes[recipe] = report;
    if (!best || cfg.trainObjective > best.trainObjective + 1e-9) best = cfg;
  }
  const baseScore = fusionObjective(train, precision, { recipe: 'none', aggregation: 'sum', answer: 'top1' });
  fusion[precision] = { baselineTrainObjective: round(baseScore, 4), bestPerRecipe: recipes, selected: best ? { recipe: best.recipe, trainObjective: round(best.trainObjective, 4) } : null };
  if (best) recommended.set(precision, best);
}

// ------------------------------------------------------------------ agreement fp32 / int8 and timing

let precisionAgreement: Record<string, number> | null = null;
if (precisions.includes('fp32') && precisions.includes('int8')) {
  const d = prepared
    .map((p) => {
      const a = p.geo.fp32?.sum.top[0];
      const b = p.geo.int8?.sum.top[0];
      return a && b ? greatCircleKm(a.lat, a.lon, b.lat, b.lon) : null;
    })
    .filter((x): x is number => x !== null);
  precisionAgreement = {
    videos: d.length,
    medianTop1DistanceKm: round(median(d), 1),
    within1km: round(d.filter((x) => x <= 1).length / Math.max(1, d.length), 3),
    within25km: round(d.filter((x) => x <= 25).length / Math.max(1, d.length), 3),
    over750km: d.filter((x) => x > 750).length,
  };
}
const timing: Record<string, unknown> = {};
for (const precision of precisions) {
  const t = prepared.map((p) => p.timing[precision]).filter((x): x is NonNullable<typeof x> => x !== undefined);
  timing[precision] = {
    inferMsPerFrameMedian: round(median(t.map((x) => x.inferMsPerFrame)), 0),
    preprocessMsPerFrameMedian: round(median(t.map((x) => x.preprocessMsPerFrame)), 1),
    galleryScoreMsPerVideoMedian: round(median(t.map((x) => x.scoreMs)), 0),
    refineMsPerVideoMedian: round(median(t.map((x) => x.refineMs)), 0),
    embedding: embedCaches.get(precision)?.stats ?? null,
  };
}
const files = geoclip.files();
const sizeOf = async (f: string): Promise<number | null> => fs.stat(f).then((s) => s.size).catch(() => null);
const downloads = {
  visionFp32: await sizeOf(path.join(geoclip.modelDir, geo.GEOCLIP_FILES.vision.fp32)),
  visionInt8: await sizeOf(path.join(geoclip.modelDir, geo.GEOCLIP_FILES.vision.int8)),
  location: await sizeOf(files.location),
  gallery: await sizeOf(files.gallery),
  galleryEmbeddingCache: await sizeOf(galleryCacheFile),
};

const report = {
  generatedAt: new Date().toISOString(),
  model: { id: geo.GEOCLIP_MODEL_ID, licence: 'MIT (code and weights)', logitScale: geo.GEOCLIP_LOGIT_SCALE, galleryPoints: gGallery.size },
  machine: { cpu: os.cpus()[0]?.model ?? 'unknown', cores: os.availableParallelism(), threads, loadAverageAtEnd: os.loadavg().map((x) => round(x, 2)), note: 'machine shared with other jobs while measured' },
  protocol: {
    frames: `${frameCount} frames at the middle of equal segments, max 640 px wide, JPEG q 3 (sampleAndEmbedFrames of datum/locate.ts, replicated); CLIPImageProcessor preprocessing (shortest side 224 bicubic, centre crop 224, CLIP mean/std)`,
    split: 'manifest videos sorted by id; even index = train (every choice), odd index = test (report only)',
    existing: 'decideLocation with DEFAULT_LOCATE_PARAMS of the current engine, from the SigLIP vectors cached by datum:evaluate; open = whole gallery, unknown = own Wikidata item left out; GPS in the file not used',
    aggregations: 'sum = summed per-frame logits (identical to summed per-frame log-probabilities); mean = mean logit; embedding = renormalised mean embedding; mixture = mean of per-frame probabilities',
    answers: 'top1 = best gallery point; modePeak / modeCentre = best point / weighted centre of the mode (gallery points within 25 km) with the most mass; refined = best point of a 0.05° then 0.01° local grid around the 3 best modes scored with the location encoder',
    countryAcc: 'top country of the method\'s distribution (GeoCLIP: gallery mass per country; existing: its country posterior; fusion: as the recipe sets it); answerCountryAcc: country the answer point lies in',
    objective: 'mean of the five accuracies (1, 25, 200, 750, 2500 km); for fusion averaged over open and unknown, train half only',
    trainIds: train.map((p) => p.video.id),
    testIds: test.map((p) => p.video.id),
  },
  downloadsBytes: downloads,
  setup: { galleryEmbeddingMs: galleryCached ? null : round(galleryMs, 0), galleryCacheReadMs: galleryCached ? round(galleryMs, 0) : null, galleryCountriesMs: round(countriesMs, 0) },
  timing,
  existingDecision: baseline,
  geoclipAlone: {
    selectedOnTrain: Object.fromEntries([...selectedAlone].map(([k, v]) => [k, { ...v, trainObjective: round(v.trainObjective, 4) }])),
    radiusTiersOnTrain: Object.fromEntries(
      [...selectedAlone].map(([precision, v]) => {
        const rows = (items: Prepared[]): { concentration: number; errorKm: number }[] =>
          items.flatMap((p) => {
            const pred = p.geo[precision]?.[v.aggregation];
            if (!pred) return [];
            const at = geoAnswer(pred, v.answer);
            return [{ concentration: geo.massWithin(pred, at.lat, at.lon, 25), errorKm: greatCircleKm(at.lat, at.lon, p.video.lat, p.video.lon) }];
          });
        const tiers = calibrateTiers(rows(train));
        const testRows = rows(test);
        return [precision, { ...tiers, testWithinRadius: round(testRows.filter((r) => r.errorKm <= tierRadius(tiers, r.concentration)).length / Math.max(1, testRows.length), 3) }];
      }),
    ),
    variants: geoAlone,
    fewerFrames: frameStudy,
  },
  precisionAgreement,
  fusion,
  videos: prepared.map((p) => {
    const row: Record<string, unknown> = {
      id: p.video.id,
      label: p.video.label,
      split: p.split,
      truth: { lat: p.video.lat, lon: p.video.lon, countries: p.truthIsos },
      existingUnknown: compact(existingOutcome(p, 'unknown'), p.existing.unknown.diagnostics.radiusTier),
      existingOpen: compact(existingOutcome(p, 'open'), p.existing.open.diagnostics.radiusTier),
    };
    for (const precision of precisions) {
      const sel = selectedAlone.get(precision);
      const rec = recommended.get(precision);
      const o = sel ? geoOutcome(p, precision, sel.aggregation, sel.answer) : null;
      if (o) row[`geoclip_${precision}`] = { ...compact(o, null), topModeMass: round(p.geo[precision]?.[sel?.aggregation ?? 'sum']?.modes[0]?.p ?? 0, 3) };
      if (rec) row[`fused_${precision}`] = { unknown: compact(fuse(p, 'unknown', precision, rec), null), open: compact(fuse(p, 'open', precision, rec), null) };
    }
    return row;
  }),
};

function compact(o: Outcome, tier: string | null): Record<string, unknown> {
  return {
    lat: round(o.lat, 5),
    lon: round(o.lon, 5),
    errorKm: round(o.errorKm, 1),
    country: o.country,
    countryCorrect: o.countryCorrect,
    source: o.source,
    ...(tier ? { tier } : {}),
  };
}

await fs.mkdir(path.dirname(outFile), { recursive: true });
await fs.writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`);

// ---- table
const pc = (v: number | undefined): string => `${((v ?? 0) * 100).toFixed(0)} %`.padStart(6);
const line = (name: string, s: Record<string, number>): void =>
  say(`${name.padEnd(44)} ${String(s['n']).padStart(3)} ${String(s['medianKm']).padStart(9)} ${pc(s['acc1km'])} ${pc(s['acc25km'])} ${pc(s['acc200km'])} ${pc(s['acc750km'])} ${pc(s['acc2500km'])} ${pc(s['countryAcc'])}`);
say('');
say(`${'Verfahren'.padEnd(44)}   n  Median km  ≤1 km ≤25 km ≤200km ≤750km ≤2500km  Land`);
for (const split of ['train', 'test'] as const) {
  line(`bestehend unbekannt ${split}`, baseline.unknown[split]);
  line(`bestehend offen ${split}`, baseline.open[split]);
  for (const precision of precisions) {
    const sel = selectedAlone.get(precision);
    if (!sel) continue;
    const rows = (split === 'train' ? train : test).map((p) => geoOutcome(p, precision, sel.aggregation, sel.answer)).filter((o): o is Outcome => o !== null);
    line(`GeoCLIP ${precision} ${sel.aggregation}/${sel.answer} ${split}`, summarise(rows));
    const rec = recommended.get(precision);
    if (rec) {
      line(`Fusion ${precision} ${rec.recipe} unbekannt ${split}`, summarise((split === 'train' ? train : test).map((p) => fuse(p, 'unknown', precision, rec))));
      line(`Fusion ${precision} ${rec.recipe} offen ${split}`, summarise((split === 'train' ? train : test).map((p) => fuse(p, 'open', precision, rec))));
    }
  }
}
say('');
for (const precision of precisions) say(`${precision}: ${JSON.stringify(timing[precision])}`);
for (const precision of precisions) say(`Empfohlen ${precision}: ${JSON.stringify(recommended.get(precision))}`);
say(`Geschrieben: ${path.relative(repoRoot, outFile)}`);
