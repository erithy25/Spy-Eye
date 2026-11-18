import { config } from '../config.js';
import type { ModelState } from '../types.js';
import { l2normalizeRows } from './math.js';
import {
  checkProbe,
  detectFamily,
  probeAgreement,
  type ModelFamily,
  type SiglipEvent,
  type SiglipInfo,
  type SiglipOps,
  type SiglipOptions,
} from './siglipShared.js';
import { InferenceThread } from './workerHost.js';
import { movable } from './workerProtocol.js';

export type { ModelFamily };
export { probeAgreement };

/** Seconds without transfer progress after which a notice is given while model files are fetched. */
const STALL_NOTICE_SEC = 90;

type ProgressListener = (state: ModelState) => void;

/** Devices to try in order for the configured ML_DEVICE. */
function deviceCandidates(): string[] {
  if (config.device === 'cpu') return ['cpu'];
  if (config.device !== 'auto') return [config.device, 'cpu'];
  if (process.platform === 'win32') return ['dml', 'cpu'];
  if (process.platform === 'linux' && process.arch === 'x64') return ['cuda', 'cpu'];
  return ['cpu'];
}

/** What the inference thread loads, from config.ts (exported for tests that load it on their own thread). */
export function embeddingModelOptions(): SiglipOptions {
  return {
    modelId: config.modelId,
    family: detectFamily(config.modelId),
    dtype: config.modelDtype,
    textDtype: config.modelTextDtype,
    devices: deviceCandidates(),
    threads: config.threads,
    cacheDir: config.modelCacheDir,
    offline: config.offline,
  };
}

type SiglipThread = InferenceThread<SiglipOps, SiglipOptions, SiglipInfo, SiglipEvent>;

/**
 * Local dual-encoder (image tower + text tower) running on onnxruntime.
 * All inference happens in this process, in an inference thread of its own (siglipService.ts):
 * a run takes the calling thread for its whole duration, and on the main thread that held every
 * request. The weights are loaded from the local cache directory.
 */
export class EmbeddingModel {
  readonly family: ModelFamily;

  private thread: SiglipThread | null = null;
  private readonly listeners = new Set<ProgressListener>();
  private readonly textCache = new Map<string, Float32Array>();
  /** Share of the mean text embedding that search queries are reduced by; null: none. */
  private searchCentre: Float32Array | null = null;
  /** Watches the transfer of the model files while they are loaded. */
  private stallTimer: NodeJS.Timeout | null = null;
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
    this.loadPromise ??= this.doLoad()
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.updateState({ phase: 'error', message: `Modell konnte nicht geladen werden: ${message}` });
        this.loadPromise = null;
        throw err;
      })
      .finally(() => {
        if (this.stallTimer) clearInterval(this.stallTimer);
        this.stallTimer = null;
      });
    return this.loadPromise;
  }

  private async doLoad(): Promise<void> {
    // Aggregate download progress across files so the UI shows one bar.
    const files = new Map<string, { loaded: number; total: number }>();
    let lastEmit = 0;
    let lastProgress = Date.now();
    // A transfer that stops without an error would look like a hang: say so after a while.
    this.stallTimer = setInterval(() => {
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      const idleSec = Math.round((Date.now() - lastProgress) / 1000);
      if (total > 0 && loaded < total && idleSec >= STALL_NOTICE_SEC) {
        this.updateState({
          message: `Abruf der Modelle stockt seit ${idleSec} s (${(loaded / 1e6).toFixed(0)} von ${(total / 1e6).toFixed(0)} MB). Netzverbindung prüfen; ein Neustart setzt bei den fertig geladenen Dateien fort.`,
        });
      }
    }, 30_000);
    this.stallTimer.unref();
    const onEvent = (event: SiglipEvent): void => {
      if (event.kind === 'state') {
        this.updateState(event.progress === null ? { message: event.message } : { progress: event.progress, message: event.message });
        return;
      }
      files.set(event.file, { loaded: event.loaded, total: event.total });
      lastProgress = Date.now();
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
    const previous = this.thread;
    this.thread = null;
    await previous?.close();
    const thread: SiglipThread = new InferenceThread({
      name: 'Bildmodell',
      service: 'siglip',
      options: embeddingModelOptions(),
      onEvent,
      onReady: (info, restart) => {
        // A restarted thread loads the same files; anything else would mix incompatible vectors.
        if (restart && (info.dim !== this.dim || info.imageSize !== this.imageSize)) {
          throw new Error(`neu gestartetes Modell hat ${info.dim} statt ${this.dim} Dimensionen`);
        }
        if (restart) this.updateState({ device: info.device, notice: info.notice });
      },
      onGiveUp: (error) => {
        this.updateState({ phase: 'error', message: error.message });
      },
    });
    let info: SiglipInfo;
    try {
      info = await thread.start();
    } catch (err: unknown) {
      await thread.close();
      throw err;
    }
    this.imageSize = info.imageSize;
    this.imageMean = info.imageMean;
    this.imageStd = info.imageStd;
    this.dim = info.dim;
    this.thread = thread;

    this.updateState({
      phase: 'ready',
      progress: 1,
      dim: this.dim,
      imageSize: this.imageSize,
      device: info.device,
      notice: info.notice,
      message: 'Bereit',
    });
  }

  /**
   * Embeds `count` preprocessed images.
   * @param pixels CHW float data, `count * 3 * imageSize * imageSize` values. Its buffer is moved
   *   to the inference thread, not copied: afterwards `pixels` is empty (length 0). Every caller
   *   fills a fresh array for the call; one that needs the data again must pass a copy.
   * @returns L2-normalized embeddings, `count * dim` values.
   */
  embedPixels(pixels: Float32Array, count: number): Promise<Float32Array> {
    const thread = this.thread;
    if (!thread) return Promise.reject(new Error('Model is not loaded yet.'));
    const size = this.imageSize;
    if (pixels.length !== count * 3 * size * size) {
      return Promise.reject(new Error(`Pixel buffer has ${pixels.length} values, expected ${count * 3 * size * size}.`));
    }
    const moved = movable(pixels);
    return thread.call('vision', { pixels: moved, count }, { transfer: [moved.buffer], lane: 'batch' });
  }

  /** Embeds texts; returns L2-normalized embeddings, `texts.length * dim` values. */
  embedTexts(texts: string[]): Promise<Float32Array> {
    const thread = this.thread;
    if (!thread) return Promise.reject(new Error('Model is not loaded yet.'));
    if (texts.length === 0) return Promise.resolve(new Float32Array(0));
    // A text query is what a person waits for: it goes ahead of queued image batches.
    return thread.call('text', { texts }, { lane: 'interactive' });
  }

  /** Runs the probe on the active provider and reports timings; used by `pnpm selftest`. */
  async diagnose(): Promise<{ device: string; agreement: number; imageMs: number; textMs: number }> {
    const thread = this.thread;
    if (!thread) throw new Error('Model is not loaded yet.');
    const probe = await thread.call('probe', null);
    checkProbe(probe);
    const size = this.imageSize;
    const pixels = new Float32Array(8 * 3 * size * size).fill(0.25);
    let started = performance.now();
    await this.embedPixels(pixels, 8);
    const imageMs = (performance.now() - started) / 8;
    started = performance.now();
    await this.embedTexts(['a flooded street', 'smoke over a building']);
    const textMs = (performance.now() - started) / 2;
    return { device: probe.device, agreement: probeAgreement(probe), imageMs, textMs };
  }

  /**
   * Stops the inference thread. Called when the process ends its work; the model has to be
   * loaded again before it can embed anything.
   */
  async dispose(): Promise<void> {
    const thread = this.thread;
    this.thread = null;
    this.loadPromise = null;
    await thread?.close();
  }

  /** Empties the cache of query embeddings (for measurements of first-time queries). */
  forgetQueries(): void {
    this.textCache.clear();
  }

  /**
   * Sets what the search subtracts from every query: `share` times the mean text embedding (see
   * SearchCalibration.centring). Without it, search queries are compared as they are.
   */
  setSearchCentre(meanText: Float32Array, share: number): void {
    if (share <= 0 || meanText.length !== this.dim) {
      this.searchCentre = null;
      return;
    }
    this.searchCentre = Float32Array.from(meanText, (v) => v * share);
  }

  /**
   * Rows of text embeddings reduced by what search queries are reduced by; the rows themselves
   * when no centre is set. Used for the scene tags, which are judged like a search.
   */
  centreTexts(rows: Float32Array): Float32Array {
    const centre = this.searchCentre;
    if (!centre) return rows;
    const dim = centre.length;
    const out = new Float32Array(rows.length);
    for (let i = 0; i < rows.length; i++) out[i] = (rows[i] as number) - (centre[i % dim] as number);
    return out;
  }

  /**
   * The vector the search compares footage with: the query embedding minus the configured share
   * of the mean text embedding. Not re-normalised, so that the cut-offs keep their meaning.
   */
  async embedSearchQuery(query: string): Promise<Float32Array> {
    const base = await this.embedQuery(query);
    const centre = this.searchCentre;
    if (!centre) return base;
    const out = new Float32Array(base.length);
    for (let i = 0; i < out.length; i++) out[i] = (base[i] as number) - (centre[i] as number);
    return out;
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

/**
 * Turns the loader's state messages into occasional console lines. Reading the model files from
 * the local cache also reports progress but is over within seconds; only a transfer that lasts
 * longer is shown, with one line per 100 MB.
 */
export function loadingNotes(): (message: string) => string | null {
  let last = '';
  let transferSince: number | null = null;
  return (message) => {
    const transfer = /^Lade Modellgewichte … (\d+) \/ (\d+) MB/.exec(message);
    let note = message;
    if (transfer) {
      transferSince ??= Date.now();
      if (Date.now() - transferSince < 4000) return null;
      note = `Lade Modellgewichte … ${Math.floor(Number(transfer[1]) / 100) * 100} / ${transfer[2]} MB`;
    } else {
      transferSince = null;
    }
    if (note === last) return null;
    last = note;
    return note;
  };
}

/** Mean of the rows of a matrix of row vectors. */
export function meanRow(rows: Float32Array, dim: number): Float32Array {
  const count = Math.floor(rows.length / dim);
  const mean = new Float32Array(dim);
  if (count === 0) return mean;
  for (let r = 0; r < count; r++) {
    for (let i = 0; i < dim; i++) mean[i] = (mean[i] as number) + (rows[r * dim + i] as number);
  }
  for (let i = 0; i < dim; i++) mean[i] = (mean[i] as number) / count;
  return mean;
}

export function normalizeQuery(query: string): string {
  return query.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
}

/** Prompt ensemble: the raw phrase plus two caption-style templates. */
export function buildPrompts(normalizedQuery: string): string[] {
  return [normalizedQuery, `a photo of ${normalizedQuery}.`, `a video frame showing ${normalizedQuery}.`];
}
