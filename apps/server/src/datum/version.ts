/**
 * Version of the DATUM engine's output. It lives in a module of its own, without imports or side
 * effects, so that the preflight (scripts/datum/check.ts) can compare stored fixes against it
 * without loading the engine and its models.
 *
 * Bumped when the engine changes in a way that makes stored fixes outdated: a stored fix of
 * another version is discarded at start and computed again.
 *   5: horizon point (`HorizonMatch.at`), heading pitch/frame/aspect, keyframe pitch, keyframe
 *      with the most sky for the skyline match, date-only file tags no longer taken as an instant.
 */
export const ENGINE_VERSION = 5;
