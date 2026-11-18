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
 *   8: landmark names in both languages (gallery and truths carry labelDe/labelEn from Wikidata):
 *      label from the German, labelEn from the English name, `truth.labelEn`, `refLabelEn` on the
 *      reference evidence; a far reference picture is no longer called a recognition (of the place
 *      found; distances from the GPS position where the file has one); the street-level no-match
 *      text names the condition that failed, a value just below its threshold with the decimals
 *      that keep it below.
 *   9: a reference picture at the answer is called a recognition only when the answer is sure
 *      (GPS of the file, or the 'strong' landmark tier); under a wider radius it is a similarity.
 */
export const ENGINE_VERSION = 9;

/** Stored fixes from this version on are shown while they are computed again (see above). */
export const OLDEST_SHOWN_VERSION = 5;
