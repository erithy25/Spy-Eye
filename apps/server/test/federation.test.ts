import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Federation, PEER_BUDGET, PEER_BUDGET_WINDOW_MS, acceptHits, sign, type PeerRecord } from '../src/intel/federation.js';

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

const SEARCH = '/api/federation/search';
const HELLO = '/api/federation/hello';
let counter = 0;
/** Headers as the peer `trier` would send them to `koblenz`. */
function signed(body: string, patch: Partial<{ timestamp: string; nonce: string; from: string; to: string; path: string; secret: string }> = {}) {
  const timestamp = patch.timestamp ?? String(Date.now());
  const nonce = patch.nonce ?? (++counter).toString(16).padStart(24, '0');
  const signature = sign(patch.secret ?? peer.secret, { timestamp, nonce, from: patch.from ?? 'trier', to: patch.to ?? 'koblenz', path: patch.path ?? SEARCH, body });
  return { node: 'trier', timestamp, nonce, signature };
}

test('a request signed with the shared key of the two nodes is accepted', async () => {
  const f = await federation();
  const body = JSON.stringify({ query: 'flooded street' });
  assert.equal(f.authenticate(signed(body), SEARCH, body)?.id, 'trier');
});

test('a changed body, a foreign key, an unknown node and an old timestamp are rejected', async () => {
  const f = await federation();
  const body = JSON.stringify({ query: 'flooded street' });
  assert.equal(f.authenticate(signed(body), SEARCH, body.replace('street', 'square')), null);
  assert.equal(f.authenticate(signed(body, { secret: 'b'.repeat(64) }), SEARCH, body), null);
  assert.equal(f.authenticate({ ...signed(body), node: 'mainz' }, SEARCH, body), null);
  const old = String(Date.now() - 10 * 60 * 1000);
  assert.equal(f.authenticate(signed(body, { timestamp: old }), SEARCH, body), null);
  assert.equal(f.authenticate({ ...signed(body), signature: 'zz' }, SEARCH, body), null);
  assert.equal(f.authenticate({ ...signed(body), node: undefined }, SEARCH, body), null);
  assert.equal(f.authenticate({ ...signed(body), nonce: undefined }, SEARCH, body), null);
});

test('a request is accepted once, only on its path and only by the node it was signed for', async () => {
  const f = await federation();
  const body = JSON.stringify({ query: 'flooded street' });

  // The same request a second time.
  const once = signed(body);
  assert.equal(f.authenticate(once, SEARCH, body)?.id, 'trier');
  assert.equal(f.authenticate(once, SEARCH, body), null);

  // Signed for one path, delivered on another.
  assert.equal(f.authenticate(signed(body, { path: HELLO }), SEARCH, body), null);

  // What koblenz itself sent to trier, sent back to koblenz under trier's name.
  assert.equal(f.authenticate(signed(body, { from: 'koblenz', to: 'trier' }), SEARCH, body), null);

  // Signed by trier for mainz, delivered to koblenz.
  assert.equal(f.authenticate(signed(body, { to: 'mainz' }), SEARCH, body), null);

  // A fresh request still passes.
  assert.equal(f.authenticate(signed(body), SEARCH, body)?.id, 'trier');
});

test('a field of the signature cannot be moved into its neighbour', async () => {
  const f = await federation();
  const body = 'x';
  // Same bytes under the key if the fields were merely concatenated: nonce "aa…" + from "trier".
  const headers = signed(body);
  const shifted = { ...headers, nonce: `${headers.nonce}0` };
  assert.equal(f.authenticate(shifted, SEARCH, body), null);
  // A line feed inside a header value never reaches the key.
  assert.equal(f.authenticate({ ...headers, timestamp: `${headers.timestamp}\n` }, SEARCH, body), null);
});

test('a peer has a budget of questions per window', async () => {
  const f = await federation();
  const start = 1_000_000;
  for (let i = 0; i < PEER_BUDGET; i++) assert.equal(f.spend('trier', start + i).allowed, true);
  assert.deepEqual(f.spend('trier', start + PEER_BUDGET), { allowed: false, first: true });
  assert.deepEqual(f.spend('trier', start + PEER_BUDGET + 1), { allowed: false, first: false });
  // Another peer is not affected, and the window passes.
  assert.equal(f.spend('mainz', start + PEER_BUDGET).allowed, true);
  assert.equal(f.spend('trier', start + PEER_BUDGET + PEER_BUDGET_WINDOW_MS + 5).allowed, true);
});

test('of a peer answer only embedded previews with plausible fields are kept', () => {
  const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')}`;
  const good = { sourceName: 'Erkunder · Pfalzel', sourceKind: 'vehicle', lat: 49.78, lon: 6.69, at: 1794981234000, confidence: 0.82, score: 0.14, thumbnail: jpeg, tags: [{ label: 'flooded field', p: 0.9 }] };
  const hits = acceptHits(
    [
      good,
      // An address instead of a picture: the console would fetch it with the analyst's session.
      { ...good, thumbnail: 'api/search?q=angela%20merkel&federated=1' },
      { ...good, thumbnail: 'https://example.org/x.jpg' },
      { ...good, thumbnail: 'data:image/svg+xml;base64,PHN2Zz4=' },
      { ...good, thumbnail: `${jpeg}" onerror="x` },
      { ...good, confidence: 'high' },
      null,
      'text',
      { ...good, sourceName: 'x'.repeat(5000), sourceKind: 'tank', lat: 400, lon: 'east', confidence: 7, tags: [{ label: 'y'.repeat(500), p: 3 }, { label: 5 }, 1, 2, 3] },
    ],
    12,
  );
  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0], good);
  assert.equal(hits[1]?.sourceName.length, 120);
  assert.equal(hits[1]?.sourceKind, 'upload');
  assert.equal(hits[1]?.lat, null);
  assert.equal(hits[1]?.lon, null);
  assert.equal(hits[1]?.confidence, 1);
  assert.deepEqual(hits[1]?.tags, [{ label: 'y'.repeat(60), p: 1 }]);

  // Never more than was asked for, whatever arrives.
  assert.equal(acceptHits(Array.from({ length: 500 }, () => good), 12).length, 12);
  assert.deepEqual(acceptHits({ length: 3 }, 12), []);
  assert.deepEqual(acceptHits(undefined, 12), []);
});
