import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MIN_SAMPLES_FOR_STATS, RELEVANCE, adaptiveCutoff } from '../src/ml/calibration.js';

const cal = RELEVANCE.siglip2;

test('without footage the cut-off is the prior', () => {
  assert.equal(adaptiveCutoff(new Float64Array(0), cal), cal.prior);
});

test('the cut-off stays inside its band whatever the footage looks like', () => {
  const low = Float64Array.from({ length: 200 }, (_, i) => 0.01 + (i % 7) * 0.001);
  const high = Float64Array.from({ length: 200 }, (_, i) => 0.18 + (i % 9) * 0.004);
  assert.ok(adaptiveCutoff(low, cal) >= cal.floor - 1e-9);
  assert.ok(adaptiveCutoff(high, cal) <= cal.ceiling + 1e-9);
});

test('a few samples only nudge the prior', () => {
  const few = Float64Array.from([0.02, 0.03, 0.025]);
  const cutoff = adaptiveCutoff(few, cal);
  const weight = few.length / MIN_SAMPLES_FOR_STATS;
  assert.ok(Math.abs(cutoff - (cal.prior * (1 - weight) + cal.floor * weight)) < 1e-9, String(cutoff));
});

test('every model family has an ordered calibration band', () => {
  for (const [family, c] of Object.entries(RELEVANCE)) {
    assert.ok(c.floor < c.prior && c.prior < c.ceiling, family);
    assert.ok(c.width > 0 && c.k > 0, family);
  }
});
