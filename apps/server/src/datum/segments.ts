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
 *      Only when at least two distinct places hold for at least `minPlaceSec` each does the fix
 *      carry the stretches (Fix.segments); a recording of one place stays as it was.
 *
 * Everything here except analyseSegments is pure; analyseSegments is handed the gallery search,
 * the world model and the frame vectors, so that tests and the measurement can stand in for them.
 */
import type { CountryProb, Evidence, FixLocation, FixSegment, FixSegmentPlace, FixSegmentSummary } from './contract.js';
import type { GalleryNeighbour, GallerySearchOptions } from './gallery.js';
import { massWithin, type GeoclipPrediction } from './geoclip.js';
import { breathe, decideLocation, type LocateParams, type LocateResult, type RadiusTier } from './locate.js';
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
 * The countries of a recording of several places: the countries of its located stretches, each
 * with its share of the located time, the fix's own country first. The country estimate of the
 * whole file mixes the places (China and India for a recording of Mexico, Indonesia and Benin).
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
  const first = lead !== null ? (segments[lead]?.location?.country ?? null) : null;
  return [...seconds.entries()]
    .map(([iso, v]) => ({ iso, name: v.name, p: total > 0 ? v.s / total : 0 }))
    .sort((a, b) => Number(b.iso === first) - Number(a.iso === first) || b.p - a.p);
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
  /** The fix's place: the current one, or that of the longest located stretch. */
  location: FixLocation | null;
  /** Whether `location` was replaced. */
  replaced: boolean;
  /** Index into the segments of the stretch the place comes from (multi only). */
  lead: number | null;
  /** Evidence to add (none for a recording of one place). */
  evidence: Evidence[];
  /** The trace step's detail. */
  note: SegmentText;
}

const pctDe = (p: number): string => `${Math.round(p * 100)} %`;

/**
 * What the stretches mean for the fix. A recording of one place keeps everything as it was. With
 * at least two places, the fix carries the stretches and its place must not pretend: it
 * stays where the answer for the whole file agrees with the longest located stretch, and becomes
 * that stretch's place otherwise; an evidence entry names the places and the stretch shown. With
 * GPS in the file, the file's position stands (it covers the whole file) and the entry only says
 * that the pictures show several places.
 *
 * `rejected` is the gallery's answer for the whole file where the world model replaced it
 * (LocateDiagnostics.gallery): a stretch at that place does not lead. The whole file's decision
 * saw more frames and both models and turned that answer down; a stretch decided from a few frames
 * of the same pictures (a station that the gallery takes for another one 400 km away) must not
 * bring it back as the fix's place with a radius of a few kilometres. The stretch keeps its answer
 * in the timeline.
 */
export function segmentVerdict(segments: readonly FixSegment[], current: FixLocation | null, opts: { gps: boolean; sameKm?: number; rejected?: FixLocation | null }): SegmentVerdict {
  const places = new Set(segments.map((s) => s.place).filter((p) => p !== null)).size;
  const located = segments.filter((s) => s.location && s.place !== null);
  const undetermined = segments.filter((s) => !s.location).length;
  const joined = new Set(segments.filter((s) => s.joined && s.place !== null).map((s) => s.place)).size;
  const sameKm = opts.sameKm ?? DEFAULT_SEGMENT_PARAMS.sameKm;
  if (places < 2) {
    const note: SegmentText =
      segments.length <= 1
        ? { de: 'ein Abschnitt', en: 'one segment' }
        : {
            de: `${segments.length} Abschnitte, ein Ort${undetermined > 0 ? ` (${undetermined} unbestimmt)` : ''}`,
            en: `${segments.length} segments, one place${undetermined > 0 ? ` (${undetermined} undetermined)` : ''}`,
          };
    return { multi: false, places, joined, location: current, replaced: false, lead: null, evidence: [], note };
  }
  // Undetermined stretches may hold further places, and so may a place the world model joined
  // from answers that lie apart: then the count is a lower bound.
  const atLeast: SegmentText = undetermined > 0 || joined > 0 ? { de: 'mindestens ', en: 'at least ' } : { de: '', en: '' };
  // How places are told apart; distinct places are farther apart than this, but one place need
  // not be narrower (the world model's ties, see mergeWindows).
  const ruleDe = `Antworten näher als ${sameKm} km beieinander zählen als ein Ort.`;
  const ruleEn = `Answers closer than ${sameKm} km count as one place.`;
  const joinedDe =
    joined > 0
      ? ` ${joined === 1 ? 'Ein Ort fasst' : `${joined} Orte fassen`} Antworten zusammen, die weiter auseinanderliegen, weil das Weltmodell ihrer Fenster sie derselben Gegend zurechnet; es können also mehr Orte sein.`
      : '';
  const joinedEn =
    joined > 0
      ? ` ${joined === 1 ? 'One place joins' : `${joined} places join`} answers that lie farther apart, because the world model of their windows puts them in the same region; there may be more places.`
      : '';
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
          detail: `Abschnittsweise geortet zeigen die Bilder ${atLeast.de}${places} verschiedene Orte. ${ruleDe}${joinedDe} Die GPS-Angabe der Datei gilt für die ganze Datei und bestimmt den Ort; ob die Aufnahme geschnitten oder zusammengesetzt ist, sollte geprüft werden.`,
          detailEn: `Located segment by segment, the pictures show ${atLeast.en}${places} different places. ${ruleEn}${joinedEn} The GPS position in the file covers the whole file and decides the place; whether the recording was cut or put together should be checked.`,
          weight: 0,
        },
      ],
      note: { de: `${atLeast.de}${places} Orte in den Bildern, GPS der Datei gilt`, en: `${atLeast.en}${places} places in the pictures, the file's GPS stands` },
    };
  }
  const rejected = opts.rejected ?? null;
  const atRejected = (loc: FixLocation): boolean => rejected !== null && greatCircleKm(rejected.lat, rejected.lon, loc.lat, loc.lon) <= sameKm;
  // The longest located stretch; on equal length the surer one. With `skip`, none at the place
  // the whole file's decision rejected.
  const longest = (skip: boolean): number => {
    let best = -1;
    segments.forEach((s, i) => {
      if (!s.location || s.place === null || (skip && atRejected(s.location))) return;
      const b = best >= 0 ? (segments[best] as FixSegment) : null;
      const len = s.endSec - s.startSec;
      const bestLen = b ? b.endSec - b.startSec : -1;
      if (!b || len > bestLen || (len === bestLen && s.location.confidence > (b.location as FixLocation).confidence)) best = i;
    });
    return best;
  };
  const first = longest(false);
  const other = longest(true);
  const lead = other >= 0 ? other : first;
  // The longest names the rejected place: shown below it, said why.
  const passed = lead !== first ? (segments[first] as FixSegment) : null;
  const shown = segments[lead] as FixSegment;
  const place = shown.location as FixLocation;
  const shownLen = shown.endSec - shown.startSec;
  // Another stretch as long, decided by the confidence: "the longest" alone would not be true.
  const tie = segments.some((s, i) => i !== lead && s.location && s.place !== null && (passed === null || !atRejected(s.location)) && s.endSec - s.startSec === shownLen);
  // Agreeing means the same place as the stretches are told apart (sameKm), not overlapping circles:
  // two answers of 1 500 km 800 km apart would agree, and the top would name another city.
  const agrees = current !== null && greatCircleKm(current.lat, current.lon, place.lat, place.lon) <= sameKm;
  const location = agrees ? current : place;
  const span = `${clockText(shown.startSec)}–${clockText(shown.endSec)}`;
  const labelDe = place.label;
  const labelEn = place.labelEn ?? place.label;
  const restEn = passed ? 'remaining ' : '';
  const whyDe = tie ? `der sicherste der gleich langen längsten ${passed ? 'übrigen ' : ''}Abschnitte mit Ort` : `der längste ${passed ? 'übrige ' : ''}Abschnitt mit Ort`;
  const whyEn = tie ? `the surest of the equally long longest ${restEn}segments with a place` : `the longest ${restEn}segment with a place`;
  const passedSpan = passed ? `${clockText(passed.startSec)}–${clockText(passed.endSec)}` : '';
  const passedDe = passed
    ? ` Der längste Abschnitt mit Ort (${passedSpan}: ${(passed.location as FixLocation).label}) nennt den Ort, den das Weltmodell für die ganze Datei schon verworfen hat; er bleibt in der Zeitleiste, steht aber nicht oben.`
    : '';
  const passedEn = passed
    ? ` The longest segment with a place (${passedSpan}: ${(passed.location as FixLocation).labelEn ?? (passed.location as FixLocation).label}) names the place the world model already rejected for the whole file; it stays in the timeline but is not shown above.`
    : '';
  const undeterminedDe = undetermined > 0 ? ` ${undetermined} ${undetermined === 1 ? 'Abschnitt bleibt' : 'Abschnitte bleiben'} unbestimmt.` : '';
  const undeterminedEn = undetermined > 0 ? ` ${undetermined} ${undetermined === 1 ? 'segment remains' : 'segments remain'} undetermined.` : '';
  const keptDe = agrees ? 'Die Ortung aus der ganzen Datei stimmt mit ihm überein und bleibt.' : 'Er ersetzt die Ortung aus der ganzen Datei, die die Orte vermischt.';
  const keptEn = agrees ? 'The fix from the whole file agrees with it and stands.' : 'It replaces the fix from the whole file, which mixes the places.';
  return {
    multi: true,
    places,
    joined,
    location,
    replaced: !agrees,
    lead,
    evidence: [
      {
        kind: 'segments',
        label: `Die Aufnahme zeigt ${atLeast.de}${places} Orte; oben der Abschnitt ${span}`,
        labelEn: `The recording shows ${atLeast.en}${places} places; shown above: segment ${span}`,
        detail: `Abschnittsweise geortet: ${segments.length} Abschnitte, ${located.length} davon mit Ort, ${atLeast.de}${places} verschiedene Orte. ${ruleDe}${joinedDe}${passedDe} Oben steht ${whyDe}, ${span}: ${labelDe}, ± ${kmDe(place.radiusKm)}, Sicherheit ${pctDe(place.confidence)}. ${keptDe}${undeterminedDe} Die Zeitleiste unter dem Video zeigt jeden Abschnitt.`,
        detailEn: `Located segment by segment: ${segments.length} segments, ${located.length} of them with a place, ${atLeast.en}${places} different places. ${ruleEn}${joinedEn}${passedEn} Shown above is ${whyEn}, ${span}: ${labelEn}, ± ${kmEn(place.radiusKm)}, confidence ${Math.round(place.confidence * 100)}%. ${keptEn}${undeterminedEn} The timeline under the video shows every segment.`,
        weight: agrees ? 0.5 : 0.9,
        frame: shown.keyframe.frame,
        refLabel: labelDe,
        refLabelEn: labelEn,
        refLat: place.lat,
        refLon: place.lon,
      },
    ],
    note: {
      de: `${atLeast.de}${places} Orte in ${segments.length} Abschnitten; oben ${span}${agrees ? '' : ', ersetzt die Ortung der ganzen Datei'}${passed ? `, nicht ${passedSpan} (verworfen)` : ''}`,
      en: `${atLeast.en}${places} places in ${segments.length} segments; shown ${span}${agrees ? '' : ', replaces the fix of the whole file'}${passed ? `, not ${passedSpan} (rejected)` : ''}`,
    },
  };
}

/** The prefix of the whole file's entries in a fix whose place came from a stretch (wholeFileEvidence). */
export const WHOLE_FILE: SegmentText = { de: 'Ganze Datei (gemischt): ', en: 'Whole file (mixed): ' };

/**
 * An evidence entry of the whole file's decision in a fix whose place came from a stretch: what
 * it says of "the result" ("1 km from the result: a recognition", "which stands") is said of the
 * whole file's answer, which mixes the places and is no longer the fix's. Entries that name a
 * place (reference pictures, the world model, the country estimate) say so and lose their weight;
 * the others (sun, file name) stay as they are.
 */
export function wholeFileEvidence(e: Evidence): Evidence {
  if (e.kind !== 'landmark' && e.kind !== 'worldmodel' && e.kind !== 'region') return e;
  return {
    ...e,
    label: `${WHOLE_FILE.de}${e.label}`,
    labelEn: `${WHOLE_FILE.en}${e.labelEn ?? e.label}`,
    detail: `Aus der Ortung der ganzen Datei, deren Bilder mehrere Orte vermischen; „Ergebnis“ ist hier deren Antwort, nicht der oben gezeigte Ort. ${e.detail}`,
    detailEn: `From the fix of the whole file, whose pictures mix several places; "result" here is its answer, not the place shown above. ${e.detailEn ?? e.detail}`,
    weight: 0,
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
