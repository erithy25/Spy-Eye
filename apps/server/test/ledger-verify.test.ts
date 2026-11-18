import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Ledger } from '../src/core/ledger.js';

/**
 * The two stand-alone verifiers in tools/pruefen share no code with the ledger. These tests hold
 * them to it: what the ledger writes they must accept, and what was changed they must name.
 */

const tools = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'tools', 'pruefen');
const nodeVerifier = path.join(tools, 'ledger-verify.mjs');
const pythonVerifier = path.join(tools, 'ledger_verify.py');

/** The Python interpreter of this machine, if it has one. */
const python = ['python3', 'python'].find((name) => {
  const probe = spawnSync(name, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)'], { encoding: 'utf8' });
  return probe.status === 0;
});

interface Run {
  status: number | null;
  out: string;
}

function runNode(args: string[]): Run {
  const result = spawnSync(process.execPath, [nodeVerifier, ...args], { encoding: 'utf8' });
  return { status: result.status, out: result.stdout + result.stderr };
}

function runPython(args: string[]): Run {
  const result = spawnSync(python as string, [pythonVerifier, ...args], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  return { status: result.status, out: result.stdout + result.stderr };
}

/** Both verifiers where Python exists, otherwise the Node one alone. */
const verifiers: [string, (args: string[]) => Run][] = python ? [['node', runNode], ['python', runPython]] : [['node', runNode]];

/** Content that separates a careful canonical form from a careless one. */
const awkward: Record<string, unknown>[] = [
  { query: 'überflutete Wiese', results: 4, share: 0.1 },
  { query: 'Rauch "über" Gebäuden \\ Straße', tab: 'a\tb', line: 'a\nb', bell: '\u0007', del: '\u007f' },
  { emoji: 'Lage 🛰️', separator: 'a b', loneSurrogate: 'x\ud800y', nested: { z: 1, a: [true, false, null, { b: 2, a: 1 }] } },
  { tiny: 1e-7, huge: 1e21, wide: 123456789012345680000, negative: -12.5, zero: -0, score: 0.12379999458789825 },
  { ä: 1, z: 2, Z: 3, '😀': 4, '￿': 5, '': 6, 'a b': 7 },
  { empty: {}, list: [], text: '' },
];

async function writeLedger(): Promise<{ file: string; heads: string[] }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sicht-verify-'));
  const file = path.join(dir, 'ledger.jsonl');
  const ledger = new Ledger(file);
  await ledger.open();
  const heads: string[] = [];
  for (const [i, data] of awkward.entries()) {
    const entry = await ledger.append({
      actor: i % 2 === 0 ? 'leitung' : 'node:trier',
      role: 'supervisor',
      mandateId: i === 0 ? null : 'md_übung',
      action: 'search.query',
      summary: `Suche „${i}“`,
      data,
    });
    heads.push(entry.hash);
  }
  return { file, heads };
}

test('the stand-alone verifiers accept what the ledger writes, awkward content included', async () => {
  const { file, heads } = await writeLedger();
  const head = heads.at(-1) as string;
  for (const [name, run] of verifiers) {
    const result = run([file]);
    assert.equal(result.status, 0, `${name}: ${result.out}`);
    assert.match(result.out, new RegExp(`Kette unversehrt: ${awkward.length} Einträge\\.`), name);
    assert.match(result.out, new RegExp(`Letzter Stand: ${head}`), name);
  }
});

test('a witnessed head is found as the last or as an earlier state, and a foreign one is not', async () => {
  const { file, heads } = await writeLedger();
  for (const [name, run] of verifiers) {
    const last = run([file, '--head', heads.at(-1) as string]);
    assert.equal(last.status, 0, `${name}: ${last.out}`);
    assert.match(last.out, /ist der letzte Stand/, name);

    const earlier = run([file, '--head', (heads[1] as string).slice(0, 12)]);
    assert.equal(earlier.status, 0, `${name}: ${earlier.out}`);
    assert.match(earlier.out, /ist ein früherer Stand/, name);

    const foreign = run([file, '--head', 'ab'.repeat(32)]);
    assert.equal(foreign.status, 1, `${name}: ${foreign.out}`);
    assert.match(foreign.out, /kommt in dieser Kette NICHT vor/, name);
  }
});

test('a changed, a removed and a reordered entry are each named', async () => {
  const { file } = await writeLedger();
  const lines = (await fs.readFile(file, 'utf8')).split('\n').filter((line) => line !== '');

  const changed = file.replace('ledger.jsonl', 'changed.jsonl');
  await fs.writeFile(changed, `${lines.map((line, i) => (i === 2 ? line.replace('Lage', 'Luge') : line)).join('\n')}\n`);
  const removed = file.replace('ledger.jsonl', 'removed.jsonl');
  await fs.writeFile(removed, `${lines.filter((_line, i) => i !== 1).join('\n')}\n`);
  const reordered = file.replace('ledger.jsonl', 'reordered.jsonl');
  await fs.writeFile(reordered, `${[lines[0], lines[1], lines[3], lines[2], lines[4], lines[5]].join('\n')}\n`);
  const truncated = file.replace('ledger.jsonl', 'truncated.jsonl');
  await fs.writeFile(truncated, `${lines.slice(0, 4).join('\n')}\n`);

  for (const [name, run] of verifiers) {
    const a = run([changed]);
    assert.equal(a.status, 1, `${name}: ${a.out}`);
    assert.match(a.out, /GEBROCHEN bei Eintrag 3: Inhalt passt nicht zur Prüfsumme/, name);
    assert.match(a.out, /Unversehrt bis einschließlich Eintrag 2/, name);

    const b = run([removed]);
    assert.equal(b.status, 1, `${name}: ${b.out}`);
    assert.match(b.out, /GEBROCHEN bei Eintrag 2: Sequenznummer 3 statt 2/, name);

    const c = run([reordered]);
    assert.equal(c.status, 1, `${name}: ${c.out}`);
    assert.match(c.out, /GEBROCHEN bei Eintrag 3/, name);

    // A file cut off at the end is consistent in itself; only a witnessed head shows the loss.
    const d = run([truncated]);
    assert.equal(d.status, 0, `${name}: ${d.out}`);
    assert.match(d.out, /Kette unversehrt: 4 Einträge/, name);
  }
});

test('a missing file and a wrong call end with their own exit code', () => {
  for (const [name, run] of verifiers) {
    assert.equal(run([path.join(os.tmpdir(), 'sicht-there-is-no-such-ledger.jsonl')]).status, 2, name);
    assert.equal(run([]).status, 2, name);
    assert.equal(run(['a.jsonl', '--head', 'xyz']).status, 2, name);
  }
});
