import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Fix, FixLocation, FixSegment } from '../src/datum/contract.js';
import { summariseSegments } from '../src/datum/segments.js';
// The console's helpers for the stretches (pure; their imports are types only).
import { barLayout, nextKey, numberFits, placesLowerBound, placesText, routeGeometry, segmentIndexAt, segmentSummary } from '../../web/src/datum/segments.ts';

function loc(lat: number, lon: number, over: Partial<FixLocation> = {}): FixLocation {
  return { lat, lon, radiusKm: 1500, confidence: 0.9, method: 'landmark', label: over.label ?? `${lat},${lon}`, country: null, countryName: null, ...over };
}

function seg(startSec: number, endSec: number, location: FixLocation | null, place: number | null, joined = false): FixSegment {
  return { startSec, endSec, firstFrame: startSec + 1, lastFrame: endSec, keyframe: { frame: startSec + 2, time: startSec + 1, imageUrl: String(startSec) }, location, place, windows: 1, ...(joined ? { joined: true } : {}) };
}

function fixWith(segments: FixSegment[], lead: number): Fix {
  return {
    videoId: 'v',
    status: 'ready',
    error: null,
    computedAt: 1,
    elapsedMs: 1,
    location: segments[lead]!.location,
    candidates: [],
    countries: [],
    time: { method: 'none', utc: null, date: null, dateSource: 'none', monthRange: null, timezone: null, windows: [], sunElevationBand: null, phase: 'unknown', confidence: 0, notes: [] },
    sun: null,
    heading: null,
    horizon: null,
    evidence: [{ kind: 'segments', label: 'x', detail: 'y', weight: 0.9, frame: segments[lead]!.keyframe.frame }],
    keyframes: [],
    truth: null,
    segments,
  };
}

test('console: stretches at one point share a marker with a short label, and clicks go through them', () => {
  // A recording that goes back and forth between two places, 160 stretches: two markers.
  const stops = Array.from({ length: 160 }, (_, i) => ({ key: i + 1, lat: i % 2 ? 52.52 : 48.86, lon: i % 2 ? 13.4 : 2.35 }));
  const { markers, keys } = routeGeometry(stops, 46, 'seg:', (k) => `Stretch ${k}`);
  assert.equal(markers.length, 2);
  // Not "2·4·6·…·160" (266 characters): the chosen number and how many more.
  assert.deepEqual(
    markers.map((m) => m.label),
    ['1+79', '46+79'],
  );
  assert.equal(markers[1]!.selected, true);
  assert.equal(markers[1]!.sub, 'Stretch 46');
  assert.equal(keys.get('seg:2')!.length, 80);
  // A click on the chosen marker takes the next of its stretches; on another, its first.
  assert.equal(nextKey(keys.get('seg:2')!, 46), 48);
  assert.equal(nextKey(keys.get('seg:2')!, 160), 2);
  assert.equal(nextKey(keys.get('seg:1')!, 46), 1);
  assert.equal(nextKey([], 3), null);
  // A single stretch keeps its plain number.
  assert.equal(routeGeometry([{ key: 7, lat: 1, lon: 2 }], null, 'seg:', String).markers[0]!.label, '7');
});

test('console: the count of places is a lower bound with undetermined stretches or a joined place', () => {
  const t = (de: string, vars?: Record<string, string | number>): string => de.replace('{n}', String(vars?.n ?? ''));
  const plain = [seg(0, 30, loc(48.86, 2.35), 1), seg(30, 60, loc(52.52, 13.4), 2)];
  assert.equal(placesText(fixWith(plain, 0), t), '2 Orte');
  // The world model joined two answers far apart into place 1: "mindestens", as the server says.
  const joined = [seg(0, 30, loc(48.86, 2.35), 1, true), seg(30, 60, loc(52.52, 13.4), 2)];
  assert.equal(placesText(fixWith(joined, 0), t), 'mindestens 2 Orte');
  assert.equal(placesLowerBound({ undetermined: 0, joined: 1 }), true);
  assert.equal(placesLowerBound({ undetermined: 0 }), false);
  assert.equal(placesLowerBound({ undetermined: 2 }), true);
});

test('console: the fix\'s own place stands at the stretch the fix shows, as the server summarises it', () => {
  // Place 1 is Munich (the longest, which the fix shows) and Salzburg (surer, 115 km away).
  const segments = [seg(0, 40, loc(48.14, 11.58, { confidence: 0.82, label: 'München' }), 1, true), seg(40, 60, loc(52.52, 13.4, { label: 'Berlin' }), 2), seg(60, 70, loc(47.8, 13.04, { confidence: 0.95, label: 'Salzburg' }), 1, true)];
  const summary = segmentSummary(fixWith(segments, 0))!;
  assert.equal(summary.lead, 1);
  assert.equal(summary.places[0]!.label, 'München', 'the marker stands where the fix names the place');
  assert.deepEqual(summary, summariseSegments(segments, 0), 'the same as the server\'s compact form');
});

test('console: the timeline fits 160 stretches into the BEFUND column, and the video picks the stretch on screen', () => {
  // 424 px of bar: 2 px bars and gaps hold 106 stretches; beyond, 1 px each.
  assert.deepEqual(barLayout(57, 424), { dense: false, usable: 424 - 2 * 56 });
  const many = barLayout(160, 424);
  assert.equal(many.dense, true);
  assert.ok(160 * 1 + 159 * 1 <= 424, 'the least widths fit');
  assert.equal(many.usable, 424 - 159);
  // Even in the narrowest shell (about 322 px of bar).
  assert.equal(barLayout(160, 322).dense, true);
  assert.ok(2 * 160 - 1 <= 322);
  assert.equal(barLayout(10, 0).dense, false, 'before the bar is measured');
  // Three-digit numbers need wider bars than two.
  assert.equal(numberFits(16, 99), true);
  assert.equal(numberFits(16, 101), false);
  assert.equal(numberFits(22, 160), true);
  // The stretch that holds a second of the video.
  const segments = [seg(0, 30, null, null), seg(30, 60, loc(1, 1), 1), seg(60, 75, null, null)];
  assert.equal(segmentIndexAt(segments, 0), 0);
  assert.equal(segmentIndexAt(segments, 30), 1);
  assert.equal(segmentIndexAt(segments, 74.9), 2);
  assert.equal(segmentIndexAt(segments, 80), -1);
});
