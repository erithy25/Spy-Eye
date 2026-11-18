import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, test } from 'node:test';
import sharp from 'sharp';
import type { ImageEmbedder } from '../src/datum/gallery.js';
import {
  DEFAULT_STREETLEVEL_OPTIONS,
  applyStreetLevel,
  bboxAreaDeg2,
  clearStreetLevelSearchCache,
  distanceKm,
  failedRules,
  isMatch,
  isSafeRemoteUrl,
  noMatchText,
  parseMapillarySearch,
  parsePanoramaxSearch,
  planSearchTiles,
  redact,
  refineStreetLevel,
  selectSpread,
  splitBbox,
  streetImagePath,
  streetLevelEvidence,
  publicAuthor,
  usableLicense,
  withStreetImagePaths,
  type FetchLike,
  type StreetLevelListing,
  type StreetLevelOptions,
  type StreetLevelStats,
} from '../src/datum/streetlevel.js';
import type { FixLocation } from '../src/datum/contract.js';

// ------------------------------------------------------------------ fixtures

/**
 * Stand-in for the image tower: a red picture becomes the "landmark" row e0, every other picture
 * one of seven rows by its brightness, so similarities are exactly 1 or 0.
 */
class ColourEmbedder implements ImageEmbedder {
  readonly imageSize = 8;
  readonly imageMean: [number, number, number] = [0.5, 0.5, 0.5];
  readonly imageStd: [number, number, number] = [0.5, 0.5, 0.5];
  readonly dim = 8;
  pictures = 0;
  async embedPixels(pixels: Float32Array, count: number): Promise<Float32Array> {
    const plane = this.imageSize * this.imageSize;
    const out = new Float32Array(count * this.dim);
    for (let i = 0; i < count; i++) {
      const mean = (c: number): number => {
        let s = 0;
        for (let k = 0; k < plane; k++) s += pixels[i * 3 * plane + c * plane + k] as number;
        return s / plane;
      };
      const [r, g, b] = [mean(0), mean(1), mean(2)];
      if (r > 0.5 && g < -0.5 && b < -0.5) out[i * this.dim] = 1;
      else out[i * this.dim + 1 + Math.min(6, Math.max(0, Math.floor((r + 1) * 3.5)))] = 1;
    }
    this.pictures += count;
    return out;
  }
}

const CENTRE = { lat: 48.85, lon: 2.29 };
const RED_AT = { lat: 48.853, lon: 2.292 };
const TOKEN = 'MLY|4242424242|abcdefSECRETtoken';

async function jpeg(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({ create: { width: 32, height: 24, channels: 3, background: { r, g, b } } }).jpeg({ quality: 95 }).toBuffer();
}

interface FakePicture {
  id: string;
  lat: number;
  lon: number;
  red: boolean;
}

/** Twenty grey pictures on a grid around the centre and one red picture (the landmark). */
function fakePictures(): FakePicture[] {
  const out: FakePicture[] = [];
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 4; j++) {
      out.push({ id: `grey-${i}-${j}`, lat: CENTRE.lat - 0.006 + i * 0.003, lon: CENTRE.lon - 0.006 + j * 0.004, red: false });
    }
  }
  out.push({ id: 'red-1', lat: RED_AT.lat, lon: RED_AT.lon, red: true });
  return out;
}

function panoramaxFeature(p: FakePicture, license = 'CC-BY-SA-4.0'): Record<string, unknown> {
  return {
    id: p.id,
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    assets: {
      thumb: { href: `https://thumbs.example.org/${p.id}/thumb.jpg`, type: 'image/jpeg', roles: ['thumbnail'] },
      sd: { href: `https://thumbs.example.org/${p.id}/sd.jpg`, type: 'image/jpeg', roles: ['visual'] },
    },
    providers: [{ name: 'jdupont', roles: ['producer'] }],
    links: [{ rel: 'license', href: 'https://spdx.org/licenses/CC-BY-SA-4.0.html', title: 'License for this object (CC-BY-SA-4.0)' }],
    properties: {
      datetime: '2024-05-04T10:00:00+00:00',
      license,
      'view:azimuth': 412,
      'geovisio:status': 'ready',
      'geovisio:visibility': 'anyone',
      'pers:interior_orientation': { field_of_view: 70 },
    },
  };
}

function bboxOf(url: string): [number, number, number, number] {
  const raw = new URL(url).searchParams.get('bbox') ?? '';
  const parts = raw.split(',').map(Number);
  assert.equal(parts.length, 4, `bbox in ${url}`);
  return parts as [number, number, number, number];
}

function inBbox(p: { lat: number; lon: number }, b: readonly number[]): boolean {
  return p.lon >= (b[0] as number) && p.lat >= (b[1] as number) && p.lon <= (b[2] as number) && p.lat <= (b[3] as number);
}

interface Seen {
  url: string;
  headers: Record<string, string>;
}

/** A fake Panoramax (and thumbnail host) answering from fakePictures(). */
async function fakeServices(pictures: FakePicture[] = fakePictures()) {
  const red = await jpeg(230, 20, 20);
  const greys = await Promise.all([40, 70, 100, 130, 160, 190, 220].map((v) => jpeg(v, v, v)));
  const seen: Seen[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    seen.push({ url, headers: { ...(init.headers as Record<string, string>) } });
    const u = new URL(url);
    if (u.hostname === 'api.panoramax.xyz') {
      const b = bboxOf(url);
      const features = pictures.filter((p) => inBbox(p, b)).map((p) => panoramaxFeature(p));
      return new Response(JSON.stringify({ type: 'FeatureCollection', features }), { status: 200, headers: { 'content-type': 'application/geo+json' } });
    }
    if (u.hostname === 'thumbs.example.org') {
      const id = u.pathname.split('/')[1] ?? '';
      const p = pictures.find((x) => x.id === id);
      if (!p) return new Response('missing', { status: 404 });
      const body = p.red ? red : (greys[pictures.indexOf(p) % greys.length] as Buffer);
      return new Response(new Uint8Array(body), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    return new Response('unknown host', { status: 404 });
  };
  return { fetchImpl, seen };
}

/** The video: twelve frame rows that all show the landmark (row e0). */
function landmarkFrames(dim = 8, rows = 12): Float32Array {
  const v = new Float32Array(rows * dim);
  for (let r = 0; r < rows; r++) v[r * dim] = 1;
  return v;
}

const BASE: Partial<StreetLevelOptions> = {
  providers: ['panoramax'],
  cacheDir: null,
  searchCacheTtlMs: 0,
  budgetMs: 10_000,
  maxTilesPerCandidate: 4,
};

beforeEach(() => clearStreetLevelSearchCache());

// ------------------------------------------------------------------ geometry

test('search tiles cover the candidate disk, stay within the tile budget and start in the middle', () => {
  for (const radiusKm of [0.3, 2, 3, 5]) {
    for (const maxTiles of [1, 9, 16, 25]) {
      const tiles = planSearchTiles(CENTRE, radiusKm, maxTiles, 0.25);
      assert.ok(tiles.length >= 1 && tiles.length <= maxTiles, `${tiles.length} tiles for r=${radiusKm}, max=${maxTiles}`);
      // Points inside the disk all fall into some tile.
      for (let k = 0; k < 400; k++) {
        const a = (k * 137.508 * Math.PI) / 180;
        const d = radiusKm * Math.sqrt((k + 0.5) / 400) * 0.999;
        const p = { lat: CENTRE.lat + (d * Math.cos(a)) / 111.32, lon: CENTRE.lon + (d * Math.sin(a)) / (111.32 * Math.cos((CENTRE.lat * Math.PI) / 180)) };
        assert.ok(tiles.some((t) => inBbox(p, t)), `point ${k} at ${d.toFixed(2)} km not covered (r=${radiusKm}, max=${maxTiles})`);
      }
      const first = tiles[0] as readonly number[];
      assert.ok(inBbox(CENTRE, first) || tiles.length === 1 || distanceKm(CENTRE.lat, CENTRE.lon, ((first[1] as number) + (first[3] as number)) / 2, ((first[0] as number) + (first[2] as number)) / 2) <= radiusKm / 2);
    }
  }
  // Never finer than the minimum side: a 300 m radius is one or a few boxes, not hundreds.
  assert.ok(planSearchTiles(CENTRE, 0.3, 100, 0.25).length <= 9);
});

test('boxes larger than the Mapillary limit are split into parts below 0.01 square degrees', () => {
  const big = [2.2, 48.8, 2.4, 48.9] as const; // 0.02 deg²
  const parts = splitBbox(big, 0.0095);
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(bboxAreaDeg2(p) < 0.0095);
  const total = parts.reduce((s, p) => s + bboxAreaDeg2(p), 0);
  assert.ok(Math.abs(total - bboxAreaDeg2(big)) < 1e-9);
  assert.deepEqual(splitBbox([2.29, 48.85, 2.3, 48.86], 0.0095), [[2.29, 48.85, 2.3, 48.86]]);
  // The tiles of a 5 km candidate are under the limit anyway.
  for (const t of planSearchTiles(CENTRE, 5, 25)) assert.ok(bboxAreaDeg2(t) < 0.01);
});

// ------------------------------------------------------------------ parsing

test('Panoramax search responses are parsed with licence, author, heading and safe URLs only', () => {
  const ok = panoramaxFeature({ id: 'a2a3d073-8887-4d76-a9b4-3cc089937ef6', lat: 48.8582, lon: 2.2946, red: false });
  const nc = panoramaxFeature({ id: 'nc-1', lat: 48.85, lon: 2.29, red: false }, 'CC-BY-NC-4.0');
  const noLicence = { ...panoramaxFeature({ id: 'nolic', lat: 48.85, lon: 2.29, red: false }), properties: { datetime: '2024-01-01T00:00:00Z' } };
  const httpThumb = { ...panoramaxFeature({ id: 'plain', lat: 48.85, lon: 2.29, red: false }), assets: { thumb: { href: 'http://example.org/t.jpg' } } };
  const ipThumb = { ...panoramaxFeature({ id: 'ip', lat: 48.85, lon: 2.29, red: false }), assets: { thumb: { href: 'https://127.0.0.1/t.jpg' } } };
  const badId = panoramaxFeature({ id: '../../etc', lat: 48.85, lon: 2.29, red: false });
  const noGeom = { ...panoramaxFeature({ id: 'nogeom', lat: 0, lon: 0, red: false }), geometry: null };
  const list = parsePanoramaxSearch({ type: 'FeatureCollection', features: [ok, nc, noLicence, httpThumb, ipThumb, badId, noGeom, 42, null] });
  assert.equal(list.length, 1);
  const p = list[0] as StreetLevelListing;
  assert.equal(p.provider, 'panoramax');
  assert.equal(p.id, 'a2a3d073-8887-4d76-a9b4-3cc089937ef6');
  assert.equal(p.lat, 48.8582);
  assert.equal(p.lon, 2.2946);
  assert.equal(p.thumbUrl, 'https://thumbs.example.org/a2a3d073-8887-4d76-a9b4-3cc089937ef6/thumb.jpg');
  assert.equal(p.author, 'jdupont');
  assert.equal(p.license, 'CC-BY-SA-4.0');
  assert.equal(p.attribution, '© jdupont, CC BY-SA 4.0, Panoramax');
  assert.equal(p.headingDeg, 52);
  assert.equal(p.capturedAt, Date.parse('2024-05-04T10:00:00Z'));
  assert.equal(p.panorama, false);
  assert.match(p.pageUrl, /^https:\/\/api\.panoramax\.xyz\/#focus=pic&pic=a2a3d073/);
  assert.deepEqual(parsePanoramaxSearch({ nothing: true }), []);
  assert.deepEqual(parsePanoramaxSearch('not json'), []);
});

test('Mapillary search responses are parsed; computed geometry first, fixed CC BY-SA licence', () => {
  const raw = {
    data: [
      {
        id: '498763468214164',
        computed_geometry: { type: 'Point', coordinates: [2.2946, 48.8582] },
        geometry: { type: 'Point', coordinates: [2.3, 48.9] },
        thumb_256_url: 'https://scontent.example.net/t256.jpg?sig=x',
        thumb_1024_url: 'https://scontent.example.net/t1024.jpg?sig=x',
        captured_at: 1_600_000_000_000,
        creator: { username: 'mapper', id: '1' },
        compass_angle: -10,
        is_pano: true,
      },
      { id: 123, geometry: { type: 'Point', coordinates: [2.31, 48.86] }, thumb_1024_url: 'https://scontent.example.net/b.jpg' },
      { id: '9', computed_geometry: { type: 'Point', coordinates: [2.31, 48.86] } },
      { id: 'x', thumb_256_url: 'https://scontent.example.net/c.jpg' },
    ],
  };
  const small = parseMapillarySearch(raw);
  assert.equal(small.length, 2);
  const a = small[0] as StreetLevelListing;
  assert.equal(a.provider, 'mapillary');
  assert.equal(a.lat, 48.8582);
  assert.equal(a.lon, 2.2946);
  assert.equal(a.thumbUrl, 'https://scontent.example.net/t256.jpg?sig=x');
  assert.equal(a.capturedAt, 1_600_000_000_000);
  assert.equal(a.headingDeg, 350);
  assert.equal(a.panorama, true);
  assert.equal(a.attribution, '© mapper, CC BY-SA 4.0, Mapillary');
  assert.equal(a.pageUrl, 'https://www.mapillary.com/app/?pKey=498763468214164');
  const b = small[1] as StreetLevelListing;
  assert.equal(b.id, '123');
  assert.equal(b.lat, 48.86);
  assert.equal(b.author, null);
  assert.equal(b.attribution, 'CC BY-SA 4.0, Mapillary');
  assert.equal((parseMapillarySearch(raw, true)[0] as StreetLevelListing).thumbUrl, 'https://scontent.example.net/t1024.jpg?sig=x');
  assert.deepEqual(parseMapillarySearch({ error: { message: 'x' } }), []);
});

test('licences, URLs and redaction', () => {
  assert.ok(usableLicense('CC-BY-SA-4.0'));
  assert.ok(usableLicense('etalab-2.0'));
  assert.ok(!usableLicense('CC-BY-NC-SA-4.0'));
  assert.ok(!usableLicense(''));
  assert.ok(!usableLicense(null));
  assert.ok(isSafeRemoteUrl('https://panoramax.ign.fr/api/pictures/x/thumb.jpg'));
  for (const bad of ['http://panoramax.ign.fr/x.jpg', 'https://127.0.0.1/x.jpg', 'https://[::1]/x.jpg', 'https://localhost/x.jpg', 'https://user:pw@example.org/x.jpg', 'file:///etc/passwd', 'https://intranet/x.jpg']) {
    assert.ok(!isSafeRemoteUrl(bad), bad);
  }
  const text = redact(`GET /images?access_token=${TOKEN}&x=1 Authorization: OAuth ${TOKEN} raw ${TOKEN}`, [TOKEN]);
  assert.ok(!text.includes(TOKEN));
  assert.ok(!text.includes('SECRET'));
});

test('the sample is spread over the area and prefers recent pictures', () => {
  const at = (id: string, lat: number, lon: number, year: number): StreetLevelListing => ({
    provider: 'panoramax',
    id,
    lat,
    lon,
    thumbUrl: `https://t.example.org/${id}.jpg`,
    pageUrl: '',
    capturedAt: Date.parse(`${year}-06-01T00:00:00Z`),
    headingDeg: null,
    panorama: false,
    author: null,
    license: 'CC-BY-SA-4.0',
    licenseUrl: null,
    attribution: 'CC BY-SA 4.0, Panoramax',
  });
  // A dense sequence in the west (30 pictures 10 m apart) and four single pictures elsewhere.
  const dense = Array.from({ length: 30 }, (_, i) => at(`w${i}`, 48.85, 2.27 + i * 0.00014, 2024));
  const spread = [at('n', 48.865, 2.29, 2024), at('s', 48.835, 2.29, 2024), at('e', 48.85, 2.31, 2024), at('c', 48.85, 2.29, 2024)];
  const pick = selectSpread([...dense, ...spread], 5, CENTRE, Date.parse('2026-11-18T00:00:00Z'));
  assert.equal(pick.length, 5);
  const ids = pick.map((p) => p.id);
  for (const id of ['n', 's', 'e', 'c']) assert.ok(ids.includes(id), `${id} missing from ${ids.join(',')}`);
  assert.equal(ids.filter((id) => id.startsWith('w')).length, 1);
  // Two pictures at the same spot: the recent one is taken first.
  const old = at('old', 48.86, 2.29, 2012);
  const recent = at('recent', 48.86, 2.29, 2025);
  const two = selectSpread([old, recent, at('c2', 48.85, 2.29, 2024)], 2, CENTRE, Date.parse('2026-11-18T00:00:00Z'));
  assert.deepEqual(two.map((p) => p.id), ['c2', 'recent']);
  // Exclusions and duplicates.
  assert.equal(selectSpread([old, old, recent], 5, CENTRE, Date.now(), new Set(['panoramax:recent'])).length, 1);
  assert.deepEqual(selectSpread([], 5, CENTRE), []);
});

// ------------------------------------------------------------------ the stage with mocked services

test('a standing-out picture is found, located, attributed and cached', async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-streetlevel-'));
  try {
    const { fetchImpl, seen } = await fakeServices();
    const model = new ColourEmbedder();
    const input = {
      frameVectors: landmarkFrames(),
      dim: 8,
      frameNumbers: Array.from({ length: 12 }, (_, i) => i * 25),
      candidates: [{ ...CENTRE, radiusKm: 1.5 }],
      model,
      options: { ...BASE, providers: ['panoramax', 'mapillary'] as const, cacheDir, minPictures: 8, modelId: 'test/colour' },
    };
    const result = await refineStreetLevel(input, { fetch: fetchImpl, env: {} });
    assert.equal(result.matched, true, result.reason);
    assert.equal(result.reasonCode, 'matched');
    assert.ok(result.location);
    assert.ok(distanceKm(result.location.lat, result.location.lon, RED_AT.lat, RED_AT.lon) < 0.05);
    assert.ok(result.location.radiusKm >= 0.3);
    assert.ok(result.location.confidence > 0.5 && result.location.confidence <= 0.85);
    const top = result.top[0];
    assert.ok(top);
    assert.equal(top.id, 'red-1');
    assert.ok(Math.abs(top.similarity - 1) < 1e-6);
    assert.equal(top.frame, 0);
    assert.equal(top.attribution, '© jdupont, CC BY-SA 4.0, Panoramax');
    assert.equal(result.stats?.pictures, 21);
    assert.ok((result.stats?.gap ?? 0) > 0.9);
    // User-Agent on every request, no credential anywhere.
    for (const s of seen) {
      assert.match(s.headers['User-Agent'] ?? '', /^DATUM\/0\.5 \(Ortung von Videos\)$/);
      assert.equal(s.headers['Authorization'], undefined);
    }
    const thumbs = seen.filter((s) => s.url.startsWith('https://thumbs.example.org/')).length;
    assert.equal(thumbs, 21);
    assert.equal(model.pictures, 21);
    // Mapillary was not asked without a token, and says so.
    const mly = result.providers.find((p) => p.name === 'mapillary');
    assert.equal(mly?.enabled, false);
    assert.match(mly?.note ?? '', /MAPILLARY_TOKEN/);

    // Evidence and location for the fix.
    const evidence = streetLevelEvidence(result);
    assert.equal(evidence.length, Math.min(3, result.top.length));
    const first = evidence[0];
    assert.ok(first);
    assert.equal(first.kind, 'streetlevel');
    // The remote thumbnail is only named; the console gets the node's proxy path from the engine.
    assert.equal(first.refImage, undefined);
    assert.equal(first.refSource, 'https://thumbs.example.org/red-1/thumb.jpg');
    assert.match(first.refUrl ?? '', /^https:\/\/api\.panoramax\.xyz\/#focus=pic&pic=red-1/);
    const proxied = withStreetImagePaths('vid_abc', evidence);
    assert.deepEqual(
      proxied.map((e) => e.refImage),
      evidence.map((_e, i) => streetImagePath('vid_abc', i)),
    );
    assert.equal(proxied[0]?.refImage, '/api/datum/fixes/vid_abc/street/0');
    for (const e of evidence) assert.ok(e.label && e.labelEn && e.detail && e.detailEn);
    assert.equal(first.refLabel, '© jdupont, CC BY-SA 4.0, Panoramax');
    assert.ok(first.labelEn && first.detailEn && first.detail.includes('Panoramax'));
    assert.ok(Math.abs(evidence.reduce((s, e) => s + e.weight, 0) - result.location.confidence) < 1e-9);
    const coarse: FixLocation = { lat: CENTRE.lat, lon: CENTRE.lon, radiusKm: 3, confidence: 0.4, method: 'landmark', label: 'Ort', labelEn: 'Place', country: 'FR', countryName: 'Frankreich' };
    const fine = applyStreetLevel(coarse, result);
    assert.equal(fine.lat, result.location.lat);
    assert.ok(fine.radiusKm < 3);
    assert.equal(fine.label, 'Ort');

    // The cache holds vectors only: a second call downloads nothing.
    const files: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else files.push(full);
      }
    };
    await walk(cacheDir);
    assert.equal(files.length, 21);
    for (const f of files) {
      assert.ok(f.endsWith('.f32'));
      assert.equal((await fs.stat(f)).size, 8 * 4);
    }
    const before = seen.length;
    const again = await refineStreetLevel(input, { fetch: fetchImpl, env: {} });
    assert.equal(again.matched, true);
    assert.equal(again.timing.fromCache, 21);
    assert.equal(seen.slice(before).filter((s) => s.url.startsWith('https://thumbs.example.org/')).length, 0);
    assert.equal(model.pictures, 21);
  } finally {
    await fs.rm(cacheDir, { recursive: true, force: true });
  }
});

test('a no-match names the condition that failed, in plain words and both languages', () => {
  const opts = DEFAULT_STREETLEVEL_OPTIONS;
  // The case seen in the field: the gap is enough, the z rule is not (a landmark seen from afar).
  const zOnly: StreetLevelStats = { pictures: 46, spreadPictures: 30, best: 0.842, typical: 0.698, spread: 0.0686, gap: 0.144, z: 2.1, agreement: 1 };
  assert.deepEqual(failedRules(zOnly, opts), ['z']);
  assert.equal(isMatch(zOnly, opts), false);
  let text = noMatchText(zOnly, opts);
  assert.equal(
    text.de,
    'Kein Straßenbild passt sicher genug: bestes 0,84, typisch 0,70; der Abstand 0,14 reicht (nötig 0,10), aber das beste Bild sticht nicht deutlich genug aus der Streuung heraus (z 2,1, nötig 3).',
  );
  assert.equal(
    text.en,
    'No street-level picture matches clearly enough: best 0.84, typical 0.70; the gap of 0.14 is enough (needed 0.10), but the best picture does not stand out clearly enough from the spread (z 2.1, needed 3).',
  );

  // Gap too small (z then usually fails too): both are named, the gap is not called enough.
  const small: StreetLevelStats = { ...zOnly, best: 0.75, typical: 0.7, gap: 0.05, spread: 0.03, z: 1.7 };
  assert.deepEqual(failedRules(small, opts), ['gap', 'z']);
  text = noMatchText(small, opts);
  assert.equal(
    text.de,
    'Kein Straßenbild hebt sich ab: bestes 0,75, typisch 0,70; der Abstand 0,05 ist zu klein (nötig 0,10) und das beste Bild sticht nicht deutlich genug aus der Streuung heraus (z 1,7, nötig 3).',
  );
  assert.match(text.en, /^No street-level picture stands out: .*the gap of 0\.05 is too small \(needed 0\.10\) and the best picture does not stand out/);
  assert.doesNotMatch(text.de, /reicht/);
  assert.doesNotMatch(text.en, /is enough/);

  // Gap alone.
  const gapOnly: StreetLevelStats = { ...zOnly, gap: 0.08, typical: 0.762, spread: 0.01, z: 8 };
  assert.deepEqual(failedRules(gapOnly, opts), ['gap']);
  text = noMatchText(gapOnly, opts);
  assert.match(text.de, /; der Abstand 0,08 ist zu klein \(nötig 0,10\)\.$/);
  assert.match(text.en, /; the gap of 0\.08 is too small \(needed 0\.10\)\.$/);

  // Minimum best similarity.
  const weak: StreetLevelStats = { ...zOnly, best: 0.66, typical: 0.5, gap: 0.16, spread: 0.02, z: 8 };
  assert.deepEqual(failedRules(weak, opts), ['similarity']);
  text = noMatchText(weak, opts);
  assert.match(text.de, /der Abstand 0,16 reicht \(nötig 0,10\), aber das beste Bild ist insgesamt zu unähnlich \(0,66, nötig 0,70\)\.$/);
  assert.match(text.en, /the gap of 0\.16 is enough \(needed 0\.10\), but the best picture is too dissimilar overall \(0\.66, needed 0\.70\)\.$/);

  // Too few pictures for the spread.
  const few: StreetLevelStats = { ...zOnly, spreadPictures: 5, z: 8 };
  assert.deepEqual(failedRules(few, opts), ['pictures']);
  text = noMatchText(few, opts);
  assert.match(text.de, /aber zu wenige Bilder, um die Streuung zu messen \(5, nötig 8\)\.$/);
  assert.match(text.en, /but too few pictures to measure the spread \(5, needed 8\)\.$/);

  // Agreement of the next best pictures (off by default, so only with a threshold).
  const apart: StreetLevelStats = { ...zOnly, z: 8, agreement: 0 };
  assert.deepEqual(failedRules(apart, opts), []);
  assert.equal(isMatch(apart, opts), true);
  const strict = { ...opts, minAgreement: 0.5 };
  assert.deepEqual(failedRules(apart, strict), ['agreement']);
  text = noMatchText(apart, strict);
  assert.match(text.de, /aber die nächstbesten Bilder liegen nicht beim besten \(0 %, nötig 50 %\)\.$/);
  assert.match(text.en, /but the next best pictures do not lie near the best one \(0%, needed 50%\)\.$/);

  // Several at once: all of them, joined.
  text = noMatchText({ ...weak, z: 2 }, opts);
  assert.match(text.de, /aber das beste Bild ist insgesamt zu unähnlich \(0,66, nötig 0,70\) und das beste Bild sticht nicht deutlich genug aus der Streuung heraus \(z 2,0, nötig 3\)\.$/);
  text = noMatchText({ ...small, spreadPictures: 5, best: 0.6 }, opts);
  assert.match(text.de, /; zu wenige Bilder, .*\(5, nötig 8\), das beste Bild ist insgesamt zu unähnlich .*, der Abstand 0,05 ist zu klein .* und das beste Bild sticht/);
  assert.match(text.en, /; too few pictures .*, the best picture is too dissimilar overall .*, the gap of 0\.05 is too small .* and the best picture does not/);

  // A value just below its threshold never reads as the threshold itself ("0,10 ist zu klein
  // (nötig 0,10)"): it gets the decimals it needs, best and typical the same ones as the gap.
  const justGap: StreetLevelStats = { ...zOnly, best: 0.7846, typical: 0.685, gap: 0.0996, spread: 0.01, z: 9.96 };
  assert.deepEqual(failedRules(justGap, opts), ['gap']);
  text = noMatchText(justGap, opts);
  assert.equal(text.de, 'Kein Straßenbild hebt sich ab: bestes 0,7846, typisch 0,6850; der Abstand 0,0996 ist zu klein (nötig 0,10).');
  assert.equal(text.en, 'No street-level picture stands out: best 0.7846, typical 0.6850; the gap of 0.0996 is too small (needed 0.10).');
  const justZ: StreetLevelStats = { ...zOnly, z: 2.96 };
  text = noMatchText(justZ, opts);
  assert.match(text.de, /\(z 2,96, nötig 3\)\.$/);
  assert.match(text.en, /\(z 2\.96, needed 3\)\.$/);
  const justSimilar: StreetLevelStats = { ...weak, best: 0.6996, typical: 0.53, gap: 0.1696 };
  text = noMatchText(justSimilar, opts);
  assert.match(text.de, /^Kein Straßenbild passt sicher genug: bestes 0,6996, typisch 0,5300; der Abstand 0,1696 reicht .*zu unähnlich \(0,6996, nötig 0,70\)\.$/);
  // Rounding that would reach the threshold at every precision: cut, not rounded.
  const hair: StreetLevelStats = { ...zOnly, best: 0.7999999, typical: 0.7, gap: 0.0999999, spread: 0.01, z: 9.99 };
  text = noMatchText(hair, opts);
  assert.match(text.de, /der Abstand 0,09999 ist zu klein \(nötig 0,10\)\.$/);
  text = noMatchText({ ...apart, agreement: 0.497 }, strict);
  assert.match(text.de, /\(49,7 %, nötig 50 %\)\.$/);
  assert.match(text.en, /\(49\.7%, needed 50%\)\.$/);
  // Whatever the numbers, the value a failed condition shows lies below its threshold.
  for (let i = 0; i < 2000; i++) {
    const g = Math.random() * 0.2;
    const b = 0.6 + Math.random() * 0.2;
    const s: StreetLevelStats = { ...zOnly, best: b, typical: b - g, gap: g, spread: 0.03, z: Math.random() * 6 };
    const t = noMatchText(s, opts).en;
    const shown = (re: RegExp): number => Number(re.exec(t)?.[1] ?? NaN);
    if (g < opts.minGap) assert.ok(shown(/the gap of ([\d.]+) is too small/) < opts.minGap, t);
    if (b < opts.minSimilarity) assert.ok(shown(/too dissimilar overall \(([\d.]+),/) < opts.minSimilarity, t);
    if (s.z < opts.minZ) assert.ok(shown(/\(z ([\d.]+), needed/) < opts.minZ, t);
    if (g >= opts.minGap && failedRules(s, opts).length > 0) assert.ok(shown(/the gap of ([\d.]+) is enough/) >= opts.minGap, t);
  }
});

test('without a standing-out picture the stage says so and leaves the place alone', async () => {
  const { fetchImpl } = await fakeServices(fakePictures().filter((p) => !p.red));
  const frames = new Float32Array(12 * 8).fill(1 / Math.sqrt(8));
  const result = await refineStreetLevel(
    { frameVectors: frames, dim: 8, candidates: [{ ...CENTRE, radiusKm: 1.5 }], model: new ColourEmbedder(), options: BASE },
    { fetch: fetchImpl, env: {} },
  );
  assert.equal(result.matched, false);
  assert.equal(result.reasonCode, 'no-match');
  assert.equal(result.location, null);
  assert.match(result.reason, /Kein Straßenbild hebt sich ab/);
  assert.match(result.reasonEn, /No street-level picture stands out/);
  const evidence = streetLevelEvidence(result);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.weight, 0);
  assert.equal(evidence[0]?.refImage, undefined);
  const coarse: FixLocation = { lat: 1, lon: 2, radiusKm: 3, confidence: 0.4, method: 'landmark', label: 'x', country: null, countryName: null };
  assert.deepEqual(applyStreetLevel(coarse, result), coarse);
});

test('no coverage, no candidates and too few pictures are reported, not thrown', async () => {
  const empty: FetchLike = async () => new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), { status: 200 });
  const model = new ColourEmbedder();
  const none = await refineStreetLevel({ frameVectors: landmarkFrames(), dim: 8, candidates: [{ ...CENTRE, radiusKm: 2 }], model, options: BASE }, { fetch: empty, env: {} });
  assert.equal(none.matched, false);
  assert.equal(none.reasonCode, 'no-coverage');
  assert.equal(streetLevelEvidence(none)[0]?.label, 'Straßenbilder: keine in der Nähe');

  const far = await refineStreetLevel({ frameVectors: landmarkFrames(), dim: 8, candidates: [{ ...CENTRE, radiusKm: 1500 }], model, options: BASE }, { fetch: empty, env: {} });
  assert.equal(far.reasonCode, 'no-candidates');
  assert.deepEqual(streetLevelEvidence(far), []);

  const { fetchImpl } = await fakeServices(fakePictures().slice(0, 3));
  const few = await refineStreetLevel({ frameVectors: landmarkFrames(), dim: 8, candidates: [{ ...CENTRE, radiusKm: 1.5 }], model, options: BASE }, { fetch: fetchImpl, env: {} });
  assert.equal(few.matched, false);
  assert.equal(few.reasonCode, 'too-few');

  const wrongDim = await refineStreetLevel({ frameVectors: new Float32Array(10), dim: 8, candidates: [{ ...CENTRE, radiusKm: 1 }], model, options: BASE }, { fetch: empty, env: {} });
  assert.equal(wrongDim.reasonCode, 'error');
});

test('network errors, HTTP errors and a failing model never throw out of the stage', async () => {
  const model = new ColourEmbedder();
  const input = { frameVectors: landmarkFrames(), dim: 8, candidates: [{ ...CENTRE, radiusKm: 1.5 }], model, options: BASE };
  const broken: FetchLike = async () => {
    throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND api.panoramax.xyz') });
  };
  const a = await refineStreetLevel(input, { fetch: broken, env: {} });
  assert.equal(a.matched, false);
  assert.equal(a.reasonCode, 'error');
  assert.match(a.reason, /ENOTFOUND/);
  assert.ok((a.providers.find((p) => p.name === 'panoramax')?.errors ?? 0) > 0);

  let calls = 0;
  const limited: FetchLike = async () => {
    calls++;
    return new Response('slow down', { status: 429 });
  };
  const b = await refineStreetLevel({ ...input, options: { ...BASE, concurrency: 1 } }, { fetch: limited, env: {} });
  assert.equal(b.matched, false);
  assert.equal(calls, 1, 'a rate limit stops further requests to the provider');
  assert.match(b.providers.find((p) => p.name === 'panoramax')?.note ?? '', /429/);

  const garbage: FetchLike = async () => new Response('<html>not json</html>', { status: 200 });
  const c = await refineStreetLevel(input, { fetch: garbage, env: {} });
  assert.equal(c.matched, false);
  assert.equal(c.reasonCode, 'error');

  const { fetchImpl } = await fakeServices();
  const failingModel: ImageEmbedder = {
    imageSize: 8,
    imageMean: [0.5, 0.5, 0.5],
    imageStd: [0.5, 0.5, 0.5],
    dim: 8,
    embedPixels: async () => {
      throw new Error('Model is not loaded yet.');
    },
  };
  const d = await refineStreetLevel({ ...input, model: failingModel }, { fetch: fetchImpl, env: {} });
  assert.equal(d.matched, false);
  assert.equal(d.reasonCode, 'error');
  assert.match(d.reason, /Model is not loaded/);

  // Broken thumbnails are skipped one by one.
  const brokenThumbs: FetchLike = async (url, init) => {
    if (url.startsWith('https://thumbs.example.org/')) return new Response('not an image', { status: 200, headers: { 'content-type': 'image/jpeg' } });
    return fetchImpl(url, init);
  };
  const e = await refineStreetLevel(input, { fetch: brokenThumbs, env: {} });
  assert.equal(e.matched, false);
  assert.equal(e.reasonCode, 'too-few');
  assert.ok(e.timing.failed > 0);
});

test('only JPEG, PNG and WebP thumbnails are decoded; other formats and huge rasters are skipped', async () => {
  const model = new ColourEmbedder();
  const input = { frameVectors: landmarkFrames(), dim: 8, candidates: [{ ...CENTRE, radiusKm: 1.5 }], model, options: BASE };
  const { fetchImpl } = await fakeServices();
  // A few bytes of SVG that declare a 6000 x 6000 raster (108 MB decoded), and a PNG of the same
  // size that compresses to a few kB: neither may reach the decoder's raster.
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="6000"><rect width="6000" height="6000" fill="red"/></svg>');
  const bigPng = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 230, g: 20, b: 20 } } }).png({ compressionLevel: 9 }).toBuffer();
  const greyJpeg = await jpeg(100, 100, 100);
  for (const [what, body, type] of [
    ['svg', svg, 'image/svg+xml'],
    ['svg as octet-stream', svg, 'application/octet-stream'],
    ['huge png', bigPng, 'image/png'],
    ['jpeg declared as png', greyJpeg, 'image/png'],
  ] as const) {
    const thumbs: FetchLike = async (url, init) => {
      if (url.startsWith('https://thumbs.example.org/')) return new Response(new Uint8Array(body), { status: 200, headers: { 'content-type': type } });
      return fetchImpl(url, init);
    };
    model.pictures = 0;
    const lines: string[] = [];
    const r = await refineStreetLevel(input, { fetch: thumbs, env: {}, log: (l) => lines.push(l) });
    assert.equal(r.matched, false, what);
    assert.equal(r.timing.downloaded, 0, `${what}: nothing counted as downloaded`);
    assert.ok(r.timing.failed > 0, what);
    assert.equal(model.pictures, 0, `${what}: nothing reached the image model`);
  }
  // A JPEG sent as octet-stream (as some storage hosts do) is still taken.
  const generic: FetchLike = async (url, init) => {
    const res = await fetchImpl(url, init);
    if (!url.startsWith('https://thumbs.example.org/')) return res;
    return new Response(new Uint8Array(await res.arrayBuffer()), { status: res.status, headers: { 'content-type': 'application/octet-stream' } });
  };
  const ok = await refineStreetLevel(input, { fetch: generic, env: {} });
  assert.ok(ok.timing.downloaded > 0);
});

test('a body without Content-Length is read only up to the limit', async () => {
  const model = new ColourEmbedder();
  const input = { frameVectors: landmarkFrames(), dim: 8, candidates: [{ ...CENTRE, radiusKm: 1.5 }], model, options: { ...BASE, maxImageBytes: 64 * 1024 } };
  const { fetchImpl } = await fakeServices();
  let pulled = 0;
  const endless: FetchLike = async (url, init) => {
    if (!url.startsWith('https://thumbs.example.org/')) return fetchImpl(url, init);
    // A JPEG start, then chunks for as long as anyone reads (no Content-Length).
    const chunk = new Uint8Array(16 * 1024);
    chunk.set([0xff, 0xd8, 0xff, 0xe0]);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'image/jpeg' } });
  };
  const r = await refineStreetLevel(input, { fetch: endless, env: {} });
  assert.equal(r.matched, false);
  assert.equal(r.timing.downloaded, 0);
  const requests = r.timing.requests;
  // Each thumbnail stops shortly past the limit (a chunk or two of read-ahead), not at the timeout.
  assert.ok(pulled <= requests * (64 * 1024 + 4 * 16 * 1024), `read ${pulled} bytes over ${requests} requests`);
});

test('the English reason carries no German error fragments', async () => {
  const model = new ColourEmbedder();
  const input = { frameVectors: landmarkFrames(), dim: 8, candidates: [{ ...CENTRE, radiusKm: 1.5 }], model, options: BASE };
  // Every listing request is answered with endless redirects: the error is the stage's own.
  let n = 0;
  const loops: FetchLike = async () => new Response(null, { status: 302, headers: { location: `https://api.panoramax.xyz/loop/${n++}` } });
  const r = await refineStreetLevel(input, { fetch: loops, env: {} });
  assert.equal(r.matched, false);
  assert.match(r.reason, /Zu viele Weiterleitungen/);
  assert.match(r.reasonEn, /too many redirects/);
  assert.doesNotMatch(r.reasonEn, /Weiterleitungen|Zeitüberschreitung|Zeitbudget|Adresse|Name nicht/);
  const p = r.providers.find((x) => x.name === 'panoramax');
  assert.equal(p?.lastErrorEn, 'too many redirects');
  // Evidence and trace take reasonEn as their English detail.
  const e = streetLevelEvidence(r);
  assert.equal(e[0]?.detailEn, r.reasonEn);
});

/** A request that only ends when it is aborted. */
const hanging: FetchLike = (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init.signal;
    if (!signal) return;
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

test('a hanging service is cut off by the request timeout', async () => {
  const t0 = performance.now();
  const result = await refineStreetLevel(
    { frameVectors: landmarkFrames(), dim: 8, candidates: [{ ...CENTRE, radiusKm: 1.5 }], model: new ColourEmbedder(), options: { ...BASE, requestTimeoutMs: 150, budgetMs: 20_000 } },
    { fetch: hanging, env: {} },
  );
  const ms = performance.now() - t0;
  assert.ok(ms < 3_000, `took ${ms} ms`);
  assert.equal(result.matched, false);
  assert.equal(result.reasonCode, 'error');
  assert.match(result.reason, /Zeitüberschreitung/);
});

test('the total budget ends slow downloads and the stage returns what it has', async () => {
  const { fetchImpl } = await fakeServices();
  // Listing is fast, thumbnails hang: the budget, not the 8 s request timeout, ends the call.
  const slowThumbs: FetchLike = (url, init) => (url.startsWith('https://thumbs.example.org/') ? hanging(url, init) : fetchImpl(url, init));
  const t0 = performance.now();
  const result = await refineStreetLevel(
    { frameVectors: landmarkFrames(), dim: 8, candidates: [{ ...CENTRE, radiusKm: 1.5 }], model: new ColourEmbedder(), options: { ...BASE, budgetMs: 800, reserveMs: 200 } },
    { fetch: slowThumbs, env: {} },
  );
  const ms = performance.now() - t0;
  assert.ok(ms < 1_500, `took ${ms} ms`);
  assert.equal(result.matched, false);
  assert.equal(result.timing.budgetExhausted, true);
  assert.match(result.reason, /Zeitbudget/);
  assert.match(result.reasonEn, /budget/);
  assert.equal(result.timing.failed, 0, 'pictures cut off by the budget are not counted as broken');

  // The caller can cancel too.
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 100);
  const t1 = performance.now();
  const cancelled = await refineStreetLevel(
    { frameVectors: landmarkFrames(), dim: 8, candidates: [{ ...CENTRE, radiusKm: 1.5 }], model: new ColourEmbedder(), options: { ...BASE, budgetMs: 20_000 } },
    { fetch: slowThumbs, env: {}, signal: ac.signal },
  );
  assert.ok(performance.now() - t1 < 1_500);
  assert.equal(cancelled.matched, false);
});

test('the Mapillary token travels only in the header to the API and never shows up in URLs, logs or results', async () => {
  const red = await jpeg(230, 20, 20);
  const grey = await jpeg(120, 120, 120);
  const seen: Seen[] = [];
  const pictures = fakePictures();
  const fetchImpl: FetchLike = async (url, init) => {
    seen.push({ url, headers: { ...(init.headers as Record<string, string>) } });
    const u = new URL(url);
    if (u.hostname === 'graph.mapillary.com') {
      const b = bboxOf(url);
      const data = pictures
        .filter((p) => inBbox(p, b))
        .map((p, i) => ({
          id: String(1000 + pictures.indexOf(p)),
          computed_geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
          thumb_256_url: `https://scontent.example.net/${p.red ? 'red' : 'grey'}-${i}.jpg?_nc=sig`,
          captured_at: 1_700_000_000_000,
          creator: { username: 'mapper' },
          compass_angle: 90,
        }));
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    if (u.hostname === 'scontent.example.net') return new Response(new Uint8Array(u.pathname.startsWith('/red') ? red : grey), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), { status: 200 });
  };
  const lines: string[] = [];
  const result = await refineStreetLevel(
    { frameVectors: landmarkFrames(), dim: 8, candidates: [{ ...CENTRE, radiusKm: 1.5 }], model: new ColourEmbedder(), options: { ...BASE, providers: ['panoramax', 'mapillary'] } },
    { fetch: fetchImpl, env: { MAPILLARY_TOKEN: TOKEN }, log: (l) => lines.push(l) },
  );
  assert.equal(result.matched, true, result.reason);
  assert.equal(result.top[0]?.provider, 'mapillary');
  assert.equal(result.top[0]?.attribution, '© mapper, CC BY-SA 4.0, Mapillary');
  const graph = seen.filter((s) => s.url.startsWith('https://graph.mapillary.com/'));
  assert.ok(graph.length > 0);
  for (const s of graph) {
    assert.equal(s.headers['Authorization'], `OAuth ${TOKEN}`);
    assert.ok(bboxAreaDeg2(bboxOf(s.url)) < 0.01);
  }
  for (const s of seen) {
    assert.ok(!s.url.includes(TOKEN) && !s.url.includes('SECRET'), s.url);
    if (!s.url.startsWith('https://graph.mapillary.com/')) assert.equal(s.headers['Authorization'], undefined, `credential sent to ${s.url}`);
  }
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  assert.ok(!lines.join('\n').includes('SECRET'));

  // A rejected token: the error texts may quote it; neither logs nor the result do.
  const leaky: FetchLike = async (url) => {
    if (url.startsWith('https://graph.mapillary.com/')) throw new Error(`request to ${url}&access_token=${TOKEN} failed, Authorization: OAuth ${TOKEN}`);
    return new Response(JSON.stringify({ type: 'FeatureCollection', features: [] }), { status: 200 });
  };
  const leakLines: string[] = [];
  const leak = await refineStreetLevel(
    { frameVectors: landmarkFrames(), dim: 8, candidates: [{ ...CENTRE, radiusKm: 1.5 }], model: new ColourEmbedder(), options: { ...BASE, providers: ['panoramax', 'mapillary'] } },
    { fetch: leaky, env: { MAPILLARY_TOKEN: TOKEN }, log: (l) => leakLines.push(l) },
  );
  assert.equal(leak.matched, false);
  assert.ok(leakLines.length > 0);
  assert.ok(!leakLines.join('\n').includes('SECRET'), leakLines.join('\n'));
  assert.ok(!JSON.stringify(leak).includes('SECRET'));

  const denied: FetchLike = async (url) =>
    url.startsWith('https://graph.mapillary.com/') ? new Response(`{"error":{"message":"Invalid OAuth access token ${TOKEN}"}}`, { status: 401 }) : new Response(JSON.stringify({ features: [] }), { status: 200 });
  const d = await refineStreetLevel(
    { frameVectors: landmarkFrames(), dim: 8, candidates: [{ ...CENTRE, radiusKm: 1.5 }], model: new ColourEmbedder(), options: { ...BASE, providers: ['panoramax', 'mapillary'], concurrency: 1 } },
    { fetch: denied, env: { MAPILLARY_TOKEN: TOKEN } },
  );
  const m = d.providers.find((p) => p.name === 'mapillary');
  assert.equal(m?.requests, 1, 'a rejected key is not tried again');
  assert.match(m?.note ?? '', /401/);
  assert.ok(!JSON.stringify(d).includes('SECRET'));

  // A token with a line break would be a header injection: it is not used at all.
  const bad = await refineStreetLevel(
    { frameVectors: landmarkFrames(), dim: 8, candidates: [{ ...CENTRE, radiusKm: 1.5 }], model: new ColourEmbedder(), options: { ...BASE, providers: ['panoramax', 'mapillary'] } },
    { fetch: denied, env: { MAPILLARY_TOKEN: 'abc def\r\nX-Evil: 1' } },
  );
  const bm = bad.providers.find((p) => p.name === 'mapillary');
  assert.equal(bm?.enabled, false);
  assert.match(bm?.note ?? '', /kein gültiges Format/);
});

test('a large Mapillary search box is split below 0.01 square degrees', async () => {
  const seen: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    seen.push(url);
    return url.startsWith('https://graph.mapillary.com/') ? new Response(JSON.stringify({ data: [] }), { status: 200 }) : new Response(JSON.stringify({ features: [] }), { status: 200 });
  };
  const result = await refineStreetLevel(
    { frameVectors: landmarkFrames(), dim: 8, candidates: [{ ...CENTRE, radiusKm: 5 }], model: new ColourEmbedder(), options: { ...BASE, providers: ['mapillary'], maxTilesPerCandidate: 1 } },
    { fetch: fetchImpl, env: { MAPILLARY_TOKEN: TOKEN } },
  );
  assert.equal(result.reasonCode, 'no-coverage');
  const graph = seen.filter((u) => u.startsWith('https://graph.mapillary.com/'));
  assert.ok(graph.length >= 2, `${graph.length} requests`);
  let total = 0;
  for (const u of graph) {
    const area = bboxAreaDeg2(bboxOf(u));
    assert.ok(area < 0.01, `area ${area}`);
    total += area;
    assert.ok(Number(new URL(u).searchParams.get('limit')) <= 100);
  }
  const whole = bboxAreaDeg2(planSearchTiles(CENTRE, 5, 1)[0] as readonly [number, number, number, number]);
  assert.ok(Math.abs(total - whole) < 1e-6);
});

// ------------------------------------------------------------------ key from the settings, redirects, address checks, attribution

test('the Mapillary key comes from the caller or the node settings; env still wins inside the settings', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-streetlevel-key-'));
  const saved = process.env['MAPILLARY_TOKEN'];
  delete process.env['MAPILLARY_TOKEN'];
  try {
    const seen: { url: string; auth: string | undefined }[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      seen.push({ url, auth: (init.headers as Record<string, string>)['Authorization'] });
      return url.startsWith('https://graph.mapillary.com/') ? new Response(JSON.stringify({ data: [] }), { status: 200 }) : new Response(JSON.stringify({ features: [] }), { status: 200 });
    };
    const input = { frameVectors: landmarkFrames(), dim: 8, candidates: [{ ...CENTRE, radiusKm: 0.5 }], model: new ColourEmbedder(), options: { ...BASE, providers: ['mapillary'] as const, maxTilesPerCandidate: 1 } };

    // Given by the caller (what the engine does with settings.mapillaryKey()).
    await refineStreetLevel(input, { fetch: fetchImpl, mapillaryKey: TOKEN });
    assert.ok(seen.some((s) => s.auth === `OAuth ${TOKEN}`));

    // From the settings of the node: nothing stored, no request to Mapillary, and the note says why.
    seen.length = 0;
    const none = await refineStreetLevel(input, { fetch: fetchImpl, dataDir });
    assert.equal(seen.length, 0);
    assert.match(none.providers[0]?.note ?? '', /Kein Mapillary-Schlüssel hinterlegt/);
    assert.match(none.providers[0]?.noteEn ?? '', /No Mapillary key stored/);

    // Stored by an operator: used.
    const { datumSettings } = await import('../src/datum/settings.js');
    const store = datumSettings(dataDir);
    const stored = await store.setMapillaryKey(TOKEN);
    assert.ok('view' in stored);
    await refineStreetLevel(input, { fetch: fetchImpl, dataDir });
    assert.ok(seen.some((s) => s.auth === `OAuth ${TOKEN}`));

    // MAPILLARY_TOKEN in the environment wins over the stored key.
    seen.length = 0;
    process.env['MAPILLARY_TOKEN'] = 'MLY|99|fromtheenvironment000';
    await refineStreetLevel(input, { fetch: fetchImpl, dataDir });
    assert.ok(seen.length > 0 && seen.every((s) => s.auth === 'OAuth MLY|99|fromtheenvironment000'));

    // A null key from the caller means none, whatever is stored.
    seen.length = 0;
    await refineStreetLevel(input, { fetch: fetchImpl, dataDir, mapillaryKey: null });
    assert.equal(seen.length, 0);
  } finally {
    if (saved === undefined) delete process.env['MAPILLARY_TOKEN'];
    else process.env['MAPILLARY_TOKEN'] = saved;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('redirects are followed one by one, re-checked, and never carry the key to another host', async () => {
  const red = await jpeg(230, 20, 20);
  const grey = await jpeg(120, 120, 120);
  const pictures = fakePictures();
  const seen: { url: string; headers: Record<string, string>; redirect: RequestRedirect | undefined }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    seen.push({ url, headers: { ...(init.headers as Record<string, string>) }, redirect: init.redirect });
    const u = new URL(url);
    if (u.hostname === 'graph.mapillary.com') {
      const b = bboxOf(url);
      const data = pictures
        .filter((p) => inBbox(p, b))
        .map((p) => ({ id: String(1000 + pictures.indexOf(p)), computed_geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, thumb_256_url: `https://thumbs.mapillary.example/${p.red ? 'red' : 'grey'}-${p.id}.jpg` }));
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    // The thumbnail host sends every picture on to a storage host; the red one goes via an internal address.
    if (u.hostname === 'thumbs.mapillary.example') {
      const target = u.pathname.startsWith('/red') ? 'https://10.0.0.7/red.jpg' : `https://storage.example.net${u.pathname}`;
      return new Response(null, { status: 302, headers: { location: target } });
    }
    if (u.hostname === 'storage.example.net') return new Response(new Uint8Array(u.pathname.startsWith('/red') ? red : grey), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    if (u.hostname === '10.0.0.7') return new Response(new Uint8Array(red), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    return new Response('?', { status: 404 });
  };
  const result = await refineStreetLevel(
    { frameVectors: landmarkFrames(), dim: 8, candidates: [{ ...CENTRE, radiusKm: 1.5 }], model: new ColourEmbedder(), options: { ...BASE, providers: ['mapillary'] } },
    { fetch: fetchImpl, mapillaryKey: TOKEN },
  );
  // The red picture was never fetched from the internal address: no match from it.
  assert.equal(seen.filter((s) => s.url.startsWith('https://10.')).length, 0);
  assert.ok(seen.filter((s) => s.url.startsWith('https://storage.example.net/')).length > 0);
  assert.notEqual(result.top[0]?.id, '1020');
  for (const s of seen) {
    assert.equal(s.redirect, 'manual');
    if (!s.url.startsWith('https://graph.mapillary.com/')) assert.equal(s.headers['Authorization'], undefined, `key sent to ${s.url}`);
  }

  // More than two hops are refused.
  let hops = 0;
  const loop: FetchLike = async (url) => {
    if (url.startsWith('https://api.panoramax.xyz/')) {
      return new Response(JSON.stringify({ type: 'FeatureCollection', features: pictures.slice(0, 1).map((p) => panoramaxFeature(p)) }), { status: 200 });
    }
    hops++;
    return new Response(null, { status: 301, headers: { location: `https://thumbs.example.org/hop-${hops}.jpg` } });
  };
  await refineStreetLevel({ frameVectors: landmarkFrames(), dim: 8, candidates: [{ ...CENTRE, radiusKm: 1.5 }], model: new ColourEmbedder(), options: BASE }, { fetch: loop, env: {} });
  assert.ok(hops >= 1 && hops <= 3, `${hops} requests for one picture`);
});

test('with an address check, hosts that resolve to internal addresses are not asked', async () => {
  const { fetchImpl, seen } = await fakeServices();
  const result = await refineStreetLevel(
    { frameVectors: landmarkFrames(), dim: 8, candidates: [{ ...CENTRE, radiusKm: 1.5 }], model: new ColourEmbedder(), options: BASE },
    { fetch: fetchImpl, env: {}, lookup: async (host) => (host === 'thumbs.example.org' ? ['192.168.1.20'] : ['203.0.114.10']) },
  );
  assert.equal(seen.filter((s) => s.url.startsWith('https://thumbs.example.org/')).length, 0);
  assert.equal(result.matched, false);
  assert.ok(seen.some((s) => s.url.startsWith('https://api.panoramax.xyz/')));
});

test('a producer name that is an e-mail address is replaced by the instance in the attribution', () => {
  assert.equal(publicAuthor('jdupont', 'IGN'), 'jdupont');
  assert.equal(publicAuthor('jean.dupont@example.fr', 'IGN'), 'IGN');
  assert.equal(publicAuthor('Jean <jean@example.fr>', null), null);
  assert.equal(publicAuthor(null, 'IGN'), null);
  const withHost = {
    ...panoramaxFeature({ id: 'mail-1', lat: 48.85, lon: 2.29, red: false }),
    providers: [
      { name: 'IGN', roles: ['host', 'licensor'] },
      { name: 'jean.dupont@example.fr', roles: ['producer'] },
    ],
  };
  const withoutHost = { ...panoramaxFeature({ id: 'mail-2', lat: 48.85, lon: 2.29, red: false }), providers: [{ name: 'someone@example.org', roles: ['producer'] }] };
  const [a, b] = parsePanoramaxSearch({ type: 'FeatureCollection', features: [withHost, withoutHost] });
  assert.equal(a?.author, 'IGN');
  assert.equal(a?.attribution, '© IGN, CC BY-SA 4.0, Panoramax');
  assert.equal(b?.author, 'thumbs.example.org');
  for (const p of [a, b]) assert.ok(!JSON.stringify(p).includes('@'), JSON.stringify(p));
  const mly = parseMapillarySearch({ data: [{ id: '5', computed_geometry: { type: 'Point', coordinates: [2.29, 48.85] }, thumb_256_url: 'https://scontent.example.net/a.jpg', creator: { username: 'x@y.example' } }] });
  assert.equal(mly[0]?.author, null);
  assert.equal(mly[0]?.attribution, 'CC BY-SA 4.0, Mapillary');
});
