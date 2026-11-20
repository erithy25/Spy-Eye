import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { EventHub } from '../src/events.js';
import type { EmbeddingModel } from '../src/ml/model.js';
import type { Store, VideoEntry } from '../src/store.js';
import type { ServerEvent, VideoInfo } from '../src/types.js';
import type { Fix } from '../src/datum/contract.js';
import { DatumEngine, moreSky, segmentsGiveWay, type SkyCandidate } from '../src/datum/engine.js';
import { ENGINE_VERSION } from '../src/datum/version.js';

/**
 * The bookkeeping of the DATUM engine around the computation: which stored fixes are used, when
 * a recording is located again, and what happens to recordings that are deleted. The computation
 * itself is replaced where it would need models and data.
 */

/** The part of the store the engine uses, kept in memory. */
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
  infos(): VideoInfo[] {
    return [...this.entries.values()].map((e) => e.info);
  }
  /** As Store.remove: marks the entry, forgets it, deletes its folder. */
  async remove(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry) entry.cancelled = true;
    this.entries.delete(id);
    await fs.rm(this.videoDir(id), { recursive: true, force: true });
  }
}

function recording(id: string, status: VideoInfo['status']): VideoEntry {
  return {
    info: {
      id,
      name: `${id}.mp4`,
      sizeBytes: 1,
      status,
      error: null,
      createdAt: 0,
      durationSec: 10,
      frameWidth: 1280,
      frameHeight: 720,
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
    // No index: a real computation fails at once, which some tests use.
    embeddings: null,
    cancelled: false,
  };
}

function readyFix(videoId: string, label: string): Fix {
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
  };
}

async function setup(): Promise<{ store: MemoryStore; engine: DatumEngine; events: Fix[]; dispose: () => Promise<void> }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-engine-'));
  const store = new MemoryStore(root);
  const events: Fix[] = [];
  const hub = {
    broadcast: (event: ServerEvent): void => {
      if (event.type === 'datum-fix') events.push(event.fix);
    },
  };
  const engine = new DatumEngine({
    store: store as unknown as Store,
    model: { dim: 4, embedTexts: async () => new Float32Array(0) } as unknown as EmbeddingModel,
    hub: hub as unknown as EventHub,
    gallery: () => Promise.reject(new Error('no gallery in this test')),
    log: () => undefined,
    holdout: false,
  });
  return {
    store,
    engine,
    events,
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

/** Lets the engine's background work run to its next wait. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * Waits until `done` holds (polling every 10 ms, at most 5 s). For results of background work
 * that a fixed pause would wait for too briefly on a slow machine (seen on the CI runner).
 */
async function until(done: () => boolean, ms = 5000): Promise<void> {
  const by = Date.now() + ms;
  while (!done() && Date.now() < by) await new Promise((resolve) => setTimeout(resolve, 10));
}

/** Replaces the computation (models, gallery, terrain) with a function of the test. */
function replaceCompute(engine: DatumEngine, compute: (entry: VideoEntry) => Promise<Fix>): void {
  (engine as unknown as { compute: (entry: VideoEntry) => Promise<Fix> }).compute = compute;
}

test('stored fixes: used when current, ignored while the index is rebuilt, replaced when it was rebuilt', async () => {
  const { store, engine, events, dispose } = await setup();
  try {
    await add(store, recording('a', 'ready'), { ...readyFix('a', 'alt'), engineVersion: ENGINE_VERSION });
    // Index being rebuilt (other model, broken vectors): its stored fix came from the old index.
    await add(store, recording('b', 'queued'), { ...readyFix('b', 'alt'), engineVersion: ENGINE_VERSION });
    // Fix of an older engine version: located again.
    await add(store, recording('c', 'ready'), { ...readyFix('c', 'alt'), engineVersion: ENGINE_VERSION - 1 });
    const computed: string[] = [];
    replaceCompute(engine, async (entry) => {
      computed.push(entry.info.id);
      return readyFix(entry.info.id, 'neu');
    });

    await engine.init();
    await until(() => engine.get('c')?.location?.label === 'neu');
    assert.equal(engine.get('a')?.location?.label, 'alt');
    assert.equal(engine.get('b')?.status, 'pending');
    assert.equal(engine.get('b')?.location, null, 'the old fix of a re-indexed recording is not shown');
    assert.deepEqual(computed, ['c']);
    assert.equal(engine.get('c')?.location?.label, 'neu');

    // Without force a ready fix stays; the pipeline's report of a rebuilt index forces a new one.
    engine.enqueue('a');
    await settle();
    assert.deepEqual(computed, ['c']);
    engine.enqueue('a', true);
    await until(() => engine.get('a')?.location?.label === 'neu');
    assert.deepEqual(computed, ['c', 'a']);
    assert.equal(engine.get('a')?.location?.label, 'neu');
    const written = JSON.parse(await fs.readFile(path.join(store.videoDir('a'), 'datum', 'fix.json'), 'utf8')) as Fix & { engineVersion: number };
    assert.equal(written.engineVersion, ENGINE_VERSION);
    assert.equal(written.location?.label, 'neu');

    // b's index is ready again: located now, its stored fix is not taken over.
    store.entries.get('b')!.info.status = 'ready';
    engine.enqueue('b', true);
    await until(() => engine.get('b')?.location?.label === 'neu');
    assert.equal(engine.get('b')?.location?.label, 'neu');
    assert.ok(events.some((f) => f.videoId === 'b' && f.status === 'running'));
  } finally {
    await dispose();
  }
});

test('init does not replace a fix that this run has already queued or computed', async () => {
  const { store, engine, dispose } = await setup();
  try {
    await add(store, recording('a', 'ready'), { ...readyFix('a', 'alt'), engineVersion: ENGINE_VERSION });
    replaceCompute(engine, async (entry) => readyFix(entry.info.id, 'neu'));
    // The pipeline finished re-indexing before init ran.
    engine.enqueue('a', true);
    await until(() => engine.get('a')?.location?.label === 'neu');
    await engine.init();
    assert.equal(engine.get('a')?.location?.label, 'neu');
  } finally {
    await dispose();
  }
});

test('a final fix computed again and stopped before the new one is written is computed again at the next start', async () => {
  const { store, engine, events, dispose } = await setup();
  const later: DatumEngine[] = [];
  /** A second start of the node on the same recordings. */
  const restart = (): DatumEngine => {
    const next = new DatumEngine({
      store: store as unknown as Store,
      model: { dim: 4, embedTexts: async () => new Float32Array(0) } as unknown as EmbeddingModel,
      hub: { broadcast: () => undefined } as unknown as EventHub,
      gallery: () => Promise.reject(new Error('no gallery in this test')),
      log: () => undefined,
      holdout: false,
    });
    later.push(next);
    return next;
  };
  const redo = path.join(store.videoDir('a'), 'datum', 'redo');
  try {
    await add(store, recording('a', 'ready'), { ...readyFix('a', 'alt'), engineVersion: ENGINE_VERSION });
    // The first run: Neu orten, and the node stops while the new fix is computed.
    let release: (() => void) | null = null;
    replaceCompute(engine, (entry) => new Promise<Fix>((resolve) => (release = () => resolve(readyFix(entry.info.id, 'abgebrochen')))));
    await engine.init();
    assert.equal(engine.get('a')?.location?.label, 'alt');
    engine.enqueue('a', true);
    await until(() => release !== null);
    assert.ok(release, 'the computation started');
    // While it runs, the list says so and keeps the old place (a 'pending' set after the job had
    // started used to overwrite 'running').
    assert.equal(engine.get('a')?.status, 'running');
    assert.equal(engine.get('a')?.location?.label, 'alt');
    // The wait was announced with the old place, so that an open console shows it at once.
    assert.ok(events.some((e) => e.videoId === 'a' && e.status === 'pending' && e.location?.label === 'alt'));
    await fs.access(redo);
    engine.stop();
    (release as unknown as () => void)();
    await settle();
    const kept = JSON.parse(await fs.readFile(path.join(store.videoDir('a'), 'datum', 'fix.json'), 'utf8')) as Fix;
    assert.equal(kept.location?.label, 'alt', 'nothing is written after the stop');

    // The next start shows the old fix and computes it again; the note goes once the new one is written.
    const second = restart();
    const computed: string[] = [];
    replaceCompute(second, async (entry) => {
      computed.push(entry.info.id);
      return readyFix(entry.info.id, 'neu');
    });
    await second.init();
    assert.equal(second.get('a')?.location?.label, 'alt', 'the old fix stays on show meanwhile');
    await until(() => second.get('a')?.location?.label === 'neu');
    assert.deepEqual(computed, ['a']);
    await assert.rejects(fs.access(redo), 'the note is removed with the new fix');

    // A start after that has nothing left to do.
    const third = restart();
    const again: string[] = [];
    replaceCompute(third, async (entry) => {
      again.push(entry.info.id);
      return readyFix(entry.info.id, 'noch einmal');
    });
    await third.init();
    await settle();
    assert.deepEqual(again, []);
    assert.equal(third.get('a')?.location?.label, 'neu');

    // A recording located for the first time needs no note: its missing fix says it all.
    await add(store, recording('b', 'ready'));
    third.enqueue('b', true);
    await until(() => third.get('b')?.location?.label === 'noch einmal');
    await assert.rejects(fs.access(path.join(store.videoDir('b'), 'datum', 'redo')));
  } finally {
    for (const e of later) e.stop();
    await dispose();
  }
});

test('the note of a computation still to do: written for a rebuilt index, gone after a failure for good', async () => {
  const { store, engine, events, dispose } = await setup();
  const later: DatumEngine[] = [];
  const restart = (): DatumEngine => {
    const next = new DatumEngine({
      store: store as unknown as Store,
      model: { dim: 4, embedTexts: async () => new Float32Array(0) } as unknown as EmbeddingModel,
      hub: { broadcast: () => undefined } as unknown as EventHub,
      gallery: () => Promise.reject(new Error('no gallery in this test')),
      log: () => undefined,
      holdout: false,
    });
    later.push(next);
    return next;
  };
  const redo = (id: string): string => path.join(store.videoDir(id), 'datum', 'redo');
  const noted = async (id: string): Promise<boolean> =>
    fs.access(redo(id)).then(
      () => true,
      () => false,
    );
  try {
    // 'r': its index is rebuilt (other model); its full fix came from the old one.
    await add(store, recording('r', 'queued'), { ...readyFix('r', 'alter Index'), engineVersion: ENGINE_VERSION });
    // 'f': a final fix whose recomputation fails for good.
    await add(store, recording('f', 'ready'), { ...readyFix('f', 'alt'), engineVersion: ENGINE_VERSION });
    let release: (() => void) | null = null;
    replaceCompute(engine, (entry) =>
      entry.info.id === 'f' ? Promise.reject(new Error('Galerie unlesbar')) : new Promise<Fix>((resolve) => (release = () => resolve(readyFix(entry.info.id, 'abgebrochen')))),
    );
    await engine.init();
    assert.ok(await noted('r'), 'the old index\'s fix is noted at init');
    assert.equal(await noted('f'), false);

    // The failure for good: shown, and no note is left to compute it again at every start.
    engine.enqueue('f', true);
    await until(() => events.some((e) => e.videoId === 'f' && e.status === 'error'));
    assert.ok(events.some((e) => e.videoId === 'f' && e.status === 'error'));
    await until(() => !existsNow(redo('f')));
    assert.equal(await noted('f'), false, 'no note after a failure for good');

    // The pipeline reports 'r' ready; the node stops while it is located.
    store.entries.get('r')!.info.status = 'ready';
    engine.enqueue('r', true);
    await until(() => release !== null);
    assert.ok(release, 'the computation of r started');
    engine.stop();
    (release as unknown as () => void)();
    await settle();
    assert.ok(await noted('r'), 'still noted after the stop');

    // Next start: 'r' (ready now, its fix current by version) is computed again; 'f' is not.
    const second = restart();
    const computed: string[] = [];
    replaceCompute(second, async (entry) => {
      computed.push(entry.info.id);
      return readyFix(entry.info.id, 'neu');
    });
    await second.init();
    await until(() => second.get('r')?.location?.label === 'neu');
    await settle();
    assert.deepEqual(computed, ['r']);
    assert.equal(second.get('f')?.location?.label, 'alt', 'the stored fix stands after the failure');
    assert.equal(await noted('r'), false);

    // A noted recomputation that fails for good at the next start: quietly, the stored fix on
    // show; it stands as final in that run too, so nothing stays outstanding (--prepare ends).
    await add(store, recording('g', 'ready'), { ...readyFix('g', 'alt'), engineVersion: ENGINE_VERSION });
    await fs.writeFile(redo('g'), '1');
    second.stop();
    const third = restart();
    let failed = 0;
    replaceCompute(third, async (entry) => {
      if (entry.info.id === 'g') {
        failed++;
        throw new Error('Galerie unlesbar');
      }
      return readyFix(entry.info.id, 'neu');
    });
    await third.init();
    await until(() => failed === 1 && third.outstanding === 0);
    assert.equal(failed, 1);
    assert.equal(third.outstanding, 0, 'nothing outstanding after the failure');
    assert.equal(third.get('g')?.status, 'ready');
    assert.equal(third.get('g')?.location?.label, 'alt');
    assert.equal(await noted('g'), false);
  } finally {
    for (const e of later) e.stop();
    await dispose();
  }
});

/** Whether a file exists right now (for until()). */
function existsNow(file: string): boolean {
  return existsSync(file);
}

test('a recording deleted while it is located gets no fix, no fix.json and no folder back', async () => {
  const { store, engine, events, dispose } = await setup();
  try {
    await add(store, recording('d', 'ready'));
    replaceCompute(engine, async (entry) => {
      // The operator deletes the recording while the computation runs.
      await store.remove(entry.info.id);
      return readyFix(entry.info.id, 'gelöscht');
    });
    engine.enqueue('d');
    // Until the job is done, not a fixed time: deleting a folder takes longer on Windows.
    await until(() => engine.queueLength === 0);
    await assert.rejects(fs.access(store.videoDir('d')), 'the folder of the deleted recording is not created again');
    assert.equal(engine.get('d'), null);
    assert.ok(!events.some((f) => f.videoId === 'd' && f.status === 'ready'), 'no fix announced for a deleted recording');
    assert.equal(engine.prune(), 0, 'nothing left behind in the engine');

    // A computation that fails because its recording vanished is no error either.
    await add(store, recording('e', 'ready'));
    replaceCompute(engine, async (entry) => {
      await store.remove(entry.info.id);
      throw new Error('Bild fehlt');
    });
    engine.enqueue('e');
    await until(() => engine.queueLength === 0);
    assert.ok(!events.some((f) => f.videoId === 'e' && f.status === 'error'));
    assert.equal(engine.prune(), 0);
  } finally {
    await dispose();
  }
});

test('prune forgets the fixes of recordings deleted elsewhere', async () => {
  const { store, engine, dispose } = await setup();
  try {
    await add(store, recording('f', 'ready'), { ...readyFix('f', 'alt'), engineVersion: ENGINE_VERSION });
    await add(store, recording('g', 'ready'), { ...readyFix('g', 'alt'), engineVersion: ENGINE_VERSION });
    await engine.init();
    await store.remove('f');
    assert.equal(engine.prune(), 1);
    assert.equal(engine.prune(), 0);
    assert.equal(engine.get('g')?.location?.label, 'alt');
    // forget() is what the deleting code calls directly.
    await store.remove('g');
    engine.forget('g');
    assert.equal(engine.prune(), 0);
  } finally {
    await dispose();
  }
});

test('the horizon match uses the keyframe with the most sky, not the first one above 5 %', () => {
  const sky = (frame: number, skyFraction: number): SkyCandidate => ({ skyline: [0.5], aspect: 16 / 9, frame, skyFraction });
  // A street with a corner of sky first, an open ridge second.
  const pick = (candidates: SkyCandidate[]): number | null => candidates.reduce<SkyCandidate | null>(moreSky, null)?.frame ?? null;
  assert.equal(pick([sky(1, 0.06), sky(2, 0.4), sky(3, 0.2)]), 2);
  assert.equal(pick([sky(1, 0.3), sky(2, 0.3)]), 1, 'on a tie the earlier keyframe stays');
  assert.equal(pick([sky(1, 0.04), sky(2, 0.05)]), null, 'up to 5 % sky is no skyline to match');
});

test('the segment step of a long recording gives way: to a person\'s quick fix always, in the background to any job of a person\'s', () => {
  const quick = { kind: 'quick' as const, background: false };
  const full = { kind: 'full' as const, background: false };
  const reference = { kind: 'quick' as const, background: true };
  // A person's long recording: another person's upload waits for its quick fix, which should be
  // there in seconds; the world model's two minutes give way. A full job or background work waiting
  // does not stop it.
  assert.equal(segmentsGiveWay(40, false, [quick]), true);
  assert.equal(segmentsGiveWay(40, false, [full, reference]), false);
  // In the background, any job of a person's.
  assert.equal(segmentsGiveWay(40, true, [full]), true);
  assert.equal(segmentsGiveWay(40, true, [reference]), false);
  // A short recording (the reference clips) finishes: a few seconds.
  assert.equal(segmentsGiveWay(3, false, [quick]), false);
  assert.equal(segmentsGiveWay(3, true, [quick]), false);
});
