import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { can, type Permission } from '../src/core/auth.js';
import { Ledger } from '../src/core/ledger.js';
import type { Fix, Keyframe } from '../src/datum/contract.js';
import { registerDatumRoutes, slimFix, etagMatches, weakEtag } from '../src/datum/routes.js';
import { DatumSettingsStore, plausibleMapillaryKey, worldModelState, type EnvReader } from '../src/datum/settings.js';
import { StreetImageCache, type StreetFetch } from '../src/datum/streetImage.js';
import type { PlatformNode, RequestContext } from '../src/node.js';
import type { Role } from '../src/types.js';

const KEY = 'MLY|4242424242424242|0123456789abcdefSECRET';
const dirs: string[] = [];
after(async () => {
  for (const d of dirs) await fs.rm(d, { recursive: true, force: true });
});

async function tempDir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-settings-'));
  dirs.push(d);
  return d;
}

function envOf(values: Record<string, string>): EnvReader {
  return () => values;
}

// ------------------------------------------------------------------ the store

test('street-level comparison is on by default, persists per node and is forced off by DATUM_STREETLEVEL=0', async () => {
  const dir = await tempDir();
  const env: Record<string, string> = {};
  const a = new DatumSettingsStore(dir, { env: envOf(env), geoclipDir: dir });
  assert.equal(a.streetLevelEnabled(), true);
  assert.deepEqual(a.view().streetLevel, { enabled: true, forcedOff: false, providers: ['panoramax'], mapillaryKey: false, mapillaryKeySource: 'none' });
  await a.setStreetLevel(false);
  assert.equal(a.streetLevelEnabled(), false);
  const stored = JSON.parse(await fs.readFile(path.join(dir, 'datum', 'settings.json'), 'utf8')) as unknown;
  assert.deepEqual(stored, { version: 1, streetLevel: { enabled: false } });
  // Another store on the same directory (a restart) reads it back.
  const b = new DatumSettingsStore(dir, { env: envOf(env), geoclipDir: dir });
  assert.equal(b.streetLevelEnabled(), false);
  await b.setStreetLevel(true);
  // The environment wins, and says so; the stored choice stays visible.
  env['DATUM_STREETLEVEL'] = '0';
  assert.equal(b.streetLevelEnabled(), false);
  assert.equal(b.view().streetLevel.forcedOff, true);
  assert.equal(b.view().streetLevel.enabled, true);
  env['DATUM_STREETLEVEL'] = '1';
  assert.equal(b.streetLevelEnabled(), true);
  // Two nodes in one process have separate settings.
  const other = new DatumSettingsStore(await tempDir(), { env: envOf({}) });
  assert.equal(other.streetLevelEnabled(), true);
});

test('a damaged settings file keeps the default instead of switching anything off', async () => {
  const dir = await tempDir();
  await fs.mkdir(path.join(dir, 'datum'), { recursive: true });
  await fs.writeFile(path.join(dir, 'datum', 'settings.json'), '{ not json');
  const s = new DatumSettingsStore(dir, { env: envOf({}) });
  assert.equal(s.streetLevelEnabled(), true);
});

test('Mapillary keys: plausible client tokens only, trimmed, stored 0600, never in the view', async () => {
  assert.equal(plausibleMapillaryKey(`  ${KEY}\n`), KEY);
  for (const bad of ['', 'MLY|short', 'abc'.repeat(10), `MLY|123|${'x'.repeat(300)}`, 'MLY|12 34|abcdefghijklmnopqrstu', 'MLY|1234|abc\r\nX-Evil: 1xxxxxxx', 'OAuth MLY|1234|abcdefghijklmnop', 'MLY||abcdefghijklmnopqrst', 'MLY|1234|abcd|efghijklmnop']) {
    assert.equal(plausibleMapillaryKey(bad), null, JSON.stringify(bad));
  }
  const dir = await tempDir();
  const s = new DatumSettingsStore(dir, { env: envOf({}) });
  const changes: unknown[] = [];
  s.onChange((v) => changes.push(v));
  assert.deepEqual(await s.setMapillaryKey('not a key at all, sorry'), { refused: 'implausible' });
  const ok = await s.setMapillaryKey(` ${KEY} `);
  assert.ok('view' in ok);
  assert.equal(ok.removed, false);
  assert.equal(s.mapillaryKey(), KEY);
  assert.deepEqual(ok.view.streetLevel.providers, ['panoramax', 'mapillary']);
  assert.equal(ok.view.streetLevel.mapillaryKeySource, 'stored');
  assert.ok(!JSON.stringify(ok.view).includes('SECRET'));
  assert.ok(!JSON.stringify(changes).includes('SECRET'));
  const file = path.join(dir, 'datum', 'mapillary-key');
  assert.equal((await fs.readFile(file, 'utf8')).trim(), KEY);
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  // Read back after a restart.
  assert.equal(new DatumSettingsStore(dir, { env: envOf({}) }).mapillaryKey(), KEY);
  // Removed with an empty string.
  const removed = await s.setMapillaryKey('   ');
  assert.ok('view' in removed && removed.removed);
  assert.equal(s.mapillaryKey(), null);
  await assert.rejects(fs.access(file));
  assert.equal(changes.length, 2);
  // A key edited by hand into something implausible is not used.
  await fs.writeFile(file, 'garbage with spaces');
  assert.equal(new DatumSettingsStore(dir, { env: envOf({}) }).mapillaryKey(), null);
});

test('MAPILLARY_TOKEN in the environment wins and cannot be changed from the console', async () => {
  const dir = await tempDir();
  const env: Record<string, string> = {};
  const s = new DatumSettingsStore(dir, { env: envOf(env) });
  await s.setMapillaryKey(KEY);
  env['MAPILLARY_TOKEN'] = 'MLY|1|fromtheenvironment';
  assert.equal(s.mapillaryKey(), 'MLY|1|fromtheenvironment');
  assert.equal(s.view().streetLevel.mapillaryKeySource, 'env');
  assert.deepEqual(await s.setMapillaryKey(''), { refused: 'env' });
  assert.deepEqual(await s.setMapillaryKey(KEY), { refused: 'env' });
  // A malformed environment token is not used, and not replaced by the stored one.
  env['MAPILLARY_TOKEN'] = 'has a space';
  assert.equal(s.mapillaryKey(), null);
  assert.equal(s.envKeyMalformed(), true);
  assert.equal(s.view().streetLevel.mapillaryKey, false);
});

test('the world model is reported from the weights on disk', async () => {
  const dir = await tempDir();
  assert.deepEqual(worldModelState({}, dir), { available: false, precision: 'fp32' });
  for (const f of ['onnx/vision_model_int8.onnx', 'onnx/location_model.onnx', 'gps_gallery/coordinates_100K.bin']) {
    await fs.mkdir(path.dirname(path.join(dir, f)), { recursive: true });
    await fs.writeFile(path.join(dir, f), 'x');
  }
  assert.deepEqual(worldModelState({}, dir), { available: true, precision: 'int8' });
  assert.deepEqual(worldModelState({ DATUM_GEOCLIP_PRECISION: 'fp32' }, dir), { available: false, precision: 'fp32' });
});

// ------------------------------------------------------------------ routes

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 3)]);

function keyframe(frame: number): Keyframe {
  return { frame, time: frame / 25, imageUrl: `media/v/frames/${frame}.jpg`, spaceUrl: null, skyline: [0.2, 0.3] };
}

function fixOf(videoId: string, refSources: string[]): Fix {
  return {
    videoId,
    status: 'ready',
    error: null,
    computedAt: 5,
    elapsedMs: 1200,
    location: { lat: 48.85, lon: 2.29, radiusKm: 1, confidence: 0.7, method: 'streetlevel', label: 'Paris', labelEn: 'Paris', country: 'FR', countryName: 'Frankreich' },
    candidates: Array.from({ length: 9 }, (_, i) => ({ lat: 48 + i, lon: 2, label: `c${i}`, country: 'FR', score: 0.1, radiusKm: 5 })),
    countries: Array.from({ length: 8 }, (_, i) => ({ iso: `C${i}`, name: `n${i}`, p: 0.1 })),
    time: { method: 'none', utc: null, date: null, dateSource: 'none', monthRange: null, timezone: null, windows: [], sunElevationBand: null, phase: 'unknown', confidence: 0, notes: ['a'], notesEn: ['a'] },
    sun: { date: '2024-06-21', at: null, path: [{ t: 1, az: 2, el: 3 }], sunrise: null, sunset: null, solarNoon: null },
    heading: null,
    horizon: { matched: false, errorDeg: null, profile: [1, 2, 3] },
    evidence: [
      { kind: 'landmark', label: 'Referenz', labelEn: 'Reference', detail: 'd', detailEn: 'd', weight: 0.2, refImage: '/api/datum/gallery/Q1.jpg' },
      ...refSources.map((u, i) => ({ kind: 'streetlevel' as const, label: `S${i}`, labelEn: `S${i}`, detail: 'd', detailEn: 'd', weight: 0.1, refSource: u, refUrl: 'https://viewer.example.org/' })),
    ],
    keyframes: [keyframe(0), keyframe(25), keyframe(50)],
    trace: [{ label: 'Ort', ms: 3 }],
    stage: 'full',
    truth: null,
  };
}

interface Harness {
  app: FastifyInstance;
  ledger: Ledger;
  dir: string;
  fixes: Fix[];
  env: Record<string, string>;
  fetched: string[];
}

async function harness(thumbs: (url: string) => Response = () => new Response(new Uint8Array(JPEG), { status: 200, headers: { 'content-type': 'image/jpeg' } })): Promise<Harness> {
  const dir = await tempDir();
  const ledger = new Ledger(path.join(dir, 'ledger.jsonl'));
  await ledger.open();
  const fixes: Fix[] = [];
  const env: Record<string, string> = {};
  const fetched: string[] = [];
  const fetchImpl: StreetFetch = async (url) => {
    fetched.push(url);
    return thumbs(url);
  };
  const node = {
    cfg: { dataDir: dir },
    ledger,
    store: { get: (id: string) => (fixes.some((f) => f.videoId === id) ? {} : undefined) },
    datum: {
      list: () => fixes,
      get: (id: string) => fixes.find((f) => f.videoId === id) ?? null,
    },
  } as unknown as PlatformNode;
  // The session is the X-Test-Role header; the permission check is the node's own.
  const need = (request: FastifyRequest, reply: FastifyReply, permission: Permission | null): RequestContext | null => {
    const role = request.headers['x-test-role'];
    if (typeof role !== 'string') {
      void reply.code(401).send({ error: 'Nicht angemeldet.' });
      return null;
    }
    if (permission !== null && !can(role as Role, permission)) {
      void reply.code(403).send({ error: 'Für diese Rolle nicht zulässig.' });
      return null;
    }
    return { user: { id: role, name: role, role: role as Role, unit: '' }, mandate: null, lang: request.headers['x-test-lang'] === 'en' ? 'en' : 'de' } as unknown as RequestContext;
  };
  const sendError = (reply: FastifyReply, status: number, message: string): FastifyReply => reply.code(status).send({ error: message });
  const app = Fastify();
  registerDatumRoutes(app, node, need, sendError, {
    settings: new DatumSettingsStore(dir, { env: () => env, geoclipDir: dir }),
    streetImages: new StreetImageCache({ fetch: fetchImpl }),
  });
  await app.ready();
  return { app, ledger, dir, fixes, env, fetched };
}

const as = (role: Role, lang: 'de' | 'en' = 'de'): Record<string, string> => ({ 'x-test-role': role, 'x-test-lang': lang });

test('GET /api/datum/settings: every signed-in role, never the key', async () => {
  const h = await harness();
  assert.equal((await h.app.inject({ method: 'GET', url: '/api/datum/settings' })).statusCode, 401);
  for (const role of ['operator', 'supervisor', 'auditor'] as const) {
    const res = await h.app.inject({ method: 'GET', url: '/api/datum/settings', headers: as(role) });
    assert.equal(res.statusCode, 200, role);
    const body = res.json() as { streetLevel: { enabled: boolean; providers: string[] }; worldModel: { available: boolean } };
    assert.equal(body.streetLevel.enabled, true);
    assert.deepEqual(body.streetLevel.providers, ['panoramax']);
    assert.equal(body.worldModel.available, false);
  }
  await h.app.close();
});

test('PUT street-level: supervisor only, validated, recorded in both languages', async () => {
  const h = await harness();
  const put = (role: Role, payload: unknown) => h.app.inject({ method: 'PUT', url: '/api/datum/settings/streetlevel', headers: as(role), payload: payload as Record<string, unknown> });
  assert.equal((await put('operator', { enabled: false })).statusCode, 403);
  assert.equal((await put('auditor', { enabled: false })).statusCode, 403);
  assert.equal((await put('supervisor', { enabled: 'no' })).statusCode, 400);
  const res = await put('supervisor', { enabled: false });
  assert.equal(res.statusCode, 200);
  assert.equal((res.json() as { streetLevel: { enabled: boolean } }).streetLevel.enabled, false);
  const entry = h.ledger.list({ limit: 1 })[0];
  assert.equal(entry?.action, 'datum.settings.streetlevel');
  assert.equal(entry?.summary, 'Straßenbildvergleich ausgeschaltet');
  assert.equal(entry?.summaryEn, 'Street-level comparison switched off');
  assert.deepEqual(entry?.data, { enabled: false, forcedOff: false });
  // The chain still verifies with the English twin in it.
  assert.equal((await h.ledger.verify()).ok, true);
  await h.app.close();
});

test('PUT Mapillary key: supervisor only, 400 on nonsense, 409 from the environment, never echoed or recorded', async () => {
  const h = await harness();
  const put = (role: Role, key: unknown, lang: 'de' | 'en' = 'de') =>
    h.app.inject({ method: 'PUT', url: '/api/datum/settings/mapillary-key', headers: as(role, lang), payload: { key } as Record<string, unknown> });
  assert.equal((await put('operator', KEY)).statusCode, 403);
  assert.equal((await put('supervisor', 42)).statusCode, 400);
  const bad = await put('supervisor', 'hello world', 'en');
  assert.equal(bad.statusCode, 400);
  assert.match((bad.json() as { error: string }).error, /not a Mapillary key/);
  assert.ok(!bad.body.includes('hello world'));
  const ok = await put('supervisor', KEY);
  assert.equal(ok.statusCode, 200);
  assert.ok(!ok.body.includes('SECRET') && !ok.body.includes('4242424242424242'));
  const view = ok.json() as { streetLevel: { mapillaryKey: boolean; mapillaryKeySource: string; providers: string[] } };
  assert.equal(view.streetLevel.mapillaryKey, true);
  assert.equal(view.streetLevel.mapillaryKeySource, 'stored');
  assert.deepEqual(view.streetLevel.providers, ['panoramax', 'mapillary']);
  const read = await h.app.inject({ method: 'GET', url: '/api/datum/settings', headers: as('operator') });
  assert.ok(!read.body.includes('SECRET'));
  assert.equal((await put('supervisor', '')).statusCode, 200);
  const entries = h.ledger.list({ limit: 10 });
  assert.deepEqual(
    entries.map((e) => [e.summary, e.summaryEn]),
    [
      ['Mapillary-Schlüssel entfernt', 'Mapillary key removed'],
      ['Mapillary-Schlüssel hinterlegt', 'Mapillary key stored'],
    ],
  );
  const ledgerText = await fs.readFile(path.join(h.dir, 'ledger.jsonl'), 'utf8');
  assert.ok(!ledgerText.includes('SECRET') && !ledgerText.includes('4242424242424242'));
  h.env['MAPILLARY_TOKEN'] = 'MLY|7|fromtheenvironmentXX';
  const conflict = await put('supervisor', KEY);
  assert.equal(conflict.statusCode, 409);
  assert.ok(!conflict.body.includes('fromtheenvironment'));
  assert.equal(((await h.app.inject({ method: 'GET', url: '/api/datum/settings', headers: as('auditor') })).json() as { streetLevel: { mapillaryKeySource: string } }).streetLevel.mapillaryKeySource, 'env');
  await h.app.close();
});

test('the slim list keeps the shape, drops the bulk, and answers 304 to a matching ETag', async () => {
  const h = await harness();
  h.fixes.push(fixOf('aaaaaaaaaaaaaaaa', ['https://t.example.org/1.jpg']), { ...fixOf('bbbbbbbbbbbbbbbb', []), keyframes: [] });
  const full = await h.app.inject({ method: 'GET', url: '/api/datum/fixes', headers: as('operator') });
  assert.equal(full.statusCode, 200);
  const fullBody = full.json() as Fix[];
  assert.equal(fullBody[0]?.evidence.length, 2);
  assert.equal(fullBody[0]?.slim, undefined);
  assert.equal(fullBody[0]?.horizon?.profile, null);
  assert.deepEqual(fullBody[0]?.sun?.path, []);
  const etag = full.headers['etag'];
  assert.match(String(etag), /^W\/"[A-Za-z0-9_-]+"$/);
  assert.match(String(full.headers['cache-control']), /private/);
  const again = await h.app.inject({ method: 'GET', url: '/api/datum/fixes', headers: { ...as('operator'), 'if-none-match': String(etag) } });
  assert.equal(again.statusCode, 304);
  assert.equal(again.body, '');

  const slim = await h.app.inject({ method: 'GET', url: '/api/datum/fixes?slim=1', headers: as('operator') });
  assert.equal(slim.statusCode, 200);
  assert.notEqual(slim.headers['etag'], etag);
  const [a, b] = slim.json() as Fix[];
  assert.ok(a && b);
  assert.equal(a.slim, true);
  assert.deepEqual(a.evidence, []);
  assert.equal('trace' in a, false);
  assert.deepEqual(a.keyframes.map((k) => k.frame), [25]);
  assert.equal(a.candidates.length, 5);
  assert.equal(a.countries.length, 5);
  assert.equal(a.horizon?.profile, null);
  assert.equal(a.location?.label, 'Paris');
  assert.deepEqual(b.keyframes, []);
  assert.ok(slim.body.length < full.body.length);
  // Something changes: the tag changes with it.
  h.fixes.pop();
  const changed = await h.app.inject({ method: 'GET', url: '/api/datum/fixes', headers: { ...as('operator'), 'if-none-match': String(etag) } });
  assert.equal(changed.statusCode, 200);
  assert.equal((await h.app.inject({ method: 'GET', url: '/api/datum/fixes', headers: as('auditor') })).statusCode, 403);
  await h.app.close();
});

test('slimFix and ETag helpers', () => {
  const f = slimFix(fixOf('v', ['https://t.example.org/1.jpg']));
  assert.equal(f.slim, true);
  assert.equal(f.sun?.path.length, 0);
  const tag = weakEtag('abc');
  assert.equal(tag, weakEtag('abc'));
  assert.notEqual(tag, weakEtag('abd'));
  assert.ok(etagMatches(tag, tag));
  assert.ok(etagMatches(`"x", ${tag.slice(2)}`, tag));
  assert.ok(etagMatches('*', tag));
  assert.ok(!etagMatches(undefined, tag));
  assert.ok(!etagMatches('W/"other"', tag));
});

test('the street-picture proxy fetches only URLs stored in the fix, under the guards', async () => {
  const h = await harness((url) => {
    if (url.includes('/html')) return new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } });
    if (url.includes('/big')) return new Response(new Uint8Array(JPEG), { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': String(5 * 1024 * 1024) } });
    if (url.includes('/expired')) return new Response('URL signature expired', { status: 403 });
    return new Response(new Uint8Array(JPEG), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  });
  h.fixes.push(
    fixOf('aaaaaaaaaaaaaaaa', [
      'https://t.example.org/ok.jpg',
      'https://127.0.0.1/internal.jpg',
      'https://t.example.org/html',
      'https://t.example.org/big.jpg',
      'https://t.example.org/expired.jpg',
      'http://t.example.org/plain.jpg',
    ]),
  );
  const get = (url: string, role: Role = 'operator') => h.app.inject({ method: 'GET', url, headers: as(role) });
  const ok = await get('/api/datum/fixes/aaaaaaaaaaaaaaaa/street/0');
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers['content-type'], 'image/jpeg');
  assert.match(String(ok.headers['cache-control']), /^private/);
  assert.equal(ok.rawPayload.length, JPEG.length);
  assert.deepEqual(h.fetched, ['https://t.example.org/ok.jpg']);
  // Served from memory the second time.
  assert.equal((await get('/api/datum/fixes/aaaaaaaaaaaaaaaa/street/0')).statusCode, 200);
  assert.equal(h.fetched.length, 1);
  // Guards: internal host, wrong type, too large, expired, plain http.
  for (const n of [1, 2, 3, 4, 5]) assert.equal((await get(`/api/datum/fixes/aaaaaaaaaaaaaaaa/street/${n}`)).statusCode, 404, `picture ${n}`);
  assert.ok(!h.fetched.some((u) => u.includes('127.0.0.1') || u.startsWith('http:')));
  // Not in the fix: no request at all.
  const before = h.fetched.length;
  for (const url of ['/api/datum/fixes/aaaaaaaaaaaaaaaa/street/6', '/api/datum/fixes/aaaaaaaaaaaaaaaa/street/99', '/api/datum/fixes/ffffffffffffffff/street/0', '/api/datum/fixes/aaaaaaaaaaaaaaaa/street/-1', '/api/datum/fixes/aaaaaaaaaaaaaaaa/street/https%3A%2F%2Fevil.example.org%2Fx']) {
    assert.equal((await get(url)).statusCode, 404, url);
  }
  assert.equal(h.fetched.length, before);
  // Same rights as reading a fix.
  assert.equal((await get('/api/datum/fixes/aaaaaaaaaaaaaaaa/street/0', 'auditor')).statusCode, 403);
  assert.equal((await h.app.inject({ method: 'GET', url: '/api/datum/fixes/aaaaaaaaaaaaaaaa/street/0' })).statusCode, 401);
  await h.app.close();
});
