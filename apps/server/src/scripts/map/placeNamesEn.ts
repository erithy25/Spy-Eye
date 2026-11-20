/**
 * Writes apps/web/src/map/placeNamesEn.ts: the English names of the place and river labels the
 * shipped map tiles (apps/web/public/map) carry in German.
 *
 *   tsx src/scripts/map/placeNamesEn.ts
 *
 * The tiles name places and rivers as the German map does (`name:de`, see extractTiles.ts and
 * englishNames.ts nameOf): "8. Arrondissement von Paris", "Themse", "Gablonz an der Neiße". The
 * English console names each label by `name:en` (else the local `name`) of the very feature it was
 * made from (englishOf): the source tile of the same zoom and number in the cache of the extraction
 * (.cache/map/osm), matched by name and point (a place's point, a river's first point), so that no
 * map service is asked. One German name can stand for features named differently in English (the
 * town of Homburg in the Saarland is "Homburg", the Belgian village whose German name is Homburg is
 * "Hombourg"): such names are written per tile and point, the others by name (englishNames); the
 * pieces of one river, with its pieces in the source tiles no shipped tile was made from, take the
 * name most of those that name themselves carry (the Mosel is "Moselle"). Tiles
 * extracted from now on carry the English name themselves (`e`, extractTiles.ts); this table covers
 * those extracted before.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from '../../config.js';
import { englishNames, englishOf, nameOf, namesEnglish, type EnglishNames, type LabelEnglish } from './englishNames.js';
import { decodeTile, type MvtLayer } from './mvt.js';

const PUBLIC_MAP = path.join(repoRoot, 'apps', 'web', 'public', 'map');
const OSM_CACHE = path.join(repoRoot, '.cache', 'map', 'osm');
const OUT = path.join(repoRoot, 'apps', 'web', 'src', 'map', 'placeNamesEn.ts');
/** Tile units of the shipped tiles (extractTiles.ts EXTENT). */
const EXTENT = 4096;
/**
 * Labels of one German river name this close (km, one after the other) are pieces of one river
 * (englishNames): the Weiße Elster's lie up to 113 km from the next named piece; the Vesdre, whose
 * German name is Weser, lies 264 km from the Weser, the Scheldt 350 km from the Schelde in Hesse.
 */
const RIVER_LINK_KM = 150;

interface RawTile {
  pl?: { n: string; c: string; p: [number, number] }[];
  ww?: Record<string, { n?: string; l: number[] }[]>;
}

async function* files(dir: string, ext: string): AsyncGenerator<string> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(p, ext);
    else if (e.name.endsWith(ext)) yield p;
  }
}

/** The cached source tile of a shipped one, from the newest extraction that has it; null if none. */
async function sourceTile(versions: readonly string[], z: number, x: number, y: number): Promise<Map<string, MvtLayer> | null> {
  for (const version of versions) {
    try {
      return decodeTile(await fs.readFile(path.join(OSM_CACHE, version, String(z), String(x), `${y}.pbf`)));
    } catch {
      // not in this extraction, or unreadable
    }
  }
  return null;
}

const scale = (layer: MvtLayer): number => EXTENT / layer.extent;

/** A point of a tile (tile units) on the Earth (Web Mercator). */
function lonLat(z: number, x: number, y: number, px: number, py: number): { lat: number; lon: number } {
  const n = 2 ** z;
  return { lon: ((x + px / EXTENT) / n) * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / EXTENT)) / n))) * 180) / Math.PI };
}

async function main(): Promise<void> {
  const versions = (await fs.readdir(OSM_CACHE, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .reverse();
  const places: LabelEnglish[] = [];
  const rivers: LabelEnglish[] = [];
  let shipped = 0;
  let unmatched = 0;
  const shippedTiles = new Set<string>();
  for await (const file of files(PUBLIC_MAP, '.json')) {
    const at = /[/\\](\d+)[/\\](\d+)[/\\](\d+)\.json$/.exec(file);
    if (!at) continue;
    const [z, x, y] = [Number(at[1]), Number(at[2]), Number(at[3])];
    shippedTiles.add(`${z}/${x}/${y}`);
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as RawTile;
    const labelled = (raw.pl ?? []).filter((p) => p.c !== 'country');
    const named = Object.entries(raw.ww ?? {}).flatMap(([k, list]) => (k === 's' ? [] : list.filter((w) => w.n)));
    if (labelled.length === 0 && named.length === 0) continue;
    shipped++;
    const tile = `${z}/${x}/${y}`;
    const source = await sourceTile(versions, z, x, y);
    // The English name of each place of the source tile at its point (as extractTiles.ts placed it).
    const placeAt = new Map<string, { en: string | null; says: boolean }>();
    const placeLayer = source?.get('place');
    if (placeLayer) {
      const k = scale(placeLayer);
      for (const f of placeLayer.features) {
        const de = nameOf(f);
        if (!de || String(f.properties['class']) === 'country') continue;
        for (const point of f.geometry) {
          const px = Math.round((point[0] as number) * k);
          const py = Math.round((point[1] as number) * k);
          placeAt.set(`${de}@${px},${py}`, { en: englishOf(f, de) ?? null, says: namesEnglish(f, de) });
        }
      }
    }
    for (const p of labelled) {
      const own = placeAt.get(`${p.n}@${p.p[0]},${p.p[1]}`);
      if (own === undefined) unmatched++;
      else places.push({ tile, x: p.p[0], y: p.p[1], ...lonLat(z, x, y, p.p[0], p.p[1]), de: p.n, ...own });
    }
    // Rivers and canals by the first point of each line (simplify and pack keep it, rounded).
    const riverAt = new Map<string, { en: string | null; says: boolean }>();
    const waterLayer = source?.get('waterway');
    if (waterLayer) {
      const k = scale(waterLayer);
      for (const f of waterLayer.features) {
        const de = nameOf(f);
        if (!de || f.type !== 2) continue;
        for (const g of f.geometry) {
          if (g.length < 2) continue;
          riverAt.set(`${de}@${Math.round((g[0] as number) * k)},${Math.round((g[1] as number) * k)}`, { en: englishOf(f, de) ?? null, says: namesEnglish(f, de) });
        }
      }
    }
    for (const w of named) {
      const de = w.n as string;
      const [lx, ly] = [w.l[0] as number, w.l[1] as number];
      const own = riverAt.get(`${de}@${lx},${ly}`);
      if (own === undefined) unmatched++;
      else rivers.push({ tile, x: lx, y: ly, ...lonLat(z, x, y, lx, ly), de, ...own });
    }
  }
  // The pieces of the same rivers in the source tiles no shipped tile was made from: they say what
  // a river is called in English where its shipped pieces do not (the Teltowkanal).
  const riverNamesShipped = new Set(rivers.map((r) => r.de));
  const pieces: LabelEnglish[] = [];
  const newest = versions[0];
  if (newest !== undefined) {
    for await (const file of files(path.join(OSM_CACHE, newest), '.pbf')) {
      const at = /[/\\](\d+)[/\\](\d+)[/\\](\d+)\.pbf$/.exec(file);
      if (!at) continue;
      const [z, x, y] = [Number(at[1]), Number(at[2]), Number(at[3])];
      if (shippedTiles.has(`${z}/${x}/${y}`)) continue;
      let layer: MvtLayer | undefined;
      try {
        layer = decodeTile(await fs.readFile(file)).get('waterway');
      } catch {
        continue;
      }
      if (!layer) continue;
      const k = scale(layer);
      for (const f of layer.features) {
        const de = nameOf(f);
        if (!riverNamesShipped.has(de) || f.type !== 2) continue;
        for (const g of f.geometry) {
          if (g.length < 2) continue;
          const [px, py] = [Math.round((g[0] as number) * k), Math.round((g[1] as number) * k)];
          pieces.push({ tile: `${z}/${x}/${y}`, x: px, y: py, ...lonLat(z, x, y, px, py), de, en: englishOf(f, de) ?? null, says: namesEnglish(f, de) });
        }
      }
    }
  }
  const placeNames = englishNames(places);
  const riverNames = englishNames(rivers, RIVER_LINK_KM, pieces);
  const byName = (names: EnglishNames): string =>
    [...names.byName.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'de'))
      .map(([de, en]) => `  ${JSON.stringify(de)}: ${JSON.stringify(en)},`)
      .join('\n');
  const byTile = (names: EnglishNames): string =>
    [...names.byTile.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))
      .map(([tile, labels]) => {
        const inner = [...labels.entries()]
          .sort((a, b) => a[0].localeCompare(b[0], 'de'))
          .map(([key, en]) => `${JSON.stringify(key)}: ${JSON.stringify(en)}`)
          .join(', ');
        return `  ${JSON.stringify(tile)}: { ${inner} },`;
      })
      .join('\n');
  const text = `/**
 * English names of the place and river labels of the shipped map tiles, which carry the German
 * ones. Generated by apps/server/src/scripts/map/placeNamesEn.ts from the cached source tiles
 * (OpenStreetMap \`name:en\`, else the local \`name\`, of the feature each label was made from); do
 * not edit by hand.
 *
 * Map data © OpenStreetMap contributors (ODbL).
 */

/** Places (city, town, village, suburb, quarter, …): German label → English, where all labels of that name agree. */
export const PLACE_NAMES_EN: Readonly<Record<string, string>> = {
${byName(placeNames)}
};

/** Named rivers and canals: German label → English, where all labels of that name agree. */
export const RIVER_NAMES_EN: Readonly<Record<string, string>> = {
${byName(riverNames)}
};

/**
 * Places whose German name stands for features named differently in English (the town of Homburg
 * in the Saarland is "Homburg", the Belgian village whose German name is Homburg is "Hombourg"):
 * tile "z/x/y" → ("German name@x,y", the label's point in tile units → English), for the labels
 * whose English name differs.
 */
export const TILE_PLACE_NAMES_EN: Readonly<Record<string, Readonly<Record<string, string>>>> = {
${byTile(placeNames)}
};

/**
 * Rivers and canals the same way, by the first point of the line ("Weser": the Weser, and the
 * Vesdre in Belgium); the pieces of one river have one name.
 */
export const TILE_RIVER_NAMES_EN: Readonly<Record<string, Readonly<Record<string, string>>>> = {
${byTile(riverNames)}
};
`;
  await fs.writeFile(OUT, text);
  const count = (names: EnglishNames): number => [...names.byTile.values()].reduce((sum, m) => sum + m.size, 0);
  console.log(
    `${shipped} shipped tiles with labels, ${versions.length} source extraction(s); ${places.length} place and ${rivers.length} river labels matched, ${unmatched} without a source feature; ` +
      `${pieces.length} pieces of their rivers elsewhere; ${placeNames.byName.size} places and ${riverNames.byName.size} rivers by name, ${count(placeNames)} place and ${count(riverNames)} river labels by tile -> ${path.relative(repoRoot, OUT)}`,
  );
}

await main();
