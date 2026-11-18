/** Geodesy helpers: distances and UTM / MGRS grid references (WGS 84). */

const R_EARTH_KM = 6371.0088;
const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface Utm {
  zone: number;
  band: string;
  easting: number;
  northing: number;
}

const BANDS = 'CDEFGHJKLMNPQRSTUVWXX';

/** Transverse Mercator forward projection (Krüger series, accurate to millimetres within a zone). */
export function toUtm(lat: number, lon: number): Utm {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const zone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
  const lambda0 = rad((zone - 1) * 6 - 180 + 3);
  const e2 = f * (2 - f);
  const n = f / (2 - f);
  const A = (a / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64);
  const alpha = [
    n / 2 - (2 / 3) * n ** 2 + (5 / 16) * n ** 3,
    (13 / 48) * n ** 2 - (3 / 5) * n ** 3,
    (61 / 240) * n ** 3,
  ];
  const phi = rad(lat);
  const lambda = rad(lon) - lambda0;
  const e = Math.sqrt(e2);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
  const xi = Math.atan2(t, Math.cos(lambda));
  const eta = Math.atanh(Math.sin(lambda) / Math.sqrt(1 + t * t));
  let x = eta;
  let y = xi;
  for (let j = 1; j <= 3; j++) {
    const aj = alpha[j - 1] as number;
    x += aj * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    y += aj * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  const easting = 500000 + k0 * A * x;
  const northing = k0 * A * y + (lat < 0 ? 10000000 : 0);
  const band = BANDS[Math.min(20, Math.max(0, Math.floor((lat + 80) / 8)))] ?? 'X';
  return { zone, band, easting, northing };
}

const COLUMN_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const ROW_SETS = ['ABCDEFGHJKLMNPQRSTUV', 'FGHJKLMNPQRSTUVABCDE'];

/** MGRS reference with 10 m precision, e.g. `32U LA 9876 5432` (the form used on German rescue maps). */
export function toMgrs(lat: number, lon: number): string {
  if (lat < -80 || lat > 84) return '—';
  const utm = toUtm(lat, lon);
  const columns = COLUMN_SETS[(utm.zone - 1) % 3] as string;
  const rows = ROW_SETS[(utm.zone - 1) % 2] as string;
  const col = columns[Math.floor(utm.easting / 100000) - 1] ?? '?';
  const row = rows[Math.floor(utm.northing / 100000) % 20] ?? '?';
  const e = Math.floor((utm.easting % 100000) / 10);
  const n = Math.floor((utm.northing % 100000) / 10);
  return `${utm.zone}${utm.band} ${col}${row} ${String(e).padStart(4, '0')} ${String(n).padStart(4, '0')}`;
}
