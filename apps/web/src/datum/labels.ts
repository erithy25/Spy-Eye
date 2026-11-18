/**
 * How the console words what a fix says: place names, countries, the stage of a fix and the case
 * name of a recording, in the language the analyst chose.
 */
import type { Fix, FixCandidate, FixLocation } from '../../../server/src/datum/contract';
import type { VideoInfo } from '../api';
import { VIDEO_FILE_PATTERN } from '../format';
import type { useLang } from '../i18n';

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
export function placeText(lang: Lang, place: Pick<FixLocation, 'label' | 'country'> & { labelEn?: string; countryName?: string | null }, fix?: Fix | null): string {
  if (lang.lang === 'en' && place.labelEn) return place.labelEn;
  if (CONTINENTS.has(place.label)) return lang.t(place.label);
  if (place.country) {
    const germanName = place.countryName ?? fix?.countries.find((c) => c.iso === place.country)?.name ?? null;
    if (germanName !== null && germanName === place.label) return lang.region(place.country, place.label);
  }
  return place.label;
}

/** Country of a fix or candidate in the console language, or '' when unknown. */
export function countryText(lang: Lang, place: Pick<FixCandidate, 'country'> & { countryName?: string | null }): string {
  return place.country ? lang.region(place.country, place.countryName ?? null) : '';
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
