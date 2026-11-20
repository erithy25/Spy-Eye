/**
 * Offline base map: loads the pre-extracted vector tiles shipped with the console (see
 * apps/server/src/scripts/map/extractTiles.ts) and turns them into canvas paths. No map service
 * is contacted at run time.
 */

export const EXTENT = 4096;

export interface Manifest {
  minZoom: number;
  maxZoom: number;
  extent: number;
  tiles: Record<string, [number, number][]>;
  attribution: string;
  source: string;
}

interface RawTile {
  water?: number[][];
  urban?: number[][];
  wood?: number[][];
  bld?: number[][];
  ww?: Record<string, { n?: string; e?: string; l: number[] }[]>;
  rd?: Record<string, number[][]>;
  br?: number[][];
  bd?: Record<string, number[][]>;
  pl?: { n: string; e?: string; c: string; r: number; p: [number, number] }[];
  pk?: { n: string; h: number; p: [number, number] }[];
  poi?: { k: string; n: string; p: [number, number] }[];
  ct?: { h: number; l: number[] }[];
}

export interface PlaceLabel {
  name: string;
  /** English name where the tile carries one that differs (tiles extracted with it; else placeNames.ts). */
  nameEn?: string;
  /** city | town | village | suburb | quarter | hamlet | neighbourhood */
  cls: string;
  rank: number;
  x: number;
  y: number;
}

export interface LineLabel {
  name: string;
  /** English name where the tile carries one that differs. */
  nameEn?: string;
  x: number;
  y: number;
  angle: number;
  length: number;
}

/**
 * The vertices behind the paths of a tile, absolute tile units (0..EXTENT), one flat [x0, y0, x1,
 * y1, ...] array per ring or line. The flat map draws the Path2D objects under an affine transform;
 * the globe has to project every vertex itself, which needs the numbers.
 */
export interface TileGeometry {
  water: number[][];
  urban: number[][];
  wood: number[][];
  buildings: number[][];
  rivers: number[][];
  streams: number[][];
  roads: Record<string, number[][]>;
  bridges: number[][];
  boundaries: Record<string, number[][]>;
  contours: number[][];
  contoursIndex: number[][];
}

/** The drawable layers of a tile; the globe builds the same set from projected vertices. */
export interface TileLayers {
  water: Path2D | null;
  urban: Path2D | null;
  wood: Path2D | null;
  buildings: Path2D | null;
  rivers: Path2D | null;
  streams: Path2D | null;
  roads: Record<string, Path2D>;
  bridges: Path2D | null;
  boundaries: Record<string, Path2D>;
  contours: Path2D | null;
  contoursIndex: Path2D | null;
}

export interface Tile extends TileLayers {
  z: number;
  x: number;
  y: number;
  geom: TileGeometry;
  places: PlaceLabel[];
  peaks: { name: string; height: number; x: number; y: number }[];
  pois: { kind: string; name: string; x: number; y: number }[];
  riverLabels: LineLabel[];
}

/** Adds a delta-encoded path to `path`; returns its absolute vertices. */
function trace(path: Path2D, packed: number[], close: boolean): number[] {
  const out: number[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i + 1 < packed.length; i += 2) {
    x += packed[i] as number;
    y += packed[i + 1] as number;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
    out.push(x, y);
  }
  if (close) path.closePath();
  return out;
}

function pathOf(list: number[][] | undefined, close: boolean, rings: number[][]): Path2D | null {
  if (!list || list.length === 0) return null;
  const path = new Path2D();
  for (const packed of list) rings.push(trace(path, packed, close));
  return path;
}

/** Where a name can be written along a line: the middle of its longest straight-ish stretch. */
function labelSpot(vertices: number[], name: string): LineLabel | null {
  let total = 0;
  for (let i = 2; i < vertices.length; i += 2) {
    total += Math.hypot((vertices[i] as number) - (vertices[i - 2] as number), (vertices[i + 1] as number) - (vertices[i - 1] as number));
  }
  if (total < 700) return null;
  let walked = 0;
  for (let i = 2; i < vertices.length; i += 2) {
    const ax = vertices[i - 2] as number;
    const ay = vertices[i - 1] as number;
    const bx = vertices[i] as number;
    const by = vertices[i + 1] as number;
    const seg = Math.hypot(bx - ax, by - ay);
    if (walked + seg >= total / 2) {
      const t = seg === 0 ? 0 : (total / 2 - walked) / seg;
      let angle = Math.atan2(by - ay, bx - ax);
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      if (x < 0 || y < 0 || x > EXTENT || y > EXTENT) return null;
      return { name, x, y, angle, length: total };
    }
    walked += seg;
  }
  return null;
}

function build(z: number, x: number, y: number, raw: RawTile): Tile {
  const geom: TileGeometry = {
    water: [],
    urban: [],
    wood: [],
    buildings: [],
    rivers: [],
    streams: [],
    roads: {},
    bridges: [],
    boundaries: {},
    contours: [],
    contoursIndex: [],
  };
  const roads: Record<string, Path2D> = {};
  for (const [key, list] of Object.entries(raw.rd ?? {})) {
    const rings: number[][] = [];
    const path = pathOf(list, false, rings);
    if (path) {
      roads[key] = path;
      geom.roads[key] = rings;
    }
  }
  const boundaries: Record<string, Path2D> = {};
  for (const [key, list] of Object.entries(raw.bd ?? {})) {
    const rings: number[][] = [];
    const path = pathOf(list, false, rings);
    if (path) {
      boundaries[key] = path;
      geom.boundaries[key] = rings;
    }
  }

  let rivers: Path2D | null = null;
  let streams: Path2D | null = null;
  const riverLabels: LineLabel[] = [];
  for (const [key, list] of Object.entries(raw.ww ?? {})) {
    for (const item of list) {
      const isStream = key === 's';
      const target = isStream ? (streams ??= new Path2D()) : (rivers ??= new Path2D());
      const vertices = trace(target, item.l, false);
      (isStream ? geom.streams : geom.rivers).push(vertices);
      if (item.n) {
        const spot = labelSpot(vertices, item.n);
        if (spot) riverLabels.push(item.e ? { ...spot, nameEn: item.e } : spot);
      }
    }
  }

  let contours: Path2D | null = null;
  let contoursIndex: Path2D | null = null;
  if (raw.ct && raw.ct.length > 0) {
    const interval = z <= 9 ? 100 : z <= 11 ? 50 : z <= 13 ? 20 : 10;
    for (const line of raw.ct) {
      const isIndex = Math.round(line.h / interval) % 5 === 0;
      const vertices = trace(isIndex ? (contoursIndex ??= new Path2D()) : (contours ??= new Path2D()), line.l, false);
      (isIndex ? geom.contoursIndex : geom.contours).push(vertices);
    }
  }

  return {
    z,
    x,
    y,
    geom,
    water: pathOf(raw.water, true, geom.water),
    urban: pathOf(raw.urban, true, geom.urban),
    wood: pathOf(raw.wood, true, geom.wood),
    buildings: pathOf(raw.bld, true, geom.buildings),
    rivers,
    streams,
    roads,
    bridges: pathOf(raw.br, false, geom.bridges),
    boundaries,
    contours,
    contoursIndex,
    places: (raw.pl ?? []).map((p) => ({ name: p.n, ...(p.e ? { nameEn: p.e } : {}), cls: p.c, rank: p.r, x: p.p[0], y: p.p[1] })),
    peaks: (raw.pk ?? []).map((p) => ({ name: p.n, height: p.h, x: p.p[0], y: p.p[1] })),
    pois: (raw.poi ?? []).map((p) => ({ kind: p.k, name: p.n, x: p.p[0], y: p.p[1] })),
    riverLabels,
  };
}

const key = (z: number, x: number, y: number): string => `${z}/${x}/${y}`;

export class TileSource {
  private manifest: Manifest | null = null;
  private available = new Set<string>();
  private readonly tiles = new Map<string, Tile>();
  private readonly loading = new Set<string>();
  private readonly failed = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private manifestRequested = false;

  constructor(private readonly base: string) {}

  get info(): Manifest | null {
    return this.manifest;
  }

  /** Calls `listener` whenever a tile or the manifest finished loading. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (!this.manifestRequested) this.loadManifest();
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  private loadManifest(): void {
    this.manifestRequested = true;
    fetch(`${this.base}/manifest.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((manifest) => {
        this.manifest = manifest;
        this.available = new Set();
        for (const [z, list] of Object.entries(manifest.tiles)) for (const [x, y] of list) this.available.add(key(Number(z), x, y));
        this.notify();
      })
      .catch(() => {
        // Without a base map the console still works; markers are drawn on an empty ground.
        this.manifest = { minZoom: 0, maxZoom: 0, extent: EXTENT, tiles: {}, attribution: '', source: '' };
        this.notify();
      });
  }

  private request(z: number, x: number, y: number): void {
    const k = key(z, x, y);
    if (this.tiles.has(k) || this.loading.has(k) || this.failed.has(k) || !this.available.has(k)) return;
    this.loading.add(k);
    fetch(`${this.base}/${k}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<RawTile>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((raw) => {
        this.tiles.set(k, build(z, x, y, raw));
        this.loading.delete(k);
        this.notify();
      })
      .catch(() => {
        this.loading.delete(k);
        this.failed.add(k);
      });
  }

  /**
   * The best tile that can be drawn for cell (z, x, y) right now: the cell's own tile, or the
   * nearest loaded ancestor while the tile is loading or where no detail was extracted.
   */
  resolve(z: number, x: number, y: number): Tile | null {
    if (!this.manifest) return null;
    let cz = Math.min(z, this.manifest.maxZoom);
    let cx = x >> (z - cz);
    let cy = y >> (z - cz);
    let wanted = false;
    for (; cz >= this.manifest.minZoom; cz--, cx >>= 1, cy >>= 1) {
      const k = key(cz, cx, cy);
      if (!this.available.has(k)) continue;
      const tile = this.tiles.get(k);
      if (tile) return tile;
      // Load the most detailed missing tile, and one coarser tile so something shows quickly.
      if (!wanted) {
        this.request(cz, cx, cy);
        wanted = true;
      }
    }
    return null;
  }
}

let shared: TileSource | null = null;

/** One tile cache for all maps of the console. */
export function tileSource(): TileSource {
  shared ??= new TileSource('map');
  return shared;
}
