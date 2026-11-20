import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import type { FixLocation, FixSegment } from '../src/datum/contract.js';
import { segmentCountries } from '../src/datum/segments.js';
// The console's parts as the components call them (their imports are types, pure modules and React's hooks only).
import { countryListOf, countryRows } from '../../web/src/datum/segments.ts';
import { RESULT_CARD_PX, routeMapView } from '../../web/src/datum/useFixes.ts';
import { project, unproject, worldSize } from '../../web/src/map/geo.ts';
import { makeGlobe, projectGlobe } from '../../web/src/map/globe.ts';
import { drawBaseNames, reachZoom, viewTarget } from '../../web/src/map/MapCanvas.tsx';
import { buildTile, type LineLabel, type PlaceLabel, type RawTile, type Tile } from '../../web/src/map/tiles.ts';

/**
 * Where the console calls the helpers datum-console-fixes checks: the English names a shipped tile
 * gives its labels (tiles.ts buildTile), the names the base map writes in each language
 * (MapCanvas drawBaseNames), the view that puts a place left of the result card (MapCanvas
 * viewTarget), and what BEFUND tells its country list it is.
 */

// The tiles' paths are Path2D objects, which Node has not: a stand-in that takes the calls.
(globalThis as { Path2D?: unknown }).Path2D ??= class {
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
};

/**
 * MapCanvas itself needs a canvas, a ResizeObserver and animation frames, which Node has not: its
 * hand-over to the parts tested here is read from its source.
 */
const mapCanvasSource = (): Promise<string> => readFile(new URL('../../web/src/map/MapCanvas.tsx', import.meta.url), 'utf8');

async function shipped(tile: string): Promise<Tile> {
  const [z, x, y] = tile.split('/').map(Number) as [number, number, number];
  return buildTile(z, x, y, JSON.parse(await readFile(new URL(`../../web/public/map/${tile}.json`, import.meta.url), 'utf8')) as RawTile);
}

test('base map tiles: each label of a shipped tile carries the English name of its own feature', async () => {
  const place = async (tile: string, name: string): Promise<PlaceLabel> => {
    const p = (await shipped(tile)).places.find((l) => l.name === name);
    assert.ok(p, `${name} in ${tile}`);
    return p;
  };
  // Falkenburg in Pomerania is Złocieniec, the Dutch one Valkenburg; Homburg (Saar) keeps its name.
  assert.equal((await place('7/69/41', 'Falkenburg')).nameEn, 'Złocieniec');
  assert.equal((await place('9/264/171', 'Falkenburg')).nameEn, 'Valkenburg');
  assert.equal((await place('8/133/87', 'Homburg')).nameEn, undefined);
  // The Vesdre, whose German name is Weser, by its own label; the Weser keeps its name.
  const rivers = async (tile: string, name: string): Promise<(string | null)[]> =>
    (await shipped(tile)).riverLabels.filter((l) => l.name === name).map((l) => l.nameEn ?? null);
  assert.deepEqual(await rivers('9/264/172', 'Weser'), ['Vesdre']);
  assert.deepEqual([...new Set(await rivers('8/134/85', 'Weser'))], [null]);
});

/** A stand-in for the canvas that keeps what is written (6 px per character). */
function canvas(): { ctx: CanvasRenderingContext2D; written: string[] } {
  const written: string[] = [];
  const ctx = {
    font: '',
    textBaseline: '',
    textAlign: '',
    lineJoin: '',
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    measureText: (text: string) => ({ width: text.length * 6 }),
    strokeText: (): void => {},
    fillText: (text: string): void => {
      written.push(text);
    },
    save: (): void => {},
    restore: (): void => {},
    translate: (): void => {},
    rotate: (): void => {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, written };
}

test('base map names: written in the console\'s language, from the labels of the shipped tiles', async () => {
  const falkenburg = (await shipped('7/69/41')).places.find((p) => p.name === 'Falkenburg');
  const vesdre = (await shipped('9/264/172')).riverLabels.find((l) => l.name === 'Weser');
  assert.ok(falkenburg && vesdre);
  const places = (): { p: PlaceLabel; x: number; y: number }[] => [
    { p: { name: 'Deutschland', cls: 'country', rank: 0, x: 0, y: 0 }, x: 400, y: 300 },
    { p: { name: 'Köln', cls: 'city', rank: 1, x: 0, y: 0 }, x: 200, y: 100 },
    { p: falkenburg, x: 600, y: 100 },
  ];
  const rivers = (): { l: LineLabel; x: number; y: number }[] => [
    { l: { name: 'Themse', x: 0, y: 0, angle: 0, length: 3000 }, x: 200, y: 500 },
    { l: vesdre, x: 700, y: 500 },
  ];
  const written = (english: ReadonlyMap<string, string> | null): string[] => {
    const { ctx, written: texts } = canvas();
    drawBaseNames(ctx, places(), rivers(), english, 10, []);
    return texts.sort();
  };
  // In English (the country names loaded): countries by them, every other place and river by its
  // English name; in German the tiles' names.
  assert.deepEqual(written(new Map([['Deutschland', 'Germany']])), ['COLOGNE', 'GERMANY', 'Thames', 'Vesdre', 'ZŁOCIENIEC']);
  assert.deepEqual(written(null), ['DEUTSCHLAND', 'FALKENBURG', 'KÖLN', 'Themse', 'Weser']);
  // The map writes them with its names of the console's language (null in German).
  assert.match(await mapCanvasSource(), /\bdrawBaseNames\(\s*ctx,\s*places,\s*rivers,\s*countryNamesRef\.current,/);
});

test('map view beside the result card: the place in the middle of the area left of it', async () => {
  // ORTUNG on a map of 986 × 706 px (1366 × 768): a route's view (routeMapView) left of the card.
  const [width, height] = [986, 706];
  const view = routeMapView({ lat: 50.1, lon: 23.4, reachKm: 1200 }, 2.25);
  assert.equal(view.insetRight, RESULT_CARD_PX);
  const left = width - RESULT_CARD_PX;
  // The flat map: the place half the card's width left of the middle.
  const zf = reachZoom(view.reachKm ?? 0, view.lat, width, height, RESULT_CARD_PX, false, 1, 16);
  const flat = viewTarget(view, zf, width, height, false);
  assert.equal(flat.zoom, zf);
  const x = width / 2 + (project(view.lat, view.lon).x - flat.x) * worldSize(zf);
  assert.ok(Math.abs(x - left / 2) < 1e-6, `place at ${x}, area middle ${left / 2}`);
  // The globe turns it there (a turn of the sphere: within a few pixels).
  const zg = reachZoom(view.reachKm ?? 0, view.lat, width, height, RESULT_CARD_PX, true, 1, 16);
  const round = viewTarget(view, zg, width, height, true);
  const c = unproject(round.x, round.y);
  const at = projectGlobe(makeGlobe(c.lat, c.lon, zg, width, height), view.lat, view.lon);
  assert.ok(at.v && Math.abs(at.x - left / 2) < 8, `place at ${at.x}, area middle ${left / 2}`);
  // Without a card, or before the map has a size: the place in the middle.
  assert.deepEqual(viewTarget({ ...view, insetRight: 0 }, zf, width, height, false), { ...project(view.lat, view.lon), zoom: zf });
  assert.deepEqual(viewTarget(view, zf, 0, 0, false), { ...project(view.lat, view.lon), zoom: zf });
  // The map turns to every requested view so, its card's width as asked.
  assert.match(await mapCanvasSource(), /\bconst targetOf = \(v: MapView\): ViewState => viewTarget\(\s*v,\s*viewZoom\(v\),/);
});

function loc(lat: number, lon: number, radiusKm: number, method: FixLocation['method']): FixLocation {
  return { lat, lon, radiusKm, confidence: 0.9, method, label: `${lat},${lon}`, country: null, countryName: null };
}

test('BEFUND: its country list is told what it is (the stretches\' shares of the recording time)', async () => {
  // The props BEFUND writes on its CountryBars, read from its source and evaluated for a fix whose
  // stretch shows the place (Köln 10 s, Eiffel Tower 15 s, Hof 10 s): FR 43 %, DE 57 %, France first.
  const source = await readFile(new URL('../../web/src/datum/views/Befund.tsx', import.meta.url), 'utf8');
  const bars = [...source.matchAll(/<CountryBars\b([^>]*?)\/>/g)];
  assert.equal(bars.length, 1, 'one country list in BEFUND');
  const stretch = (startSec: number, endSec: number, country: string, place: number, lat: number, lon: number): FixSegment =>
    ({ startSec, endSec, place, location: { ...loc(lat, lon, 1, 'landmark'), country, countryName: country } }) as unknown as FixSegment;
  const segments = [stretch(0, 10, 'DE', 1, 50.94, 6.96), stretch(10, 25, 'FR', 2, 48.858, 2.294), stretch(25, 35, 'DE', 3, 50.32, 11.92)];
  const fix = { location: { ...loc(48.858, 2.294, 1, 'landmark'), country: 'FR' }, segments, countries: segmentCountries(segments, 1) };
  const props: Record<string, unknown> = Object.fromEntries(
    [...(bars[0]?.[1] ?? '').matchAll(/(\w+)=\{([^{}]*)\}/g)].map(([, name, expr]) => [name, new Function('fix', 'loc', 'countryListOf', `return (${expr as string});`)(fix, fix.location, countryListOf) as unknown]),
  );
  assert.equal(props['countries'], fix.countries);
  assert.equal(props['list'], 'shares', 'without it the list says "Wahrscheinlichkeit" and sorts the shares by size');
  // What CountryBars makes of them: the server's order, no note that calls a share a probability.
  const rows = countryRows(fix.countries, props['list'] as 'shares', props['limit'] as number, props['answer'] as string);
  assert.deepEqual(rows.shown.map((c) => c.iso), ['FR', 'DE']);
  assert.equal(rows.apart, false);
});
