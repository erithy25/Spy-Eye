/**
 * SpaceView: steps into the space reconstructed from one video frame.
 *
 * A DSG1 grid (distance along each pinhole ray, sky mask) becomes one triangle mesh with the
 * keyframe as texture; seen from the original camera the first view equals the frame. From there
 * the viewer walks through the space in first person. Everything is drawn with the WebGL2 code in
 * ./gl.ts, the HUD with ./hud.ts; no third-party 3D code.
 *
 * Frames: the grid's rays are those of the camera as it was pitched when the frame was taken
 * (`Keyframe.pitchDeg`). The scene is built in a level world frame instead (x right, y up, the
 * camera at the origin looking along −z at yaw 0): every point is turned from the camera frame
 * about x by the pitch, so the ground the grid was scaled with lies at y = −EYE_HEIGHT, under the
 * ground grid, and walking stays horizontal. The start pose looks along the original camera axis.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useLang } from '../../i18n';
import { FirstPersonControls } from './controls';
import {
  GlResources,
  LINE_FS,
  LINE_VS,
  LineBuilder,
  createGl,
  fitCanvas,
  loseContext,
  mat4,
  parseSpaceGrid,
  projectToScreen,
  uploadImageTexture,
  vec3,
  type Mesh,
  type Program,
  type SpaceGrid,
  type Vec3,
} from './gl';
import {
  drawAnchor,
  drawCompassTape,
  drawCrosshair,
  drawEdgePointer,
  drawPitchLadder,
  drawSun,
  fmt,
  fmtAz,
  fmtMetres,
  fmtSigned,
  normDeg,
  prepareOverlay,
  type TapeMarker,
} from './hud';
import './space.css';

/** The console's translation function (`useLang().t`). */
type Translate = (de: string, vars?: Record<string, string | number>) => string;

export interface SpaceViewProps {
  /** URL of the DSG1 grid (`Keyframe.spaceUrl`). */
  gridUrl: string;
  /** URL of the keyframe image (`Keyframe.imageUrl`), same origin. */
  imageUrl: string;
  label?: string;
  /** Viewing direction of the camera at the keyframe (azimuth), when known. */
  headingDeg?: number | null;
  /** Horizontal field of view, used when the grid does not carry one. */
  fovDeg?: number;
  /**
   * Camera pitch the grid was built with (`Keyframe.pitchDeg`, degrees, positive = looking up).
   * Missing means level, as grids of older engine versions were shown.
   */
  pitchDeg?: number;
  /** Sun at the determined time; drawn when the heading is known as well. */
  sun?: { azimuthDeg: number; elevationDeg: number } | null;
  onExit?: () => void;
  /**
   * Inside a page that names the place and has its own way back (RAUM): no title in the picture
   * and no exit button; Esc still leaves.
   */
  embedded?: boolean;
}

/** Grid size, triangles and frame rate are for development: shown with ?debug in the address only. */
const DEBUG = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');

type RenderMode = 'surface' | 'points' | 'wire';

const MODES: { id: RenderMode; label: string; key: string }[] = [
  { id: 'surface', label: 'Fläche', key: '1' },
  { id: 'points', label: 'Punkte', key: '2' },
  { id: 'wire', label: 'Gitter', key: '3' },
];

const COLOUR_STEPS = [
  { value: 0, label: 'Mono' },
  { value: 0.3, label: '30 %' },
  { value: 1, label: 'Voll' },
];

/** Eye height above the estimated ground plane (m). */
const EYE_HEIGHT = 1.6;
/** Largest ratio of the distances of a triangle's corners before it counts as a depth jump. */
const MAX_DEPTH_RATIO = 1.25;
const BG = 0.0196;

interface Settings {
  mode: RenderMode;
  edges: boolean;
  colour: number;
  ground: boolean;
}

interface Live {
  headingDeg: number | null;
  sun: { azimuthDeg: number; elevationDeg: number } | null;
}

interface Readout {
  position: Vec3;
  azimuth: number;
  relative: boolean;
  pitch: number;
  hfov: number;
  zoom: number;
  speed: number;
  fps: number;
}

interface Stats {
  columns: number;
  rows: number;
  triangles: number;
  points: number;
  imageWidth: number;
  imageHeight: number;
  fovDeg: number;
  far: number;
}

type Phase =
  | { kind: 'loading'; steps: string[] }
  | { kind: 'ready'; stats: Stats }
  | { kind: 'error'; message: string };

/* ------------------------------------------------------------------ shaders */

const MESH_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUv;
uniform mat4 uViewProj;
uniform vec3 uEye;
uniform float uInfinity;
uniform float uPointScale;
out vec2 vUv;
out vec3 vWorld;
out float vRange;
void main() {
  vec3 p = uInfinity > 0.0 ? uEye + normalize(aPos) * uInfinity : aPos;
  vUv = aUv;
  vWorld = p;
  vRange = length(aPos);
  gl_Position = uViewProj * vec4(p, 1.0);
  gl_PointSize = clamp(uPointScale * length(aPos) / max(distance(p, uEye), 0.05), 1.0, 14.0);
}`;

const MESH_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vWorld;
in float vRange;
uniform sampler2D uTex;
uniform vec3 uEye;
uniform float uColour;
uniform vec2 uFog;
uniform int uMode;
uniform vec2 uCells;
uniform float uDim;
uniform float uReveal;
uniform float uAlpha;
out vec4 outColor;
const vec3 BG = vec3(${BG});
void main() {
  if (vRange > uReveal) discard;
  if (uMode == 1) {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    if (dot(q, q) > 1.0) discard;
  }
  vec3 c = texture(uTex, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uColour) * uDim;
  if (uMode == 2) {
    vec2 g = vUv * uCells;
    vec2 w = max(fwidth(g), vec2(1e-5));
    vec2 a = abs(fract(g - 0.5) - 0.5) / w;
    float line = (1.0 - min(min(a.x, a.y), 1.0)) * (1.0 - smoothstep(0.3, 0.8, max(w.x, w.y)));
    c = vec3(l) * 0.22 * uDim + vec3(0.55 * line);
  }
  float d = distance(vWorld, uEye);
  float fog = uFog.y > 0.0 ? smoothstep(uFog.x, uFog.y, d) : 0.0;
  c = mix(c, BG, fog);
  float front = 1.0 - smoothstep(0.0, max(0.5, uReveal * 0.05), uReveal - vRange);
  c = mix(c, vec3(0.96), front * 0.9);
  outColor = vec4(c, uAlpha);
}`;

const GROUND_VS = `#version 300 es
layout(location = 0) in vec2 aXZ;
uniform mat4 uView;
uniform mat4 uProj;
uniform vec3 uCenter;
uniform float uRadius;
uniform float uY;
uniform float uBias;
out vec3 vWorld;
void main() {
  vec3 p = vec3(uCenter.x + aXZ.x * uRadius, uY, uCenter.z + aXZ.y * uRadius);
  vWorld = p;
  vec4 v = uView * vec4(p, 1.0);
  v.xyz *= uBias;
  gl_Position = uProj * v;
}`;

const GROUND_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
uniform vec3 uEye;
uniform vec2 uFog;
uniform float uAlpha;
uniform float uReveal;
out vec4 outColor;
float gridLine(vec2 p, float step) {
  vec2 g = p / step;
  vec2 w = max(fwidth(g), vec2(1e-5));
  vec2 a = abs(fract(g - 0.5) - 0.5) / w;
  float l = 1.0 - min(min(a.x, a.y), 1.0);
  return l * (1.0 - smoothstep(0.2, 0.7, max(w.x, w.y)));
}
void main() {
  float r = length(vWorld);
  if (r > uReveal) discard;
  float minor = gridLine(vWorld.xz, 1.0);
  float major = gridLine(vWorld.xz, 10.0);
  float d = distance(vWorld, uEye);
  float fog = smoothstep(uFog.x, uFog.y, d);
  float a = max(minor * 0.13, major * 0.34) * (1.0 - fog) * uAlpha;
  if (a < 0.004) discard;
  outColor = vec4(vec3(0.93), a);
}`;

/* -------------------------------------------------------------- scene build */

interface LineSet {
  positions: Float32Array;
  alphas: Float32Array;
}

interface SpaceScene {
  grid: SpaceGrid;
  /** tan of the half field of view, horizontally and vertically. */
  tx: number;
  ty: number;
  /** Pitch of the original camera (radians, positive = up): camera frame → level world frame. */
  pitch: number;
  /** World positions (level frame, see the header comment). */
  positions: Float32Array;
  uvs: Float32Array;
  /** 0 sky, 1 measured surface, 2 beyond the far distance / unknown. */
  kind: Uint8Array;
  triangles: Uint32Array;
  /** Triangles across depth jumps: shown only from the start pose, where they close the seams. */
  seams: Uint32Array;
  backdrop: Uint32Array;
  /** Triangles touching the sky: drawn at infinity, so the sky of the frame stays in place. */
  sky: Uint32Array;
  points: Uint32Array;
  edges: LineSet;
  skyline: LineSet;
  skylineFar: LineSet;
}

function toSet(b: LineBuilder): LineSet {
  return b.arrays();
}

/**
 * Turns a point or direction about the x axis by `pitch` radians. With +pitch it goes from the
 * pitched camera frame to the level world frame (as a three.js camera with rotation.x = pitch);
 * with −pitch back. x is unchanged, lengths are kept.
 */
function pitchAboutX(p: Vec3, pitch: number): Vec3 {
  if (pitch === 0) return p;
  const c = Math.cos(pitch);
  const s = Math.sin(pitch);
  return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
}

/**
 * Builds the mesh from a grid. Vertex (i, j) lies on the ray through the normalised image point
 * (i / (w - 1), j / (h - 1)) at its measured distance, and samples the image at the same point,
 * so that the original camera sees exactly the frame. The rays are those of the camera pitched by
 * `pitchDeg` (positive = up); positions are turned into the level world frame.
 */
export function buildSpaceScene(grid: SpaceGrid, imageAspect: number, fallbackFovDeg: number, pitchDeg = 0): SpaceScene {
  const { width: w, height: h, distance, sky, far } = grid;
  const fov = grid.fovDeg > 0 ? grid.fovDeg : fallbackFovDeg;
  const tx = Math.tan(((fov / 2) * Math.PI) / 180);
  const ty = tx / imageAspect;
  const pitch = Number.isFinite(pitchDeg) ? (pitchDeg * Math.PI) / 180 : 0;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const n = w * h;
  const positions = new Float32Array(n * 3);
  const uvs = new Float32Array(n * 2);
  const kind = new Uint8Array(n);
  const range = new Float32Array(n);
  const pointList: number[] = [];

  for (let j = 0; j < h; j++) {
    const v = j / (h - 1);
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const u = i / (w - 1);
      const rx = (2 * u - 1) * tx;
      const ry = (1 - 2 * v) * ty;
      const len = Math.hypot(rx, ry, 1);
      const d = distance[k]!;
      let r = far;
      if (sky[k] === 1) kind[k] = 0;
      else if (Number.isFinite(d) && d > 0 && d < far) {
        kind[k] = 1;
        r = d;
        pointList.push(k);
      } else kind[k] = 2;
      range[k] = r;
      // Camera frame (ray (rx, ry, −1)), turned about x by the pitch into the world frame.
      const cx = (rx / len) * r;
      const cy = (ry / len) * r;
      const cz = (-1 / len) * r;
      positions[k * 3] = cx;
      positions[k * 3 + 1] = cy * cp - cz * sp;
      positions[k * 3 + 2] = cy * sp + cz * cp;
      uvs[k * 2] = u;
      uvs[k * 2 + 1] = v;
    }
  }

  const tris: number[] = [];
  const seams: number[] = [];
  const back: number[] = [];
  const skyTris: number[] = [];
  const hCount = new Uint8Array((w - 1) * h);
  const vCount = new Uint8Array(w * (h - 1));
  const dCount = new Uint8Array((w - 1) * (h - 1));
  const diagonal = new Uint8Array((w - 1) * (h - 1));
  const near = (a: number, b: number, c: number): boolean => {
    if (kind[a] !== 1 || kind[b] !== 1 || kind[c] !== 1) return false;
    const da = range[a]!;
    const db = range[b]!;
    const dc = range[c]!;
    const lo = Math.min(da, db, dc);
    const hi = Math.max(da, db, dc);
    return hi / lo <= MAX_DEPTH_RATIO || hi - lo < 0.12;
  };
  const count = (a: number, b: number): void => {
    const ia = a % w;
    const ja = (a - ia) / w;
    const ib = b % w;
    const jb = (b - ib) / w;
    if (ja === jb) hCount[ja * (w - 1) + Math.min(ia, ib)]!++;
    else if (ia === ib) vCount[Math.min(ja, jb) * w + ia]!++;
    else dCount[Math.min(ja, jb) * (w - 1) + Math.min(ia, ib)]!++;
  };
  const add = (a: number, b: number, c: number): void => {
    const ka = kind[a]!;
    const kb = kind[b]!;
    const kc = kind[c]!;
    if (near(a, b, c)) {
      tris.push(a, b, c);
      count(a, b);
      count(b, c);
      count(c, a);
    } else if (ka === 1 && kb === 1 && kc === 1) seams.push(a, b, c);
    // Far scenery, and the cells between it and measured surfaces, go to the backdrop.
    else if (ka !== 0 && kb !== 0 && kc !== 0) back.push(a, b, c);
    // Sky, including the cells along the skyline, becomes a dome at infinity.
    else skyTris.push(a, b, c);
  };
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const a = j * w + i;
      const b = a + 1;
      const c = a + w;
      const d = c + 1;
      // Split along the diagonal whose ends are closer in depth: cleaner silhouettes.
      if (Math.abs(range[a]! - range[d]!) <= Math.abs(range[b]! - range[c]!)) {
        add(a, c, d);
        add(a, d, b);
      } else {
        diagonal[j * (w - 1) + i] = 1;
        add(a, c, b);
        add(b, c, d);
      }
    }
  }

  // Outline: edges used by exactly one kept triangle (depth jumps, skyline, frame border).
  const edges = new LineBuilder();
  const p = (k: number): Vec3 => [positions[k * 3]!, positions[k * 3 + 1]!, positions[k * 3 + 2]!];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w - 1; i++) if (hCount[j * (w - 1) + i] === 1) edges.segment(p(j * w + i), p(j * w + i + 1), 0.6);
  }
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w; i++) if (vCount[j * w + i] === 1) edges.segment(p(j * w + i), p((j + 1) * w + i), 0.6);
  }
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const q = j * (w - 1) + i;
      if (dCount[q] !== 1) continue;
      const a = j * w + i;
      if (diagonal[q] === 0) edges.segment(p(a), p(a + w + 1), 0.6);
      else edges.segment(p(a + 1), p(a + w), 0.6);
    }
  }

  // Skyline: per column the topmost step from sky to ground, joined where continuous.
  const skyline = new LineBuilder();
  const skylineFar = new LineBuilder();
  let prev: { k: number; j: number } | null = null;
  for (let i = 0; i < w; i++) {
    let found: { k: number; j: number } | null = null;
    for (let j = 1; j < h; j++) {
      const k = j * w + i;
      if (sky[k - w] === 1 && kind[k] !== 0) {
        found = { k, j };
        break;
      }
    }
    if (found && prev && kind[found.k] === kind[prev.k]) {
      if (kind[found.k] === 1) {
        const ra = range[found.k]!;
        const rb = range[prev.k]!;
        if (Math.max(ra, rb) / Math.min(ra, rb) < 1.35) skyline.segment(p(prev.k), p(found.k));
      } else if (Math.abs(found.j - prev.j) < 10) skylineFar.segment(p(prev.k), p(found.k));
    }
    prev = found;
  }

  return {
    grid,
    tx,
    ty,
    pitch,
    positions,
    uvs,
    kind,
    triangles: new Uint32Array(tris),
    seams: new Uint32Array(seams),
    backdrop: new Uint32Array(back),
    sky: new Uint32Array(skyTris),
    points: new Uint32Array(pointList),
    edges: toSet(edges),
    skyline: toSet(skyline),
    skylineFar: toSet(skylineFar),
  };
}

/** Signed distance along the original ray between a world point and the surface behind it, or null. */
function surfaceGap(scene: SpaceScene, world: Vec3): number | null {
  // Back into the frame of the original camera, whose image the grid is.
  const p = pitchAboutX(world, -scene.pitch);
  const z = -p[2];
  if (z < 1e-3) return null;
  const u = (p[0] / z / scene.tx + 1) / 2;
  const v = (1 - p[1] / z / scene.ty) / 2;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const { width: w, height: h, distance } = scene.grid;
  const fx = u * (w - 1);
  const fy = v * (h - 1);
  const i0 = Math.min(w - 2, Math.floor(fx));
  const j0 = Math.min(h - 2, Math.floor(fy));
  const ax = fx - i0;
  const ay = fy - j0;
  const k = j0 * w + i0;
  const ks = [k, k + 1, k + w, k + w + 1];
  let d: number;
  if (ks.every((q) => scene.kind[q] === 1)) {
    d =
      (distance[k]! * (1 - ax) + distance[k + 1]! * ax) * (1 - ay) +
      (distance[k + w]! * (1 - ax) + distance[k + w + 1]! * ax) * ay;
  } else {
    const q = Math.round(fy) * w + Math.round(fx);
    if (scene.kind[q] !== 1) return null;
    d = distance[q]!;
  }
  return vec3.length(p) - d;
}

/** Kind of the grid cell the original camera saw in a world direction (0 sky, 1 surface, 2 far), or null. */
function cellKind(scene: SpaceScene, worldDir: Vec3): number | null {
  const dir = pitchAboutX(worldDir, -scene.pitch);
  const z = -dir[2];
  if (z < 1e-3) return null;
  const u = (dir[0] / z / scene.tx + 1) / 2;
  const v = (1 - dir[1] / z / scene.ty) / 2;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const { width: w, height: h } = scene.grid;
  return scene.kind[Math.round(v * (h - 1)) * w + Math.round(u * (w - 1))] ?? null;
}

/** Distance along a ray to the reconstructed surface (marching in the original camera's image). */
export function raycastSpace(scene: SpaceScene, eye: Vec3, dir: Vec3, maxT: number): number | null {
  let t = 0.03;
  let prev: number | null = null;
  let prevT = 0;
  for (let n = 0; n < 1200 && t < maxT; n++) {
    const s = surfaceGap(scene, vec3.add(eye, vec3.scale(dir, t)));
    if (s !== null && prev !== null && prev < 0 && s >= 0 && s < Math.max(0.4, t * 0.12)) {
      let lo = prevT;
      let hi = t;
      for (let r = 0; r < 14; r++) {
        const mid = (lo + hi) / 2;
        const sm = surfaceGap(scene, vec3.add(eye, vec3.scale(dir, mid)));
        if (sm === null || sm >= 0) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    prev = s;
    prevT = t;
    t += Math.max(0.025, t * 0.01);
  }
  return null;
}

/* ------------------------------------------------------------------ engine */

interface EngineHooks {
  settings: () => Settings;
  live: () => Live;
  onReadout: (r: Readout) => void;
  onLost: () => void;
  /** Translates the HUD texts in the current language. */
  t: Translate;
}

class SpaceEngine {
  private readonly gl: WebGL2RenderingContext;
  private readonly res: GlResources;
  private readonly controls: FirstPersonControls;
  private readonly detach: () => void;
  private readonly mesh: Program;
  private readonly ground: Program;
  private readonly lines: Program;
  private readonly texture: WebGLTexture;
  private readonly surface: Mesh;
  private readonly backdrop: Mesh;
  private readonly skyDome: Mesh;
  private readonly seams: Mesh;
  private readonly cloud: Mesh;
  private readonly plane: Mesh;
  private readonly edgeLines: Mesh;
  private readonly skyLines: Mesh;
  private readonly skyFarLines: Mesh;
  private extras: Mesh;
  private extrasKey = '';
  private shadowTip: { tip: Vec3; end: Vec3; azimuth: number; ratio: number } | null = null;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private raf = 0;
  private last = 0;
  private fps = 60;
  private dirty = true;
  private settingsKey = '';
  private readonly revealStart: number;
  private revealing: boolean;
  private target: { range: number; kind: 'surface' | 'ground' | 'far' | 'sky' } | null = null;
  private readonly view = mat4.create();
  private readonly proj = mat4.create();
  private readonly viewProj = mat4.create();
  readonly stats: Stats;

  constructor(
    wrap: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly hud: HTMLCanvasElement,
    private readonly scene: SpaceScene,
    image: HTMLImageElement,
    private readonly hooks: EngineHooks,
  ) {
    const gl = createGl(canvas);
    // German message; the component translates it when it shows the error.
    if (!gl) throw new Error('WebGL 2 ist in diesem Browser nicht verfügbar.');
    this.gl = gl;
    this.res = new GlResources(gl);
    this.mesh = this.res.program(MESH_VS, MESH_FS);
    this.ground = this.res.program(GROUND_VS, GROUND_FS);
    this.lines = this.res.program(LINE_VS, LINE_FS);
    this.texture = this.res.texture();
    uploadImageTexture(gl, this.texture, image);

    this.surface = this.res.mesh(
      [
        { location: 0, size: 3, data: scene.positions },
        { location: 1, size: 2, data: scene.uvs },
      ],
      scene.triangles,
    );
    const shared = [
      { location: 0, size: 3, buffer: this.surface.buffers[0]! },
      { location: 1, size: 2, buffer: this.surface.buffers[1]! },
    ];
    this.backdrop = this.res.mesh(shared, scene.backdrop);
    this.skyDome = this.res.mesh(shared, scene.sky);
    this.seams = this.res.mesh(shared, scene.seams);
    this.cloud = this.res.mesh(shared, scene.points);
    this.plane = this.res.mesh([{ location: 0, size: 2, data: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]) }]);
    const lineMesh = (set: LineSet): Mesh =>
      this.res.mesh([
        { location: 0, size: 3, data: set.positions },
        { location: 1, size: 1, data: set.alphas },
      ]);
    this.edgeLines = lineMesh(scene.edges);
    this.skyLines = lineMesh(scene.skyline);
    this.skyFarLines = lineMesh(scene.skylineFar);
    this.extras = lineMesh({ positions: new Float32Array(0), alphas: new Float32Array(0) });

    this.stats = {
      columns: scene.grid.width,
      rows: scene.grid.height,
      triangles: scene.triangles.length / 3,
      points: scene.points.length,
      imageWidth: image.naturalWidth,
      imageHeight: image.naturalHeight,
      fovDeg: (2 * Math.atan(scene.tx) * 180) / Math.PI,
      far: scene.grid.far,
    };

    // Start (and R) along the original camera axis, so the first view equals the frame and the
    // pitch readout shows the camera's real tilt.
    this.controls = new FirstPersonControls(wrap, { position: [0, 0, 0], yaw: 0, pitch: scene.pitch }, { speed: 1.5, runFactor: 4.5 });
    this.detach = this.controls.attach();
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

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.dpr = fitCanvas(this.canvas, this.width, this.height);
    this.dirty = true;
  }

  invalidate(): void {
    this.dirty = true;
  }

  reset(): void {
    this.controls.reset();
  }

  /** Lines that depend on the heading and the sun: original camera frustum, shadow direction. */
  private rebuildExtras(live: Live): void {
    const key = `${live.headingDeg ?? 'x'}|${live.sun?.azimuthDeg ?? 'x'}|${live.sun?.elevationDeg ?? 'x'}`;
    if (key === this.extrasKey) return;
    this.extrasKey = key;
    const b = new LineBuilder();
    const { tx, ty, pitch } = this.scene;
    // The original camera: a pyramid to a frame 0.8 m in front, which from the start pose
    // coincides with the border of the picture. Drawn in the camera frame, turned by its pitch.
    const s = 0.8;
    const cam = (p: Vec3): Vec3 => pitchAboutX(p, pitch);
    const corners: Vec3[] = [
      cam([-tx * s, ty * s, -s]),
      cam([tx * s, ty * s, -s]),
      cam([tx * s, -ty * s, -s]),
      cam([-tx * s, -ty * s, -s]),
    ];
    for (const c of corners) b.segment([0, 0, 0], c, 0.45);
    b.polyline(corners, 0.7, true);
    b.polyline([cam([-tx * s * 0.25, ty * s * 1.06, -s]), cam([0, ty * s * 1.28, -s]), cam([tx * s * 0.25, ty * s * 1.06, -s])], 0.7, true);
    // The foot of the camera on the ground plane.
    const y = -EYE_HEIGHT;
    for (let i = 0; i < 48; i++) {
      const a0 = (i / 48) * Math.PI * 2;
      const a1 = ((i + 1) / 48) * Math.PI * 2;
      b.segment([Math.cos(a0) * 0.35, y, Math.sin(a0) * 0.35], [Math.cos(a1) * 0.35, y, Math.sin(a1) * 0.35], 0.6);
    }
    b.segment([0, y, 0], [0, -0.1, 0], 0.35);

    this.shadowTip = null;
    const { headingDeg, sun } = live;
    if (headingDeg !== null && sun && sun.elevationDeg > 0.5) {
      const rel = ((sun.azimuthDeg + 180 - headingDeg) * Math.PI) / 180;
      const dir: Vec3 = [Math.sin(rel), 0, -Math.cos(rel)];
      const foot: Vec3 = [0, y, 0];
      const length = 40;
      const end = vec3.add(foot, vec3.scale(dir, length));
      b.dashed(vec3.add(foot, vec3.scale(dir, 0.4)), end, 0.6, 0.45, 0.85);
      // Where the shadow of something as tall as the eye ends.
      const ratio = 1 / Math.tan((sun.elevationDeg * Math.PI) / 180);
      const tipLen = Math.min(length, EYE_HEIGHT * ratio);
      const tip = vec3.add(foot, vec3.scale(dir, tipLen));
      const side: Vec3 = [-dir[2] * 0.5, 0, dir[0] * 0.5];
      b.segment(vec3.sub(tip, side), vec3.add(tip, side), 1);
      this.shadowTip = { tip, end, azimuth: normDeg(sun.azimuthDeg + 180), ratio };
    }
    const { positions, alphas } = b.arrays();
    this.res.update(this.extras, 0, positions, 3);
    this.res.update(this.extras, 1, alphas, 1);
  }

  private projection(): { tanY: number; hfov: number; focal: number } {
    const { tx, ty } = this.scene;
    const aspect = this.width / this.height;
    // Contain: the whole frame is visible at the start, as in the video.
    const base = aspect >= tx / ty ? ty : tx / aspect;
    const tanY = base * this.controls.zoom;
    const far = Math.max(400, this.scene.grid.far * 4);
    mat4.perspective(this.proj, 2 * Math.atan(tanY), aspect, 0.04, far);
    return { tanY, hfov: (2 * Math.atan(tanY * aspect) * 180) / Math.PI, focal: this.height / 2 / tanY };
  }

  private readonly frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, this.last ? (now - this.last) / 1000 : 1 / 60);
    this.last = now;
    if (this.gl.isContextLost()) return;
    const settings = this.hooks.settings();
    const live = this.hooks.live();
    const key = `${settings.mode}|${settings.edges}|${settings.colour}|${settings.ground}`;
    if (key !== this.settingsKey) {
      this.settingsKey = key;
      this.dirty = true;
    }
    const prevExtras = this.extrasKey;
    this.rebuildExtras(live);
    if (prevExtras !== this.extrasKey) this.dirty = true;
    const moved = this.controls.update(dt);
    if (!moved && !this.dirty && !this.revealing) return;
    this.dirty = false;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.08;
    this.render(now, settings, live);
  };

  private render(now: number, settings: Settings, live: Live): void {
    const gl = this.gl;
    const c = this.controls;
    const eye = c.position;
    const fwd = c.forward;
    mat4.lookAt(this.view, eye, vec3.add(eye, fwd), [0, 1, 0]);
    const { hfov, focal } = this.projection();
    mat4.multiply(this.viewProj, this.proj, this.view);
    const far = this.scene.grid.far;
    const fog: [number, number] = [far * 0.45, far * 1.15];
    let reveal = 1e9;
    if (this.revealing) {
      const t = Math.min(1, (now - this.revealStart) / 1500);
      reveal = (1 - (1 - t) ** 3) * far * 1.02 + 0.3;
      if (t >= 1) {
        this.revealing = false;
        reveal = 1e9;
      }
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(BG, BG, BG, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);

    // Surfaces.
    const m = this.mesh;
    gl.useProgram(m.program);
    gl.uniformMatrix4fv(m.u['uViewProj'] ?? null, false, this.viewProj);
    gl.uniform3fv(m.u['uEye'] ?? null, eye);
    gl.uniform1f(m.u['uColour'] ?? null, settings.colour);
    gl.uniform2f(m.u['uCells'] ?? null, ...this.cells());
    gl.uniform1f(m.u['uReveal'] ?? null, reveal);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(m.u['uTex'] ?? null, 0);
    gl.uniform1f(m.u['uAlpha'] ?? null, 1);
    const modeIndex = settings.mode === 'points' ? 1 : settings.mode === 'wire' ? 2 : 0;
    const cellAngle = (2 * this.scene.tx) / (this.scene.grid.width - 1);
    gl.uniform1f(m.u['uPointScale'] ?? null, cellAngle * focal * this.dpr * 0.92);

    // The sky of the frame and far scenery (beyond the measured range) as a backdrop at
    // infinity, dimmed: they keep their direction while the viewer walks, as distant things do.
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.uniform1f(m.u['uInfinity'] ?? null, Math.max(400, far * 4) * 0.8);
    gl.uniform2f(m.u['uFog'] ?? null, 0, 0);
    gl.uniform1i(m.u['uMode'] ?? null, modeIndex === 2 ? 2 : 0);
    if (this.skyDome.count > 0 && modeIndex !== 1) {
      // Full brightness at the start pose (the first view equals the frame), dimmed once the
      // viewer steps away, so the backdrop reads as such.
      gl.uniform1f(m.u['uDim'] ?? null, 1 - 0.45 * smoothstep(0.03, 0.45, vec3.length(eye)));
      this.drawIndexed(this.skyDome, gl.TRIANGLES);
    }
    if (this.backdrop.count > 0) {
      gl.uniform1f(m.u['uDim'] ?? null, 0.42);
      this.drawIndexed(this.backdrop, gl.TRIANGLES);
    }
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.uniform1f(m.u['uInfinity'] ?? null, 0);
    gl.uniform1f(m.u['uDim'] ?? null, 1);
    gl.uniform2f(m.u['uFog'] ?? null, fog[0], fog[1]);
    gl.uniform1i(m.u['uMode'] ?? null, modeIndex);
    if (modeIndex === 1) this.drawIndexed(this.cloud, gl.POINTS);
    else this.drawIndexed(this.surface, gl.TRIANGLES);
    // Seams across depth jumps: they complete the picture from the start pose and fade out as
    // soon as the viewer steps away, uncovering what the camera could not see.
    const seamAlpha = 1 - smoothstep(0.03, 0.45, vec3.length(eye));
    if (modeIndex === 0 && seamAlpha > 0.01 && this.seams.count > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.uniform1f(m.u['uAlpha'] ?? null, seamAlpha);
      this.drawIndexed(this.seams, gl.TRIANGLES);
      gl.uniform1f(m.u['uAlpha'] ?? null, 1);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);

    // Ground plane grid; pulled 5 % towards the eye so it shows on the reconstructed ground.
    if (settings.ground) {
      const g = this.ground;
      gl.useProgram(g.program);
      gl.uniformMatrix4fv(g.u['uView'] ?? null, false, this.view);
      gl.uniformMatrix4fv(g.u['uProj'] ?? null, false, this.proj);
      gl.uniform3f(g.u['uCenter'] ?? null, Math.round(eye[0] / 10) * 10, 0, Math.round(eye[2] / 10) * 10);
      gl.uniform1f(g.u['uRadius'] ?? null, far * 1.2);
      gl.uniform1f(g.u['uY'] ?? null, -EYE_HEIGHT);
      gl.uniform1f(g.u['uBias'] ?? null, 0.95);
      gl.uniform3fv(g.u['uEye'] ?? null, eye);
      gl.uniform2f(g.u['uFog'] ?? null, far * 0.15, far * 0.9);
      gl.uniform1f(g.u['uAlpha'] ?? null, 1);
      gl.uniform1f(g.u['uReveal'] ?? null, reveal);
      gl.bindVertexArray(this.plane.vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // Lines.
    const l = this.lines;
    gl.useProgram(l.program);
    gl.uniformMatrix4fv(l.u['uView'] ?? null, false, this.view);
    gl.uniformMatrix4fv(l.u['uProj'] ?? null, false, this.proj);
    gl.uniform3fv(l.u['uEye'] ?? null, eye);
    gl.uniform1f(l.u['uInfinity'] ?? null, 0);
    gl.uniform1f(l.u['uRound'] ?? null, 0);
    gl.uniform1f(l.u['uPointSize'] ?? null, 1);
    gl.uniform2f(l.u['uFog'] ?? null, fog[0], fog[1]);
    const lineDone = !this.revealing;
    if (settings.edges && lineDone) this.drawLines(this.edgeLines, 0.995, settings.mode === 'wire' ? 0.9 : 0.6);
    if (lineDone) this.drawLines(this.skyLines, 0.99, 1);
    gl.uniform2f(l.u['uFog'] ?? null, 0, 0);
    if (lineDone) this.drawLines(this.extras, 0.97, 0.9);
    if (lineDone && this.skyFarLines.count > 0) {
      gl.uniform1f(l.u['uInfinity'] ?? null, Math.max(400, far * 4) * 0.8);
      this.drawLines(this.skyFarLines, 1, 0.75);
      gl.uniform1f(l.u['uInfinity'] ?? null, 0);
    }
    // The original camera stays visible through walls, faintly.
    gl.disable(gl.DEPTH_TEST);
    if (lineDone) this.drawLines(this.extras, 1, 0.14);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);

    this.target = this.aim(eye, fwd, far);
    this.drawHud(live, hfov, focal);
    const azRel = (c.yaw * 180) / Math.PI;
    this.hooks.onReadout({
      position: eye,
      azimuth: live.headingDeg !== null ? normDeg(live.headingDeg + azRel) : azRel,
      relative: live.headingDeg === null,
      pitch: (c.pitch * 180) / Math.PI,
      hfov,
      zoom: 1 / c.zoom,
      speed: c.speedNow,
      fps: this.fps,
    });
  }

  private cells(): [number, number] {
    const { width: w, height: h } = this.scene.grid;
    const stride = Math.max(1, Math.round(w / 110));
    return [(w - 1) / stride, (h - 1) / stride];
  }

  private drawIndexed(mesh: Mesh, primitive: number): void {
    const gl = this.gl;
    if (mesh.count === 0) return;
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(primitive, mesh.count, mesh.indexType ?? gl.UNSIGNED_INT, 0);
  }

  private drawLines(mesh: Mesh, bias: number, alpha: number): void {
    if (mesh.count === 0) return;
    const gl = this.gl;
    gl.uniform1f(this.lines.u['uBias'] ?? null, bias);
    gl.uniform1f(this.lines.u['uAlpha'] ?? null, alpha);
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(gl.LINES, 0, mesh.count);
  }

  private aim(eye: Vec3, dir: Vec3, far: number): { range: number; kind: 'surface' | 'ground' | 'far' | 'sky' } | null {
    const hit = raycastSpace(this.scene, eye, dir, far * 1.5);
    if (hit !== null) return { range: hit, kind: 'surface' };
    if (dir[1] < -1e-3) {
      const t = (-EYE_HEIGHT - eye[1]) / dir[1];
      if (t > 0 && t < far * 1.5) return { range: t, kind: 'ground' };
    }
    // What the original camera saw in this direction, far away: unmeasured scenery or sky.
    const k = cellKind(this.scene, dir);
    if (k === 2) return { range: Infinity, kind: 'far' };
    if (k === 0) return { range: Infinity, kind: 'sky' };
    return null;
  }

  private drawHud(live: Live, hfov: number, focal: number): void {
    const ctx = prepareOverlay(this.hud, this.width, this.height, this.dpr);
    if (!ctx) return;
    const t = this.hooks.t;
    const W = this.width;
    const H = this.height;
    const cx = W / 2;
    const cy = H / 2;
    const c = this.controls;
    const yawDeg = (c.yaw * 180) / Math.PI;
    const pitchDeg = (c.pitch * 180) / Math.PI;
    const heading = live.headingDeg;
    const relative = heading === null;
    const az = relative ? yawDeg : normDeg(heading + yawDeg);

    drawPitchLadder(ctx, cx, cy, W, pitchDeg, focal, H, t);

    const markers: TapeMarker[] = [];
    if (Math.abs(((yawDeg % 360) + 540) % 360 - 180) > 2 || Math.hypot(...c.position) > 0.3) {
      markers.push({ az: relative ? 0 : heading, label: t('KAMERA'), kind: 'origin' });
    }
    const sun = live.sun;
    if (sun && heading !== null) markers.push({ az: sun.azimuthDeg, label: t('SONNE'), kind: 'sun' });
    drawCompassTape(ctx, { cx, y: 14, width: Math.min(560, W * 0.46), azimuth: az, relative, span: 110, fovDeg: hfov, markers, t });

    // Sun in the sky.
    if (sun && heading !== null) {
      const dir = vec3.fromAzEl(sun.azimuthDeg - heading, sun.elevationDeg);
      const p = projectToScreen(this.viewProj, vec3.add(c.position, vec3.scale(dir, 1000)), W, H);
      const caption = t('SONNE');
      const sub = `${fmtAz(sun.azimuthDeg)} · ${fmtSigned(sun.elevationDeg, 1)}°`;
      if (p && p.x > 30 && p.x < W - 30 && p.y > 80 && p.y < H - 50) drawSun(ctx, p.x, p.y, sun.elevationDeg < 0, caption, sub, p.x > W - 330);
      else {
        const v = transformDir(this.view, dir);
        drawEdgePointer(ctx, W, H, v[0], -v[1], `${t('SONNE')} ${fmtAz(sun.azimuthDeg)}`);
      }
    }
    if (this.shadowTip) {
      const tip = projectToScreen(this.viewProj, this.shadowTip.tip, W, H);
      if (tip && tip.depth > 0.5 && tip.x > 0 && tip.x < W && tip.y > 0 && tip.y < H) {
        drawAnchor(ctx, tip.x, tip.y + 10, `${t('SCHATTEN')} ${fmtAz(this.shadowTip.azimuth)}`, `1 : ${fmt(this.shadowTip.ratio, 2)}`, 'left');
      }
    }
    // The point the video was recorded from, once the viewer has left it.
    const away = Math.hypot(...c.position);
    if (away > 1.2) {
      const o = projectToScreen(this.viewProj, [0, 0, 0], W, H);
      if (o && o.x > 20 && o.x < W - 20 && o.y > 80 && o.y < H - 40) drawAnchor(ctx, o.x, o.y - 14, t('AUFNAHMEPUNKT'), fmtMetres(away), 'center');
    }

    const aim = this.target;
    const far = this.scene.grid.far;
    if (!aim) drawCrosshair(ctx, cx, cy, '—', t('KEIN ZIEL'));
    else if (aim.kind === 'far') drawCrosshair(ctx, cx, cy, `> ${fmt(far, 0)} M`, t('JENSEITS DER REICHWEITE'));
    else if (aim.kind === 'sky') drawCrosshair(ctx, cx, cy, '∞', t('HIMMEL'));
    else drawCrosshair(ctx, cx, cy, fmtMetres(aim.range), aim.kind === 'ground' ? t('BODENEBENE') : t('OBERFLÄCHE'));
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.detach();
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.res.dispose();
    loseContext(this.gl);
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Direction into view space (no translation). */
function transformDir(view: Float32Array, d: Vec3): Vec3 {
  return [
    view[0]! * d[0] + view[4]! * d[1] + view[8]! * d[2],
    view[1]! * d[0] + view[5]! * d[1] + view[9]! * d[2],
    view[2]! * d[0] + view[6]! * d[1] + view[10]! * d[2],
  ];
}

/* ---------------------------------------------------------------- loading */

async function fetchGrid(url: string, signal: AbortSignal, t: Translate): Promise<SpaceGrid> {
  const response = await fetch(url, { signal, credentials: 'same-origin' });
  if (!response.ok) throw new Error(t('Raumgitter nicht verfügbar (HTTP {status}).', { status: response.status }));
  return parseSpaceGrid(await response.arrayBuffer());
}

function loadImage(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.crossOrigin = 'anonymous';
    const abort = (): void => {
      img.src = '';
      reject(new DOMException('Abgebrochen', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    img.onload = () => {
      signal.removeEventListener('abort', abort);
      resolve(img);
    };
    img.onerror = () => {
      signal.removeEventListener('abort', abort);
      reject(new Error('Schlüsselbild konnte nicht geladen werden.'));
    };
    img.src = url;
  });
}

/* --------------------------------------------------------------- component */

function setText(el: HTMLElement | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

export function SpaceView({ gridUrl, imageUrl, label, headingDeg = null, fovDeg, pitchDeg = 0, sun = null, onExit, embedded = false }: SpaceViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<SpaceEngine | null>(null);
  const posRef = useRef<HTMLSpanElement>(null);
  const viewRef = useRef<HTMLSpanElement>(null);
  const opticRef = useRef<HTMLSpanElement>(null);
  const rateRef = useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading', steps: [] });
  const [mode, setMode] = useState<RenderMode>('surface');
  const [edges, setEdges] = useState(false);
  const [colour, setColour] = useState(0.3);
  const [ground, setGround] = useState(true);
  const [restore, setRestore] = useState(0);
  const { t } = useLang();
  // The engine and the readout callback live across language changes; they read `t` from here.
  const tRef = useRef(t);
  tRef.current = t;

  const settings = useRef<Settings>({ mode, edges, colour, ground });
  settings.current = { mode, edges, colour, ground };
  const live = useRef<Live>({ headingDeg, sun });
  live.current = { headingDeg: headingDeg ?? null, sun: sun ?? null };
  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  const onReadout = useCallback((r: Readout) => {
    const tr = tRef.current;
    const [x, y, z] = r.position;
    // The position is for development (?debug); the view direction is for everyone.
    if (DEBUG) setText(posRef.current, `X ${fmtSigned(x, 2)}  Y ${fmtSigned(y, 2)}  Z ${fmtSigned(z, 2)} m`);
    setText(
      viewRef.current,
      `${r.relative ? `${tr('Richtung')} ${fmtSigned(((r.azimuth % 360) + 540) % 360 - 180, 0)}°` : `${tr('Azimut')} ${fmtAz(r.azimuth)}`} · ${tr('Nick')} ${fmtSigned(r.pitch, 0)}°`,
    );
    setText(opticRef.current, `${tr('SICHTFELD')} ${fmt(r.hfov, 0)}°  ${fmt(r.speed, 1)} M/S`);
    setText(rateRef.current, `${fmt(Math.min(240, r.fps), 0)} ${tr('BILDER/S')}`);
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    const hud = hudRef.current;
    if (!wrap || !hud) return;
    let cancelled = false;
    const abort = new AbortController();
    const canvas = document.createElement('canvas');
    canvas.className = 'sv-gl';
    canvas.setAttribute('aria-hidden', 'true');
    wrap.insertBefore(canvas, wrap.firstChild);
    let engine: SpaceEngine | null = null;
    let observer: ResizeObserver | null = null;
    setPhase({ kind: 'loading', steps: [] });
    const steps: string[] = [];
    const step = (s: string): void => {
      steps.push(s);
      if (!cancelled) setPhase({ kind: 'loading', steps: [...steps] });
    };

    void (async () => {
      try {
        const tr = tRef.current;
        const gridP = fetchGrid(gridUrl, abort.signal, tr).then((g) => {
          step(
            tr('Raster {w} × {h} · {fov} · bis {far} m', {
              w: g.width,
              h: g.height,
              fov: g.fovDeg > 0 ? `${fmt(g.fovDeg, 0)}°` : tr('ohne Brennweite'),
              far: fmt(g.far, 0),
            }),
          );
          return g;
        });
        const imageP = loadImage(imageUrl, abort.signal).then((img) => {
          step(tr('Bild {w} × {h}', { w: img.naturalWidth, h: img.naturalHeight }));
          return img;
        });
        const [grid, image] = await Promise.all([gridP, imageP]);
        if (cancelled) return;
        const aspect = image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : grid.width / grid.height;
        const scene = buildSpaceScene(grid, aspect, fovDeg ?? 60, pitchDeg);
        if (scene.triangles.length === 0 && scene.points.length === 0) throw new Error('Das Raster enthält keine vermessenen Flächen.');
        engine = new SpaceEngine(wrap, canvas, hud, scene, image, {
          settings: () => settings.current,
          live: () => live.current,
          onReadout,
          onLost: () => {
            if (!cancelled) setPhase({ kind: 'error', message: 'Der Grafikkontext ist verloren gegangen. Der Raum wird neu aufgebaut …' });
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
        setPhase({ kind: 'ready', stats: engine.stats });
        if (!wrap.contains(document.activeElement)) wrap.focus({ preventScroll: true });
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        setPhase({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    })();

    return () => {
      cancelled = true;
      abort.abort();
      observer?.disconnect();
      engine?.dispose();
      engineRef.current = null;
      canvas.remove();
    };
  }, [gridUrl, imageUrl, fovDeg, pitchDeg, onReadout, restore]);

  useEffect(() => {
    engineRef.current?.invalidate();
  }, [mode, edges, colour, ground, headingDeg, sun?.azimuthDeg, sun?.elevationDeg, t]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') {
      if (document.pointerLockElement) return;
      if (exitRef.current) {
        e.preventDefault();
        exitRef.current();
      }
      return;
    }
    if (phase.kind !== 'ready' || e.repeat) return;
    const k = e.key.toLowerCase();
    if (k === '1') setMode('surface');
    else if (k === '2') setMode('points');
    else if (k === '3') setMode('wire');
    else if (k === 'k') setEdges((v) => !v);
    else if (k === 'g') setGround((v) => !v);
    else if (k === 'f') setColour((v) => COLOUR_STEPS[(COLOUR_STEPS.findIndex((s) => s.value === v) + 1) % COLOUR_STEPS.length]!.value);
    else return;
    e.preventDefault();
  };

  // The sun at the estimated time: its height and the length of shadows hold whichever way the
  // camera looked; where in the picture it stands only with a heading (then drawn in the sky).
  const sunLine = sun
    ? sun.elevationDeg > 0.5
      ? `${t('Sonne')} ${fmt(sun.elevationDeg, 0)}° · ${t('Schatten')} 1 : ${fmt(1 / Math.tan((sun.elevationDeg * Math.PI) / 180), 1)}${headingDeg === null ? ` · ${t('Richtung im Bild unbekannt')}` : ''}`
      : t('Sonne unter dem Horizont')
    : null;

  // Inside a tab (embedded) there is nothing to leave: Esc goes back, but the line does not offer it.
  const help = `${t('W A S D gehen · Maus schauen · Q E hoch runter · Shift schneller · R zurück')}${onExit && !embedded ? ` · ${t('Esc verlassen')}` : ''}`;

  return (
    <div
      ref={wrapRef}
      className="sv"
      tabIndex={0}
      role="application"
      aria-roledescription={t('begehbarer Raum')}
      aria-label={`${t('Raum aus dem Videobild')}${label ? `: ${label}` : ''}. ${help}. ${t('Ziffern 1 bis 3 wechseln die Darstellung.')}`}
      aria-busy={phase.kind === 'loading'}
      onKeyDown={onKeyDown}
    >
      <canvas ref={hudRef} className="sv-hud" aria-hidden="true" />
      {!embedded && (
        <div className="sv-readout sv-tl">
          <span>{t('Raum')}</span>
          {label && <span className="sv-dim">{label}</span>}
        </div>
      )}

      {phase.kind === 'ready' && (
        <>
          <div className="sv-panel sv-tr" data-hud-control>
            <div className="sv-group" role="group" aria-label={t('Darstellung')}>
              {MODES.map((m) => (
                <button key={m.id} type="button" aria-pressed={mode === m.id} title={`${t(m.label)} (${m.key})`} onClick={() => setMode(m.id)}>
                  {t(m.label)}
                </button>
              ))}
            </div>
            <div className="sv-group" role="group" aria-label={t('Ebenen')}>
              <button type="button" aria-pressed={edges} title={`${t('Kanten')} (K)`} onClick={() => setEdges((v) => !v)}>
                {t('Kanten')}
              </button>
              <button type="button" aria-pressed={ground} title={`${t('Bodenraster')} (G)`} onClick={() => setGround((v) => !v)}>
                {t('Boden')}
              </button>
            </div>
            <div className="sv-group" role="group" aria-label={t('Farbanteil')}>
              {COLOUR_STEPS.map((s) => (
                <button key={s.label} type="button" aria-pressed={colour === s.value} title={`${t('Farbanteil')} (F)`} onClick={() => setColour(s.value)}>
                  {t(s.label)}
                </button>
              ))}
            </div>
            <div className="sv-group">
              <button type="button" title={`${t('Zurück zum Aufnahmepunkt')} (R)`} onClick={() => engineRef.current?.reset()}>
                {t('Aufnahmepunkt')}
              </button>
              {onExit && !embedded && (
                <button type="button" title={`${t('Verlassen')} (Esc)`} onClick={onExit}>
                  {t('Verlassen')}
                </button>
              )}
            </div>
          </div>

          <div className="sv-readout sv-bl sv-stack sv-plain" aria-live="off">
            {DEBUG && <span ref={posRef} />}
            <span ref={viewRef} />
            {sunLine && <span className="sv-dim">{sunLine}</span>}
          </div>
          {DEBUG && (
            <div className="sv-readout sv-br sv-stack">
              <span>
                {t('Raster {w} × {h} · {n} Dreiecke', { w: phase.stats.columns, h: phase.stats.rows, n: fmt(phase.stats.triangles, 0) })}
              </span>
              <span className="sv-dim">
                {t('Sichtfeld {fov}° · Reichweite {far} m', { fov: fmt(phase.stats.fovDeg, 0), far: fmt(phase.stats.far, 0) })} · <span ref={rateRef} /> ·{' '}
                <span ref={opticRef} />
              </span>
            </div>
          )}
          <div className="sv-help" aria-hidden="true">
            {help}
          </div>
        </>
      )}

      {phase.kind === 'loading' && (
        <div className="sv-status" role="status">
          <p className="sv-status-title">{t('Raum wird aufgebaut …')}</p>
          <i className="sv-bar" />
          <ul className="sv-steps">
            {phase.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {phase.kind === 'error' && (
        <div className="sv-status" role="alert">
          <p className="sv-status-title">{t('Raum nicht verfügbar')}</p>
          <p className="sv-status-detail">{t(phase.message)}</p>
          {onExit && (
            <button type="button" className="sv-status-btn" onClick={onExit}>
              {t('Zurück')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
