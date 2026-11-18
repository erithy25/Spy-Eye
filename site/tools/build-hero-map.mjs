/**
 * Builds the map data of the hero visual from the offline tiles of the console.
 *
 *   node site/tools/build-hero-map.mjs
 *
 * Reads the z12 tiles around the Rhine–Moselle confluence (plus the minor roads of the z13
 * tiles for the street pattern), merges them into one coordinate space and writes
 * site/assets/map/hero.js. The page loads that file with a script tag, so it also works when
 * index.html is opened straight from disk.
 *
 * Map data © OpenStreetMap contributors (ODbL), schema © OpenMapTiles, elevation: Mapzen
 * terrain tiles.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TILES = path.resolve(here, '..', '..', 'apps', 'web', 'public', 'map');
const OUT = path.resolve(here, '..', 'assets', 'map', 'hero.js');

const Z = 12;
const X0 = 2132;
const Y0 = 1381;
const COLS = 4;
const ROWS = 4;
/** Units per z12 tile in the merged coordinate space. */
const UNIT = 2048;
const EXTENT = 4096;

const readTile = (z, x, y) => {
  const file = path.join(TILES, String(z), String(x), `${y}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};

/** Delta-encoded tile path -> absolute tile coordinates. */
const unpack = (packed) => {
  const out = new Array(packed.length);
  let x = 0;
  let y = 0;
  for (let i = 0; i < packed.length; i += 2) {
    x += packed[i];
    y += packed[i + 1];
    out[i] = x;
    out[i + 1] = y;
  }
  return out;
};

/** Absolute merged coordinates -> delta-encoded integers, dropping repeated vertices. */
const pack = (abs) => {
  const out = [];
  let px = 0;
  let py = 0;
  for (let i = 0; i < abs.length; i += 2) {
    const x = Math.round(abs[i]);
    const y = Math.round(abs[i + 1]);
    if (i > 0 && x === px && y === py) continue;
    out.push(x - px, y - py);
    px = x;
    py = y;
  }
  return out;
};

const lengthOf = (abs) => {
  let sum = 0;
  for (let i = 2; i < abs.length; i += 2) sum += Math.hypot(abs[i] - abs[i - 2], abs[i + 1] - abs[i - 1]);
  return sum;
};

/** Splits a clipped ring into the parts that are real outline, leaving out runs along the tile edge. */
const shoreOf = (ring) => {
  const parts = [];
  let current = null;
  const onEdge = (ax, ay, bx, by) =>
    (ax <= 0 && bx <= 0) || (ax >= EXTENT && bx >= EXTENT) || (ay <= 0 && by <= 0) || (ay >= EXTENT && by >= EXTENT);
  for (let i = 2; i < ring.length; i += 2) {
    const ax = ring[i - 2];
    const ay = ring[i - 1];
    const bx = ring[i];
    const by = ring[i + 1];
    if (onEdge(ax, ay, bx, by)) {
      current = null;
      continue;
    }
    if (!current) {
      current = [ax, ay];
      parts.push(current);
    }
    current.push(bx, by);
  }
  return parts;
};

const data = {
  z: Z,
  x0: X0,
  y0: Y0,
  cols: COLS,
  rows: ROWS,
  unit: UNIT,
  water: [],
  shore: [],
  rivers: [],
  contours: [],
  contoursMajor: [],
  roads: { m: [], t: [], p: [], s: [], e: [], n: [], r: [] },
  bridges: [],
  bounds: [],
  places: [],
};

for (let tx = X0; tx < X0 + COLS; tx++) {
  for (let ty = Y0; ty < Y0 + ROWS; ty++) {
    const tile = readTile(Z, tx, ty);
    if (!tile) throw new Error(`Tile ${Z}/${tx}/${ty} is missing; run the map extraction of the console first.`);
    const k = UNIT / EXTENT;
    const ox = (tx - X0) * UNIT;
    const oy = (ty - Y0) * UNIT;
    const place = (abs) => abs.map((v, i) => (i % 2 === 0 ? ox + v * k : oy + v * k));

    for (const packed of tile.water ?? []) {
      const ring = unpack(packed);
      data.water.push(pack(place(ring)));
      for (const part of shoreOf(ring)) if (part.length >= 4) data.shore.push(pack(place(part)));
    }
    for (const group of ['r', 'c']) {
      for (const way of tile.ww?.[group] ?? []) data.rivers.push({ n: way.n ?? '', l: pack(place(unpack(way.l))) });
    }
    for (const c of tile.ct ?? []) {
      const abs = place(unpack(c.l));
      if (lengthOf(abs) < 90) continue;
      (c.h % 100 === 0 ? data.contoursMajor : data.contours).push(pack(abs));
    }
    for (const cls of ['m', 't', 'p', 's', 'e', 'r']) {
      for (const packed of tile.rd?.[cls] ?? []) data.roads[cls].push(pack(place(unpack(packed))));
    }
    for (const packed of tile.br ?? []) data.bridges.push(pack(place(unpack(packed))));
    for (const level of ['4', '6']) {
      for (const packed of tile.bd?.[level] ?? []) data.bounds.push(pack(place(unpack(packed))));
    }
    for (const p of tile.pl ?? []) {
      if (!['city', 'town', 'village'].includes(p.c)) continue;
      data.places.push({ n: p.n, c: p.c, x: Math.round(ox + p.p[0] * k), y: Math.round(oy + p.p[1] * k) });
    }
  }
}

// Residential streets come from the next zoom level; the z12 tiles stop at tertiary roads.
let minorTiles = 0;
for (let tx = X0 * 2; tx < (X0 + COLS) * 2; tx++) {
  for (let ty = Y0 * 2; ty < (Y0 + ROWS) * 2; ty++) {
    const tile = readTile(Z + 1, tx, ty);
    if (!tile) continue;
    minorTiles++;
    const k = UNIT / 2 / EXTENT;
    const ox = (tx - X0 * 2) * (UNIT / 2);
    const oy = (ty - Y0 * 2) * (UNIT / 2);
    for (const packed of tile.rd?.n ?? []) {
      const abs = unpack(packed).map((v, i) => (i % 2 === 0 ? ox + v * k : oy + v * k));
      if (lengthOf(abs) < 14) continue;
      data.roads.n.push(pack(abs));
    }
  }
}

const count = (list) => list.reduce((sum, p) => sum + p.length / 2, 0);
const banner =
  '/* Map data of the hero visual. © OpenStreetMap contributors (ODbL) · OpenMapTiles · elevation: Mapzen terrain tiles.\n' +
  '   Generated by site/tools/build-hero-map.mjs from the offline tiles of the console. */\n';
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${banner}window.SICHT_MAP=${JSON.stringify(data)};\n`);
const size = fs.statSync(OUT).size;
process.stdout.write(
  `hero.js ${(size / 1024).toFixed(0)} KB · water ${data.water.length} rings · contours ${data.contours.length}+${data.contoursMajor.length} ` +
    `(${count(data.contours) + count(data.contoursMajor)} pts) · minor roads ${data.roads.n.length} from ${minorTiles} tiles · places ${data.places.length}\n`,
);
