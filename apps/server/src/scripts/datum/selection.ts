/** Pure helpers of the gallery selection (scripts/datum/fetchDataset.ts), testable on their own. */

const CONTINENT_ORDER = ['EU', 'AS', 'NA', 'AF', 'SA', 'OC', 'AN'];

/**
 * Interleaves a list (sorted by notability) over continents: the most notable item of Europe,
 * Asia, North America, Africa, South America, Oceania, then the second of each, and so on. Within
 * a continent the order is kept; a continent that runs out simply drops out of the rotation.
 */
export function interleaveByContinent<T>(items: readonly T[], continent: (item: T) => string): T[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const c = continent(item);
    const list = buckets.get(c) ?? [];
    list.push(item);
    buckets.set(c, list);
  }
  const order = [...CONTINENT_ORDER, ...[...buckets.keys()].filter((c) => !CONTINENT_ORDER.includes(c)).sort()];
  const out: T[] = [];
  for (let i = 0; out.length < items.length; i++) {
    for (const c of order) {
      const item = buckets.get(c)?.[i];
      if (item !== undefined) out.push(item);
    }
  }
  return out;
}
