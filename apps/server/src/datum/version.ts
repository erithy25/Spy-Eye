/**
 * Version of the DATUM engine's output. It lives in a module of its own, without imports or side
 * effects, so that the preflight (scripts/datum/check.ts) can compare stored fixes against it
 * without loading the engine and its models.
 *
 * Bumped when the engine changes in a way that makes stored fixes outdated: a stored fix of
 * another version is computed again at start. One of version OLDEST_SHOWN_VERSION or later stays
 * on the map until its new fix is there (the fields the console reads have not changed since);
 * an older one is discarded at once.
 *   5: horizon point (`HorizonMatch.at`), heading pitch/frame/aspect, keyframe pitch, keyframe
 *      with the most sky for the skyline match, date-only file tags no longer taken as an instant.
 *   6: quick stage (`Fix.stage`), every text in German and English (labelEn, detailEn, notesEn),
 *      truth source 'referenz' / 'eigene' with the reference URL in `truth.url`.
 *   7: world model (GeoCLIP): evidence kind 'worldmodel', location method 'worldmodel' where it
 *      replaces the gallery's answer, its modes among the candidates, refitted confidence.
 */
export const ENGINE_VERSION = 7;

/** Stored fixes from this version on are shown while they are computed again (see above). */
export const OLDEST_SHOWN_VERSION = 5;
