export { toMgrs, toUtm, haversineKm } from '../../../server/src/core/geo';

const TILE = 256;

/** Web Mercator: longitude / latitude to world coordinates in 0..1. */
export function project(lat: number, lon: number): { x: number; y: number } {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return { x: (lon + 180) / 360, y: (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 };
}

export function unproject(x: number, y: number): { lat: number; lon: number } {
  const n = Math.PI - 2 * Math.PI * y;
  return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lon: x * 360 - 180 };
}

/** Size of the whole world in CSS pixels at `zoom`. */
export function worldSize(zoom: number): number {
  return TILE * 2 ** zoom;
}

/** Ground metres per CSS pixel at a latitude and zoom. */
export function metresPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

export function formatCoordinate(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(5)}° ${ns}  ${Math.abs(lon).toFixed(5).padStart(9, '0')}° ${ew}`;
}
