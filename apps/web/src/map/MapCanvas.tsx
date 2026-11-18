import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatCoordinate, fromUtm, metresPerPixel, project, toMgrs, toUtm, unproject, worldSize } from './geo';
import { useLang } from '../i18n';
import { EXTENT, tileSource, type LineLabel, type PlaceLabel, type Tile } from './tiles';

export type MarkerShape = 'drone' | 'helicopter' | 'fixed' | 'vehicle' | 'bodycam' | 'citizen' | 'satellite' | 'upload' | 'node' | 'incident' | 'fix' | 'truth';

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  shape: MarkerShape;
  label: string;
  /** Second line under the label. */
  sub?: string;
  /** 0 = quiet; 1..3 = an alert of that severity is active here. */
  alert?: 0 | 1 | 2 | 3;
  /** Drawn subdued (source offline, peer unreachable). */
  dim?: boolean;
  selected?: boolean;
  /** 0..1 emphasis, e.g. how well a source matches the current search. */
  glow?: number;
}

export interface MapLink {
  from: string;
  to: string;
  /** Animated while a request is travelling. */
  active?: boolean;
  dim?: boolean;
}

/** Geometry drawn between the base map and the markers (DATUM: uncertainty, sun, view, countries). */
export type MapShape =
  | { kind: 'circle'; lat: number; lon: number; radiusKm: number; style?: ShapeStyle; label?: string }
  | { kind: 'ray'; lat: number; lon: number; azimuthDeg: number; lengthKm: number; style?: ShapeStyle; label?: string; arrow?: boolean }
  | { kind: 'wedge'; lat: number; lon: number; azimuthDeg: number; spreadDeg: number; lengthKm: number; style?: ShapeStyle }
  | { kind: 'line'; points: [number, number][]; style?: ShapeStyle }
  | { kind: 'area'; rings: [number, number][][]; opacity: number; label?: string; labelAt?: [number, number] };

export type ShapeStyle = 'solid' | 'dashed' | 'dotted' | 'faint' | 'strong';

const R_EARTH_KM = 6371.0088;

/** Point reached from (lat, lon) after `km` along the great circle with initial bearing `azimuthDeg`. */
export function destination(lat: number, lon: number, azimuthDeg: number, km: number): [number, number] {
  const d = km / R_EARTH_KM;
  const b = (azimuthDeg * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180;
  const l1 = (lon * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [(p2 * 180) / Math.PI, ((((l2 * 180) / Math.PI + 540) % 360) - 180)];
}

export interface MapView {
  lat: number;
  lon: number;
  zoom: number;
}

interface MapCanvasProps {
  /** Initial view; change `viewKey` to jump to a new one. */
  view: MapView;
  viewKey?: string | number;
  markers: MapMarker[];
  links?: MapLink[];
  shapes?: MapShape[];
  onSelect?: (id: string | null) => void;
  minZoom?: number;
  maxZoom?: number;
  /** Shows cursor position, grid reference and scale. */
  readouts?: boolean;
  /** Draws the UTM kilometre grid. */
  grid?: boolean;
  label?: string;
  children?: ReactNode;
}

const BG = '#050505';
const FG = '#ededed';
const MID = '#8a8a8a';
const FONT = "'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace";

interface ViewState {
  /** Centre in world coordinates 0..1. */
  x: number;
  y: number;
  zoom: number;
}

const ROAD_STYLE: { key: string; color: string; width: number; from: number }[] = [
  { key: 'n', color: '#1e1e1e', width: 0.7, from: 13 },
  { key: 'e', color: '#2b2b2b', width: 0.8, from: 11 },
  { key: 's', color: '#383838', width: 0.9, from: 9 },
  { key: 'p', color: '#484848', width: 1.1, from: 7 },
  { key: 't', color: '#585858', width: 1.3, from: 5 },
  { key: 'm', color: '#6c6c6c', width: 1.5, from: 5 },
];

function setSpacing(ctx: CanvasRenderingContext2D, value: string): void {
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = value;
}

function drawTile(ctx: CanvasRenderingContext2D, tile: Tile, zoom: number, k: number): void {
  // `k` is CSS pixels per tile unit; line widths are given in CSS pixels.
  const w = (px: number): number => px / k;
  if (tile.wood && zoom >= 9) {
    ctx.fillStyle = 'rgba(255,255,255,0.022)';
    ctx.fill(tile.wood, 'evenodd');
  }
  if (tile.urban) {
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    ctx.fill(tile.urban, 'evenodd');
  }
  if (tile.contours && zoom >= 10.5) {
    ctx.strokeStyle = 'rgba(255,255,255,0.055)';
    ctx.lineWidth = w(0.6);
    ctx.stroke(tile.contours);
  }
  if (tile.contoursIndex && zoom >= 9) {
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = w(0.7);
    ctx.stroke(tile.contoursIndex);
  }
  if (tile.streams && zoom >= 12) {
    ctx.strokeStyle = '#262626';
    ctx.lineWidth = w(0.8);
    ctx.stroke(tile.streams);
  }
  if (tile.rivers) {
    ctx.strokeStyle = '#2f2f2f';
    ctx.lineWidth = w(zoom >= 11 ? 1.4 : 1);
    ctx.stroke(tile.rivers);
  }
  if (tile.water) {
    ctx.fillStyle = '#161616';
    ctx.fill(tile.water, 'evenodd');
  }
  if (tile.buildings && zoom >= 13) {
    ctx.fillStyle = 'rgba(255,255,255,0.075)';
    ctx.fill(tile.buildings, 'evenodd');
  }
  for (const level of ['6', '4', '2']) {
    const path = tile.boundaries[level];
    if (!path) continue;
    ctx.strokeStyle = level === '2' ? '#7a7a7a' : level === '4' ? '#454545' : '#2c2c2c';
    ctx.lineWidth = w(level === '2' ? 1.1 : 0.8);
    ctx.setLineDash(level === '2' ? [w(8), w(3), w(1.5), w(3)] : level === '4' ? [w(5), w(3)] : [w(1.5), w(3)]);
    ctx.stroke(path);
  }
  ctx.setLineDash([]);
  const rail = tile.roads['r'];
  if (rail && zoom >= 10) {
    ctx.strokeStyle = '#3a3a3a';
    ctx.lineWidth = w(0.9);
    ctx.setLineDash([w(4), w(2.5)]);
    ctx.stroke(rail);
    ctx.setLineDash([]);
  }
  ctx.lineJoin = 'round';
  for (const style of ROAD_STYLE) {
    const path = tile.roads[style.key];
    if (!path || zoom < style.from) continue;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = w(style.width * (zoom >= 13 ? 1.35 : 1));
    ctx.stroke(path);
  }
  if (tile.bridges && zoom >= 12) {
    ctx.strokeStyle = '#8c8c8c';
    ctx.lineWidth = w(1.6);
    ctx.stroke(tile.bridges);
  }
}

function placeVisible(cls: string, zoom: number): boolean {
  if (cls === 'city') return true;
  if (cls === 'town') return zoom >= 8;
  if (cls === 'village') return zoom >= 10.5;
  if (cls === 'suburb') return zoom >= 12;
  return zoom >= 13.2;
}

function placeFont(cls: string, zoom: number): { size: number; weight: number; color: string } {
  if (cls === 'city') return { size: zoom >= 10 ? 13 : 11, weight: 700, color: '#d8d8d8' };
  if (cls === 'town') return { size: 10.5, weight: 500, color: '#a8a8a8' };
  if (cls === 'village') return { size: 9.5, weight: 500, color: '#808080' };
  return { size: 9, weight: 400, color: '#6a6a6a' };
}

/**
 * UTM grid as on German operations maps: lines every kilometre (every ten at smaller scales),
 * labelled with the two kilometre digits used in a UTMREF grid reference.
 */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  zoom: number,
  width: number,
  height: number,
  occupied: { x0: number; y0: number; x1: number; y1: number }[],
): void {
  if (zoom < 9.5) return;
  const step = zoom >= 12.2 ? 1000 : 10_000;
  const world = worldSize(zoom);
  const at = (px: number, py: number): { lat: number; lon: number } => unproject(cx + (px - width / 2) / world, cy + (py - height / 2) / world);
  const centre = at(width / 2, height / 2);
  const zone = toUtm(centre.lat, centre.lon).zone;
  // Bounds in grid coordinates of the centre's zone; the corners are enough at these scales.
  const corners = [at(0, 0), at(width, 0), at(0, height), at(width, height)].map((c) => {
    const lambda0 = (zone - 1) * 6 - 180 + 3;
    // Positions slightly outside the zone are still projected into it so that lines stay continuous.
    const u = toUtm(c.lat, Math.max(lambda0 - 3.2, Math.min(lambda0 + 3.2, c.lon)));
    return u.zone === zone ? u : toUtm(c.lat, lambda0 + (c.lon > lambda0 ? 2.999 : -2.999));
  });
  const e0 = Math.floor(Math.min(...corners.map((c) => c.easting)) / step) * step;
  const e1 = Math.ceil(Math.max(...corners.map((c) => c.easting)) / step) * step;
  const n0 = Math.floor(Math.min(...corners.map((c) => c.northing)) / step) * step;
  const n1 = Math.ceil(Math.max(...corners.map((c) => c.northing)) / step) * step;
  if ((e1 - e0) / step > 80 || (n1 - n0) / step > 80) return;
  const toScreen = (easting: number, northing: number): { x: number; y: number } => {
    const g = fromUtm(zone, easting, northing);
    const p = project(g.lat, g.lon);
    return { x: (p.x - cx) * world + width / 2, y: (p.y - cy) * world + height / 2 };
  };
  ctx.lineWidth = 1;
  ctx.font = `400 9px ${FONT}`;
  ctx.textBaseline = 'top';
  const label = (value: number): string => String(Math.floor(value / 1000) % 100).padStart(2, '0');
  for (let e = e0; e <= e1; e += step) {
    const a = toScreen(e, n0);
    const b = toScreen(e, n1);
    const major = e % (step * 10) === 0;
    ctx.strokeStyle = major ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.055)';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    // Where the line meets the top edge of the view.
    const t = (30 - a.y) / (b.y - a.y);
    const x = a.x + (b.x - a.x) * t;
    if (x > 40 && x < width - 60) {
      ctx.fillStyle = '#4a4a4a';
      ctx.textAlign = 'left';
      ctx.fillText(label(e), x + 3, 30);
      occupied.push({ x0: x - 2, y0: 26, x1: x + 20, y1: 42 });
    }
  }
  for (let n = n0; n <= n1; n += step) {
    const a = toScreen(e0, n);
    const b = toScreen(e1, n);
    const major = n % (step * 10) === 0;
    ctx.strokeStyle = major ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.055)';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const t = (width - 20 - a.x) / (b.x - a.x);
    const y = a.y + (b.y - a.y) * t;
    if (y > 60 && y < height - 50) {
      ctx.fillStyle = '#4a4a4a';
      ctx.textAlign = 'right';
      ctx.fillText(label(n), width - 6, y + 3);
      occupied.push({ x0: width - 24, y0: y - 1, x1: width, y1: y + 15 });
    }
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
}

function strokeStyleFor(ctx: CanvasRenderingContext2D, style: ShapeStyle | undefined): void {
  ctx.setLineDash([]);
  switch (style ?? 'solid') {
    case 'strong':
      ctx.strokeStyle = FG;
      ctx.lineWidth = 1.4;
      break;
    case 'dashed':
      ctx.strokeStyle = 'rgba(237,237,237,0.8)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      break;
    case 'dotted':
      ctx.strokeStyle = 'rgba(237,237,237,0.7)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([1.2, 3.5]);
      break;
    case 'faint':
      ctx.strokeStyle = 'rgba(237,237,237,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      break;
    default:
      ctx.strokeStyle = 'rgba(237,237,237,0.85)';
      ctx.lineWidth = 1;
  }
}

/** Draws DATUM geometry: country likelihood, uncertainty circles, view wedges, sun and shadow rays. */
function drawShapes(
  ctx: CanvasRenderingContext2D,
  shapes: MapShape[],
  toScreen: (lat: number, lon: number) => { x: number; y: number },
  zoom: number,
): void {
  if (shapes.length === 0) return;
  const { width, height } = ctx.canvas;
  const label = (text: string, x: number, y: number, align: CanvasTextAlign = 'left'): void => {
    ctx.font = `500 9px ${FONT}`;
    setSpacing(ctx, '0.12em');
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = BG;
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.strokeText(text.toUpperCase(), x, y);
    ctx.fillStyle = '#bdbdbd';
    ctx.fillText(text.toUpperCase(), x, y);
    setSpacing(ctx, '0px');
  };
  // Long lines are split so that they follow the projection (great circles look curved on the map).
  const geoPath = (pts: [number, number][]): void => {
    let prev: { x: number; y: number } | null = null;
    for (const [lat, lon] of pts) {
      const p = toScreen(lat, lon);
      if (prev === null || Math.abs(p.x - prev.x) > width) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
      prev = p;
    }
  };
  for (const s of shapes) {
    if (s.kind !== 'area') continue;
    ctx.beginPath();
    for (const ring of s.rings) {
      ring.forEach(([lon, lat], i) => {
        const p = toScreen(lat, lon);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
    }
    ctx.fillStyle = `rgba(237,237,237,${Math.min(0.32, s.opacity * 0.32).toFixed(3)})`;
    ctx.fill('evenodd');
    ctx.strokeStyle = `rgba(237,237,237,${Math.min(0.7, 0.15 + s.opacity * 0.6).toFixed(3)})`;
    ctx.lineWidth = 0.8;
    ctx.setLineDash([]);
    ctx.stroke();
    if (s.label && s.labelAt && zoom < 6.5) {
      const p = toScreen(s.labelAt[1], s.labelAt[0]);
      if (p.x > 0 && p.y > 0 && p.x < width && p.y < height) label(s.label, p.x, p.y, 'center');
    }
  }
  for (const s of shapes) {
    switch (s.kind) {
      case 'circle': {
        const pts: [number, number][] = [];
        for (let a = 0; a <= 360; a += 4) pts.push(destination(s.lat, s.lon, a, s.radiusKm));
        ctx.beginPath();
        geoPath(pts);
        strokeStyleFor(ctx, s.style);
        ctx.stroke();
        if (s.label) {
          const [la, lo] = destination(s.lat, s.lon, 45, s.radiusKm);
          const p = toScreen(la, lo);
          label(s.label, p.x + 6, p.y - 6);
        }
        break;
      }
      case 'ray': {
        const pts: [number, number][] = [];
        for (let i = 0; i <= 24; i++) pts.push(destination(s.lat, s.lon, s.azimuthDeg, (s.lengthKm * i) / 24));
        ctx.beginPath();
        geoPath(pts);
        strokeStyleFor(ctx, s.style);
        ctx.stroke();
        const end = toScreen(pts[24]![0], pts[24]![1]);
        if (s.arrow) {
          const before = toScreen(pts[22]![0], pts[22]![1]);
          const ang = Math.atan2(end.y - before.y, end.x - before.x);
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(end.x - 9 * Math.cos(ang - 0.35), end.y - 9 * Math.sin(ang - 0.35));
          ctx.lineTo(end.x, end.y);
          ctx.lineTo(end.x - 9 * Math.cos(ang + 0.35), end.y - 9 * Math.sin(ang + 0.35));
          ctx.stroke();
        }
        if (s.label) label(s.label, end.x + 6, end.y);
        break;
      }
      case 'wedge': {
        const pts: [number, number][] = [[s.lat, s.lon]];
        for (let a = -s.spreadDeg / 2; a <= s.spreadDeg / 2 + 0.001; a += s.spreadDeg / 16) pts.push(destination(s.lat, s.lon, s.azimuthDeg + a, s.lengthKm));
        pts.push([s.lat, s.lon]);
        ctx.beginPath();
        geoPath(pts);
        ctx.fillStyle = 'rgba(237,237,237,0.06)';
        ctx.fill();
        strokeStyleFor(ctx, s.style);
        ctx.stroke();
        break;
      }
      case 'line': {
        ctx.beginPath();
        geoPath(s.points);
        strokeStyleFor(ctx, s.style);
        ctx.stroke();
        break;
      }
      default:
        break;
    }
  }
  ctx.setLineDash([]);
}

function drawShape(ctx: CanvasRenderingContext2D, shape: MarkerShape, x: number, y: number, r: number): void {
  ctx.beginPath();
  switch (shape) {
    case 'drone':
    case 'helicopter':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      if (shape === 'helicopter') {
        ctx.moveTo(x - r * 1.5, y);
        ctx.lineTo(x + r * 1.5, y);
      }
      break;
    case 'fixed':
    case 'upload':
      ctx.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6);
      break;
    case 'vehicle':
      ctx.rect(x - r, y - r * 0.6, r * 2, r * 1.2);
      break;
    case 'bodycam':
      ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
      break;
    case 'citizen':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y + r * 0.8);
      ctx.lineTo(x - r, y + r * 0.8);
      ctx.closePath();
      break;
    case 'satellite':
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        if (i === 0) ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a));
        else ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
      }
      ctx.closePath();
      break;
    case 'fix':
      // Crosshair with a gap at the centre: the determined position.
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.moveTo(x - r * 2, y);
      ctx.lineTo(x - r * 0.45, y);
      ctx.moveTo(x + r * 0.45, y);
      ctx.lineTo(x + r * 2, y);
      ctx.moveTo(x, y - r * 2);
      ctx.lineTo(x, y - r * 0.45);
      ctx.moveTo(x, y + r * 0.45);
      ctx.lineTo(x, y + r * 2);
      break;
    case 'truth':
      // Ground truth: a small diagonal cross.
      ctx.moveTo(x - r, y - r);
      ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r);
      ctx.lineTo(x - r, y + r);
      break;
    case 'node':
      ctx.rect(x - r, y - r, r * 2, r * 2);
      ctx.rect(x - r * 0.4, y - r * 0.4, r * 0.8, r * 0.8);
      break;
    case 'incident': {
      const c = r * 0.55;
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        ctx.moveTo(x + sx * r, y + sy * (r - c));
        ctx.lineTo(x + sx * r, y + sy * r);
        ctx.lineTo(x + sx * (r - c), y + sy * r);
      }
      break;
    }
  }
}

export function MapCanvas({ view, viewKey, markers, links, shapes, onSelect, minZoom = 5, maxZoom = 15.5, readouts = true, grid = false, label, children }: MapCanvasProps) {
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const container = useRef<HTMLDivElement>(null);
  const baseCanvas = useRef<HTMLCanvasElement>(null);
  const overlayCanvas = useRef<HTMLCanvasElement>(null);
  const state = useRef<ViewState>({ ...project(view.lat, view.lon), zoom: view.zoom });
  const size = useRef({ width: 0, height: 0, dpr: 1 });
  const markersRef = useRef(markers);
  const linksRef = useRef(links ?? []);
  const shapesRef = useRef(shapes ?? []);
  const dirty = useRef({ base: true, overlay: true });
  const frame = useRef<number | null>(null);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ lat: number; lon: number } | null>(null);
  const [zoomShown, setZoomShown] = useState(view.zoom);
  const [attribution, setAttribution] = useState('');

  markersRef.current = markers;
  linksRef.current = links ?? [];
  shapesRef.current = shapes ?? [];

  const toScreen = useCallback((lat: number, lon: number): { x: number; y: number } => {
    const p = project(lat, lon);
    const world = worldSize(state.current.zoom);
    return {
      x: (p.x - state.current.x) * world + size.current.width / 2,
      y: (p.y - state.current.y) * world + size.current.height / 2,
    };
  }, []);

  const drawBase = useCallback(() => {
    const canvas = baseCanvas.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { width, height, dpr } = size.current;
    const { x: cx, y: cy, zoom } = state.current;
    const source = tileSource();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, width, height);
    const info = source.info;
    if (!info || width === 0) return;

    const world = worldSize(zoom);
    const zt = Math.max(info.minZoom, Math.min(info.maxZoom, Math.floor(zoom + 0.35)));
    const n = 2 ** zt;
    const cell = world / n;
    const left = cx * world - width / 2;
    const top = cy * world - height / 2;
    const x0 = Math.floor(left / cell);
    const x1 = Math.floor((left + width) / cell);
    const y0 = Math.max(0, Math.floor(top / cell));
    const y1 = Math.min(n - 1, Math.floor((top + height) / cell));

    const used = new Map<Tile, { ox: number; oy: number; k: number }>();
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (tx < 0 || tx >= n) continue;
        const tile = source.resolve(zt, tx, ty);
        if (!tile) continue;
        // Position of the resolved tile (which may be a coarser ancestor of this cell).
        const tileCell = world / 2 ** tile.z;
        const ox = tile.x * tileCell - left;
        const oy = tile.y * tileCell - top;
        const k = tileCell / EXTENT;
        used.set(tile, { ox, oy, k });
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.beginPath();
        ctx.rect(tx * cell - left, ty * cell - top, cell + 0.5, cell + 0.5);
        ctx.clip();
        ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * ox, dpr * oy);
        drawTile(ctx, tile, zoom, k);
        ctx.restore();
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Labels are placed after all geometry, most important first, without overlaps.
    const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
    if (gridRef.current) drawGrid(ctx, cx, cy, zoom, width, height, boxes);
    const free = (b: { x0: number; y0: number; x1: number; y1: number }): boolean =>
      !boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);

    const places: { p: PlaceLabel; x: number; y: number }[] = [];
    const seen = new Set<string>();
    const rivers: { l: LineLabel; x: number; y: number }[] = [];
    for (const [tile, t] of used) {
      for (const p of tile.places) {
        if (!placeVisible(p.cls, zoom)) continue;
        const x = t.ox + p.x * t.k;
        const y = t.oy + p.y * t.k;
        if (x < -40 || y < -10 || x > width + 40 || y > height + 10) continue;
        const id = `${p.name}:${Math.round(x / 24)}:${Math.round(y / 24)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        places.push({ p, x, y });
      }
      if (zoom >= 9.5) {
        for (const l of tile.riverLabels) {
          const x = t.ox + l.x * t.k;
          const y = t.oy + l.y * t.k;
          if (x < 40 || y < 20 || x > width - 40 || y > height - 20) continue;
          if (l.length * t.k < 110) continue;
          rivers.push({ l, x, y });
        }
      }
    }
    places.sort((a, b) => a.p.rank - b.p.rank);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    for (const { p, x, y } of places) {
      const font = placeFont(p.cls, zoom);
      ctx.font = `${font.weight} ${font.size}px ${FONT}`;
      setSpacing(ctx, p.cls === 'city' || p.cls === 'town' ? '0.14em' : '0.06em');
      const text = p.cls === 'city' || p.cls === 'town' ? p.name.toUpperCase() : p.name;
      const w = ctx.measureText(text).width + 8;
      const box = { x0: x - w / 2, y0: y - font.size * 0.75, x1: x + w / 2, y1: y + font.size * 0.75 };
      if (!free(box)) continue;
      boxes.push(box);
      ctx.strokeStyle = BG;
      ctx.lineWidth = 3;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = font.color;
      ctx.fillText(text, x, y);
    }
    const riverNames = new Map<string, { x: number; y: number }[]>();
    rivers.sort((a, b) => b.l.length - a.l.length);
    for (const { l, x, y } of rivers) {
      const earlier = riverNames.get(l.name) ?? [];
      if (earlier.some((e) => Math.hypot(e.x - x, e.y - y) < 420)) continue;
      ctx.font = `400 italic 10px ${FONT}`;
      setSpacing(ctx, '0.3em');
      const w = ctx.measureText(l.name).width + 8;
      const box = { x0: x - w / 2, y0: y - w / 4, x1: x + w / 2, y1: y + w / 4 };
      if (!free(box)) continue;
      boxes.push(box);
      earlier.push({ x, y });
      riverNames.set(l.name, earlier);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(l.angle);
      ctx.strokeStyle = BG;
      ctx.lineWidth = 3;
      ctx.strokeText(l.name, 0, 0);
      ctx.fillStyle = '#6f6f6f';
      ctx.fillText(l.name, 0, 0);
      ctx.restore();
    }
    setSpacing(ctx, '0px');

    if (zoom >= 12.5) {
      ctx.font = `500 8px ${FONT}`;
      for (const [tile, t] of used) {
        for (const poi of tile.pois) {
          const x = t.ox + poi.x * t.k;
          const y = t.oy + poi.y * t.k;
          if (x < 0 || y < 0 || x > width || y > height) continue;
          const box = { x0: x - 7, y0: y - 7, x1: x + 7, y1: y + 7 };
          if (!free(box)) continue;
          boxes.push(box);
          ctx.fillStyle = BG;
          ctx.fillRect(x - 5, y - 5, 10, 10);
          ctx.strokeStyle = '#5a5a5a';
          ctx.lineWidth = 1;
          ctx.strokeRect(x - 5 + 0.5, y - 5 + 0.5, 9, 9);
          ctx.fillStyle = '#9a9a9a';
          ctx.fillText(poi.kind.toUpperCase(), x, y + 0.5);
        }
        for (const peak of tile.peaks) {
          const x = t.ox + peak.x * t.k;
          const y = t.oy + peak.y * t.k;
          if (x < 0 || y < 0 || x > width || y > height) continue;
          const box = { x0: x - 18, y0: y - 6, x1: x + 18, y1: y + 14 };
          if (!free(box)) continue;
          boxes.push(box);
          ctx.strokeStyle = '#5a5a5a';
          ctx.beginPath();
          ctx.moveTo(x, y - 3);
          ctx.lineTo(x + 3, y + 2);
          ctx.lineTo(x - 3, y + 2);
          ctx.closePath();
          ctx.stroke();
          ctx.fillStyle = '#5f5f5f';
          ctx.fillText(String(peak.height), x, y + 9);
        }
      }
    }
  }, []);

  const drawOverlay = useCallback(
    (now: number) => {
      const canvas = overlayCanvas.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const { width, height, dpr } = size.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      drawShapes(ctx, shapesRef.current, toScreen, state.current.zoom);
      const list = markersRef.current;
      const positions = new Map<string, { x: number; y: number }>();
      for (const m of list) positions.set(m.id, toScreen(m.lat, m.lon));

      for (const link of linksRef.current) {
        const a = positions.get(link.from);
        const b = positions.get(link.to);
        if (!a || !b) continue;
        ctx.strokeStyle = link.dim ? '#2a2a2a' : link.active ? FG : '#5a5a5a';
        ctx.lineWidth = 1;
        ctx.setLineDash(link.active ? [6, 5] : link.dim ? [2, 5] : []);
        ctx.lineDashOffset = link.active ? -(now / 40) % 11 : 0;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;

      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      // Quiet markers first so that alerting and selected ones stay on top.
      const order = [...list].sort((a, b) => (a.alert ?? 0) + (a.selected ? 5 : 0) - ((b.alert ?? 0) + (b.selected ? 5 : 0)));
      const labelBoxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
      for (const m of order) {
        const p = positions.get(m.id);
        if (!p || p.x < -60 || p.y < -30 || p.x > width + 60 || p.y > height + 30) continue;
        const severity = m.alert ?? 0;
        const r = m.shape === 'incident' ? 13 : m.shape === 'node' ? 6 : m.shape === 'fix' ? 7 : 5;

        if (severity > 0) {
          const period = severity === 3 ? 1300 : severity === 2 ? 1900 : 2600;
          for (let ring = 0; ring < (severity === 3 ? 2 : 1); ring++) {
            const phase = ((now + (ring * period) / 2) % period) / period;
            ctx.strokeStyle = `rgba(237,237,237,${(1 - phase) * 0.75})`;
            ctx.lineWidth = severity === 3 ? 1.5 : 1;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r + 3 + phase * 22, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        if ((m.glow ?? 0) > 0.02) {
          ctx.strokeStyle = `rgba(237,237,237,${0.25 + 0.6 * (m.glow ?? 0)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 5 + 8 * (m.glow ?? 0), 0, Math.PI * 2);
          ctx.stroke();
        }

        const color = m.dim ? '#4a4a4a' : severity > 0 || m.selected ? FG : '#b4b4b4';
        drawShape(ctx, m.shape, p.x, p.y, r);
        const hollow = m.shape === 'incident' || m.shape === 'fix' || m.shape === 'truth';
        ctx.fillStyle = m.selected || severity > 0 ? (hollow ? 'transparent' : FG) : BG;
        if (!hollow) ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = m.shape === 'incident' || (m.shape === 'fix' && m.selected) ? 1.5 : 1.2;
        ctx.stroke();

        if (m.label === '') continue;
        ctx.font = `${m.selected || severity > 0 ? 700 : 500} 10px ${FONT}`;
        setSpacing(ctx, '0.08em');
        const text = m.label.toUpperCase();
        const tw = ctx.measureText(text).width;
        let lx = p.x + r + 7;
        let ly = p.y;
        let box = { x0: lx - 2, y0: ly - 7, x1: lx + tw + 2, y1: ly + (m.sub ? 18 : 7) };
        const clash = (b: typeof box): boolean => labelBoxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
        if (clash(box)) {
          lx = p.x - r - 7 - tw;
          box = { x0: lx - 2, y0: ly - 7, x1: lx + tw + 2, y1: ly + (m.sub ? 18 : 7) };
          if (clash(box)) {
            lx = p.x - tw / 2;
            ly = p.y - r - 10;
            box = { x0: lx - 2, y0: ly - 7, x1: lx + tw + 2, y1: ly + 7 };
            if (clash(box) && !m.selected && severity === 0) continue;
          }
        }
        labelBoxes.push(box);
        // A plate behind the label keeps it legible over the place names of the base map.
        ctx.fillStyle = 'rgba(5,5,5,0.86)';
        ctx.fillRect(box.x0 - 2, box.y0 - 1, box.x1 - box.x0 + 4, box.y1 - box.y0 + 2);
        ctx.strokeStyle = BG;
        ctx.lineWidth = 3.5;
        ctx.lineJoin = 'round';
        ctx.strokeText(text, lx, ly);
        ctx.fillStyle = m.dim ? '#5a5a5a' : severity > 0 || m.selected ? FG : '#c8c8c8';
        ctx.fillText(text, lx, ly);
        if (m.sub) {
          ctx.font = `400 9px ${FONT}`;
          ctx.strokeText(m.sub, lx, ly + 12);
          ctx.fillStyle = MID;
          ctx.fillText(m.sub, lx, ly + 12);
        }
        setSpacing(ctx, '0px');
      }

      const c = cursorRef.current;
      if (c) {
        ctx.strokeStyle = 'rgba(237,237,237,0.28)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(Math.round(c.x) + 0.5, 0);
        ctx.lineTo(Math.round(c.x) + 0.5, height);
        ctx.moveTo(0, Math.round(c.y) + 0.5);
        ctx.lineTo(width, Math.round(c.y) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    },
    [toScreen],
  );

  const schedule = useCallback(
    (what: 'base' | 'overlay' | 'both') => {
      if (what !== 'overlay') dirty.current.base = true;
      dirty.current.overlay = true;
      if (frame.current !== null) return;
      const tick = (now: number): void => {
        frame.current = null;
        if (dirty.current.base) {
          dirty.current.base = false;
          drawBase();
        }
        drawOverlay(now);
        dirty.current.overlay = false;
        const animated =
          markersRef.current.some((m) => (m.alert ?? 0) > 0) || linksRef.current.some((l) => l.active === true);
        if (animated && !document.hidden) frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    },
    [drawBase, drawOverlay],
  );

  // Size and tile loading.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const resize = (): void => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { width: rect.width, height: rect.height, dpr };
      for (const canvas of [baseCanvas.current, overlayCanvas.current]) {
        if (!canvas) continue;
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }
      schedule('both');
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    const unsubscribe = tileSource().subscribe(() => {
      setAttribution(tileSource().info?.attribution ?? '');
      schedule('both');
    });
    setAttribution(tileSource().info?.attribution ?? '');
    // Fonts arrive after the first paint; redraw so labels use them.
    void document.fonts?.ready.then(() => schedule('both'));
    const onVisible = (): void => schedule('both');
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      observer.disconnect();
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [schedule]);

  // Jump to a new view when asked.
  useEffect(() => {
    state.current = { ...project(view.lat, view.lon), zoom: view.zoom };
    setZoomShown(view.zoom);
    schedule('both');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  useEffect(() => {
    schedule('overlay');
  }, [markers, links, shapes, schedule]);

  const zoomAt = useCallback(
    (delta: number, px: number, py: number) => {
      const s = state.current;
      const next = Math.max(minZoom, Math.min(maxZoom, s.zoom + delta));
      if (next === s.zoom) return;
      const before = worldSize(s.zoom);
      const after = worldSize(next);
      const dx = px - size.current.width / 2;
      const dy = py - size.current.height / 2;
      // Keep the point under the cursor where it is.
      s.x += dx / before - dx / after;
      s.y += dy / before - dy / after;
      s.zoom = next;
      setZoomShown(next);
      schedule('both');
    },
    [maxZoom, minZoom, schedule],
  );

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(-event.deltaY * (event.deltaMode === 1 ? 0.08 : 0.0022), event.clientX - rect.left, event.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const hit = (px: number, py: number): string | null => {
    let best: string | null = null;
    let bestDist = 16;
    for (const m of markersRef.current) {
      const p = toScreen(m.lat, m.lon);
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < bestDist) {
        bestDist = d;
        best = m.id;
      }
    }
    return best;
  };

  const { t } = useLang();

  return (
    <div
      ref={container}
      className="geo"
      role="group"
      tabIndex={0}
      aria-roledescription={t('Karte')}
      aria-label={`${t('Karte')}${label ? `: ${label}` : ''}. ${t('Pfeiltasten verschieben, Plus und Minus vergrößern und verkleinern.')}`}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
        const step = 96 / worldSize(state.current.zoom);
        if (e.key === 'ArrowLeft') state.current.x -= step;
        else if (e.key === 'ArrowRight') state.current.x += step;
        else if (e.key === 'ArrowUp') state.current.y = Math.max(0, state.current.y - step);
        else if (e.key === 'ArrowDown') state.current.y = Math.min(1, state.current.y + step);
        else if (e.key === '+' || e.key === '=') zoomAt(1, size.current.width / 2, size.current.height / 2);
        else if (e.key === '-') zoomAt(-1, size.current.width / 2, size.current.height / 2);
        else return;
        e.preventDefault();
        schedule('both');
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, moved: false };
      }}
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const d = drag.current;
        if (d) {
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
          if (d.moved) {
            const world = worldSize(state.current.zoom);
            state.current.x -= dx / world;
            state.current.y = Math.min(1, Math.max(0, state.current.y - dy / world));
            d.x = e.clientX;
            d.y = e.clientY;
            schedule('both');
          }
        }
        cursorRef.current = { x: px, y: py };
        const world = worldSize(state.current.zoom);
        setCursor(unproject(state.current.x + (px - rect.width / 2) / world, state.current.y + (py - rect.height / 2) / world));
        e.currentTarget.style.cursor = d?.moved ? 'grabbing' : hit(px, py) ? 'pointer' : 'crosshair';
        schedule('overlay');
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved && onSelect) {
          const rect = e.currentTarget.getBoundingClientRect();
          onSelect(hit(e.clientX - rect.left, e.clientY - rect.top));
        }
      }}
      onPointerLeave={() => {
        cursorRef.current = null;
        setCursor(null);
        schedule('overlay');
      }}
      onDoubleClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        zoomAt(1, e.clientX - rect.left, e.clientY - rect.top);
      }}
    >
      <canvas ref={baseCanvas} className="geo-layer" />
      <canvas ref={overlayCanvas} className="geo-layer" />
      {label && <div className="geo-readout geo-tl">{label}</div>}
      <div className="geo-zoom">
        <button type="button" aria-label={t('Vergrößern')} onClick={() => zoomAt(1, size.current.width / 2, size.current.height / 2)}>
          +
        </button>
        <button type="button" aria-label={t('Verkleinern')} onClick={() => zoomAt(-1, size.current.width / 2, size.current.height / 2)}>
          −
        </button>
      </div>
      {readouts && (
        <>
          <div className="geo-readout geo-bl">
            {cursor ? (
              <>
                <span>{toMgrs(cursor.lat, cursor.lon)}</span>
                <span className="geo-dim">{formatCoordinate(cursor.lat, cursor.lon)}</span>
              </>
            ) : (
              <span className="geo-dim">UTMREF · WGS 84</span>
            )}
          </div>
          <div className="geo-readout geo-br">
            <ScaleBar lat={unproject(state.current.x, state.current.y).lat} zoom={zoomShown} />
            <span className="geo-dim">Z {zoomShown.toFixed(1)}</span>
          </div>
          {attribution !== '' && <div className="geo-attribution">{attribution}</div>}
        </>
      )}
      {children}
    </div>
  );
}

function ScaleBar({ lat, zoom }: { lat: number; zoom: number }) {
  const mpp = metresPerPixel(lat, zoom);
  const steps = [50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000, 200_000];
  const metres = steps.find((s) => s / mpp >= 70) ?? 200_000;
  return (
    <span className="geo-scale">
      <i style={{ width: `${Math.round(metres / mpp)}px` }} />
      {metres >= 1000 ? `${metres / 1000} km` : `${metres} m`}
    </span>
  );
}
