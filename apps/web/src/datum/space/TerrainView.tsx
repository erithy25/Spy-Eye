/**
 * TerrainView: the terrain around the determined location in 3D, lit by the sun at the determined
 * time (Lambert shading and cast shadows from a shadow map), with contour lines, the camera's
 * position and field of view, the sun's ray and path on a dome above the camera, the terrain
 * horizon and the skyline read from the video. Orbit around it, or step onto the camera point
 * and walk over the ground at eye height.
 *
 * World: x east, z south, y up, metres; origin on the ground below the camera.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { SunPathPoint, TerrainGrid } from '../../../../server/src/datum/contract';
import { useLang } from '../../i18n';
import { FirstPersonControls, OrbitControls } from './controls';
import {
  GlResources,
  LINE_FS,
  LINE_VS,
  LineBuilder,
  createGl,
  fitCanvas,
  loseContext,
  mat4,
  projectToScreen,
  transformPoint,
  vec3,
  type Mesh,
  type Program,
  type Vec3,
} from './gl';
import {
  drawAnchor,
  drawCompassTape,
  drawCrosshair,
  drawSun,
  fmt,
  fmtAz,
  fmtMetres,
  fmtSigned,
  label as hudLabel,
  normDeg,
  prepareOverlay,
  ring,
  LOW,
  MID,
  type TapeMarker,
} from './hud';
import { formatCoordinate } from '../../map/geo';
import { hhmm, localMinutes } from '../panel/common';
import './space.css';

/** The console's translation function (`useLang().t`). */
type Translate = (de: string, vars?: Record<string, string | number>) => string;

export interface TerrainViewProps {
  /** Height grid around the location; null when there is none. */
  terrain: TerrainGrid | null;
  /** True while the grid is still being fetched. */
  loading?: boolean;
  /**
   * The camera point (where the horizon profile and the heading were computed) and the camera
   * as the skyline match solved it: heading, horizontal field of view, pitch (degrees, positive =
   * looking up; missing = level) and image aspect (width / height; missing = 16:9).
   */
  camera: {
    lat: number;
    lon: number;
    headingDeg: number | null;
    fovDeg: number;
    pitchDeg?: number | undefined;
    aspect?: number | undefined;
  };
  sun: { azimuthDeg: number; elevationDeg: number } | null;
  sunPath?: SunPathPoint[];
  /** Time zone of the place (IANA); sunrise and sunset are written in its local time, as on the dials. */
  timezone?: string | null;
  /** Terrain horizon at the camera: elevation angle (deg) for azimuth 0..359. */
  horizonProfile?: number[] | null;
  /** Skyline of the keyframe the heading was matched on: per column the normalised y of the sky boundary. */
  skyline?: number[] | null;
  label?: string;
  /** Inside a page that names the place (RAUM): no title in the picture. */
  embedded?: boolean;
}

type ViewMode = 'orbit' | 'walk';

const EYE = 1.7;
const BG = 0.0196;
const DEG = Math.PI / 180;

/**
 * Direction of a point of the video frame, with the camera model of the server's skyline match
 * (horizon.ts `imageRay`, documented at `Heading.pitchDeg`): pinhole, square pixels, no roll.
 * u runs 0..1 left to right, y 0..1 top to bottom. Returns the azimuth offset from the heading and
 * the elevation above the horizon, in degrees.
 */
function imageRay(u: number, y: number, aspect: number, fovDeg: number, pitchDeg: number): { azOff: number; el: number } {
  const f = 0.5 / Math.tan((fovDeg / 2) * DEG);
  const X = (u - 0.5) / f;
  const Y = (y - 0.5) / (aspect * f);
  const sp = Math.sin(pitchDeg * DEG);
  const cp = Math.cos(pitchDeg * DEG);
  const forward = Y * sp + cp;
  const up = sp - Y * cp;
  return { azOff: Math.atan2(X, forward) / DEG, el: Math.atan2(up, Math.hypot(X, forward)) / DEG };
}

/* ------------------------------------------------------------------ model */

interface TerrainModel {
  size: number;
  xs: Float64Array;
  zs: Float64Array;
  heights: Float32Array;
  minH: number;
  maxH: number;
  /** Ground height below the camera (m above sea level). */
  base: number;
  /** Largest distance from the camera to the grid border along x or z. */
  extent: number;
  cell: number;
  mLat: number;
  mLon: number;
  center: { lat: number; lon: number };
  peak: { x: number; z: number; h: number };
  heightAt(x: number, z: number): number | null;
  toLatLon(x: number, z: number): { lat: number; lon: number };
}

function buildModel(t: TerrainGrid, cam: { lat: number; lon: number }): TerrainModel | null {
  const size = t.size;
  if (!Number.isFinite(size) || size < 2 || !Array.isArray(t.heights) || t.heights.length < size * size) return null;
  const [west, south, east, north] = t.bbox;
  if (![west, south, east, north].every(Number.isFinite) || east <= west || north <= south) return null;
  const mLat = 110_540;
  const mLon = 111_320 * Math.cos((cam.lat * Math.PI) / 180);
  const xs = new Float64Array(size);
  const zs = new Float64Array(size);
  for (let i = 0; i < size; i++) xs[i] = (west + ((east - west) * i) / (size - 1) - cam.lon) * mLon;
  for (let j = 0; j < size; j++) zs[j] = (cam.lat - (north - ((north - south) * j) / (size - 1))) * mLat;
  const heights = new Float32Array(size * size);
  let minH = Infinity;
  let maxH = -Infinity;
  let valid = 0;
  for (let k = 0; k < size * size; k++) {
    const h = t.heights[k];
    if (typeof h === 'number' && Number.isFinite(h) && h > -1000 && h < 9000) {
      heights[k] = h;
      minH = Math.min(minH, h);
      maxH = Math.max(maxH, h);
      valid++;
    } else heights[k] = NaN;
  }
  if (valid < size * size * 0.5) return null;
  let peak = { x: 0, z: 0, h: -Infinity };
  for (let k = 0; k < size * size; k++) {
    if (!Number.isFinite(heights[k]!)) heights[k] = minH;
    if (heights[k]! > peak.h) peak = { x: xs[k % size]!, z: zs[Math.floor(k / size)]!, h: heights[k]! };
  }
  const x0 = xs[0]!;
  const x1 = xs[size - 1]!;
  const z0 = zs[0]!;
  const z1 = zs[size - 1]!;
  const heightAt = (x: number, z: number): number | null => {
    const gx = ((x - x0) / (x1 - x0)) * (size - 1);
    const gz = ((z - z0) / (z1 - z0)) * (size - 1);
    if (!(gx >= 0 && gz >= 0 && gx <= size - 1 && gz <= size - 1)) return null;
    const i = Math.min(size - 2, Math.floor(gx));
    const j = Math.min(size - 2, Math.floor(gz));
    const fx = gx - i;
    const fz = gz - j;
    const k = j * size + i;
    return (heights[k]! * (1 - fx) + heights[k + 1]! * fx) * (1 - fz) + (heights[k + size]! * (1 - fx) + heights[k + size + 1]! * fx) * fz;
  };
  const base = heightAt(0, 0) ?? heights[Math.floor(size / 2) * size + Math.floor(size / 2)]!;
  return {
    size,
    xs,
    zs,
    heights,
    minH,
    maxH,
    base,
    extent: Math.max(Math.abs(x0), Math.abs(x1), Math.abs(z0), Math.abs(z1)),
    cell: (x1 - x0) / (size - 1),
    mLat,
    mLon,
    center: cam,
    peak,
    heightAt,
    toLatLon: (x, z) => ({ lat: cam.lat - z / mLat, lon: cam.lon + x / mLon }),
  };
}

/* ---------------------------------------------------------------- shaders */

const TERRAIN_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aGrad;
uniform mat4 uViewProj;
uniform mat4 uLight;
uniform float uExag;
uniform float uBase;
out vec3 vWorld;
out float vHeight;
out vec3 vNormal;
out vec4 vLight;
void main() {
  vec3 p = vec3(aPos.x, (aPos.y - uBase) * uExag, aPos.z);
  vWorld = p;
  vHeight = aPos.y;
  vNormal = vec3(-aGrad.x * uExag, 1.0, -aGrad.y * uExag);
  vLight = uLight * vec4(p, 1.0);
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

const TERRAIN_FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vWorld;
in float vHeight;
in vec3 vNormal;
in vec4 vLight;
uniform vec3 uSun;
uniform float uSunPower;
uniform float uShadowOn;
uniform sampler2DShadow uShadow;
uniform vec3 uEye;
uniform vec2 uFog;
uniform vec2 uContour;
uniform float uReveal;
uniform float uRevealWidth;
uniform vec3 uGrid;
out vec4 outColor;
float gridLine(vec2 p, float step) {
  vec2 g = p / step;
  vec2 w = max(fwidth(g), vec2(1e-5));
  vec2 a = abs(fract(g - 0.5) - 0.5) / w;
  return (1.0 - min(min(a.x, a.y), 1.0)) * (1.0 - smoothstep(0.2, 0.55, max(w.x, w.y)));
}
float contour(float h, float step) {
  float g = h / step;
  float w = max(fwidth(g), 1e-5);
  float a = abs(fract(g - 0.5) - 0.5) / w;
  return (1.0 - min(a, 1.0)) * (1.0 - smoothstep(0.25, 0.6, w));
}
float shadowAt() {
  vec3 p = vLight.xyz / vLight.w * 0.5 + 0.5;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  vec2 texel = 1.0 / vec2(textureSize(uShadow, 0));
  float s = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      s += texture(uShadow, vec3(p.xy + vec2(float(x), float(y)) * texel, p.z - 0.0004));
    }
  }
  return s / 9.0;
}
void main() {
  float r = length(vWorld.xz);
  if (r > uReveal) discard;
  vec3 n = normalize(vNormal);
  float lambert = max(dot(n, uSun), 0.0);
  float sh = uShadowOn > 0.5 ? shadowAt() : 1.0;
  float shade = 0.035 + 0.06 * (0.5 + 0.5 * n.y) + uSunPower * lambert * mix(0.12, 1.0, sh);
  shade = pow(clamp(shade, 0.0, 1.0), 0.85) * 0.8;
  vec3 c = vec3(shade);
  float minor = contour(vHeight, uContour.x);
  float major = contour(vHeight, uContour.y);
  c = mix(c, vec3(0.93), max(minor * 0.17, major * 0.45));
  // Survey grid in metres from the camera point.
  float g1 = gridLine(vWorld.xz, uGrid.x);
  float g2 = gridLine(vWorld.xz, uGrid.y);
  c = mix(c, vec3(0.93), max(g1 * 0.07, g2 * 0.17) * uGrid.z);
  float d = distance(vWorld, uEye);
  c = mix(c, vec3(${BG}), smoothstep(uFog.x, uFog.y, d));
  float front = 1.0 - smoothstep(0.0, uRevealWidth, uReveal - r);
  c = mix(c, vec3(0.96), front * 0.9);
  outColor = vec4(c, 1.0);
}`;

const DEPTH_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uLight;
uniform float uExag;
uniform float uBase;
void main() {
  gl_Position = uLight * vec4(aPos.x, (aPos.y - uBase) * uExag, aPos.z, 1.0);
}`;

const DEPTH_FS = `#version 300 es
precision mediump float;
void main() {}`;

/* ---------------------------------------------------------------- engine */

interface Live {
  exag: number;
  shadows: boolean;
  dome: boolean;
  sun: { azimuthDeg: number; elevationDeg: number } | null;
  headingDeg: number | null;
  fovDeg: number;
  /** Camera pitch of the skyline match (degrees, positive = up). */
  pitchDeg: number;
  /** Image aspect the match assumed (width / height). */
  aspect: number;
  sunPath: SunPathPoint[];
  timezone: string | null;
  horizonProfile: number[] | null;
  skyline: number[] | null;
}

/** Cheap content signature of a number array, so that a replaced array of the same length is noticed. */
function signature(values: number[] | null): number {
  if (!values) return -1;
  let s = values.length;
  for (let i = 0; i < values.length; i++) s += (values[i] ?? 0) * ((i % 7) + 1);
  return s;
}

interface Readout {
  mode: ViewMode;
  cursor: { x: number; z: number; h: number; dist: number } | null;
  eye: Vec3;
  ground: number | null;
  metresPerPixel: number | null;
  fps: number;
}

interface Hooks {
  live: () => Live;
  onReadout: (r: Readout) => void;
  onMode: (m: ViewMode) => void;
  onLost: () => void;
  /** Translates the HUD texts in the current language. */
  t: Translate;
}

interface CamPose {
  eye: Vec3;
  fwd: Vec3;
  fovY: number;
}

const ORBIT_FOV = (42 * Math.PI) / 180;
const WALK_FOV = (60 * Math.PI) / 180;
const SHADOW_SIZE = 2048;

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

class TerrainEngine {
  private readonly gl: WebGL2RenderingContext;
  private readonly res: GlResources;
  private readonly terrainProg: Program;
  private readonly depthProg: Program;
  private readonly lineProg: Program;
  private readonly terrain: Mesh;
  private lines: Mesh;
  private marker: Mesh;
  private dots: Mesh;
  private hourDots: Mesh;
  private readonly shadowTex: WebGLTexture | null = null;
  private readonly shadowFbo: WebGLFramebuffer | null = null;
  private readonly orbit: OrbitControls;
  private readonly walk: FirstPersonControls;
  private readonly detachOrbit: () => void;
  private readonly detachWalk: () => void;
  private mode: ViewMode = 'orbit';
  private transition: { from: CamPose; to: ViewMode; start: number } | null = null;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private raf = 0;
  private last = 0;
  private fps = 60;
  private dirty = true;
  private linesKey = '';
  private shadowKey = '';
  private readonly lightMat = mat4.create();
  private readonly view = mat4.create();
  private readonly proj = mat4.create();
  private readonly viewProj = mat4.create();
  private pointer: { x: number; y: number } | null = null;
  private pointerMoved = false;
  private cursor: Readout['cursor'] = null;
  private readonly revealStart: number;
  private revealing: boolean;
  private anchors: {
    sun: Vec3 | null;
    rise: { p: Vec3; t: number } | null;
    set: { p: Vec3; t: number } | null;
    cardinals: { p: Vec3; text: string }[];
    cone: Vec3 | null;
    marker: Vec3;
  } = { sun: null, rise: null, set: null, cardinals: [], cone: null, marker: [0, 0, 0] };
  private lastLive: Live;

  constructor(
    private readonly wrap: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly hud: HTMLCanvasElement,
    private readonly model: TerrainModel,
    private readonly hooks: Hooks,
  ) {
    const gl = createGl(canvas);
    // German message; the component translates it when it shows the error.
    if (!gl) throw new Error('WebGL 2 ist in diesem Browser nicht verfügbar.');
    this.gl = gl;
    this.res = new GlResources(gl);
    this.terrainProg = this.res.program(TERRAIN_VS, TERRAIN_FS);
    this.depthProg = this.res.program(DEPTH_VS, DEPTH_FS);
    this.lineProg = this.res.program(LINE_VS, LINE_FS);

    // Terrain mesh: true heights and their gradient; exaggeration is applied in the shader.
    const { size, xs, zs, heights } = model;
    const pos = new Float32Array(size * size * 3);
    const grad = new Float32Array(size * size * 2);
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const k = j * size + i;
        pos[k * 3] = xs[i]!;
        pos[k * 3 + 1] = heights[k]!;
        pos[k * 3 + 2] = zs[j]!;
        const il = Math.max(0, i - 1);
        const ir = Math.min(size - 1, i + 1);
        const ju = Math.max(0, j - 1);
        const jd = Math.min(size - 1, j + 1);
        grad[k * 2] = (heights[j * size + ir]! - heights[j * size + il]!) / (xs[ir]! - xs[il]!);
        grad[k * 2 + 1] = (heights[jd * size + i]! - heights[ju * size + i]!) / (zs[jd]! - zs[ju]!);
      }
    }
    const idx = new Uint32Array((size - 1) * (size - 1) * 6);
    let o = 0;
    for (let j = 0; j < size - 1; j++) {
      for (let i = 0; i < size - 1; i++) {
        const a = j * size + i;
        idx[o++] = a;
        idx[o++] = a + size;
        idx[o++] = a + 1;
        idx[o++] = a + 1;
        idx[o++] = a + size;
        idx[o++] = a + size + 1;
      }
    }
    this.terrain = this.res.mesh(
      [
        { location: 0, size: 3, data: pos },
        { location: 1, size: 2, data: grad },
      ],
      idx,
    );
    const empty = (): Mesh =>
      this.res.mesh([
        { location: 0, size: 3, data: new Float32Array(0) },
        { location: 1, size: 1, data: new Float32Array(0) },
      ]);
    this.lines = empty();
    this.marker = empty();
    this.dots = empty();
    this.hourDots = empty();

    // Shadow map: one depth texture rendered from the sun.
    const tex = this.res.texture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    const fbo = this.res.framebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    if (complete) {
      this.shadowTex = tex;
      this.shadowFbo = fbo;
    }

    const live = hooks.live();
    this.lastLive = live;
    const headingRad = ((live.headingDeg ?? 0) * Math.PI) / 180;
    const groundY = (x: number, z: number): number | null => {
      const h = model.heightAt(x, z);
      return h === null ? null : (h - model.base) * this.lastLive.exag;
    };
    const clamp = (x: number, z: number): [number, number] => {
      const xs0 = model.xs[0]!;
      const xs1 = model.xs[model.size - 1]!;
      const zs0 = model.zs[0]!;
      const zs1 = model.zs[model.size - 1]!;
      return [Math.max(xs0 + 1, Math.min(xs1 - 1, x)), Math.max(zs0 + 1, Math.min(zs1 - 1, z))];
    };
    this.orbit = new OrbitControls(
      wrap,
      { target: [0, 0, 0], distance: model.extent * 2.1, yaw: headingRad, pitch: 0.62 },
      { minDistance: 40, maxDistance: model.extent * 8, ground: groundY, clamp },
    );
    this.walk = new FirstPersonControls(wrap, { position: [0, EYE, 0], yaw: headingRad, pitch: 0 }, { speed: 5, runFactor: 8, ground: groundY, eyeHeight: EYE, clamp });
    this.walk.enabled = false;
    this.detachOrbit = this.orbit.attach();
    this.detachWalk = this.walk.attach();

    wrap.addEventListener('pointermove', this.onPointerMove);
    wrap.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('webglcontextlost', this.onLost);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.revealing = !reduced;
    this.revealStart = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly onLost = (e: Event): void => {
    e.preventDefault();
    cancelAnimationFrame(this.raf);
    this.hooks.onLost();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const rect = this.wrap.getBoundingClientRect();
    this.pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this.pointerMoved = true;
  };

  private readonly onPointerLeave = (): void => {
    this.pointer = null;
    this.pointerMoved = true;
  };

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = fitCanvas(this.canvas, this.width, this.height);
    this.dirty = true;
  }

  invalidate(): void {
    this.dirty = true;
  }

  private currentPose(): CamPose {
    if (this.mode === 'walk') {
      return { eye: [...this.walk.position], fwd: this.walk.forward, fovY: 2 * Math.atan(Math.tan(WALK_FOV / 2) * this.walk.zoom) };
    }
    return { eye: this.orbit.eye(), fwd: this.orbit.forward, fovY: ORBIT_FOV };
  }

  setMode(next: ViewMode): void {
    if (next === this.mode && !this.transition) return;
    const from = this.transition ? this.transitionPose(performance.now()) : this.currentPose();
    if (next === 'walk') {
      const live = this.hooks.live();
      const yaw = ((live.headingDeg ?? 0) * Math.PI) / 180;
      this.walk.setHome({ position: [0, EYE, 0], yaw, pitch: 0 }, true);
      this.walk.update(0);
    }
    this.orbit.enabled = false;
    this.walk.enabled = false;
    this.transition = { from, to: next, start: performance.now() };
    this.mode = next;
    this.hooks.onMode(next);
    this.dirty = true;
  }

  private transitionPose(now: number): CamPose {
    const tr = this.transition;
    const target = this.currentPose();
    if (!tr) return target;
    const t = easeInOut(Math.min(1, (now - tr.start) / 1300));
    // Rise in an arc on the way so that the camera does not cut through hills.
    const lift = Math.sin(t * Math.PI) * this.model.extent * 0.15 * (tr.to === 'walk' ? 1 : 0.5);
    const eye = vec3.lerp(tr.from.eye, target.eye, t);
    eye[1] += lift;
    return { eye, fwd: vec3.normalize(vec3.lerp(tr.from.fwd, target.fwd, t)), fovY: tr.from.fovY + (target.fovY - tr.from.fovY) * t };
  }

  resetWalk(): void {
    this.walk.reset();
  }

  /** World direction for an azimuth and elevation with the vertical exaggeration applied. */
  private dir(az: number, el: number, exag: number): Vec3 {
    const d = vec3.fromAzEl(az, el);
    return vec3.normalize([d[0], d[1] * exag, d[2]]);
  }

  private ground(x: number, z: number, exag: number, lift = 0): Vec3 | null {
    const h = this.model.heightAt(x, z);
    return h === null ? null : [x, (h - this.model.base) * exag + lift, z];
  }

  private rebuildLines(live: Live): void {
    const key = JSON.stringify([
      live.exag,
      live.dome,
      live.sun,
      live.headingDeg,
      live.fovDeg,
      live.pitchDeg,
      live.aspect,
      live.sunPath.length,
      signature(live.horizonProfile),
      signature(live.skyline),
    ]);
    if (key === this.linesKey) return;
    this.linesKey = key;
    const m = this.model;
    const ex = live.exag;
    const b = new LineBuilder();
    const E = m.extent;
    const lift = Math.max(1.5, m.cell * 0.06) * ex;

    // Grid border at terrain height, the base of the block and its corners.
    const n = m.size;
    const border: Vec3[] = [];
    const baseY = (m.minH - m.base) * ex - E * 0.035;
    for (let i = 0; i < n; i++) border.push([m.xs[i]!, (m.heights[i]! - m.base) * ex, m.zs[0]!]);
    for (let j = 1; j < n; j++) border.push([m.xs[n - 1]!, (m.heights[j * n + n - 1]! - m.base) * ex, m.zs[j]!]);
    for (let i = n - 2; i >= 0; i--) border.push([m.xs[i]!, (m.heights[(n - 1) * n + i]! - m.base) * ex, m.zs[n - 1]!]);
    for (let j = n - 2; j > 0; j--) border.push([m.xs[0]!, (m.heights[j * n]! - m.base) * ex, m.zs[j]!]);
    b.polyline(border, 0.6, true);
    const corners: [number, number, number][] = [
      [m.xs[0]!, m.zs[0]!, m.heights[0]!],
      [m.xs[n - 1]!, m.zs[0]!, m.heights[n - 1]!],
      [m.xs[n - 1]!, m.zs[n - 1]!, m.heights[n * n - 1]!],
      [m.xs[0]!, m.zs[n - 1]!, m.heights[(n - 1) * n]!],
    ];
    b.polyline(corners.map(([x, z]) => [x, baseY, z] as Vec3), 0.22, true);
    for (const [x, z, h] of corners) b.segment([x, baseY, z], [x, (h - m.base) * ex, z], 0.3);

    // Camera: a vertical line and rings on the ground (overview only: in first person the eye
    // stands on it).
    const mk = new LineBuilder();
    const markerTop: Vec3 = [0, E * 0.085, 0];
    mk.segment([0, 0, 0], markerTop, 1);
    const drape = (r: number, alpha: number, steps = 96): void => {
      const pts: Vec3[] = [];
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const p = this.ground(Math.sin(a) * r, -Math.cos(a) * r, ex, lift);
        if (p) pts.push(p);
      }
      mk.polyline(pts, alpha, true);
    };
    drape(E * 0.016, 1);
    drape(E * 0.034, 0.35);

    // Field of view along the terrain.
    let coneEnd: Vec3 | null = null;
    if (live.headingDeg !== null) {
      const reach = E * 0.55;
      const along = (az: number, alpha: number, dashed: boolean): Vec3 | null => {
        const a = (az * Math.PI) / 180;
        const pts: Vec3[] = [];
        const step = Math.max(m.cell * 0.5, 4);
        for (let r = E * 0.016; r <= reach; r += step) {
          const p = this.ground(Math.sin(a) * r, -Math.cos(a) * r, ex, lift);
          if (!p) break;
          pts.push(p);
        }
        if (dashed) {
          for (let i = 0; i + 1 < pts.length; i += 4) b.polyline(pts.slice(i, i + 3), alpha);
        } else b.polyline(pts, alpha);
        return pts[pts.length - 1] ?? null;
      };
      along(live.headingDeg - live.fovDeg / 2, 0.9, false);
      along(live.headingDeg + live.fovDeg / 2, 0.9, false);
      coneEnd = along(live.headingDeg, 0.45, true);
      const arc: Vec3[] = [];
      for (let k = 0; k <= 32; k++) {
        const az = ((live.headingDeg - live.fovDeg / 2 + (live.fovDeg * k) / 32) * Math.PI) / 180;
        const p = this.ground(Math.sin(az) * reach * 0.5, -Math.cos(az) * reach * 0.5, ex, lift);
        if (p) arc.push(p);
      }
      b.polyline(arc, 0.3);
    }

    // Dome above the eye: horizon, rings at 30° and 60°, meridians.
    const eye: Vec3 = [0, EYE * ex, 0];
    const R = E * 0.36;
    const onDome = (az: number, el: number): Vec3 => vec3.add(eye, vec3.scale(this.dir(az, el, ex), R));
    const cardinals: { p: Vec3; text: string }[] = [];
    let sunAnchor: Vec3 | null = null;
    let rise: { p: Vec3; t: number } | null = null;
    let set: { p: Vec3; t: number } | null = null;
    const dots = new LineBuilder();
    const hours = new LineBuilder();
    if (live.dome) {
      for (const el of [0, 30, 60]) {
        const pts: Vec3[] = [];
        for (let az = 0; az < 360; az += 3) pts.push(onDome(az, el));
        b.polyline(pts, el === 0 ? 0.28 : 0.1, true);
      }
      for (let az = 0; az < 360; az += 45) {
        const pts: Vec3[] = [];
        for (let el = 0; el <= 90; el += 3) pts.push(onDome(az, el));
        b.polyline(pts, az % 90 === 0 ? 0.16 : 0.07);
        if (az % 90 === 0) cardinals.push({ p: onDome(az, 0), text: ['N', 'O', 'S', 'W'][az / 90] ?? '' });
      }
      // Terrain horizon at its true elevation angles.
      const prof = live.horizonProfile;
      if (prof && prof.length >= 36) {
        const pts: Vec3[] = [];
        for (let i = 0; i < prof.length; i++) pts.push(onDome((i * 360) / prof.length, prof[i] ?? 0));
        b.polyline(pts, 0.95, true);
        // Short ticks down to the dome's horizon every 10°.
        for (let i = 0; i < prof.length; i += Math.round(prof.length / 36)) {
          const az = (i * 360) / prof.length;
          b.segment(onDome(az, 0), onDome(az, prof[i] ?? 0), 0.12);
        }
      }
      // The skyline of the video, placed with the camera the match solved (heading, field of
      // view, pitch, aspect) and the match's column centres, so that it lies on the terrain
      // horizon wherever the match says it fits.
      const sky = live.skyline;
      if (sky && sky.length > 1 && live.headingDeg !== null) {
        const pts: Vec3[] = [];
        for (let c = 0; c < sky.length; c++) {
          const ray = imageRay((c + 0.5) / sky.length, sky[c] ?? 0.5, live.aspect, live.fovDeg, live.pitchDeg);
          pts.push(onDome(live.headingDeg + ray.azOff, ray.el));
        }
        for (let i = 0; i + 1 < pts.length; i += 2) b.segment(pts[i]!, pts[i + 1]!, 1);
      }
      // Sun path: a dot every 10 minutes above the horizon, larger on the hour.
      const path = live.sunPath;
      for (let i = 0; i < path.length; i++) {
        const p = path[i]!;
        if (p.el < -0.5) continue;
        const at = onDome(p.az, p.el);
        const onHour = Math.abs((p.t % 3_600_000) - 0) < 60_000 || Math.abs((p.t % 3_600_000) - 3_600_000) < 60_000;
        (onHour ? hours : dots).point(at, onHour ? 1 : 0.75);
        const prev = path[i - 1];
        const next = path[i + 1];
        if (prev && prev.el < 0 && p.el >= 0 && !rise) rise = { p: at, t: p.t };
        if (next && next.el < 0 && p.el >= 0) set = { p: at, t: p.t };
      }
    }
    if (live.sun) {
      const sd = this.dir(live.sun.azimuthDeg, live.sun.elevationDeg, ex);
      sunAnchor = vec3.add(eye, vec3.scale(sd, R));
      b.segment(eye, sunAnchor, live.sun.elevationDeg > 0 ? 0.95 : 0.35);
      // Drop line from the sun to the dome's horizon, and the sun's azimuth on the ground.
      b.segment(sunAnchor, onDome(live.sun.azimuthDeg, 0), 0.18);
    }
    this.anchors = { sun: sunAnchor, rise, set, cardinals, cone: coneEnd, marker: markerTop };

    const upload = (mesh: Mesh, builder: LineBuilder): void => {
      const { positions, alphas } = builder.arrays();
      this.res.update(mesh, 0, positions, 3);
      this.res.update(mesh, 1, alphas, 1);
    };
    upload(this.lines, b);
    upload(this.marker, mk);
    upload(this.dots, dots);
    upload(this.hourDots, hours);
  }

  /** Light direction (towards the sun, exaggerated) and strength. */
  private light(live: Live): { dir: Vec3; power: number; shadows: boolean } {
    if (live.sun && live.sun.elevationDeg > 0) {
      return { dir: this.dir(live.sun.azimuthDeg, live.sun.elevationDeg, live.exag), power: 0.92, shadows: live.shadows && this.shadowFbo !== null };
    }
    // No sun: a neutral relief light from the north-west, without shadows.
    return { dir: this.dir(315, 40, 1), power: live.sun ? 0.28 : 0.6, shadows: false };
  }

  private renderShadow(live: Live, light: { dir: Vec3; shadows: boolean }): void {
    const key = `${live.exag}|${light.dir.join(',')}|${light.shadows}`;
    if (key === this.shadowKey || !light.shadows || !this.shadowFbo) return;
    this.shadowKey = key;
    const gl = this.gl;
    const m = this.model;
    const cx = (m.xs[0]! + m.xs[m.size - 1]!) / 2;
    const cz = (m.zs[0]! + m.zs[m.size - 1]!) / 2;
    const cy = ((m.minH + m.maxH) / 2 - m.base) * live.exag;
    const R = Math.hypot(m.xs[m.size - 1]! - m.xs[0]!, m.zs[m.size - 1]! - m.zs[0]!, (m.maxH - m.minH) * live.exag) / 2 + 10;
    const center: Vec3 = [cx, cy, cz];
    const eye = vec3.add(center, vec3.scale(light.dir, R * 2));
    const lightView = mat4.lookAt(mat4.create(), eye, center, Math.abs(light.dir[1]) > 0.98 ? [0, 0, -1] : [0, 1, 0]);
    const lightProj = mat4.ortho(mat4.create(), -R, R, -R, R, R * 0.5, R * 3.5);
    mat4.multiply(this.lightMat, lightProj, lightView);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.5, 3);
    const p = this.depthProg;
    gl.useProgram(p.program);
    gl.uniformMatrix4fv(p.u['uLight'] ?? null, false, this.lightMat);
    gl.uniform1f(p.u['uExag'] ?? null, live.exag);
    gl.uniform1f(p.u['uBase'] ?? null, m.base);
    gl.bindVertexArray(this.terrain.vao);
    gl.drawElements(gl.TRIANGLES, this.terrain.count, gl.UNSIGNED_INT, 0);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private readonly frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, this.last ? (now - this.last) / 1000 : 1 / 60);
    this.last = now;
    if (this.gl.isContextLost()) return;
    const live = this.hooks.live();
    if (live !== this.lastLive) {
      if (live.exag !== this.lastLive.exag) {
        this.orbit.touch();
        this.walk.touch();
      }
      this.lastLive = live;
      this.dirty = true;
    }
    this.orbit.viewportHeight = this.height;
    this.orbit.fovY = ORBIT_FOV;
    const a = this.orbit.update(dt);
    const b = this.walk.update(dt);
    const moved = (this.mode === 'orbit' ? a : b) || this.transition !== null;
    if (!moved && !this.dirty && !this.revealing && !this.pointerMoved) return;
    this.dirty = false;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.08;
    this.render(now, live, moved || this.pointerMoved);
    this.pointerMoved = false;
  }

  private render(now: number, live: Live, recast: boolean): void {
    const gl = this.gl;
    const m = this.model;
    this.rebuildLines(live);
    const light = this.light(live);
    this.renderShadow(live, light);

    let pose: CamPose;
    if (this.transition) {
      pose = this.transitionPose(now);
      if (now - this.transition.start >= 1300) {
        const to = this.transition.to;
        this.transition = null;
        if (to === 'walk') this.walk.enabled = true;
        else this.orbit.enabled = true;
        pose = this.currentPose();
      }
    } else pose = this.currentPose();

    const aspect = this.width / this.height;
    const E = m.extent;
    const walking = this.mode === 'walk' && !this.transition;
    const dist = vec3.length(pose.eye);
    const near = walking ? 0.4 : Math.max(2, dist * 0.004);
    const far = walking ? E * 6 : dist + E * 6;
    mat4.perspective(this.proj, pose.fovY, aspect, near, far);
    mat4.lookAt(this.view, pose.eye, vec3.add(pose.eye, pose.fwd), [0, 1, 0]);
    mat4.multiply(this.viewProj, this.proj, this.view);
    const fog: [number, number] = walking ? [E * 0.3, E * 2.2] : [dist + E * 0.8, dist + E * 3.5];

    let reveal = 1e9;
    if (this.revealing) {
      const t = Math.min(1, (now - this.revealStart) / 1700);
      reveal = (1 - (1 - t) ** 3) * E * 1.5 + 1;
      if (t >= 1) {
        this.revealing = false;
        reveal = 1e9;
      }
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(BG, BG, BG, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    const t = this.terrainProg;
    gl.useProgram(t.program);
    gl.uniformMatrix4fv(t.u['uViewProj'] ?? null, false, this.viewProj);
    gl.uniformMatrix4fv(t.u['uLight'] ?? null, false, this.lightMat);
    gl.uniform1f(t.u['uExag'] ?? null, live.exag);
    gl.uniform1f(t.u['uBase'] ?? null, m.base);
    gl.uniform3fv(t.u['uSun'] ?? null, light.dir);
    gl.uniform1f(t.u['uSunPower'] ?? null, light.power);
    gl.uniform1f(t.u['uShadowOn'] ?? null, light.shadows ? 1 : 0);
    gl.uniform3fv(t.u['uEye'] ?? null, pose.eye);
    gl.uniform2f(t.u['uFog'] ?? null, fog[0], fog[1]);
    gl.uniform2f(t.u['uContour'] ?? null, ...contourStep(m));
    gl.uniform1f(t.u['uReveal'] ?? null, reveal);
    gl.uniform1f(t.u['uRevealWidth'] ?? null, E * 0.04);
    if (walking) gl.uniform3f(t.u['uGrid'] ?? null, 1, 10, 1.7);
    else gl.uniform3f(t.u['uGrid'] ?? null, 100, 1000, 0.8);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.uniform1i(t.u['uShadow'] ?? null, 1);
    gl.bindVertexArray(this.terrain.vao);
    gl.drawElements(gl.TRIANGLES, this.terrain.count, gl.UNSIGNED_INT, 0);

    if (!this.revealing) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      const l = this.lineProg;
      gl.useProgram(l.program);
      gl.uniformMatrix4fv(l.u['uView'] ?? null, false, this.view);
      gl.uniformMatrix4fv(l.u['uProj'] ?? null, false, this.proj);
      gl.uniform3fv(l.u['uEye'] ?? null, pose.eye);
      gl.uniform1f(l.u['uInfinity'] ?? null, 0);
      gl.uniform2f(l.u['uFog'] ?? null, fog[0], fog[1]);
      const draw = (mesh: Mesh, primitive: number, alpha: number, size: number): void => {
        if (mesh.count === 0) return;
        gl.uniform1f(l.u['uAlpha'] ?? null, alpha);
        gl.uniform1f(l.u['uPointSize'] ?? null, size * this.dpr);
        gl.uniform1f(l.u['uRound'] ?? null, primitive === gl.POINTS ? 1 : 0);
        gl.bindVertexArray(mesh.vao);
        gl.drawArrays(primitive, 0, mesh.count);
      };
      gl.uniform1f(l.u['uBias'] ?? null, 0.998);
      draw(this.lines, gl.LINES, 1, 1);
      if (!walking) draw(this.marker, gl.LINES, 1, 1);
      draw(this.dots, gl.POINTS, 1, 2.2);
      draw(this.hourDots, gl.POINTS, 1, 3.6);
      // Behind hills: the same lines, faint (x-ray).
      gl.disable(gl.DEPTH_TEST);
      draw(this.lines, gl.LINES, 0.16, 1);
      if (!walking) draw(this.marker, gl.LINES, 0.3, 1);
      draw(this.dots, gl.POINTS, 0.3, 2.2);
      draw(this.hourDots, gl.POINTS, 0.3, 3.6);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);

    if (recast || walking) this.cursor = this.pick(pose, walking);
    this.drawHud(live, pose, walking);

    const g = walking ? m.heightAt(pose.eye[0], pose.eye[2]) : null;
    this.hooks.onReadout({
      mode: this.transition ? this.transition.to : this.mode,
      cursor: this.cursor,
      eye: pose.eye,
      ground: g,
      metresPerPixel: walking ? null : (2 * this.orbit.state.distance * Math.tan(ORBIT_FOV / 2)) / this.height,
      fps: this.fps,
    });
  }

  /** Point of the terrain under the pointer (orbit) or the crosshair (walk). */
  private pick(pose: CamPose, walking: boolean): Readout['cursor'] {
    let dir: Vec3;
    if (walking) dir = pose.fwd;
    else {
      if (!this.pointer) return null;
      const inv = mat4.invert(mat4.create(), this.viewProj);
      if (!inv) return null;
      const nx = (this.pointer.x / this.width) * 2 - 1;
      const ny = 1 - (this.pointer.y / this.height) * 2;
      const a = transformPoint(inv, [nx, ny, -1]);
      const b = transformPoint(inv, [nx, ny, 1]);
      const pa: Vec3 = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
      const pb: Vec3 = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
      dir = vec3.normalize(vec3.sub(pb, pa));
    }
    const hit = this.raycast(pose.eye, dir);
    if (!hit) return null;
    const h = this.model.heightAt(hit[0], hit[2]);
    if (h === null) return null;
    return { x: hit[0], z: hit[2], h, dist: vec3.length(vec3.sub(hit, pose.eye)) };
  }

  private raycast(eye: Vec3, dir: Vec3): Vec3 | null {
    const ex = this.lastLive.exag;
    const m = this.model;
    const step = Math.max(2, m.cell * 0.5);
    const maxT = m.extent * 8 + vec3.length(eye);
    let prevT = 0;
    let prevAbove: boolean | null = null;
    const above = (t: number): boolean | null => {
      const p = vec3.add(eye, vec3.scale(dir, t));
      const h = m.heightAt(p[0], p[2]);
      return h === null ? null : p[1] > (h - m.base) * ex;
    };
    for (let t = 0.5; t < maxT; t += step * (1 + t / (m.extent * 2))) {
      const a = above(t);
      if (a === false && prevAbove === true) {
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 18; i++) {
          const mid = (lo + hi) / 2;
          if (above(mid) === false) hi = mid;
          else lo = mid;
        }
        return vec3.add(eye, vec3.scale(dir, hi));
      }
      prevAbove = a;
      prevT = t;
    }
    return null;
  }

  private drawHud(live: Live, pose: CamPose, walking: boolean): void {
    const ctx = prepareOverlay(this.hud, this.width, this.height, this.dpr);
    if (!ctx) return;
    const t = this.hooks.t;
    const W = this.width;
    const H = this.height;
    const P = (p: Vec3): { x: number; y: number; depth: number } | null => {
      const s = projectToScreen(this.viewProj, p, W, H);
      return s && s.x > -40 && s.x < W + 40 && s.y > -40 && s.y < H + 40 ? s : null;
    };
    const m = this.model;
    const az = normDeg((Math.atan2(pose.fwd[0], -pose.fwd[2]) * 180) / Math.PI);
    const markers: TapeMarker[] = [];
    if (live.sun) markers.push({ az: live.sun.azimuthDeg, label: t('SONNE'), kind: 'sun' });
    if (live.headingDeg !== null) markers.push({ az: live.headingDeg, label: t('KAMERA'), kind: 'origin' });
    const hfov = (2 * Math.atan(Math.tan(pose.fovY / 2) * (W / H)) * 180) / Math.PI;
    drawCompassTape(ctx, { cx: W / 2, y: 14, width: Math.min(520, W * 0.42), azimuth: az, relative: false, span: 120, fovDeg: hfov, markers, t });
    if (this.revealing) return;

    const a = this.anchors;
    if (!walking) {
      const top = P(a.marker);
      if (top) drawAnchor(ctx, top.x, top.y - 12, t('STANDPUNKT'), t('{h} m ü. NN', { h: fmt(m.base, 0) }), 'center');
      const peak = P([m.peak.x, (m.peak.h - m.base) * live.exag, m.peak.z]);
      if (peak) {
        ctx.save();
        ctx.strokeStyle = 'rgba(237,237,237,0.85)';
        ctx.beginPath();
        ctx.moveTo(peak.x, peak.y - 5);
        ctx.lineTo(peak.x + 4, peak.y + 2);
        ctx.lineTo(peak.x - 4, peak.y + 2);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
        hudLabel(ctx, `${fmt(m.peak.h, 0)} m`, peak.x, peak.y + 12, { align: 'center', size: 9, color: MID });
      }
    }
    for (const c of a.cardinals) {
      const s = P(c.p);
      if (s) hudLabel(ctx, t(c.text), s.x, s.y - 9, { align: 'center', size: 10, weight: 700, color: c.text === 'N' ? '#ededed' : MID });
    }
    if (a.cone && live.headingDeg !== null && !walking) {
      const s = P(a.cone);
      if (s) hudLabel(ctx, `${t('BLICK')} ${fmtAz(live.headingDeg)} · ${fmt(live.fovDeg, 0)}°`, s.x + 8, s.y, { size: 8.5, color: MID, track: 0.14 });
    }
    // Local time of the place, as the dials of BEFUND write it; UTC only when the zone is unknown.
    const fmtUtc = (t: number): string => (live.timezone ? hhmm(localMinutes(t, live.timezone)) : `${hhmm(localMinutes(t, null))} UTC`);
    const sunAt = a.sun && live.sun ? P(a.sun) : null;
    // Sunrise and sunset labels give way to the sun's own label.
    const clear = (s: { x: number; y: number }): boolean => !sunAt || Math.hypot(s.x - sunAt.x, s.y - sunAt.y) > 110;
    if (a.rise) {
      const s = P(a.rise.p);
      if (s && clear(s)) drawAnchor(ctx, s.x, s.y + 10, t('AUFGANG'), fmtUtc(a.rise.t), 'center');
    }
    if (a.set) {
      const s = P(a.set.p);
      if (s && clear(s)) drawAnchor(ctx, s.x, s.y + 10, t('UNTERGANG'), fmtUtc(a.set.t), 'center');
    }
    if (sunAt && live.sun) {
      drawSun(ctx, sunAt.x, sunAt.y, live.sun.elevationDeg <= 0, t('SONNE'), `${fmtAz(live.sun.azimuthDeg)} · ${fmtSigned(live.sun.elevationDeg, 1)}°`, sunAt.x > W - 330);
    }
    if (walking) {
      const c = this.cursor;
      drawCrosshair(ctx, W / 2, H / 2, c ? fmtMetres(c.dist) : '—', c ? t('{h} m ü. NN', { h: fmt(c.h, 0) }) : t('KEIN ZIEL'));
    } else if (this.cursor && this.pointer) {
      const s = P([this.cursor.x, (this.cursor.h - m.base) * live.exag, this.cursor.z]);
      if (s) ring(ctx, s.x, s.y, 5, 0.9);
    }
    if (!walking && this.transition === null && live.sun === null) {
      hudLabel(ctx, t('OHNE SONNENSTAND · RELIEFLICHT AUS NORDWEST'), W / 2, 78, { align: 'center', size: 9, color: LOW, track: 0.16 });
    } else if (live.sun && live.sun.elevationDeg <= 0) {
      hudLabel(ctx, t('SONNE UNTER DEM HORIZONT'), W / 2, 78, { align: 'center', size: 9, color: LOW, track: 0.16 });
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.detachOrbit();
    this.detachWalk();
    this.wrap.removeEventListener('pointermove', this.onPointerMove);
    this.wrap.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.res.dispose();
    loseContext(this.gl);
  }
}

function contourStep(m: TerrainModel): [number, number] {
  const relief = m.maxH - m.minH;
  if (relief > 200) return [20, 100];
  if (relief > 60) return [5, 25];
  return [1, 5];
}

/* -------------------------------------------------------------- component */

function setText(el: HTMLElement | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

function ScaleBar({ mpp }: { mpp: number }) {
  const steps = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000];
  const metres = steps.find((s) => s / mpp >= 70) ?? 50_000;
  return (
    <span className="sv-scale">
      <i style={{ width: `${Math.round(metres / mpp)}px` }} />
      {metres >= 1000 ? `${metres / 1000} km` : `${metres} m`}
    </span>
  );
}

export function TerrainView({ terrain, loading = false, camera, sun, sunPath, timezone = null, horizonProfile = null, skyline = null, label, embedded = false }: TerrainViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<TerrainEngine | null>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);
  const cursorSubRef = useRef<HTMLSpanElement>(null);
  const [mode, setMode] = useState<ViewMode>('orbit');
  const [exag, setExag] = useState(1);
  const [shadows, setShadows] = useState(true);
  const [dome, setDome] = useState(true);
  const [mpp, setMpp] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restore, setRestore] = useState(0);
  const { t } = useLang();
  // The engine and the readout callback live across language changes; they read `t` from here.
  const tRef = useRef(t);
  tRef.current = t;

  const modelKey = terrain ? `${terrain.bbox.join(',')}|${terrain.size}|${terrain.heights.length}|${camera.lat}|${camera.lon}` : 'none';
  // The model only changes with the grid and the camera position.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const built = useMemo(() => (terrain ? buildModel(terrain, { lat: camera.lat, lon: camera.lon }) : null), [modelKey]);
  const model = useRef<TerrainModel | null>(built);
  model.current = built;

  const liveRef = useRef<Live | null>(null);
  const next: Live = {
    exag,
    shadows,
    dome,
    sun: sun ?? null,
    headingDeg: camera.headingDeg,
    fovDeg: camera.fovDeg,
    pitchDeg: camera.pitchDeg !== undefined && Number.isFinite(camera.pitchDeg) ? camera.pitchDeg : 0,
    aspect: camera.aspect !== undefined && camera.aspect > 0 ? camera.aspect : 16 / 9,
    sunPath: sunPath ?? [],
    timezone: timezone ?? null,
    horizonProfile: horizonProfile ?? null,
    skyline: skyline ?? null,
  };
  const prev = liveRef.current;
  if (
    !prev ||
    prev.exag !== next.exag ||
    prev.shadows !== next.shadows ||
    prev.dome !== next.dome ||
    prev.sun?.azimuthDeg !== next.sun?.azimuthDeg ||
    prev.sun?.elevationDeg !== next.sun?.elevationDeg ||
    prev.headingDeg !== next.headingDeg ||
    prev.fovDeg !== next.fovDeg ||
    prev.pitchDeg !== next.pitchDeg ||
    prev.aspect !== next.aspect ||
    prev.sunPath !== next.sunPath ||
    prev.timezone !== next.timezone ||
    prev.horizonProfile !== next.horizonProfile ||
    prev.skyline !== next.skyline
  ) {
    liveRef.current = next;
  }

  const onReadout = useCallback((r: Readout) => {
    const tr = tRef.current;
    const m = model.current;
    if (r.cursor && m) {
      const g = m.toLatLon(r.cursor.x, r.cursor.z);
      setText(cursorRef.current, `${r.mode === 'walk' ? tr('ZIEL') : tr('ZEIGER')} ${formatCoordinate(g.lat, g.lon)}`);
      setText(cursorSubRef.current, tr('Höhe {h} m ü. NN · Abstand {d}', { h: fmt(r.cursor.h, 0), d: fmtMetres(r.cursor.dist) }));
    } else if (r.mode === 'walk' && m && r.ground !== null) {
      const g = m.toLatLon(r.eye[0], r.eye[2]);
      setText(cursorRef.current, `${tr('STANDORT')} ${formatCoordinate(g.lat, g.lon)}`);
      setText(cursorSubRef.current, tr('Grund {h} m ü. NN', { h: fmt(r.ground, 0) }));
    } else {
      setText(cursorRef.current, `${tr('STANDPUNKT')} ${formatCoordinate(m?.center.lat ?? 0, m?.center.lon ?? 0)}`);
      setText(
        cursorSubRef.current,
        m ? tr('Grund {h} m ü. NN · Relief {min}–{max} m', { h: fmt(m.base, 0), min: fmt(m.minH, 0), max: fmt(m.maxH, 0) }) : '',
      );
    }
    setMpp((v) => {
      const n = r.metresPerPixel;
      if (n === null) return null;
      return v === null || Math.abs(v - n) / n > 0.02 ? n : v;
    });
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    const hud = hudRef.current;
    setError(null);
    setMode('orbit');
    if (!wrap || !hud || !built) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'sv-gl';
    canvas.setAttribute('aria-hidden', 'true');
    wrap.insertBefore(canvas, wrap.firstChild);
    let engine: TerrainEngine | null = null;
    let observer: ResizeObserver | null = null;
    try {
      engine = new TerrainEngine(wrap, canvas, hud, built, {
        live: () => liveRef.current ?? next,
        onReadout,
        onMode: setMode,
        onLost: () => {
          setError('Der Grafikkontext ist verloren gegangen. Das Gelände wird neu aufgebaut …');
          window.setTimeout(() => setRestore((n) => n + 1), 600);
        },
        t: (de, vars) => tRef.current(de, vars),
      });
      engineRef.current = engine;
      const rect = wrap.getBoundingClientRect();
      engine.resize(rect.width, rect.height);
      observer = new ResizeObserver(() => {
        const r = wrap.getBoundingClientRect();
        engine?.resize(r.width, r.height);
      });
      observer.observe(wrap);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    return () => {
      observer?.disconnect();
      engine?.dispose();
      engineRef.current = null;
      canvas.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, onReadout, restore]);

  useEffect(() => {
    engineRef.current?.invalidate();
  }, [exag, shadows, dome, sun?.azimuthDeg, sun?.elevationDeg, camera.headingDeg, camera.fovDeg, camera.pitchDeg, camera.aspect, sunPath, horizonProfile, skyline, t]);

  const go = (m: ViewMode): void => {
    engineRef.current?.setMode(m);
    wrapRef.current?.focus({ preventScroll: true });
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
    const k = e.key.toLowerCase();
    if (e.key === 'Escape' && mode === 'walk') {
      if (document.pointerLockElement) return;
      go('orbit');
    } else if (k === 'p') go(mode === 'walk' ? 'orbit' : 'walk');
    else if (k === 'u') setExag((v) => (v === 1 ? 2 : 1));
    else if (k === 'l') setShadows((v) => !v);
    else if (k === 'k') setDome((v) => !v);
    else if (k === 'r' && mode === 'walk') engineRef.current?.resetWalk();
    else return;
    e.preventDefault();
  };

  const ready = built !== null && error === null;
  const missing = !loading && built === null;
  const help =
    mode === 'walk'
      ? `${t('W A S D gehen · Maus schauen · Q E hoch runter · Shift schneller · R zurück')} · ${t('Esc Übersicht')}`
      : t('Ziehen drehen · Rechts ziehen verschieben · Rad zoomen · W A S D verschieben · P Standpunkt');

  return (
    <div
      ref={wrapRef}
      className="sv"
      tabIndex={0}
      role="application"
      aria-roledescription={t('Geländemodell')}
      aria-label={`${t('Gelände um den Aufnahmeort')}${label ? `: ${label}` : ''}. ${help}.`}
      aria-busy={loading}
      onKeyDown={onKeyDown}
    >
      <canvas ref={hudRef} className="sv-hud" aria-hidden="true" />
      {!embedded && (
        <div className="sv-readout sv-tl">
          <span>{t('Gelände')}</span>
          {label && <span className="sv-dim">{label}</span>}
        </div>
      )}

      {ready && (
        <>
          <div className="sv-panel sv-tr" data-hud-control>
            <div className="sv-group" role="group" aria-label={t('Ansicht')}>
              <button type="button" aria-pressed={mode === 'orbit'} title={`${t('Übersicht')} (P)`} onClick={() => go('orbit')}>
                {t('Übersicht')}
              </button>
              <button type="button" aria-pressed={mode === 'walk'} title={`${t('Am Standpunkt stehen')} (P)`} onClick={() => go('walk')}>
                {t('Standpunkt')}
              </button>
            </div>
            <div className="sv-group" role="group" aria-label={t('Überhöhung')}>
              <span className="sv-group-label">{t('Überhöhung')}</span>
              <button type="button" aria-pressed={exag === 1} title={`${t('Überhöhung')} (U)`} onClick={() => setExag(1)}>
                1×
              </button>
              <button type="button" aria-pressed={exag === 2} title={`${t('Überhöhung')} (U)`} onClick={() => setExag(2)}>
                2×
              </button>
            </div>
            <div className="sv-group" role="group" aria-label={t('Ebenen')}>
              <button type="button" aria-pressed={shadows} title={`${t('Schattenwurf')} (L)`} onClick={() => setShadows((v) => !v)}>
                {t('Schatten')}
              </button>
              <button type="button" aria-pressed={dome} title={`${t('Himmelskuppel, Sonnenbahn, Horizont')} (K)`} onClick={() => setDome((v) => !v)}>
                {t('Kuppel')}
              </button>
            </div>
          </div>

          <div className="sv-readout sv-bl sv-stack">
            <span ref={cursorRef} />
            <span ref={cursorSubRef} className="sv-dim sv-plain" />
          </div>
          <div className="sv-readout sv-br sv-stack">
            <span>
              {sun
                ? t('Sonne Azimut {az} · Höhe {el}°', { az: fmtAz(sun.azimuthDeg), el: fmtSigned(sun.elevationDeg, 1) })
                : t('Kein Sonnenstand')}
            </span>
            {mpp !== null && mode === 'orbit' && <ScaleBar mpp={mpp} />}
          </div>
          {dome && (
            <div className="sv-readout sv-legend" style={{ top: embedded ? 12 : 44, left: 12 }}>
              <i />
              <span>{t('Geländehorizont')}</span>
              {skyline && camera.headingDeg !== null && (
                <>
                  <i className="dash" />
                  <span>{t('Horizont im Video')}</span>
                </>
              )}
              {(sunPath?.length ?? 0) > 0 && (
                <>
                  <i className="dot" />
                  <span>{t('Sonnenbahn')}</span>
                </>
              )}
              <i className="faint" />
              <span>{t('Sichtfeld · Kuppel')}</span>
            </div>
          )}
          <div className="sv-help" aria-hidden="true">
            {help}
          </div>
        </>
      )}

      {loading && !terrain && (
        <div className="sv-status" role="status">
          <p className="sv-status-title">{t('Höhenmodell wird geladen …')}</p>
          <i className="sv-bar" />
        </div>
      )}
      {missing && (
        <div className="sv-status" role="status">
          <p className="sv-status-title">{t('Kein Höhenmodell')}</p>
          <p className="sv-status-detail">{t('Kein Höhenmodell für diesen Ort vorhanden.')}</p>
        </div>
      )}
      {error && (
        <div className="sv-status" role="alert">
          <p className="sv-status-title">{t('Gelände nicht verfügbar')}</p>
          <p className="sv-status-detail">{t(error)}</p>
        </div>
      )}
    </div>
  );
}
