/**
 * Camera controls for the DATUM viewers, written against plain DOM events:
 *
 *   FirstPersonControls  walk through a space (W A S D / arrows, mouse or finger look, Q E up and
 *                        down, Shift run, wheel field of view, R back to the start pose, optional
 *                        pointer lock on double click, two fingers to move on touch screens).
 *   OrbitControls        turn around a target (drag), zoom (wheel, pinch) and pan (right drag,
 *                        Shift drag, two fingers).
 *
 * Both integrate their state with exponential damping in `update(dt)`, which returns whether the
 * camera moved, so a viewer only redraws when needed. Angles are radians; yaw is clockwise seen
 * from above (an azimuth: 0 looks along -z, pi/2 along +x), pitch is positive upwards.
 */

import type { Vec3 } from './gl';

const TAU = Math.PI * 2;

/** Exponential approach factor for a rate (1/s) over dt seconds. */
function ease(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** Shortest signed angle from a to b. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function forwardVector(yaw: number, pitch: number): Vec3 {
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}

/** Keys are taken only while focus is inside the viewer and not on a text field. */
function ownsKey(el: HTMLElement, event: KeyboardEvent): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  const target = event.target as HTMLElement | null;
  if (!target || !el.contains(target)) return false;
  const tag = target.tagName;
  return tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !target.isContentEditable;
}

const MOVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'PageUp', 'PageDown',
]);

export interface FirstPersonPose {
  position: Vec3;
  yaw: number;
  pitch: number;
}

export interface FirstPersonOptions {
  /** Walking speed (m/s). */
  speed?: number;
  /** Speed multiplier while Shift is held. */
  runFactor?: number;
  /** Look speed (radians per CSS pixel at the default field of view). */
  lookSpeed?: number;
  /** Bounds for the zoom factor applied to the tangent of the field of view. */
  minZoom?: number;
  maxZoom?: number;
  /**
   * Height of the ground below a point. When given, the eye is kept `eyeHeight` above it and Q / E
   * lift the eye above that height instead of flying freely.
   */
  ground?: ((x: number, z: number) => number | null) | null;
  eyeHeight?: number;
  /** Keeps the eye inside an area (returns the corrected x, z). */
  clamp?: ((x: number, z: number) => [number, number]) | null;
}

interface TouchPoint {
  x: number;
  y: number;
}

export class FirstPersonControls {
  position: Vec3;
  yaw: number;
  pitch: number;
  /** Multiplies tan(fov / 2); 1 = the field of view the viewer starts with. */
  zoom = 1;
  /** When false all input is ignored (another control owns the camera). */
  enabled = true;
  /** Height above `eyeHeight` while following the ground. */
  lift = 0;

  private home: FirstPersonPose;
  private yawGoal: number;
  private pitchGoal: number;
  private zoomGoal = 1;
  private velocity: Vec3 = [0, 0, 0];
  private pending: Vec3 = [0, 0, 0];
  private returning = false;
  private readonly keys = new Set<string>();
  private readonly touches = new Map<number, TouchPoint>();
  private drag: { id: number; x: number; y: number } | null = null;
  private pinch: { mid: TouchPoint; dist: number } | null = null;
  private dirty = true;
  private readonly opts: Required<Omit<FirstPersonOptions, 'ground' | 'clamp'>> & Pick<FirstPersonOptions, 'ground' | 'clamp'>;

  constructor(
    private readonly el: HTMLElement,
    home: FirstPersonPose,
    options: FirstPersonOptions = {},
  ) {
    this.opts = {
      speed: options.speed ?? 1.6,
      runFactor: options.runFactor ?? 4,
      lookSpeed: options.lookSpeed ?? 0.0034,
      minZoom: options.minZoom ?? 0.25,
      maxZoom: options.maxZoom ?? 2.2,
      eyeHeight: options.eyeHeight ?? 1.7,
      ground: options.ground ?? null,
      clamp: options.clamp ?? null,
    };
    this.home = { position: [...home.position], yaw: home.yaw, pitch: home.pitch };
    this.position = [...home.position];
    this.yaw = this.yawGoal = home.yaw;
    this.pitch = this.pitchGoal = home.pitch;
  }

  setHome(home: FirstPersonPose, jump = true): void {
    this.home = { position: [...home.position], yaw: home.yaw, pitch: home.pitch };
    if (jump) {
      this.position = [...home.position];
      this.yaw = this.yawGoal = home.yaw;
      this.pitch = this.pitchGoal = home.pitch;
      this.velocity = [0, 0, 0];
      this.pending = [0, 0, 0];
      this.lift = 0;
      this.zoom = this.zoomGoal = 1;
      this.returning = false;
      this.dirty = true;
    }
  }

  setGround(ground: ((x: number, z: number) => number | null) | null): void {
    this.opts.ground = ground;
    this.dirty = true;
  }

  /** Glides back to the start pose (R). */
  reset(): void {
    this.returning = true;
    this.yawGoal = this.yaw + angleDelta(this.yaw, this.home.yaw);
    this.pitchGoal = this.home.pitch;
    this.zoomGoal = 1;
    this.lift = 0;
    this.velocity = [0, 0, 0];
    this.pending = [0, 0, 0];
    this.dirty = true;
  }

  /** Marks the camera as changed (e.g. after a resize) so that the next update reports it. */
  touch(): void {
    this.dirty = true;
  }

  get pressed(): ReadonlySet<string> {
    return this.keys;
  }

  get speedNow(): number {
    return Math.hypot(this.velocity[0], this.velocity[1], this.velocity[2]);
  }

  get forward(): Vec3 {
    return forwardVector(this.yaw, this.pitch);
  }

  private look(dx: number, dy: number): void {
    const k = this.opts.lookSpeed * this.zoom;
    this.yawGoal += dx * k;
    this.pitchGoal = Math.max(-1.45, Math.min(1.45, this.pitchGoal - dy * k));
    this.returning = false;
    this.dirty = true;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled || !ownsKey(this.el, e)) return;
    if (e.code === 'KeyR' && !e.repeat) {
      this.reset();
      e.preventDefault();
      return;
    }
    if (!MOVE_KEYS.has(e.code)) return;
    // Arrows and Space-like keys would scroll the page; WASD on a focused button is harmless.
    e.preventDefault();
    this.keys.add(e.code);
    this.returning = false;
    this.dirty = true;
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (this.keys.delete(e.code)) this.dirty = true;
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.drag = null;
    this.touches.clear();
    this.pinch = null;
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if ((e.target as HTMLElement | null)?.closest('button, a, input, [data-hud-control]')) return;
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.el.setPointerCapture(e.pointerId);
      this.pinch = this.touches.size === 2 ? this.twoFinger() : null;
      return;
    }
    if (e.button !== 0) return;
    this.el.focus({ preventScroll: true });
    this.el.setPointerCapture(e.pointerId);
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };

  private twoFinger(): { mid: TouchPoint; dist: number } | null {
    const [a, b] = [...this.touches.values()];
    if (!a || !b) return null;
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if (document.pointerLockElement === this.el) {
      this.look(e.movementX, e.movementY);
      return;
    }
    if (e.pointerType === 'touch') {
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      const dx = e.clientX - t.x;
      const dy = e.clientY - t.y;
      t.x = e.clientX;
      t.y = e.clientY;
      if (this.touches.size === 1) {
        // One finger drags the picture, as in a panorama.
        this.look(-dx * 1.1, -dy * 1.1);
      } else if (this.touches.size === 2) {
        const next = this.twoFinger();
        if (next && this.pinch) {
          const mdx = next.mid.x - this.pinch.mid.x;
          const mdy = next.mid.y - this.pinch.mid.y;
          const spread = next.dist - this.pinch.dist;
          const k = 0.02 * this.opts.speed;
          const fwd = -mdy * k + spread * k * 1.5;
          const side = mdx * k;
          const s = Math.sin(this.yaw);
          const c = Math.cos(this.yaw);
          this.pending[0] += s * fwd + c * side;
          this.pending[2] += -c * fwd + s * side;
          this.returning = false;
          this.dirty = true;
        }
        this.pinch = next;
      }
      return;
    }
    if (this.drag && this.drag.id === e.pointerId) {
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      this.look(dx, dy);
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      this.pinch = this.touches.size === 2 ? this.twoFinger() : null;
      return;
    }
    if (this.drag?.id === e.pointerId) this.drag = null;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    const delta = e.deltaY * (e.deltaMode === 1 ? 33 : 1);
    this.zoomGoal = Math.max(this.opts.minZoom, Math.min(this.opts.maxZoom, this.zoomGoal * Math.exp(delta * 0.0012)));
    this.dirty = true;
  };

  private readonly onDoubleClick = (e: MouseEvent): void => {
    if (!this.enabled) return;
    if ((e.target as HTMLElement | null)?.closest('button, a, input, [data-hud-control]')) return;
    if (document.pointerLockElement === this.el) return;
    try {
      const request = this.el.requestPointerLock() as unknown;
      if (request instanceof Promise) request.catch(() => undefined);
    } catch {
      // Pointer lock is optional.
    }
  };

  attach(): () => void {
    const el = this.el;
    el.addEventListener('keydown', this.onKeyDown);
    el.addEventListener('keyup', this.onKeyUp);
    el.addEventListener('focusout', this.onBlur);
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('dblclick', this.onDoubleClick);
    window.addEventListener('blur', this.onBlur);
    return () => {
      el.removeEventListener('keydown', this.onKeyDown);
      el.removeEventListener('keyup', this.onKeyUp);
      el.removeEventListener('focusout', this.onBlur);
      el.removeEventListener('pointerdown', this.onPointerDown);
      el.removeEventListener('pointermove', this.onPointerMove);
      el.removeEventListener('pointerup', this.onPointerUp);
      el.removeEventListener('pointercancel', this.onPointerUp);
      el.removeEventListener('wheel', this.onWheel);
      el.removeEventListener('dblclick', this.onDoubleClick);
      window.removeEventListener('blur', this.onBlur);
      if (document.pointerLockElement === el) document.exitPointerLock();
    };
  }

  /** Advances the camera by dt seconds; returns true when anything visible changed. */
  update(dt: number): boolean {
    const k = this.keys;
    const run = k.has('ShiftLeft') || k.has('ShiftRight') ? this.opts.runFactor : 1;
    const speed = this.opts.speed * run;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const u = (k.has('KeyQ') || k.has('PageUp') ? 1 : 0) - (k.has('KeyE') || k.has('PageDown') ? 1 : 0);
    const turn = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0);
    if (turn !== 0) this.yawGoal += turn * 1.5 * dt * this.zoom;

    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    let tx = sy * f + cy * s;
    let tz = -cy * f + sy * s;
    const tl = Math.hypot(tx, tz);
    if (tl > 0) {
      tx = (tx / tl) * speed;
      tz = (tz / tl) * speed;
    }
    const ty = u * speed * 0.7;
    const a = ease(9, dt);
    this.velocity[0] += (tx - this.velocity[0]) * a;
    this.velocity[1] += (ty - this.velocity[1]) * a;
    this.velocity[2] += (tz - this.velocity[2]) * a;

    const before: Vec3 = [...this.position];
    const p = ease(10, dt);
    const px = this.pending[0] * p;
    const pz = this.pending[2] * p;
    this.pending[0] -= px;
    this.pending[2] -= pz;
    let x = this.position[0] + this.velocity[0] * dt + px;
    let z = this.position[2] + this.velocity[2] * dt + pz;
    let y = this.position[1] + this.velocity[1] * dt;

    if (this.returning) {
      const r = ease(4.5, dt);
      x += (this.home.position[0] - x) * r;
      y += (this.home.position[1] - y) * r;
      z += (this.home.position[2] - z) * r;
      const far = Math.hypot(this.home.position[0] - x, this.home.position[1] - y, this.home.position[2] - z);
      if (far < 0.002 && Math.abs(this.yawGoal - this.yaw) < 1e-4) {
        x = this.home.position[0];
        y = this.home.position[1];
        z = this.home.position[2];
        this.returning = false;
      }
    }
    if (this.opts.clamp) [x, z] = this.opts.clamp(x, z);
    const ground = this.opts.ground;
    if (ground) {
      this.lift = Math.max(0, this.lift + this.velocity[1] * dt);
      const g = ground(x, z);
      if (g !== null) y = g + this.opts.eyeHeight + this.lift;
    }
    this.position = [x, y, z];

    const l = ease(16, dt);
    this.yaw += (this.yawGoal - this.yaw) * l;
    this.pitch += (this.pitchGoal - this.pitch) * l;
    this.zoom += (this.zoomGoal - this.zoom) * ease(12, dt);
    if (Math.abs(this.yawGoal - this.yaw) < 1e-6) this.yaw = this.yawGoal;
    if (Math.abs(this.pitchGoal - this.pitch) < 1e-6) this.pitch = this.pitchGoal;
    if (Math.abs(this.zoomGoal - this.zoom) < 1e-6) this.zoom = this.zoomGoal;
    // Keep the angles bounded without visible jumps.
    if (Math.abs(this.yaw) > TAU * 4) {
      const wrap = Math.round(this.yaw / TAU) * TAU;
      this.yaw -= wrap;
      this.yawGoal -= wrap;
    }

    const moved =
      Math.abs(before[0] - x) + Math.abs(before[1] - y) + Math.abs(before[2] - z) > 1e-6 ||
      Math.abs(this.yawGoal - this.yaw) > 1e-6 ||
      Math.abs(this.pitchGoal - this.pitch) > 1e-6 ||
      Math.abs(this.zoomGoal - this.zoom) > 1e-6;
    const changed = moved || this.dirty;
    this.dirty = false;
    return changed;
  }
}

/* ------------------------------------------------------------------- orbit */

export interface OrbitState {
  target: Vec3;
  distance: number;
  /** Azimuth the camera looks towards. */
  yaw: number;
  /** Angle below the horizontal at which the camera looks down on the target. */
  pitch: number;
}

export interface OrbitOptions {
  minDistance?: number;
  maxDistance?: number;
  minPitch?: number;
  maxPitch?: number;
  /** Keeps the target on the ground. */
  ground?: ((x: number, z: number) => number | null) | null;
  clamp?: ((x: number, z: number) => [number, number]) | null;
}

export class OrbitControls {
  state: OrbitState;
  enabled = true;
  /** Viewport height in CSS pixels and vertical field of view; set by the viewer for panning. */
  viewportHeight = 600;
  fovY = 0.8;

  private goal: OrbitState;
  private readonly keys = new Set<string>();
  private readonly touches = new Map<number, TouchPoint>();
  private drag: { id: number; x: number; y: number; pan: boolean } | null = null;
  private pinch: { mid: TouchPoint; dist: number } | null = null;
  private dirty = true;
  private readonly opts: Required<Omit<OrbitOptions, 'ground' | 'clamp'>> & Pick<OrbitOptions, 'ground' | 'clamp'>;

  constructor(
    private readonly el: HTMLElement,
    initial: OrbitState,
    options: OrbitOptions = {},
  ) {
    this.opts = {
      minDistance: options.minDistance ?? 50,
      maxDistance: options.maxDistance ?? 50_000,
      minPitch: options.minPitch ?? 0.06,
      maxPitch: options.maxPitch ?? 1.52,
      ground: options.ground ?? null,
      clamp: options.clamp ?? null,
    };
    this.state = { ...initial, target: [...initial.target] };
    this.goal = { ...initial, target: [...initial.target] };
  }

  set(next: OrbitState, jump = false): void {
    this.goal = { ...next, target: [...next.target] };
    if (jump) this.state = { ...next, target: [...next.target] };
    this.dirty = true;
  }

  get target(): OrbitState {
    return this.goal;
  }

  touch(): void {
    this.dirty = true;
  }

  get forward(): Vec3 {
    return forwardVector(this.state.yaw, -this.state.pitch);
  }

  eye(): Vec3 {
    const f = this.forward;
    const s = this.state;
    return [s.target[0] - f[0] * s.distance, s.target[1] - f[1] * s.distance, s.target[2] - f[2] * s.distance];
  }

  private rotate(dx: number, dy: number): void {
    this.goal.yaw -= dx * 0.0052;
    this.goal.pitch = Math.max(this.opts.minPitch, Math.min(this.opts.maxPitch, this.goal.pitch + dy * 0.004));
    this.dirty = true;
  }

  private pan(dx: number, dy: number): void {
    const g = this.goal;
    const scale = (2 * g.distance * Math.tan(this.fovY / 2)) / Math.max(1, this.viewportHeight);
    const s = Math.sin(g.yaw);
    const c = Math.cos(g.yaw);
    const along = (dy * scale) / Math.max(0.35, Math.sin(g.pitch));
    let x = g.target[0] - c * dx * scale + s * along;
    let z = g.target[2] - s * dx * scale - c * along;
    if (this.opts.clamp) [x, z] = this.opts.clamp(x, z);
    g.target = [x, g.target[1], z];
    this.dirty = true;
  }

  private zoomBy(factor: number): void {
    const g = this.goal;
    g.distance = Math.max(this.opts.minDistance, Math.min(this.opts.maxDistance, g.distance * factor));
    this.dirty = true;
  }

  private twoFinger(): { mid: TouchPoint; dist: number } | null {
    const [a, b] = [...this.touches.values()];
    if (!a || !b) return null;
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if ((e.target as HTMLElement | null)?.closest('button, a, input, [data-hud-control]')) return;
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.el.setPointerCapture(e.pointerId);
      this.pinch = this.touches.size === 2 ? this.twoFinger() : null;
      return;
    }
    if (e.button !== 0 && e.button !== 2 && e.button !== 1) return;
    this.el.focus({ preventScroll: true });
    this.el.setPointerCapture(e.pointerId);
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey };
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if (e.pointerType === 'touch') {
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      const dx = e.clientX - t.x;
      const dy = e.clientY - t.y;
      t.x = e.clientX;
      t.y = e.clientY;
      if (this.touches.size === 1) this.rotate(dx, dy);
      else if (this.touches.size === 2) {
        const next = this.twoFinger();
        if (next && this.pinch) {
          this.pan(next.mid.x - this.pinch.mid.x, next.mid.y - this.pinch.mid.y);
          if (this.pinch.dist > 10 && next.dist > 10) this.zoomBy(this.pinch.dist / next.dist);
        }
        this.pinch = next;
      }
      return;
    }
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    if (d.pan) this.pan(dx, dy);
    else this.rotate(dx, dy);
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      this.pinch = this.touches.size === 2 ? this.twoFinger() : null;
      return;
    }
    if (this.drag?.id === e.pointerId) this.drag = null;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    e.preventDefault();
    const delta = e.deltaY * (e.deltaMode === 1 ? 33 : 1);
    this.zoomBy(Math.exp(delta * 0.0013));
  };

  private readonly onContextMenu = (e: Event): void => {
    if (this.enabled) e.preventDefault();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled || !ownsKey(this.el, e)) return;
    if (e.key === '+' || e.key === '=') this.zoomBy(0.8);
    else if (e.key === '-') this.zoomBy(1.25);
    else if (MOVE_KEYS.has(e.code)) this.keys.add(e.code);
    else return;
    e.preventDefault();
    this.dirty = true;
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.drag = null;
    this.touches.clear();
    this.pinch = null;
  };

  attach(): () => void {
    const el = this.el;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContextMenu);
    el.addEventListener('keydown', this.onKeyDown);
    el.addEventListener('keyup', this.onKeyUp);
    el.addEventListener('focusout', this.onBlur);
    window.addEventListener('blur', this.onBlur);
    return () => {
      el.removeEventListener('pointerdown', this.onPointerDown);
      el.removeEventListener('pointermove', this.onPointerMove);
      el.removeEventListener('pointerup', this.onPointerUp);
      el.removeEventListener('pointercancel', this.onPointerUp);
      el.removeEventListener('wheel', this.onWheel);
      el.removeEventListener('contextmenu', this.onContextMenu);
      el.removeEventListener('keydown', this.onKeyDown);
      el.removeEventListener('keyup', this.onKeyUp);
      el.removeEventListener('focusout', this.onBlur);
      window.removeEventListener('blur', this.onBlur);
    };
  }

  update(dt: number): boolean {
    const k = this.keys;
    if (this.enabled && k.size > 0) {
      const turn = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0);
      const tilt = (k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0);
      if (turn || tilt) this.rotate(-turn * 260 * dt, tilt * 200 * dt);
      const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
      const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
      const run = k.has('ShiftLeft') || k.has('ShiftRight') ? 3 : 1;
      if (f || s) this.pan(-s * 420 * dt * run, f * 420 * dt * run * Math.max(0.35, Math.sin(this.goal.pitch)));
      const z = (k.has('KeyE') || k.has('PageDown') ? 1 : 0) - (k.has('KeyQ') || k.has('PageUp') ? 1 : 0);
      if (z) this.zoomBy(Math.exp(z * 1.6 * dt));
    }
    const g = this.goal;
    if (this.opts.ground) {
      const h = this.opts.ground(g.target[0], g.target[2]);
      if (h !== null) g.target[1] = h;
    }
    const s = this.state;
    const a = ease(10, dt);
    const before = s.target[0] + s.target[1] + s.target[2] + s.distance + s.yaw + s.pitch;
    s.target = [
      s.target[0] + (g.target[0] - s.target[0]) * a,
      s.target[1] + (g.target[1] - s.target[1]) * a,
      s.target[2] + (g.target[2] - s.target[2]) * a,
    ];
    s.distance *= Math.exp(Math.log(g.distance / s.distance) * a);
    s.yaw += (g.yaw - s.yaw) * a;
    s.pitch += (g.pitch - s.pitch) * a;
    const after = s.target[0] + s.target[1] + s.target[2] + s.distance + s.yaw + s.pitch;
    const changed = Math.abs(after - before) > 1e-7 || this.dirty;
    this.dirty = false;
    return changed;
  }
}
