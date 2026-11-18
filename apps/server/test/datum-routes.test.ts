import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Fix } from '../src/datum/contract.js';
import { caseName } from '../src/datum/dataset.js';
import { summarise } from '../src/datum/engine.js';
import { summariseFixes } from '../src/datum/routes.js';

function fix(id: string, errorKm: number | null, radiusKm: number, status: Fix['status'] = 'ready'): Fix {
  return {
    videoId: id,
    status,
    error: null,
    computedAt: 1,
    elapsedMs: 2000,
    location: { lat: 50, lon: 7, radiusKm, confidence: 0.5, method: 'landmark', label: 'x', country: 'DE', countryName: 'Deutschland' },
    candidates: [],
    countries: [],
    time: { method: 'sun', utc: null, date: null, dateSource: 'none', monthRange: null, timezone: 'Europe/Berlin', windows: [{ startMin: 600, endMin: 660, label: 'Vormittag', probability: 1 }], sunElevationBand: [20, 30], phase: 'day', confidence: 0.4, notes: [] },
    sun: { date: '2024-06-21', at: null, path: [{ t: 1, az: 90, el: 10 }], sunrise: null, sunset: null, solarNoon: null },
    heading: null,
    horizon: { matched: false, errorDeg: null, profile: [1, 2, 3] },
    evidence: [],
    keyframes: [],
    truth: errorKm === null ? null : { lat: 50, lon: 7, label: 'y', errorKm, source: 's' },
  };
}

test('neutral case names are numbered from 001', () => {
  assert.equal(caseName(0), 'datum-001.mp4');
  assert.equal(caseName(41), 'datum-042.mp4');
});

test('the summary counts accuracy at the Im2GPS thresholds and the share inside the stated circle', () => {
  const s = summariseFixes([fix('a', 0.5, 1), fix('b', 30, 10), fix('c', 900, 1000), fix('d', null, 5), fix('e', null, 5, 'pending')], true, null);
  assert.equal(s.recordings, 5);
  assert.equal(s.ready, 4);
  assert.equal(s.pending, 1);
  assert.equal(s.withTruth, 3);
  assert.equal(s.medianErrorKm, 30);
  assert.deepEqual(s.within.map((w) => w.count), [1, 1, 2, 2, 3]);
  // a: 0.5 ≤ 1 inside; b: 30 > 10 outside; c: 900 ≤ 1000 inside
  assert.equal(s.insideRadius, 2 / 3);
  assert.equal(s.timeKnown, 4);
});

test('the list summary drops the heavy arrays but keeps everything else', () => {
  const s = summarise(fix('a', 1, 1));
  assert.deepEqual(s.sun?.path, []);
  assert.equal(s.horizon?.profile, null);
  assert.equal(s.location?.label, 'x');
});
