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
import { DatumEngine } from '../src/datum/engine.js';
import { summariseFixes } from '../src/datum/routes.js';
import { MAX_TRUTH_ENTRIES, TruthBook, cleanTruthName, parseTruthBody, truthKey } from '../src/datum/truth.js';
import { ENGINE_VERSION } from '../src/datum/version.js';

/** Own ground truth: reading the list, storing it, and attaching it to the fixes. */

test('truth names: folders and control characters go, the video extension and the case do not matter', () => {
  assert.equal(cleanTruthName('C:\\Videos\\Ausflug\\Clip 1.MP4'), 'Clip 1.MP4');
  assert.equal(cleanTruthName('/home/a/b/clip.mov'), 'clip.mov');
  assert.equal(cleanTruthName('cl\u0000ip\u202e.mp4'), 'clip.mp4');
  assert.equal(truthKey('Clip 1.MP4'), truthKey('clip 1'));
  assert.equal(truthKey('IMG_0042.mov'), truthKey('img_0042.MOV'));
  assert.equal(truthKey('folder/IMG_0042.mov'), 'img_0042');
  // Only video extensions are cut off: a dot in the name stays.
  assert.equal(truthKey('Fahrt 1.2'), 'fahrt 1.2');
  assert.notEqual(truthKey('Fahrt 1.2'), truthKey('Fahrt 1'));
  assert.equal(truthKey('Straße.MP4'), 'straße');
});

test('truth list: every entry is checked, the first fault is named, later entries win', () => {
  const refused = (body: unknown): string => {
    const parsed = parseTruthBody(body);
    assert.ok(!('entries' in parsed), JSON.stringify(parsed));
    assert.ok(parsed.en.length > 0);
    return parsed.de;
  };
  assert.match(refused(null), /entries/);
  assert.match(refused({ entries: 'x' }), /entries/);
  assert.match(refused({ entries: [] }), /leer/);
  assert.match(refused({ entries: [{ name: 'a', lat: 91, lon: 0 }] }), /Eintrag 1 .*Breite/);
  assert.match(refused({ entries: [{ name: 'a', lat: 0, lon: 0 }, { name: 'b', lat: 0, lon: -180.5 }] }), /Eintrag 2 .*Länge/);
  assert.match(refused({ entries: [{ name: 'a', lat: '50', lon: 7 }] }), /Breite/);
  assert.match(refused({ entries: [{ name: 'a', lat: Number.NaN, lon: 7 }] }), /Breite/);
  assert.match(refused({ entries: [{ name: '  ', lat: 50, lon: 7 }] }), /Dateiname/);
  assert.match(refused({ entries: [{ name: '.mp4', lat: 50, lon: 7 }] }), /Dateiname/);
  assert.match(refused({ entries: [{ name: 'a', lat: 50, lon: 7, label: 5 }] }), /Bezeichnung/);
  assert.match(refused({ entries: Array.from({ length: MAX_TRUTH_ENTRIES + 1 }, (_, i) => ({ name: `v${i}`, lat: 0, lon: 0 })) }), /Höchstens/);

  const parsed = parseTruthBody({
    entries: [
      { name: 'Clip.mp4', lat: 50.123456789, lon: 7.1, label: '  Rhein\nufer  ' },
      { name: 'other', lat: -33.9, lon: 151.2 },
      { name: 'CLIP', lat: 51, lon: 8, label: null },
    ],
  });
  assert.ok('entries' in parsed);
  assert.deepEqual(parsed.entries, [
    { name: 'other', lat: -33.9, lon: 151.2 },
    { name: 'CLIP', lat: 51, lon: 8 },
  ]);
  const one = parseTruthBody({ entries: [{ name: 'x', lat: 50.123456789, lon: 7, label: '  Rhein\nufer  ' }] });
  assert.ok('entries' in one);
  assert.deepEqual(one.entries[0], { name: 'x', lat: 50.123457, lon: 7, label: 'Rhein ufer' });
  assert.ok('entries' in parseTruthBody({ entries: Array.from({ length: MAX_TRUTH_ENTRIES }, (_, i) => ({ name: `v${i}`, lat: 0, lon: 0 })) }));
});

test('truth book: stored, looked up by file name, kept over a restart, capped', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-truth-'));
  try {
    const file = path.join(dir, 'datum', 'truth.json');
    const book = new TruthBook(file);
    await book.open();
    assert.equal(book.size, 0);
    const result = await book.put([{ name: 'Clip.mp4', lat: 50, lon: 7, label: 'Rheinufer' }, { name: 'b', lat: 1, lon: 2 }]);
    assert.deepEqual(result, { stored: 2 });
    assert.deepEqual(book.lookup('clip.MOV'), { name: 'Clip.mp4', lat: 50, lon: 7, label: 'Rheinufer' });
    assert.equal(book.lookup('c.mp4'), null);
    // A corrected position replaces the old one.
    await book.put([{ name: 'clip', lat: 51, lon: 8 }]);
    assert.equal(book.size, 2);
    const again = new TruthBook(file);
    await again.open();
    assert.deepEqual(again.lookup('Clip.mp4'), { name: 'clip', lat: 51, lon: 8 });
    // The node keeps at most MAX_TRUTH_ENTRIES; a list that would exceed it changes nothing.
    const tooMany = Array.from({ length: MAX_TRUTH_ENTRIES - 1 }, (_, i) => ({ name: `v${i}`, lat: 0, lon: 0 }));
    assert.ok(!('stored' in (await again.put(tooMany))), 'two stored plus 9 999 new ones is one too many');
    assert.equal(again.size, 2);
    const full = await again.put(tooMany.slice(1));
    assert.ok('stored' in full);
    assert.equal(again.size, MAX_TRUTH_ENTRIES);
    const refused = await again.put([{ name: 'one-more', lat: 0, lon: 0 }]);
    assert.ok(!('stored' in refused));
    assert.equal(again.lookup('one-more'), null);
    // Replacing an existing entry is still possible at the limit.
    assert.ok('stored' in (await again.put([{ name: 'v1', lat: 3, lon: 4 }])));
    // An unreadable file is moved aside, not overwritten.
    await fs.writeFile(file, '{ kaputt');
    const broken = new TruthBook(file);
    await assert.rejects(broken.open(), /unreadable-/);
    assert.ok((await fs.readdir(path.dirname(file))).some((f) => f.startsWith('truth.json.unreadable-')));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

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

function recording(id: string, name: string): VideoEntry {
  return {
    info: {
      id, name, sizeBytes: 1, status: 'ready', error: null, createdAt: 0, durationSec: 10, frameWidth: 640, frameHeight: 360, sampleFps: 1,
      detail: 'standard', tilesPerFrame: 1, framesSeen: 0, framesIndexed: 0, sceneCount: 0, progress: 1, processingMs: 0, playable: true,
      sourceId: 'eingang', capturedAt: 0, scenario: null, facesMasked: 0, deleteAfter: null, coarse: false,
    },
    sourceFile: 'source.mp4',
    frames: [],
    scenes: [],
    embeddings: null,
    cancelled: false,
  };
}

function readyFix(videoId: string, lat: number, lon: number): Fix {
  return {
    videoId,
    status: 'ready',
    error: null,
    computedAt: 1,
    elapsedMs: 1000,
    location: { lat, lon, radiusKm: 30, confidence: 0.5, method: 'landmark', label: 'x', country: 'DE', countryName: 'Deutschland' },
    candidates: [],
    countries: [],
    time: { method: 'none', utc: null, date: null, dateSource: 'none', monthRange: null, timezone: null, windows: [], sunElevationBand: null, phase: 'unknown', confidence: 0, notes: [], notesEn: [] },
    sun: null,
    heading: null,
    horizon: null,
    evidence: [],
    keyframes: [],
    stage: 'full',
    truth: null,
  };
}

test('own truths are attached to the fixes at once, written and announced; the reference set keeps its own', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-truth-engine-'));
  try {
    const store = new MemoryStore(root);
    const events: Fix[] = [];
    const book = new TruthBook(path.join(root, 'truth.json'));
    await book.open();
    const engine = new DatumEngine({
      store: store as unknown as Store,
      model: { dim: 4, embedTexts: async () => new Float32Array(0) } as unknown as EmbeddingModel,
      hub: { broadcast: (e: ServerEvent) => (e.type === 'datum-fix' ? events.push(e.fix) : undefined) } as unknown as EventHub,
      gallery: () => Promise.reject(new Error('no gallery in this test')),
      log: () => undefined,
      holdout: false,
      truths: book,
    });
    // Two own recordings with fixes, one not yet located, and a reference video.
    const own = [recording('a', 'Ausflug.MP4'), recording('b', 'Hafen.mov'), recording('c', 'Später.mp4'), recording('r', 'datum-001.mp4')];
    for (const entry of own) {
      store.entries.set(entry.info.id, entry);
      await fs.mkdir(path.join(store.videoDir(entry.info.id), 'datum'), { recursive: true });
    }
    for (const [id, lat, lon] of [['a', 50.36, 7.6], ['b', 53.54, 9.98], ['r', 0, 0]] as const) {
      await fs.writeFile(path.join(store.videoDir(id), 'datum', 'fix.json'), JSON.stringify({ ...readyFix(id, lat, lon), engineVersion: ENGINE_VERSION }));
    }
    await engine.init();
    assert.equal(engine.get('a')?.truth, null);

    const entries = [
      { name: 'ausflug', lat: 50.3644, lon: 7.6062, label: 'Deutsches Eck' },
      { name: 'Hafen.MP4', lat: 53.5, lon: 10.0 },
      { name: 'datum-001', lat: 1, lon: 1 },
      { name: 'unbekannt.mp4', lat: 1, lon: 1 },
    ];
    await book.put(entries);
    const matched = await engine.applyTruths(entries.map((e) => e.name));
    assert.equal(matched, 2, 'Ausflug and Hafen; the reference video keeps its reference truth, nothing is called unbekannt');

    const a = engine.get('a')!;
    assert.equal(a.truth?.source, 'eigene');
    assert.equal(a.truth?.label, 'Deutsches Eck');
    assert.ok(a.truth?.errorKm !== null && a.truth!.errorKm! < 1);
    assert.equal(engine.get('b')?.truth?.label, 'Hafen.MP4', 'without a label the file name stands for the place');
    assert.ok(events.some((f) => f.videoId === 'a' && f.truth?.source === 'eigene'), 'announced');
    const written = JSON.parse(await fs.readFile(path.join(store.videoDir('a'), 'datum', 'fix.json'), 'utf8')) as Fix & { engineVersion: number };
    assert.equal(written.truth?.source, 'eigene');
    assert.equal(written.engineVersion, ENGINE_VERSION);
    assert.equal(engine.get('r')?.truth, null, 'not touched: the reference truth comes with its next fix');

    // The measurement counts own and reference truths apart.
    const summary = summariseFixes(engine.list(), false, null, book.size);
    assert.equal(summary.withTruth, 2);
    assert.equal(summary.bySource.eigene.withTruth, 2);
    assert.equal(summary.bySource.referenz.withTruth, 0);
    assert.equal(summary.ownTruths, 4);
    assert.equal(summary.quick, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('a fix computed for a reference video carries the reference truth with its URL', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-truth-ref-'));
  try {
    const store = new MemoryStore(root);
    const book = new TruthBook(path.join(root, 'truth.json'));
    await book.put([{ name: 'datum-001.mp4', lat: 1, lon: 1 }, { name: 'eigen.mp4', lat: 50, lon: 7 }]);
    const engine = new DatumEngine({
      store: store as unknown as Store,
      model: { dim: 4 } as unknown as EmbeddingModel,
      hub: { broadcast: () => undefined } as unknown as EventHub,
      gallery: () => Promise.reject(new Error('no gallery')),
      log: () => undefined,
      holdout: false,
      truths: book,
    });
    (engine as unknown as { compute: (entry: VideoEntry) => Promise<Fix> }).compute = async (entry) => readyFix(entry.info.id, 50.1, 7.1);
    for (const entry of [recording('r', 'datum-001.mp4'), recording('e', 'EIGEN.MP4')]) {
      store.entries.set(entry.info.id, entry);
      await fs.mkdir(store.videoDir(entry.info.id), { recursive: true });
      engine.enqueue(entry.info.id);
    }
    const end = Date.now() + 5000;
    while (engine.get('r')?.status !== 'ready' || engine.get('e')?.status !== 'ready') {
      if (Date.now() > end) throw new Error('timed out');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const reference = engine.get('r')!.truth;
    // The reference set ships with the repository; its first video has a known place.
    assert.equal(reference?.source, 'referenz');
    assert.match(reference?.url ?? '', /^https:\/\//);
    assert.notEqual(reference?.lat, 1, 'an own truth never overrides the reference set');
    const ownTruth = engine.get('e')!.truth;
    assert.equal(ownTruth?.source, 'eigene');
    assert.equal(ownTruth?.url, undefined);
    assert.ok(ownTruth?.errorKm !== null && Math.abs(ownTruth!.errorKm! - 13.5) < 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
