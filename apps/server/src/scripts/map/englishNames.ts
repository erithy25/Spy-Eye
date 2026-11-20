/**
 * The names of the map's labels in German and in English, shared by the extraction (extractTiles.ts,
 * the German name in the tiles and the English one beside it) and by the table of the English names
 * of the tiles shipped before that (placeNamesEn.ts): which name a feature has, and which English
 * name a German label stands for.
 */
import type { MvtFeature } from './mvt.js';

/** The German map's name of a feature: `name:de`, else the local `name`, else its Latin form. */
export const nameOf = (f: MvtFeature): string => String(f.properties['name:de'] ?? f.properties['name'] ?? f.properties['name:latin'] ?? '').trim();

/** Latin letters (with their accents), digits and punctuation: an English label in another script is no English label. */
const LATIN = /^[\u0000-ɏḀ-ỿ -⁯]+$/;

/**
 * The English console's name of a feature whose German one is `german`: `name:en`, else the local
 * `name`, where it differs and is written in Latin letters; undefined otherwise (the German stands).
 */
export const englishOf = (f: MvtFeature, german: string): string | undefined => {
  const en = String(f.properties['name:en'] ?? f.properties['name_en'] ?? f.properties['name'] ?? '').trim();
  return en !== '' && en !== german && LATIN.test(en) ? en : undefined;
};

/**
 * Where a feature's English name (englishOf) comes from, for the vote of the pieces of a river
 * (englishNames): 'en' from its `name:en`; 'local' from its local name, which it has instead, in
 * Latin letters, the German one or another (the German Rur's pieces "Rur", the Dutch ones "Roer");
 * null from neither (no local name, or one in another script): it says nothing.
 */
export type EnglishSource = 'en' | 'local' | null;

export const englishSource = (f: MvtFeature, german: string): EnglishSource => {
  if (String(f.properties['name:en'] ?? '').trim() !== '') return 'en';
  const local = String(f.properties['name_en'] ?? f.properties['name'] ?? '').trim();
  return local === german || englishOf(f, german) !== undefined ? 'local' : null;
};

/**
 * One label of a shipped tile: the tile ("z/x/y"), the label's point in it (a place's point, a
 * river's first point, tile units) and on the Earth, its German name, and the English name of the
 * feature it was made from (null: the German name stands in English too). `from`: where that
 * English name comes from (englishSource; undefined: `name:en`), which decides the vote of the
 * pieces of a river and nothing for a place.
 */
export interface LabelEnglish {
  tile: string;
  x: number;
  y: number;
  lat: number;
  lon: number;
  de: string;
  en: string | null;
  from?: EnglishSource;
}

/** The English names of a kind of label: by German name, and by tile and point where one name stands for several. */
export interface EnglishNames {
  /** German name → English, where every label of that name has this one English name. */
  byName: Map<string, string>;
  /** Tile "z/x/y" → (labelKey(name, x, y) → English), for the labels of the other names that differ in English. */
  byTile: Map<string, Map<string, string>>;
}

/** The key of a label within its tile in EnglishNames.byTile: "German name@x,y". */
export function labelKey(name: string, x: number, y: number): string {
  return `${name}@${x},${y}`;
}

/** Great-circle distance (km). */
function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The labels of one German name as one feature each, or, with `linkKm`, as rivers: labels within
 * `linkKm` of each other (one after the other) belong to one river, with the pieces of `others`
 * (features of the source tiles no shipped label was made from) between them. Its pieces are
 * tagged unevenly (the Mosel: `name:en` "Moselle" on 22 of its pieces, the local name only on the
 * others, "La Moselle" on 7 and "Mosel" on 172; the Teltowkanal "Teltow Canal" on 6 pieces, none
 * of them shipped; the Rur no `name:en` at all, "Rur" on its 19 German pieces and "Roer" on its 3
 * Dutch ones). Every label of a river has the English name most of its pieces with `name:en`
 * carry (the German one where most say that: the Spree is "Spree" on 15 pieces, "Sprewa" on 3);
 * where none of them has one, the local name most of its pieces carry, the German one counted
 * (the Rur stays "Rur"); of a tie the German one, else the alphabetically first. A river none of
 * whose pieces says anything (englishSource null) keeps the German name.
 */
function asFeatures(list: readonly LabelEnglish[], linkKm: number, others: readonly LabelEnglish[]): LabelEnglish[] {
  if (linkKm <= 0) return [...list];
  const all = [...list, ...others];
  const river = all.map((_, i) => i);
  const root = (i: number): number => {
    while (river[i] !== i) i = river[i] = river[river[i] as number] as number;
    return i;
  };
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) if (km(all[i] as LabelEnglish, all[j] as LabelEnglish) <= linkKm) river[root(i)] = root(j);
  }
  // The votes of each river: of its pieces with `name:en`, else of those by their local name. The
  // German name stands for "" among them.
  const votes = new Map<number, { from: 'en' | 'local'; counts: Map<string, number> }>();
  all.forEach((l, i) => {
    const from = l.from === undefined ? 'en' : l.from;
    if (from === null) return;
    const had = votes.get(root(i));
    if (had?.from === 'en' && from === 'local') return;
    const counts = had?.from === from ? had.counts : new Map<string, number>();
    counts.set(l.en ?? '', (counts.get(l.en ?? '') ?? 0) + 1);
    votes.set(root(i), { from, counts });
  });
  return list.map((l, i) => {
    // Most votes; of a tie the German name, else the alphabetically first.
    const ranked = [...(votes.get(root(i))?.counts ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1] || Number(b[0] === '') - Number(a[0] === '') || a[0].localeCompare(b[0]));
    const best = ranked[0];
    return best ? { ...l, en: best[0] === '' ? null : best[0] } : l;
  });
}

/**
 * Sorts the labels' English names into a table by German name and one by tile. A German name all
 * of whose labels have one English name that differs gets it by name ("Themse" → "Thames").
 * Where the labels of one German name disagree, each feature keeps its own: the town of Homburg in
 * the Saarland is "Homburg" in English as well, the Belgian village whose German name is Homburg
 * is "Hombourg"; the name gets no entry (the German stands), and every label of it whose English
 * name differs gets one of its tile and point. A tie or a majority of other features never decides
 * for a feature. With `linkKm` the labels are pieces of rivers (asFeatures, with the pieces of
 * `others` between them): the pieces of one river share its name, two rivers of one German name
 * keep theirs (the Weser, and the Vesdre in Belgium, 260 km away, whose German name is Weser).
 */
export function englishNames(labels: Iterable<LabelEnglish>, linkKm = 0, others: Iterable<LabelEnglish> = []): EnglishNames {
  const byGerman = new Map<string, LabelEnglish[]>();
  for (const l of labels) {
    const list = byGerman.get(l.de);
    if (list) list.push(l);
    else byGerman.set(l.de, [l]);
  }
  const otherPieces = new Map<string, LabelEnglish[]>();
  for (const l of others) {
    const list = otherPieces.get(l.de);
    if (list) list.push(l);
    else otherPieces.set(l.de, [l]);
  }
  const byName = new Map<string, string>();
  const byTile = new Map<string, Map<string, string>>();
  for (const [de, all] of byGerman) {
    const list = asFeatures(all, linkKm, otherPieces.get(de) ?? []);
    const english = new Set(list.map((l) => l.en));
    if (english.size === 1) {
      const en = list[0]?.en ?? null;
      if (en !== null && en !== de) byName.set(de, en);
      continue;
    }
    for (const l of list) {
      if (l.en === null || l.en === de) continue;
      const tile = byTile.get(l.tile) ?? new Map<string, string>();
      tile.set(labelKey(de, l.x, l.y), l.en);
      byTile.set(l.tile, tile);
    }
  }
  return { byName, byTile };
}
