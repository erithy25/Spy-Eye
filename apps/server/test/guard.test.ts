import assert from 'node:assert/strict';
import { test } from 'node:test';
import { screenPrompt } from '../src/intel/guard.js';

const allowed = [
  'man with a cup', 'black car', 'green bus', 'people on a roof', 'submerged car', 'a child alone near water',
  'person in a wheelchair', 'firefighters with a ladder', 'smoke over a building', 'a white van parked on a bridge',
  'crowd on a train platform', 'a person lying on the ground', 'max water level at the bridge', 'a mark on the wall',
  'rose garden', 'a man in a yellow vest', 'an elderly person with a walking frame', 'collapsed building', 'police car',
  'the ben nevis mountain', 'a white truck', 'black smoke', 'a christmas tree', 'roman bridge', 'an asian restaurant sign',
  'race car', 'a robin on a branch', 'frank view of the valley',
];

const refused: [string, string][] = [
  ['angela merkel', 'named-person'], ['find peter', 'named-person'], ['Herr Schmidt', 'named-person'],
  ['Donald Trump', 'named-person'], ['Wolfgang', 'named-person'],
  ['who is the man in the red jacket', 'identification'], ['identify the driver', 'identification'],
  ['license plate number of the van', 'licence-plate'], ['face recognition of suspect', 'identification'],
  ['wer ist die Frau', 'identification'],
  ['muslim woman', 'protected-attribute'], ['a black man running', 'protected-attribute'],
  ['people wearing a hijab', 'protected-attribute'], ['refugees at the station', 'protected-attribute'],
  ['gay couple', 'protected-attribute'], ['südländischer mann', 'protected-attribute'],
  ['Muslims praying', 'protected-attribute'], ['ausländische männer', 'protected-attribute'],
  ['two arab men', 'protected-attribute'],
  ['a woman with red hair', 'identifying-feature'], ['man with a tattoo on his arm', 'identifying-feature'],
  ['bearded man', 'identifying-feature'], ['a blonde girl', 'identifying-feature'],
];

test('descriptive prompts pass the guard', () => {
  for (const prompt of allowed) {
    const verdict = screenPrompt(prompt);
    assert.equal(verdict.allowed, true, `"${prompt}" was refused by rule ${verdict.rule}`);
  }
});

test('identity and protected-attribute prompts are refused with the right rule', () => {
  for (const [prompt, rule] of refused) {
    const verdict = screenPrompt(prompt);
    assert.equal(verdict.allowed, false, `"${prompt}" was allowed`);
    assert.equal(verdict.rule, rule, `"${prompt}" fired ${verdict.rule}, expected ${rule}`);
    assert.ok(verdict.reason && verdict.reasonEn);
  }
});

test('descriptions by sex or age are flagged, and refused where the mandate forbids them', () => {
  const lenient = screenPrompt('a child alone near water');
  assert.equal(lenient.allowed, true);
  assert.deepEqual(lenient.flags, ['person-description']);
  const strict = screenPrompt('a child alone near water', { personDescriptions: false });
  assert.equal(strict.allowed, false);
  assert.equal(strict.rule, 'person-description');
  assert.equal(screenPrompt('a person lying on the ground', { personDescriptions: false }).allowed, true);
  assert.deepEqual(screenPrompt('people on a roof').flags, []);
});

test('bodily features of animals and objects are not refused', () => {
  for (const prompt of ['a dog with long hair', 'a scar in the hillside', 'hair salon sign']) {
    assert.equal(screenPrompt(prompt).allowed, true, prompt);
  }
});

test('licence plates are never searched, however the request is worded', () => {
  for (const prompt of [
    'license plate KO AB 123', 'nummernschild des lieferwagens', 'Kennzeichen KO-AB 123', 'the car with number plate M XY 4711',
    'white van KO AB 123', 'registration number of the truck',
  ]) {
    const verdict = screenPrompt(prompt);
    assert.equal(verdict.allowed, false, prompt);
    assert.equal(verdict.rule, 'licence-plate', prompt);
  }
  // Road numbers and unit designations are not registrations.
  for (const prompt of ['accident on the B 9', 'UAS 3 over the A 48', 'flooded underpass near the K 12']) {
    assert.equal(screenPrompt(prompt).allowed, true, prompt);
  }
});

test('faces, re-identification and tracking are refused in German and English', () => {
  for (const prompt of [
    'gesicht von herrn müller', 'finde diese person wieder', 'the face of the driver', 'find this person again',
    'the same man as before', 'verfolge den radfahrer', 'bewegungsprofil der person', 'where is she now', 'gesichter der zuschauer',
    'erkenne die person am eingang', 'identität des fahrers',
  ]) {
    const verdict = screenPrompt(prompt);
    assert.equal(verdict.allowed, false, prompt);
    assert.equal(verdict.rule, 'identification', prompt);
  }
});

test('forms of address only count as names when a name follows', () => {
  assert.equal(screenPrompt('Frau Müller').rule, 'named-person');
  assert.equal(screenPrompt('Herrn Schmidt am Ufer').rule, 'named-person');
  assert.equal(screenPrompt('Familie Becker').rule, 'named-person');
  // "Frau mit …" describes a person and is governed by the mandate, not by the name rule.
  assert.deepEqual(screenPrompt('eine Frau mit Kinderwagen').flags, ['person-description']);
  assert.equal(screenPrompt('eine Frau mit Kinderwagen').allowed, true);
});

test('clothing descriptions of persons depend on the mandate', () => {
  const open = screenPrompt('person in a red jacket', { personDescriptions: true });
  assert.equal(open.allowed, true);
  assert.deepEqual(open.flags, ['person-description']);
  const strict = screenPrompt('person in a red jacket', { personDescriptions: false });
  assert.equal(strict.allowed, false);
  assert.equal(strict.rule, 'person-description');
  // Clothing without a person, and responders by role, stay ordinary scene descriptions.
  assert.deepEqual(screenPrompt('a yellow jacket lying on the river bank', { personDescriptions: false }).flags, []);
  assert.equal(screenPrompt('firefighters wearing breathing apparatus', { personDescriptions: false }).allowed, true);
});

test('origin and looks of persons are refused whatever the mandate allows', () => {
  const refused = [
    'a southern-looking man', 'Mediterranean-looking man', 'a man of Middle Eastern appearance', 'eastern european men',
    'a turkish man', 'türkischer Mann', 'arabisch aussehender Mann', 'syrische Familie', 'osteuropäische Männer',
    'ein Mann mit ausländischem Aussehen', 'afrikanische Frau', 'asiatisch aussehende Person', 'person of colour',
    'a north african youth', 'rumänische Jugendliche', 'ein Schwarzer', 'schwarzer Mann', 'dunkelhäutige Frau',
    'orientalisch aussehender Mann', 'people who look foreign', 'nordafrikanisch aussehende Männer',
    'Mann mit Migrationshintergrund', 'zwei Farbige am Bahnhof', 'a group of asian tourists and a white man',
  ];
  for (const query of refused) {
    const verdict = screenPrompt(query, { personDescriptions: true });
    assert.equal(verdict.allowed, false, query);
    assert.equal(verdict.rule, 'protected-attribute', query);
  }
});

test('the same words stay usable for things, places and clothing', () => {
  const things = [
    'german shepherd', 'chinese restaurant', 'schwarzer Rauch', 'weißer Lieferwagen', 'türkisches Restaurant',
    'ein schwarzes Auto', 'asian food market', 'russian tank', 'polnischer Lastwagen', 'a modern-looking building',
    'a sign on a black background', 'white smoke over a roof', 'black and white image', 'eine schwarze Katze',
    'Deutsche Bahn Zug am Bahnsteig', 'southern bank of the river', 'eastern entrance of the tunnel',
  ];
  for (const query of things) assert.equal(screenPrompt(query, { personDescriptions: false }).allowed, true, query);
  // Clothing is a description of a person: a matter for the mandate, not a protected attribute.
  for (const query of ['schwarz gekleidete Person', 'a man in a black jacket', 'person in white dress']) {
    assert.equal(screenPrompt(query, { personDescriptions: true }).allowed, true, query);
    const strict = screenPrompt(query, { personDescriptions: false });
    assert.equal(strict.allowed, false, query);
    assert.equal(strict.rule, 'person-description', query);
  }
});
