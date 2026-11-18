/**
 * DATUM time engine: when was the video recorded?
 *
 * 1. File metadata, when present, gives the exact instant.
 * 2. Otherwise the light in the picture is read zero-shot (prompt ensembles against the image
 *    embeddings, fused with simple luminance/colour statistics) as a band of sun elevations, the
 *    season from vegetation and snow as a range of months (or the date from the file name), and
 *    the sun arithmetic turns band + date + place into local clock windows.
 *
 * Everything is computed locally. Notes for the console are German.
 */
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { LightPhase, SunReport, SunState, TimeEstimate, TimeWindow } from './contract.js';
import { intervalsWithElevation, solarPosition, sunEvents, sunPath, sunState } from './sun.js';
import { localDateYmd, localDayBounds, localMinutes, localToUtc, parseYmd, timeZoneFor } from './timezones.js';

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

export interface FrameStats {
  /** Mean luma 0..1. */
  meanLuma: number;
  /** Mean luma of the sky region (top rows), null when no sky region was found. */
  skyLuma: number | null;
  /** Mean (b − r) of the sky region, −1..1, null without sky. */
  skyBlueness: number | null;
  /** Mean (r − b) of the whole frame, −1..1. */
  warmth: number;
  /** Standard deviation of luma (0..0.5). */
  contrast: number;
}

export type EmbedTexts = (texts: string[]) => Promise<Float32Array>;

export interface TimeInput {
  /** n rows of L2-normalised image embeddings. */
  frameEmbeddings: Float32Array;
  dim: number;
  embedTexts: EmbedTexts;
  frameStats: FrameStats[];
  location: { lat: number; lon: number } | null;
  country: string | null;
  metadataUtc: number | null;
  /** YYYY-MM-DD */
  filenameDate: string | null;
  now?: number;
  /**
   * Identifies the text model for the per-process cache of prompt embeddings (e.g. the model id).
   * Without it the cache is keyed by the `embedTexts` function itself, so pass a stable function.
   */
  textCacheKey?: string;
}

export interface TimeResult {
  time: TimeEstimate;
  sun: SunReport | null;
}

// ---------------------------------------------------------------------------------------------
// Zero-shot vocabularies
// ---------------------------------------------------------------------------------------------

export interface LightClass {
  id: 'night' | 'twilight' | 'horizon' | 'golden' | 'daylight' | 'midday' | 'overcast' | 'indoor';
  /** German name for the notes. */
  name: string;
  /** Apparent sun elevation band (degrees); null: the sun says nothing (indoor). */
  band: [number, number] | null;
  phase: LightPhase;
  prompts: string[];
}

export const LIGHT_CLASSES: readonly LightClass[] = [
  {
    id: 'night',
    name: 'Nacht',
    band: [-90, -6],
    phase: 'night',
    prompts: [
      'a photo taken at night',
      'a street at night lit by street lamps under a black sky',
      'a dark night scene with artificial lights',
      'a city at night',
      'a nighttime photo with a pitch dark sky',
    ],
  },
  {
    id: 'twilight',
    name: 'Dämmerung (blaue Stunde)',
    band: [-6, 0],
    phase: 'twilight',
    prompts: [
      'a photo taken at dusk during the blue hour',
      'twilight with a deep blue sky just after sunset',
      'a dim scene at dawn before sunrise',
      'evening twilight, the sky still blue and the street lights turning on',
    ],
  },
  {
    id: 'horizon',
    name: 'Sonnenauf- oder -untergang',
    band: [-1, 6],
    phase: 'golden',
    prompts: [
      'a sunset with the sun on the horizon',
      'a sunrise with the sun just above the horizon',
      'an orange and red sky at sunset',
      'the sun setting behind the horizon',
    ],
  },
  {
    id: 'golden',
    name: 'goldene Stunde',
    band: [2, 12],
    phase: 'golden',
    prompts: [
      'a photo taken during golden hour with long shadows',
      'warm low sunlight casting long shadows',
      'late afternoon golden light',
      'early morning sunshine with long shadows',
    ],
  },
  {
    id: 'daylight',
    name: 'Tageslicht am Vor- oder Nachmittag',
    band: [12, 35],
    phase: 'day',
    prompts: [
      'a photo taken in the morning in daylight',
      'a sunny afternoon',
      'daylight with clear sunshine and medium-length shadows',
      'a scene in bright sunlight with a blue sky',
    ],
  },
  {
    id: 'midday',
    name: 'Mittagssonne',
    band: [35, 90],
    phase: 'day',
    prompts: [
      'a photo taken at noon with the sun high overhead and short shadows',
      'harsh midday sunlight with very short shadows',
      'bright midday sun in summer',
      'the sun directly overhead at noon',
    ],
  },
  {
    id: 'overcast',
    name: 'bedeckter Himmel',
    band: [3, 60],
    phase: 'day',
    prompts: [
      'an overcast day with a grey cloudy sky',
      'a cloudy day with diffuse light and no shadows',
      'grey overcast weather in daytime',
      'a rainy day under grey clouds',
    ],
  },
  {
    id: 'indoor',
    name: 'Innenraum / Kunstlicht',
    band: null,
    phase: 'unknown',
    prompts: [
      'a photo taken indoors under artificial light',
      'an indoor room lit by lamps',
      'inside a building with fluorescent lighting',
      'an interior scene without daylight',
      'inside a road tunnel lit by artificial lights',
    ],
  },
];

export interface SeasonClass {
  id: 'winter' | 'bare' | 'spring' | 'summer' | 'autumn' | 'tropical' | 'arid' | 'rain' | 'urban';
  name: string;
  /** Months for the northern hemisphere (inclusive, may wrap); null: uninformative. */
  months: [number, number] | null;
  prompts: string[];
}

export const SEASON_CLASSES: readonly SeasonClass[] = [
  {
    id: 'winter',
    name: 'Schnee und Winter',
    months: [12, 2],
    prompts: ['a snowy winter landscape', 'snow on the ground in winter', 'a street covered with snow', 'frost and snow in winter'],
  },
  {
    id: 'bare',
    name: 'kahle Bäume',
    months: [11, 3],
    prompts: ['bare leafless trees', 'trees without leaves in winter', 'a park with bare branches and no foliage'],
  },
  {
    id: 'spring',
    name: 'Frühlingsblüte',
    months: [3, 5],
    prompts: ['trees in spring blossom', 'cherry blossoms in spring', 'fresh light green leaves and flowers in spring'],
  },
  {
    id: 'summer',
    name: 'sattes Sommergrün',
    months: [5, 9],
    prompts: ['lush green trees in summer', 'dense green summer foliage', 'a green park on a summer day'],
  },
  {
    id: 'autumn',
    name: 'Herbstlaub',
    months: [9, 11],
    prompts: ['autumn foliage with red and yellow leaves', 'trees with orange autumn leaves', 'fallen leaves on the ground in autumn'],
  },
  {
    id: 'tropical',
    name: 'tropisch immergrün',
    months: null,
    prompts: ['tropical palm trees', 'tropical evergreen vegetation', 'a tropical beach with palm trees'],
  },
  {
    id: 'arid',
    name: 'trocken, Wüste',
    months: null,
    prompts: ['a dry desert landscape', 'arid land with sand and rocks', 'dry brown grass and dust'],
  },
  {
    // Wet, grey scenes otherwise pass for snow.
    id: 'rain',
    name: 'Regen, nasse Straßen',
    months: null,
    prompts: ['a rainy street with wet asphalt', 'heavy rain falling on a street', 'raindrops and wet reflections on the road'],
  },
  {
    id: 'urban',
    name: 'ohne Vegetation',
    months: null,
    prompts: ['a city street with buildings and no trees', 'an indoor scene', 'a close-up of an object'],
  },
];

/**
 * Softmax temperature applied to image–text cosines. SigLIP 2 cosines between images and texts
 * are small (about −0.1..0.2) and differ between classes by a few hundredths; the model's own
 * logit scale is about 110. Tuned on real frames (see report): 100.
 */
export const ZERO_SHOT_TEMPERATURE = 100;

// ---------------------------------------------------------------------------------------------
// Text embeddings (prompt ensembles, cached per process and per embedder)
// ---------------------------------------------------------------------------------------------

const centroidCache = new WeakMap<EmbedTexts, Map<string, Promise<Float32Array>>>();
const centroidCacheByKey = new Map<string, Map<string, Promise<Float32Array>>>();

/**
 * Averaged, re-normalised text embedding per class: `classes.length × dim` values. Cached per
 * process: by `modelKey` when given, else by the identity of `embedTexts`.
 */
export function classCentroids(
  embedTexts: EmbedTexts,
  key: string,
  classes: readonly { prompts: string[] }[],
  modelKey?: string,
): Promise<Float32Array> {
  let perFn = modelKey !== undefined ? centroidCacheByKey.get(modelKey) : centroidCache.get(embedTexts);
  if (!perFn) {
    perFn = new Map();
    if (modelKey !== undefined) centroidCacheByKey.set(modelKey, perFn);
    else centroidCache.set(embedTexts, perFn);
  }
  const cached = perFn.get(key);
  if (cached) return cached;
  const job = (async (): Promise<Float32Array> => {
    const texts = classes.flatMap((c) => c.prompts);
    const rows = await embedTexts(texts);
    const dim = rows.length / texts.length;
    if (!Number.isInteger(dim) || dim <= 0) throw new Error('Text-Encoder lieferte unerwartete Größe.');
    const out = new Float32Array(classes.length * dim);
    let row = 0;
    classes.forEach((c, k) => {
      for (let i = 0; i < c.prompts.length; i++, row++) {
        for (let d = 0; d < dim; d++) out[k * dim + d]! += rows[row * dim + d]!;
      }
      let norm = 0;
      for (let d = 0; d < dim; d++) norm += out[k * dim + d]! ** 2;
      norm = Math.sqrt(norm) || 1;
      for (let d = 0; d < dim; d++) out[k * dim + d]! /= norm;
    });
    return out;
  })();
  perFn.set(key, job);
  const owner = perFn;
  job.catch(() => owner.delete(key));
  return job;
}

/** Mean over frames of the softmax over classes of `temperature × cosine`. */
export function zeroShot(
  frames: Float32Array,
  dim: number,
  centroids: Float32Array,
  classCount: number,
  temperature = ZERO_SHOT_TEMPERATURE,
): number[] {
  const n = dim > 0 ? Math.floor(frames.length / dim) : 0;
  const mean = new Array<number>(classCount).fill(0);
  if (n === 0 || centroids.length !== classCount * dim) return mean.map(() => 1 / classCount);
  const logits = new Array<number>(classCount).fill(0);
  for (let f = 0; f < n; f++) {
    let max = -Infinity;
    for (let k = 0; k < classCount; k++) {
      let dot = 0;
      for (let d = 0; d < dim; d++) dot += frames[f * dim + d]! * centroids[k * dim + d]!;
      logits[k] = temperature * dot;
      if (logits[k]! > max) max = logits[k]!;
    }
    let sum = 0;
    for (let k = 0; k < classCount; k++) {
      logits[k] = Math.exp(logits[k]! - max);
      sum += logits[k]!;
    }
    for (let k = 0; k < classCount; k++) mean[k]! += logits[k]! / sum / n;
  }
  return mean;
}

// ---------------------------------------------------------------------------------------------
// Light: zero-shot fused with frame statistics
// ---------------------------------------------------------------------------------------------

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Mean of the per-frame statistics (sky values over frames that have a sky). */
export function meanFrameStats(stats: readonly FrameStats[]): FrameStats | null {
  if (stats.length === 0) return null;
  let luma = 0;
  let warmth = 0;
  let contrast = 0;
  let skyL = 0;
  let skyB = 0;
  let skyN = 0;
  for (const s of stats) {
    luma += s.meanLuma;
    warmth += s.warmth;
    contrast += s.contrast;
    if (s.skyLuma !== null && s.skyBlueness !== null) {
      skyL += s.skyLuma;
      skyB += s.skyBlueness;
      skyN++;
    }
  }
  const n = stats.length;
  return {
    meanLuma: luma / n,
    warmth: warmth / n,
    contrast: contrast / n,
    skyLuma: skyN > 0 ? skyL / skyN : null,
    skyBlueness: skyN > 0 ? skyB / skyN : null,
  };
}

/** Log-likelihood adjustments per light class from the image statistics. */
export function statsAdjustment(s: FrameStats | null): Record<LightClass['id'], number> {
  const adj: Record<LightClass['id'], number> = {
    night: 0,
    twilight: 0,
    horizon: 0,
    golden: 0,
    daylight: 0,
    midday: 0,
    overcast: 0,
    indoor: 0,
  };
  if (!s) return adj;
  const dark = clamp01((0.25 - s.meanLuma) / 0.2); // 1 at luma ≤ 0.05
  const bright = clamp01((s.meanLuma - 0.35) / 0.25);
  const highContrast = clamp01((s.contrast - 0.12) / 0.12);
  const blueSky = s.skyBlueness !== null ? clamp01((s.skyBlueness - 0.02) / 0.15) : 0;
  const greySky = s.skyBlueness !== null ? clamp01(1 - Math.abs(s.skyBlueness) / 0.05) * clamp01(((s.skyLuma ?? 0) - 0.4) / 0.3) : 0;
  const warm = clamp01((s.warmth - 0.1) / 0.15);
  adj.night += 2.0 * dark - 1.5 * bright - 1.0 * blueSky * (1 - dark);
  adj.twilight += 1.0 * dark - 0.8 * bright + 0.3 * warm * (1 - highContrast);
  adj.horizon += 0.3 * dark + 0.8 * warm;
  adj.golden += 0.8 * warm - 0.5 * dark;
  adj.daylight += -1.0 * dark + 0.3 * bright + 0.8 * blueSky * highContrast;
  adj.midday += -1.5 * dark + 0.5 * bright + 0.8 * blueSky * highContrast - 0.3 * warm;
  adj.overcast += -0.8 * dark - 0.8 * blueSky + 0.6 * greySky * (1 - highContrast);
  return adj;
}

export interface LightReading {
  /** Fused probability per class (sums to 1). */
  probs: Record<LightClass['id'], number>;
  top: LightClass;
  phase: LightPhase;
  band: [number, number] | null;
  confidence: number;
}

/** Turns zero-shot class probabilities and image statistics into phase, band and confidence. */
export function readLight(zeroShotProbs: readonly number[], stats: FrameStats | null, hasEmbeddings: boolean): LightReading {
  const adj = statsAdjustment(stats);
  const raw = LIGHT_CLASSES.map((c, k) => Math.max(1e-9, zeroShotProbs[k] ?? 0) * Math.exp(adj[c.id]));
  const total = raw.reduce((a, b) => a + b, 0);
  const p = raw.map((v) => v / total);
  const probs = Object.fromEntries(LIGHT_CLASSES.map((c, k) => [c.id, p[k]!])) as Record<LightClass['id'], number>;
  const order = LIGHT_CLASSES.map((c, k) => ({ c, p: p[k]! })).sort((a, b) => b.p - a.p);
  const top = order[0]!.c;
  if (top.band === null && order[0]!.p >= 0.35) {
    return { probs, top, phase: 'unknown', band: null, confidence: 0 };
  }
  // Outdoor reading: renormalise without the indoor class.
  const outdoor = order.filter((o) => o.c.band !== null);
  const outdoorMass = outdoor.reduce((a, o) => a + o.p, 0) || 1;
  const phaseScore = new Map<LightPhase, number>();
  for (const o of outdoor) phaseScore.set(o.c.phase, (phaseScore.get(o.c.phase) ?? 0) + o.p / outdoorMass);
  let phase: LightPhase = 'unknown';
  let phaseP = 0;
  for (const [ph, v] of phaseScore) {
    if (v > phaseP) {
      phase = ph;
      phaseP = v;
    }
  }
  // Band: union of the most probable classes' bands (until 70 % of the mass; each class at least
  // 15 % and at least 40 % of the best one).
  let lo = Infinity;
  let hi = -Infinity;
  let cumulative = 0;
  const topShare = outdoor[0]!.p / outdoorMass;
  for (const [i, o] of outdoor.entries()) {
    const share = o.p / outdoorMass;
    if (i > 0 && (cumulative >= 0.7 || share < 0.15 || share < 0.4 * topShare)) break;
    cumulative += share;
    const band = o.c.band as [number, number];
    lo = Math.min(lo, band[0]);
    hi = Math.max(hi, band[1]);
  }
  const topOutdoor = outdoor[0]!.c;
  let confidence = phaseP * (1 - probs.indoor) * (hasEmbeddings ? 1 : 0.5);
  if (topOutdoor.id === 'overcast') confidence *= 0.6;
  // A wide band says little.
  confidence *= hi - lo > 40 ? 0.7 : 1;
  return { probs, top: topOutdoor, phase, band: [lo, hi], confidence: Math.max(0.05, Math.min(0.85, confidence)) };
}

// ---------------------------------------------------------------------------------------------
// Season
// ---------------------------------------------------------------------------------------------

const MONTHS_DE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
] as const;

const monthName = (m: number): string => MONTHS_DE[(m - 1 + 12) % 12]!;

/** Months 1..12 contained in an inclusive, possibly wrapping range. */
export function monthsOfRange(range: [number, number]): number[] {
  const out: number[] = [];
  for (let m = range[0]; ; m = (m % 12) + 1) {
    out.push(m);
    if (m === range[1] || out.length >= 12) break;
  }
  return out;
}

/** Smallest wrapping range covering a set of months; null when the set is empty or all 12. */
export function rangeOfMonths(months: Iterable<number>): [number, number] | null {
  const set = new Set(months);
  if (set.size === 0 || set.size >= 12) return null;
  // Start right after the longest circular run of missing months.
  let bestStart = 1;
  let bestLen = -1;
  for (let m = 1; m <= 12; m++) {
    if (set.has(m)) continue;
    const prev = ((m - 2 + 12) % 12) + 1;
    if (set.has(prev)) {
      let len = 0;
      while (len < 12 && !set.has(((m - 1 + len) % 12) + 1)) len++;
      if (len > bestLen) {
        bestLen = len;
        bestStart = ((m - 1 + len) % 12) + 1;
      }
    }
  }
  const end = ((bestStart - 1 + (12 - bestLen) - 1) % 12) + 1;
  return [bestStart, end];
}

const shiftRange = (r: [number, number], by: number): [number, number] => [
  ((r[0] - 1 + by) % 12) + 1,
  ((r[1] - 1 + by) % 12) + 1,
];

export interface SeasonReading {
  /** Northern-hemisphere months, or null when uninformative. */
  monthsNorth: [number, number] | null;
  top: SeasonClass;
  p: number;
}

/** Month range from the season classes' probabilities (northern hemisphere). */
export function readSeason(probs: readonly number[]): SeasonReading {
  const order = SEASON_CLASSES.map((c, k) => ({ c, p: probs[k] ?? 0 })).sort((a, b) => b.p - a.p);
  const first = order[0]!;
  if (first.c.months === null || first.p < 0.3) return { monthsNorth: null, top: first.c, p: first.p };
  const months = new Set(monthsOfRange(first.c.months));
  const second = order[1];
  if (second && second.c.months !== null && second.p >= 0.6 * first.p) {
    const extra = monthsOfRange(second.c.months);
    // Only adjacent or overlapping seasons are merged into one range.
    if (extra.some((m) => months.has(m) || months.has((m % 12) + 1) || months.has(((m - 2 + 12) % 12) + 1))) {
      for (const m of extra) months.add(m);
    }
  }
  return { monthsNorth: rangeOfMonths(months), top: first.c, p: first.p };
}

// ---------------------------------------------------------------------------------------------
// Clock windows
// ---------------------------------------------------------------------------------------------

export interface Place {
  lat: number;
  lon: number;
  timeZone: string;
}

export interface LabelledPiece {
  start: number;
  end: number;
  startMin: number;
  endMin: number;
  label: string;
}

function labelAt(t: number, place: Place): string {
  const p = solarPosition(t, place.lat, place.lon);
  if (p.elevationDeg < -6) return 'Nacht';
  const min = localMinutes(t, place.timeZone);
  if (p.hourAngleDeg < 0) return p.elevationDeg < 10 || min < 9 * 60 ? 'Morgen' : 'Vormittag';
  return p.elevationDeg < 10 || min >= 18 * 60 ? 'Abend' : 'Nachmittag';
}

/**
 * Intervals of the local day inside the band with German labels, split at solar noon and where
 * the sun crosses −6° (end of civil twilight), so that each piece has one meaning.
 */
export function labelledPieces(dateYmd: string, place: Place, band: [number, number]): LabelledPiece[] {
  const { end: dayEnd } = localDayBounds(dateYmd, place.timeZone);
  const noon = sunEvents(dateYmd, place.lat, place.lon, place.timeZone).solarNoon;
  const cuts = [noon];
  if (band[0] < -6 && band[1] > -6) {
    for (const n of intervalsWithElevation(dateYmd, place.lat, place.lon, place.timeZone, -90, -6)) cuts.push(n.start, n.end);
  }
  cuts.sort((a, b) => a - b);
  const out: LabelledPiece[] = [];
  for (const iv of intervalsWithElevation(dateYmd, place.lat, place.lon, place.timeZone, band[0], band[1])) {
    const parts: Array<{ start: number; end: number }> = [];
    let from = iv.start;
    for (const c of cuts) {
      if (c > from && c < iv.end) {
        parts.push({ start: from, end: c });
        from = c;
      }
    }
    parts.push({ start: from, end: iv.end });
    for (const part of parts) {
      if (part.end - part.start < 60000) continue;
      const startMin = localMinutes(part.start, place.timeZone);
      let endMin = part.end >= dayEnd ? 1440 : localMinutes(part.end, place.timeZone);
      if (endMin <= startMin) endMin = 1440;
      out.push({ ...part, startMin, endMin, label: labelAt((part.start + part.end) / 2, place) });
    }
  }
  return out;
}

/** Pieces of the same label closer than this (minutes) are merged into one window. */
const MERGE_GAP_MIN = 120;

/**
 * Clock windows where the sun is inside `band`, over one or more dates (weights per date), merged
 * per label. Probabilities are proportional to duration within each date.
 */
export function clockWindows(dates: ReadonlyArray<{ date: string; weight: number }>, place: Place, band: [number, number]): TimeWindow[] {
  const pieces: Array<{ startMin: number; endMin: number; label: string; w: number }> = [];
  for (const { date, weight } of dates) {
    const parts = labelledPieces(date, place, band);
    const total = parts.reduce((a, p) => a + (p.end - p.start), 0);
    if (total <= 0) continue;
    for (const p of parts) pieces.push({ startMin: p.startMin, endMin: p.endMin, label: p.label, w: (weight * (p.end - p.start)) / total });
  }
  const totalW = pieces.reduce((a, p) => a + p.w, 0);
  if (totalW <= 0) return [];
  const merged: Array<{ startMin: number; endMin: number; label: string; w: number }> = [];
  const byLabel = new Map<string, typeof pieces>();
  for (const p of pieces) {
    const list = byLabel.get(p.label) ?? [];
    list.push(p);
    byLabel.set(p.label, list);
  }
  for (const [label, list] of byLabel) {
    list.sort((a, b) => a.startMin - b.startMin);
    let cur: (typeof merged)[number] | null = null;
    for (const p of list) {
      if (cur && p.startMin <= cur.endMin + MERGE_GAP_MIN) {
        cur.endMin = Math.max(cur.endMin, p.endMin);
        cur.w += p.w;
      } else {
        if (cur) merged.push(cur);
        cur = { startMin: p.startMin, endMin: p.endMin, label, w: p.w };
      }
    }
    if (cur) merged.push(cur);
  }
  return merged
    .map((m) => ({
      startMin: Math.max(0, Math.min(1439, Math.round(m.startMin))),
      endMin: Math.max(0, Math.min(1439, Math.round(m.endMin))),
      label: m.label,
      probability: m.w / totalW,
    }))
    .filter((w) => w.probability >= 0.01)
    .sort((a, b) => b.probability - a.probability || a.startMin - b.startMin);
}

// ---------------------------------------------------------------------------------------------
// Formatting helpers (German)
// ---------------------------------------------------------------------------------------------

const deg = (v: number): string => `${v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`;
const pct = (v: number): string => `${Math.round(v * 100)} %`;
const clock = (min: number): string => {
  const m = Math.round(min) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const dateDe = (ymd: string): string => {
  const { year, month, day } = parseYmd(ymd);
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
};

function bandText(band: [number, number]): string {
  if (band[1] <= -6 && band[0] <= -80) return `unter ${deg(band[1])}° (Nacht)`;
  if (band[0] <= -80) return `unter ${deg(band[1])}°`;
  return `${deg(band[0])} bis ${deg(band[1])}°`;
}

function phaseOfElevation(el: number): LightPhase {
  if (el < -6) return 'night';
  if (el < -0.833) return 'twilight';
  if (el < 10) return 'golden';
  return 'day';
}

function validYmd(s: string | null): string | null {
  if (s === null) return null;
  try {
    const { year, month, day } = parseYmd(s);
    const d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
    return s.trim();
  } catch {
    return null;
  }
}

function sunReportFor(date: string, place: Place, at: number | null): SunReport {
  const ev = sunEvents(date, place.lat, place.lon, place.timeZone);
  const state: SunState | null = at === null ? null : sunState(at, place.lat, place.lon);
  return {
    date,
    at: state,
    path: sunPath(date, place.lat, place.lon, place.timeZone, 10),
    sunrise: ev.sunrise,
    sunset: ev.sunset,
    solarNoon: ev.solarNoon,
  };
}

// ---------------------------------------------------------------------------------------------
// Estimate
// ---------------------------------------------------------------------------------------------

async function lightAndSeason(input: TimeInput): Promise<{ light: LightReading; seasonProbs: number[] | null }> {
  const dim = input.dim;
  const n = dim > 0 ? Math.floor(input.frameEmbeddings.length / dim) : 0;
  const stats = meanFrameStats(input.frameStats);
  if (n === 0) {
    return { light: readLight(LIGHT_CLASSES.map(() => 1 / LIGHT_CLASSES.length), stats, false), seasonProbs: null };
  }
  const [lightC, seasonC] = await Promise.all([
    classCentroids(input.embedTexts, 'light', LIGHT_CLASSES, input.textCacheKey),
    classCentroids(input.embedTexts, 'season', SEASON_CLASSES, input.textCacheKey),
  ]);
  if (lightC.length !== LIGHT_CLASSES.length * dim) {
    // Text and image embeddings of different models: the zero-shot reading is meaningless.
    return { light: readLight(LIGHT_CLASSES.map(() => 1 / LIGHT_CLASSES.length), stats, false), seasonProbs: null };
  }
  const lightP = zeroShot(input.frameEmbeddings, dim, lightC, LIGHT_CLASSES.length);
  const seasonP = zeroShot(input.frameEmbeddings, dim, seasonC, SEASON_CLASSES.length);
  return { light: readLight(lightP, stats, true), seasonProbs: seasonP };
}

/** Estimates the recording time (and the sun at that time) for one video. */
export async function estimateTime(input: TimeInput): Promise<TimeResult> {
  const now = input.now ?? Date.now();
  const loc = input.location;
  const zone = loc ? timeZoneFor(loc.lat, loc.lon, input.country) : null;
  const place: Place | null = loc && zone ? { lat: loc.lat, lon: loc.lon, timeZone: zone } : null;
  const { light, seasonProbs } = await lightAndSeason(input);

  // --- 1. Exact instant from metadata --------------------------------------------------------
  if (input.metadataUtc !== null && Number.isFinite(input.metadataUtc)) {
    const utc = input.metadataUtc;
    const tz = zone ?? 'UTC';
    const date = localDateYmd(utc, tz);
    const minute = Math.floor(localMinutes(utc, tz));
    const notes: string[] = [`Aufnahmezeit aus den Metadaten der Datei: ${dateDe(date)}, ${clock(minute)} Uhr (${zone ?? 'UTC, Ort unbekannt'}).`];
    let phase: LightPhase = light.phase;
    let sun: SunReport | null = null;
    if (place) {
      sun = sunReportFor(date, place, utc);
      const el = sun.at!.elevationDeg;
      phase = phaseOfElevation(el);
      notes.push(`Sonne zu diesem Zeitpunkt: ${deg(el)}° hoch, Azimut ${deg(sun.at!.azimuthDeg)}°.`);
      if (light.band && light.confidence >= 0.4) {
        const inside = el >= light.band[0] - 5 && el <= light.band[1] + 5;
        notes.push(
          inside
            ? 'Das Licht im Bild passt zum Sonnenstand dieser Uhrzeit.'
            : `Achtung: Das Licht im Bild (${light.top.name}) passt nicht zum Sonnenstand der Metadaten; Zeitstempel prüfen.`,
        );
      }
    }
    const time: TimeEstimate = {
      method: 'metadata',
      utc,
      date,
      dateSource: 'metadata',
      monthRange: null,
      timezone: zone ?? 'UTC',
      windows: [{ startMin: Math.max(0, minute - 1), endMin: Math.min(1439, minute + 1), label: labelFor(utc, place, tz), probability: 1 }],
      sunElevationBand: light.band,
      phase,
      confidence: 0.95,
      notes,
    };
    return { time, sun };
  }

  // --- 2. Date: file name or season ---------------------------------------------------------
  const notes: string[] = [];
  const year = new Date(now).getUTCFullYear();
  let date = validYmd(input.filenameDate);
  if (date !== null && Date.UTC(parseYmd(date).year, parseYmd(date).month - 1, parseYmd(date).day) > now + 86400000) {
    notes.push(`Datum im Dateinamen (${dateDe(date)}) liegt in der Zukunft und wird nicht verwendet.`);
    date = null;
  }
  let monthRange: [number, number] | null = null;
  let dateSource: TimeEstimate['dateSource'] = 'none';
  let seasonNote: string | null = null;
  if (date !== null) {
    dateSource = 'filename';
    notes.push(`Datum aus dem Dateinamen: ${dateDe(date)}.`);
  } else if (seasonProbs) {
    const season = readSeason(seasonProbs);
    const lat = loc?.lat ?? null;
    if (season.monthsNorth === null) {
      seasonNote = `Jahreszeit nicht erkennbar (${season.top.name}); alle Monate berücksichtigt.`;
    } else if (lat !== null && Math.abs(lat) < 10) {
      seasonNote = `Nahe am Äquator sagt die Vegetation (${season.top.name}) nichts über den Monat; alle Monate berücksichtigt.`;
    } else {
      const south = lat !== null && lat < -10;
      monthRange = south ? shiftRange(season.monthsNorth, 6) : season.monthsNorth;
      dateSource = 'season';
      const hemi = lat === null ? ', Nordhalbkugel angenommen' : south ? ', Südhalbkugel' : '';
      seasonNote = `Jahreszeit aus dem Bild: ${season.top.name} (${pct(season.p)}) – ${monthName(monthRange[0])} bis ${monthName(monthRange[1])}${hemi}.`;
    }
  } else {
    seasonNote = 'Keine Bildmerkmale für die Jahreszeit; alle Monate berücksichtigt.';
  }

  // --- 3. Light → band → clock windows ------------------------------------------------------
  const band = light.band;
  const reasonPlace: Place = place ?? { lat: 45, lon: 0, timeZone: 'UTC' };
  const months = monthRange ? monthsOfRange(monthRange) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const mm = (m: number): string => String(m).padStart(2, '0');
  const dates = date !== null ? [{ date, weight: 1 }] : months.map((m) => ({ date: `${year}-${mm(m)}-15`, weight: 1 }));
  const bestDate = date ?? (monthRange ? `${year}-${mm(months[Math.floor((months.length - 1) / 2)]!)}-15` : `${year}-03-20`);

  if (band === null) {
    notes.unshift(`Licht im Bild: ${light.top.name} (${pct(light.probs.indoor)}); die Sonne ist nicht zu sehen, die Uhrzeit bleibt offen.`);
    if (seasonNote && date === null) notes.push(seasonNote);
    const time: TimeEstimate = {
      method: 'none',
      utc: null,
      date,
      dateSource,
      monthRange,
      timezone: zone,
      windows: [],
      sunElevationBand: null,
      phase: 'unknown',
      confidence: 0,
      notes: notes.slice(0, 5),
    };
    return { time, sun: place ? sunReportFor(bestDate, place, null) : null };
  }

  const windows = clockWindows(dates, reasonPlace, band);
  const lightNote =
    light.top.id === 'night' || light.top.id === 'twilight'
      ? `Sonnenhöhe aus dem Licht: ${bandText(band)} – ${light.top.name} (${pct(light.probs[light.top.id])}).`
      : `Sonnenhöhe aus Licht und Schatten: ${bandText(band)} – ${light.top.name} (${pct(light.probs[light.top.id])}).`;
  const out: string[] = [lightNote, ...notes];
  if (seasonNote && date === null) out.push(seasonNote);
  const am = windows.find((w) => w.label === 'Morgen' || w.label === 'Vormittag');
  const pm = windows.find((w) => w.label === 'Nachmittag' || w.label === 'Abend');
  if (am && pm) out.push(`${am.label} und ${pm.label} sind aus der Sonnenhöhe allein nicht zu unterscheiden.`);
  if (!place) out.push('Ort unbekannt: Uhrzeiten als Sonnenzeit für 45° nördlicher Breite geschätzt.');
  if (windows.length === 0) out.push('An diesem Ort und Datum erreicht die Sonne diese Höhe nicht; Licht oder Datum prüfen.');

  const dateFactor = date !== null ? 1 : monthRange ? 0.85 : 0.7;
  const placeFactor = place ? 1 : 0.7;
  const confidence = windows.length === 0 ? 0.05 : Math.min(0.8, light.confidence * dateFactor * placeFactor);

  let sun: SunReport | null = null;
  if (place) {
    let at: number | null = null;
    const best = windows[0];
    if (best) {
      const pieces = labelledPieces(bestDate, place, band).filter((p) => p.label === best.label);
      const piece = pieces.sort((a, b) => b.end - b.start - (a.end - a.start))[0];
      at = piece ? (piece.start + piece.end) / 2 : localToUtc(bestDate, (best.startMin + best.endMin) / 2, place.timeZone);
    }
    sun = sunReportFor(bestDate, place, at);
  }

  const time: TimeEstimate = {
    method: 'sun',
    utc: null,
    date,
    dateSource,
    monthRange,
    timezone: zone,
    windows,
    sunElevationBand: band,
    phase: light.phase,
    confidence,
    notes: out.slice(0, 5),
  };
  return { time, sun };
}

function labelFor(t: number, place: Place | null, tz: string): string {
  if (place) return labelAt(t, place);
  const m = localMinutes(t, tz);
  if (m < 5 * 60 || m >= 22 * 60) return 'Nacht';
  if (m < 9 * 60) return 'Morgen';
  if (m < 12 * 60) return 'Vormittag';
  if (m < 18 * 60) return 'Nachmittag';
  return 'Abend';
}

// ---------------------------------------------------------------------------------------------
// Frame statistics
// ---------------------------------------------------------------------------------------------

/** Statistics of an RGB(A) raster (8 bit per channel). */
export function frameStatsFromRgb(data: Uint8Array, width: number, height: number, channels = 3): FrameStats {
  const n = width * height;
  if (n === 0) return { meanLuma: 0, skyLuma: null, skyBlueness: null, warmth: 0, contrast: 0 };
  const skyRows = Math.max(1, Math.round(height * 0.25));
  let sumL = 0;
  let sumL2 = 0;
  let sumRB = 0;
  let topL = 0;
  let topBR = 0;
  let topN = 0;
  let restL = 0;
  let restN = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i]! / 255;
      const g = data[i + 1]! / 255;
      const b = data[i + 2]! / 255;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sumL += l;
      sumL2 += l * l;
      sumRB += r - b;
      if (y < skyRows) {
        topL += l;
        topBR += b - r;
        topN++;
      } else {
        restL += l;
        restN++;
      }
    }
  }
  const meanLuma = sumL / n;
  const contrast = Math.sqrt(Math.max(0, sumL2 / n - meanLuma * meanLuma));
  const top = topL / topN;
  const rest = restN > 0 ? restL / restN : top;
  // Margin against compression noise in flat frames.
  const hasSky = restN > 0 && top > rest + 0.01;
  return {
    meanLuma,
    skyLuma: hasSky ? top : null,
    skyBlueness: hasSky ? topBR / topN : null,
    warmth: sumRB / n,
    contrast,
  };
}

/** Statistics of a JPEG (or any image sharp reads), downscaled to 64 px width. */
export async function frameStatsFromJpeg(path: string): Promise<FrameStats> {
  // Decode from memory: libvips can keep a file handle open when it opens the path itself.
  const encoded = await readFile(path);
  const { data, info } = await sharp(encoded, { failOn: 'none' })
    .resize({ width: 64 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return frameStatsFromRgb(data, info.width, info.height, info.channels);
}
