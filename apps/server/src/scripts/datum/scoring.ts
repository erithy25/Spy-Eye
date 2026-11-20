/** Pure helpers of the localisation measurement (scripts/datum/evaluate.ts), testable on their own. */

import { decideLocation, type LocateEvidence, type LocateParams, type LocateResult } from '../../datum/locate.js';
import type { World } from '../../datum/world.js';

/**
 * The decision the measurement scores: the pictures' alone. The file's metadata is left out, since
 * GPS in the file would answer trivially: its position is the place, and since engine 14 its
 * country leads the fix's countries (locate.ts gpsCountries), so that every clip with GPS would
 * count as "Land richtig" whatever the pictures say. Whether a clip has GPS is reported on its own
 * (`gpsInFile`). Without GPS the decision is the same as with the metadata.
 */
export function scoredDecision(world: World, ev: LocateEvidence, params: LocateParams): LocateResult {
  return decideLocation(world, { ...ev, metadata: null }, params);
}

/**
 * "Land richtig": the first country of the fix's list is one of the truth's (the shape the point
 * falls in and the manifest's); null without a truth country.
 */
export function countryCorrect(r: Pick<LocateResult, 'countries'>, truthIsos: readonly string[]): boolean | null {
  return truthIsos.length > 0 ? truthIsos.includes(r.countries[0]?.iso ?? '') : null;
}
