/**
 * Vector HUD for the DATUM viewers, drawn on a 2D canvas above the WebGL canvas: compass tape,
 * crosshair, pitch ladder, labels and rings. Same visual language as the map (hairlines, small
 * caps, tabular figures, a dark halo behind text so it stays legible over bright pictures).
 */

import { formatDecimal } from '../../format';

export const HUD_FONT = "'JetBrains Mono', 'IBM Plex Mono', 'SF Mono', ui-monospace, Menlo, Consolas, monospace";
export const FG = '#ededed';
export const MID = '#a8a8a8';
export const LOW = '#828282';
export const FAINT = '#555555';
const HALO = 'rgba(5,5,5,0.78)';

export function normDeg(a: number): number {
  return ((a % 360) + 360) % 360;
}

export function fmt(value: number, digits = 0): string {
  return formatDecimal(value, digits);
}

/** Signed number with a true minus sign: "+1,20", "−0,35". */
export function fmtSigned(value: number, digits = 0): string {
  const rounded = Number(value.toFixed(digits));
  return `${rounded < 0 ? '−' : '+'}${formatDecimal(Math.abs(rounded), digits)}`;
}

/** Azimuth with three digits: "007°". */
export function fmtAz(a: number): string {
  return `${String(Math.round(normDeg(a)) % 360).padStart(3, '0')}°`;
}

export function fmtMetres(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (m >= 10_000) return `${fmt(m / 1000, 1)} KM`;
  if (m >= 1000) return `${fmt(m / 1000, 2)} KM`;
  if (m >= 100) return `${fmt(m, 0)} M`;
  if (m >= 10) return `${fmt(m, 1)} M`;
  return `${fmt(m, 2)} M`;
}

const POINTS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function cardinal(a: number): string {
  return POINTS16[Math.round(normDeg(a) / 22.5) % 16] ?? 'N';
}

function spacing(ctx: CanvasRenderingContext2D, value: string): void {
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = value;
}

/** Sizes the overlay to the viewport and returns a context in CSS pixels, cleared. */
export function prepareOverlay(canvas: HTMLCanvasElement, width: number, height: number, dpr: number): CanvasRenderingContext2D | null {
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  return ctx;
}

export interface TextStyle {
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  color?: string;
  size?: number;
  weight?: number;
  /** Letter spacing in em. */
  track?: number;
  halo?: boolean;
  alpha?: number;
}

export function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, style: TextStyle = {}): number {
  ctx.save();
  ctx.globalAlpha = style.alpha ?? 1;
  ctx.font = `${style.weight ?? 500} ${style.size ?? 10}px ${HUD_FONT}`;
  spacing(ctx, `${style.track ?? 0.1}em`);
  ctx.textAlign = style.align ?? 'left';
  ctx.textBaseline = style.baseline ?? 'middle';
  if (style.halo !== false) {
    ctx.strokeStyle = HALO;
    ctx.lineWidth = 3;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = style.color ?? FG;
  ctx.fillText(text, x, y);
  const w = ctx.measureText(text).width;
  ctx.restore();
  return w;
}

/** Hairline with a dark underlay so it reads over bright and dark ground alike. */
function hair(ctx: CanvasRenderingContext2D, draw: () => void, color = FG, alpha = 1, halo = true): void {
  ctx.save();
  if (halo) {
    ctx.globalAlpha = alpha * 0.55;
    ctx.strokeStyle = '#050505';
    ctx.lineWidth = 3;
    ctx.beginPath();
    draw();
    ctx.stroke();
  }
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  draw();
  ctx.stroke();
  ctx.restore();
}

export function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha = 1, dashed = false): void {
  ctx.save();
  if (dashed) ctx.setLineDash([2, 3]);
  hair(ctx, () => ctx.arc(x, y, r, 0, Math.PI * 2), FG, alpha);
  ctx.restore();
}

export interface TapeMarker {
  az: number;
  label: string;
  kind: 'sun' | 'origin' | 'target';
}

export interface TapeOptions {
  cx: number;
  y: number;
  width: number;
  /** Azimuth (or relative angle) at the centre of the tape. */
  azimuth: number;
  /** True when no true heading is known: labels are angles relative to the start view. */
  relative: boolean;
  /** Degrees across the full tape. */
  span?: number;
  /** Horizontal field of view, drawn as brackets. */
  fovDeg?: number;
  markers?: TapeMarker[];
}

/**
 * Compass tape: ticks every 5°, labels every 15°, cardinal letters at 45°, index line and an
 * inverted readout at the centre, field-of-view brackets and markers (sun, start direction).
 */
export function drawCompassTape(ctx: CanvasRenderingContext2D, o: TapeOptions): void {
  const span = o.span ?? 100;
  const half = span / 2;
  const ppd = o.width / span;
  const base = o.y + 22;
  const left = o.cx - o.width / 2;
  const fade = (off: number): number => {
    const t = Math.abs(off) / half;
    return t < 0.72 ? 1 : Math.max(0, 1 - (t - 0.72) / 0.28);
  };

  // Baseline in short pieces so that it fades at both ends like the ticks.
  for (let i = 0; i < 40; i++) {
    const x0 = left + (o.width * i) / 40;
    const x1 = left + (o.width * (i + 1)) / 40;
    const off = ((x0 + x1) / 2 - o.cx) / ppd;
    hair(ctx, () => {
      ctx.moveTo(x0, base + 0.5);
      ctx.lineTo(x1, base + 0.5);
    }, FG, 0.3 * fade(off), false);
  }

  const start = Math.ceil((o.azimuth - half) / 5) * 5;
  for (let a = start; a <= o.azimuth + half; a += 5) {
    const off = a - o.azimuth;
    const x = Math.round(o.cx + off * ppd) + 0.5;
    const alpha = fade(off);
    if (alpha <= 0) continue;
    const n = normDeg(a);
    const major = n % 15 === 0;
    const cardinalTick = n % 45 === 0;
    const len = cardinalTick ? 9 : major ? 6 : 3;
    hair(ctx, () => {
      ctx.moveTo(x, base);
      ctx.lineTo(x, base - len);
    }, FG, alpha * (major ? 0.85 : 0.45), false);
    if (!major) continue;
    let text: string;
    let color = LOW;
    let weight = 500;
    if (o.relative) {
      const rel = Math.round(((n + 180) % 360) - 180);
      text = rel === 0 ? '0' : `${rel > 0 ? '+' : '−'}${Math.abs(rel)}`;
      if (rel === 0) {
        color = FG;
        weight = 700;
      }
    } else if (cardinalTick) {
      text = POINTS16[(n / 22.5) % 16] ?? '';
      color = n % 90 === 0 ? FG : MID;
      weight = n % 90 === 0 ? 700 : 500;
    } else {
      text = String(n).padStart(3, '0');
    }
    label(ctx, text, x, base - 17, { align: 'center', color, size: n % 90 === 0 && !o.relative ? 10.5 : 9, weight, alpha, track: 0.06 });
  }

  // Field of view brackets.
  if (o.fovDeg && o.fovDeg / 2 < half) {
    for (const side of [-1, 1]) {
      const x = Math.round(o.cx + side * (o.fovDeg / 2) * ppd) + 0.5;
      hair(ctx, () => {
        ctx.moveTo(x - side * 5, base + 6);
        ctx.lineTo(x, base + 6);
        ctx.lineTo(x, base + 2);
      }, FG, 0.55, false);
    }
  }

  // Markers.
  for (const m of o.markers ?? []) {
    const off = ((((m.az - o.azimuth) % 360) + 540) % 360) - 180;
    if (Math.abs(off) <= half * 0.96) {
      const x = o.cx + off * ppd;
      if (m.kind === 'sun') {
        ring(ctx, x, base, 3.5, 0.95);
      } else {
        hair(ctx, () => {
          ctx.moveTo(x - 3.5, base + 3);
          ctx.lineTo(x, base - 1);
          ctx.lineTo(x + 3.5, base + 3);
        }, FG, 0.9);
      }
      label(ctx, m.label, x, base + 12, { align: 'center', size: 8.5, color: MID, alpha: fade(off), track: 0.12 });
    } else {
      // Off the tape: a chevron at the end pointing the way.
      const side = off > 0 ? 1 : -1;
      const x = o.cx + side * (o.width / 2 + 10);
      hair(ctx, () => {
        ctx.moveTo(x - side * 3, base - 9);
        ctx.lineTo(x + side * 1, base - 5);
        ctx.lineTo(x - side * 3, base - 1);
      }, FG, 0.75);
      label(ctx, m.label, x + side * 6, base - 5, { align: side > 0 ? 'left' : 'right', size: 8.5, color: LOW, track: 0.12 });
    }
  }

  // Index and readout.
  hair(ctx, () => {
    ctx.moveTo(o.cx + 0.5, base - 12);
    ctx.lineTo(o.cx + 0.5, base + 6);
  }, FG, 1);
  const readout = o.relative
    ? `${fmtSigned(((((o.azimuth % 360) + 540) % 360) - 180), 0)}° REL`
    : `${fmtAz(o.azimuth)} ${cardinal(o.azimuth)}`;
  ctx.save();
  ctx.font = `700 10.5px ${HUD_FONT}`;
  spacing(ctx, '0.1em');
  const tw = ctx.measureText(readout).width;
  ctx.fillStyle = FG;
  ctx.fillRect(Math.round(o.cx - tw / 2 - 6), base + 9, Math.round(tw + 12), 16);
  ctx.fillStyle = '#050505';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(readout, o.cx + 1, base + 17.5);
  ctx.restore();
}

/** Centre crosshair with a gap, and an optional range readout to its lower right. */
export function drawCrosshair(ctx: CanvasRenderingContext2D, x: number, y: number, readout?: string | null, sub?: string | null): void {
  const cx = Math.round(x) + 0.5;
  const cy = Math.round(y) + 0.5;
  hair(ctx, () => {
    ctx.moveTo(cx - 15, cy);
    ctx.lineTo(cx - 5, cy);
    ctx.moveTo(cx + 5, cy);
    ctx.lineTo(cx + 15, cy);
    ctx.moveTo(cx, cy - 15);
    ctx.lineTo(cx, cy - 5);
    ctx.moveTo(cx, cy + 5);
    ctx.lineTo(cx, cy + 15);
  }, FG, 0.95);
  ctx.save();
  ctx.fillStyle = FG;
  ctx.fillRect(cx - 0.5, cy - 0.5, 1, 1);
  ctx.restore();
  // Corner brackets around the aim point.
  hair(ctx, () => {
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      ctx.moveTo(cx + sx * 26, cy + sy * 20);
      ctx.lineTo(cx + sx * 26, cy + sy * 26);
      ctx.lineTo(cx + sx * 20, cy + sy * 26);
    }
  }, FG, 0.35, false);
  if (readout) label(ctx, readout, cx + 32, cy + 22, { size: 10.5, weight: 700, track: 0.08 });
  if (sub) label(ctx, sub, cx + 32, cy + 35, { size: 8.5, color: MID, track: 0.14 });
}

/**
 * Pitch ladder: the true horizon as a dashed line outside the centre, short rungs every 10°.
 * `focal` is the vertical focal length in CSS pixels.
 */
export function drawPitchLadder(ctx: CanvasRenderingContext2D, cx: number, cy: number, width: number, pitchDeg: number, focal: number, height: number): void {
  for (let level = -80; level <= 80; level += 10) {
    const d = ((level - pitchDeg) * Math.PI) / 180;
    if (Math.abs(d) >= Math.PI / 2 - 0.05) continue;
    const y = Math.round(cy - focal * Math.tan(d)) + 0.5;
    if (y < 70 || y > height - 60) continue;
    if (level === 0) {
      ctx.save();
      ctx.setLineDash([6, 6]);
      hair(ctx, () => {
        ctx.moveTo(24, y);
        ctx.lineTo(cx - 150, y);
        ctx.moveTo(cx + 150, y);
        ctx.lineTo(width - 24, y);
      }, FG, 0.32, false);
      ctx.restore();
      label(ctx, 'HORIZONT', width - 26, y - 8, { align: 'right', size: 8, color: LOW, track: 0.18 });
      continue;
    }
    hair(ctx, () => {
      ctx.moveTo(cx - 132, y);
      ctx.lineTo(cx - 118, y);
      ctx.moveTo(cx + 118, y);
      ctx.lineTo(cx + 132, y);
    }, FG, 0.42, false);
    const t = `${level > 0 ? '+' : '−'}${Math.abs(level)}`;
    label(ctx, t, cx - 138, y, { align: 'right', size: 8, color: LOW, track: 0.04 });
    label(ctx, t, cx + 138, y, { align: 'left', size: 8, color: LOW, track: 0.04 });
  }
}

/** A sun symbol: ring with four short rays; dashed when the sun is below the horizon. */
export function drawSun(ctx: CanvasRenderingContext2D, x: number, y: number, below: boolean, caption: string, sub?: string): void {
  ring(ctx, x, y, 7, 1, below);
  hair(ctx, () => {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.moveTo(x + Math.cos(a) * 10, y + Math.sin(a) * 10);
      ctx.lineTo(x + Math.cos(a) * (i % 2 ? 12 : 14), y + Math.sin(a) * (i % 2 ? 12 : 14));
    }
  }, FG, below ? 0.4 : 0.85);
  label(ctx, caption, x + 20, y - 4, { size: 9.5, weight: 700, track: 0.14 });
  if (sub) label(ctx, sub, x + 20, y + 8, { size: 8.5, color: MID, track: 0.1 });
}

/** Points to a target outside the viewport from the nearest edge. */
export function drawEdgePointer(ctx: CanvasRenderingContext2D, width: number, height: number, dx: number, dy: number, caption: string): void {
  const margin = 46;
  const cx = width / 2;
  const cy = height / 2;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const sx = ux !== 0 ? (cx - margin) / Math.abs(ux) : Infinity;
  const sy = uy !== 0 ? (cy - margin) / Math.abs(uy) : Infinity;
  const s = Math.min(sx, sy);
  const x = cx + ux * s;
  const y = cy + uy * s;
  const a = Math.atan2(uy, ux);
  hair(ctx, () => {
    ctx.moveTo(x + Math.cos(a + 2.5) * 9, y + Math.sin(a + 2.5) * 9);
    ctx.lineTo(x, y);
    ctx.lineTo(x + Math.cos(a - 2.5) * 9, y + Math.sin(a - 2.5) * 9);
  }, FG, 0.9);
  label(ctx, caption, x - ux * 18, y - uy * 18, { align: ux > 0.3 ? 'right' : ux < -0.3 ? 'left' : 'center', size: 8.5, color: MID, track: 0.14 });
}

/** A small tick cross at a projected point with a caption (for world anchors). */
export function drawAnchor(ctx: CanvasRenderingContext2D, x: number, y: number, caption: string, sub?: string, align: CanvasTextAlign = 'left'): void {
  const dx = align === 'left' ? 8 : align === 'right' ? -8 : 0;
  label(ctx, caption, x + dx, y, { align, size: 9, weight: 700, track: 0.14 });
  if (sub) label(ctx, sub, x + dx, y + 12, { align, size: 8.5, color: MID, track: 0.08 });
}
