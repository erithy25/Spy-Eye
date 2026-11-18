import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { GrowableMatrix } from './ml/math.js';
import { tileLayout, type PixelRect } from './ml/preprocess.js';
import type { DetailLevel, SceneInfo, Stats, Tag, VideoInfo } from './types.js';

export interface FrameRecord {
  /** Sequential number of the extracted frame (1-based); also the JPEG file name. */
  n: number;
  /** Timestamp in seconds. */
  t: number;
  /** Index of the scene this frame belongs to. */
  s: number;
}

export interface SceneRecord {
  index: number;
  start: number;
  end: number;
  /** Indices into `frames` (inclusive range). */
  firstFrame: number;
  lastFrame: number;
  /** Index into `frames` of the most representative frame. */
  keyframe: number;
  tags: Tag[];
}

export interface VideoEntry {
  info: VideoInfo;
  /** File name of the uploaded source inside the video directory. */
  sourceFile: string;
  frames: FrameRecord[];
  scenes: SceneRecord[];
  /** `frames.length * tilesPerFrame` rows of `dim` floats; null until the first frame is embedded. */
  embeddings: GrowableMatrix | null;
  /** Set when the video is deleted while being processed. */
  cancelled: boolean;
}

interface PersistedMeta {
  version: 1;
  modelId: string;
  modelDtype: string;
  dim: number;
  info: VideoInfo;
  sourceFile: string;
  frames: FrameRecord[];
  scenes: SceneRecord[];
}

const ID_PATTERN = /^[a-f0-9]{16}$/;
const IDENTICAL_FRAMES_MIN = 4;
const PLAYABLE_EXTENSIONS = new Set(['.mp4', '.m4v', '.webm', '.mov', '.ogv']);

/** Removal options that tolerate short-lived file locks (Windows releases handles lazily). */
export const RM_OPTIONS = { recursive: true, force: true, maxRetries: 8, retryDelay: 150 } as const;

export function isValidVideoId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function frameFileName(n: number): string {
  return `${String(n).padStart(7, '0')}.jpg`;
}

export function frameUrl(videoId: string, n: number): string {
  // Relative on purpose: the client resolves it against its own base URL, so the app also works
  // behind a reverse proxy that serves it under a path prefix.
  return `media/${videoId}/frames/${frameFileName(n)}`;
}

export function sceneId(videoId: string, index: number): string {
  return `${videoId}:${index}`;
}

async function writeFileAtomic(file: string, data: string | Buffer): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

/** On-disk dataset plus the in-memory vector index. No database, no external service. */
export class Store {
  private readonly entries = new Map<string, VideoEntry>();
  private readonly layouts = new Map<string, PixelRect[]>();
  /** Incremented whenever searchable content changes (used for cache invalidation). */
  version = 0;

  get videosDir(): string {
    return path.join(config.dataDir, 'videos');
  }

  videoDir(id: string): string {
    return path.join(this.videosDir, id);
  }

  framesDir(id: string): string {
    return path.join(this.videoDir(id), 'frames');
  }

  framePath(id: string, n: number): string {
    return path.join(this.framesDir(id), frameFileName(n));
  }

  sourcePath(entry: VideoEntry): string {
    return path.join(this.videoDir(entry.info.id), entry.sourceFile);
  }

  get(id: string): VideoEntry | undefined {
    return this.entries.get(id);
  }

  all(): VideoEntry[] {
    return [...this.entries.values()].sort((a, b) => a.info.createdAt - b.info.createdAt);
  }

  infos(): VideoInfo[] {
    return this.all().map((e) => e.info);
  }

  /** Tile rectangles (pixel coordinates) for a video's frames. */
  layout(entry: VideoEntry): PixelRect[] {
    const { id, frameWidth, frameHeight, detail } = entry.info;
    const key = `${id}:${frameWidth}x${frameHeight}:${detail}`;
    let layout = this.layouts.get(key);
    if (!layout) {
      layout = tileLayout(frameWidth, frameHeight, detail);
      this.layouts.set(key, layout);
    }
    return layout;
  }

  stats(): Stats {
    let scenes = 0;
    let frames = 0;
    let vectors = 0;
    let indexBytes = 0;
    for (const e of this.entries.values()) {
      scenes += e.scenes.length;
      frames += e.frames.length;
      if (e.embeddings) {
        vectors += e.embeddings.rows;
        indexBytes += e.embeddings.rows * e.embeddings.dim * 4;
      }
    }
    return { videos: this.entries.size, scenes, frames, vectors, indexBytes };
  }

  /** Creates the directory for a new upload and returns its id. */
  async allocate(): Promise<string> {
    await fs.mkdir(this.videosDir, { recursive: true });
    for (;;) {
      const id = randomBytes(8).toString('hex');
      if (this.entries.has(id)) continue;
      try {
        await fs.mkdir(this.videoDir(id));
        return id;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
    }
  }

  register(params: {
    id: string;
    name: string;
    sourceFile: string;
    sizeBytes: number;
    sampleFps: number;
    detail: DetailLevel;
  }): VideoEntry {
    const ext = path.extname(params.sourceFile).toLowerCase();
    const entry: VideoEntry = {
      info: {
        id: params.id,
        name: params.name,
        sizeBytes: params.sizeBytes,
        status: 'queued',
        error: null,
        createdAt: Date.now(),
        durationSec: null,
        frameWidth: 0,
        frameHeight: 0,
        sampleFps: params.sampleFps,
        detail: params.detail,
        tilesPerFrame: 0,
        framesSeen: 0,
        framesIndexed: 0,
        sceneCount: 0,
        progress: 0,
        processingMs: 0,
        playable: PLAYABLE_EXTENSIONS.has(ext),
        coarse: false,
      },
      sourceFile: params.sourceFile,
      frames: [],
      scenes: [],
      embeddings: null,
      cancelled: false,
    };
    this.entries.set(params.id, entry);
    return entry;
  }

  /** Clears analysis results so the video can be processed from scratch. */
  resetAnalysis(entry: VideoEntry): void {
    entry.frames = [];
    entry.scenes = [];
    entry.embeddings = null;
    entry.info.framesSeen = 0;
    entry.info.framesIndexed = 0;
    entry.info.sceneCount = 0;
    entry.info.progress = 0;
    entry.info.processingMs = 0;
    entry.info.error = null;
    entry.info.coarse = false;
    this.version++;
  }

  async persist(entry: VideoEntry, dim: number): Promise<void> {
    const dir = this.videoDir(entry.info.id);
    const data = entry.embeddings ? entry.embeddings.view() : new Float32Array(0);
    await writeFileAtomic(
      path.join(dir, 'embeddings.f32'),
      Buffer.from(data.buffer, data.byteOffset, data.byteLength),
    );
    const meta: PersistedMeta = {
      version: 1,
      modelId: config.modelId,
      modelDtype: config.modelDtype,
      dim,
      info: entry.info,
      sourceFile: entry.sourceFile,
      frames: entry.frames,
      scenes: entry.scenes,
    };
    await writeFileAtomic(path.join(dir, 'meta.json'), JSON.stringify(meta));
  }

  /** Persists only the metadata (used for queued / failed videos so they survive a restart). */
  async persistMeta(entry: VideoEntry): Promise<void> {
    const meta: PersistedMeta = {
      version: 1,
      modelId: config.modelId,
      modelDtype: config.modelDtype,
      dim: 0,
      info: entry.info,
      sourceFile: entry.sourceFile,
      frames: [],
      scenes: [],
    };
    await writeFileAtomic(path.join(this.videoDir(entry.info.id), 'meta.json'), JSON.stringify(meta));
  }

  async remove(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.cancelled = true;
    this.entries.delete(id);
    this.version++;
    await fs.rm(this.videoDir(id), RM_OPTIONS);
    return true;
  }

  /**
   * Loads the dataset from disk. Returns the ids of videos that still need processing
   * (interrupted runs, or indexes built with a different model).
   */
  async load(log: (msg: string) => void): Promise<string[]> {
    await fs.mkdir(this.videosDir, { recursive: true });
    const pending: string[] = [];
    const dirs = await fs.readdir(this.videosDir, { withFileTypes: true });
    for (const dirent of dirs) {
      if (!dirent.isDirectory() || !isValidVideoId(dirent.name)) continue;
      const id = dirent.name;
      const dir = this.videoDir(id);
      let meta: PersistedMeta;
      try {
        meta = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8')) as PersistedMeta;
      } catch {
        // Upload was interrupted before the metadata was written: remove the leftovers.
        log(`Removing incomplete upload ${id}`);
        await fs.rm(dir, RM_OPTIONS);
        continue;
      }
      if (meta.version !== 1 || meta.info?.id !== id || typeof meta.sourceFile !== 'string') {
        log(`Skipping ${id}: unsupported metadata format`);
        continue;
      }
      try {
        await fs.access(path.join(dir, meta.sourceFile));
      } catch {
        log(`Skipping ${id}: source file is missing`);
        continue;
      }

      const entry: VideoEntry = {
        // `coarse` is absent in metadata written by earlier versions.
        info: { ...meta.info, coarse: false },
        sourceFile: meta.sourceFile,
        frames: meta.frames,
        scenes: meta.scenes,
        embeddings: null,
        cancelled: false,
      };
      this.entries.set(id, entry);

      const sameModel = meta.modelId === config.modelId && meta.modelDtype === config.modelDtype;
      if (meta.info.status === 'error') continue;
      if (meta.info.status !== 'ready' || !sameModel) {
        if (!sameModel) log(`Video ${id} was indexed with ${meta.modelId} (${meta.modelDtype}); re-indexing.`);
        this.resetAnalysis(entry);
        entry.info.status = 'queued';
        pending.push(id);
        continue;
      }

      try {
        const buf = await fs.readFile(path.join(dir, 'embeddings.f32'));
        const expected = meta.frames.length * meta.info.tilesPerFrame * meta.dim * 4;
        if (meta.dim <= 0 || buf.byteLength !== expected) {
          throw new Error(`embeddings.f32 has ${buf.byteLength} bytes, expected ${expected}`);
        }
        const data = new Float32Array(buf.byteLength / 4);
        Buffer.from(data.buffer).set(buf);
        entry.embeddings = GrowableMatrix.fromData(data, meta.dim);
      } catch (err: unknown) {
        log(`Index of ${id} is unreadable (${err instanceof Error ? err.message : String(err)}); re-indexing.`);
        this.resetAnalysis(entry);
        entry.info.status = 'queued';
        pending.push(id);
      }
    }
    this.version++;
    return pending.sort((a, b) => (this.get(a)?.info.createdAt ?? 0) - (this.get(b)?.info.createdAt ?? 0));
  }

  /**
   * Finds indexes whose vectors are all the same. They come from a broken execution provider and
   * make every search return identical scores, so they have to be rebuilt.
   */
  degenerateVideoIds(): string[] {
    const tolerance = 1e-6;
    const same = (a: Float32Array, aOff: number, b: Float32Array, bOff: number, dim: number): boolean => {
      let dot = 0;
      for (let i = 0; i < dim; i++) dot += (a[aOff + i] as number) * (b[bOff + i] as number);
      return 1 - dot < tolerance;
    };
    const ready = this.all().filter((e) => e.info.status === 'ready' && e.embeddings && e.embeddings.rows > 0);
    const ids = new Set<string>();

    // Within one video: first, middle and last indexed frame identical.
    for (const entry of ready) {
      const emb = entry.embeddings;
      const tiles = entry.info.tilesPerFrame;
      if (!emb || tiles <= 0 || entry.frames.length < IDENTICAL_FRAMES_MIN) continue;
      const row = (frame: number): number => frame * tiles * emb.dim;
      const last = entry.frames.length - 1;
      if (
        same(emb.data, row(0), emb.data, row(last), emb.dim) &&
        same(emb.data, row(0), emb.data, row(last >> 1), emb.dim)
      ) {
        ids.add(entry.info.id);
      }
    }

    // Across videos: every video starts with the same vector.
    const first = ready[0];
    if (first?.embeddings && ready.length >= 3) {
      const base = first.embeddings;
      const allSame = ready.every((e) => e.embeddings && e.embeddings.dim === base.dim && same(base.data, 0, e.embeddings.data, 0, base.dim));
      if (allSame) for (const e of ready) ids.add(e.info.id);
    }
    return [...ids];
  }

  sceneInfo(entry: VideoEntry, scene: SceneRecord): SceneInfo {
    const key = entry.frames[scene.keyframe] ?? entry.frames[scene.firstFrame];
    return {
      id: sceneId(entry.info.id, scene.index),
      videoId: entry.info.id,
      index: scene.index,
      start: scene.start,
      end: scene.end,
      frameCount: scene.lastFrame - scene.firstFrame + 1,
      keyframeUrl: key ? frameUrl(entry.info.id, key.n) : '',
      keyframeNumber: key ? key.n : 0,
      keyframeTime: key ? key.t : scene.start,
      tags: scene.tags,
    };
  }
}
