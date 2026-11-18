/**
 * Shared arithmetic and small parts of the DATUM result panel: local clock time in the zone of
 * the fix, angles on dials, number formats and the hairline meter.
 */
import { useId } from 'react';
import type { EvidenceKind, SunPathPoint, TimeEstimate } from '../../../../server/src/datum/contract';
import { formatCount, formatDecimal } from '../../format';

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

/** Decimal degrees with five places and the hemisphere: "50.93962", "N". */
export function coordParts(lat: number, lon: number): { lat: string; ns: string; lon: string; ew: string } {
  return { lat: Math.abs(lat).toFixed(5), ns: lat >= 0 ? 'N' : 'S', lon: Math.abs(lon).toFixed(5), ew: lon >= 0 ? 'E' : 'W' };
}

export function fmtCoord(lat: number, lon: number): string {
  const c = coordParts(lat, lon);
  return `${c.lat} ${c.ns}  ${c.lon} ${c.ew}`;
}

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
};
