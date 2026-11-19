import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { repoRoot } from '../src/config.js';
import {
  GEOCLIP_DIM,
  GEOCLIP_IMAGE_SIZE,
  GEOCLIP_LOGIT_SCALE,
  GEOCLIP_MEAN,
  GEOCLIP_STD,
  GeoClip,
  aggregateScores,
  bestInCountry,
  clipResizeSize,
  cosines,
  countryDistribution,
  densityAt,
  float16ToFloat32,
  float32ToFloat16,
  halfGalleryCosines,
  halfRowScales,
  massWithin,
  meanEmbedding,
  meanEmbeddingNorm,
  modesOf,
  normaliseRows,
  preprocessImage,
  readEmbeddingCache,
  readHalfCache,
  softmax,
  supportOf,
  writeEmbeddingCache,
} from '../src/datum/geoclip.js';
import { World, greatCircleKm, type LonLat } from '../src/datum/world.js';

const run = promisify(execFile);

/** Deterministic pseudo-random numbers. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomRows(rows: number, dim: number, seed: number): Float32Array {
  const rand = rng(seed);
  const v = new Float32Array(rows * dim);
  for (let i = 0; i < v.length; i++) v[i] = rand() - 0.5;
  return normaliseRows(v, dim);
}

const box = (w: number, s: number, e: number, n: number): LonLat[] => [
  [w, s],
  [e, s],
  [e, n],
  [w, n],
  [w, s],
];

test('resize follows CLIPImageProcessor: shortest side 224, the other truncated', () => {
  assert.deepEqual(clipResizeSize(640, 360), { width: 398, height: 224 });
  assert.deepEqual(clipResizeSize(360, 640), { width: 224, height: 398 });
  assert.deepEqual(clipResizeSize(224, 224), { width: 224, height: 224 });
  assert.deepEqual(clipResizeSize(1000, 999), { width: 224, height: 224 });
});

test('preprocessing gives a 3 x 224 x 224 tensor, normalised per channel, centre-cropped', async () => {
  // Left half pure red, right half pure blue, 640 x 360: after the resize (398 x 224) the crop
  // keeps columns 87..310, so the left of the crop is red and the right is blue.
  const width = 640;
  const height = 360;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      if (x < width / 2) raw[o] = 255;
      else raw[o + 2] = 255;
    }
  }
  const png = await sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
  const t = await preprocessImage(png);
  const size = GEOCLIP_IMAGE_SIZE;
  const plane = size * size;
  assert.equal(t.length, 3 * plane);
  const at = (c: number, x: number, y: number): number => t[c * plane + y * size + x] as number;
  const norm = (c: number, v: number): number => (v / 255 - (GEOCLIP_MEAN[c] as number)) / (GEOCLIP_STD[c] as number);
  // Red on the left (x = 10), blue on the right (x = 210), away from the blurred edge at x = 112.
  assert.ok(Math.abs(at(0, 10, 100) - norm(0, 255)) < 1e-4);
  assert.ok(Math.abs(at(2, 10, 100) - norm(2, 0)) < 1e-4);
  assert.ok(Math.abs(at(0, 210, 100) - norm(0, 0)) < 1e-4);
  assert.ok(Math.abs(at(2, 210, 100) - norm(2, 255)) < 1e-4);
  // The edge between the halves sits where the centre crop puts it (column 199 - 87 = 112).
  let edge = -1;
  for (let x = 0; x < size - 1; x++) {
    if (at(0, x, 100) > 0 && at(0, x + 1, 100) <= 0) edge = x;
  }
  assert.ok(Math.abs(edge - 111) <= 1, `edge at column ${edge}`);
});

test('float16 conversion keeps embedding values to 1e-3 and rounds special values', () => {
  const values = Float32Array.from([0, 1, -1, 0.5, -0.25, 0.1234, 1e-5, 65504, 1e6, -1e6]);
  const back = float16ToFloat32(float32ToFloat16(values));
  for (let i = 0; i < 8; i++) {
    const v = values[i] as number;
    assert.ok(Math.abs((back[i] as number) - v) <= Math.max(1e-3 * Math.abs(v), 1e-7), `${v} -> ${back[i]}`);
  }
  assert.equal(back[8], Infinity);
  assert.equal(back[9], -Infinity);
});

test('gallery embedding cache: float16 round trip, wrong shapes are not read', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geoclip-cache-'));
  try {
    const rows = 37;
    const embeds = randomRows(rows, GEOCLIP_DIM, 3);
    const file = path.join(dir, 'g.f16');
    await writeEmbeddingCache(file, embeds, rows, GEOCLIP_DIM);
    assert.equal((await fs.stat(file)).size, 12 + rows * GEOCLIP_DIM * 2);
    const back = await readEmbeddingCache(file, rows, GEOCLIP_DIM);
    assert.ok(back);
    let maxDiff = 0;
    for (let i = 0; i < embeds.length; i++) maxDiff = Math.max(maxDiff, Math.abs((back[i] as number) - (embeds[i] as number)));
    assert.ok(maxDiff < 2e-4, `max difference ${maxDiff}`);
    assert.equal(await readEmbeddingCache(file, rows + 1, GEOCLIP_DIM), null);
    assert.equal(await readEmbeddingCache(path.join(dir, 'missing.f16'), rows, GEOCLIP_DIM), null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('float16 gallery: cosines bit for bit those of the normalised float32 copy', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geoclip-half-'));
  try {
    const rows = 300;
    const file = path.join(dir, 'g.f16');
    await writeEmbeddingCache(file, randomRows(rows, GEOCLIP_DIM, 5), rows, GEOCLIP_DIM);
    const half = await readHalfCache(file, rows, GEOCLIP_DIM);
    assert.ok(half);
    assert.equal(half.length, rows * GEOCLIP_DIM);
    assert.equal(await readHalfCache(file, rows - 1, GEOCLIP_DIM), null);
    // What the gallery held before: the decoded cache, normalised as float32.
    const full = normaliseRows((await readEmbeddingCache(file, rows, GEOCLIP_DIM)) as Float32Array, GEOCLIP_DIM);
    const gallery = { coords: new Float32Array(2 * rows), half, scale: halfRowScales(half, rows, GEOCLIP_DIM), size: rows };
    // Every frame count takes another mix of the passes of twelve, eight, four, two and one frames;
    // one frame alone decodes inside its sum.
    for (const frames of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 20, 23, 25]) {
      const images = randomRows(frames, GEOCLIP_DIM, 20 + frames);
      const expected = cosines(images, frames, full, rows, GEOCLIP_DIM);
      const got = halfGalleryCosines(images, frames, gallery, GEOCLIP_DIM);
      assert.equal(got.length, expected.length);
      for (let i = 0; i < got.length; i++) assert.ok(Object.is(got[i], expected[i]), `${frames} frames, value ${i}: ${got[i]} vs ${expected[i]}`);
      // And cosines() itself is still the plain sum over d, one frame at a time.
      for (let f = 0; f < frames; f++) {
        for (let g = 0; g < rows; g += 37) {
          let s = 0;
          for (let d = 0; d < GEOCLIP_DIM; d++) s += (images[f * GEOCLIP_DIM + d] as number) * (full[g * GEOCLIP_DIM + d] as number);
          assert.equal(expected[f * rows + g], Math.fround(s));
        }
      }
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('frame aggregations: sum and mean rank alike, embedding equals the mean row, mixture averages probabilities', () => {
  const dim = 16;
  const frames = 3;
  const n = 50;
  const images = randomRows(frames, dim, 11);
  const gallery = randomRows(n, dim, 12);
  const cos = cosines(images, frames, gallery, n, dim);
  const sum = aggregateScores(cos, frames, n, 'sum').scores;
  const mean = aggregateScores(cos, frames, n, 'mean').scores;
  for (let g = 0; g < n; g++) assert.ok(Math.abs((sum[g] as number) / frames - (mean[g] as number)) < 1e-9);
  // Summed logits = summed per-frame log-probabilities up to a constant: the same distribution.
  const pSum = softmax(sum);
  const logProbs = new Float64Array(n);
  for (let f = 0; f < frames; f++) {
    const row = new Float64Array(n);
    for (let g = 0; g < n; g++) row[g] = GEOCLIP_LOGIT_SCALE * (cos[f * n + g] as number);
    const p = softmax(row);
    for (let g = 0; g < n; g++) logProbs[g] = (logProbs[g] as number) + Math.log(p[g] as number);
  }
  const pLog = softmax(logProbs);
  for (let g = 0; g < n; g++) assert.ok(Math.abs((pSum[g] as number) - (pLog[g] as number)) < 1e-5);
  // 'embedding' = one softmax over the cosines of the renormalised mean embedding.
  const emb = aggregateScores(cos, frames, n, 'embedding', GEOCLIP_LOGIT_SCALE, undefined, meanEmbeddingNorm(images, frames, dim)).scores;
  const direct = cosines(meanEmbedding(images, frames, dim), 1, gallery, n, dim);
  for (let g = 0; g < n; g++) assert.ok(Math.abs((emb[g] as number) - GEOCLIP_LOGIT_SCALE * (direct[g] as number)) < 1e-4);
  // 'mixture' = mean of the per-frame softmax distributions.
  const mix = softmax(aggregateScores(cos, frames, n, 'mixture').scores);
  for (let g = 0; g < n; g++) {
    let m = 0;
    for (let f = 0; f < frames; f++) {
      const row = new Float64Array(n);
      for (let h = 0; h < n; h++) row[h] = GEOCLIP_LOGIT_SCALE * (cos[f * n + h] as number);
      m += (softmax(row)[g] as number) / frames;
    }
    assert.ok(Math.abs((mix[g] as number) - m) < 1e-6);
  }
});

test('modes, density and country distribution over a gallery', () => {
  const world = World.fromJson(
    [
      { iso: 'DE', name_de: 'Deutschland', name_en: 'Germany', continent: 'EU', centroid: [10, 51], areaKm2: 357000, bbox: [6, 47, 15, 55], polygons: [box(6, 47, 15, 55)] },
      { iso: 'FR', name_de: 'Frankreich', name_en: 'France', continent: 'EU', centroid: [2.5, 46.5], areaKm2: 550000, bbox: [-5, 42, 6, 51], polygons: [box(-5, 42, 6, 51)] },
    ],
    [],
  );
  // Three points near Paris (0.2 each), two near Berlin (0.15 each), one in the Atlantic (0.1).
  const coords = Float32Array.from([48.85, 2.35, 48.86, 2.3, 48.9, 2.4, 52.5, 13.4, 52.52, 13.38, 45, -30]);
  const probs = Float32Array.from([0.2, 0.2, 0.2, 0.15, 0.15, 0.1]);
  const support = supportOf(probs, 1);
  assert.equal(support.length, 6);
  const modes = modesOf(coords, probs, support, 25, 5);
  assert.equal(modes.length, 3);
  assert.ok(Math.abs((modes[0]?.p ?? 0) - 0.6) < 1e-6);
  assert.ok(greatCircleKm(modes[0]?.lat ?? 0, modes[0]?.lon ?? 0, 48.87, 2.35) < 5);
  assert.ok(Math.abs((modes[1]?.p ?? 0) - 0.3) < 1e-6);
  const pred = { coords, probs, support };
  assert.ok(densityAt(pred, 48.86, 2.35, 50) > densityAt(pred, 52.5, 13.4, 50));
  assert.ok(Math.abs(massWithin(pred, 52.51, 13.39, 10) - 0.3) < 1e-6);
  const isos = world.countries().map((c) => c.iso);
  const countryOf = Int16Array.from([1, 1, 1, 0, 0, -1]);
  const countries = countryDistribution(world, probs, countryOf, isos);
  assert.equal(countries[0]?.iso, 'FR');
  assert.ok(Math.abs((countries[0]?.p ?? 0) - 0.6 / 0.9) < 1e-6);
  const inDe = bestInCountry(pred, countryOf, isos, 'DE');
  assert.ok(inDe && greatCircleKm(inDe.lat, inDe.lon, 52.51, 13.39) < 5);
});

// ---- the real model (skipped when the weights are not downloaded)

const model = new GeoClip({ precision: 'int8' });
const clip = path.join(repoRoot, 'datasets', 'datum', 'clips', 'fr-eiffel-tower.mp4');
const missing = !(await model.available())
  ? `GeoCLIP-Gewichte fehlen unter ${model.modelDir} (onnx/vision_model_int8.onnx, onnx/location_model.onnx, gps_gallery/coordinates_100K.bin)`
  : !(await fs.access(clip).then(() => true, () => false))
    ? `Referenzclip fehlt: ${clip}`
    : null;

async function eiffelFrame(): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geoclip-frame-'));
  try {
    const out = path.join(dir, 'f.jpg');
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '5', '-i', clip, '-frames:v', '1', '-vf', "scale=w='min(640,iw)':h=-2:flags=bicubic", '-q:v', '3', out]);
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('a frame of the Eiffel Tower clip scores Paris above other cities', { skip: missing ?? false }, async () => {
  const frame = await eiffelFrame();
  const image = await model.embedImages([frame]);
  assert.equal(image.length, GEOCLIP_DIM);
  const cities = { Paris: [48.8583, 2.2945], Berlin: [52.52, 13.405], NewYork: [40.7128, -74.006], Tokyo: [35.6762, 139.6503], Sydney: [-33.8688, 151.2093], Rio: [-22.9068, -43.1729], Cairo: [30.0444, 31.2357] } as const;
  const names = Object.keys(cities) as (keyof typeof cities)[];
  const loc = await model.embedLocations(Float32Array.from(names.flatMap((n) => [...cities[n]])));
  const scores = cosines(image, 1, loc, names.length, GEOCLIP_DIM);
  const best = names[scores.indexOf(Math.max(...scores))];
  assert.equal(best, 'Paris');
});

test('the full prediction places the Eiffel Tower frame in France', { skip: missing ?? false }, async (t) => {
  const cache = await model.galleryCacheFile();
  if (!(await fs.access(cache).then(() => true, () => false))) {
    t.skip(`Galerie-Einbettungen noch nicht berechnet (${cache}); pnpm datum:geoclip legt sie an`);
    return;
  }
  const world = await World.load();
  const pred = await model.predict([await eiffelFrame()], { world });
  assert.equal(pred.countries[0]?.iso, 'FR');
  const km = greatCircleKm(pred.best.lat, pred.best.lon, 48.858296, 2.294479);
  assert.ok(km < 25, `${km.toFixed(1)} km from the Eiffel Tower`);
  await model.release();
});
