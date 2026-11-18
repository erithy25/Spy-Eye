/**
 * Writes the gallery vectors that ship with the dataset (datasets/datum/gallery-vectors-<model>.*)
 * from the vector cache of this machine (.cache/datum), so that a fresh machine starts without
 * embedding the reference pictures. Run after the gallery changed and the node (or
 * `pnpm datum:prepare`) has embedded it:
 *
 *   tsx src/scripts/datum/shipGallery.ts
 *
 * Only rows of pictures that gallery.json still lists are shipped, in the order of gallery.json.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, repoRoot } from '../../config.js';
import { defaultDatasetDir, modelSlug } from '../../datum/gallery.js';
import { writeSeed } from '../../datum/gallerySeed.js';

interface CacheIndex {
  version: number;
  modelId: string;
  dim: number;
  ids: string[];
  sources: string[];
}

const modelId = config.modelId;
const cacheBase = path.join(repoRoot, '.cache', 'datum', `gallery-${modelSlug(modelId)}`);
const datasetDir = defaultDatasetDir();

const index = JSON.parse(await fs.readFile(`${cacheBase}.json`, 'utf8')) as CacheIndex;
if (index.version !== 1 || index.modelId !== modelId) {
  throw new Error(`Der Vektor-Cache gehört zu ${index.modelId}, eingestellt ist ${modelId}.`);
}
const buf = await fs.readFile(`${cacheBase}.bin`);
const dim = index.dim;
if (buf.byteLength !== index.ids.length * dim * 4) throw new Error('Der Vektor-Cache ist unvollständig.');
const all = new Float32Array(index.ids.length * dim);
new Uint8Array(all.buffer).set(buf);
const row = new Map(index.ids.map((id, i) => [id, i]));

const listed = (JSON.parse(await fs.readFile(path.join(datasetDir, 'gallery.json'), 'utf8')) as { images: { id: string }[] }).images;
const ids: string[] = [];
const sources: string[] = [];
const vectors = new Float32Array(listed.length * dim);
for (const image of listed) {
  const r = row.get(image.id);
  if (r === undefined) continue;
  vectors.set(all.subarray(r * dim, (r + 1) * dim), ids.length * dim);
  ids.push(image.id);
  sources.push(index.sources[r] ?? '');
}
const missing = listed.length - ids.length;
const written = await writeSeed(datasetDir, modelId, dim, ids, sources, vectors.subarray(0, ids.length * dim));
process.stdout.write(
  `Galerie-Vektoren: ${ids.length} von ${listed.length} Bildern, ${(written.bytes / 1e6).toFixed(1)} MB → ${path.relative(repoRoot, written.bin)}` +
    `${missing > 0 ? ` (${missing} noch nicht eingerechnet)` : ''}\n`,
);
