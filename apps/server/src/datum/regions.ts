/**
 * DATUM regions: the parts of the world a coarse answer is named by ("eher Westeuropa"), after the
 * subregions of the UN geoscheme (M49). Russia, which M49 puts in Eastern Europe as a whole, is
 * split at 60° east (the Urals): a point in Siberia (or in Chukotka, east of 180°) reads
 * "Nordasien", not "Osteuropa".
 */
import { greatCircleKm, type World } from './world.js';

/** A part of the world in both languages. */
export interface RegionName {
  de: string;
  en: string;
}

/** The subregions with their countries (ISO 3166-1 alpha-2). */
const SUBREGIONS: ReadonlyArray<RegionName & { isos: string }> = [
  { de: 'Nordeuropa', en: 'Northern Europe', isos: 'AX DK EE FI FO GB GG IE IM IS JE LT LV NO SE SJ' },
  { de: 'Westeuropa', en: 'Western Europe', isos: 'AT BE CH DE FR LI LU MC NL' },
  { de: 'Südeuropa', en: 'Southern Europe', isos: 'AD AL BA ES GI GR HR IT ME MK MT PT RS SI SM VA XK' },
  { de: 'Osteuropa', en: 'Eastern Europe', isos: 'BG BY CZ HU MD PL RO RU SK UA' },
  { de: 'Westasien', en: 'Western Asia', isos: 'AE AM AZ BH CY GE IL IQ JO KW LB OM PS QA SA SY TR YE' },
  { de: 'Zentralasien', en: 'Central Asia', isos: 'KG KZ TJ TM UZ' },
  { de: 'Südasien', en: 'Southern Asia', isos: 'AF BD BT IN IR LK MV NP PK' },
  { de: 'Ostasien', en: 'Eastern Asia', isos: 'CN HK JP KP KR MN MO TW' },
  { de: 'Südostasien', en: 'South-eastern Asia', isos: 'BN ID KH LA MM MY PH SG TH TL VN' },
  { de: 'Nordafrika', en: 'Northern Africa', isos: 'DZ EG EH LY MA SD TN' },
  { de: 'Westafrika', en: 'Western Africa', isos: 'BF BJ CI CV GH GM GN GW LR ML MR NE NG SH SL SN TG' },
  { de: 'Zentralafrika', en: 'Middle Africa', isos: 'AO CD CF CG CM GA GQ ST TD' },
  { de: 'Ostafrika', en: 'Eastern Africa', isos: 'BI DJ ER ET IO KE KM MG MU MW MZ RE RW SC SO SS TF TZ UG YT ZM ZW' },
  { de: 'Südliches Afrika', en: 'Southern Africa', isos: 'BW LS NA SZ ZA' },
  { de: 'Nordamerika', en: 'Northern America', isos: 'BM CA GL PM US' },
  { de: 'Mittelamerika', en: 'Central America', isos: 'BZ CR GT HN MX NI PA SV' },
  { de: 'Karibik', en: 'Caribbean', isos: 'AG AI AW BB BL BQ BS CU CW DM DO GD GP HT JM KN KY LC MF MQ MS PR SX TC TT VC VG VI' },
  { de: 'Südamerika', en: 'South America', isos: 'AR BO BR CL CO EC FK GF GS GY PE PY SR UY VE' },
  { de: 'Australien und Neuseeland', en: 'Australia and New Zealand', isos: 'AU CC CX HM NF NZ' },
  { de: 'Melanesien', en: 'Melanesia', isos: 'FJ NC PG SB VU' },
  { de: 'Mikronesien', en: 'Micronesia', isos: 'FM GU KI MH MP NR PW UM' },
  { de: 'Polynesien', en: 'Polynesia', isos: 'AS CK NU PF PN TK TO TV WF WS' },
  { de: 'Antarktis', en: 'Antarctica', isos: 'AQ' },
];

const NORTHERN_ASIA: RegionName = { de: 'Nordasien', en: 'Northern Asia' };

/**
 * The codes the map data gives areas without an ISO code of their own (Natural Earth), read as a
 * country of the same part of the world: the city list names Hargeisa, Berbera and Erigabo "SOL"
 * (Somaliland), the country shapes also have "CYN" (Northern Cyprus) and "KAS" (Siachen Glacier,
 * Southern Asia whichever side holds it).
 */
const ALIASES: Readonly<Record<string, string>> = { SOL: 'SO', CYN: 'CY', KAS: 'IN' };

const BY_ISO = new Map<string, RegionName>();
for (const r of SUBREGIONS) for (const iso of r.isos.split(' ')) BY_ISO.set(iso, { de: r.de, en: r.en });

/**
 * The part of the world a country belongs to (Russia east of 60° E, and east of 180° where the
 * longitude turns negative: Nordasien); null if unknown.
 */
export function regionOfCountry(iso: string, lon: number): RegionName | null {
  const upper = iso.toUpperCase();
  const code = ALIASES[upper] ?? upper;
  // Russia has no land west of 0°: a negative longitude is Chukotka, past the antimeridian.
  if (code === 'RU' && (lon >= 60 || lon < 0)) return NORTHERN_ASIA;
  return BY_ISO.get(code) ?? null;
}

/**
 * The part of the world a point lies in: that of the country containing it, else of the country of
 * the nearest listed city within `maxKm` (a point at sea between two coasts); null when there is
 * none (open ocean).
 */
export function regionOf(world: World, lat: number, lon: number, maxKm = 1500): RegionName | null {
  const iso = world.countryAt(lat, lon)?.iso ?? world.nearestCity(lat, lon, { maxKm })?.iso ?? null;
  return iso ? regionOfCountry(iso, lon) : null;
}

/** The order of the parts of the world in SUBREGIONS (Nordasien after Osteuropa), for names of two. */
const ORDER = new Map<string, number>([...SUBREGIONS.map((r, i) => [r.de, i] as const), [NORTHERN_ASIA.de, SUBREGIONS.findIndex((r) => r.de === 'Osteuropa') + 0.5]]);

/**
 * The name of a coarse region (FixSegment.coarse): the part of the world that holds the circle of
 * `radiusKm` around the point, by the people of the listed cities inside it. One part where at
 * least `alone` of them live in it, else the two with the most ("Westeuropa oder Osteuropa", in
 * the order of the table above, so that neighbouring windows read the same); null where no listed
 * city lies in the circle (open ocean). A 1 500 km circle spans several parts of the world: named
 * by the part at its centre alone, the truth's part was the one named in 58 and 67 % of the
 * regions shown, by this rule in 88 and 92 % (docs/DATUM.md, "Grobe Region für unbestimmte
 * Abschnitte").
 */
export function regionAround(world: World, lat: number, lon: number, radiusKm: number, alone = 0.9): RegionName | null {
  const people = new Map<string, { name: RegionName; pop: number }>();
  let total = 0;
  for (const c of world.cities()) {
    if (greatCircleKm(lat, lon, c.lat, c.lon) > radiusKm) continue;
    const name = regionOfCountry(c.iso, c.lon);
    if (!name) continue;
    const pop = Math.max(1, c.pop);
    const known = people.get(name.de);
    if (known) known.pop += pop;
    else people.set(name.de, { name, pop });
    total += pop;
  }
  const ranked = [...people.values()].sort((a, b) => b.pop - a.pop);
  const first = ranked[0];
  if (!first) return null;
  const second = ranked[1];
  if (!second || first.pop >= alone * total) return first.name;
  const [a, b] = [first.name, second.name].sort((x, y) => (ORDER.get(x.de) ?? 99) - (ORDER.get(y.de) ?? 99)) as [RegionName, RegionName];
  return { de: `${a.de} oder ${b.de}`, en: `${a.en} or ${b.en}` };
}
