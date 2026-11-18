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
