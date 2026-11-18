import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { restorePreparedState, snapshotPreparedState } from '../src/scripts/prepared.ts';

async function write(file: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

test('a rehearsal is undone: state files return, later recordings go, analysed footage stays', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sicht-prepared-'));
  try {
    await write(path.join(dir, 'ledger.jsonl'), 'eins\n');
    await write(path.join(dir, 'watches.json'), '[{"id":"w","version":1}]');
    await write(path.join(dir, 'cases', '.keep'), '');
    await write(path.join(dir, 'videos', 'aaaa', 'meta.json'), '{"analysed":true}');
    await snapshotPreparedState(dir);

    // What a rehearsal leaves behind.
    await fs.appendFile(path.join(dir, 'ledger.jsonl'), 'zwei\ndrei\n');
    await write(path.join(dir, 'watches.json'), '[{"id":"w","version":2}]');
    await write(path.join(dir, 'cases', 'vg_1.json'), '{"sealed":true}');
    await write(path.join(dir, 'alerts.json'), '[1,2,3]');
    await write(path.join(dir, 'videos', 'bbbb', 'meta.json'), '{"uploaded":"during rehearsal"}');

    const result = await restorePreparedState(dir);
    assert.ok(result);
    assert.equal(result.recordings, 1);
    assert.equal(result.removedRecordings, 1);
    assert.equal(await fs.readFile(path.join(dir, 'ledger.jsonl'), 'utf8'), 'eins\n');
    assert.equal(await fs.readFile(path.join(dir, 'watches.json'), 'utf8'), '[{"id":"w","version":1}]');
    assert.deepEqual(await fs.readdir(path.join(dir, 'cases')), ['.keep']);
    await assert.rejects(fs.access(path.join(dir, 'alerts.json')));
    assert.deepEqual(await fs.readdir(path.join(dir, 'videos')), ['aaaa']);
    assert.equal(await fs.readFile(path.join(dir, 'videos', 'aaaa', 'meta.json'), 'utf8'), '{"analysed":true}');

    // Restoring twice gives the same state: the snapshot itself is not consumed.
    const again = await restorePreparedState(dir);
    assert.equal(again?.removedRecordings, 0);
    assert.equal(await fs.readFile(path.join(dir, 'ledger.jsonl'), 'utf8'), 'eins\n');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a node that was never prepared is left alone', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sicht-prepared-'));
  try {
    await write(path.join(dir, 'ledger.jsonl'), 'eins\n');
    assert.equal(await restorePreparedState(dir), null);
    assert.equal(await fs.readFile(path.join(dir, 'ledger.jsonl'), 'utf8'), 'eins\n');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
