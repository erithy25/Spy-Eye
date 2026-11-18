import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  StreetImageCache,
  checkHost,
  fetchStreetImage,
  isPublicAddress,
  isSafeRemoteUrl,
  sniffImageType,
  streetImagePath,
  streetSources,
  withStreetImagePaths,
  type StreetFetch,
} from '../src/datum/streetImage.js';
import type { Evidence } from '../src/datum/contract.js';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP'), Buffer.alloc(50, 2)]);

function image(body: Buffer, type = 'image/jpeg', extra: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(body), { status: 200, headers: { 'content-type': type, ...extra } });
}

test('only public unicast addresses count as public, IPv4 and IPv6, mapped forms included', () => {
  for (const ok of ['93.184.216.34', '8.8.8.8', '2a00:1450:4001:82b::200e', '2606:4700::6810:85e5', '::ffff:93.184.216.34']) assert.ok(isPublicAddress(ok), ok);
  for (const bad of [
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '198.18.0.1',
    '::1',
    '::',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::10.0.0.1',
    '2001:db8::1',
    'not an address',
  ]) {
    assert.ok(!isPublicAddress(bad), bad);
  }
});

test('URLs: https on named hosts only, no internal names, ports, credentials or IP literals', () => {
  assert.ok(isSafeRemoteUrl('https://panoramax.ign.fr/api/pictures/x/thumb.jpg'));
  assert.ok(isSafeRemoteUrl('https://scontent-fra5-1.xx.fbcdn.net/m1/v/t6/a.jpg?ccb=10-5&oh=00_x'));
  for (const bad of [
    'http://panoramax.ign.fr/x.jpg',
    'https://127.0.0.1/x.jpg',
    'https://2130706433/x.jpg',
    'https://0x7f000001/x.jpg',
    'https://[::1]/x.jpg',
    'https://localhost/x.jpg',
    'https://printer.local/x.jpg',
    'https://nas.lan/x.jpg',
    'https://router.home.arpa/x.jpg',
    'https://intranet/x.jpg',
    'https://user:pw@example.org/x.jpg',
    'https://example.org:8443/x.jpg',
    'file:///etc/passwd',
    'not a url',
  ]) {
    assert.ok(!isSafeRemoteUrl(bad), bad);
  }
});

test('the first bytes decide the type: JPEG, PNG and WebP only', () => {
  assert.equal(sniffImageType(JPEG), 'image/jpeg');
  assert.equal(sniffImageType(PNG), 'image/png');
  assert.equal(sniffImageType(WEBP), 'image/webp');
  assert.equal(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffImageType(Buffer.from('GIF89a')), null);
  assert.equal(sniffImageType(Buffer.alloc(0)), null);
});

test('street pictures of a fix are numbered in evidence order, only those with a remote source', () => {
  const evidence: Evidence[] = [
    { kind: 'landmark', label: 'a', detail: '', weight: 0.5, refImage: '/api/datum/gallery/Q1.jpg' },
    { kind: 'streetlevel', label: 'b', detail: '', weight: 0.3, refSource: 'https://t.example.org/1.jpg' },
    { kind: 'streetlevel', label: 'c', detail: '', weight: 0, refSource: '' },
    { kind: 'streetlevel', label: 'd', detail: '', weight: 0.2, refSource: 'https://t.example.org/2.jpg' },
  ];
  assert.deepEqual(streetSources({ evidence }), ['https://t.example.org/1.jpg', 'https://t.example.org/2.jpg']);
  const out = withStreetImagePaths('vid_1', evidence);
  assert.deepEqual(
    out.map((e) => e.refImage),
    ['/api/datum/gallery/Q1.jpg', '/api/datum/fixes/vid_1/street/0', undefined, '/api/datum/fixes/vid_1/street/1'],
  );
  assert.equal(streetImagePath('a/b', 3), '/api/datum/fixes/a%2Fb/street/3');
});

test('a picture is fetched with a generic User-Agent, manual redirects and no credentials', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchImpl: StreetFetch = async (url, init) => {
    seen.push({ url, init });
    return image(JPEG);
  };
  const r = await fetchStreetImage('https://thumbs.example.org/a.jpg', { fetch: fetchImpl });
  assert.ok(r.ok);
  assert.equal(r.type, 'image/jpeg');
  assert.equal(r.body.length, JPEG.length);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.init.redirect, 'manual');
  const headers = seen[0]?.init.headers as Record<string, string>;
  assert.match(headers['User-Agent'] ?? '', /^DATUM\/0\.5 \(street-level thumbnail\)$/);
  assert.equal(headers['Authorization'], undefined);
  assert.equal(headers['Cookie'], undefined);
  // PNG and WebP pass too.
  assert.equal((await fetchStreetImage('https://t.example.org/p.png', { fetch: async () => image(PNG, 'image/png') })).ok, true);
  assert.equal((await fetchStreetImage('https://t.example.org/w.webp', { fetch: async () => image(WEBP, 'image/webp; charset=binary') })).ok, true);
});

test('redirects: at most two, each target checked again', async () => {
  const chain = (targets: string[]): StreetFetch => {
    let i = 0;
    return async () => {
      const next = targets[i++];
      return next ? new Response(null, { status: 302, headers: { location: next } }) : image(JPEG);
    };
  };
  assert.equal((await fetchStreetImage('https://a.example.org/x.jpg', { fetch: chain(['https://b.example.org/y.jpg', '/z.jpg']) })).ok, true);
  const tooMany = await fetchStreetImage('https://a.example.org/x.jpg', { fetch: chain(['https://b.example.org/1', 'https://b.example.org/2', 'https://b.example.org/3']) });
  assert.deepEqual(tooMany, { ok: false, failure: 'refused' });
  for (const target of ['https://127.0.0.1/x.jpg', 'http://b.example.org/x.jpg', 'https://localhost/x.jpg', 'https://[::1]/x.jpg', 'file:///etc/passwd']) {
    const r = await fetchStreetImage('https://a.example.org/x.jpg', { fetch: chain([target]) });
    assert.deepEqual(r, { ok: false, failure: 'refused' }, target);
  }
  // A redirect target whose name resolves to an internal address.
  const lookup = async (host: string): Promise<string[]> => (host === 'evil.example.org' ? ['10.0.0.5'] : ['93.184.216.34']);
  const viaDns = await fetchStreetImage('https://a.example.org/x.jpg', { fetch: chain(['https://evil.example.org/x.jpg']), lookup });
  assert.deepEqual(viaDns, { ok: false, failure: 'refused' });
  const noLocation = await fetchStreetImage('https://a.example.org/x.jpg', { fetch: async () => new Response(null, { status: 301 }) });
  assert.deepEqual(noLocation, { ok: false, failure: 'refused' });
});

test('address check: a host with any internal address is refused, a resolver failure is an error', async () => {
  let asked = 0;
  const fetchImpl: StreetFetch = async () => {
    asked++;
    return image(JPEG);
  };
  assert.deepEqual(await fetchStreetImage('https://a.example.org/x.jpg', { fetch: fetchImpl, lookup: async () => ['93.184.216.34', '192.168.1.1'] }), { ok: false, failure: 'refused' });
  assert.deepEqual(await fetchStreetImage('https://a.example.org/x.jpg', { fetch: fetchImpl, lookup: async () => [] }), { ok: false, failure: 'refused' });
  assert.deepEqual(
    await fetchStreetImage('https://a.example.org/x.jpg', {
      fetch: fetchImpl,
      lookup: async () => {
        throw new Error('ENOTFOUND');
      },
    }),
    { ok: false, failure: 'error' },
  );
  assert.equal(asked, 0);
  assert.equal(await checkHost('https://127.0.0.1/x', null), 'refused');
  assert.equal(await checkHost('https://a.example.org/x', async () => ['2a00:1450:4001:82b::200e']), 'ok');
});

test('size, type and status are enforced', async () => {
  const big = Buffer.concat([JPEG, Buffer.alloc(3 * 1024 * 1024)]);
  // Declared too large: refused before reading.
  assert.deepEqual(await fetchStreetImage('https://a.example.org/x.jpg', { fetch: async () => image(big, 'image/jpeg', { 'content-length': String(big.length) }) }), { ok: false, failure: 'too-large' });
  // Not declared: cut off while reading.
  const streamed: StreetFetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < 40; i++) controller.enqueue(new Uint8Array(100_000));
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'image/jpeg' } },
    );
  assert.deepEqual(await fetchStreetImage('https://a.example.org/x.jpg', { fetch: streamed }), { ok: false, failure: 'too-large' });
  for (const type of ['text/html', 'image/svg+xml', 'image/gif', 'application/octet-stream', '']) {
    assert.deepEqual(await fetchStreetImage('https://a.example.org/x', { fetch: async () => image(JPEG, type) }), { ok: false, failure: 'type' }, type);
  }
  // The declared type must match the bytes.
  assert.deepEqual(await fetchStreetImage('https://a.example.org/x', { fetch: async () => image(PNG, 'image/jpeg') }), { ok: false, failure: 'type' });
  assert.deepEqual(await fetchStreetImage('https://a.example.org/x', { fetch: async () => image(Buffer.from('<html>'), 'image/jpeg') }), { ok: false, failure: 'type' });
  for (const status of [404, 410, 403]) {
    assert.deepEqual(await fetchStreetImage('https://a.example.org/x', { fetch: async () => new Response('no', { status }) }), { ok: false, failure: 'gone' }, String(status));
  }
  assert.deepEqual(await fetchStreetImage('https://a.example.org/x', { fetch: async () => new Response('no', { status: 500 }) }), { ok: false, failure: 'error' });
  assert.deepEqual(
    await fetchStreetImage('https://a.example.org/x', {
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    }),
    { ok: false, failure: 'error' },
  );
});

test('a source that does not answer is cut off after the timeout', async () => {
  const hanging: StreetFetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  // AbortSignal.timeout does not keep the event loop alive (the server's sockets do); a timer here does.
  const keepAlive = setInterval(() => undefined, 50);
  const t0 = performance.now();
  const r = await fetchStreetImage('https://a.example.org/x', { fetch: hanging, timeoutMs: 150 }).finally(() => clearInterval(keepAlive));
  assert.deepEqual(r, { ok: false, failure: 'timeout' });
  // Upper bound only: the machine running the tests is shared and loaded.
  assert.ok(performance.now() - t0 < 3_000);
});

test('a resolver that hangs counts against the same timeout as the exchange', async () => {
  let fetched = 0;
  const fetchImpl: StreetFetch = async () => {
    fetched++;
    return image(JPEG);
  };
  // dns.lookup takes no signal; a broken resolver answers late or never.
  const neverAnswers = (): Promise<string[]> => new Promise<string[]>(() => undefined);
  const keepAlive = setInterval(() => undefined, 50);
  const t0 = performance.now();
  const r = await fetchStreetImage('https://a.example.org/x.jpg', { fetch: fetchImpl, lookup: neverAnswers, timeoutMs: 150 }).finally(() => clearInterval(keepAlive));
  assert.deepEqual(r, { ok: false, failure: 'timeout' });
  assert.equal(fetched, 0, 'nothing is fetched without a verdict on the address');
  // Upper bound only: the machine running the tests is shared and loaded.
  assert.ok(performance.now() - t0 < 3_000);
});

test('the memory cache keeps pictures and "gone" answers, evicts by count and bytes, forgets after the TTL', async () => {
  let now = 1_000_000;
  const calls = new Map<string, number>();
  const fetchImpl: StreetFetch = async (url) => {
    calls.set(url, (calls.get(url) ?? 0) + 1);
    if (url.includes('gone')) return new Response('', { status: 404 });
    if (url.includes('flaky')) return new Response('', { status: 503 });
    return image(JPEG);
  };
  const cache = new StreetImageCache({ fetch: fetchImpl }, { entries: 3, bytes: JPEG.length * 2 + 10, ttlMs: 1000, goneTtlMs: 500 }, () => now);
  assert.equal((await cache.get('https://a.example.org/1')).ok, true);
  assert.equal((await cache.get('https://a.example.org/1')).ok, true);
  assert.equal(calls.get('https://a.example.org/1'), 1);
  // Gone is remembered; a transient error is not.
  await cache.get('https://a.example.org/gone');
  await cache.get('https://a.example.org/gone');
  assert.equal(calls.get('https://a.example.org/gone'), 1);
  await cache.get('https://a.example.org/flaky');
  await cache.get('https://a.example.org/flaky');
  assert.equal(calls.get('https://a.example.org/flaky'), 2);
  // Bytes: two pictures fit, a third pushes out the least recently used.
  await cache.get('https://a.example.org/2');
  await cache.get('https://a.example.org/1');
  await cache.get('https://a.example.org/3');
  assert.ok(cache.byteSize <= JPEG.length * 2 + 10);
  await cache.get('https://a.example.org/1');
  assert.equal(calls.get('https://a.example.org/1'), 1, 'recently used, still cached');
  await cache.get('https://a.example.org/2');
  assert.equal(calls.get('https://a.example.org/2'), 2, 'least recently used, evicted');
  assert.ok(cache.size <= 3);
  // TTL.
  now += 1001;
  await cache.get('https://a.example.org/1');
  assert.equal(calls.get('https://a.example.org/1'), 2);
  // Parallel requests for one URL share one fetch.
  const slow = new StreetImageCache({
    fetch: async (url) => {
      calls.set(url, (calls.get(url) ?? 0) + 1);
      await new Promise((r) => setTimeout(r, 20));
      return image(JPEG);
    },
  });
  await Promise.all([slow.get('https://a.example.org/p'), slow.get('https://a.example.org/p'), slow.get('https://a.example.org/p')]);
  assert.equal(calls.get('https://a.example.org/p'), 1);
});
