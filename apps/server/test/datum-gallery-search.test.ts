import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import {
  Gallery,
  defaultDatasetDir,
  type GalleryImage,
  type GalleryNeighbour,
  type GallerySearchOptions,
  type ImageEmbedder,
} from '../src/datum/gallery.js';
import { GallerySearchThread, closeGallerySearch } from '../src/datum/gallerySearch.js';
import { seedFiles, writeSeed, type SeedIndex } from '../src/datum/gallerySeed.js';

/**
 * Gallery.searchAsync runs the gallery search in a worker thread (gallerySearch.ts). It must give
 * exactly what search() gives, keep working when the thread does not, see one complete gallery
 * state per search while load() extends the gallery, and end with the node.
 */

after(() => closeGallerySearch());

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Stand-in for the image tower: every row comes from the shipped seed, nothing is embedded. */
function noEmbedder(dim: number): ImageEmbedder {
  return {
    imageSize: 8,
    imageMean: [0.5, 0.5, 0.5],
    imageStd: [0.5, 0.5, 0.5],
    dim,
    embedPixels: () => Promise.reject(new Error('im Test wird nichts eingerechnet')),
  };
}

/**
 * The search as it was before the search thread (verbatim apart from its inputs): the reference
 * both paths must reproduce to the last bit.
 */
function referenceSearch(images: readonly GalleryImage[], g: Float32Array, dim: number, vectors: Float32Array, k: number, opts: GallerySearchOptions = {}): GalleryNeighbour[][] {
  if (dim === 0 || images.length === 0) return [];
  const rows = vectors.length / dim;
  const excluded = new Set(opts.excludeWikidata ?? []);
  const allowed = excluded.size === 0 ? null : images.map((img) => !(img.wikidata !== null && excluded.has(img.wikidata)));
  const n = images.length;
  const out: GalleryNeighbour[][] = [];
  const all = new Float32Array(rows * n);
  for (let i = 0; i < n; i++) {
    const gOff = i * dim;
    for (let r = 0; r < rows; r++) {
      const qOff = r * dim;
      let d0 = 0;
      let d1 = 0;
      let d2 = 0;
      let d3 = 0;
      let d = 0;
      for (; d + 3 < dim; d += 4) {
        d0 += (vectors[qOff + d] as number) * (g[gOff + d] as number);
        d1 += (vectors[qOff + d + 1] as number) * (g[gOff + d + 1] as number);
        d2 += (vectors[qOff + d + 2] as number) * (g[gOff + d + 2] as number);
        d3 += (vectors[qOff + d + 3] as number) * (g[gOff + d + 3] as number);
      }
      for (; d < dim; d++) d0 += (vectors[qOff + d] as number) * (g[gOff + d] as number);
      all[r * n + i] = d0 + d1 + d2 + d3;
    }
  }
  for (let r = 0; r < rows; r++) {
    const sims = all.subarray(r * n, (r + 1) * n);
    const top: number[] = [];
    for (let i = 0; i < n; i++) {
      if (allowed && !allowed[i]) continue;
      const s = sims[i] as number;
      if (top.length === k && s <= (sims[top[top.length - 1] as number] as number)) continue;
      let pos = top.length;
      while (pos > 0 && (sims[top[pos - 1] as number] as number) < s) pos--;
      top.splice(pos, 0, i);
      if (top.length > k) top.pop();
    }
    out.push(
      top.map((i) => {
        const img = images[i] as GalleryImage;
        return { id: img.id, label: img.label, lat: img.lat, lon: img.lon, country: img.country, wikidata: img.wikidata, similarity: sims[i] as number };
      }),
    );
  }
  return out;
}

/** The gallery's rows in list order, as one matrix (for the reference search). */
function matrixOf(gallery: Gallery): Float32Array {
  const out = new Float32Array(gallery.size * gallery.dim);
  gallery.list().forEach((img, i) => out.set(gallery.vector(img.id) ?? new Float32Array(gallery.dim), i * gallery.dim));
  return out;
}

/** Deterministic pseudo-random numbers in [0, 1). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function normaliseRows(values: Float32Array, dim: number): Float32Array {
  for (let off = 0; off < values.length; off += dim) {
    let norm = 0;
    for (let d = 0; d < dim; d++) norm += (values[off + d] as number) ** 2;
    const scale = norm > 0 ? 1 / Math.sqrt(norm) : 0;
    for (let d = 0; d < dim; d++) values[off + d] = (values[off + d] as number) * scale;
  }
  return values;
}

function randomRows(rows: number, dim: number, seed: number): Float32Array {
  const next = rng(seed);
  return normaliseRows(Float32Array.from({ length: rows * dim }, () => next() * 2 - 1), dim);
}

/** A gallery whose rows come from a seed written here (no pictures on disk, nothing embedded). */
async function seededGallery(
  root: string,
  dim: number,
  vectors: Float32Array,
  thread: GallerySearchThread,
  ids: string[] = Array.from({ length: vectors.length / dim }, (_, i) => `Q${i + 1}`),
): Promise<{ gallery: Gallery; datasetDir: string }> {
  const datasetDir = path.join(root, 'dataset');
  await writeGallery(datasetDir, dim, vectors, ids);
  const gallery = new Gallery(noEmbedder(dim), { datasetDir, cacheDir: path.join(root, 'cache'), modelId: 'test/model', searchThread: thread });
  const report = await gallery.load();
  assert.equal(report.images, ids.length);
  return { gallery, datasetDir };
}

async function writeGallery(datasetDir: string, dim: number, vectors: Float32Array, ids: string[]): Promise<void> {
  await fs.mkdir(datasetDir, { recursive: true });
  const images = ids.map((id, i) => ({ id, file: `gallery/${id}.jpg`, label: `Ort ${id}`, lat: 40 + i * 0.01, lon: 7, country: 'DE', wikidata: id }));
  await fs.writeFile(path.join(datasetDir, 'gallery.json'), JSON.stringify({ images }));
  await writeSeed(datasetDir, 'test/model', dim, ids, ids.map((id) => `gallery/${id}.jpg:1`), vectors);
}

/** A search thread whose notices are collected instead of printed. */
function quietThread(options: ConstructorParameters<typeof GallerySearchThread>[0] = {}): { thread: GallerySearchThread; notices: string[] } {
  const notices: string[] = [];
  return { thread: new GallerySearchThread({ ...options, log: (line) => notices.push(line) }), notices };
}

/** A worker script for the failure tests, written as plain JavaScript into `dir`. */
async function fixtureWorker(dir: string, name: string, body: string): Promise<URL> {
  const file = path.join(dir, `${name}.mjs`);
  await fs.writeFile(file, `import { parentPort } from 'node:worker_threads';\n${body}\n`);
  return pathToFileURL(file);
}

// ---------------------------------------------------------------- identical results

const realSeed = seedFiles(defaultDatasetDir(), 'onnx-community/siglip2-base-patch32-256-ONNX');
const realGalleryPresent = existsSync(path.join(defaultDatasetDir(), 'gallery.json')) && existsSync(realSeed.index) && existsSync(realSeed.bin);

test(
  'on the real gallery searchAsync gives exactly what search() gives, and search() what it gave before',
  { skip: realGalleryPresent ? false : 'shipped gallery vectors not in the checkout' },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-search-real-'));
    const { thread, notices } = quietThread();
    try {
      // The shipped dataset without its pictures: every row comes from the shipped vectors.
      const datasetDir = path.join(root, 'dataset');
      await fs.mkdir(datasetDir);
      await fs.copyFile(path.join(defaultDatasetDir(), 'gallery.json'), path.join(datasetDir, 'gallery.json'));
      const seed = seedFiles(datasetDir, 'onnx-community/siglip2-base-patch32-256-ONNX');
      await fs.copyFile(realSeed.index, seed.index);
      await fs.copyFile(realSeed.bin, seed.bin);
      const index = JSON.parse(await fs.readFile(seed.index, 'utf8')) as SeedIndex;
      const gallery = new Gallery(noEmbedder(index.dim), { datasetDir, cacheDir: path.join(root, 'cache'), modelId: index.modelId, searchThread: thread });
      const report = await gallery.load();
      assert.equal(report.embedded, 0);
      assert.ok(gallery.size > 5000, `${gallery.size} rows`);
      const dim = gallery.dim;
      const images = gallery.list();
      const g = matrixOf(gallery);

      // 100 query rows as in a localisation: random directions, gallery rows themselves (a
      // similarity of 1 at the top) and mixtures of two rows (two near-equal neighbours).
      const queries = new Float32Array(100 * dim);
      queries.set(randomRows(60, dim, 11));
      const pick = rng(5);
      for (let r = 60; r < 100; r++) {
        const a = Math.floor(pick() * images.length);
        const b = Math.floor(pick() * images.length);
        for (let d = 0; d < dim; d++) {
          queries[r * dim + d] = r < 80 ? (g[a * dim + d] as number) : (g[a * dim + d] as number) + (g[b * dim + d] as number);
        }
      }
      normaliseRows(queries, dim);

      const expected = referenceSearch(images, g, dim, queries, 30);
      assert.deepStrictEqual(gallery.search(queries, 30), expected, 'search() changed its result');
      const fromThread = await gallery.searchAsync(queries, 30);
      assert.deepStrictEqual(fromThread, expected);
      assert.equal(thread.running, true, 'the search ran in the thread');
      assert.equal(queries.length, 100 * dim, "the caller's query rows stay intact");

      // Leaving out the places of the best hits (evaluation of unknown places).
      const excludeWikidata = [...new Set(expected.slice(0, 40).map((row) => row[0]?.wikidata).filter((w): w is string => typeof w === 'string'))];
      const some = queries.subarray(0, 40 * dim);
      const expectedExcluded = referenceSearch(images, g, dim, some, 10, { excludeWikidata });
      assert.deepStrictEqual(gallery.search(some, 10, { excludeWikidata }), expectedExcluded);
      assert.deepStrictEqual(await gallery.searchAsync(some, 10, { excludeWikidata }), expectedExcluded);
      assert.notEqual(expectedExcluded[0]?.[0]?.wikidata, expected[0]?.[0]?.wikidata, 'the exclusion took effect');
      assert.deepStrictEqual(notices, []);
    } finally {
      await thread.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

test('ties, edge values of k and malformed queries behave as in search()', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-search-ties-'));
  const { thread, notices } = quietThread();
  try {
    const dim = 6;
    // Rows 2, 4 and 5 are the same vector: equal similarities, the earlier row must come first.
    const rows = randomRows(8, dim, 3);
    rows.copyWithin(4 * dim, 2 * dim, 3 * dim);
    rows.copyWithin(5 * dim, 2 * dim, 3 * dim);
    const { gallery } = await seededGallery(root, dim, rows, thread);
    const images = gallery.list();
    const g = matrixOf(gallery);
    const queries = new Float32Array(4 * dim);
    queries.set(randomRows(3, dim, 9));
    queries.set(g.subarray(2 * dim, 3 * dim), 3 * dim);
    for (const k of [0, 1, 2, 2.5, 3, images.length, images.length + 5]) {
      const expected = referenceSearch(images, g, dim, queries, k);
      assert.deepStrictEqual(gallery.search(queries, k), expected, `search() with k = ${k}`);
      assert.deepStrictEqual(await gallery.searchAsync(queries, k), expected, `searchAsync() with k = ${k}`);
    }
    const tied = (await gallery.searchAsync(queries.subarray(3 * dim), 3))[0] ?? [];
    assert.deepStrictEqual(
      tied.map((n) => n.id),
      ['Q3', 'Q5', 'Q6'],
    );
    const exclude = { excludeWikidata: ['Q3', 'Q6'] };
    assert.deepStrictEqual(await gallery.searchAsync(queries, 4, exclude), referenceSearch(images, g, dim, queries, 4, exclude));

    assert.deepStrictEqual(await gallery.searchAsync(new Float32Array(0), 3), []);
    assert.throws(() => gallery.search(new Float32Array(dim + 1), 3), { message: `search: ${dim + 1} Werte sind kein Vielfaches von ${dim}.` });
    await assert.rejects(gallery.searchAsync(new Float32Array(dim + 1), 3), { message: `search: ${dim + 1} Werte sind kein Vielfaches von ${dim}.` });
    const empty = new Gallery(noEmbedder(dim), { datasetDir: root, cacheDir: root, searchThread: thread });
    assert.deepStrictEqual(await empty.searchAsync(queries, 3), []);
    assert.deepStrictEqual(notices, []);
  } finally {
    await thread.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- failures of the thread

test('a thread that cannot start, dies, hangs or answers nonsense costs nothing but time; it is reported once', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-search-fail-'));
  const dim = 8;
  const threads: GallerySearchThread[] = [];
  try {
    const plain = quietThread().thread;
    threads.push(plain);
    const { gallery: reference } = await seededGallery(path.join(root, 'reference'), dim, randomRows(40, dim, 21), plain);
    const queries = randomRows(5, dim, 22);
    const expected = reference.search(queries, 4);
    const cases: { name: string; entry: URL; stallMs?: number }[] = [
      { name: 'missing script', entry: pathToFileURL(path.join(root, 'nicht-vorhanden.mjs')) },
      { name: 'throws at start', entry: await fixtureWorker(root, 'throws', "throw new Error('Start verweigert');") },
      { name: 'dies in a search', entry: await fixtureWorker(root, 'dies', "parentPort.on('message', (m) => { if (m.type === 'search') process.exit(3); });") },
      { name: 'never answers', entry: await fixtureWorker(root, 'silent', "parentPort.on('message', () => {});"), stallMs: 300 },
      {
        name: 'answers with an error',
        entry: await fixtureWorker(root, 'error', "parentPort.on('message', (m) => { if (m.type === 'search') parentPort.postMessage({ type: 'error', id: m.id, message: 'kaputt' }); });"),
      },
      {
        name: 'answers nonsense',
        entry: await fixtureWorker(
          root,
          'nonsense',
          "parentPort.on('message', (m) => { if (m.type === 'search') parentPort.postMessage({ type: 'result', id: m.id, offsets: new Int32Array([0, 1]), indices: new Int32Array([99999]), similarities: new Float32Array([1]) }); });",
        ),
      },
    ];
    for (const c of cases) {
      const { thread, notices } = quietThread({ entry: c.entry, ...(c.stallMs !== undefined ? { stallMs: c.stallMs } : {}) });
      threads.push(thread);
      const { gallery } = await seededGallery(path.join(root, c.name.replace(/\s+/g, '-')), dim, randomRows(40, dim, 21), thread);
      assert.deepStrictEqual(await gallery.searchAsync(queries, 4), expected, c.name);
      assert.deepStrictEqual(await gallery.searchAsync(queries, 4), expected, `${c.name}, second search`);
      assert.equal(notices.length, 1, `${c.name}: ${JSON.stringify(notices)}`);
      assert.match(notices[0] ?? '', /^ {2}Galeriesuche: .+; betroffene Suchen laufen im Hauptthread\.$/);
    }
  } finally {
    await Promise.all(threads.map((t) => t.close()));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('after a failed start no new thread is started for every search, but after the pause one is', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-search-retry-'));
  const dim = 4;
  const entry = path.join(root, 'later.mjs');
  // A pause long enough that a busy machine does not end it between two searches.
  const { thread, notices } = quietThread({ entry: pathToFileURL(entry), retryAfterMs: 2000 });
  try {
    const { gallery } = await seededGallery(root, dim, randomRows(10, dim, 31), thread);
    const queries = randomRows(2, dim, 32);
    const expected = gallery.search(queries, 3);
    assert.deepStrictEqual(await gallery.searchAsync(queries, 3), expected);
    assert.equal(thread.running, false);
    // The script appears (it runs the real search thread); within the pause it is not tried.
    const realWorker = pathToFileURL(path.join(serverDir, 'src', 'datum', 'gallerySearchWorker.ts')).href;
    await fs.writeFile(entry, `await import(${JSON.stringify(realWorker)});\n`);
    assert.deepStrictEqual(await gallery.searchAsync(queries, 3), expected);
    assert.equal(thread.running, false, 'no new thread within the pause');
    await new Promise((resolve) => setTimeout(resolve, 2100));
    assert.deepStrictEqual(await gallery.searchAsync(queries, 3), expected);
    assert.equal(thread.running, true, 'a new thread after the pause');
    assert.equal(notices.length, 1);
  } finally {
    await thread.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- gallery changes

test('a search sees the gallery as it was at the call; after load() the new rows are searched', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-search-grow-'));
  const { thread, notices } = quietThread();
  try {
    const dim = 8;
    const first = randomRows(30, dim, 41);
    const { gallery, datasetDir } = await seededGallery(root, dim, first, thread);
    const queries = randomRows(6, dim, 42);
    const before = gallery.search(queries, 5);
    assert.deepStrictEqual(await gallery.searchAsync(queries, 5), before);
    // A view into the current matrix, and its values (rounded to half precision by the seed).
    const oldRow = gallery.vector('Q1');
    const oldValues = [...(oldRow ?? [])];

    // The gallery grows by rows that are exactly the query directions: they must come first.
    const grown = new Float32Array(36 * dim);
    grown.set(first);
    grown.set(queries, 30 * dim);
    const ids = Array.from({ length: 36 }, (_, i) => `Q${i + 1}`);
    await writeGallery(datasetDir, dim, grown, ids);
    // Asked before the extension, answered after it: the old state, completely.
    const pending = gallery.searchAsync(queries, 5);
    const report = await gallery.load();
    assert.equal(report.images, 36);
    assert.deepStrictEqual(await pending, before);
    assert.deepStrictEqual([...(oldRow ?? [])], oldValues, 'the old matrix was not written');
    assert.notEqual(gallery.vector('Q1')?.buffer, oldRow?.buffer, 'the extended gallery has a matrix of its own');

    const after = await gallery.searchAsync(queries, 5);
    assert.deepStrictEqual(after, gallery.search(queries, 5));
    assert.deepStrictEqual(
      after.map((row) => row[0]?.id),
      ids.slice(30),
    );
    assert.deepStrictEqual(notices, []);
  } finally {
    await thread.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- shutdown

test('closing lets a search under way finish; later searches run here; closeGallerySearch ends every thread', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-search-close-'));
  const { thread, notices } = quietThread();
  const other = quietThread();
  try {
    const dim = 16;
    const { gallery } = await seededGallery(root, dim, randomRows(2000, dim, 51), thread);
    const queries = randomRows(50, dim, 52);
    const expected = gallery.search(queries, 8);
    const underWay = gallery.searchAsync(queries, 8);
    assert.equal(thread.running, true);
    await thread.close();
    assert.equal(thread.running, false);
    assert.deepStrictEqual(await underWay, expected);
    assert.deepStrictEqual(await gallery.searchAsync(queries, 8), expected, 'after closing the search runs here');
    assert.equal(thread.running, false, 'a closed thread is not started again');
    assert.deepStrictEqual(notices, [], 'closing is no failure');

    const { gallery: second } = await seededGallery(path.join(root, 'second'), dim, randomRows(50, dim, 53), other.thread);
    await second.searchAsync(queries, 3);
    assert.equal(other.thread.running, true);
    await closeGallerySearch();
    assert.equal(other.thread.running, false);
    assert.deepStrictEqual(other.notices, []);
  } finally {
    await Promise.all([thread.close(), other.thread.close()]);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('an idle search thread does not keep a script alive', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-search-exit-'));
  try {
    const dim = 4;
    await writeGallery(path.join(root, 'dataset'), dim, randomRows(20, dim, 61), Array.from({ length: 20 }, (_, i) => `Q${i + 1}`));
    const script = path.join(root, 'script.mts');
    const galleryModule = pathToFileURL(path.join(serverDir, 'src', 'datum', 'gallery.ts')).href;
    // Searches with the process-wide thread and ends without closing it, as a script does.
    await fs.writeFile(
      script,
      [
        `import { Gallery } from ${JSON.stringify(galleryModule)};`,
        `const model = { imageSize: 8, imageMean: [0, 0, 0], imageStd: [1, 1, 1], dim: ${dim}, embedPixels: () => Promise.reject(new Error('nein')) };`,
        `const gallery = new Gallery(model, { datasetDir: ${JSON.stringify(path.join(root, 'dataset'))}, cacheDir: ${JSON.stringify(path.join(root, 'cache'))}, modelId: 'test/model' });`,
        'await gallery.load();',
        `const hits = await gallery.searchAsync(Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0]), 2);`,
        'process.stdout.write(String(hits.length));',
      ].join('\n'),
    );
    const started = performance.now();
    const result = await new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', script], { cwd: serverDir, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.setEncoding('utf8').on('data', (c: string) => (out += c));
      child.stderr.setEncoding('utf8').on('data', (c: string) => (err += c));
      const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
      child.on('error', reject);
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ code, out, err });
      });
    });
    assert.equal(result.code, 0, result.err);
    assert.equal(result.out, '2');
    assert.ok(performance.now() - started < 60_000, 'the script ended by itself');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
