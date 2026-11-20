/**
 * Contour lines of a terrain grid (marching squares), for the outline of the terrain around a fix
 * on the map. The grid comes from `/api/datum/terrain` (local elevation tiles, no service).
 */
import type { TerrainGrid } from '../../../server/src/datum/contract';

export interface ContourLine {
  /** Height of the line (m). */
  level: number;
  /** Every fifth interval: drawn stronger. */
  index: boolean;
  /** [lat, lon] along the line. */
  points: [number, number][];
}

export interface ContourSet {
  lines: ContourLine[];
  interval: number;
  minHeight: number;
  maxHeight: number;
}

const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

/** Sources coarser than this (m per pixel) say nothing of the local relief (server: terrain.ts COARSE_SOURCE_M). */
export const COARSE_SOURCE_M = 200;

/**
 * Metres per pixel of a grid's elevation source, and whether it is the world overview (coarser
 * than COARSE_SOURCE_M, about 9 km per pixel at zoom 4) rather than terrain: the grid is then an
 * interpolated plate, without an outline of the terrain. Grids of older nodes carry only the
 * source zoom.
 */
export function terrainSource(grid: Pick<TerrainGrid, 'sourceZoom' | 'sourceMetres' | 'coarse' | 'center'>): { metres: number; coarse: boolean } {
  const metres = grid.sourceMetres ?? (156543.03 * Math.cos((grid.center.lat * Math.PI) / 180)) / 2 ** grid.sourceZoom;
  return { metres, coarse: grid.coarse ?? metres > COARSE_SOURCE_M };
}

/** Interval that gives about `target` lines over the height range. */
export function contourInterval(range: number, target = 14): number {
  const raw = range / Math.max(1, target);
  return STEPS.find((s) => s >= raw) ?? STEPS[STEPS.length - 1]!;
}

/**
 * Lines at every multiple of the interval between the lowest and highest sample. Null when the
 * grid is too coarse to say anything about the local relief (its spacing, or its source: the world
 * overview interpolated to the spacing asked for), or flat.
 */
export function terrainContours(grid: TerrainGrid, maxCellMetres = 150): ContourSet | null {
  const { size, heights, bbox } = grid;
  if (!(grid.cellMetres > 0) || grid.cellMetres > maxCellMetres) return null;
  if (terrainSource(grid).coarse) return null;
  if (size < 3 || heights.length !== size * size) return null;
  const range = grid.maxHeight - grid.minHeight;
  if (!(range >= 2)) return null;
  const interval = contourInterval(range);
  const [west, south, east, north] = bbox;
  // Grid (column, row) from the north-west corner -> [lat, lon].
  const geo = (x: number, y: number): [number, number] => [north - (y / (size - 1)) * (north - south), west + (x / (size - 1)) * (east - west)];
  const h = (x: number, y: number): number => heights[y * size + x]!;
  const lines: ContourLine[] = [];
  const first = Math.ceil(grid.minHeight / interval) * interval;
  for (let level = first; level <= grid.maxHeight; level += interval) {
    // Segments as pairs of edge points; an edge point is keyed by its edge so segments can be joined.
    const segs: [string, string][] = [];
    const where = new Map<string, [number, number]>();
    const edgePoint = (x0: number, y0: number, x1: number, y1: number): string => {
      const key = x0 < x1 || (x0 === x1 && y0 < y1) ? `${x0},${y0},${x1},${y1}` : `${x1},${y1},${x0},${y0}`;
      if (!where.has(key)) {
        const a = h(x0, y0);
        const b = h(x1, y1);
        const t = a === b ? 0.5 : Math.min(1, Math.max(0, (level - a) / (b - a)));
        where.set(key, geo(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t));
      }
      return key;
    };
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const tl = h(x, y) >= level ? 1 : 0;
        const tr = h(x + 1, y) >= level ? 1 : 0;
        const br = h(x + 1, y + 1) >= level ? 1 : 0;
        const bl = h(x, y + 1) >= level ? 1 : 0;
        const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
        if (code === 0 || code === 15) continue;
        const top = (): string => edgePoint(x, y, x + 1, y);
        const right = (): string => edgePoint(x + 1, y, x + 1, y + 1);
        const bottom = (): string => edgePoint(x, y + 1, x + 1, y + 1);
        const left = (): string => edgePoint(x, y, x, y + 1);
        switch (code) {
          case 1:
          case 14:
            segs.push([left(), bottom()]);
            break;
          case 2:
          case 13:
            segs.push([bottom(), right()]);
            break;
          case 3:
          case 12:
            segs.push([left(), right()]);
            break;
          case 4:
          case 11:
            segs.push([top(), right()]);
            break;
          case 6:
          case 9:
            segs.push([top(), bottom()]);
            break;
          case 7:
          case 8:
            segs.push([left(), top()]);
            break;
          case 5:
          case 10: {
            // Saddle: decided by the mean of the four corners.
            const centre = (h(x, y) + h(x + 1, y) + h(x + 1, y + 1) + h(x, y + 1)) / 4 >= level;
            if ((code === 5) === centre) {
              segs.push([left(), top()]);
              segs.push([bottom(), right()]);
            } else {
              segs.push([left(), bottom()]);
              segs.push([top(), right()]);
            }
            break;
          }
          default:
            break;
        }
      }
    }
    // Join segments that share an edge point into polylines.
    const byPoint = new Map<string, number[]>();
    segs.forEach(([a, b], i) => {
      (byPoint.get(a) ?? byPoint.set(a, []).get(a)!).push(i);
      (byPoint.get(b) ?? byPoint.set(b, []).get(b)!).push(i);
    });
    const used = new Uint8Array(segs.length);
    const index = Math.round(level / interval) % 5 === 0;
    for (let s = 0; s < segs.length; s++) {
      if (used[s]) continue;
      used[s] = 1;
      const chain = [segs[s]![0], segs[s]![1]];
      for (const forward of [true, false]) {
        for (;;) {
          const end = forward ? chain[chain.length - 1]! : chain[0]!;
          const next = (byPoint.get(end) ?? []).find((i) => !used[i]);
          if (next === undefined) break;
          used[next] = 1;
          const [a, b] = segs[next]!;
          const other = a === end ? b : a;
          if (forward) chain.push(other);
          else chain.unshift(other);
        }
      }
      if (chain.length >= 3) lines.push({ level, index, points: chain.map((k) => where.get(k)!) });
    }
  }
  return { lines, interval, minHeight: grid.minHeight, maxHeight: grid.maxHeight };
}
