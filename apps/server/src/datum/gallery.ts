/**
 * DATUM reference gallery: geotagged pictures of places (Wikidata items with their P18 image),
 * embedded with the same image tower and the same preprocessing as the analysis frames, so that a
 * frame and a reference picture of the same place end up close together.
 *
 * The vectors are cached next to the node's data (`<dataDir>/datum/gallery-<model>.bin` plus a
 * `.json` index). A restart reads the cache in well under a second; when the gallery grows only
 * the new pictures are embedded. Vectors shipped with the dataset (gallerySeed.ts) fill rows the
 * cache does not have, so a fresh machine embeds nothing that was shipped.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config, repoRoot } from '../config.js';
import { decodeFrame, writeTile, type PixelRect } from '../ml/preprocess.js';
import { readSeed } from './gallerySeed.js';

/** One reference picture as listed in `gallery.json`. */
export interface GalleryImage {
  id: string;
  /** Path relative to the dataset directory, e.g. "gallery/Q2981.jpg". */
  file: string;
  label: string;
  lat: number;
  lon: number;
  /** ISO 3166-1 alpha-2 code (or whatever the dataset carries), null if unknown. */
  country: string | null;
  wikidata: string | null;
  hasVideo?: boolean;
  testItem?: boolean;
}

export interface GalleryNeighbour {
  id: string;
  label: string;
  lat: number;
  lon: number;
  country: string | null;
  wikidata: string | null;
  /** Cosine similarity between the query row and the reference picture. */
  similarity: number;
}

export interface GallerySearchOptions {
  /** Wikidata items whose pictures are left out (evaluation of unknown places). */
  excludeWikidata?: readonly string[];
}

/** What the gallery needs from the embedding model (EmbeddingModel satisfies it). */
export interface ImageEmbedder {
  readonly imageSize: number;
  readonly imageMean: [number, number, number];
  readonly imageStd: [number, number, number];
  readonly dim: number;
  embedPixels(pixels: Float32Array, count: number): Promise<Float32Array>;
}

export interface GalleryOptions {
  /** Directory holding gallery.json and the gallery/ folder. Default: <repo>/datasets/datum. */
  datasetDir?: string;
  /** Directory of the vector cache. Default: <dataDir>/datum. */
  cacheDir?: string;
  /** Model id written to the cache; a different model invalidates it. Default: config.modelId. */
  modelId?: string;
  /** Pictures per inference batch. Default: config.batchSize. */
  batchSize?: number;
  /** Parallel JPEG decodes. Default: number of cores. */
  decodeConcurrency?: number;
}

export interface GalleryLoadProgress {
  done: number;
  total: number;
  /** Pictures embedded in this run (the others came from the cache). */
  embedded: number;
}

export interface GalleryLoadReport {
  images: number;
  fromCache: number;
  embedded: number;
  failed: number;
  embedMs: number;
  /** Pictures per second of the embedding run (0 when nothing had to be embedded). */
  imagesPerSec: number;
  loadMs: number;
}

interface CacheIndex {
  version: 1;
  modelId: string;
  dim: number;
  /** sha256 of gallery.json at the time of writing. */
  galleryHash: string;
  /** Row order of the .bin file. */
  ids: string[];
  /** Per row: "<file>:<bytes>", so a replaced picture is embedded again. */
  sources: string[];
}

export function defaultDatasetDir(): string {
  return path.join(repoRoot, 'datasets', 'datum');
}

export function modelSlug(modelId: string = config.modelId): string {
  return (modelId.split('/').pop() ?? modelId).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}

const SAFE_ID = /^[A-Za-z0-9_.-]{1,80}$/;

/**
 * Resolves the thumbnail of a reference picture for `/api/datum/gallery/<id>.jpg`. Returns null
 * for ids that are not in the gallery (or look like a path), so the route can answer 404 and no
 * file outside the gallery folder is ever served.
 */
export function galleryImagePath(gallery: Gallery, id: string): string | null {
  const clean = id.replace(/\.jpe?g$/i, '');
  if (!SAFE_ID.test(clean)) return null;
  const image = gallery.image(clean);
  if (!image) return null;
  const root = path.resolve(gallery.datasetDir);
  const file = path.resolve(root, image.file);
  if (!file.startsWith(root + path.sep)) return null;
  return file;
}

/** URL under which the HTTP layer serves a reference thumbnail. */
export function galleryImageUrl(id: string): string {
  return `/api/datum/gallery/${encodeURIComponent(id)}.jpg`;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return out;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function parseGallery(raw: unknown): GalleryImage[] {
  const list = (raw as { images?: unknown } | null)?.images;
  if (!Array.isArray(list)) throw new Error('gallery.json: "images" fehlt.');
  const out: GalleryImage[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = typeof o['id'] === 'string' ? o['id'] : null;
    const file = typeof o['file'] === 'string' ? o['file'] : null;
    if (!id || !file || !SAFE_ID.test(id) || seen.has(id)) continue;
    if (!isFiniteNumber(o['lat']) || !isFiniteNumber(o['lon'])) continue;
    if (Math.abs(o['lat']) > 90 || Math.abs(o['lon']) > 180) continue;
    seen.add(id);
    out.push({
      id,
      file,
      label: typeof o['label'] === 'string' && o['label'] !== '' ? o['label'] : id,
      lat: o['lat'],
      lon: o['lon'],
      country: typeof o['country'] === 'string' && o['country'] !== '' ? o['country'] : null,
      wikidata: typeof o['wikidata'] === 'string' && o['wikidata'] !== '' ? o['wikidata'] : null,
      ...(typeof o['hasVideo'] === 'boolean' ? { hasVideo: o['hasVideo'] } : {}),
      ...(typeof o['testItem'] === 'boolean' ? { testItem: o['testItem'] } : {}),
    });
  }
  return out;
}

async function writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

/**
 * The reference gallery in memory: one L2-normalised row per picture, searched exhaustively
 * (a few thousand rows times a handful of frames is a few million multiply-adds).
 */
export class Gallery {
  readonly datasetDir: string;
  readonly cacheDir: string;
  readonly modelId: string;
  private readonly batchSize: number;
  private readonly decodeConcurrency: number;

  private images: GalleryImage[] = [];
  private byId = new Map<string, number>();
  private vectors = new Float32Array(0);
  private dimension = 0;

  constructor(
    private readonly model: ImageEmbedder,
    options: GalleryOptions = {},
  ) {
    this.datasetDir = options.datasetDir ?? defaultDatasetDir();
    this.cacheDir = options.cacheDir ?? path.join(config.dataDir, 'datum');
    this.modelId = options.modelId ?? config.modelId;
    this.batchSize = options.batchSize ?? config.batchSize;
    this.decodeConcurrency = options.decodeConcurrency ?? Math.max(2, os.availableParallelism());
  }

  get size(): number {
    return this.images.length;
  }

  get dim(): number {
    return this.dimension;
  }

  image(id: string): GalleryImage | undefined {
    const row = this.byId.get(id);
    return row === undefined ? undefined : this.images[row];
  }

  list(): readonly GalleryImage[] {
    return this.images;
  }

  /** Row vector of a picture (a view, do not modify). */
  vector(id: string): Float32Array | null {
    const row = this.byId.get(id);
    if (row === undefined) return null;
    return this.vectors.subarray(row * this.dimension, (row + 1) * this.dimension);
  }

  private cacheFiles(): { bin: string; index: string } {
    const base = path.join(this.cacheDir, `gallery-${modelSlug(this.modelId)}`);
    return { bin: `${base}.bin`, index: `${base}.json` };
  }

  /**
   * Reads gallery.json, takes every vector it can from the cache, embeds the rest and writes the
   * cache back. Pictures that cannot be decoded are left out. Call again when the gallery grew.
   */
  async load(onProgress?: (p: GalleryLoadProgress) => void): Promise<GalleryLoadReport> {
    const started = performance.now();
    const galleryFile = path.join(this.datasetDir, 'gallery.json');
    const text = await fs.readFile(galleryFile, 'utf8');
    const galleryHash = createHash('sha256').update(text).digest('hex');
    const listed = parseGallery(JSON.parse(text) as unknown);

    const files = this.cacheFiles();
    const dim = this.model.dim;
    if (!(dim > 0)) throw new Error('Gallery.load: das Modell ist nicht geladen (dim = 0).');

    // Cached rows by id, valid only for the same model and dimension.
    const cached = new Map<string, { source: string; row: Float32Array }>();
    try {
      const index = JSON.parse(await fs.readFile(files.index, 'utf8')) as CacheIndex;
      if (index.version === 1 && index.modelId === this.modelId && index.dim === dim) {
        const buf = await fs.readFile(files.bin);
        const all = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
        if (all.length === index.ids.length * dim) {
          index.ids.forEach((id, i) => {
            cached.set(id, { source: index.sources[i] ?? '', row: all.subarray(i * dim, (i + 1) * dim) });
          });
        }
      }
    } catch {
      // No cache yet, or an unreadable one: everything is embedded.
    }

    // Vectors shipped with the dataset: used where the local cache has no row, so a fresh machine
    // starts without embedding the pictures.
    const seed = await readSeed(this.datasetDir, this.modelId, dim);

    // Which listed pictures still have a valid cached row? The file size tells a replaced picture.
    const sources = await mapLimit(listed, 32, async (img) => {
      try {
        const stat = await fs.stat(path.join(this.datasetDir, img.file));
        return `${img.file}:${stat.size}`;
      } catch {
        return null;
      }
    });
    const keep: { img: GalleryImage; source: string; row: Float32Array | null }[] = [];
    let fromSeed = 0;
    for (let i = 0; i < listed.length; i++) {
      const source = sources[i];
      const img = listed[i] as GalleryImage;
      const hit = cached.get(img.id);
      const shipped = seed.get(img.id);
      if (source === null || source === undefined) {
        // Picture not on disk: a shipped row still makes the place searchable (only its
        // thumbnail is missing); without one there is nothing to embed.
        if (shipped) {
          keep.push({ img, source: shipped.source, row: shipped.row });
          fromSeed++;
        }
        continue;
      }
      if (hit && hit.source === source) keep.push({ img, source, row: hit.row });
      else if (shipped && shipped.source === source) {
        keep.push({ img, source, row: shipped.row });
        fromSeed++;
      } else keep.push({ img, source, row: null });
    }

    const missing = keep.filter((k) => k.row === null);
    let embedMs = 0;
    let failed = 0;
    if (missing.length > 0) {
      const t0 = performance.now();
      failed = await this.embedMissing(missing, (done) =>
        onProgress?.({ done: keep.length - missing.length + done, total: keep.length, embedded: done }),
      );
      embedMs = performance.now() - t0;
    }

    const usable = keep.filter((k) => k.row !== null);
    const vectors = new Float32Array(usable.length * dim);
    usable.forEach((k, i) => vectors.set(k.row as Float32Array, i * dim));
    this.images = usable.map((k) => k.img);
    this.byId = new Map(this.images.map((img, i) => [img.id, i]));
    this.vectors = vectors;
    this.dimension = dim;

    const unchanged = missing.length === 0 && fromSeed === 0 && cached.size === usable.length;
    if (!unchanged) {
      await fs.mkdir(this.cacheDir, { recursive: true });
      const index: CacheIndex = {
        version: 1,
        modelId: this.modelId,
        dim,
        galleryHash,
        ids: usable.map((k) => k.img.id),
        sources: usable.map((k) => k.source),
      };
      await writeAtomic(files.bin, new Uint8Array(vectors.buffer, vectors.byteOffset, vectors.byteLength));
      await writeAtomic(files.index, JSON.stringify(index));
    }
    const embedded = missing.length - failed;
    return {
      images: usable.length,
      fromCache: usable.length - embedded,
      embedded,
      failed,
      embedMs,
      imagesPerSec: embedded > 0 && embedMs > 0 ? embedded / (embedMs / 1000) : 0,
      loadMs: performance.now() - started,
    };
  }

  /** Embeds the given pictures in batches; fills `row` of each, returns the number that failed. */
  private async embedMissing(
    items: { img: GalleryImage; row: Float32Array | null }[],
    progress: (done: number) => void,
  ): Promise<number> {
    const { model } = this;
    const size = model.imageSize;
    const plane = 3 * size * size;
    const dim = model.dim;
    let failed = 0;
    let done = 0;
    // Decode the next batch while the current one runs through the model.
    const prepare = (batch: typeof items): Promise<(Float32Array | null)[]> =>
      mapLimit(batch, this.decodeConcurrency, async (item) => {
        try {
          const decoded = await decodeFrame(path.join(this.datasetDir, item.img.file));
          const full: PixelRect = { left: 0, top: 0, width: decoded.width, height: decoded.height };
          const pixels = new Float32Array(plane);
          await writeTile(decoded, full, size, model.imageMean, model.imageStd, pixels, 0);
          return pixels;
        } catch {
          return null;
        }
      });
    const batches: (typeof items)[] = [];
    for (let i = 0; i < items.length; i += this.batchSize) batches.push(items.slice(i, i + this.batchSize));
    let pending = batches.length > 0 ? prepare(batches[0] as typeof items) : null;
    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b] as typeof items;
      const prepared = await (pending as Promise<(Float32Array | null)[]>);
      pending = b + 1 < batches.length ? prepare(batches[b + 1] as typeof items) : null;
      const ok = batch.map((item, i) => ({ item, pixels: prepared[i] ?? null })).filter((x) => x.pixels !== null);
      failed += batch.length - ok.length;
      if (ok.length > 0) {
        const pixels = new Float32Array(ok.length * plane);
        ok.forEach((x, i) => pixels.set(x.pixels as Float32Array, i * plane));
        const out = await model.embedPixels(pixels, ok.length);
        ok.forEach((x, i) => {
          x.item.row = out.slice(i * dim, (i + 1) * dim);
        });
      }
      done += batch.length;
      progress(done);
    }
    return failed;
  }

  /**
   * k nearest reference pictures for every row of `vectors` (n x dim, L2-normalised), best first.
   */
  search(vectors: Float32Array, k: number, opts: GallerySearchOptions = {}): GalleryNeighbour[][] {
    const dim = this.dimension;
    if (dim === 0 || this.images.length === 0) return [];
    if (vectors.length % dim !== 0) throw new Error(`search: ${vectors.length} Werte sind kein Vielfaches von ${dim}.`);
    const rows = vectors.length / dim;
    const excluded = new Set(opts.excludeWikidata ?? []);
    const allowed = excluded.size === 0 ? null : this.images.map((img) => !(img.wikidata !== null && excluded.has(img.wikidata)));
    const n = this.images.length;
    const g = this.vectors;
    const out: GalleryNeighbour[][] = [];
    // Gallery row outside, query rows inside: the query block stays in the cache while the
    // gallery streams through once, however many rows (frames and crops) are asked.
    const all = new Float32Array(rows * n);
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
          d0 += (vectors[qOff + d] as number) * (g[gOff + d] as number);
          d1 += (vectors[qOff + d + 1] as number) * (g[gOff + d + 1] as number);
          d2 += (vectors[qOff + d + 2] as number) * (g[gOff + d + 2] as number);
          d3 += (vectors[qOff + d + 3] as number) * (g[gOff + d + 3] as number);
        }
        for (; d < dim; d++) d0 += (vectors[qOff + d] as number) * (g[gOff + d] as number);
        all[r * n + i] = d0 + d1 + d2 + d3;
      }
    }
    for (let r = 0; r < rows; r++) {
      const sims = all.subarray(r * n, (r + 1) * n);
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
      out.push(
        top.map((i) => {
          const img = this.images[i] as GalleryImage;
          return {
            id: img.id,
            label: img.label,
            lat: img.lat,
            lon: img.lon,
            country: img.country,
            wikidata: img.wikidata,
            similarity: sims[i] as number,
          };
        }),
      );
    }
    return out;
  }
}
