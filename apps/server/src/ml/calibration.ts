import type { ModelFamily } from './model.js';

/**
 * Relevance calibration in cosine-similarity space, per model family.
 *
 * Raw image-text similarities are not comparable across prompts: "a wedding" and "street" have
 * very different baselines. The cut-off for "this matches" is therefore derived per prompt from the
 * score distribution of the indexed footage (robust median + k * sigma: a match has to stand out
 * from the rest) and clamped to an absolute band so it also behaves when nothing or everything
 * matches.
 */
export interface RelevanceCalibration {
  /** Below this similarity nothing counts as a match. */
  floor: number;
  /** At or above this similarity everything counts as a match. */
  ceiling: number;
  /** Cut-off used when there is too little footage for meaningful statistics. */
  prior: number;
  /** Similarity distance that maps to one logit of confidence. */
  width: number;
  /** Number of robust standard deviations above the median. */
  k: number;
}

export const RELEVANCE: Readonly<Record<ModelFamily, RelevanceCalibration>> = {
  siglip: { floor: 0.06, ceiling: 0.09, prior: 0.075, width: 0.012, k: 2.5 },
  // SigLIP 2 (base, patch 32): matches lie around 0.13-0.20, unrelated footage below about 0.12.
  siglip2: { floor: 0.105, ceiling: 0.125, prior: 0.118, width: 0.01, k: 2.5 },
  clip: { floor: 0.24, ceiling: 0.285, prior: 0.27, width: 0.012, k: 2.5 },
  mobileclip: { floor: 0.225, ceiling: 0.26, prior: 0.245, width: 0.012, k: 2.5 },
};

/** Sample size from which the distribution-based cut-off is fully trusted. */
export const MIN_SAMPLES_FOR_STATS = 40;

function median(sorted: Float64Array): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = n >> 1;
  return n % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Prompt-specific similarity cut-off from a sample of best-match scores (one per scene or frame). */
export function adaptiveCutoff(scores: Float64Array, cal: RelevanceCalibration): number {
  const n = scores.length;
  if (n === 0) return cal.prior;
  const sorted = Float64Array.from(scores).sort();
  const med = median(sorted);
  const deviations = Float64Array.from(sorted, (v) => Math.abs(v - med)).sort();
  const sigma = 1.4826 * median(deviations);
  const adaptive = Math.min(cal.ceiling, Math.max(cal.floor, med + cal.k * sigma));
  // Blend towards the prior for small samples where the statistics are unreliable.
  const weight = Math.min(1, n / MIN_SAMPLES_FOR_STATS);
  return cal.prior * (1 - weight) + adaptive * weight;
}

/**
 * Calibration of the interactive search, per model family.
 *
 * A short query such as "beach" or "Hund" scores lower than a descriptive sentence, and a scene
 * that is represented by many vectors reaches a higher best score by chance than a single
 * picture. The search therefore judges two views separately, each against its own cut-off:
 *
 * - the whole picture: cut-off from `wholeFloorSingle` (one picture) to `wholeFloorPooled`
 *   (a scene of a dozen pictures or more),
 * - the tiles of a picture, which find small objects but also produce more chance agreement:
 *   cut-off `tileFloor`.
 *
 * Either cut-off rises by up to `span` when the footage as a whole scores high for the query
 * (median + k robust standard deviations). What counts is the larger margin of the two views.
 *
 * Before comparing, `centring` times the mean text embedding is subtracted from the query. Text
 * embeddings share a large common component; removing part of it lowers the agreement that every
 * picture has with every text and noticeably improves the order of the results.
 *
 * The figures for SigLIP 2 were fitted on 97 queries over two sets of footage (see
 * docs/EVALUATION.md). The other families keep their former single cut-off; they have not been
 * measured again.
 */
export interface SearchCalibration {
  centring: number;
  wholeFloorSingle: number;
  wholeFloorPooled: number;
  tileFloor: number;
  span: number;
  k: number;
  /** Margin that maps to one logit of confidence. */
  width: number;
}

const legacySearch = (cal: RelevanceCalibration): SearchCalibration => ({
  centring: 0,
  wholeFloorSingle: cal.floor,
  wholeFloorPooled: cal.floor,
  tileFloor: cal.floor,
  span: cal.ceiling - cal.floor,
  k: cal.k,
  width: cal.width,
});

export const SEARCH_CALIBRATION: Readonly<Record<ModelFamily, SearchCalibration>> = {
  siglip: legacySearch(RELEVANCE.siglip),
  siglip2: { centring: 0.5, wholeFloorSingle: 0.075, wholeFloorPooled: 0.09, tileFloor: 0.11, span: 0.02, k: 3, width: 0.01 },
  clip: legacySearch(RELEVANCE.clip),
  mobileclip: legacySearch(RELEVANCE.mobileclip),
};

/** Number of pictures from which a scene counts as fully pooled. */
const POOLED_FRAMES = 12;

/** Lowest cut-off of the whole-picture view for a scene represented by `frames` pictures. */
export function wholeFloor(cal: SearchCalibration, frames: number): number {
  if (frames <= 1) return cal.wholeFloorSingle;
  const share = Math.min(1, Math.log(frames) / Math.log(POOLED_FRAMES));
  return cal.wholeFloorSingle + (cal.wholeFloorPooled - cal.wholeFloorSingle) * share;
}

/** Robust location and spread of the best scores of all scenes in one view. */
export interface ScoreStats {
  count: number;
  median: number;
  /** Standard deviation estimated from the median absolute deviation. */
  sigma: number;
}

export function scoreStats(scores: Float64Array): ScoreStats {
  if (scores.length === 0) return { count: 0, median: 0, sigma: 0 };
  const sorted = Float64Array.from(scores).sort();
  const med = median(sorted);
  const deviations = Float64Array.from(sorted, (v) => Math.abs(v - med)).sort();
  return { count: scores.length, median: med, sigma: 1.4826 * median(deviations) };
}

/**
 * How far a cut-off is raised above `floor` for one query: not at all while the footage scores
 * low, by at most `span` when it scores high.
 */
export function cutoffLift(stats: ScoreStats, floor: number, cal: SearchCalibration): number {
  if (stats.count === 0) return 0;
  const lift = Math.min(cal.span, Math.max(0, stats.median + cal.k * stats.sigma - floor));
  // Statistics over a handful of scenes say little; trust them in proportion to the sample.
  return lift * Math.min(1, stats.count / MIN_SAMPLES_FOR_STATS);
}
