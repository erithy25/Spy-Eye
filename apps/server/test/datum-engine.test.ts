import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { EventHub } from '../src/events.js';
import type { EmbeddingModel } from '../src/ml/model.js';
import type { Store, VideoEntry } from '../src/store.js';
import type { ServerEvent, VideoInfo } from '../src/types.js';
import type { Fix } from '../src/datum/contract.js';
import { DatumEngine, moreSky, type SkyCandidate } from '../src/datum/engine.js';
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
    await settle();
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
    await settle();
    assert.deepEqual(computed, ['c', 'a']);
    assert.equal(engine.get('a')?.location?.label, 'neu');
    const written = JSON.parse(await fs.readFile(path.join(store.videoDir('a'), 'datum', 'fix.json'), 'utf8')) as Fix & { engineVersion: number };
    assert.equal(written.engineVersion, ENGINE_VERSION);
    assert.equal(written.location?.label, 'neu');

    // b's index is ready again: located now, its stored fix is not taken over.
    store.entries.get('b')!.info.status = 'ready';
    engine.enqueue('b', true);
    await settle();
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
    await settle();
    await engine.init();
    assert.equal(engine.get('a')?.location?.label, 'neu');
  } finally {
    await dispose();
  }
});

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
    await settle();
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
    await settle();
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
