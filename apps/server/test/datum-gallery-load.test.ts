import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { Gallery, type ImageEmbedder } from '../src/datum/gallery.js';
import { writeSeed } from '../src/datum/gallerySeed.js';

/** Stand-in for the image tower: every picture becomes the same unit row; counts the pictures. */
class CountingEmbedder implements ImageEmbedder {
  readonly imageSize = 8;
  readonly imageMean: [number, number, number] = [0.5, 0.5, 0.5];
  readonly imageStd: [number, number, number] = [0.5, 0.5, 0.5];
  readonly dim = 4;
  embedded = 0;
  async embedPixels(_pixels: Float32Array, count: number): Promise<Float32Array> {
    this.embedded += count;
    const out = new Float32Array(count * this.dim);
    for (let i = 0; i < count; i++) out.set([0, 0, 0, 1], i * this.dim);
    return out;
  }
}

test('shipped gallery vectors spare the embedding and cover pictures that are not on disk', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-gallery-'));
  const datasetDir = path.join(root, 'dataset');
  const cacheDir = path.join(root, 'cache');
  try {
    await fs.mkdir(path.join(datasetDir, 'gallery'), { recursive: true });
    const jpeg = await sharp({ create: { width: 16, height: 12, channels: 3, background: { r: 90, g: 120, b: 160 } } }).jpeg().toBuffer();
    await fs.writeFile(path.join(datasetDir, 'gallery', 'Q1.jpg'), jpeg);
    await fs.writeFile(path.join(datasetDir, 'gallery', 'Q3.jpg'), jpeg);
    const image = (id: string, lat: number) => ({ id, file: `gallery/${id}.jpg`, label: id, lat, lon: 7, country: 'DE', wikidata: id });
    await fs.writeFile(path.join(datasetDir, 'gallery.json'), JSON.stringify({ images: [image('Q1', 50), image('Q2', 51), image('Q3', 52)] }));
    // Shipped rows for Q1 (on disk, same bytes) and Q2 (not downloaded); none for Q3.
    await writeSeed(
      datasetDir,
      'test/model',
      4,
      ['Q1', 'Q2'],
      [`gallery/Q1.jpg:${jpeg.byteLength}`, 'gallery/Q2.jpg:999'],
      Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0]),
    );

    const model = new CountingEmbedder();
    const gallery = new Gallery(model, { datasetDir, cacheDir, modelId: 'test/model', batchSize: 4, decodeConcurrency: 2 });
    const report = await gallery.load();
    assert.equal(report.images, 3);
    assert.equal(report.embedded, 1, 'only the picture without a shipped row is embedded');
    assert.equal(model.embedded, 1);
    assert.deepEqual([...(gallery.vector('Q1') ?? [])], [1, 0, 0, 0]);
    assert.deepEqual([...(gallery.vector('Q2') ?? [])], [0, 1, 0, 0]);
    assert.deepEqual([...(gallery.vector('Q3') ?? [])], [0, 0, 0, 1]);
    const hits = gallery.search(Float32Array.from([0, 1, 0, 0]), 1);
    assert.equal(hits[0]?.[0]?.id, 'Q2', 'a place known only from the shipped vectors is found');

    // The local cache now holds everything: a restart embeds nothing.
    const again = new Gallery(model, { datasetDir, cacheDir, modelId: 'test/model' });
    const second = await again.load();
    assert.equal(second.images, 3);
    assert.equal(second.embedded, 0);
    assert.equal(model.embedded, 1);

    // A picture replaced on disk (other size) is embedded again instead of taking the shipped row.
    await fs.rm(cacheDir, { recursive: true, force: true });
    await fs.writeFile(path.join(datasetDir, 'gallery', 'Q1.jpg'), Buffer.concat([jpeg, Buffer.alloc(10)]));
    const third = await new Gallery(model, { datasetDir, cacheDir, modelId: 'test/model' }).load();
    assert.equal(third.embedded, 2, 'Q1 (replaced) and Q3 (no shipped row)');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
