import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Evidence, Fix, FixCandidate, FixLocation, SunReport, TerrainGrid, TimeEstimate } from '../src/datum/contract.js';
import { sunPath, sunState } from '../src/datum/sun.js';
// The console's pure helpers (their imports are types, pure modules and React's hooks only).
import { fmtElev, rivalWindow, sunInWindow } from '../../web/src/datum/panel/common.tsx';
import { groupEvidence } from '../../web/src/datum/panel/evidenceOrder.ts';
import { terrainContours, terrainSource } from '../../web/src/datum/contours.ts';
import { routeFrame } from '../../web/src/datum/segments.ts';
import { firstCandidateIsFix, fixMapView, rivalText, windowLabelText, windowsText, zoomForRadius } from '../../web/src/datum/useFixes.ts';
import { placeNameEn, riverNameEn } from '../../web/src/map/placeNames.ts';
import { overlayLayout, type MapMarker, type MapShape } from '../../web/src/map/MapCanvas.tsx';

/**
 * Findings of the acceptance of engine 13 that the console fixes: the map of BEFUND on the fix
 * (not on the pictures' first candidate), the even split of morning and afternoon, the order of the
 * evidence, the English names of the map, the coarse terrain and the frame of a route.
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
