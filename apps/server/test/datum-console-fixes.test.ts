import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import type { CountryProb, Evidence, Fix, FixCandidate, FixLocation, FixSegment, SunReport, TerrainGrid, TimeEstimate } from '../src/datum/contract.js';
import { englishNames, type LabelEnglish } from '../src/scripts/map/englishNames.js';
import { sunPath, sunState } from '../src/datum/sun.js';
import { segmentCountries } from '../src/datum/segments.js';
import { localToUtc } from '../src/datum/timezones.js';
// The console's pure helpers (their imports are types, pure modules and React's hooks only).
import { fmtElev, instantOfMinute, rivalWindow, sunInWindow } from '../../web/src/datum/panel/common.tsx';
import { groupEvidence } from '../../web/src/datum/panel/evidenceOrder.ts';
import { terrainContours, terrainSource } from '../../web/src/datum/contours.ts';
import { countryListOf, countryRows, routeFrame } from '../../web/src/datum/segments.ts';
import { firstCandidateIsFix, fixMapView, RESULT_CARD_PX, rivalText, routeMapView, windowLabelText, windowsText, zoomForRadius } from '../../web/src/datum/useFixes.ts';
import { project, worldSize } from '../../web/src/map/geo.ts';
import { makeGlobe, projectGlobe, unprojectGlobe } from '../../web/src/map/globe.ts';
import { placeNameEn, riverNameEn, tileNameEn } from '../../web/src/map/placeNames.ts';
import { flatInsetCentre, globeInsetPoint, overlayLayout, placeLabelText, reachZoom, riverLabelText, type MapMarker, type MapShape } from '../../web/src/map/MapCanvas.tsx';

/**
 * Findings of the acceptances of engines 13 and 14 that the console fixes, through its pure parts:
 * the map of BEFUND on the fix (not on the pictures' first candidate), the even split of morning
 * and afternoon (and its sun on the days the clocks change), the order of the evidence, the
 * countries of a recording of stretches, the English names of the map and the text the base map
 * writes with them, the coarse terrain, the frame of a route and the view that puts it left of
 * the result card, and the layout of the map's labels.
 */

const GLOBE_KM = 2500;
const t = (de: string, vars?: Record<string, string | number>): string => de.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? `{${k}}`));

function loc(lat: number, lon: number, radiusKm: number, method: FixLocation['method']): FixLocation {
  return { lat, lon, radiusKm, confidence: 0.9, method, label: `${lat},${lon}`, country: null, countryName: null };
}

function cand(lat: number, lon: number, radiusKm: number, label = 'c'): FixCandidate {
  return { lat, lon, radiusKm, label, country: null, score: 0.5 };
}

test('BEFUND map: the fix with its circle, not the first candidate (GPS file, single clips)', () => {
  // stadt-land-gps: Cork from the file's GPS, the pictures' first candidate in Frankfurt.
  const gps = { location: loc(51.8967, -8.4634, 0.05, 'metadata'), candidates: [cand(50.1107, 8.6729, 0.93, 'Gallileo, Frankfurt'), cand(51.849, -8.3005, 25)] };
  assert.equal(firstCandidateIsFix(gps), false);
  const view = fixMapView(gps, -1, GLOBE_KM);
  assert.deepEqual([view?.lat, view?.lon], [51.8967, -8.4634]);
  // Chosen in the list, a candidate turns the map to itself.
  assert.equal(fixMapView(gps, 0, GLOBE_KM)?.lat, 50.1107);
  // A GPS file whose pictures agree: candidate 01 (the Eiffel Tower) 15 m from the position is
  // still the pictures' answer, no mark of the place, and choosing it turns the map to it.
  const agreeing = { location: loc(48.8584, 2.2945, 0.05, 'metadata'), candidates: [cand(48.8583, 2.2944, 0.5, 'Eiffelturm')] };
  assert.equal(firstCandidateIsFix(agreeing), false);
  assert.deepEqual([fixMapView(agreeing, 0, GLOBE_KM)?.lat, fixMapView(agreeing, 0, GLOBE_KM)?.lon], [48.8583, 2.2944]);
  // The same geometry from the pictures: candidate 01 is the place.
  assert.equal(firstCandidateIsFix({ ...agreeing, location: loc(48.8584, 2.2945, 0.5, 'landmark') }), true);
  // datum-007: fix ± 1 500 km, candidate 01 at the same point ± 0.58 km: the map shows the circle
  // (about zoom 2.9), not a street map of 2 km.
  const d007 = { location: loc(50.6, 12.2, 1500, 'landmark'), candidates: [cand(50.6, 12.2, 0.583)] };
  assert.equal(firstCandidateIsFix(d007), true);
  const z007 = fixMapView(d007, -1, GLOBE_KM)?.zoom ?? 99;
  assert.ok(Math.abs(z007 - (zoomForRadius(1500, 50.6) - 0.6)) < 1e-9 && z007 < 4, `zoom ${z007}`);
  // ± 3 km (datum-021): its radius, not candidate 01's ± 0.5 km.
  assert.ok(Math.abs((fixMapView({ location: loc(56.876, -5.432, 3, 'landmark'), candidates: [cand(56.876, -5.432, 0.5)] }, -1, GLOBE_KM)?.zoom ?? 0) - (zoomForRadius(3, 56.876) - 0.6)) < 1e-9);
  // ± 7 500 km: the whole globe.
  assert.equal(fixMapView({ location: loc(0, 0, 7500, 'region'), candidates: [] }, -1, GLOBE_KM)?.zoom, 1.4);
  assert.equal(fixMapView({ location: null, candidates: [] }, -1, GLOBE_KM), null);
});

test('countries of a fix whose stretch shows the place: the shares of the recording time, in the server\'s order', () => {
  const stretch = (startSec: number, endSec: number, country: string, place: number, lat: number, lon: number): FixSegment =>
    ({ startSec, endSec, place, location: { ...loc(lat, lon, 1, 'landmark'), country, countryName: country } }) as unknown as FixSegment;
  // Köln 10 s, Eiffel 15 s, Hof 10 s; the whole file elsewhere: the Eiffel stretch gives the place
  // (the longest), the countries are FR 43 % and DE 57 % of the time, France first.
  const köln = [stretch(0, 10, 'DE', 1, 50.94, 6.96), stretch(10, 25, 'FR', 2, 48.858, 2.294), stretch(25, 35, 'DE', 3, 50.32, 11.92)];
  const shares = segmentCountries(köln, 1);
  assert.deepEqual(shares.map((c) => c.iso), ['FR', 'DE']);
  const b = { location: loc(48.858, 2.294, 1, 'landmark'), segments: köln, countries: shares };
  assert.equal(countryListOf(b), 'shares');
  const rows = countryRows(shares, 'shares', 5, 'FR');
  assert.deepEqual(rows.shown.map((c) => c.iso), ['FR', 'DE'], 'the place\'s country first, as the server orders them');
  assert.equal(rows.apart, false, 'no note that calls 43 % of the time a probability');
  // Eiffel 30 s and the Brandenburg Gate 15 s, the whole file's world-model answer by the Eiffel
  // Tower: the place stays the world model's, the countries are the shares (FR 67 %, DE 33 %).
  const two = [stretch(0, 30, 'FR', 1, 48.858, 2.294), stretch(30, 45, 'DE', 2, 52.516, 13.378)];
  assert.equal(countryListOf({ location: loc(48.86, 2.3, 25, 'worldmodel'), segments: two, countries: segmentCountries(two, 0) }), 'shares');
  // One recognised place and an undetermined stretch: the share is of the whole recording (FR 50 %).
  const stadtLand = [stretch(0, 20, 'FR', 1, 48.858, 2.294), { startSec: 20, endSec: 40, place: null, location: null } as unknown as FixSegment];
  const half = segmentCountries(stadtLand, 0);
  assert.deepEqual(half.map((c) => [c.iso, c.p]), [['FR', 0.5]]);
  assert.equal(countryListOf({ location: loc(48.858, 2.294, 1, 'landmark'), segments: stadtLand, countries: half }), 'shares');
  // A world model's own mass per country, and the probability over the evidence, as before.
  const mass: CountryProb[] = [
    { iso: 'IT', name: 'Italien', p: 0.16 },
    { iso: 'SA', name: 'Saudi-Arabien', p: 0.04 },
    { iso: 'FR', name: 'Frankreich', p: 0.12 },
  ];
  assert.equal(countryListOf({ location: loc(24.46, 39.6, 1500, 'worldmodel'), countries: mass }), 'worldmodel');
  assert.equal(countryListOf({ location: loc(24.46, 39.6, 1500, 'worldmodel'), segments: two, countries: mass }), 'worldmodel');
  assert.equal(countryListOf({ location: loc(48.858, 2.294, 1, 'landmark'), countries: mass }), 'probability');
  const ranked = countryRows(mass, 'worldmodel', 5, 'SA');
  assert.deepEqual(ranked.shown.map((c) => c.iso), ['IT', 'FR', 'SA']);
  assert.equal(ranked.apart, true);
});

function sunTime(windows: TimeEstimate['windows'], timezone = 'Asia/Seoul'): TimeEstimate {
  return { method: 'sun', utc: null, date: '2026-03-20', timezone, windows, light: 'day', sunElevationBand: [15, 35], notes: [], confidence: 0.5 } as unknown as TimeEstimate;
}

test('morning and afternoon as likely: both windows named, the second one\'s sun and shadow from the path', () => {
  // weltreise, Busan: 06:25–10:15 Morgen 0.322, 14:30–18:15 Nachmittag 0.320.
  const even = sunTime([
    { startMin: 385, endMin: 615, label: 'Morgen', probability: 0.322 },
    { startMin: 870, endMin: 1095, label: 'Nachmittag', probability: 0.32 },
  ]);
  assert.equal(rivalWindow(even)?.label, 'Nachmittag');
  assert.equal(rivalText(even), '14:30–18:15');
  assert.equal(windowsText(even, t), '06:25–10:15 oder 14:30–18:15');
  assert.equal(windowLabelText(even, t), 'Morgen · oder 14:30–18:15 (Nachmittag)');
  // Paris: 0.40 / 0.29 is no even split; nor are two windows on one side of noon, nor file time.
  const clear = sunTime([
    { startMin: 400, endMin: 600, label: 'Morgen', probability: 0.4 },
    { startMin: 900, endMin: 1000, label: 'Nachmittag', probability: 0.29 },
  ]);
  assert.equal(rivalWindow(clear), null);
  assert.equal(windowsText(clear, t), '06:40–10:00');
  assert.equal(windowLabelText(clear, t), 'Morgen');
  assert.equal(rivalWindow(sunTime([{ startMin: 400, endMin: 500, label: 'Morgen', probability: 0.4 }, { startMin: 560, endMin: 700, label: 'Vormittag', probability: 0.39 }])), null);
  assert.equal(rivalWindow({ ...even, method: 'metadata' }), null);
  // The afternoon's sun from the day's path at the middle of its window, against the server's sun.
  const lat = 35.105556;
  const lon = 129.065;
  const path = sunPath('2026-03-20', lat, lon, 'Asia/Seoul');
  const sun = { date: '2026-03-20', at: null, path, sunrise: null, sunset: null, solarNoon: null } as unknown as SunReport;
  const other = sunInWindow(sun, 'Asia/Seoul', { startMin: 870, endMin: 1095 });
  assert.ok(other);
  // 16:22 local is 07:22 UTC.
  const truth = sunState(Date.UTC(2026, 2, 20, 7, 22, 30), lat, lon);
  assert.ok(Math.abs(other.azimuthDeg - truth.azimuthDeg) < 1.5, `azimuth ${other.azimuthDeg} vs ${truth.azimuthDeg}`);
  assert.ok(Math.abs(other.elevationDeg - truth.elevationDeg) < 1, `elevation ${other.elevationDeg} vs ${truth.elevationDeg}`);
  assert.ok(Math.abs(((other.shadowAzimuthDeg - other.azimuthDeg + 360) % 360) - 180) < 1e-9);
  // The morning's shadow points west, the afternoon's east: the even split is not one direction.
  assert.ok(other.shadowAzimuthDeg > 40 && other.shadowAzimuthDeg < 110, `shadow ${other.shadowAzimuthDeg}`);
});

test('the second window\'s sun on the days the clocks go forward or back', () => {
  // Berlin, 14:30–18:15 (middle 16:22:30): on 2026-03-29 the path spans 23 hours, on 2026-10-25
  // 25; the sun at 16:22 is not the one of 17:22 (15:22). The days around them, and New York's.
  const cases: [string, number, number, string][] = [
    ['2026-03-28', 52.52, 13.405, 'Europe/Berlin'],
    ['2026-03-29', 52.52, 13.405, 'Europe/Berlin'],
    ['2026-06-21', 52.52, 13.405, 'Europe/Berlin'],
    ['2026-10-25', 52.52, 13.405, 'Europe/Berlin'],
    ['2026-10-26', 52.52, 13.405, 'Europe/Berlin'],
    ['2026-03-08', 40.71, -74.0, 'America/New_York'],
    ['2026-11-01', 40.71, -74.0, 'America/New_York'],
  ];
  for (const [date, lat, lon, zone] of cases) {
    const path = sunPath(date, lat, lon, zone);
    const truth = sunState(localToUtc(date, 982.5, zone), lat, lon);
    const got = sunInWindow({ path }, zone, { startMin: 870, endMin: 1095 });
    assert.ok(got, date);
    assert.ok(Math.abs(got.azimuthDeg - truth.azimuthDeg) < 0.5, `${zone} ${date}: azimuth ${got.azimuthDeg} vs ${truth.azimuthDeg}`);
    assert.ok(Math.abs(got.elevationDeg - truth.elevationDeg) < 0.5, `${zone} ${date}: elevation ${got.elevationDeg} vs ${truth.elevationDeg}`);
    // The polar diagram's clock (window arcs and hour marks) puts its minutes the same way.
    const first = Math.min(...path.map((p) => p.t));
    for (const minute of [7 * 60, 12 * 60, 982.5, 20 * 60]) assert.equal(instantOfMinute(first, zone, minute), localToUtc(date, minute, zone), `${zone} ${date} ${minute}`);
  }
  // The values of the finding: 236.3° / 27.2° on 2026-03-29, 245.2° / 3.3° on 2026-10-25.
  const spring = sunInWindow({ path: sunPath('2026-03-29', 52.52, 13.405, 'Europe/Berlin') }, 'Europe/Berlin', { startMin: 870, endMin: 1095 });
  assert.ok(spring && Math.abs(spring.azimuthDeg - 236.3) < 0.3 && Math.abs(spring.elevationDeg - 27.2) < 0.3, JSON.stringify(spring));
  const autumn = sunInWindow({ path: sunPath('2026-10-25', 52.52, 13.405, 'Europe/Berlin') }, 'Europe/Berlin', { startMin: 870, endMin: 1095 });
  assert.ok(autumn && Math.abs(autumn.azimuthDeg - 245.2) < 0.3 && Math.abs(autumn.elevationDeg - 3.3) < 0.3, JSON.stringify(autumn));
});

test('a sun just above the horizon reads with its decimal, not "0°"', () => {
  assert.equal(fmtElev(0.2887).replace(',', '.'), '+0.3°');
  assert.equal(fmtElev(-0.4).replace(',', '.'), '−0.4°');
  assert.equal(fmtElev(22.4), '22°');
  assert.equal(fmtElev(0.01), '0°');
});

function ev(kind: Evidence['kind'], weight: number): Evidence {
  return { kind, label: kind, detail: '', weight };
}

test('evidence: what decided the place first, then the place, then the time', () => {
  // datum-007, method landmark: sun 0.72, region 0.17, world model 0.17, season 0.15, three
  // reference pictures of 0.02 each, file name 0.05.
  const evidence = [ev('sun', 0.7225), ev('region', 0.1734), ev('worldmodel', 0.173), ev('season', 0.15), ev('landmark', 0.0213), ev('landmark', 0.0196), ev('landmark', 0.0178), ev('filename', 0.05)];
  assert.deepEqual(
    groupEvidence(evidence, 'landmark').map((g) => g.kind),
    ['landmark', 'region', 'worldmodel', 'sun', 'season', 'filename'],
  );
  // A weighed file tag and the stretches' entry still lead; weightless groups go last.
  const gps = [ev('landmark', 0.3), ev('metadata', 0.98), ev('segments', 0), ev('region', 0), ev('sun', 0.5)];
  assert.deepEqual(groupEvidence(gps, 'metadata').map((g) => g.kind), ['metadata', 'segments', 'landmark', 'sun', 'region']);
  // Without the method: place before time, by weight within each.
  assert.deepEqual(groupEvidence([ev('sun', 0.9), ev('worldmodel', 0.2), ev('horizon', 0.35)]).map((g) => g.kind), ['horizon', 'worldmodel', 'sun']);
});

test('English map names: districts, cities, rivers', () => {
  assert.equal(placeNameEn({ name: '8. Arrondissement von Paris' }), '8th Arrondissement');
  assert.equal(placeNameEn({ name: '2. Arrondissement von Lyon' }), '2nd Arrondissement, Lyon');
  assert.equal(placeNameEn({ name: 'Lateinisches Viertel' }), 'Latin Quarter');
  assert.equal(placeNameEn({ name: 'Gablonz an der Neiße' }), 'Jablonec nad Nisou');
  assert.equal(placeNameEn({ name: 'Antwerpen' }), 'Antwerp');
  assert.equal(placeNameEn({ name: 'Köln' }), 'Cologne');
  assert.equal(placeNameEn({ name: 'Frankfurt am Main' }), 'Frankfurt');
  // The tile's own English name first; names alike in both stay.
  assert.equal(placeNameEn({ name: 'Wien', nameEn: 'Vienna (tile)' }), 'Vienna (tile)');
  assert.equal(placeNameEn({ name: 'Koblenz' }), 'Koblenz');
  assert.equal(riverNameEn({ name: 'Themse' }), 'River Thames');
  assert.equal(riverNameEn({ name: 'Donau' }), 'Danube');
  assert.equal(riverNameEn({ name: 'Rhein' }), 'Rhine');
  assert.equal(riverNameEn({ name: 'Mosel', nameEn: 'Moselle' }), 'Moselle');
  assert.equal(riverNameEn({ name: 'Mosel' }), 'Moselle');
  // What the base map writes: in English (the country names loaded) by these names, cities, towns
  // and countries in capitals; in German the tiles' names.
  const english = new Map([['Deutschland', 'Germany']]);
  assert.equal(placeLabelText({ name: '8. Arrondissement von Paris', cls: 'suburb' }, english), '8th Arrondissement');
  assert.equal(placeLabelText({ name: 'Köln', cls: 'city' }, english), 'COLOGNE');
  assert.equal(placeLabelText({ name: 'Deutschland', cls: 'country' }, english), 'GERMANY');
  assert.equal(placeLabelText({ name: 'Gablonz an der Neiße', nameEn: 'Jablonec nad Nisou', cls: 'town' }, english), 'JABLONEC NAD NISOU');
  assert.equal(placeLabelText({ name: 'Köln', cls: 'city' }, null), 'KÖLN');
  assert.equal(placeLabelText({ name: '8. Arrondissement von Paris', cls: 'suburb' }, null), '8. Arrondissement von Paris');
  assert.equal(riverLabelText({ name: 'Themse' }, true), 'River Thames');
  assert.equal(riverLabelText({ name: 'Themse' }, false), 'Themse');
});

test('English map names: a German name of features named differently in English is no name of all of them', async () => {
  // German towns keep their names: one foreign place of the same German name does not rename them
  // (Homburg (Saar) was "HOMBOURG" after the Belgian village, Freudenberg "VESELÉ", the Weser "Vesdre").
  for (const name of ['Homburg', 'Freudenberg', 'Wenden', 'Burscheid', 'Rüdesheim', 'Simmern', 'Hausen', 'Neuhaus', 'Neustadt', 'Falkenburg']) {
    assert.equal(placeNameEn({ name }), name, name);
  }
  assert.equal(riverNameEn({ name: 'Weser' }), 'Weser');
  // The foreign ones by their own labels, as the tiles place them.
  const shipped = async (tile: string): Promise<{ pl?: { n: string; p: [number, number] }[]; ww?: Record<string, { n?: string; l: number[] }[]> }> =>
    JSON.parse(await readFile(new URL(`../../web/public/map/${tile}.json`, import.meta.url), 'utf8'));
  const place = async (tile: string, name: string): Promise<string> => {
    const p = (await shipped(tile)).pl?.find((l) => l.n === name);
    assert.ok(p, `${name} in ${tile}`);
    return placeNameEn({ name, nameEn: tileNameEn('place', tile, name, p.p[0], p.p[1]) });
  };
  assert.equal(await place('8/133/87', 'Homburg'), 'Homburg');
  assert.equal(await place('7/69/41', 'Falkenburg'), 'Złocieniec');
  assert.equal(await place('9/264/171', 'Falkenburg'), 'Valkenburg');
  const rivers = async (tile: string, name: string): Promise<string[]> =>
    Object.values((await shipped(tile)).ww ?? {})
      .flat()
      .filter((w) => w.n === name)
      .map((w) => riverNameEn({ name, nameEn: tileNameEn('river', tile, name, w.l[0] as number, w.l[1] as number) }));
  assert.deepEqual([...new Set(await rivers('8/134/85', 'Weser'))], ['Weser']);
  assert.deepEqual([...new Set(await rivers('9/264/172', 'Weser'))], ['Vesdre']);
});

test('English map names: the table follows each feature, and the pieces of one river', () => {
  const at = (tile: string, de: string, en: string | null, lat: number, lon: number, x = 100, y = 200, says = true): LabelEnglish => ({ tile, x, y, lat, lon, de, en, says });
  const places = englishNames([
    // Homburg (Saar) keeps its name in English; the Belgian village is Hombourg.
    at('8/133/87', 'Homburg', null, 49.32, 7.34),
    at('10/529/344', 'Homburg', 'Hombourg', 50.72, 5.92),
    // A tie decides nothing: each Falkenburg by its own.
    at('7/69/41', 'Falkenburg', 'Złocieniec', 53.53, 16.01),
    at('9/264/171', 'Falkenburg', 'Valkenburg', 50.86, 5.83),
    // All labels of a name agree: by name.
    at('7/63/42', 'Themse', 'River Thames', 51.5, -0.1),
    at('8/127/85', 'Themse', 'River Thames', 51.48, -0.2),
    at('8/133/87', 'Koblenz', null, 50.36, 7.6),
  ]);
  assert.deepEqual([...places.byName], [['Themse', 'River Thames']]);
  assert.deepEqual(
    [...places.byTile].map(([tile, m]) => [tile, [...m]]),
    [
      ['10/529/344', [['Homburg@100,200', 'Hombourg']]],
      ['7/69/41', [['Falkenburg@100,200', 'Złocieniec']]],
      ['9/264/171', [['Falkenburg@100,200', 'Valkenburg']]],
    ],
  );
  // Rivers: the Mosel's pieces with and without their English name, 20 km apart, are one river,
  // named as most of its pieces that name themselves; the Vesdre (German name Weser) 260 km from
  // the Weser is another. A piece with no English name of its own says nothing (the Teltowkanal's
  // shipped pieces: its English name is on pieces of other tiles); one whose English name is the
  // German one says that (the Spree, against the Sorbian "Sprewa"; the Warche on a tie).
  const rivers = englishNames(
    [
      at('9/265/172', 'Mosel', 'Moselle', 50.0, 7.0),
      at('9/265/173', 'Mosel', null, 49.85, 6.9, 100, 200, false),
      at('9/265/173', 'Mosel', 'La Moselle', 49.7, 6.8, 300, 400),
      at('9/265/174', 'Mosel', 'Moselle', 49.6, 6.6),
      at('8/134/85', 'Weser', null, 52.6, 9.1, 100, 200, false),
      at('8/134/84', 'Weser', null, 53.1, 8.8, 100, 200, false),
      at('9/264/172', 'Weser', 'Vesdre', 50.6, 5.9),
      at('12/2199/1345', 'Teltowkanal', null, 52.39, 13.25, 100, 200, false),
      at('12/2199/1344', 'Teltowkanal', null, 52.41, 13.3, 100, 200, false),
      at('11/1100/671', 'Spree', null, 52.52, 13.4),
      at('11/1100/672', 'Spree', null, 52.45, 13.6),
      at('10/529/345', 'Warche', null, 50.42, 6.1),
      at('9/264/172', 'Warche', 'La Warche', 50.43, 6.0),
    ],
    150,
    [
      at('12/2201/1344', 'Teltowkanal', 'Teltow Canal', 52.38, 13.45),
      at('12/2201/1345', 'Teltowkanal', 'Teltow Canal', 52.37, 13.5),
      at('11/1099/671', 'Spree', 'Sprewa', 52.5, 13.3),
      at('12/2198/1342', 'Spree', null, 52.51, 13.35, 0, 0, false),
    ],
  );
  assert.deepEqual([...rivers.byName].sort(), [['Mosel', 'Moselle'], ['Teltowkanal', 'Teltow Canal']]);
  assert.deepEqual([...rivers.byTile].map(([tile, m]) => [tile, [...m]]), [['9/264/172', [['Weser@100,200', 'Vesdre']]]]);
});

function grid(over: Partial<TerrainGrid>): TerrainGrid {
  const size = 5;
  return {
    center: { lat: 24.46, lon: 39.6 },
    bbox: [39.5, 24.4, 39.7, 24.5],
    size,
    heights: Array.from({ length: size * size }, (_, i) => 600 + i * 6),
    minHeight: 600,
    maxHeight: 744,
    cellMetres: 100,
    sourceZoom: 11,
    ...over,
  };
}

test('terrain from the world overview: said coarse, no contour lines', () => {
  assert.equal(terrainSource(grid({ coarse: true, sourceMetres: 8905 })).coarse, true);
  assert.equal(terrainContours(grid({ coarse: true, sourceMetres: 8905 })), null);
  // A node before the flag: the source zoom says it (zoom 4 at 24° is 8.9 km per pixel).
  const old = terrainSource(grid({ sourceZoom: 4 }));
  assert.equal(old.coarse, true);
  assert.ok(old.metres > 8000 && old.metres < 9500, `${old.metres}`);
  assert.equal(terrainContours(grid({ sourceZoom: 4 })), null);
  // Fine sources keep their lines.
  assert.equal(terrainSource(grid({ sourceZoom: 11 })).coarse, false);
  assert.ok(terrainContours(grid({ sourceZoom: 11, coarse: false }))?.lines.length);
});

test('route frame: the middle of the places and the farthest from it', () => {
  // europa-rand: Hottendorf, Elbasan, Moscow.
  const f = routeFrame([
    { lat: 52.528, lon: 11.518 },
    { lat: 41.113, lon: 20.082 },
    { lat: 55.744, lon: 37.598 },
  ]);
  assert.ok(f);
  assert.ok(f.lat > 48 && f.lat < 53 && f.lon > 20 && f.lon < 25, `${f.lat}, ${f.lon}`);
  assert.ok(f.reachKm > 1000 && f.reachKm < 1400, `${f.reachKm}`);
  assert.equal(routeFrame([]), null);
  // Across ±180°: the middle lies on the date line, not at longitude 0.
  const pacific = routeFrame([
    { lat: 0, lon: 179 },
    { lat: 0, lon: -179 },
  ]);
  assert.ok(pacific && Math.abs(Math.abs(pacific.lon) - 180) < 1e-6);
  // ORTUNG shows the route left of the result card: on its globe and on a flat map of 986 × 706 px
  // (1366 × 768), the places lie left of the card and the route's middle in the middle of that area.
  const places = [
    { lat: 52.528, lon: 11.518 },
    { lat: 41.113, lon: 20.082 },
    { lat: 55.744, lon: 37.598 },
  ];
  const view = routeMapView(f, 2.25);
  assert.equal(view.insetRight, RESULT_CARD_PX);
  assert.ok(view.reachKm && view.reachKm > f.reachKm);
  const [width, height] = [986, 706];
  const inset = view.insetRight ?? 0;
  const left = width - inset;
  // The globe turns the point half the card's width east of its middle into the middle.
  const zg = reachZoom(view.reachKm, view.lat, width, height, inset, true, 1, 16);
  const g = makeGlobe(view.lat, view.lon, zg, width, height);
  const turn = globeInsetPoint(width, height, g.r, inset);
  assert.equal(turn.x, width / 2 + Math.min(inset / 2, g.r / 2));
  const c = unprojectGlobe(g, turn.x, turn.y);
  assert.ok(c);
  const shown = makeGlobe(c.lat, c.lon, zg, width, height);
  // (A turn of the sphere, not a shift: the middle lands within a few pixels of it.)
  const middle = projectGlobe(shown, f.lat, f.lon);
  assert.ok(Math.abs(middle.x - left / 2) < 8, `route middle at ${middle.x}, area middle ${left / 2}`);
  for (const p of places) {
    const q = projectGlobe(shown, p.lat, p.lon);
    assert.ok(q.v && q.x > 0 && q.x < left && q.y > 0 && q.y < height, `${p.lat}, ${p.lon} at ${q.x}, ${q.y}`);
  }
  // The flat map moves its centre by half the card's width.
  const zf = reachZoom(view.reachKm, view.lat, width, height, inset, false, 1, 16);
  const centre = flatInsetCentre(view.lat, view.lon, zf, inset);
  const x = (lat: number, lon: number): number => width / 2 + (project(lat, lon).x - centre.x) * worldSize(zf);
  assert.ok(Math.abs(x(view.lat, view.lon) - left / 2) < 1e-6);
  for (const p of places) assert.ok(x(p.lat, p.lon) > 0 && x(p.lat, p.lon) < left, `${p.lat}, ${p.lon} at ${x(p.lat, p.lon)}`);
  // A route around the world: the whole Earth in that area.
  assert.deepEqual(routeMapView({ lat: 10, lon: 60, reachKm: 9000 }, 2.25), { lat: 10, lon: 60, zoom: 2.25, fit: true, insetRight: RESULT_CARD_PX });
});

test('map labels: markers, their labels and the shapes\' labels do not cover each other', () => {
  // A stand-in for the canvas: 6 px per character, as the 9 to 10 px type measures about.
  const ctx = { font: '', letterSpacing: '0px', measureText: (text: string) => ({ width: text.length * 6 }) } as unknown as CanvasRenderingContext2D;
  // Flat screen: 1 degree = 20 px around (500, 300).
  const toScreen = (lat: number, lon: number) => ({ x: 500 + lon * 20, y: 300 - lat * 20, v: true });
  // The share of Germany at its centroid among two recordings' markers right next to it (ORTUNG,
  // europa-rand: "DE 38 %" under the plates of DATUM-004 and DATUM-007), a selected marker and a ray.
  const markers: MapMarker[] = [
    { id: 'a', lat: 0.4, lon: -0.6, shape: 'fix', label: 'DATUM-004' },
    { id: 'b', lat: -0.4, lon: 0.4, shape: 'fix', label: 'DATUM-007' },
    { id: 'c', lat: 3, lon: 3, shape: 'fix', label: 'EUROPA-RAND', sub: '06:25–10:15', selected: true },
  ];
  const shapes: MapShape[] = [
    { kind: 'area', rings: [], opacity: 1, label: 'DE 38 %', labelAt: [0, 0] },
    { kind: 'ray', lat: 3, lon: 3, azimuthDeg: 90, lengthKm: 100, label: 'Schatten' },
  ];
  const layout = overlayLayout(ctx, markers, shapes, toScreen, 4, 1000, 600);
  const overlap = (a: { x0: number; y0: number; x1: number; y1: number }, b: typeof a): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const boxes = layout.boxes.slice(1);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i]!, boxes[j]!), `boxes ${i} and ${j} overlap`);
  // The share and the selected marker's label are placed; every symbol has its box.
  assert.ok(layout.shapeLabels.some((l) => l.text === 'DE 38 %'));
  assert.ok(layout.markers.find((m) => m.m.id === 'c')?.label);
  assert.equal(layout.markers.length, 3);
  // Where the shapes' labels went, apart from the boxes the layout keeps: clear of every symbol and
  // marker label drawn ("DE 38 %" under the plates of DATUM-004 and DATUM-007, "SCHATTEN" over the
  // selected marker's label), and among the boxes the base map's place names give way to.
  assert.equal(layout.shapeLabels.length, 2, 'both shapes are labelled');
  const drawn = layout.markers.flatMap((m) => [{ x0: m.x - m.r, y0: m.y - m.r, x1: m.x + m.r, y1: m.y + m.r }, ...(m.label ? [m.label.box] : [])]);
  for (const l of layout.shapeLabels) {
    const box = { x0: l.x, y0: l.y - 6, x1: l.x + ctx.measureText(l.text).width, y1: l.y + 6 };
    for (const o of drawn) assert.ok(!overlap(box, o), `${l.text} ${JSON.stringify(box)} covers ${JSON.stringify(o)}`);
    assert.ok(layout.boxes.some((b) => b.x0 <= box.x0 && b.x1 >= box.x1 && b.y0 <= box.y0 && b.y1 >= box.y1), `${l.text} is among the boxes`);
  }
});

test('map labels stay on the map: a marker at its top or bottom edge labels itself inside it', () => {
  const ctx = { font: '', letterSpacing: '0px', measureText: (text: string) => ({ width: text.length * 6 }) } as unknown as CanvasRenderingContext2D;
  const toScreen = (lat: number, lon: number) => ({ x: 500 + lon * 20, y: 300 - lat * 20, v: true });
  const [width, height] = [986, 680];
  const inside = (b: { y0: number; y1: number }): boolean => b.y0 >= 0 && b.y1 <= height;
  // ORTUNG, reise-96s in English: the dimmed DATUM-007 2 px below the map's top edge, right of the
  // tool bar (278 px), was labelled to its right half above the edge; in German the bar (350 px)
  // sent the label wholly above the map.
  const top: MapMarker = { id: 'd007', lat: 14.9, lon: -10, shape: 'fix', label: 'DATUM-007', dim: true };
  for (const bar of [null, { width: 278, height: 51 }, { width: 350, height: 51 }]) {
    const label = overlayLayout(ctx, [top], [], toScreen, 4, width, height, bar).markers[0]?.label;
    assert.ok(!label || inside(label.box), `bar ${bar?.width ?? 0}: label box ${JSON.stringify(label?.box)}`);
  }
  assert.ok(overlayLayout(ctx, [top], [], toScreen, 4, width, height).markers[0]?.label, 'without the bar it goes below the symbol');
  // A selected marker's label is placed in any case, on the map too.
  const forced = overlayLayout(ctx, [{ ...top, selected: true }], [], toScreen, 4, width, height, { width: 350, height: 51 }).markers[0]?.label;
  assert.ok(forced && inside(forced.box), `forced label box ${JSON.stringify(forced?.box)}`);
  // At the bottom edge, with a second line.
  const bottom: MapMarker = { id: 'b', lat: (300 - (height - 2)) / 20, lon: 0, shape: 'fix', label: 'EUROPA-RAND', sub: '06:25–10:15' };
  const low = overlayLayout(ctx, [bottom], [], toScreen, 4, width, height).markers[0]?.label;
  assert.ok(low && inside(low.box), `label box ${JSON.stringify(low?.box)}`);
});

test('map labels keep clear of a tool bar over the top left corner (clearTopLeft)', () => {
  const ctx = { font: '', letterSpacing: '0px', measureText: (text: string) => ({ width: text.length * 6 }) } as unknown as CanvasRenderingContext2D;
  // A marker at the lower edge of the tool bar (ORTUNG, reise-96s: "DATUM-025" cut by "Wahrheit
  // zeigen · Weltansicht · Einstellungen"): screen (60, 56); its label would go right of it, into
  // the bar.
  const toScreen = (lat: number, lon: number) => ({ x: 500 + lon * 20, y: 300 - lat * 20, v: true });
  const markers: MapMarker[] = [{ id: 'a', lat: 12.2, lon: -22, shape: 'fix', label: 'DATUM-025' }];
  const bar = { width: 330, height: 58 };
  const overlap = (a: { x0: number; y0: number; x1: number; y1: number }, b: typeof a): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const barBox = { x0: 0, y0: 0, x1: bar.width, y1: bar.height };
  // Without the bar the label lands in its rectangle.
  const open = overlayLayout(ctx, markers, [], toScreen, 4, 1000, 600);
  const openLabel = open.markers[0]?.label;
  assert.ok(openLabel && overlap(openLabel.box, barBox), 'the probe must put the label under the bar');
  // With it the label is placed elsewhere, or left out (an unselected marker's label).
  const clear = overlayLayout(ctx, markers, [], toScreen, 4, 1000, 600, bar);
  const label = clear.markers[0]?.label;
  assert.ok(!label || !overlap(label.box, barBox), `label box ${JSON.stringify(label?.box)}`);
  // The bar is among the boxes the base map's place names give way to.
  assert.ok(clear.boxes.some((b) => b.x0 === 0 && b.y0 === 0 && b.x1 === bar.width && b.y1 === bar.height));
  // A selected marker's label is placed in any case, but not inside the bar when a place is free.
  const selected = overlayLayout(ctx, [{ ...markers[0]!, selected: true }], [], toScreen, 4, 1000, 600, bar);
  const forced = selected.markers[0]?.label;
  assert.ok(forced && !overlap(forced.box, barBox), `forced label box ${JSON.stringify(forced?.box)}`);
});
