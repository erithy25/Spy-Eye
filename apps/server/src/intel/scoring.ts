import { dotAt } from '../ml/math.js';
import type { VideoEntry } from '../store.js';

export interface FrameScore {
  /** Best cosine similarity over the tiles of the frame. */
  score: number;
  /** Index of the best tile (0 = whole frame). */
  tile: number;
}

/** Offset of a tile vector inside the embedding matrix of a recording. */
export function tileOffset(entry: VideoEntry, frameIdx: number, tile: number): number {
  const dim = entry.embeddings?.dim ?? 0;
  return (frameIdx * entry.info.tilesPerFrame + tile) * dim;
}

/** Best similarity between a query vector and the tiles of one frame. */
export function scoreFrame(entry: VideoEntry, frameIdx: number, vector: Float32Array): FrameScore {
  const emb = entry.embeddings;
  const tiles = entry.info.tilesPerFrame;
  if (!emb || tiles <= 0 || emb.dim !== vector.length || (frameIdx + 1) * tiles > emb.rows) return { score: -1, tile: 0 };
  let best = -1;
  let bestTile = 0;
  const base = frameIdx * tiles * emb.dim;
  for (let t = 0; t < tiles; t++) {
    const raw = dotAt(emb.data, base + t * emb.dim, vector, 0, emb.dim);
    const s = Number.isFinite(raw) ? raw : -1;
    if (s > best) {
      best = s;
      bestTile = t;
    }
  }
  return { score: best, tile: bestTile };
}

/** A set of frames that may be searched, with the wall-clock time each frame stands for. */
export interface SearchScope {
  entry: VideoEntry;
  sourceId: string;
  /** Indices into `entry.frames`; null means every frame. */
  frames: readonly number[] | null;
  /** Wall-clock time (epoch ms) of a frame. */
  timeOf(frameIdx: number): number;
}
