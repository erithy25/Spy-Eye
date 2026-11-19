/**
 * Where on the sun's path the terrain view marks sunrise and sunset. The path has a point every 10
 * minutes (the fix) or 30 (a stretch of a recording of several places): its last point above the
 * horizon can be half an hour before the sunset the dials of BEFUND write. The marks take the
 * report's times (SunReport.sunrise, sunset: the upper limb at the standard altitude, as the dials)
 * where the path covers them, at the azimuth between its points; without them, the path's crossing
 * of 0°, interpolated between the points either side.
 */
import type { SunPathPoint } from '../../../../server/src/datum/contract';

export interface SunEdge {
  /** UTC milliseconds. */
  t: number;
  /** Azimuth (degrees from north). */
  az: number;
}

/** The angle a fraction `f` of the way from `a` to `b` (degrees), the short way round. */
function azBetween(a: number, b: number, f: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (((a + f * d) % 360) + 360) % 360;
}

/** The path's azimuth at `t`, between its points; null outside the path. */
function azAt(path: readonly SunPathPoint[], t: number): number | null {
  for (let i = 1; i < path.length; i++) {
    const p = path[i - 1]!;
    const q = path[i]!;
    if (t < p.t || t > q.t) continue;
    return azBetween(p.az, q.az, q.t > p.t ? (t - p.t) / (q.t - p.t) : 0);
  }
  return null;
}

/**
 * The first sunrise and the last sunset on the path (null where the path does not cross the
 * horizon that way: polar day or night, or a path that begins or ends with the sun up).
 */
export function sunEdges(path: readonly SunPathPoint[], sunrise: number | null = null, sunset: number | null = null): { rise: SunEdge | null; set: SunEdge | null } {
  let rise: SunEdge | null = null;
  let set: SunEdge | null = null;
  for (let i = 1; i < path.length; i++) {
    const p = path[i - 1]!;
    const q = path[i]!;
    if (p.el < 0 && q.el >= 0 && !rise) {
      const f = -p.el / (q.el - p.el);
      rise = { t: p.t + f * (q.t - p.t), az: azBetween(p.az, q.az, f) };
    }
    if (p.el >= 0 && q.el < 0) {
      const f = p.el / (p.el - q.el);
      set = { t: p.t + f * (q.t - p.t), az: azBetween(p.az, q.az, f) };
    }
  }
  const atRise = sunrise !== null && rise ? azAt(path, sunrise) : null;
  const atSet = sunset !== null && set ? azAt(path, sunset) : null;
  return {
    rise: rise && atRise !== null && sunrise !== null ? { t: sunrise, az: atRise } : rise,
    set: set && atSet !== null && sunset !== null ? { t: sunset, az: atSet } : set,
  };
}
