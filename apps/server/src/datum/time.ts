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
  /**
   * Calendar date from the file's tags when they carry a date but no time of day (YYYY-MM-DD).
   * Used for the sun path like a date from the file name, which takes precedence.
   */
  metadataDate?: string | null;
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

/** German labels of the parts of the day; the index addresses the per-bin label mass in coreWindows. */
const DAY_LABELS = ['Nacht', 'Morgen', 'Vormittag', 'Nachmittag', 'Abend'] as const;
type DayLabel = (typeof DAY_LABELS)[number];

/** German label of a moment from the sun's elevation, its hour angle and the local clock minute. */
function labelOfSun(elevationDeg: number, hourAngleDeg: number, localMin: number): DayLabel {
  if (elevationDeg < -6) return 'Nacht';
  if (hourAngleDeg < 0) return elevationDeg < 10 || localMin < 9 * 60 ? 'Morgen' : 'Vormittag';
  return elevationDeg < 10 || localMin >= 18 * 60 ? 'Abend' : 'Nachmittag';
}

function labelAt(t: number, place: Place): string {
  const p = solarPosition(t, place.lat, place.lon);
  // The local minute only matters by day; skip the time-zone lookup at night.
  return labelOfSun(p.elevationDeg, p.hourAngleDeg, p.elevationDeg < -6 ? 0 : localMinutes(t, place.timeZone));
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

/**
 * Share of the probability mass the core windows hold at least (highest-density region of the
 * clock). Plateaus and closed gaps can make the windows hold more; the notes state the actual sum.
 */
export const CORE_MASS = 0.6;
const CORE_STEP_MIN = 5;

/**
 * Core clock windows: the light classes are read as a density over sun elevation (each class
 * spreads its probability evenly over its band), mapped through the sun's course on the possible
 * dates into a density over the local clock, and the smallest set of minutes holding at least
 * CORE_MASS of it is returned as windows. Narrower than the union of the bands, and still an
 * honest statement: each window carries the probability mass it actually holds. A window is
 * labelled by the label that carries most of its density over all its minutes and dates, so a
 * long night window whose densest minutes lie in the twilight at its ends stays "Nacht".
 */
export function coreWindows(
  dates: ReadonlyArray<{ date: string; weight: number }>,
  place: Place,
  probs: Record<LightClass['id'], number>,
): { windows: TimeWindow[]; modeMin: number | null } {
  const steps = 1440 / CORE_STEP_MIN;
  const dens = new Float64Array(steps);
  // Density per bin and label: labelMass[i * DAY_LABELS.length + k].
  const labelMass = new Float64Array(steps * DAY_LABELS.length);
  const classes = LIGHT_CLASSES.filter((c) => c.band !== null && (probs[c.id] ?? 0) > 0.01);
  if (classes.length === 0) return { windows: [], modeMin: null };
  for (const { date, weight } of dates) {
    for (let i = 0; i < steps; i++) {
      const minute = i * CORE_STEP_MIN + CORE_STEP_MIN / 2;
      const at = localToUtc(date, minute, place.timeZone);
      const sun = solarPosition(at, place.lat, place.lon);
      const el = sun.elevationDeg;
      let d = 0;
      for (const c of classes) {
        const [lo, hi] = c.band as [number, number];
        if (el >= lo && el <= hi) d += (probs[c.id] ?? 0) / Math.max(6, hi - lo);
      }
      dens[i] = (dens[i] ?? 0) + weight * d;
      if (d > 0) {
        const k = DAY_LABELS.indexOf(labelOfSun(el, sun.hourAngleDeg, minute));
        const j = i * DAY_LABELS.length + k;
        labelMass[j] = (labelMass[j] ?? 0) + weight * d;
      }
    }
  }
  const total = dens.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return { windows: [], modeMin: null };
  const order = Array.from({ length: steps }, (_, i) => i).sort((a, b) => dens[b]! - dens[a]!);
  // Density level at which the mass reaches CORE_MASS; every minute at least that dense is taken,
  // so equally likely minutes (a plateau) are never split arbitrarily.
  let acc = 0;
  let level = 0;
  for (const i of order) {
    acc += dens[i]!;
    level = dens[i]!;
    if (acc >= CORE_MASS * total) break;
  }
  const chosen = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) if (dens[i]! > 0 && dens[i]! >= level * (1 - 1e-9)) chosen[i] = 1;
  // Close gaps up to 20 minutes, then collect runs (a run may wrap around midnight).
  const gap = Math.round(20 / CORE_STEP_MIN);
  for (let i = 0; i < steps; i++) {
    if (chosen[i]) continue;
    let l = 1;
    while (l <= gap && !chosen[(i - l + steps) % steps]) l++;
    let r = 1;
    while (r <= gap && !chosen[(i + r) % steps]) r++;
    if (l <= gap && r <= gap && l + r - 1 <= gap) chosen[i] = 2;
  }
  const start = chosen.findIndex((c) => c === 0);
  if (start < 0) return { windows: [{ startMin: 0, endMin: 1439, label: 'ganztägig', probability: 1 }], modeMin: order[0]! * CORE_STEP_MIN };
  const runs: Array<{ from: number; len: number; mass: number }> = [];
  for (let k = 1; k <= steps; k++) {
    const i = (start + k) % steps;
    if (!chosen[i]) continue;
    const prev = runs[runs.length - 1];
    const j = (i - 1 + steps) % steps;
    if (prev && chosen[j]) {
      prev.len++;
      prev.mass += dens[i]!;
    } else runs.push({ from: i, len: 1, mass: dens[i]! });
  }
  const windows = runs
    .filter((r) => r.mass / total >= 0.04)
    .map((r) => {
      const startMin = r.from * CORE_STEP_MIN;
      const endMin = ((r.from + r.len) * CORE_STEP_MIN) % 1440;
      // Density-weighted majority over all bins of the run (closed gaps included) and all dates.
      const byLabel = new Float64Array(DAY_LABELS.length);
      for (let n = 0; n < r.len; n++) {
        const i = (r.from + n) % steps;
        for (let k = 0; k < DAY_LABELS.length; k++) byLabel[k] = byLabel[k]! + labelMass[i * DAY_LABELS.length + k]!;
      }
      let best = 0;
      for (let k = 1; k < DAY_LABELS.length; k++) if (byLabel[k]! > byLabel[best]!) best = k;
      return { startMin, endMin: endMin === 0 ? 1439 : endMin, label: DAY_LABELS[best]!, probability: r.mass / total };
    })
    .sort((a, b) => b.probability - a.probability);
  return { windows, modeMin: order[0]! * CORE_STEP_MIN + CORE_STEP_MIN / 2 };
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

/**
 * Clock ranges in which the sun stands in the band, as a German clause ("möglich ist 05:05–06:23
 * oder 19:53–21:12 Uhr"). Windows that touch or overlap are merged, and a range that ends at
 * midnight is joined with the one that starts at 00:00, so a night reads 16:36–07:33 instead of
 * two pieces; the gaps between ranges are never reported as possible.
 */
export function possibleClause(windows: ReadonlyArray<TimeWindow>): string {
  const ranges: Array<{ s: number; e: number }> = [];
  for (const w of [...windows].sort((a, b) => a.startMin - b.startMin)) {
    const last = ranges[ranges.length - 1];
    // Neighbouring windows share their edge minute (or differ by one after rounding).
    if (last && w.startMin <= last.e + 1) last.e = Math.max(last.e, w.endMin);
    else ranges.push({ s: w.startMin, e: w.endMin });
  }
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  if (!first || !last) return 'möglich ist keine Uhrzeit';
  if (first === last && first.s === 0 && first.e >= 1439) return 'möglich ist jede Uhrzeit';
  if (first !== last && first.s === 0 && last.e >= 1439) {
    // Across midnight: the evening part and the early-morning part are one range.
    ranges.shift();
    last.e = first.e;
  }
  const parts = ranges.map((r) => `${clock(r.s)}–${clock(r.e)}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} oder ${parts[parts.length - 1]!}` : parts[0]!;
  return `möglich ist ${list} Uhr`;
}

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
  const inFuture = (ymd: string): boolean => Date.UTC(parseYmd(ymd).year, parseYmd(ymd).month - 1, parseYmd(ymd).day) > now + 86400000;
  let date = validYmd(input.filenameDate);
  let fromTags = false;
  if (date !== null && inFuture(date)) {
    notes.push(`Datum im Dateinamen (${dateDe(date)}) liegt in der Zukunft und wird nicht verwendet.`);
    date = null;
  }
  if (date === null) {
    const tagged = validYmd(input.metadataDate ?? null);
    if (tagged !== null && inFuture(tagged)) {
      notes.push(`Datum in den Metadaten (${dateDe(tagged)}) liegt in der Zukunft und wird nicht verwendet.`);
    } else if (tagged !== null) {
      date = tagged;
      fromTags = true;
    }
  }
  let monthRange: [number, number] | null = null;
  let dateSource: TimeEstimate['dateSource'] = 'none';
  let seasonNote: string | null = null;
  if (date !== null && fromTags) {
    dateSource = 'metadata';
    notes.push(`Datum aus den Metadaten der Datei (ohne Uhrzeit): ${dateDe(date)}.`);
  } else if (date !== null) {
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

  const possible = clockWindows(dates, reasonPlace, band);
  const core = coreWindows(dates, reasonPlace, light.probs);
  const windows = core.windows.length > 0 ? core.windows : possible;
  const lightNote =
    light.top.id === 'night' || light.top.id === 'twilight'
      ? `Sonnenhöhe aus dem Licht: ${bandText(band)} – ${light.top.name} (${pct(light.probs[light.top.id])}).`
      : `Sonnenhöhe aus Licht und Schatten: ${bandText(band)} – ${light.top.name} (${pct(light.probs[light.top.id])}).`;
  const out: string[] = [lightNote, ...notes];
  if (seasonNote && date === null) out.push(seasonNote);
  const am = windows.find((w) => w.label === 'Morgen' || w.label === 'Vormittag');
  const pm = windows.find((w) => w.label === 'Nachmittag' || w.label === 'Abend');
  if (am && pm) out.push(`${am.label} und ${pm.label} sind aus der Sonnenhöhe allein nicht zu unterscheiden.`);
  if (core.windows.length > 0 && possible.length > 0) {
    // The mass the shown windows really hold: plateaus and closed gaps often take it above CORE_MASS.
    const shownMass = core.windows.reduce((a, w) => a + w.probability, 0);
    out.push(`Gezeigt sind die Zeitfenster mit zusammen ${pct(shownMass)} Wahrscheinlichkeit; ${possibleClause(possible)}.`);
  }
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
      // The middle of the best window (which may run past midnight).
      const span = (best.endMin - best.startMin + 1440) % 1440;
      at = localToUtc(bestDate, (best.startMin + span / 2) % 1440, place.timeZone);
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
