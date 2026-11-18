import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { screenPrompt } from '../src/intel/guard.ts';
import { VOCABULARY, displayLabel } from '../src/ml/vocab.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

test('no scene tag describes a person by sex, age, clothing, occupation or features', () => {
  const forbidden = /\b(man|woman|men|women|boy|girl|child|children|baby|elderly|couple|face|wearing|shirt|jacket|vest|suit|uniform|hat|mask|sunglasses|officer|soldier|doctor|chef|athlete|worker|beard|hair|skin|tattoo)\b/i;
  assert.deepEqual(VOCABULARY.filter((entry) => forbidden.test(entry)), []);
});

test('no scene tag names licence plates, weapons or assemblies', () => {
  const forbidden = /\b(licen[cs]e plate|number plate|weapon|gun|rifle|knife attack|protest|demonstration|rally)\b/i;
  assert.deepEqual(VOCABULARY.filter((entry) => forbidden.test(entry)), []);
});

test('every scene tag would pass the prompt guard as a search under a mandate without person descriptions', () => {
  const refused = VOCABULARY.filter((entry) => !screenPrompt(entry, { personDescriptions: false }).allowed);
  assert.deepEqual(refused, []);
});

test('scene tags are unique, also in their displayed form', () => {
  assert.equal(new Set(VOCABULARY).size, VOCABULARY.length);
  const labels = VOCABULARY.map(displayLabel);
  assert.equal(new Set(labels).size, labels.length);
});

test('the German console has a name for every scene tag', () => {
  const source = fs.readFileSync(path.resolve(here, '..', '..', 'web', 'src', 'tags.ts'), 'utf8');
  const keys = new Set<string>();
  for (const match of source.matchAll(/(?:^|[\s,{])(?:'([^']+)'|([A-Za-z]+)):\s*'/gm)) keys.add((match[1] ?? match[2]) as string);
  assert.deepEqual(VOCABULARY.map(displayLabel).filter((label) => !keys.has(label)), []);
});

test('the centring vector shipped for the default encoder is complete', () => {
  const file = path.resolve(here, '..', 'assets', 'text-centre.siglip2-base-patch32-256-onnx.json');
  const asset = JSON.parse(fs.readFileSync(file, 'utf8')) as { encoder: string; captions: string[]; mean: number[] };
  assert.equal(asset.encoder, 'onnx-community/siglip2-base-patch32-256-ONNX');
  assert.equal(asset.mean.length, 768);
  assert.ok(asset.captions.length >= 300);
  assert.ok(asset.mean.every((v) => Number.isFinite(v)));
  const norm = Math.sqrt(asset.mean.reduce((sum, v) => sum + v * v, 0));
  // Text embeddings share a large common component: the mean of unit vectors stays close to unit length.
  assert.ok(norm > 0.8 && norm < 1, `norm ${norm}`);
});
