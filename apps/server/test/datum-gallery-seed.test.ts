import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { decodeHalf, encodeHalf, fromHalf, readSeed, seedFiles, toHalf, writeSeed } from '../src/datum/gallerySeed.js';

test('half floats: exact values, rounding, limits', () => {
  for (const v of [0, 1, -1, 0.5, 2, 1024, -0.25, 65504]) assert.equal(fromHalf(toHalf(v)), v, String(v));
  assert.equal(toHalf(0), 0);
  assert.equal(toHalf(-0), 0x8000);
  assert.equal(fromHalf(toHalf(1e6)), Infinity);
  assert.equal(fromHalf(toHalf(-1e6)), -Infinity);
  assert.ok(Number.isNaN(fromHalf(toHalf(Number.NaN))));
  // Smallest subnormal and below.
  assert.equal(fromHalf(toHalf(2 ** -24)), 2 ** -24);
  assert.equal(fromHalf(toHalf(2 ** -26)), 0);
  // Relative error of normal numbers stays within half an ulp (2^-11).
  for (let i = 0; i < 2000; i++) {
    const v = (Math.random() * 2 - 1) * 10 ** (Math.random() * 6 - 3);
    const back = fromHalf(toHalf(v));
    assert.ok(Math.abs(back - v) <= Math.abs(v) * 2 ** -11 + 2 ** -25, `${v} -> ${back}`);
  }
});

test('cosine similarities of unit rows survive half precision', () => {
  const dim = 768;
  const unit = (seed: number): Float32Array => {
    const v = new Float32Array(dim);
    let s = seed;
    let norm = 0;
    for (let i = 0; i < dim; i++) {
      s = (s * 1103515245 + 12345) % 2147483648;
      v[i] = s / 2147483648 - 0.5;
      norm += (v[i] as number) ** 2;
    }
    norm = Math.sqrt(norm);
    for (let i = 0; i < dim; i++) v[i] = (v[i] as number) / norm;
    return v;
  };
  const dot = (a: Float32Array, b: Float32Array): number => a.reduce((acc, x, i) => acc + x * (b[i] as number), 0);
  for (let k = 1; k < 20; k++) {
    const a = unit(k);
    const b = unit(k * 7 + 3);
    const a2 = decodeHalf(encodeHalf(a));
    const b2 = decodeHalf(encodeHalf(b));
    assert.ok(Math.abs(dot(a, b) - dot(a2, b2)) < 5e-4, `pair ${k}`);
    assert.ok(Math.abs(dot(a2, a2) - 1) < 5e-4, `norm ${k}`);
  }
});

test('a written seed reads back for the same model and is ignored for another', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-seed-'));
  try {
    const dim = 4;
    const vectors = Float32Array.from([1, 0, 0, 0, 0, 0.6, 0.8, 0, 0.5, 0.5, 0.5, 0.5]);
    await writeSeed(dir, 'org/model-a', dim, ['Q1', 'Q2', 'Q3'], ['gallery/Q1.jpg:10', 'gallery/Q2.jpg:20', 'gallery/Q3.jpg:30'], vectors);
    const rows = await readSeed(dir, 'org/model-a', dim);
    assert.equal(rows.size, 3);
    assert.equal(rows.get('Q2')?.source, 'gallery/Q2.jpg:20');
    assert.deepEqual([...(rows.get('Q2')?.row ?? [])].map((v) => Math.round(v * 1000) / 1000), [0, 0.6, 0.8, 0]);
    assert.equal((await readSeed(dir, 'org/model-b', dim)).size, 0);
    assert.equal((await readSeed(dir, 'org/model-a', 8)).size, 0);
    // A truncated vector file is not used.
    const files = seedFiles(dir, 'org/model-a');
    await fs.truncate(files.bin, 10);
    assert.equal((await readSeed(dir, 'org/model-a', dim)).size, 0);
    await assert.rejects(writeSeed(dir, 'org/model-a', dim, ['Q1'], [], vectors));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
