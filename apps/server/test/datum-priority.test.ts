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
  pipeline.shutdown();
});
