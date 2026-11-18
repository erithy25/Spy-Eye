import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.js';
import type { EventHub } from './events.js';
import { extractFrames, extractKeyframes, probeVideo, type FrameExtraction } from './media/ffmpeg.js';
import { GrowableMatrix, dotAt, sigmoid } from './ml/math.js';
import { pixelate, type FaceDetector } from './ml/faces.js';
import type { EmbeddingModel, ModelFamily } from './ml/model.js';
import {
  decodeFrame,
  frameSignature,
  isStaticDuplicate,
  signatureDelta,
  tileLayout,
  toNormRect,
  writeTile,
  type DecodedFrame,
  type PixelRect,
} from './ml/preprocess.js';
import type { VocabularyIndex } from './ml/vocab.js';
import { RM_OPTIONS, frameUrl, type FrameRecord, type SceneRecord, type Store, type VideoEntry } from './store.js';
import type { FrameEvent, NormRect, Tag } from './types.js';

/** Scene segmentation thresholds on cosine distance between whole-frame embeddings. */
const SCENE_THRESHOLDS: Readonly<Record<ModelFamily, { cut: number; drift: number }>> = {
  siglip: { cut: 0.28, drift: 0.36 },
  siglip2: { cut: 0.28, drift: 0.36 },
  clip: { cut: 0.22, drift: 0.28 },
  mobileclip: { cut: 0.3, drift: 0.38 },
};

/** Operating point for turning a label similarity into a display confidence. */
const TAG_CALIBRATION: Readonly<Record<ModelFamily, { center: number; slope: number }>> = {
  siglip: { center: 0.07, slope: 80 },
  siglip2: { center: 0.105, slope: 80 },
  clip: { center: 0.255, slope: 80 },
  mobileclip: { center: 0.235, slope: 60 },
};

/**
 * Continuous footage (CCTV, dashcams) has no hard cuts. Two extra rules split it into useful
 * segments: a pause in activity starts a new scene, and no scene runs longer than the maximum.
 */
const IDLE_GAP_SEC = 2.5;
const MAX_SCENE_SEC = 30;

const FINGERPRINT_SIZE = 64;
const MAX_TAGS_PER_FRAME = 5;
const MAX_TAGS_PER_SCENE = 6;

/**
 * First pass: a few whole-frame keyframes per video, so a new dataset is searchable within
 * seconds. Preview frames use file numbers from this offset upwards to stay clear of the
 * sequentially numbered frames of the dense pass.
 */
const PREVIEW_FRAME_OFFSET = 9_000_000;
const PREVIEW_MAX_FRAMES = 3;
const PREVIEW_SECONDS_PER_FRAME = 30;
/** Videos handled per first-pass round; bounds memory and makes results appear progressively. */
const PREVIEW_CHUNK = 32;
/** Dense analysis waits until no upload has arrived for this long. */
const INGEST_SETTLE_MS = 1200;

/**
 * Frames that reach the model differ visibly (static repeats are filtered before). If their vectors
 * are nevertheless numerically identical, the encoder is broken and the index would be worthless.
 */
const IDENTICAL_DISTANCE = 1e-6;
const IDENTICAL_FRAMES_LIMIT = 4;
const DEGENERATE_MESSAGE =
  'Das Modell liefert für unterschiedliche Bilder identische Vektoren. Server ohne ML_DEVICE neu starten (CPU).';

interface Logger {
  info(msg: string): void;
  error(msg: string): void;
}

interface OpenScene {
  record: SceneRecord;
  /** Sum of the whole-frame embeddings of the scene (un-normalized centroid). */
  sum: Float32Array;
  /** Per-label maximum similarity over the frames of the scene. */
  labelMax: Float32Array;
}

interface PendingFrame {
  n: number;
  time: number;
}

interface PreparedPreview {
  entry: VideoEntry;
  durationSec: number | null;
  width: number;
  height: number;
  frames: { n: number; time: number; pixels: Float32Array; faces: number[][] | undefined }[];
}

export interface PipelineHooks {
  /** Called after the dense index of a recording has replaced its preview. */
  onRecordingReady?: (entry: VideoEntry) => void;
}

class CancelledError extends Error {}

/** Runs `worker` over `items` with at most `limit` running at once; preserves order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const run = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, run));
  return results;
}

/**
 * Background worker that turns uploaded videos into searchable scenes in two passes:
 *
 * 1. Preview pass, for every new video before anything else: a few keyframes, one whole-frame
 *    embedding each, batched across videos. Makes the whole dataset searchable quickly.
 * 2. Dense pass, one video at a time: sampled frames with tiles, scene segmentation and tags.
 *    Its result atomically replaces the preview index of that video.
 *
 * Inference is the bottleneck and already uses every core, so dense passes run sequentially;
 * decoding for the preview pass runs in parallel.
 */
export class Pipeline {
  private readonly previewQueue: string[] = [];
  private readonly fullQueue: string[] = [];
  private running = false;
  private current: { id: string; extraction: FrameExtraction | null } | null = null;
  private vocabulary: VocabularyIndex | null = null;
  private readyGate: Promise<void> | null = null;
  private uploadsInFlight = 0;
  private lastArrival = 0;

  constructor(
    private readonly store: Store,
    private readonly model: EmbeddingModel,
    private readonly faces: FaceDetector,
    private readonly hub: EventHub,
    private readonly log: Logger,
    private readonly hooks: PipelineHooks = {},
  ) {}

  /**
   * Masks the faces of one extracted frame: the pixelated version becomes the file that is
   * served, the extracted original is kept next to it for authorized unmasking and for evidence
   * hashes. Returns the masked rectangles in normalized coordinates, or undefined if there are none.
   */
  private async maskFaces(id: string, n: number, decoded: DecodedFrame): Promise<number[][] | undefined> {
    if (!this.faces.ready) return undefined;
    const boxes = await this.faces.detect(decoded);
    if (boxes.length === 0) return undefined;
    const served = this.store.framePath(id, n);
    await fs.rename(served, this.store.originalFramePath(id, n));
    const copy: DecodedFrame = { data: Buffer.from(decoded.data), width: decoded.width, height: decoded.height };
    pixelate(copy, boxes);
    await sharp(copy.data, { raw: { width: copy.width, height: copy.height, channels: 3 } })
      .jpeg({ quality: 84 })
      .toFile(served);
    const round = (v: number): number => Math.round(v * 10000) / 10000;
    return boxes.map((b) => [
      round(b.left / decoded.width),
      round(b.top / decoded.height),
      round(b.width / decoded.width),
      round(b.height / decoded.height),
    ]);
  }

  setVocabulary(vocabulary: VocabularyIndex): void {
    this.vocabulary = vocabulary;
  }

  /** Processing waits for this promise (model and vocabulary initialisation) before it starts. */
  setReadyGate(gate: Promise<void>): void {
    this.readyGate = gate;
    gate.catch(() => undefined);
  }

  /** Called by the upload route so dense work can step aside while files are still arriving. */
  uploadStarted(): void {
    this.uploadsInFlight++;
  }

  uploadFinished(): void {
    this.uploadsInFlight = Math.max(0, this.uploadsInFlight - 1);
    this.lastArrival = Date.now();
  }

  /**
   * While a dataset is being uploaded, every bit of inference time goes to the preview pass.
   * Dense analysis resumes once no file has arrived for a moment.
   */
  private async yieldToIngest(isCancelled: () => boolean): Promise<void> {
    for (;;) {
      if (this.previewQueue.length > 0) await this.runPreviews();
      const settling = this.uploadsInFlight > 0 || Date.now() - this.lastArrival < INGEST_SETTLE_MS;
      if (!settling || isCancelled()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** Videos whose dense analysis is still outstanding. */
  get queueLength(): number {
    return this.fullQueue.length + (this.current ? 1 : 0);
  }

  enqueue(id: string): void {
    if (this.fullQueue.includes(id) || this.current?.id === id) return;
    this.previewQueue.push(id);
    this.fullQueue.push(id);
    this.lastArrival = Date.now();
    void this.drain();
  }

  /** Stops work on a video that is being deleted. */
  cancel(id: string): void {
    for (const queue of [this.previewQueue, this.fullQueue]) {
      const idx = queue.indexOf(id);
      if (idx >= 0) queue.splice(idx, 1);
    }
    if (this.current?.id === id) this.current.extraction?.kill();
  }

  shutdown(): void {
    this.previewQueue.length = 0;
    this.fullQueue.length = 0;
    this.current?.extraction?.kill();
  }

  private broadcastVideo(entry: VideoEntry): void {
    this.hub.broadcast({
      type: 'video',
      video: entry.info,
      stats: this.store.stats(),
      queueLength: this.queueLength,
    });
  }

  private async fail(entry: VideoEntry, err: unknown): Promise<void> {
    const id = entry.info.id;
    const message = err instanceof Error ? err.message : String(err);
    this.log.error(`Processing "${entry.info.name}" failed: ${message}`);
    this.cancel(id);
    this.store.resetAnalysis(entry);
    entry.info.status = 'error';
    entry.info.error = message;
    await fs.rm(this.store.framesDir(id), RM_OPTIONS).catch(() => undefined);
    await this.store.persistMeta(entry).catch(() => undefined);
    this.broadcastVideo(entry);
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await (this.readyGate ?? this.model.load());
      for (;;) {
        await this.yieldToIngest(() => false);
        if (this.previewQueue.length > 0) continue;
        const id = this.fullQueue.shift();
        if (id === undefined) break;
        const entry = this.store.get(id);
        if (!entry || entry.cancelled) continue;
        this.current = { id, extraction: null };
        const started = Date.now();
        try {
          await this.process(entry, started);
          entry.info.status = 'ready';
          entry.info.progress = 1;
          entry.info.processingMs = Date.now() - started;
          await this.store.persist(entry, this.model.dim);
          this.log.info(
            `Indexed "${entry.info.name}": ${entry.info.framesIndexed} frames, ${entry.info.sceneCount} scenes in ${(entry.info.processingMs / 1000).toFixed(1)} s`,
          );
          this.current = null;
          this.store.version++;
          this.broadcastVideo(entry);
          this.hooks.onRecordingReady?.(entry);
        } catch (err: unknown) {
          this.current = null;
          if (entry.cancelled || err instanceof CancelledError) continue;
          await this.fail(entry, err);
        }
      }
    } catch (err: unknown) {
      this.log.error(`Pipeline stopped: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.running = false;
      this.current = null;
    }
  }

  // ------------------------------------------------------------------ preview pass

  /** Embeds a handful of keyframes for every waiting video. */
  private async runPreviews(): Promise<void> {
    const { model, store } = this;
    const size = model.imageSize;
    const plane = 3 * size * size;
    const dim = model.dim;
    const decodeConcurrency = Math.max(2, os.availableParallelism());

    while (this.previewQueue.length > 0) {
      const ids = this.previewQueue.splice(0, PREVIEW_CHUNK);
      const chunkStart = Date.now();
      const prepared = (await mapLimit(ids, decodeConcurrency, (id) => this.preparePreview(id, size, plane))).filter(
        (p): p is PreparedPreview => p !== null,
      );

      const preparedAt = Date.now();
      // One flat list of frames so batches are filled across video boundaries.
      const flat = prepared.flatMap((p) => p.frames);
      const embeddings = new Float32Array(flat.length * dim);
      for (let start = 0; start < flat.length; start += config.batchSize) {
        const batch = flat.slice(start, start + config.batchSize);
        const pixels = new Float32Array(batch.length * plane);
        batch.forEach((frame, i) => pixels.set(frame.pixels, i * plane));
        embeddings.set(await model.embedPixels(pixels, batch.length), start * dim);
      }

      this.log.info(
        `Preview pass: ${prepared.length} videos, ${flat.length} frames; decode ${preparedAt - chunkStart} ms, embed ${Date.now() - preparedAt} ms`,
      );

      // Pictures from different videos must not collapse onto one vector.
      let identical = 0;
      for (let i = 1; i < flat.length; i++) {
        if (1 - dotAt(embeddings, (i - 1) * dim, embeddings, i * dim, dim) < IDENTICAL_DISTANCE) identical++;
      }
      if (flat.length >= 3 && identical === flat.length - 1) {
        for (const item of prepared) await this.fail(item.entry, new Error(DEGENERATE_MESSAGE));
        continue;
      }

      let offset = 0;
      for (const item of prepared) {
        const { entry } = item;
        const count = item.frames.length;
        const vectors = embeddings.slice(offset * dim, (offset + count) * dim);
        offset += count;
        // The video may have been deleted, or its dense pass may have finished, in the meantime.
        if (entry.cancelled || entry.info.status !== 'queued' || !store.get(entry.info.id)) continue;

        const segment = item.durationSec !== null ? item.durationSec / count : 1;
        entry.frames = item.frames.map((f, i): FrameRecord => (f.faces ? { n: f.n, t: f.time, s: i, f: f.faces } : { n: f.n, t: f.time, s: i }));
        entry.info.facesMasked = item.frames.reduce((sum, f) => sum + (f.faces?.length ?? 0), 0);
        entry.scenes = item.frames.map((f, i): SceneRecord => {
          const tags = this.vocabulary
            ? this.topTags(this.scoreLabels(vectors, i * dim, 1, this.vocabulary), this.vocabulary, MAX_TAGS_PER_SCENE)
            : [];
          return {
            index: i,
            start: item.durationSec !== null ? i * segment : f.time,
            end: item.durationSec !== null ? (i + 1) * segment : f.time + 1,
            firstFrame: i,
            lastFrame: i,
            keyframe: i,
            tags,
          };
        });
        entry.embeddings = GrowableMatrix.fromData(vectors, dim);
        entry.info.durationSec = item.durationSec;
        entry.info.frameWidth = item.width;
        entry.info.frameHeight = item.height;
        entry.info.tilesPerFrame = 1;
        entry.info.framesIndexed = count;
        entry.info.sceneCount = count;
        entry.info.coarse = true;
        store.version++;
        this.broadcastVideo(entry);
      }
    }
  }

  /** Probes one video, grabs its keyframes and preprocesses them for the model. */
  private async preparePreview(id: string, size: number, plane: number): Promise<PreparedPreview | null> {
    const { store, model } = this;
    const entry = store.get(id);
    if (!entry || entry.cancelled) return null;
    try {
      const framesDir = store.framesDir(id);
      await fs.mkdir(framesDir, { recursive: true });
      const probe = await probeVideo(store.sourcePath(entry));
      if (!probe.hasVideo) throw new Error('Die Datei enthält keine Videospur.');
      const duration = probe.durationSec;
      const count =
        duration === null ? 1 : Math.max(1, Math.min(PREVIEW_MAX_FRAMES, Math.round(duration / PREVIEW_SECONDS_PER_FRAME)));
      const requests = Array.from({ length: count }, (_, i) => ({
        n: PREVIEW_FRAME_OFFSET + i + 1,
        time: duration === null ? 0 : (duration * (i + 0.5)) / count,
      }));

      const grab = (list: typeof requests): Promise<void> =>
        extractKeyframes(
          store.sourcePath(entry),
          list.map((r) => ({ time: r.time, outputPath: store.framePath(id, r.n) })),
          config.frameWidth,
        );
      await grab(requests);

      const frames: PreparedPreview['frames'] = [];
      let width = 0;
      let height = 0;
      const load = async (request: (typeof requests)[number]): Promise<void> => {
        let decoded: DecodedFrame;
        try {
          decoded = await decodeFrame(store.framePath(id, request.n));
        } catch {
          return; // No keyframe after this timestamp, so ffmpeg wrote no picture for it.
        }
        if (width === 0) {
          width = decoded.width;
          height = decoded.height;
        } else if (decoded.width !== width || decoded.height !== height) {
          return;
        }
        const pixels = new Float32Array(plane);
        const full: PixelRect = { left: 0, top: 0, width: decoded.width, height: decoded.height };
        await writeTile(decoded, full, size, model.imageMean, model.imageStd, pixels, 0);
        const faces = await this.maskFaces(id, request.n, decoded);
        frames.push({ n: request.n, time: request.time, pixels, faces });
      };
      for (const request of requests) await load(request);

      if (frames.length === 0) {
        // Short clips often have their only keyframe at the start; that one is always reachable.
        const first = { n: PREVIEW_FRAME_OFFSET + 1, time: 0 };
        await grab([first]);
        await load(first);
      }
      if (frames.length === 0) throw new Error('Aus dem Video konnten keine Bilder extrahiert werden.');
      return { entry, durationSec: duration, width, height, frames };
    } catch (err: unknown) {
      if (!entry.cancelled) await this.fail(entry, err);
      return null;
    }
  }

  // ------------------------------------------------------------------ dense pass

  private async process(entry: VideoEntry, started: number): Promise<void> {
    const { store, model } = this;
    const id = entry.info.id;
    const dim = model.dim;
    const fps = entry.info.sampleFps;
    const framesDir = store.framesDir(id);

    entry.info.status = 'processing';
    entry.info.error = null;
    entry.info.progress = 0;
    entry.info.framesSeen = 0;
    this.broadcastVideo(entry);

    // Results are built in a draft and swapped in at the end, so the preview index of this
    // video stays searchable while the dense pass is running.
    const draft: VideoEntry = {
      info: { ...entry.info, facesMasked: 0 },
      sourceFile: entry.sourceFile,
      frames: [],
      scenes: [],
      embeddings: null,
      cancelled: false,
    };

    await fs.mkdir(framesDir, { recursive: true });
    const isPreviewFile = (name: string): boolean => Number.parseInt(name, 10) > PREVIEW_FRAME_OFFSET;
    for (const name of await fs.readdir(framesDir)) {
      // Left-overs of an interrupted earlier run; the preview frames are still referenced.
      if (!isPreviewFile(name)) await fs.rm(path.join(framesDir, name), RM_OPTIONS);
    }

    const probe = await probeVideo(store.sourcePath(entry));
    if (!probe.hasVideo) throw new Error('Die Datei enthält keine Videospur.');
    draft.info.durationSec = probe.durationSec;
    const expectedFrames = probe.durationSec !== null ? Math.max(1, Math.ceil(probe.durationSec * fps)) : null;

    const extraction = extractFrames({
      inputPath: store.sourcePath(entry),
      outputPattern: `${framesDir}/%07d.jpg`,
      fps,
      maxWidth: config.frameWidth,
    });
    if (this.current) this.current.extraction = extraction;

    const thresholds = SCENE_THRESHOLDS[model.family];
    const size = model.imageSize;
    const plane = 3 * size * size;
    const vocabulary = this.vocabulary;

    let layout: PixelRect[] | null = null;
    let normTiles: NormRect[] = [];
    let tilesPerFrame = 0;
    let lastSignature: Uint8Array | null = null;
    let previousFull: Float32Array | null = null;
    const state: { open: OpenScene | null } = { open: null };
    const idleLimit = Math.max(IDLE_GAP_SEC, 2.5 / fps);
    let msPerFrame = 0;
    let lastBroadcast = 0;
    let next = 1;
    let identicalStreak = 0;

    const closeScene = (): void => {
      const open = state.open;
      if (!open) return;
      const scene = open.record;
      // Keyframe: the frame closest to the scene centroid.
      let best = scene.firstFrame;
      let bestDot = -Infinity;
      const emb = draft.embeddings;
      if (emb) {
        for (let f = scene.firstFrame; f <= scene.lastFrame; f++) {
          const d = dotAt(emb.data, f * tilesPerFrame * dim, open.sum, 0, dim);
          if (d > bestDot) {
            bestDot = d;
            best = f;
          }
        }
      }
      scene.keyframe = best;
      if (vocabulary) scene.tags = this.topTags(open.labelMax, vocabulary, MAX_TAGS_PER_SCENE);
      this.hub.broadcast({ type: 'scene', scene: store.sceneInfo(draft, scene) });
      state.open = null;
    };

    try {
      for (;;) {
        if (entry.cancelled) throw new CancelledError();
        // Newly uploaded videos get their preview before this dense pass continues.
        await this.yieldToIngest(() => entry.cancelled);

        const available = extraction.available();
        if (next > available) {
          if (extraction.finished()) break;
          await extraction.waitForProgress();
          continue;
        }

        // Decode a batch of frames and drop the ones that are identical to their predecessor.
        const framesPerBatch = tilesPerFrame > 0 ? Math.max(1, Math.floor(config.batchSize / tilesPerFrame)) : 1;
        const batchEnd = Math.min(available, next + framesPerBatch - 1);
        const kept: (PendingFrame & { decoded: DecodedFrame })[] = [];
        const events: FrameEvent[] = [];
        for (let n = next; n <= batchEnd; n++) {
          const time = (n - 1) / fps;
          const decoded = await decodeFrame(store.framePath(id, n));
          if (!layout) {
            layout = tileLayout(decoded.width, decoded.height, entry.info.detail);
            tilesPerFrame = layout.length;
            normTiles = layout.map((r) => toNormRect(r, decoded.width, decoded.height));
            draft.info.frameWidth = decoded.width;
            draft.info.frameHeight = decoded.height;
            draft.info.tilesPerFrame = tilesPerFrame;
            draft.embeddings = new GrowableMatrix(dim, Math.max(64, (expectedFrames ?? 256) * tilesPerFrame));
          } else if (decoded.width !== draft.info.frameWidth || decoded.height !== draft.info.frameHeight) {
            throw new Error('Die Bildgröße ändert sich innerhalb des Videos; das wird nicht unterstützt.');
          }
          const signature = await frameSignature(decoded);
          const isDuplicate: boolean =
            lastSignature !== null && isStaticDuplicate(signatureDelta(signature, lastSignature));
          entry.info.framesSeen = n;
          if (isDuplicate) {
            // Nothing changed since the last indexed frame: skip the embedding. The scene is
            // extended over short pauses only; a long pause ends it (see IDLE_GAP_SEC).
            const lastKept = draft.frames[draft.frames.length - 1];
            if (state.open && lastKept && time - lastKept.t <= idleLimit) state.open.record.end = time + 1 / fps;
            events.push({
              videoId: id,
              frameNumber: n,
              time,
              url: lastKept ? frameUrl(id, lastKept.n) : '',
              skipped: true,
              distance: 0,
              drift: 0,
              cut: false,
              sceneIndex: state.open ? state.open.record.index : 0,
              tags: [],
              fingerprint: [],
              tiles: [],
              msPerFrame,
            });
            await fs.rm(store.framePath(id, n), { force: true, maxRetries: 8, retryDelay: 150 });
            continue;
          }
          lastSignature = signature;
          kept.push({ n, time, decoded });
        }
        next = batchEnd + 1;

        if (kept.length > 0 && layout && draft.embeddings) {
          const tiles: PixelRect[] = layout;
          const pixels = new Float32Array(kept.length * tilesPerFrame * plane);
          await Promise.all(
            kept.flatMap((frame, f) =>
              tiles.map((rect, t) =>
                writeTile(frame.decoded, rect, size, model.imageMean, model.imageStd, pixels, (f * tilesPerFrame + t) * plane),
              ),
            ),
          );
          // The model sees the extracted pixels; what is stored for viewing has faces masked.
          const masked = await Promise.all(kept.map((frame) => this.maskFaces(id, frame.n, frame.decoded)));
          const inferStart = Date.now();
          const embedded = await model.embedPixels(pixels, kept.length * tilesPerFrame);
          const perFrame = (Date.now() - inferStart) / kept.length;
          msPerFrame = msPerFrame === 0 ? perFrame : msPerFrame * 0.8 + perFrame * 0.2;
          if (entry.cancelled) throw new CancelledError();

          for (let f = 0; f < kept.length; f++) {
            const frame = kept[f] as PendingFrame;
            const rowOffset = f * tilesPerFrame * dim;
            const full = embedded.subarray(rowOffset, rowOffset + dim);

            const distance = previousFull ? 1 - dotAt(full, 0, previousFull, 0, dim) : 0;
            identicalStreak = previousFull && distance < IDENTICAL_DISTANCE ? identicalStreak + 1 : 0;
            if (identicalStreak >= IDENTICAL_FRAMES_LIMIT) throw new Error(DEGENERATE_MESSAGE);
            let drift = 0;
            const currentScene = state.open;
            if (currentScene) {
              let norm = 0;
              for (let i = 0; i < dim; i++) norm += (currentScene.sum[i] as number) ** 2;
              drift = 1 - dotAt(full, 0, currentScene.sum, 0, dim) / Math.sqrt(norm || 1);
            }
            const previousFrame = draft.frames[draft.frames.length - 1];
            const idleGap = previousFrame !== undefined && frame.time - previousFrame.t > idleLimit;
            const tooLong = currentScene !== null && frame.time - currentScene.record.start >= MAX_SCENE_SEC;
            const cut =
              currentScene === null || distance > thresholds.cut || drift > thresholds.drift || idleGap || tooLong;
            let scene: OpenScene;
            if (cut || currentScene === null) {
              closeScene();
              const record: SceneRecord = {
                index: draft.scenes.length,
                start: frame.time,
                end: frame.time + 1 / fps,
                firstFrame: draft.frames.length,
                lastFrame: draft.frames.length,
                keyframe: draft.frames.length,
                tags: [],
              };
              draft.scenes.push(record);
              scene = {
                record,
                sum: new Float32Array(dim),
                labelMax: new Float32Array(vocabulary ? vocabulary.labels.length : 0).fill(-1),
              };
              state.open = scene;
            } else {
              scene = currentScene;
            }
            scene.record.lastFrame = draft.frames.length;
            scene.record.end = frame.time + 1 / fps;
            for (let i = 0; i < dim; i++) scene.sum[i] = (scene.sum[i] as number) + (full[i] as number);

            const faceBoxes = masked[f];
            draft.frames.push(
              faceBoxes
                ? { n: frame.n, t: frame.time, s: scene.record.index, f: faceBoxes }
                : { n: frame.n, t: frame.time, s: scene.record.index },
            );
            if (faceBoxes) draft.info.facesMasked += faceBoxes.length;
            draft.embeddings.append(embedded, rowOffset, tilesPerFrame);

            let tags: Tag[] = [];
            if (vocabulary) {
              const labelScores = this.scoreLabels(embedded, rowOffset, tilesPerFrame, vocabulary);
              for (let l = 0; l < labelScores.length; l++) {
                if ((labelScores[l] as number) > (scene.labelMax[l] as number)) scene.labelMax[l] = labelScores[l] as number;
              }
              tags = this.topTags(labelScores, vocabulary, MAX_TAGS_PER_FRAME);
            }

            const fingerprint: number[] = [];
            const gain = Math.sqrt(dim) / 2.5;
            for (let i = 0; i < FINGERPRINT_SIZE; i++) {
              const v = Math.max(-1, Math.min(1, (full[i] as number) * gain));
              fingerprint.push(Math.round(v * 100) / 100);
            }

            events.push({
              videoId: id,
              frameNumber: frame.n,
              time: frame.time,
              url: frameUrl(id, frame.n),
              skipped: false,
              distance: Math.round(distance * 1000) / 1000,
              drift: Math.round(drift * 1000) / 1000,
              cut,
              sceneIndex: scene.record.index,
              tags,
              fingerprint,
              tiles: normTiles,
              msPerFrame: Math.round(msPerFrame),
            });
            previousFull = new Float32Array(full);
          }
        }

        events.sort((a, b) => a.frameNumber - b.frameNumber);
        if (events.length > 0) this.hub.broadcast({ type: 'frames', frames: events });

        entry.info.processingMs = Date.now() - started;
        entry.info.progress =
          expectedFrames !== null ? Math.min(0.99, entry.info.framesSeen / expectedFrames) : extraction.finished() ? 0.99 : 0.5;
        const now = Date.now();
        if (now - lastBroadcast > 400) {
          lastBroadcast = now;
          this.broadcastVideo(entry);
        }
      }

      await extraction.done;
      closeScene();
      if (draft.frames.length === 0) throw new Error('Aus dem Video konnten keine Bilder extrahiert werden.');
    } catch (err: unknown) {
      extraction.kill();
      throw err;
    }
    if (entry.cancelled) throw new CancelledError();

    // Swap the dense index in for the preview index.
    entry.frames = draft.frames;
    entry.scenes = draft.scenes;
    entry.embeddings = draft.embeddings;
    entry.info.durationSec = draft.info.durationSec;
    entry.info.frameWidth = draft.info.frameWidth;
    entry.info.frameHeight = draft.info.frameHeight;
    entry.info.tilesPerFrame = draft.info.tilesPerFrame;
    entry.info.framesIndexed = draft.frames.length;
    entry.info.sceneCount = draft.scenes.length;
    entry.info.facesMasked = draft.info.facesMasked;
    entry.info.coarse = false;
    store.version++;
    for (const name of await fs.readdir(framesDir)) {
      if (isPreviewFile(name)) await fs.rm(path.join(framesDir, name), RM_OPTIONS).catch(() => undefined);
    }
  }

  /** Best similarity per vocabulary label over all tiles of one frame. */
  private scoreLabels(
    embedded: Float32Array,
    rowOffset: number,
    tilesPerFrame: number,
    vocabulary: VocabularyIndex,
  ): Float32Array {
    const { embeddings, dim, labels } = vocabulary;
    const scores = new Float32Array(labels.length);
    for (let l = 0; l < labels.length; l++) {
      let best = -1;
      for (let t = 0; t < tilesPerFrame; t++) {
        const s = dotAt(embedded, rowOffset + t * dim, embeddings, l * dim, dim);
        if (s > best) best = s;
      }
      scores[l] = best;
    }
    return scores;
  }

  private topTags(scores: Float32Array, vocabulary: VocabularyIndex, limit: number): Tag[] {
    const calibration = TAG_CALIBRATION[this.model.family];
    const order = Array.from(scores.keys()).sort((a, b) => (scores[b] as number) - (scores[a] as number));
    const tags: Tag[] = [];
    for (const idx of order.slice(0, limit)) {
      const p = sigmoid(((scores[idx] as number) - calibration.center) * calibration.slope);
      if (p < 0.15 && tags.length >= 2) break;
      tags.push({ label: vocabulary.labels[idx] as string, p: Math.round(p * 1000) / 1000 });
    }
    return tags;
  }
}
