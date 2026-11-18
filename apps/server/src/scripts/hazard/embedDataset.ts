/**
 * Embeds a folder-per-class image dataset with the configured model.
 *
 *   tsx src/scripts/hazard/embedDataset.ts <datasetRoot> <outDir>
 *
 * Expects <datasetRoot>/<split>/<Class>/<image>. Writes one Float32 matrix per split
 * (<outDir>/<split>.f32, rows L2-normalized) and <outDir>/index.json with labels and file names.
 * The output is the input of trainHead.ts; nothing here touches the product's data directory.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../../config.js';
import { EmbeddingModel } from '../../ml/model.js';

const [root, outDir] = process.argv.slice(2);
if (!root || !outDir) {
  process.stderr.write('usage: embedDataset.ts <datasetRoot> <outDir>\n');
  process.exit(2);
}

const model = new EmbeddingModel();
await model.load();
const size = model.imageSize;
const plane = 3 * size * size;
const BATCH = 16;

async function loadPixels(file: string, out: Float32Array, offset: number): Promise<void> {
  const raw = await sharp(file, { failOn: 'none' })
    .toColourspace('srgb')
    .removeAlpha()
    .resize(size, size, { fit: 'fill', kernel: 'cubic' })
    .raw()
    .toBuffer();
  const area = size * size;
  for (let c = 0; c < 3; c++) {
    const mean = model.imageMean[c] as number;
    const std = model.imageStd[c] as number;
    for (let i = 0; i < area; i++) out[offset + c * area + i] = ((raw[i * 3 + c] as number) / 255 - mean) / std;
  }
}

await fs.mkdir(outDir, { recursive: true });
const splits = (await fs.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const classes = (await fs.readdir(path.join(root, splits[0] ?? ''), { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

const index: { modelId: string; dim: number; classes: string[]; splits: Record<string, { labels: number[]; files: string[] }> } = {
  modelId: config.modelId,
  dim: model.dim,
  classes,
  splits: {},
};

for (const split of splits) {
  const items: { file: string; label: number }[] = [];
  for (const [label, cls] of classes.entries()) {
    const dir = path.join(root, split, cls);
    for (const name of (await fs.readdir(dir)).sort()) {
      if (/\.(png|jpe?g|webp)$/i.test(name)) items.push({ file: path.join(dir, name), label });
    }
  }
  const matrix = new Float32Array(items.length * model.dim);
  const started = Date.now();
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const pixels = new Float32Array(batch.length * plane);
    await Promise.all(batch.map((item, b) => loadPixels(item.file, pixels, b * plane)));
    matrix.set(await model.embedPixels(pixels, batch.length), i * model.dim);
    if ((i / BATCH) % 50 === 0) {
      const rate = (i + batch.length) / ((Date.now() - started) / 1000);
      process.stdout.write(`${split}: ${i + batch.length}/${items.length} (${rate.toFixed(1)} img/s)\n`);
    }
  }
  await fs.writeFile(path.join(outDir, `${split}.f32`), Buffer.from(matrix.buffer, matrix.byteOffset, matrix.byteLength));
  index.splits[split] = { labels: items.map((i) => i.label), files: items.map((i) => path.relative(root, i.file)) };
  process.stdout.write(`${split}: done, ${items.length} images in ${((Date.now() - started) / 1000).toFixed(0)} s\n`);
}
await fs.writeFile(path.join(outDir, 'index.json'), JSON.stringify(index));
process.stdout.write('finished\n');
process.exit(0);
