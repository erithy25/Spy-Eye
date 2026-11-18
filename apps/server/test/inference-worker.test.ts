import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import sharp from 'sharp';
import { config, repoRoot } from '../src/config.js';
import type { CheckInfo, CheckOps, CheckOptions } from '../src/ml/checkService.js';
import { InferenceThread, closeInferenceThreads } from '../src/ml/workerHost.js';

/**
 * Inference runs in worker threads (src/ml/workerHost.ts). The first tests check the machinery
 * with a service that has no model; the last ones load the real models twice, once in a thread and
 * once on this thread, and require the same numbers from both.
 */

after(() => closeInferenceThreads());

type CheckThread = InferenceThread<CheckOps, CheckOptions, CheckInfo>;

function checkThread(failInit: string | null = null, onReady?: (info: CheckInfo, restart: boolean) => void): CheckThread {
  return new InferenceThread<CheckOps, CheckOptions, CheckInfo>({
    name: 'Prüfdienst',
    service: 'check',
    options: { failInit },
    ...(onReady ? { onReady } : {}),
  });
}

test('a call moves its input to the thread and its result back', async () => {
  const thread = checkThread();
  await thread.start();
  const values = Float32Array.from([1, 2.5, -3]);
  const out = await thread.call('double', { values }, { transfer: [values.buffer] });
  assert.deepEqual(Array.from(out), [2, 5, -6]);
  // Moved, not copied: the caller's array is detached.
  assert.equal(values.length, 0);
  await thread.close();
});

test('an error in a call arrives as a rejection with its message; the thread carries on', async () => {
  const thread = checkThread();
  await thread.start();
  await assert.rejects(thread.call('fail', { message: 'Bild-Encoder liefert ungültige Werte' }), {
    message: 'Bild-Encoder liefert ungültige Werte',
  });
  const out = await thread.call('double', { values: Float32Array.from([4]) });
  assert.deepEqual(Array.from(out), [8]);
  await thread.close();
});

test('a failing init rejects start, and later calls', async () => {
  const thread = checkThread('Gewichte fehlen');
  await assert.rejects(thread.start(), { message: 'Gewichte fehlen' });
  assert.equal(thread.usable, false);
  await assert.rejects(thread.call('double', { values: Float32Array.from([1]) }), { message: 'Gewichte fehlen' });
  await thread.close();
});

test('a dead thread fails its call and is restarted once; a second death without a completed call is final', async () => {
  const starts: { threadId: number; restart: boolean }[] = [];
  let gaveUp: Error | null = null;
  const thread = new InferenceThread<CheckOps, CheckOptions, CheckInfo>({
    name: 'Prüfdienst',
    service: 'check',
    options: { failInit: null },
    onReady: (info, restart) => starts.push({ threadId: info.threadId, restart }),
    onGiveUp: (error) => (gaveUp = error),
  });
  await thread.start();
  // Calls queued behind the crash run in the restarted thread.
  const crashed = thread.call('crash', null);
  const queued = thread.call('double', { values: Float32Array.from([21]) });
  await assert.rejects(crashed, /ausgefallen/);
  assert.deepEqual(Array.from(await queued), [42]);
  assert.equal(starts.length, 2);
  assert.equal(starts[1]?.restart, true);
  assert.notEqual(starts[0]?.threadId, starts[1]?.threadId);

  // The completed call restored the restart: one more crash is survived …
  await assert.rejects(thread.call('crash', null), /ausgefallen/);
  assert.equal((await thread.call('block', { ms: 1, tag: 'x' })).tag, 'x');
  assert.equal(starts.length, 3);
  // … but a crash right after a restart, before any call completed, ends the model.
  await assert.rejects(thread.call('crash', null), /ausgefallen/);
  await assert.rejects(thread.call('crash', null), /ausgefallen/);
  await assert.rejects(thread.call('double', { values: Float32Array.from([1]) }), /erneut ausgefallen/);
  assert.equal(thread.usable, false);
  assert.match((gaveUp as Error | null)?.message ?? '', /erneut ausgefallen/);
  await thread.close();
});

test('the main thread keeps running while a thread computes', async () => {
  const thread = checkThread();
  await thread.start();
  let last = performance.now();
  let worst = 0;
  const tick = setInterval(() => {
    const now = performance.now();
    worst = Math.max(worst, now - last);
    last = now;
  }, 5);
  // 600 ms of a blocked thread, as a long session run.
  await thread.call('block', { ms: 600, tag: 'long' });
  clearInterval(tick);
  // The run blocks its thread for 600 ms; on the main thread this would be a 600 ms stall. The bound
  // leaves room for a busy machine that deschedules this process for a moment.
  assert.ok(worst < 300, `event loop stalled for ${worst.toFixed(0)} ms`);
  await thread.close();
});

test('runs of different threads never overlap; a waiting text query goes first', async () => {
  const a = checkThread();
  const b = checkThread();
  await Promise.all([a.start(), b.start()]);
  const done: { tag: string; start: number; end: number }[] = [];
  const record = (p: Promise<{ tag: string; start: number; end: number }>): Promise<void> => p.then((r) => void done.push(r));
  await Promise.all([
    record(a.call('block', { ms: 120, tag: 'a1' })),
    record(b.call('block', { ms: 30, tag: 'b1' })),
    record(a.call('block', { ms: 30, tag: 'a2' })),
    record(b.call('block', { ms: 10, tag: 'query' }, { lane: 'interactive' })),
  ]);
  done.sort((x, y) => x.start - y.start);
  assert.deepEqual(
    done.map((r) => r.tag),
    ['a1', 'query', 'b1', 'a2'],
  );
  for (let i = 1; i < done.length; i++) {
    assert.ok((done[i] as { start: number }).start >= (done[i - 1] as { end: number }).end, 'two runs overlapped');
  }
  await Promise.all([a.close(), b.close()]);
});

test('closing rejects later calls', async () => {
  const thread = checkThread();
  await thread.start();
  await thread.close();
  await assert.rejects(thread.call('double', { values: Float32Array.from([1]) }), /beendet/);
});

// ---------------------------------------------------------------- the real models

const tmp = mkdtempSync(path.join(os.tmpdir(), 'inference-worker-'));
const siglipFile = path.join(config.modelCacheDir, config.modelId, 'onnx');
const facesFile = path.join(config.modelCacheDir, 'opencv', 'face_detection_yunet', 'face_detection_yunet_2023mar.onnx');
const depthFile = path.join(config.modelCacheDir, 'onnx-community', 'depth-anything-v2-small', 'onnx', 'model.onnx');
const peopleClip = path.join(repoRoot, 'dataset', 'children-and-her-teacher-learning-didactically.mp4');

/** One frame of a clip as JPEG, or null without ffmpeg. */
function frameOf(clip: string, name: string): string | null {
  const jpeg = path.join(tmp, name);
  try {
    execFileSync(config.ffmpegPath, ['-loglevel', 'error', '-y', '-ss', '2', '-i', clip, '-frames:v', '1', '-vf', 'scale=640:-2', jpeg]);
    return jpeg;
  } catch {
    return null;
  }
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  assert.equal(a.length, b.length);
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs((a[i] as number) - (b[i] as number)));
  return worst;
}

/** Deterministic pseudo-random pixels in the normalised range of the encoder. */
function noisePixels(count: number, size: number, seed: number): Float32Array {
  const out = new Float32Array(count * 3 * size * size);
  let s = seed >>> 0;
  for (let i = 0; i < out.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = (s / 2 ** 32) * 2 - 1;
  }
  return out;
}

test(
  'image and text embeddings from the thread equal those computed on this thread',
  { skip: existsSync(siglipFile) ? false : 'embedding model not in the cache' },
  async () => {
    const { EmbeddingModel, embeddingModelOptions } = await import('../src/ml/model.js');
    const { SiglipEngine } = await import('../src/ml/siglipService.js');
    const model = new EmbeddingModel();
    await model.load();
    const local = new SiglipEngine();
    const info = await local.load(embeddingModelOptions());
    try {
      assert.equal(model.dim, info.dim);
      assert.equal(model.imageSize, info.imageSize);
      assert.deepEqual(model.imageMean, info.imageMean);

      const pixels = noisePixels(3, model.imageSize, 7);
      const expected = await local.vision(pixels.slice(), 3);
      const fromThread = await model.embedPixels(pixels, 3);
      assert.equal(pixels.length, 0, 'the pixel buffer is moved to the thread');
      assert.ok(maxAbsDiff(fromThread, expected) <= 1e-6, `image rows differ by ${maxAbsDiff(fromThread, expected)}`);

      const texts = ['a flooded street', 'Rauch über einem Gebäude', 'a red car on a bridge'];
      const textRows = await model.embedTexts(texts);
      const textExpected = await local.text(texts);
      assert.ok(maxAbsDiff(textRows, textExpected) <= 1e-6, `text rows differ by ${maxAbsDiff(textRows, textExpected)}`);
      assert.equal((await model.embedTexts([])).length, 0);

      // The same checks and messages as before.
      await assert.rejects(model.embedPixels(new Float32Array(5), 1), /Pixel buffer has 5 values/);
      const diagnosis = await model.diagnose();
      assert.ok(diagnosis.agreement >= 2);
    } finally {
      await Promise.all([model.dispose(), local.dispose()]);
    }
    await assert.rejects(model.embedTexts(['x']), /not loaded/);
  },
);

test(
  'face boxes from the thread equal those found on this thread',
  { skip: existsSync(facesFile) && existsSync(peopleClip) ? false : 'face detector or test clip not available' },
  async (t) => {
    const jpeg = frameOf(peopleClip, 'people.jpg');
    if (!jpeg) return t.skip('no ffmpeg');
    const { FaceDetector } = await import('../src/ml/faces.js');
    const { YunetEngine } = await import('../src/ml/yunetService.js');
    const { decodeFrame } = await import('../src/ml/preprocess.js');
    const frame = await decodeFrame(jpeg);
    const before = Buffer.from(frame.data);
    const faces = new FaceDetector();
    await faces.load();
    assert.equal(faces.ready, true, faces.problem ?? '');
    const local = new YunetEngine();
    await local.load({ file: facesFile, threads: Math.min(4, config.threads) });
    try {
      const fromThread = await faces.detect(frame);
      const expected = await local.detect(new Uint8Array(frame.data), frame.width, frame.height);
      assert.deepEqual(fromThread, expected);
      // The frame stays with the caller (it is pixelated afterwards).
      assert.ok(frame.data.equals(before));
    } finally {
      await Promise.all([faces.dispose(), local.dispose()]);
    }
    assert.equal(faces.ready, false);
    assert.deepEqual(await faces.detect(frame), []);
  },
);

test(
  'depth from the thread equals depth computed on this thread',
  { skip: existsSync(depthFile) && existsSync(peopleClip) ? false : 'depth model or test clip not available' },
  async (t) => {
    const jpeg = frameOf(peopleClip, 'depth.jpg');
    if (!jpeg) return t.skip('no ffmpeg');
    const { estimateDisparity, depthInputDims, depthModelId, disposeDepthModel } = await import('../src/datum/depth.js');
    const { DepthEngine } = await import('../src/ml/depthService.js');
    const local = new DepthEngine();
    await local.load({ modelId: depthModelId, dtype: 'fp32', devices: ['cpu'], threads: config.threads, cacheDir: config.modelCacheDir, offline: true });
    try {
      const fromThread = await estimateDisparity(jpeg);
      const meta = await sharp(jpeg).metadata();
      const { w, h } = depthInputDims(meta.width ?? 0, meta.height ?? 0);
      const raw = await sharp(jpeg).rotate().removeAlpha().toColourspace('srgb').resize(w, h, { fit: 'fill', kernel: 'cubic' }).raw().toBuffer();
      const expected = await local.run(new Uint8Array(raw), w, h, true);
      assert.equal(fromThread.width, expected.width);
      assert.equal(fromThread.height, expected.height);
      assert.ok(maxAbsDiff(fromThread.data, expected.data) <= 1e-5, `depth differs by ${maxAbsDiff(fromThread.data, expected.data)}`);
    } finally {
      await Promise.all([disposeDepthModel(), local.dispose()]);
    }
  },
);
