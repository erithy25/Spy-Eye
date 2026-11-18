import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { repoRoot } from '../src/config.js';
import { GEOCLIP_REMOTE_FILES, GeoClip, defaultGeoclipDir, ensureGeoclipFiles, geoclipFilesFor, geoclipFilesPresent } from '../src/datum/geoclip.js';
import { WorldModelService } from '../src/datum/geoclipService.js';
import { greatCircleKm } from '../src/datum/world.js';

/**
 * The world model's thread (geoclipService.ts / geoclipWorker.ts) and the download of its files.
 * The life cycle (start, a crash, the one restart, giving up, closing) is tested without the
 * weights: sparse files of the pinned sizes make the files look present, and the thread's test
 * mode starts without loading them. The real model runs only when its weights and the gallery
 * cache are on this machine.
 */

async function sparseModelDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geoclip-sparse-'));
  for (const rel of geoclipFilesFor('int8')) {
    const file = path.join(dir, ...rel.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    const handle = await fs.open(file, 'w');
    // A sparse file of the pinned size: no disk space, and the size check passes.
    await handle.truncate(GEOCLIP_REMOTE_FILES[rel]?.bytes ?? 1);
    await handle.close();
  }
  return dir;
}

const jpeg = async (): Promise<Buffer> => {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 90, g: 140, b: 200 } } }).jpeg().toBuffer();
};

test('without the weights the world model says so at once, in both languages, and starts no thread', async () => {
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'geoclip-none-'));
  try {
    const wm = new WorldModelService({ modelDir: empty, cacheDir: empty, precision: 'int8' });
    assert.equal(await wm.available(), false);
    const r = await wm.predict([await jpeg()]);
    assert.equal(r.state, 'unavailable');
    assert.equal(r.prediction, null);
    assert.match(r.reason?.de ?? '', /fehlen/);
    assert.match(r.reason?.en ?? '', /missing/);
    assert.ok(r.ms < 1000);
    let settled: boolean | null = null;
    wm.warm();
    await wm.close();
    wm.onGallerySettled((ready) => (settled = ready));
    assert.equal(settled, false, 'a closed model will never be ready');
    // Nothing of the files is required to answer: no frames at all is a failure, not an exception.
    assert.equal((await new WorldModelService({ modelDir: empty }).predict([])).state, 'failed');
  } finally {
    await fs.rm(empty, { recursive: true, force: true });
  }
});

test('the thread: a crash fails the call in it, the thread starts once more, a second crash gives up', async () => {
  const dir = await sparseModelDir();
  const logs: string[] = [];
  const wm = new WorldModelService({ modelDir: dir, cacheDir: dir, precision: 'int8', threads: 1, testOps: true, log: (m) => logs.push(m) });
  try {
    assert.equal(await wm.available(), true, 'sparse files of the pinned sizes count as present');
    const frame = await jpeg();
    // The files are no model: the gallery cannot be built. The quick call does not wait for it.
    const first = await wm.predict([frame]);
    assert.ok(first.state === 'building' || first.state === 'failed', first.state);
    assert.equal(first.prediction, null);
    assert.ok(first.reason?.de && first.reason.en);
    const settled = await new Promise<boolean>((resolve) => wm.onGallerySettled(resolve));
    assert.equal(settled, false, 'a gallery that cannot be built is reported as such');
    const second = await wm.predict([frame]);
    assert.equal(second.state, 'failed');
    assert.match(second.reason?.en ?? '', /world model failed/);
    assert.doesNotMatch(second.reason?.en ?? '', /Ortsgalerie|nicht verfügbar/);

    // A crash with a call waiting behind it: the call fails cleanly, the thread comes back.
    const crash = wm.crashForTest();
    const caught = await wm.predict([frame]);
    await crash;
    assert.equal(caught.state, 'failed');
    assert.match(caught.reason?.de ?? '', /ausgefallen/);
    // The English twin is English throughout, also for the host's own errors.
    assert.match(caught.reason?.en ?? '', /world model failed: the computing thread failed/);
    assert.doesNotMatch(caught.reason?.en ?? '', /ausgefallen|Rechenthread|Aufruf/);
    const afterRestart = await wm.predict([frame]);
    assert.ok(afterRestart.state === 'building' || afterRestart.state === 'failed', 'the restarted thread answers');
    assert.ok(logs.some((l) => /neu gestartet/.test(l)));

    // Two crashes without a completed call between them: the model is given up.
    await wm.crashForTest();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await wm.crashForTest();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const gone = await wm.predict([frame]);
    assert.equal(gone.state, 'failed');
    assert.match(gone.reason?.de ?? '', /erneut ausgefallen|Neustart/);
    assert.match(gone.reason?.en ?? '', /failed again|restarting/);
    assert.doesNotMatch(gone.reason?.en ?? '', /ausgefallen|Rechenthread|Neustart|Weltmodell/);
    assert.ok(logs.some((l) => /aufgegeben/.test(l)));
  } finally {
    await wm.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('download: pinned files are fetched, checked against their SHA-256, never left half-written; idempotent', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'geoclip-dl-'));
  try {
    const content: Record<string, Buffer> = {};
    const pinned: Record<string, { sha256: string; bytes: number }> = {};
    for (const rel of geoclipFilesFor('int8')) {
      content[rel] = Buffer.from(`inhalt von ${rel} `.repeat(500));
      pinned[rel] = { sha256: createHash('sha256').update(content[rel] as Buffer).digest('hex'), bytes: (content[rel] as Buffer).length };
    }
    const requested: string[] = [];
    let serve = (rel: string): Response => new Response(content[rel] as Buffer);
    const fetchImpl = (async (url: string | URL | Request): Promise<Response> => {
      const rel = String(url).replace('https://example.invalid/rev/', '');
      requested.push(rel);
      return serve(rel);
    }) as typeof fetch;
    const opts = { modelDir: dir, baseUrl: 'https://example.invalid/rev', fetchImpl, pinned, precision: 'int8' as const };

    const first = await ensureGeoclipFiles(opts);
    assert.deepEqual(first.fetched.sort(), Object.keys(pinned).sort());
    for (const rel of Object.keys(pinned)) assert.deepEqual(await fs.readFile(path.join(dir, ...rel.split('/'))), content[rel]);
    // Idempotent: nothing is fetched again.
    requested.length = 0;
    const again = await ensureGeoclipFiles(opts);
    assert.equal(again.fetched.length, 0);
    assert.equal(requested.length, 0);

    // A changed file of the right size is fetched again (the hash is checked).
    const gallery = path.join(dir, 'gps_gallery', 'coordinates_100K.bin');
    const wrong = Buffer.from(content['gps_gallery/coordinates_100K.bin'] as Buffer);
    wrong[0] = (wrong[0] ?? 0) ^ 0xff;
    await fs.writeFile(gallery, wrong);
    const repaired = await ensureGeoclipFiles(opts);
    assert.deepEqual(repaired.fetched, ['gps_gallery/coordinates_100K.bin']);

    // A wrong or cut-off download leaves no file and no part file behind.
    await fs.rm(gallery);
    serve = (rel) => new Response(rel.endsWith('.bin') ? wrong : (content[rel] as Buffer));
    await assert.rejects(ensureGeoclipFiles(opts), /SHA-256/);
    serve = (rel) => new Response((content[rel] as Buffer).subarray(0, 100));
    await assert.rejects(ensureGeoclipFiles(opts), /Bytes statt/);
    serve = () => new Response('nicht da', { status: 404 });
    await assert.rejects(ensureGeoclipFiles(opts), /HTTP 404/);
    const left = await fs.readdir(path.join(dir, 'gps_gallery'));
    assert.deepEqual(left, [], `nothing half-written: ${left.join(', ')}`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ the real model (when present)

const realDir = defaultGeoclipDir();
const realFiles = await geoclipFilesPresent('int8', realDir);
const galleryBuilt = realFiles.ok ? await new GeoClip({ precision: 'int8', modelDir: realDir }).galleryCached() : false;
const clip = path.join(repoRoot, 'datasets', 'datum', 'clips', 'fr-eiffel-tower.mp4');
const clipThere = await fs.access(clip).then(() => true, () => false);
const skipReal = !realFiles.ok ? 'GeoCLIP-Gewichte fehlen' : !galleryBuilt ? 'Ortsgalerie noch nicht berechnet' : !clipThere ? 'Referenzvideo fehlt' : false;

test('the real model in its thread: the Eiffel Tower frames land in Paris, the main thread stays free', { skip: skipReal }, async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'geoclip-real-'));
  const wm = new WorldModelService({ precision: 'int8' });
  try {
    const jpegs: Buffer[] = [];
    for (const t of [2, 6, 10]) {
      const out = path.join(tmp, `f${t}.jpg`);
      const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(t), '-i', clip, '-frames:v', '1', '-vf', "scale=w='min(640,iw)':h=-2", '-q:v', '3', out]);
      assert.equal(r.status, 0, String(r.stderr));
      jpegs.push(await fs.readFile(out));
    }
    await wm.ensureGallery();
    // Main-thread time during a prediction: event-loop utilisation (busy time of this thread).
    const before = performance.eventLoopUtilization();
    const result = await wm.predict(jpegs);
    const busy = performance.eventLoopUtilization(before);
    assert.equal(result.state, 'ok', result.reason?.de ?? '');
    const pred = result.prediction;
    assert.ok(pred);
    assert.ok(greatCircleKm(pred.best.lat, pred.best.lon, 48.8584, 2.2945) < 25, `best ${pred.best.lat}, ${pred.best.lon}`);
    assert.equal(pred.countries[0]?.iso, 'FR');
    assert.ok(pred.support.length > 0 && pred.coords.length === 2 * pred.support.length, 'compact prediction');
    // The call took seconds; this thread was busy for a small part of it (structured clone of
    // the compact prediction, a few listeners). Loose bound: the machine runs other work too.
    assert.ok(busy.active < 200, `main thread busy ${busy.active.toFixed(1)} ms of ${result.ms.toFixed(0)} ms`);
    process.stdout.write(`# GeoCLIP im Thread: ${result.ms.toFixed(0)} ms, Hauptthread belegt ${busy.active.toFixed(1)} ms\n`);
  } finally {
    await wm.close();
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('a process that exits while the world model computes ends cleanly, without an abort', { skip: skipReal }, async () => {
  // Before the exit drain, a process.exit in the middle of a session run (the node's shutdown, a
  // script's end) took the process down with SIGABRT ("terminate called after throwing an
  // instance of 'Napi::Error'"): Node tore the thread down inside onnxruntime. Now the exit waits
  // until the thread has finished its run and released its sessions.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'geoclip-exit-'));
  try {
    const frames: string[] = [];
    for (const t of [1, 3, 5, 7, 9, 11]) {
      const out = path.join(tmp, `f${t}.jpg`);
      const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(t), '-i', clip, '-frames:v', '1', '-vf', "scale=w='min(640,iw)':h=-2", '-q:v', '3', out]);
      assert.equal(r.status, 0, String(r.stderr));
      frames.push(out);
    }
    const service = new URL('../src/datum/geoclipService.ts', import.meta.url).href;
    const script = path.join(tmp, 'exit-mid-run.mts');
    await fs.writeFile(
      script,
      [
        "import fs from 'node:fs/promises';",
        `const { WorldModelService } = await import(${JSON.stringify(service)});`,
        `const frames = await Promise.all(${JSON.stringify(frames)}.map((f) => fs.readFile(f)));`,
        "const wm = new WorldModelService({ precision: 'int8', threads: 2 });",
        'await wm.ensureGallery();',
        'void wm.predict(frames, { wait: true });',
        // The image tower's runs start right away; the exit falls into one of them.
        'setTimeout(() => process.exit(0), Number(process.argv[2]));',
      ].join('\n'),
    );
    for (const delay of [300, 800]) {
      const r = spawnSync(process.execPath, ['--import', 'tsx', script, String(delay)], { cwd: path.join(import.meta.dirname, '..'), encoding: 'utf8', timeout: 120_000 });
      assert.equal(r.signal, null, `exit after ${delay} ms: signal ${r.signal}\n${r.stderr}`);
      assert.equal(r.status, 0, `exit after ${delay} ms: status ${r.status}\n${r.stderr}`);
      assert.doesNotMatch(r.stderr, /Napi::Error|terminate called/);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
