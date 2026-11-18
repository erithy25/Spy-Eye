import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { truthNames } from '../src/datum/dataset.js';
import { Gallery, type ImageEmbedder } from '../src/datum/gallery.js';
import {
  LABELS_USER_AGENT,
  applyLabels,
  bilingualLabels,
  fetchLabels,
  needsLabels,
  parseEntities,
  withLabels,
  type FetchLike,
  type LabelledEntry,
} from '../src/scripts/datum/fetchLabels.js';

/**
 * German and English names of the reference places (scripts/datum/fetchLabels.ts): parsed from
 * Wikidata's answer, stored next to the old label without touching anything else, read by the
 * gallery and the truths. The network is a stand-in; nothing here contacts Wikidata.
 */

/** A wbgetentities answer for the given items: [id, de, en, mul] (null: no label in that language). */
function answer(items: [string, string | null, string | null, string | null][], missing: string[] = []): unknown {
  const entities: Record<string, unknown> = {};
  for (const [id, de, en, mul] of items) {
    const labels: Record<string, { language: string; value: string }> = {};
    if (de) labels['de'] = { language: 'de', value: de };
    if (en) labels['en'] = { language: 'en', value: en };
    if (mul) labels['mul'] = { language: 'mul', value: mul };
    entities[id] = { type: 'item', id, labels };
  }
  for (const id of missing) entities[id] = { id, missing: '' };
  return { entities, success: 1 };
}

const KNOWN: Record<string, [string | null, string | null, string | null]> = {
  Q243: ['Eiffelturm', 'Eiffel Tower', null],
  Q270725: ['Nowodewitschi-Kloster', 'Novodevichy Convent', null],
  Q1000623: ['Schiller-Gymnasium Hof', null, null],
  Q42: [null, null, 'Douglas Adams'],
};

/** Stand-in for Wikidata: answers from KNOWN, records every request. */
function fakeWikidata(opts: { throttleFirst?: boolean; offline?: boolean } = {}): { fetch: FetchLike; requests: { url: string; agent: string | undefined }[] } {
  const requests: { url: string; agent: string | undefined }[] = [];
  let throttled = false;
  const fetch: FetchLike = async (url, init) => {
    requests.push({ url, agent: init.headers['User-Agent'] });
    if (opts.offline) throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND www.wikidata.org') });
    if (opts.throttleFirst && !throttled) {
      throttled = true;
      return { status: 429, ok: false, headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? '7' : null) }, json: async () => ({}) };
    }
    const ids = (new URL(url).searchParams.get('ids') ?? '').split('|');
    const items = ids.filter((id) => KNOWN[id]).map((id) => [id, ...(KNOWN[id] as [string | null, string | null, string | null])] as [string, string | null, string | null, string | null]);
    return { status: 200, ok: true, headers: { get: () => null }, json: async () => answer(items, ids.filter((id) => !KNOWN[id])) };
  };
  return { fetch, requests };
}

test('names from Wikidata: parsed per item, with the fallbacks de → mul → en → old label', () => {
  const parsed = parseEntities(answer([['Q243', 'Eiffelturm', 'Eiffel Tower', null], ['Q42', null, null, 'Douglas Adams']], ['Q999']));
  assert.deepEqual(parsed.get('Q243'), { de: 'Eiffelturm', en: 'Eiffel Tower', mul: null });
  assert.equal(parsed.has('Q999'), false, 'an item Wikidata does not know has no names');
  // A redirected item is answered under its new id; it is kept under the id that was asked for.
  const redirected = parseEntities({ entities: { Q2: { id: 'Q2', redirects: { from: 'Q1', to: 'Q2' }, labels: { de: { value: 'Neu' } } } } });
  assert.deepEqual(redirected.get('Q1'), { de: 'Neu', en: null, mul: null });

  assert.deepEqual(bilingualLabels('Eiffel Tower', parsed.get('Q243')), { labelDe: 'Eiffelturm', labelEn: 'Eiffel Tower' });
  assert.deepEqual(bilingualLabels('x', parsed.get('Q42')), { labelDe: 'Douglas Adams', labelEn: 'Douglas Adams' }, 'language-neutral name for both');
  assert.deepEqual(bilingualLabels('Schiller-Gymnasium Hof', { de: 'Schiller-Gymnasium Hof', en: null, mul: null }), { labelDe: 'Schiller-Gymnasium Hof', labelEn: 'Schiller-Gymnasium Hof' });
  assert.deepEqual(bilingualLabels('Altes Label', undefined), { labelDe: 'Altes Label', labelEn: 'Altes Label' });

  // The two fields go right after `label`; everything else stays where and as it was.
  const entry: LabelledEntry = { id: 'Q243', file: 'gallery/Q243.jpg', label: 'Eiffel Tower', lat: 48.8, wikidata: 'Q243' };
  assert.equal(needsLabels(entry), true);
  const named = withLabels(entry, { labelDe: 'Eiffelturm', labelEn: 'Eiffel Tower' });
  assert.deepEqual(Object.keys(named), ['id', 'file', 'label', 'labelDe', 'labelEn', 'lat', 'wikidata']);
  assert.equal(named['label'], 'Eiffel Tower', 'the old label stays for older readers');
  assert.equal(needsLabels(named), false);
  assert.equal(needsLabels({ id: 'x', label: 'y' }), false, 'nothing to ask without a Wikidata id');
  const list = [named];
  assert.equal(applyLabels(list, parseEntities(answer([['Q243', 'Eiffelturm', 'Eiffel Tower', null]])), new Set(['Q243'])), 0, 'complete entries are left alone');
});

test('the label run writes both names into gallery.json and manifest.json, once; offline it changes nothing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-labels-'));
  try {
    const images = ['Q243', 'Q270725', 'Q1000623', 'Q42', 'Q999'].map((id, i) => ({
      id,
      file: `gallery/${id}.jpg`,
      label: id === 'Q270725' ? 'Novodevichy Convent' : `Label ${i}`,
      lat: 50 + i,
      lon: 7,
      country: 'DE',
      wikidata: id,
      commonsFile: `${id}.jpg`,
      hasVideo: false,
      testItem: i === 0,
    }));
    const videos = [{ id: 'fr-eiffel-tower', file: 'clips/fr-eiffel-tower.mp4', title: 'Eiffel Tower at night', label: 'Eiffel Tower', wikidata: 'Q243', lat: 48.8584, lon: 2.2945, country: 'FR' }];
    const galleryText = `${JSON.stringify({ version: 1, images }, null, 2)}\n`;
    const manifestText = `${JSON.stringify({ version: 1, createdAt: 'x', source: 'Wikidata', videos }, null, 2)}\n`;
    await fs.writeFile(path.join(dir, 'gallery.json'), galleryText);
    await fs.writeFile(path.join(dir, 'manifest.json'), manifestText);

    // Offline: nothing learned, nothing written, and it says so.
    const offline = fakeWikidata({ offline: true });
    const none = await fetchLabels(dir, { fetch: offline.fetch, sleep: async () => undefined });
    assert.match(none.stopped ?? '', /^offline/);
    assert.deepEqual(none.changed, {});
    assert.equal(await fs.readFile(path.join(dir, 'gallery.json'), 'utf8'), galleryText);
    assert.equal(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'), manifestText);

    // Online, throttled once: waits as long as the server asks (Retry-After 7 s), then goes on.
    const online = fakeWikidata({ throttleFirst: true });
    const waits: number[] = [];
    const report = await fetchLabels(dir, { fetch: online.fetch, sleep: async (ms) => void waits.push(ms) });
    assert.equal(report.stopped, null);
    assert.equal(report.asked, 5, 'each item once, although Q243 is in both files');
    assert.ok(waits.some((ms) => ms >= 7000), `waited ${waits.join(', ')} ms`);
    assert.equal(online.requests.length, 2);
    for (const r of online.requests) {
      assert.equal(r.agent, LABELS_USER_AGENT);
      const params = new URL(r.url).searchParams;
      assert.equal(params.get('action'), 'wbgetentities');
      assert.equal(params.get('props'), 'labels');
      assert.equal(params.get('languages'), 'de|en|mul');
    }
    assert.deepEqual(report.changed, { 'gallery.json': 5, 'manifest.json': 1 });
    assert.equal(report.withDe, 3);
    assert.equal(report.withEn, 2);
    assert.equal(report.mulOnly, 1);
    assert.equal(report.notFound, 1);

    const gallery = JSON.parse(await fs.readFile(path.join(dir, 'gallery.json'), 'utf8')) as { images: Record<string, unknown>[] };
    assert.deepEqual(gallery.images.map((g) => g['id']), images.map((g) => g.id), 'ids and order stay (the shipped vectors are bound to them)');
    for (const [i, g] of gallery.images.entries()) {
      const { labelDe: _de, labelEn: _en, ...rest } = g;
      assert.deepEqual(rest, images[i], 'only the two fields are added');
    }
    const byId = new Map(gallery.images.map((g) => [g['id'], g]));
    assert.deepEqual([byId.get('Q270725')?.['labelDe'], byId.get('Q270725')?.['labelEn']], ['Nowodewitschi-Kloster', 'Novodevichy Convent']);
    assert.deepEqual([byId.get('Q1000623')?.['labelDe'], byId.get('Q1000623')?.['labelEn']], ['Schiller-Gymnasium Hof', 'Schiller-Gymnasium Hof']);
    assert.deepEqual([byId.get('Q42')?.['labelDe'], byId.get('Q42')?.['labelEn']], ['Douglas Adams', 'Douglas Adams']);
    assert.deepEqual([byId.get('Q999')?.['labelDe'], byId.get('Q999')?.['labelEn']], ['Label 4', 'Label 4'], 'unknown to Wikidata: the old label');
    const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')) as { videos: { label: string; labelDe: string; labelEn: string }[] };
    assert.deepEqual(truthNames(manifest.videos[0] as { label: string; labelDe: string; labelEn: string }), { de: 'Eiffelturm', en: 'Eiffel Tower' });

    // Again: nothing missing, no request, no write.
    const before = await fs.stat(path.join(dir, 'gallery.json'));
    const again = fakeWikidata();
    const second = await fetchLabels(dir, { fetch: again.fetch, sleep: async () => undefined });
    assert.equal(second.asked, 0);
    assert.equal(again.requests.length, 0);
    assert.equal((await fs.stat(path.join(dir, 'gallery.json'))).mtimeMs, before.mtimeMs);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

/** Stand-in for the image tower: one unit row per picture. */
class UnitEmbedder implements ImageEmbedder {
  readonly imageSize = 8;
  readonly imageMean: [number, number, number] = [0.5, 0.5, 0.5];
  readonly imageStd: [number, number, number] = [0.5, 0.5, 0.5];
  readonly dim = 4;
  async embedPixels(_pixels: Float32Array, count: number): Promise<Float32Array> {
    const out = new Float32Array(count * this.dim);
    for (let i = 0; i < count; i++) out.set([1, 0, 0, 0], i * this.dim);
    return out;
  }
}

test('the gallery reads the German and the English name; without them the old label serves both', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-gallery-names-'));
  try {
    const datasetDir = path.join(root, 'dataset');
    await fs.mkdir(path.join(datasetDir, 'gallery'), { recursive: true });
    const jpeg = await sharp({ create: { width: 16, height: 12, channels: 3, background: { r: 90, g: 120, b: 160 } } }).jpeg().toBuffer();
    for (const id of ['Q1', 'Q2']) await fs.writeFile(path.join(datasetDir, 'gallery', `${id}.jpg`), jpeg);
    const images = [
      { id: 'Q1', file: 'gallery/Q1.jpg', label: 'Tokyo Station', labelDe: 'Bahnhof Tokio', labelEn: 'Tokyo Station', lat: 35.68, lon: 139.77, country: 'JP', wikidata: 'Q1' },
      { id: 'Q2', file: 'gallery/Q2.jpg', label: 'Zoobrücke', lat: 50.95, lon: 6.98, country: 'DE', wikidata: 'Q2' },
    ];
    await fs.writeFile(path.join(datasetDir, 'gallery.json'), JSON.stringify({ images }));
    const gallery = new Gallery(new UnitEmbedder(), { datasetDir, cacheDir: path.join(root, 'cache'), modelId: 'test/model', batchSize: 2, decodeConcurrency: 1 });
    await gallery.load();
    assert.equal(gallery.image('Q1')?.label, 'Bahnhof Tokio');
    assert.equal(gallery.image('Q1')?.labelEn, 'Tokyo Station');
    assert.equal(gallery.image('Q2')?.label, 'Zoobrücke');
    assert.equal(gallery.image('Q2')?.labelEn, 'Zoobrücke');
    const hit = gallery.search(Float32Array.from([1, 0, 0, 0]), 2)[0]?.find((n) => n.id === 'Q1');
    assert.equal(hit?.label, 'Bahnhof Tokio');
    assert.equal(hit?.labelEn, 'Tokyo Station', 'the neighbours carry both names to the localisation');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
  assert.deepEqual(truthNames({ label: 'Eiffel Tower' }), { de: 'Eiffel Tower', en: 'Eiffel Tower' }, 'a manifest without names keeps its label');
});
