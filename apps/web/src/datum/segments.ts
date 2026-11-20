/**
 * The stretches of a recording located stretch by stretch (Fix.segments: several places from
 * engine 10 on, one recognised place and undetermined stretches from engine 12 on), as the
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

/** How many distinct places a recording shows (0 for a recording of one stretch or an older fix). */
export function placeCount(fix: Fix | null | undefined): number {
  return segmentSummary(fix)?.places.length ?? 0;
}

/**
 * "7 Orte", or "mindestens 7 Orte" when the count is a lower bound (placesLowerBound); for one
 * recognised place and undetermined stretches (engine 12) "1 erkannter Ort, ein Abschnitt
 * unbestimmt" (never "mindestens 1 Orte": the undetermined stretches are said instead), or
 * `compact` "1 erkannter Ort · 1 unbestimmt" as the timeline says it (the list's row has room for
 * no more); '' for a recording of one stretch. `t` is the console's translation.
 */
export function placesText(fix: Fix | null | undefined, t: (de: string, vars?: Record<string, string | number>) => string, compact = false): string {
  const summary = segmentSummary(fix);
  if (!summary || summary.places.length === 0) return '';
  if (summary.places.length === 1) {
    const u = summary.undetermined ?? 0;
    if (u === 0) return '';
    if (compact) return `${t('1 erkannter Ort')} · ${t('{n} unbestimmt', { n: u })}`;
    return `${t('1 erkannter Ort')}, ${u === 1 ? t('ein Abschnitt unbestimmt') : t('{n} Abschnitte unbestimmt', { n: u })}`;
  }
  return t(placesLowerBound(summary) ? 'mindestens {n} Orte' : '{n} Orte', { n: summary.places.length });
}

/**
 * Whether the place a fix shows is the whole file's while the fix carries stretches
 * (wholeFileShown), told from the full fix or from the list's compact form: there, one recognised
 * place without `lead` (one-place summaries exist from engine 12 on, and a fix that shows its
 * stretch always names its place). The list and the result card in ORTUNG say it next to the
 * place: "1 erkannter Ort" beside the whole file's answer would read as that place.
 */
export function wholeFilePlace(fix: Fix | null | undefined): boolean {
  if (!fix) return false;
  if (fix.segments && fix.segments.length > 0) return wholeFileShown(fix);
  const summary = fix.segmentSummary;
  return !!summary && summary.segments > 1 && summary.places.length === 1 && (summary.undetermined ?? 0) > 0 && summary.lead === undefined;
}

/**
 * The count of places at the head of the timeline: "mindestens 3 Orte", "2 Orte", or "1 erkannter
 * Ort" for one place (the undetermined stretches follow it there on their own).
 */
export function timelinePlacesText(places: number, atLeast: boolean, t: (de: string, vars?: Record<string, string | number>) => string): string {
  if (places === 1) return t('1 erkannter Ort');
  return atLeast ? t('mindestens {n} Orte', { n: places }) : t('{n} Orte', { n: places });
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
 * The stretch the fix's place comes from: the one the 'segments' entry names by its keyframe (the
 * longest located stretch, or the one the answer for the whole file agrees with); -1 where that
 * entry names none (engine 12: one recognised place that covers too little of the recording, or
 * only at the place the whole file rejected; the fix's place, time and spaces are then the whole
 * file's, see wholeFileShown). Fixes whose entry is missing: the stretch at the fix's location,
 * else the first located.
 */
export function leadSegment(fix: Fix): number {
  const segments = fix.segments ?? [];
  const loc = fix.location;
  const entry = fix.evidence.find((e) => e.kind === 'segments');
  const lead = entry?.frame;
  const byFrame = lead !== undefined ? segments.findIndex((s) => s.keyframe.frame === lead) : -1;
  if (byFrame >= 0) return byFrame;
  // Before engine 12 the entry of a fix with stretches always named one (and GPS files carry no
  // stretches): an entry without a frame is a fix that shows none of them.
  if (entry && lead === undefined && segments.length > 0) return -1;
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

/**
 * The middle of a set of places (the mean of their directions from the Earth's centre) and how
 * far the farthest lies from it (km): the frame ORTUNG shows a recording of several places in.
 * Null without points.
 */
export function routeFrame(points: readonly { lat: number; lon: number }[]): { lat: number; lon: number; reachKm: number } | null {
  if (points.length === 0) return null;
  const r = Math.PI / 180;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += Math.cos(p.lat * r) * Math.cos(p.lon * r);
    y += Math.cos(p.lat * r) * Math.sin(p.lon * r);
    z += Math.sin(p.lat * r);
  }
  // Points spread evenly round the globe have no middle: the first stands for it.
  const first = points[0] as { lat: number; lon: number };
  const mid = Math.hypot(x, y, z) < 1e-9 ? first : { lat: Math.atan2(z, Math.hypot(x, y)) / r, lon: Math.atan2(y, x) / r };
  return { lat: mid.lat, lon: mid.lon, reachKm: reachKm(mid, points) };
}

/** The farthest of `points` from `from` (km); 0 without points. */
export function reachKm(from: { lat: number; lon: number }, points: readonly { lat: number; lon: number }[]): number {
  return points.reduce((m, p) => Math.max(m, km(from, p)), 0);
}

/**
 * Markers for the located stretches of a recording and the route through them in time order. A
 * marker is numbered `display(key)` (the key itself by default; BEFUND keys its markers by
 * stretch and numbers them by place, as ORTUNG and the timeline's "Ort n von m" do). Stretches at
 * the same point share one marker (a place the recording comes back to, or a stretch that takes
 * its place's point): it shows one number, the chosen one's where it is among them, and how many
 * other numbers it stands for ("3+2"; none where they all show the same); `keys` lists them all
 * by marker id, so that a click can go through them. `chosen` is emphasised.
 */
export function routeGeometry(
  stops: readonly { key: number; lat: number; lon: number }[],
  chosen: number | null,
  idPrefix: string,
  name: (key: number) => string,
  display: (key: number) => string = String,
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
    const m: MapMarker = { id: `${idPrefix}${s.key}`, lat: s.lat, lon: s.lon, shape: 'segment', label: display(s.key), ...(s.key === chosen ? { selected: true, sub: name(s.key) } : {}) };
    at.set(pos, m);
    keys.set(m.id, [s.key]);
    markers.push(m);
  }
  for (const m of markers) {
    const list = keys.get(m.id) as number[];
    if (list.length < 2) continue;
    const shown = chosen !== null && list.includes(chosen) ? chosen : (list[0] as number);
    const others = new Set(list.map(display));
    others.delete(display(shown));
    m.label = others.size > 0 ? `${display(shown)}+${others.size}` : display(shown);
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
 * Whether a fix with stretches shows none of them (leadSegment -1): its place, time and spaces are
 * those of the whole file, which the console says next to them, and the timeline holds the rest.
 */
export function wholeFileShown(fix: Fix): boolean {
  return (fix.segments?.length ?? 0) > 1 && leadSegment(fix) < 0;
}

/** BEFUND's map shows the whole globe where the places it keeps in view reach farther than this (km). */
export const GLOBE_REACH_KM = 2500;

/**
 * How far BEFUND's map reaches around `at`, the place it turns to, for a fix with stretches: to
 * the farthest located stretch, and to the fix's own place where it shows none of them (that place
 * is then drawn besides them, wholeFileShown).
 */
export function stretchMapReach(fix: Fix, at: { lat: number; lon: number }): number {
  const points: { lat: number; lon: number }[] = (fix.segments ?? []).flatMap((s) => (s.location ? [s.location] : []));
  if (fix.location && wholeFileShown(fix)) points.push(fix.location);
  return reachKm(at, points);
}

/**
 * The geometry of the fix's own place that BEFUND draws besides the stretches of a fix that shows
 * none of them (its circle, sun, shadow, heading and the line to the truth), turned to `at`. On a
 * map of the whole globe (stretchMapReach beyond GLOBE_REACH_KM) a circle of ± 1 500 km and its
 * rays are a few pixels long: their labels would fall on each other and under the place's marker
 * ("☉ 256°500 KM"), so circles and rays lose them there. The radius is in the header, the sun in
 * the sun dial. Nearer, they keep them.
 */
export function wholeFileShapes(fix: Fix, at: { lat: number; lon: number }, shapes: readonly MapShape[]): MapShape[] {
  if (stretchMapReach(fix, at) <= GLOBE_REACH_KM) return [...shapes];
  return shapes.map((shape) => {
    if (shape.kind !== 'circle' && shape.kind !== 'ray') return shape;
    const { label, ...rest } = shape;
    return label === undefined ? shape : rest;
  });
}

/**
 * Index of the chosen stretch of a fix: the choice where it belongs to this result and lies within
 * its stretches, else the stretch the fix shows (leadSegment), or the first where it shows none
 * (the video opens at its start). 0 for a fix without stretches.
 */
export function chosenStretch(fix: Fix, choice: StretchChoice | null): number {
  const segments = fix.segments ?? [];
  if (segments.length === 0) return 0;
  if (choice && choice.videoId === fix.videoId && choice.computedAt === fix.computedAt && choice.index >= 0 && choice.index < segments.length) return choice.index;
  return Math.max(0, leadSegment(fix));
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

/**
 * The time BEFUND's clock and sun dial show for a stretch: stretchClock, and for an undetermined
 * stretch of a fix that shows none of its stretches (wholeFileShown) the fix's own, which is the
 * whole file's (`whole`): the time in the header then has its dials, and that stretch's frames
 * are among those it was read from. The stretch has still no time of its own; the dials say whose.
 */
export function dialClock(fix: Fix, index: number | null): { time: TimeEstimate; sun: SunReport | null; own: boolean; whole: boolean } | null {
  const clock = stretchClock(fix, index);
  if (clock) return { ...clock, whole: false };
  const s = index !== null ? fix.segments?.[index] : undefined;
  if (s && !s.location && wholeFileShown(fix)) return { time: fix.time, sun: fix.sun, own: false, whole: true };
  return null;
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
 * `fix` says whether they are the fix's keyframes (the heading and horizon belong to those, and
 * the fix's place and time).
 *
 * Where the fix shows no stretch (wholeFileShown), its keyframes are the whole file's, spread over
 * the recording, and each is offered by the stretch it lies in, so that every one can be entered:
 * an undetermined stretch offers those among its frames (`fix` true; none: `fix` false, it has no
 * place); a located one its own space first and then those (`fixFrom`, the index of the first of
 * them: they go with the fix's place, time and heading, the own one with the stretch's).
 */
export function stretchSpaces(fix: Fix, index: number | null): { fix: boolean; spaces: SpaceKey[]; fixFrom?: number } {
  const own = (k: Keyframe): SpaceKey[] => (k.spaceUrl ? [{ frame: k.frame, imageUrl: k.imageUrl, spaceUrl: k.spaceUrl, pitchDeg: k.pitchDeg ?? 0 }] : []);
  const segments = fix.segments ?? [];
  const s = index !== null ? segments[index] : undefined;
  const lead = leadSegment(fix);
  // Before engine 11 the stretches had no spaces (nor times): the fix's keyframes for all of them.
  if (!s || !timedStretches(fix) || index === lead) return { fix: true, spaces: fix.keyframes.flatMap(own) };
  const k = s.keyframe;
  const ownSpace: SpaceKey[] = k.spaceUrl ? [{ frame: k.frame, imageUrl: k.imageUrl, spaceUrl: k.spaceUrl, pitchDeg: k.pitchDeg ?? 0 }] : [];
  if (lead < 0) {
    // The last stretch ends with the video: a keyframe at its very end is still its own.
    const last = segments.length - 1;
    const inside = (kf: Keyframe): boolean => kf.time >= s.startSec && (kf.time < s.endSec || (index === last && kf.time <= s.endSec));
    // A whole-file keyframe on the stretch's own frame is offered once, as the stretch's.
    const whole = fix.keyframes.filter((kf) => inside(kf) && !ownSpace.some((o) => o.frame === kf.frame)).flatMap(own);
    if (!s.location) return whole.length > 0 ? { fix: true, spaces: whole } : { fix: false, spaces: [] };
    if (whole.length > 0) return { fix: false, spaces: [...ownSpace, ...whole], fixFrom: ownSpace.length };
  }
  return { fix: false, spaces: ownSpace };
}

/** Whether the i-th space of stretchSpaces is one of the fix's keyframes (see there). */
export function spaceOfFix(offered: { fix: boolean; fixFrom?: number }, i: number): boolean {
  return offered.fixFrom !== undefined ? i >= offered.fixFrom : offered.fix;
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
