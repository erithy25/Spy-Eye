/**
 * DATUM segments: a recording that shows several places (travel, dashcam, drone footage, a
 * compilation) is located place by place instead of being reduced to one point.
 *
 *   1. Windows. The analysis pipeline cuts a recording into scenes (store.ts SceneRecord, at most
 *      30 s each). Scenes shorter than `minWindowSec` join the neighbour they look most like (the
 *      cosine of the mean whole-frame vectors), so that the one-second scenes around a cut do not
 *      become windows of their own.
 *   2. Decision per window. Every window is decided as a whole recording is (locate.ts
 *      decideLocation): up to `galleryFrames` of its analysis frames, each whole and in its crops,
 *      against the reference gallery (searches of whole windows, at most `searchRows` rows each),
 *      its own country prior, and the world model on `worldFramesPerWindow` of its frames (at most
 *      `worldFramesTotal` over the recording). The file's tags do not enter: GPS covers the whole
 *      file (see engine.ts).
 *   3. Places. A window whose answer is sure enough is an anchor: a landmark that stands out from
 *      the gallery's other matches, or an answer of the gallery with a confidence of at least
 *      `anchorConfidence` (isAnchor). The world model's point alone never is: on a few frames it
 *      was wrong in most windows measured. Anchors closer than `sameKm` are one place, also
 *      through a chain of them (whichever is surest); places that the world model of both their
 *      surest windows sees as the same region (`worldAgree`) are one too, except two standing-out
 *      landmarks. Such a place is marked `joined`: it may be several, and the count says "at
 *      least". A recording may come back to a place. A place needs anchors of at least
 *      `minPlaceSec`. A weak window joins a place only between two anchors of it and when its own
 *      answer leaves room for one of them; otherwise it stays undetermined, honestly, instead of
 *      being forced onto a place.
 *   4. Stretches. Neighbouring windows of the same place (or both undetermined) form one stretch.
 *      The fix carries the stretches (Fix.segments) when at least two distinct places hold for at
 *      least `minPlaceSec` each, and (engine 12 on) when one place does and other stretches stay
 *      undetermined: those may show other places, which the whole file's answer mixes in. Its
 *      place shows above only where it holds at least `leadShare` of the recording (see
 *      segmentVerdict). A recording that is one stretch stays as it was.
 *
 * Everything here except analyseSegments is pure; analyseSegments is handed the gallery search,
 * the world model and the frame vectors, so that tests and the measurement can stand in for them.
 */
import type { CountryProb, Evidence, FixCandidate, FixLocation, FixSegment, FixSegmentPlace, FixSegmentRegion, FixSegmentSummary, GeoPoint, SunReport, TimeEstimate } from './contract.js';
import type { GalleryNeighbour, GallerySearchOptions } from './gallery.js';
import { massWithin, type GeoclipPrediction } from './geoclip.js';
import { REGION_ROLE, breathe, decideLocation, type LocateParams, type LocateResult, type RadiusTier } from './locate.js';
import type { RegionName } from './regions.js';
import { greatCircleKm, type EmbedTexts, type World } from './world.js';

export interface SegmentParams {
  /** Scenes shorter than this (s) join the neighbour they look most like. */
  minWindowSec: number;
  /** Most windows per recording; beyond, the neighbours that look most alike merge. */
  maxWindows: number;
  /** Length of the windows (s) when the analysis has no scenes that cover its frames. */
  fallbackWindowSec: number;
  /** Analysis frames per window that go into the gallery decision (each with its crops). */
  galleryFrames: number;
  /** Frames per window the world model looks at, and in total over the recording. */
  worldFramesPerWindow: number;
  worldFramesTotal: number;
  /** An answer of the gallery is an anchor from this confidence on (see isAnchor). */
  anchorConfidence: number;
  /** Two answers closer than this (km) are the same place, whatever their radii. */
  sameKm: number;
  /**
   * The world model's say on whether two anchors are one place: when the window of one puts at
   * least `worldAgree` of its probability within `worldAgreeKm` of the other's answer (both ways
   * round), they are one place even when their points lie apart.
   */
  worldAgreeKm: number;
  worldAgree: number;
  /** A place needs anchors of at least this many seconds; a shorter one stays undetermined. */
  minPlaceSec: number;
  /**
   * Rows (frames times crops) per gallery search, whole windows each. One search of all windows
   * (up to 160 windows of 32 rows) took close to a minute on a loaded node, and the search thread
   * is ended after 60 s without an answer (gallerySearch.ts), after which the search would run
   * again on the main thread; 256 rows take a few seconds, and other searches go in between.
   */
  searchRows: number;
  /**
   * The coarse region of an undetermined window (coarsePoint): shown when the gallery's answer and
   * the world model's best point lie at most this far apart (km), as a circle of this radius
   * around the middle of the two. Calibrated on the undetermined windows of the compilations
   * (docs/DATUM.md, "Grobe Region für unbestimmte Abschnitte"): with 1 500 km the truth lay inside
   * in 32 of 34 of them (94 %), 91 to 95 % on the check sets.
   */
  coarseKm: number;
  /**
   * A recording of one recognised place and undetermined stretches shows that place above (its
   * time, sun and spaces too) only when its stretches together last at least this share of the
   * recording; below, the whole file's answer stays above and the stretches are the timeline.
   * Measured on the 7 such cases of the reference clips, compilations and end-to-end files
   * (docs/DATUM.md, "Ein erkannter Ort und unbestimmte Abschnitte"): always showing the stretch put
   * a 12-s bridge above a 96-s world tour (12.5 %, +2 731 km per second on average); where the
   * place held 25 % or more (Stadt-Land, the Leverkusen clip) it gained 151 km or cost at most
   * 31 km. Any value above 0.125 and up to 0.25 gives the same results there. Stretches at the
   * place the whole file's world model rejected do not count: they cannot lead, and a short
   * stretch elsewhere must not stand for a recording they fill.
   */
  leadShare: number;
}

export const DEFAULT_SEGMENT_PARAMS: SegmentParams = {
  minWindowSec: 4,
  maxWindows: 160,
  fallbackWindowSec: 15,
  galleryFrames: 8,
  worldFramesPerWindow: 3,
  worldFramesTotal: 120,
  anchorConfidence: 0.8,
  sameKm: 25,
  worldAgreeKm: 200,
  worldAgree: 0.05,
  minPlaceSec: 5,
  searchRows: 256,
  coarseKm: 1500,
  leadShare: 0.2,
};

/** An analysis frame as the store keeps it (FrameRecord): number, second and scene. */
export interface SegmentFrame {
  n: number;
  t: number;
  s: number;
}

/** A scene of the analysis (SceneRecord): indices into the frames, inclusive. */
export interface SegmentScene {
  firstFrame: number;
  lastFrame: number;
}

/** A group of consecutive analysis frames decided on its own. */
export interface SegmentWindow {
  /** Indices into the frames, inclusive. */
  first: number;
  last: number;
  /** Seconds: from the first frame (0 for the first window) to where the next window starts. */
  startSec: number;
  endSec: number;
}

/** A window with its decision. */
export interface WindowAnswer extends SegmentWindow {
  location: FixLocation | null;
  tier: RadiusTier | null;
  /** The world model's prediction for the window's frames, if it was asked. */
  geoclip: GeoclipPrediction | null;
  /** How the decision came about (locate.ts LocateDiagnostics). */
  diagnostics: LocateResult['diagnostics'] | null;
}

/** Indices `count` evenly spread over first..last (the middle of equal parts), without repeats. */
export function spreadIndices(first: number, last: number, count: number): number[] {
  const len = last - first + 1;
  if (len <= 0 || count <= 0) return [];
  if (len <= count) return Array.from({ length: len }, (_, i) => first + i);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(first + Math.min(len - 1, Math.floor(((i + 0.5) * len) / count)));
  return [...new Set(out)];
}

/** Cosine of two L2-normalised (or not) vectors. */
function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] as number) * (b[i] as number);
    na += (a[i] as number) ** 2;
    nb += (b[i] as number) ** 2;
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * The windows of a recording: its scenes, with short ones joined to the neighbour they look most
 * like and, beyond `maxWindows`, the most alike neighbours merged. `wholeFrame(i)` is the
 * whole-frame vector of frame i. Scenes that do not cover the frames (an index of another
 * version) give way to windows of `fallbackSec` seconds.
 */
export function buildWindows(
  frames: readonly SegmentFrame[],
  scenes: readonly SegmentScene[],
  durationSec: number | null,
  wholeFrame: (i: number) => Float32Array,
  params: Pick<SegmentParams, 'minWindowSec' | 'maxWindows'>,
  fallbackSec = 15,
): SegmentWindow[] {
  if (frames.length === 0) return [];
  let spans = scenes.map((s) => ({ first: s.firstFrame, last: s.lastFrame }));
  const covers =
    spans.length > 0 &&
    spans[0]!.first === 0 &&
    spans[spans.length - 1]!.last === frames.length - 1 &&
    spans.every((s, i) => s.last >= s.first && (i === 0 || s.first === spans[i - 1]!.last + 1));
  if (!covers) {
    spans = [];
    let first = 0;
    for (let i = 1; i <= frames.length; i++) {
      if (i === frames.length || (frames[i] as SegmentFrame).t - (frames[first] as SegmentFrame).t >= fallbackSec) {
        spans.push({ first, last: i - 1 });
        first = i;
      }
    }
  }
  const end = Math.max(durationSec ?? 0, (frames[frames.length - 1] as SegmentFrame).t + 1);
  const startOf = (k: number): number => (k === 0 ? 0 : (frames[spans[k]!.first] as SegmentFrame).t);
  const lengthOf = (k: number): number => (k + 1 < spans.length ? startOf(k + 1) : end) - startOf(k);
  // Mean whole-frame vector of every span (its direction is all the cosine needs).
  const sumOf = (s: { first: number; last: number }): Float32Array => {
    const out = new Float32Array(wholeFrame(s.first).length);
    for (let i = s.first; i <= s.last; i++) {
      const v = wholeFrame(i);
      for (let d = 0; d < out.length; d++) out[d] = (out[d] as number) + (v[d] as number);
    }
    return out;
  };
  let sums = spans.map(sumOf);
  // Cosine of every span with the next one (-Infinity after the last). A merge changes only the
  // two around it: recomputing all of them on every merge made thousands of short scenes (hours of
  // footage with many cuts) cost seconds on the node's main thread.
  const nextCos = spans.map((_, k) => (k + 1 < spans.length ? cosine(sums[k] as Float32Array, sums[k + 1] as Float32Array) : -Infinity));
  const merge = (k: number): void => {
    // Spans k and k + 1 become one.
    const a = spans[k]!;
    const b = spans[k + 1]!;
    const sum = (sums[k] as Float32Array).map((v, d) => v + ((sums[k + 1] as Float32Array)[d] as number));
    spans.splice(k, 2, { first: a.first, last: b.last });
    sums.splice(k, 2, sum);
    nextCos.splice(k, 2, k + 1 < spans.length ? cosine(sum, sums[k + 1] as Float32Array) : -Infinity);
    if (k > 0) nextCos[k - 1] = cosine(sums[k - 1] as Float32Array, sum);
  };
  // Short scenes join the neighbour they look most like (one at a time, shortest first).
  for (;;) {
    if (spans.length < 2) break;
    let shortest = -1;
    for (let k = 0; k < spans.length; k++) {
      if (lengthOf(k) >= params.minWindowSec) continue;
      if (shortest < 0 || lengthOf(k) < lengthOf(shortest)) shortest = k;
    }
    if (shortest < 0) break;
    const prev = shortest > 0 ? (nextCos[shortest - 1] as number) : -Infinity;
    const next = nextCos[shortest] as number;
    merge(prev >= next ? shortest - 1 : shortest);
  }
  // Too many windows: the most alike neighbours merge.
  while (spans.length > Math.max(1, params.maxWindows)) {
    let best = 0;
    let bestCos = -Infinity;
    for (let k = 0; k + 1 < spans.length; k++) {
      const c = nextCos[k] as number;
      if (c > bestCos) {
        bestCos = c;
        best = k;
      }
    }
    merge(best);
  }
  sums = [];
  return spans.map((s, k) => ({ first: s.first, last: s.last, startSec: startOf(k), endSec: k + 1 < spans.length ? startOf(k + 1) : end }));
}

/**
 * How many frames the world model sees of each window: as many as the total allows, at most
 * `perWindow`, the same for all; when there are more windows than frames, one each for the
 * longest windows. Frames left over go to the longest windows first.
 */
export function planWorldFrames(windows: readonly SegmentWindow[], perWindow: number, total: number): number[] {
  const n = windows.length;
  const out = new Array<number>(n).fill(0);
  if (n === 0 || perWindow <= 0 || total <= 0) return out;
  const frames = windows.map((w) => w.last - w.first + 1);
  const byLength = Array.from({ length: n }, (_, i) => i).sort((a, b) => windows[b]!.endSec - windows[b]!.startSec - (windows[a]!.endSec - windows[a]!.startSec) || a - b);
  let left = total;
  const base = Math.min(perWindow, Math.floor(total / n));
  if (base >= 1) {
    for (let i = 0; i < n; i++) {
      out[i] = Math.min(base, frames[i] as number);
      left -= out[i] as number;
    }
  }
  // One round at a time over the longest windows, so that the frames left are spread.
  for (let round = 0; left > 0 && round < perWindow; round++) {
    for (const i of byLength) {
      if (left <= 0) break;
      if ((out[i] as number) >= Math.min(perWindow, frames[i] as number) || (out[i] as number) > round) continue;
      out[i] = (out[i] as number) + 1;
      left--;
    }
  }
  return out;
}

/** The parts of a window's answer that the merging reads. */
type Answer = Pick<WindowAnswer, 'location' | 'tier' | 'geoclip' | 'startSec' | 'endSec'>;

/**
 * Whether a window's answer is sure enough to stand for a place: a landmark that stands out from
 * the gallery's other matches (the 'strong' tier), or an answer of the gallery (or the street-level
 * comparison) with at least `anchorConfidence`. An answer of the world model alone, a country or a
 * continent is not: on a few frames the world model's point was wrong in most windows measured
 * (docs/DATUM.md, Abschnitte).
 */
export function isAnchor(w: Pick<WindowAnswer, 'location' | 'tier'>, params: Pick<SegmentParams, 'anchorConfidence'>): boolean {
  const loc = w.location;
  if (!loc) return false;
  if (w.tier === 'strong') return true;
  return (loc.method === 'landmark' || loc.method === 'streetlevel') && loc.confidence >= params.anchorConfidence;
}

/** Whether two anchors lie within `sameKm` of each other: one place, whatever their radii. */
function nearby(a: Answer, b: Answer, sameKm: number): boolean {
  const la = a.location;
  const lb = b.location;
  if (!la || !lb) return false;
  return greatCircleKm(la.lat, la.lon, lb.lat, lb.lon) <= sameKm;
}

/**
 * Whether the world model ties two anchors that lie apart to one region: the window of each puts
 * at least `worldAgree` of its probability within `worldAgreeKm` of the other's answer. Never for
 * two standing-out landmarks ('strong' both): each is the surest answer there is, and the world
 * model's broad regions (Great Britain, northern Germany) would merge two of them hundreds of
 * kilometres apart into one place and lose the recording's timeline.
 */
function worldTie(a: Answer, b: Answer, params: Pick<SegmentParams, 'worldAgreeKm' | 'worldAgree'>): boolean {
  const la = a.location;
  const lb = b.location;
  if (!la || !lb || !a.geoclip || !b.geoclip || params.worldAgree <= 0) return false;
  if (a.tier === 'strong' && b.tier === 'strong') return false;
  return massWithin(a.geoclip, lb.lat, lb.lon, params.worldAgreeKm) >= params.worldAgree && massWithin(b.geoclip, la.lat, la.lon, params.worldAgreeKm) >= params.worldAgree;
}

/** Whether two anchors stand for one place (see SegmentParams.sameKm and worldAgree). */
export function samePlace(a: Answer, b: Answer, params: Pick<SegmentParams, 'sameKm' | 'worldAgreeKm' | 'worldAgree'>): boolean {
  return nearby(a, b, params.sameKm) || worldTie(a, b, params);
}

/**
 * Whether a weak window leaves room for a place: it has no answer, or the place lies inside its
 * circle.
 */
export function consistentWith(weak: Pick<WindowAnswer, 'location'>, place: Pick<WindowAnswer, 'location'>): boolean {
  const lw = weak.location;
  const lp = place.location;
  if (!lp) return false;
  if (!lw) return true;
  return greatCircleKm(lw.lat, lw.lon, lp.lat, lp.lon) <= lw.radiusKm;
}

/** Stretches of a recording before they become FixSegments: windows (indices) and their place. */
export interface Stretch {
  /** Indices into the windows, inclusive. */
  first: number;
  last: number;
  /** Place index (into MergeResult.places), or -1 when undetermined. */
  place: number;
}

export interface MergeResult {
  /** Per window: its place index, or -1. */
  labels: number[];
  /** Per window: whether it is an anchor of its place. */
  anchors: boolean[];
  /** Per place: the index of the window that stands for it (its most confident anchor). */
  places: number[];
  /**
   * Per place: whether the world model joined anchors into it that lie farther apart than
   * `sameKm` (samePlace). Such a place may be several, so the count of places is a lower bound.
   */
  joined: boolean[];
  stretches: Stretch[];
}

/** Better anchor first: 'strong' tier, then higher confidence, then longer window. */
function stronger(a: Answer, b: Answer): number {
  const la = a.location as FixLocation;
  const lb = b.location as FixLocation;
  return Number(b.tier === 'strong') - Number(a.tier === 'strong') || lb.confidence - la.confidence || b.endSec - b.startSec - (a.endSec - a.startSec);
}

/**
 * The places of a recording from the answers of its windows (see the module comment, steps 3
 * and 4). Places are numbered in the order they first appear.
 */
export function mergeWindows(windows: readonly Answer[], partial: Partial<SegmentParams> = {}): MergeResult {
  const params: SegmentParams = { ...DEFAULT_SEGMENT_PARAMS, ...partial };
  const n = windows.length;
  const labels = new Array<number>(n).fill(-1);
  const strength = (a: number, b: number): number => stronger(windows[a] as Answer, windows[b] as Answer) || a - b;
  const order = windows.map((_, i) => i).filter((i) => isAnchor(windows[i] as Answer, params));
  // Anchors closer than sameKm are one place, also through a chain of them. Every pair counts, so
  // that which anchors form a place does not depend on which of them happens to be surest (one
  // compared only with a place's surest anchor could stay apart from another 20 km away).
  const parent = new Map(order.map((i) => [i, i]));
  const root = (i: number): number => {
    let r = i;
    while (parent.get(r) !== r) r = parent.get(r) as number;
    return r;
  };
  for (let x = 0; x < order.length; x++) {
    for (let y = x + 1; y < order.length; y++) {
      const a = order[x] as number;
      const b = order[y] as number;
      if (!nearby(windows[a] as Answer, windows[b] as Answer, params.sameKm)) continue;
      const ra = root(a);
      const rb = root(b);
      if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
    }
  }
  const groups = new Map<number, number[]>();
  for (const i of order) groups.set(root(i), [...(groups.get(root(i)) ?? []), i]);
  const byStrength = [...groups.values()].map((g) => g.sort(strength)).sort((a, b) => strength(a[0] as number, b[0] as number));
  // Places that lie apart become one where the world model of both their surest anchors sees the
  // same region (worldTie): strongest first, so that a place stands for its best answer, each
  // joining the nearest place it ties with. Only the surest anchors are compared: chained, the
  // world model's ties would run on from region to region (Berlin, Magdeburg, Hof).
  const reps: number[] = [];
  const joinedRaw: boolean[] = [];
  for (const group of byStrength) {
    const lead = group[0] as number;
    const w = windows[lead] as Answer;
    let joined = -1;
    let bestKm = Infinity;
    reps.forEach((r, p) => {
      const rep = windows[r] as Answer;
      if (!worldTie(w, rep, params)) return;
      const d = greatCircleKm(w.location!.lat, w.location!.lon, rep.location!.lat, rep.location!.lon);
      if (d < bestKm) {
        bestKm = d;
        joined = p;
      }
    });
    if (joined < 0) {
      joined = reps.length;
      reps.push(lead);
      joinedRaw.push(false);
    } else {
      joinedRaw[joined] = true;
    }
    for (const i of group) labels[i] = joined;
  }
  // A place needs anchors of at least minPlaceSec; the windows of a shorter one are undetermined.
  const seconds = new Array<number>(reps.length).fill(0);
  labels.forEach((p, i) => {
    if (p >= 0) seconds[p] = (seconds[p] as number) + ((windows[i] as Answer).endSec - (windows[i] as Answer).startSec);
  });
  for (let i = 0; i < n; i++) if (labels[i]! >= 0 && (seconds[labels[i]!] as number) < params.minPlaceSec) labels[i] = -1;
  const anchors = labels.map((p) => p >= 0);
  // A weak window takes a place only between two anchors of that place, and only when its own
  // answer leaves room for one of them; otherwise it stays undetermined: a weak answer is not
  // forced onto a neighbouring place. The anchors around it are what it is compared with, not the
  // place's surest anchor, which the world model may have tied to it from far away.
  const assigned = [...labels];
  let before = -1;
  for (let i = 0; i < n; i++) {
    if (labels[i]! >= 0) {
      if (before >= 0 && labels[before] === labels[i] && i - before > 1) {
        const around = [windows[before] as Answer, windows[i] as Answer];
        for (let j = before + 1; j < i; j++) if (around.some((a) => consistentWith(windows[j] as Answer, a))) assigned[j] = labels[i] as number;
      }
      before = i;
    }
  }
  // Renumber the places in the order they first appear.
  const seen: number[] = [];
  for (const p of assigned) if (p >= 0 && !seen.includes(p)) seen.push(p);
  const renumber = new Map(seen.map((p, k) => [p, k]));
  const finalLabels = assigned.map((p) => (p >= 0 ? (renumber.get(p) as number) : -1));
  const places = seen.map((p) => reps[p] as number);
  const joined = seen.map((p) => joinedRaw[p] === true);
  const stretches: Stretch[] = [];
  for (let i = 0; i < n; i++) {
    const last = stretches[stretches.length - 1];
    if (last && last.place === finalLabels[i]) last.last = i;
    else stretches.push({ first: i, last: i, place: finalLabels[i] as number });
  }
  return { labels: finalLabels, anchors, places, joined, stretches };
}

/** "4:12", "1:02:05": a second of the video as a clock reads it. */
export function clockText(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** The parts of an analysis frame a stretch needs for its keyframe. */
export type FrameUrl = (n: number) => string;

/**
 * The FixSegments of a merge: every stretch with its place (the most confident anchor inside it;
 * a stretch whose place has no anchor inside takes the place's own), its keyframe (the frame in
 * the middle of its strongest window) and its place number (1-based).
 */
export function toSegments(frames: readonly SegmentFrame[], windows: readonly WindowAnswer[], merged: MergeResult, frameUrl: FrameUrl, sameKm = DEFAULT_SEGMENT_PARAMS.sameKm): FixSegment[] {
  return merged.stretches.map((s) => {
    const inside = windows.slice(s.first, s.last + 1);
    let lead: WindowAnswer | null = null;
    if (s.place >= 0) {
      const anchors = inside.filter((_, k) => merged.anchors[s.first + k]);
      lead = anchors.length > 0 ? leadAnchor(anchors, sameKm) : (windows[merged.places[s.place] as number] as WindowAnswer);
    }
    // The keyframe: the middle frame of the window that decided, else of the longest window.
    const shown = lead && inside.includes(lead) ? lead : [...inside].sort((a, b) => b.endSec - b.startSec - (a.endSec - a.startSec))[0]!;
    const mid = Math.floor((shown.first + shown.last) / 2);
    const frame = frames[mid] as SegmentFrame;
    const first = frames[inside[0]!.first] as SegmentFrame;
    const last = frames[inside[inside.length - 1]!.last] as SegmentFrame;
    return {
      startSec: inside[0]!.startSec,
      endSec: inside[inside.length - 1]!.endSec,
      firstFrame: first.n,
      lastFrame: last.n,
      keyframe: { frame: frame.n, time: frame.t, imageUrl: frameUrl(frame.n) },
      location: lead?.location ?? null,
      place: s.place >= 0 ? s.place + 1 : null,
      windows: s.last - s.first + 1,
      ...(s.place >= 0 && merged.joined[s.place] ? { joined: true } : {}),
    };
  });
}

/**
 * The anchor that stands for a stretch: the one whose answer the most seconds of anchors agree with
 * (within sameKm), then the stronger. Anchors the world model tied together may lie apart (see
 * samePlace); the stretch shows where most of its time points, not a short window that happens to
 * be the surest.
 */
function leadAnchor(anchors: readonly WindowAnswer[], sameKm: number): WindowAnswer {
  const support = (a: WindowAnswer): number =>
    anchors.reduce((sum, b) => sum + (greatCircleKm(a.location!.lat, a.location!.lon, b.location!.lat, b.location!.lon) <= sameKm ? b.endSec - b.startSec : 0), 0);
  return [...anchors].sort((a, b) => support(b) - support(a) || stronger(a, b))[0] as WindowAnswer;
}

/** The point halfway between two points on the great circle through them. */
export function midpoint(a: GeoPoint, b: GeoPoint): GeoPoint {
  const r = Math.PI / 180;
  const x = Math.cos(a.lat * r) * Math.cos(a.lon * r) + Math.cos(b.lat * r) * Math.cos(b.lon * r);
  const y = Math.cos(a.lat * r) * Math.sin(a.lon * r) + Math.cos(b.lat * r) * Math.sin(b.lon * r);
  const z = Math.sin(a.lat * r) + Math.sin(b.lat * r);
  return { lat: Math.atan2(z, Math.hypot(x, y)) / r, lon: Math.atan2(y, x) / r };
}

/**
 * The coarse point of a window that has no place: the middle of the gallery's answer and the
 * world model's best point, when both exist and lie at most `coarseKm` apart. Two sources that
 * see the pictures differently (reference pictures with the country prior, GeoCLIP's 100 000
 * places) pointing to the same area is what makes it hold: around the undetermined windows' own
 * answers no radius up to 5 000 km held the truth in 80 % of them (71 to 76 % at 5 000 km); where
 * the two agreed within 1 500 km, 1 500 km around their middle did in 91 to 95 % (docs/DATUM.md).
 */
export function coarsePoint(w: Pick<WindowAnswer, 'geoclip' | 'diagnostics'>, coarseKm: number): GeoPoint | null {
  const gallery = w.diagnostics?.gallery ?? null;
  const best = w.geoclip?.best ?? null;
  if (!gallery || !best || coarseKm <= 0) return null;
  if (greatCircleKm(gallery.lat, gallery.lon, best.lat, best.lon) > coarseKm) return null;
  return midpoint(gallery, best);
}

/**
 * The coarse regions of every stretch (parallel to merged.stretches; null for a located stretch or
 * one without any): consecutive windows of an undetermined stretch with a coarse point
 * (coarsePoint) in the same part of the world, at most `coarseKm` from the first of them, are one
 * region, at the point of its longest window. A window without one ends the run: what lies
 * between two runs of one region is not claimed for it.
 */
export function coarseRegions(
  windows: readonly Pick<WindowAnswer, 'geoclip' | 'diagnostics' | 'startSec' | 'endSec'>[],
  merged: Pick<MergeResult, 'stretches'>,
  regionAt: (lat: number, lon: number) => RegionName | null,
  coarseKm = DEFAULT_SEGMENT_PARAMS.coarseKm,
): (FixSegmentRegion[] | null)[] {
  return merged.stretches.map((s) => {
    if (s.place >= 0) return null;
    const out: FixSegmentRegion[] = [];
    let run: { first: GeoPoint; best: GeoPoint; bestSec: number; name: RegionName; start: number; end: number } | null = null;
    const close = (): void => {
      if (!run) return;
      out.push({ startSec: run.start, endSec: run.end, lat: run.best.lat, lon: run.best.lon, radiusKm: coarseKm, label: run.name.de, labelEn: run.name.en });
      run = null;
    };
    for (let i = s.first; i <= s.last; i++) {
      const w = windows[i]!;
      const p = coarsePoint(w, coarseKm);
      const name = p ? regionAt(p.lat, p.lon) : null;
      if (!p || !name) {
        close();
        continue;
      }
      const secs = w.endSec - w.startSec;
      if (run && run.name.de === name.de && greatCircleKm(run.first.lat, run.first.lon, p.lat, p.lon) <= coarseKm) {
        run.end = w.endSec;
        if (secs > run.bestSec) {
          run.best = p;
          run.bestSec = secs;
        }
        continue;
      }
      close();
      run = { first: p, best: p, bestSec: secs, name, start: w.startSec, end: w.endSec };
    }
    close();
    return out.length > 0 ? out : null;
  });
}

/** The analysis frames (indices, inclusive) of every stretch of a merge. */
export function stretchFrames(windows: readonly Pick<SegmentWindow, 'first' | 'last'>[], merged: Pick<MergeResult, 'stretches'>): [number, number][] {
  return merged.stretches.map((s) => [windows[s.first]!.first, windows[s.last]!.last]);
}

/**
 * The stretches that get a walkable space of their own (FixSegment.keyframe.spaceUrl): the located
 * ones other than the stretch the fix shows (`lead`, whose spaces are the fix's keyframes), the
 * longest first (the earlier on equal length), at most `cap`. Returned in time order.
 */
export function spaceStretches(segments: readonly Pick<FixSegment, 'location' | 'startSec' | 'endSec'>[], lead: number | null, cap: number): number[] {
  const located = segments.map((_, i) => i).filter((i) => i !== lead && segments[i]!.location !== null);
  const len = (i: number): number => segments[i]!.endSec - segments[i]!.startSec;
  return located
    .sort((a, b) => len(b) - len(a) || a - b)
    .slice(0, Math.max(0, cap))
    .sort((a, b) => a - b);
}

/**
 * What the whole file's frames hold besides the stretch a fix shows: several places, or (one
 * recognised place) the undetermined stretches, which may show others. Its entries say which.
 */
export type WholeFileMix = 'places' | 'undetermined';

const MIXED_TEXT: Record<WholeFileMix, { fix: SegmentText; frames: SegmentText }> = {
  places: {
    fix: { de: 'deren Bilder mehrere Orte vermischen', en: 'whose pictures mix several places' },
    frames: { de: 'die mehrere Orte vermischen', en: 'which mix several places' },
  },
  undetermined: {
    fix: { de: 'deren Bilder auch die unbestimmten Abschnitte einschließen', en: 'whose pictures include the undetermined segments too' },
    frames: { de: 'die auch die unbestimmten Abschnitte einschließen', en: 'which include the undetermined segments too' },
  },
};

/**
 * The words for `mix`. Anything but 'undetermined' is several places: the entry functions are
 * handed to Array.map, whose index must not pick a text.
 */
function mixed(mix: unknown): { fix: SegmentText; frames: SegmentText } {
  return mix === 'undetermined' ? MIXED_TEXT.undetermined : MIXED_TEXT.places;
}

/**
 * The time evidence of the stretch whose place the fix shows, in a fix of stretches: said to come
 * from that stretch's frames (the whole file's light mixes the places).
 */
export function stretchTimeEvidence(e: Evidence, span: string): Evidence {
  return {
    ...e,
    label: `${e.label} (Abschnitt ${span})`,
    labelEn: `${e.labelEn ?? e.label} (segment ${span})`,
    detail: `Aus den Bildern des oben gezeigten Abschnitts ${span} an seinem Ort. ${e.detail}`,
    detailEn: `From the frames of the segment shown above, ${span}, at its place. ${e.detailEn ?? e.detail}`,
  };
}

/**
 * The time evidence of the whole file in a fix whose place a stretch shows: its frames come from
 * all of the recording, so its light and season mix the places (or the place with the
 * undetermined stretches, `mix`); it stays, said to be the whole file's, without weight. The time
 * shown is the stretch's (stretchTimeEvidence).
 */
export function wholeFileTimeEvidence(e: Evidence, mix: WholeFileMix = 'places'): Evidence {
  const m = mixed(mix).frames;
  return {
    ...e,
    label: `${WHOLE_FILE.de}${e.label}`,
    labelEn: `${WHOLE_FILE.en}${e.labelEn ?? e.label}`,
    detail: `Aus Bildern der ganzen Datei, ${m.de}; die Uhrzeit oben ist die des gezeigten Abschnitts. ${e.detail}`,
    detailEn: `From frames of the whole file, ${m.en}; the time shown above is that of the segment shown. ${e.detailEn ?? e.detail}`,
    weight: 0,
  };
}

/**
 * The time evidence of a fix whose place a stretch shows: that of the stretch (stretchTimeEvidence)
 * and the whole file's, mixed and without weight (wholeFileTimeEvidence). A recording time from
 * the file's tags (`own` holds kind 'metadata') comes from neither the stretch's frames nor the
 * mixed ones: it holds for the whole file and every stretch and is said once; its check
 * against the light is that of the stretch shown. The whole file's copy would only repeat it, with
 * a check against light that mixes the places.
 */
export function multiPlaceTimeEvidence(own: readonly Evidence[], whole: readonly Evidence[], span: string, mix: WholeFileMix = 'places'): Evidence[] {
  if (!own.some((e) => e.kind === 'metadata')) return [...own.map((e) => stretchTimeEvidence(e, span)), ...whole.map((e) => wholeFileTimeEvidence(e, mix))];
  return own.map((e) =>
    e.kind === 'metadata'
      ? {
          ...e,
          detail: `Gilt für die ganze Datei und jeden ihrer Abschnitte, in dessen Ortszeit; mit dem Licht verglichen in den Bildern des oben gezeigten Abschnitts ${span}. ${e.detail}`,
          detailEn: `Holds for the whole file and each of its segments, in its local time; checked against the light in the frames of the segment shown above, ${span}. ${e.detailEn ?? e.detail}`,
        }
      : stretchTimeEvidence(e, span),
  );
}

/**
 * The trace's line for the spaces of the stretches: "12 weitere Räume für 32 Abschnitte mit Ort
 * (die 12 längsten außer dem gezeigten), 4,1 s"; one of each in the singular. `shown` is false
 * where the fix shows no stretch (its spaces are the whole file's): every located one may get one.
 */
export function stretchSpacesNote(built: number, located: number, chosen: number, ms: number, shown = true): SegmentText {
  // One recognised place whose only stretch is the one shown: its spaces are the fix's.
  if (chosen === 0 && shown && located === 1) return { de: 'keine weiteren: der einzige Abschnitt mit Ort ist der gezeigte', en: 'none more: the only segment with a place is the one shown' };
  const secs = (ms / 1000).toFixed(1);
  const longest = (shown ? located - 1 : located) > chosen;
  const besidesDe = shown ? ' außer dem gezeigten' : '';
  const besidesEn = shown ? ' besides the one shown' : '';
  return {
    de: `${built} ${built === 1 ? 'weiterer Raum' : 'weitere Räume'} für ${located} ${located === 1 ? 'Abschnitt' : 'Abschnitte'} mit Ort${longest ? ` (${chosen === 1 ? 'der längste' : `die ${chosen} längsten`}${besidesDe})` : ''}, ${secs.replace('.', ',')} s`,
    en: `${built} more ${built === 1 ? 'space' : 'spaces'} for ${located} ${located === 1 ? 'segment' : 'segments'} with a place${longest ? ` (the ${chosen === 1 ? 'longest' : `${chosen} longest`}${besidesEn})` : ''}, ${secs} s`,
  };
}

/** The trace's words for the stretches timed on their own: "32 Abschnitte mit Ort je für sich"; one in the singular. */
export function stretchTimesNote(counted: number): SegmentText {
  return counted === 1
    ? { de: '1 Abschnitt mit Ort für sich', en: '1 segment with a place on its own' }
    : { de: `${counted} Abschnitte mit Ort je für sich`, en: `${counted} segments with a place each on its own` };
}

/**
 * The time of day and the sun of every located stretch (FixSegment.time, sun): `timeOf` estimates
 * them from the given analysis frames (indices) at the given place; each stretch gives up to
 * `perStretch` of its own frames, spread over it (spreadIndices), and its own place. Undetermined
 * stretches get none: without a place there is no clock. One stretch after another, with a turn
 * of the event loop between them; `stop` may throw to end the whole loop (the engine stopped, the
 * recording was deleted). A stretch whose estimate fails (a frame unreadable) keeps none, and
 * `onError` hears of it: one stretch's clock is not worth the fix.
 */
export async function stretchTimes(
  segments: readonly FixSegment[],
  ranges: readonly [number, number][],
  timeOf: (frames: number[], at: FixLocation) => Promise<{ time: TimeEstimate; sun: SunReport | null }>,
  perStretch: number,
  stop: () => void = () => undefined,
  onError: (index: number, err: unknown) => void = () => undefined,
): Promise<FixSegment[]> {
  const out: FixSegment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const range = ranges[i];
    if (!seg.location || !range) {
      out.push(seg);
      continue;
    }
    stop();
    try {
      const result = await timeOf(spreadIndices(range[0], range[1], perStretch), seg.location);
      // The reasoning lines stay with the fix's own time: the console's dial of a stretch shows none.
      out.push({ ...seg, time: { ...result.time, notes: [], notesEn: [] }, sun: compactSun(result.sun) });
    } catch (err: unknown) {
      onError(i, err);
      out.push(seg);
    }
    await breathe();
  }
  return out;
}

/** The sun of a stretch as FixSegment.sun keeps it: the path's angles to 0.1° (0.2 px on the dial). */
export function compactSun(sun: SunReport | null): SunReport | null {
  if (!sun) return null;
  const round = (v: number): number => Math.round(v * 10) / 10;
  return { ...sun, path: sun.path.map((p) => ({ t: p.t, az: round(p.az), el: round(p.el) })) };
}

/**
 * The compact form of the stretches for the list of fixes (FixSegmentSummary). `lead` is the index
 * of the stretch whose place the fix shows (see segmentVerdict): its place stands at that
 * stretch's point, so that the route's marker is where the fix says; every other place shows its
 * most confident stretch.
 */
export function summariseSegments(segments: readonly FixSegment[], lead: number | null = null): FixSegmentSummary {
  const places = new Map<number, FixSegmentPlace>();
  const route: number[] = [];
  const shown = lead !== null ? segments[lead] : undefined;
  const leadPlace = shown?.location && shown.place !== null ? shown.place : null;
  for (const s of segments) {
    if (s.place === null || !s.location) continue;
    if (route[route.length - 1] !== s.place) route.push(s.place);
    const seconds = s.endSec - s.startSec;
    const known = places.get(s.place);
    // A place shows its most confident stretch; the fix's own place the stretch the fix shows.
    const keep = s.place === leadPlace ? s !== shown : known !== undefined && known.confidence >= s.location.confidence;
    if (known && keep) {
      known.seconds += seconds;
      continue;
    }
    places.set(s.place, {
      place: s.place,
      lat: s.location.lat,
      lon: s.location.lon,
      radiusKm: s.location.radiusKm,
      confidence: s.location.confidence,
      label: s.location.label,
      ...(s.location.labelEn ? { labelEn: s.location.labelEn } : {}),
      country: s.location.country,
      seconds: (known?.seconds ?? 0) + seconds,
    });
  }
  const joined = new Set(segments.filter((s) => s.joined && s.place !== null).map((s) => s.place)).size;
  return {
    segments: segments.length,
    undetermined: segments.filter((s) => !s.location).length,
    ...(joined > 0 ? { joined } : {}),
    ...(leadPlace !== null ? { lead: leadPlace } : {}),
    places: [...places.values()].sort((a, b) => a.place - b.place),
    route,
  };
}

/**
 * The countries of a recording whose place a stretch shows: the countries of its located
 * stretches, each with its share of the located time, the fix's own country first. The country
 * estimate of the whole file mixes the places (China and India for a recording of Mexico,
 * Indonesia and Benin). With one recognised place the share is of the whole recording: the
 * located time alone would give its country all of it, and the undetermined stretches may lie
 * anywhere.
 */
export function segmentCountries(segments: readonly FixSegment[], lead: number | null): CountryProb[] {
  const seconds = new Map<string, { name: string; s: number }>();
  let total = 0;
  for (const s of segments) {
    if (!s.location?.country) continue;
    const len = Math.max(0, s.endSec - s.startSec);
    const known = seconds.get(s.location.country);
    seconds.set(s.location.country, { name: known?.name ?? s.location.countryName ?? s.location.country, s: (known?.s ?? 0) + len });
    total += len;
  }
  const onePlace = new Set(segments.filter((s) => s.location && s.place !== null).map((s) => s.place)).size === 1;
  const span = segments.length > 0 ? segments[segments.length - 1]!.endSec - segments[0]!.startSec : 0;
  if (onePlace && span > total) total = span;
  const first = lead !== null ? (segments[lead]?.location?.country ?? null) : null;
  return [...seconds.entries()]
    .map(([iso, v]) => ({ iso, name: v.name, p: total > 0 ? v.s / total : 0 }))
    .sort((a, b) => Number(b.iso === first) - Number(a.iso === first) || b.p - a.p);
}

/**
 * The countries a fix of stretches carries in place of the whole file's (segmentCountries), or
 * null where the whole file's stay. They stay where no stretch is shown, and where one recognised
 * place agrees with the whole file's answer: that fix keeps the whole file's place, candidates and
 * evidence with its weight, the country estimate among them, and the place's share of the whole
 * recording next to it would give the same country two figures (Frankreich 33 % in the bars, the
 * whole file's estimate in the entry). With several places the countries of the stretches stand
 * even where the whole file agrees (engine 10 on): its estimate mixes the places.
 */
export function verdictCountries(verdict: Pick<SegmentVerdict, 'lead' | 'places' | 'replaced'>, segments: readonly FixSegment[]): CountryProb[] | null {
  if (verdict.lead === null) return null;
  if (verdict.places === 1 && !verdict.replaced) return null;
  return segmentCountries(segments, verdict.lead);
}

/** A text in both languages. */
export interface SegmentText {
  de: string;
  en: string;
}

/** What the segments change in a fix (see segmentVerdict). */
export interface SegmentVerdict {
  /** Whether the fix carries the stretches. */
  multi: boolean;
  /** Distinct places that count. */
  places: number;
  /** Of these, the places that may be several (FixSegment.joined). */
  joined: number;
  /** The fix's place: the current one, or that of the stretch it shows. */
  location: FixLocation | null;
  /** Whether `location` was replaced. */
  replaced: boolean;
  /**
   * Index into the segments of the stretch the place comes from (multi only). Null where the fix
   * carries the stretches but shows none of them: one recognised place that holds less than
   * `leadShare` of the recording, or only at the place the whole file's world model rejected.
   * The fix then keeps the whole file's place, time and spaces.
   */
  lead: number | null;
  /**
   * Evidence to add: none for a recording of one stretch, except where its place lies away from
   * the file's GPS position (gpsApartEvidence).
   */
  evidence: Evidence[];
  /** The trace step's detail. */
  note: SegmentText;
}

const pctDe = (p: number): string => `${Math.round(p * 100)} %`;
const pctEn = (p: number): string => `${Math.round(p * 100)}%`;

/**
 * A place's share of the recording as a whole percent that says what is there: a stretch there is
 * never reads 0 % (10 s of 45 minutes are 0.4 %), and stretches beside an undetermined one never
 * 100 % (1196 of 1200 s are 99.7 %); 1 % and 99 % stand for them. Elsewhere it is rounded.
 */
function sharePercent(p: number): number {
  const rounded = Math.round(p * 100);
  return p > 0 && p < 1 ? Math.min(99, Math.max(1, rounded)) : rounded;
}

/**
 * A share below `limit` as a whole percent (sharePercent) that stays below it: 19.8 % of a
 * recording rounds to 20 %, and "nur 20 %, weniger als die 20 %" would contradict itself.
 */
function belowPercent(p: number, limit: number): number {
  return Math.max(0, Math.min(sharePercent(p), Math.ceil(limit * 100 - 1e-9) - 1));
}

/**
 * Tolerance of the share against `leadShare`: stretch bounds are seconds of the video, whose sums
 * and quotients carry float error (9.6 of 48 s is 0.19999999999999998).
 */
const SHARE_EPS = 1e-9;

/** What segmentVerdict's two ways (several places, one place) share. */
interface VerdictParts {
  segments: readonly FixSegment[];
  located: readonly FixSegment[];
  undetermined: number;
  sameKm: number;
  /** Whether the place of a location is the one the whole file's world model rejected. */
  atRejected: (loc: FixLocation) => boolean;
  /** How places are told apart, and what a joined place means. */
  rule: SegmentText;
  /** " Für ihn nennt die Zeitleiste eine grobe Region …" where undetermined stretches have one. */
  coarse: SegmentText;
}

/**
 * Index of the longest located stretch, on equal length the surer one; -1 without any. With
 * `skip`, none at the place the whole file's decision rejected.
 */
function longestStretch(p: VerdictParts, skip: boolean): number {
  let best = -1;
  p.segments.forEach((s, i) => {
    if (!s.location || s.place === null || (skip && p.atRejected(s.location))) return;
    const b = best >= 0 ? (p.segments[best] as FixSegment) : null;
    const len = s.endSec - s.startSec;
    const bestLen = b ? b.endSec - b.startSec : -1;
    if (!b || len > bestLen || (len === bestLen && s.location.confidence > (b.location as FixLocation).confidence)) best = i;
  });
  return best;
}

/** "0:36–0:48" */
function spanOf(s: Pick<FixSegment, 'startSec' | 'endSec'>): string {
  return `${clockText(s.startSec)}–${clockText(s.endSec)}`;
}

/**
 * The stretch a fix shows and what is said of it: the longest located stretch not at the
 * rejected place (`lead`), and the longest of all where that one is at the rejected place
 * (`passed`, shown below it in the timeline, said why).
 */
function shownStretch(p: VerdictParts, lead: number): {
  shown: FixSegment;
  place: FixLocation;
  span: string;
  passed: FixSegment | null;
  passedSpan: string;
  why: SegmentText;
  passedText: SegmentText;
} {
  const first = longestStretch(p, false);
  const passed = lead !== first && first >= 0 ? (p.segments[first] as FixSegment) : null;
  const shown = p.segments[lead] as FixSegment;
  const place = shown.location as FixLocation;
  const shownLen = shown.endSec - shown.startSec;
  // Another stretch as long, decided by the confidence: "the longest" alone would not be true.
  const tie = p.segments.some((s, i) => i !== lead && s.location && s.place !== null && (passed === null || !p.atRejected(s.location)) && s.endSec - s.startSec === shownLen);
  const restEn = passed ? 'remaining ' : '';
  // The only stretch with a place is not "the longest" of anything.
  const why: SegmentText =
    p.located.length === 1
      ? { de: 'der Abschnitt mit Ort', en: 'the segment with a place' }
      : tie
        ? { de: `der sicherste der gleich langen längsten ${passed ? 'übrigen ' : ''}Abschnitte mit Ort`, en: `the surest of the equally long longest ${restEn}segments with a place` }
        : { de: `der längste ${passed ? 'übrige ' : ''}Abschnitt mit Ort`, en: `the longest ${restEn}segment with a place` };
  const passedSpan = passed ? spanOf(passed) : '';
  const passedLoc = passed?.location ?? null;
  const passedText: SegmentText = passedLoc
    ? {
        de: ` Der längste Abschnitt mit Ort (${passedSpan}: ${passedLoc.label}) nennt den Ort, den das Weltmodell für die ganze Datei schon verworfen hat; er bleibt in der Zeitleiste, steht aber nicht oben.`,
        en: ` The longest segment with a place (${passedSpan}: ${passedLoc.labelEn ?? passedLoc.label}) names the place the world model already rejected for the whole file; it stays in the timeline but is not shown above.`,
      }
    : { de: '', en: '' };
  return { shown, place, span: spanOf(shown), passed, passedSpan, why, passedText };
}

/** The 'segments' entry's fields that name the stretch the fix shows (its keyframe is the lead's mark, see routes.ts slimFix). */
function shownFields(shown: FixSegment, place: FixLocation): Pick<Evidence, 'frame' | 'refLabel' | 'refLabelEn' | 'refLat' | 'refLon'> {
  return { frame: shown.keyframe.frame, refLabel: place.label, refLabelEn: place.labelEn ?? place.label, refLat: place.lat, refLon: place.lon };
}

/**
 * The located stretches of one place that lie at a point, by the rule places are told apart by:
 * within `sameKm` of it. A place the world model did not join is one chain of anchors each closer
 * than `sameKm` to the next (mergeWindows), so a point at one of its stretches is at the place and
 * at all its stretches (a drive from Dortmund through Bochum to Essen, 32 km, with the GPS tag in
 * Dortmund). A joined place may be several: from the stretches at the point the chain goes on only
 * through stretches each closer than `sameKm` to the next.
 */
function stretchesAt(point: GeoPoint, located: readonly FixSegment[], sameKm: number, joined: boolean): Set<FixSegment> {
  const near = (from: GeoPoint, s: FixSegment): boolean => s.location !== null && greatCircleKm(from.lat, from.lon, s.location.lat, s.location.lon) <= sameKm;
  const at = new Set(located.filter((s) => near(point, s)));
  if (at.size === 0) return at;
  if (!joined) return new Set(located);
  const next = [...at];
  for (let s = next.pop(); s !== undefined; s = next.pop()) {
    const from = s.location as FixLocation;
    for (const o of located) {
      if (at.has(o) || !near(from, o)) continue;
      at.add(o);
      next.push(o);
    }
  }
  return at;
}

/** The entry of gpsApartEvidence and what the trace note adds after "GPS der Datei gilt". */
export interface GpsApart {
  entry: Evidence;
  note: SegmentText;
}

/**
 * The entry for a file with GPS whose pictures show one place away from that position: farther
 * than `sameKm`, the distance at which answers count as different places. The file's position
 * stands (it covers the whole file); the entry has no weight and names no frame, as the entry of
 * several places with GPS does, and says where and how far. Null where the place lies at the
 * position (one of its stretches is within `sameKm`; for a place the world model joined, all of
 * them are, also through a chain), or where there is no position to compare with.
 *
 * Only the stretches away from the position are named: the longest of them, with its own place
 * and distance and how many there are; the ones of a joined place at the position are counted
 * apart. Stretches at `rejected`, the gallery's answer for the whole file that the world model
 * turned down (the test of segmentVerdict's `atRejected`), do not put the GPS position in doubt:
 * the whole file's decision saw the same pictures and found that place wrong (Bhf. Eschborn with
 * its GPS tag, held for the Bahnhof Norderstedt Mitte 408 km away). Where the other stretches away
 * from the position are all at that place, the entry says it is the rejected one and does not ask
 * whether the GPS tag belongs to another recording.
 */
export function gpsApartEvidence(p: {
  segments: readonly FixSegment[];
  located: readonly FixSegment[];
  current: FixLocation | null;
  sameKm: number;
  rejected: FixLocation | null;
  joined: boolean;
  /** How places are told apart, and what a joined place means (segmentVerdict's `rule`). */
  rule: SegmentText;
}): GpsApart | null {
  const { segments, located, current, sameKm, rejected, rule } = p;
  if (!current) return null;
  const atGps = stretchesAt(current, located, sameKm, p.joined);
  const apart = located.filter((s) => s.location && !atGps.has(s));
  if (apart.length === 0) return null;
  const isRejected = (s: FixSegment): boolean => rejected !== null && greatCircleKm(rejected.lat, rejected.lon, (s.location as FixLocation).lat, (s.location as FixLocation).lon) <= sameKm;
  const elsewhere = apart.filter((s) => !isRejected(s));
  // What the entry names: the stretches away from the position and from the rejected place, or,
  // where there are none, those at the rejected place.
  const onlyRejected = elsewhere.length === 0;
  const named = onlyRejected ? apart : elsewhere;
  // The longest of them, on equal length the surer one: where the pictures say most.
  const len = (s: FixSegment): number => s.endSec - s.startSec;
  let best = named[0] as FixSegment;
  for (const s of named) {
    if (len(s) > len(best) || (len(s) === len(best) && (s.location as FixLocation).confidence > (best.location as FixLocation).confidence)) best = s;
  }
  const place = best.location as FixLocation;
  const km = greatCircleKm(current.lat, current.lon, place.lat, place.lon);
  const k = named.length;
  const span = spanOf(best);
  // Another stretch as long, decided by the confidence: "the longest" alone would not be true.
  const tie = named.some((s) => s !== best && len(s) === len(best));
  // The label is said of the stretch it belongs to only, not of every stretch counted.
  const whereDe =
    segments.length < 2 ? '' : k === 1 ? ` im Abschnitt ${span}` : ` in ${k} Abschnitten einen Ort, ${tie ? 'im sichersten der gleich langen längsten' : 'im längsten'} (${span})`;
  const whereEn =
    segments.length < 2 ? '' : k === 1 ? ` in the segment ${span}` : ` one place in ${k} segments, ${tie ? 'in the surest of the equally long longest' : 'in the longest'} (${span})`;
  const atCount = atGps.size;
  const atDe = atCount > 0 ? ` ${atCount === 1 ? 'Ein weiterer Abschnitt des Orts liegt' : `${atCount} weitere Abschnitte des Orts liegen`} bei der GPS-Angabe.` : '';
  const atEn = atCount > 0 ? ` ${atCount === 1 ? 'One more segment of the place lies' : `${atCount} more segments of the place lie`} at the GPS position.` : '';
  const rejectedCount = onlyRejected ? 0 : apart.length - elsewhere.length;
  const alsoDe =
    rejectedCount > 0 ? ` ${rejectedCount === 1 ? 'Ein weiterer Abschnitt nennt' : `${rejectedCount} weitere Abschnitte nennen`} den Ort, den das Weltmodell für die ganze Datei schon verworfen hat.` : '';
  const alsoEn = rejectedCount > 0 ? ` ${rejectedCount === 1 ? 'One more segment names' : `${rejectedCount} more segments name`} the place the world model already rejected for the whole file.` : '';
  const closeDe = onlyRejected
    ? `${k === 1 ? `${place.label} ist der Ort` : `Die ${k} Abschnitte abseits der GPS-Angabe nennen den Ort`}, den das Weltmodell für die ganze Datei schon verworfen hat; er stellt die GPS-Angabe nicht in Frage. Die GPS-Angabe gilt für die ganze Datei und bestimmt den Ort.`
    : 'Die GPS-Angabe gilt für die ganze Datei und bestimmt den Ort; ob die Aufnahme geschnitten oder zusammengesetzt ist oder die GPS-Angabe zu einer anderen Aufnahme gehört, sollte geprüft werden.';
  const closeEn = onlyRejected
    ? `${k === 1 ? `${place.labelEn ?? place.label} is` : `The ${k} segments away from the GPS position name`} the place the world model already rejected for the whole file, so it does not call the GPS position into question. The GPS position covers the whole file and decides the place.`
    : 'The GPS position covers the whole file and decides the place; whether the recording was cut or put together, or whether the GPS position belongs to another recording, should be checked.';
  // Part of the pictures at the position (a joined place), or all of them away from it.
  const someDe = atCount > 0 ? 'Ein Teil der Bilder zeigt' : 'Die Bilder zeigen';
  const someEn = atCount > 0 ? 'Some of the pictures show' : 'The pictures show';
  const labelEn = place.labelEn ?? place.label;
  return {
    entry: {
      kind: 'segments',
      label: onlyRejected ? `${someDe} den vom Weltmodell verworfenen Ort, ${kmDe(km)} von der GPS-Angabe` : `${someDe} einen Ort ${kmDe(km)} von der GPS-Angabe`,
      labelEn: onlyRejected ? `${someEn} the place the world model rejected, ${kmEn(km)} from the GPS position` : `${someEn} a place ${kmEn(km)} from the GPS position`,
      detail: `Abschnittsweise geortet zeigen die Bilder${whereDe} ${place.label} (± ${kmDe(place.radiusKm)}, Sicherheit ${pctDe(place.confidence)}), ${kmDe(km)} von der GPS-Angabe der Datei. ${rule.de}${atDe}${alsoDe} ${closeDe}`,
      detailEn: `Located segment by segment, the pictures show${whereEn} ${labelEn} (± ${kmEn(place.radiusKm)}, confidence ${pctEn(place.confidence)}), ${kmEn(km)} from the GPS position in the file. ${rule.en}${atEn}${alsoEn} ${closeEn}`,
      weight: 0,
    },
    note: {
      de: `${atCount > 0 ? 'ein Teil der Bilder' : 'der Ort der Bilder'} liegt ${kmDe(km)} davon${onlyRejected ? ', am verworfenen Ort' : ''}`,
      en: `${atCount > 0 ? 'some of the pictures lie' : "the pictures' place lies"} ${kmEn(km)} from it${onlyRejected ? ', at the rejected place' : ''}`,
    },
  };
}

/**
 * What the stretches mean for the fix. A recording of one stretch keeps everything as it was. With
 * at least two places, the fix carries the stretches and its place must not pretend: it
 * stays where the answer for the whole file agrees with the longest located stretch, and becomes
 * that stretch's place otherwise; an evidence entry names the places and the stretch shown. With
 * GPS in the file, the file's position stands (it covers the whole file) and the entry only says
 * that the pictures show several places.
 *
 * One recognised place with undetermined stretches (engine 12) carries the stretches too: the
 * undetermined ones may show other places, and the whole file's answer mixes their frames in
 * (Stadt-Land: 24 s Cork, then a church and a bridge in Germany, gave "Frankfurt"). Its place shows
 * above, as for several places, only when its stretches together last at least `leadShare` of the
 * recording; a short stretch would otherwise stand for a long recording it says nothing of (a
 * 12-s bridge in Korea above a 96-s world tour). Below that, the whole file's answer stays above,
 * with its time and spaces, and the stretches are the timeline: each located one with its own
 * time and space, the undetermined ones with their coarse regions. With GPS such a recording
 * stays as it was: the file's position covers the whole file and decides the place. Where the
 * pictures' one place lies farther than `sameKm` from that position (a recording cut together, or
 * a GPS tag of another recording), an entry without weight says so, as it does for several
 * places (gpsApartEvidence, engine 13); with a single stretch too.
 *
 * `rejected` is the gallery's answer for the whole file where the world model replaced it
 * (LocateDiagnostics.gallery): a stretch at that place does not lead. The whole file's decision
 * saw more frames and both models and turned that answer down; a stretch decided from a few frames
 * of the same pictures (a station that the gallery takes for another one 400 km away) must not
 * bring it back as the fix's place with a radius of a few kilometres. The stretch keeps its answer
 * in the timeline. With GPS such a stretch does not put the position in doubt either: the entry
 * says the place is the rejected one (gpsApartEvidence).
 */
export function segmentVerdict(
  segments: readonly FixSegment[],
  current: FixLocation | null,
  opts: { gps: boolean; sameKm?: number; rejected?: FixLocation | null; leadShare?: number },
): SegmentVerdict {
  const places = new Set(segments.map((s) => s.place).filter((p) => p !== null)).size;
  const located = segments.filter((s) => s.location && s.place !== null);
  const undetermined = segments.filter((s) => !s.location).length;
  const joined = new Set(segments.filter((s) => s.joined && s.place !== null).map((s) => s.place)).size;
  const sameKm = opts.sameKm ?? DEFAULT_SEGMENT_PARAMS.sameKm;
  const rejected = opts.rejected ?? null;
  // How places are told apart; distinct places are farther apart than this, but one place need
  // not be narrower (the world model's ties, see mergeWindows).
  const joinedDe =
    joined > 0
      ? ` ${joined === 1 ? 'Ein Ort fasst' : `${joined} Orte fassen`} Antworten zusammen, die weiter auseinanderliegen, weil das Weltmodell ihrer Fenster sie derselben Gegend zurechnet; es können also mehr Orte sein.`
      : '';
  const joinedEn =
    joined > 0
      ? ` ${joined === 1 ? 'One place joins' : `${joined} places join`} answers that lie farther apart, because the world model of their windows puts them in the same region; there may be more places.`
      : '';
  const rule: SegmentText = { de: `Antworten näher als ${sameKm} km beieinander zählen als ein Ort.${joinedDe}`, en: `Answers closer than ${sameKm} km count as one place.${joinedEn}` };
  // One stretch, no place (a place always has a located stretch; checked all the same), or one
  // place in a file with GPS: nothing to show stretch by stretch.
  if (places === 0 || located.length === 0 || segments.length < 2 || (places === 1 && opts.gps)) {
    const apart = places === 1 && opts.gps ? gpsApartEvidence({ segments, located, current, sameKm, rejected, joined: joined > 0, rule }) : null;
    const gpsNote =
      places === 1 && opts.gps
        ? apart
          ? { de: `, GPS der Datei gilt; ${apart.note.de}`, en: `, the file's GPS stands; ${apart.note.en}` }
          : { de: ', GPS der Datei gilt', en: ", the file's GPS stands" }
        : { de: '', en: '' };
    const note: SegmentText =
      segments.length <= 1
        ? { de: `ein Abschnitt${gpsNote.de}`, en: `one segment${gpsNote.en}` }
        : {
            de: `${segments.length} Abschnitte, ein Ort${undetermined > 0 ? ` (${undetermined} unbestimmt)` : ''}${gpsNote.de}`,
            en: `${segments.length} segments, one place${undetermined > 0 ? ` (${undetermined} undetermined)` : ''}${gpsNote.en}`,
          };
    return { multi: false, places, joined, location: current, replaced: false, lead: null, evidence: apart ? [apart.entry] : [], note };
  }
  // Coarse regions (FixSegment.coarse) are no places: said so where there are any.
  const withCoarse = segments.filter((s) => !s.location && s.coarse && s.coarse.length > 0).length;
  const coarse: SegmentText =
    withCoarse > 0
      ? {
          de: ` Für ${withCoarse === undetermined ? (withCoarse === 1 ? 'ihn' : 'sie alle') : withCoarse === 1 ? 'einen davon' : `${withCoarse} davon`} nennt die Zeitleiste eine grobe Region, die nicht als Ort zählt.`,
          en: ` For ${withCoarse === undetermined ? (withCoarse === 1 ? 'it' : 'all of them') : withCoarse === 1 ? 'one of them' : `${withCoarse} of them`} the timeline names a coarse region, which does not count as a place.`,
        }
      : { de: '', en: '' };
  const parts: VerdictParts = {
    segments,
    located,
    undetermined,
    sameKm,
    atRejected: (loc) => rejected !== null && greatCircleKm(rejected.lat, rejected.lon, loc.lat, loc.lon) <= sameKm,
    rule,
    coarse,
  };
  if (places === 1) return onePlaceVerdict(parts, current, joined, opts.leadShare ?? DEFAULT_SEGMENT_PARAMS.leadShare);
  // Undetermined stretches may hold further places, and so may a place the world model joined
  // from answers that lie apart: then the count is a lower bound.
  const atLeast: SegmentText = undetermined > 0 || joined > 0 ? { de: 'mindestens ', en: 'at least ' } : { de: '', en: '' };
  if (opts.gps) {
    return {
      multi: false,
      places,
      joined,
      location: current,
      replaced: false,
      lead: null,
      evidence: [
        {
          kind: 'segments',
          label: `Die Bilder zeigen ${atLeast.de}${places} verschiedene Orte`,
          labelEn: `The pictures show ${atLeast.en}${places} different places`,
          detail: `Abschnittsweise geortet zeigen die Bilder ${atLeast.de}${places} verschiedene Orte. ${rule.de} Die GPS-Angabe der Datei gilt für die ganze Datei und bestimmt den Ort; ob die Aufnahme geschnitten oder zusammengesetzt ist, sollte geprüft werden.`,
          detailEn: `Located segment by segment, the pictures show ${atLeast.en}${places} different places. ${rule.en} The GPS position in the file covers the whole file and decides the place; whether the recording was cut or put together should be checked.`,
          weight: 0,
        },
      ],
      note: { de: `${atLeast.de}${places} Orte in den Bildern, GPS der Datei gilt`, en: `${atLeast.en}${places} places in the pictures, the file's GPS stands` },
    };
  }
  const other = longestStretch(parts, true);
  const lead = other >= 0 ? other : longestStretch(parts, false);
  const { shown, place, span, passed, passedSpan, why, passedText } = shownStretch(parts, lead);
  // Agreeing means the same place as the stretches are told apart (sameKm), not overlapping circles:
  // two answers of 1 500 km 800 km apart would agree, and the top would name another city.
  const agrees = current !== null && greatCircleKm(current.lat, current.lon, place.lat, place.lon) <= sameKm;
  const labelDe = place.label;
  const labelEn = place.labelEn ?? place.label;
  const undeterminedDe = undetermined > 0 ? ` ${undetermined} ${undetermined === 1 ? 'Abschnitt bleibt' : 'Abschnitte bleiben'} unbestimmt.${coarse.de}` : '';
  const undeterminedEn = undetermined > 0 ? ` ${undetermined} ${undetermined === 1 ? 'segment remains' : 'segments remain'} undetermined.${coarse.en}` : '';
  const keptDe = agrees ? 'Die Ortung aus der ganzen Datei stimmt mit ihm überein und bleibt.' : 'Er ersetzt die Ortung aus der ganzen Datei, die die Orte vermischt.';
  const keptEn = agrees ? 'The fix from the whole file agrees with it and stands.' : 'It replaces the fix from the whole file, which mixes the places.';
  return {
    multi: true,
    places,
    joined,
    location: agrees ? current : place,
    replaced: !agrees,
    lead,
    evidence: [
      {
        kind: 'segments',
        label: `Die Aufnahme zeigt ${atLeast.de}${places} Orte; oben der Abschnitt ${span}`,
        labelEn: `The recording shows ${atLeast.en}${places} places; shown above: segment ${span}`,
        detail: `Abschnittsweise geortet: ${segments.length} Abschnitte, ${located.length} davon mit Ort, ${atLeast.de}${places} verschiedene Orte. ${rule.de}${passedText.de} Oben steht ${why.de}, ${span}: ${labelDe}, ± ${kmDe(place.radiusKm)}, Sicherheit ${pctDe(place.confidence)}. ${keptDe}${undeterminedDe} Die Zeitleiste unter dem Video zeigt jeden Abschnitt.`,
        detailEn: `Located segment by segment: ${segments.length} segments, ${located.length} of them with a place, ${atLeast.en}${places} different places. ${rule.en}${passedText.en} Shown above is ${why.en}, ${span}: ${labelEn}, ± ${kmEn(place.radiusKm)}, confidence ${pctEn(place.confidence)}. ${keptEn}${undeterminedEn} The timeline under the video shows every segment.`,
        weight: agrees ? 0.5 : 0.9,
        ...shownFields(shown, place),
      },
    ],
    note: {
      de: `${atLeast.de}${places} Orte in ${segments.length} Abschnitten; oben ${span}${agrees ? '' : ', ersetzt die Ortung der ganzen Datei'}${passed ? `, nicht ${passedSpan} (verworfen)` : ''}`,
      en: `${atLeast.en}${places} places in ${segments.length} segments; shown ${span}${agrees ? '' : ', replaces the fix of the whole file'}${passed ? `, not ${passedSpan} (rejected)` : ''}`,
    },
  };
}

/**
 * segmentVerdict for one recognised place and at least one undetermined stretch (see there): the
 * stretches always, the place above only from `leadShare` of the recording on and not at the
 * place the whole file's world model rejected.
 */
function onePlaceVerdict(p: VerdictParts, current: FixLocation | null, joined: number, leadShare: number): SegmentVerdict {
  const { segments, located, undetermined, rule, coarse } = p;
  const n = segments.length;
  const span = Math.max(0, segments[n - 1]!.endSec - segments[0]!.startSec);
  // The share counts only the stretches that may lead: those at the place the whole file's world
  // model rejected cannot, and a short stretch elsewhere must not stand for a recording they fill
  // (40 s of a rejected place and 3 s of Köln in 100 s are not 43 % Köln).
  const counted = located.filter((s) => !p.atRejected(s.location as FixLocation));
  const rejectedCount = located.length - counted.length;
  const placeSec = counted.reduce((sum, s) => sum + (s.endSec - s.startSec), 0);
  const share = span > 0 ? placeSec / span : 0;
  const candidate = longestStretch(p, true);
  const lead = candidate >= 0 && share + SHARE_EPS >= leadShare ? candidate : null;
  const one = located.length === 1;
  const undeterminedDe = undetermined === 1 ? 'ein Abschnitt unbestimmt' : `${undetermined} Abschnitte unbestimmt`;
  const undeterminedEn = undetermined === 1 ? 'one segment undetermined' : `${undetermined} segments undetermined`;
  // The undetermined stretches are what the whole file's answer mixes in: said first, with their
  // coarse regions.
  const elsewhereDe = `${undetermined === 1 ? 'Ein Abschnitt bleibt unbestimmt; er kann' : `${undetermined} Abschnitte bleiben unbestimmt; sie können`} einen anderen Ort zeigen.${coarse.de}`;
  const elsewhereEn = `${undetermined === 1 ? 'One segment remains undetermined and may show another place.' : `${undetermined} segments remain undetermined and may show other places.`}${coarse.en}`;
  // How places are told apart says something only where several stretches have one (or the
  // world model joined answers far apart).
  const ruled = !one || joined > 0;
  const countDe = `Abschnittsweise geortet: ${n} Abschnitte, ${one ? 'einer' : located.length} davon mit Ort, ein erkannter Ort.${ruled ? ` ${rule.de}` : ''}`;
  const countEn = `Located segment by segment: ${n} segments, ${one ? 'one' : located.length} of them with a place, one recognised place.${ruled ? ` ${rule.en}` : ''}`;
  // What the share is of: the place, or the place without its stretches at the rejected place.
  const withoutDe = rejectedCount > 0 ? `ohne ${rejectedCount === 1 ? 'den Abschnitt' : `die ${rejectedCount} Abschnitte`} an dem Ort, den das Weltmodell für die ganze Datei verworfen hat, ` : '';
  const withoutEn = rejectedCount > 0 ? `without the ${rejectedCount === 1 ? 'segment' : `${rejectedCount} segments`} at the place the world model rejected for the whole file, ` : '';
  const sharePct = sharePercent(share);
  const shareDe =
    rejectedCount > 0 ? `${withoutDe}umfasst der Ort ${sharePct} % der Aufnahme` : `${one ? 'der Abschnitt umfasst' : 'die Abschnitte mit Ort umfassen zusammen'} ${sharePct} % der Aufnahme`;
  const shareEn =
    rejectedCount > 0 ? `${withoutEn}the place covers ${sharePct}% of the recording` : `${one ? 'the segment covers' : 'the segments with a place cover'} ${sharePct}% of the recording`;
  const noteHead: SegmentText = {
    de: `1 erkannter Ort in ${n} Abschnitten (${undetermined} unbestimmt)`,
    en: `1 recognised place in ${n} segments (${undetermined} undetermined)`,
  };
  if (lead === null) {
    const first = segments[longestStretch(p, false)] as FixSegment;
    const loc = first.location as FixLocation;
    const firstSpan = spanOf(first);
    // Why no stretch shows above: its place is the one the whole file turned down, or it covers too
    // little of the recording to stand for it. The share said stays below the threshold.
    const atRejected = candidate < 0;
    const below = belowPercent(share, leadShare);
    const limitDe = pctDe(leadShare);
    const limitEn = pctEn(leadShare);
    const whyDe = atRejected
      ? one
        ? `Der Abschnitt mit Ort (${firstSpan}: ${loc.label}) nennt den Ort, den das Weltmodell für die ganze Datei schon verworfen hat; er bleibt in der Zeitleiste, steht aber nicht oben.`
        : `Die Abschnitte mit Ort (der längste ${firstSpan}: ${loc.label}) nennen den Ort, den das Weltmodell für die ganze Datei schon verworfen hat; sie bleiben in der Zeitleiste, stehen aber nicht oben.`
      : rejectedCount > 0
        ? `${withoutDe.charAt(0).toUpperCase()}${withoutDe.slice(1)}umfasst der Ort nur ${below} % der Aufnahme, weniger als die ${limitDe}, ab denen ein Ort oben steht.`
        : `${one ? `Der Abschnitt mit Ort (${firstSpan}: ${loc.label}) umfasst` : 'Die Abschnitte mit Ort umfassen zusammen'} nur ${below} % der Aufnahme, weniger als die ${limitDe}, ab denen ein Ort oben steht.`;
    const whyEn = atRejected
      ? one
        ? `The segment with a place (${firstSpan}: ${loc.labelEn ?? loc.label}) names the place the world model already rejected for the whole file; it stays in the timeline but is not shown above.`
        : `The segments with a place (the longest ${firstSpan}: ${loc.labelEn ?? loc.label}) name the place the world model already rejected for the whole file; they stay in the timeline but are not shown above.`
      : rejectedCount > 0
        ? `${withoutEn.charAt(0).toUpperCase()}${withoutEn.slice(1)}the place covers only ${below}% of the recording, less than the ${limitEn} from which a place is shown above.`
        : `${one ? `The segment with a place (${firstSpan}: ${loc.labelEn ?? loc.label}) covers` : 'The segments with a place cover'} only ${below}% of the recording, less than the ${limitEn} from which a place is shown above.`;
    return {
      multi: true,
      places: 1,
      joined,
      location: current,
      replaced: false,
      lead: null,
      evidence: [
        {
          kind: 'segments',
          label: `Die Aufnahme zeigt einen erkannten Ort; ${undeterminedDe}`,
          labelEn: `The recording shows one recognised place; ${undeterminedEn}`,
          // No frame: the entry names no stretch as the fix's (see routes.ts slimFix, the console's leadSegment).
          detail: `${countDe} ${elsewhereDe} ${whyDe} Ort, Uhrzeit und Räume oben sind die der ganzen Datei, deren Bilder auch die unbestimmten Abschnitte einschließen; ${one ? 'der Abschnitt mit Ort hat' : 'die Abschnitte mit Ort haben'} in der Zeitleiste unter dem Video ${one ? 'seine' : 'ihre'} eigene Uhrzeit.`,
          detailEn: `${countEn} ${elsewhereEn} ${whyEn} The place, time and spaces above are those of the whole file, whose pictures include the undetermined segments too; in the timeline under the video the ${one ? 'segment with a place has its' : 'segments with a place have their'} own time.`,
          weight: 0,
        },
      ],
      note: atRejected
        ? { de: `${noteHead.de}; oben die ganze Datei: der Ort ist der verworfene`, en: `${noteHead.en}; the whole file stays above: the place is the rejected one` }
        : rejectedCount > 0
          ? {
              de: `${noteHead.de}; oben die ganze Datei: der Ort umfasst ohne ${rejectedCount === 1 ? 'seinen Abschnitt' : 'seine Abschnitte'} am verworfenen Ort nur ${below} % (unter ${limitDe})`,
              en: `${noteHead.en}; the whole file stays above: without its ${rejectedCount === 1 ? 'segment' : 'segments'} at the rejected place it covers only ${below}% (below ${limitEn})`,
            }
          : { de: `${noteHead.de}; oben die ganze Datei: der Ort umfasst nur ${below} % (unter ${limitDe})`, en: `${noteHead.en}; the whole file stays above: the place covers only ${below}% (below ${limitEn})` },
    };
  }
  const { shown, place, span: shownSpan, passed, passedSpan, why, passedText } = shownStretch(p, lead);
  const agrees = current !== null && greatCircleKm(current.lat, current.lon, place.lat, place.lon) <= p.sameKm;
  const keptDe = agrees ? 'Die Ortung aus der ganzen Datei stimmt mit ihm überein und bleibt.' : 'Er ersetzt die Ortung aus der ganzen Datei, deren Bilder auch die unbestimmten Abschnitte einschließen.';
  const keptEn = agrees ? 'The fix from the whole file agrees with it and stands.' : 'It replaces the fix from the whole file, whose pictures include the undetermined segments too.';
  return {
    multi: true,
    places: 1,
    joined,
    location: agrees ? current : place,
    replaced: !agrees,
    lead,
    evidence: [
      {
        kind: 'segments',
        label: `Die Aufnahme zeigt einen erkannten Ort; ${undeterminedDe}; oben der Abschnitt ${shownSpan}`,
        labelEn: `The recording shows one recognised place; ${undeterminedEn}; shown above: segment ${shownSpan}`,
        detail: `${countDe}${passedText.de} ${elsewhereDe} Oben steht ${why.de}, ${shownSpan}: ${place.label}, ± ${kmDe(place.radiusKm)}, Sicherheit ${pctDe(place.confidence)}; ${shareDe} (ab ${pctDe(leadShare)} steht ein Ort oben). ${keptDe} Die Zeitleiste unter dem Video zeigt jeden Abschnitt.`,
        detailEn: `${countEn}${passedText.en} ${elsewhereEn} Shown above is ${why.en}, ${shownSpan}: ${place.labelEn ?? place.label}, ± ${kmEn(place.radiusKm)}, confidence ${pctEn(place.confidence)}; ${shareEn} (a place is shown above from ${pctEn(leadShare)} on). ${keptEn} The timeline under the video shows every segment.`,
        weight: agrees ? 0.5 : 0.9,
        ...shownFields(shown, place),
      },
    ],
    note: {
      de: `${noteHead.de}; oben ${shownSpan}${agrees ? '' : ', ersetzt die Ortung der ganzen Datei'}${passed ? `, nicht ${passedSpan} (verworfen)` : ''}`,
      en: `${noteHead.en}; shown ${shownSpan}${agrees ? '' : ', replaces the fix of the whole file'}${passed ? `, not ${passedSpan} (rejected)` : ''}`,
    },
  };
}

/** The prefix of the whole file's entries in a fix whose place came from a stretch (wholeFileEvidence). */
export const WHOLE_FILE: SegmentText = { de: 'Ganze Datei (gemischt): ', en: 'Whole file (mixed): ' };

/**
 * An evidence entry of the whole file's decision in a fix whose place came from a stretch: what
 * it says of "the result" ("1 km from the result: a recognition", "which stands") is said of the
 * whole file's answer, which mixes the places (or the place with the undetermined stretches,
 * `mix`) and is no longer the fix's. Entries that name a place (reference pictures, the world
 * model, the country estimate) say so and lose their weight; the others (sun, file name) stay as
 * they are.
 */
export function wholeFileEvidence(e: Evidence, mix: WholeFileMix = 'places'): Evidence {
  if (e.kind !== 'landmark' && e.kind !== 'worldmodel' && e.kind !== 'region') return e;
  const m = mixed(mix).fix;
  return {
    ...e,
    label: `${WHOLE_FILE.de}${e.label}`,
    labelEn: `${WHOLE_FILE.en}${e.labelEn ?? e.label}`,
    detail: `Aus der Ortung der ganzen Datei, ${m.de}; „Ergebnis“ ist hier deren Antwort, nicht der oben gezeigte Ort. ${e.detail}`,
    detailEn: `From the fix of the whole file, ${m.en}; "result" here is its answer, not the place shown above. ${e.detailEn ?? e.detail}`,
    weight: 0,
  };
}

/**
 * The first country estimate of a fix whose countries are the stretches' shares of the recording
 * time (verdictCountries): where it says the fix's countries are the world model's (locate.ts
 * REGION_ROLE.world, the whole file's answer came from the world model), it says now that they are
 * the stretches' shares, as the console heads them ("Anteil der Aufnahmezeit"). Every other entry,
 * and every other estimate's role, stays as it is.
 */
export function stretchCountryEvidence(e: Evidence): Evidence {
  if (e.kind !== 'region') return e;
  const from = REGION_ROLE.world;
  const to = REGION_ROLE.worldStretches;
  const en = e.detailEn ?? e.detail;
  if (!e.detail.endsWith(from.de) && !en.endsWith(from.en)) return e;
  return {
    ...e,
    detail: e.detail.endsWith(from.de) ? `${e.detail.slice(0, -from.de.length)}${to.de}` : e.detail,
    detailEn: en.endsWith(from.en) ? `${en.slice(0, -from.en.length)}${to.en}` : en,
  };
}

/**
 * The whole file's localisation with what its stretches change (engine.ts, DatumEngine.segment):
 * where the verdict has an entry, the place it shows, its entry first, the places as candidates
 * where a stretch replaced the place, and the stretches' countries where they stand for the fix
 * (verdictCountries). The whole file's entries stay; where a stretch's place replaced its answer
 * they are said to be of the whole file (wholeFileEvidence), and where the countries are the
 * stretches' the country estimate says so (stretchCountryEvidence): it said "the fix's countries
 * are the world model's" above bars headed "Anteil der Aufnahmezeit" (a world-model place in
 * Paris for 40 of 60 s, Berlin for 20: Frankreich 67 %, Deutschland 33 %).
 */
export function placedByStretches(
  located: LocateResult,
  parts: { verdict: Pick<SegmentVerdict, 'evidence' | 'location' | 'replaced' | 'places'>; candidates: FixCandidate[] | null; countries: CountryProb[] | null },
): LocateResult {
  const { verdict } = parts;
  if (verdict.evidence.length === 0) return located;
  // What the whole file's frames mix with the stretch shown: other places, or the undetermined
  // stretches of a recording of one recognised place (its entries say which).
  const mix: WholeFileMix = verdict.places === 1 ? 'undetermined' : 'places';
  const whole = verdict.replaced ? located.evidence.map((e) => wholeFileEvidence(e, mix)) : located.evidence;
  return {
    ...located,
    location: verdict.location,
    evidence: [...verdict.evidence, ...(parts.countries ? whole.map(stretchCountryEvidence) : whole)],
    ...(parts.candidates ? { candidates: parts.candidates } : {}),
    ...(parts.countries ? { countries: parts.countries } : {}),
  };
}

function kmDe(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${Math.round(km).toLocaleString('de-DE')} km`;
}

function kmEn(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${Math.round(km).toLocaleString('en-GB')} km`;
}

/** What analyseSegments needs of the node (the engine hands in the real ones, tests stand-ins). */
export interface SegmentDeps {
  world: World;
  embedTexts: EmbedTexts;
  /** The gallery search (Gallery.searchAsync). */
  search: (vectors: Float32Array, k: number, opts?: GallerySearchOptions) => Promise<GalleryNeighbour[][]>;
  /**
   * The world model's prediction for these analysis frames (indices into the frames), or null
   * (none, or not now). Absent: windows are decided without the world model.
   */
  predictWorld?: (frameIndices: number[]) => Promise<GeoclipPrediction | null>;
  /** Stops asking the world model (a person's job is waiting); later windows go without it. */
  stopWorld?: () => boolean;
  /**
   * Stops the gallery search between its calls (the engine stops, the recording was deleted, or a
   * background job gives way to a person's): the windows not searched yet stay undetermined.
   */
  stopSearch?: () => boolean;
}

export interface SegmentInput {
  frames: readonly SegmentFrame[];
  scenes: readonly SegmentScene[];
  durationSec: number | null;
  /** The analysis vectors: frames.length * tiles rows of dim floats (tile 0 is the whole frame). */
  matrix: Float32Array;
  tiles: number;
  dim: number;
  excludeWikidata?: string[];
  params?: Partial<SegmentParams>;
  locateParams?: Partial<LocateParams>;
}

export interface SegmentAnalysis {
  windows: WindowAnswer[];
  merged: MergeResult;
  /** Frames the world model looked at, and windows that went without it after stopWorld. */
  worldFrames: number;
  worldSkipped: number;
  /** Windows left unsearched after stopSearch (undetermined), and the gallery searches made. */
  searchSkipped: number;
  searches: number;
  timing: { searchMs: number; worldMs: number; decideMs: number };
}

/**
 * Decides every window of a recording (steps 1 to 3 of the module comment). The gallery searches
 * (whole windows, at most `searchRows` rows each, one after another) and the world model's
 * predictions run side by side (each in its own thread); the decisions run on this thread, one
 * window at a time with a turn of the event loop between them.
 */
export async function analyseSegments(input: SegmentInput, deps: SegmentDeps): Promise<SegmentAnalysis> {
  const params: SegmentParams = { ...DEFAULT_SEGMENT_PARAMS, ...input.params };
  const { frames, matrix, tiles, dim } = input;
  const wholeFrame = (i: number): Float32Array => matrix.subarray(i * tiles * dim, i * tiles * dim + dim);
  const windows = buildWindows(frames, input.scenes, input.durationSec, wholeFrame, params, params.fallbackWindowSec);
  // Rows of the gallery search: per window its frames, each whole and in its crops.
  const picks = windows.map((w) => spreadIndices(w.first, w.last, params.galleryFrames));
  const rowCount = picks.reduce((s, p) => s + p.length * tiles, 0);
  const rows = new Float32Array(rowCount * dim);
  let r = 0;
  for (const p of picks) {
    for (const f of p) {
      rows.set(matrix.subarray(f * tiles * dim, (f + 1) * tiles * dim), r * dim);
      r += tiles;
    }
  }
  const k = input.locateParams?.k ?? 30;
  const timing = { searchMs: 0, worldMs: 0, decideMs: 0 };
  const t0 = performance.now();
  // Windows searched so far (a prefix); the rest stay undetermined after stopSearch.
  let searchedWindows = 0;
  let searches = 0;
  const searched = (async (): Promise<GalleryNeighbour[][]> => {
    const out: GalleryNeighbour[][] = [];
    let row = 0;
    while (searchedWindows < windows.length && !deps.stopSearch?.()) {
      // Whole windows up to searchRows rows (at least one window).
      let end = searchedWindows;
      let count = 0;
      while (end < windows.length && (count === 0 || count + (picks[end] as number[]).length * tiles <= params.searchRows)) {
        count += (picks[end] as number[]).length * tiles;
        end++;
      }
      out.push(...(await deps.search(rows.subarray(row * dim, (row + count) * dim), k, input.excludeWikidata ? { excludeWikidata: input.excludeWikidata } : {})));
      searches++;
      row += count;
      searchedWindows = end;
    }
    timing.searchMs = performance.now() - t0;
    return out;
  })();
  // The world model, window by window (its thread runs one call after another anyway; asking one
  // at a time lets a person's job go first, see stopWorld).
  const plan = deps.predictWorld ? planWorldFrames(windows, params.worldFramesPerWindow, params.worldFramesTotal) : windows.map(() => 0);
  let worldFrames = 0;
  let worldSkipped = 0;
  const predictions: (GeoclipPrediction | null)[] = windows.map(() => null);
  const asking = (async () => {
    const t1 = performance.now();
    for (let i = 0; i < windows.length; i++) {
      const count = plan[i] as number;
      if (count <= 0 || !deps.predictWorld) continue;
      if (deps.stopWorld?.()) {
        worldSkipped++;
        continue;
      }
      const w = windows[i] as SegmentWindow;
      const chosen = spreadIndices(w.first, w.last, count);
      predictions[i] = await deps.predictWorld(chosen).catch(() => null);
      if (predictions[i]) worldFrames += chosen.length;
    }
    timing.worldMs = performance.now() - t1;
  })();
  const [neighbours] = await Promise.all([searched, asking]);
  const t2 = performance.now();
  const answers: WindowAnswer[] = [];
  let at = 0;
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i] as SegmentWindow;
    const p = picks[i] as number[];
    if (i >= searchedWindows) {
      // Not searched (stopSearch): no gallery answer, so no place for this window.
      answers.push({ ...w, location: null, tier: null, geoclip: predictions[i] ?? null, diagnostics: null });
      continue;
    }
    const rowsHere = neighbours.slice(at, at + p.length * tiles);
    at += p.length * tiles;
    const whole = new Float32Array(p.length * dim);
    p.forEach((f, j) => whole.set(wholeFrame(f), j * dim));
    const countryCosines = await deps.world.countryCosines(whole, dim, deps.embedTexts);
    const rowFrame: number[] = [];
    const rowTile: number[] = [];
    p.forEach((_, j) => {
      for (let t = 0; t < tiles; t++) {
        rowFrame.push(j);
        rowTile.push(t);
      }
    });
    const decided: LocateResult = decideLocation(
      deps.world,
      {
        neighbours: rowsHere,
        rowFrame,
        rowTile,
        countryCosines,
        frameNumbers: p.map((f) => (frames[f] as SegmentFrame).n),
        metadata: null,
        hints: null,
        geoclip: predictions[i] ?? null,
      },
      input.locateParams ?? {},
    );
    answers.push({ ...w, location: decided.location, tier: decided.diagnostics.radiusTier, geoclip: predictions[i] ?? null, diagnostics: decided.diagnostics });
    await breathe();
  }
  timing.decideMs = performance.now() - t2;
  return { windows: answers, merged: mergeWindows(answers, params), worldFrames, worldSkipped, searchSkipped: windows.length - searchedWindows, searches, timing };
}
