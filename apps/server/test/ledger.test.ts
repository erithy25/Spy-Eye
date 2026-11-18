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

test('line separators inside a text neither split an entry nor change its hash', async () => {
  const file = await tempFile();
  const ledger = new Ledger(file);
  await ledger.open();
  const awkward = 'vor nach ende\rund\nzeile';
  const written = await ledger.append({ ...entry(1), actor: awkward, summary: awkward, data: { query: awkward } });
  await ledger.append(entry(2));

  const text = await fs.readFile(file, 'utf8');
  assert.equal(text.includes(' ') || text.includes(' '), false, 'the separators are written as escapes');
  assert.equal(text.split('\n').filter((line) => line !== '').length, 2);

  const reopened = new Ledger(file);
  await reopened.open();
  assert.equal(reopened.length, 2);
  const read = reopened.list({ limit: 10 }).find((e) => e.seq === 1);
  assert.equal(read?.summary, awkward);
  assert.equal(read?.hash, written.hash);
  assert.equal((await reopened.verify()).ok, true);
});

test('a file written with the separators left raw is still read as one entry per line', async () => {
  const file = await tempFile();
  const first = new Ledger(file);
  await first.open();
  const written = await first.append({ ...entry(1), summary: 'a b' });
  // As earlier versions wrote it: the separator unescaped inside the line.
  await fs.writeFile(file, `${JSON.stringify(written)}\n`);
  assert.equal((await fs.readFile(file, 'utf8')).includes(' '), true);

  const reopened = new Ledger(file);
  await reopened.open();
  assert.equal(reopened.length, 1);
  assert.equal(reopened.headHash, written.hash);
});

test('verification notices a file that was cut off or exchanged while the node runs', async () => {
  const file = await tempFile();
  const ledger = new Ledger(file);
  await ledger.open();
  for (const i of [1, 2, 3]) await ledger.append(entry(i));
  assert.equal((await ledger.verify()).ok, true);

  const lines = (await fs.readFile(file, 'utf8')).split('\n').filter((line) => line !== '');
  await fs.writeFile(file, `${lines.slice(0, 2).join('\n')}\n`);
  const cut = await ledger.verify();
  assert.equal(cut.ok, false);
  assert.equal(cut.brokenAt, 3);
  assert.match(cut.reason ?? '', /endet bei Eintrag 2, der Knoten hält Eintrag 3/);

  // Another chain of the same length, consistent in itself.
  const otherFile = await tempFile();
  const other = new Ledger(otherFile);
  await other.open();
  for (const i of [7, 8, 9]) await other.append(entry(i));
  await fs.copyFile(otherFile, file);
  const exchanged = await ledger.verify();
  assert.equal(exchanged.ok, false);
});

test('appending and verifying at the same time neither forks the chain nor reports a false break', async () => {
  const file = await tempFile();
  const ledger = new Ledger(file);
  await ledger.open();
  const work: Promise<unknown>[] = [];
  for (let i = 0; i < 40; i++) {
    work.push(ledger.append(entry(i)));
    if (i % 5 === 0) work.push(ledger.verify().then((result) => assert.equal(result.ok, true)));
  }
  await Promise.all(work);
  const final = await ledger.verify();
  assert.deepEqual([final.ok, final.entries], [true, 40]);
});

test('the oversight sample is drawn from the whole file, not only from recent entries', async () => {
  const file = await tempFile();
  const ledger = new Ledger(file);
  await ledger.open();
  // More entries than the ledger keeps in memory, with the queries at the very beginning.
  for (let i = 0; i < 6; i++) await ledger.append({ ...entry(i), action: 'search.query' });
  for (let i = 0; i < 4200; i++) await ledger.append({ ...entry(i), action: 'alert.raise', actor: 'system' });
  assert.equal(ledger.list({ limit: 5000, action: 'search.query' }).length, 0, 'the early queries have left the window in memory');

  const all = await ledger.sample((e) => e.action === 'search.query', 10);
  assert.equal(all.population, 6);
  assert.deepEqual(all.entries.map((e) => e.seq), [6, 5, 4, 3, 2, 1]);

  // A sample smaller than the population: the right size, distinct entries, every entry reachable.
  const seen = new Set<number>();
  for (let round = 0; round < 60; round++) {
    const some = await ledger.sample((e) => e.action === 'search.query', 2);
    assert.equal(some.population, 6);
    assert.equal(some.entries.length, 2);
    assert.notEqual(some.entries[0]?.seq, some.entries[1]?.seq);
    for (const e of some.entries) seen.add(e.seq);
  }
  assert.equal(seen.size, 6);

  const none = await ledger.sample((e) => e.action === 'no.such.action', 5);
  assert.deepEqual(none, { population: 0, entries: [] });
});
