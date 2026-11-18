/**
 * Minimal WebGL2 toolkit for the DATUM space and terrain viewers: context creation, shader
 * compilation, buffers and vertex arrays, resource tracking, 4x4 matrices and 3-vectors, and the
 * parser for DSG1 space grids. No third-party code; matrices are column-major as WebGL expects.
 */

export type Vec3 = [number, number, number];
export type Mat4 = Float32Array;

/* ------------------------------------------------------------------ vectors */

export const vec3 = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  length: (a: Vec3): number => Math.hypot(a[0], a[1], a[2]),
  normalize: (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  /** Horizontal unit direction for an azimuth (0 = north = -z, 90 = east = +x) and elevation, in degrees. */
  fromAzEl: (azDeg: number, elDeg: number): Vec3 => {
    const a = (azDeg * Math.PI) / 180;
    const e = (elDeg * Math.PI) / 180;
    return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
  },
};

/* ----------------------------------------------------------------- matrices */

export const mat4 = {
  create(): Mat4 {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },

  perspective(out: Mat4, fovY: number, aspect: number, near: number, far: number): Mat4 {
    const f = 1 / Math.tan(fovY / 2);
    const nf = 1 / (near - far);
    out.fill(0);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[14] = 2 * far * near * nf;
    return out;
  },

  ortho(out: Mat4, left: number, right: number, bottom: number, top: number, near: number, far: number): Mat4 {
    const lr = 1 / (left - right);
    const bt = 1 / (bottom - top);
    const nf = 1 / (near - far);
    out.fill(0);
    out[0] = -2 * lr;
    out[5] = -2 * bt;
    out[10] = 2 * nf;
    out[12] = (left + right) * lr;
    out[13] = (top + bottom) * bt;
    out[14] = (far + near) * nf;
    out[15] = 1;
    return out;
  },

  lookAt(out: Mat4, eye: Vec3, center: Vec3, up: Vec3): Mat4 {
    let z = vec3.sub(eye, center);
    z = vec3.normalize(z);
    let x = vec3.cross(up, z);
    if (vec3.length(x) < 1e-9) x = vec3.cross([0, 0, 1], z);
    x = vec3.normalize(x);
    const y = vec3.cross(z, x);
    out[0] = x[0];
    out[1] = y[0];
    out[2] = z[0];
    out[3] = 0;
    out[4] = x[1];
    out[5] = y[1];
    out[6] = z[1];
    out[7] = 0;
    out[8] = x[2];
    out[9] = y[2];
    out[10] = z[2];
    out[11] = 0;
    out[12] = -vec3.dot(x, eye);
    out[13] = -vec3.dot(y, eye);
    out[14] = -vec3.dot(z, eye);
    out[15] = 1;
    return out;
  },

  multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
    const r = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let row = 0; row < 4; row++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += (a[k * 4 + row] as number) * (b[c * 4 + k] as number);
        r[c * 4 + row] = s;
      }
    }
    out.set(r);
    return out;
  },

  invert(out: Mat4, m: Mat4): Mat4 | null {
    const a = Array.from(m);
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = a as [
      number, number, number, number, number, number, number, number,
      number, number, number, number, number, number, number, number,
    ];
    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1 / det;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return out;
  },
};

/** Multiplies a point (w = 1) by a matrix; returns clip coordinates [x, y, z, w]. */
export function transformPoint(m: Mat4, p: Vec3): [number, number, number, number] {
  const [x, y, z] = p;
  const e = (i: number): number => m[i] as number;
  return [
    e(0) * x + e(4) * y + e(8) * z + e(12),
    e(1) * x + e(5) * y + e(9) * z + e(13),
    e(2) * x + e(6) * y + e(10) * z + e(14),
    e(3) * x + e(7) * y + e(11) * z + e(15),
  ];
}

/**
 * Projects a world point to CSS pixels of a viewport, or null when it lies behind the eye.
 * `depth` is the clip w (distance along the view axis).
 */
export function projectToScreen(viewProj: Mat4, p: Vec3, width: number, height: number): { x: number; y: number; depth: number } | null {
  const c = transformPoint(viewProj, p);
  if (c[3] <= 1e-6) return null;
  return { x: ((c[0] / c[3]) * 0.5 + 0.5) * width, y: (0.5 - (c[1] / c[3]) * 0.5) * height, depth: c[3] };
}

/* ------------------------------------------------------------------ context */

export function createGl(canvas: HTMLCanvasElement, options: WebGLContextAttributes = {}): WebGL2RenderingContext | null {
  return canvas.getContext('webgl2', {
    antialias: true,
    alpha: false,
    depth: true,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
    ...options,
  });
}

export interface Program {
  program: WebGLProgram;
  /** Uniform locations by name; a missing name means the uniform was optimised away. */
  u: Record<string, WebGLUniformLocation>;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Shader konnte nicht angelegt werden.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new Error(`Shader-Fehler: ${log}`);
  }
  return shader;
}

/** Compiles and links a program; attribute locations are fixed in the shaders with `layout(location = n)`. */
export function createProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): Program {
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!program) throw new Error('Programm konnte nicht angelegt werden.');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(program) ?? '';
    gl.deleteProgram(program);
    throw new Error(`Programm-Fehler: ${log}`);
  }
  const u: Record<string, WebGLUniformLocation> = {};
  const count = (gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number | null) ?? 0;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    const name = info.name.replace(/\[0\]$/, '');
    const loc = gl.getUniformLocation(program, info.name);
    if (loc) u[name] = loc;
  }
  return { program, u };
}

export interface Attribute {
  location: number;
  /** Components per vertex. */
  size: number;
  /** Uploaded into a new buffer. */
  data?: Float32Array | Uint8Array;
  /** Or: an existing buffer shared with another mesh (`type` defaults to FLOAT). */
  buffer?: WebGLBuffer;
  type?: number;
  normalized?: boolean;
  usage?: number;
}

export interface Mesh {
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  /** Vertex count, or index count when indexed. */
  count: number;
  indexType: number | null;
}

/**
 * Tracks every GL object created for a view so that one `dispose()` frees all of them on unmount.
 */
export class GlResources {
  private readonly programs: WebGLProgram[] = [];
  private readonly buffers: WebGLBuffer[] = [];
  private readonly vaos: WebGLVertexArrayObject[] = [];
  private readonly textures: WebGLTexture[] = [];
  private readonly framebuffers: WebGLFramebuffer[] = [];

  constructor(readonly gl: WebGL2RenderingContext) {}

  program(vertex: string, fragment: string): Program {
    const p = createProgram(this.gl, vertex, fragment);
    this.programs.push(p.program);
    return p;
  }

  /** A vertex array with one buffer per attribute and an optional index buffer. */
  mesh(attributes: Attribute[], indices?: Uint32Array | Uint16Array | null): Mesh {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Vertex-Array konnte nicht angelegt werden.');
    this.vaos.push(vao);
    gl.bindVertexArray(vao);
    const buffers: WebGLBuffer[] = [];
    let vertexCount = 0;
    for (const a of attributes) {
      let buffer = a.buffer ?? null;
      let type = a.type ?? gl.FLOAT;
      if (!buffer) {
        buffer = gl.createBuffer();
        if (!buffer) throw new Error('Puffer konnte nicht angelegt werden.');
        this.buffers.push(buffer);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        if (a.data) gl.bufferData(gl.ARRAY_BUFFER, a.data, a.usage ?? gl.STATIC_DRAW);
        type = a.data instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.FLOAT;
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      }
      buffers.push(buffer);
      gl.enableVertexAttribArray(a.location);
      gl.vertexAttribPointer(a.location, a.size, type, a.normalized ?? false, 0, 0);
      if (a.data) vertexCount = a.data.length / a.size;
    }
    let indexType: number | null = null;
    let count = vertexCount;
    if (indices) {
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error('Puffer konnte nicht angelegt werden.');
      this.buffers.push(buffer);
      buffers.push(buffer);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      indexType = indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
      count = indices.length;
    }
    gl.bindVertexArray(null);
    return { vao, buffers, count, indexType };
  }

  /** Replaces the contents of attribute buffer `index` of a mesh (dynamic geometry). */
  update(mesh: Mesh, index: number, data: Float32Array, size: number): void {
    const gl = this.gl;
    const buffer = mesh.buffers[index];
    if (!buffer) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    if (index === 0) mesh.count = data.length / size;
  }

  texture(): WebGLTexture {
    const t = this.gl.createTexture();
    if (!t) throw new Error('Textur konnte nicht angelegt werden.');
    this.textures.push(t);
    return t;
  }

  framebuffer(): WebGLFramebuffer {
    const f = this.gl.createFramebuffer();
    if (!f) throw new Error('Framebuffer konnte nicht angelegt werden.');
    this.framebuffers.push(f);
    return f;
  }

  dispose(): void {
    const gl = this.gl;
    for (const p of this.programs) gl.deleteProgram(p);
    for (const b of this.buffers) gl.deleteBuffer(b);
    for (const v of this.vaos) gl.deleteVertexArray(v);
    for (const t of this.textures) gl.deleteTexture(t);
    for (const f of this.framebuffers) gl.deleteFramebuffer(f);
    this.programs.length = 0;
    this.buffers.length = 0;
    this.vaos.length = 0;
    this.textures.length = 0;
    this.framebuffers.length = 0;
  }
}

/** Uploads an image as an RGBA texture with mipmaps and (where available) anisotropic filtering. */
export function uploadImageTexture(gl: WebGL2RenderingContext, texture: WebGLTexture, image: TexImageSource): void {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  if (aniso) {
    const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
    gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
  }
  gl.bindTexture(gl.TEXTURE_2D, null);
}

/** Resizes a canvas's drawing buffer to its CSS box times the device pixel ratio (capped at 2). */
export function fitCanvas(canvas: HTMLCanvasElement, width: number, height: number, maxDpr = 2): number {
  const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return dpr;
}

/** Frees the GPU context right away instead of waiting for garbage collection. */
export function loseContext(gl: WebGL2RenderingContext): void {
  gl.getExtension('WEBGL_lose_context')?.loseContext();
}

/* ------------------------------------------------------------ line shader */

/**
 * Hairlines and dots shared by both viewers: white, per-vertex alpha, fog by view distance.
 * `uBias` < 1 pulls a line towards the eye so it wins the depth test on the surface it lies on
 * (the projection is unchanged because the point moves along its own view ray). With
 * `uInfinity` > 0 the positions are directions drawn at that radius around the eye (sky, far
 * backdrop), so they keep their direction while the viewer walks.
 */
export const LINE_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in float aAlpha;
uniform mat4 uView;
uniform mat4 uProj;
uniform vec3 uEye;
uniform float uBias;
uniform float uInfinity;
uniform float uPointSize;
out float vAlpha;
out float vDist;
void main() {
  vec3 p = uInfinity > 0.0 ? uEye + normalize(aPos) * uInfinity : aPos;
  vec4 v = uView * vec4(p, 1.0);
  vDist = uInfinity > 0.0 ? 0.0 : length(v.xyz);
  v.xyz *= uBias;
  gl_Position = uProj * v;
  gl_PointSize = uPointSize;
  vAlpha = aAlpha;
}`;

export const LINE_FS = `#version 300 es
precision highp float;
in float vAlpha;
in float vDist;
uniform float uAlpha;
uniform vec2 uFog;
uniform float uRound;
out vec4 outColor;
void main() {
  if (uRound > 0.5) {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    if (dot(q, q) > 1.0) discard;
  }
  float fog = uFog.y > 0.0 ? smoothstep(uFog.x, uFog.y, vDist) : 0.0;
  outColor = vec4(vec3(0.93), vAlpha * uAlpha * (1.0 - fog));
}`;

/** Growable list of line vertices (position + alpha) for GL_LINES or GL_POINTS. */
export class LineBuilder {
  positions: number[] = [];
  alphas: number[] = [];

  segment(a: Vec3, b: Vec3, alpha = 1, alphaB = alpha): void {
    this.positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    this.alphas.push(alpha, alphaB);
  }

  point(p: Vec3, alpha = 1): void {
    this.positions.push(p[0], p[1], p[2]);
    this.alphas.push(alpha);
  }

  /** A polyline as separate segments; `closed` joins the last point to the first. */
  polyline(points: Vec3[], alpha = 1, closed = false): void {
    for (let i = 0; i + 1 < points.length; i++) this.segment(points[i] as Vec3, points[i + 1] as Vec3, alpha);
    if (closed && points.length > 2) this.segment(points[points.length - 1] as Vec3, points[0] as Vec3, alpha);
  }

  /** Dashes along a straight segment: `on` metres drawn, `off` metres gap. */
  dashed(a: Vec3, b: Vec3, on: number, off: number, alpha = 1): void {
    const len = vec3.length(vec3.sub(b, a));
    if (len <= 0) return;
    for (let t = 0; t < len; t += on + off) {
      const t1 = Math.min(len, t + on);
      this.segment(vec3.lerp(a, b, t / len), vec3.lerp(a, b, t1 / len), alpha);
    }
  }

  get count(): number {
    return this.alphas.length;
  }

  arrays(): { positions: Float32Array; alphas: Float32Array } {
    return { positions: new Float32Array(this.positions), alphas: new Float32Array(this.alphas) };
  }
}

/* --------------------------------------------------------------- DSG1 grid */

export interface SpaceGrid {
  width: number;
  height: number;
  /** Horizontal field of view of the pinhole the rays were cast from (degrees). */
  fovDeg: number;
  near: number;
  far: number;
  /** Distance along each viewing ray (m), row-major from the top-left; >= far marks sky / unknown. */
  distance: Float32Array;
  /** 1 = sky. */
  sky: Uint8Array;
}

/**
 * Parses a DSG1 space grid (see `SPACE_GRID_MAGIC` in the DATUM contract). Throws an Error with a
 * German message when the data is not a valid grid.
 */
export function parseSpaceGrid(buffer: ArrayBuffer): SpaceGrid {
  const header = 24;
  if (buffer.byteLength < header) throw new Error('Raumgitter ist zu kurz.');
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'DSG1') throw new Error('Unbekanntes Raumgitter-Format.');
  const width = view.getUint32(4, true);
  const height = view.getUint32(8, true);
  const fovDeg = view.getFloat32(12, true);
  const near = view.getFloat32(16, true);
  const far = view.getFloat32(20, true);
  const n = width * height;
  if (width < 2 || height < 2 || n > 16_777_216) throw new Error('Raumgitter hat eine ungültige Größe.');
  if (buffer.byteLength < header + n * 5) throw new Error('Raumgitter ist unvollständig.');
  if (!(far > 0) || !Number.isFinite(far)) throw new Error('Raumgitter hat keine gültige Fernweite.');
  const distance = new Float32Array(n);
  const littleEndianHost = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  if (littleEndianHost) distance.set(new Float32Array(buffer, header, n));
  else for (let i = 0; i < n; i++) distance[i] = view.getFloat32(header + i * 4, true);
  const sky = new Uint8Array(buffer, header + n * 4, n).slice();
  return {
    width,
    height,
    fovDeg: Number.isFinite(fovDeg) && fovDeg > 1 && fovDeg < 179 ? fovDeg : 0,
    near: Number.isFinite(near) && near > 0 ? near : 0.1,
    far,
    distance,
    sky,
  };
}

/** Writes a DSG1 grid (used by the development harness and tests). */
export function encodeSpaceGrid(grid: SpaceGrid): ArrayBuffer {
  const n = grid.width * grid.height;
  const buffer = new ArrayBuffer(24 + n * 5);
  const view = new DataView(buffer);
  'DSG1'.split('').forEach((c, i) => view.setUint8(i, c.charCodeAt(0)));
  view.setUint32(4, grid.width, true);
  view.setUint32(8, grid.height, true);
  view.setFloat32(12, grid.fovDeg, true);
  view.setFloat32(16, grid.near, true);
  view.setFloat32(20, grid.far, true);
  for (let i = 0; i < n; i++) view.setFloat32(24 + i * 4, grid.distance[i] as number, true);
  new Uint8Array(buffer, 24 + n * 4, n).set(grid.sky);
  return buffer;
}
