/**
 * How the console words what a fix says: place names, countries, the stage of a fix and the case
 * name of a recording, in the language the analyst chose.
 */
import type { Fix, FixCandidate, FixLocation } from '../../../server/src/datum/contract';
import type { VideoInfo } from '../api';
import { VIDEO_FILE_PATTERN } from '../format';
import type { useLang } from '../i18n';
import { formatCoordinate } from '../map/geo';
import { kmText } from './useFixes';

type Lang = ReturnType<typeof useLang>;

/**
 * Continents the engine names when it can only answer on that level. They are no proper names,
 * so they are translated (the keys are in en.ts).
 */
const CONTINENTS = new Set(['Afrika', 'Asien', 'Europa', 'Nordamerika', 'Südamerika', 'Mittelamerika', 'Ozeanien', 'Antarktis']);

/**
 * The name of a place in the console language. Landmark names stay as they are; a fix answered on
 * the level of a country carries the German country name as its label, which is shown as the
 * country's name in the chosen language instead. Fixes of the current engine carry `labelEn`.
 */
export function placeText(
  lang: Lang,
  place: Pick<FixLocation, 'label' | 'country'> & { labelEn?: string; countryName?: string | null; lat?: number; lon?: number },
  fix?: Fix | null,
): string {
  // A point without a place name is named by its coordinates, written as every view writes them.
  if (isCoordLabel(place.label) && place.lat !== undefined && place.lon !== undefined) return formatCoordinate(place.lat, place.lon);
  if (lang.lang === 'en' && place.labelEn) return place.labelEn;
  if (CONTINENTS.has(place.label)) return lang.t(place.label);
  if (place.country) {
    const germanName = place.countryName ?? fix?.countries.find((c) => c.iso === place.country)?.name ?? null;
    if (germanName !== null && germanName === place.label) return lang.region(place.country, place.label);
  }
  return place.label;
}

/**
 * A name the node gives in German with an English twin (a reference picture's place, a reference
 * truth, a row of the reference set), in the console language. Without the twin (own truths,
 * fixes of older engines) the one name serves both: it is a proper name or the analyst's own text.
 */
export function nameText(lang: Lang, de: string, en?: string | null): string {
  return lang.lang === 'en' && en ? en : de;
}

/**
 * Country of a fix or candidate in the console language, or '' when unknown. A point named only by
 * its coordinates has no country beside it: the country of a world-model answer is the model's
 * likeliest country, which such a point (often at sea) need not lie in.
 */
export function countryText(lang: Lang, place: Pick<FixCandidate, 'country'> & { countryName?: string | null; label?: string }): string {
  if (place.label !== undefined && isCoordLabel(place.label)) return '';
  return place.country ? lang.region(place.country, place.countryName ?? null) : '';
}

/** The radius of a fix as the console states it: "± 1.500 km". */
export function radiusText(lang: Lang, loc: Pick<FixLocation, 'radiusKm'>): string {
  return `± ${kmText(loc.radiusKm, lang.locale)}`;
}

/**
 * The hover text of a radius. An answer of the world model stands for a region (often hundreds of
 * kilometres), not a point: its title says so, so that the circle is not read as a place that was
 * pinned down. '' for every other method.
 */
export function radiusHint(lang: Lang, loc: Pick<FixLocation, 'radiusKm' | 'method'>): string {
  return loc.method === 'worldmodel' ? lang.t('Weltmodell: Region ± {r}', { r: kmText(loc.radiusKm, lang.locale) }) : '';
}

/**
 * A place of more than ± 1 500 km (the engine's widest radius, ± 7 500 km: one answer barely set
 * apart from the others) does not fix a time zone: local time and UTC offset are those of the
 * point assumed. The console says so next to the time; null where the place is close enough.
 */
export function zoneDoubt(lang: Lang, loc: Pick<FixLocation, 'radiusKm'> | null): { text: string; hint: string } | null {
  if (!loc || loc.radiusKm <= 1500) return null;
  return {
    text: lang.t('Zeitzone unsicher'),
    hint: lang.t('Der Ort ist nur auf {r} bestimmt: Ortszeit und Zeitzone gelten für den angenommenen Punkt.', { r: radiusText(lang, loc) }),
  };
}

/**
 * Whether a place label is a bare coordinate pair ("39,4881° N, 13,5324° O"), as the engine
 * names a point without a place name nearby.
 */
export function isCoordLabel(label: string): boolean {
  return /^-?\d+[.,]\d+°\s*[NS],?\s+-?\d+[.,]\d+°\s*[EOW]$/.test(label.trim());
}

export type Stage = 'quick' | 'full';

/** Stage of a fix; fixes of older engine versions have none and count as full. */
export function stageOf(fix: Fix): Stage {
  return fix.stage === 'quick' ? 'quick' : 'full';
}

/** The case name of a recording: its file name without the video extension, in capitals. */
export function caseLabel(name: string): string {
  return name.replace(VIDEO_FILE_PATTERN, '').toUpperCase();
}

/** Whether a recording belongs to the shipped reference set (and not to the analyst's own footage). */
export function isReference(video: VideoInfo): boolean {
  return video.sourceId === 'referenz';
}
