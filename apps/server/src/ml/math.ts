/** Small dense linear-algebra helpers on Float32Array row-major matrices. */

export function l2normalizeRows(data: Float32Array, dim: number): void {
  const rows = data.length / dim;
  for (let r = 0; r < rows; r++) {
    const off = r * dim;
    let sum = 0;
    for (let i = 0; i < dim; i++) {
      const v = data[off + i] as number;
      sum += v * v;
    }
    const inv = sum > 0 ? 1 / Math.sqrt(sum) : 0;
    for (let i = 0; i < dim; i++) data[off + i] = (data[off + i] as number) * inv;
  }
}

export function l2normalize(vec: Float32Array): Float32Array {
  l2normalizeRows(vec, vec.length);
  return vec;
}

/** Dot product of `a[aOff..aOff+dim)` and `b[bOff..bOff+dim)`. */
export function dotAt(a: Float32Array, aOff: number, b: Float32Array, bOff: number, dim: number): number {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  const end4 = dim - (dim % 4);
  let i = 0;
  for (; i < end4; i += 4) {
    s0 += (a[aOff + i] as number) * (b[bOff + i] as number);
    s1 += (a[aOff + i + 1] as number) * (b[bOff + i + 1] as number);
    s2 += (a[aOff + i + 2] as number) * (b[bOff + i + 2] as number);
    s3 += (a[aOff + i + 3] as number) * (b[bOff + i + 3] as number);
  }
  for (; i < dim; i++) s0 += (a[aOff + i] as number) * (b[bOff + i] as number);
  return s0 + s1 + s2 + s3;
}

export function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

/** Append-only Float32 matrix with amortized growth. */
export class GrowableMatrix {
  private buffer: Float32Array;
  private rowCount = 0;

  constructor(
    readonly dim: number,
    initialRows = 256,
  ) {
    this.buffer = new Float32Array(Math.max(1, initialRows) * dim);
  }

  static fromData(data: Float32Array, dim: number): GrowableMatrix {
    if (data.length % dim !== 0) throw new Error(`Matrix data length ${data.length} is not a multiple of dim ${dim}`);
    const m = new GrowableMatrix(dim, 1);
    m.buffer = data;
    m.rowCount = data.length / dim;
    return m;
  }

  get rows(): number {
    return this.rowCount;
  }

  /** Backing buffer; only the first `rows * dim` values are valid. */
  get data(): Float32Array {
    return this.buffer;
  }

  /** View of the valid part of the buffer (no copy). */
  view(): Float32Array {
    return this.buffer.subarray(0, this.rowCount * this.dim);
  }

  append(src: Float32Array, srcOffset: number, rows: number): void {
    const needed = (this.rowCount + rows) * this.dim;
    if (needed > this.buffer.length) {
      let capacity = this.buffer.length;
      while (capacity < needed) capacity = Math.ceil(capacity * 1.6);
      const next = new Float32Array(capacity);
      next.set(this.buffer.subarray(0, this.rowCount * this.dim));
      this.buffer = next;
    }
    this.buffer.set(src.subarray(srcOffset, srcOffset + rows * this.dim), this.rowCount * this.dim);
    this.rowCount += rows;
  }
}

export interface Pca2Result {
  /** Interleaved x,y per input row, scaled to roughly -1..1. */
  coords: Float32Array;
  explainedVariance: number;
}

/**
 * Top-2 principal components via power iteration with deflation.
 * `rows` are given as offsets into `data` so callers can project a subset without copying.
 */
export function pca2(data: Float32Array, dim: number, rowOffsets: readonly number[]): Pca2Result {
  const n = rowOffsets.length;
  const coords = new Float32Array(n * 2);
  if (n < 2) return { coords, explainedVariance: 0 };

  const mean = new Float64Array(dim);
  for (const off of rowOffsets) for (let i = 0; i < dim; i++) mean[i] = (mean[i] as number) + (data[off + i] as number);
  for (let i = 0; i < dim; i++) mean[i] = (mean[i] as number) / n;

  let totalVariance = 0;
  for (const off of rowOffsets) {
    for (let i = 0; i < dim; i++) {
      const c = (data[off + i] as number) - (mean[i] as number);
      totalVariance += c * c;
    }
  }

  const components: Float64Array[] = [];
  const eigenvalues: number[] = [];
  const proj = new Float64Array(n);

  for (let k = 0; k < 2; k++) {
    // Deterministic pseudo-random start vector.
    let v = new Float64Array(dim);
    let seed = 1234567 + k * 7919;
    for (let i = 0; i < dim; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      v[i] = seed / 0x7fffffff - 0.5;
    }
    let eigen = 0;
    for (let iter = 0; iter < 60; iter++) {
      // Orthogonalize against previous components.
      for (const prev of components) {
        let d = 0;
        for (let i = 0; i < dim; i++) d += (v[i] as number) * (prev[i] as number);
        for (let i = 0; i < dim; i++) v[i] = (v[i] as number) - d * (prev[i] as number);
      }
      let norm = 0;
      for (let i = 0; i < dim; i++) norm += (v[i] as number) * (v[i] as number);
      norm = Math.sqrt(norm);
      if (norm < 1e-12) break;
      for (let i = 0; i < dim; i++) v[i] = (v[i] as number) / norm;

      // w = Xc^T (Xc v)
      const w = new Float64Array(dim);
      for (let r = 0; r < n; r++) {
        const off = rowOffsets[r] as number;
        let p = 0;
        for (let i = 0; i < dim; i++) p += ((data[off + i] as number) - (mean[i] as number)) * (v[i] as number);
        proj[r] = p;
        for (let i = 0; i < dim; i++) w[i] = (w[i] as number) + p * ((data[off + i] as number) - (mean[i] as number));
      }
      let nextEigen = 0;
      for (let i = 0; i < dim; i++) nextEigen += (w[i] as number) * (v[i] as number);
      const converged = Math.abs(nextEigen - eigen) <= 1e-7 * Math.max(1, Math.abs(nextEigen));
      eigen = nextEigen;
      v = w;
      if (converged && iter > 3) break;
    }
    for (const prev of components) {
      let d = 0;
      for (let i = 0; i < dim; i++) d += (v[i] as number) * (prev[i] as number);
      for (let i = 0; i < dim; i++) v[i] = (v[i] as number) - d * (prev[i] as number);
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += (v[i] as number) * (v[i] as number);
    norm = Math.sqrt(norm);
    if (norm > 1e-12) for (let i = 0; i < dim; i++) v[i] = (v[i] as number) / norm;
    components.push(v);
    eigenvalues.push(Math.max(0, eigen));
  }

  let maxAbs = 1e-9;
  for (let r = 0; r < n; r++) {
    const off = rowOffsets[r] as number;
    for (let k = 0; k < 2; k++) {
      const comp = components[k] as Float64Array;
      let p = 0;
      for (let i = 0; i < dim; i++) p += ((data[off + i] as number) - (mean[i] as number)) * (comp[i] as number);
      coords[r * 2 + k] = p;
      if (Math.abs(p) > maxAbs) maxAbs = Math.abs(p);
    }
  }
  for (let i = 0; i < coords.length; i++) coords[i] = (coords[i] as number) / maxAbs;

  const explained = totalVariance > 0 ? ((eigenvalues[0] ?? 0) + (eigenvalues[1] ?? 0)) / totalVariance : 0;
  return { coords, explainedVariance: Math.min(1, explained) };
}
