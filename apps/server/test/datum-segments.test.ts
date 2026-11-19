import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Evidence, Fix, FixLocation, FixSegment } from '../src/datum/contract.js';
import type { GalleryNeighbour } from '../src/datum/gallery.js';
import type { GeoclipPrediction } from '../src/datum/geoclip.js';
import { slimFix } from '../src/datum/routes.js';
import {
  analyseSegments,
  buildWindows,
  clockText,
  isAnchor,
  mergeWindows,
  planWorldFrames,
  segmentCountries,
  segmentVerdict,
  spreadIndices,
  summariseSegments,
  toSegments,
  wholeFileEvidence,
  type SegmentFrame,
  type WindowAnswer,
} from '../src/datum/segments.js';
import { World, type LonLat } from '../src/datum/world.js';

const box = (w: number, s: number, e: number, n: number): LonLat[] => [
  [w, s],
  [e, s],
  [e, n],
  [w, n],
  [w, s],
];

/** Two square "countries" and a few cities (as in datum-locate.test.ts). */
function fixtureWorld(): World {
  return World.fromJson(
    [
      { iso: 'DE', name_de: 'Deutschland', name_en: 'Germany', continent: 'Europe', centroid: [10, 51], areaKm2: 357000, bbox: [6, 47, 15, 55], polygons: [box(6, 47, 15, 55)] },
      { iso: 'FR', name_de: 'Frankreich', name_en: 'France', continent: 'Europe', centroid: [2.5, 46.5], areaKm2: 550000, bbox: [-5, 42, 6, 51], polygons: [box(-5, 42, 6, 51)] },
    ],
    [
      { name: 'Koblenz', name_de: 'Koblenz', iso: 'DE', lat: 50.36, lon: 7.59, pop: 113000 },
      { name: 'Berlin', name_de: 'Berlin', iso: 'DE', lat: 52.52, lon: 13.4, pop: 3600000 },
      { name: 'Paris', name_de: 'Paris', iso: 'FR', lat: 48.86, lon: 2.35, pop: 2100000 },
    ],
  );
}

/** One frame per second; scene s for every frame from the given cut points. */
function framesWith(count: number, cuts: number[]): SegmentFrame[] {
  return Array.from({ length: count }, (_, i) => ({ n: i + 1, t: i, s: cuts.filter((c) => c <= i).length }));
}

function scenesOf(frames: SegmentFrame[]): { firstFrame: number; lastFrame: number }[] {
  const out: { firstFrame: number; lastFrame: number }[] = [];
  frames.forEach((f, i) => {
    const last = out[out.length - 1];
    if (last && frames[last.firstFrame]!.s === f.s) last.lastFrame = i;
    else out.push({ firstFrame: i, lastFrame: i });
  });
  return out;
}

const unit = (dim: number, axis: number): Float32Array => {
  const v = new Float32Array(dim);
  v[axis % dim] = 1;
  return v;
};

function loc(lat: number, lon: number, over: Partial<FixLocation> = {}): FixLocation {
  return { lat, lon, radiusKm: 1500, confidence: 0.9, method: 'landmark', label: over.label ?? `${lat},${lon}`, labelEn: over.labelEn ?? `${lat},${lon} (en)`, country: null, countryName: null, ...over };
}

/** A window answer for the merge: seconds start..end, its answer and tier. */
function win(startSec: number, endSec: number, location: FixLocation | null, tier: WindowAnswer['tier'] = location ? 'similar' : null, geoclip: GeoclipPrediction | null = null): WindowAnswer {
  return { first: startSec, last: endSec - 1, startSec, endSec, location, tier, geoclip, diagnostics: null };
}

const PARIS = { lat: 48.8584, lon: 2.2945 };
const BERLIN = { lat: 52.5163, lon: 13.3777 };
const TOKYO = { lat: 35.6812, lon: 139.7671 };

test('spreadIndices takes the middle of equal parts, without repeats', () => {
  assert.deepEqual(spreadIndices(0, 9, 2), [2, 7]);
  assert.deepEqual(spreadIndices(5, 7, 8), [5, 6, 7]);
  assert.deepEqual(spreadIndices(3, 2, 4), []);
  assert.equal(clockText(252), '4:12');
  assert.equal(clockText(3725), '1:02:05');
});

test('windows: short scenes join the neighbour they look most like, the timeline has no gaps', () => {
  // Scenes 0-9, 10 (one second, looks like the next), 11-20, 21-29.
  const frames = framesWith(30, [10, 11, 21]);
  const look = (i: number): Float32Array => unit(4, i < 10 ? 0 : i <= 20 ? 1 : 2);
  const windows = buildWindows(frames, scenesOf(frames), 30.5, look, { minWindowSec: 4, maxWindows: 160 });
  assert.deepEqual(
    windows.map((w) => [w.first, w.last]),
    [
      [0, 9],
      [10, 20],
      [21, 29],
    ],
  );
  assert.equal(windows[0]!.startSec, 0);
  assert.equal(windows[1]!.startSec, 10);
  assert.equal(windows[2]!.endSec, 30.5, 'the last window ends with the video');
  for (let i = 1; i < windows.length; i++) assert.equal(windows[i]!.startSec, windows[i - 1]!.endSec);
});

test('windows: too many scenes merge the most alike neighbours; scenes that do not cover the frames give fixed windows', () => {
  const frames = framesWith(40, [10, 20, 30]);
  const look = (i: number): Float32Array => unit(4, i < 20 ? 0 : i < 30 ? 1 : 2);
  const merged = buildWindows(frames, scenesOf(frames), 40, look, { minWindowSec: 1, maxWindows: 3 });
  assert.deepEqual(
    merged.map((w) => [w.first, w.last]),
    [
      [0, 19],
      [20, 29],
      [30, 39],
    ],
  );
  const fallback = buildWindows(frames, [{ firstFrame: 0, lastFrame: 5 }], 40, look, { minWindowSec: 1, maxWindows: 160 }, 15);
  assert.deepEqual(
    fallback.map((w) => [w.first, w.last]),
    [
      [0, 14],
      [15, 29],
      [30, 39],
    ],
  );
});

test('world model frames: at most per window and in total, the longest windows first', () => {
  const w = (first: number, last: number) => ({ first, last, startSec: first, endSec: last + 1 });
  // Three windows of 10, 30 and 5 s.
  const windows = [w(0, 9), w(10, 39), w(40, 44)];
  assert.deepEqual(planWorldFrames(windows, 3, 120), [3, 3, 3]);
  assert.deepEqual(planWorldFrames(windows, 3, 4), [1, 2, 1]);
  assert.deepEqual(planWorldFrames(windows, 3, 2), [1, 1, 0], 'more windows than frames: one each for the longest');
  assert.equal(planWorldFrames(Array.from({ length: 300 }, (_, i) => w(i * 4, i * 4 + 3)), 3, 120).reduce((a, b) => a + b, 0), 120);
});

test('anchors: a standing-out landmark or a sure gallery answer, never the world model or a country alone', () => {
  assert.ok(isAnchor(win(0, 10, loc(1, 1, { radiusKm: 3, confidence: 0.4 }), 'strong'), { anchorConfidence: 0.8 }));
  assert.ok(isAnchor(win(0, 10, loc(1, 1, { confidence: 0.85 }), 'similar'), { anchorConfidence: 0.8 }));
  assert.ok(!isAnchor(win(0, 10, loc(1, 1, { confidence: 0.7 }), 'similar'), { anchorConfidence: 0.8 }));
  assert.ok(!isAnchor(win(0, 10, loc(1, 1, { confidence: 0.9, method: 'worldmodel', radiusKm: 25 }), 'worldmodel'), { anchorConfidence: 0.8 }));
  assert.ok(!isAnchor(win(0, 10, loc(1, 1, { confidence: 0.95, method: 'region' }), 'country'), { anchorConfidence: 0.8 }));
  assert.ok(!isAnchor(win(0, 10, null), { anchorConfidence: 0.8 }));
});

test('merge: a recording of one place is not split, whatever its weak windows say; its undetermined window keeps the place', () => {
  const windows = [
    win(0, 10, loc(PARIS.lat, PARIS.lon)),
    // The world model alone, far off: weak, it does not make a place.
    win(10, 20, loc(TOKYO.lat, TOKYO.lon, { method: 'worldmodel', radiusKm: 25, confidence: 0.75 }), 'worldmodel'),
    win(20, 30, loc(PARIS.lat + 0.05, PARIS.lon + 0.05, { radiusKm: 3, confidence: 0.92 }), 'strong'),
    win(30, 40, null),
    win(40, 50, loc(PARIS.lat, PARIS.lon)),
  ];
  const merged = mergeWindows(windows);
  assert.equal(merged.places.length, 1);
  // The weak window between two anchors of the place: no answer joins it, a contradicting answer stays undetermined.
  assert.deepEqual(merged.labels, [0, -1, 0, 0, 0]);
  const segments = toSegments(framesWith(50, []), windows, merged, (n) => `media/x/frames/${n}.jpg`);
  assert.equal(segments.length, 3);
  const paris = loc(PARIS.lat, PARIS.lon);
  const verdict = segmentVerdict(segments, paris, { gps: false });
  // Engine 12: one place and an undetermined stretch get a timeline (the Tokyo window may be
  // elsewhere), but no second place, and the place stays Paris: the whole file agrees with the
  // longest stretch (40 of 50 s are Paris).
  assert.equal(verdict.multi, true);
  assert.equal(verdict.places, 1);
  assert.equal(verdict.lead, 2);
  assert.equal(verdict.replaced, false);
  assert.equal(verdict.location, paris);
  assert.equal(verdict.evidence.length, 1);
  assert.equal(verdict.evidence[0]!.weight, 0.5);
  assert.equal(verdict.evidence[0]!.label, 'Die Aufnahme zeigt einen erkannten Ort; ein Abschnitt unbestimmt; oben der Abschnitt 0:20–0:50');
  assert.match(verdict.evidence[0]!.detail, /Die Ortung aus der ganzen Datei stimmt mit ihm überein und bleibt\./);
  assert.doesNotMatch(verdict.evidence[0]!.detail, /mindestens|verschiedene Orte/);
});

test('merge: two places, a return and an undetermined window between them', () => {
  const windows = [
    win(0, 20, loc(PARIS.lat, PARIS.lon, { label: 'Eiffelturm, Paris', labelEn: 'Eiffel Tower, Paris' })),
    win(20, 30, loc(PARIS.lat, PARIS.lon, { radiusKm: 3, confidence: 0.93 }), 'strong'),
    win(30, 40, loc(TOKYO.lat, TOKYO.lon, { method: 'worldmodel', confidence: 0.7 }), 'worldmodel'),
    win(40, 100, loc(BERLIN.lat, BERLIN.lon, { label: 'Brandenburger Tor, Berlin', labelEn: 'Brandenburg Gate, Berlin' })),
    win(100, 110, loc(PARIS.lat + 0.01, PARIS.lon, { confidence: 0.88 })),
  ];
  const merged = mergeWindows(windows);
  assert.deepEqual(merged.labels, [0, 0, -1, 1, 0]);
  const frames = framesWith(110, []);
  const segments = toSegments(frames, windows, merged, (n) => `media/x/frames/${n}.jpg`);
  assert.deepEqual(
    segments.map((s) => [s.startSec, s.endSec, s.place]),
    [
      [0, 30, 1],
      [30, 40, null],
      [40, 100, 2],
      [100, 110, 1],
    ],
  );
  // The place of a stretch is its surest anchor ('strong' first); the undetermined one has none.
  assert.equal(segments[0]!.location?.radiusKm, 3);
  assert.equal(segments[1]!.location, null);
  assert.equal(segments[0]!.firstFrame, 1);
  assert.equal(segments[0]!.lastFrame, 30);
  assert.match(segments[2]!.keyframe.imageUrl, /^media\/x\/frames\/\d+\.jpg$/);

  // The whole file said Paris; the longest stretch (Berlin, 1:00 long) replaces it.
  const verdict = segmentVerdict(segments, loc(PARIS.lat, PARIS.lon, { radiusKm: 3 }), { gps: false });
  assert.equal(verdict.multi, true);
  assert.equal(verdict.places, 2);
  assert.equal(verdict.lead, 2);
  assert.equal(verdict.replaced, true);
  assert.equal(verdict.location?.label, 'Brandenburger Tor, Berlin');
  const ev = verdict.evidence[0]!;
  assert.equal(ev.kind, 'segments');
  assert.equal(ev.label, 'Die Aufnahme zeigt mindestens 2 Orte; oben der Abschnitt 0:40–1:40');
  assert.equal(ev.labelEn, 'The recording shows at least 2 places; shown above: segment 0:40–1:40');
  assert.match(ev.detail, /Brandenburger Tor, Berlin/);
  assert.match(ev.detailEn ?? '', /Brandenburg Gate, Berlin/);
  assert.match(ev.detail, /Oben steht der längste Abschnitt mit Ort, 0:40–1:40/);
  assert.match(ev.detail, /1 Abschnitt bleibt unbestimmt/);
  assert.equal(ev.frame, segments[2]!.keyframe.frame);

  // A whole-file answer that agrees with the longest stretch stays.
  const kept = segmentVerdict(segments, loc(BERLIN.lat + 0.02, BERLIN.lon, { radiusKm: 1, label: 'Berlin' }), { gps: false });
  assert.equal(kept.replaced, false);
  assert.equal(kept.location?.label, 'Berlin');
  assert.equal(kept.evidence[0]!.weight, 0.5);

  // The compact form: places with their seconds and the route through them.
  const summary = summariseSegments(segments);
  assert.equal(summary.segments, 4);
  assert.deepEqual(
    summary.places.map((p) => [p.place, p.seconds]),
    [
      [1, 40],
      [2, 60],
    ],
  );
  assert.deepEqual(summary.route, [1, 2, 1]);
});

test('merge: a place needs anchors of at least minPlaceSec; nearby answers are one place', () => {
  const windows = [
    win(0, 30, loc(PARIS.lat, PARIS.lon)),
    // Three seconds of Berlin: too short to count as a place of its own.
    win(30, 33, loc(BERLIN.lat, BERLIN.lon)),
    // 10 km from the first answer: the same place.
    win(33, 60, loc(PARIS.lat + 0.09, PARIS.lon)),
  ];
  const merged = mergeWindows(windows, { minPlaceSec: 5 });
  assert.equal(merged.places.length, 1);
  // Too short for a place, it is a weak window between two anchors of Paris; its circle (1 500 km)
  // reaches Paris, so it joins it.
  assert.deepEqual(merged.labels, [0, 0, 0]);
  assert.deepEqual(merged.anchors, [true, false, true]);
  // With a narrow circle that leaves Paris out it stays undetermined.
  const narrow = mergeWindows([windows[0]!, win(30, 33, loc(BERLIN.lat, BERLIN.lon, { radiusKm: 25 })), windows[2]!], { minPlaceSec: 5 });
  assert.deepEqual(narrow.labels, [0, -1, 0]);
});

test('merge: the world model can tie two far answers of one place together (both ways round)', () => {
  // A prediction that puts its mass at two points (compact form: support over its own points).
  const prediction = (points: { lat: number; lon: number; p: number }[]): GeoclipPrediction => ({
    frames: 1,
    aggregation: 'mixture',
    probs: Float32Array.from(points.map((x) => x.p)),
    coords: Float32Array.from(points.flatMap((x) => [x.lat, x.lon])),
    support: Uint32Array.from(points.map((_, i) => i)),
    top: [],
    modes: [],
    refined: null,
    best: points[0]!,
    countries: [],
    timing: { embedMs: 0, scoreMs: 0, refineMs: 0 },
  });
  const both = prediction([
    { ...PARIS, p: 0.6 },
    { ...BERLIN, p: 0.4 },
  ]);
  const one = prediction([{ ...BERLIN, p: 1 }]);
  const tied = mergeWindows([win(0, 30, loc(PARIS.lat, PARIS.lon), 'similar', both), win(30, 60, loc(BERLIN.lat, BERLIN.lon), 'similar', both)], { worldAgree: 0.05 });
  assert.equal(tied.places.length, 1);
  const apart = mergeWindows([win(0, 30, loc(PARIS.lat, PARIS.lon), 'similar', one), win(30, 60, loc(BERLIN.lat, BERLIN.lon), 'similar', one)], { worldAgree: 0.05 });
  assert.equal(apart.places.length, 2, 'only one side sees the other place: two places');
  const off = mergeWindows([win(0, 30, loc(PARIS.lat, PARIS.lon), 'similar', both), win(30, 60, loc(BERLIN.lat, BERLIN.lon), 'similar', both)], { worldAgree: 0 });
  assert.equal(off.places.length, 2);
});

test('a stretch shows where most of its anchor time points, not its single surest window', () => {
  // Berlin for 60 s, a 'strong' look-alike near Hamburg for 20 s; the world model of both sees
  // northern Germany, so they are one place. The stretch is Berlin.
  const north: GeoclipPrediction = {
    frames: 1,
    aggregation: 'mixture',
    probs: Float32Array.from([0.5, 0.5]),
    coords: Float32Array.from([BERLIN.lat, BERLIN.lon, 53.7, 10.0]),
    support: Uint32Array.from([0, 1]),
    top: [],
    modes: [],
    refined: null,
    best: BERLIN,
    countries: [],
    timing: { embedMs: 0, scoreMs: 0, refineMs: 0 },
  };
  const windows = [
    win(0, 30, loc(BERLIN.lat, BERLIN.lon, { label: 'Berlin' }), 'similar', north),
    win(30, 60, loc(BERLIN.lat, BERLIN.lon + 0.05, { label: 'Berlin' }), 'similar', north),
    win(60, 80, loc(53.7, 10.0, { label: 'Norderstedt', radiusKm: 3 }), 'strong', north),
    win(80, 120, loc(PARIS.lat, PARIS.lon, { label: 'Paris' })),
  ];
  const merged = mergeWindows(windows);
  assert.deepEqual(merged.labels, [0, 0, 0, 1]);
  const segments = toSegments(framesWith(120, []), windows, merged, String);
  assert.equal(segments[0]!.location?.label, 'Berlin');
  assert.equal(segments[0]!.endSec, 80);
});

test('verdict with GPS in the file: no stretches, the file position stands, the pictures are named', () => {
  const segments: FixSegment[] = [
    { startSec: 0, endSec: 30, firstFrame: 1, lastFrame: 30, keyframe: { frame: 15, time: 14, imageUrl: 'a' }, location: loc(PARIS.lat, PARIS.lon), place: 1, windows: 2 },
    { startSec: 30, endSec: 60, firstFrame: 31, lastFrame: 60, keyframe: { frame: 45, time: 44, imageUrl: 'b' }, location: loc(BERLIN.lat, BERLIN.lon), place: 2, windows: 1 },
  ];
  const gps = loc(50.36, 7.59, { method: 'metadata', radiusKm: 0.05 });
  const verdict = segmentVerdict(segments, gps, { gps: true });
  assert.equal(verdict.multi, false);
  assert.equal(verdict.location, gps);
  assert.equal(verdict.evidence.length, 1);
  assert.equal(verdict.evidence[0]!.weight, 0);
  assert.equal(verdict.evidence[0]!.label, 'Die Bilder zeigen 2 verschiedene Orte');
  assert.equal(verdict.evidence[0]!.labelEn, 'The pictures show 2 different places');
  assert.match(verdict.evidence[0]!.detail, /GPS-Angabe der Datei gilt für die ganze Datei/);
  assert.match(verdict.note.en, /GPS stands/);
});

test('slim fixes carry the compact form of the stretches, not the stretches', () => {
  const segments: FixSegment[] = [
    { startSec: 0, endSec: 30, firstFrame: 1, lastFrame: 30, keyframe: { frame: 15, time: 14, imageUrl: 'a' }, location: loc(PARIS.lat, PARIS.lon, { label: 'Paris' }), place: 1, windows: 2 },
    { startSec: 30, endSec: 40, firstFrame: 31, lastFrame: 40, keyframe: { frame: 35, time: 34, imageUrl: 'b' }, location: null, place: null, windows: 1 },
    { startSec: 40, endSec: 60, firstFrame: 41, lastFrame: 60, keyframe: { frame: 45, time: 44, imageUrl: 'c' }, location: loc(BERLIN.lat, BERLIN.lon, { label: 'Berlin' }), place: 2, windows: 1 },
  ];
  const fix: Fix = {
    videoId: 'v',
    status: 'ready',
    error: null,
    computedAt: 1,
    elapsedMs: 1,
    location: segments[0]!.location,
    candidates: [],
    countries: [],
    time: { method: 'none', utc: null, date: null, dateSource: 'none', monthRange: null, timezone: null, windows: [], sunElevationBand: null, phase: 'unknown', confidence: 0, notes: [] },
    sun: null,
    heading: null,
    horizon: null,
    evidence: [],
    keyframes: [],
    truth: null,
    segments,
  };
  const slim = slimFix(fix);
  assert.equal(slim.segments, undefined);
  assert.equal(slim.segmentSummary?.segments, 3);
  assert.equal(slim.segmentSummary?.undetermined, 1);
  assert.deepEqual(
    slim.segmentSummary?.places.map((p) => p.label),
    ['Paris', 'Berlin'],
  );
  assert.deepEqual(slim.segmentSummary?.route, [1, 2]);
  // A fix without stretches (one place, or an older engine) has neither.
  const { segments: _s, ...plain } = fix;
  assert.equal(slimFix(plain).segmentSummary, undefined);
});

/** A stand-in gallery: rows whose first component is set match Paris, the others Berlin. */
function standInSearch(vectors: Float32Array, k: number, dim: number): GalleryNeighbour[][] {
  const rows = vectors.length / dim;
  const n = (id: string, lat: number, lon: number, s: number, country: string): GalleryNeighbour => ({ id, label: id, lat, lon, country, wikidata: null, similarity: s });
  return Array.from({ length: rows }, (_, r) => {
    const paris = (vectors[r * dim] as number) > 0.5;
    const top = paris ? n('Eiffelturm', PARIS.lat, PARIS.lon, 0.93, 'FR') : n('Brandenburger Tor', BERLIN.lat, BERLIN.lon, 0.93, 'DE');
    const rest = Array.from({ length: Math.max(0, k - 1) }, (_, i) => n(`r${i}`, 44 + (i % 7), -3 + ((i * 3) % 20), 0.62 - i * 0.001, i % 2 ? 'FR' : 'DE'));
    return [top, ...rest];
  });
}

test('analyseSegments: windows decided from their own frames find the two places of a recording, and only one in a recording of one place', async () => {
  const world = fixtureWorld();
  const dim = 4;
  const tiles = 2;
  // Country prompts embed to unit vectors on the last two axes (no country stands out).
  const embedTexts = async (texts: string[]): Promise<Float32Array> => {
    const out = new Float32Array(texts.length * dim);
    texts.forEach((_, i) => (out[i * dim + 2 + (i % 2)] = 1));
    return out;
  };
  const run = async (switchAt: number) => {
    const frames = framesWith(40, [switchAt]);
    const matrix = new Float32Array(frames.length * tiles * dim);
    frames.forEach((_, i) => {
      for (let t = 0; t < tiles; t++) matrix.set(unit(dim, i < switchAt ? 0 : 1), (i * tiles + t) * dim);
    });
    let asked = 0;
    const analysis = await analyseSegments(
      { frames, scenes: scenesOf(frames), durationSec: 40, matrix, tiles, dim },
      {
        world,
        embedTexts,
        search: async (vectors, k) => standInSearch(vectors, k, dim),
        predictWorld: async () => {
          asked++;
          return null;
        },
      },
    );
    return { analysis, asked, frames };
  };
  const two = await run(20);
  assert.equal(two.analysis.windows.length, 2);
  assert.equal(two.asked, 2, 'the world model is asked once per window');
  assert.ok(two.analysis.windows.every((w) => w.tier === 'strong'));
  assert.equal(two.analysis.merged.places.length, 2);
  const segments = toSegments(two.frames, two.analysis.windows, two.analysis.merged, (n) => String(n));
  assert.deepEqual(
    segments.map((s) => [s.startSec, s.endSec, s.place, s.location?.country]),
    [
      [0, 20, 1, 'FR'],
      [20, 40, 2, 'DE'],
    ],
  );
  const one = await run(40);
  assert.equal(one.analysis.merged.places.length, 1);
  assert.equal(segmentVerdict(toSegments(one.frames, one.analysis.windows, one.analysis.merged, String), null, { gps: false }).multi, false);
});

/** A world-model prediction that puts its mass at these points (compact form). */
function predictionAt(points: { lat: number; lon: number; p: number }[]): GeoclipPrediction {
  return {
    frames: 1,
    aggregation: 'mixture',
    probs: Float32Array.from(points.map((x) => x.p)),
    coords: Float32Array.from(points.flatMap((x) => [x.lat, x.lon])),
    support: Uint32Array.from(points.map((_, i) => i)),
    top: [],
    modes: [],
    refined: null,
    best: points[0]!,
    countries: [],
    timing: { embedMs: 0, scoreMs: 0, refineMs: 0 },
  };
}

const GLENFINNAN = { lat: 56.8762, lon: -5.4316 };
const RHUDDLAN = { lat: 53.2887, lon: -3.4636 };
const NORDERSTEDT = { lat: 53.7078, lon: 9.9922 };

test('merge: anchors closer than sameKm are one place through a chain, whichever of them is surest', () => {
  // Three anchors 20 km apart on a line (A to C 40 km), without the world model. Compared only
  // with a place's surest anchor, the order of the confidences decided between one and two places.
  const at = [52.0, 52.18, 52.36];
  for (const confidences of [
    [0.95, 0.9, 0.85],
    [0.9, 0.95, 0.85],
    [0.85, 0.9, 0.95],
  ]) {
    const windows = at.map((lat, i) => win(i * 30, i * 30 + 30, loc(lat, 13.0, { confidence: confidences[i]! })));
    const merged = mergeWindows(windows);
    assert.deepEqual(merged.labels, [0, 0, 0], `confidences ${confidences.join('/')}`);
    assert.equal(merged.places.length, 1);
    assert.deepEqual(merged.joined, [false], 'one place by distance alone is not joined by the world model');
  }
});

test('merge: the world model does not tie two standing-out landmarks; a weaker answer it ties is a joined place', () => {
  // Both windows' world model sees Great Britain: half at its own place, the rest over Scotland,
  // Wales and London.
  const uk = predictionAt([
    { ...GLENFINNAN, p: 0.25 },
    { ...RHUDDLAN, p: 0.25 },
    { lat: 55.95, lon: -3.19, p: 0.25 },
    { lat: 51.5, lon: -0.12, p: 0.25 },
  ]);
  const glenfinnan = win(0, 60, loc(GLENFINNAN.lat, GLENFINNAN.lon, { radiusKm: 3, confidence: 0.93, label: 'Glenfinnan-Viadukt' }), 'strong', uk);
  const rhuddlanStrong = win(60, 120, loc(RHUDDLAN.lat, RHUDDLAN.lon, { radiusKm: 3, confidence: 0.92, label: 'Rhuddlan Castle' }), 'strong', uk);
  const two = mergeWindows([glenfinnan, rhuddlanStrong]);
  assert.equal(two.places.length, 2, 'two recognised landmarks 418 km apart stay two places');
  assert.deepEqual(two.joined, [false, false]);
  // A gallery answer that is only similar is tied to the landmark (the documented protection
  // against misrecognitions), and the place says so.
  const rhuddlanSimilar = win(60, 120, loc(RHUDDLAN.lat, RHUDDLAN.lon, { confidence: 0.92, label: 'Rhuddlan Castle' }), 'similar', uk);
  const paris = win(120, 180, loc(PARIS.lat, PARIS.lon, { label: 'Paris' }));
  const windows = [glenfinnan, rhuddlanSimilar, paris];
  const merged = mergeWindows(windows);
  assert.deepEqual(merged.labels, [0, 0, 1]);
  assert.deepEqual(merged.joined, [true, false]);
  const segments = toSegments(framesWith(180, []), windows, merged, String);
  assert.equal(segments[0]!.joined, true);
  assert.equal(segments[1]!.joined, undefined);
  assert.equal(summariseSegments(segments).joined, 1);

  // The count is then a lower bound, also without undetermined stretches, and the evidence does
  // not claim that the places it counts are all more than 25 km apart.
  const verdict = segmentVerdict(segments, null, { gps: false });
  assert.equal(verdict.places, 2);
  assert.equal(verdict.joined, 1);
  const ev = verdict.evidence[0]!;
  assert.match(ev.label, /^Die Aufnahme zeigt mindestens 2 Orte/);
  assert.match(ev.labelEn ?? '', /^The recording shows at least 2 places/);
  assert.match(ev.detail, /Antworten näher als 25 km beieinander zählen als ein Ort\. Ein Ort fasst Antworten zusammen, die weiter auseinanderliegen/);
  assert.match(ev.detailEn ?? '', /One place joins answers that lie farther apart/);
  assert.doesNotMatch(ev.detail, /mehr als 25 km auseinander/);
  assert.doesNotMatch(ev.detailEn ?? '', /more than 25 km apart/);
  assert.match(verdict.note.de, /^mindestens 2 Orte/);
  // With GPS in the file the same.
  const gps = segmentVerdict(segments, loc(50, 8, { method: 'metadata', radiusKm: 0.05 }), { gps: true });
  assert.equal(gps.evidence[0]!.label, 'Die Bilder zeigen mindestens 2 verschiedene Orte');
  assert.doesNotMatch(gps.evidence[0]!.detail, /auseinanderliegen\./);
});

test('merge: a weak window between two anchors is compared with them, not with the place\'s surest answer far away', () => {
  // A Berlin place that the world model tied to a 'strong' look-alike near Hamburg, which stands
  // for it; between two Berlin anchors a world-model window at Berlin ± 25 km.
  const north = predictionAt([
    { ...BERLIN, p: 0.5 },
    { ...NORDERSTEDT, p: 0.5 },
  ]);
  const windows = [
    win(0, 20, loc(NORDERSTEDT.lat, NORDERSTEDT.lon, { radiusKm: 3, label: 'Norderstedt' }), 'strong', north),
    win(20, 50, loc(BERLIN.lat, BERLIN.lon, { label: 'Berlin' }), 'similar', north),
    win(50, 80, loc(BERLIN.lat + 0.05, BERLIN.lon, { method: 'worldmodel', radiusKm: 25, confidence: 0.6 }), 'worldmodel', north),
    win(80, 110, loc(BERLIN.lat, BERLIN.lon + 0.02, { label: 'Berlin' }), 'similar', north),
  ];
  const merged = mergeWindows(windows);
  assert.deepEqual(merged.labels, [0, 0, 0, 0]);
  assert.equal(merged.stretches.length, 1);
});

/** buildWindows as it was: every neighbour's cosine computed again on every merge. */
function buildWindowsSlow(frames: SegmentFrame[], look: (i: number) => Float32Array, minWindowSec: number, maxWindows: number, end: number): [number, number][] {
  const scenes = scenesOf(frames);
  const spans = scenes.map((s) => ({ first: s.firstFrame, last: s.lastFrame }));
  const startOf = (k: number): number => (k === 0 ? 0 : frames[spans[k]!.first]!.t);
  const lengthOf = (k: number): number => (k + 1 < spans.length ? startOf(k + 1) : end) - startOf(k);
  const cos = (a: Float32Array, b: Float32Array): number => {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      na += a[i]! ** 2;
      nb += b[i]! ** 2;
    }
    return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
  };
  const sums = spans.map((s) => {
    const out = new Float32Array(look(s.first).length);
    for (let i = s.first; i <= s.last; i++) look(i).forEach((v, d) => (out[d] = out[d]! + v));
    return out;
  });
  const merge = (k: number): void => {
    const sum = sums[k]!.map((v, d) => v + sums[k + 1]![d]!);
    spans.splice(k, 2, { first: spans[k]!.first, last: spans[k + 1]!.last });
    sums.splice(k, 2, sum);
  };
  for (;;) {
    if (spans.length < 2) break;
    let shortest = -1;
    for (let k = 0; k < spans.length; k++) if (lengthOf(k) < minWindowSec && (shortest < 0 || lengthOf(k) < lengthOf(shortest))) shortest = k;
    if (shortest < 0) break;
    const prev = shortest > 0 ? cos(sums[shortest]!, sums[shortest - 1]!) : -Infinity;
    const next = shortest + 1 < spans.length ? cos(sums[shortest]!, sums[shortest + 1]!) : -Infinity;
    merge(prev >= next ? shortest - 1 : shortest);
  }
  while (spans.length > maxWindows) {
    let best = 0;
    let bestCos = -Infinity;
    for (let k = 0; k + 1 < spans.length; k++) {
      const c = cos(sums[k]!, sums[k + 1]!);
      if (c > bestCos) {
        bestCos = c;
        best = k;
      }
    }
    merge(best);
  }
  return spans.map((s) => [s.first, s.last]);
}

/** Frames of `scenes` scenes of 1 to 6 s each, and a seeded random look per scene. */
function manyScenes(scenes: number, dim: number, seed: number): { frames: SegmentFrame[]; look: (i: number) => Float32Array } {
  let x = seed;
  const random = (): number => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
  const cuts: number[] = [];
  let t = 0;
  for (let k = 0; k < scenes; k++) {
    cuts.push(t);
    t += 1 + Math.floor(random() * 6);
  }
  const frames = framesWith(t, cuts.slice(1));
  const looks = Array.from({ length: scenes }, () => Float32Array.from({ length: dim }, () => random() - 0.5));
  return { frames, look: (i: number) => looks[frames[i]!.s]! };
}

test('windows: merging many scenes recomputes only the cosines next to each merge, with the same windows as before', () => {
  for (const seed of [1, 2, 3]) {
    const { frames, look } = manyScenes(400, 16, seed);
    const end = frames.length + 0.5;
    const fast = buildWindows(frames, scenesOf(frames), end, look, { minWindowSec: 4, maxWindows: 60 });
    assert.deepEqual(
      fast.map((w) => [w.first, w.last]),
      buildWindowsSlow(frames, look, 4, 60, end),
      `seed ${seed}`,
    );
  }
  // Hours of footage with many short cuts: 3000 scenes at 768 dimensions merged down to 160
  // windows took about 7 s of the main thread before; now a small part of a second.
  const { frames, look } = manyScenes(3000, 768, 7);
  const started = performance.now();
  const windows = buildWindows(frames, scenesOf(frames), null, look, { minWindowSec: 4, maxWindows: 160 });
  const ms = performance.now() - started;
  assert.equal(windows.length, 160);
  assert.ok(ms < 2500, `buildWindows took ${Math.round(ms)} ms`);
});

test('verdict: a stretch at the place the whole file\'s world model rejected does not lead; equal lengths are said', () => {
  // The Deutschlandreise of the end-to-end check: Eschborn station taken for Norderstedt (±3 km)
  // over 24 s; the whole file's gallery said Norderstedt too, and its world model turned that down.
  const seg = (startSec: number, endSec: number, location: FixLocation | null, place: number | null, joined = false): FixSegment => ({
    startSec,
    endSec,
    firstFrame: startSec + 1,
    lastFrame: endSec,
    keyframe: { frame: startSec + 2, time: startSec + 1, imageUrl: String(startSec) },
    location,
    place,
    windows: 1,
    ...(joined ? { joined: true } : {}),
  });
  const norderstedt = loc(NORDERSTEDT.lat, NORDERSTEDT.lon, { radiusKm: 3, confidence: 0.83, label: 'Bahnhof Norderstedt Mitte, Hamburg', labelEn: 'Norderstedt Mitte station, Hamburg' });
  const segments = [
    seg(0, 12, null, null),
    seg(12, 17, loc(49.48, 8.44, { label: 'Ludwigshafen am Rhein, Mannheim' }), 1, true),
    seg(17, 24, null, null),
    seg(24, 48, norderstedt, 1, true),
    seg(48, 72, null, null),
    seg(72, 84, loc(52.5212, 13.3959, { radiusKm: 3, label: 'Bode-Museum, Berlin' }), 2),
    seg(84, 115, null, null),
  ];
  const vancouver = loc(49.17, -122.95, { method: 'worldmodel', radiusKm: 1500, confidence: 0.6, label: 'bei Vancouver' });
  const before = segmentVerdict(segments, vancouver, { gps: false });
  assert.equal(before.location?.label, 'Bahnhof Norderstedt Mitte, Hamburg', 'without the rejection the longest stretch leads');
  const verdict = segmentVerdict(segments, vancouver, { gps: false, rejected: loc(NORDERSTEDT.lat + 0.01, NORDERSTEDT.lon, { radiusKm: 7500 }) });
  assert.equal(verdict.lead, 5);
  assert.equal(verdict.location?.label, 'Bode-Museum, Berlin');
  assert.equal(verdict.replaced, true);
  const ev = verdict.evidence[0]!;
  assert.equal(ev.label, 'Die Aufnahme zeigt mindestens 2 Orte; oben der Abschnitt 1:12–1:24');
  assert.match(ev.detail, /Der längste Abschnitt mit Ort \(0:24–0:48: Bahnhof Norderstedt Mitte, Hamburg\) nennt den Ort, den das Weltmodell für die ganze Datei schon verworfen hat/);
  assert.match(ev.detail, /Oben steht der längste übrige Abschnitt mit Ort, 1:12–1:24/);
  assert.match(ev.detailEn ?? '', /Norderstedt Mitte station, Hamburg\) names the place the world model already rejected/);
  assert.match(verdict.note.de, /nicht 0:24–0:48 \(verworfen\)/);

  // Two stretches equally long: the surer shows, and the text does not call it "the longest".
  const tied = segmentVerdict([seg(0, 24, loc(PARIS.lat, PARIS.lon, { confidence: 0.85, label: 'Paris' }), 1), seg(24, 48, loc(BERLIN.lat, BERLIN.lon, { confidence: 0.9, label: 'Berlin' }), 2)], null, { gps: false });
  assert.equal(tied.location?.label, 'Berlin');
  assert.match(tied.evidence[0]!.detail, /Oben steht der sicherste der gleich langen längsten Abschnitte mit Ort, 0:24–0:48/);
  assert.match(tied.evidence[0]!.detailEn ?? '', /Shown above is the surest of the equally long longest segments with a place/);
});

test('summary: the fix\'s own place stands at the stretch the fix shows; the slim fix finds it from the evidence', () => {
  const segments: FixSegment[] = [
    { startSec: 0, endSec: 40, firstFrame: 1, lastFrame: 40, keyframe: { frame: 20, time: 19, imageUrl: 'a' }, location: loc(48.0, 11.6, { confidence: 0.82, label: 'München' }), place: 1, windows: 2, joined: true },
    { startSec: 40, endSec: 60, firstFrame: 41, lastFrame: 60, keyframe: { frame: 50, time: 49, imageUrl: 'b' }, location: loc(BERLIN.lat, BERLIN.lon, { label: 'Berlin' }), place: 2, windows: 1 },
    { startSec: 60, endSec: 70, firstFrame: 61, lastFrame: 70, keyframe: { frame: 65, time: 64, imageUrl: 'c' }, location: loc(47.8, 13.04, { confidence: 0.95, label: 'Salzburg' }), place: 1, windows: 1, joined: true },
  ];
  // Without a lead a place shows its surest stretch (Salzburg), 115 km from the fix's Munich.
  assert.equal(summariseSegments(segments).places[0]!.label, 'Salzburg');
  const summary = summariseSegments(segments, 0);
  assert.equal(summary.lead, 1);
  assert.equal(summary.places[0]!.label, 'München');
  assert.equal(summary.places[0]!.seconds, 50);
  assert.equal(summary.joined, 1);
  const fix: Fix = {
    videoId: 'v',
    status: 'ready',
    error: null,
    computedAt: 1,
    elapsedMs: 1,
    location: segments[0]!.location,
    candidates: [],
    countries: [],
    time: { method: 'none', utc: null, date: null, dateSource: 'none', monthRange: null, timezone: null, windows: [], sunElevationBand: null, phase: 'unknown', confidence: 0, notes: [] },
    sun: null,
    heading: null,
    horizon: null,
    evidence: [{ kind: 'segments', label: 'x', detail: 'y', weight: 0.9, frame: 20 }],
    keyframes: [],
    truth: null,
    segments,
  };
  const slim = slimFix(fix);
  assert.equal(slim.segmentSummary?.lead, 1);
  assert.equal(slim.segmentSummary?.places[0]!.label, 'München');
});

test('a fix whose place came from a stretch: the whole file\'s entries say so and lose their weight; countries from the places', () => {
  const landmark: Evidence = { kind: 'landmark', label: 'Referenzbild: Christ-Erlöser-Kathedrale (0,86)', labelEn: 'Reference picture: Cathedral of Christ the Saviour (0.86)', detail: 'Bild 3 … 1 km vom Ergebnis. Das ist eine Wiedererkennung.', detailEn: 'Frame 3 … 1 km from the result. That is a recognition.', weight: 0.4, refLat: 55.74, refLon: 37.6 };
  const world: Evidence = { kind: 'worldmodel', label: 'Weltmodell (GeoCLIP): bei Moskau (20 %)', detail: '… es bestätigt dieses Ergebnis, das bestehen bleibt.', weight: 0.5 };
  const region: Evidence = { kind: 'region', label: 'Länderschätzung: Russland 21 %', labelEn: 'Country estimate: Russia 21%', detail: 'd', weight: 0.1 };
  const sun: Evidence = { kind: 'sun', label: 'Sonnenhöhe 3–90°', detail: 'd', weight: 0.3 };
  const [l, w, r, s] = [landmark, world, region, sun].map(wholeFileEvidence);
  assert.equal(l!.label, 'Ganze Datei (gemischt): Referenzbild: Christ-Erlöser-Kathedrale (0,86)');
  assert.equal(l!.labelEn, 'Whole file (mixed): Reference picture: Cathedral of Christ the Saviour (0.86)');
  assert.equal(l!.weight, 0);
  assert.equal(l!.refLat, 55.74, 'the reference picture stays');
  assert.match(l!.detail, /^Aus der Ortung der ganzen Datei, deren Bilder mehrere Orte vermischen; „Ergebnis“ ist hier deren Antwort/);
  assert.match(l!.detailEn ?? '', /^From the fix of the whole file, whose pictures mix several places; "result" here is its answer/);
  assert.equal(w!.weight, 0);
  assert.equal(w!.labelEn, 'Whole file (mixed): Weltmodell (GeoCLIP): bei Moskau (20 %)');
  assert.equal(r!.label, 'Ganze Datei (gemischt): Länderschätzung: Russland 21 %');
  assert.equal(s, sun, 'the time evidence is not touched here: the engine marks the whole file\'s with wholeFileTimeEvidence');

  const segments: FixSegment[] = [
    { startSec: 0, endSec: 30, firstFrame: 1, lastFrame: 30, keyframe: { frame: 15, time: 14, imageUrl: 'a' }, location: loc(19.42, -99.18, { country: 'MX', countryName: 'Mexiko' }), place: 1, windows: 1 },
    { startSec: 30, endSec: 40, firstFrame: 31, lastFrame: 40, keyframe: { frame: 35, time: 34, imageUrl: 'b' }, location: null, place: null, windows: 1 },
    { startSec: 40, endSec: 50, firstFrame: 41, lastFrame: 50, keyframe: { frame: 45, time: 44, imageUrl: 'c' }, location: loc(-7.6, 110.2, { country: 'ID', countryName: 'Indonesien' }), place: 2, windows: 1 },
  ];
  // The fix shows the Indonesian stretch: its country first, then by time.
  assert.deepEqual(segmentCountries(segments, 2), [
    { iso: 'ID', name: 'Indonesien', p: 0.25 },
    { iso: 'MX', name: 'Mexiko', p: 0.75 },
  ]);
});

test('analyseSegments: the gallery is searched in parts of whole windows; a stop leaves the windows after it undetermined', async () => {
  const world = fixtureWorld();
  const dim = 4;
  const tiles = 2;
  const embedTexts = async (texts: string[]): Promise<Float32Array> => {
    const out = new Float32Array(texts.length * dim);
    texts.forEach((_, i) => (out[i * dim + 2 + (i % 2)] = 1));
    return out;
  };
  // Six scenes of 10 s, Paris and Berlin by turns: six windows of 8 frames, 16 rows each.
  const frames = framesWith(60, [10, 20, 30, 40, 50]);
  const matrix = new Float32Array(frames.length * tiles * dim);
  frames.forEach((f, i) => {
    for (let t = 0; t < tiles; t++) matrix.set(unit(dim, f.s % 2), (i * tiles + t) * dim);
  });
  const run = async (params: { searchRows?: number }, stopAfter = Infinity) => {
    const calls: number[] = [];
    const analysis = await analyseSegments(
      { frames, scenes: scenesOf(frames), durationSec: 60, matrix, tiles, dim, params },
      {
        world,
        embedTexts,
        search: async (vectors, k) => {
          calls.push(vectors.length / dim);
          return standInSearch(vectors, k, dim);
        },
        stopSearch: () => calls.length >= stopAfter,
      },
    );
    return { analysis, calls };
  };
  const whole = await run({ searchRows: 1000 });
  assert.deepEqual(whole.calls, [96]);
  const parts = await run({ searchRows: 40 });
  // Two windows (32 rows) per search: a third would make 48.
  assert.deepEqual(parts.calls, [32, 32, 32]);
  assert.equal(parts.analysis.searches, 3);
  assert.deepEqual(
    parts.analysis.windows.map((w) => [w.location?.label, w.tier]),
    whole.analysis.windows.map((w) => [w.location?.label, w.tier]),
    'the same answers as from one search',
  );
  // A window larger than the parts is still searched whole.
  assert.deepEqual((await run({ searchRows: 10 })).calls, [16, 16, 16, 16, 16, 16]);
  // Stopped after the first part: four windows without the gallery, undetermined.
  const stopped = await run({ searchRows: 40 }, 1);
  assert.deepEqual(stopped.calls, [32]);
  assert.equal(stopped.analysis.searchSkipped, 4);
  assert.deepEqual(
    stopped.analysis.windows.map((w) => w.location !== null),
    [true, true, false, false, false, false],
  );
});
