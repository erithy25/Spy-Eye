import assert from 'node:assert/strict';
import { test } from 'node:test';
import { haversineKm, toMgrs, toUtm } from '../src/core/geo.js';

test('UTM matches published reference points', () => {
  // Eiffel Tower: 31U 448252 E 5411955 N.
  const paris = toUtm(48.8584, 2.2945);
  assert.equal(paris.zone, 31);
  assert.equal(paris.band, 'U');
  assert.ok(Math.abs(paris.easting - 448252) < 2, String(paris.easting));
  assert.ok(Math.abs(paris.northing - 5411955) < 2, String(paris.northing));
});

test('MGRS grid references', () => {
  assert.equal(toMgrs(48.8584, 2.2945), '31U DQ 4825 1195');
  assert.match(toMgrs(50.3644, 7.6061), /^32U MA \d{4} \d{4}$/);
  assert.match(toMgrs(52.5163, 13.3777), /^33U UU \d{4} \d{4}$/);
});

test('great-circle distance', () => {
  const d = haversineKm(50.3644, 7.6061, 50.9413, 6.9583);
  assert.ok(d > 77 && d < 81, String(d));
  assert.equal(haversineKm(50, 7, 50, 7), 0);
});
