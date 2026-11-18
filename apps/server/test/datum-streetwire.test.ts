import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { EventHub } from '../src/events.js';
import type { EmbeddingModel } from '../src/ml/model.js';
import type { Store, VideoEntry } from '../src/store.js';
import type { VideoInfo } from '../src/types.js';
import type { Fix } from '../src/datum/contract.js';
import type { Gallery, GalleryNeighbour } from '../src/datum/gallery.js';
import type { StreetLevelHooks } from '../src/datum/engine.js';
import type { FetchLike, StreetLevelDeps, StreetLevelInput, StreetLevelPicture, StreetLevelResult, StreetLevelSituation } from '../src/datum/streetlevel.js';

/**
 * The street-level stage inside the full analysis: when it is asked (and when never), what it
 * changes in the fix, and that a failing, slow or rate-limiting service costs the fix at most the
 * stage's budget. The engine runs as in datum-quick.test.ts, with a deterministic stand-in for the
 * image model and a gallery stand-in with one clear landmark (tier 'strong'); the network is a
 * mock in every test, and one that fails the test when it is asked where nothing may be asked.
 */

// Set before config is loaded: the stand-in's text vectors must not land in the node's cache, and
// offline mode is what these tests run in (the stage is switched on explicitly where it runs).
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-streetwire-data-'));
process.env['DATA_DIR'] = dataDir;
process.env['SICHT_OFFLINE'] = '1';
const { DatumEngine } = await import('../src/datum/engine.js');
const { GrowableMatrix } = await import('../src/ml/math.js');
const sl = await import('../src/datum/streetlevel.js');
const { streetSources, streetImagePath } = await import('../src/datum/streetImage.js');

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

const LANDMARK = { lat: 50.3644, lon: 7.6062 };

/** Every query row finds the Deutsches Eck far ahead of two look-alikes: tier 'strong'. */
const gallery = {
  size: 3,
  search: (vectors: Float32Array, k: number): GalleryNeighbour[][] => {
    const rows = vectors.length / DIM;
    const row: GalleryNeighbour[] = [
      { id: 'Q1', label: 'Deutsches Eck', lat: LANDMARK.lat, lon: LANDMARK.lon, country: 'DE', wikidata: 'Q1', similarity: 0.95 },
      { id: 'Q2', label: 'Brücke', lat: 48.85, lon: 2.35, country: 'FR', wikidata: 'Q2', similarity: 0.7 },
      { id: 'Q3', label: 'Turm', lat: 41.9, lon: 12.5, country: 'IT', wikidata: 'Q3', similarity: 0.69 },
    ];
    return Array.from({ length: rows }, () => row.slice(0, k));
  },
} as unknown as Gallery;

class MemoryStore {
  readonly entries = new Map<string, VideoEntry>();
  constructor(readonly root: string) {}
  get dataDir(): string {
    return dataDir;
  }
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

function recording(id: string): VideoEntry {
  return {
    info: {
      id,
      name: `${id}.mp4`,
      sizeBytes: 1,
      status: 'queued',
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

/** A recording with its file, as the upload stores it (6 s of moving colour bars). */
async function stored(store: MemoryStore, id: string): Promise<VideoEntry> {
  const entry = recording(id);
  store.entries.set(id, entry);
  await fs.mkdir(store.videoDir(id), { recursive: true });
  const made = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=6', '-pix_fmt', 'yuv420p', store.sourcePath(entry)]);
  if (made.status !== 0) throw new Error(`ffmpeg failed: ${String(made.stderr)}`);
  return entry;
}

/** The analysis has finished: frames on disk, their vectors in the index. */
async function analysed(store: MemoryStore, entry: VideoEntry): Promise<void> {
  const framesDir = path.join(store.videoDir(entry.info.id), 'frames');
  await fs.mkdir(framesDir, { recursive: true });
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', store.sourcePath(entry), '-vf', 'fps=1', '-q:v', '3', path.join(framesDir, '%d.jpg')]);
  const files = (await fs.readdir(framesDir)).filter((f) => f.endsWith('.jpg'));
  entry.frames = files.map((f) => Number.parseInt(f, 10)).sort((a, b) => a - b).map((n, i) => ({ n, t: i, s: 0 }));
  const vectors = new Float32Array(entry.frames.length * DIM);
  entry.frames.forEach((_, i) => vectors.set(hashVector(`frame-${i}`), i * DIM));
  entry.embeddings = GrowableMatrix.fromData(vectors, DIM);
  entry.info.status = 'ready';
}

async function until(check: () => boolean, ms = 120_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

interface Run {
  engine: InstanceType<typeof DatumEngine>;
  store: MemoryStore;
  logs: string[];
  dispose: () => Promise<void>;
}

async function engineWith(streetLevel: StreetLevelHooks): Promise<Run> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-streetwire-'));
  const store = new MemoryStore(root);
  const logs: string[] = [];
  const engine = new DatumEngine({
    store: store as unknown as Store,
    model: model as unknown as EmbeddingModel,
    hub: { broadcast: () => undefined } as unknown as EventHub,
    gallery: async () => gallery,
    log: (line) => logs.push(line),
    holdout: false,
    worldModel: null,
    streetLevel,
  });
  return {
    engine,
    store,
    logs,
    dispose: async () => {
      engine.stop();
      await fs.rm(root, { recursive: true, force: true });
    },
  };
}

/** The full fix of a recording analysed at once (no quick fix before it). */
async function fullFix(run: Run, id: string): Promise<Fix> {
  const entry = await stored(run.store, id);
  await analysed(run.store, entry);
  run.engine.enqueue(id, true);
  await until(() => run.engine.get(id)?.status === 'ready' || run.engine.get(id)?.status === 'error');
  const fix = run.engine.get(id)!;
  assert.equal(fix.status, 'ready', fix.error ?? '');
  assert.equal(fix.stage, 'full');
  return fix;
}

/** A network that fails the test if anything is asked. */
function forbiddenNetwork(): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      throw new Error(`no request may be made, but ${url} was asked`);
    },
  };
}

const STEP = 'Mit Straßenbildern verglichen';
const MAPILLARY_KEY = 'MLY|4242424242|streetwire0secret0value';

test('switched off: nothing is requested, the fix has no street-level step', async () => {
  const net = forbiddenNetwork();
  let lookups = 0;
  const run = await engineWith({
    enabled: () => false,
    deps: {
      fetch: net.fetch,
      lookup: async () => {
        lookups++;
        throw new Error('no name may be resolved');
      },
      mapillaryKey: MAPILLARY_KEY,
    },
  });
  try {
    const fix = await fullFix(run, 'off1');
    assert.deepEqual(net.calls, []);
    assert.equal(lookups, 0);
    assert.ok(!fix.evidence.some((e) => e.kind === 'streetlevel'));
    assert.ok(!fix.trace?.some((s) => s.label === STEP));
    assert.equal(fix.location?.method, 'landmark');
  } finally {
    await run.dispose();
  }
});

test('offline mode (SICHT_OFFLINE): nothing is requested whatever the setting says', async () => {
  const net = forbiddenNetwork();
  // No `enabled` hook: the engine decides as on a node, and SICHT_OFFLINE=1 is set above.
  const run = await engineWith({ deps: { fetch: net.fetch, lookup: null, mapillaryKey: null } });
  try {
    const fix = await fullFix(run, 'off2');
    assert.deepEqual(net.calls, []);
    assert.ok(!fix.trace?.some((s) => s.label === STEP));
  } finally {
    await run.dispose();
  }
});

test('services unreachable (no network, no name resolution): the fix completes and says why, the key never shows', async () => {
  let asked = 0;
  const run = await engineWith({
    enabled: () => true,
    deps: {
      // What undici throws without a network, with the request details in the cause.
      fetch: async (url, init) => {
        asked++;
        const auth = new Headers(init.headers).get('Authorization') ?? '';
        throw new TypeError('fetch failed', { cause: new Error(`getaddrinfo ENOTFOUND ${new URL(url).hostname} (${auth})`) });
      },
      lookup: null,
      mapillaryKey: MAPILLARY_KEY,
    },
  });
  try {
    const t0 = Date.now();
    const fix = await fullFix(run, 'net1');
    assert.ok(asked > 0, 'the services were asked');
    assert.ok(Date.now() - t0 < 60_000);
    const step = fix.trace?.find((s) => s.label === STEP);
    assert.ok(step, 'the trace says the stage ran');
    assert.match(step.detail ?? '', /Abruf fehlgeschlagen/);
    assert.match(step.detailEn ?? '', /retrieval failed/);
    const street = fix.evidence.filter((e) => e.kind === 'streetlevel');
    assert.equal(street.length, 1);
    assert.equal(street[0]?.weight, 0);
    assert.ok(street[0]?.labelEn && street[0]?.detailEn);
    assert.equal(street[0]?.refSource, undefined, 'no picture without a match');
    // The place stays the recognised landmark.
    assert.equal(fix.location?.method, 'landmark');
    assert.ok(Math.abs((fix.location?.lat ?? 0) - LANDMARK.lat) < 0.01);
    // The key appears nowhere: not in the fix, not in the log.
    const secret = MAPILLARY_KEY.split('|')[2] as string;
    assert.ok(!JSON.stringify(fix).includes(secret), 'the key is not in the fix');
    assert.ok(!run.logs.join('\n').includes(secret), 'the key is not in the log');
  } finally {
    await run.dispose();
  }
});

test('rate limit (429): the service is not asked again in that call, the fix completes', async () => {
  const asked: string[] = [];
  const run = await engineWith({
    enabled: () => true,
    deps: {
      fetch: async (url) => {
        asked.push(url);
        return new Response('slow down', { status: 429 });
      },
      lookup: null,
      mapillaryKey: null,
    },
  });
  try {
    const fix = await fullFix(run, 'rate1');
    // The first answers stop the provider: the waiting searches are dropped (4 run at a time).
    assert.ok(asked.length > 0 && asked.length <= 8, `asked ${asked.length} times`);
    const street = fix.evidence.find((e) => e.kind === 'streetlevel');
    assert.ok(street);
    assert.match(street.detail, /429/);
    assert.match(street.detailEn ?? '', /429/);
    assert.equal(fix.location?.method, 'landmark');
  } finally {
    await run.dispose();
  }
});

/** Seconds of the stage as the engine logged them: `Straßenbilder "name": reason (1.9 s)`. */
function loggedSeconds(logs: readonly string[]): number {
  const line = logs.find((l) => l.startsWith('Straßenbilder '));
  assert.ok(line, 'the engine logs the outcome of the stage');
  const m = /\((\d+(?:\.\d+)?) s\)$/.exec(line);
  assert.ok(m, line);
  return Number(m[1]);
}

test('a service that never answers: the stage stops at its budget, the fix goes on', async () => {
  // A fetch that answers only when it is cut off, as the real one does.
  const run = await engineWith({
    enabled: () => true,
    options: { budgetMs: 2_000, reserveMs: 300, requestTimeoutMs: 30_000 },
    deps: {
      fetch: (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason instanceof Error ? init.signal.reason : new Error('aborted')), { once: true });
        }),
      lookup: null,
      mapillaryKey: null,
    },
  });
  try {
    const fix = await fullFix(run, 'slow1');
    const secs = loggedSeconds(run.logs);
    // 2 s budget; a loaded machine may fire the timer late.
    assert.ok(secs <= 3, `stage took ${secs} s`);
    const street = fix.evidence.find((e) => e.kind === 'streetlevel');
    assert.ok(street);
    assert.match(street.detail, /Zeitbudget/);
    assert.match(street.detailEn ?? '', /budget/);
  } finally {
    await run.dispose();
  }
});

test('a resolver that hangs and a fetch that ignores its signal: the engine waits no longer than the budget', async () => {
  const run = await engineWith({
    enabled: () => true,
    options: { budgetMs: 2_000, reserveMs: 300, requestTimeoutMs: 30_000 },
    deps: {
      // Neither ever settles: only the stage's own abort of the name check and the engine's
      // hard limit can end the wait.
      fetch: () => new Promise<Response>(() => undefined),
      lookup: () => new Promise<string[]>(() => undefined),
      mapillaryKey: null,
    },
  });
  try {
    const fix = await fullFix(run, 'hang1');
    const secs = loggedSeconds(run.logs);
    assert.ok(secs <= 3, `stage took ${secs} s`);
    assert.ok(fix.trace?.some((s) => s.label === STEP));
    assert.equal(fix.location?.method, 'landmark');
  } finally {
    await run.dispose();
  }
});

test('the same with a fetch that ignores its signal behind an allowed name: the engine cuts the stage off', async () => {
  const run = await engineWith({
    enabled: () => true,
    options: { budgetMs: 1_500, reserveMs: 300, requestTimeoutMs: 30_000 },
    deps: { fetch: () => new Promise<Response>(() => undefined), lookup: null, mapillaryKey: null },
  });
  try {
    const fix = await fullFix(run, 'hang2');
    const secs = loggedSeconds(run.logs);
    assert.ok(secs >= 1.5 && secs <= 2.6, `stage took ${secs} s`);
    const street = fix.evidence.find((e) => e.kind === 'streetlevel');
    assert.ok(street);
    assert.match(street.detail, /überschritten/);
    assert.match(street.detailEn ?? '', /exceeded/);
  } finally {
    await run.dispose();
  }
});

/** Three street-level pictures around the landmark, as the stage returns a match. */
function matchedResult(): StreetLevelResult {
  const picture = (i: number): StreetLevelPicture => ({
    provider: i === 1 ? 'mapillary' : 'panoramax',
    id: `pic${i}`,
    lat: LANDMARK.lat + 0.0004 + i * 0.0001,
    lon: LANDMARK.lon - 0.0006,
    thumbUrl: `https://panoramax.example.org/thumb/pic${i}.jpg`,
    pageUrl: `https://api.panoramax.xyz/#focus=pic&pic=pic${i}`,
    capturedAt: Date.UTC(2024, 5, 1),
    headingDeg: null,
    panorama: false,
    author: 'jdupont',
    license: 'CC-BY-SA-4.0',
    licenseUrl: null,
    attribution: '© jdupont, CC BY-SA 4.0, Panoramax',
    similarity: 0.9 - i * 0.01,
    frameRow: 0,
    frame: 5,
    candidateIndex: 0,
    distanceKm: 0.1,
    pass: 1,
  });
  return {
    matched: true,
    reasonCode: 'matched',
    reason: 'Straßenbild passt.',
    reasonEn: 'A street-level picture matches.',
    location: { lat: LANDMARK.lat + 0.0005, lon: LANDMARK.lon - 0.0006, radiusKm: 1, confidence: 0.75 },
    candidateIndex: 0,
    top: [picture(0), picture(1), picture(2)],
    stats: { pictures: 30, spreadPictures: 24, best: 0.9, typical: 0.7, spread: 0.02, gap: 0.2, z: 10, agreement: 1 },
    candidates: [],
    providers: [],
    timing: { totalMs: 1200, searchMs: 500, picturesMs: 600, embedMs: 100, requests: 12, downloaded: 10, fromCache: 0, failed: 0, budgetExhausted: false },
  };
}

test('a match: the place is pinned, the pictures are numbered as the route counts them, the quick stage never asks', async () => {
  const inputs: StreetLevelInput[] = [];
  const deps: StreetLevelDeps[] = [];
  const run = await engineWith({
    enabled: () => true,
    refine: async (input, d) => {
      inputs.push(input);
      deps.push(d);
      return matchedResult();
    },
  });
  try {
    // Quick stage first: located from the file, no street-level pictures.
    const entry = await stored(run.store, 'hit1');
    run.engine.quick('hit1');
    await until(() => run.engine.get('hit1')?.status === 'ready' || run.engine.get('hit1')?.status === 'error');
    assert.equal(run.engine.get('hit1')?.stage, 'quick');
    assert.equal(inputs.length, 0, 'the quick stage does not ask');
    // The analysis finishes: the full stage asks once, around the landmark.
    await analysed(run.store, entry);
    run.engine.enqueue('hit1', true);
    await until(() => run.engine.get('hit1')?.stage === 'full');
    const fix = run.engine.get('hit1')!;
    assert.equal(inputs.length, 1);
    const input = inputs[0]!;
    assert.equal(input.candidates.length, 1);
    assert.equal(input.candidates[0]?.radiusKm, 3);
    assert.ok(sl.distanceKm(input.candidates[0]!.lat, input.candidates[0]!.lon, LANDMARK.lat, LANDMARK.lon) < 1);
    assert.equal(input.dim, DIM);
    assert.ok(input.tiles && input.tiles.vectors.length === input.tiles.frameRow.length * DIM, 'the frames and their crops are the query');
    assert.ok(deps[0]?.signal, 'the engine can stop the stage');
    // The refined place, with the label of the landmark.
    const expected = matchedResult().location!;
    assert.equal(fix.location?.method, 'streetlevel');
    assert.equal(fix.location?.lat, expected.lat);
    assert.equal(fix.location?.lon, expected.lon);
    assert.equal(fix.location?.radiusKm, 1);
    assert.match(fix.location?.label ?? '', /Deutsches Eck/);
    // The street-level pictures lead the evidence; each refImage names the number under which the
    // route finds that very picture.
    const street = fix.evidence.filter((e) => e.kind === 'streetlevel');
    assert.equal(street.length, 3);
    assert.equal(fix.evidence[0]?.kind, 'streetlevel');
    const sources = streetSources(fix);
    assert.equal(sources.length, 3);
    for (const [n, url] of sources.entries()) {
      const item = fix.evidence.find((e) => e.refSource === url);
      assert.equal(item?.refImage, streetImagePath('hit1', n));
    }
    for (const e of street) {
      assert.ok(e.labelEn && e.detailEn && e.refUrl && e.refLabel);
      assert.ok(e.refImage?.startsWith('/api/datum/fixes/hit1/street/'), 'the console loads the picture from the node');
    }
    const step = fix.trace?.find((s) => s.label === STEP);
    assert.ok(step?.detail && step.detailEn);
    // The error against a truth would be measured from the pinned place (none here).
    assert.equal(fix.truth, null);
  } finally {
    await run.dispose();
  }
});

test('a stand-in stage that throws costs the fix nothing but the refinement', async () => {
  const run = await engineWith({
    enabled: () => true,
    refine: async () => {
      throw new Error('kaputt');
    },
  });
  try {
    const fix = await fullFix(run, 'boom1');
    assert.equal(fix.location?.method, 'landmark');
    const street = fix.evidence.find((e) => e.kind === 'streetlevel');
    assert.ok(street);
    assert.match(street.detail, /kaputt/);
  } finally {
    await run.dispose();
  }
});

test('which answers are searched: clearly recognised landmarks, never weaker ones, countries, GPS or world-model answers', () => {
  const location = { lat: 48.1, lon: 11.5, radiusKm: 3, confidence: 0.6, method: 'landmark' as const, label: 'Ort', country: 'DE', countryName: 'Deutschland' };
  const situation = (method: StreetLevelSituation['diagnostics']['method'], radiusTier: string | null, worldModel: StreetLevelSituation['diagnostics']['worldModel'] = null): StreetLevelSituation => ({
    location,
    diagnostics: { method, radiusTier, worldModel },
  });
  const strong = sl.streetLevelPlan(situation('landmark', 'strong'));
  assert.deepEqual(strong?.candidate, { lat: 48.1, lon: 11.5, radiusKm: 3, label: 'Ort' });
  assert.equal(strong?.source, 'landmark');
  // A weaker recognition is too often a look-alike elsewhere (docs/measurements/datum-streetlevel-open.json).
  assert.equal(sl.streetLevelPlan(situation('landmark', 'recognised')), null);
  assert.equal(sl.streetLevelPlan(situation('landmark', 'similar')), null);
  assert.equal(sl.streetLevelPlan(situation('region', 'country')), null);
  assert.equal(sl.streetLevelPlan(situation('metadata', 'strong')), null);
  assert.equal(sl.streetLevelPlan({ location: null, diagnostics: { method: 'none', radiusTier: null, worldModel: null } }), null);
  // A world-model answer: GeoCLIP's best point, only under a rule that allows it.
  const geo = { concentration: 0.45, best: { lat: 40.4, lon: -3.7 } };
  const concentrated = situation('worldmodel', 'worldmodel', geo);
  assert.equal(sl.streetLevelPlan(concentrated, { ...sl.STREETLEVEL_RULE, worldModelMinConcentration: null }), null);
  const allowed = sl.streetLevelPlan(concentrated, { ...sl.STREETLEVEL_RULE, worldModelMinConcentration: 0.2 });
  assert.deepEqual(allowed?.candidate, { lat: 40.4, lon: -3.7, radiusKm: 3, label: 'Ort' });
  assert.equal(allowed?.source, 'worldmodel');
  assert.equal(sl.streetLevelPlan(situation('worldmodel', 'worldmodel', { ...geo, concentration: 0.1 }), { ...sl.STREETLEVEL_RULE, worldModelMinConcentration: 0.2 }), null);
});

test('cleanup of the test data directory', async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});
