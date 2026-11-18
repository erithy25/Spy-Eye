import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EventHub } from '../src/events.js';
import type { FaceDetector } from '../src/ml/faces.js';
import type { EmbeddingModel } from '../src/ml/model.js';
import { Pipeline, insertByPriority } from '../src/pipeline.js';
import type { Store, VideoEntry } from '../src/store.js';

/**
 * An analyst's own upload must not wait behind the seeded reference set: on a first start the
 * sixty reference videos fill the dense-pass queue, and a person's upload is analysed next.
 */

test('insertByPriority: a foreground id goes before the first background id, background ids go last', () => {
  const background = new Set(['r1', 'r2', 'r3']);
  const isBackground = (id: string): boolean => background.has(id);
  const queue: string[] = [];
  insertByPriority(queue, 'r1', true, isBackground);
  insertByPriority(queue, 'r2', true, isBackground);
  insertByPriority(queue, 'own1', false, isBackground);
  insertByPriority(queue, 'r3', true, isBackground);
  insertByPriority(queue, 'own2', false, isBackground);
  assert.deepEqual(queue, ['own1', 'own2', 'r1', 'r2', 'r3']);
});

test('pipeline: uploads are analysed before the waiting reference videos, in the order they came', () => {
  const entries = new Map<string, VideoEntry>();
  for (const id of ['r1', 'r2', 'r3', 'own1', 'own2']) entries.set(id, { info: { id, name: `${id}.mp4` } } as unknown as VideoEntry);
  const store = { get: (id: string) => entries.get(id) } as unknown as Store;
  const queued: string[] = [];
  const pipeline = new Pipeline(
    store,
    {} as EmbeddingModel,
    {} as FaceDetector,
    { broadcast: () => undefined } as unknown as EventHub,
    { info: () => undefined, error: () => undefined },
    { onRecordingQueued: (entry) => queued.push(entry.info.id) },
  );
  // Nothing is processed: the model never becomes ready in this test.
  pipeline.setReadyGate(new Promise<void>(() => undefined));
  pipeline.enqueue('r1', { background: true });
  pipeline.enqueue('r2', { background: true });
  pipeline.enqueue('own1');
  pipeline.enqueue('r3', { background: true });
  pipeline.enqueue('own2');
  assert.deepEqual(pipeline.waiting, ['own1', 'own2', 'r1', 'r2', 'r3']);
  // Every recording is announced once when it is queued (DATUM's quick stage starts there).
  assert.deepEqual(queued, ['r1', 'r2', 'own1', 'r3', 'own2']);
  pipeline.enqueue('own1');
  assert.deepEqual(queued.length, 5, 'queued twice is queued once');
  // A deleted recording leaves the queue and its background mark.
  pipeline.cancel('r1');
  pipeline.enqueue('own3');
  assert.deepEqual(pipeline.waiting, ['own1', 'own2', 'own3', 'r2', 'r3']);
  // While a person's recording waits for (or is in) the dense pass, other background work holds back.
  assert.equal(pipeline.foregroundActive, true);
  for (const id of ['own1', 'own2', 'own3']) pipeline.cancel(id);
  assert.equal(pipeline.foregroundActive, false, 'only reference videos left');
  pipeline.uploadStarted();
  assert.equal(pipeline.foregroundActive, true, 'a file is arriving');
  pipeline.uploadFinished();
  assert.equal(pipeline.foregroundActive, false);
  pipeline.shutdown();
});

test('pipeline: a dense pass that fails because the node shuts down is not stored as failed', async () => {
  // shutdown() kills the running ffmpeg; the pass then fails with "ffmpeg wurde beendet". Stored
  // as 'error', the recording would never be analysed again (the store skips such recordings at
  // start). Without the shutdown the same failure is the recording's and is stored.
  const until = async (cond: () => boolean): Promise<void> => {
    const deadline = Date.now() + 10_000;
    while (!cond()) {
      if (Date.now() > deadline) throw new Error('timeout');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  /** The parts of the pipeline the test replaces: the dense pass itself and the preview pass. */
  type Internals = { process(entry: VideoEntry, started: number): Promise<void>; runPreviews(): Promise<void>; previewQueue: string[] };
  const run = async (stop: boolean): Promise<{ status: string; persisted: string[]; logs: string[] }> => {
    const entry = { info: { id: 'own', name: 'own.mp4', status: 'queued', error: null }, cancelled: false } as unknown as VideoEntry;
    const persisted: string[] = [];
    const logs: string[] = [];
    const store = {
      get: (id: string) => (id === 'own' ? entry : undefined),
      resetAnalysis: () => undefined,
      persistMeta: async (e: VideoEntry) => void persisted.push(e.info.id),
      videoDir: (id: string) => `/nirgends/${id}`,
      videosDir: '/nirgends',
      framesDir: (id: string) => `/nirgends/${id}/frames`,
      stats: () => ({}),
    } as unknown as Store;
    const pipeline = new Pipeline(store, {} as EmbeddingModel, {} as FaceDetector, { broadcast: () => undefined } as unknown as EventHub, {
      info: (m) => void logs.push(m),
      error: (m) => void logs.push(m),
    });
    const inner = pipeline as unknown as Internals;
    inner.runPreviews = async () => {
      inner.previewQueue.length = 0;
    };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let started = false;
    inner.process = async () => {
      started = true;
      await gate;
      throw new Error('ffmpeg wurde beendet (SIGKILL).');
    };
    pipeline.setReadyGate(Promise.resolve());
    pipeline.enqueue('own');
    await until(() => started);
    if (stop) pipeline.shutdown();
    release();
    await until(() => pipeline.queueLength === 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { status: entry.info.status, persisted, logs };
  };

  const stopped = await run(true);
  assert.notEqual(stopped.status, 'error');
  assert.deepEqual(stopped.persisted, [], 'nothing written: the stored state stays "queued" for the next start');
  assert.ok(stopped.logs.some((l) => /beim Beenden angehalten/.test(l)), stopped.logs.join('\n'));

  const failed = await run(false);
  assert.equal(failed.status, 'error');
  assert.deepEqual(failed.persisted, ['own']);
});
