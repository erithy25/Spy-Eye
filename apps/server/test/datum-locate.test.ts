import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GalleryNeighbour } from '../src/datum/gallery.js';
import type { GeoclipPrediction } from '../src/datum/geoclip.js';
import { DEFAULT_LOCATE_PARAMS, REGION_ROLE, analysisFrameCount, analysisFrameNumbers, decideLocation, frameAgreement, gpsCountries, poolTileRows, voteModes, weightNeighbours, type LocateEvidence, type WeightedRef } from '../src/datum/locate.js';
import { filenameHints, judgeCreationTime, metadataFromProbe, parseIso6709, parseTagDate, parseTagDay } from '../src/datum/metadata.js';
import { World, greatCircleKm, pointInRing, type LonLat } from '../src/datum/world.js';
import { countryCorrect, scoredDecision } from '../src/scripts/datum/scoring.js';
import { interleaveByContinent } from '../src/scripts/datum/selection.js';

/** Deterministic pseudo-random numbers. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function ref(id: string, lat: number, lon: number, weight: number, country = 'DE'): WeightedRef {
  return { id, label: id, lat, lon, country, weight, bestSimilarity: 0.8, bestRow: 0 };
}

const box = (w: number, s: number, e: number, n: number): LonLat[] => [
  [w, s],
  [e, s],
  [e, n],
  [w, n],
  [w, s],
];

/** Two square "countries" and a few cities. */
function fixtureWorld(): World {
  return World.fromJson(
    [
      {
        iso: 'DE', name_de: 'Deutschland', name_en: 'Germany', continent: 'Europe', centroid: [10, 51], areaKm2: 357000,
        bbox: [6, 47, 15, 55],
        // Outer ring with a hole (a "lake") between 9..10 E, 50..51 N.
        polygons: [box(6, 47, 15, 55), box(9, 50, 10, 51)],
      },
      {
        iso: 'FR', name_de: 'Frankreich', name_en: 'France', continent: 'Europe', centroid: [2.5, 46.5], areaKm2: 550000,
        bbox: [-5, 42, 6, 51],
        polygons: [[box(-5, 42, 6, 51)]], // one level deeper: a polygon of rings
      },
    ],
    [
      { name: 'Koblenz', name_de: 'Koblenz', iso: 'DE', lat: 50.36, lon: 7.59, pop: 113000 },
      { name: 'Cologne', name_de: 'Köln', iso: 'DE', lat: 50.94, lon: 6.96, pop: 1080000 },
      { name: 'Berlin', name_de: 'Berlin', iso: 'DE', lat: 52.52, lon: 13.4, pop: 3600000 },
      { name: 'Paris', name_de: 'Paris', iso: 'FR', lat: 48.86, lon: 2.35, pop: 2100000 },
    ],
  );
}

test('geodesic voting finds the mode of a cluster among scattered neighbours', () => {
  const rand = rng(7);
  const target = { lat: 50.3644, lon: 7.6058 };
  const refs: WeightedRef[] = [];
  // 12 neighbours within ~1.5 km of the target, moderately weighted.
  for (let i = 0; i < 12; i++) {
    refs.push(ref(`c${i}`, target.lat + (rand() - 0.5) * 0.02, target.lon + (rand() - 0.5) * 0.03, 1 + rand()));
  }
  // 30 distractors all over Europe, some individually heavier than any cluster member.
  for (let i = 0; i < 30; i++) refs.push(ref(`d${i}`, 40 + rand() * 20, -5 + rand() * 30, i < 3 ? 3 : 0.5 + rand()));
  const modes = voteModes(refs, DEFAULT_LOCATE_PARAMS);
  const best = modes[0];
  assert.ok(best);
  const errKm = greatCircleKm(best.lat, best.lon, target.lat, target.lon);
  assert.ok(errKm < 1, `mode ${errKm.toFixed(2)} km from the cluster centre`);
  assert.ok(best.members.length >= 10, `mode has ${best.members.length} members`);
  // Every reference belongs to exactly one mode.
  const all = modes.flatMap((m) => m.members).sort((a, b) => a - b);
  assert.deepEqual(all, refs.map((_, i) => i));
});

test('neighbour weighting sharpens similarity and pools frames', () => {
  const n = (id: string, s: number): GalleryNeighbour => ({ id, label: id, lat: 50, lon: 7, country: 'DE', wikidata: null, similarity: s });
  const refs = weightNeighbours([[n('a', 0.9), n('b', 0.6)], [n('a', 0.85)]], { simOffset: 0.6, simTemperature: 0.03 });
  assert.equal(refs[0]?.id, 'a');
  assert.equal(refs[0]?.bestSimilarity, 0.9);
  assert.ok((refs[0]?.weight ?? 0) > 1000 * (refs[1]?.weight ?? 1));
  // 'max': a reference counts once, with its best frame; the mean divides by the frames.
  const maxed = weightNeighbours([[n('a', 0.9)], [n('a', 0.85)]], { simOffset: 0.6, simTemperature: 0.03, frameAggregation: 'max' });
  assert.equal(maxed.length, 1);
  assert.ok(Math.abs((maxed[0]?.weight ?? 0) - Math.exp(0.3 / 0.03)) < 1e-6 * Math.exp(10));
  assert.equal(maxed[0]?.bestRow, 0);
});

test('tile rows: whole frames only, best tile per frame, or every tile', () => {
  const n = (id: string, s: number): GalleryNeighbour => ({ id, label: id, lat: 50, lon: 7, country: 'DE', wikidata: null, similarity: s });
  // Two frames with two tiles each (tile 0 = whole frame); the crop of frame 0 finds 'tower'.
  const rows = [
    [n('street', 0.7), n('tower', 0.5)],
    [n('tower', 0.9), n('street', 0.4)],
    [n('park', 0.6)],
    [n('park', 0.65), n('street', 0.3)],
  ];
  const rowFrame = [0, 0, 1, 1];
  const rowTile = [0, 1, 0, 1];
  const whole = poolTileRows(rows, rowFrame, rowTile, 'whole', 5);
  assert.deepEqual(whole.rows.map((r) => r.map((x) => x.id)), [['street', 'tower'], ['park']]);
  assert.deepEqual(whole.frameOfRow, [0, 1]);
  const frame = poolTileRows(rows, rowFrame, rowTile, 'frame', 5);
  assert.deepEqual(frame.rows.map((r) => r.map((x) => `${x.id}:${x.similarity}`)), [['tower:0.9', 'street:0.7'], ['park:0.65', 'street:0.3']]);
  assert.deepEqual(frame.frameOfRow, [0, 1]);
  // k caps the merged list.
  assert.equal(poolTileRows(rows, rowFrame, rowTile, 'frame', 1).rows[0]?.length, 1);
  const every = poolTileRows(rows, rowFrame, rowTile, 'rows', 5);
  assert.equal(every.rows.length, 4);
  assert.deepEqual(every.frameOfRow, rowFrame);
  // Without tile information every row is a frame.
  assert.deepEqual(poolTileRows(rows, undefined, undefined, 'frame', 5).frameOfRow, [0, 1, 2, 3]);
});

test('frame agreement: share of frames whose best match lies near the answer', () => {
  const at = (id: string, lat: number, lon: number): GalleryNeighbour => ({ id, label: id, lat, lon, country: null, wikidata: null, similarity: 0.8 });
  const rows = [[at('a', 50.36, 7.6)], [at('b', 50.4, 7.65), at('far', 0, 0)], [at('c', 48.86, 2.35)], []];
  // Three frames with a match; two of them within 25 km of Koblenz, Paris is not.
  assert.equal(frameAgreement(rows, 50.36, 7.59), 2 / 3);
  assert.equal(frameAgreement(rows, 50.36, 7.59, 1000), 1);
  assert.equal(frameAgreement([], 0, 0), 0);
});

test('gallery selection interleaves continents and keeps the order within each', () => {
  const items = [
    { id: 'eu1', c: 'EU' },
    { id: 'eu2', c: 'EU' },
    { id: 'eu3', c: 'EU' },
    { id: 'as1', c: 'AS' },
    { id: 'af1', c: 'AF' },
    { id: 'xx1', c: 'XX' },
    { id: 'as2', c: 'AS' },
  ];
  const out = interleaveByContinent(items, (i) => i.c).map((i) => i.id);
  assert.deepEqual(out, ['eu1', 'as1', 'af1', 'xx1', 'eu2', 'as2', 'eu3']);
  assert.deepEqual(interleaveByContinent([], () => 'EU'), []);
});

test('point in polygon with holes and nested rings', () => {
  const square = box(0, 0, 10, 10);
  assert.equal(pointInRing(5, 5, square), true);
  assert.equal(pointInRing(11, 5, square), false);
  assert.equal(pointInRing(-0.001, 5, square), false);
  // Concave ring (a "C"): the notch is outside.
  const c: LonLat[] = [[0, 0], [10, 0], [10, 3], [3, 3], [3, 7], [10, 7], [10, 10], [0, 10], [0, 0]];
  assert.equal(pointInRing(5, 5, c), false);
  assert.equal(pointInRing(1, 5, c), true);

  const world = fixtureWorld();
  assert.equal(world.countryAt(50.36, 7.6)?.iso, 'DE');
  assert.equal(world.countryAt(48.86, 2.35)?.iso, 'FR');
  assert.equal(world.countryAt(50.5, 9.5), null, 'inside the hole');
  assert.equal(world.countryAt(0, 0), null);
  // Just outside, but a city of the country is near.
  assert.equal(world.countryNear(55.05, 13.4, 300)?.iso, 'DE');
});

test('nearest city through the grid index', () => {
  const world = fixtureWorld();
  const near = world.nearestCity(50.37, 7.6);
  assert.equal(near?.name, 'Koblenz');
  assert.ok((near?.distanceKm ?? 99) < 2);
  assert.equal(world.nearestCity(50.9, 7.0)?.name, 'Köln');
  // Far from everything, but within the default search distance.
  assert.equal(world.nearestCity(53, 20)?.name, 'Berlin');
  assert.equal(world.nearestCity(-40, 170, { maxKm: 500 }), null);
  assert.equal(world.biggestCity('DE')?.name, 'Berlin');
});

test('ISO 6709 strings', () => {
  assert.deepEqual(parseIso6709('+50.3644+007.6058+065.000/'), { lat: 50.3644, lon: 7.6058, altitude: 65 });
  assert.deepEqual(parseIso6709('+50.3644+007.6058/'), { lat: 50.3644, lon: 7.6058, altitude: null });
  assert.deepEqual(parseIso6709('-33.8568+151.2153-012.5/'), { lat: -33.8568, lon: 151.2153, altitude: -12.5 });
  const dm = parseIso6709('+5021.864+00736.348/');
  assert.ok(dm && Math.abs(dm.lat - 50.3644) < 1e-4 && Math.abs(dm.lon - 7.6058) < 1e-4);
  const dms = parseIso6709('+502151.84+0073620.88/');
  assert.ok(dms && Math.abs(dms.lat - 50.3644) < 1e-4 && Math.abs(dms.lon - 7.6058) < 1e-4);
  assert.equal(parseIso6709('+27.5916+086.5640+8850CRSWGS_84/')?.altitude, 8850);
  assert.equal(parseIso6709('+00.0000+000.0000/'), null);
  assert.equal(parseIso6709('+95.0+007.0/'), null);
  assert.equal(parseIso6709('nonsense'), null);
});

test('metadata from ffprobe tags: GPS, device, bogus times', () => {
  const now = Date.UTC(2026, 0, 1);
  const meta = metadataFromProbe(
    {
      format: {
        duration: '12.5',
        tags: {
          'com.apple.quicktime.location.ISO6709': '+50.3644+007.6058+065.000/',
          'com.apple.quicktime.make': 'Apple',
          'com.apple.quicktime.model': 'iPhone 12',
          'com.apple.quicktime.creationdate': '2018-06-17T14:34:56+0200',
          creation_time: '2018-06-17T12:34:57.000000Z',
        },
      },
      streams: [{ codec_type: 'video', avg_frame_rate: '30000/1001', width: 1920, height: 1080 }],
    },
    null,
    now,
  );
  assert.deepEqual(meta.location, { lat: 50.3644, lon: 7.6058 });
  assert.equal(meta.altitude, 65);
  assert.equal(meta.device, 'Apple iPhone 12');
  assert.equal(meta.creationUtc, Date.UTC(2018, 5, 17, 12, 34, 56));
  assert.ok(Math.abs((meta.fps ?? 0) - 29.97) < 0.01);
  assert.equal(meta.durationSec, 12.5);

  // 1904/1970 defaults, the future, and a transcoder's own timestamp are all rejected.
  assert.ok(judgeCreationTime(Date.UTC(1904, 0, 1), { encoder: null, fileMtimeMs: null, now }));
  assert.ok(judgeCreationTime(0, { encoder: null, fileMtimeMs: null, now }));
  assert.ok(judgeCreationTime(now + 3 * 86400_000, { encoder: null, fileMtimeMs: null, now }));
  const t = Date.UTC(2025, 5, 1, 10, 0);
  assert.ok(judgeCreationTime(t, { encoder: 'Lavf60.16.100', fileMtimeMs: t + 60_000, now }));
  assert.equal(judgeCreationTime(t, { encoder: 'Lavf60.16.100', fileMtimeMs: t + 30 * 86400_000, now }), null);
  const transcoded = metadataFromProbe({ format: { tags: { encoder: 'Lavf58.29.100', creation_time: '1970-01-01T00:00:00.000000Z' } } }, null, now);
  assert.equal(transcoded.creationUtc, null);
  assert.ok(transcoded.creationRejected);

  assert.equal(parseTagDate('2018:06:17 12:34:56'), Date.UTC(2018, 5, 17, 12, 34, 56));
  assert.equal(metadataFromProbe({ format: { tags: { location: '+48.8584+002.2945/' } } }, null, now).location?.lat, 48.8584);
});

test('a date or a year without a time of day is no recording instant', () => {
  const now = Date.UTC(2026, 0, 1);
  // Date.parse would make each of these midnight UTC, reported as the exact recording time.
  for (const value of ['2018', '2019-07', '2019-07-04', 'July 4, 2019', '2019-07-04+02:00']) assert.equal(parseTagDate(value), null, value);
  // Values with a time of day still parse, in all the forms seen in files.
  assert.equal(parseTagDate('2018-06-17T14:34:56+0200'), Date.UTC(2018, 5, 17, 12, 34, 56));
  assert.equal(parseTagDate('2018-06-17 12:34'), Date.UTC(2018, 5, 17, 12, 34));
  assert.equal(parseTagDate('Thu Jul 04 12:00:00 2019'), new Date('Thu Jul 04 12:00:00 2019').getTime());
  assert.equal(parseTagDay('2019-07-04'), '2019-07-04');
  assert.equal(parseTagDay('2019:07:04'), '2019-07-04');
  assert.equal(parseTagDay('2019'), null);
  assert.equal(parseTagDay('2019-02-30'), null);

  // The reviewer's case: creation_time rejected as a transcode stamp, a date-only "date" tag.
  const mtime = Date.UTC(2025, 5, 1, 10, 0);
  const transcoded = metadataFromProbe(
    { format: { tags: { encoder: 'Lavf58.29.100', creation_time: new Date(mtime - 5 * 60_000).toISOString(), date: '2019-07-04' } } },
    mtime,
    now,
  );
  assert.equal(transcoded.creationUtc, null);
  assert.ok(transcoded.creationRejected);
  // The day is kept as a date hint (like a date in the file name), never as an instant.
  assert.equal(transcoded.creationDate, '2019-07-04');

  // A camera AVI: ICRD maps to "date" and holds a date only.
  assert.deepEqual(
    (({ creationUtc, creationDate }) => ({ creationUtc, creationDate }))(metadataFromProbe({ format: { tags: { date: '2019-07-04' } } }, null, now)),
    { creationUtc: null, creationDate: '2019-07-04' },
  );
  // A year alone says nothing usable; a day in the future is not believed.
  assert.equal(metadataFromProbe({ format: { tags: { date: '2018' } } }, null, now).creationDate, null);
  assert.equal(metadataFromProbe({ format: { tags: { date: '2026-03-01' } } }, null, now).creationDate, null);
  // The day a transcoder rewrote the file is its stamp, not the recording date.
  assert.equal(metadataFromProbe({ format: { tags: { encoder: 'HandBrake 1.6', date: '2025-06-01' } } }, mtime, now).creationDate, null);
  // With an exact instant the date hint is not needed.
  const both = metadataFromProbe({ format: { tags: { date: '2019-07-04', creationdate: '2019-07-04T12:00:00Z' } } }, null, now);
  assert.equal(both.creationUtc, Date.UTC(2019, 6, 4, 12));
  assert.equal(both.creationDate, null);
});

test('dates and places in file names', () => {
  assert.equal(filenameHints('2018-06-17 Deutsches Eck.mp4').date, '2018-06-17');
  assert.equal(filenameHints('2018-06-17 Deutsches Eck.mp4').place, 'Deutsches Eck');
  assert.equal(filenameHints('VID_20180617_123456.mp4').date, '2018-06-17');
  assert.equal(filenameHints('VID_20180617_123456.mp4').place, null);
  assert.equal(filenameHints('PXL_20230105_101112345.mp4').date, '2023-01-05');
  assert.equal(filenameHints('Hochwasser Ahr 17.06.2018.mov').date, '2018-06-17');
  assert.equal(filenameHints('Hochwasser Ahr 17.06.2018.mov').place, 'Hochwasser Ahr');
  assert.equal(filenameHints('20180617.mp4').date, '2018-06-17');
  assert.equal(filenameHints('clip_2018_06_17_koblenz.mp4').place, 'koblenz');
  assert.equal(filenameHints('20181317.mp4').date, null, 'month 13');
  assert.equal(filenameHints('20180231.mp4').date, null, '31 February');
  assert.equal(filenameHints('DJI_0042.MP4').date, null);
  assert.equal(filenameHints('DJI_0042.MP4').place, null);
  assert.equal(filenameHints('Q2981.mp4').place, null);
});

test('decideLocation: strong landmark, weak retrieval falls back to the country, metadata wins', () => {
  const world = fixtureWorld();
  const n = (id: string, lat: number, lon: number, s: number, country = 'DE'): GalleryNeighbour => ({
    id, label: id, lat, lon, country, wikidata: null, similarity: s,
  });
  // The cosines rank Germany first (two countries in the fixture).
  const cos = new Float32Array([0.12, 0.08]);
  const strong = decideLocation(world, {
    neighbours: [
      [n('Deutsches Eck', 50.3644, 7.6058, 0.9), n('Louvre', 48.861, 2.336, 0.62, 'FR')],
      [n('Deutsches Eck', 50.3644, 7.6058, 0.88), n('Kölner Dom', 50.9413, 6.9583, 0.6)],
    ],
    countryCosines: cos,
    frameNumbers: [10, 20],
    metadata: null,
    hints: null,
  });
  assert.equal(strong.location?.method, 'landmark');
  assert.ok(greatCircleKm(strong.location?.lat ?? 0, strong.location?.lon ?? 0, 50.3644, 7.6058) < 0.5);
  // A match that stands out is the 'strong' tier: its calibrated (small) radius, not the
  // continental one of a mere similarity.
  assert.equal(strong.diagnostics.radiusTier, 'strong');
  assert.ok((strong.location?.radiusKm ?? 99) <= Math.max(1, DEFAULT_LOCATE_PARAMS.radiusKm.strong));
  assert.ok(DEFAULT_LOCATE_PARAMS.radiusKm.strong < DEFAULT_LOCATE_PARAMS.radiusKm.similar);
  assert.match(strong.location?.label ?? '', /Deutsches Eck, Koblenz/);
  assert.equal(strong.location?.country, 'DE');
  const scoreSum = strong.candidates.reduce((s, c) => s + c.score, 0);
  assert.ok(scoreSum <= 1 + 1e-9);
  const refEvidence = strong.evidence.filter((e) => e.kind === 'landmark');
  assert.equal(refEvidence[0]?.refImage, '/api/datum/gallery/Deutsches%20Eck.jpg');
  assert.equal(refEvidence[0]?.frame, 10);

  const weak = decideLocation(world, {
    neighbours: [[n('a', 52.5, 13.4, 0.4), n('b', 48.1, 11.6, 0.38)]],
    countryCosines: cos,
    frameNumbers: [1],
    metadata: null,
    hints: { date: '2018-06-17', place: null },
  });
  assert.equal(weak.location?.method, 'region');
  assert.equal(weak.location?.country, 'DE');
  assert.ok((weak.location?.radiusKm ?? 0) > 200);
  // The country-level circle is calibrated (a multiple of the country's size), so it may be
  // likely to hold the truth, but never certain.
  assert.ok((weak.location?.radiusKm ?? 0) >= Math.sqrt(357000), 'the circle covers at least the country');
  assert.ok((weak.location?.confidence ?? 1) <= 0.95, 'a country-level answer is never certain');
  assert.ok(weak.evidence.some((e) => e.kind === 'filename'));

  const withGps = decideLocation(world, {
    neighbours: [[n('a', 52.5, 13.4, 0.4)]],
    countryCosines: cos,
    frameNumbers: [1],
    metadata: {
      creationUtc: null, creationDate: null, location: { lat: 48.8584, lon: 2.2945 }, altitude: null, device: null, raw: {},
      durationSec: null, fps: null, width: null, height: null,
    },
    hints: null,
  });
  assert.equal(withGps.location?.method, 'metadata');
  assert.equal(withGps.location?.radiusKm, 0.05);
  assert.equal(withGps.location?.country, 'FR');
  assert.ok(withGps.diagnostics.visual, 'the visual estimate is still computed');
  // The countries follow the place the GPS position gives: its country first, with the fix's
  // confidence; the pictures (a German neighbour) share the rest.
  assert.equal(withGps.countries[0]?.iso, 'FR');
  assert.equal(withGps.countries[0]?.p, 0.98);
  assert.equal(withGps.countries[0]?.name, 'Frankreich');
  assert.equal(withGps.countries[1]?.iso, 'DE');
  assert.ok(Math.abs(withGps.countries.reduce((sum, c) => sum + c.p, 0) - 1) < 1e-9);
  // The pictures' own estimate stays in the region entry, which says whose it is and decides nothing.
  const region = withGps.evidence.find((e) => e.kind === 'region');
  assert.ok(region);
  assert.equal(region.weight, 0);
  assert.match(region.detail, /Schätzung der Bilder allein/);
  assert.match(region.detailEn ?? '', /pictures' estimate alone/);
  assert.match(region.detail, /Deutschland \d+ %/);
  // Without GPS the entry weights the candidates as before.
  const plain = strong.evidence.find((e) => e.kind === 'region');
  assert.ok(plain && plain.weight > 0);
  assert.match(plain.detail, /weiche Gewichtung/);
});

/** A world model concentrated at Paris (it replaces a weak gallery answer in Germany). */
function parisWorldModel(): GeoclipPrediction {
  const count = 50;
  const coords = new Float32Array(count * 2);
  const probs = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    coords[i * 2] = 48.86 + (i % 5) * 0.01;
    coords[i * 2 + 1] = 2.35 + Math.floor(i / 5) * 0.01;
    probs[i] = 1 / count;
  }
  return {
    frames: 12,
    aggregation: 'mixture',
    probs,
    coords,
    support: Uint32Array.from({ length: count }, (_, i) => i),
    top: [{ lat: 48.86, lon: 2.35, p: 0.02 }],
    modes: [{ lat: 48.86, lon: 2.35, p: 0.9, peak: { lat: 48.86, lon: 2.35, p: 0.02 }, spreadKm: 2 }],
    refined: null,
    best: { lat: 48.86, lon: 2.35 },
    countries: [{ iso: 'FR', name: 'Frankreich', p: 1 }],
    timing: { embedMs: 0, scoreMs: 0, refineMs: 0 },
  };
}

test('decideLocation: GPS in no country (at sea) gives the place; the country estimate says the countries are its own', () => {
  const world = fixtureWorld();
  const n = (id: string, lat: number, lon: number, s: number): GalleryNeighbour => ({ id, label: id, lat, lon, country: 'DE', wikidata: null, similarity: s });
  const atSea = (lat: number, lon: number): LocateEvidence['metadata'] => ({
    creationUtc: null, creationDate: null, location: { lat, lon }, altitude: null, device: null, raw: {},
    durationSec: null, fps: null, width: null, height: null,
  });
  const ev = { neighbours: [[n('a', 52.5, 13.4, 0.4), n('b', 48.1, 11.6, 0.38)]], countryCosines: new Float32Array([0.12, 0.08]), frameNumbers: [1], hints: null };
  // 56.5 N 3 E: north of both fixture countries, far from every city: no country.
  const sea = decideLocation(world, { ...ev, metadata: atSea(56.5, 3) });
  assert.equal(sea.location?.method, 'metadata');
  assert.equal(sea.location?.country, null);
  // gpsCountries leaves the list as it is: the fix's countries are the pictures' estimate.
  const pictures = decideLocation(world, { ...ev, metadata: null });
  assert.deepEqual(sea.countries, pictures.countries);
  assert.equal(sea.countries[0]?.iso, 'DE');
  const region = sea.evidence.find((e) => e.kind === 'region');
  assert.ok(region);
  assert.equal(region.weight, 0, 'the GPS position gives the place');
  // Not "the fix's countries begin with that one": the position has no country.
  assert.doesNotMatch(region.detail, /beginnen mit diesem/);
  assert.doesNotMatch(region.detailEn ?? '', /begin with that one/);
  assert.ok(region.detail.endsWith(REGION_ROLE.gpsNoCountry.de), region.detail);
  assert.ok(region.detailEn?.endsWith(REGION_ROLE.gpsNoCountry.en), region.detailEn);
  assert.match(region.detail, /in keinem Land/);
  assert.match(region.detailEn ?? '', /in no country/);

  // Where the world model replaced the gallery's answer, the countries are its own (Frankreich).
  const seaWorld = decideLocation(world, { ...ev, metadata: atSea(56.5, 3), geoclip: parisWorldModel() });
  assert.equal(seaWorld.diagnostics.worldModel?.replaced, true);
  assert.equal(seaWorld.location?.method, 'metadata');
  assert.equal(seaWorld.countries[0]?.iso, 'FR');
  const regionWorld = seaWorld.evidence.find((e) => e.kind === 'region');
  assert.ok(regionWorld?.detail.endsWith(REGION_ROLE.gpsNoCountryWorld.de), regionWorld?.detail);
  assert.ok(regionWorld?.detailEn?.endsWith(REGION_ROLE.gpsNoCountryWorld.en), regionWorld?.detailEn);
  assert.equal(regionWorld?.weight, 0);

  // With a country (Paris) the text stays: the countries begin with the position's.
  const paris = decideLocation(world, { ...ev, metadata: atSea(48.8584, 2.2945) });
  assert.equal(paris.countries[0]?.iso, 'FR');
  assert.ok(paris.evidence.find((e) => e.kind === 'region')?.detail.endsWith(REGION_ROLE.gps.de));
});

test('evaluation: the pictures are scored, not GPS in the file (scoring.ts)', () => {
  const world = fixtureWorld();
  const n = (id: string, lat: number, lon: number, s: number): GalleryNeighbour => ({ id, label: id, lat, lon, country: 'DE', wikidata: null, similarity: s });
  // The pictures say Germany; the file's GPS position (and the truth) is the Eiffel Tower.
  const ev: LocateEvidence = {
    neighbours: [[n('a', 52.5, 13.4, 0.4), n('b', 48.1, 11.6, 0.38)]],
    countryCosines: new Float32Array([0.12, 0.08]),
    frameNumbers: [1],
    metadata: {
      creationUtc: null, creationDate: null, location: { lat: 48.8584, lon: 2.2945 }, altitude: null, device: null, raw: {},
      durationSec: null, fps: null, width: null, height: null,
    },
    hints: null,
  };
  const truth = ['FR'];
  // The node's decision puts the GPS country first: scored, every clip with GPS would be right.
  const node = decideLocation(world, ev, DEFAULT_LOCATE_PARAMS);
  assert.equal(node.countries[0]?.iso, 'FR');
  assert.equal(countryCorrect(node, truth), true);
  // The measurement scores the pictures' answer: Germany, wrong.
  const scored = scoredDecision(world, ev, DEFAULT_LOCATE_PARAMS);
  assert.equal(scored.diagnostics.method, 'region');
  assert.equal(scored.countries[0]?.iso, 'DE');
  assert.equal(countryCorrect(scored, truth), false);
  // What else the measurement reads does not depend on the metadata.
  assert.deepEqual(scored.diagnostics.visual, node.diagnostics.visual);
  assert.deepEqual(scored.diagnostics.countryTop, node.diagnostics.countryTop);
  assert.equal(scored.diagnostics.radiusTier, node.diagnostics.radiusTier);
  // Without GPS the decision is the node's.
  assert.deepEqual(scoredDecision(world, { ...ev, metadata: null }, DEFAULT_LOCATE_PARAMS).countries, scored.countries);
  assert.equal(countryCorrect(scored, []), null, 'no truth country, no score');
});

test('gpsCountries: the GPS country first with its confidence, the rest in proportion', () => {
  const gps = { lat: 51.9, lon: -8.46, radiusKm: 0.05, confidence: 0.98, method: 'metadata' as const, label: 'Cork', country: 'IE', countryName: 'Irland' };
  const pictures = [
    { iso: 'DE', name: 'Deutschland', p: 0.74 },
    { iso: 'GB', name: 'Vereinigtes Königreich', p: 0.15 },
    { iso: 'IE', name: 'Irland', p: 0.02 },
    { iso: 'US', name: 'Vereinigte Staaten', p: 0.09 },
  ];
  const out = gpsCountries(gps, pictures);
  assert.deepEqual(out.map((c) => c.iso), ['IE', 'DE', 'GB', 'US']);
  assert.equal(out[0]?.p, 0.98);
  assert.ok(Math.abs((out[1]?.p ?? 0) / (out[2]?.p ?? 1) - 0.74 / 0.15) < 1e-9, 'the pictures keep their proportions');
  assert.ok(Math.abs(out.reduce((s, c) => s + c.p, 0) - 1) < 1e-9);
  // Over sea (no country) the pictures' list stands.
  assert.deepEqual(gpsCountries({ ...gps, country: null, countryName: null }, pictures), pictures);
});

test('analysisFrameNumbers: frames sampled from the file named on the analysis scale', () => {
  // Frame n of the analysis shows the interval [(n - 1) / sampleFps, n / sampleFps): 0 s is frame
  // 1, 41 s frame 42.
  assert.deepEqual(analysisFrameNumbers([0, 6, 34, 41], 1), [1, 7, 35, 42]);
  // The frame whose interval holds the time, not the nearest start: 2.4 s and 2.6 s both lie in
  // frame 3 (2 to 3 s); europa-rand's church at 69.5625 s is frame 70, not the waterfall of 71.
  assert.deepEqual(analysisFrameNumbers([2.4, 2.6], 1), [3, 3]);
  assert.deepEqual(analysisFrameNumbers([69.5625], 1, 111), [70]);
  assert.deepEqual(analysisFrameNumbers([9.5, 10.5, 11.5], 1, 12), [10, 11, 12]);
  // At 2 fps twice as many: 2.4 s lies in frame 5 (2.0 to 2.5 s).
  assert.deepEqual(analysisFrameNumbers([2.4, 2.5], 2), [5, 6]);
  // Never past the analysis's last frame where it is known: ffmpeg's fps filter writes 12 frames
  // for a clip of 12 s at one a second (frames 1..12 at 0..11 s), not 13.
  assert.deepEqual(analysisFrameNumbers([11.9, 12.4], 1, 12), [12, 12]);
  assert.deepEqual(analysisFrameNumbers([-1], 1), [1]);
  // The last of twelve frames sampled from us-vessel.mp4 (12.012 s) lies at 11.511 s: frame 12,
  // the last the analysis has, with the quick stage's clamp and without it.
  assert.deepEqual(analysisFrameNumbers([11.511], 1), [12]);
  assert.deepEqual(analysisFrameNumbers([11.511], 1, analysisFrameCount(12.012, 1)), [12]);
  // A time at the very end needs the clamp.
  assert.deepEqual(analysisFrameNumbers([12.01], 1), [13]);
  assert.deepEqual(analysisFrameNumbers([12.01], 1, analysisFrameCount(12.012, 1)), [12]);
});

test('analysisFrameCount: the frames the analysis writes, from the duration', () => {
  // As ffmpeg's fps filter writes them (measured on the reference clips): round(d · fps).
  assert.equal(analysisFrameCount(12.012, 1), 12);
  assert.equal(analysisFrameCount(12, 1), 12);
  assert.equal(analysisFrameCount(11.92, 1), 12);
  assert.equal(analysisFrameCount(9.32, 1), 9);
  assert.equal(analysisFrameCount(12.012, 0.5), 6);
  assert.equal(analysisFrameCount(12.012, 2), 24);
  assert.equal(analysisFrameCount(9.32, 4), 37);
  // At least one; none without a duration.
  assert.equal(analysisFrameCount(0.2, 1), 1);
  assert.equal(analysisFrameCount(null, 1), null);
  assert.equal(analysisFrameCount(undefined, 1), null);
  assert.equal(analysisFrameCount(0, 1), null);
  assert.equal(analysisFrameCount(Number.NaN, 1), null);
  // Twelve frames at the middle of equal segments (the localisation's), any clip and rate: none
  // past the analysis's last frame.
  for (const d of [3, 9, 9.32, 11.92, 12, 12.012, 36.5, 61.2]) {
    for (const fps of [0.5, 1, 2, 4]) {
      const times = Array.from({ length: 12 }, (_, i) => (d * (i + 0.5)) / 12);
      const last = analysisFrameCount(d, fps) as number;
      assert.ok(Math.max(...analysisFrameNumbers(times, fps, last)) <= last, `${d} s at ${fps} fps`);
    }
  }
});

test('countryAt falls back to the nearest border within 10 km; flat priors give no 25 km fix', () => {
  const world = fixtureWorld();
  // 5 km east of the DE square (15° E edge) at 52° N: outside every shape, near the border.
  assert.equal(world.countryAt(52, 15.07)?.iso, 'DE');
  assert.equal(world.countryAt(52, 15.07, 0), null, 'strict test without tolerance');
  assert.equal(world.countryAt(52, 15.5), null, '34 km off: no country');

  // A nearly flat country distribution and no usable reference: never a country with a small radius.
  const n = (id: string, lat: number, lon: number, s: number): GalleryNeighbour => ({
    id, label: id, lat, lon, country: null, wikidata: null, similarity: s,
  });
  const flat = decideLocation(
    world,
    { neighbours: [[n('a', 52.5, 13.4, 0.3)]], countryCosines: new Float32Array([0.1, 0.1]), frameNumbers: [1], metadata: null, hints: null },
    { countryMinP: 0.9, continentMinP: 0.5, prior: { temperature: 0.01, uniformMix: 0, populationExponent: 0 } },
  );
  assert.equal(flat.location?.method, 'region');
  assert.equal(flat.location?.country, null, 'continent, not a country');
  assert.ok((flat.location?.radiusKm ?? 0) >= 1500);
  const none = decideLocation(
    world,
    { neighbours: [[n('a', 52.5, 13.4, 0.3)]], countryCosines: new Float32Array([0.1, 0.1]), frameNumbers: [1], metadata: null, hints: null },
    { countryMinP: 0.9, continentMinP: 1.1, prior: { temperature: 0.01, uniformMix: 0, populationExponent: 0 } },
  );
  assert.equal(none.location, null);
  // A country-level answer covers the country.
  const country = decideLocation(
    world,
    { neighbours: [[n('a', 52.5, 13.4, 0.3)]], countryCosines: new Float32Array([0.2, 0.0]), frameNumbers: [1], metadata: null, hints: null },
    { countryMinP: 0.5, prior: { temperature: 0.01, uniformMix: 0, populationExponent: 0 } },
  );
  assert.equal(country.location?.country, 'DE');
  assert.ok((country.location?.radiusKm ?? 0) >= Math.sqrt(357000) - 1);
});
