import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { freeBytes } from '../src/core/disk.js';

test('free space of an existing directory is a number of bytes', async () => {
  const free = await freeBytes(os.tmpdir());
  assert.ok(free !== null && Number.isFinite(free) && free >= 0, String(free));
});

test('free space of a directory that does not exist is unknown, not zero', async () => {
  assert.equal(await freeBytes(path.join(os.tmpdir(), 'sicht-gibt-es-nicht', 'x')), null);
});
