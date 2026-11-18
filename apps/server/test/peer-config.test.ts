import assert from 'node:assert/strict';
import { test } from 'node:test';
import { externalPeer, pairSecret } from '../src/intel/peerConfig.ts';

const master = 'ein-gemeinsames-geheimnis-beider-behoerden';

test('two nodes derive the same key for their pair, and another pair gets another key', () => {
  assert.equal(pairSecret(master, 'koblenz', 'trier'), pairSecret(master, 'trier', 'koblenz'));
  assert.notEqual(pairSecret(master, 'koblenz', 'trier'), pairSecret(master, 'koblenz', 'mainz'));
  assert.notEqual(pairSecret(master, 'koblenz', 'trier'), pairSecret(`${master}x`, 'koblenz', 'trier'));
  assert.match(pairSecret(master, 'a', 'b'), /^[0-9a-f]{64}$/);
});

test('a peer on another machine is described with its address and gets the key of the pair', () => {
  const peer = externalPeer('nodes.json', 'koblenz', { id: 'trier', name: ' Lagezentrum Trier ', url: 'https://sicht.trier.example/', lat: 49.76, lon: 6.64 }, master);
  assert.deepEqual(peer, {
    id: 'trier',
    name: 'Lagezentrum Trier',
    operator: '',
    region: '',
    url: 'https://sicht.trier.example',
    lat: 49.76,
    lon: 6.64,
    secret: pairSecret(master, 'koblenz', 'trier'),
  });
  // The other side, configured on its own machine, arrives at the same key.
  const back = externalPeer('nodes.json', 'trier', { id: 'koblenz', name: 'Lagezentrum Koblenz', url: 'http://192.168.1.20:8787' }, master);
  assert.equal(back.secret, peer.secret);
  assert.equal(back.url, 'http://192.168.1.20:8787');
  // A key given for the pair is used as it is.
  const own = 'k'.repeat(40);
  assert.equal(externalPeer('nodes.json', 'koblenz', { id: 'mainz', name: 'Mainz', url: 'http://10.0.0.5:8787', secret: own }, undefined).secret, own);
});

test('an incomplete or unsafe description of a peer is refused with the reason', () => {
  const bad: [Record<string, unknown>, RegExp][] = [
    [{ id: 'Trier!', name: 'x', url: 'http://h:1' }, /"id"/],
    [{ id: 'koblenz', name: 'x', url: 'http://h:1' }, /eigener Nachbar/],
    [{ id: 'trier', name: '', url: 'http://h:1' }, /"name" fehlt/],
    [{ id: 'trier', name: 'x', url: 'trier' }, /keine Adresse/],
    [{ id: 'trier', name: 'x', url: 'ftp://h/x' }, /http:\/\/ oder https:\/\//],
    [{ id: 'trier', name: 'x', url: 'https://user:pw@h/x' }, /keine Zugangsdaten/],
    [{ id: 'trier', name: 'x', url: 'http://h:1', secret: 'kurz' }, /kürzer als 32/],
  ];
  for (const [peer, reason] of bad) {
    assert.throws(() => externalPeer('nodes.json', 'koblenz', peer as never, master), reason, JSON.stringify(peer));
  }
  // Without any key there is no federation.
  assert.throws(() => externalPeer('nodes.json', 'koblenz', { id: 'trier', name: 'x', url: 'http://h:1' }, undefined), /fehlt ein Schlüssel/);
  assert.throws(() => externalPeer('nodes.json', 'koblenz', { id: 'trier', name: 'x', url: 'http://h:1' }, 'zu kurz'), /fehlt ein Schlüssel/);
});
