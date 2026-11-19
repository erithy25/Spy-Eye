import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Evidence, Fix, FixLocation, FixSegment, Keyframe, TimeEstimate } from '../src/datum/contract.js';
import type { GeoclipPrediction } from '../src/datum/geoclip.js';
import type { LocateDiagnostics } from '../src/datum/locate.js';
import { regionAround, regionOf, regionOfCountry } from '../src/datum/regions.js';
import {
  coarsePoint,
  coarseRegions,
  compactSun,
  midpoint,
  multiPlaceTimeEvidence,
  segmentVerdict,
  spaceStretches,
  stretchFrames,
  stretchSpacesNote,
  stretchTimeEvidence,
  stretchTimes,
  summariseSegments,
  wholeFileTimeEvidence,
  type WindowAnswer,
} from '../src/datum/segments.js';
import { estimateTime, type FrameStats } from '../src/datum/time.js';
import { greatCircleKm, World, type LonLat } from '../src/datum/world.js';
import { summarise, timeEvidence } from '../src/datum/engine.js';
// The console's helpers (pure; their imports are types only).
import { chosenStretch, coarseText, spacedStretches, stretchClock, stretchSpaces, timedStretches } from '../../web/src/datum/segments.ts';
import { sunEdges } from '../../web/src/datum/space/sunEdges.ts';

/**
 * Engine 11: the stretches of a recording of several places are complete. Each located stretch
 * has its own time and sun, an undetermined one may name a coarse region (never a place), and the
 * longest located ones have a walkable space of their own, which RAUM enters.
 */

const box = (w: number, s: number, e: number, n: number): LonLat[] => [
  [w, s],
  [e, s],
  [e, n],
  [w, n],
  [w, s],
];

/** Square "countries" and a few cities. */
function fixtureWorld(): World {
  return World.fromJson(
    [
      { iso: 'DE', name_de: 'Deutschland', name_en: 'Germany', continent: 'Europe', centroid: [10, 51], areaKm2: 357000, bbox: [6, 47, 15, 55], polygons: [box(6, 47, 15, 55)] },
      { iso: 'FR', name_de: 'Frankreich', name_en: 'France', continent: 'Europe', centroid: [2.5, 46.5], areaKm2: 550000, bbox: [-5, 42, 6, 51], polygons: [box(-5, 42, 6, 51)] },
      { iso: 'RU', name_de: 'Russland', name_en: 'Russia', continent: 'Europe', centroid: [90, 60], areaKm2: 17000000, bbox: [30, 45, 180, 75], polygons: [box(30, 45, 180, 75)] },
      { iso: 'JP', name_de: 'Japan', name_en: 'Japan', continent: 'Asia', centroid: [138, 36], areaKm2: 378000, bbox: [129, 31, 146, 45], polygons: [box(129, 31, 146, 45)] },
    ],
    [
      { name: 'Berlin', name_de: 'Berlin', iso: 'DE', lat: 52.52, lon: 13.4, pop: 3600000 },
      { name: 'Paris', name_de: 'Paris', iso: 'FR', lat: 48.86, lon: 2.35, pop: 2100000 },
      { name: 'Tokyo', name_de: 'Tokio', iso: 'JP', lat: 35.68, lon: 139.77, pop: 14000000 },
    ],
  );
}

function loc(lat: number, lon: number, over: Partial<FixLocation> = {}): FixLocation {
  return { lat, lon, radiusKm: 3, confidence: 0.9, method: 'landmark', label: over.label ?? `${lat},${lon}`, country: null, countryName: null, ...over };
}

function seg(startSec: number, endSec: number, location: FixLocation | null, place: number | null, over: Partial<FixSegment> = {}): FixSegment {
  return { startSec, endSec, firstFrame: startSec + 1, lastFrame: endSec, keyframe: { frame: startSec + 2, time: startSec + 1, imageUrl: `f${startSec}` }, location, place, windows: 1, ...over };
}

/** A window without a place whose gallery answered `gallery` and whose world model put its best point at `best`. */
function weak(startSec: number, endSec: number, gallery: FixLocation | null, best: { lat: number; lon: number } | null): WindowAnswer {
  const diagnostics = gallery ? ({ gallery } as unknown as LocateDiagnostics) : null;
  const geoclip = best ? ({ best } as unknown as GeoclipPrediction) : null;
  return { first: startSec, last: endSec - 1, startSec, endSec, location: null, tier: null, geoclip, diagnostics };
}

const BERLIN = { lat: 52.5163, lon: 13.3777 };
const PARIS = { lat: 48.8584, lon: 2.2945 };
const TOKYO = { lat: 35.6812, lon: 139.7671 };

// ---------------------------------------------------------------------------------------------
// A. Time of day and sun per located stretch
// ---------------------------------------------------------------------------------------------

/** Frame statistics of a bright day under a blue sky. */
const DAY: FrameStats = { meanLuma: 0.55, skyLuma: 0.82, skyBlueness: 0.18, warmth: -0.02, contrast: 0.22 };
/** Frame statistics of a night picture. */
const NIGHT: FrameStats = { meanLuma: 0.06, skyLuma: null, skyBlueness: null, warmth: 0.04, contrast: 0.08 };

test('time per stretch: each located stretch from its own frames at its own place; none without a place', async () => {
  const segments = [seg(0, 30, loc(BERLIN.lat, BERLIN.lon, { country: 'DE' }), 1), seg(30, 40, null, null), seg(40, 70, loc(TOKYO.lat, TOKYO.lon, { country: 'JP' }), 2)];
  // Frames 0..29 are the Berlin stretch (day), 30..39 undetermined, 40..69 Tokyo (night).
  const ranges: [number, number][] = [
    [0, 29],
    [30, 39],
    [40, 69],
  ];
  const asked: { frames: number[]; at: FixLocation }[] = [];
  const timed = await stretchTimes(
    segments,
    ranges,
    async (frames, at) => {
      asked.push({ frames, at });
      return estimateTime({
        frameEmbeddings: new Float32Array(0),
        dim: 4,
        embedTexts: async () => new Float32Array(0),
        frameStats: frames.map((f) => (f < 40 ? DAY : NIGHT)),
        location: { lat: at.lat, lon: at.lon },
        country: at.country,
        metadataUtc: null,
        filenameDate: '2026-06-21',
        pathStepMin: 30,
      });
    },
    8,
  );
  // Only the located stretches are asked, each with up to 8 of its own frames.
  assert.equal(asked.length, 2);
  assert.deepEqual(asked[0]!.frames, [1, 5, 9, 13, 16, 20, 24, 28]);
  assert.ok(asked[1]!.frames.every((f) => f >= 40 && f <= 69));
  assert.equal(asked[1]!.at.lat, TOKYO.lat);
  assert.equal(timed[1], segments[1], 'an undetermined stretch has no clock');
  assert.equal(timed[1]!.time, undefined);
  const berlin = timed[0]!;
  const tokyo = timed[2]!;
  assert.equal(berlin.time?.timezone, 'Europe/Berlin');
  assert.equal(tokyo.time?.timezone, 'Asia/Tokyo');
  assert.notEqual(berlin.time?.phase, tokyo.time?.phase, 'day in Berlin, night in Tokyo: the light of each stretch is its own');
  // The sun path of a stretch in 30-minute steps (one local day: 49 points), angles to 0.1°.
  const path = berlin.sun?.path ?? [];
  assert.ok(path.length >= 48 && path.length <= 50, `${path.length} points`);
  assert.equal(path[1]!.t - path[0]!.t, 30 * 60000);
  assert.ok(path.every((p) => Math.abs(Math.round(p.az * 10) - p.az * 10) < 1e-6 && Math.abs(Math.round(p.el * 10) - p.el * 10) < 1e-6));
  // Compact: the reasoning lines stay with the fix's own time.
  assert.deepEqual([berlin.time?.notes, berlin.time?.notesEn], [[], []]);
  assert.equal(berlin.sun?.date, '2026-06-21');
});

test('time per stretch: one stretch that fails keeps no clock, the others theirs; a stop ends the loop', async () => {
  const segments = [seg(0, 10, loc(BERLIN.lat, BERLIN.lon), 1), seg(10, 20, loc(TOKYO.lat, TOKYO.lon), 2), seg(20, 30, loc(PARIS.lat, PARIS.lon), 3)];
  const ranges: [number, number][] = [
    [0, 9],
    [10, 19],
    [20, 29],
  ];
  const time: TimeEstimate = { method: 'none', utc: null, date: null, dateSource: 'none', monthRange: null, timezone: 'UTC', windows: [], sunElevationBand: null, phase: 'unknown', confidence: 0, notes: ['n'], notesEn: ['n'] };
  const failed: number[] = [];
  const out = await stretchTimes(
    segments,
    ranges,
    async (_frames, at) => {
      if (at.lat === TOKYO.lat) throw new Error('frame unreadable');
      return { time, sun: null };
    },
    4,
    () => undefined,
    (i) => failed.push(i),
  );
  assert.deepEqual(failed, [1]);
  assert.deepEqual(out.map((s) => s.time !== undefined), [true, false, true]);
  let calls = 0;
  await assert.rejects(
    stretchTimes(
      segments,
      ranges,
      async () => ({ time, sun: null }),
      4,
      () => {
        if (++calls > 1) throw new Error('stopped');
      },
    ),
    /stopped/,
  );
});

test('time per stretch: a time in the file\'s tags holds for every stretch; the sun is each place\'s at that instant', async () => {
  const utc = Date.UTC(2026, 5, 21, 10, 0);
  const at = async (place: { lat: number; lon: number }, country: string): Promise<{ time: TimeEstimate; sunAz: number; sunEl: number }> => {
    const r = await estimateTime({
      frameEmbeddings: new Float32Array(0),
      dim: 4,
      embedTexts: async () => new Float32Array(0),
      frameStats: [DAY],
      location: place,
      country,
      metadataUtc: utc,
      filenameDate: null,
      pathStepMin: 30,
    });
    return { time: r.time, sunAz: r.sun!.at!.azimuthDeg, sunEl: r.sun!.at!.elevationDeg };
  };
  const berlin = await at(BERLIN, 'DE');
  const tokyo = await at(TOKYO, 'JP');
  assert.equal(berlin.time.method, 'metadata');
  assert.equal(tokyo.time.method, 'metadata');
  assert.equal(berlin.time.utc, utc);
  assert.equal(tokyo.time.utc, utc, 'the same instant in every stretch');
  // 10:00 UTC is noon in Berlin (summer time) and 19:00 in Tokyo: the sun high there, down here.
  assert.ok(berlin.sunEl > 50, `${berlin.sunEl}`);
  assert.ok(tokyo.sunEl < 0, `${tokyo.sunEl}`);
  assert.notEqual(berlin.time.windows[0]!.startMin, tokyo.time.windows[0]!.startMin, 'local clocks differ');
});

test('time per stretch: the fix\'s time evidence names the stretch; the whole file\'s is mixed and weighs nothing', () => {
  const sun: Evidence = { kind: 'sun', label: 'Sonnenhöhe 20–35°', labelEn: 'Sun elevation 20–35°', detail: 'Licht.', detailEn: 'Light.', weight: 0.4 };
  const own = stretchTimeEvidence(sun, '11:19–11:43');
  assert.equal(own.label, 'Sonnenhöhe 20–35° (Abschnitt 11:19–11:43)');
  assert.equal(own.labelEn, 'Sun elevation 20–35° (segment 11:19–11:43)');
  assert.equal(own.weight, 0.4, 'the stretch\'s light counts');
  assert.match(own.detail, /^Aus den Bildern des oben gezeigten Abschnitts 11:19–11:43 an seinem Ort\. Licht\.$/);
  const whole = wholeFileTimeEvidence(sun);
  assert.equal(whole.label, 'Ganze Datei (gemischt): Sonnenhöhe 20–35°');
  assert.equal(whole.labelEn, 'Whole file (mixed): Sun elevation 20–35°');
  assert.equal(whole.weight, 0);
  assert.match(whole.detailEn ?? '', /^From frames of the whole file, which mix several places; the time shown above is that of the segment shown\. Light\.$/);
});

test('time per stretch: a time from the file\'s tags is said once, for the whole file and every stretch, not as the stretch\'s pictures', async () => {
  const utc = Date.UTC(2026, 5, 21, 10, 0);
  // The estimate the engine makes for the stretch shown (its frames at its place) and for the whole file.
  const estimate = (stats: FrameStats[]): Promise<{ time: TimeEstimate }> =>
    estimateTime({ frameEmbeddings: new Float32Array(0), dim: 4, embedTexts: async () => new Float32Array(0), frameStats: stats, location: BERLIN, country: 'DE', metadataUtc: utc, filenameDate: null });
  const own = timeEvidence((await estimate([DAY])).time);
  const whole = timeEvidence((await estimate([NIGHT, DAY])).time);
  assert.equal(own[0]!.kind, 'metadata');
  const out = multiPlaceTimeEvidence(own, whole, '11:19–11:43');
  assert.equal(out.length, 1, 'no copy for the whole file');
  assert.equal(out[0]!.label, 'Aufnahmezeit aus den Metadaten', 'not said to come from the stretch');
  assert.equal(out[0]!.weight, own[0]!.weight);
  assert.match(out[0]!.detail, /^Gilt für die ganze Datei und jeden ihrer Abschnitte, in dessen Ortszeit; mit dem Licht verglichen in den Bildern des oben gezeigten Abschnitts 11:19–11:43\. Aufnahmezeit aus den Metadaten der Datei/);
  assert.match(out[0]!.detailEn ?? '', /^Holds for the whole file and each of its segments, in its local time; checked against the light in the frames of the segment shown above, 11:19–11:43\. /);
  assert.ok(out.every((e) => !e.label.startsWith('Ganze Datei') && !/vermischen|Aus den Bildern des oben/.test(e.detail)));
  // Without a time in the tags: the stretch's evidence, and the whole file's mixed and without weight.
  const sun: Evidence = { kind: 'sun', label: 'Sonnenhöhe 20–35°', detail: 'Licht.', weight: 0.4 };
  const season: Evidence = { kind: 'season', label: 'Jahreszeit: Juni', detail: 'Vegetation.', weight: 0.15 };
  const mixed = multiPlaceTimeEvidence([sun, season], [sun], '0:00–0:30');
  assert.deepEqual(
    mixed.map((e) => [e.label, e.weight]),
    [
      ['Sonnenhöhe 20–35° (Abschnitt 0:00–0:30)', 0.4],
      ['Jahreszeit: Juni (Abschnitt 0:00–0:30)', 0.15],
      ['Ganze Datei (gemischt): Sonnenhöhe 20–35°', 0],
    ],
  );
});

test('summaries leave out the stretches\' sun paths (the full fix has them); compactSun rounds the angles', () => {
  const sunReport = { date: '2026-06-21', at: null, path: [{ t: 1, az: 12.3456, el: -3.21987 }], sunrise: null, sunset: null, solarNoon: null };
  assert.deepEqual(compactSun(sunReport)!.path, [{ t: 1, az: 12.3, el: -3.2 }]);
  assert.equal(compactSun(null), null);
  const fix = { ...fixWith([seg(0, 30, loc(1, 2), 1, { sun: sunReport }), seg(30, 60, loc(40, 2), 2)], 0) };
  const slim = summarise(fix);
  assert.deepEqual(slim.segments![0]!.sun!.path, []);
  assert.equal(slim.segments![0]!.sun!.date, '2026-06-21');
  assert.equal(fix.segments![0]!.sun!.path.length, 1, 'the fix itself is not changed');
});

// ---------------------------------------------------------------------------------------------
// B. Coarse region of undetermined stretches
// ---------------------------------------------------------------------------------------------

test('regions: a point is named by the part of the world of its country; Russia east of the Urals is Northern Asia', () => {
  const world = fixtureWorld();
  assert.deepEqual(regionOf(world, 50.1, 8.7), { de: 'Westeuropa', en: 'Western Europe' });
  assert.deepEqual(regionOf(world, 55.75, 37.6), { de: 'Osteuropa', en: 'Eastern Europe' });
  assert.deepEqual(regionOf(world, 55.0, 83.0), { de: 'Nordasien', en: 'Northern Asia' });
  assert.deepEqual(regionOf(world, 35.7, 139.7), { de: 'Ostasien', en: 'Eastern Asia' });
  // At sea off the coast: the country of the nearest city within 1 500 km; on the open ocean none.
  assert.deepEqual(regionOf(world, 47.0, -8.0), { de: 'Westeuropa', en: 'Western Europe' });
  assert.equal(regionOf(world, -40, -140), null);
  assert.deepEqual(regionOfCountry('br', 0), { de: 'Südamerika', en: 'South America' });
  assert.equal(regionOfCountry('ZZ', 0), null);
});

test('regions: Russia past the antimeridian (Chukotka) is Northern Asia; the map data\'s codes without ISO have their part of the world', () => {
  const NORTH_ASIA = { de: 'Nordasien', en: 'Northern Asia' };
  assert.deepEqual(regionOfCountry('RU', 37.6), { de: 'Osteuropa', en: 'Eastern Europe' });
  assert.deepEqual(regionOfCountry('RU', 179), NORTH_ASIA);
  assert.deepEqual(regionOfCountry('RU', -169.8), NORTH_ASIA, 'Uelen, east of 180°');
  assert.deepEqual(regionOfCountry('RU', -180), NORTH_ASIA);
  // Somaliland in the city list (Hargeisa, Berbera), Northern Cyprus and Siachen in the shapes.
  assert.deepEqual(regionOfCountry('SOL', 44.07), { de: 'Ostafrika', en: 'Eastern Africa' });
  assert.deepEqual(regionOfCountry('CYN', 33.5), { de: 'Westasien', en: 'Western Asia' });
  assert.deepEqual(regionOfCountry('KAS', 77), { de: 'Südasien', en: 'Southern Asia' });
  const world = World.fromJson(
    [{ iso: 'RU', name_de: 'Russland', name_en: 'Russia', continent: 'Europe', centroid: [100, 60], areaKm2: 17000000, bbox: [30, 45, 180, 75], polygons: [box(30, 45, 180, 75)] }],
    [
      { name: 'Anadyr', name_de: 'Anadyr', iso: 'RU', lat: 64.73, lon: 177.51, pop: 15000 },
      { name: 'Uelen', name_de: 'Uelen', iso: 'RU', lat: 66.16, lon: -169.8, pop: 700 },
      { name: 'Hargeisa', name_de: 'Hargeisa', iso: 'SOL', lat: 9.56, lon: 44.07, pop: 1200000 },
    ],
  );
  // Off the coast of Chukotka (no shape there): the nearest city's country, east of 180°.
  assert.deepEqual(regionOf(world, 66.0, -172.0), NORTH_ASIA);
  // Hargeisa has no shape (Somaliland's is not an ISO country): the city's code.
  assert.deepEqual(regionOf(world, 9.56, 44.07), { de: 'Ostafrika', en: 'Eastern Africa' });
  // A coarse region across the antimeridian: gallery near Anadyr, world model off Uelen.
  const across = coarseRegions([weak(0, 10, loc(64.7, 177.5, { radiusKm: 1500 }), { lat: 66.0, lon: -172.0 })], { stretches: [{ first: 0, last: 0, place: -1 }] }, (lat, lon) => regionAround(world, lat, lon, 1500));
  assert.equal(across[0]![0]!.label, 'Nordasien');
  assert.ok(across[0]![0]!.lon < -170, `${across[0]![0]!.lon}`);
  assert.deepEqual(regionAround(world, 65.4, -177.4, 1500), NORTH_ASIA);
});

test('regions: a coarse region is named by the parts of the world its circle holds, not by its centre alone', () => {
  const world = World.fromJson(
    [],
    [
      { name: 'Berlin', name_de: 'Berlin', iso: 'DE', lat: 52.52, lon: 13.4, pop: 3600000 },
      { name: 'Munich', name_de: 'München', iso: 'DE', lat: 48.14, lon: 11.58, pop: 1500000 },
      { name: 'Prague', name_de: 'Prag', iso: 'CZ', lat: 50.08, lon: 14.44, pop: 1300000 },
      { name: 'Warsaw', name_de: 'Warschau', iso: 'PL', lat: 52.23, lon: 21.01, pop: 1800000 },
      { name: 'Tokyo', name_de: 'Tokio', iso: 'JP', lat: 35.68, lon: 139.77, pop: 14000000 },
      { name: 'Hargeisa', name_de: 'Hargeisa', iso: 'SOL', lat: 9.56, lon: 44.07, pop: 1200000 },
    ],
  );
  // A circle centred in Czechia (Eastern Europe by M49) holds Germany too: both are named, in the
  // order of the table (neighbouring windows read the same whichever leads).
  const both = { de: 'Westeuropa oder Osteuropa', en: 'Western Europe or Eastern Europe' };
  assert.deepEqual(regionAround(world, 50.0, 15.0, 1500), both);
  assert.deepEqual(regionAround(world, 52.0, 20.5, 1500), both, 'Osteuropa leads here, the name is the same');
  // Where (nearly) all the people of the circle live in one part: that part alone.
  assert.deepEqual(regionAround(world, 35.68, 139.77, 1500), { de: 'Ostasien', en: 'Eastern Asia' });
  assert.deepEqual(regionAround(world, 50.0, 15.0, 1500, 0.5), { de: 'Westeuropa', en: 'Western Europe' }, '5.1 of 8.2 million in Western Europe');
  assert.deepEqual(regionAround(world, 9.56, 44.07, 1500), { de: 'Ostafrika', en: 'Eastern Africa' });
  // No listed city in the circle: no name (open ocean).
  assert.equal(regionAround(world, -40, -140, 1500), null);
  // Windows of one stretch with the same two names are one entry.
  const regions = coarseRegions(
    [weak(0, 10, loc(50.2, 14.0, { radiusKm: 1500 }), { lat: 50.0, lon: 15.0 }), weak(10, 20, loc(52.0, 20.0, { radiusKm: 1500 }), { lat: 52.2, lon: 21.0 })],
    { stretches: [{ first: 0, last: 1, place: -1 }] },
    (lat, lon) => regionAround(world, lat, lon, 1500),
  );
  assert.equal(regions[0]!.length, 1);
  assert.equal(regions[0]![0]!.label, 'Westeuropa oder Osteuropa');
  assert.equal(regions[0]![0]!.labelEn, 'Western Europe or Eastern Europe');
  assert.deepEqual([regions[0]![0]!.startSec, regions[0]![0]!.endSec], [0, 20]);
});

test('coarse point: only where the gallery and the world model agree within 1 500 km, at the middle of the two', () => {
  const near = weak(0, 10, loc(PARIS.lat, PARIS.lon, { radiusKm: 1500, method: 'landmark' }), BERLIN);
  const p = coarsePoint(near, 1500);
  assert.ok(p);
  const m = midpoint(PARIS, BERLIN);
  assert.ok(Math.abs(greatCircleKm(m.lat, m.lon, PARIS.lat, PARIS.lon) - greatCircleKm(m.lat, m.lon, BERLIN.lat, BERLIN.lon)) < 0.5, 'halfway');
  assert.deepEqual(p, m);
  // 9 000 km apart: no coarse region (such windows held the truth within 2 500 km almost never).
  assert.equal(coarsePoint(weak(0, 10, loc(PARIS.lat, PARIS.lon), TOKYO), 1500), null);
  // One of the two missing (no world model asked, gallery not searched): none.
  assert.equal(coarsePoint(weak(0, 10, loc(PARIS.lat, PARIS.lon), null), 1500), null);
  assert.equal(coarsePoint(weak(0, 10, null, BERLIN), 1500), null);
  // Just over the limit: none; switched off: none.
  const far = { lat: PARIS.lat, lon: PARIS.lon + 21 };
  assert.ok(greatCircleKm(PARIS.lat, PARIS.lon, far.lat, far.lon) > 1500);
  assert.equal(coarsePoint(weak(0, 10, loc(PARIS.lat, PARIS.lon), far), 1500), null);
  assert.equal(coarsePoint(near, 0), null);
  // The midpoint across the date line stays on the short way round.
  const dl = midpoint({ lat: 0, lon: 179 }, { lat: 0, lon: -179 });
  assert.ok(Math.abs(Math.abs(dl.lon) - 180) < 1e-9, `${dl.lon}`);
});

test('coarse regions: runs of agreeing windows of an undetermined stretch, a break ends a run, located stretches have none', () => {
  const world = fixtureWorld();
  const regionAt = (lat: number, lon: number) => regionOf(world, lat, lon);
  const g = (p: { lat: number; lon: number }) => loc(p.lat, p.lon, { radiusKm: 1500 });
  const windows: WindowAnswer[] = [
    // stretch 0 (located, place 0): windows 0..1
    { ...weak(0, 10, g(BERLIN), BERLIN), location: loc(BERLIN.lat, BERLIN.lon), tier: 'strong' },
    { ...weak(10, 20, g(BERLIN), BERLIN), location: loc(BERLIN.lat, BERLIN.lon), tier: 'strong' },
    // stretch 1 (undetermined): Paris/Berlin agree twice (one region), a disagreeing window, then Tokyo twice
    weak(20, 30, g(PARIS), BERLIN),
    weak(30, 45, g(BERLIN), { lat: 51, lon: 9 }),
    weak(45, 55, g(PARIS), TOKYO),
    weak(55, 60, g(TOKYO), TOKYO),
    weak(60, 70, g({ lat: 35, lon: 135.5 }), TOKYO),
  ];
  const merged = {
    stretches: [
      { first: 0, last: 1, place: 0 },
      { first: 2, last: 6, place: -1 },
    ],
  };
  const regions = coarseRegions(windows, merged, regionAt, 1500);
  assert.equal(regions[0], null, 'a located stretch names no coarse region');
  const parts = regions[1]!;
  assert.equal(parts.length, 2);
  assert.deepEqual(
    parts.map((r) => [r.startSec, r.endSec, r.label, r.labelEn, r.radiusKm]),
    [
      [20, 45, 'Westeuropa', 'Western Europe', 1500],
      [55, 70, 'Ostasien', 'Eastern Asia', 1500],
    ],
  );
  // The point of a run is that of its longest window (30–45 s: Berlin and 51° N 9° E).
  const longest = midpoint(BERLIN, { lat: 51, lon: 9 });
  assert.ok(greatCircleKm(parts[0]!.lat, parts[0]!.lon, longest.lat, longest.lon) < 0.01);
  // Without any agreeing window: null.
  assert.deepEqual(coarseRegions([weak(0, 10, g(PARIS), TOKYO)], { stretches: [{ first: 0, last: 0, place: -1 }] }, regionAt), [null]);
});

test('coarse regions are no places: the count, the summary and the fix\'s place stay; the verdict says so', () => {
  const region = { startSec: 30, endSec: 40, lat: 50, lon: 10, radiusKm: 1500, label: 'Westeuropa', labelEn: 'Western Europe' };
  const segments = [seg(0, 30, loc(BERLIN.lat, BERLIN.lon), 1), seg(30, 40, null, null, { coarse: [region] }), seg(40, 80, loc(TOKYO.lat, TOKYO.lon), 2)];
  const without = segments.map((s) => ({ ...s, coarse: undefined }));
  const v = segmentVerdict(segments, null, { gps: false });
  const w = segmentVerdict(without, null, { gps: false });
  assert.equal(v.places, 2);
  assert.equal(v.places, w.places);
  assert.equal(v.location, w.location, 'the fix\'s place is a stretch\'s, never a coarse region');
  assert.deepEqual(summariseSegments(segments, v.lead), summariseSegments(without, w.lead));
  assert.match(v.evidence[0]!.label, /mindestens 2 Orte/, 'still "at least": the stretch stays undetermined');
  assert.match(v.evidence[0]!.detail, /1 Abschnitt bleibt unbestimmt\. Für ihn nennt die Zeitleiste eine grobe Region, die nicht als Ort zählt\./);
  assert.match(v.evidence[0]!.detailEn ?? '', /1 segment remains undetermined\. For it the timeline names a coarse region, which does not count as a place\./);
  assert.doesNotMatch(w.evidence[0]!.detail, /grobe Region/);
  // The console's line: the span in front where the region covers only part of the stretch.
  const t = (de: string, vars?: Record<string, string | number>): string => de.replace('{region}', String(vars?.region)).replace('{km}', String(vars?.km));
  const km = (x: number): string => `${x.toLocaleString('de-DE')} km`;
  // The radius does not break from its sign and unit (no-break spaces).
  assert.equal(coarseText(region, segments[1]!, t, km, (r) => r.label), 'grobe Region: eher Westeuropa, ±\u00a01.500\u00a0km');
  assert.equal(coarseText({ ...region, endSec: 35 }, segments[1]!, t, km, (r) => r.labelEn), '0:30–0:35 · grobe Region: eher Western Europe, ±\u00a01.500\u00a0km');
});

// ---------------------------------------------------------------------------------------------
// C. A walkable space per located stretch, and which one RAUM enters
// ---------------------------------------------------------------------------------------------

test('spaces: the longest located stretches other than the one shown, at most the cap, in time order', () => {
  const segments = [
    seg(0, 10, loc(1, 1), 1),
    seg(10, 50, loc(2, 2), 2),
    seg(50, 60, null, null),
    seg(60, 90, loc(3, 3), 3),
    seg(90, 100, loc(1, 1), 1),
    seg(100, 130, loc(4, 4), 4),
  ];
  // The fix shows stretch 1 (the longest): it has the fix's keyframes.
  assert.deepEqual(spaceStretches(segments, 1, 12), [0, 3, 4, 5]);
  // Capped by length: the 30 s stretches 3 and 5 before the 10 s ones; equal lengths the earlier.
  assert.deepEqual(spaceStretches(segments, 1, 2), [3, 5]);
  assert.deepEqual(spaceStretches(segments, 1, 3), [0, 3, 5]);
  assert.deepEqual(spaceStretches(segments, null, 1), [1]);
  assert.deepEqual(spaceStretches(segments, 1, 0), []);
  // Frames of every stretch from its windows.
  const windows = [
    { first: 0, last: 4 },
    { first: 5, last: 9 },
    { first: 10, last: 19 },
  ];
  assert.deepEqual(stretchFrames(windows, { stretches: [{ first: 0, last: 1, place: 0 }, { first: 2, last: 2, place: -1 }] }), [
    [0, 9],
    [10, 19],
  ]);
});

test('spaces: the trace says one space and one stretch in the singular', () => {
  assert.deepEqual(stretchSpacesNote(12, 32, 12, 4130), {
    de: '12 weitere Räume für 32 Abschnitte mit Ort (die 12 längsten außer dem gezeigten), 4,1 s',
    en: '12 more spaces for 32 segments with a place (the 12 longest besides the one shown), 4.1 s',
  });
  assert.deepEqual(stretchSpacesNote(1, 2, 1, 1200), { de: '1 weiterer Raum für 2 Abschnitte mit Ort, 1,2 s', en: '1 more space for 2 segments with a place, 1.2 s' });
  assert.deepEqual(stretchSpacesNote(0, 1, 0, 0), { de: '0 weitere Räume für 1 Abschnitt mit Ort, 0,0 s', en: '0 more spaces for 1 segment with a place, 0.0 s' });
  assert.equal(stretchSpacesNote(1, 3, 1, 900).de, '1 weiterer Raum für 3 Abschnitte mit Ort (der längste außer dem gezeigten), 0,9 s');
  assert.equal(stretchSpacesNote(1, 3, 1, 900).en, '1 more space for 3 segments with a place (the longest besides the one shown), 0.9 s');
});

const KEYS: Keyframe[] = [
  { frame: 11, time: 10, imageUrl: 'k11', spaceUrl: 'api/datum/space/v/11', skyline: null, pitchDeg: -2 },
  { frame: 21, time: 20, imageUrl: 'k21', spaceUrl: 'api/datum/space/v/21', skyline: null, pitchDeg: 3 },
];

function fixWith(segments: FixSegment[], lead: number, keyframes: Keyframe[] = KEYS): Fix {
  return {
    videoId: 'v',
    status: 'ready',
    error: null,
    computedAt: 7,
    elapsedMs: 1,
    location: segments[lead]!.location,
    candidates: [],
    countries: [],
    time: { method: 'sun', utc: null, date: null, dateSource: 'none', monthRange: null, timezone: 'Europe/Berlin', windows: [{ startMin: 600, endMin: 660, label: 'Vormittag', probability: 0.6 }], sunElevationBand: [20, 35], phase: 'day', confidence: 0.5, notes: [] },
    sun: { date: '2026-06-21', at: null, path: [], sunrise: null, sunset: null, solarNoon: null },
    heading: null,
    horizon: null,
    evidence: [{ kind: 'segments', label: 'x', detail: 'y', weight: 0.9, frame: segments[lead]!.keyframe.frame }],
    keyframes,
    truth: null,
    segments,
  };
}

test('RAUM: the stretch chosen in BEFUND, its own space, sun and clock; the shown stretch keeps the fix\'s', () => {
  const tokyoTime: TimeEstimate = { method: 'sun', utc: null, date: null, dateSource: 'none', monthRange: null, timezone: 'Asia/Tokyo', windows: [{ startMin: 1200, endMin: 1260, label: 'Abend', probability: 0.7 }], sunElevationBand: [-6, 0], phase: 'twilight', confidence: 0.4, notes: [] };
  const tokyoSun = { date: '2026-06-21', at: { at: 5, azimuthDeg: 300, elevationDeg: -3, shadowAzimuthDeg: 120, shadowRatio: null }, path: [], sunrise: null, sunset: null, solarNoon: null };
  const segments = [
    seg(0, 30, loc(BERLIN.lat, BERLIN.lon), 1, { time: { ...tokyoTime, timezone: 'Europe/Berlin' }, sun: null }),
    seg(30, 40, null, null, { coarse: [{ startSec: 30, endSec: 40, lat: 50, lon: 10, radiusKm: 1500, label: 'Westeuropa', labelEn: 'Western Europe' }] }),
    seg(40, 70, loc(TOKYO.lat, TOKYO.lon), 2, { time: tokyoTime, sun: tokyoSun, keyframe: { frame: 55, time: 54, imageUrl: 'k55', spaceUrl: 'api/datum/space/v/55', pitchDeg: 4 } }),
    seg(70, 80, loc(PARIS.lat, PARIS.lon), 3, { time: tokyoTime, sun: null }),
  ];
  const fix = fixWith(segments, 0);

  // The choice holds for this result of this recording only; otherwise the stretch shown.
  assert.equal(chosenStretch(fix, null), 0);
  assert.equal(chosenStretch(fix, { videoId: 'v', computedAt: 7, index: 2 }), 2);
  assert.equal(chosenStretch(fix, { videoId: 'v', computedAt: 6, index: 2 }), 0, 'a new result starts at the stretch shown');
  assert.equal(chosenStretch(fix, { videoId: 'w', computedAt: 7, index: 2 }), 0);
  assert.equal(chosenStretch(fix, { videoId: 'v', computedAt: 7, index: 9 }), 0);

  // The stretch shown: the fix's keyframes (heading and horizon belong to them), the fix's clock.
  assert.deepEqual(stretchSpaces(fix, 0), {
    fix: true,
    spaces: [
      { frame: 11, imageUrl: 'k11', spaceUrl: 'api/datum/space/v/11', pitchDeg: -2 },
      { frame: 21, imageUrl: 'k21', spaceUrl: 'api/datum/space/v/21', pitchDeg: 3 },
    ],
  });
  assert.deepEqual(stretchClock(fix, 0), { time: fix.time, sun: fix.sun, own: false });
  // Another located stretch with a space: that space, its own time and sun (for the shadows).
  assert.deepEqual(stretchSpaces(fix, 2), { fix: false, spaces: [{ frame: 55, imageUrl: 'k55', spaceUrl: 'api/datum/space/v/55', pitchDeg: 4 }] });
  assert.deepEqual(stretchClock(fix, 2), { time: tokyoTime, sun: tokyoSun, own: true });
  // A located stretch beyond the cap: no space, but its clock.
  assert.deepEqual(stretchSpaces(fix, 3), { fix: false, spaces: [] });
  assert.equal(stretchClock(fix, 3)!.own, true);
  // An undetermined stretch: no space, no clock (a coarse region is no place).
  assert.deepEqual(stretchSpaces(fix, 1), { fix: false, spaces: [] });
  assert.equal(stretchClock(fix, 1), null);
  // What RAUM offers.
  assert.deepEqual(spacedStretches(fix), [0, 2]);

  // A fix before engine 11 (stretches without times): the fix's spaces and clock for every stretch.
  const old = fixWith(segments.map((s) => ({ ...s, time: undefined, sun: undefined, keyframe: { frame: s.keyframe.frame, time: s.keyframe.time, imageUrl: s.keyframe.imageUrl } })), 0);
  assert.equal(stretchSpaces(old, 2).fix, true);
  assert.equal(stretchClock(old, 1)!.own, false);
  assert.deepEqual(stretchClock(old, 2), { time: old.time, sun: old.sun, own: false });
  // A recording of one place: the fix's.
  const single = { ...fixWith([seg(0, 30, loc(1, 1), 1)], 0) };
  delete single.segments;
  assert.equal(stretchSpaces(single, null).spaces.length, 2);
  assert.equal(stretchClock(single, null)!.time, single.time);
  // Whether the stretches have their own times: the console says a stretch's time only then
  // (before engine 11 every located stretch would show the whole file's mixed time).
  assert.equal(timedStretches(fix), true);
  assert.equal(timedStretches(old), false);
  assert.equal(timedStretches(single), false);
  // A located stretch whose estimate failed: no clock, but its place stays (the console says
  // "no time could be determined", not "no place").
  const failed = fixWith([...segments.slice(0, 3), { ...segments[3]!, time: undefined, sun: undefined }], 0);
  assert.equal(stretchClock(failed, 3), null);
  assert.ok(failed.segments![3]!.location);
});

test('RAUM terrain: sunrise and sunset where the dials have them, not at the last point of a 30-minute path', () => {
  const at = (h: number, m: number): number => Date.UTC(2026, 6, 15, h, m);
  // A stretch's path near sunset (UTC): 3.1° at 19:00, -0.4° at 19:30.
  const path = [
    { t: at(18, 30), az: 296, el: 7.2 },
    { t: at(19, 0), az: 300, el: 3.1 },
    { t: at(19, 30), az: 304, el: -0.4 },
    { t: at(20, 0), az: 308, el: -4.1 },
  ];
  // Without the report's times: the crossing of 0°, between the two points.
  const plain = sunEdges(path);
  assert.equal(plain.rise, null);
  assert.ok(plain.set);
  assert.ok(Math.abs(plain.set.t - (at(19, 0) + (3.1 / 3.5) * 30 * 60_000)) < 1, `${new Date(plain.set.t).toISOString()}`);
  assert.ok(Math.abs(plain.set.az - (300 + (3.1 / 3.5) * 4)) < 1e-9);
  // With the report's sunset (as BEFUND's dial writes it): that time, at the azimuth there.
  const report = sunEdges(path, null, at(19, 31));
  assert.equal(report.set!.t, at(19, 31));
  assert.ok(Math.abs(report.set!.az - (304 + (1 / 30) * 4)) < 1e-9);
  // A sunrise across north (azimuth 358° to 2°) stays in the north.
  const north = sunEdges([
    { t: at(1, 0), az: 358, el: -1 },
    { t: at(1, 30), az: 2, el: 1 },
  ]);
  assert.ok(north.rise && (north.rise.az > 359.9 || north.rise.az < 0.1), `${north.rise?.az}`);
  // The report's time outside the path (another day) is not used.
  assert.equal(sunEdges(path, null, at(23, 0)).set!.t, plain.set.t);
});
