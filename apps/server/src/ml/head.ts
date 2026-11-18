import fs from 'node:fs/promises';
import type { HazardModelCard } from '../types.js';

/**
 * Linear classification heads on top of the frozen image encoder.
 *
 * `HazardHead` is trained offline on a public aerial disaster benchmark (see
 * scripts/hazard/trainHead.ts) and shipped as a small JSON file. `BinaryHead` is trained at run
 * time from analyst feedback on one watch. Both are plain logistic models: fast, inspectable,
 * and reproducible from their training data.
 */

interface HazardHeadFile {
  version: 1;
  encoder: string;
  dim: number;
  classes: string[];
  /** base64 of Float32 weights, classes x dim, row-major. */
  weights: string;
  bias: number[];
  /** Logit scale applied to the unit-norm embedding. */
  scale: number;
  card: HazardModelCard;
}

export class HazardHead {
  private constructor(
    readonly encoder: string,
    readonly dim: number,
    readonly classes: string[],
    private readonly weights: Float32Array,
    private readonly bias: Float32Array,
    private readonly scale: number,
    readonly card: HazardModelCard,
  ) {}

  static async load(file: string): Promise<HazardHead | null> {
    let parsed: HazardHeadFile;
    try {
      parsed = JSON.parse(await fs.readFile(file, 'utf8')) as HazardHeadFile;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    const bytes = Buffer.from(parsed.weights, 'base64');
    const weights = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    if (parsed.version !== 1 || weights.length !== parsed.classes.length * parsed.dim) {
      throw new Error(`Hazard head ${file} is inconsistent`);
    }
    return new HazardHead(parsed.encoder, parsed.dim, parsed.classes, weights, Float32Array.from(parsed.bias), parsed.scale, parsed.card);
  }

  classIndex(name: string): number {
    return this.classes.indexOf(name);
  }

  /** Softmax probabilities for one embedding at `offset` in `data`. */
  classify(data: Float32Array, offset: number): Float32Array {
    const k = this.classes.length;
    const logits = new Float32Array(k);
    let max = -Infinity;
    for (let c = 0; c < k; c++) {
      let z = this.bias[c] as number;
      const w = c * this.dim;
      for (let i = 0; i < this.dim; i++) z += (this.weights[w + i] as number) * (data[offset + i] as number) * this.scale;
      logits[c] = z;
      if (z > max) max = z;
    }
    let sum = 0;
    for (let c = 0; c < k; c++) {
      logits[c] = Math.exp((logits[c] as number) - max);
      sum += logits[c] as number;
    }
    for (let c = 0; c < k; c++) logits[c] = (logits[c] as number) / sum;
    return logits;
  }
}

export interface BinaryHeadState {
  dim: number;
  /** base64 of Float32 weights. */
  weights: string;
  bias: number;
  examples: number;
}

/** Logistic regression trained by batch gradient descent on unit-norm embeddings. */
export class BinaryHead {
  private static readonly SCALE = 20;

  constructor(
    readonly weights: Float32Array,
    readonly bias: number,
    readonly examples: number,
  ) {}

  static train(features: readonly Float32Array[], labels: readonly number[], sampleWeights?: readonly number[]): BinaryHead {
    const n = features.length;
    const dim = features[0]?.length ?? 0;
    const w = new Float32Array(dim);
    let b = 0;
    const lr = 0.4;
    const l2 = 0.01;
    let weightSum = 0;
    for (let i = 0; i < n; i++) weightSum += sampleWeights?.[i] ?? 1;
    for (let iter = 0; iter < 300; iter++) {
      const grad = new Float32Array(dim);
      let gradB = 0;
      for (let i = 0; i < n; i++) {
        const x = features[i] as Float32Array;
        let z = b;
        for (let j = 0; j < dim; j++) z += (w[j] as number) * (x[j] as number) * BinaryHead.SCALE;
        const p = 1 / (1 + Math.exp(-z));
        const err = (p - (labels[i] as number)) * (sampleWeights?.[i] ?? 1);
        gradB += err;
        for (let j = 0; j < dim; j++) grad[j] = (grad[j] as number) + err * (x[j] as number) * BinaryHead.SCALE;
      }
      b -= (lr * gradB) / weightSum;
      for (let j = 0; j < dim; j++) w[j] = (w[j] as number) - lr * ((grad[j] as number) / weightSum + l2 * (w[j] as number));
    }
    return new BinaryHead(w, b, n);
  }

  predict(data: Float32Array, offset: number): number {
    let z = this.bias;
    for (let j = 0; j < this.weights.length; j++) z += (this.weights[j] as number) * (data[offset + j] as number) * BinaryHead.SCALE;
    return 1 / (1 + Math.exp(-z));
  }

  toJSON(): BinaryHeadState {
    return {
      dim: this.weights.length,
      weights: Buffer.from(this.weights.buffer, this.weights.byteOffset, this.weights.byteLength).toString('base64'),
      bias: this.bias,
      examples: this.examples,
    };
  }

  static fromJSON(state: BinaryHeadState): BinaryHead {
    const bytes = Buffer.from(state.weights, 'base64');
    const weights = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    return new BinaryHead(weights, state.bias, state.examples);
  }
}
