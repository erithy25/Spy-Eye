import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const tool = path.join(repo, 'tools', 'stueckliste', 'build.mjs');

test('the bill of materials matches the lock file', () => {
  const output = execFileSync(process.execPath, [tool, '--check'], { cwd: repo, encoding: 'utf8' });
  assert.match(output, /Stückliste passt zur Sperrdatei: \d+ Pakete/);
});

test('the bill of materials names every shipped part with a licence', () => {
  const bom = JSON.parse(readFileSync(path.join(repo, 'docs', 'stueckliste', 'sicht.cdx.json'), 'utf8')) as {
    bomFormat: string;
    specVersion: string;
    components: { type: string; name: string; purl?: string; licenses?: unknown[]; hashes?: { alg: string; content: string }[] }[];
  };
  assert.equal(bom.bomFormat, 'CycloneDX');
  assert.equal(bom.specVersion, '1.5');
  const libraries = bom.components.filter((component) => component.type === 'library');
  assert.ok(libraries.length > 100);
  for (const component of bom.components) {
    assert.ok(Array.isArray(component.licenses) && component.licenses.length === 1, `${component.name} has no licence entry`);
    assert.doesNotMatch(JSON.stringify(component.licenses), /unbekannt/, `${component.name} has an unknown licence`);
  }
  for (const library of libraries) {
    assert.match(library.purl ?? '', /^pkg:npm\//);
    assert.ok(library.hashes?.[0]?.alg === 'SHA-512' && /^[0-9a-f]{128}$/.test(library.hashes[0].content), `${library.name} has no checksum`);
  }
  for (const name of ['fastify', 'onnxruntime-node', 'sharp', 'react', '@img/sharp-win32-x64']) {
    assert.ok(libraries.some((library) => library.name === name), `${name} is missing`);
  }
  for (const copyleft of ['GPL-2.0', 'GPL-3.0', 'AGPL']) {
    assert.ok(!bom.components.some((component) => new RegExp(`(^|[^L])${copyleft}`).test(JSON.stringify(component.licenses))), `${copyleft} appears`);
  }
});
