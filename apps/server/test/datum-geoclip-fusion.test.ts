import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GalleryNeighbour } from '../src/datum/gallery.js';
import { compactPrediction, cosines, massWithin, modesOf, normaliseRows, type GeoclipPrediction } from '../src/datum/geoclip.js';
import { DEFAULT_LOCATE_PARAMS, decideLocation, worldModelRadiusKm, type LocateEvidence } from '../src/datum/locate.js';
import { World, greatCircleKm, type LonLat } from '../src/datum/world.js';

/**
 * The world model in the localisation (decideLocation with a GeoCLIP prediction): where GeoCLIP
 * agrees with the gallery the gallery's answer stands, where it puts almost nothing there its own
 * point becomes the answer; it is always part of the evidence, in German and in English.
 */

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
      { iso: 'FR', name_de: 'Frankreich', name_en: 'France', continent: 'Europe', centroid: [2.5, 46.5], areaKm2: 550000, bbox: [-5, 42, 6, 51], polygons: [[box(-5, 42, 6, 51)]] },
    ],
    [
      { name: 'Koblenz', name_de: 'Koblenz', iso: 'DE', lat: 50.36, lon: 7.59, pop: 113000 },
      { name: 'Cologne', name_de: 'Köln', iso: 'DE', lat: 50.94, lon: 6.96, pop: 1080000 },
      { name: 'Paris', name_de: 'Paris', iso: 'FR', lat: 48.86, lon: 2.35, pop: 2100000 },
      { name: 'Lyon', name_de: 'Lyon', iso: 'FR', lat: 45.76, lon: 4.84, pop: 500000 },
    ],
  );
}

const n = (id: string, lat: number, lon: number, s: number, country = 'DE'): GalleryNeighbour => ({ id, label: id, lat, lon, country, wikidata: null, similarity: s });

/** A clear recognition of the Deutsches Eck (the 'strong' tier). */
function strongEvidence(): LocateEvidence {
  return {
    neighbours: [
      [n('Deutsches Eck', 50.3644, 7.6058, 0.9), n('Louvre', 48.861, 2.336, 0.62, 'FR')],
      [n('Deutsches Eck', 50.3644, 7.6058, 0.88), n('Kölner Dom', 50.9413, 6.9583, 0.6)],
    ],
    countryCosines: new Float32Array([0.12, 0.08]),
    frameNumbers: [10, 20],
    metadata: null,
    hints: null,
  };
}

/** A GeoCLIP prediction with its mass on the given points (compact form, as the thread sends it). */
function prediction(points: { lat: number; lon: number; p: number }[], countries: { iso: string; name: string; p: number }[]): GeoclipPrediction {
  const sorted = [...points].sort((a, b) => b.p - a.p);
  const best = sorted[0] ?? { lat: 0, lon: 0, p: 1 };
  return {
    frames: 12,
    aggregation: 'mixture',
    probs: Float32Array.from(sorted.map((x) => x.p)),
    coords: Float32Array.from(sorted.flatMap((x) => [x.lat, x.lon])),
    support: Uint32Array.from(sorted.map((_, i) => i)),
    top: sorted.slice(0, 20),
    // One mode per point (the points of a test lie far apart).
    modes: sorted.map((x) => ({ lat: x.lat, lon: x.lon, p: x.p, peak: x, spreadKm: 2 })),
    refined: null,
    best: { lat: best.lat, lon: best.lon },
    countries,
    timing: { embedMs: 0, scoreMs: 0, refineMs: 0 },
  };
}

const GERMAN_WORDS = /\b(der|die|das|und|nicht|Bild|Bilder|Wahrscheinlichkeit|seiner|liegen)\b/;

test('GeoCLIP agrees with the gallery: the gallery answer stands, GeoCLIP confirms it', () => {
  const world = fixtureWorld();
  const geo = prediction(
    [
      { lat: 50.3644, lon: 7.6062, p: 0.6 },
      { lat: 50.94, lon: 6.96, p: 0.3 },
      { lat: 48.86, lon: 2.35, p: 0.1 },
    ],
    [
      { iso: 'DE', name: 'Deutschland', p: 0.9 },
      { iso: 'FR', name: 'Frankreich', p: 0.1 },
    ],
  );
  const without = decideLocation(world, strongEvidence());
  const r = decideLocation(world, { ...strongEvidence(), geoclip: geo });
  assert.equal(r.location?.method, 'landmark');
  assert.equal(r.location?.lat, without.location?.lat);
  assert.equal(r.location?.radiusKm, without.location?.radiusKm, 'the gallery answer keeps its radius');
  assert.equal(r.diagnostics.worldModel?.replaced, false);
  assert.ok((r.diagnostics.worldModel?.agreeMass ?? 0) > 0.85, 'Koblenz and Cologne lie within 200 km of the answer');
  assert.equal(r.diagnostics.features.agreeMass, r.diagnostics.worldModel?.agreeMass);
  const e = r.evidence.find((x) => x.kind === 'worldmodel');
  assert.ok(e);
  assert.match(e.detail, /bestätigt/);
  assert.match(e.detailEn ?? '', /confirms/);
  assert.doesNotMatch(e.detailEn ?? '', GERMAN_WORDS);
  assert.ok(e.labelEn?.startsWith('World model (GeoCLIP)'));
  assert.ok(e.weight > 0 && e.weight <= 1);
  // The gallery's answer leads the candidates, scores stay normalised.
  const first = r.candidates[0];
  assert.ok(first && greatCircleKm(first.lat, first.lon, r.location?.lat ?? 0, r.location?.lon ?? 0) < 1);
  assert.ok(r.candidates.reduce((s, c) => s + c.score, 0) <= 1 + 1e-9);
  assert.ok(r.candidates.every((c, i) => i === 0 || c.score <= (r.candidates[0]?.score ?? 0)));
  // Without GeoCLIP nothing of it shows.
  assert.equal(without.evidence.some((x) => x.kind === 'worldmodel'), false);
  assert.equal(without.diagnostics.worldModel, null);
});

test('GeoCLIP puts almost nothing near the gallery answer: its point replaces it', () => {
  const world = fixtureWorld();
  // Everything around Lyon; nothing within 200 km of Koblenz.
  const geo = prediction(
    [
      { lat: 45.76, lon: 4.84, p: 0.5 },
      { lat: 45.8, lon: 4.9, p: 0.3 },
      { lat: 48.86, lon: 2.35, p: 0.2 },
    ],
    [{ iso: 'FR', name: 'Frankreich', p: 1 }],
  );
  const r = decideLocation(world, { ...strongEvidence(), geoclip: geo });
  assert.equal(r.location?.method, 'worldmodel');
  assert.equal(r.diagnostics.radiusTier, 'worldmodel');
  assert.equal(r.diagnostics.level, 'worldmodel');
  assert.equal(r.diagnostics.worldModel?.replaced, true);
  assert.ok(greatCircleKm(r.location?.lat ?? 0, r.location?.lon ?? 0, 45.76, 4.84) < 0.1, 'the answer is GeoCLIP\'s best point');
  assert.match(r.location?.label ?? '', /Lyon/);
  assert.match(r.location?.labelEn ?? '', /Lyon/);
  assert.equal(r.location?.country, 'FR');
  assert.equal(r.countries[0]?.iso, 'FR', 'the countries are GeoCLIP\'s');
  // The first country estimate belongs to the replaced gallery answer: said, and without weight.
  const region = r.evidence.find((x) => x.kind === 'region');
  assert.ok(region);
  assert.equal(region.weight, 0);
  assert.match(region.detail, /das das Weltmodell ersetzt hat/);
  assert.match(region.detailEn ?? '', /which the world model replaced/);
  assert.doesNotMatch(region.detail, /weiche Gewichtung/);
  // 0.8 of the mass within 25 km of the answer: the concentrated tier's radius.
  const concentration = r.diagnostics.worldModel?.concentration ?? 0;
  assert.ok(concentration > 0.79 && concentration < 0.81);
  assert.equal(r.location?.radiusKm, worldModelRadiusKm(DEFAULT_LOCATE_PARAMS.geoclip.radius, concentration));
  assert.ok((r.location?.confidence ?? 0) > 0 && (r.location?.confidence ?? 1) <= 0.95);
  // The gallery's own answer is kept for the record.
  assert.equal(r.diagnostics.gallery?.method, 'landmark');
  const e = r.evidence.find((x) => x.kind === 'worldmodel');
  assert.ok(e);
  assert.match(e.detail, /ersetzt/);
  assert.match(e.detailEn ?? '', /replaces/);
  assert.doesNotMatch(e.detailEn ?? '', GERMAN_WORDS);
  assert.ok(e.weight >= 0.5);
  // GeoCLIP's point leads the candidates; the gallery's place is still among them; sum <= 1.
  const first = r.candidates[0];
  assert.ok(first && greatCircleKm(first.lat, first.lon, 45.76, 4.84) < 0.1);
  assert.ok(r.candidates.some((c) => greatCircleKm(c.lat, c.lon, 50.3644, 7.6058) < 1));
  assert.ok(r.candidates.reduce((s, c) => s + c.score, 0) <= 1 + 1e-9);
  for (const c of r.candidates) assert.ok(c.labelEn, `candidate ${c.label} has an English name`);
});

test('a diffuse GeoCLIP answer gets the wide radius; no gallery answer at all is replaced too; GPS still wins', () => {
  const world = fixtureWorld();
  // Spread over many places far apart: little mass near any one of them.
  const points = Array.from({ length: 10 }, (_, i) => ({ lat: 43 + i * 0.9, lon: -2 + i * 1.5, p: 0.1 }));
  const geo = prediction(points, [{ iso: 'FR', name: 'Frankreich', p: 1 }]);
  // Weak retrieval and a flat prior: no gallery answer.
  const weak: LocateEvidence = {
    neighbours: [[n('a', 52.5, 13.4, 0.3)]],
    countryCosines: new Float32Array([0.1, 0.1]),
    frameNumbers: [1],
    metadata: null,
    hints: null,
  };
  const none = decideLocation(world, weak, { countryMinP: 0.9, continentMinP: 1.1 });
  assert.equal(none.location, null);
  const r = decideLocation(world, { ...weak, geoclip: geo }, { countryMinP: 0.9, continentMinP: 1.1 });
  assert.equal(r.location?.method, 'worldmodel');
  assert.ok((r.diagnostics.worldModel?.concentration ?? 1) < 0.2);
  assert.equal(r.location?.radiusKm, DEFAULT_LOCATE_PARAMS.geoclip.radius[DEFAULT_LOCATE_PARAMS.geoclip.radius.length - 1]?.radiusKm);
  assert.match(r.evidence.find((x) => x.kind === 'worldmodel')?.detail ?? '', /keinen Ort/);

  // GPS in the file decides the place; GeoCLIP is reported and weighs little.
  const withGps = decideLocation(world, {
    ...weak,
    geoclip: geo,
    metadata: {
      creationUtc: null,
      creationDate: null,
      location: { lat: 48.8584, lon: 2.2945 },
      altitude: null,
      device: null,
      raw: {},
      durationSec: null,
      fps: null,
      width: null,
      height: null,
    },
  });
  assert.equal(withGps.location?.method, 'metadata');
  const e = withGps.evidence.find((x) => x.kind === 'worldmodel');
  assert.ok(e && e.weight <= 0.05);
  assert.match(e.detail, /GPS/);
  assert.match(e.detailEn ?? '', /GPS/);
});

test('a world-model answer in a small mode still leads the candidates', () => {
  const world = fixtureWorld();
  // Diffuse prediction: the single most probable point (Munich, 1.5 %) is a mode of its own,
  // below candidateMinMass and behind three larger clusters (Madrid, Rome, Amsterdam, 7.2 % each)
  // that use up candidateModes. The rest lies scattered in small points far from all of them.
  const points: { lat: number; lon: number; p: number }[] = [{ lat: 48.14, lon: 11.58, p: 0.015 }];
  for (const [lat, lon] of [
    [40.42, -3.7],
    [41.9, 12.5],
    [52.37, 4.9],
  ] as const) {
    for (let k = 0; k < 6; k++) points.push({ lat: lat + k * 0.01, lon: lon + k * 0.01, p: 0.012 });
  }
  for (let k = 0; k < 60; k++) points.push({ lat: -50 + (k % 10) * 9, lon: -170 + Math.floor(k / 10) * 25, p: 0.011 });
  points.sort((a, b) => b.p - a.p);
  const coords = Float32Array.from(points.flatMap((x) => [x.lat, x.lon]));
  const probs = Float32Array.from(points.map((x) => x.p));
  const support = Uint32Array.from(points.map((_, i) => i));
  const modes = modesOf(coords, probs, support, 25, 10);
  // The fixture holds what it should: Munich's mode is the fourth and below the mass cut-off.
  assert.ok(modes.slice(0, 3).every((m) => m.p > 0.07));
  assert.ok(greatCircleKm(modes[3]?.lat ?? 0, modes[3]?.lon ?? 0, 48.14, 11.58) < 1);
  assert.ok((modes[3]?.p ?? 1) < DEFAULT_LOCATE_PARAMS.geoclip.candidateMinMass);
  const base: GeoclipPrediction = {
    frames: 12,
    aggregation: 'mixture',
    probs,
    coords,
    support,
    top: points.slice(0, 20),
    modes,
    refined: null,
    best: { lat: 48.14, lon: 11.58 },
    countries: [{ iso: 'DE', name: 'Deutschland', p: 1 }],
    timing: { embedMs: 0, scoreMs: 0, refineMs: 0 },
  };
  // No gallery answer at all: GeoCLIP gives the place.
  const weak: LocateEvidence = {
    neighbours: [[n('a', 52.5, 13.4, 0.3)]],
    countryCosines: new Float32Array([0.1, 0.1]),
    frameNumbers: [1],
    metadata: null,
    hints: null,
  };
  const check = (geo: GeoclipPrediction, what: string): void => {
    const r = decideLocation(world, { ...weak, geoclip: geo }, { countryMinP: 0.9, continentMinP: 1.1 });
    assert.equal(r.location?.method, 'worldmodel', what);
    const first = r.candidates[0];
    assert.ok(first, what);
    assert.ok(greatCircleKm(first.lat, first.lon, geo.best.lat, geo.best.lon) < 0.1, `${what}: the answer leads the candidates`);
    assert.equal(first.label, r.location?.label, what);
    assert.ok(first.labelEn, what);
    assert.ok(r.candidates.every((c) => c.score <= first.score + 1e-12), `${what}: the answer has the top score`);
    assert.ok(r.candidates.reduce((s, c) => s + c.score, 0) <= 1 + 1e-9, what);
    // The three large clusters are still offered.
    assert.ok(r.candidates.filter((c) => greatCircleKm(c.lat, c.lon, 40.42, -3.7) < 30).length === 1, what);
  };
  check(base, 'answer in a small mode');
  // A refined answer that is no member of any mode (Lyon, no support near it) gets its own entry.
  const refined: GeoclipPrediction = { ...base, refined: { lat: 45.76, lon: 4.84, gain: 0.5 }, best: { lat: 45.76, lon: 4.84 } };
  check(refined, 'answer away from every mode');
  const r = decideLocation(world, { ...weak, geoclip: refined }, { countryMinP: 0.9, continentMinP: 1.1 });
  assert.equal(r.candidates[0]?.radiusKm, DEFAULT_LOCATE_PARAMS.geoclip.candidateKm);
  assert.equal(r.candidates[0]?.country, 'FR');
});

test('radius tiers of world-model answers by concentration', () => {
  const tiers = [
    { minConcentration: 0.2, radiusKm: 25 },
    { minConcentration: 0, radiusKm: 1500 },
  ];
  assert.equal(worldModelRadiusKm(tiers, 0.5), 25);
  assert.equal(worldModelRadiusKm(tiers, 0.2), 25);
  assert.equal(worldModelRadiusKm(tiers, 0.19), 1500);
  assert.equal(worldModelRadiusKm(tiers, 0), 1500);
  assert.equal(worldModelRadiusKm([], 0.5), 1500);
});

test('the compact prediction answers mass queries like the full one; scoring several frames per pass is exact', () => {
  // Gallery of 1000 points, probabilities on a few of them.
  const size = 1000;
  const coords = new Float32Array(2 * size);
  const probs = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    coords[2 * i] = -60 + (i % 100) * 1.2;
    coords[2 * i + 1] = -170 + Math.floor(i / 100) * 34;
  }
  const support = Uint32Array.from([5, 17, 230, 999]);
  [0.4, 0.3, 0.2, 0.1].forEach((p, k) => (probs[support[k] as number] = p));
  const full: GeoclipPrediction = {
    frames: 1,
    aggregation: 'mixture',
    probs,
    coords,
    support,
    top: [],
    modes: [],
    refined: null,
    best: { lat: coords[10] as number, lon: coords[11] as number },
    countries: [],
    timing: { embedMs: 0, scoreMs: 0, refineMs: 0 },
  };
  const compact = compactPrediction(full);
  assert.equal(compact.coords.length, 8);
  assert.equal(compact.probs.length, 4);
  for (const i of support) {
    const lat = coords[2 * i] as number;
    const lon = coords[2 * i + 1] as number;
    for (const km of [1, 200, 5000]) assert.equal(massWithin(compact, lat, lon, km), massWithin(full, lat, lon, km));
  }

  // cosines() takes twelve frames per pass, then what is left in passes of eight, four, two and one;
  // every sum keeps its order, so the result is exact (23 frames: one pass of each width).
  const dim = 16;
  const frames = 23;
  const rand = (seed: number): (() => number) => {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32 - 0.5;
    };
  };
  const r = rand(7);
  const images = normaliseRows(Float32Array.from({ length: frames * dim }, r), dim);
  const gallery = normaliseRows(Float32Array.from({ length: 50 * dim }, r), dim);
  const fast = cosines(images, frames, gallery, 50, dim);
  for (let f = 0; f < frames; f++) {
    for (let g = 0; g < 50; g++) {
      let s = 0;
      for (let d = 0; d < dim; d++) s += (images[f * dim + d] as number) * (gallery[g * dim + d] as number);
      assert.equal(fast[f * 50 + g], Math.fround(s));
    }
  }
});
