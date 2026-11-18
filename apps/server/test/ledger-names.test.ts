import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Fastify from 'fastify';
import { config } from '../src/config.js';
import { Auth } from '../src/core/auth.js';
import { PlatformNode, type SharedRuntime } from '../src/node.js';
import { registerRoutes } from '../src/routes.js';

/**
 * English twins of ledger texts that name an account: the English console reads "Operations
 * command signed in", not the German account name in an English sentence.
 */

// No world model thread for a node that never locates anything.
process.env['DATUM_WORLDMODEL'] = '0';

test('demonstration accounts have their English names, also when seeded before there were any', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'auth-names-'));
  try {
    const fresh = new Auth(path.join(dir, 'fresh.json'));
    await fresh.open('geheim-123');
    assert.equal(fresh.getUser('leitung')?.nameEn, 'Operations command');
    assert.equal(fresh.getUser('lage')?.nameEn, 'Situation desk');
    assert.equal(fresh.getUser('aufsicht')?.nameEn, 'Oversight');
    assert.equal(fresh.login('leitung', 'geheim-123')?.user.nameEn, 'Operations command');

    // users.json of an older node: no English names stored. The seeded accounts still get theirs;
    // a renamed one and an account of the operator's own do not (their name is not ours to translate).
    const older = path.join(dir, 'older.json');
    const record = (id: string, name: string, demo: boolean): Record<string, unknown> => ({ id, name, role: 'operator', unit: 'Stab', salt: 's', hash: '00', demo });
    await fs.writeFile(older, JSON.stringify([record('leitung', 'Einsatzleitung', true), record('lage', 'Lagedienst Nord', true), record('mueller', 'Müller', false)]));
    const auth = new Auth(older);
    await auth.open('geheim-123');
    assert.equal(auth.getUser('leitung')?.nameEn, 'Operations command');
    assert.equal(auth.getUser('lage')?.nameEn, undefined);
    assert.equal(auth.getUser('mueller')?.nameEn, undefined);
    assert.equal('nameEn' in (auth.getUser('mueller') ?? {}), false, 'no empty field');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the sign-in and sign-out ledger entries name the account in English in their English twin', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ledger-names-'));
  const dataDir = path.join(dir, 'data');
  await fs.mkdir(path.join(dataDir, 'videos'), { recursive: true });
  const shared = {
    model: { dim: 4, ready: false, state: { phase: 'loading' }, onState: () => () => undefined },
    faces: { ready: false },
    hazard: null,
    ready: new Promise(() => undefined),
  } as unknown as SharedRuntime;
  const node = new PlatformNode(
    { id: 'datum', name: 'DATUM · Ortungsstelle', nameEn: 'DATUM · Location desk', operator: 'Test', region: '', lat: 0, lon: 0, host: '127.0.0.1', port: 0, dataDir, peers: [], exercise: false },
    shared,
  );
  await node.ledger.open();
  await node.auth.open(config.demoPassword);
  await node.mandates.open();
  await node.sources.open();
  await node.cases.open();
  node.pipeline.setReadyGate(new Promise(() => undefined));
  node.datum.stop();
  const app = Fastify({ bodyLimit: 1024 * 1024 });
  try {
    await registerRoutes(app, node, false);
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/api/login', payload: { user: 'leitung', password: config.demoPassword } });
    assert.equal(res.statusCode, 200);
    const cookie = String(res.headers['set-cookie']).split(';')[0] as string;
    const out = await app.inject({ method: 'POST', url: '/api/logout', headers: { cookie } });
    assert.equal(out.statusCode, 204);
    const entries = node.ledger.list({ limit: 10 });
    const login = entries.find((e) => e.action === 'auth.login');
    assert.equal(login?.summary, 'Einsatzleitung angemeldet');
    assert.equal(login?.summaryEn, 'Operations command signed in');
    const logout = entries.find((e) => e.action === 'auth.logout');
    assert.equal(logout?.summary, 'Einsatzleitung abgemeldet');
    assert.equal(logout?.summaryEn, 'Operations command signed out');
  } finally {
    await app.close();
    await node.sources.flush();
    // The user list is written shortly after the first start; let it land before the folder goes.
    await new Promise((resolve) => setTimeout(resolve, 250));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the DATUM node carries its English name for the English twin of "Knoten … gestartet"', async () => {
  const file = JSON.parse(await fs.readFile(path.join(import.meta.dirname, '..', '..', '..', 'nodes.datum.json'), 'utf8')) as { nodes: { name: string; nameEn?: string }[] };
  const datum = file.nodes[0];
  assert.equal(datum?.name, 'DATUM · Ortungsstelle');
  assert.equal(datum?.nameEn, 'DATUM · Location desk', 'the name the English console shows for it');
});
