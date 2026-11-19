/**
 * The stretches of a recording that shows several places (Fix.segments, engine 10 on), as the
 * console reads them: from the full fix, or from the compact form the list carries
 * (Fix.segmentSummary). Mirrors summariseSegments of the server (datum/segments.ts), which is not
 * imported here because it pulls in the server's localisation code.
 */
import type { Fix, FixSegment, FixSegmentPlace, FixSegmentRegion, FixSegmentSummary, Keyframe, SunReport, TimeEstimate } from '../../../server/src/datum/contract';
import type { MapMarker, MapShape } from '../map/MapCanvas';

export type { FixSegment, FixSegmentPlace, FixSegmentRegion, FixSegmentSummary };

/** The compact form of the stretches: from the list's slim fix, else computed from the full fix. */
export function segmentSummary(fix: Fix | null | undefined): FixSegmentSummary | null {
  if (!fix) return null;
  if (fix.segmentSummary) return fix.segmentSummary;
  const segments = fix.segments;
  if (!segments || segments.length === 0) return null;
  // The fix's own place stands at the stretch the fix shows, every other at its surest stretch.
  const shown = segments[leadSegment(fix)];
  const leadPlace = shown?.location && shown.place !== null ? shown.place : null;
  const places = new Map<number, FixSegmentPlace>();
  const route: number[] = [];
  for (const s of segments) {
    if (s.place === null || !s.location) continue;
    if (route[route.length - 1] !== s.place) route.push(s.place);
    const seconds = s.endSec - s.startSec;
    const known = places.get(s.place);
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
 * Whether the count of places is a lower bound ("mindestens"): some stretches are undetermined, or
 * a place joins answers far apart that the world model saw as one region (FixSegment.joined).
 * Older summaries say nothing of either: no lower bound claimed.
 */
export function placesLowerBound(summary: Pick<FixSegmentSummary, 'undetermined' | 'joined'>): boolean {
  return (summary.undetermined ?? 0) > 0 || (summary.joined ?? 0) > 0;
}

/** How many distinct places a recording shows (0 for a recording of one place or an older fix). */
export function placeCount(fix: Fix | null | undefined): number {
  return segmentSummary(fix)?.places.length ?? 0;
}

/**
 * "7 Orte", or "mindestens 7 Orte" when the count is a lower bound (placesLowerBound); '' for a
 * recording of one place. `t` is the console's translation.
 */
export function placesText(fix: Fix | null | undefined, t: (de: string, vars?: Record<string, string | number>) => string): string {
  const summary = segmentSummary(fix);
  if (!summary || summary.places.length < 2) return '';
  return t(placesLowerBound(summary) ? 'mindestens {n} Orte' : '{n} Orte', { n: summary.places.length });
}

/** "4:12", "1:02:05": a second of the video as its clock reads. */
export function clockText(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** "4:12–6:30" */
export function spanText(s: Pick<FixSegment, 'startSec' | 'endSec'>): string {
  return `${clockText(s.startSec)}–${clockText(s.endSec)}`;
}

/** Index of the stretch that holds this second of the video, or -1 (the video follows, BEFUND). */
export function segmentIndexAt(segments: readonly Pick<FixSegment, 'startSec' | 'endSec'>[], seconds: number): number {
  return segments.findIndex((s) => seconds >= s.startSec && seconds < s.endSec);
}

/**
 * The timeline's bars in a bar `width` px wide: 2 px bars with 2 px gaps need 4n - 2 px; where the
 * bar has less (about 110 stretches in the BEFUND column, the server allows 160), bars and gaps
 * are 1 px ("dense"), so that the bar does not push the page sideways. `usable` is the width the
 * bars share, less the gaps.
 */
export function barLayout(count: number, width: number): { dense: boolean; usable: number } {
  const dense = width > 0 && 4 * count - 2 > width;
  return { dense, usable: Math.max(0, width - (dense ? 1 : 2) * Math.max(0, count - 1)) };
}

/**
 * Whether a bar `px` wide shows its number n: two digits fit in 16 px (border included), three
 * need 22 px at the bar's 10 px type.
 */
export function numberFits(px: number, n: number): boolean {
  return px >= (n >= 100 ? 22 : 16);
}

/**
 * The stretch the fix's place comes from: the one whose place is the fix's location (the longest
 * located stretch, or the one the answer for the whole file agrees with); else the first located.
 */
export function leadSegment(fix: Fix): number {
  const segments = fix.segments ?? [];
  const loc = fix.location;
  const lead = fix.evidence.find((e) => e.kind === 'segments')?.frame;
  const byFrame = lead !== undefined ? segments.findIndex((s) => s.keyframe.frame === lead) : -1;
  if (byFrame >= 0) return byFrame;
  if (loc) {
    const at = segments.findIndex((s) => s.location && s.location.lat === loc.lat && s.location.lon === loc.lon);
    if (at >= 0) return at;
  }
  return Math.max(0, segments.findIndex((s) => s.location !== null));
}

/** Great-circle distance (km). */
function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** The point of `points` nearest to `at`, if one lies within `maxKm`. */
export function nearestWithin<T extends { lat: number; lon: number }>(at: { lat: number; lon: number }, points: readonly T[], maxKm: number): T | null {
  let best: T | null = null;
  let bestKm = maxKm;
  for (const p of points) {
    const d = km(at, p);
    if (d <= bestKm) {
      bestKm = d;
      best = p;
    }
  }
  return best;
}

/** The farthest of `points` from `from` (km); 0 without points. */
export function reachKm(from: { lat: number; lon: number }, points: readonly { lat: number; lon: number }[]): number {
  return points.reduce((m, p) => Math.max(m, km(from, p)), 0);
}

/**
 * Markers for the located stretches of a recording, numbered `label(i)`, and the route through
 * them in time order. Stretches at the same point share one marker (a place the recording comes
 * back to, or a stretch that takes its place's point): it shows one number, the chosen one where
 * it is among them, and how many more ("3+2"); `keys` lists them all by marker id, so that a click
 * can go through them. `chosen` is emphasised.
 */
export function routeGeometry(
  stops: readonly { key: number; lat: number; lon: number }[],
  chosen: number | null,
  idPrefix: string,
  name: (key: number) => string,
): { markers: MapMarker[]; line: MapShape | null; keys: Map<string, number[]> } {
  const markers: MapMarker[] = [];
  const at = new Map<string, MapMarker>();
  const keys = new Map<string, number[]>();
  for (const s of stops) {
    const pos = `${s.lat.toFixed(5)},${s.lon.toFixed(5)}`;
    const known = at.get(pos);
    if (known) {
      const list = keys.get(known.id) as number[];
      if (!list.includes(s.key)) list.push(s.key);
      if (s.key === chosen) {
        known.selected = true;
        known.sub = name(s.key);
      }
      continue;
    }
    const m: MapMarker = { id: `${idPrefix}${s.key}`, lat: s.lat, lon: s.lon, shape: 'segment', label: String(s.key), ...(s.key === chosen ? { selected: true, sub: name(s.key) } : {}) };
    at.set(pos, m);
    keys.set(m.id, [s.key]);
    markers.push(m);
  }
  for (const m of markers) {
    const list = keys.get(m.id) as number[];
    if (list.length < 2) continue;
    const shown = chosen !== null && list.includes(chosen) ? chosen : (list[0] as number);
    m.label = `${shown}+${list.length - 1}`;
  }
  const points: [number, number][] = [];
  for (const s of stops) {
    const last = points[points.length - 1];
    if (last && last[0] === s.lat && last[1] === s.lon) continue;
    // A great circle between far stops, so that the line follows the globe.
    if (last) points.push(...between(last, [s.lat, s.lon]));
    points.push([s.lat, s.lon]);
  }
  return { markers, line: points.length >= 2 ? { kind: 'line', points, style: 'solid' } : null, keys };
}

/**
 * The stretch a click on a shared marker chooses: the next of its stretches after the chosen one
 * (so that clicks go through them), else its first.
 */
export function nextKey(keys: readonly number[], chosen: number | null): number | null {
  if (keys.length === 0) return null;
  const at = chosen !== null ? keys.indexOf(chosen) : -1;
  return keys[(at + 1) % keys.length] as number;
}

/** Points on the great circle strictly between a and b (none for short legs). */
function between(a: [number, number], b: [number, number]): [number, number][] {
  const d = km({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] });
  const steps = Math.min(64, Math.floor(d / 150));
  if (steps < 2) return [];
  const r = Math.PI / 180;
  const toV = (lat: number, lon: number): [number, number, number] => [Math.cos(lat * r) * Math.cos(lon * r), Math.cos(lat * r) * Math.sin(lon * r), Math.sin(lat * r)];
  const p = toV(a[0], a[1]);
  const q = toV(b[0], b[1]);
  const omega = Math.acos(Math.min(1, Math.max(-1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])));
  if (omega < 1e-6) return [];
  const out: [number, number][] = [];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const s1 = Math.sin((1 - t) * omega) / Math.sin(omega);
    const s2 = Math.sin(t * omega) / Math.sin(omega);
    const x = s1 * p[0] + s2 * q[0];
    const y = s1 * p[1] + s2 * q[1];
    const z = s1 * p[2] + s2 * q[2];
    out.push([Math.atan2(z, Math.hypot(x, y)) / r, Math.atan2(y, x) / r]);
  }
  return out;
}

/**
 * The stretch chosen in BEFUND, shared with RAUM (App keeps it): for one result of one recording.
 * Another recording or a new result (its computedAt) starts again at the stretch the fix shows.
 */
export interface StretchChoice {
  videoId: string;
  computedAt: number;
  index: number;
}

/**
 * Index of the chosen stretch of a fix: the choice where it belongs to this result and lies within
 * its stretches, else the stretch the fix shows (leadSegment). 0 for a fix without stretches.
 */
export function chosenStretch(fix: Fix, choice: StretchChoice | null): number {
  const segments = fix.segments ?? [];
  if (segments.length === 0) return 0;
  if (choice && choice.videoId === fix.videoId && choice.computedAt === fix.computedAt && choice.index >= 0 && choice.index < segments.length) return choice.index;
  return leadSegment(fix);
}

/**
 * Whether the stretches of a fix have a time of their own (engine 11 on). Before, every stretch
 * had only the fix's time, estimated from the frames of the whole file.
 */
export function timedStretches(fix: Fix): boolean {
  return (fix.segments ?? []).some((s) => s.time);
}

/**
 * The time and sun the console shows for a stretch (BEFUND's clock and sun dial, RAUM's sun): the
 * fix's own for the stretch the fix shows, for a fix without stretches and for fixes before
 * engine 11 (whose stretches have no time of their own); a located stretch's own; null for a
 * stretch of a fix whose stretches have their own times when it has none: an undetermined one (no
 * place, no clock), or a located one whose estimate failed (the caller tells them apart by
 * FixSegment.location). `own` says whether it is a stretch's own time rather than the fix's.
 */
export function stretchClock(fix: Fix, index: number | null): { time: TimeEstimate; sun: SunReport | null; own: boolean } | null {
  const segments = fix.segments ?? [];
  const s = index !== null ? segments[index] : undefined;
  if (!s || !timedStretches(fix) || index === leadSegment(fix)) return { time: fix.time, sun: fix.sun, own: false };
  if (!s.time) return null;
  return { time: s.time, sun: s.sun ?? null, own: true };
}

/** A walkable space as RAUM enters it. */
export interface SpaceKey {
  frame: number;
  imageUrl: string;
  spaceUrl: string;
  pitchDeg: number;
}

/**
 * The spaces RAUM offers for a stretch: the fix's keyframes for the stretch the fix shows, for a
 * fix without stretches and for older fixes; a stretch's own space (FixSegment.keyframe, the
 * longest located stretches have one); none for the others (undetermined, or beyond the twelve).
 * Fixes before engine 11 (their stretches have no time of their own) offer the fix's keyframes.
 * `fix` says whether they are the fix's keyframes (the heading and horizon belong to those).
 */
export function stretchSpaces(fix: Fix, index: number | null): { fix: boolean; spaces: SpaceKey[] } {
  const own = (k: Keyframe): SpaceKey[] => (k.spaceUrl ? [{ frame: k.frame, imageUrl: k.imageUrl, spaceUrl: k.spaceUrl, pitchDeg: k.pitchDeg ?? 0 }] : []);
  const segments = fix.segments ?? [];
  const s = index !== null ? segments[index] : undefined;
  // Before engine 11 the stretches had no spaces (nor times): the fix's keyframes for all of them.
  if (!s || !timedStretches(fix) || index === leadSegment(fix)) return { fix: true, spaces: fix.keyframes.flatMap(own) };
  const k = s.keyframe;
  return { fix: false, spaces: k.spaceUrl ? [{ frame: k.frame, imageUrl: k.imageUrl, spaceUrl: k.spaceUrl, pitchDeg: k.pitchDeg ?? 0 }] : [] };
}

/** The stretches RAUM can enter (stretchSpaces has a space for them), in time order. */
export function spacedStretches(fix: Fix): number[] {
  return (fix.segments ?? []).flatMap((_, i) => (stretchSpaces(fix, i).spaces.length > 0 ? [i] : []));
}

/**
 * "grobe Region: eher Westeuropa, ± 1.500 km" for a coarse region of an undetermined stretch
 * (FixSegment.coarse), with its span in front where it covers only part of the stretch. `km`
 * writes a distance as the console does, `name` picks the region's name in the console's language.
 */
export function coarseText(
  r: FixSegmentRegion,
  stretch: Pick<FixSegment, 'startSec' | 'endSec'>,
  t: (de: string, vars?: Record<string, string | number>) => string,
  km: (km: number) => string,
  name: (r: FixSegmentRegion) => string,
): string {
  // The radius stays on one line with its sign and unit ("± 1.500 km").
  const text = t('grobe Region: eher {region}, ± {km}', { region: name(r), km: km(r.radiusKm).replace(/ /g, '\u00a0') }).replace('± ', '±\u00a0');
  return r.startSec <= stretch.startSec && r.endSec >= stretch.endSec ? text : `${spanText(r)} · ${text}`;
}
