import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Evidence, TimeEstimate } from '../src/datum/contract.js';
import { timeEvidence } from '../src/datum/engine.js';
import type { GalleryNeighbour } from '../src/datum/gallery.js';
import { decideLocation, placeLabel } from '../src/datum/locate.js';
import { judgeCreationTime, metadataFromProbe } from '../src/datum/metadata.js';
import { DAY_LABELS_EN, LIGHT_CLASSES, SEASON_CLASSES, estimateTime, possibleClause, possibleClauseEn, type FrameStats, type TimeInput } from '../src/datum/time.js';
import { World } from '../src/datum/world.js';

/**
 * One language at a time in the console: every text the engine writes into a fix exists in
 * German and in English, in the same order, and the English one is English.
 */

const DIM = 32;
const NOW = Date.UTC(2026, 10, 18);

function embedder(): (texts: string[]) => Promise<Float32Array> {
  const index = new Map<string, number>();
  LIGHT_CLASSES.forEach((c, k) => c.prompts.forEach((p) => index.set(p, k)));
  SEASON_CLASSES.forEach((c, k) => c.prompts.forEach((p) => index.set(p, 8 + k)));
  return (texts) => {
    const out = new Float32Array(texts.length * DIM);
    texts.forEach((t, i) => {
      const k = index.get(t);
      if (k !== undefined) out[i * DIM + k] = 1;
      else out[i * DIM + 16 + (t.length % 16)] = 1;
    });
    return Promise.resolve(out);
  };
}

function frames(light: string, season: string): Float32Array {
  const out = new Float32Array(3 * DIM);
  const l = LIGHT_CLASSES.findIndex((c) => c.id === light);
  const s = 8 + SEASON_CLASSES.findIndex((c) => c.id === season);
  for (let f = 0; f < 3; f++) {
    out[f * DIM + l] = Math.SQRT1_2;
    out[f * DIM + s] = Math.SQRT1_2;
  }
  return out;
}

const day: FrameStats = { meanLuma: 0.5, skyLuma: 0.7, skyBlueness: 0.15, warmth: 0, contrast: 0.22 };
const dark: FrameStats = { meanLuma: 0.05, skyLuma: null, skyBlueness: null, warmth: 0.02, contrast: 0.08 };

function input(over: Partial<TimeInput>): TimeInput {
  return {
    frameEmbeddings: frames('daylight', 'summer'),
    dim: DIM,
    embedTexts: embedder(),
    frameStats: [day],
    location: { lat: 52.52, lon: 13.405 },
    country: 'DE',
    metadataUtc: null,
    filenameDate: null,
    now: NOW,
    ...over,
  };
}

/** Words that give a German sentence away; none may appear in an English text. */
const GERMAN = /\b(der|die|das|und|oder|nicht|ist|aus|dem|den|Uhr|möglich|Sonnenhöhe|Jahreszeit|Bild|Datei|Licht|Datum)\b|[äöüß]/;

function assertEnglish(texts: readonly string[], where: string): void {
  for (const text of texts) assert.doesNotMatch(text, GERMAN, `${where}: "${text}"`);
}

function assertNotes(time: TimeEstimate, where: string): void {
  assert.ok(time.notesEn, `${where}: notesEn present`);
  assert.equal(time.notesEn.length, time.notes.length, `${where}: same number of notes`);
  assert.ok(time.notes.length > 0, `${where}: there are notes`);
  assertEnglish(time.notesEn, where);
}

test('time notes exist in both languages, same length, in every branch', async () => {
  const cases: Array<[string, Partial<TimeInput>]> = [
    ['metadata instant', { metadataUtc: Date.UTC(2024, 5, 21, 10, 0), frameEmbeddings: frames('midday', 'summer') }],
    ['metadata against the light', { metadataUtc: Date.UTC(2024, 5, 21, 10, 0), frameEmbeddings: frames('night', 'urban'), frameStats: [dark] }],
    ['metadata without a place', { metadataUtc: Date.UTC(2024, 5, 21, 10, 0), location: null, country: null }],
    ['file name date', { filenameDate: '2024-06-21' }],
    ['date tag', { metadataDate: '2024-06-21' }],
    ['future dates', { filenameDate: '2999-01-01', metadataDate: '2999-02-01' }],
    ['season from the picture', { frameEmbeddings: frames('daylight', 'autumn') }],
    ['southern hemisphere', { frameEmbeddings: frames('daylight', 'autumn'), location: { lat: -33.87, lon: 151.21 }, country: 'AU' }],
    ['equator', { frameEmbeddings: frames('daylight', 'tropical'), location: { lat: 1.29, lon: 103.85 }, country: 'SG' }],
    ['no season', { frameEmbeddings: frames('daylight', 'urban') }],
    ['night', { frameEmbeddings: frames('night', 'urban'), frameStats: [dark], filenameDate: '2024-12-21' }],
    ['indoors', { frameEmbeddings: frames('indoor', 'urban'), frameStats: [dark] }],
    ['place unknown', { location: null, country: null }],
    ['no embeddings', { frameEmbeddings: new Float32Array(0) }],
  ];
  for (const [name, over] of cases) {
    const { time } = await estimateTime(input(over));
    assertNotes(time, name);
    // The evidence built from the time carries both languages as well.
    for (const e of timeEvidence(time)) {
      assert.ok(e.labelEn && e.detailEn, `${name}: time evidence in English`);
      assertEnglish([e.labelEn, e.detailEn], `${name} evidence`);
    }
  }
  const { time } = await estimateTime(input({ filenameDate: '2024-06-21' }));
  assert.match(time.notesEn!.join(' '), /Date from the file name: 21 June 2024\./);
  assert.match(time.notesEn!.join(' '), /Sun elevation from light and shadows: 12 to 35°/);
  assert.match(time.notesEn!.join(' '), /cannot be told apart/);
  // Window labels stay German keys; the console translates them.
  assert.ok(time.windows.every((w) => w.label in DAY_LABELS_EN));
});

test('the clause of possible times reads the same in both languages', () => {
  const w = (startMin: number, endMin: number): { startMin: number; endMin: number; label: string; probability: number } => ({ startMin, endMin, label: 'Morgen', probability: 0.5 });
  assert.equal(possibleClause([w(305, 383), w(1193, 1272)]), 'möglich ist 05:05–06:23 oder 19:53–21:12 Uhr');
  assert.equal(possibleClauseEn([w(305, 383), w(1193, 1272)]), 'possible times are 05:05–06:23 or 19:53–21:12');
  assert.equal(possibleClauseEn([w(305, 383)]), 'possible time is 05:05–06:23');
  assert.equal(possibleClauseEn([w(0, 1439)]), 'any time of day is possible');
  assert.equal(possibleClauseEn([]), 'no time of day is possible');
});

function box(w: number, s: number, e: number, n: number): [number, number][] {
  return [[w, s], [e, s], [e, n], [w, n], [w, s]];
}

function fixtureWorld(): World {
  return World.fromJson(
    [
      { iso: 'DE', name_de: 'Deutschland', name_en: 'Germany', continent: 'EU', centroid: [10, 51], areaKm2: 357000, bbox: [6, 47, 15, 55], polygons: [box(6, 47, 15, 55)] },
      { iso: 'FR', name_de: 'Frankreich', name_en: 'France', continent: 'EU', centroid: [2.5, 46.5], areaKm2: 550000, bbox: [-5, 42, 6, 51], polygons: [box(-5, 42, 6, 51)] },
    ],
    [
      { name: 'Koblenz', name_de: 'Koblenz', iso: 'DE', lat: 50.36, lon: 7.59, pop: 113000 },
      { name: 'Cologne', name_de: 'Köln', iso: 'DE', lat: 50.94, lon: 6.96, pop: 1080000 },
      { name: 'Paris', name_de: 'Paris', iso: 'FR', lat: 48.86, lon: 2.35, pop: 2100000 },
    ],
  );
}

function assertEvidence(evidence: readonly Evidence[], where: string): void {
  assert.ok(evidence.length > 0, where);
  for (const e of evidence) {
    assert.ok(e.labelEn && e.detailEn, `${where}: ${e.kind} "${e.label}" has English texts`);
    assertEnglish([e.labelEn, e.detailEn], `${where} ${e.kind}`);
  }
}

test('localisation evidence and place names exist in both languages', () => {
  const world = fixtureWorld();
  const n = (id: string, lat: number, lon: number, s: number, country = 'DE'): GalleryNeighbour => ({ id, label: id, lat, lon, country, wikidata: null, similarity: s });
  const cos = new Float32Array([0.12, 0.08]);
  const strong = decideLocation(world, {
    neighbours: [[n('Deutsches Eck', 50.3644, 7.6058, 0.9), n('Louvre', 48.861, 2.336, 0.62, 'FR')]],
    countryCosines: cos,
    frameNumbers: [10],
    metadata: null,
    hints: { date: '2018-06-17', place: 'Koblenz Ufer' },
  });
  assertEvidence(strong.evidence, 'landmark');
  assert.equal(strong.location?.labelEn, 'Deutsches Eck, Koblenz');
  assert.ok(strong.candidates.every((c) => c.labelEn));
  const region = decideLocation(world, { neighbours: [[n('a', 52.5, 13.4, 0.4)]], countryCosines: cos, frameNumbers: [1], metadata: null, hints: null });
  assert.equal(region.location?.label, 'Deutschland');
  assert.equal(region.location?.labelEn, 'Germany');
  assertEvidence(region.evidence, 'region');
  const meta = metadataFromProbe(
    { format: { tags: { location: '+50.9413+006.9583/', creation_time: '1904-01-01T00:00:00Z' } }, streams: [{ codec_type: 'video', width: 640, height: 360 }] },
    null,
    NOW,
  );
  assert.ok(meta.creationRejected && meta.creationRejectedEn);
  const withGps = decideLocation(world, { neighbours: [[n('a', 52.5, 13.4, 0.4)]], countryCosines: cos, frameNumbers: [1], metadata: meta, hints: null });
  assert.equal(withGps.location?.method, 'metadata');
  assert.equal(withGps.location?.label, 'Köln');
  assert.equal(withGps.location?.labelEn, 'Cologne');
  assertEvidence(withGps.evidence, 'metadata');
  assert.match(withGps.evidence.find((e) => e.label.startsWith('GPS'))?.labelEn ?? '', /GPS in the file: 50\.9413° N, 6\.9583° E/);

  // Place names: "bei Köln" / "near Cologne".
  const near = placeLabel(world, 50.8, 7.1, null);
  assert.deepEqual(near, { de: 'bei Köln', en: 'near Cologne' });
  assert.deepEqual(judgeCreationTime(0, { encoder: null, fileMtimeMs: null, now: NOW }), {
    de: 'Zeitstempel vor 1990 (Standardwert des Encoders)',
    en: "timestamp before 1990 (the encoder's default value)",
  });
});
