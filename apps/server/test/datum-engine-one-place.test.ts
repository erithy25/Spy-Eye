import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import type { EventHub } from '../src/events.js';
import type { EmbeddingModel } from '../src/ml/model.js';
import type { Store, VideoEntry } from '../src/store.js';
import type { VideoInfo } from '../src/types.js';
import type { Fix } from '../src/datum/contract.js';
import type { Gallery, GalleryNeighbour } from '../src/datum/gallery.js';

/**
 * Engine 12 through the engine itself: a recording of one recognised place and undetermined
 * stretches, located by the real DatumEngine (frame sampling, windows, stretches, segmentVerdict,
 * the full stage with time and spaces). The tests of segmentVerdict and its helpers
 * (datum-segments-one-place.test.ts) cannot see how the engine hands their answers on: whether a
 * fix that shows no stretch keeps its timeline, whether the whole file's entries of one place say
 * what its pictures include, and whose countries the fix carries. Stand-ins: the image model, the
 * gallery; no world model. Written video files need ffmpeg; without it these tests are skipped.
 */

const FFMPEG = process.env['FFMPEG_PATH'] ?? 'ffmpeg';
const NO_FFMPEG = spawnSync(FFMPEG, ['-version']).status === 0 ? false : 'ffmpeg fehlt auf diesem Rechner';

// The world caches country text vectors under DATA_DIR/datum, keyed by the model id: the
// stand-in's vectors must never land in the node's real cache. Set before config is loaded.
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-one-place-data-'));
process.env['DATA_DIR'] = dataDir;
process.env['SICHT_OFFLINE'] = '1';
const { DatumEngine } = await import('../src/datum/engine.js');
const { GrowableMatrix } = await import('../src/ml/math.js');

after(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

const DIM = 16;

function unit(k: number): Float32Array {
  const v = new Float32Array(DIM);
  v[k] = 1;
  return v;
}

/** Unit vector from a string, the same every time. */
function hashVector(text: string): Float32Array {
  const v = new Float32Array(DIM);
  let h = 2166136261;
  for (let d = 0; d < DIM; d++) {
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    h = Math.imul(h ^ d, 16777619);
    v[d] = ((h >>> 0) % 2000) / 1000 - 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

/** The places the gallery finds: a vector along dimension 0 or 2 is one, along 1 none. */
const DEUTSCHES_ECK = 0;
const NOWHERE = 1;
const ROEMER = 2;

/** Rows along dimension 0: the Deutsches Eck clearly ahead of two look-alikes. */
const ECK: GalleryNeighbour[] = [
  { id: 'Q1', label: 'Deutsches Eck', lat: 50.3644, lon: 7.6062, country: 'DE', wikidata: 'Q1', similarity: 0.95 },
  { id: 'Q2', label: 'Brücke', lat: 48.85, lon: 2.35, country: 'FR', wikidata: 'Q2', similarity: 0.7 },
  { id: 'Q3', label: 'Turm', lat: 41.9, lon: 12.5, country: 'IT', wikidata: 'Q3', similarity: 0.69 },
];
/** Rows along dimension 2: the Römer in Frankfurt, 88 km from the Deutsches Eck. */
const ROEMER_ROWS: GalleryNeighbour[] = [
  { id: 'Q10', label: 'Römer', lat: 50.1106, lon: 8.6821, country: 'DE', wikidata: 'Q10', similarity: 0.95 },
  { id: 'Q2', label: 'Brücke', lat: 48.85, lon: 2.35, country: 'FR', wikidata: 'Q2', similarity: 0.7 },
  { id: 'Q3', label: 'Turm', lat: 41.9, lon: 12.5, country: 'IT', wikidata: 'Q3', similarity: 0.69 },
];
/** Rows along dimension 1: nothing stands out, look-alikes all over the world. */
const SCATTERED: GalleryNeighbour[] = [
  { id: 'Q20', label: 'Platz', lat: 40.4, lon: -3.7, country: 'ES', wikidata: 'Q20', similarity: 0.52 },
  { id: 'Q21', label: 'Tempel', lat: 35.0, lon: 135.7, country: 'JP', wikidata: 'Q21', similarity: 0.519 },
  { id: 'Q22', label: 'Strand', lat: -22.9, lon: -43.2, country: 'BR', wikidata: 'Q22', similarity: 0.518 },
  { id: 'Q23', label: 'Markt', lat: 6.4, lon: 2.4, country: 'BJ', wikidata: 'Q23', similarity: 0.517 },
  { id: 'Q24', label: 'Hafen', lat: -33.9, lon: 151.2, country: 'AU', wikidata: 'Q24', similarity: 0.516 },
];

function search(vectors: Float32Array, k: number): GalleryNeighbour[][] {
  const rows = vectors.length / DIM;
  return Array.from({ length: rows }, (_, r) => {
    const v = vectors.subarray(r * DIM, (r + 1) * DIM);
    const top = v[DEUTSCHES_ECK]! > 0.5 ? ECK : v[ROEMER]! > 0.5 ? ROEMER_ROWS : SCATTERED;
    return top.slice(0, k);
  });
}

const gallery = {
  size: 9,
  search,
  // The localisation calls the gallery through its search thread; the stand-in answers directly.
  searchAsync: (vectors: Float32Array, k: number): Promise<GalleryNeighbour[][]> => Promise.resolve(search(vectors, k)),
} as unknown as Gallery;

/** Stand-in for the image model: the frames drawn from the file for the whole file all read as `whole`. */
function modelFor(whole: number): EmbeddingModel {
  return {
    dim: DIM,
    imageSize: 16,
    imageMean: [0.5, 0.5, 0.5],
    imageStd: [0.5, 0.5, 0.5],
    embedPixels: async (_pixels: Float32Array, count: number): Promise<Float32Array> => {
      const out = new Float32Array(count * DIM);
      for (let i = 0; i < count; i++) out.set(unit(whole), i * DIM);
      return out;
    },
    embedTexts: async (texts: string[]): Promise<Float32Array> => {
      const out = new Float32Array(texts.length * DIM);
      texts.forEach((t, i) => out.set(hashVector(t), i * DIM));
      return out;
    },
  } as unknown as EmbeddingModel;
}

class MemoryStore {
  readonly entries = new Map<string, VideoEntry>();
  constructor(readonly root: string) {}
  videoDir(id: string): string {
    return path.join(this.root, id);
  }
  framePath(id: string, n: number): string {
    return path.join(this.root, id, 'frames', `${n}.jpg`);
  }
  async analysisFramePath(id: string, n: number): Promise<string> {
    return this.framePath(id, n);
  }
  sourcePath(entry: VideoEntry): string {
    return path.join(this.root, entry.info.id, entry.sourceFile);
  }
  get(id: string): VideoEntry | undefined {
    return this.entries.get(id);
  }
  all(): VideoEntry[] {
    return [...this.entries.values()];
  }
  infos(): VideoInfo[] {
    return [...this.entries.values()].map((e) => e.info);
  }
}

const SECONDS = 48;
const SCENE = 6;

/**
 * Locates a recording of 48 s in scenes of 6 s whose first `placeSec` seconds show the Deutsches
 * Eck and whose rest the gallery cannot place; the frames drawn for the whole file read as
 * `whole`. Returns the full fix and the engine's log.
 */
async function locateRecording(placeSec: number, whole: number): Promise<{ fix: Fix; logs: string[] }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-one-place-'));
  const store = new MemoryStore(root);
  const id = 'onep';
  const entry: VideoEntry = {
    info: {
      id,
      name: 'ein-ort.mp4',
      sizeBytes: 1,
      status: 'ready',
      error: null,
      createdAt: 0,
      durationSec: SECONDS,
      frameWidth: 320,
      frameHeight: 240,
      sampleFps: 1,
      detail: 'standard',
      tilesPerFrame: 1,
      framesSeen: 0,
      framesIndexed: 0,
      sceneCount: 0,
      progress: 1,
      processingMs: 0,
      playable: true,
      sourceId: 'eingang',
      capturedAt: 0,
      scenario: null,
      facesMasked: 0,
      deleteAfter: null,
      coarse: false,
    },
    sourceFile: 'source.mp4',
    frames: [],
    scenes: [],
    embeddings: null,
    cancelled: false,
  };
  store.entries.set(id, entry);
  const framesDir = path.join(root, id, 'frames');
  await fs.mkdir(framesDir, { recursive: true });
  const made = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=320x240:rate=10:duration=${SECONDS}`, '-pix_fmt', 'yuv420p', store.sourcePath(entry)]);
  if (made.status !== 0) throw new Error(`ffmpeg failed: ${String(made.stderr)}`);
  spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', store.sourcePath(entry), '-vf', 'fps=1', '-q:v', '3', path.join(framesDir, '%d.jpg')]);
  const numbers = (await fs.readdir(framesDir))
    .filter((f) => f.endsWith('.jpg'))
    .map((f) => Number.parseInt(f, 10))
    .sort((a, b) => a - b)
    .slice(0, SECONDS);
  entry.frames = numbers.map((n, i) => ({ n, t: i, s: Math.floor(i / SCENE) }));
  entry.scenes = Array.from({ length: SECONDS / SCENE }, (_, k) => ({
    index: k,
    start: k * SCENE,
    end: (k + 1) * SCENE,
    firstFrame: k * SCENE,
    lastFrame: k * SCENE + SCENE - 1,
    keyframe: k * SCENE + SCENE / 2,
    tags: [],
  }));
  // The analysis vectors: the Deutsches Eck for the first `placeSec` seconds, then nowhere.
  const vectors = new Float32Array(entry.frames.length * DIM);
  entry.frames.forEach((_, i) => vectors.set(unit(i < placeSec ? DEUTSCHES_ECK : NOWHERE), i * DIM));
  entry.embeddings = GrowableMatrix.fromData(vectors, DIM);

  const logs: string[] = [];
  const engine = new DatumEngine({
    store: store as unknown as Store,
    model: modelFor(whole),
    hub: { broadcast: () => undefined } as unknown as EventHub,
    gallery: async () => gallery,
    log: (m) => logs.push(m),
    holdout: false,
    worldModel: null,
  });
  try {
    await engine.init();
    engine.enqueue(id, true);
    const end = Date.now() + 120_000;
    while (engine.get(id)?.status !== 'ready' && engine.get(id)?.status !== 'error') {
      if (Date.now() > end) throw new Error('timed out');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const fix = engine.get(id) as Fix;
    assert.equal(fix.status, 'ready', fix.error ?? '');
    return { fix, logs };
  } finally {
    engine.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
}

/** "Deutschland 25 %", as the whole file's country entry lists countries. */
const countryList = (fix: Fix): string =>
  fix.countries
    .slice(0, 3)
    .map((c) => `${c.name} ${Math.round(c.p * 100)} %`)
    .join(', ');

/** The whole file's country estimate (its region entry) says the fix's countries are its own. */
function keepsWholeFileCountries(fix: Fix): void {
  const region = fix.evidence.find((e) => e.kind === 'region');
  assert.ok(region, 'the whole file has a country entry');
  assert.ok(fix.countries.length > 0);
  assert.ok(region.detail.includes(`Zusammen mit den Ländern der ähnlichsten Referenzbilder: ${countryList(fix)}.`), `${countryList(fix)} | ${region.detail}`);
}

test('engine, one place below a fifth of the recording: the whole file stays above and the fix keeps its stretches as the timeline', { skip: NO_FFMPEG }, async () => {
  // 6 of 48 s at the Deutsches Eck (12.5 %); the whole file says Römer, Frankfurt.
  const { fix, logs } = await locateRecording(6, ROEMER);
  assert.equal(fix.location?.label.startsWith('Römer'), true, fix.location?.label);
  // The timeline: the located stretch and the undetermined rest (engine.ts keeps the stretches of
  // a verdict without a lead; engine 11 dropped them).
  const segments = fix.segments ?? [];
  assert.deepEqual(
    segments.map((s) => [s.startSec, s.endSec, s.place, s.location?.label ?? null]),
    [
      [0, 6, 1, 'Deutsches Eck, Koblenz'],
      [6, 48, null, null],
    ],
  );
  const entry = fix.evidence.find((e) => e.kind === 'segments');
  assert.ok(entry);
  assert.equal(entry.weight, 0);
  assert.equal(entry.frame, undefined, 'the entry names no stretch as the one shown');
  assert.match(entry.detail, /\(0:00–0:06: Deutsches Eck, Koblenz\) umfasst nur 13 % der Aufnahme, weniger als die 20 %/);
  assert.match(entry.detail, /der Abschnitt mit Ort hat in der Zeitleiste unter dem Video seine eigene Uhrzeit\.$/);
  // Its stretch has the time that entry promises.
  assert.ok(segments[0]!.time, 'the located stretch has a time of its own');
  // The whole file's place, entries, time and countries stand: nothing says "Ganze Datei (gemischt)".
  assert.equal(fix.evidence.some((e) => e.label.startsWith('Ganze Datei (gemischt): ')), false);
  assert.ok(fix.evidence.some((e) => e.kind === 'landmark' && e.weight > 0 && e.label.startsWith('Referenzbild: Römer')));
  keepsWholeFileCountries(fix);
  assert.ok(logs.some((l) => l.includes('1 erkannter Ort in 2 Abschnitten (1 unbestimmt); oben die ganze Datei: der Ort umfasst nur 13 % (unter 20 %)')), logs.join('\n'));
});

test('engine, one place that replaces the whole file: the whole file\'s entries say they include the undetermined stretches, the countries are the place\'s share', { skip: NO_FFMPEG }, async () => {
  // 12 of 48 s at the Deutsches Eck (25 %); the whole file says Römer, Frankfurt, 88 km away.
  const { fix } = await locateRecording(12, ROEMER);
  assert.equal(fix.location?.label.startsWith('Deutsches Eck'), true, fix.location?.label);
  assert.deepEqual(
    (fix.segments ?? []).map((s) => [s.startSec, s.endSec, s.place]),
    [
      [0, 12, 1],
      [12, 48, null],
    ],
  );
  const entry = fix.evidence.find((e) => e.kind === 'segments');
  assert.equal(entry?.weight, 0.9);
  assert.notEqual(entry?.frame, undefined);
  // Every whole-file entry, those of the place (reference pictures, country estimate) and those of
  // the time (sun, season), speaks of one place and the undetermined stretches, never of several
  // places (engine.ts hands the mix on to wholeFileEvidence and multiPlaceTimeEvidence).
  const whole = fix.evidence.filter((e) => e.label.startsWith('Ganze Datei (gemischt): '));
  assert.ok(whole.some((e) => e.kind === 'landmark'), 'a reference picture of the whole file');
  assert.ok(whole.some((e) => e.kind === 'region'), 'the whole file\'s country estimate');
  assert.ok(whole.some((e) => e.kind === 'sun' || e.kind === 'season'), 'a time entry of the whole file');
  for (const e of whole) {
    assert.equal(e.weight, 0, e.label);
    assert.match(e.detail, /auch die unbestimmten Abschnitte einschließen/, e.label);
    assert.doesNotMatch(e.detail, /mehrere Orte vermischen/, e.label);
    assert.match(e.detailEn ?? '', /include the undetermined segments too/, e.label);
    assert.doesNotMatch(e.detailEn ?? '', /mix several places/, e.label);
  }
  // The countries are the place's share of the whole recording.
  assert.deepEqual(
    fix.countries.map((c) => [c.iso, c.p]),
    [['DE', 0.25]],
  );
});

test('engine, one place that agrees with the whole file: its place, entries and countries stand', { skip: NO_FFMPEG }, async () => {
  // 12 of 48 s at the Deutsches Eck (25 %); the whole file says the same.
  const { fix } = await locateRecording(12, DEUTSCHES_ECK);
  assert.equal(fix.location?.label.startsWith('Deutsches Eck'), true, fix.location?.label);
  assert.equal(fix.segments?.length, 2);
  const entry = fix.evidence.find((e) => e.kind === 'segments');
  assert.equal(entry?.weight, 0.5);
  assert.match(entry?.detail ?? '', /Die Ortung aus der ganzen Datei stimmt mit ihm überein und bleibt\./);
  // The whole file's entries of the place keep their weight and their words; its time entries
  // stand besides the stretch's own time, said to include the undetermined stretches.
  for (const e of fix.evidence.filter((x) => x.kind === 'landmark' || x.kind === 'region' || x.kind === 'worldmodel')) {
    assert.equal(e.label.startsWith('Ganze Datei (gemischt): '), false, e.label);
  }
  assert.ok(fix.evidence.some((e) => e.kind === 'landmark' && e.weight > 0.5 && e.label.startsWith('Referenzbild: Deutsches Eck')));
  const time = fix.evidence.filter((e) => e.label.startsWith('Ganze Datei (gemischt): '));
  assert.ok(time.length > 0);
  for (const e of time) {
    assert.ok(e.kind === 'sun' || e.kind === 'season', e.label);
    assert.match(e.detail, /^Aus Bildern der ganzen Datei, die auch die unbestimmten Abschnitte einschließen;/, e.label);
    assert.match(e.detailEn ?? '', /^From frames of the whole file, which include the undetermined segments too;/, e.label);
  }
  // Not "Deutschland 25 %" next to the whole file's estimate of the same country (verdictCountries).
  assert.notDeepEqual(
    fix.countries.map((c) => [c.iso, c.p]),
    [['DE', 0.25]],
  );
  keepsWholeFileCountries(fix);
});
