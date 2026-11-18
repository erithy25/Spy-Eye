import type { Sources } from './intel/sources.js';
import { scoreFrameViews, type SearchScope } from './intel/scoring.js';
import { SEARCH_CALIBRATION, cutoffLift, scoreStats, wholeFloor } from './ml/calibration.js';
import { dotAt, pca2, sigmoid } from './ml/math.js';
import type { EmbeddingModel } from './ml/model.js';
import { decodeFrame, explainWindows, toNormRect, writeTile, type PixelRect } from './ml/preprocess.js';
import { frameUrl, sceneId, type Store, type VideoEntry } from './store.js';
import type { ExplainResponse, MapPoint, MapResponse, NormRect, SearchResponse, SearchResult } from './types.js';

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

/** Best agreement of one scene with the query, for the whole picture and for its tiles. */
interface SceneHit {
  scope: SearchScope;
  sceneIndex: number;
  /** Pictures of the scene that were compared. */
  frames: number;
  whole: number;
  wholeFrame: number;
  /** Best tile of the picture in which the whole picture agrees best, and its similarity. */
  wholeTile: number;
  wholeTileScore: number;
  tile: number;
  tileFrame: number;
  tileIdx: number;
  /** Larger of the two margins over their cut-offs; filled in once the cut-offs are known. */
  margin: number;
  /** True when the tile view carries the result. */
  byTile: boolean;
}

export class SearchEngine {
  private readonly explainCache = new Map<string, { windows: PixelRect[]; embeddings: Float32Array; width: number; height: number }>();
  private mapCache: MapResponse | null = null;

  constructor(
    private readonly store: Store,
    private readonly model: EmbeddingModel,
    private readonly sources: Sources,
    /** Everything that may be searched right now. */
    private readonly scopes: () => SearchScope[],
  ) {}

  /**
   * Finds the best frame per scene for a free-text query.
   * `sharedOnly` restricts the search to sources that are released to peer nodes.
   */
  async search(params: { query: string; limit: number; videoId: string | null; sharedOnly?: boolean }): Promise<SearchResponse> {
    const started = performance.now();
    if (!this.model.ready) throw new SearchError('Das Modell wird noch geladen.', 503);
    let queryVector: Float32Array;
    try {
      queryVector = await this.model.embedSearchQuery(params.query);
    } catch (err: unknown) {
      throw new SearchError(err instanceof Error ? err.message : String(err), 500);
    }
    const embedMs = performance.now() - started;
    const dim = this.model.dim;

    const hits: SceneHit[] = [];
    let framesSearched = 0;

    for (const scope of this.scopes()) {
      const { entry } = scope;
      if (params.videoId !== null && entry.info.id !== params.videoId) continue;
      if (params.sharedOnly && !this.sources.resolve(scope.sourceId).shared) continue;
      const emb = entry.embeddings;
      const tiles = entry.info.tilesPerFrame;
      if (!emb || tiles <= 0 || emb.dim !== dim) continue;
      const available = Math.min(entry.frames.length, Math.floor(emb.rows / tiles));
      const perScene = new Map<number, SceneHit>();
      const visit = (f: number): void => {
        if (f < 0 || f >= available) return;
        const views = scoreFrameViews(entry, f, queryVector);
        const sceneIndex = (entry.frames[f] as { s: number }).s;
        let hit = perScene.get(sceneIndex);
        if (!hit) {
          hit = { scope, sceneIndex, frames: 0, whole: -1, wholeFrame: f, wholeTile: 0, wholeTileScore: -1, tile: -1, tileFrame: f, tileIdx: 0, margin: 0, byTile: false };
          perScene.set(sceneIndex, hit);
        }
        hit.frames++;
        if (views.whole > hit.whole) {
          hit.whole = views.whole;
          hit.wholeFrame = f;
          hit.wholeTile = views.tileIdx;
          hit.wholeTileScore = views.tile;
        }
        if (views.tile > hit.tile) {
          hit.tile = views.tile;
          hit.tileFrame = f;
          hit.tileIdx = views.tileIdx;
        }
        framesSearched++;
      };
      if (scope.frames) for (const f of scope.frames) visit(f);
      else for (let f = 0; f < available; f++) visit(f);
      for (const hit of perScene.values()) hits.push(hit);
    }

    // Each view is judged against its own cut-off; the larger margin decides (see SearchCalibration).
    const cal = SEARCH_CALIBRATION[this.model.family];
    const wholeStats = scoreStats(Float64Array.from(hits, (h) => h.whole));
    const tileStats = scoreStats(
      Float64Array.from(
        hits.filter((h) => h.tile >= 0),
        (h) => h.tile,
      ),
    );
    const pooledFloor = wholeFloor(cal, Number.MAX_SAFE_INTEGER);
    const pooledLift = cutoffLift(wholeStats, pooledFloor, cal);
    const tileCutoff = cal.tileFloor + cutoffLift(tileStats, cal.tileFloor, cal);
    for (const hit of hits) {
      const floor = wholeFloor(cal, hit.frames);
      const wholeMargin = hit.whole - (floor + cutoffLift(wholeStats, floor, cal));
      const tileMargin = hit.tile >= 0 ? hit.tile - tileCutoff : Number.NEGATIVE_INFINITY;
      hit.byTile = tileMargin > wholeMargin;
      hit.margin = hit.byTile ? tileMargin : wholeMargin;
    }
    const cutoff = pooledFloor + pooledLift;
    const confidenceOf = (margin: number): number => sigmoid(margin / cal.width);

    const distribution = new Array<number>(DISTRIBUTION_BINS).fill(0);
    const sceneScores: Record<string, number> = {};
    const sourceScores: Record<string, number> = {};
    let matched = 0;
    for (const hit of hits) {
      const c = confidenceOf(hit.margin);
      if (c >= 0.5) matched++;
      const bin = Math.min(DISTRIBUTION_BINS - 1, Math.floor(c * DISTRIBUTION_BINS));
      distribution[bin] = (distribution[bin] as number) + 1;
      const rounded = Math.round(c * 1000) / 1000;
      sceneScores[sceneId(hit.scope.entry.info.id, hit.sceneIndex)] = rounded;
      if (rounded > (sourceScores[hit.scope.sourceId] ?? 0)) sourceScores[hit.scope.sourceId] = rounded;
    }

    hits.sort((a, b) => b.margin - a.margin);
    const results: SearchResult[] = [];
    for (const hit of hits.slice(0, params.limit)) {
      const { entry } = hit.scope;
      const scene = entry.scenes[hit.sceneIndex];
      const frameIdx = hit.byTile ? hit.tileFrame : hit.wholeFrame;
      const frame = entry.frames[frameIdx];
      if (!scene || !frame) continue;
      const layout = this.store.layout(entry);
      // The marked region: the tile that carries the result, or, when the whole picture does,
      // the tile of that picture which agrees even better than the picture as a whole.
      const tileIdx = hit.byTile ? hit.tileIdx : hit.wholeTileScore > hit.whole ? hit.wholeTile : 0;
      const tile = tileIdx > 0 ? layout[tileIdx] : undefined;
      const score = hit.byTile ? hit.tile : hit.whole;
      const source = this.sources.resolve(hit.scope.sourceId);
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
        score: Math.round(score * 10000) / 10000,
        confidence: Math.round(confidenceOf(hit.margin) * 1000) / 1000,
        box: tile ? toNormRect(tile, entry.info.frameWidth, entry.info.frameHeight) : null,
        tags: scene.tags,
        playable: entry.info.playable,
        sourceId: source.id,
        sourceName: source.name,
        sourceKind: source.kind,
        lat: source.lat,
        lon: source.lon,
        at: hit.scope.timeOf(frameIdx),
      });
    }

    return {
      query: params.query,
      tookMs: Math.round((performance.now() - started) * 10) / 10,
      embedMs: Math.round(embedMs * 10) / 10,
      scenesSearched: hits.length,
      framesSearched,
      vectorsSearched: countVectors(this.scopes(), params, this.sources, dim),
      threshold: Math.round(cutoff * 10000) / 10000,
      matched,
      results,
      distribution,
      sceneScores,
      sourceScores,
      federated: [],
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
      const frame = await decodeFrame(await this.store.analysisFramePath(params.videoId, params.frameNumber));
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

    const queryVector = await this.model.embedSearchQuery(params.query);
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
    const cal = SEARCH_CALIBRATION[this.model.family];
    const bestScore = Math.max(...scores);
    return {
      videoId: params.videoId,
      frameNumber: params.frameNumber,
      query: params.query,
      cols,
      rows,
      grid,
      box,
      // The windows are picture regions like the tiles, so their cut-off applies.
      peakConfidence: Math.round(sigmoid((bestScore - cal.tileFloor) / cal.width) * 1000) / 1000,
      tookMs: Math.round(performance.now() - started),
    };
  }

  /** 2D projection (PCA) of one whole-frame embedding per scene of the archive. */
  map(): MapResponse {
    if (this.mapCache && this.mapCache.version === this.store.version) return this.mapCache;
    const dim = this.model.dim;
    const candidates: { entry: VideoEntry; sceneIndex: number; frameIdx: number }[] = [];
    for (const entry of this.store.all()) {
      const emb = entry.embeddings;
      if (!emb || emb.dim !== dim || entry.info.tilesPerFrame <= 0 || entry.info.scenario !== null) continue;
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

/** Number of vectors a search over the given scopes compares against. */
function countVectors(
  scopes: SearchScope[],
  params: { videoId: string | null; sharedOnly?: boolean },
  sources: Sources,
  dim: number,
): number {
  let total = 0;
  for (const scope of scopes) {
    const { entry } = scope;
    if (params.videoId !== null && entry.info.id !== params.videoId) continue;
    if (params.sharedOnly && !sources.resolve(scope.sourceId).shared) continue;
    const emb = entry.embeddings;
    const tiles = entry.info.tilesPerFrame;
    if (!emb || tiles <= 0 || emb.dim !== dim) continue;
    const available = Math.min(entry.frames.length, Math.floor(emb.rows / tiles));
    total += (scope.frames ? scope.frames.filter((f) => f >= 0 && f < available).length : available) * tiles;
  }
  return total;
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
