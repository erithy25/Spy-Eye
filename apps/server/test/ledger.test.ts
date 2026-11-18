import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { GENESIS_HASH, Ledger, canonical } from '../src/core/ledger.js';

async function tempFile(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sicht-ledger-'));
  return path.join(dir, 'ledger.jsonl');
}

const entry = (i: number) => ({
  actor: 'lage',
  role: 'operator',
  mandateId: 'md_test',
  action: 'search.query',
  summary: `Suche ${i}`,
  data: { query: `q${i}`, results: i },
});

test('canonical JSON is independent of key order', () => {
  assert.equal(canonical({ b: 1, a: [2, { d: 4, c: 3 }] }), canonical({ a: [2, { c: 3, d: 4 }], b: 1 }));
});

test('entries chain, survive a restart and verify', async () => {
  const file = await tempFile();
  const ledger = new Ledger(file);
  await ledger.open();
  assert.equal(ledger.headHash, GENESIS_HASH);
  await Promise.all([0, 1, 2, 3, 4].map((i) => ledger.append(entry(i))));
  assert.equal(ledger.length, 5);
  const head = ledger.headHash;

  const reopened = new Ledger(file);
  await reopened.open();
  assert.equal(reopened.headHash, head);
  assert.equal(reopened.length, 5);
  const result = await reopened.verify();
  assert.deepEqual([result.ok, result.entries, result.head], [true, 5, head]);
  assert.equal(reopened.list({ limit: 2 })[0]?.seq, 5);
});

test('editing a past entry is detected at that entry', async () => {
  const file = await tempFile();
  const ledger = new Ledger(file);
  await ledger.open();
  for (let i = 0; i < 6; i++) await ledger.append(entry(i));
  const lines = (await fs.readFile(file, 'utf8')).trim().split('\n');
  lines[2] = (lines[2] as string).replace('"q2"', '"something else"');
  await fs.writeFile(file, `${lines.join('\n')}\n`);
  const result = await ledger.verify();
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, 3);
});

test('removing an entry is detected', async () => {
  const file = await tempFile();
  const ledger = new Ledger(file);
  await ledger.open();
  for (let i = 0; i < 4; i++) await ledger.append(entry(i));
  const lines = (await fs.readFile(file, 'utf8')).trim().split('\n');
  lines.splice(1, 1);
  await fs.writeFile(file, `${lines.join('\n')}\n`);
  const result = await ledger.verify();
  assert.equal(result.ok, false);
  assert.equal(result.brokenAt, 2);
});
