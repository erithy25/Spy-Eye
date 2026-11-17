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

export type ModelFamily = 'siglip' | 'clip';

type ProgressListener = (state: ModelState) => void;

interface CallableModel {
  (inputs: Record<string, unknown>): Promise<Record<string, Tensor | undefined>>;
}

interface CallableTokenizer {
  (texts: string[], options: Record<string, unknown>): Record<string, unknown>;
}

function detectFamily(modelId: string): ModelFamily {
  return /siglip/i.test(modelId) ? 'siglip' : 'clip';
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
  private tokenizer: CallableTokenizer | null = null;
  private textModel: CallableModel | null = null;
  private visionModel: CallableModel | null = null;
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

    const modelOptions = {
      dtype: config.modelDtype,
      progress_callback,
      session_options: { intraOpNumThreads: config.threads, interOpNumThreads: 1 },
    };

    this.updateState({ phase: 'loading', progress: 0, message: 'Lade Tokenizer …' });
    const tokenizer = await AutoTokenizer.from_pretrained(config.modelId, { progress_callback });
    this.tokenizer = tokenizer as unknown as CallableTokenizer;

    const processor = await AutoProcessor.from_pretrained(config.modelId, { progress_callback });
    const imageProcessor = (processor as unknown as { image_processor?: { config?: Record<string, unknown> } })
      .image_processor;
    const ipc = imageProcessor?.config ?? {};
    this.imageSize = readImageSize(ipc);
    const defaultMean: [number, number, number] =
      this.family === 'siglip' ? [0.5, 0.5, 0.5] : [0.48145466, 0.4578275, 0.40821073];
    const defaultStd: [number, number, number] =
      this.family === 'siglip' ? [0.5, 0.5, 0.5] : [0.26862954, 0.26130258, 0.27577711];
    this.imageMean = asNumberTriple(ipc['image_mean'], defaultMean);
    this.imageStd = asNumberTriple(ipc['image_std'], defaultStd);

    this.updateState({ message: 'Lade Text-Encoder …' });
    const TextModel = this.family === 'siglip' ? SiglipTextModel : CLIPTextModelWithProjection;
    this.textModel = (await TextModel.from_pretrained(config.modelId, modelOptions)) as unknown as CallableModel;

    this.updateState({ message: 'Lade Bild-Encoder …' });
    const VisionModel = this.family === 'siglip' ? SiglipVisionModel : CLIPVisionModelWithProjection;
    this.visionModel = (await VisionModel.from_pretrained(config.modelId, modelOptions)) as unknown as CallableModel;

    this.updateState({ progress: 0.99, message: 'Wärme Modell auf …' });
    const warm = await this.embedPixels(new Float32Array(3 * this.imageSize * this.imageSize), 1);
    this.dim = warm.length;
    if (this.dim <= 0) throw new Error('Vision model returned an empty embedding.');
    const warmText = await this.embedTexts(['warm-up']);
    if (warmText.length !== this.dim) {
      throw new Error(`Text (${warmText.length}) and image (${this.dim}) embedding sizes differ.`);
    }

    this.updateState({
      phase: 'ready',
      progress: 1,
      dim: this.dim,
      imageSize: this.imageSize,
      message: 'Bereit',
    });
  }

  private pickEmbedding(output: Record<string, Tensor | undefined>, kind: 'image' | 'text'): Tensor {
    const tensor =
      this.family === 'siglip' ? output['pooler_output'] : output[kind === 'image' ? 'image_embeds' : 'text_embeds'];
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
    const model = this.visionModel;
    if (!model) return Promise.reject(new Error('Model is not loaded yet.'));
    const size = this.imageSize;
    if (pixels.length !== count * 3 * size * size) {
      return Promise.reject(new Error(`Pixel buffer has ${pixels.length} values, expected ${count * 3 * size * size}.`));
    }
    return this.visionLock.run(async () => {
      const input = new Tensor('float32', pixels, [count, 3, size, size]);
      const output = await model({ pixel_values: input });
      const tensor = this.pickEmbedding(output, 'image');
      const out = new Float32Array(tensor.data as Float32Array);
      const dim = out.length / count;
      l2normalizeRows(out, dim);
      return out;
    });
  }

  /** Embeds texts; returns L2-normalized embeddings, `texts.length * dim` values. */
  embedTexts(texts: string[]): Promise<Float32Array> {
    const model = this.textModel;
    const tokenizer = this.tokenizer;
    if (!model || !tokenizer) return Promise.reject(new Error('Model is not loaded yet.'));
    if (texts.length === 0) return Promise.resolve(new Float32Array(0));
    return this.textLock.run(async () => {
      // SigLIP was trained with fixed-length padding; CLIP uses dynamic padding.
      const inputs = tokenizer(texts, {
        padding: this.family === 'siglip' ? 'max_length' : true,
        truncation: true,
      });
      const feed = this.family === 'siglip' ? { input_ids: inputs['input_ids'] } : inputs;
      const output = await model(feed);
      const tensor = this.pickEmbedding(output, 'text');
      const out = new Float32Array(tensor.data as Float32Array);
      l2normalizeRows(out, out.length / texts.length);
      return out;
    });
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
