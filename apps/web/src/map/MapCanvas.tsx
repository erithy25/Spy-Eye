import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatCoordinate, fromUtm, metresPerPixel, project, toMgrs, toUtm, unproject, worldSize } from './geo';
import { useLang } from '../i18n';
import { EXTENT, tileSource, type LineLabel, type PlaceLabel, type Tile, type TileLayers } from './tiles';
import { placeNameEn, riverNameEn } from './placeNames';
import {
  angleBetween,
  cellOutline,
  drawGraticule,
  globeRadius,
  makeGlobe,
  onRim,
  projectGlobe,
  projectTileLayers,
  tileAffine,
  tileToGeo,
  unprojectGlobe,
  visibleCells,
  wrapLon,
  type Globe,
} from './globe';
import { fetchCountries } from '../datum/api';

export type MarkerShape = 'drone' | 'helicopter' | 'fixed' | 'vehicle' | 'bodycam' | 'citizen' | 'satellite' | 'upload' | 'node' | 'incident' | 'fix' | 'truth' | 'segment';

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  shape: MarkerShape;
  /** Name beside the marker; for 'segment' the number written inside it. */
  label: string;
  /** Second line under the label; for 'segment' the name beside it. */
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

export type ShapeStyle = 'solid' | 'dashed' | 'dotted' | 'faint' | 'strong' | 'contour' | 'contour-index';

const R_EARTH_KM = 6371.0088;

/** Country labels of the map tiles whose German name differs from the one in the country outlines. */
const TILE_COUNTRY_EN: Record<string, string> = {
  Botsuana: 'Botswana',
  'Die Bahamas': 'The Bahamas',
  Moldau: 'Moldova',
  'Palästinensische Autonomiegebiete': 'Palestinian Territories',
  Pitcairn: 'Pitcairn Islands',
  'Staat Vatikanstadt': 'Vatican City',
  Surinam: 'Suriname',
  'Vereinigte Staaten von Amerika': 'United States',
  Weißrussland: 'Belarus',
  Zypern: 'Cyprus',
};

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
  /** Globe only: size the whole Earth to fit the map area instead of using `zoom`. */
  fit?: boolean;
  /**
   * Width covered on the right by something drawn over the map (CSS pixels, e.g. a result card):
   * (lat, lon) is centred in the area left of it, and `reachKm` fitted into that area.
   */
  insetRight?: number;
  /**
   * Show this far around (lat, lon) (km): the zoom is chosen from the map's size so that a circle
   * of this radius fits the free area (`zoom` stands until the map has a size).
   */
  reachKm?: number;
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
  /** Fly to a new view (zoom out, travel, zoom in) instead of jumping. */
  fly?: boolean;
  /**
   * Draw the Earth as a globe (orthographic) instead of a flat map: same tiles, colours and
   * labels; dragging turns the globe. Zoom levels of `view` mean the same ground scale as on the
   * flat map at that latitude.
   */
  globe?: boolean;
  /**
   * A rectangle from the top left corner covered by something drawn over the map (CSS pixels,
   * e.g. a tool bar): markers' and shapes' labels and place names keep clear of it, as of the zoom
   * buttons' corner.
   */
  clearTopLeft?: { width: number; height: number } | null;
}

/** A screen position; `v` is false for a point on the far side of the globe (always true flat). */
interface ScreenPoint {
  x: number;
  y: number;
  v: boolean;
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

function drawTile(ctx: CanvasRenderingContext2D, tile: TileLayers, zoom: number, k: number): void {
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
    // On the world map only national borders are drawn; states and districts would fill it.
    if (level !== '2' && zoom < (level === '4' ? 5.5 : 9)) continue;
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
  if (cls === 'country') return zoom >= 1.4 && zoom < 6.2;
  if (cls === 'city') return zoom >= 2.6;
  if (cls === 'town') return zoom >= 8;
  if (cls === 'village') return zoom >= 10.5;
  if (cls === 'suburb') return zoom >= 12;
  return zoom >= 13.2;
}

function placeFont(cls: string, zoom: number): { size: number; weight: number; color: string } {
  if (cls === 'country') return { size: zoom >= 4 ? 10 : 9, weight: 500, color: '#7c7c7c' };
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
  zoom: number,
  width: number,
  height: number,
  occupied: { x0: number; y0: number; x1: number; y1: number }[],
  at: (px: number, py: number) => { lat: number; lon: number } | null,
  toPixel: (lat: number, lon: number) => { x: number; y: number },
): void {
  if (zoom < 9.5) return;
  const step = zoom >= 12.2 ? 1000 : 10_000;
  const centre = at(width / 2, height / 2);
  const edges = [at(0, 0), at(width, 0), at(0, height), at(width, height)];
  if (!centre || edges.some((c) => c === null)) return;
  const zone = toUtm(centre.lat, centre.lon).zone;
  // Bounds in grid coordinates of the centre's zone; the corners are enough at these scales.
  const corners = (edges as { lat: number; lon: number }[]).map((c) => {
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
    return toPixel(g.lat, g.lon);
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
    case 'contour':
      ctx.strokeStyle = 'rgba(237,237,237,0.14)';
      ctx.lineWidth = 0.8;
      break;
    case 'contour-index':
      ctx.strokeStyle = 'rgba(237,237,237,0.3)';
      ctx.lineWidth = 1;
      break;
    default:
      ctx.strokeStyle = 'rgba(237,237,237,0.85)';
      ctx.lineWidth = 1;
  }
}

/** The corner the zoom buttons take (top right, CSS pixels from the right and the top edge). */
const ZOOM_CLEAR_X = 46;
const ZOOM_CLEAR_Y = 70;

/** A screen rectangle a label or a marker takes (CSS pixels). */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

/**
 * Where a shape wants its label (a circle's radius, a ray's end, an area's share): the point and
 * the side the text goes from it ('left': starting there, 'center': centred on it).
 */
interface ShapeLabelRequest {
  text: string;
  x: number;
  y: number;
  align: 'left' | 'center';
}

/** The labels of the shapes, where they want them (shapeLabelRequests), without drawing anything. */
function shapeLabelRequests(shapes: readonly MapShape[], toScreen: (lat: number, lon: number) => ScreenPoint, zoom: number, width: number, height: number): ShapeLabelRequest[] {
  const out: ShapeLabelRequest[] = [];
  for (const s of shapes) {
    if (s.kind === 'area') {
      if (!s.label || !s.labelAt || zoom >= 6.5) continue;
      const p = toScreen(s.labelAt[1], s.labelAt[0]);
      if (p.v && p.x > 0 && p.y > 0 && p.x < width && p.y < height) out.push({ text: s.label, x: p.x, y: p.y, align: 'center' });
    }
  }
  for (const s of shapes) {
    if (s.kind === 'circle' && s.label) {
      const [la, lo] = destination(s.lat, s.lon, 45, s.radiusKm);
      const p = toScreen(la, lo);
      if (p.v) out.push({ text: s.label, x: p.x + 6, y: p.y - 6, align: 'left' });
    } else if (s.kind === 'ray' && s.label) {
      const [la, lo] = destination(s.lat, s.lon, s.azimuthDeg, s.lengthKm);
      const p = toScreen(la, lo);
      if (p.v) out.push({ text: s.label, x: p.x + 6, y: p.y, align: 'left' });
    }
  }
  return out;
}

/** A marker as the overlay lays it out: its symbol's place and size, and its label's, if any. */
interface MarkerPlacement {
  m: MapMarker;
  x: number;
  y: number;
  /** Radius of the symbol (a stretch's ring widened by its number). */
  r: number;
  label: { text: string; second: string | undefined; x: number; y: number; box: Box } | null;
}

/** A shape's label where it found room (the left edge of its text). */
interface ShapeLabelPlacement {
  text: string;
  x: number;
  y: number;
}

/**
 * One layout for everything the overlay writes (marker symbols, marker labels, the labels of the
 * shapes), free of each other, and the boxes they take, so that the base map's place names give
 * way to them instead of being cut ("PARI", "MO⑤AU"). In order: the zoom buttons' corner and a
 * tool bar's corner (MapCanvasProps.clearTopLeft), every
 * marker symbol, the labels of selected and alerting markers (always shown), the labels of the
 * shapes (a share of a country, a radius, a ray: tried at their place and around it, left out
 * where none is free), then the other markers' labels (left out where none is free).
 */
export function overlayLayout(
  ctx: CanvasRenderingContext2D,
  markers: readonly MapMarker[],
  shapes: readonly MapShape[],
  toScreen: (lat: number, lon: number) => ScreenPoint,
  zoom: number,
  width: number,
  height: number,
  clearTopLeft: { width: number; height: number } | null = null,
): { markers: MarkerPlacement[]; shapeLabels: ShapeLabelPlacement[]; boxes: Box[] } {
  const boxes: Box[] = [{ x0: width - ZOOM_CLEAR_X, y0: 0, x1: width, y1: ZOOM_CLEAR_Y }];
  if (clearTopLeft && clearTopLeft.width > 0 && clearTopLeft.height > 0) boxes.push({ x0: 0, y0: 0, x1: clearTopLeft.width, y1: clearTopLeft.height });
  const placed: MarkerPlacement[] = [];
  for (const m of markers) {
    const p = toScreen(m.lat, m.lon);
    // Markers on the far side of the globe and far off the view are not drawn.
    if (!p.v || p.x < -60 || p.y < -30 || p.x > width + 60 || p.y > height + 30) continue;
    let r = m.shape === 'incident' ? 13 : m.shape === 'node' ? 6 : m.shape === 'fix' || m.shape === 'segment' ? 7 : 5;
    if (m.shape === 'segment') {
      ctx.font = `${m.selected ? 700 : 500} 9px ${FONT}`;
      setSpacing(ctx, '0px');
      r = Math.max(r, ctx.measureText(m.label).width / 2 + 3);
    }
    placed.push({ m, x: p.x, y: p.y, r, label: null });
    boxes.push({ x0: p.x - r - 2, y0: p.y - r - 2, x1: p.x + r + 2, y1: p.y + r + 2 });
  }
  // A label's tries keep clear of its own symbol by construction (r + 7 beside it, r + 10 above
  // or below), so one test against every box serves.
  const free = (b: Box): boolean => b.x1 <= width - 4 && b.x0 >= 4 && !boxes.some((o) => overlaps(b, o));
  const placeMarkerLabel = (pl: MarkerPlacement, forced: boolean): void => {
    const { m, x, y, r } = pl;
    const named = m.shape === 'segment' ? (m.sub ?? '') : m.label;
    if (named === '') return;
    const severity = m.alert ?? 0;
    ctx.font = `${m.selected || severity > 0 ? 700 : 500} 10px ${FONT}`;
    setSpacing(ctx, '0.08em');
    const text = named.toUpperCase();
    const second = m.shape === 'segment' ? undefined : m.sub;
    let tw = ctx.measureText(text).width;
    if (second) {
      ctx.font = `400 9px ${FONT}`;
      tw = Math.max(tw, ctx.measureText(second).width);
    }
    const tries = [
      { lx: x + r + 7, ly: y, below: second ? 18 : 7 },
      { lx: x - r - 7 - tw, ly: y, below: second ? 18 : 7 },
      { lx: x - tw / 2, ly: y - r - 10 - (second ? 12 : 0), below: second ? 18 : 7 },
      { lx: x - tw / 2, ly: y + r + 10, below: second ? 18 : 7 },
    ];
    for (const at of tries) {
      const box = { x0: at.lx - 2, y0: at.ly - 7, x1: at.lx + tw + 2, y1: at.ly + at.below };
      if (free(box)) {
        pl.label = { text, second, x: at.lx, y: at.ly, box };
        boxes.push(box);
        return;
      }
    }
    if (!forced) return;
    const first = tries[0] as (typeof tries)[number];
    const box = { x0: first.lx - 2, y0: first.ly - 7, x1: first.lx + tw + 2, y1: first.ly + first.below };
    pl.label = { text, second, x: first.lx, y: first.ly, box };
    boxes.push(box);
  };
  const forced = (pl: MarkerPlacement): boolean => pl.m.selected === true || (pl.m.alert ?? 0) > 0;
  for (const pl of placed) if (forced(pl)) placeMarkerLabel(pl, true);
  const shapeLabels: ShapeLabelPlacement[] = [];
  ctx.font = `500 9px ${FONT}`;
  setSpacing(ctx, '0.12em');
  for (const req of shapeLabelRequests(shapes, toScreen, zoom, width, height)) {
    const text = req.text.toUpperCase();
    const w = ctx.measureText(text).width;
    const left = req.align === 'center' ? req.x - w / 2 : req.x;
    const tries: [number, number][] =
      req.align === 'center'
        ? [[left, req.y], [left, req.y + 13], [left, req.y - 13], [left + w / 2 + 8, req.y], [left - w / 2 - 8, req.y], [left, req.y + 26], [left, req.y - 26]]
        : [[left, req.y], [req.x - 12 - w, req.y], [left, req.y - 13], [left, req.y + 13], [left, req.y - 26], [left, req.y + 26]];
    for (const [tx, ty] of tries) {
      // Kept on the map and clear of the zoom buttons in the top right corner.
      const limit = ty < ZOOM_CLEAR_Y ? width - ZOOM_CLEAR_X : width - 6;
      const x0 = Math.max(6, Math.min(tx, limit - w));
      const box = { x0: x0 - 2, y0: ty - 6, x1: x0 + w + 2, y1: ty + 6 };
      if (box.y0 < 0 || box.y1 > height || !free(box)) continue;
      shapeLabels.push({ text, x: x0, y: ty });
      boxes.push(box);
      break;
    }
  }
  setSpacing(ctx, '0px');
  for (const pl of placed) if (!forced(pl)) placeMarkerLabel(pl, false);
  return { markers: placed, shapeLabels, boxes };
}

/** What overlayLayout depends on besides the view: where markers stand, what they and the shapes say. */
function layoutKey(markers: readonly MapMarker[], shapes: readonly MapShape[]): string {
  const m = markers.map((x) => `${x.id}|${x.lat}|${x.lon}|${x.shape}|${x.label}|${x.sub ?? ''}|${x.selected ? 1 : 0}|${(x.alert ?? 0) > 0 ? 1 : 0}`).join(';');
  const s = shapes
    .map((x) =>
      !('label' in x) || !x.label
        ? ''
        : x.kind === 'area'
          ? `a|${x.label}|${(x.labelAt ?? []).join(',')}`
          : x.kind === 'circle'
            ? `c|${x.label}|${x.lat},${x.lon},${x.radiusKm}`
            : x.kind === 'ray'
              ? `r|${x.label}|${x.lat},${x.lon},${x.azimuthDeg},${x.lengthKm}`
              : '',
    )
    .join(';');
  return `${m}#${s}`;
}

/** Draws the shapes' labels where overlayLayout placed them. */
function drawShapeLabels(ctx: CanvasRenderingContext2D, labels: readonly ShapeLabelPlacement[]): void {
  if (labels.length === 0) return;
  ctx.font = `500 9px ${FONT}`;
  setSpacing(ctx, '0.12em');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  for (const l of labels) {
    ctx.strokeStyle = BG;
    ctx.lineWidth = 3;
    ctx.strokeText(l.text, l.x, l.y);
    ctx.fillStyle = '#bdbdbd';
    ctx.fillText(l.text, l.x, l.y);
  }
  setSpacing(ctx, '0px');
}

/**
 * Draws DATUM geometry: country likelihood, uncertainty circles, view wedges, sun and shadow rays.
 * Their labels are laid out with the markers' (overlayLayout) and drawn by drawShapeLabels.
 */
function drawShapes(
  ctx: CanvasRenderingContext2D,
  shapes: MapShape[],
  toScreen: (lat: number, lon: number) => ScreenPoint,
  zoom: number,
  globe: Globe | null,
): void {
  if (shapes.length === 0) return;
  // toScreen works in CSS pixels.
  const world = worldSize(zoom);
  // Long lines are split so that they follow the projection (great circles look curved on the map).
  const geoPath = (pts: [number, number][]): void => {
    if (globe) {
      // On the globe a line is drawn on the near side only and broken where it passes the rim.
      let open = false;
      for (const [lat, lon] of pts) {
        const p = toScreen(lat, lon);
        if (!p.v) {
          open = false;
          continue;
        }
        if (open) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
        open = true;
      }
      return;
    }
    let prev: { x: number; y: number } | null = null;
    for (const [lat, lon] of pts) {
      const p = toScreen(lat, lon);
      if (prev === null) ctx.moveTo(p.x, p.y);
      else if (Math.abs(p.x - prev.x) > world / 2) {
        // The short way between the two points crosses ±180°: on screen they sit at opposite edges
        // of the world. The step is drawn out over one edge and in again over the other, never as
        // a line across the whole map. The test uses the world width, not the view: zoomed out,
        // the world is narrower than the view.
        const shift = p.x > prev.x ? -world : world;
        ctx.lineTo(p.x + shift, p.y);
        ctx.moveTo(prev.x - shift, prev.y);
        ctx.lineTo(p.x, p.y);
      } else ctx.lineTo(p.x, p.y);
      prev = p;
    }
  };
  for (const s of shapes) {
    if (s.kind !== 'area') continue;
    ctx.beginPath();
    for (const ring of s.rings) {
      if (globe && !ring.some(([lon, lat]) => toScreen(lat, lon).v)) continue;
      ring.forEach(([lon, lat], i) => {
        const raw = toScreen(lat, lon);
        // Far-side points of an area lie on the rim of the globe, so the fill ends at the edge.
        const p = globe ? onRim(globe, raw) : raw;
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
        if (!end.v) break;
        if (s.arrow) {
          const before = toScreen(pts[22]![0], pts[22]![1]);
          // A ray ending just past ±180° has its last points at opposite edges of the world.
          const bx = !globe && Math.abs(end.x - before.x) > world / 2 ? before.x + (end.x > before.x ? world : -world) : before.x;
          const ang = Math.atan2(end.y - before.y, end.x - bx);
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(end.x - 9 * Math.cos(ang - 0.35), end.y - 9 * Math.sin(ang - 0.35));
          ctx.lineTo(end.x, end.y);
          ctx.lineTo(end.x - 9 * Math.cos(ang + 0.35), end.y - 9 * Math.sin(ang + 0.35));
          ctx.stroke();
        }
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

/**
 * A numbered stretch of a recording (DATUM segments): a ring with its number, filled when chosen.
 * Returns the ring's radius.
 */
function drawSegment(ctx: CanvasRenderingContext2D, m: MapMarker, x: number, y: number, r: number, color: string): number {
  ctx.font = `${m.selected ? 700 : 500} 9px ${FONT}`;
  setSpacing(ctx, '0px');
  // The ring holds its number; a wider one ("12+3", stretches at one point) widens it.
  const big = Math.max(r, ctx.measureText(m.label).width / 2 + 3);
  ctx.beginPath();
  ctx.arc(x, y, big, 0, Math.PI * 2);
  ctx.fillStyle = m.selected ? FG : BG;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = m.selected ? 1.5 : 1.1;
  ctx.setLineDash([]);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = m.selected ? BG : m.dim ? '#5a5a5a' : '#c8c8c8';
  ctx.fillText(m.label, x, y + 0.5);
  ctx.textAlign = 'left';
  return big;
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

/** Whether a pointer event started on a control laid over the map (zoom buttons, links). */
function onControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, a, input, select, .geo-zoom') !== null;
}

export function MapCanvas({ view, viewKey, markers, links, shapes, onSelect, minZoom = 5, maxZoom = 15.5, readouts = true, grid = false, label, children, fly = false, globe = false, clearTopLeft = null }: MapCanvasProps) {
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const clearRef = useRef(clearTopLeft);
  clearRef.current = clearTopLeft;
  const globeRef = useRef(globe);
  globeRef.current = globe;
  /**
   * Zoom of a requested view as this map uses it. The flat map enlarges high latitudes by
   * 1 / cos(latitude); the globe does not, so a view meant for the flat map is zoomed in by that
   * factor to show the same ground at the same size.
   */
  const size = useRef({ width: 0, height: 0, dpr: 1 });
  /** Zoom at which the whole globe fills most of the shorter side of the map area. */
  const fitZoom = (insetRight = 0): number | null => {
    const { width, height } = size.current;
    if (width === 0 || height === 0) return null;
    return Math.log2((0.44 * Math.min(Math.max(120, width - insetRight), height) * 2 * Math.PI) / 256);
  };
  /** Whether the current view still is the fitted whole-Earth view (until the user zooms). */
  const fitted = useRef(globe && view.fit === true);
  const viewZoom = (v: MapView): number => {
    const { width, height } = size.current;
    if (v.reachKm !== undefined && width > 0 && height > 0) {
      // The circle's radius takes 0.42 of the free area's shorter side.
      const free = Math.max(120, width - (v.insetRight ?? 0));
      const mpp = (Math.max(0.05, v.reachKm) * 1000) / (0.42 * Math.min(free, height));
      const c = globe ? 1 : Math.cos((Math.max(-80, Math.min(80, v.lat)) * Math.PI) / 180);
      return Math.max(minZoom, Math.min(maxZoom, Math.log2((156543.03 * c) / mpp)));
    }
    if (!globe) return v.zoom;
    const fit = v.fit ? fitZoom(v.insetRight ?? 0) : null;
    if (fit !== null) return Math.max(minZoom, Math.min(maxZoom, fit));
    const c = Math.cos((Math.max(-80, Math.min(80, v.lat)) * Math.PI) / 180);
    return Math.max(minZoom, Math.min(maxZoom, v.zoom - Math.log2(c)));
  };
  const container = useRef<HTMLDivElement>(null);
  const baseCanvas = useRef<HTMLCanvasElement>(null);
  const overlayCanvas = useRef<HTMLCanvasElement>(null);
  // The crosshair has a layer of its own: moving the pointer redraws two hairlines, not every
  // circle, country area and contour line of the overlay.
  const cursorCanvas = useRef<HTMLCanvasElement>(null);
  /**
   * The centre and zoom that show a requested view: (lat, lon) in the middle of the area left of
   * `insetRight` (the centre is moved that half width east of it).
   */
  const targetOf = (v: MapView): ViewState => {
    const zoom = viewZoom(v);
    const shift = (v.insetRight ?? 0) / 2;
    const { width, height } = size.current;
    if (shift <= 0 || width === 0 || height === 0) return { ...project(v.lat, v.lon), zoom };
    if (globe) {
      // The globe turns (it is always centred in the view): by at most 30°, so that a small globe
      // (the whole Earth) does not turn the places around (lat, lon) to its far side.
      const g = makeGlobe(v.lat, v.lon, zoom, width, height);
      const c = unprojectGlobe(g, width / 2 + Math.min(shift, 0.5 * g.r), height / 2);
      return c ? { ...project(c.lat, c.lon), zoom } : { ...project(v.lat, v.lon), zoom };
    }
    const p = project(v.lat, v.lon);
    return { x: p.x + shift / worldSize(zoom), y: p.y, zoom };
  };
  /** A view framed by the map's size (reachKm, insetRight), until the user moves it: framed again on resizing. */
  const framed = useRef<MapView | null>(view.reachKm !== undefined || (view.insetRight ?? 0) > 0 ? view : null);
  const state = useRef<ViewState>({ ...project(view.lat, view.lon), zoom: viewZoom(view) });
  const markersRef = useRef(markers);
  /** German country name -> name in the console language; null while the console is German. */
  const countryNamesRef = useRef<Map<string, string> | null>(null);
  const linksRef = useRef(links ?? []);
  const shapesRef = useRef(shapes ?? []);
  const dirty = useRef({ base: true, overlay: true, cursor: true });
  /** What the base map's place names last gave way to (layoutKey). */
  const layoutShown = useRef('');
  /** Position under the pointer, passed to the readout once per frame instead of per event. */
  const cursorGeo = useRef<{ lat: number; lon: number } | null>(null);
  const frame = useRef<number | null>(null);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ lat: number; lon: number } | null>(null);
  const [zoomShown, setZoomShown] = useState(() => viewZoom(view));
  const [attribution, setAttribution] = useState('');

  markersRef.current = markers;
  linksRef.current = links ?? [];
  shapesRef.current = shapes ?? [];

  /** The globe for the current view (centre, zoom, size). */
  const currentGlobe = useCallback((): Globe => {
    const c = unproject(state.current.x, state.current.y);
    return makeGlobe(c.lat, c.lon, state.current.zoom, size.current.width, size.current.height);
  }, []);

  const toScreen = useCallback(
    (lat: number, lon: number): ScreenPoint => {
      if (globeRef.current) return projectGlobe(currentGlobe(), lat, lon);
      const p = project(lat, lon);
      const world = worldSize(state.current.zoom);
      return {
        x: (p.x - state.current.x) * world + size.current.width / 2,
        y: (p.y - state.current.y) * world + size.current.height / 2,
        v: true,
      };
    },
    [currentGlobe],
  );

  /** Latitude/longitude under a screen point; null off the globe. */
  const geoAt = useCallback(
    (px: number, py: number): { lat: number; lon: number } | null => {
      if (globeRef.current) return unprojectGlobe(currentGlobe(), px, py);
      const world = worldSize(state.current.zoom);
      return unproject(state.current.x + (px - size.current.width / 2) / world, state.current.y + (py - size.current.height / 2) / world);
    },
    [currentGlobe],
  );

  /** Moves the centre of the view to a latitude/longitude (kept in the flat map's coordinates). */
  const centreOn = (lat: number, lon: number): void => {
    const p = project(Math.max(-85, Math.min(85, lat)), wrapLon(lon));
    state.current.x = p.x;
    state.current.y = p.y;
  };

  /** Turns the globe as if the ground under the pointer was dragged by (dx, dy) CSS pixels. */
  const turnGlobe = (dx: number, dy: number): void => {
    const c = unproject(state.current.x, state.current.y);
    const r = globeRadius(state.current.zoom);
    const lat = c.lat + ((dy / r) * 180) / Math.PI;
    const lon = c.lon - ((dx / (r * Math.max(0.2, Math.cos((c.lat * Math.PI) / 180)))) * 180) / Math.PI;
    centreOn(lat, lon);
  };

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

    const zt = Math.max(info.minZoom, Math.min(info.maxZoom, Math.floor(zoom + 0.35)));
    const n = 2 ** zt;
    /** Screen position of a point given in a tile's units; null when it is on the far side. */
    const used = new Map<Tile, (u: number, v: number) => { x: number; y: number } | null>();
    const g = globeRef.current ? currentGlobe() : null;

    if (g) {
      // Cells grouped by the tile that is drawn for them (a coarser ancestor stands in for several
      // cells while their own tiles load): each tile is projected once and clipped to its cells.
      const groups = new Map<Tile, { x: number; y: number }[][]>();
      for (const c of visibleCells(g, zt, width, height)) {
        const outline = cellOutline(g, zt, c.x, c.y);
        if (!outline.visible) continue;
        const xs = outline.points.map((p) => p.x);
        const ys = outline.points.map((p) => p.y);
        if (Math.max(...xs) < 0 || Math.min(...xs) > width || Math.max(...ys) < 0 || Math.min(...ys) > height) continue;
        const tile = source.resolve(zt, c.x, c.y);
        if (!tile) continue;
        const list = groups.get(tile) ?? [];
        list.push(outline.points);
        groups.set(tile, list);
      }
      ctx.save();
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, g.r, 0, Math.PI * 2);
      ctx.clip();
      for (const [tile, cells] of groups) {
        ctx.save();
        ctx.beginPath();
        for (const pts of cells) {
          pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
          ctx.closePath();
        }
        ctx.clip();
        const affine = tileAffine(g, tile);
        if (affine) {
          // Fine tiles: one transform per tile, as on the flat map.
          ctx.setTransform(dpr * affine.a, dpr * affine.b, dpr * affine.c, dpr * affine.d, dpr * affine.e, dpr * affine.f);
          drawTile(ctx, tile, zoom, affine.k);
        } else {
          drawTile(ctx, projectTileLayers(g, tile), zoom, 1);
        }
        ctx.restore();
        used.set(tile, (u, v) => {
          const geo = tileToGeo(tile, u, v);
          const p = projectGlobe(g, geo.lat, geo.lon);
          return p.v ? p : null;
        });
      }
      ctx.restore();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawGraticule(ctx, g, zoom);
    } else {
      const world = worldSize(zoom);
      const cell = world / n;
      const left = cx * world - width / 2;
      const top = cy * world - height / 2;
      const x0 = Math.floor(left / cell);
      const x1 = Math.floor((left + width) / cell);
      const y0 = Math.max(0, Math.floor(top / cell));
      const y1 = Math.min(n - 1, Math.floor((top + height) / cell));
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
          used.set(tile, (u, v) => ({ x: ox + u * k, y: oy + v * k }));
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
    }
    /** Scale of a tile at the screen (CSS pixels per tile unit), for label spacing along rivers. */
    const unitScale = (tile: Tile): number => (g ? (2 * Math.PI * g.r) / 2 ** tile.z / EXTENT : worldSize(zoom) / 2 ** tile.z / EXTENT);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Labels are placed after all geometry, most important first, without overlaps.
    // What the overlay writes takes its room first: place names give way to markers, their labels
    // and the shapes' labels instead of being cut by them.
    const boxes: Box[] = overlayLayout(ctx, markersRef.current, shapesRef.current, toScreen, zoom, width, height, clearRef.current).boxes;
    if (gridRef.current) {
      drawGrid(ctx, zoom, width, height, boxes, geoAt, (lat, lon) => toScreen(lat, lon));
    }
    const free = (b: { x0: number; y0: number; x1: number; y1: number }): boolean =>
      !boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);

    const places: { p: PlaceLabel; x: number; y: number }[] = [];
    const seen = new Set<string>();
    const rivers: { l: LineLabel; x: number; y: number }[] = [];
    for (const [tile, at] of used) {
      for (const p of tile.places) {
        if (!placeVisible(p.cls, zoom)) continue;
        const q = at(p.x, p.y);
        if (!q) continue;
        const { x, y } = q;
        if (x < -40 || y < -10 || x > width + 40 || y > height + 10) continue;
        const id = `${p.name}:${Math.round(x / 24)}:${Math.round(y / 24)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        places.push({ p, x, y });
      }
      if (zoom >= 9.5) {
        for (const l of tile.riverLabels) {
          const q = at(l.x, l.y);
          if (!q) continue;
          const { x, y } = q;
          if (x < 40 || y < 20 || x > width - 40 || y > height - 20) continue;
          if (l.length * unitScale(tile) < 110) continue;
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
      setSpacing(ctx, p.cls === 'country' ? '0.24em' : p.cls === 'city' || p.cls === 'town' ? '0.14em' : '0.06em');
      // The tiles carry German names; in English (the country names are loaded) countries, and
      // every other place by its English name (placeNameEn: the tile's own, the table of the
      // shipped tiles, the German exonyms of cities).
      const english = countryNamesRef.current;
      const name = !english ? p.name : p.cls === 'country' ? (english.get(p.name) ?? p.name) : placeNameEn(p);
      const text = p.cls === 'city' || p.cls === 'town' || p.cls === 'country' ? name.toUpperCase() : name;
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
    const englishRivers = countryNamesRef.current !== null;
    for (const { l, x, y } of rivers) {
      // In English rivers too by their English names ("Themse" is the Thames).
      const name = englishRivers ? riverNameEn(l) : l.name;
      const earlier = riverNames.get(name) ?? [];
      if (earlier.some((e) => Math.hypot(e.x - x, e.y - y) < 420)) continue;
      ctx.font = `400 italic 10px ${FONT}`;
      setSpacing(ctx, '0.3em');
      const w = ctx.measureText(name).width + 8;
      const box = { x0: x - w / 2, y0: y - w / 4, x1: x + w / 2, y1: y + w / 4 };
      if (!free(box)) continue;
      boxes.push(box);
      earlier.push({ x, y });
      riverNames.set(name, earlier);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(l.angle);
      ctx.strokeStyle = BG;
      ctx.lineWidth = 3;
      ctx.strokeText(name, 0, 0);
      ctx.fillStyle = '#6f6f6f';
      ctx.fillText(name, 0, 0);
      ctx.restore();
    }
    setSpacing(ctx, '0px');

    if (zoom >= 12.5) {
      ctx.font = `500 8px ${FONT}`;
      for (const [tile, at] of used) {
        for (const poi of tile.pois) {
          const q = at(poi.x, poi.y);
          if (!q) continue;
          const { x, y } = q;
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
          const q = at(peak.x, peak.y);
          if (!q) continue;
          const { x, y } = q;
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
  }, [currentGlobe, geoAt, toScreen]);

  const drawOverlay = useCallback(
    (now: number) => {
      const canvas = overlayCanvas.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const { width, height, dpr } = size.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      drawShapes(ctx, shapesRef.current, toScreen, state.current.zoom, globeRef.current ? currentGlobe() : null);
      const list = markersRef.current;
      // Symbols and labels of the markers and the shapes' labels, laid out together (the base map
      // gave way to the same layout).
      const layout = overlayLayout(ctx, list, shapesRef.current, toScreen, state.current.zoom, width, height, clearRef.current);
      const positions = new Map<string, { x: number; y: number }>();
      // Markers on the far side of the globe are not drawn (their positions stay unset).
      for (const m of list) {
        const p = toScreen(m.lat, m.lon);
        if (p.v) positions.set(m.id, p);
      }

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
      const rank = (m: MapMarker): number => (m.alert ?? 0) + (m.selected ? 5 : 0);
      const order = [...layout.markers].sort((a, b) => rank(a.m) - rank(b.m));
      for (const { m, x, y, r } of order) {
        const severity = m.alert ?? 0;
        if (severity > 0) {
          const period = severity === 3 ? 1300 : severity === 2 ? 1900 : 2600;
          for (let ring = 0; ring < (severity === 3 ? 2 : 1); ring++) {
            const phase = ((now + (ring * period) / 2) % period) / period;
            ctx.strokeStyle = `rgba(237,237,237,${(1 - phase) * 0.75})`;
            ctx.lineWidth = severity === 3 ? 1.5 : 1;
            ctx.beginPath();
            ctx.arc(x, y, r + 3 + phase * 22, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        if ((m.glow ?? 0) > 0.02) {
          ctx.strokeStyle = `rgba(237,237,237,${0.25 + 0.6 * (m.glow ?? 0)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, r + 5 + 8 * (m.glow ?? 0), 0, Math.PI * 2);
          ctx.stroke();
        }
        const color = m.dim ? '#4a4a4a' : severity > 0 || m.selected ? FG : '#b4b4b4';
        if (m.shape === 'segment') {
          // A stretch of a recording: its number in a ring, filled when chosen; the name beside it.
          drawSegment(ctx, m, x, y, r, color);
          continue;
        }
        drawShape(ctx, m.shape, x, y, r);
        const hollow = m.shape === 'incident' || m.shape === 'fix' || m.shape === 'truth';
        ctx.fillStyle = m.selected || severity > 0 ? (hollow ? 'transparent' : FG) : BG;
        if (!hollow) ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = m.shape === 'incident' || (m.shape === 'fix' && m.selected) ? 1.5 : 1.2;
        ctx.stroke();
      }
      drawShapeLabels(ctx, layout.shapeLabels);
      for (const { m, label } of order) {
        if (!label) continue;
        const severity = m.alert ?? 0;
        ctx.font = `${m.selected || severity > 0 ? 700 : 500} 10px ${FONT}`;
        setSpacing(ctx, '0.08em');
        const { box, text, second, x: lx, y: ly } = label;
        // A plate behind the label keeps it legible over the map's lines (place names gave way).
        ctx.fillStyle = 'rgba(5,5,5,0.86)';
        ctx.fillRect(box.x0 - 2, box.y0 - 1, box.x1 - box.x0 + 4, box.y1 - box.y0 + 2);
        ctx.strokeStyle = BG;
        ctx.lineWidth = 3.5;
        ctx.lineJoin = 'round';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.strokeText(text, lx, ly);
        ctx.fillStyle = m.dim ? '#5a5a5a' : severity > 0 || m.selected ? FG : '#c8c8c8';
        ctx.fillText(text, lx, ly);
        if (second) {
          ctx.font = `400 9px ${FONT}`;
          ctx.strokeText(second, lx, ly + 12);
          ctx.fillStyle = MID;
          ctx.fillText(second, lx, ly + 12);
        }
        setSpacing(ctx, '0px');
      }
    },
    [toScreen, currentGlobe],
  );

  const drawCursor = useCallback(() => {
    const canvas = cursorCanvas.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const { width, height, dpr } = size.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const c = cursorRef.current;
    if (!c) return;
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
  }, []);

  const schedule = useCallback(
    (what: 'base' | 'overlay' | 'both' | 'cursor') => {
      if (what === 'base' || what === 'both') dirty.current.base = true;
      if (what !== 'cursor') dirty.current.overlay = true;
      // The crosshair is cheap and moves with the view, so it is redrawn with everything.
      dirty.current.cursor = true;
      if (frame.current !== null) return;
      const tick = (now: number): void => {
        frame.current = null;
        if (dirty.current.base) {
          dirty.current.base = false;
          drawBase();
        }
        const animated =
          markersRef.current.some((m) => (m.alert ?? 0) > 0) || linksRef.current.some((l) => l.active === true);
        if (dirty.current.overlay || animated) {
          dirty.current.overlay = false;
          drawOverlay(now);
        }
        if (dirty.current.cursor) {
          dirty.current.cursor = false;
          drawCursor();
          setCursor(cursorGeo.current);
        }
        if (animated && !document.hidden) frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    },
    [drawBase, drawOverlay, drawCursor],
  );

  // Size and tile loading.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const resize = (): void => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      size.current = { width: rect.width, height: rect.height, dpr };
      if (framed.current && rect.width > 0 && rect.height > 0) {
        // A view framed by the size of the map area (a route beside the result card) follows it
        // (the first size arrives only now).
        state.current = targetOf(framed.current);
        setZoomShown(state.current.zoom);
      } else if (globeRef.current && fitted.current) {
        // So does the fitted globe.
        const z = fitZoom();
        if (z !== null) {
          state.current.zoom = Math.max(minZoom, Math.min(maxZoom, z));
          setZoomShown(state.current.zoom);
        }
      }
      for (const canvas of [baseCanvas.current, overlayCanvas.current, cursorCanvas.current]) {
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

  // Country labels follow the language switch; the names come with the country outlines.
  const { lang } = useLang();
  useEffect(() => {
    if (lang !== 'en') {
      if (countryNamesRef.current !== null) {
        countryNamesRef.current = null;
        schedule('base');
      }
      return;
    }
    let live = true;
    void fetchCountries().then((list) => {
      if (!live) return;
      countryNamesRef.current = new Map([...list.map((c): [string, string] => [c.name_de, c.name_en]), ...Object.entries(TILE_COUNTRY_EN)]);
      schedule('base');
    });
    return () => {
      live = false;
    };
  }, [lang, schedule]);

  // Jump (or fly) to a new view when asked.
  const flight = useRef<number | null>(null);
  const firstView = useRef(true);
  useEffect(() => {
    fitted.current = globe && view.fit === true;
    framed.current = view.reachKm !== undefined || (view.insetRight ?? 0) > 0 ? view : null;
    const target = targetOf(view);
    if (flight.current !== null) cancelAnimationFrame(flight.current);
    flight.current = null;
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!fly || firstView.current || reduce || size.current.width === 0) {
      firstView.current = false;
      state.current = target;
      setZoomShown(target.zoom);
      schedule('both');
      return;
    }
    const from = { ...state.current };
    if (globe) {
      // On the globe the short way round is the natural one, also over ±180°.
      from.x = target.x + ((((from.x - target.x) % 1) + 1.5) % 1) - 0.5;
    }
    // Straight across the map, never the short way over ±180°: the map draws one copy of the
    // world, so a flight over its edge would show empty space and then cut to the other side.
    // The centre is interpolated without wrapping, so a flight that starts outside [0, 1), where
    // dragging or the arrow keys may leave it, does not jump either; it still ends on the target.
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const fromGeo = unproject(from.x, from.y);
    // On the globe the distance is the arc between the two centres, as a share of the equator.
    const dist = globe ? angleBetween(fromGeo.lat, fromGeo.lon, view.lat, view.lon) / (2 * Math.PI) : Math.hypot(dx, dy);
    const fit = Math.log2((size.current.width * 0.7) / Math.max(1e-9, dist * worldSize(0)));
    const mid = Math.max(minZoom, Math.min(from.zoom, target.zoom, fit));
    const ease = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
    const duration = Math.min(1600, 650 + 120 * (Math.abs(from.zoom - mid) + Math.abs(target.zoom - mid)));
    const started = performance.now();
    const step = (now: number): void => {
      const u = Math.min(1, (now - started) / duration);
      const e = ease(u);
      const zoom = u < 0.5 ? from.zoom + (mid - from.zoom) * ease(u * 2) : mid + (target.zoom - mid) * ease((u - 0.5) * 2);
      state.current = { x: from.x + dx * e, y: from.y + dy * e, zoom };
      setZoomShown(zoom);
      schedule('both');
      flight.current = u < 1 ? requestAnimationFrame(step) : null;
    };
    flight.current = requestAnimationFrame(step);
    return () => {
      if (flight.current !== null) cancelAnimationFrame(flight.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  useEffect(() => {
    // The base map too where what the overlay writes has moved: its place names give way to the
    // markers and labels (overlayLayout). A change of emphasis alone (glow, an alert's pulse)
    // redraws the overlay only.
    const key = `${layoutKey(markers, shapes ?? [])}#${clearTopLeft ? `${Math.round(clearTopLeft.width)}x${Math.round(clearTopLeft.height)}` : ''}`;
    const moved = key !== layoutShown.current;
    layoutShown.current = key;
    schedule(moved ? 'both' : 'overlay');
  }, [markers, links, shapes, schedule, clearTopLeft]);

  const zoomAt = useCallback(
    (delta: number, px: number, py: number) => {
      const s = state.current;
      const next = Math.max(minZoom, Math.min(maxZoom, s.zoom + delta));
      if (next === s.zoom) return;
      fitted.current = false;
      framed.current = null;
      if (globeRef.current) {
        // Keep the place under the pointer where it is: zoom, then turn the globe back under it.
        const before = geoAt(px, py);
        s.zoom = next;
        const after = before ? geoAt(px, py) : null;
        if (before && after) {
          const c = unproject(s.x, s.y);
          centreOn(c.lat + before.lat - after.lat, c.lon + wrapLon(before.lon - after.lon));
        }
      } else {
        const before = worldSize(s.zoom);
        const after = worldSize(next);
        const dx = px - size.current.width / 2;
        const dy = py - size.current.height / 2;
        // Keep the point under the cursor where it is.
        s.x += dx / before - dx / after;
        s.y += dy / before - dy / after;
        s.zoom = next;
      }
      setZoomShown(next);
      schedule('both');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [maxZoom, minZoom, schedule, geoAt],
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
      if (!p.v) continue;
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
        if (e.key.startsWith('Arrow')) framed.current = null;
        if (globeRef.current && e.key.startsWith('Arrow')) {
          const d = { ArrowLeft: [96, 0], ArrowRight: [-96, 0], ArrowUp: [0, 96], ArrowDown: [0, -96] }[e.key];
          if (!d) return;
          turnGlobe(d[0] as number, d[1] as number);
        } else if (e.key === 'ArrowLeft') state.current.x -= step;
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
        // A press on the zoom buttons or a link is theirs: capturing it here would send the click
        // to the map, and the button would never see it.
        if (e.button !== 0 || onControl(e.target)) return;
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
          if (Math.abs(dx) + Math.abs(dy) > 3) {
            d.moved = true;
            framed.current = null;
          }
          if (d.moved && globeRef.current) {
            turnGlobe(dx, dy);
            d.x = e.clientX;
            d.y = e.clientY;
            schedule('both');
          } else if (d.moved) {
            const world = worldSize(state.current.zoom);
            state.current.x -= dx / world;
            state.current.y = Math.min(1, Math.max(0, state.current.y - dy / world));
            d.x = e.clientX;
            d.y = e.clientY;
            schedule('both');
          }
        }
        cursorRef.current = { x: px, y: py };
        cursorGeo.current = geoAt(px, py);
        e.currentTarget.style.cursor = d?.moved ? 'grabbing' : hit(px, py) ? 'pointer' : 'crosshair';
        schedule('cursor');
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
        cursorGeo.current = null;
        schedule('cursor');
      }}
      onDoubleClick={(e) => {
        if (onControl(e.target)) return;
        const rect = e.currentTarget.getBoundingClientRect();
        zoomAt(1, e.clientX - rect.left, e.clientY - rect.top);
      }}
    >
      <canvas ref={baseCanvas} className="geo-layer" />
      <canvas ref={overlayCanvas} className="geo-layer" />
      <canvas ref={cursorCanvas} className="geo-layer" />
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
              <span className="geo-dim">{t('UTMREF')} · WGS 84</span>
            )}
          </div>
          <div className="geo-readout geo-br">
            <ScaleBar lat={globe ? 0 : unproject(state.current.x, state.current.y).lat} zoom={zoomShown} />
            <span className="geo-dim">Z {zoomShown.toFixed(1)}</span>
          </div>
          {attribution !== '' && <div className="geo-attribution">{t(attribution)}</div>}
        </>
      )}
      {children}
    </div>
  );
}

function ScaleBar({ lat, zoom }: { lat: number; zoom: number }) {
  const mpp = metresPerPixel(lat, zoom);
  const steps = [50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000];
  const metres = steps.find((s) => s / mpp >= 70) ?? 5_000_000;
  return (
    <span className="geo-scale">
      <i style={{ width: `${Math.round(metres / mpp)}px` }} />
      {metres >= 1000 ? `${metres / 1000} km` : `${metres} m`}
    </span>
  );
}
