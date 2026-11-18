/**
 * The arithmetic of the gallery search, shared by Gallery.search (main thread, scripts) and the
 * search thread (gallerySearchWorker.ts). Both run this very code, so they agree to the last bit:
 * the same products summed in the same order give the same float32 similarity, and the same
 * selection gives the same order and the same ties. The module imports nothing, so that the search
 * thread loads only this file and its own entry.
 */

/**
 * Similarity of every query row with every gallery row (both n x dim, L2-normalised), stored as
 * float32 at `out[r * n + i]` for query row r and gallery row i.
 */
export function similarityMatrix(queries: Float32Array, rows: number, gallery: Float32Array, n: number, dim: number): Float32Array {
  const all = new Float32Array(rows * n);
  // Gallery row outside, query rows inside: the query block stays in the cache while the
  // gallery streams through once, however many rows (frames and crops) are asked.
  for (let i = 0; i < n; i++) {
    const gOff = i * dim;
    for (let r = 0; r < rows; r++) {
      const qOff = r * dim;
      let d0 = 0;
      let d1 = 0;
      let d2 = 0;
      let d3 = 0;
      let d = 0;
      for (; d + 3 < dim; d += 4) {
        d0 += (queries[qOff + d] as number) * (gallery[gOff + d] as number);
        d1 += (queries[qOff + d + 1] as number) * (gallery[gOff + d + 1] as number);
        d2 += (queries[qOff + d + 2] as number) * (gallery[gOff + d + 2] as number);
        d3 += (queries[qOff + d + 3] as number) * (gallery[gOff + d + 3] as number);
      }
      for (; d < dim; d++) d0 += (queries[qOff + d] as number) * (gallery[gOff + d] as number);
      all[r * n + i] = d0 + d1 + d2 + d3;
    }
  }
  return all;
}

/**
 * Gallery rows of the best `k` similarities of one query row, best first; among equal
 * similarities the earlier gallery row comes first. Rows whose `allowed` entry is 0 are skipped
 * (null: every row may be chosen).
 */
export function selectTop(sims: Float32Array, k: number, allowed: Uint8Array | null): number[] {
  const n = sims.length;
  // Partial selection: keep a small sorted list of the best k.
  const top: number[] = [];
  for (let i = 0; i < n; i++) {
    if (allowed && !allowed[i]) continue;
    const s = sims[i] as number;
    if (top.length === k && s <= (sims[top[top.length - 1] as number] as number)) continue;
    let pos = top.length;
    while (pos > 0 && (sims[top[pos - 1] as number] as number) < s) pos--;
    top.splice(pos, 0, i);
    if (top.length > k) top.pop();
  }
  return top;
}

/**
 * The selected rows of every query row in three flat arrays, as they cross the thread boundary:
 * query row r owns the entries offsets[r] to offsets[r + 1] - 1 of `indices` (gallery rows) and
 * `similarities`, best first.
 */
export interface TopRows {
  offsets: Int32Array<ArrayBuffer>;
  indices: Int32Array<ArrayBuffer>;
  similarities: Float32Array<ArrayBuffer>;
}

/** Searches all query rows and packs the result (what the search thread computes per call). */
export function searchTopRows(
  queries: Float32Array,
  rows: number,
  gallery: Float32Array,
  n: number,
  dim: number,
  k: number,
  allowed: Uint8Array | null,
): TopRows {
  const all = similarityMatrix(queries, rows, gallery, n, dim);
  const lists: number[][] = [];
  const offsets = new Int32Array(rows + 1);
  for (let r = 0; r < rows; r++) {
    const top = selectTop(all.subarray(r * n, (r + 1) * n), k, allowed);
    lists.push(top);
    offsets[r + 1] = (offsets[r] as number) + top.length;
  }
  const total = offsets[rows] as number;
  const indices = new Int32Array(total);
  const similarities = new Float32Array(total);
  for (let r = 0; r < rows; r++) {
    const top = lists[r] as number[];
    let j = offsets[r] as number;
    for (const i of top) {
      indices[j] = i;
      // Copied from the float32 matrix into a float32 array: the very value search() reports.
      similarities[j] = all[r * n + i] as number;
      j++;
    }
  }
  return { offsets, indices, similarities };
}

// ------------------------------------------------------------------ messages of the search thread

/** Main thread → search thread. */
export type SearchHostMessage =
  /**
   * A gallery matrix in shared memory (the thread keeps it until the next version or a drop).
   * A published matrix is never written again: a reloaded gallery comes with a new matrix and a
   * new version, so a search always reads one complete state.
   */
  | { type: 'matrix'; gallery: number; version: number; matrix: Float32Array; n: number; dim: number }
  /** The gallery is gone: the thread releases its matrix. */
  | { type: 'drop'; gallery: number }
  /** One search over the matrix of that gallery version; `queries` is moved, not copied. */
  | {
      type: 'search';
      id: number;
      gallery: number;
      version: number;
      queries: Float32Array<ArrayBuffer>;
      rows: number;
      k: number;
      allowed: Uint8Array | null;
    };

/** Search thread → main thread. */
export type SearchThreadMessage = ({ type: 'result'; id: number } & TopRows) | { type: 'error'; id: number; message: string };
