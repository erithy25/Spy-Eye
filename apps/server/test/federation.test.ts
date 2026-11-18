import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Federation, sign, type PeerRecord } from '../src/intel/federation.js';

const peer: PeerRecord = {
  id: 'trier',
  name: 'Lagezentrum Trier',
  operator: 'Übung',
  region: 'Trier',
  url: 'http://127.0.0.1:1',
  lat: 49.76,
  lon: 6.64,
  secret: 'a'.repeat(64),
};

async function federation(): Promise<Federation> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sicht-federation-'));
  const f = new Federation(
    path.join(dir, 'peers.json'),
    () => ({ id: 'koblenz', name: 'Koblenz', operator: 'Übung', region: 'Koblenz', lat: 50.36, lon: 7.59, version: 'test' }),
    () => '0'.repeat(64),
    () => undefined,
  );
  f.configure([peer]);
  return f;
}

test('a request signed with the shared key of the two nodes is accepted', async () => {
  const f = await federation();
  const body = JSON.stringify({ query: 'flooded street' });
  const timestamp = String(Date.now());
  assert.equal(f.authenticate('trier', timestamp, sign(peer.secret, timestamp, body), body)?.id, 'trier');
});

test('a changed body, a foreign key, an unknown node and an old timestamp are rejected', async () => {
  const f = await federation();
  const body = JSON.stringify({ query: 'flooded street' });
  const timestamp = String(Date.now());
  const signature = sign(peer.secret, timestamp, body);
  assert.equal(f.authenticate('trier', timestamp, signature, body.replace('street', 'square')), null);
  assert.equal(f.authenticate('trier', timestamp, sign('b'.repeat(64), timestamp, body), body), null);
  assert.equal(f.authenticate('mainz', timestamp, signature, body), null);
  const old = String(Date.now() - 10 * 60 * 1000);
  assert.equal(f.authenticate('trier', old, sign(peer.secret, old, body), body), null);
  assert.equal(f.authenticate('trier', timestamp, 'zz', body), null);
  assert.equal(f.authenticate(undefined, timestamp, signature, body), null);
});
