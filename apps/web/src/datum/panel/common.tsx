/**
 * Shared arithmetic and small parts of the DATUM result panel: local clock time in the zone of
 * the fix, angles on dials, number formats and the hairline meter.
 */
import { useId } from 'react';
import type { EvidenceKind, SunPathPoint, SunReport, TimeEstimate, TimeWindow } from '../../../../server/src/datum/contract';
import { formatCount, formatDecimal } from '../../format';
import { coordinateParts, formatCoordinate } from '../../map/geo';

export type { EvidenceKind };

const DAY_MIN = 1440;

const clockFormats = new Map<string, Intl.DateTimeFormat>();

function clockFormat(zone: string): Intl.DateTimeFormat {
  let format = clockFormats.get(zone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    } catch {
      format = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    }
    clockFormats.set(zone, format);
  }
  return format;
}

/** Seconds after local midnight of an instant, in the civil time of `zone` (UTC when unknown). */
export function localSeconds(epochMs: number, zone: string | null): number {
  let h = 0;
  let m = 0;
  let s = 0;
  for (const part of clockFormat(zone ?? 'UTC').formatToParts(epochMs)) {
    if (part.type === 'hour') h = Number(part.value) % 24;
    else if (part.type === 'minute') m = Number(part.value);
    else if (part.type === 'second') s = Number(part.value);
  }
  return h * 3600 + m * 60 + s;
}

export function localMinutes(epochMs: number, zone: string | null): number {
  return localSeconds(epochMs, zone) / 60;
}

/** 1050 -> "17:30"; 1440 stays "24:00" so a window may end at midnight. */
export function hhmm(minutes: number): string {
  let v = Math.round(minutes);
  if (v === DAY_MIN) return '24:00';
  v = ((v % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

/** 62764 -> "17:26:04" */
export function hhmmss(seconds: number): string {
  const v = ((Math.floor(seconds) % 86400) + 86400) % 86400;
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const s = v % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

/** "UTC+2", "UTC−3:30", "UTC" for the offset of `zone` at an instant. */
export function utcOffset(zone: string | null, at: number): string {
  if (!zone) return 'UTC';
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value;
    if (!name || name === 'GMT' || name === 'UTC') return 'UTC';
    return name.replace('GMT', 'UTC').replace('-', '−');
  } catch {
    return '';
  }
}

/** Length of a window in minutes; windows may run across midnight. */
export function windowSpan(startMin: number, endMin: number): number {
  const span = endMin - startMin;
  return span < 0 ? span + DAY_MIN : span;
}

export function windowMid(startMin: number, endMin: number): number {
  return (startMin + windowSpan(startMin, endMin) / 2) % DAY_MIN;
}

/** Clock windows before and after noon (TimeWindow.label, as the server's time.ts names them). */
const BEFORE_NOON: ReadonlySet<string> = new Set(['Morgen', 'Vormittag']);
const AFTER_NOON: ReadonlySet<string> = new Set(['Nachmittag', 'Abend']);

/** A second window at least this share of the first's probability is as good as the first. */
export const RIVAL_SHARE = 0.8;

/**
 * The second clock window of a time from the sun where it is about as likely as the first (at
 * least RIVAL_SHARE of its probability) and lies on the other side of noon: the sun's height alone
 * does not tell the morning from the afternoon, and the first window is then only ahead by a
 * hair. The console names it beside the first (head of BEFUND, list, result card, RAUM) and draws
 * its shadow too. Null otherwise.
 */
export function rivalWindow(time: TimeEstimate): TimeWindow | null {
  if (time.method !== 'sun') return null;
  const [a, b] = time.windows;
  if (!a || !b || b.probability < RIVAL_SHARE * a.probability) return null;
  const before = (w: TimeWindow): boolean | null => (BEFORE_NOON.has(w.label) ? true : AFTER_NOON.has(w.label) ? false : null);
  const sa = before(a);
  const sb = before(b);
  return sa !== null && sb !== null && sa !== sb ? b : null;
}

function lerpAz(a: number, b: number, f: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return norm360(a + d * f);
}

/** Sun position at an instant, interpolated along the path (clamped to its ends); null without one. */
export function sunOnPath(path: readonly SunPathPoint[], t: number): { az: number; el: number } | null {
  if (path.length === 0) return null;
  const first = path[0] as SunPathPoint;
  const last = path[path.length - 1] as SunPathPoint;
  if (t <= first.t) return { az: first.az, el: first.el };
  if (t >= last.t) return { az: last.az, el: last.el };
  let lo = 0;
  let hi = path.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((path[mid] as SunPathPoint).t <= t) lo = mid;
    else hi = mid;
  }
  const a = path[lo] as SunPathPoint;
  const b = path[hi] as SunPathPoint;
  const f = (t - a.t) / (b.t - a.t);
  return { az: lerpAz(a.az, b.az, f), el: a.el + (b.el - a.el) * f };
}

/**
 * The sun at the middle of a clock window, from the day's path (as the server puts SunReport.at at
 * the middle of the first window): direction, height, shadow direction, and the shadow's length
 * per object height above 0.5° (as the server's shadowRatio). Null without a path.
 */
export function sunInWindow(sun: Pick<SunReport, 'path'>, zone: string | null, w: Pick<TimeWindow, 'startMin' | 'endMin'>): { azimuthDeg: number; elevationDeg: number; shadowAzimuthDeg: number; shadowRatio: number | null } | null {
  const path = [...sun.path].sort((a, b) => a.t - b.t);
  const first = path[0];
  if (!first) return null;
  const m0 = localMinutes(first.t, zone);
  const minute = windowMid(w.startMin, w.endMin);
  const p = sunOnPath(path, first.t + ((((minute - m0) % DAY_MIN) + DAY_MIN) % DAY_MIN) * 60000);
  if (!p) return null;
  return { azimuthDeg: p.az, elevationDeg: p.el, shadowAzimuthDeg: norm360(p.az + 180), shadowRatio: p.el > 0.5 ? 1 / Math.tan((p.el * Math.PI) / 180) : null };
}

/** Whether a local minute lies inside a window (which may run across midnight). */
export function inWindow(minute: number, startMin: number, endMin: number): boolean {
  const offset = (((minute - startMin) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return offset <= windowSpan(startMin, endMin);
}

/**
 * The single best local time of day (minutes after midnight): the exact instant from metadata,
 * else the middle of the most probable window, else the instant the sun report refers to.
 */
export function bestMinute(time: TimeEstimate, sunAt: number | null): number | null {
  if (time.method === 'metadata' && time.utc !== null) return localSeconds(time.utc, time.timezone) / 60;
  const best = time.windows[0];
  if (best) return windowMid(best.startMin, best.endMin);
  if (sunAt !== null && time.method !== 'none') return localMinutes(sunAt, time.timezone);
  return null;
}

/** Instant used to read the zone offset: the exact time, else the sun state, else noon of the path. */
export function referenceInstant(time: TimeEstimate, sun: { at: { at: number } | null; solarNoon: number | null; path: SunPathPoint[] } | null): number {
  if (time.utc !== null) return time.utc;
  if (sun?.at) return sun.at.at;
  if (sun?.solarNoon !== null && sun?.solarNoon !== undefined) return sun.solarNoon;
  const mid = sun?.path[Math.floor(sun.path.length / 2)];
  return mid ? mid.t : Date.now();
}

// ---------- angles ----------

export function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** "214°" (never "360°"). */
export function fmtDeg(deg: number): string {
  return `${Math.round(norm360(deg)) % 360}°`;
}

/** "38°" or "−2°" for an elevation. */
export function fmtElev(deg: number): string {
  // Within a degree of the horizon one decimal and the sign, so that a sun just above it does not
  // read "0°" (the terrain view shows "+0,3°" for the same sun).
  if (Math.abs(deg) < 1 && Math.abs(deg) >= 0.05) return `${deg < 0 ? '−' : '+'}${formatDecimal(Math.abs(deg), 1)}°`;
  const v = Math.round(deg);
  return `${v < 0 ? '−' : ''}${Math.abs(v)}°`;
}

/** Point at `deg` clockwise from the top, `r` from the centre. */
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

function pt([x, y]: [number, number]): string {
  return `${x.toFixed(2)} ${y.toFixed(2)}`;
}

/** Arc of a circle from angle a0 clockwise to a1 (degrees, 0 = top). */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  let sweep = norm360(a1 - a0);
  if (sweep === 0 && a1 !== a0) sweep = 360;
  if (sweep >= 359.99) {
    const mid = a0 + 180;
    return `M${pt(polar(cx, cy, r, a0))}A${r} ${r} 0 0 1 ${pt(polar(cx, cy, r, mid))}A${r} ${r} 0 0 1 ${pt(polar(cx, cy, r, a0 + 359.99))}`;
  }
  return `M${pt(polar(cx, cy, r, a0))}A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${pt(polar(cx, cy, r, a0 + sweep))}`;
}

/** Ring segment between radii r0 < r1 from a0 clockwise to a1. */
export function annulusPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  let sweep = norm360(a1 - a0);
  if (sweep === 0 && a1 !== a0) sweep = 360;
  sweep = Math.min(sweep, 359.99);
  const large = sweep > 180 ? 1 : 0;
  const b = a0 + sweep;
  return (
    `M${pt(polar(cx, cy, r1, a0))}A${r1} ${r1} 0 ${large} 1 ${pt(polar(cx, cy, r1, b))}` +
    `L${pt(polar(cx, cy, r0, b))}A${r0} ${r0} 0 ${large} 0 ${pt(polar(cx, cy, r0, a0))}Z`
  );
}

/** Text anchor so a label placed outward at `deg` never runs into the dial. */
export function anchorFor(deg: number): 'start' | 'middle' | 'end' {
  const a = norm360(deg);
  if (a < 12 || a > 348 || (a > 168 && a < 192)) return 'middle';
  return a < 180 ? 'start' : 'end';
}

/** Vertical nudge of a label placed outward at `deg` (top labels sit above, bottom below). */
export function baselineFor(deg: number): number {
  return Math.cos((deg * Math.PI) / 180) * -3.5 + 3.5;
}

// ---------- numbers ----------

/** Distances: "80 m", "0,6 km", "140 km". */
export function fmtKm(km: number): string {
  if (km < 0.1) return `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m`;
  if (km < 10) return `${formatDecimal(km, 1)} km`;
  return `${formatCount(Math.round(km))} km`;
}

export function fmtScore(value: number): string {
  return formatDecimal(Math.max(0, Math.min(1, value)), 2);
}

export function fmtPct(value: number): string {
  const v = Math.max(0, Math.min(1, value));
  if (v > 0 && v < 0.005) return '<1 %';
  return `${Math.round(v * 100)} %`;
}

/** Decimal degrees with five places and the hemisphere, as every view writes them (see map/geo). */
export const coordParts = coordinateParts;

/** "50,93962° N  6,95829° O" */
export const fmtCoord = formatCoordinate;

/** "17. Juni 2018" / "17 June 2018" for a local calendar date (YYYY-MM-DD). */
export function fmtLongDate(date: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
  );
}

export function monthName(month: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(Date.UTC(2000, month - 1, 1));
}

/** An id that can be used inside `url(#…)` in SVG attributes. */
export function useSvgId(prefix: string): string {
  return `${prefix}-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

// ---------- parts ----------

/** A hairline with a filled share: confidence, weight, score. */
export function Meter({ value, label, ticks = false }: { value: number; label: string; ticks?: boolean }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <span
      className={ticks ? 'dp-meter dp-meter-ticks' : 'dp-meter'}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Math.round(v * 100) / 100}
    >
      <span style={{ width: `${v * 100}%` }} />
    </span>
  );
}

export const KIND_CODE: Record<EvidenceKind, string> = {
  metadata: 'META',
  landmark: 'MARKE',
  region: 'REGION',
  horizon: 'HORIZONT',
  sun: 'SONNE',
  season: 'JAHRESZEIT',
  text: 'TEXT',
  filename: 'DATEINAME',
  worldmodel: 'WELTMODELL',
  streetlevel: 'STRASSENBILD',
  segments: 'ABSCHNITTE',
};

/** How a location was obtained, as a phrase. */
export const KIND_METHOD: Record<EvidenceKind, string> = {
  metadata: 'GPS aus Metadaten',
  landmark: 'Wiedererkennung einer Landmarke',
  region: 'Regionsschätzung',
  horizon: 'Abgleich mit dem Geländehorizont',
  sun: 'Sonnenstand',
  season: 'Jahreszeit',
  text: 'Schrift im Bild',
  filename: 'Angabe im Dateinamen',
  worldmodel: 'Weltmodell',
  streetlevel: 'Abgleich mit Straßenbildern',
  segments: 'Abschnittsweise Ortung',
};

export { KIND_ORDER, kindRank } from './evidenceOrder';

/**
 * Code and phrase of a kind. The record covers every kind of the contract this console was built
 * with; a newer node may send one it does not know, which then shows as sent instead of failing.
 */
export function kindCode(kind: string): string {
  return (KIND_CODE as Partial<Record<string, string>>)[kind] ?? kind.toUpperCase();
}

export function kindMethod(kind: string): string {
  return (KIND_METHOD as Partial<Record<string, string>>)[kind] ?? kind;
}

/**
 * A page link from the node (Evidence.refUrl), but only if it is a web address: the link opens in
 * the analyst's browser, so a javascript: or data: URL must never become clickable.
 */
export function webLink(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

// ---------- check links (Google, opened by a person only) ----------

/**
 * Coordinates as Google's map URLs take them: six decimals (about 0.1 m) with a decimal point,
 * whatever the console language. Nothing else is handed over.
 */
function googlePoint(lat: number, lon: number): string {
  return `${lat.toFixed(6)},${lon.toFixed(6)}`;
}

/** Google Street View at a point (Maps URLs, documented for links a person clicks). */
export function streetViewUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${googlePoint(lat, lon)}`;
}

/** Google Maps with a pin at a point. */
export function googleMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${googlePoint(lat, lon)}`;
}
