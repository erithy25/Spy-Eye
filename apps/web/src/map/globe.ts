/**
 * The globe: an orthographic view of the Earth drawn from the same offline vector tiles as the
 * flat map. The flat map places a tile with one affine transform; on a sphere that only holds for
 * small tiles, so coarse tiles are projected vertex by vertex and fine tiles (where the curvature
 * inside a tile stays below a pixel) still use one affine transform per tile, which keeps street
 * level as fast as the flat map.
 */
import { EXTENT, type Tile, type TileGeometry, type TileLayers } from './tiles';

const DEG = Math.PI / 180;

/** Orthographic view: centre of the visible hemisphere, sphere radius and its centre on screen. */
export interface Globe {
  lat0: number;
  lon0: number;
  sin0: number;
  cos0: number;
  /** Centre longitude in radians. */
  lam0: number;
  /** Radius of the sphere in CSS pixels. */
  r: number;
  cx: number;
  cy: number;
}

export interface GlobePoint {
  x: number;
  y: number;
  /** On the side of the Earth that faces the viewer. */
  v: boolean;
}

export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * Sphere radius at a zoom level: the equator is as long as the flat map's world at the same
 * zoom, so the centre of the globe has the scale the flat map has on the equator.
 */
export function globeRadius(zoom: number): number {
  return (256 * 2 ** zoom) / (2 * Math.PI);
}

export function makeGlobe(lat0: number, lon0: number, zoom: number, width: number, height: number): Globe {
  const phi = lat0 * DEG;
  return {
    lat0,
    lon0: wrapLon(lon0),
    sin0: Math.sin(phi),
    cos0: Math.cos(phi),
    lam0: wrapLon(lon0) * DEG,
    r: globeRadius(zoom),
    cx: width / 2,
    cy: height / 2,
  };
}

/** Projects with precomputed sin/cos of the latitude (radians for the longitude). */
function projectTrig(g: Globe, sp: number, cp: number, lam: number): GlobePoint {
  const dl = lam - g.lam0;
  const cdl = Math.cos(dl);
  const x = cp * Math.sin(dl);
  const y = g.cos0 * sp - g.sin0 * cp * cdl;
  const c = g.sin0 * sp + g.cos0 * cp * cdl;
  return { x: g.cx + g.r * x, y: g.cy - g.r * y, v: c >= 0 };
}

export function projectGlobe(g: Globe, lat: number, lon: number): GlobePoint {
  const phi = lat * DEG;
  return projectTrig(g, Math.sin(phi), Math.cos(phi), lon * DEG);
}

/**
 * A point on the far side moved onto the rim, in the direction it lies in. Filled areas that run
 * over the rim then end on it instead of folding back over the visible side.
 */
export function onRim(g: Globe, p: GlobePoint): { x: number; y: number } {
  if (p.v) return p;
  const dx = p.x - g.cx;
  const dy = p.y - g.cy;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) return { x: g.cx + g.r, y: g.cy };
  return { x: g.cx + (dx / d) * g.r, y: g.cy + (dy / d) * g.r };
}

export function unprojectGlobe(g: Globe, px: number, py: number): { lat: number; lon: number } | null {
  const x = (px - g.cx) / g.r;
  const y = (g.cy - py) / g.r;
  const rho = Math.hypot(x, y);
  if (rho > 1) return null;
  if (rho < 1e-12) return { lat: g.lat0, lon: g.lon0 };
  const c = Math.asin(rho);
  const sc = Math.sin(c);
  const cc = Math.cos(c);
  const lat = Math.asin(Math.max(-1, Math.min(1, cc * g.sin0 + (y * sc * g.cos0) / rho)));
  const lon = g.lam0 + Math.atan2(x * sc, rho * cc * g.cos0 - y * sc * g.sin0);
  return { lat: lat / DEG, lon: wrapLon(lon / DEG) };
}

/** Great-circle angle between two points (radians). */
export function angleBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * DEG;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ------------------------------------------------------------------ tile geometry on the sphere

/** Tile units to latitude (degrees). */
function tileLat(tile: { z: number; y: number }, v: number): number {
  const my = (tile.y + v / EXTENT) / 2 ** tile.z;
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) / DEG;
}

function tileLon(tile: { z: number; x: number }, u: number): number {
  return ((tile.x + u / EXTENT) / 2 ** tile.z) * 360 - 180;
}

/** Latitude/longitude of a point given in tile units. */
export function tileToGeo(tile: { z: number; x: number; y: number }, u: number, v: number): { lat: number; lon: number } {
  return { lat: tileLat(tile, v), lon: tileLon(tile, u) };
}

/** Vertices as [sin lat, cos lat, lon (radians)] triples, so a frame needs one sin and cos each. */
type Trig = Float64Array;

interface TileTrig {
  water: Trig[];
  urban: Trig[];
  wood: Trig[];
  buildings: Trig[];
  rivers: Trig[];
  streams: Trig[];
  roads: Record<string, Trig[]>;
  bridges: Trig[];
  boundaries: Record<string, Trig[]>;
  contours: Trig[];
  contoursIndex: Trig[];
}

const trigCache = new WeakMap<Tile, TileTrig>();

/**
 * Converts one ring or line. Long straight edges of coarse tiles (a tile border crossing an ocean
 * is a single segment) are split first: on the sphere they are curves, drawn straight they would
 * cut across the globe.
 */
function toTrig(tile: Tile, flat: number[]): Trig {
  const maxStep = tile.z <= 2 ? EXTENT / 64 : tile.z <= 7 ? EXTENT / 32 : Infinity;
  const pts: number[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const u = flat[i] as number;
    const v = flat[i + 1] as number;
    if (i > 0 && maxStep !== Infinity) {
      const pu = flat[i - 2] as number;
      const pv = flat[i - 1] as number;
      const n = Math.ceil(Math.hypot(u - pu, v - pv) / maxStep);
      for (let k = 1; k < n; k++) pts.push(pu + ((u - pu) * k) / n, pv + ((v - pv) * k) / n);
    }
    pts.push(u, v);
  }
  const out = new Float64Array((pts.length / 2) * 3);
  for (let i = 0, j = 0; i + 1 < pts.length; i += 2, j += 3) {
    const phi = tileLat(tile, pts[i + 1] as number) * DEG;
    out[j] = Math.sin(phi);
    out[j + 1] = Math.cos(phi);
    out[j + 2] = tileLon(tile, pts[i] as number) * DEG;
  }
  return out;
}

function trigOf(tile: Tile): TileTrig {
  const cached = trigCache.get(tile);
  if (cached) return cached;
  const list = (rings: number[][]): Trig[] => rings.map((r) => toTrig(tile, r));
  const record = (rec: Record<string, number[][]>): Record<string, Trig[]> =>
    Object.fromEntries(Object.entries(rec).map(([k, rings]) => [k, list(rings)]));
  const geom: TileGeometry = tile.geom;
  const trig: TileTrig = {
    water: list(geom.water),
    urban: list(geom.urban),
    wood: list(geom.wood),
    buildings: list(geom.buildings),
    rivers: list(geom.rivers),
    streams: list(geom.streams),
    roads: record(geom.roads),
    bridges: list(geom.bridges),
    boundaries: record(geom.boundaries),
    contours: list(geom.contours),
    contoursIndex: list(geom.contoursIndex),
  };
  trigCache.set(tile, trig);
  return trig;
}

/** Areas: points behind the rim are moved onto it, so the fill ends at the edge of the Earth. */
function areaPath(g: Globe, rings: Trig[]): Path2D | null {
  let path: Path2D | null = null;
  for (const ring of rings) {
    const n = ring.length / 3;
    if (n < 3) continue;
    const pts: { x: number; y: number }[] = [];
    let anyVisible = false;
    for (let j = 0; j < ring.length; j += 3) {
      const p = projectTrig(g, ring[j] as number, ring[j + 1] as number, ring[j + 2] as number);
      if (p.v) anyVisible = true;
      pts.push(onRim(g, p));
    }
    if (!anyVisible) continue;
    path ??= new Path2D();
    pts.forEach((p, i) => (i === 0 ? path!.moveTo(p.x, p.y) : path!.lineTo(p.x, p.y)));
    path.closePath();
  }
  return path;
}

/** Lines: drawn on the visible side only, broken where they pass behind the rim. */
function linePath(g: Globe, lines: Trig[]): Path2D | null {
  let path: Path2D | null = null;
  for (const line of lines) {
    let open = false;
    for (let j = 0; j < line.length; j += 3) {
      const p = projectTrig(g, line[j] as number, line[j + 1] as number, line[j + 2] as number);
      if (!p.v) {
        open = false;
        continue;
      }
      path ??= new Path2D();
      if (open) path.lineTo(p.x, p.y);
      else path.moveTo(p.x, p.y);
      open = true;
    }
  }
  return path;
}

/** The tile's layers projected onto the globe, in CSS pixels (draw them with scale 1). */
export function projectTileLayers(g: Globe, tile: Tile): TileLayers {
  const t = trigOf(tile);
  const lines = (rec: Record<string, Trig[]>): Record<string, Path2D> => {
    const out: Record<string, Path2D> = {};
    for (const [k, list] of Object.entries(rec)) {
      const p = linePath(g, list);
      if (p) out[k] = p;
    }
    return out;
  };
  return {
    water: areaPath(g, t.water),
    urban: areaPath(g, t.urban),
    wood: areaPath(g, t.wood),
    buildings: areaPath(g, t.buildings),
    rivers: linePath(g, t.rivers),
    streams: linePath(g, t.streams),
    roads: lines(t.roads),
    bridges: linePath(g, t.bridges),
    boundaries: lines(t.boundaries),
    contours: linePath(g, t.contours),
    contoursIndex: linePath(g, t.contoursIndex),
  };
}

/**
 * For a fine tile (zoom 9 and up the curvature inside one tile stays well below a pixel at the
 * zoom levels it is drawn at): the affine transform from tile units to CSS pixels, taken from the
 * projection at the tile centre. Null when the tile reaches the far side.
 */
export function tileAffine(g: Globe, tile: Tile): { a: number; b: number; c: number; d: number; e: number; f: number; k: number } | null {
  if (tile.z < 9) return null;
  const h = EXTENT / 2;
  const q = EXTENT / 4;
  const at = (u: number, v: number): GlobePoint => {
    const p = tileToGeo(tile, u, v);
    return projectGlobe(g, p.lat, p.lon);
  };
  const p0 = at(h, h);
  const pu = at(h + q, h);
  const pv = at(h, h + q);
  if (!p0.v || !pu.v || !pv.v) return null;
  const a = (pu.x - p0.x) / q;
  const b = (pu.y - p0.y) / q;
  const c = (pv.x - p0.x) / q;
  const d = (pv.y - p0.y) / q;
  const e = p0.x - a * h - c * h;
  const f = p0.y - b * h - d * h;
  return { a, b, c, d, e, f, k: Math.sqrt(Math.abs(a * d - b * c)) };
}

/** Outline of a tile cell (zoom z, column x, row y) on the globe, far-side points on the rim. */
export function cellOutline(g: Globe, z: number, x: number, y: number): { points: { x: number; y: number }[]; visible: boolean } {
  const steps = z <= 3 ? 16 : z <= 7 ? 8 : 2;
  const cell = { z, x, y };
  const points: { x: number; y: number }[] = [];
  let visible = false;
  const push = (u: number, v: number): void => {
    const geo = tileToGeo(cell, u, v);
    const p = projectGlobe(g, geo.lat, geo.lon);
    if (p.v) visible = true;
    points.push(onRim(g, p));
  };
  for (let i = 0; i < steps; i++) push((EXTENT * i) / steps, 0);
  for (let i = 0; i < steps; i++) push(EXTENT, (EXTENT * i) / steps);
  for (let i = 0; i < steps; i++) push(EXTENT - (EXTENT * i) / steps, EXTENT);
  for (let i = 0; i < steps; i++) push(0, EXTENT - (EXTENT * i) / steps);
  return { points, visible };
}

/** Tile cells at zoom z that can show on screen. */
export function visibleCells(g: Globe, z: number, width: number, height: number): { x: number; y: number }[] {
  const n = 2 ** z;
  const found = new Set<number>();
  const add = (x: number, y: number): void => {
    if (y < 0 || y >= n) return;
    const xx = ((x % n) + n) % n;
    found.add(y * n + xx);
  };
  if (z <= 4) {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) add(x, y);
  } else {
    // Sample the screen, find the cell under each sample and take its neighbours too, so thin
    // slivers of cells between the samples are not lost.
    const cols = 28;
    const rows = 20;
    for (let i = 0; i <= cols; i++) {
      for (let j = 0; j <= rows; j++) {
        const geo = unprojectGlobe(g, (width * i) / cols, (height * j) / rows);
        if (!geo) continue;
        const lat = Math.max(-85.0511, Math.min(85.0511, geo.lat)) * DEG;
        const mx = (geo.lon + 180) / 360;
        const my = (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2;
        const cx = Math.floor(mx * n);
        const cy = Math.floor(my * n);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) add(cx + dx, cy + dy);
      }
    }
  }
  return [...found].map((k) => ({ x: k % n, y: Math.floor(k / n) }));
}

/** Parallels and meridians every 15° (and the rim), drawn faintly so the sphere reads as one. */
export function drawGraticule(ctx: CanvasRenderingContext2D, g: Globe, zoom: number): void {
  if (zoom < 5.5) {
    ctx.save();
    ctx.strokeStyle = zoom < 4 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    const trace = (pts: GlobePoint[]): void => {
      let open = false;
      for (const p of pts) {
        if (!p.v) {
          open = false;
          continue;
        }
        if (open) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
        open = true;
      }
    };
    for (let lat = -75; lat <= 75; lat += 15) {
      const pts: GlobePoint[] = [];
      for (let lon = -180; lon <= 180; lon += 3) pts.push(projectGlobe(g, lat, lon));
      trace(pts);
    }
    for (let lon = -180; lon < 180; lon += 15) {
      const pts: GlobePoint[] = [];
      for (let lat = -88; lat <= 88; lat += 2) pts.push(projectGlobe(g, lat, lon));
      trace(pts);
    }
    ctx.stroke();
    ctx.restore();
  }
  // The rim: the edge of the Earth against the dark of space.
  if (g.r < 4 * Math.max(g.cx, g.cy)) {
    ctx.save();
    ctx.strokeStyle = 'rgba(237,237,237,0.24)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, g.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(237,237,237,0.06)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, g.r + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
