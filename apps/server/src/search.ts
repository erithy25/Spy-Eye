import { dotAt, pca2, sigmoid } from './ml/math.js';
import type { EmbeddingModel, ModelFamily } from './ml/model.js';
import { decodeFrame, explainWindows, toNormRect, writeTile, type PixelRect } from './ml/preprocess.js';
import { frameUrl, sceneId, type Store, type VideoEntry } from './store.js';
import type { ExplainResponse, MapPoint, MapResponse, NormRect, SearchResponse, SearchResult } from './types.js';

/**
 * Relevance calibration (cosine similarity space).
 *
 * Raw image-text similarities are not comparable across queries: "a wedding" and "street" have
 * very different baselines. The cut-off is therefore derived per query from the score
 * distribution of the dataset (robust median + k * sigma: a match has to stand out from the
 * rest) and clamped to an absolute band so it also behaves when nothing or everything matches.
 */
interface RelevanceCalibration {
  /** Below this similarity nothing counts as a match. */
  floor: number;
  /** At or above this similarity everything counts as a match. */
  ceiling: number;
  /** Cut-off used when the dataset is too small for meaningful statistics. */
  prior: number;
  /** Similarity distance that maps to one logit of confidence. */
  width: number;
  /** Number of robust standard deviations above the median. */
  k: number;
}

const RELEVANCE: Readonly<Record<ModelFamily, RelevanceCalibration>> = {
  siglip: { floor: 0.06, ceiling: 0.09, prior: 0.075, width: 0.012, k: 2.5 },
  clip: { floor: 0.24, ceiling: 0.285, prior: 0.27, width: 0.012, k: 2.5 },
  mobileclip: { floor: 0.225, ceiling: 0.26, prior: 0.245, width: 0.012, k: 2.5 },
};

const MIN_SCENES_FOR_STATS = 40;
const DISTRIBUTION_BINS = 40;

export class SearchError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'SearchError';
  }
}

interface SceneHit {
  entry: VideoEntry;
  sceneIndex: number;
  score: number;
  frameIdx: number;
  tileIdx: number;
}

function median(sorted: Float64Array): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = n >> 1;
  return n % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export class SearchEngine {
  private readonly explainCache = new Map<string, { windows: PixelRect[]; embeddings: Float32Array; width: number; height: number }>();
  private mapCache: MapResponse | null = null;

  constructor(
    private readonly store: Store,
    private readonly model: EmbeddingModel,
  ) {}

  /** Query-specific similarity cut-off for "this scene matches". */
  private cutoff(sceneScores: Float64Array): number {
    const cal = RELEVANCE[this.model.family];
    const n = sceneScores.length;
    if (n === 0) return cal.prior;
    const sorted = Float64Array.from(sceneScores).sort();
    const med = median(sorted);
    const deviations = Float64Array.from(sorted, (v) => Math.abs(v - med)).sort();
    const sigma = 1.4826 * median(deviations);
    const adaptive = Math.min(cal.ceiling, Math.max(cal.floor, med + cal.k * sigma));
    // Blend towards the prior for small datasets where the statistics are unreliable.
    const weight = Math.min(1, n / MIN_SCENES_FOR_STATS);
    return cal.prior * (1 - weight) + adaptive * weight;
  }

  async search(params: { query: string; limit: number; videoId: string | null }): Promise<SearchResponse> {
    const started = performance.now();
    if (!this.model.ready) throw new SearchError('Das Modell wird noch geladen.', 503);
    let queryVector: Float32Array;
    try {
      queryVector = await this.model.embedQuery(params.query);
    } catch (err: unknown) {
      throw new SearchError(err instanceof Error ? err.message : String(err), 500);
    }
    const embedMs = performance.now() - started;
    const dim = this.model.dim;

    const hits: SceneHit[] = [];
    let framesSearched = 0;
    let vectorsSearched = 0;

    for (const entry of this.store.all()) {
      if (params.videoId !== null && entry.info.id !== params.videoId) continue;
      const emb = entry.embeddings;
      const tiles = entry.info.tilesPerFrame;
      if (!emb || tiles <= 0 || emb.dim !== dim) continue;
      const frameCount = Math.min(entry.frames.length, Math.floor(emb.rows / tiles));
      const data = emb.data;
      const perScene = new Map<number, SceneHit>();
      for (let f = 0; f < frameCount; f++) {
        let best = -Infinity;
        let bestTile = 0;
        const base = f * tiles * dim;
        for (let t = 0; t < tiles; t++) {
          const raw = dotAt(data, base + t * dim, queryVector, 0, dim);
          const s = Number.isFinite(raw) ? raw : -1;
          if (s > best) {
            best = s;
            bestTile = t;
          }
        }
        const sceneIndex = (entry.frames[f] as { s: number }).s;
        const current = perScene.get(sceneIndex);
        if (!current || best > current.score) {
          perScene.set(sceneIndex, { entry, sceneIndex, score: best, frameIdx: f, tileIdx: bestTile });
        }
      }
      framesSearched += frameCount;
      vectorsSearched += frameCount * tiles;
      for (const hit of perScene.values()) hits.push(hit);
    }

    const cal = RELEVANCE[this.model.family];
    const cutoff = this.cutoff(Float64Array.from(hits, (h) => h.score));
    const confidenceOf = (score: number): number => sigmoid((score - cutoff) / cal.width);

    const distribution = new Array<number>(DISTRIBUTION_BINS).fill(0);
    const sceneScores: Record<string, number> = {};
    let matched = 0;
    for (const hit of hits) {
      const c = confidenceOf(hit.score);
      if (c >= 0.5) matched++;
      const bin = Math.min(DISTRIBUTION_BINS - 1, Math.floor(c * DISTRIBUTION_BINS));
      distribution[bin] = (distribution[bin] as number) + 1;
      sceneScores[sceneId(hit.entry.info.id, hit.sceneIndex)] = Math.round(c * 1000) / 1000;
    }

    hits.sort((a, b) => b.score - a.score);
    const results: SearchResult[] = [];
    for (const hit of hits.slice(0, params.limit)) {
      const { entry } = hit;
      const scene = entry.scenes[hit.sceneIndex];
      const frame = entry.frames[hit.frameIdx];
      if (!scene || !frame) continue;
      const layout = this.store.layout(entry);
      const tile = hit.tileIdx > 0 ? layout[hit.tileIdx] : undefined;
      results.push({
        sceneId: sceneId(entry.info.id, scene.index),
        videoId: entry.info.id,
        videoName: entry.info.name,
        sceneIndex: scene.index,
        start: scene.start,
        end: scene.end,
        frameCount: scene.lastFrame - scene.firstFrame + 1,
        frameNumber: frame.n,
        frameUrl: frameUrl(entry.info.id, frame.n),
        time: frame.t,
        score: Math.round(hit.score * 10000) / 10000,
        confidence: Math.round(confidenceOf(hit.score) * 1000) / 1000,
        box: tile ? toNormRect(tile, entry.info.frameWidth, entry.info.frameHeight) : null,
        tags: scene.tags,
        playable: entry.info.playable,
      });
    }

    return {
      query: params.query,
      tookMs: Math.round((performance.now() - started) * 10) / 10,
      embedMs: Math.round(embedMs * 10) / 10,
      scenesSearched: hits.length,
      framesSearched,
      vectorsSearched,
      threshold: Math.round(cutoff * 10000) / 10000,
      matched,
      results,
      distribution,
      sceneScores,
    };
  }

  /**
   * Localizes the query inside one frame: embeds a dense set of overlapping windows and
   * accumulates their similarity to the query into a relevance grid.
   */
  async explain(params: { videoId: string; frameNumber: number; query: string }): Promise<ExplainResponse> {
    const started = performance.now();
    if (!this.model.ready) throw new SearchError('Das Modell wird noch geladen.', 503);
    const entry = this.store.get(params.videoId);
    if (!entry) throw new SearchError('Video nicht gefunden.', 404);
    if (!entry.frames.some((f) => f.n === params.frameNumber)) throw new SearchError('Frame nicht gefunden.', 404);

    const key = `${params.videoId}:${params.frameNumber}`;
    let cached = this.explainCache.get(key);
    if (cached) {
      this.explainCache.delete(key);
      this.explainCache.set(key, cached);
    } else {
      const frame = await decodeFrame(this.store.framePath(params.videoId, params.frameNumber));
      const windows = explainWindows(frame.width, frame.height);
      const size = this.model.imageSize;
      const plane = 3 * size * size;
      const pixels = new Float32Array(windows.length * plane);
      await Promise.all(
        windows.map((rect, i) => writeTile(frame, rect, size, this.model.imageMean, this.model.imageStd, pixels, i * plane)),
      );
      const embeddings = await this.model.embedPixels(pixels, windows.length);
      cached = { windows, embeddings, width: frame.width, height: frame.height };
      this.explainCache.set(key, cached);
      if (this.explainCache.size > 128) {
        const oldest = this.explainCache.keys().next();
        if (!oldest.done) this.explainCache.delete(oldest.value);
      }
    }

    const queryVector = await this.model.embedQuery(params.query);
    const dim = this.model.dim;
    const { windows, embeddings, width, height } = cached;
    const scores = windows.map((_, i) => dotAt(embeddings, i * dim, queryVector, 0, dim));

    const cols = 32;
    const rows = Math.max(4, Math.round((cols * height) / width));
    const grid = new Array<number>(cols * rows).fill(0);
    let min = Infinity;
    let max = -Infinity;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = ((c + 0.5) / cols) * width;
        const py = ((r + 0.5) / rows) * height;
        let weightSum = 0;
        let valueSum = 0;
        for (let i = 0; i < windows.length; i++) {
          const w = windows[i] as PixelRect;
          const dx = Math.abs(px - (w.left + w.width / 2)) / (w.width / 2);
          const dy = Math.abs(py - (w.top + w.height / 2)) / (w.height / 2);
          if (dx >= 1 || dy >= 1) continue;
          // Tent weight: the centre of a window says more about a pixel than its border.
          const weight = (1 - dx) * (1 - dy) + 0.05;
          weightSum += weight;
          valueSum += weight * (scores[i] as number);
        }
        const value = weightSum > 0 ? valueSum / weightSum : 0;
        grid[r * cols + c] = value;
        if (value < min) min = value;
        if (value > max) max = value;
      }
    }
    const range = Math.max(1e-6, max - min);
    let peak = 0;
    for (let i = 0; i < grid.length; i++) {
      grid[i] = Math.round((((grid[i] as number) - min) / range) * 1000) / 1000;
      if ((grid[i] as number) > (grid[peak] as number)) peak = i;
    }

    const box = hotRegion(grid, cols, rows, peak, 0.8);
    const cal = RELEVANCE[this.model.family];
    const bestScore = Math.max(...scores);
    return {
      videoId: params.videoId,
      frameNumber: params.frameNumber,
      query: params.query,
      cols,
      rows,
      grid,
      box,
      peakConfidence: Math.round(sigmoid((bestScore - cal.prior) / cal.width) * 1000) / 1000,
      tookMs: Math.round(performance.now() - started),
    };
  }

  /** 2D projection (PCA) of one whole-frame embedding per scene. */
  map(): MapResponse {
    if (this.mapCache && this.mapCache.version === this.store.version) return this.mapCache;
    const dim = this.model.dim;
    const candidates: { entry: VideoEntry; sceneIndex: number; frameIdx: number }[] = [];
    for (const entry of this.store.all()) {
      const emb = entry.embeddings;
      if (!emb || emb.dim !== dim || entry.info.tilesPerFrame <= 0) continue;
      const maxFrame = Math.floor(emb.rows / entry.info.tilesPerFrame);
      for (const scene of entry.scenes) {
        if (scene.keyframe < maxFrame) candidates.push({ entry, sceneIndex: scene.index, frameIdx: scene.keyframe });
      }
    }
    const MAX_POINTS = 4000;
    const step = Math.max(1, Math.ceil(candidates.length / MAX_POINTS));
    const selected = candidates.filter((_, i) => i % step === 0);

    // Copy the selected whole-frame vectors into one contiguous matrix for the projection.
    const matrix = new Float32Array(selected.length * dim);
    const offsets: number[] = [];
    selected.forEach((c, i) => {
      const emb = c.entry.embeddings;
      if (!emb) return;
      const src = c.frameIdx * c.entry.info.tilesPerFrame * dim;
      matrix.set(emb.data.subarray(src, src + dim), i * dim);
      offsets.push(i * dim);
    });
    const { coords, explainedVariance } = pca2(matrix, dim, offsets);

    const points: MapPoint[] = selected.map((c, i) => {
      const scene = c.entry.scenes[c.sceneIndex];
      const frame = c.entry.frames[c.frameIdx];
      return {
        sceneId: sceneId(c.entry.info.id, c.sceneIndex),
        videoId: c.entry.info.id,
        x: Math.round((coords[i * 2] as number) * 1000) / 1000,
        y: Math.round((coords[i * 2 + 1] as number) * 1000) / 1000,
        keyframeUrl: frame ? frameUrl(c.entry.info.id, frame.n) : '',
        frameNumber: frame ? frame.n : 0,
        sceneIndex: c.sceneIndex,
        time: frame ? frame.t : 0,
        label: scene?.tags[0]?.label ?? '',
      };
    });
    this.mapCache = { version: this.store.version, points, explainedVariance: Math.round(explainedVariance * 1000) / 1000 };
    return this.mapCache;
  }
}

/** Bounding box of the connected region around `peak` whose values are at least `level`. */
function hotRegion(grid: readonly number[], cols: number, rows: number, peak: number, level: number): NormRect {
  const seen = new Uint8Array(grid.length);
  const stack = [peak];
  seen[peak] = 1;
  let minC = cols;
  let maxC = -1;
  let minR = rows;
  let maxR = -1;
  while (stack.length > 0) {
    const idx = stack.pop() as number;
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    const neighbours = [
      c > 0 ? idx - 1 : -1,
      c < cols - 1 ? idx + 1 : -1,
      r > 0 ? idx - cols : -1,
      r < rows - 1 ? idx + cols : -1,
    ];
    for (const n of neighbours) {
      if (n >= 0 && seen[n] === 0 && (grid[n] as number) >= level) {
        seen[n] = 1;
        stack.push(n);
      }
    }
  }
  return {
    x: minC / cols,
    y: minR / rows,
    w: (maxC - minC + 1) / cols,
    h: (maxR - minR + 1) / rows,
  };
}
