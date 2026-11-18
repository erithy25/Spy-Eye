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

/** Inverse transverse Mercator (Krüger series): UTM grid coordinates to latitude / longitude, northern hemisphere. */
export function fromUtm(zone: number, easting: number, northing: number): { lat: number; lon: number } {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const n = f / (2 - f);
  const A = (a / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64);
  const beta = [n / 2 - (2 / 3) * n ** 2 + (37 / 96) * n ** 3, (1 / 48) * n ** 2 + (1 / 15) * n ** 3, (17 / 480) * n ** 3];
  const delta = [2 * n - (2 / 3) * n ** 2 - 2 * n ** 3, (7 / 3) * n ** 2 - (8 / 5) * n ** 3, (56 / 15) * n ** 3];
  const xi = northing / (k0 * A);
  const eta = (easting - 500000) / (k0 * A);
  let xiP = xi;
  let etaP = eta;
  for (let j = 1; j <= 3; j++) {
    xiP -= (beta[j - 1] as number) * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaP -= (beta[j - 1] as number) * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  let phi = chi;
  for (let j = 1; j <= 3; j++) phi += (delta[j - 1] as number) * Math.sin(2 * j * chi);
  const lambda0 = ((zone - 1) * 6 - 180 + 3) * (Math.PI / 180);
  const lambda = lambda0 + Math.atan(Math.sinh(etaP) / Math.cos(xiP));
  return { lat: (phi * 180) / Math.PI, lon: (lambda * 180) / Math.PI };
}
