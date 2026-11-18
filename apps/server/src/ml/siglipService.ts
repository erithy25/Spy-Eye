/**
 * The dual encoder (image tower + text tower, SigLIP 2 by default) on onnxruntime through
 * transformers.js. Runs inside an inference thread (see inferenceWorker.ts); `SiglipEngine` can
 * also be used directly on the calling thread, which the tests do to compare both paths.
 */
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
import { l2normalizeRows } from './math.js';
import {
  PROBE_IMAGES,
  PROBE_TEXTS,
  assertUsable,
  checkProbe,
  compareProbes,
  type ModelFamily,
  type Probe,
  type SiglipEvent,
  type SiglipInfo,
  type SiglipOps,
  type SiglipOptions,
} from './siglipShared.js';
import type { InferenceService, Reply } from './workerProtocol.js';

interface CallableModel {
  (inputs: Record<string, unknown>): Promise<Record<string, Tensor | undefined>>;
}

interface CallableTokenizer {
  (texts: string[], options: Record<string, unknown>): Record<string, unknown>;
}

interface Towers {
  device: string;
  text: CallableModel;
  vision: CallableModel;
}

async function disposeTowers(towers: Towers | null): Promise<void> {
  if (!towers) return;
  for (const model of [towers.text, towers.vision]) {
    const dispose = (model as unknown as { dispose?: () => Promise<unknown> }).dispose;
    if (typeof dispose === 'function') await dispose.call(model).catch(() => undefined);
  }
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

/** Download progress is reported per chunk; the main thread needs it a few times per second. */
const PROGRESS_INTERVAL_MS = 100;

export class SiglipEngine {
  private family: ModelFamily = 'siglip2';
  private tokenizer: CallableTokenizer | null = null;
  private towers: Towers | null = null;
  private imageSize = 224;
  private imageMean: [number, number, number] = [0.5, 0.5, 0.5];
  private imageStd: [number, number, number] = [0.5, 0.5, 0.5];

  /** SigLIP and SigLIP 2 share their model classes, pooled outputs and fixed text length. */
  private get sigmoidFamily(): boolean {
    return this.family === 'siglip' || this.family === 'siglip2';
  }

  /** Loads tokenizer and both towers on the first provider that passes the self-test. */
  async load(options: SiglipOptions, notify: (event: SiglipEvent) => void = () => undefined): Promise<SiglipInfo> {
    this.family = options.family;
    env.cacheDir = options.cacheDir;
    env.allowRemoteModels = !options.offline;
    env.allowLocalModels = true;

    const lastSent = new Map<string, number>();
    const progress_callback = (info: unknown): void => {
      if (info === null || typeof info !== 'object') return;
      const p = info as { status?: string; file?: string; loaded?: number; total?: number };
      if (p.status !== 'progress' || typeof p.file !== 'string') return;
      if (typeof p.loaded !== 'number' || typeof p.total !== 'number' || p.total <= 0) return;
      const now = Date.now();
      if (p.loaded < p.total && now - (lastSent.get(p.file) ?? 0) < PROGRESS_INTERVAL_MS) return;
      lastSent.set(p.file, now);
      notify({ kind: 'download', file: p.file, loaded: p.loaded, total: p.total });
    };

    const tokenizer = await AutoTokenizer.from_pretrained(options.modelId, { progress_callback });
    this.tokenizer = tokenizer as unknown as CallableTokenizer;

    const processor = await AutoProcessor.from_pretrained(options.modelId, { progress_callback });
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
        dtype: options.dtype,
        progress_callback,
        ...(device === 'cpu' ? {} : { device: device as 'dml' }),
        session_options: { intraOpNumThreads: options.threads, interOpNumThreads: 1 },
      };
      notify({ kind: 'state', message: `Lade Text-Encoder (${device}) …`, progress: null });
      const text = (await TextModel.from_pretrained(options.modelId, { ...modelOptions, dtype: options.textDtype })) as unknown as CallableModel;
      notify({ kind: 'state', message: `Lade Bild-Encoder (${device}) …`, progress: null });
      const vision = (await VisionModel.from_pretrained(options.modelId, modelOptions)) as unknown as CallableModel;
      return { device, text, vision };
    };

    let notice = '';
    let chosen: Towers | null = null;
    let reference: { towers: Towers; probe: Probe } | null = null;
    let lastError: unknown = null;
    for (const device of options.devices) {
      let towers: Towers | null = null;
      try {
        if (device === 'cpu' && reference) {
          chosen = reference.towers;
          reference = null;
          break;
        }
        towers = await load(device);
        notify({ kind: 'state', message: `Selbsttest (${device}) …`, progress: 0.99 });
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
    const dim = (await this.text(['warm-up'])).length;
    return { device: chosen.device, notice, dim, imageSize: this.imageSize, imageMean: this.imageMean, imageStd: this.imageStd };
  }

  private pickEmbedding(output: Record<string, Tensor | undefined>, kind: 'image' | 'text'): Tensor {
    const tensor =
      this.sigmoidFamily ? output['pooler_output'] : output[kind === 'image' ? 'image_embeds' : 'text_embeds'];
    if (!tensor) {
      throw new Error(`Model output is missing the ${kind} embedding (keys: ${Object.keys(output).join(', ')}).`);
    }
    return tensor;
  }

  /** `count` preprocessed images (CHW, `count * 3 * imageSize²` values) → L2-normalised rows. */
  vision(pixels: Float32Array, count: number): Promise<Float32Array<ArrayBuffer>> {
    const towers = this.towers;
    if (!towers) return Promise.reject(new Error('Model is not loaded yet.'));
    return this.runVision(towers, pixels, count);
  }

  /** Texts → L2-normalised rows. */
  text(texts: string[]): Promise<Float32Array<ArrayBuffer>> {
    const towers = this.towers;
    if (!towers) return Promise.reject(new Error('Model is not loaded yet.'));
    if (texts.length === 0) return Promise.resolve(new Float32Array(0));
    return this.runText(towers, texts);
  }

  /** The self-test inputs through the active provider. */
  async probe(): Promise<Probe & { device: string }> {
    const towers = this.towers;
    if (!towers) throw new Error('Model is not loaded yet.');
    return { ...(await this.runProbe(towers)), device: towers.device };
  }

  async dispose(): Promise<void> {
    const towers = this.towers;
    this.towers = null;
    await disposeTowers(towers);
  }

  private async runVision(towers: Towers, pixels: Float32Array, count: number): Promise<Float32Array<ArrayBuffer>> {
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

  private async runText(towers: Towers, texts: string[]): Promise<Float32Array<ArrayBuffer>> {
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
}

/** The engine as a service of an inference thread. */
export function createSiglipService(): InferenceService {
  const engine = new SiglipEngine();
  return {
    init: (options, notify) => engine.load(options as SiglipOptions, notify as (event: SiglipEvent) => void),
    async call(op, args): Promise<Reply<unknown>> {
      switch (op) {
        case 'vision': {
          const { pixels, count } = args as SiglipOps['vision']['args'];
          const value = await engine.vision(pixels, count);
          return { value, transfer: [value.buffer] };
        }
        case 'text': {
          const { texts } = args as SiglipOps['text']['args'];
          const value = await engine.text(texts);
          return { value, transfer: [value.buffer] };
        }
        case 'probe': {
          const value = await engine.probe();
          return { value, transfer: [] };
        }
        default:
          throw new Error(`siglip: unknown operation ${op}`);
      }
    },
    dispose: () => engine.dispose(),
  };
}
