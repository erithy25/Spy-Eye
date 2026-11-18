import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SEARCH_CALIBRATION, cutoffLift, scoreStats, wholeFloor } from '../src/ml/calibration.ts';
import { meanRow } from '../src/ml/model.ts';

const cal = SEARCH_CALIBRATION.siglip2;

test('the cut-off of the whole picture grows with the number of pictures of a scene', () => {
  assert.equal(wholeFloor(cal, 1), cal.wholeFloorSingle);
  assert.equal(wholeFloor(cal, 0), cal.wholeFloorSingle);
  assert.ok(wholeFloor(cal, 4) > wholeFloor(cal, 1));
  assert.ok(wholeFloor(cal, 4) < wholeFloor(cal, 12));
  assert.equal(wholeFloor(cal, 12), cal.wholeFloorPooled);
  assert.equal(wholeFloor(cal, 500), cal.wholeFloorPooled);
});

test('footage that scores low for a query leaves the cut-off at its floor', () => {
  const scores = Float64Array.from({ length: 60 }, (_, i) => 0.02 + (i % 7) * 0.004);
  assert.equal(cutoffLift(scoreStats(scores), cal.wholeFloorPooled, cal), 0);
});

test('footage that scores high as a whole raises the cut-off, by the span at most', () => {
  const scores = Float64Array.from({ length: 60 }, (_, i) => 0.1 + (i % 9) * 0.01);
  const lift = cutoffLift(scoreStats(scores), cal.wholeFloorPooled, cal);
  assert.ok(lift > 0);
  assert.ok(lift <= cal.span);
});

test('statistics over a handful of scenes are trusted only in proportion', () => {
  const few = Float64Array.from({ length: 4 }, (_, i) => 0.1 + i * 0.02);
  const many = Float64Array.from({ length: 80 }, (_, i) => 0.1 + (i % 4) * 0.02);
  const liftFew = cutoffLift(scoreStats(few), cal.wholeFloorPooled, cal);
  const liftMany = cutoffLift(scoreStats(many), cal.wholeFloorPooled, cal);
  assert.ok(liftFew < liftMany);
  assert.equal(cutoffLift(scoreStats(new Float64Array(0)), cal.wholeFloorPooled, cal), 0);
});

test('a single outstanding scene does not move the cut-off', () => {
  // The statistics are robust: one match among unrelated footage must not raise its own bar.
  const scores = Float64Array.from({ length: 50 }, () => 0.03);
  scores[7] = 0.16;
  assert.equal(cutoffLift(scoreStats(scores), cal.wholeFloorPooled, cal), 0);
});

test('families that were not measured again keep one cut-off for both views', () => {
  for (const family of ['siglip', 'clip', 'mobileclip'] as const) {
    const legacy = SEARCH_CALIBRATION[family];
    assert.equal(legacy.centring, 0);
    assert.equal(legacy.wholeFloorSingle, legacy.tileFloor);
    assert.equal(legacy.wholeFloorPooled, legacy.tileFloor);
  }
});

test('the mean row of a matrix of row vectors', () => {
  const rows = Float32Array.from([1, 2, 3, 3, 2, 1]);
  assert.deepEqual([...meanRow(rows, 3)], [2, 2, 2]);
  assert.deepEqual([...meanRow(new Float32Array(0), 3)], [0, 0, 0]);
});
