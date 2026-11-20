/**
 * The names the English console gives the labels of the map tiles, which carry the German ones
 * (apps/server/src/scripts/map/extractTiles.ts nameOf). Pure, so that the server's tests can check
 * it.
 */
import { PLACE_NAMES_EN, RIVER_NAMES_EN } from './placeNamesEn';

/**
 * German exonyms of cities and their English names, beside the table of the shipped tiles (some
 * cities name the English map differently from OpenStreetMap's `name:en`, e.g. "Frankfurt").
 */
export const CITY_EN: Readonly<Record<string, string>> = {
  'Addis Abeba': 'Addis Ababa',
  Algier: 'Algiers',
  Aschgabat: 'Ashgabat',
  Athen: 'Athens',
  Bagdad: 'Baghdad',
  Belgrad: 'Belgrade',
  Bischkek: 'Bishkek',
  Brügge: 'Bruges',
  Brünn: 'Brno',
  Brüssel: 'Brussels',
  Bukarest: 'Bucharest',
  Damaskus: 'Damascus',
  Danzig: 'Gdańsk',
  Daressalam: 'Dar es Salaam',
  'Den Haag': 'The Hague',
  Dschibuti: 'Djibouti',
  Dschidda: 'Jeddah',
  Dschuba: 'Juba',
  Duschanbe: 'Dushanbe',
  Eriwan: 'Yerevan',
  Florenz: 'Florence',
  'Frankfurt am Main': 'Frankfurt',
  Genf: 'Geneva',
  'Guatemala-Stadt': 'Guatemala City',
  Havanna: 'Havana',
  'Ho-Chi-Minh-Stadt': 'Ho Chi Minh City',
  Hongkong: 'Hong Kong',
  Jaunde: 'Yaoundé',
  Kairo: 'Cairo',
  Kalkutta: 'Kolkata',
  Kapstadt: 'Cape Town',
  Karatschi: 'Karachi',
  Khartum: 'Khartoum',
  Kiew: 'Kyiv',
  Kischinau: 'Chișinău',
  Köln: 'Cologne',
  Kopenhagen: 'Copenhagen',
  Krakau: 'Kraków',
  'Kuwait-Stadt': 'Kuwait City',
  Laibach: 'Ljubljana',
  Lissabon: 'Lisbon',
  Lüttich: 'Liège',
  Mailand: 'Milan',
  Maschhad: 'Mashhad',
  Maskat: 'Muscat',
  Mekka: 'Mecca',
  'Mexiko-Stadt': 'Mexico City',
  Mogadischu: 'Mogadishu',
  Moskau: 'Moscow',
  Mülhausen: 'Mulhouse',
  München: 'Munich',
  Neapel: 'Naples',
  'Neu-Delhi': 'New Delhi',
  Nikosia: 'Nicosia',
  Nürnberg: 'Nuremberg',
  Peking: 'Beijing',
  Pjöngjang: 'Pyongyang',
  Prag: 'Prague',
  Riad: 'Riyadh',
  Rom: 'Rome',
  'Sankt Petersburg': 'Saint Petersburg',
  Singapur: 'Singapore',
  Straßburg: 'Strasbourg',
  Taipeh: 'Taipei',
  Taschkent: 'Tashkent',
  Teheran: 'Tehran',
  Tiflis: 'Tbilisi',
  Tokio: 'Tokyo',
  Tripolis: 'Tripoli',
  'Ulan Bator': 'Ulaanbaatar',
  Urumtschi: 'Ürümqi',
  Venedig: 'Venice',
  Warschau: 'Warsaw',
  Wien: 'Vienna',
  Windhuk: 'Windhoek',
  'Zona Metropolitana de Monterrey': 'Monterrey',
  Zürich: 'Zurich',
};

const ORDINAL = (n: number): string => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th');

/**
 * English name of a place label (not a country): the tile's own (`nameEn`, tiles extracted with it),
 * a German exonym of a city, the table of the shipped tiles (placeNamesEn.ts), a numbered district
 * ("8. Arrondissement von Lyon" -> "8th Arrondissement, Lyon"), else the name as it stands (most
 * places are named alike in both).
 */
export function placeNameEn(p: { name: string; nameEn?: string }): string {
  if (p.nameEn) return p.nameEn;
  const listed = CITY_EN[p.name] ?? PLACE_NAMES_EN[p.name];
  if (listed) return listed;
  const district = /^(\d+)\. Arrondissement von (.+)$/.exec(p.name);
  if (district) {
    const n = Number(district[1]);
    return `${n}${ORDINAL(n)} Arrondissement, ${district[2] as string}`;
  }
  return p.name;
}

/** English name of a river or canal label: the tile's own, else the table of the shipped tiles, else as it stands. */
export function riverNameEn(l: { name: string; nameEn?: string }): string {
  return l.nameEn ?? RIVER_NAMES_EN[l.name] ?? l.name;
}
