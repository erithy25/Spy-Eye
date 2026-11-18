import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { config } from '../src/config.js';
import type { Fix } from '../src/datum/contract.js';
import type { DatasetDeleteResult, DatasetInfo } from '../src/datum/datasets.js';
import { cleanDatasetName } from '../src/datum/datasets.js';
import { ENGINE_VERSION } from '../src/datum/version.js';
import { PlatformNode, type SharedRuntime } from '../src/node.js';
import { registerRoutes } from '../src/routes.js';

/**
 * DATUM datasets (GET/POST/PATCH/DELETE /api/datum/datasets) through the node's real routes and
 * sessions: a node with nothing loaded (no model, no analysis), signed in as the demo accounts.
 */

// No world model thread for a node that never locates anything.
process.env['DATUM_WORLDMODEL'] = '0';

interface Harness {
  app: FastifyInstance;
  node: PlatformNode;
  /** Session cookies: supervisor, operator, auditor. */
  leitung: string;
  lage: string;
  aufsicht: string;
  dispose: () => Promise<void>;
}

async function harness(): Promise<Harness> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-datasets-'));
  const dataDir = path.join(dir, 'data');
  await fs.mkdir(path.join(dataDir, 'videos'), { recursive: true });
  const shared = {
    model: { dim: 4, ready: false, state: { phase: 'loading' }, onState: () => () => undefined },
    faces: { ready: false },
    hazard: null,
    ready: new Promise(() => undefined),
  } as unknown as SharedRuntime;
  const node = new PlatformNode(
    { id: 'datum', name: 'DATUM', operator: 'Test', region: '', lat: 0, lon: 0, host: '127.0.0.1', port: 0, dataDir, peers: [], exercise: false },
    shared,
  );
  await node.ledger.open();
  await node.auth.open(config.demoPassword);
  await node.mandates.open();
  await node.sources.open();
  await node.cases.open();
  await node.datum.truths?.open();
  // Nothing is analysed or located: the pipeline waits for a model that never comes, and the
  // engine takes no jobs.
  node.pipeline.setReadyGate(new Promise(() => undefined));
  node.datum.stop();
  const app = Fastify({ bodyLimit: 1024 * 1024 });
  await registerRoutes(app, node, false);
  await app.ready();
  const login = async (user: string): Promise<string> => {
    const res = await app.inject({ method: 'POST', url: '/api/login', payload: { user, password: config.demoPassword } });
    assert.equal(res.statusCode, 200, `login ${user}`);
    return String(res.headers['set-cookie']).split(';')[0] as string;
  };
  return {
    app,
    node,
    leitung: await login('leitung'),
    lage: await login('lage'),
    aufsicht: await login('aufsicht'),
    dispose: async () => {
      await app.close();
      await node.sources.flush();
      // The user list is written shortly after the first start; let it land before the folder goes.
      await new Promise((resolve) => setTimeout(resolve, 250));
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

/** A recording put straight into the store, with a folder of a few files like an analysed one. */
async function recording(node: PlatformNode, sourceId: string, name: string, files = 3): Promise<string> {
  const id = await node.store.allocate();
  await fs.writeFile(path.join(node.store.videoDir(id), 'source.mp4'), 'x');
  await fs.mkdir(node.store.framesDir(id), { recursive: true });
  for (let i = 1; i <= files; i++) await fs.writeFile(path.join(node.store.framesDir(id), `${String(i).padStart(7, '0')}.jpg`), 'jpg');
  const entry = node.store.register({ id, name, sourceFile: 'source.mp4', sizeBytes: 1, sampleFps: 1, detail: 'standard', sourceId });
  entry.info.status = 'ready';
  await node.store.persistMeta(entry);
  return id;
}

/** A located fix stored next to the recording, read the way the engine reads it at start. */
async function located(node: PlatformNode, videoId: string): Promise<void> {
  const fix: Fix & { engineVersion: number } = {
    videoId,
    status: 'ready',
    error: null,
    computedAt: 1,
    elapsedMs: 1000,
    location: { lat: 50, lon: 7, radiusKm: 5, confidence: 0.5, method: 'landmark', label: 'x', country: 'DE', countryName: 'Deutschland' },
    candidates: [],
    countries: [],
    time: { method: 'none', utc: null, date: null, dateSource: 'none', monthRange: null, timezone: null, windows: [], sunElevationBand: null, phase: null, confidence: 0, notes: [] },
    sun: null,
    heading: null,
    horizon: null,
    evidence: [],
    keyframes: [],
    stage: 'full',
    truth: null,
    engineVersion: ENGINE_VERSION,
  } as unknown as Fix & { engineVersion: number };
  await fs.mkdir(node.datum.dir(videoId), { recursive: true });
  await fs.writeFile(path.join(node.datum.dir(videoId), 'fix.json'), JSON.stringify(fix));
}

function multipart(files: { name: string; bytes: Buffer }[]): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----datumtest${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const f of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: video/mp4\r\n\r\n`), f.bytes, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

const list = async (h: Harness): Promise<DatasetInfo[]> => {
  const res = await h.app.inject({ method: 'GET', url: '/api/datum/datasets', headers: { cookie: h.lage } });
  assert.equal(res.statusCode, 200);
  return res.json() as DatasetInfo[];
};

test('dataset names: 2 to 80 characters, control characters and runs of spaces cleaned', () => {
  assert.equal(cleanDatasetName('  Fahrten   Mai\u0000 '), 'Fahrten Mai');
  assert.equal(cleanDatasetName('x'), null);
  assert.equal(cleanDatasetName('a'.repeat(81)), null);
  assert.equal(cleanDatasetName('a'.repeat(80)), 'a'.repeat(80));
  assert.equal(cleanDatasetName(42), null);
});

test('list, create, rename: counts per dataset, the inbox only with recordings, read-only roles refused', async () => {
  const h = await harness();
  try {
    h.node.sources.create({ id: 'referenz', name: 'Referenzbestand', nameEn: 'Reference set', kind: 'upload', owner: 'DATUM', description: '', lat: 0, lon: 0, mode: 'archive', shared: false });
    const r1 = await recording(h.node, 'referenz', 'datum-001.mp4');
    await recording(h.node, 'referenz', 'datum-002.mp4');
    await located(h.node, r1);
    await h.node.datum.init();

    assert.equal((await h.app.inject({ method: 'GET', url: '/api/datum/datasets' })).statusCode, 401);
    assert.equal((await h.app.inject({ method: 'GET', url: '/api/datum/datasets', headers: { cookie: h.aufsicht } })).statusCode, 403);
    let datasets = await list(h);
    assert.deepEqual(
      datasets.map((d) => [d.id, d.name, d.nameEn, d.reference, d.recordings, d.located]),
      [['referenz', 'Referenzbestand', 'Reference set', true, 2, 1]],
      'the empty inbox is not listed',
    );
    assert.equal(typeof datasets[0]?.createdAt, 'number');

    // Create: source.write, a valid and unused name.
    const post = (cookie: string, payload: unknown, lang = 'de') =>
      h.app.inject({ method: 'POST', url: '/api/datum/datasets', headers: { cookie, 'accept-language': lang }, payload: payload as Record<string, unknown> });
    assert.equal((await post(h.aufsicht, { name: 'Fahrten' })).statusCode, 403);
    assert.equal((await post(h.lage, { name: 'x' })).statusCode, 400);
    const tooLong = await post(h.lage, { name: 'a'.repeat(81) }, 'en');
    assert.equal(tooLong.statusCode, 400);
    assert.match((tooLong.json() as { error: string }).error, /2 to 80 characters/);
    assert.equal((await post(h.lage, {})).statusCode, 400);
    const created = await post(h.lage, { name: '  Fahrten  Mai ' });
    assert.equal(created.statusCode, 201);
    const info = created.json() as DatasetInfo;
    assert.deepEqual({ ...info, createdAt: 0 }, { id: info.id, name: 'Fahrten Mai', reference: false, recordings: 0, located: 0, createdAt: 0 });
    assert.equal(typeof info.createdAt, 'number');
    const source = h.node.sources.get(info.id);
    assert.equal(source?.mode, 'archive', 'a dataset is an archive source');
    assert.equal(source?.shared, false);
    assert.equal((await post(h.lage, { name: 'fahrten mai' })).statusCode, 409, 'names are unique in any letter case');
    assert.equal((await post(h.lage, { name: 'Reference set' })).statusCode, 409, 'the English name counts as well');
    const createdEntry = h.node.ledger.list({ limit: 1 })[0];
    assert.equal(createdEntry?.action, 'datum.dataset.create');
    assert.equal(createdEntry?.summary, 'Datensatz „Fahrten Mai“ angelegt');
    assert.equal(createdEntry?.summaryEn, 'Dataset "Fahrten Mai" created');

    // Upload into the dataset through the upload route, and one into the inbox.
    const up = multipart([{ name: 'fahrt-1.mp4', bytes: Buffer.from('not really a video') }, { name: 'fahrt-2.mp4', bytes: Buffer.from('nor this') }]);
    const upload = await h.app.inject({ method: 'POST', url: `/api/videos?source=${info.id}&fps=1&detail=standard`, headers: { ...up.headers, cookie: h.lage }, payload: up.payload });
    assert.equal(upload.statusCode, 201, upload.body);
    const inbox = multipart([{ name: 'eigen.mp4', bytes: Buffer.from('mine') }]);
    assert.equal((await h.app.inject({ method: 'POST', url: '/api/videos?fps=1&detail=standard', headers: { ...inbox.headers, cookie: h.lage }, payload: inbox.payload })).statusCode, 201);
    datasets = await list(h);
    assert.deepEqual(
      datasets.map((d) => [d.id, d.name, d.nameEn, d.reference, d.recordings]),
      [
        ['referenz', 'Referenzbestand', 'Reference set', true, 2],
        ['eingang', 'Eigene Aufnahmen', 'Own recordings', false, 1],
        [info.id, 'Fahrten Mai', undefined, false, 2],
      ],
    );

    // Every entry of the fix list names its dataset, slim or not.
    for (const url of ['/api/datum/fixes', '/api/datum/fixes?slim=1']) {
      const fixes = (await h.app.inject({ method: 'GET', url, headers: { cookie: h.lage } })).json() as Fix[];
      assert.equal(fixes.length, 5);
      const byDataset = new Map<string, number>();
      for (const f of fixes) byDataset.set(String(f.datasetId), (byDataset.get(String(f.datasetId)) ?? 0) + 1);
      assert.deepEqual(Object.fromEntries(byDataset), { referenz: 2, eingang: 1, [info.id]: 2 }, url);
    }

    // Rename: source.write, validated, unique, recorded; an English name of the old one goes.
    const patch = (cookie: string, id: string, payload: unknown) => h.app.inject({ method: 'PATCH', url: `/api/datum/datasets/${id}`, headers: { cookie }, payload: payload as Record<string, unknown> });
    assert.equal((await patch(h.aufsicht, info.id, { name: 'Neu' })).statusCode, 403);
    assert.equal((await patch(h.lage, 'src_nothere', { name: 'Neu' })).statusCode, 404);
    assert.equal((await patch(h.lage, info.id, { name: 'N' })).statusCode, 400);
    assert.equal((await patch(h.lage, info.id, { name: 'referenzbestand' })).statusCode, 409);
    const renamed = await patch(h.lage, info.id, { name: 'Fahrten Juni' });
    assert.equal(renamed.statusCode, 200);
    assert.deepEqual([(renamed.json() as DatasetInfo).name, (renamed.json() as DatasetInfo).recordings], ['Fahrten Juni', 2]);
    const renameEntry = h.node.ledger.list({ limit: 1 })[0];
    assert.equal(renameEntry?.action, 'datum.dataset.rename');
    assert.equal(renameEntry?.summary, 'Datensatz „Fahrten Mai“ in „Fahrten Juni“ umbenannt');
    assert.equal(renameEntry?.summaryEn, 'Dataset "Fahrten Mai" renamed to "Fahrten Juni"');
    const ref = (await patch(h.leitung, 'referenz', { name: 'Referenz alt' })).json() as DatasetInfo;
    assert.equal(ref.name, 'Referenz alt');
    assert.equal(ref.nameEn, undefined, 'the English name of the old name no longer fits');
    assert.equal(ref.reference, true);
    // An exercise or live source is no dataset.
    h.node.sources.create({ id: 'kamera', name: 'Kamera', kind: 'camera', owner: '', description: '', lat: null, lon: null, mode: 'live', shared: false });
    assert.equal((await patch(h.lage, 'kamera', { name: 'Neu' })).statusCode, 404);
    assert.ok(!(await list(h)).some((d) => d.id === 'kamera'));
  } finally {
    await h.dispose();
  }
});

test('delete: every recording as DELETE /api/videos/:id does, recordings a case holds kept, own truths of the deleted ones removed', async () => {
  const h = await harness();
  try {
    const created = await h.app.inject({ method: 'POST', url: '/api/datum/datasets', headers: { cookie: h.lage }, payload: { name: 'Fahrten' } });
    const set = created.json() as DatasetInfo;
    const a = await recording(h.node, set.id, 'a.mp4');
    const b = await recording(h.node, set.id, 'b.mp4');
    const held = await recording(h.node, set.id, 'gehalten.mp4');
    const elsewhere = await recording(h.node, 'eingang', 'a.mp4');
    const truths = h.node.datum.truths;
    assert.ok(truths);
    await truths.put([
      { name: 'b.mp4', lat: 1, lon: 1 },
      { name: 'a', lat: 2, lon: 2 },
      { name: 'gehalten', lat: 3, lon: 3 },
      { name: 'fremd.mp4', lat: 4, lon: 4 },
    ]);
    const user = h.node.auth.listUsers().find((u) => u.id === 'lage');
    assert.ok(user);
    const file = await h.node.cases.create('Vorgang Brücke', 'md_test', user);
    file.items.push({ id: 'ev_1', videoId: held, frameNumber: 1, frameUrl: '', sourceId: set.id, sourceName: 'Fahrten', at: 0, note: '', sha256: '', query: null, box: null, addedBy: 'lage', addedAt: 0 });

    const del = (cookie: string, id: string, lang = 'de') => h.app.inject({ method: 'DELETE', url: `/api/datum/datasets/${id}`, headers: { cookie, 'accept-language': lang } });
    assert.equal((await del(h.aufsicht, set.id)).statusCode, 403, 'the auditor deletes nothing');
    const missing = await del(h.lage, 'src_nothere', 'en');
    assert.equal(missing.statusCode, 404);
    assert.equal((missing.json() as { error: string }).error, 'Dataset not found.');

    const before = h.node.ledger.length;
    const res = await del(h.lage, set.id);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json() as DatasetDeleteResult, { deleted: 2, kept: 1, removed: false });
    assert.equal(h.node.store.get(a), undefined);
    assert.equal(h.node.store.get(b), undefined);
    await assert.rejects(fs.access(h.node.store.videoDir(a)), 'the files are gone');
    assert.ok(h.node.store.get(held), 'the recording a case holds stays');
    assert.ok(h.node.store.get(elsewhere), 'another dataset is untouched');
    assert.equal(h.node.datum.get(a), null, 'its fix is gone');

    // One entry for the dataset first, then one per recording.
    const entries = h.node.ledger.list({ limit: h.node.ledger.length - before }).reverse();
    assert.deepEqual(entries.map((e) => e.action), ['datum.dataset.delete', 'recording.delete', 'recording.delete']);
    assert.equal(entries[0]?.summary, 'Datensatz „Fahrten“ gelöscht (2 Aufzeichnungen; 1 bleibt, da ein Vorgang sie hält)');
    assert.equal(entries[0]?.summaryEn, 'Dataset "Fahrten" deleted (2 recordings; 1 kept, held by a case)');
    assert.deepEqual(entries[0]?.data, { datasetId: set.id, name: 'Fahrten', reference: false, recordings: 2, kept: 1, truths: 1 });
    assert.deepEqual(entries.slice(1).map((e) => e.data['datasetId']), [set.id, set.id]);
    assert.equal((await h.node.ledger.verify()).ok, true);

    // b's truth went; a's stays (a recording of that name remains in the inbox), as do the rest.
    assert.deepEqual(truths.list().map((t) => t.name).sort(), ['a', 'fremd.mp4', 'gehalten']);

    let listed = (await list(h)).find((d) => d.id === set.id);
    assert.equal(listed?.recordings, 1, 'still listed with the recording that stays');

    // The single delete route goes the same way and refuses the held one with the same reason.
    const single = await h.app.inject({ method: 'DELETE', url: `/api/videos/${held}`, headers: { cookie: h.lage } });
    assert.equal(single.statusCode, 409);
    assert.equal((single.json() as { code: string }).code, 'held-by-case');
    assert.match((single.json() as { error: string }).error, /Vorgang Brücke/);

    // The case lets go: the rest goes, and the dataset with it.
    file.items.length = 0;
    const again = await del(h.lage, set.id);
    assert.deepEqual(again.json() as DatasetDeleteResult, { deleted: 1, kept: 0, removed: true });
    assert.equal(h.node.sources.get(set.id), undefined);
    listed = (await list(h)).find((d) => d.id === set.id);
    assert.equal(listed, undefined);
    assert.deepEqual(truths.list().map((t) => t.name).sort(), ['a', 'fremd.mp4']);

    // The inbox: emptied, it stays a source of the node but is no longer listed.
    assert.ok((await list(h)).some((d) => d.id === 'eingang'));
    assert.deepEqual((await del(h.lage, 'eingang')).json() as DatasetDeleteResult, { deleted: 1, kept: 0, removed: true });
    assert.ok(h.node.sources.get('eingang'));
    assert.ok(!(await list(h)).some((d) => d.id === 'eingang'));
    // The last a.mp4 went with the inbox, and its truth with it; a truth for no recording stays.
    assert.deepEqual(truths.list().map((t) => t.name), ['fremd.mp4']);

    // Single deletion still answers 204 and leaves its entry; the recording's own truth goes too,
    // unless another recording of the same name still answers to it.
    const lone = await recording(h.node, 'eingang', 'allein.mp4');
    const twinA = await recording(h.node, 'eingang', 'zwilling.mp4');
    const twinB = await recording(h.node, 'eingang', 'zwilling.mp4');
    await truths.put([{ name: 'allein.mp4', lat: 5, lon: 5 }, { name: 'zwilling', lat: 6, lon: 6 }]);
    assert.equal((await h.app.inject({ method: 'DELETE', url: `/api/videos/${lone}`, headers: { cookie: h.lage } })).statusCode, 204);
    assert.equal(h.node.ledger.list({ limit: 1 })[0]?.summary, 'Aufzeichnung „allein.mp4“ gelöscht');
    assert.equal(truths.lookup('allein.mp4'), null, 'the truth of a deleted recording does not stay behind');
    assert.equal((await h.app.inject({ method: 'DELETE', url: `/api/videos/${twinA}`, headers: { cookie: h.lage } })).statusCode, 204);
    assert.ok(truths.lookup('zwilling.mp4'), 'the other recording of that name still answers to it');
    assert.equal((await h.app.inject({ method: 'DELETE', url: `/api/videos/${twinB}`, headers: { cookie: h.lage } })).statusCode, 204);
    assert.equal(truths.lookup('zwilling.mp4'), null);
    assert.deepEqual(truths.list().map((t) => t.name), ['fremd.mp4']);
    assert.equal((await h.app.inject({ method: 'DELETE', url: `/api/videos/${lone}`, headers: { cookie: h.lage } })).statusCode, 404);
  } finally {
    await h.dispose();
  }
});

test('the reference set can be deleted, and 60 recordings go within seconds without blocking the node', async () => {
  const h = await harness();
  try {
    h.node.sources.create({ id: 'referenz', name: 'Referenzbestand', nameEn: 'Reference set', kind: 'upload', owner: 'DATUM', description: '', lat: 0, lon: 0, mode: 'archive', shared: false });
    for (let i = 1; i <= 60; i++) await recording(h.node, 'referenz', `datum-${String(i).padStart(3, '0')}.mp4`, 40);
    assert.equal((await list(h))[0]?.recordings, 60);

    // The event loop keeps turning while the dataset is deleted.
    let last = performance.now();
    let longest = 0;
    const ticker = setInterval(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 10);
    const started = performance.now();
    const res = await h.app.inject({ method: 'DELETE', url: '/api/datum/datasets/referenz', headers: { cookie: h.leitung, 'accept-language': 'en' } });
    const took = performance.now() - started;
    clearInterval(ticker);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json() as DatasetDeleteResult, { deleted: 60, kept: 0, removed: true });
    console.log(`  60 recordings deleted in ${Math.round(took)} ms, longest pause of the event loop ${Math.round(longest)} ms`);
    assert.ok(took < 8000, `took ${Math.round(took)} ms`);
    assert.ok(longest < 1000, `the event loop stood still for ${Math.round(longest)} ms`);
    assert.equal(h.node.store.all().length, 0);
    assert.equal(h.node.sources.get('referenz'), undefined, 'the source goes with the last recording');
    assert.deepEqual(await list(h), []);
    const entry = h.node.ledger.list({ limit: 200, action: 'datum.dataset.delete' })[0];
    assert.equal(entry?.data['reference'], true);
    assert.equal(entry?.summaryEn, 'Dataset "Reference set" deleted (60 recordings)');
    assert.equal(h.node.ledger.list({ limit: 200, action: 'recording.delete' }).length, 60);
  } finally {
    await h.dispose();
  }
});
