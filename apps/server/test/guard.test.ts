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
  ['angela merkel', 'named-person'], ['find peter', 'named-person'], ['herr schmidt', 'named-person'],
  ['Donald Trump', 'named-person'], ['Wolfgang', 'named-person'],
  ['who is the man in the red jacket', 'identification'], ['identify the driver', 'identification'],
  ['license plate number of the van', 'identification'], ['face recognition of suspect', 'identification'],
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
