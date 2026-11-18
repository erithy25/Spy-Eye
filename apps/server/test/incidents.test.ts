import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { EventHub } from '../src/events.js';
import { Incidents } from '../src/intel/incidents.js';
import type { Alert } from '../src/types.js';

function alert(overrides: Partial<Alert>): Alert {
  return {
    id: `al_${Math.random().toString(36).slice(2)}`,
    watchId: 'wa_fire',
    watchName: 'Brand',
    watchNameEn: 'Fire',
    exerciseSec: null,
    severity: 3,
    sourceId: 'src_a',
    sourceName: 'UAS 1',
    sourceKind: 'drone',
    lat: 50.3918,
    lon: 7.5996,
    videoId: 'v1',
    frameNumber: 1,
    frameUrl: 'media/v1/frames/0000001.jpg',
    box: null,
    confidence: 0.9,
    score: 0.14,
    firstSeen: 1_000_000,
    lastSeen: 1_000_000,
    frames: 2,
    active: true,
    status: 'new',
    reviewedBy: null,
    incidentId: null,
    exercise: false,
    group: 'fire',
    secondOpinion: null,
    ...overrides,
  };
}

async function incidents(): Promise<Incidents> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sicht-incidents-'));
  await fs.writeFile(
    path.join(dir, 'places.json'),
    JSON.stringify([
      { name: 'Koblenz', lat: 50.3569, lon: 7.589, rank: 1 },
      { name: 'Koblenz-Wallersheim', lat: 50.385, lon: 7.605, rank: 4 },
    ]),
  );
  const store = new Incidents(path.join(dir, 'incidents.json'), path.join(dir, 'places.json'), new EventHub());
  await store.open();
  return store;
}

test('two sources reporting the same kind of event nearby form one corroborated incident', async () => {
  const store = await incidents();
  const first = store.attach(alert({}));
  const second = store.attach(alert({ sourceId: 'src_b', sourceName: 'Erkunder 3', lat: 50.3871, lon: 7.6042, firstSeen: 1_060_000, lastSeen: 1_060_000 }));
  assert.ok(first && second);
  assert.equal(second.id, first.id);
  assert.equal(second.corroboration, 2);
  assert.equal(second.alertIds.length, 2);
  assert.equal(second.place, 'Koblenz-Wallersheim');
  assert.match(second.mgrs, /^32U [A-Z]{2} \d{4} \d{4}$/);
});

test('a different kind of event at the same place is a separate incident', async () => {
  const store = await incidents();
  const fire = store.attach(alert({}));
  const flood = store.attach(alert({ watchId: 'wa_flood', watchName: 'Überflutung', group: 'flood', sourceId: 'src_b' }));
  assert.ok(fire && flood);
  assert.notEqual(flood.id, fire.id);
  assert.equal(store.list().length, 2);
});

test('distance, time and exercise context keep incidents apart', async () => {
  const store = await incidents();
  const base = store.attach(alert({}));
  const far = store.attach(alert({ sourceId: 'src_c', lat: 50.3412, lon: 7.5529 }));
  const late = store.attach(alert({ sourceId: 'src_d', firstSeen: 1_000_000 + 45 * 60_000, lastSeen: 1_000_000 + 45 * 60_000 }));
  const drill = store.attach(alert({ sourceId: 'src_e', exercise: true }));
  assert.ok(base && far && late && drill);
  assert.equal(new Set([base.id, far.id, late.id, drill.id]).size, 4);
  store.clearExercise();
  assert.equal(store.list().some((i) => i.exercise), false);
  assert.equal(store.list().length, 3);
});

test('an alert without a position cannot be placed', async () => {
  const store = await incidents();
  assert.equal(store.attach(alert({ lat: null, lon: null })), null);
});
