/**
 * Checks the shipped country shapes (apps/server/assets/datum/countries.json):
 *
 *   tsx src/scripts/datum/pointInCountry.ts
 *
 * A stand-alone check, not a module to import: it holds its own small pointInCountry(lat, lon).
 * Rings of a country are tested together with the even-odd rule (holes are rings too). Where
 * shapes overlap after simplification (an enclave inside its neighbour), the smaller country
 * wins. The outlines are simplified to about 0.05°, so a point right on the coast can fall a few
 * kilometres outside; `pointInCountry(lat, lon, km)` then accepts the nearest country within `km`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../../config.js';

interface Country {
  iso: string;
  name_de: string;
  areaKm2: number;
  bbox: [number, number, number, number];
  polygons: [number, number][][];
}

const countries = JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps', 'server', 'assets', 'datum', 'countries.json'), 'utf8')) as Country[];

function inside(country: Country, lat: number, lon: number): boolean {
  const [w, s, e, n] = country.bbox;
  if (lon < w || lon > e || lat < s || lat > n) return false;
  let odd = false;
  for (const ring of country.polygons) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] as [number, number];
      const [xj, yj] = ring[j] as [number, number];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) odd = !odd;
    }
  }
  return odd;
}

/** Distance (km) from a point to the outline of a country, on a local flat approximation. */
function distanceKm(country: Country, lat: number, lon: number): number {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  const ky = 110.57;
  let best = Infinity;
  for (const ring of country.polygons) {
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1] as [number, number];
      const [bx, by] = ring[i] as [number, number];
      const px = (lon - ax) * kx;
      const py = (lat - ay) * ky;
      const dx = (bx - ax) * kx;
      const dy = (by - ay) * ky;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
      best = Math.min(best, Math.hypot(px - t * dx, py - t * dy));
    }
  }
  return best;
}

function pointInCountry(lat: number, lon: number, coastKm = 0): string | null {
  const hits = countries.filter((c) => inside(c, lat, lon)).sort((a, b) => a.areaKm2 - b.areaKm2);
  if (hits[0]) return hits[0].iso;
  if (coastKm <= 0) return null;
  let best: { iso: string; d: number } | null = null;
  for (const c of countries) {
    const [w, s, e, n] = c.bbox;
    const margin = coastKm / 50;
    if (lon < w - margin || lon > e + margin || lat < s - margin || lat > n + margin) continue;
    const d = distanceKm(c, lat, lon);
    if (d <= coastKm && (!best || d < best.d)) best = { iso: c.iso, d };
  }
  return best?.iso ?? null;
}

const cases: { name: string; lat: number; lon: number; expect: string | null }[] = [
  { name: 'Berlin', lat: 52.52, lon: 13.405, expect: 'DE' },
  { name: 'Paris', lat: 48.8566, lon: 2.3522, expect: 'FR' },
  { name: 'New York', lat: 40.7128, lon: -74.006, expect: 'US' },
  { name: 'Sydney', lat: -33.8688, lon: 151.2093, expect: 'AU' },
  { name: 'Rio de Janeiro', lat: -22.9068, lon: -43.1729, expect: 'BR' },
  { name: 'Atlantic (30°N 40°W)', lat: 30, lon: -40, expect: null },
  { name: 'Oslo', lat: 59.9139, lon: 10.7522, expect: 'NO' },
  { name: 'Pristina', lat: 42.6629, lon: 21.1655, expect: 'XK' },
  { name: 'Maseru (Lesotho in South Africa)', lat: -29.31, lon: 27.48, expect: 'LS' },
  { name: 'Cape Town', lat: -33.9249, lon: 18.4241, expect: 'ZA' },
  { name: 'Tokyo', lat: 35.6762, lon: 139.6503, expect: 'JP' },
];

let failed = 0;
for (const c of cases) {
  const strict = pointInCountry(c.lat, c.lon);
  const coast = pointInCountry(c.lat, c.lon, 10);
  const ok = coast === c.expect;
  if (!ok) failed++;
  process.stdout.write(
    `${ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(34)} expected ${String(c.expect).padEnd(4)} inside: ${String(strict).padEnd(4)} within 10 km of coast: ${coast}\n`,
  );
}
process.stdout.write(`${cases.length - failed} of ${cases.length} correct (${countries.length} countries loaded)\n`);
process.exit(failed > 0 ? 1 : 0);
