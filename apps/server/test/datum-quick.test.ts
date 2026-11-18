import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { EventHub } from '../src/events.js';
import type { EmbeddingModel } from '../src/ml/model.js';
import type { Store, VideoEntry } from '../src/store.js';
import type { ServerEvent, VideoInfo } from '../src/types.js';
import type { Fix } from '../src/datum/contract.js';
import type { Gallery, GalleryNeighbour } from '../src/datum/gallery.js';
import type { GeoclipPrediction } from '../src/datum/geoclip.js';
import type { GalleryState, WorldModel, WorldModelResult } from '../src/datum/geoclipService.js';

/**
 * The quick stage of DATUM: a recording is located from its file before the analysis has run,
 * and the full fix replaces it later. The engine runs with a small deterministic stand-in for the
 * image model and a gallery stand-in with one clear landmark, so that the test needs neither
 * model weights nor the reference set; the frame sampling, the world data, the localisation
 * and the time engine are the real ones.
 */

// The world caches country text vectors under DATA_DIR/datum, keyed by the model id: the
// stand-in's vectors must never land in the node's real cache. Set before config is loaded.
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-quick-data-'));
process.env['DATA_DIR'] = dataDir;
process.env['SICHT_OFFLINE'] = '1';
const { DatumEngine, jobRank } = await import('../src/datum/engine.js');
const { ENGINE_VERSION, OLDEST_SHOWN_VERSION } = await import('../src/datum/version.js');
const { GrowableMatrix } = await import('../src/ml/math.js');

const DIM = 16;

/** Unit vector from a string, the same every time. */
function hashVector(text: string, dim = DIM): Float32Array {
  const v = new Float32Array(dim);
  let h = 2166136261;
  for (let d = 0; d < dim; d++) {
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    h = Math.imul(h ^ d, 16777619);
    v[d] = ((h >>> 0) % 2000) / 1000 - 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

/** Stand-in for the image model: vectors from the mean colour of each picture. */
const model = {
  dim: DIM,
  imageSize: 16,
  imageMean: [0.5, 0.5, 0.5] as [number, number, number],
  imageStd: [0.5, 0.5, 0.5] as [number, number, number],
  embedPixels: async (pixels: Float32Array, count: number): Promise<Float32Array> => {
    const plane = pixels.length / count;
    const out = new Float32Array(count * DIM);
    for (let i = 0; i < count; i++) {
      let sum = 0;
      for (let j = 0; j < plane; j++) sum += pixels[i * plane + j]!;
      out.set(hashVector(`image-${Math.round((sum / plane) * 100)}-${i % 4}`), i * DIM);
    }
    return out;
  },
  embedTexts: async (texts: string[]): Promise<Float32Array> => {
    const out = new Float32Array(texts.length * DIM);
    texts.forEach((t, i) => out.set(hashVector(t), i * DIM));
    return out;
  },
};

/** Stand-in gallery: every query row finds the Deutsches Eck clearly ahead of two look-alikes. */
const gallery = {
  size: 3,
  // The localisation calls the gallery through its search thread; the stand-in answers directly.
  searchAsync(vectors: Float32Array, k: number): Promise<GalleryNeighbour[][]> {
    return Promise.resolve(this.search(vectors, k));
  },
  search: (vectors: Float32Array, k: number): GalleryNeighbour[][] => {
    const rows = vectors.length / DIM;
    const row: GalleryNeighbour[] = [
      { id: 'Q1', label: 'Deutsches Eck', lat: 50.3644, lon: 7.6062, country: 'DE', wikidata: 'Q1', similarity: 0.95 },
      { id: 'Q2', label: 'Brücke', lat: 48.85, lon: 2.35, country: 'FR', wikidata: 'Q2', similarity: 0.7 },
      { id: 'Q3', label: 'Turm', lat: 41.9, lon: 12.5, country: 'IT', wikidata: 'Q3', similarity: 0.69 },
    ];
    return Array.from({ length: rows }, () => row.slice(0, k));
  },
} as unknown as Gallery;

/**
 * Stand-in for the world model: a prediction concentrated at the Deutsches Eck (it agrees with
 * the gallery), counting how often it is asked and for how many frames.
 */
class WorldStandIn implements WorldModel {
  calls: number[] = [];
  galleryState: GalleryState = 'ready';
  warm(): void {}
  onGallerySettled(listener: (ready: boolean) => void): () => void {
    listener(true);
    return () => undefined;
  }
  async predict(jpegs: readonly Buffer[]): Promise<WorldModelResult> {
    this.calls.push(jpegs.length);
    const prediction: GeoclipPrediction = {
      frames: jpegs.length,
      aggregation: 'mixture',
      probs: new Float32Array([0.7, 0.3]),
      coords: new Float32Array([50.3644, 7.6062, 50.37, 7.6]),
      support: new Uint32Array([0, 1]),
      top: [{ lat: 50.3644, lon: 7.6062, p: 0.7 }],
      modes: [{ lat: 50.366, lon: 7.604, p: 1, peak: { lat: 50.3644, lon: 7.6062, p: 0.7 }, spreadKm: 0.4 }],
      refined: null,
      best: { lat: 50.3644, lon: 7.6062 },
      countries: [{ iso: 'DE', name: 'Deutschland', p: 1 }],
      timing: { embedMs: 1, scoreMs: 1, refineMs: 0 },
    };
    return { state: 'ok', prediction, reason: null, ms: 5 };
  }
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

function recording(id: string, status: VideoInfo['status'], name = `${id}.mp4`): VideoEntry {
  return {
    info: {
      id,
      name,
      sizeBytes: 1,
      status,
      error: null,
      createdAt: 0,
      durationSec: 6,
      frameWidth: 320,
      frameHeight: 240,
      sampleFps: 1,
      detail: 'standard',
      tilesPerFrame: 1,
      framesSeen: 0,
      framesIndexed: 0,
      sceneCount: 0,
      progress: 0,
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
}

function readyFix(videoId: string, label: string, stage?: 'quick' | 'full'): Fix {
  return {
    videoId,
    status: 'ready',
    error: null,
    computedAt: 1,
    elapsedMs: 1,
    location: { lat: 50, lon: 7, radiusKm: 1, confidence: 0.5, method: 'landmark', label, country: 'DE', countryName: 'Deutschland' },
    candidates: [],
    countries: [],
    time: { method: 'none', utc: null, date: null, dateSource: 'none', monthRange: null, timezone: null, windows: [], sunElevationBand: null, phase: 'unknown', confidence: 0, notes: [] },
    sun: null,
    heading: null,
    horizon: null,
    evidence: [],
    keyframes: [],
    truth: null,
    ...(stage ? { stage } : {}),
  };
}

interface Setup {
  store: MemoryStore;
  engine: InstanceType<typeof DatumEngine>;
  events: Fix[];
  background: Set<string>;
  world: WorldStandIn;
  dispose: () => Promise<void>;
}

async function setup(): Promise<Setup> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-quick-'));
  const store = new MemoryStore(root);
  const events: Fix[] = [];
  const background = new Set<string>();
  const world = new WorldStandIn();
  const hub = {
    broadcast: (event: ServerEvent): void => {
      if (event.type === 'datum-fix') events.push(event.fix);
    },
  };
  const engine = new DatumEngine({
    store: store as unknown as Store,
    model: model as unknown as EmbeddingModel,
    hub: hub as unknown as EventHub,
    gallery: async () => gallery,
    log: () => undefined,
    holdout: false,
    background: (id) => background.has(id),
    worldModel: world,
  });
  return {
    store,
    engine,
    events,
    background,
    world,
    dispose: async () => {
      engine.stop();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

async function add(store: MemoryStore, entry: VideoEntry, stored?: Fix & { engineVersion: number }): Promise<void> {
  store.entries.set(entry.info.id, entry);
  await fs.mkdir(store.videoDir(entry.info.id), { recursive: true });
  if (stored) {
    await fs.mkdir(path.join(store.videoDir(entry.info.id), 'datum'), { recursive: true });
    await fs.writeFile(path.join(store.videoDir(entry.info.id), 'datum', 'fix.json'), JSON.stringify(stored));
  }
}

/** Waits until `check` holds, polling; fails after `ms`. */
async function until(check: () => boolean, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

type Compute = (entry: VideoEntry) => Promise<Fix>;
function replace(engine: InstanceType<typeof DatumEngine>, quick: Compute | null, full: Compute | null): void {
  const target = engine as unknown as { computeQuick: Compute; compute: Compute };
  if (quick) target.computeQuick = quick;
  if (full) target.compute = full;
}

/** A short test picture video (moving colour bars, 6 s) made with ffmpeg. */
async function testVideo(file: string, seconds = 6): Promise<void> {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=320x240:rate=10:duration=${seconds}`, '-pix_fmt', 'yuv420p', file]);
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${String(result.stderr)}`);
}

test('job order: quick before full, a person\'s recordings before background work', () => {
  const ranks = [
    jobRank({ kind: 'quick', background: false }),
    jobRank({ kind: 'full', background: false }),
    jobRank({ kind: 'quick', background: true }),
    jobRank({ kind: 'full', background: true }),
  ];
  assert.deepEqual(ranks, [0, 1, 2, 3]);
});

test('the engine takes quick jobs first and an upload before the waiting reference set', async () => {
  const { store, engine, background, dispose } = await setup();
  try {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    replace(
      engine,
      async (entry) => {
        order.push(`quick:${entry.info.id}`);
        await gate;
        return { ...readyFix(entry.info.id, 'q', 'quick') };
      },
      async (entry) => {
        order.push(`full:${entry.info.id}`);
        await gate;
        return { ...readyFix(entry.info.id, 'f', 'full') };
      },
    );
    // Three reference videos are waiting, two of them analysed already.
    for (const id of ['ref1', 'ref2', 'ref3']) {
      background.add(id);
      await add(store, recording(id, id === 'ref3' ? 'queued' : 'ready'));
    }
    engine.quick('ref1');
    await settle();
    // ref1's quick job runs (and blocks); the rest waits.
    engine.enqueue('ref2', true);
    engine.quick('ref3');
    // A person uploads a video, and an analysed one of theirs is waiting for its full fix.
    await add(store, recording('own', 'queued'));
    await add(store, recording('mine', 'ready'));
    engine.enqueue('mine', true);
    engine.quick('own');
    assert.deepEqual(engine.waiting, [
      { id: 'own', kind: 'quick' },
      { id: 'mine', kind: 'full' },
      { id: 'ref3', kind: 'quick' },
      { id: 'ref2', kind: 'full' },
    ]);
    release();
    await until(() => order.length === 5);
    assert.deepEqual(order, ['quick:ref1', 'quick:own', 'full:mine', 'quick:ref3', 'full:ref2']);
  } finally {
    await dispose();
  }
});

test('background jobs wait while a person\'s recording is being analysed; the person\'s own jobs do not', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-quick-defer-'));
  try {
    const store = new MemoryStore(root);
    let analysing = true;
    const engine = new DatumEngine({
      store: store as unknown as Store,
      model: model as unknown as EmbeddingModel,
      hub: { broadcast: () => undefined } as unknown as EventHub,
      gallery: async () => gallery,
      log: () => undefined,
      holdout: false,
      background: (id) => id.startsWith('ref'),
      foregroundElsewhere: () => analysing,
      worldModel: null,
    });
    const order: string[] = [];
    replace(engine, async (entry) => {
      order.push(entry.info.id);
      return readyFix(entry.info.id, 'q', 'quick');
    }, null);
    for (const id of ['ref1', 'own']) await add(store, recording(id, 'queued'));
    engine.quick('ref1');
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.deepEqual(order, [], 'the reference video waits while the pipeline analyses an upload');
    engine.quick('own');
    await until(() => order.length === 1);
    assert.deepEqual(order, ['own'], 'the upload\'s own quick fix does not wait');
    analysing = false;
    await until(() => order.length === 2);
    assert.deepEqual(order, ['own', 'ref1']);

    // While a person's recording is located from its file, the engine asks the pipeline to pause;
    // not for reference videos.
    const seen: Array<[string, boolean]> = [];
    replace(engine, async (entry) => {
      seen.push([entry.info.id, engine.locatingForeground]);
      return readyFix(entry.info.id, 'q', 'quick');
    }, null);
    for (const id of ['ref2', 'own2']) await add(store, recording(id, 'queued'));
    engine.quick('own2');
    engine.quick('ref2');
    await until(() => seen.length === 2);
    assert.deepEqual(seen, [['own2', true], ['ref2', false]]);
    assert.equal(engine.locatingForeground, false, 'nothing held once the quick fix is there');
    engine.stop();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('quick stage: located from the file alone, before the analysis, every text in both languages', async () => {
  const { store, engine, events, world, dispose } = await setup();
  try {
    const entry = recording('v1', 'queued', 'Ausflug.mp4');
    await add(store, entry);
    await testVideo(store.sourcePath(entry));
    engine.quick('v1');
    await until(() => engine.get('v1')?.status === 'ready' || engine.get('v1')?.status === 'error');
    const fix = engine.get('v1')!;
    assert.equal(fix.status, 'ready', fix.error ?? '');
    assert.equal(fix.stage, 'quick');
    assert.deepEqual(fix.keyframes, [], 'no walkable space before the analysis has released frames');
    assert.equal(fix.heading, null);
    assert.equal(fix.horizon, null);
    assert.ok(fix.location, 'located');
    assert.match(fix.location.label, /Deutsches Eck/);
    assert.ok(fix.location.labelEn, 'the place has an English name');
    assert.ok(Math.abs(fix.location.lat - 50.36) < 0.1 && Math.abs(fix.location.lon - 7.61) < 0.1);
    // Running first, with the steps as they happen, then ready.
    const own = events.filter((f) => f.videoId === 'v1');
    assert.ok(own.some((f) => f.status === 'running' && (f.trace?.length ?? 0) > 0));
    assert.equal(own[own.length - 1]?.status, 'ready');
    // Every text the fix carries exists in German and in English.
    assert.ok(fix.evidence.length > 0);
    for (const e of fix.evidence) {
      assert.ok(e.labelEn && e.detailEn, `evidence ${e.kind} "${e.label}" has English texts`);
      assert.doesNotMatch(e.detailEn, /\b(der|die|das|und|nicht|Bild)\b/, `English detail is English: ${e.detailEn}`);
    }
    for (const step of fix.trace ?? []) if (step.detail) assert.ok(step.detailEn, `trace "${step.label}" has an English detail`);
    assert.deepEqual(fix.trace?.map((s) => s.label), ['Metadaten gelesen', 'Bilder für die Ortung gezogen', 'Mit der Referenzgalerie verglichen', 'Weltmodell befragt', 'Licht und Sonnenstand bestimmt']);
    // The world model looked at the sampled frames once, and agreed with the gallery.
    assert.equal(world.calls.length, 1);
    assert.ok((world.calls[0] ?? 0) > 0);
    const worldEvidence = fix.evidence.find((e) => e.kind === 'worldmodel');
    assert.ok(worldEvidence, 'the world model is part of the evidence');
    assert.match(worldEvidence.detail, /bestätigt/);
    assert.match(worldEvidence.detailEn ?? '', /confirms/);
    assert.equal(fix.location.method, 'landmark', 'the gallery answer stands where GeoCLIP agrees');
    assert.equal(fix.time.notesEn?.length, fix.time.notes.length);
    // Stored next to the recording with its stage.
    const stored = JSON.parse(await fs.readFile(path.join(store.videoDir('v1'), 'datum', 'fix.json'), 'utf8')) as Fix & { engineVersion: number };
    assert.equal(stored.engineVersion, ENGINE_VERSION);
    assert.equal(stored.stage, 'quick');

    // The analysis finishes: the full fix is computed while the quick one stays on show, and it
    // takes over the quick stage's frames instead of sampling them again.
    const framesDir = path.join(store.videoDir('v1'), 'frames');
    await fs.mkdir(framesDir, { recursive: true });
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', store.sourcePath(entry), '-vf', 'fps=1', '-q:v', '3', path.join(framesDir, '%d.jpg')]);
    const frameFiles = (await fs.readdir(framesDir)).filter((f) => f.endsWith('.jpg'));
    entry.frames = frameFiles.map((f) => Number.parseInt(f, 10)).sort((a, b) => a - b).map((n, i) => ({ n, t: i, s: 0 }));
    const vectors = new Float32Array(entry.frames.length * DIM);
    entry.frames.forEach((_, i) => vectors.set(hashVector(`frame-${i}`), i * DIM));
    entry.embeddings = GrowableMatrix.fromData(vectors, DIM);
    entry.info.status = 'ready';
    const before = events.length;
    engine.enqueue('v1', true);
    assert.equal(engine.get('v1')?.stage, 'quick', 'the quick fix stays on show while the full one is queued');
    assert.equal(engine.get('v1')?.status, 'ready');
    await until(() => engine.get('v1')?.stage === 'full', 120_000);
    const later = events.slice(before).filter((f) => f.videoId === 'v1');
    assert.ok(later.every((f) => f.status === 'ready'), 'no running state hides the quick fix');
    const full = engine.get('v1')!;
    assert.equal(full.location?.label, fix.location.label, 'same frames, same place');
    assert.ok(full.trace?.some((s) => s.label === 'Bilder für die Ortung gezogen' && /Schnellortung/.test(s.detail ?? '') && /quick localisation/.test(s.detailEn ?? '')));
    // The full stage takes the world model's answer over instead of asking again.
    assert.equal(world.calls.length, 1, 'the world model is not asked twice for the same frames');
    assert.ok(full.trace?.some((s) => s.label === 'Weltmodell befragt' && /Schnellortung/.test(s.detail ?? '') && /quick localisation/.test(s.detailEn ?? '')));
    assert.ok(full.evidence.some((e) => e.kind === 'worldmodel'));
    assert.ok(full.keyframes.length > 0);
    for (const e of full.evidence) assert.ok(e.labelEn && e.detailEn, `full evidence ${e.kind} has English texts`);
    for (const step of full.trace ?? []) if (step.detail) assert.ok(step.detailEn, `full trace "${step.label}" has an English detail`);
    assert.equal(engine.outstanding, 0);
  } finally {
    await dispose();
  }
});

test('a failed quick stage shows the error; the full stage still replaces it', async () => {
  const { store, engine, events, dispose } = await setup();
  try {
    await add(store, recording('bad', 'queued'));
    replace(engine, async () => {
      throw new Error('kaputt');
    }, async (entry) => readyFix(entry.info.id, 'voll', 'full'));
    engine.quick('bad');
    await until(() => engine.get('bad')?.status === 'error');
    assert.equal(engine.get('bad')?.error, 'kaputt');
    store.entries.get('bad')!.info.status = 'ready';
    engine.enqueue('bad', true);
    await until(() => engine.get('bad')?.status === 'ready');
    assert.equal(engine.get('bad')?.location?.label, 'voll');
    // The run without a fix on show is announced as it goes.
    assert.ok(events.some((f) => f.videoId === 'bad' && f.status === 'running'));
    // A recording with a fix gets no second quick stage.
    let quickRuns = 0;
    replace(engine, async (entry) => {
      quickRuns++;
      return readyFix(entry.info.id, 'q', 'quick');
    }, null);
    engine.quick('bad');
    await settle();
    assert.equal(quickRuns, 0);
  } finally {
    await dispose();
  }
});

test('start: stored quick fixes are shown, outdated fixes stay on show while they are computed again', async () => {
  const { store, engine, dispose } = await setup();
  try {
    // Analysis outstanding, quick fix stored: shown; no full job until the analysis is ready.
    await add(store, recording('q1', 'queued'), { ...readyFix('q1', 'schnell', 'quick'), engineVersion: ENGINE_VERSION });
    // Analysed, but the node stopped before the full stage: the quick fix is shown, the full one queued.
    await add(store, recording('q2', 'ready'), { ...readyFix('q2', 'schnell', 'quick'), engineVersion: ENGINE_VERSION });
    // Fix of the previous version: shown until the new one is there.
    await add(store, recording('old', 'ready'), { ...readyFix('old', 'alt'), engineVersion: OLDEST_SHOWN_VERSION });
    // Much older: discarded at once.
    await add(store, recording('ancient', 'ready'), { ...readyFix('ancient', 'uralt'), engineVersion: OLDEST_SHOWN_VERSION - 1 });
    const computed: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    replace(engine, null, async (entry) => {
      computed.push(entry.info.id);
      await gate;
      return readyFix(entry.info.id, 'neu', 'full');
    });
    await engine.init();
    await settle();
    assert.equal(engine.get('q1')?.location?.label, 'schnell');
    assert.equal(engine.get('q2')?.location?.label, 'schnell');
    assert.equal(engine.get('old')?.location?.label, 'alt');
    assert.equal(engine.get('old')?.status, 'ready');
    assert.equal(engine.get('ancient')?.location, null);
    assert.equal(engine.outstanding, 3, 'quick and outdated fixes are not final');
    release();
    await until(() => computed.length === 3 && engine.outstanding === 0);
    assert.deepEqual([...computed].sort(), ['ancient', 'old', 'q2']);
    assert.equal(engine.get('old')?.location?.label, 'neu');
    assert.equal(engine.get('q1')?.stage, 'quick');
    // The pipeline queues q1 again after the restart: its stored quick fix is not computed twice.
    let quickRuns = 0;
    replace(engine, async (entry) => {
      quickRuns++;
      return readyFix(entry.info.id, 'q', 'quick');
    }, null);
    engine.quick('q1');
    await settle();
    assert.equal(quickRuns, 0);
  } finally {
    await dispose();
  }
});

test('cleanup of the test data directory', async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});
