import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { solarPosition } from '../src/datum/sun.js';
import {
  LIGHT_CLASSES,
  SEASON_CLASSES,
  type FrameStats,
  type TimeInput,
  clockWindows,
  estimateTime,
  frameStatsFromJpeg,
  monthsOfRange,
  rangeOfMonths,
  readLight,
  readSeason,
} from '../src/datum/time.js';
import { localToUtc } from '../src/datum/timezones.js';

const DIM = 32;
const BERLIN = { lat: 52.52, lon: 13.405 };
const NOW = Date.UTC(2026, 10, 18);

/** Deterministic fake text tower: every prompt of a class maps to that class's basis vector. */
function fakeEmbedder(): { embed: (texts: string[]) => Promise<Float32Array>; calls: () => number } {
  const index = new Map<string, number>();
  LIGHT_CLASSES.forEach((c, k) => c.prompts.forEach((p) => index.set(p, k)));
  SEASON_CLASSES.forEach((c, k) => c.prompts.forEach((p) => index.set(p, 8 + k)));
  let calls = 0;
  return {
    calls: () => calls,
    embed: (texts) => {
      calls++;
      const out = new Float32Array(texts.length * DIM);
      texts.forEach((t, i) => {
        const k = index.get(t);
        if (k !== undefined) out[i * DIM + k] = 1;
        else out[i * DIM + 16 + (t.length % 16)] = 1;
      });
      return Promise.resolve(out);
    },
  };
}

type LightId = (typeof LIGHT_CLASSES)[number]['id'];
type SeasonId = (typeof SEASON_CLASSES)[number]['id'];

function frames(count: number, light: LightId, season: SeasonId): Float32Array {
  const out = new Float32Array(count * DIM);
  const l = LIGHT_CLASSES.findIndex((c) => c.id === light);
  const s = 8 + SEASON_CLASSES.findIndex((c) => c.id === season);
  for (let f = 0; f < count; f++) {
    out[f * DIM + l] = Math.SQRT1_2;
    out[f * DIM + s] = Math.SQRT1_2;
  }
  return out;
}

const dayStats: FrameStats = { meanLuma: 0.5, skyLuma: 0.7, skyBlueness: 0.15, warmth: 0.0, contrast: 0.22 };
const darkStats: FrameStats = { meanLuma: 0.05, skyLuma: null, skyBlueness: null, warmth: 0.02, contrast: 0.08 };

function input(over: Partial<TimeInput>): TimeInput {
  return {
    frameEmbeddings: new Float32Array(0),
    dim: DIM,
    embedTexts: fakeEmbedder().embed,
    frameStats: [],
    location: BERLIN,
    country: 'DE',
    metadataUtc: null,
    filenameDate: null,
    now: NOW,
    ...over,
  };
}

const hhmm = (s: string): number => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

test('clockWindows: Berlin 2024-06-21, 20–30° → one morning and one afternoon window', () => {
  const w = clockWindows([{ date: '2024-06-21', weight: 1 }], { ...BERLIN, timeZone: 'Europe/Berlin' }, [20, 30]);
  assert.equal(w.length, 2);
  const am = w.find((x) => x.startMin < 720)!;
  const pm = w.find((x) => x.startMin > 720)!;
  // 07:19–08:25 and 17:51–18:58 CEST: German "Morgen" and "Abend".
  assert.equal(am.label, 'Morgen');
  assert.equal(pm.label, 'Abend');
  assert.ok(Math.abs(am.startMin - hhmm('07:19')) <= 3 && Math.abs(am.endMin - hhmm('08:25')) <= 3, JSON.stringify(am));
  assert.ok(Math.abs(pm.startMin - hhmm('17:51')) <= 3 && Math.abs(pm.endMin - hhmm('18:58')) <= 3, JSON.stringify(pm));
  assert.ok(Math.abs(am.probability - 0.5) < 0.02 && Math.abs(pm.probability - 0.5) < 0.02);
});

test('clockWindows: a band through solar noon is split there; twilight gives Morgen and Abend', () => {
  const place = { ...BERLIN, timeZone: 'Europe/Berlin' };
  const mid = clockWindows([{ date: '2024-06-21', weight: 1 }], place, [50, 90]);
  assert.deepEqual(mid.map((w) => w.label).sort(), ['Nachmittag', 'Vormittag']);
  const noon = hhmm('13:08');
  assert.ok(mid.every((w) => Math.abs((w.label === 'Vormittag' ? w.endMin : w.startMin) - noon) <= 2));
  const dusk = clockWindows([{ date: '2024-03-20', weight: 1 }], place, [-6, 0]);
  assert.deepEqual(dusk.map((w) => w.label).sort(), ['Abend', 'Morgen']);
  const night = clockWindows([{ date: '2024-12-21', weight: 1 }], place, [-90, -6]);
  assert.ok(night.length === 2 && night.every((w) => w.label === 'Nacht'));
  assert.ok(night.some((w) => w.startMin === 0) && night.some((w) => w.endMin === 1439));
});

test('clockWindows over several months merges per label and follows daylight saving', () => {
  const place = { ...BERLIN, timeZone: 'Europe/Berlin' };
  const w = clockWindows(
    [1, 4, 7, 10].map((m) => ({ date: `2024-${String(m).padStart(2, '0')}-15`, weight: 1 })),
    place,
    [10, 15],
  );
  const total = w.reduce((a, x) => a + x.probability, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  for (const x of w) assert.ok(x.startMin <= x.endMin && x.startMin >= 0 && x.endMin <= 1439);
  assert.ok(w.length >= 2 && w.length <= 6, JSON.stringify(w));
});

test('month ranges: wrap-around, union and mirroring helpers', () => {
  assert.deepEqual(monthsOfRange([11, 2]), [11, 12, 1, 2]);
  assert.deepEqual(rangeOfMonths([12, 1, 2]), [12, 2]);
  assert.deepEqual(rangeOfMonths([3, 4, 5, 6, 7, 8, 9]), [3, 9]);
  assert.equal(rangeOfMonths([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), null);
  const p = SEASON_CLASSES.map((c) => (c.id === 'autumn' ? 0.5 : c.id === 'summer' ? 0.35 : 0.15 / 6));
  assert.deepEqual(readSeason(p).monthsNorth, [5, 11]);
  const urban = SEASON_CLASSES.map((c) => (c.id === 'urban' ? 0.6 : 0.4 / 7));
  assert.equal(readSeason(urban).monthsNorth, null);
});

test('readLight: frame statistics shift an undecided zero-shot reading', () => {
  const flat = LIGHT_CLASSES.map(() => 1 / LIGHT_CLASSES.length);
  const dark = readLight(flat, darkStats, true);
  assert.ok(dark.phase === 'night' || dark.phase === 'twilight', dark.phase);
  assert.ok(dark.probs.night > dark.probs.midday * 5);
  const bright = readLight(flat, dayStats, true);
  assert.equal(bright.phase, 'day');
  assert.ok(bright.band![0] >= 3 && bright.band![1] <= 90);
  const warm = readLight(flat, { meanLuma: 0.35, skyLuma: 0.5, skyBlueness: -0.05, warmth: 0.2, contrast: 0.1 }, true);
  assert.equal(warm.phase, 'golden');
});

test('metadata: exact instant, ±1 minute window, sun report', async () => {
  const utc = Date.UTC(2024, 5, 21, 10, 0); // 12:00 CEST
  const { time, sun } = await estimateTime(input({ metadataUtc: utc, frameEmbeddings: frames(3, 'midday', 'summer'), frameStats: [dayStats] }));
  assert.equal(time.method, 'metadata');
  assert.equal(time.utc, utc);
  assert.equal(time.date, '2024-06-21');
  assert.equal(time.dateSource, 'metadata');
  assert.equal(time.timezone, 'Europe/Berlin');
  assert.equal(time.confidence, 0.95);
  assert.deepEqual(time.windows.map((w) => [w.startMin, w.endMin]), [[719, 721]]);
  assert.equal(time.phase, 'day');
  assert.ok(sun);
  assert.equal(sun.date, '2024-06-21');
  assert.ok(Math.abs(sun.at!.elevationDeg - solarPosition(utc, BERLIN.lat, BERLIN.lon).elevationDeg) < 1e-9);
  assert.equal(sun.path.length, 145);
  assert.ok(sun.sunrise !== null && sun.sunset !== null);
  assert.ok(time.notes.length >= 2 && time.notes.length <= 5);
  assert.match(time.notes.join(' '), /passt zum Sonnenstand/);
});

test('metadata that contradicts the light is flagged', async () => {
  const utc = Date.UTC(2024, 5, 21, 10, 0);
  const { time } = await estimateTime(input({ metadataUtc: utc, frameEmbeddings: frames(3, 'night', 'urban'), frameStats: [darkStats] }));
  assert.match(time.notes.join(' '), /passt nicht/);
});

test('daylight frames with a date in the file name: windows on both sides of noon', async () => {
  const embed = fakeEmbedder().embed;
  const june = await estimateTime(
    input({ embedTexts: embed, frameEmbeddings: frames(4, 'daylight', 'summer'), frameStats: [dayStats, dayStats], filenameDate: '2024-06-21' }),
  );
  const { time, sun } = june;
  assert.equal(time.method, 'sun');
  assert.equal(time.dateSource, 'filename');
  assert.equal(time.date, '2024-06-21');
  assert.equal(time.monthRange, null);
  assert.equal(time.phase, 'day');
  assert.deepEqual(time.sunElevationBand, [12, 35]);
  // 12° and 35° on 21 June in Berlin (by hand: cos H = (sin h − sin φ sin δ) / (cos φ cos δ) gives
  // H = 101.1° and 62.5°, i.e. 6 h 44 min and 4 h 10 min before the 13:08 noon): 06:23 and 08:58 CEST.
  // Core windows: the highest-density part of the clock, inside the times where the sun stands in
  // the band (morning 06:23–08:58 CEST and the mirror image in the evening).
  assert.ok(time.windows.length >= 1 && time.windows.length <= 4, JSON.stringify(time.windows));
  for (const w of time.windows) assert.ok(['Morgen', 'Vormittag', 'Nachmittag', 'Abend'].includes(w.label), w.label);
  const morning = time.windows.filter((w) => w.startMin < hhmm('12:00'));
  for (const w of morning) assert.ok(w.startMin >= hhmm('06:23') - 6 && w.endMin <= hhmm('08:58') + 6, JSON.stringify(w));
  const mass = time.windows.reduce((a, w) => a + w.probability, 0);
  assert.ok(mass >= 0.55 && mass <= 1.0001, String(mass));
  const notes = time.notes.join(' ');
  assert.match(notes, /Datum aus dem Dateinamen: 21\.06\.2024\./);
  assert.match(notes, /möglich ist 06:2\d bis/);
  assert.match(notes, /Sonnenhöhe aus Licht und Schatten: 12 bis 35°/);
  assert.ok(time.notes.length >= 2 && time.notes.length <= 5);
  assert.ok(sun && sun.at);
  assert.ok(sun.at.elevationDeg >= 12 && sun.at.elevationDeg <= 35, String(sun.at.elevationDeg));
  assert.equal(sun.date, '2024-06-21');

  // At the equinox the same band lies later in the morning and earlier in the afternoon.
  const march = await estimateTime(
    input({ embedTexts: embed, frameEmbeddings: frames(4, 'daylight', 'summer'), frameStats: [dayStats], filenameDate: '2024-03-20' }),
  );
  const isAm = (l: string): boolean => l === 'Morgen' || l === 'Vormittag';
  const isPm = (l: string): boolean => l === 'Nachmittag' || l === 'Abend';
  const labels = march.time.windows.map((w) => w.label);
  assert.ok(labels.some(isAm) && labels.some(isPm), JSON.stringify(labels));
  const amP = march.time.windows.filter((w) => isAm(w.label)).reduce((a, w) => a + w.probability, 0);
  const pmP = march.time.windows.filter((w) => isPm(w.label)).reduce((a, w) => a + w.probability, 0);
  // Morning and afternoon are mirror images around solar noon: about the same weight.
  assert.ok(Math.abs(amP - pmP) < 0.08, `${amP} ${pmP}`);
});

test('night frames: night windows at both ends of the day', async () => {
  const { time } = await estimateTime(
    input({ frameEmbeddings: frames(2, 'night', 'urban'), frameStats: [darkStats], filenameDate: '2024-12-21' }),
  );
  assert.equal(time.phase, 'night');
  // One window across midnight (or two at both ends of the day), all of it night.
  assert.ok(time.windows.length >= 1 && time.windows.length <= 2 && time.windows.every((w) => w.label === 'Nacht'), JSON.stringify(time.windows));
  assert.ok(time.windows.some((w) => w.startMin > w.endMin || w.startMin <= 5 || w.endMin >= 1435), JSON.stringify(time.windows));
  assert.ok(time.sunElevationBand![1] === -6);
  assert.match(time.notes[0]!, /unter −6°/);
});

test('season from vegetation: northern, southern and equatorial latitudes', async () => {
  const embed = fakeEmbedder();
  const north = await estimateTime(input({ embedTexts: embed.embed, frameEmbeddings: frames(3, 'golden', 'autumn') }));
  assert.equal(north.time.dateSource, 'season');
  assert.deepEqual(north.time.monthRange, [9, 11]);
  assert.match(north.time.notes.join(' '), /September bis November/);
  assert.ok(north.time.windows.length > 0 && north.time.windows.every((w) => w.label !== 'Nacht'), JSON.stringify(north.time.windows));
  assert.equal(north.sun?.date, '2026-10-15');

  const south = await estimateTime(
    input({ embedTexts: embed.embed, frameEmbeddings: frames(3, 'golden', 'autumn'), location: { lat: -33.87, lon: 151.21 }, country: 'AU' }),
  );
  assert.deepEqual(south.time.monthRange, [3, 5]);
  assert.equal(south.time.timezone, 'Australia/Sydney');

  const equator = await estimateTime(
    input({ embedTexts: embed.embed, frameEmbeddings: frames(3, 'golden', 'autumn'), location: { lat: 1.29, lon: 103.85 }, country: 'SG' }),
  );
  assert.equal(equator.time.monthRange, null);
  assert.equal(equator.time.dateSource, 'none');
  // The text tower ran once for all three estimates (per-process cache).
  assert.equal(embed.calls(), 2);
});

test('unknown place: solar time at 45°, no time zone, no sun report', async () => {
  const { time, sun } = await estimateTime(
    input({ frameEmbeddings: frames(2, 'daylight', 'summer'), location: null, country: null, filenameDate: '2024-06-21' }),
  );
  assert.equal(time.method, 'sun');
  assert.equal(time.timezone, null);
  assert.equal(sun, null);
  assert.ok(time.windows.length === 2);
  assert.match(time.notes.join(' '), /45°/);
  assert.ok(time.confidence < 0.7);
});

test('indoor frames: no time, phase unknown', async () => {
  const { time, sun } = await estimateTime(input({ frameEmbeddings: frames(2, 'indoor', 'urban') }));
  assert.equal(time.method, 'none');
  assert.equal(time.phase, 'unknown');
  assert.deepEqual(time.windows, []);
  assert.equal(time.sunElevationBand, null);
  assert.ok(sun && sun.at === null && sun.path.length > 100);
});

test('no embeddings: statistics alone still read a dark scene as night or twilight', async () => {
  const { time } = await estimateTime(input({ frameStats: [darkStats, darkStats], filenameDate: '2024-06-21' }));
  assert.ok(time.phase === 'night' || time.phase === 'twilight', time.phase);
  assert.ok(time.confidence <= 0.5);
});

test('a future file-name date is ignored', async () => {
  const { time } = await estimateTime(input({ frameEmbeddings: frames(1, 'daylight', 'summer'), filenameDate: '2031-01-01' }));
  assert.equal(time.date, null);
  assert.match(time.notes.join(' '), /Zukunft/);
});

test('frameStatsFromJpeg: blue sky over dark ground, and a dark frame', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'datum-time-'));
  try {
    const w = 128;
    const h = 96;
    const sky = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3;
        const top = y < h / 3;
        sky[i] = top ? 90 : 70;
        sky[i + 1] = top ? 150 : 60;
        sky[i + 2] = top ? 235 : 40;
      }
    }
    const skyPath = path.join(dir, 'sky.jpg');
    await sharp(sky, { raw: { width: w, height: h, channels: 3 } }).jpeg().toFile(skyPath);
    const s = await frameStatsFromJpeg(skyPath);
    assert.ok(s.skyLuma !== null && s.skyBlueness !== null);
    assert.ok(s.skyBlueness > 0.4, String(s.skyBlueness));
    assert.ok(s.contrast > 0.1);
    assert.ok(s.meanLuma > 0.2 && s.meanLuma < 0.5);

    const darkPath = path.join(dir, 'dark.jpg');
    await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 10, g: 10, b: 14 } } }).jpeg().toFile(darkPath);
    const d = await frameStatsFromJpeg(darkPath);
    assert.ok(d.meanLuma < 0.06);
    assert.equal(d.skyLuma, null);
    assert.ok(d.contrast < 0.02);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('localToUtc of a window centre lands inside the band', () => {
  const w = clockWindows([{ date: '2024-06-21', weight: 1 }], { ...BERLIN, timeZone: 'Europe/Berlin' }, [20, 30]);
  for (const x of w) {
    const t = localToUtc('2024-06-21', (x.startMin + x.endMin) / 2, 'Europe/Berlin');
    const el = solarPosition(t, BERLIN.lat, BERLIN.lon).elevationDeg;
    assert.ok(el > 20 && el < 30, String(el));
  }
});

test('wide bands are cut at −6°: night and twilight/low sun get their own windows', () => {
  const w = clockWindows([{ date: '2024-12-21', weight: 1 }], { ...BERLIN, timeZone: 'Europe/Berlin' }, [-90, 12]);
  const labels = new Set(w.map((x) => x.label));
  assert.deepEqual([...labels].sort(), ['Abend', 'Morgen', 'Nacht']);
  const earlyNight = w.find((x) => x.label === 'Nacht' && x.startMin === 0)!;
  // Civil dawn in Berlin on 21 December: about 07:33 CET.
  assert.ok(Math.abs(earlyNight.endMin - hhmm('07:33')) <= 5, JSON.stringify(earlyNight));
  const morning = w.find((x) => x.label === 'Morgen')!;
  assert.ok(Math.abs(morning.startMin - earlyNight.endMin) <= 1);
});

test('textCacheKey shares prompt embeddings between different embedder functions', async () => {
  const a = fakeEmbedder();
  const b = fakeEmbedder();
  const key = `fake-${Date.now()}`;
  await estimateTime(input({ embedTexts: a.embed, textCacheKey: key, frameEmbeddings: frames(1, 'daylight', 'summer') }));
  await estimateTime(input({ embedTexts: b.embed, textCacheKey: key, frameEmbeddings: frames(1, 'daylight', 'summer') }));
  assert.equal(a.calls(), 2);
  assert.equal(b.calls(), 0);
});
