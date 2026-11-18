/**
 * Trains the hazard head: a softmax classifier on frozen image embeddings.
 *
 *   tsx src/scripts/hazard/trainHead.ts <embeddingsDir> <outFile>
 *
 * Input is the output of embedDataset.ts (train/val/test splits). Hyper-parameters are chosen
 * on the validation split; the reported figures are from the test split, which is touched once.
 * A zero-shot baseline (class captions scored by the text encoder) is measured on the same test
 * images so the gain of training is visible.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { EmbeddingModel } from '../../ml/model.js';
import type { HazardModelCard } from '../../types.js';

const [embDir, outFile] = process.argv.slice(2);
if (!embDir || !outFile) {
  process.stderr.write('usage: trainHead.ts <embeddingsDir> <outFile>\n');
  process.exit(2);
}
const embeddingsDir: string = embDir;

interface Index {
  modelId: string;
  dim: number;
  classes: string[];
  splits: Record<string, { labels: number[]; files: string[] }>;
}

/** Dataset class name -> key used by the product, and the caption for the zero-shot baseline. */
const CLASS_MAP: Record<string, { key: string; caption: string }> = {
  Earthquake: { key: 'collapse', caption: 'an aerial photo of collapsed buildings and rubble after an earthquake' },
  Fire: { key: 'fire', caption: 'an aerial photo of a fire with flames and smoke' },
  Flood: { key: 'flood', caption: 'an aerial photo of a flooded area with water covering streets and houses' },
  Normal: { key: 'normal', caption: 'an aerial photo of an ordinary area with no disaster' },
};

const index = JSON.parse(await fs.readFile(path.join(embeddingsDir, 'index.json'), 'utf8')) as Index;
const dim = index.dim;
const K = index.classes.length;

async function loadSplit(name: string): Promise<{ x: Float32Array; y: number[]; n: number }> {
  const buf = await fs.readFile(path.join(embeddingsDir, `${name}.f32`));
  const x = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const y = index.splits[name]?.labels ?? [];
  if (x.length !== y.length * dim) throw new Error(`Split ${name}: ${x.length} values for ${y.length} labels`);
  return { x, y, n: y.length };
}

const train = await loadSplit('train');
const val = await loadSplit('val');
const test = await loadSplit('test');

interface Head {
  w: Float32Array;
  b: Float32Array;
  scale: number;
}

function logits(head: Head, x: Float32Array, row: number, out: Float32Array): void {
  for (let c = 0; c < K; c++) {
    let z = head.b[c] as number;
    const wo = c * dim;
    const xo = row * dim;
    for (let i = 0; i < dim; i++) z += (head.w[wo + i] as number) * (x[xo + i] as number) * head.scale;
    out[c] = z;
  }
}

function predict(head: Head, x: Float32Array, n: number): number[] {
  const out = new Float32Array(K);
  const preds: number[] = [];
  for (let r = 0; r < n; r++) {
    logits(head, x, r, out);
    let best = 0;
    for (let c = 1; c < K; c++) if ((out[c] as number) > (out[best] as number)) best = c;
    preds.push(best);
  }
  return preds;
}

/** Mini-batch gradient descent with momentum and class-balanced loss weights. */
function fit(scale: number, l2: number, epochs: number): Head {
  const head: Head = { w: new Float32Array(K * dim), b: new Float32Array(K), scale };
  const vw = new Float32Array(K * dim);
  const vb = new Float32Array(K);
  const counts = new Array<number>(K).fill(0);
  for (const y of train.y) counts[y] = (counts[y] as number) + 1;
  const classWeight = counts.map((c) => train.n / (K * c));
  const order = Array.from({ length: train.n }, (_, i) => i);
  let seed = 20261118;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const BATCH = 256;
  const out = new Float32Array(K);
  for (let epoch = 0; epoch < epochs; epoch++) {
    for (let i = train.n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j] as number, order[i] as number];
    }
    const lr = 0.5 * 0.5 * (1 + Math.cos((Math.PI * epoch) / epochs));
    for (let start = 0; start < train.n; start += BATCH) {
      const end = Math.min(train.n, start + BATCH);
      const gw = new Float32Array(K * dim);
      const gb = new Float32Array(K);
      let weightSum = 0;
      for (let k = start; k < end; k++) {
        const r = order[k] as number;
        const y = train.y[r] as number;
        logits(head, train.x, r, out);
        let max = -Infinity;
        for (let c = 0; c < K; c++) if ((out[c] as number) > max) max = out[c] as number;
        let sum = 0;
        for (let c = 0; c < K; c++) {
          out[c] = Math.exp((out[c] as number) - max);
          sum += out[c] as number;
        }
        const cw = classWeight[y] as number;
        weightSum += cw;
        for (let c = 0; c < K; c++) {
          const err = ((out[c] as number) / sum - (c === y ? 1 : 0)) * cw;
          gb[c] = (gb[c] as number) + err;
          const wo = c * dim;
          const xo = r * dim;
          const e = err * scale;
          for (let i = 0; i < dim; i++) gw[wo + i] = (gw[wo + i] as number) + e * (train.x[xo + i] as number);
        }
      }
      for (let i = 0; i < K * dim; i++) {
        vw[i] = 0.9 * (vw[i] as number) - lr * ((gw[i] as number) / weightSum + l2 * (head.w[i] as number));
        head.w[i] = (head.w[i] as number) + (vw[i] as number);
      }
      for (let c = 0; c < K; c++) {
        vb[c] = 0.9 * (vb[c] as number) - (lr * (gb[c] as number)) / weightSum;
        head.b[c] = (head.b[c] as number) + (vb[c] as number);
      }
    }
  }
  return head;
}

interface Report {
  accuracy: number;
  macroF1: number;
  perClass: { name: string; precision: number; recall: number; f1: number; support: number }[];
  confusion: number[][];
}

function evaluate(preds: number[], labels: number[]): Report {
  const confusion = Array.from({ length: K }, () => new Array<number>(K).fill(0));
  preds.forEach((p, i) => {
    const row = confusion[labels[i] as number] as number[];
    row[p] = (row[p] as number) + 1;
  });
  let correct = 0;
  const perClass = index.classes.map((name, c) => {
    const tp = (confusion[c] as number[])[c] as number;
    correct += tp;
    const support = (confusion[c] as number[]).reduce((a, v) => a + v, 0);
    const predicted = confusion.reduce((a, row) => a + (row[c] as number), 0);
    const precision = predicted > 0 ? tp / predicted : 0;
    const recall = support > 0 ? tp / support : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    return { name: CLASS_MAP[name]?.key ?? name, precision, recall, f1, support };
  });
  return {
    accuracy: correct / preds.length,
    macroF1: perClass.reduce((a, c) => a + c.f1, 0) / K,
    perClass,
    confusion,
  };
}

const round = (v: number): number => Math.round(v * 10000) / 10000;

// ---- model selection on the validation split
let best: { head: Head; scale: number; l2: number; valF1: number } | null = null;
for (const scale of [10, 20, 40]) {
  for (const l2 of [1e-5, 1e-4, 1e-3]) {
    const head = fit(scale, l2, 30);
    const report = evaluate(predict(head, val.x, val.n), val.y);
    process.stdout.write(`scale ${scale} l2 ${l2}: val accuracy ${report.accuracy.toFixed(4)} macro-F1 ${report.macroF1.toFixed(4)}\n`);
    if (!best || report.macroF1 > best.valF1) best = { head, scale, l2, valF1: report.macroF1 };
  }
}
if (!best) throw new Error('no model trained');
process.stdout.write(`selected scale ${best.scale}, l2 ${best.l2} (val macro-F1 ${best.valF1.toFixed(4)})\n`);

// ---- zero-shot baseline with the text encoder
const model = new EmbeddingModel();
await model.load();
if (model.dim !== dim) throw new Error(`Encoder dim ${model.dim} does not match embeddings (${dim})`);
const captions = await model.embedTexts(index.classes.map((c) => CLASS_MAP[c]?.caption ?? c));
const zeroShotPreds: number[] = [];
for (let r = 0; r < test.n; r++) {
  let bestC = 0;
  let bestS = -Infinity;
  for (let c = 0; c < K; c++) {
    let s = 0;
    for (let i = 0; i < dim; i++) s += (test.x[r * dim + i] as number) * (captions[c * dim + i] as number);
    if (s > bestS) {
      bestS = s;
      bestC = c;
    }
  }
  zeroShotPreds.push(bestC);
}
const zeroShot = evaluate(zeroShotPreds, test.y);

// ---- final figures on the held-out test split
const final = evaluate(predict(best.head, test.x, test.n), test.y);
process.stdout.write(`\nTEST  trained head: accuracy ${final.accuracy.toFixed(4)}, macro-F1 ${final.macroF1.toFixed(4)}\n`);
process.stdout.write(`TEST  zero-shot:    accuracy ${zeroShot.accuracy.toFixed(4)}, macro-F1 ${zeroShot.macroF1.toFixed(4)}\n`);
for (const c of final.perClass) {
  process.stdout.write(`  ${c.name.padEnd(9)} precision ${c.precision.toFixed(3)} recall ${c.recall.toFixed(3)} f1 ${c.f1.toFixed(3)} (n=${c.support})\n`);
}
process.stdout.write(`confusion (rows = truth): ${JSON.stringify(final.confusion)}\n`);

const card: HazardModelCard = {
  name: 'Sicht Hazard Head',
  version: '0.1',
  trainedOn: 'AIDERv2 (Shianios, Kyrkou, Kolios 2023), aerial images, train split',
  license: 'Training data CC BY 4.0 (zenodo.org/records/10891054)',
  classes: index.classes.map((c) => CLASS_MAP[c]?.key ?? c),
  trainImages: train.n,
  testImages: test.n,
  accuracy: round(final.accuracy),
  macroF1: round(final.macroF1),
  zeroShotAccuracy: round(zeroShot.accuracy),
  zeroShotMacroF1: round(zeroShot.macroF1),
  perClass: final.perClass.map((c) => ({ ...c, precision: round(c.precision), recall: round(c.recall), f1: round(c.f1) })),
  confusion: final.confusion,
  encoder: index.modelId,
};

await fs.mkdir(path.dirname(outFile), { recursive: true });
await fs.writeFile(
  outFile,
  JSON.stringify({
    version: 1,
    encoder: index.modelId,
    dim,
    classes: card.classes,
    weights: Buffer.from(best.head.w.buffer, best.head.w.byteOffset, best.head.w.byteLength).toString('base64'),
    bias: Array.from(best.head.b),
    scale: best.scale,
    card,
  }),
);
process.stdout.write(`written ${outFile}\n`);
process.exit(0);
