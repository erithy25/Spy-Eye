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
 *  10: segments: a recording that shows several places is located stretch by stretch
 *      (`Fix.segments`, `segmentSummary` on slim fixes, evidence kind 'segments'); its place is
 *      that of the longest located stretch (not one at a place the whole file's world model
 *      rejected) unless the answer for the whole file agrees with it.
 *  11: segments complete: every located stretch has its own time of day and sun (`FixSegment.time`,
 *      `sun`) and the fix that of the stretch it shows (the whole file's estimate is evidence of
 *      weight 0, "Ganze Datei (gemischt)"); undetermined stretches name a coarse region where the
 *      gallery and the world model agree (`FixSegment.coarse`); the longest located stretches get
 *      a walkable space of their own (`FixSegment.keyframe.spaceUrl`).
 *  12: one recognised place and undetermined stretches: the fix carries the stretches too (the
 *      undetermined ones may show other places, which the whole file's answer mixes in). Its place
 *      shows above, with its time, sun and spaces, only where its stretches away from the place
 *      the whole file's world model rejected cover at least a fifth of the recording
 *      (`SegmentParams.leadShare`); otherwise the whole file's answer stays above, with its
 *      countries, and the 'segments' evidence entry carries no `frame`, naming no stretch as the
 *      fix's.
 *  13: with GPS in the file, one place in the pictures farther than `sameKm` from the position
 *      gets a 'segments' entry without weight and without `frame` that says where and how far
 *      (gpsApartEvidence): none where a stretch of a chained place lies at the position, only the
 *      stretches away from it named for a place the world model joined, and a place the whole
 *      file's world model rejected said to be that one. Stored engine-12 fixes lack the entry or
 *      carry its first form (commit a3b32a9) and are computed again.
 *  14: frames the localisation samples from the file (reference and street-level pictures) are
 *      named on the analysis scale (`Evidence.frame` as `Keyframe.frame`: frame n at
 *      (n − 1) / sampleFps s), not the file's own frame count; with GPS the countries begin with
 *      the position's country (locate.ts gpsCountries); the first country estimate carries no
 *      weight and says whose it is where the GPS or the world model gives the place; the horizon
 *      entry describes its search square (corners radius·√2) and says when the best point lies on
 *      its edge. Stored engine-13 fixes (98b3b89) carry the file's frame numbers, the pictures'
 *      countries under a GPS place and the old texts, and are computed again.
 *  15: a frame sampled from the file is named by the analysis frame whose interval holds it
 *      (floor, not round: "Bild 71" named the frame after the church at 69.56 s); the quick stage
 *      names its frames no further than the analysis's last frame
 *      (locate.ts analysisFrameCount: round(duration · sampleFps)), as the full stage does; the
 *      first country estimate says which list the fix's countries are where the GPS position lies
 *      in no country (this estimate's, or the world model's: REGION_ROLE.gpsNoCountry*), and where
 *      the stretches' shares of the recording time replace the world model's countries
 *      (segments.ts stretchCountryEvidence). Stored engine-14 fixes (0eaf247, 42ab6cc) may name
 *      "Bild 13" in a clip of 12 analysis frames (quick fixes), or say the countries begin with the
 *      GPS position's country, or are the world model's, where they are not; they are computed
 *      again.
 */
export const ENGINE_VERSION = 15;

/** Stored fixes from this version on are shown while they are computed again (see above). */
export const OLDEST_SHOWN_VERSION = 5;
