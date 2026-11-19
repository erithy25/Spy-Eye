import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Evidence, Fix, FixLocation, FixSegment, Keyframe, TimeEstimate } from '../src/datum/contract.js';
import { placeCandidates } from '../src/datum/engine.js';
import { slimFix } from '../src/datum/routes.js';
import {
  DEFAULT_SEGMENT_PARAMS,
  multiPlaceTimeEvidence,
  segmentCountries,
  segmentVerdict,
  stretchSpacesNote,
  stretchTimesNote,
  summariseSegments,
  verdictCountries,
  wholeFileEvidence,
  wholeFileTimeEvidence,
} from '../src/datum/segments.js';
// The console's helpers (pure; their imports are types only).
import {
  chosenStretch,
  dialClock,
  GLOBE_REACH_KM,
  leadSegment,
  placesText,
  segmentSummary,
  spaceOfFix,
  spacedStretches,
  stretchClock,
  stretchMapReach,
  stretchSpaces,
  timelinePlacesText,
  wholeFilePlace,
  wholeFileShapes,
  wholeFileShown,
} from '../../web/src/datum/segments.ts';

/** A shape of the console's map, as wholeFileShapes takes it. */
type MapShape = Parameters<typeof wholeFileShapes>[2][number];

/**
 * Engine 12: a recording of one recognised place and undetermined stretches carries its
 * stretches. The undetermined ones may show other places, which the whole file's answer mixes in
 * (Stadt-Land: 24 s Cork, then a church and a bridge in Germany, gave "Frankfurt"). The place shows
 * above only where it covers at least a fifth of the recording and is not the one the whole
 * file's world model rejected; otherwise the whole file's answer stays above. GPS files, single
 * stretches and recordings of several places stay as they were.
 */

function loc(lat: number, lon: number, over: Partial<FixLocation> = {}): FixLocation {
  return { lat, lon, radiusKm: 1500, confidence: 0.9, method: 'landmark', label: over.label ?? `${lat},${lon}`, country: null, countryName: null, ...over };
}

function seg(startSec: number, endSec: number, location: FixLocation | null, place: number | null, over: Partial<FixSegment> = {}): FixSegment {
  return { startSec, endSec, firstFrame: startSec + 1, lastFrame: endSec, keyframe: { frame: startSec + 2, time: startSec + 1, imageUrl: `f${startSec}` }, location, place, windows: 1, ...over };
}

const TIME: TimeEstimate = { method: 'sun', utc: null, date: null, dateSource: 'none', monthRange: null, timezone: 'Europe/Berlin', windows: [], sunElevationBand: [10, 40], phase: 'day', confidence: 0.4, notes: [] };

/** A full fix with these stretches and evidence, as the engine writes it. */
function fixWith(segments: FixSegment[], evidence: Evidence[], location: FixLocation | null, keyframes: Keyframe[] = []): Fix {
  return {
    videoId: 'v',
    status: 'ready',
    error: null,
    computedAt: 7,
    elapsedMs: 1,
    location,
    candidates: [],
    countries: [],
    time: TIME,
    sun: null,
    heading: null,
    horizon: null,
    evidence,
    keyframes,
    truth: null,
    segments,
  };
}

const t = (de: string, vars?: Record<string, string | number>): string => de.replace('{n}', String(vars?.n ?? ''));

// The places of the measured cases (docs/measurements/datum-segments-one-place.json).
const ELSTERTAL = loc(50.553163, 12.167632, { radiusKm: 7500, confidence: 0.871, label: 'Elstertalbrücke, Hof', labelEn: 'Elster Viaduct, Hof', country: 'DE', countryName: 'Deutschland' });
const GALLILEO = loc(50.1107, 8.6729, { confidence: 0.888, label: 'Gallileo, Frankfurt', country: 'DE', countryName: 'Deutschland' });
const YEOSU = loc(34.7375, 127.7464, { confidence: 0.864, label: 'Yi-Sun-sin-Brücke, Yeosu', labelEn: 'Yi Sun-sin Bridge, Yeosu', country: 'KR', countryName: 'Südkorea' });
const MEDINA = loc(24.4397, 39.6172, { method: 'worldmodel', confidence: 0.71, label: 'Medina', country: 'SA', countryName: 'Saudi-Arabien' });
const KOELN = loc(50.9493, 6.9726, { confidence: 0.913, label: 'Zoobrücke, Köln', labelEn: 'Zoobrücke, Cologne', country: 'DE', countryName: 'Deutschland' });
const BRYN = loc(53.0, -3.1, { confidence: 0.884, label: 'Bryn Eglwys, Chester', country: 'GB', countryName: 'Vereinigtes Königreich' });
const UK = loc(54.0, -2.0, { method: 'worldmodel', confidence: 0.75, label: 'Vereinigtes Königreich', country: 'GB', countryName: 'Vereinigtes Königreich' });

const REGIONS = [
  { startSec: 0, endSec: 30, lat: 51.29, lon: 0.34, radiusKm: 1500, label: 'Nordeuropa oder Westeuropa', labelEn: 'Northern Europe or Western Europe' },
  { startSec: 30, endSec: 36, lat: 51.28, lon: 15.11, radiusKm: 1500, label: 'Westeuropa oder Osteuropa', labelEn: 'Western Europe or Eastern Europe' },
];

test('one place: Stadt-Land shows its located stretch above, which covers a quarter of the recording, and says why', () => {
  const segments = [seg(0, 36, null, null, { windows: 2, coarse: REGIONS }), seg(36, 48, ELSTERTAL, 1)];
  const v = segmentVerdict(segments, GALLILEO, { gps: false });
  assert.equal(v.multi, true, 'the timeline: the first 36 s may be elsewhere');
  assert.equal(v.places, 1);
  assert.equal(v.lead, 1);
  assert.equal(v.replaced, true);
  assert.equal(v.location, ELSTERTAL);
  const e = v.evidence[0]!;
  assert.equal(e.kind, 'segments');
  assert.equal(e.weight, 0.9);
  assert.equal(e.frame, segments[1]!.keyframe.frame, 'the entry names the stretch shown by its keyframe');
  assert.equal(e.label, 'Die Aufnahme zeigt einen erkannten Ort; ein Abschnitt unbestimmt; oben der Abschnitt 0:36–0:48');
  assert.equal(e.labelEn, 'The recording shows one recognised place; one segment undetermined; shown above: segment 0:36–0:48');
  assert.equal(
    e.detail,
    'Abschnittsweise geortet: 2 Abschnitte, einer davon mit Ort, ein erkannter Ort. Ein Abschnitt bleibt unbestimmt; er kann einen anderen Ort zeigen. Für ihn nennt die Zeitleiste eine grobe Region, die nicht als Ort zählt. Oben steht der Abschnitt mit Ort, 0:36–0:48: Elstertalbrücke, Hof, ± 7.500 km, Sicherheit 87 %; der Abschnitt umfasst 25 % der Aufnahme (ab 20 % steht ein Ort oben). Er ersetzt die Ortung aus der ganzen Datei, deren Bilder auch die unbestimmten Abschnitte einschließen. Die Zeitleiste unter dem Video zeigt jeden Abschnitt.',
  );
  assert.equal(
    e.detailEn,
    'Located segment by segment: 2 segments, one of them with a place, one recognised place. One segment remains undetermined and may show another place. For it the timeline names a coarse region, which does not count as a place. Shown above is the segment with a place, 0:36–0:48: Elster Viaduct, Hof, ± 7,500 km, confidence 87%; the segment covers 25% of the recording (a place is shown above from 20% on). It replaces the fix from the whole file, whose pictures include the undetermined segments too. The timeline under the video shows every segment.',
  );
  assert.doesNotMatch(`${e.label} ${e.detail}`, /mindestens|verschiedene Orte|Orte vermischt/, 'no second place is claimed');
  assert.deepEqual(v.note, {
    de: '1 erkannter Ort in 2 Abschnitten (1 unbestimmt); oben 0:36–0:48, ersetzt die Ortung der ganzen Datei',
    en: '1 recognised place in 2 segments (1 undetermined); shown 0:36–0:48, replaces the fix of the whole file',
  });
  // Country and candidate: a share of the whole recording, not 100 % of the located time.
  assert.deepEqual(segmentCountries(segments, 1), [{ iso: 'DE', name: 'Deutschland', p: 0.25 }]);
  const candidates = placeCandidates(segments, 1);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.label, 'Elstertalbrücke, Hof');
  assert.equal(candidates[0]!.score, 0.25);

  // The list and the console find the stretch shown, and say one place and one undetermined stretch.
  const fix = fixWith(segments, v.evidence, v.location);
  assert.equal(slimFix(fix).segmentSummary?.lead, 1);
  assert.equal(leadSegment(fix), 1);
  assert.equal(wholeFileShown(fix), false);
  assert.equal(chosenStretch(fix, null), 1, 'BEFUND opens at the stretch shown');
  assert.equal(placesText(fix, t), '1 erkannter Ort, ein Abschnitt unbestimmt');
  assert.equal(placesText(slimFix(fix), t), '1 erkannter Ort, ein Abschnitt unbestimmt', 'the list says the same from the compact form');
});

test('one place: below a fifth of the recording the whole file stays above, with its time and spaces; the stretches are the timeline', () => {
  // The world tour of the holdout check: a 12-s bridge in Korea in 96 s of seven places.
  const segments = [seg(0, 60, null, null, { windows: 4 }), seg(60, 72, { ...YEOSU }, 1), seg(72, 96, null, null, { windows: 2 })];
  const v = segmentVerdict(segments, MEDINA, { gps: false });
  assert.equal(v.multi, true);
  assert.equal(v.lead, null);
  assert.equal(v.replaced, false);
  assert.equal(v.location, MEDINA);
  const e = v.evidence[0]!;
  assert.equal(e.weight, 0, 'the entry explains, it does not decide');
  assert.equal(e.frame, undefined, 'no stretch is named as the fix\'s');
  assert.equal(e.refLat, undefined);
  assert.equal(e.label, 'Die Aufnahme zeigt einen erkannten Ort; 2 Abschnitte unbestimmt');
  assert.equal(e.labelEn, 'The recording shows one recognised place; 2 segments undetermined');
  assert.match(e.detail, /2 Abschnitte bleiben unbestimmt; sie können einen anderen Ort zeigen\./);
  assert.match(e.detail, /Der Abschnitt mit Ort \(1:00–1:12: Yi-Sun-sin-Brücke, Yeosu\) umfasst nur 13 % der Aufnahme, weniger als die 20 %, ab denen ein Ort oben steht\./);
  assert.match(e.detail, /Ort, Uhrzeit und Räume oben sind die der ganzen Datei, deren Bilder auch die unbestimmten Abschnitte einschließen; der Abschnitt mit Ort hat in der Zeitleiste unter dem Video seine eigene Uhrzeit\.$/);
  assert.match(e.detailEn ?? '', /The segment with a place \(1:00–1:12: Yi Sun-sin Bridge, Yeosu\) covers only 13% of the recording, less than the 20% from which a place is shown above\./);
  assert.match(e.detailEn ?? '', /in the timeline under the video the segment with a place has its own time\.$/);
  assert.deepEqual(v.note, {
    de: '1 erkannter Ort in 3 Abschnitten (2 unbestimmt); oben die ganze Datei: der Ort umfasst nur 13 % (unter 20 %)',
    en: '1 recognised place in 3 segments (2 undetermined); the whole file stays above: the place covers only 13% (below 20%)',
  });

  // The share decides, at the threshold included; the parameter moves it.
  assert.equal(DEFAULT_SEGMENT_PARAMS.leadShare, 0.2);
  assert.equal(segmentVerdict(segments, MEDINA, { gps: false, leadShare: 0.1 }).lead, 1);
  assert.equal(segmentVerdict([seg(0, 48, null, null), seg(48, 60, YEOSU, 1)], MEDINA, { gps: false }).lead, 1, '12 of 60 s: exactly a fifth');
  assert.equal(segmentVerdict([seg(0, 49, null, null), seg(49, 60, YEOSU, 1)], MEDINA, { gps: false }).lead, null, '11 of 60 s');
  // A place the recording comes back to counts with all its stretches.
  const back = [seg(0, 6, YEOSU, 1), seg(6, 40, null, null), seg(40, 46, YEOSU, 1), seg(46, 60, null, null)];
  const both = segmentVerdict(back, MEDINA, { gps: false });
  assert.equal(both.lead, 0, '12 of 60 s over two stretches');
  assert.match(both.evidence[0]!.detail, /Antworten näher als 25 km beieinander zählen als ein Ort\./, 'with two stretches of the place, how one place is told');
  assert.match(both.evidence[0]!.detail, /die Abschnitte mit Ort umfassen zusammen 20 % der Aufnahme/);
  assert.match(both.evidence[0]!.detail, /Oben steht der sicherste der gleich langen längsten Abschnitte mit Ort, 0:00–0:06/);

  // The list has no lead; the console shows the whole file's place, opens at the start and
  // offers each stretch its own clock and space.
  const keyframes: Keyframe[] = [10, 50, 90].map((s) => ({ frame: s + 1, time: s, imageUrl: `k${s}`, spaceUrl: `space/${s}`, skyline: null, pitchDeg: 2 }));
  const timed = segments.map((s) => (s.location ? { ...s, time: { ...TIME, timezone: 'Asia/Seoul' }, sun: null, keyframe: { ...s.keyframe, spaceUrl: 'space/own', pitchDeg: 1 } } : s));
  const fix = fixWith(timed, v.evidence, v.location, keyframes);
  assert.equal(slimFix(fix).segmentSummary?.lead, undefined);
  assert.deepEqual(segmentSummary(fix), summariseSegments(timed, null), 'the same compact form as the server\'s');
  assert.equal(leadSegment(fix), -1);
  assert.equal(wholeFileShown(fix), true);
  assert.equal(chosenStretch(fix, null), 0);
  assert.equal(chosenStretch(fix, { videoId: 'v', computedAt: 7, index: 1 }), 1);
  assert.equal(placesText(fix, t), '1 erkannter Ort, 2 Abschnitte unbestimmt');
  assert.equal(timelinePlacesText(1, true, t), '1 erkannter Ort', 'never "mindestens 1 Orte"');
  assert.equal(timelinePlacesText(3, true, t), 'mindestens 3 Orte');
  assert.equal(timelinePlacesText(2, false, t), '2 Orte');
  assert.equal(stretchClock(fix, 1)?.own, true, 'the located stretch has its own time');
  assert.equal(stretchClock(fix, 1)?.time.timezone, 'Asia/Seoul');
  assert.equal(stretchClock(fix, 0), null, 'an undetermined stretch has no clock');
  assert.deepEqual(stretchSpaces(fix, 1), { fix: false, spaces: [{ frame: 62, imageUrl: 'f60', spaceUrl: 'space/own', pitchDeg: 1 }] });
  // The whole file's spaces are spread over the recording: each undetermined stretch offers its own frames of them.
  assert.deepEqual(
    stretchSpaces(fix, 0).spaces.map((k) => k.frame),
    [11, 51],
  );
  assert.equal(stretchSpaces(fix, 0).fix, true);
  assert.deepEqual(
    stretchSpaces(fix, 2).spaces.map((k) => k.frame),
    [91],
  );
});

test('one place at the place the whole file\'s world model rejected: the whole file stays above, said why', () => {
  // The holdout three-places compilation: Kyffhäuser taken for Bryn Eglwys over 33 s, the gallery's
  // answer for the whole file that its world model turned down.
  const segments = [seg(0, 33, BRYN, 1, { windows: 3 }), seg(33, 120, null, null, { windows: 5, coarse: [{ startSec: 40, endSec: 80, lat: 56, lon: -4, radiusKm: 1500, label: 'Nordeuropa oder Westeuropa', labelEn: 'Northern Europe or Western Europe' }] })];
  const rejected = loc(53.05, -3.1, { radiusKm: 1469 });
  const v = segmentVerdict(segments, UK, { gps: false, rejected });
  assert.equal(v.multi, true);
  assert.equal(v.lead, null);
  assert.equal(v.location, UK);
  assert.equal(v.evidence[0]!.weight, 0);
  assert.equal(v.evidence[0]!.frame, undefined);
  assert.match(v.evidence[0]!.detail, /Der Abschnitt mit Ort \(0:00–0:33: Bryn Eglwys, Chester\) nennt den Ort, den das Weltmodell für die ganze Datei schon verworfen hat; er bleibt in der Zeitleiste, steht aber nicht oben\./);
  assert.match(v.evidence[0]!.detailEn ?? '', /The segment with a place \(0:00–0:33: Bryn Eglwys, Chester\) names the place the world model already rejected for the whole file/);
  assert.match(v.evidence[0]!.detail, /Für ihn nennt die Zeitleiste eine grobe Region/);
  assert.equal(v.note.de, '1 erkannter Ort in 2 Abschnitten (1 unbestimmt); oben die ganze Datei: der Ort ist der verworfene');
  // Without the rejection the stretch (27.5 % of the recording) would lead.
  assert.equal(segmentVerdict(segments, UK, { gps: false }).lead, 0);

  // A place the world model joined from answers far apart, its longest stretch at the rejected
  // place: the remaining one shows, and the passed one is said.
  const joined = [seg(0, 30, BRYN, 1, { joined: true }), seg(30, 60, null, null), seg(60, 80, KOELN, 1, { joined: true }), seg(80, 100, null, null)];
  const w = segmentVerdict(joined, UK, { gps: false, rejected });
  assert.equal(w.lead, 2);
  assert.equal(w.location, KOELN);
  assert.match(w.evidence[0]!.detail, /Ein Ort fasst Antworten zusammen, die weiter auseinanderliegen/);
  assert.match(w.evidence[0]!.detail, / Der längste Abschnitt mit Ort \(0:00–0:30: Bryn Eglwys, Chester\) nennt den Ort, den das Weltmodell für die ganze Datei schon verworfen hat/);
  assert.match(w.evidence[0]!.detail, /Oben steht der längste übrige Abschnitt mit Ort, 1:00–1:20: Zoobrücke, Köln/);
  // The share is that of the stretches that may lead: Köln's 20 of 100 s, not 50 with Bryn Eglwys.
  assert.match(w.evidence[0]!.detail, /; ohne den Abschnitt an dem Ort, den das Weltmodell für die ganze Datei verworfen hat, umfasst der Ort 20 % der Aufnahme \(ab 20 % steht ein Ort oben\)\./);
  assert.match(w.evidence[0]!.detailEn ?? '', /; without the segment at the place the world model rejected for the whole file, the place covers 20% of the recording \(a place is shown above from 20% on\)\./);
  assert.match(w.note.de, /; oben 1:00–1:20, ersetzt die Ortung der ganzen Datei, nicht 0:00–0:30 \(verworfen\)$/);
});

test('one place: a clip of one window stays as it was; the Leverkusen clip of two windows shows its located one', () => {
  for (const one of [[seg(0, 12, KOELN, 1)], [seg(0, 12, null, null)]]) {
    const v = segmentVerdict(one, GALLILEO, { gps: false });
    assert.equal(v.multi, false);
    assert.equal(v.location, GALLILEO);
    assert.deepEqual(v.evidence, []);
    assert.deepEqual(v.note, { de: 'ein Abschnitt', en: 'one segment' });
  }
  // datum-004: 0:00–0:05 Zoobrücke (9 km from the true Rheinbrücke Leverkusen), 0:05–0:12
  // undetermined; the whole file said Deutschherrnbrücke, Frankfurt (160 km off).
  const frankfurt = loc(50.1074, 8.6902, { confidence: 0.891, label: 'Deutschherrnbrücke, Frankfurt', country: 'DE' });
  const segments = [seg(0, 5, KOELN, 1), seg(5, 12, null, null)];
  const v = segmentVerdict(segments, frankfurt, { gps: false });
  assert.equal(v.lead, 0);
  assert.equal(v.location, KOELN);
  assert.equal(v.evidence[0]!.detail.startsWith('Abschnittsweise geortet: 2 Abschnitte, einer davon mit Ort, ein erkannter Ort. Ein Abschnitt bleibt unbestimmt; er kann einen anderen Ort zeigen. Oben steht der Abschnitt mit Ort, 0:00–0:05'), true);
  assert.match(v.evidence[0]!.detail, /der Abschnitt umfasst 42 % der Aufnahme/);
  // Where the whole file agrees with the stretch, it stays (and the entry weighs less).
  const near = loc(KOELN.lat + 0.1, KOELN.lon, { label: 'Köln' });
  const kept = segmentVerdict(segments, near, { gps: false });
  assert.equal(kept.location, near);
  assert.equal(kept.replaced, false);
  assert.equal(kept.evidence[0]!.weight, 0.5);
  assert.match(kept.evidence[0]!.detail, /Die Ortung aus der ganzen Datei stimmt mit ihm überein und bleibt\./);
  assert.match(kept.note.de, /; oben 0:00–0:05$/);
});

test('GPS in the file: one place and undetermined stretches stay without a timeline; several places get the entry without weight as before', () => {
  const gps = loc(50.36, 7.59, { method: 'metadata', radiusKm: 0.05, label: 'GPS' });
  // The pictures' place at the position: nothing to say beyond the trace note.
  const atGps = loc(50.36 + 0.1, 7.59, { label: 'Deutsches Eck, Koblenz' });
  const v = segmentVerdict([seg(0, 36, null, null), seg(36, 48, atGps, 1)], gps, { gps: true });
  assert.equal(v.multi, false);
  assert.equal(v.location, gps);
  assert.equal(v.replaced, false);
  assert.deepEqual(v.evidence, []);
  assert.deepEqual(v.note, { de: '2 Abschnitte, ein Ort (1 unbestimmt), GPS der Datei gilt', en: "2 segments, one place (1 undetermined), the file's GPS stands" });
  const several = segmentVerdict([seg(0, 30, KOELN, 1), seg(30, 60, YEOSU, 2)], gps, { gps: true });
  assert.equal(several.multi, false);
  assert.equal(several.location, gps);
  assert.equal(several.evidence[0]!.weight, 0);
  assert.equal(several.evidence[0]!.label, 'Die Bilder zeigen 2 verschiedene Orte');
});

test('GPS in the file: one place in the pictures away from the position gets an entry without weight that says where and how far', () => {
  const gps = loc(50.36, 7.59, { method: 'metadata', radiusKm: 0.05, label: 'GPS' });
  // Stadt-Land with a GPS tag for Koblenz: the Elstertalbrücke is 325 km away.
  const v = segmentVerdict([seg(0, 36, null, null), seg(36, 48, ELSTERTAL, 1)], gps, { gps: true });
  assert.equal(v.multi, false);
  assert.equal(v.location, gps);
  assert.equal(v.replaced, false);
  assert.equal(v.lead, null);
  assert.equal(v.evidence.length, 1);
  const e = v.evidence[0]!;
  assert.equal(e.kind, 'segments');
  assert.equal(e.weight, 0);
  // No frame: the fix carries no stretches, and a frame would name one as the fix's.
  assert.equal(e.frame, undefined);
  assert.equal(e.label, 'Die Bilder zeigen einen Ort 325 km von der GPS-Angabe');
  assert.equal(e.labelEn, 'The pictures show a place 325 km from the GPS position');
  assert.match(e.detail, /^Abschnittsweise geortet zeigen die Bilder im Abschnitt 0:36–0:48 Elstertalbrücke, Hof \(± 7\.500 km, Sicherheit 87 %\), 325 km von der GPS-Angabe der Datei\. Antworten näher als 25 km beieinander zählen als ein Ort\. Die GPS-Angabe gilt für die ganze Datei und bestimmt den Ort;/);
  assert.match(e.detailEn ?? '', /^Located segment by segment, the pictures show in the segment 0:36–0:48 Elster Viaduct, Hof \(± 7,500 km, confidence 87%\), 325 km from the GPS position in the file\. Answers closer than 25 km count as one place\./);
  assert.deepEqual(v.note, {
    de: '2 Abschnitte, ein Ort (1 unbestimmt), GPS der Datei gilt; der Ort der Bilder liegt 325 km davon',
    en: "2 segments, one place (1 undetermined), the file's GPS stands; the pictures' place lies 325 km from it",
  });

  // The place in two stretches: the longest is named, with the count.
  const two = segmentVerdict([seg(0, 10, ELSTERTAL, 1), seg(10, 30, null, null), seg(30, 50, { ...ELSTERTAL, confidence: 0.8 }, 1)], gps, { gps: true });
  assert.match(two.evidence[0]!.detail, /zeigen die Bilder in 2 Abschnitten \(am längsten 0:30–0:50\) Elstertalbrücke, Hof \(± 7\.500 km, Sicherheit 80 %\)/);
  assert.match(two.evidence[0]!.detailEn ?? '', /the pictures show in 2 segments \(longest 0:30–0:50\) Elster Viaduct, Hof/);

  // A recording of one stretch: the same entry, without a stretch to name.
  const one = segmentVerdict([seg(0, 12, ELSTERTAL, 1)], gps, { gps: true });
  assert.equal(one.multi, false);
  assert.equal(one.location, gps);
  assert.equal(one.evidence.length, 1);
  assert.match(one.evidence[0]!.detail, /^Abschnittsweise geortet zeigen die Bilder Elstertalbrücke, Hof \(/);
  assert.deepEqual(one.note, { de: 'ein Abschnitt, GPS der Datei gilt; der Ort der Bilder liegt 325 km davon', en: "one segment, the file's GPS stands; the pictures' place lies 325 km from it" });
  // ...and at the position, nothing.
  const oneAt = segmentVerdict([seg(0, 12, loc(50.36, 7.6, { label: 'Koblenz' }), 1)], gps, { gps: true });
  assert.deepEqual(oneAt.evidence, []);
  assert.deepEqual(oneAt.note, { de: 'ein Abschnitt, GPS der Datei gilt', en: "one segment, the file's GPS stands" });

  // The rule is the one places are told apart by (sameKm): 20 km away is the same place, 30 km another.
  const near = segmentVerdict([seg(0, 12, null, null), seg(12, 24, loc(50.36 + 20 / 111.2, 7.59, { label: 'N20' }), 1)], gps, { gps: true });
  assert.deepEqual(near.evidence, []);
  const far = segmentVerdict([seg(0, 12, null, null), seg(12, 24, loc(50.36 + 30 / 111.2, 7.59, { label: 'N30' }), 1)], gps, { gps: true });
  assert.equal(far.evidence.length, 1);
  assert.equal(far.evidence[0]!.label, 'Die Bilder zeigen einen Ort 30 km von der GPS-Angabe');

  // Without GPS nothing of this: one place and an undetermined stretch get the timeline (engine 12).
  const noGps = segmentVerdict([seg(0, 36, null, null), seg(36, 48, ELSTERTAL, 1)], GALLILEO, { gps: false });
  assert.equal(noGps.multi, true);
  assert.doesNotMatch(noGps.evidence[0]!.label, /GPS/);
});

test('several places: the verdict reads as in engine 11, word for word', () => {
  const segments = [
    seg(0, 30, loc(48.8584, 2.2945, { radiusKm: 3, label: 'Eiffelturm, Paris', labelEn: 'Eiffel Tower, Paris' }), 1),
    seg(30, 40, null, null),
    seg(40, 80, loc(52.5163, 13.3777, { radiusKm: 3, confidence: 0.86, label: 'Brandenburger Tor, Berlin', labelEn: 'Brandenburg Gate, Berlin' }), 2),
  ];
  const v = segmentVerdict(segments, null, { gps: false });
  assert.equal(v.multi, true);
  assert.equal(v.places, 2);
  assert.equal(v.lead, 2);
  assert.equal(v.replaced, true);
  assert.deepEqual(v.evidence, [
    {
      kind: 'segments',
      label: 'Die Aufnahme zeigt mindestens 2 Orte; oben der Abschnitt 0:40–1:20',
      labelEn: 'The recording shows at least 2 places; shown above: segment 0:40–1:20',
      detail:
        'Abschnittsweise geortet: 3 Abschnitte, 2 davon mit Ort, mindestens 2 verschiedene Orte. Antworten näher als 25 km beieinander zählen als ein Ort. Oben steht der längste Abschnitt mit Ort, 0:40–1:20: Brandenburger Tor, Berlin, ± 3 km, Sicherheit 86 %. Er ersetzt die Ortung aus der ganzen Datei, die die Orte vermischt. 1 Abschnitt bleibt unbestimmt. Die Zeitleiste unter dem Video zeigt jeden Abschnitt.',
      detailEn:
        'Located segment by segment: 3 segments, 2 of them with a place, at least 2 different places. Answers closer than 25 km count as one place. Shown above is the longest segment with a place, 0:40–1:20: Brandenburg Gate, Berlin, ± 3 km, confidence 86%. It replaces the fix from the whole file, which mixes the places. 1 segment remains undetermined. The timeline under the video shows every segment.',
      weight: 0.9,
      frame: 42,
      refLabel: 'Brandenburger Tor, Berlin',
      refLabelEn: 'Brandenburg Gate, Berlin',
      refLat: 52.5163,
      refLon: 13.3777,
    },
  ]);
  assert.deepEqual(v.note, {
    de: 'mindestens 2 Orte in 3 Abschnitten; oben 0:40–1:20, ersetzt die Ortung der ganzen Datei',
    en: 'at least 2 places in 3 segments; shown 0:40–1:20, replaces the fix of the whole file',
  });
  // Countries stay shares of the located time with several places.
  const countries = segmentCountries(
    segments.map((s) => (s.location ? { ...s, location: { ...s.location, country: s.place === 1 ? 'FR' : 'DE' } } : s)),
    2,
  );
  assert.deepEqual(
    countries.map((c) => [c.iso, c.p]),
    [
      ['DE', 40 / 70],
      ['FR', 30 / 70],
    ],
  );
  assert.equal(placesText(fixWith(segments, v.evidence, v.location), t), 'mindestens 2 Orte');
});

test('the whole file\'s entries of one place say what its pictures include; handed to map they stay those of several places', () => {
  const landmark: Evidence = { kind: 'landmark', label: 'Referenzbild: Gallileo, Frankfurt (0,79)', detail: '… 1 km vom Ergebnis.', detailEn: '… 1 km from the result.', weight: 0.4 };
  const sun: Evidence = { kind: 'sun', label: 'Sonnenhöhe 10–40°', labelEn: 'Sun elevation 10–40°', detail: 'd', detailEn: 'd', weight: 0.3 };
  const l = wholeFileEvidence(landmark, 'undetermined');
  assert.equal(l.label, 'Ganze Datei (gemischt): Referenzbild: Gallileo, Frankfurt (0,79)');
  assert.equal(l.weight, 0);
  assert.equal(l.detail, 'Aus der Ortung der ganzen Datei, deren Bilder auch die unbestimmten Abschnitte einschließen; „Ergebnis“ ist hier deren Antwort, nicht der oben gezeigte Ort. … 1 km vom Ergebnis.');
  assert.equal(l.detailEn, 'From the fix of the whole file, whose pictures include the undetermined segments too; "result" here is its answer, not the place shown above. … 1 km from the result.');
  const s = wholeFileTimeEvidence(sun, 'undetermined');
  assert.equal(s.detail, 'Aus Bildern der ganzen Datei, die auch die unbestimmten Abschnitte einschließen; die Uhrzeit oben ist die des gezeigten Abschnitts. d');
  assert.equal(s.detailEn, 'From frames of the whole file, which include the undetermined segments too; the time shown above is that of the segment shown. d');
  assert.equal(s.weight, 0);
  const [own, whole] = multiPlaceTimeEvidence([sun], [sun], '0:36–0:48', 'undetermined');
  assert.equal(own!.label, 'Sonnenhöhe 10–40° (Abschnitt 0:36–0:48)');
  assert.equal(whole!.detail, s.detail);
  // Array.map hands an index as the second argument: it is not taken for a kind of mix.
  assert.match([landmark].map(wholeFileEvidence)[0]!.detail, /^Aus der Ortung der ganzen Datei, deren Bilder mehrere Orte vermischen;/);
  assert.match([sun].map(wholeFileTimeEvidence)[0]!.detail, /^Aus Bildern der ganzen Datei, die mehrere Orte vermischen;/);
  assert.match(multiPlaceTimeEvidence([sun], [sun], '0:36–0:48')[1]!.detail, /die mehrere Orte vermischen/);
});

test('trace lines: one stretch timed on its own and one space read in the singular; a fix that shows no stretch has no "besides the one shown"', () => {
  assert.deepEqual(stretchTimesNote(1), { de: '1 Abschnitt mit Ort für sich', en: '1 segment with a place on its own' });
  assert.deepEqual(stretchTimesNote(32), { de: '32 Abschnitte mit Ort je für sich', en: '32 segments with a place each on its own' });
  assert.deepEqual(stretchSpacesNote(1, 1, 1, 400, false), { de: '1 weiterer Raum für 1 Abschnitt mit Ort, 0,4 s', en: '1 more space for 1 segment with a place, 0.4 s' });
  assert.equal(stretchSpacesNote(12, 14, 12, 4100, false).de, '12 weitere Räume für 14 Abschnitte mit Ort (die 12 längsten), 4,1 s');
  assert.equal(stretchSpacesNote(12, 14, 12, 4100).de, '12 weitere Räume für 14 Abschnitte mit Ort (die 12 längsten außer dem gezeigten), 4,1 s');
  assert.equal(stretchSpacesNote(12, 13, 12, 4100).de, '12 weitere Räume für 13 Abschnitte mit Ort, 4,1 s');
  // Stadt-Land: the one stretch with a place is the one shown, whose spaces are the fix's.
  assert.deepEqual(stretchSpacesNote(0, 1, 0, 0), { de: 'keine weiteren: der einzige Abschnitt mit Ort ist der gezeigte', en: 'none more: the only segment with a place is the one shown' });
});

test('one place: the share counts only the stretches that may lead, not those at the rejected place', () => {
  const rejected = loc(53.05, -3.1, { radiusKm: 1469 });
  // 40 s at the rejected place and 3 s of Köln in 100 s: 43 % of the recording has the place, but
  // the 3 s that could lead are 3 %; they must not stand for the recording.
  const joined = [seg(0, 40, BRYN, 1, { joined: true }), seg(40, 97, null, null), seg(97, 100, KOELN, 1, { joined: true })];
  const v = segmentVerdict(joined, UK, { gps: false, rejected });
  assert.equal(v.lead, null);
  assert.equal(v.replaced, false);
  assert.equal(v.location, UK);
  assert.equal(v.evidence[0]!.weight, 0);
  assert.equal(v.evidence[0]!.frame, undefined);
  assert.match(v.evidence[0]!.detail, / Ohne den Abschnitt an dem Ort, den das Weltmodell für die ganze Datei verworfen hat, umfasst der Ort nur 3 % der Aufnahme, weniger als die 20 %, ab denen ein Ort oben steht\. /);
  assert.match(v.evidence[0]!.detailEn ?? '', / Without the segment at the place the world model rejected for the whole file, the place covers only 3% of the recording, less than the 20% from which a place is shown above\. /);
  assert.doesNotMatch(v.evidence[0]!.detail, /43 %/);
  // One stretch at the rejected place: the trace line says it in the singular, as the entry does.
  assert.deepEqual(v.note, {
    de: '1 erkannter Ort in 3 Abschnitten (1 unbestimmt); oben die ganze Datei: der Ort umfasst ohne seinen Abschnitt am verworfenen Ort nur 3 % (unter 20 %)',
    en: '1 recognised place in 3 segments (1 undetermined); the whole file stays above: without its segment at the rejected place it covers only 3% (below 20%)',
  });
  // Without the rejection the 43 % count, and the longest stretch leads.
  assert.equal(segmentVerdict(joined, UK, { gps: false }).lead, 0);
  // A place whose anchors chain in 25-km steps: one stretch at the rejected point, one 30 km away,
  // not joined. The same.
  const chained = [seg(0, 40, loc(rejected.lat, rejected.lon, { label: 'A' }), 1), seg(40, 97, null, null), seg(97, 100, loc(53.05, -2.65, { label: 'B' }), 1)];
  const c = segmentVerdict(chained, UK, { gps: false, rejected });
  assert.equal(c.lead, null);
  assert.equal(c.location, UK);
  // Two stretches at the rejected place are said in the plural.
  const two = [seg(0, 20, BRYN, 1, { joined: true }), seg(20, 50, null, null), seg(50, 70, BRYN, 1, { joined: true }), seg(70, 97, null, null), seg(97, 100, KOELN, 1, { joined: true })];
  const tv = segmentVerdict(two, UK, { gps: false, rejected });
  assert.match(tv.evidence[0]!.detail, / Ohne die 2 Abschnitte an dem Ort, den das Weltmodell für die ganze Datei verworfen hat, umfasst der Ort nur 3 % der Aufnahme/);
  assert.deepEqual(tv.note, {
    de: '1 erkannter Ort in 5 Abschnitten (2 unbestimmt); oben die ganze Datei: der Ort umfasst ohne seine Abschnitte am verworfenen Ort nur 3 % (unter 20 %)',
    en: '1 recognised place in 5 segments (2 undetermined); the whole file stays above: without its segments at the rejected place it covers only 3% (below 20%)',
  });
  // Enough of the place away from the rejected one: it leads, and the entry says what the share is of.
  const enough = [seg(0, 30, KOELN, 1, { joined: true }), seg(30, 60, null, null), seg(60, 70, BRYN, 1, { joined: true }), seg(70, 100, null, null)];
  const e = segmentVerdict(enough, UK, { gps: false, rejected });
  assert.equal(e.lead, 0);
  assert.equal(e.location, KOELN);
  assert.match(e.evidence[0]!.detail, /; ohne den Abschnitt an dem Ort, den das Weltmodell für die ganze Datei verworfen hat, umfasst der Ort 30 % der Aufnahme \(ab 20 % steht ein Ort oben\)\./);
  assert.doesNotMatch(e.evidence[0]!.detail, /Der längste Abschnitt mit Ort/, 'the longest stretch is not the rejected one');
});

test('one place: a share just under the threshold reads below it; a share at it within float error leads', () => {
  // 12 of 60.5 s are 19.8 %: rounded it would read "nur 20 %, weniger als die 20 %".
  const v = segmentVerdict([seg(0, 48.5, null, null), seg(48.5, 60.5, YEOSU, 1)], MEDINA, { gps: false });
  assert.equal(v.lead, null);
  assert.match(v.evidence[0]!.detail, /umfasst nur 19 % der Aufnahme, weniger als die 20 %, ab denen ein Ort oben steht\./);
  assert.match(v.evidence[0]!.detailEn ?? '', /covers only 19% of the recording, less than the 20% from which a place is shown above\./);
  assert.equal(v.note.de, '1 erkannter Ort in 2 Abschnitten (1 unbestimmt); oben die ganze Datei: der Ort umfasst nur 19 % (unter 20 %)');
  assert.equal(v.note.en, '1 recognised place in 2 segments (1 undetermined); the whole file stays above: the place covers only 19% (below 20%)');
  // Shares far from the threshold read as rounded (the world tour's 12.5 %: 13 %).
  assert.match(segmentVerdict([seg(0, 84, null, null), seg(84, 96, YEOSU, 1)], MEDINA, { gps: false }).evidence[0]!.detail, /nur 13 % der Aufnahme/);
  // 7.2 of 36 s are a fifth, though their quotient is 0.19999999999999998.
  assert.ok((36 - 28.8) / 36 < 0.2);
  const at = segmentVerdict([seg(0, 28.8, null, null), seg(28.8, 36, YEOSU, 1)], MEDINA, { gps: false });
  assert.equal(at.lead, 1);
  assert.match(at.evidence[0]!.detail, /der Abschnitt umfasst 20 % der Aufnahme/);
});

test('one place: a stretch there is never reads 0 % of the recording, nor one beside an undetermined stretch 100 %', () => {
  // A 45-minute drive with one 10-s landmark: 0.37 %, which rounds to 0.
  const drive = segmentVerdict([seg(0, 1500, null, null), seg(1500, 1510, KOELN, 1), seg(1510, 2700, null, null)], UK, { gps: false });
  assert.equal(drive.lead, null);
  assert.match(drive.evidence[0]!.detail, /\(25:00–25:10: Zoobrücke, Köln\) umfasst nur 1 % der Aufnahme, weniger als die 20 %/);
  assert.match(drive.evidence[0]!.detailEn ?? '', /covers only 1% of the recording, less than the 20%/);
  assert.doesNotMatch(drive.evidence[0]!.detail, / 0 %/);
  assert.equal(drive.note.de, '1 erkannter Ort in 3 Abschnitten (2 unbestimmt); oben die ganze Datei: der Ort umfasst nur 1 % (unter 20 %)');
  assert.equal(drive.note.en, '1 recognised place in 3 segments (2 undetermined); the whole file stays above: the place covers only 1% (below 20%)');
  // 5 s of 20 minutes: the same.
  assert.match(segmentVerdict([seg(0, 5, KOELN, 1), seg(5, 1200, null, null)], UK, { gps: false }).evidence[0]!.detail, /umfasst nur 1 % der Aufnahme/);
  // A 20-minute walk whose last 4 s stay undetermined: 99.7 %, which rounds to 100.
  const walk = segmentVerdict([seg(0, 1196, KOELN, 1), seg(1196, 1200, null, null)], UK, { gps: false });
  assert.equal(walk.lead, 0);
  assert.match(walk.evidence[0]!.detail, /; der Abschnitt umfasst 99 % der Aufnahme \(ab 20 % steht ein Ort oben\)\./);
  assert.match(walk.evidence[0]!.detailEn ?? '', /; the segment covers 99% of the recording \(a place is shown above from 20% on\)\./);
  assert.doesNotMatch(walk.evidence[0]!.detail, /100 %/);
  assert.match(segmentVerdict([seg(0, 1000, KOELN, 1), seg(1000, 1004, null, null)], UK, { gps: false }).evidence[0]!.detail, /der Abschnitt umfasst 99 % der Aufnahme/);
});

test('one place that agrees with the whole file keeps the whole file\'s countries; one that replaces it carries its share', () => {
  const de = (l: FixLocation): FixLocation => ({ ...l, country: 'DE', countryName: 'Deutschland' });
  // Replaced (Stadt-Land): the place's share of the whole recording.
  const stadtLand = [seg(0, 36, null, null), seg(36, 48, ELSTERTAL, 1)];
  const replaced = segmentVerdict(stadtLand, GALLILEO, { gps: false });
  assert.deepEqual(verdictCountries(replaced, stadtLand), [{ iso: 'DE', name: 'Deutschland', p: 0.25 }]);
  // Agrees: the fix keeps the whole file's place, candidates and weighted evidence, the country
  // estimate among them; a second figure for the same country would contradict it.
  const paris = loc(48.8584, 2.2945, { radiusKm: 3, label: 'Eiffelturm, Paris', country: 'FR', countryName: 'Frankreich' });
  const eiffel = [seg(0, 10, paris, 1), seg(10, 50, null, null), seg(50, 60, paris, 1)];
  const kept = segmentVerdict(eiffel, paris, { gps: false });
  assert.equal(kept.lead, 0);
  assert.equal(kept.replaced, false);
  assert.equal(verdictCountries(kept, eiffel), null);
  // No stretch shown: the whole file's.
  const world = [seg(0, 84, null, null), seg(84, 96, YEOSU, 1)];
  assert.equal(verdictCountries(segmentVerdict(world, MEDINA, { gps: false }), world), null);
  // Several places keep the countries of their stretches even where the whole file agrees (engine 11).
  const several = [seg(0, 30, de(KOELN), 1), seg(30, 60, paris, 2)];
  const agrees = segmentVerdict(several, KOELN, { gps: false });
  assert.equal(agrees.replaced, false);
  assert.deepEqual(
    verdictCountries(agrees, several)?.map((c) => [c.iso, c.p]),
    [
      ['DE', 0.5],
      ['FR', 0.5],
    ],
  );
});

test('console, a fix that shows no stretch: the header\'s time has its dials, every whole-file space can be entered, and the list says whose the place is', () => {
  // Stadt-Land with the threshold above its share: 0:00–0:36 undetermined, 0:36–0:48 Elstertalbrücke
  // with its own time and space; the whole file's keyframes at 0:08, 0:24 and 0:39.
  const segments: FixSegment[] = [
    seg(0, 36, null, null, { windows: 2, coarse: REGIONS }),
    seg(36, 48, ELSTERTAL, 1, { time: { ...TIME, windows: [] }, sun: null, keyframe: { frame: 42, time: 41, imageUrl: 'f42', spaceUrl: 'space/42', pitchDeg: 1 } }),
  ];
  const v = segmentVerdict(segments, GALLILEO, { gps: false, leadShare: 0.3 });
  assert.equal(v.lead, null);
  const keyframes: Keyframe[] = [8, 24, 39].map((s) => ({ frame: s + 1, time: s, imageUrl: `k${s}`, spaceUrl: `space/${s + 1}`, skyline: null, pitchDeg: 2 }));
  const fix = fixWith(segments, v.evidence, v.location, keyframes);
  assert.equal(wholeFileShown(fix), true);

  // BEFUND opens at the undetermined stretch: its dials show the header's time, said to be the
  // whole file's; the located one its own; RAUM's sun for the undetermined one is the same.
  const d0 = dialClock(fix, 0);
  assert.equal(d0?.whole, true);
  assert.equal(d0?.own, false);
  assert.equal(d0?.time, fix.time);
  assert.equal(stretchClock(fix, 0), null, 'it has no time of its own');
  assert.equal(dialClock(fix, 1)?.own, true);
  assert.equal(dialClock(fix, 1)?.whole, false);

  // RAUM: the undetermined stretch offers the whole file's keyframes in it, the located one its own
  // space first and then the whole file's at 0:39; each whole-file space is offered once.
  const u = stretchSpaces(fix, 0);
  assert.deepEqual(
    u.spaces.map((k) => k.frame),
    [9, 25],
  );
  assert.equal(u.fix, true);
  const p = stretchSpaces(fix, 1);
  assert.deepEqual(
    p.spaces.map((k) => k.frame),
    [42, 40],
  );
  assert.equal(p.fix, false, 'it opens on its own space, with its own place and time');
  assert.equal(p.fixFrom, 1);
  assert.deepEqual(
    p.spaces.map((_, i) => spaceOfFix(p, i)),
    [false, true],
  );
  const ofFix = [0, 1].flatMap((i) => {
    const offered = stretchSpaces(fix, i);
    return offered.spaces.filter((_, j) => spaceOfFix(offered, j)).map((k) => k.frame);
  });
  assert.deepEqual(
    ofFix.sort((a, b) => a - b),
    keyframes.map((k) => k.frame),
    'every whole-file space can be entered, once',
  );
  assert.deepEqual(spacedStretches(fix), [0, 1]);

  // An undetermined stretch with none of the whole file's keyframes in it has no place in RAUM.
  const late = fixWith(segments, v.evidence, v.location, [40, 44].map((f) => ({ frame: f, time: f - 1, imageUrl: `k${f}`, spaceUrl: `space/${f}`, skyline: null })));
  assert.deepEqual(stretchSpaces(late, 0), { fix: false, spaces: [] });
  assert.deepEqual(spacedStretches(late), [1]);
  // A whole-file keyframe on the located stretch's own frame is offered once, as the stretch's.
  const same = fixWith(segments, v.evidence, v.location, [{ frame: 42, time: 41, imageUrl: 'k42', spaceUrl: 'space/whole-42', skyline: null }]);
  assert.deepEqual(stretchSpaces(same, 1), { fix: false, spaces: [{ frame: 42, imageUrl: 'f42', spaceUrl: 'space/42', pitchDeg: 1 }] });

  // ORTUNG: the card and the row say that the place is the whole file's, from the full fix and
  // from the list's compact form; the row says the count in the timeline's short words.
  assert.equal(wholeFilePlace(fix), true);
  assert.equal(wholeFilePlace(slimFix(fix)), true);
  assert.equal(placesText(slimFix(fix), t, true), '1 erkannter Ort · 1 unbestimmt');
  assert.equal(placesText(slimFix(fix), t), '1 erkannter Ort, ein Abschnitt unbestimmt');
  // A fix that shows its stretch, several places without `lead` (older summaries) and a fix of one
  // stretch do not.
  const lead = segmentVerdict(segments, GALLILEO, { gps: false });
  const shown = fixWith(segments, lead.evidence, lead.location, keyframes);
  assert.equal(wholeFilePlace(shown), false);
  assert.equal(wholeFilePlace(slimFix(shown)), false);
  const older = { ...slimFix(shown), segmentSummary: { segments: 3, undetermined: 1, places: [...(slimFix(shown).segmentSummary?.places ?? []), { ...slimFix(shown).segmentSummary!.places[0]!, place: 2 }], route: [1, 2] } };
  assert.equal(wholeFilePlace(older), false);
  assert.equal(wholeFilePlace(fixWith([], [], GALLILEO)), false);
  assert.equal(wholeFilePlace(null), false);
  // With the stretch shown, an undetermined stretch has no dial (as in engine 11).
  assert.equal(dialClock(shown, 0), null);
});

test('console, a fix that shows no stretch on a map of the whole globe: its circle and rays lose their labels, nearer they keep them', () => {
  // The end-to-end probe file reise-96s (e2e12/fixes/reise-96s.mp4.json: the world tour without its
  // Busan piece, followed by a 12-s Busan clip, reference pictures in the gallery): the whole file
  // says Medina ± 1 500 km, its one located stretch is Busan, 8 430 km away. BEFUND turns to either
  // and shows the whole globe, where the circle and the 1 500-km rays are some 10 to 28 px long:
  // their labels read "☉ 256°500 KM" over each other and under the MEDINA marker.
  const medina = loc(24.484154, 39.578854, { method: 'worldmodel', confidence: 0.726, label: 'Medina', country: 'SA', countryName: 'Saudi-Arabien' });
  const busan = loc(35.105556, 129.065, { confidence: 0.86, label: 'Busan Harbor Bridge', country: 'KR', countryName: 'Südkorea' });
  const segments = [seg(0, 84, null, null), seg(84, 96, busan, 1)];
  const v = segmentVerdict(segments, medina, { gps: false });
  assert.equal(v.lead, null);
  const fix = fixWith(segments, v.evidence, v.location);
  assert.equal(wholeFileShown(fix), true);
  // The shapes fixShapes (views/Ortung.tsx) draws for the whole file's place.
  const own: MapShape[] = [
    { kind: 'circle', lat: medina.lat, lon: medina.lon, radiusKm: 1500, style: 'dashed', label: '± 1.500 km' },
    { kind: 'ray', lat: medina.lat, lon: medina.lon, azimuthDeg: 255.6, lengthKm: 1500, style: 'strong', label: '☉ 256°', arrow: false },
    { kind: 'ray', lat: medina.lat, lon: medina.lon, azimuthDeg: 75.6, lengthKm: 900, style: 'dotted', label: 'Schatten', arrow: true },
    { kind: 'wedge', lat: medina.lat, lon: medina.lon, azimuthDeg: 120, spreadDeg: 60, lengthKm: 1200, style: 'solid' },
    { kind: 'line', points: [[medina.lat, medina.lon], [40, 30]], style: 'faint' },
  ];
  const unlabelled = own.map((shape) => {
    if (shape.kind !== 'circle' && shape.kind !== 'ray') return shape;
    const { label: _label, ...rest } = shape;
    return rest;
  });
  for (const at of [busan, medina]) {
    assert.ok(stretchMapReach(fix, at) > GLOBE_REACH_KM, 'BEFUND shows the whole globe');
    // The geometry stays, in the same order; only the labels of circle and rays go.
    assert.deepEqual(wholeFileShapes(fix, at, own), unlabelled);
  }
  // The whole file's place counts towards the reach only where the fix shows none of its stretches:
  // with Busan shown the map reaches from it to nothing farther.
  const shown = fixWith(segments, segmentVerdict(segments, medina, { gps: false, leadShare: 0.1 }).evidence, busan);
  assert.equal(wholeFileShown(shown), false);
  assert.equal(stretchMapReach(shown, busan), 0);

  // Stadt-Land with a stricter threshold (fixes12/stadt-land-nolead.json): Frankfurt and the
  // Elstertalbrücke 253 km apart, a near view, the labels stay.
  const near = [seg(0, 36, null, null, { windows: 2, coarse: REGIONS }), seg(36, 48, ELSTERTAL, 1)];
  const nv = segmentVerdict(near, GALLILEO, { gps: false, leadShare: 0.3 });
  const nearFix = fixWith(near, nv.evidence, nv.location);
  assert.equal(wholeFileShown(nearFix), true);
  assert.ok(Math.abs(stretchMapReach(nearFix, ELSTERTAL) - 253) < 5);
  assert.deepEqual(wholeFileShapes(nearFix, ELSTERTAL, own), own);
  assert.deepEqual(wholeFileShapes(nearFix, GALLILEO, own), own);
});
