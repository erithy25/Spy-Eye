import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import v8 from 'node:v8';
import vm from 'node:vm';
import { withoutModelFileReads } from '../src/ml/modelFileReads.js';

test('a load ends the read streams it left running, keeps what it read, and restores fs', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'model-file-reads-'));
  try {
    const file = path.join(dir, 'model.onnx');
    // Larger than one chunk, so that a stream that was left alone would still be reading.
    await fs.promises.writeFile(file, Buffer.alloc(4 * 1024 * 1024, 7));
    const original = fs.createReadStream;
    let left: fs.ReadStream | null = null;
    const value = await withoutModelFileReads(async () => {
      // As transformers.js does: one stream read to the end, one opened and left running.
      const used = fs.createReadStream(file);
      let bytes = 0;
      for await (const chunk of used) bytes += (chunk as Buffer).length;
      left = fs.createReadStream(file);
      left.on('data', () => undefined);
      return bytes;
    });
    assert.equal(value, 4 * 1024 * 1024);
    assert.equal(fs.createReadStream, original);
    assert.ok(left);
    assert.equal((left as fs.ReadStream).destroyed, true);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test('a failed load ends its streams too and passes the error on', async () => {
  const original = fs.createReadStream;
  let left: fs.ReadStream | null = null;
  await assert.rejects(
    withoutModelFileReads(async () => {
      left = fs.createReadStream(fileURLToPath(import.meta.url));
      left.on('data', () => undefined);
      throw new Error('load failed');
    }),
    /load failed/,
  );
  assert.equal(fs.createReadStream, original);
  assert.equal((left as fs.ReadStream | null)?.destroyed, true);
});

/** Reads the file to the end as transformers.js's FileResponse does (its listener keeps every chunk). */
async function readToTheEnd(file: string): Promise<WeakRef<fs.ReadStream>> {
  const chunks: Buffer[] = [];
  const stream = fs.createReadStream(file);
  stream.on('data', (chunk) => chunks.push(chunk as Buffer));
  await once(stream, 'close');
  return new WeakRef(stream);
}

test('a stream read to the end is let go while the load goes on', async () => {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc') as () => void;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'model-file-reads-'));
  try {
    const file = path.join(dir, 'text_model.onnx');
    await fs.promises.writeFile(file, Buffer.alloc(1024 * 1024, 7));
    let collected = false;
    await withoutModelFileReads(async () => {
      // As on a first start: one file read to the end, then the load goes on (the next download).
      const read = await readToTheEnd(file);
      for (let i = 0; i < 10 && read.deref(); i++) {
        await new Promise((resolve) => setImmediate(resolve));
        gc();
      }
      collected = read.deref() === undefined;
    });
    assert.ok(collected, 'the closed stream, and with it every chunk it read, stayed reachable until the load ended');
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});
