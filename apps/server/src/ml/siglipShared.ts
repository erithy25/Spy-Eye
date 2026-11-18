/**
 * What the embedding model's main-thread side (model.ts) and its inference thread
 * (siglipService.ts) share: the types of the thread's calls and the self-test on synthetic inputs.
 * Imports nothing heavy, so that the main thread never loads onnxruntime or transformers.js.
 */
import type { ModelDtype } from '../config.js';

export type ModelFamily = 'siglip' | 'siglip2' | 'clip' | 'mobileclip';

export function detectFamily(modelId: string): ModelFamily {
  if (/siglip2/i.test(modelId)) return 'siglip2';
  if (/siglip/i.test(modelId)) return 'siglip';
  if (/mobileclip/i.test(modelId)) return 'mobileclip';
  return 'clip';
}

/** Everything the inference thread needs to load the model; read from config.ts by model.ts. */
export interface SiglipOptions {
  modelId: string;
  family: ModelFamily;
  dtype: ModelDtype;
  textDtype: ModelDtype;
  /** Execution providers in the order they are tried (deviceCandidates in model.ts). */
  devices: string[];
  threads: number;
  cacheDir: string;
  offline: boolean;
}

/** What loading found out: the provider in use and the model's input and output sizes. */
export interface SiglipInfo {
  device: string;
  notice: string;
  dim: number;
  imageSize: number;
  imageMean: [number, number, number];
  imageStd: [number, number, number];
}

/** Notices of the thread while it loads. */
export type SiglipEvent =
  | { kind: 'download'; file: string; loaded: number; total: number }
  | { kind: 'state'; message: string; progress: number | null };

export interface Probe {
  images: Float32Array;
  texts: Float32Array;
  dim: number;
}

export type SiglipOps = {
  /** `count` preprocessed images (CHW) → L2-normalised rows. */
  vision: { args: { pixels: Float32Array; count: number }; result: Float32Array };
  /** Texts → L2-normalised rows. */
  text: { args: { texts: string[] }; result: Float32Array };
  /** The self-test inputs through the active provider (diagnose). */
  probe: { args: null; result: Probe & { device: string } };
};

/** Three synthetic pictures that any working vision tower must map to clearly different vectors. */
export const PROBE_IMAGES: readonly ((x: number, y: number) => [number, number, number])[] = [
  // red disc on white
  (x, y) => ((x - 0.5) ** 2 + (y - 0.5) ** 2 < 0.09 ? [0.86, 0.08, 0.1] : [1, 1, 1]),
  // blue and yellow vertical stripes
  (x) => (Math.floor(x * 8) % 2 === 0 ? [0.1, 0.2, 0.85] : [0.98, 0.85, 0.1]),
  // black and white checkerboard
  (x, y) => ((Math.floor(x * 6) + Math.floor(y * 6)) % 2 === 0 ? [0.03, 0.03, 0.03] : [0.97, 0.97, 0.97]),
];
export const PROBE_TEXTS = [
  'a red circle on a white background',
  'blue and yellow vertical stripes',
  'a black and white checkerboard',
] as const;

export function cosineRows(a: Float32Array, i: number, b: Float32Array, j: number, dim: number): number {
  let dot = 0;
  for (let k = 0; k < dim; k++) dot += (a[i * dim + k] as number) * (b[j * dim + k] as number);
  return dot;
}

/** Throws when an encoder returned NaN/Infinity or an all-zero row. */
export function assertUsable(data: Float32Array, rows: number, what: string): void {
  const dim = data.length / rows;
  if (rows <= 0 || !Number.isInteger(dim) || dim <= 0) throw new Error(`${what}: leere Ausgabe.`);
  for (let r = 0; r < rows; r++) {
    let sum = 0;
    for (let i = 0; i < dim; i++) {
      const v = data[r * dim + i] as number;
      sum += v * v;
    }
    if (!Number.isFinite(sum) || sum < 1e-12) {
      throw new Error(`${what} liefert ungültige Werte (NaN oder Nullvektor).`);
    }
  }
}

/** A provider that maps different inputs to (nearly) the same vector is broken. */
export function checkProbe(probe: Probe): void {
  const n = PROBE_IMAGES.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (cosineRows(probe.images, i, probe.images, j, probe.dim) > 0.985) {
        throw new Error('Bild-Encoder liefert für verschiedene Bilder denselben Vektor');
      }
      if (cosineRows(probe.texts, i, probe.texts, j, probe.dim) > 0.985) {
        throw new Error('Text-Encoder liefert für verschiedene Texte denselben Vektor');
      }
    }
  }
}

/** The accelerated provider must reproduce the CPU result. */
export function compareProbes(candidate: Probe, cpu: Probe, device: string): void {
  if (candidate.dim !== cpu.dim) throw new Error(`${device}: andere Vektorgröße als CPU`);
  for (let i = 0; i < PROBE_IMAGES.length; i++) {
    const image = cosineRows(candidate.images, i, cpu.images, i, cpu.dim);
    const text = cosineRows(candidate.texts, i, cpu.texts, i, cpu.dim);
    if (image < 0.98 || text < 0.98) {
      throw new Error(`weicht vom CPU-Ergebnis ab (Bild ${image.toFixed(3)}, Text ${text.toFixed(3)})`);
    }
  }
}

/** How well the probe captions pick their own picture (0..3); a plausibility figure for diagnostics. */
export function probeAgreement(probe: { images: Float32Array; texts: Float32Array; dim: number }): number {
  let correct = 0;
  for (let i = 0; i < PROBE_IMAGES.length; i++) {
    let best = 0;
    for (let j = 1; j < PROBE_TEXTS.length; j++) {
      if (cosineRows(probe.images, i, probe.texts, j, probe.dim) > cosineRows(probe.images, i, probe.texts, best, probe.dim)) {
        best = j;
      }
    }
    if (best === i) correct++;
  }
  return correct;
}
