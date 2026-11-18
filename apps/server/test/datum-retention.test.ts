import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { config } from '../src/config.js';
import { PlatformNode, seedKey, seedRecordingKeys, type SeedFile, type SharedRuntime } from '../src/node.js';

/**
 * The DATUM reference set is seeded once and is the ground truth of the evaluation: retention
 * must not delete it, while everything else on the node keeps the normal retention.
 */

const seed: SeedFile = {
  sources: [
    {
      id: 'referenz',
      name: 'Referenzbestand',
      kind: 'upload',
      owner: 'DATUM',
      description: 'Test',
      lat: 0,
      lon: 0,
      shared: false,
      clips: [{ file: 'de-dom.mp4', name: 'datum-001.mp4', daysAgo: 1 }, { file: 'plain.mp4' }],
    },
  ],
};

test('the seed recordings are named by source and name', () => {
  const keys = seedRecordingKeys(seed);
  assert.ok(keys.has(seedKey('referenz', 'datum-001.mp4')));
  assert.ok(keys.has(seedKey('referenz', 'plain.mp4')), 'without a name the file name is used, as when seeding');
  assert.ok(!keys.has(seedKey('eingang', 'datum-001.mp4')));
  assert.ok(!keys.has(seedKey('referenz', 'eigenes.mp4')));
});

/** A node with nothing loaded: retention only needs the store, the cases and the ledger. */
async function node(keepSeed: boolean): Promise<{ node: PlatformNode; dispose: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-retention-'));
  const seedDir = path.join(dir, 'seed');
  await fs.mkdir(seedDir, { recursive: true });
  await fs.writeFile(path.join(seedDir, 'seed.json'), JSON.stringify(seed));
  const shared = { model: { dim: 4, onState: () => undefined }, faces: { ready: false }, hazard: null, ready: new Promise(() => undefined) } as unknown as SharedRuntime;
  const n = new PlatformNode(
    {
      id: 'datum',
      name: 'DATUM',
      operator: 'Test',
      region: '',
      lat: 0,
      lon: 0,
      host: '127.0.0.1',
      port: 0,
      dataDir: path.join(dir, 'data'),
      peers: [],
      seedDir,
      ...(keepSeed ? { keepSeed: true } : {}),
      exercise: false,
    },
    shared,
  );
  await fs.mkdir(path.join(dir, 'data'), { recursive: true });
  await n.ledger.open();
  return { node: n, dispose: () => fs.rm(dir, { recursive: true, force: true }) };
}

let counter = 0;
function register(n: PlatformNode, sourceId: string, name: string, ageDays: number): string {
  const id = (++counter).toString(16).padStart(16, '0');
  const entry = n.store.register({ id, name, sourceFile: 'source.mp4', sizeBytes: 1, sampleFps: 1, detail: 'standard', sourceId, capturedAt: Date.now() - ageDays * 86_400_000 });
  entry.info.status = 'ready';
  return id;
}

test('retention leaves the seeded reference set alone and deletes the rest', { skip: config.retentionDays <= 0 }, async () => {
  const { node: n, dispose } = await node(true);
  try {
    const age = config.retentionDays + 5;
    const reference = register(n, 'referenz', 'datum-001.mp4', age);
    const ownUpload = register(n, 'referenz', 'eigenes.mp4', age);
    const sameName = register(n, 'eingang', 'datum-001.mp4', age);
    const fresh = register(n, 'eingang', 'neu.mp4', 1);
    await n.enforceRetention();
    assert.ok(n.store.get(reference), 'the reference recording is kept');
    assert.equal(n.store.get(reference)?.info.deleteAfter, null, 'and carries no deletion date');
    assert.equal(n.store.get(ownUpload), undefined, 'another upload into the same source is not part of the seed');
    assert.equal(n.store.get(sameName), undefined, 'the same name in another source is not part of the seed');
    assert.ok((n.store.get(fresh)?.info.deleteAfter ?? 0) > Date.now(), 'a recent upload gets its deletion date');
  } finally {
    await dispose();
  }
});

test('without keepSeed the seed recordings follow the normal retention', { skip: config.retentionDays <= 0 }, async () => {
  const { node: n, dispose } = await node(false);
  try {
    const reference = register(n, 'referenz', 'datum-001.mp4', config.retentionDays + 5);
    await n.enforceRetention();
    assert.equal(n.store.get(reference), undefined);
  } finally {
    await dispose();
  }
});
