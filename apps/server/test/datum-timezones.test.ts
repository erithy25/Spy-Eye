import assert from 'node:assert/strict';
import { test } from 'node:test';
import { timeZoneFor, utcOffsetMin } from '../src/datum/timezones.js';

const JULY = Date.UTC(2025, 6, 1, 12);
const JANUARY = Date.UTC(2025, 0, 15, 12);

type Case = [name: string, lat: number, lon: number, zone: string];

function check(country: string, cases: readonly Case[]): void {
  for (const [name, lat, lon, zone] of cases) assert.equal(timeZoneFor(lat, lon, country), zone, `${name} (${lat}, ${lon})`);
}

test('Mexico: the Rio Grande border keeps US daylight saving, the interior does not', () => {
  check('MX', [
    ['Matamoros', 25.87, -97.5, 'America/Matamoros'],
    ['Reynosa', 26.09, -98.28, 'America/Matamoros'],
    ['Río Bravo', 25.99, -98.09, 'America/Matamoros'],
    ['Valle Hermoso', 25.67, -97.81, 'America/Matamoros'],
    ['Miguel Alemán', 26.4, -99.03, 'America/Matamoros'],
    ['Nuevo Laredo', 27.48, -99.51, 'America/Matamoros'],
    ['Anáhuac', 27.24, -100.13, 'America/Matamoros'],
    ['Piedras Negras', 28.7, -100.52, 'America/Matamoros'],
    ['Allende', 28.34, -100.85, 'America/Matamoros'],
    ['Ciudad Acuña', 29.32, -100.93, 'America/Matamoros'],
    ['Ojinaga', 29.56, -104.41, 'America/Ojinaga'],
    ['Manuel Benavides', 29.09, -103.91, 'America/Ojinaga'],
    // Inland neighbours: no daylight saving since 2022.
    ['Monterrey', 25.67, -100.31, 'America/Monterrey'],
    ['Lampazos', 27.03, -100.51, 'America/Monterrey'],
    ['Parás', 26.5, -99.52, 'America/Monterrey'],
    ['Los Aldamas', 26.06, -99.19, 'America/Monterrey'],
    ['Méndez', 25.12, -98.58, 'America/Monterrey'],
    ['Sabinas', 27.85, -101.12, 'America/Mexico_City'],
    ['Saltillo', 25.42, -101.0, 'America/Mexico_City'],
    ['Chihuahua', 28.64, -106.09, 'America/Chihuahua'],
    ['Ciudad Juárez', 31.69, -106.42, 'America/Ciudad_Juarez'],
  ]);
  // The point of the split: one hour apart in summer, the same in winter.
  for (const [lat, lon] of [
    [26.09, -98.28],
    [29.56, -104.41],
  ] as const) {
    const zone = timeZoneFor(lat, lon, 'MX');
    assert.equal(utcOffsetMin(JULY, zone), -300, zone);
    assert.equal(utcOffsetMin(JANUARY, zone), -360, zone);
  }
  assert.equal(utcOffsetMin(JULY, timeZoneFor(25.67, -100.31, 'MX')), -360);
});

test('Australia: western Queensland north of 26° S is Brisbane, South Australia stays Adelaide', () => {
  check('AU', [
    ['Mount Isa', -20.73, 139.49, 'Australia/Brisbane'],
    ['Birdsville', -25.9, 139.35, 'Australia/Brisbane'],
    ['Burketown', -17.74, 139.55, 'Australia/Brisbane'],
    ['Innamincka', -27.75, 140.73, 'Australia/Adelaide'],
    ['Coober Pedy', -29.01, 134.75, 'Australia/Adelaide'],
    ['Adelaide', -34.93, 138.6, 'Australia/Adelaide'],
    ['Alice Springs', -23.7, 133.88, 'Australia/Darwin'],
    ['Broken Hill', -31.95, 141.47, 'Australia/Broken_Hill'],
  ]);
  const isa = timeZoneFor(-20.73, 139.49, 'AU');
  assert.equal(utcOffsetMin(JANUARY, isa), 600);
  assert.equal(utcOffsetMin(JULY, isa), 600);
});

test('United States: the Eastern/Central line in Tennessee and on the Alabama/Georgia border', () => {
  check('US', [
    // Hamilton, Bradley, Rhea and Roane counties: Eastern.
    ['Chattanooga', 35.045, -85.309, 'America/New_York'],
    ['Signal Mountain', 35.12, -85.34, 'America/New_York'],
    ['Cleveland TN', 35.16, -84.877, 'America/New_York'],
    ['Dayton TN', 35.49, -85.01, 'America/New_York'],
    ['Rockwood', 35.87, -84.68, 'America/New_York'],
    ['Knoxville', 35.96, -83.92, 'America/New_York'],
    // Marion, Sequatchie, Bledsoe, Cumberland and Fentress counties and Middle Tennessee: Central.
    ['Jasper', 35.07, -85.63, 'America/Chicago'],
    ['Dunlap', 35.37, -85.39, 'America/Chicago'],
    ['Pikeville', 35.61, -85.19, 'America/Chicago'],
    ['Crossville', 35.95, -85.03, 'America/Chicago'],
    ['Jamestown TN', 36.43, -84.93, 'America/Chicago'],
    ['Nashville', 36.16, -86.78, 'America/Chicago'],
    // Georgia is Eastern up to the state line, Alabama Central.
    ['Rossville GA', 34.98, -85.29, 'America/New_York'],
    ['Summerville GA', 34.48, -85.35, 'America/New_York'],
    ['Rome GA', 34.26, -85.16, 'America/New_York'],
    ['Fort Payne AL', 34.44, -85.72, 'America/Chicago'],
    ['Heflin AL', 33.65, -85.59, 'America/Chicago'],
  ]);
  const chattanooga = timeZoneFor(35.045, -85.309, 'US');
  assert.equal(utcOffsetMin(JANUARY, chattanooga), -300);
  assert.equal(utcOffsetMin(JULY, chattanooga), -240);
});
