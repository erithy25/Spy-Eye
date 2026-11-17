import fs from 'node:fs/promises';
import { config } from './config.js';
import type { EventHub } from './events.js';
import { extractFrames, probeVideo, type FrameExtraction } from './media/ffmpeg.js';
import { GrowableMatrix, dotAt, sigmoid } from './ml/math.js';
import type { EmbeddingModel } from './ml/model.js';
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
import { frameUrl, type SceneRecord, type Store, type VideoEntry } from './store.js';
import type { FrameEvent, NormRect, Tag } from './types.js';

/** Scene segmentation thresholds on cosine distance between whole-frame embeddings. */
const SCENE_THRESHOLDS = {
  siglip: { cut: 0.28, drift: 0.36 },
  clip: { cut: 0.22, drift: 0.28 },
} as const;

/** Operating point for turning a label similarity into a display confidence. */
const TAG_CALIBRATION = {
  siglip: { center: 0.07, slope: 80 },
  clip: { center: 0.255, slope: 80 },
} as const;

/**
 * Continuous footage (CCTV, dashcams) has no hard cuts. Two extra rules split it into useful
 * segments: a pause in activity starts a new scene, and no scene runs longer than the maximum.
 */
const IDLE_GAP_SEC = 2.5;
const MAX_SCENE_SEC = 30;

const FINGERPRINT_SIZE = 64;
const MAX_TAGS_PER_FRAME = 5;
const MAX_TAGS_PER_SCENE = 6;

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

class CancelledError extends Error {}

/** Sequential background worker that turns uploaded videos into searchable scenes. */
export class Pipeline {
  private readonly queue: string[] = [];
  private running = false;
  private current: { id: string; extraction: FrameExtraction | null } | null = null;
  private vocabulary: VocabularyIndex | null = null;
  private readyGate: Promise<void> | null = null;

  constructor(
    private readonly store: Store,
    private readonly model: EmbeddingModel,
    private readonly hub: EventHub,
    private readonly log: Logger,
  ) {}

  setVocabulary(vocabulary: VocabularyIndex): void {
    this.vocabulary = vocabulary;
  }

  /** Processing waits for this promise (model and vocabulary initialisation) before it starts. */
  setReadyGate(gate: Promise<void>): void {
    this.readyGate = gate;
    gate.catch(() => undefined);
  }

  get queueLength(): number {
    return this.queue.length + (this.current ? 1 : 0);
  }

  enqueue(id: string): void {
    if (this.queue.includes(id) || this.current?.id === id) return;
    this.queue.push(id);
    void this.drain();
  }

  /** Stops work on a video that is being deleted. */
  cancel(id: string): void {
    const idx = this.queue.indexOf(id);
    if (idx >= 0) this.queue.splice(idx, 1);
    if (this.current?.id === id) this.current.extraction?.kill();
  }

  shutdown(): void {
    this.queue.length = 0;
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

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const id = this.queue.shift();
        if (id === undefined) break;
        const entry = this.store.get(id);
        if (!entry || entry.cancelled) continue;
        this.current = { id, extraction: null };
        const started = Date.now();
        try {
          await (this.readyGate ?? this.model.load());
          await this.process(entry, started);
          entry.info.status = 'ready';
          entry.info.progress = 1;
          entry.info.processingMs = Date.now() - started;
          await this.store.persist(entry, this.model.dim);
          this.log.info(
            `Indexed "${entry.info.name}": ${entry.info.framesIndexed} frames, ${entry.info.sceneCount} scenes in ${(entry.info.processingMs / 1000).toFixed(1)} s`,
          );
        } catch (err: unknown) {
          if (entry.cancelled || err instanceof CancelledError) {
            this.current = null;
            continue;
          }
          const message = err instanceof Error ? err.message : String(err);
          this.log.error(`Processing "${entry.info.name}" failed: ${message}`);
          this.store.resetAnalysis(entry);
          entry.info.status = 'error';
          entry.info.error = message;
          await fs.rm(this.store.framesDir(id), { recursive: true, force: true }).catch(() => undefined);
          await this.store.persistMeta(entry).catch(() => undefined);
        }
        this.current = null;
        this.store.version++;
        if (!entry.cancelled) this.broadcastVideo(entry);
      }
    } finally {
      this.running = false;
      this.current = null;
    }
  }

  private async process(entry: VideoEntry, started: number): Promise<void> {
    const { store, model } = this;
    const id = entry.info.id;
    const dim = model.dim;
    const fps = entry.info.sampleFps;
    const framesDir = store.framesDir(id);

    store.resetAnalysis(entry);
    entry.info.status = 'processing';
    this.broadcastVideo(entry);

    await fs.rm(framesDir, { recursive: true, force: true });
    await fs.mkdir(framesDir, { recursive: true });

    const probe = await probeVideo(store.sourcePath(entry));
    if (!probe.hasVideo) throw new Error('Die Datei enthält keine Videospur.');
    entry.info.durationSec = probe.durationSec;
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

    const closeScene = (): void => {
      const open = state.open;
      if (!open) return;
      const scene = open.record;
      // Keyframe: the frame closest to the scene centroid.
      let best = scene.firstFrame;
      let bestDot = -Infinity;
      const emb = entry.embeddings;
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
      this.hub.broadcast({ type: 'scene', scene: store.sceneInfo(entry, scene) });
      state.open = null;
    };

    try {
      for (;;) {
        if (entry.cancelled) throw new CancelledError();
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
            entry.info.frameWidth = decoded.width;
            entry.info.frameHeight = decoded.height;
            entry.info.tilesPerFrame = tilesPerFrame;
            entry.embeddings = new GrowableMatrix(dim, Math.max(64, (expectedFrames ?? 256) * tilesPerFrame));
          } else if (decoded.width !== entry.info.frameWidth || decoded.height !== entry.info.frameHeight) {
            throw new Error('Die Bildgröße ändert sich innerhalb des Videos; das wird nicht unterstützt.');
          }
          const signature = await frameSignature(decoded);
          const isDuplicate: boolean =
            lastSignature !== null && isStaticDuplicate(signatureDelta(signature, lastSignature));
          entry.info.framesSeen = n;
          if (isDuplicate) {
            // Nothing changed since the last indexed frame: skip the embedding. The scene is
            // extended over short pauses only; a long pause ends it (see IDLE_GAP_SEC).
            const lastKept = entry.frames[entry.frames.length - 1];
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
            await fs.rm(store.framePath(id, n), { force: true });
            continue;
          }
          lastSignature = signature;
          kept.push({ n, time, decoded });
        }
        next = batchEnd + 1;

        if (kept.length > 0 && layout && entry.embeddings) {
          const tiles: PixelRect[] = layout;
          const pixels = new Float32Array(kept.length * tilesPerFrame * plane);
          await Promise.all(
            kept.flatMap((frame, f) =>
              tiles.map((rect, t) =>
                writeTile(frame.decoded, rect, size, model.imageMean, model.imageStd, pixels, (f * tilesPerFrame + t) * plane),
              ),
            ),
          );
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
            let drift = 0;
            const currentScene = state.open;
            if (currentScene) {
              let norm = 0;
              for (let i = 0; i < dim; i++) norm += (currentScene.sum[i] as number) ** 2;
              drift = 1 - dotAt(full, 0, currentScene.sum, 0, dim) / Math.sqrt(norm || 1);
            }
            const previousFrame = entry.frames[entry.frames.length - 1];
            const idleGap = previousFrame !== undefined && frame.time - previousFrame.t > idleLimit;
            const tooLong = currentScene !== null && frame.time - currentScene.record.start >= MAX_SCENE_SEC;
            const cut =
              currentScene === null || distance > thresholds.cut || drift > thresholds.drift || idleGap || tooLong;
            let scene: OpenScene;
            if (cut || currentScene === null) {
              closeScene();
              const record: SceneRecord = {
                index: entry.scenes.length,
                start: frame.time,
                end: frame.time + 1 / fps,
                firstFrame: entry.frames.length,
                lastFrame: entry.frames.length,
                keyframe: entry.frames.length,
                tags: [],
              };
              entry.scenes.push(record);
              scene = {
                record,
                sum: new Float32Array(dim),
                labelMax: new Float32Array(vocabulary ? vocabulary.labels.length : 0).fill(-1),
              };
              state.open = scene;
            } else {
              scene = currentScene;
            }
            scene.record.lastFrame = entry.frames.length;
            scene.record.end = frame.time + 1 / fps;
            for (let i = 0; i < dim; i++) scene.sum[i] = (scene.sum[i] as number) + (full[i] as number);

            entry.frames.push({ n: frame.n, t: frame.time, s: scene.record.index });
            entry.embeddings.append(embedded, rowOffset, tilesPerFrame);

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
          entry.info.framesIndexed = entry.frames.length;
          entry.info.sceneCount = entry.scenes.length;
          store.version++;
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
      if (entry.frames.length === 0) throw new Error('Aus dem Video konnten keine Bilder extrahiert werden.');
    } catch (err: unknown) {
      extraction.kill();
      throw err;
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
