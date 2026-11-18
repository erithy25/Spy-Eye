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

test('the operator\'s Mapillary key and street-level setting are never snapshotted and survive a restore', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sicht-prepared-'));
  const key = path.join(dir, 'datum', 'mapillary-key');
  const settings = path.join(dir, 'datum', 'settings.json');
  try {
    await write(path.join(dir, 'ledger.jsonl'), 'eins\n');
    await write(path.join(dir, 'datum', 'truth.json'), '{"truths":1}');
    await write(key, 'MLY|1|first-key-SECRET\n');
    await write(settings, '{"version":1,"streetLevel":{"enabled":true}}');
    await snapshotPreparedState(dir);
    // No second copy of the secret, and the setting is the operator's, not the demonstration's.
    await assert.rejects(fs.access(path.join(dir, '.prepared', 'state', 'datum', 'mapillary-key')));
    await assert.rejects(fs.access(path.join(dir, '.prepared', 'state', 'datum', 'settings.json')));
    assert.equal(await fs.readFile(path.join(dir, '.prepared', 'state', 'datum', 'truth.json'), 'utf8'), '{"truths":1}');

    // The supervisor removes the key and switches the comparison off; a rehearsal changes truths.
    await fs.rm(key);
    await write(settings, '{"version":1,"streetLevel":{"enabled":false}}');
    await write(path.join(dir, 'datum', 'truth.json'), '{"truths":2}');
    await write(path.join(dir, 'datum', 'extra.json'), '{}');
    assert.ok(await restorePreparedState(dir));
    await assert.rejects(fs.access(key), 'a removed key does not come back');
    assert.equal(await fs.readFile(settings, 'utf8'), '{"version":1,"streetLevel":{"enabled":false}}');
    assert.equal(await fs.readFile(path.join(dir, 'datum', 'truth.json'), 'utf8'), '{"truths":1}');
    await assert.rejects(fs.access(path.join(dir, 'datum', 'extra.json')));

    // A key stored after the preparation is kept by a restore.
    await write(key, 'MLY|2|later-key-SECRET\n');
    assert.ok(await restorePreparedState(dir));
    assert.equal(await fs.readFile(key, 'utf8'), 'MLY|2|later-key-SECRET\n');

    // A snapshot of an earlier version that holds a copy: it is not restored, and it is deleted.
    await write(path.join(dir, '.prepared', 'state', 'datum', 'mapillary-key'), 'MLY|0|old-copy-SECRET\n');
    assert.ok(await restorePreparedState(dir));
    assert.equal(await fs.readFile(key, 'utf8'), 'MLY|2|later-key-SECRET\n');
    await assert.rejects(fs.access(path.join(dir, '.prepared', 'state', 'datum', 'mapillary-key')));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
