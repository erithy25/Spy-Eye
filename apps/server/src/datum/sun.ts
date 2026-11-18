/**
 * DATUM sun engine: solar position from the NOAA solar calculator equations (after Meeus,
 * "Astronomical Algorithms"), computed locally. Accuracy of the geometric position is about
 * 0.01° for 1950–2100; refraction follows the NOAA approximation (standard atmosphere).
 *
 * Conventions: azimuth clockwise from true north, elevation above the astronomical horizon,
 * instants in epoch milliseconds (UTC).
 */
import type { SunPathPoint, SunState } from './contract.js';
import { localDayBounds } from './timezones.js';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const DAY_MS = 86400000;

const sind = (d: number): number => Math.sin(d * RAD);
const cosd = (d: number): number => Math.cos(d * RAD);
const tand = (d: number): number => Math.tan(d * RAD);
const mod = (a: number, n: number): number => ((a % n) + n) % n;

export interface SolarPosition {
  /** Degrees clockwise from true north. */
  azimuthDeg: number;
  /** Apparent elevation, with atmospheric refraction. */
  elevationDeg: number;
  /** Geometric elevation, without refraction. */
  elevationTrueDeg: number;
  declinationDeg: number;
  /** Apparent minus mean solar time, minutes. */
  equationOfTimeMin: number;
  /** Local hour angle, degrees in (-180, 180]; negative before solar noon. */
  hourAngleDeg: number;
}

/** Julian day (UT) of an instant. */
export function julianDay(t: number): number {
  return t / DAY_MS + 2440587.5;
}

interface SunGeometry {
  declinationDeg: number;
  equationOfTimeMin: number;
}

/** Declination and equation of time (NOAA solar calculator). */
function sunGeometry(t: number): SunGeometry {
  const jc = (julianDay(t) - 2451545) / 36525;
  const l0 = mod(280.46646 + jc * (36000.76983 + jc * 0.0003032), 360);
  const m = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const c =
    sind(m) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    sind(2 * m) * (0.019993 - 0.000101 * jc) +
    sind(3 * m) * 0.000289;
  const trueLong = l0 + c;
  const omega = 125.04 - 1934.136 * jc;
  const appLong = trueLong - 0.00569 - 0.00478 * sind(omega);
  const meanObliq = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * cosd(omega);
  const declinationDeg = Math.asin(sind(obliq) * sind(appLong)) * DEG;
  const y = tand(obliq / 2) ** 2;
  const eot =
    y * sind(2 * l0) -
    2 * e * sind(m) +
    4 * e * y * sind(m) * cosd(2 * l0) -
    0.5 * y * y * sind(4 * l0) -
    1.25 * e * e * sind(2 * m);
  return { declinationDeg, equationOfTimeMin: 4 * eot * DEG };
}

/** Atmospheric refraction (degrees) at geometric elevation `el`, NOAA approximation. */
export function refractionDeg(el: number): number {
  if (el > 85) return 0;
  const te = tand(el);
  let arcsec: number;
  if (el > 5) arcsec = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (el > -0.575) arcsec = 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)));
  else arcsec = -20.772 / te;
  return arcsec / 3600;
}

/** Horizontal coordinates from declination, hour angle and latitude (all degrees). */
function horizontal(decl: number, hourAngle: number, lat: number): { azimuthDeg: number; elevationTrueDeg: number } {
  const sinEl = sind(lat) * sind(decl) + cosd(lat) * cosd(decl) * cosd(hourAngle);
  const elevationTrueDeg = Math.asin(Math.max(-1, Math.min(1, sinEl))) * DEG;
  // Azimuth measured from south, westward, then turned to "from north, eastward".
  const az = Math.atan2(sind(hourAngle) * cosd(decl), cosd(hourAngle) * cosd(decl) * sind(lat) - sind(decl) * cosd(lat));
  return { azimuthDeg: mod(az * DEG + 180, 360), elevationTrueDeg };
}

/** Sun position at instant `t` (epoch ms) seen from latitude/longitude (degrees, east positive). */
export function solarPosition(t: number, lat: number, lon: number): SolarPosition {
  const { declinationDeg, equationOfTimeMin } = sunGeometry(t);
  const utcMin = mod(t, DAY_MS) / 60000;
  const trueSolarMin = mod(utcMin + equationOfTimeMin + 4 * lon, 1440);
  let hourAngleDeg = trueSolarMin / 4 - 180;
  if (hourAngleDeg <= -180) hourAngleDeg += 360;
  const { azimuthDeg, elevationTrueDeg } = horizontal(declinationDeg, hourAngleDeg, lat);
  return {
    azimuthDeg,
    elevationDeg: elevationTrueDeg + refractionDeg(elevationTrueDeg),
    elevationTrueDeg,
    declinationDeg,
    equationOfTimeMin,
    hourAngleDeg,
  };
}

/**
 * Independent, simpler approximation: Spencer (1971) Fourier series for declination and the
 * equation of time. Accurate to roughly 0.1–0.3°; used to cross-check the NOAA implementation.
 */
export function solarPositionSpencer(t: number, lat: number, lon: number): { azimuthDeg: number; elevationTrueDeg: number; declinationDeg: number; equationOfTimeMin: number } {
  const d = new Date(t);
  const year = d.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const daysInYear = (Date.UTC(year + 1, 0, 1) - start) / DAY_MS;
  const dayOfYear = Math.floor((t - start) / DAY_MS) + 1;
  const hours = (t - Date.UTC(year, d.getUTCMonth(), d.getUTCDate())) / 3600000;
  const g = ((2 * Math.PI) / daysInYear) * (dayOfYear - 1 + (hours - 12) / 24);
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const trueSolarMin = hours * 60 + eot + 4 * lon;
  const hourAngle = trueSolarMin / 4 - 180;
  const declinationDeg = decl * DEG;
  const h = horizontal(declinationDeg, hourAngle, lat);
  return { ...h, declinationDeg, equationOfTimeMin: eot };
}

/** Sun state for the contract: position plus shadow direction and length ratio. */
export function sunState(t: number, lat: number, lon: number): SunState {
  const p = solarPosition(t, lat, lon);
  return {
    at: t,
    azimuthDeg: p.azimuthDeg,
    elevationDeg: p.elevationDeg,
    shadowAzimuthDeg: mod(p.azimuthDeg + 180, 360),
    shadowRatio: p.elevationDeg > 0.5 ? 1 / tand(p.elevationDeg) : null,
  };
}

/** Standard altitude of the sun's upper limb at rise and set (refraction 34′ + semidiameter 16′). */
export const SUNRISE_ALTITUDE = -0.833;

export interface SunEvents {
  sunrise: number | null;
  sunset: number | null;
  solarNoon: number;
  /** 'day' / 'night' when the sun stays above / below the horizon all local day. */
  polar: 'day' | 'night' | null;
}

/** Transit (hour angle 0) nearest to instant `t`. */
function transitNear(t: number, lat: number, lon: number): number {
  let x = t;
  for (let i = 0; i < 4; i++) {
    const ha = solarPosition(x, lat, lon).hourAngleDeg;
    // The hour angle grows by about 360° per (solar) day.
    x -= (ha / 360) * DAY_MS * (1 - 1 / 365.25);
  }
  return x;
}

/** Bisection on a boolean predicate between a (pred false) and b (pred true) or vice versa. */
function bisect(a: number, b: number, inside: (t: number) => boolean, toleranceMs = 500): number {
  const va = inside(a);
  let lo = a;
  let hi = b;
  while (hi - lo > toleranceMs) {
    const mid = (lo + hi) / 2;
    if (inside(mid) === va) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Sunrise, sunset and solar noon on the local civil date `dateYmd` in `timeZone`. */
export function sunEvents(dateYmd: string, lat: number, lon: number, timeZone: string): SunEvents {
  const { start, end } = localDayBounds(dateYmd, timeZone);
  const up = (t: number): boolean => solarPosition(t, lat, lon).elevationTrueDeg > SUNRISE_ALTITUDE;
  let noon = transitNear((start + end) / 2, lat, lon);
  if (noon < start) noon += DAY_MS;
  if (noon >= end) noon -= DAY_MS;
  let sunrise: number | null = null;
  let sunset: number | null = null;
  let anyUp = false;
  let anyDown = false;
  const step = 5 * 60000;
  let prevT = start;
  let prevUp = up(start);
  if (prevUp) anyUp = true;
  else anyDown = true;
  for (let t = start + step; t <= end; t += step) {
    const tt = Math.min(t, end);
    const now = up(tt);
    if (now) anyUp = true;
    else anyDown = true;
    if (now !== prevUp) {
      const edge = bisect(prevT, tt, up);
      if (now && sunrise === null) sunrise = edge;
      if (!now && sunset === null) sunset = edge;
    }
    prevT = tt;
    prevUp = now;
  }
  let polar: SunEvents['polar'] = null;
  if (sunrise === null && sunset === null) polar = anyUp && !anyDown ? 'day' : 'night';
  return { sunrise, sunset, solarNoon: noon, polar };
}

/** Sun path over the local civil day in `stepMin` steps (apparent elevation). */
export function sunPath(dateYmd: string, lat: number, lon: number, timeZone: string, stepMin = 10): SunPathPoint[] {
  const { start, end } = localDayBounds(dateYmd, timeZone);
  const step = Math.max(1, stepMin) * 60000;
  const out: SunPathPoint[] = [];
  for (let t = start; t <= end; t += step) {
    const p = solarPosition(t, lat, lon);
    out.push({ t, az: p.azimuthDeg, el: p.elevationDeg });
  }
  return out;
}

/**
 * Parts of the local civil day during which the apparent sun elevation lies within
 * [minEl, maxEl]. Sampled every 2 minutes; edges refined by bisection to about a second.
 */
export function intervalsWithElevation(
  dateYmd: string,
  lat: number,
  lon: number,
  timeZone: string,
  minEl: number,
  maxEl: number,
): Array<{ start: number; end: number }> {
  const { start, end } = localDayBounds(dateYmd, timeZone);
  const inside = (t: number): boolean => {
    const el = solarPosition(t, lat, lon).elevationDeg;
    return el >= minEl && el <= maxEl;
  };
  const step = 2 * 60000;
  const out: Array<{ start: number; end: number }> = [];
  let open: number | null = inside(start) ? start : null;
  let prevT = start;
  let prevIn = open !== null;
  for (let t = start + step; ; t += step) {
    const tt = Math.min(t, end);
    const now = inside(tt);
    if (now !== prevIn) {
      const edge = bisect(prevT, tt, inside);
      if (now) open = edge;
      else if (open !== null) {
        out.push({ start: open, end: edge });
        open = null;
      }
    }
    prevT = tt;
    prevIn = now;
    if (tt >= end) break;
  }
  if (open !== null) out.push({ start: open, end });
  return out;
}
