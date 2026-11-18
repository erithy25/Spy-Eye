import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  SiglipTextModel,
  SiglipVisionModel,
  Tensor,
  env,
} from '@huggingface/transformers';
import { config } from '../config.js';
import type { ModelState } from '../types.js';
import { l2normalizeRows } from './math.js';

export type ModelFamily = 'siglip' | 'siglip2' | 'clip' | 'mobileclip';

interface Towers {
  device: string;
  text: CallableModel;
  vision: CallableModel;
}

interface Probe {
  images: Float32Array;
  texts: Float32Array;
  dim: number;
}

/** Three synthetic pictures that any working vision tower must map to clearly different vectors. */
const PROBE_IMAGES: readonly ((x: number, y: number) => [number, number, number])[] = [
  // red disc on white
  (x, y) => ((x - 0.5) ** 2 + (y - 0.5) ** 2 < 0.09 ? [0.86, 0.08, 0.1] : [1, 1, 1]),
  // blue and yellow vertical stripes
  (x) => (Math.floor(x * 8) % 2 === 0 ? [0.1, 0.2, 0.85] : [0.98, 0.85, 0.1]),
  // black and white checkerboard
  (x, y) => ((Math.floor(x * 6) + Math.floor(y * 6)) % 2 === 0 ? [0.03, 0.03, 0.03] : [0.97, 0.97, 0.97]),
];
const PROBE_TEXTS = [
  'a red circle on a white background',
  'blue and yellow vertical stripes',
  'a black and white checkerboard',
] as const;

function cosineRows(a: Float32Array, i: number, b: Float32Array, j: number, dim: number): number {
  let dot = 0;
  for (let k = 0; k < dim; k++) dot += (a[i * dim + k] as number) * (b[j * dim + k] as number);
  return dot;
}

/** Throws when an encoder returned NaN/Infinity or an all-zero row. */
function assertUsable(data: Float32Array, rows: number, what: string): void {
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
function checkProbe(probe: Probe): void {
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
function compareProbes(candidate: Probe, cpu: Probe, device: string): void {
  if (candidate.dim !== cpu.dim) throw new Error(`${device}: andere Vektorgröße als CPU`);
  for (let i = 0; i < PROBE_IMAGES.length; i++) {
    const image = cosineRows(candidate.images, i, cpu.images, i, cpu.dim);
    const text = cosineRows(candidate.texts, i, cpu.texts, i, cpu.dim);
    if (image < 0.98 || text < 0.98) {
      throw new Error(`weicht vom CPU-Ergebnis ab (Bild ${image.toFixed(3)}, Text ${text.toFixed(3)})`);
    }
  }
}

async function disposeTowers(towers: Towers | null): Promise<void> {
  if (!towers) return;
  for (const model of [towers.text, towers.vision]) {
    const dispose = (model as unknown as { dispose?: () => Promise<unknown> }).dispose;
    if (typeof dispose === 'function') await dispose.call(model).catch(() => undefined);
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

type ProgressListener = (state: ModelState) => void;

interface CallableModel {
  (inputs: Record<string, unknown>): Promise<Record<string, Tensor | undefined>>;
}

interface CallableTokenizer {
  (texts: string[], options: Record<string, unknown>): Record<string, unknown>;
}

function detectFamily(modelId: string): ModelFamily {
  if (/siglip2/i.test(modelId)) return 'siglip2';
  if (/siglip/i.test(modelId)) return 'siglip';
  if (/mobileclip/i.test(modelId)) return 'mobileclip';
  return 'clip';
}

/** Preprocessing constants used when the model's processor config does not state them. */
const DEFAULT_NORMALIZATION: Readonly<
  Record<ModelFamily, { mean: [number, number, number]; std: [number, number, number] }>
> = {
  siglip: { mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5] },
  siglip2: { mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5] },
  clip: { mean: [0.48145466, 0.4578275, 0.40821073], std: [0.26862954, 0.26130258, 0.27577711] },
  // MobileCLIP only rescales pixels to 0..1.
  mobileclip: { mean: [0, 0, 0], std: [1, 1, 1] },
};

/** Devices to try in order for the configured ML_DEVICE. */
function deviceCandidates(): string[] {
  if (config.device === 'cpu') return ['cpu'];
  if (config.device !== 'auto') return [config.device, 'cpu'];
  if (process.platform === 'win32') return ['dml', 'cpu'];
  if (process.platform === 'linux' && process.arch === 'x64') return ['cuda', 'cpu'];
  return ['cpu'];
}

function asNumberTriple(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return [value[0] as number, value[1] as number, value[2] as number];
  }
  return fallback;
}

function readImageSize(cfg: Record<string, unknown>): number {
  const candidates: unknown[] = [cfg['crop_size'], cfg['size']];
  for (const c of candidates) {
    if (typeof c === 'number' && c > 0) return c;
    if (c !== null && typeof c === 'object') {
      const o = c as Record<string, unknown>;
      for (const key of ['height', 'width', 'shortest_edge']) {
        const v = o[key];
        if (typeof v === 'number' && v > 0) return v;
      }
    }
  }
  return 224;
}

/** Serializes async jobs so heavy inference never runs concurrently on the same session. */
class Mutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(job: () => Promise<T>): Promise<T> {
    const result = this.tail.then(job, job);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/**
 * Local dual-encoder (image tower + text tower) running on onnxruntime.
 * All inference happens in-process; the weights are loaded from the local cache directory.
 */
export class EmbeddingModel {
  readonly family: ModelFamily;

  /** SigLIP and SigLIP 2 share their model classes, pooled outputs and fixed text length. */
  private get sigmoidFamily(): boolean {
    return this.family === 'siglip' || this.family === 'siglip2';
  }
  private tokenizer: CallableTokenizer | null = null;
  private towers: Towers | null = null;
  private readonly visionLock = new Mutex();
  private readonly textLock = new Mutex();
  private readonly listeners = new Set<ProgressListener>();
  private readonly textCache = new Map<string, Float32Array>();
  private loadPromise: Promise<void> | null = null;

  imageSize = 224;
  imageMean: [number, number, number] = [0.5, 0.5, 0.5];
  imageStd: [number, number, number] = [0.5, 0.5, 0.5];
  dim = 0;

  state: ModelState;

  constructor() {
    this.family = detectFamily(config.modelId);
    this.state = {
      phase: 'loading',
      modelId: config.modelId,
      family: this.family,
      dim: null,
      imageSize: null,
      dtype: config.modelDtype,
      device: 'cpu',
      notice: '',
      threads: config.threads,
      progress: 0,
      message: 'Initialisiere …',
      vocabSize: 0,
    };
  }

  onState(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  updateState(patch: Partial<ModelState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  get ready(): boolean {
    return this.state.phase === 'ready';
  }

  /** Loads tokenizer and both towers. Safe to call multiple times. */
  load(): Promise<void> {
    this.loadPromise ??= this.doLoad().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.updateState({ phase: 'error', message: `Modell konnte nicht geladen werden: ${message}` });
      this.loadPromise = null;
      throw err;
    });
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    env.cacheDir = config.modelCacheDir;
    env.allowRemoteModels = !config.offline;
    env.allowLocalModels = true;

    // Aggregate download progress across files so the UI shows one bar.
    const files = new Map<string, { loaded: number; total: number }>();
    let lastEmit = 0;
    const progress_callback = (info: unknown): void => {
      if (info === null || typeof info !== 'object') return;
      const p = info as { status?: string; file?: string; loaded?: number; total?: number };
      if (p.status !== 'progress' || typeof p.file !== 'string') return;
      if (typeof p.loaded !== 'number' || typeof p.total !== 'number' || p.total <= 0) return;
      files.set(p.file, { loaded: p.loaded, total: p.total });
      const now = Date.now();
      if (now - lastEmit < 200) return;
      lastEmit = now;
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      this.updateState({
        progress: Math.min(0.99, loaded / total),
        message: `Lade Modellgewichte … ${(loaded / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`,
      });
    };

    this.updateState({ phase: 'loading', progress: 0, message: 'Lade Tokenizer …' });
    const tokenizer = await AutoTokenizer.from_pretrained(config.modelId, { progress_callback });
    this.tokenizer = tokenizer as unknown as CallableTokenizer;

    const processor = await AutoProcessor.from_pretrained(config.modelId, { progress_callback });
    const imageProcessor = (processor as unknown as { image_processor?: { config?: Record<string, unknown> } })
      .image_processor;
    const ipc = imageProcessor?.config ?? {};
    this.imageSize = readImageSize(ipc);
    const normalization = DEFAULT_NORMALIZATION[this.family];
    this.imageMean = asNumberTriple(ipc['image_mean'], normalization.mean);
    this.imageStd = asNumberTriple(ipc['image_std'], normalization.std);

    const TextModel = this.sigmoidFamily ? SiglipTextModel : CLIPTextModelWithProjection;
    const VisionModel = this.sigmoidFamily ? SiglipVisionModel : CLIPVisionModelWithProjection;

    // Try the requested execution provider first. A GPU provider is only accepted if it loads AND
    // reproduces the CPU result on a set of probe inputs: providers have been seen to return
    // finite but constant vectors, which silently breaks search. Anything else falls back to CPU.
    const load = async (device: string): Promise<Towers> => {
      const modelOptions = {
        dtype: config.modelDtype,
        progress_callback,
        ...(device === 'cpu' ? {} : { device: device as 'dml' }),
        session_options: { intraOpNumThreads: config.threads, interOpNumThreads: 1 },
      };
      this.updateState({ message: `Lade Text-Encoder (${device}) …` });
      const text = (await TextModel.from_pretrained(config.modelId, { ...modelOptions, dtype: config.modelTextDtype })) as unknown as CallableModel;
      this.updateState({ message: `Lade Bild-Encoder (${device}) …` });
      const vision = (await VisionModel.from_pretrained(config.modelId, modelOptions)) as unknown as CallableModel;
      return { device, text, vision };
    };

    const candidates = deviceCandidates();
    let notice = '';
    let chosen: Towers | null = null;
    let reference: { towers: Towers; probe: Probe } | null = null;
    let lastError: unknown = null;
    for (const device of candidates) {
      let towers: Towers | null = null;
      try {
        if (device === 'cpu' && reference) {
          chosen = reference.towers;
          reference = null;
          break;
        }
        towers = await load(device);
        this.updateState({ progress: 0.99, message: `Selbsttest (${device}) …` });
        const probe = await this.runProbe(towers);
        checkProbe(probe);
        if (device !== 'cpu') {
          reference ??= await (async () => {
            const cpu = await load('cpu');
            const cpuProbe = await this.runProbe(cpu);
            checkProbe(cpuProbe);
            return { towers: cpu, probe: cpuProbe };
          })();
          compareProbes(probe, reference.probe, device);
        }
        chosen = towers;
        break;
      } catch (err: unknown) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        if (device !== 'cpu') notice = `${device.toUpperCase()} verworfen (${message}); CPU aktiv.`;
        await disposeTowers(towers);
      }
    }
    if (reference && chosen !== reference.towers) await disposeTowers(reference.towers);
    if (chosen === null) throw lastError instanceof Error ? lastError : new Error(String(lastError));
    this.towers = chosen;
    this.dim = (await this.embedTexts(['warm-up'])).length;
    const active = chosen.device;

    this.updateState({
      phase: 'ready',
      progress: 1,
      dim: this.dim,
      imageSize: this.imageSize,
      device: active,
      notice,
      message: 'Bereit',
    });
  }

  private pickEmbedding(output: Record<string, Tensor | undefined>, kind: 'image' | 'text'): Tensor {
    const tensor =
      this.sigmoidFamily ? output['pooler_output'] : output[kind === 'image' ? 'image_embeds' : 'text_embeds'];
    if (!tensor) {
      throw new Error(`Model output is missing the ${kind} embedding (keys: ${Object.keys(output).join(', ')}).`);
    }
    return tensor;
  }

  /**
   * Embeds `count` preprocessed images.
   * @param pixels CHW float data, `count * 3 * imageSize * imageSize` values.
   * @returns L2-normalized embeddings, `count * dim` values.
   */
  embedPixels(pixels: Float32Array, count: number): Promise<Float32Array> {
    const towers = this.towers;
    if (!towers) return Promise.reject(new Error('Model is not loaded yet.'));
    return this.visionLock.run(() => this.runVision(towers, pixels, count));
  }

  /** Embeds texts; returns L2-normalized embeddings, `texts.length * dim` values. */
  embedTexts(texts: string[]): Promise<Float32Array> {
    const towers = this.towers;
    if (!towers) return Promise.reject(new Error('Model is not loaded yet.'));
    if (texts.length === 0) return Promise.resolve(new Float32Array(0));
    return this.textLock.run(() => this.runText(towers, texts));
  }

  private async runVision(towers: Towers, pixels: Float32Array, count: number): Promise<Float32Array> {
    const size = this.imageSize;
    if (pixels.length !== count * 3 * size * size) {
      throw new Error(`Pixel buffer has ${pixels.length} values, expected ${count * 3 * size * size}.`);
    }
    const input = new Tensor('float32', pixels, [count, 3, size, size]);
    const output = await towers.vision({ pixel_values: input });
    const out = new Float32Array(this.pickEmbedding(output, 'image').data as Float32Array);
    assertUsable(out, count, 'Bild-Encoder');
    l2normalizeRows(out, out.length / count);
    return out;
  }

  private async runText(towers: Towers, texts: string[]): Promise<Float32Array> {
    const tokenizer = this.tokenizer;
    if (!tokenizer) throw new Error('Model is not loaded yet.');
    // SigLIP and MobileCLIP expect fixed-length padding; CLIP uses dynamic padding.
    const inputs = tokenizer(texts, {
      padding: this.family === 'clip' ? true : 'max_length',
      truncation: true,
      // SigLIP was trained with 64 text tokens; some of its tokenizers declare no limit at all.
      ...(this.sigmoidFamily ? { max_length: 64 } : {}),
    });
    const feed = this.sigmoidFamily ? { input_ids: inputs['input_ids'] } : inputs;
    const output = await towers.text(feed);
    const out = new Float32Array(this.pickEmbedding(output, 'text').data as Float32Array);
    assertUsable(out, texts.length, 'Text-Encoder');
    l2normalizeRows(out, out.length / texts.length);
    return out;
  }

  /** Runs the probe on the active provider and reports timings; used by `pnpm selftest`. */
  async diagnose(): Promise<{ device: string; agreement: number; imageMs: number; textMs: number }> {
    const towers = this.towers;
    if (!towers) throw new Error('Model is not loaded yet.');
    const probe = await this.runProbe(towers);
    checkProbe(probe);
    const size = this.imageSize;
    const pixels = new Float32Array(8 * 3 * size * size).fill(0.25);
    let started = performance.now();
    await this.embedPixels(pixels, 8);
    const imageMs = (performance.now() - started) / 8;
    started = performance.now();
    await this.embedTexts(['a flooded street', 'smoke over a building']);
    const textMs = (performance.now() - started) / 2;
    return { device: towers.device, agreement: probeAgreement(probe), imageMs, textMs };
  }

  /** Embeds a fixed set of synthetic pictures and captions; used to validate an execution provider. */
  private async runProbe(towers: Towers): Promise<Probe> {
    const size = this.imageSize;
    const plane = size * size;
    const pixels = new Float32Array(PROBE_IMAGES.length * 3 * plane);
    PROBE_IMAGES.forEach((paint, n) => {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const rgb = paint(x / size, y / size);
          for (let c = 0; c < 3; c++) {
            const value = ((rgb[c] as number) - (this.imageMean[c] as number)) / (this.imageStd[c] as number);
            pixels[n * 3 * plane + c * plane + y * size + x] = value;
          }
        }
      }
    });
    const images = await this.runVision(towers, pixels, PROBE_IMAGES.length);
    const texts = await this.runText(towers, [...PROBE_TEXTS]);
    return { images, texts, dim: images.length / PROBE_IMAGES.length };
  }

  /**
   * Embeds a free-text search query using a small prompt ensemble.
   * Results are cached (LRU) because the same query is reused for search, heatmaps and the map.
   */
  async embedQuery(query: string): Promise<Float32Array> {
    const key = normalizeQuery(query);
    const cached = this.textCache.get(key);
    if (cached) {
      this.textCache.delete(key);
      this.textCache.set(key, cached);
      return cached;
    }
    const prompts = buildPrompts(key);
    const embeddings = await this.embedTexts(prompts);
    const dim = embeddings.length / prompts.length;
    const mean = new Float32Array(dim);
    for (let p = 0; p < prompts.length; p++) {
      for (let i = 0; i < dim; i++) mean[i] = (mean[i] as number) + (embeddings[p * dim + i] as number);
    }
    l2normalizeRows(mean, dim);
    this.textCache.set(key, mean);
    if (this.textCache.size > 256) {
      const oldest = this.textCache.keys().next();
      if (!oldest.done) this.textCache.delete(oldest.value);
    }
    return mean;
  }
}

export function normalizeQuery(query: string): string {
  return query.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
}

/** Prompt ensemble: the raw phrase plus two caption-style templates. */
export function buildPrompts(normalizedQuery: string): string[] {
  return [normalizedQuery, `a photo of ${normalizedQuery}.`, `a video frame showing ${normalizedQuery}.`];
}
