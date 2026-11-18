/**
 * Writes the vector that the search subtracts from queries (SearchCalibration.centring): the mean
 * text embedding of a fixed list of ordinary captions, for the configured encoder.
 *
 *   pnpm --filter @sicht/server centre:build [--from-vocabulary]
 *
 * The list of captions is stored in the asset itself, so the vector can be reproduced, and it is
 * fixed on purpose: the cut-offs of the search were fitted with this vector. A different list
 * means fitting and measuring again (pnpm search:evaluate). `--from-vocabulary` starts a new
 * asset from the tag vocabulary when none exists for the encoder.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { EmbeddingModel, meanRow } from '../ml/model.js';
import { VOCABULARY } from '../ml/vocab.js';
import { textCentreFile, type TextCentreAsset } from '../ml/centre.js';

const file = textCentreFile();
let captions: string[];
try {
  captions = (JSON.parse(await fs.readFile(file, 'utf8')) as TextCentreAsset).captions;
} catch {
  if (!process.argv.includes('--from-vocabulary')) {
    process.stderr.write(`${path.basename(file)} fehlt. Mit --from-vocabulary wird sie aus dem Schlagwortverzeichnis angelegt.\n`);
    process.exit(1);
  }
  captions = VOCABULARY.map((entry) => `a photo of ${entry.toLowerCase()}.`);
}

const model = new EmbeddingModel();
await model.load();
const rows = new Float32Array(captions.length * model.dim);
for (let i = 0; i < captions.length; i += 32) {
  rows.set(await model.embedTexts(captions.slice(i, i + 32)), i * model.dim);
}
const mean = meanRow(rows, model.dim);
const asset: TextCentreAsset = {
  encoder: config.modelId,
  textDtype: config.modelTextDtype,
  createdAt: new Date().toISOString().slice(0, 10),
  note: 'Mean of the L2-normalised text embeddings of the captions below. Subtracted from search queries in the share given by SEARCH_CALIBRATION.',
  captions,
  mean: Array.from(mean, (v) => Number(v.toPrecision(7))),
};
await fs.writeFile(file, `${JSON.stringify(asset)}\n`);
let norm = 0;
for (const v of mean) norm += v * v;
process.stdout.write(`${path.basename(file)}: ${captions.length} Beschreibungen, ${model.dim} Dimensionen, Betrag ${Math.sqrt(norm).toFixed(3)}\n`);
process.exit(0);
