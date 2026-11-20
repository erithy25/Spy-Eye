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
 * Whether a feature says what it is called in English: it carries `name:en`, or its local name
 * differs from the German one (englishOf takes that). A piece of a river without either says
 * nothing about the river's English name (englishNames).
 */
export const namesEnglish = (f: MvtFeature, german: string): boolean => String(f.properties['name:en'] ?? '').trim() !== '' || englishOf(f, german) !== undefined;

/**
 * One label of a shipped tile: the tile ("z/x/y"), the label's point in it (a place's point, a
 * river's first point, tile units) and on the Earth, its German name, and the English name of the
 * feature it was made from (null: the German name stands in English too). `says` false: the
 * feature has no English name of its own (namesEnglish), which counts for a place (its name is the
 * same in English) and not for a piece of a river.
 */
export interface LabelEnglish {
  tile: string;
  x: number;
  y: number;
  lat: number;
  lon: number;
  de: string;
  en: string | null;
  says?: boolean;
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
 * tagged unevenly (the Mosel: "Moselle" on 22 of its labels, "La Moselle" on 7, no English name
 * on 172; the Teltowkanal "Teltow Canal" on 6 pieces, none of them shipped): every label of a river
 * has the English name most of the pieces that say one carry (the German one where most say that:
 * the Spree is "Spree" on 12 pieces, the Sorbian "Sprewa" on 3), the German one of a tie with it
 * (the Warche: "Warche" on 4, "La Warche" on 4), else the alphabetically first; a river none of
 * whose pieces says one keeps the German name.
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
  // The German name stands for "" among the votes.
  const votes = new Map<number, Map<string, number>>();
  all.forEach((l, i) => {
    if (l.says === false) return;
    const counts = votes.get(root(i)) ?? new Map<string, number>();
    counts.set(l.en ?? '', (counts.get(l.en ?? '') ?? 0) + 1);
    votes.set(root(i), counts);
  });
  return list.map((l, i) => {
    // Most votes; of a tie the German name, else the alphabetically first.
    const ranked = [...(votes.get(root(i)) ?? new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1] || Number(b[0] === '') - Number(a[0] === '') || a[0].localeCompare(b[0]));
    const best = ranked[0];
    return best ? { ...l, en: best[0] === '' ? null : best[0] } : l;
  });
}

/**
 * Sorts the labels' English names into a table by German name and one by tile. A German name all
 * of whose labels have one English name that differs gets it by name ("Themse" → "River Thames").
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
