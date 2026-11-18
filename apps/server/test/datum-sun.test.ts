import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  intervalsWithElevation,
  solarPosition,
  solarPositionSpencer,
  sunEvents,
  sunPath,
  sunState,
} from '../src/datum/sun.js';
import {
  COUNTRY_ZONES,
  addDaysYmd,
  etcZoneForLongitude,
  isValidTimeZone,
  localDateYmd,
  localMinutes,
  localToUtc,
  ruleZoneFor,
  timeZoneFor,
  utcOffsetMin,
} from '../src/datum/timezones.js';

const near = (actual: number, expected: number, tol: number, what: string): void => {
  assert.ok(Math.abs(actual - expected) <= tol, `${what}: ${actual} vs ${expected} (±${tol})`);
};

const angleDiff = (a: number, b: number): number => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
};

const hhmm = (t: number, tz: string): number => localMinutes(t, tz);

// ---------------------------------------------------------------------------------------------
// Solar position
// ---------------------------------------------------------------------------------------------

test('NREL SPA reference example (Reda & Andreas 2004): Golden, CO, 2003-10-17 12:30:30 MST', () => {
  // Published: azimuth 194.34024°, topocentric zenith 50.11162° (refracted at 820 hPa, 11 °C),
  // geocentric declination −9.31434°, equation of time 14.641503 min, hour angle 11.1059°.
  // Removing that refraction (0.013°) and parallax (0.002°) gives a geometric elevation of 39.877°.
  const t = Date.UTC(2003, 9, 17, 19, 30, 30);
  const p = solarPosition(t, 39.742476, -105.1786);
  near(p.azimuthDeg, 194.34024, 0.02, 'azimuth');
  near(p.elevationTrueDeg, 39.877, 0.02, 'geometric elevation');
  near(p.declinationDeg, -9.31434, 0.01, 'declination');
  near(p.equationOfTimeMin, 14.641503, 0.05, 'equation of time');
  near(p.hourAngleDeg, 11.1059, 0.02, 'hour angle');
  // Refraction is added on top of the geometric elevation and is small at 40°.
  assert.ok(p.elevationDeg > p.elevationTrueDeg && p.elevationDeg - p.elevationTrueDeg < 0.03);
});

test('NOAA implementation agrees with the independent Spencer approximation (1950–2100) within 1°', () => {
  let seed = 12345;
  const rnd = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const vec = (az: number, el: number): [number, number, number] => {
    const r = Math.PI / 180;
    return [Math.cos(el * r) * Math.sin(az * r), Math.cos(el * r) * Math.cos(az * r), Math.sin(el * r)];
  };
  let worstSep = 0;
  let worstEl = 0;
  const from = Date.UTC(1950, 0, 1);
  const to = Date.UTC(2100, 0, 1);
  for (let i = 0; i < 5000; i++) {
    const t = from + rnd() * (to - from);
    const lat = -75 + rnd() * 150;
    const lon = -180 + rnd() * 360;
    const a = solarPosition(t, lat, lon);
    const b = solarPositionSpencer(t, lat, lon);
    const u = vec(a.azimuthDeg, a.elevationTrueDeg);
    const v = vec(b.azimuthDeg, b.elevationTrueDeg);
    const sep = (Math.acos(Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2])) * 180) / Math.PI;
    worstSep = Math.max(worstSep, sep);
    worstEl = Math.max(worstEl, Math.abs(a.elevationTrueDeg - b.elevationTrueDeg));
    if (b.elevationTrueDeg > 0 && b.elevationTrueDeg < 60) {
      assert.ok(angleDiff(a.azimuthDeg, b.azimuthDeg) < 2, `azimuth at ${new Date(t).toISOString()} ${lat},${lon}`);
    }
  }
  assert.ok(worstSep < 1, `angular separation ${worstSep}`);
  assert.ok(worstEl < 1, `elevation difference ${worstEl}`);
});

test('equinox: solar-noon elevation is 90° − |latitude|', () => {
  for (const [lat, lon] of [
    [0, 0],
    [30, 31.2],
    [52.52, 13.405],
    [-33.87, 151.21],
    [60.17, 24.94],
    [-23.5, -46.6],
  ] as const) {
    const noon = sunEvents('2024-03-20', lat, lon, etcZoneForLongitude(lon)).solarNoon;
    near(solarPosition(noon, lat, lon).elevationTrueDeg, 90 - Math.abs(lat), 0.6, `noon elevation at ${lat}`);
  }
});

test('June solstice declination is +23.44°, December −23.44°', () => {
  near(solarPosition(Date.UTC(2024, 5, 20, 20, 51), 0, 0).declinationDeg, 23.44, 0.02, 'June');
  near(solarPosition(Date.UTC(2024, 11, 21, 9, 21), 0, 0).declinationDeg, -23.44, 0.02, 'December');
});

test('the sun stands due south at solar noon in northern mid-latitudes, due north in the south', () => {
  for (const date of ['2024-01-15', '2024-04-10', '2024-07-01', '2024-10-20']) {
    const berlin = sunEvents(date, 52.52, 13.405, 'Europe/Berlin');
    near(solarPosition(berlin.solarNoon, 52.52, 13.405).azimuthDeg, 180, 0.3, `Berlin ${date}`);
    near(solarPosition(berlin.solarNoon, 52.52, 13.405).hourAngleDeg, 0, 0.05, `hour angle ${date}`);
  }
  const sydney = sunEvents('2024-06-21', -33.87, 151.21, 'Australia/Sydney');
  assert.ok(angleDiff(solarPosition(sydney.solarNoon, -33.87, 151.21).azimuthDeg, 0) < 0.3);
});

test('morning sun in the east, evening sun in the west', () => {
  const morning = solarPosition(Date.UTC(2024, 2, 20, 6, 0), 52.52, 13.405); // 07:00 CET
  const evening = solarPosition(Date.UTC(2024, 2, 20, 16, 30), 52.52, 13.405);
  assert.ok(morning.azimuthDeg > 80 && morning.azimuthDeg < 110, String(morning.azimuthDeg));
  assert.ok(evening.azimuthDeg > 245 && evening.azimuthDeg < 280, String(evening.azimuthDeg));
  assert.ok(morning.hourAngleDeg < 0 && evening.hourAngleDeg > 0);
});

test('polar day and polar night at 78° N (Longyearbyen)', () => {
  const june = sunEvents('2024-06-21', 78.22, 15.65, 'Arctic/Longyearbyen');
  assert.equal(june.polar, 'day');
  assert.equal(june.sunrise, null);
  assert.equal(june.sunset, null);
  const december = sunEvents('2024-12-21', 78.22, 15.65, 'Arctic/Longyearbyen');
  assert.equal(december.polar, 'night');
  assert.ok(solarPosition(december.solarNoon, 78.22, 15.65).elevationDeg < -10);
});

test('published sunrise and sunset times (±3 min)', () => {
  const berlin = sunEvents('2024-06-21', 52.52, 13.405, 'Europe/Berlin');
  assert.equal(berlin.polar, null);
  near(hhmm(berlin.sunrise as number, 'Europe/Berlin'), 4 * 60 + 43, 3, 'Berlin sunrise (CEST)');
  near(hhmm(berlin.sunset as number, 'Europe/Berlin'), 21 * 60 + 33, 3, 'Berlin sunset (CEST)');
  near(hhmm(berlin.solarNoon, 'Europe/Berlin'), 13 * 60 + 8, 2, 'Berlin solar noon');
  assert.equal(localDateYmd(berlin.sunrise as number, 'Europe/Berlin'), '2024-06-21');

  const sydney = sunEvents('2024-12-21', -33.8688, 151.2093, 'Australia/Sydney');
  near(hhmm(sydney.sunrise as number, 'Australia/Sydney'), 5 * 60 + 41, 3, 'Sydney sunrise (AEDT)');
  near(hhmm(sydney.sunset as number, 'Australia/Sydney'), 20 * 60 + 5, 3, 'Sydney sunset (AEDT)');

  // Elevation at the computed sunrise is the standard −0.833°.
  near(solarPosition(berlin.sunrise as number, 52.52, 13.405).elevationTrueDeg, -0.833, 0.01, 'altitude at sunrise');
});

test('sunState: shadow opposite to the sun, ratio 1/tan(elevation), none at night', () => {
  const day = sunState(Date.UTC(2024, 5, 21, 11, 0), 52.52, 13.405);
  near(day.shadowAzimuthDeg, (day.azimuthDeg + 180) % 360, 1e-9, 'shadow azimuth');
  near(day.shadowRatio as number, 1 / Math.tan((day.elevationDeg * Math.PI) / 180), 1e-9, 'shadow ratio');
  assert.ok(day.elevationDeg > 55 && day.elevationDeg < 62, String(day.elevationDeg));
  const night = sunState(Date.UTC(2024, 5, 21, 23, 0), 52.52, 13.405);
  assert.equal(night.shadowRatio, null);
  assert.ok(night.shadowAzimuthDeg >= 0 && night.shadowAzimuthDeg < 360);
});

test('sunPath covers the local day in 10-minute steps and peaks at solar noon', () => {
  const path = sunPath('2024-06-21', 52.52, 13.405, 'Europe/Berlin');
  assert.equal(path.length, 145);
  assert.equal(localMinutes(path[0]!.t, 'Europe/Berlin'), 0);
  for (let i = 1; i < path.length; i++) assert.equal(path[i]!.t - path[i - 1]!.t, 600000);
  const top = path.reduce((a, b) => (b.el > a.el ? b : a));
  const noon = sunEvents('2024-06-21', 52.52, 13.405, 'Europe/Berlin').solarNoon;
  assert.ok(Math.abs(top.t - noon) <= 5 * 60000);
  near(top.el, 90 - 52.52 + 23.44, 0.1, 'maximum elevation');
  // A day with a DST change has 23 or 25 hours.
  assert.equal(sunPath('2024-03-31', 52.52, 13.405, 'Europe/Berlin').length, 139);
  assert.equal(sunPath('2024-10-27', 52.52, 13.405, 'Europe/Berlin').length, 151);
});

test('intervalsWithElevation: Berlin 2024-06-21, 20–30° gives one morning and one afternoon window', () => {
  const iv = intervalsWithElevation('2024-06-21', 52.52, 13.405, 'Europe/Berlin', 20, 30);
  assert.equal(iv.length, 2);
  const [am, pm] = iv as [{ start: number; end: number }, { start: number; end: number }];
  near(hhmm(am.start, 'Europe/Berlin'), 7 * 60 + 19, 3, 'morning start');
  near(hhmm(am.end, 'Europe/Berlin'), 8 * 60 + 25, 3, 'morning end');
  near(hhmm(pm.start, 'Europe/Berlin'), 17 * 60 + 51, 3, 'afternoon start');
  near(hhmm(pm.end, 'Europe/Berlin'), 18 * 60 + 58, 3, 'afternoon end');
  // Edges are where the apparent elevation crosses the limits.
  near(solarPosition(am.start, 52.52, 13.405).elevationDeg, 20, 0.01, 'edge 20°');
  near(solarPosition(am.end, 52.52, 13.405).elevationDeg, 30, 0.01, 'edge 30°');
  // Symmetric about solar noon.
  const noon = sunEvents('2024-06-21', 52.52, 13.405, 'Europe/Berlin').solarNoon;
  near((noon - am.start - (pm.end - noon)) / 60000, 0, 2, 'symmetry');
});

test('intervalsWithElevation: night spans both ends of the day; an unreachable band is empty', () => {
  const night = intervalsWithElevation('2024-12-21', 52.52, 13.405, 'Europe/Berlin', -90, -6);
  assert.equal(night.length, 2);
  assert.equal(localMinutes(night[0]!.start, 'Europe/Berlin'), 0);
  near(hhmm(night[0]!.end, 'Europe/Berlin'), 7 * 60 + 33, 5, 'end of night (civil dawn)');
  assert.deepEqual(intervalsWithElevation('2024-12-21', 52.52, 13.405, 'Europe/Berlin', 20, 30), []);
  assert.deepEqual(intervalsWithElevation('2024-06-21', 78.22, 15.65, 'Arctic/Longyearbyen', -90, -6), []);
});

// ---------------------------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------------------------

test('UTC offsets: Berlin summer/winter, New York, Sydney', () => {
  assert.equal(utcOffsetMin(Date.UTC(2024, 6, 1, 12), 'Europe/Berlin'), 120);
  assert.equal(utcOffsetMin(Date.UTC(2024, 0, 15, 12), 'Europe/Berlin'), 60);
  assert.equal(utcOffsetMin(Date.UTC(2024, 6, 1, 12), 'America/New_York'), -240);
  assert.equal(utcOffsetMin(Date.UTC(2024, 0, 15, 12), 'America/New_York'), -300);
  assert.equal(utcOffsetMin(Date.UTC(2024, 0, 15, 12), 'Australia/Sydney'), 660);
  assert.equal(utcOffsetMin(Date.UTC(2024, 6, 1, 12), 'Australia/Sydney'), 600);
  assert.equal(utcOffsetMin(Date.UTC(2024, 6, 1, 12), 'Asia/Kolkata'), 330);
  assert.equal(utcOffsetMin(Date.UTC(2024, 6, 1, 12), 'Asia/Kathmandu'), 345);
  // Etc zones carry the inverted POSIX sign.
  assert.equal(utcOffsetMin(Date.UTC(2024, 6, 1, 12), 'Etc/GMT-1'), 60);
  assert.equal(utcOffsetMin(Date.UTC(2024, 6, 1, 12), 'Etc/GMT+5'), -300);
});

test('local minutes and dates across midnight', () => {
  const t = Date.UTC(2024, 6, 1, 22, 30); // 00:30 CEST on 2 July
  assert.equal(localMinutes(t, 'Europe/Berlin'), 30);
  assert.equal(localDateYmd(t, 'Europe/Berlin'), '2024-07-02');
  assert.equal(localDateYmd(t, 'America/New_York'), '2024-07-01');
  assert.equal(localMinutes(t, 'America/New_York'), 18 * 60 + 30);
  assert.equal(addDaysYmd('2024-02-28', 1), '2024-02-29');
  assert.equal(addDaysYmd('2024-12-31', 1), '2025-01-01');
});

test('localToUtc round-trips and handles DST gaps and overlaps', () => {
  assert.equal(localToUtc('2024-07-01', 12 * 60, 'Europe/Berlin'), Date.UTC(2024, 6, 1, 10));
  assert.equal(localToUtc('2024-01-15', 12 * 60, 'America/New_York'), Date.UTC(2024, 0, 15, 17));
  assert.equal(localToUtc('2024-12-21', 5 * 60 + 41, 'Australia/Sydney'), Date.UTC(2024, 11, 20, 18, 41));
  // 02:30 does not exist on 31 March 2024 in Berlin: moved forward to 03:30 CEST.
  const gap = localToUtc('2024-03-31', 150, 'Europe/Berlin');
  assert.equal(gap, Date.UTC(2024, 2, 31, 1, 30));
  assert.equal(localMinutes(gap, 'Europe/Berlin'), 210);
  // 02:30 happens twice on 27 October 2024: the earlier (CEST) instant.
  assert.equal(localToUtc('2024-10-27', 150, 'Europe/Berlin'), Date.UTC(2024, 9, 27, 0, 30));
  for (const tz of ['Europe/Berlin', 'America/New_York', 'Australia/Sydney', 'Asia/Tokyo', 'Etc/GMT+3']) {
    for (const m of [0, 359, 720, 1439]) {
      const t = localToUtc('2024-05-05', m, tz);
      assert.equal(localDateYmd(t, tz), '2024-05-05');
      assert.equal(localMinutes(t, tz), m);
    }
  }
});

test('timeZoneFor: primary zones, multi-zone countries and the Etc fallback', () => {
  const cases: Array<[number, number, string | null, string]> = [
    [52.52, 13.405, 'DE', 'Europe/Berlin'],
    [48.86, 2.35, 'fr', 'Europe/Paris'],
    [40.71, -74.0, 'US', 'America/New_York'],
    [41.88, -87.63, 'US', 'America/Chicago'],
    [39.74, -104.99, 'US', 'America/Denver'],
    [33.45, -112.07, 'US', 'America/Phoenix'],
    [34.05, -118.24, 'US', 'America/Los_Angeles'],
    [61.22, -149.9, 'US', 'America/Anchorage'],
    [21.31, -157.86, 'US', 'Pacific/Honolulu'],
    [49.28, -123.12, 'CA', 'America/Vancouver'],
    [51.05, -114.07, 'CA', 'America/Edmonton'],
    [50.45, -104.61, 'CA', 'America/Regina'],
    [49.9, -97.14, 'CA', 'America/Winnipeg'],
    [45.5, -73.57, 'CA', 'America/Toronto'],
    [44.65, -63.57, 'CA', 'America/Halifax'],
    [47.56, -52.71, 'CA', 'America/St_Johns'],
    [19.43, -99.13, 'MX', 'America/Mexico_City'],
    [32.53, -117.04, 'MX', 'America/Tijuana'],
    [29.07, -110.96, 'MX', 'America/Hermosillo'],
    [21.16, -86.85, 'MX', 'America/Cancun'],
    [-23.55, -46.63, 'BR', 'America/Sao_Paulo'],
    [-3.12, -60.02, 'BR', 'America/Manaus'],
    [-9.97, -67.81, 'BR', 'America/Rio_Branco'],
    [-3.85, -32.42, 'BR', 'America/Noronha'],
    [55.75, 37.62, 'RU', 'Europe/Moscow'],
    [54.71, 20.51, 'RU', 'Europe/Kaliningrad'],
    [53.2, 50.15, 'RU', 'Europe/Samara'],
    [56.84, 60.6, 'RU', 'Asia/Yekaterinburg'],
    [55.03, 82.92, 'RU', 'Asia/Novosibirsk'],
    [52.29, 104.28, 'RU', 'Asia/Irkutsk'],
    [43.12, 131.89, 'RU', 'Asia/Vladivostok'],
    [53.02, 158.65, 'RU', 'Asia/Kamchatka'],
    [-33.87, 151.21, 'AU', 'Australia/Sydney'],
    [-31.95, 115.86, 'AU', 'Australia/Perth'],
    [-12.46, 130.84, 'AU', 'Australia/Darwin'],
    [-34.93, 138.6, 'AU', 'Australia/Adelaide'],
    [-27.47, 153.03, 'AU', 'Australia/Brisbane'],
    [-6.2, 106.85, 'ID', 'Asia/Jakarta'],
    [-8.65, 115.22, 'ID', 'Asia/Makassar'],
    [-2.53, 140.72, 'ID', 'Asia/Jayapura'],
    [50.28, 57.21, 'KZ', 'Asia/Aqtobe'],
    [43.24, 76.95, 'KZ', 'Asia/Almaty'],
    [48.0, 91.64, 'MN', 'Asia/Hovd'],
    [47.92, 106.92, 'MN', 'Asia/Ulaanbaatar'],
    [-4.32, 15.31, 'CD', 'Africa/Kinshasa'],
    [-11.66, 27.48, 'CD', 'Africa/Lubumbashi'],
    [-33.45, -70.67, 'CL', 'America/Santiago'],
    [-27.11, -109.35, 'CL', 'Pacific/Easter'],
    [-34.6, -58.38, 'AR', 'America/Argentina/Buenos_Aires'],
    [38.72, -9.14, 'PT', 'Europe/Lisbon'],
    [37.74, -25.67, 'PT', 'Atlantic/Azores'],
    [28.12, -15.43, 'ES', 'Atlantic/Canary'],
    [40.42, -3.7, 'ES', 'Europe/Madrid'],
    [-0.74, -90.31, 'EC', 'Pacific/Galapagos'],
    [-2.17, -79.92, 'EC', 'America/Guayaquil'],
    [-20.88, 55.45, 'FR', 'Indian/Reunion'],
    [14.6, -61.07, 'FR', 'America/Martinique'],
    [-17.53, -149.57, 'FR', 'Pacific/Tahiti'],
    [-41.29, 174.78, 'NZ', 'Pacific/Auckland'],
    [-43.95, -176.56, 'NZ', 'Pacific/Chatham'],
  ];
  for (const [lat, lon, iso, zone] of cases) assert.equal(timeZoneFor(lat, lon, iso), zone, `${iso} ${lat},${lon}`);
  // Unknown country: nautical zone from the longitude (inverted sign).
  assert.equal(timeZoneFor(48, 10, null), 'Etc/GMT-1');
  assert.equal(timeZoneFor(48, -77, null), 'Etc/GMT+5');
  assert.equal(timeZoneFor(0, 2, 'ZZ'), 'Etc/GMT');
  assert.equal(timeZoneFor(-60, 179.9, null), 'Etc/GMT-12');
  assert.equal(timeZoneFor(-60, -179.9, null), 'Etc/GMT+12');
  // A French code far from any French territory falls back as well.
  assert.equal(timeZoneFor(10, 100, 'FR'), 'Etc/GMT-7');
});

test('every table zone and every rule result is known to ICU', () => {
  const codes = Object.keys(COUNTRY_ZONES);
  assert.ok(codes.length >= 245, `only ${codes.length} countries`);
  for (const [iso, zone] of Object.entries(COUNTRY_ZONES)) assert.ok(isValidTimeZone(zone), `${iso}: ${zone}`);
  for (const iso of codes) {
    for (let lat = -80; lat <= 80; lat += 4) {
      for (let lon = -178; lon <= 178; lon += 4) {
        const zone = ruleZoneFor(lat, lon, iso);
        if (zone !== null) assert.ok(isValidTimeZone(zone), `${iso} ${lat},${lon}: ${zone}`);
        assert.ok(isValidTimeZone(timeZoneFor(lat, lon, iso)));
      }
    }
  }
});
