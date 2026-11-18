import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// Tests read only the Koblenz tiles of the map cache (.cache/map/terrain): the dataset directory
// points at an empty folder so that downloads in progress do not change the results.
process.env['DATUM_TERRAIN_DIR'] = mkdtempSync(path.join(os.tmpdir(), 'datum-terrain-'));

const { heightAt, terrainAvailable, terrainGrid, offsetPoint } = await import('../src/datum/terrain.js');
const { horizonProfile, horizonProfileFromSampler, matchSkyline, imageRay, refinePosition } = await import('../src/datum/horizon.js');

const DEUTSCHES_ECK = { lat: 50.3644, lon: 7.6058 };
const DEG = Math.PI / 180;

function meanDeg(profile: number[], from: number, to: number): number {
  let sum = 0;
  for (let a = from; a <= to; a++) sum += profile[a] as number;
  return sum / (to - from + 1);
}

// ------------------------------------------------------------------------------------------------
// Real tiles (Koblenz)
// ------------------------------------------------------------------------------------------------

test('Terrarium heights at Koblenz', async () => {
  const eck = await heightAt(DEUTSCHES_ECK.lat, DEUTSCHES_ECK.lon);
  assert.ok(eck !== null, 'Deutsches Eck has elevation data');
  // Rhine and Moselle meet at about 60-65 m above sea level.
  assert.ok(eck > 50 && eck < 85, `Deutsches Eck at ${eck} m`);
  const fortress = await heightAt(50.3651, 7.6142);
  assert.ok(fortress !== null && fortress > eck + 60, `Ehrenbreitstein plateau at ${fortress} m`);
  const zoom = await terrainAvailable(DEUTSCHES_ECK.lat, DEUTSCHES_ECK.lon);
  assert.ok(zoom !== null && zoom >= 12, `best zoom ${zoom}`);
  assert.equal(await terrainAvailable(-40, -140), null, 'no tiles in the South Pacific');
  assert.equal(await heightAt(-40, -140), null);
});

test('terrain grid around Koblenz', async () => {
  const grid = await terrainGrid(DEUTSCHES_ECK, 5, 65);
  assert.ok(grid, 'grid');
  assert.equal(grid.size, 65);
  assert.equal(grid.heights.length, 65 * 65);
  assert.ok(grid.heights.every((h) => Number.isFinite(h)));
  assert.ok(grid.minHeight > 40 && grid.minHeight < 75, `min ${grid.minHeight}`);
  assert.ok(grid.maxHeight > 250 && grid.maxHeight < 500, `max ${grid.maxHeight}`);
  assert.ok(Math.abs(grid.cellMetres - 10_000 / 64) < 1e-6);
  const [w, s, e, n] = grid.bbox;
  assert.ok(w < DEUTSCHES_ECK.lon && e > DEUTSCHES_ECK.lon && s < DEUTSCHES_ECK.lat && n > DEUTSCHES_ECK.lat);
  assert.ok(grid.sourceZoom >= 10 && grid.sourceZoom <= 14, `zoom ${grid.sourceZoom}`);
  // Centre sample agrees with the point query.
  const centre = grid.heights[32 * 65 + 32] as number;
  const direct = (await heightAt(DEUTSCHES_ECK.lat, DEUTSCHES_ECK.lon)) as number;
  assert.ok(Math.abs(centre - direct) < 25, `${centre} vs ${direct}`);
  assert.equal(await terrainGrid({ lat: -40, lon: -140 }, 5), null);
});

test('horizon at Deutsches Eck shows the Ehrenbreitstein ridge to the east', async () => {
  const profile = await horizonProfile(DEUTSCHES_ECK.lat, DEUTSCHES_ECK.lon);
  assert.ok(profile, 'profile');
  assert.equal(profile.length, 360);
  assert.ok(profile.every((v) => Number.isFinite(v) && v > -5 && v < 45));
  const east = meanDeg(profile, 60, 120);
  const west = meanDeg(profile, 240, 300);
  // The fortress rock rises ~110 m within ~1 km east of the confluence; westwards the view runs
  // up the Moselle valley.
  assert.ok(east > west + 3, `east ${east.toFixed(2)}° vs west ${west.toFixed(2)}°`);
  assert.ok(Math.max(...profile.slice(60, 121)) > 5, 'ridge reaches more than 5° above the horizon');
});

// ------------------------------------------------------------------------------------------------
// Synthetic terrain: cone mountain to the north-east, ridge to the south
// ------------------------------------------------------------------------------------------------

const ORIGIN = { lat: 47.0, lon: 10.0 };
const M_PER_DEG_LAT = 6_371_008.8 * DEG;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos(ORIGIN.lat * DEG);

function syntheticHeight(lat: number, lon: number): number {
  const north = (lat - ORIGIN.lat) * M_PER_DEG_LAT;
  const east = (lon - ORIGIN.lon) * M_PER_DEG_LON;
  let h = 300;
  // Cone 6 km to the north-east, 900 m high, 3.5 km base radius.
  const cn = 6000 * Math.cos(45 * DEG);
  const ce = 6000 * Math.sin(45 * DEG);
  const r = Math.hypot(north - cn, east - ce);
  h += Math.max(0, 900 * (1 - r / 3500));
  // East-west ridge 4 km to the south with a varying crest.
  const crest = 380 + 120 * Math.sin(east / 1700) + 60 * Math.sin(east / 650);
  h += crest * Math.exp(-(((north + 4000) / 700) ** 2));
  // A small hill to the west so that no direction is entirely flat.
  h += 150 * Math.exp(-((Math.hypot(north - 500, east + 5000) / 900) ** 2));
  return h;
}

function syntheticProfile(): number[] {
  const profile = horizonProfileFromSampler(syntheticHeight, ORIGIN.lat, ORIGIN.lon, { cellM: 20, radiusKm: 15 });
  assert.ok(profile);
  return profile;
}

function profileAt(profile: number[], az: number): number {
  const a = ((az % 360) + 360) % 360;
  const i = Math.floor(a);
  const t = a - i;
  return (profile[i % 360] as number) * (1 - t) + (profile[(i + 1) % 360] as number) * t;
}

/**
 * Renders the sky boundary a camera would see: per column the y where the ray elevation equals
 * the terrain horizon in the ray's azimuth (bisection; the elevation falls monotonically with y).
 */
function renderSkyline(profile: number[], heading: number, fov: number, pitch: number, aspect: number, columns: number): number[] {
  const out: number[] = [];
  const f = 0.5 / Math.tan((fov * DEG) / 2);
  for (let c = 0; c < columns; c++) {
    const u = (c + 0.5) / columns;
    const above = (y: number): boolean => {
      // Rotate the camera ray (x right, y down, z forward) by the pitch about the x axis.
      const X = (u - 0.5) / f;
      const Y = (y - 0.5) / (aspect * f);
      const p = pitch * DEG;
      const up = -Y * Math.cos(p) + Math.sin(p);
      const fwd = Y * Math.sin(p) + Math.cos(p);
      const elev = Math.atan2(up, Math.hypot(X, fwd)) / DEG;
      const az = heading + Math.atan2(X, fwd) / DEG;
      return elev > profileAt(profile, az);
    };
    let lo = -0.5;
    let hi = 1.5;
    for (let k = 0; k < 50; k++) {
      const mid = (lo + hi) / 2;
      if (above(mid)) lo = mid;
      else hi = mid;
    }
    out.push(Math.max(0, Math.min(1, (lo + hi) / 2)));
  }
  return out;
}

function angleDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

test('synthetic horizon has the cone to the north-east and the ridge to the south', () => {
  const profile = syntheticProfile();
  assert.equal(profile.length, 360);
  let peak = 0;
  for (let a = 0; a < 360; a++) if ((profile[a] as number) > (profile[peak] as number)) peak = a;
  assert.ok(angleDiff(peak, 45) <= 3, `peak at ${peak}`);
  assert.ok(meanDeg(profile, 160, 200) > meanDeg(profile, 330, 359) + 2, 'ridge to the south');
  // Flat ground far away dips below the horizon (eye height, curvature).
  assert.ok((profile[315] as number) < 0.5);
});

test('matchSkyline recovers heading and field of view from a synthetic skyline', () => {
  const profile = syntheticProfile();
  const aspect = 16 / 9;
  const cases = [
    { heading: 60, fov: 60, pitch: 3 },
    { heading: 175, fov: 70, pitch: -2 },
    { heading: 20, fov: 50, pitch: 6 },
  ];
  for (const c of cases) {
    const skyline = renderSkyline(profile, c.heading, c.fov, c.pitch, aspect, 192);
    const started = performance.now();
    const match = matchSkyline(skyline, aspect, profile);
    const ms = performance.now() - started;
    assert.ok(angleDiff(match.headingDeg, c.heading) <= 2, `heading ${match.headingDeg} for ${c.heading}`);
    assert.ok(Math.abs(match.fovDeg - c.fov) <= 5, `fov ${match.fovDeg} for ${c.fov}`);
    assert.ok(Math.abs(match.pitchDeg - c.pitch) <= 2, `pitch ${match.pitchDeg} for ${c.pitch}`);
    assert.ok(match.errorDeg < 0.3, `error ${match.errorDeg}`);
    assert.ok(match.score > 0.3, `score ${match.score}`);
    assert.ok(ms < 5000, `matching took ${ms.toFixed(0)} ms`);
  }
});

test('matchSkyline ignores building edges and reports no information for a flat horizon', () => {
  const profile = syntheticProfile();
  const aspect = 16 / 9;
  const skyline = renderSkyline(profile, 60, 60, 3, aspect, 192);
  // A tower in front of the mountain: its outline jumps sharply up and down.
  for (let c = 120; c < 140; c++) skyline[c] = 0.12;
  const match = matchSkyline(skyline, aspect, profile);
  assert.ok(angleDiff(match.headingDeg, 60) <= 2, `heading ${match.headingDeg}`);
  const flat = new Array<number>(360).fill(0);
  const none = matchSkyline(new Array<number>(192).fill(0.5), aspect, flat);
  assert.equal(none.score, 0);
});

test('refinePosition finds the place and heading of a skyline seen at Deutsches Eck', async () => {
  const profile = await horizonProfile(DEUTSCHES_ECK.lat, DEUTSCHES_ECK.lon);
  assert.ok(profile);
  const aspect = 16 / 9;
  const skyline = renderSkyline(profile, 95, 58, 4, aspect, 192);
  // Start 1 km north and 1 km east of the truth: the 5 × 5 grid over ±2 km contains it.
  const start = offsetPoint(DEUTSCHES_ECK, 1000, 1000);
  const result = await refinePosition(skyline, aspect, start, { radiusKm: 2, steps: 5 });
  assert.ok(result, 'result');
  const dNorth = (result.point.lat - DEUTSCHES_ECK.lat) * M_PER_DEG_LAT;
  const dEast = (result.point.lon - DEUTSCHES_ECK.lon) * M_PER_DEG_LAT * Math.cos(DEUTSCHES_ECK.lat * DEG);
  assert.ok(Math.hypot(dNorth, dEast) < 50, `found ${dNorth.toFixed(0)} m N, ${dEast.toFixed(0)} m E of the truth`);
  assert.ok(angleDiff(result.match.headingDeg, 95) <= 2, `heading ${result.match.headingDeg}`);
  assert.ok(Math.abs(result.match.fovDeg - 58) <= 5, `fov ${result.match.fovDeg}`);
  assert.equal(await refinePosition(skyline, aspect, { lat: -40, lon: -140 }), null);
});

test('camera rays: centre looks along the heading, edges at half the field of view', () => {
  const centre = imageRay(0.5, 0.5, 16 / 9, 60, 0);
  assert.ok(Math.abs(centre.azOffDeg) < 1e-9 && Math.abs(centre.elevDeg) < 1e-9);
  const right = imageRay(1, 0.5, 16 / 9, 60, 0);
  assert.ok(Math.abs(right.azOffDeg - 30) < 1e-9);
  const pitched = imageRay(0.5, 0.5, 16 / 9, 60, 10);
  assert.ok(Math.abs(pitched.elevDeg - 10) < 1e-9);
  const p = offsetPoint(ORIGIN, 1000, 0);
  assert.ok(Math.abs((p.lat - ORIGIN.lat) * M_PER_DEG_LAT - 1000) < 1e-6);
});
