import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { config, repoRoot } from '../src/config.js';
import { SPACE_GRID_MAGIC } from '../src/datum/contract.js';
import { buildSpaceGrid, encodeSpaceGrid, parseSpaceGrid, EYE_HEIGHT_M } from '../src/datum/space.js';

const DEG = Math.PI / 180;
const tmp = mkdtempSync(path.join(os.tmpdir(), 'datum-space-'));

test('DSG1 encoding round-trips', () => {
  const distance = Float32Array.from([1, 2.5, 3, 2000, 7.25, 0.5]);
  const sky = Uint8Array.from([0, 0, 0, 1, 0, 0]);
  const buf = encodeSpaceGrid({ width: 3, height: 2, fovDeg: 62, near: 0.5, far: 2000, distance, sky });
  assert.equal(buf.toString('ascii', 0, 4), SPACE_GRID_MAGIC);
  assert.equal(buf.length, 24 + 6 * 5);
  assert.equal(buf.readUInt32LE(4), 3);
  assert.equal(buf.readUInt32LE(8), 2);
  const back = parseSpaceGrid(buf);
  assert.equal(back.width, 3);
  assert.equal(back.height, 2);
  assert.ok(Math.abs(back.fovDeg - 62) < 1e-6);
  assert.deepEqual(Array.from(back.distance), Array.from(distance));
  assert.deepEqual(Array.from(back.sky), Array.from(sky));
  assert.throws(() => parseSpaceGrid(Buffer.from('XXXX')));
  assert.throws(() => parseSpaceGrid(buf.subarray(0, buf.length - 1)));
});

/**
 * A synthetic outdoor frame seen by a level camera 1.6 m above flat ground: blue sky above a
 * band of distant buildings, green ground below the horizon, and a box 8 m ahead. The disparity
 * is the true inverse depth under an arbitrary affine map (as a network would give it).
 */
async function syntheticOutdoor(): Promise<{ jpeg: string; disparity: { width: number; height: number; data: Float32Array }; truth: (u: number, v: number) => number; horizonRow: number; skyRows: number; fovDeg: number }> {
  const w = 518;
  const h = 294;
  const fovDeg = 62;
  const f = w / 2 / Math.tan((fovDeg * DEG) / 2);
  const cy = h / 2;
  const skyRows = Math.round(h * 0.4);
  const rgb = Buffer.alloc(w * h * 3);
  const data = new Float32Array(w * h);
  const inverse = new Float64Array(w * h); // true 1/Z
  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      const i = v * w + u;
      const y = (v + 0.5 - cy) / f;
      const x = (u + 0.5 - w / 2) / f;
      let invZ: number;
      let colour: [number, number, number];
      if (v < skyRows) {
        invZ = 0;
        colour = [110 + (v % 3), 160, 230];
      } else if (y <= 0.012) {
        invZ = 1 / 300; // distant buildings at the horizon
        colour = [120, 118, 115];
      } else {
        invZ = y / EYE_HEIGHT_M; // ground plane
        colour = [80 + ((u * 7 + v * 3) % 30), 140, 60];
        // A box 8 m ahead, 2 m wide, 2.5 m high (its front face).
        const zBox = 8;
        const top = -(2.5 - EYE_HEIGHT_M) / zBox;
        if (Math.abs(x) * zBox < 1 && y < EYE_HEIGHT_M / zBox && y > top) {
          invZ = 1 / zBox;
          colour = [200, 60, 50];
        }
      }
      if (v >= skyRows && y <= 0.012) {
        // Box also covers the building band where it rises above the horizon.
        const zBox = 8;
        const top = -(2.5 - EYE_HEIGHT_M) / zBox;
        if (Math.abs(x) * zBox < 1 && y > top) {
          invZ = 1 / zBox;
          colour = [200, 60, 50];
        }
      }
      inverse[i] = invZ;
      data[i] = 37 * invZ + (invZ === 0 ? 0 : 0.02);
      rgb[i * 3] = colour[0];
      rgb[i * 3 + 1] = colour[1];
      rgb[i * 3 + 2] = colour[2];
    }
  }
  const jpeg = path.join(tmp, 'outdoor.jpg');
  await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toFile(jpeg);
  const truth = (u: number, v: number): number => {
    const inv = inverse[v * w + u] as number;
    const x = (u + 0.5 - w / 2) / f;
    const y = (v + 0.5 - cy) / f;
    return inv > 0 ? Math.sqrt(1 + x * x + y * y) / inv : Infinity;
  };
  return { jpeg, disparity: { width: w, height: h, data }, truth, horizonRow: cy, skyRows, fovDeg };
}

test('synthetic outdoor frame: sky, skyline, level pitch and metric ground', async () => {
  const scene = await syntheticOutdoor();
  const result = await buildSpaceGrid(scene.jpeg, scene.disparity, { fovDeg: scene.fovDeg, columns: 192 });
  const grid = parseSpaceGrid(result.buffer);
  assert.equal(grid.width, 192);
  assert.equal(grid.height, Math.round((192 * 294) / 518));
  assert.ok(Math.abs(grid.fovDeg - 62) < 1e-6);

  const expectedSky = scene.skyRows / scene.disparity.height;
  assert.ok(Math.abs(result.skyFraction - expectedSky) < 0.03, `sky ${result.skyFraction} vs ${expectedSky}`);
  assert.ok(result.skyline, 'skyline');
  assert.equal(result.skyline.length, 192);
  for (const y of result.skyline) assert.ok(Math.abs(y - expectedSky) < 0.03, `skyline ${y}`);

  assert.ok(Math.abs(result.pitchDeg) < 2, `pitch ${result.pitchDeg}`);

  // Sky cells carry the far distance.
  let skyCells = 0;
  for (let i = 0; i < grid.sky.length; i++) {
    if (grid.sky[i]) {
      skyCells++;
      assert.ok((grid.distance[i] as number) >= grid.far);
    } else {
      assert.ok((grid.distance[i] as number) < grid.far && (grid.distance[i] as number) >= 0.5);
    }
  }
  assert.ok(Math.abs(skyCells / grid.sky.length - expectedSky) < 0.03);

  // Ground distances in the lower rows within 20 % of the truth; the ground is level at -1.6 m.
  const w = scene.disparity.width;
  const h = scene.disparity.height;
  const f = grid.width / 2 / Math.tan((grid.fovDeg * DEG) / 2);
  let checked = 0;
  for (let r = Math.floor(grid.height * 0.75); r < grid.height; r += 3) {
    for (const c of [10, 40, 150, 180]) {
      const u = Math.floor(((c + 0.5) * w) / grid.width);
      const v = Math.floor(((r + 0.5) * h) / grid.height);
      const truth = scene.truth(u, v);
      const got = grid.distance[r * grid.width + c] as number;
      assert.ok(Math.abs(got - truth) / truth < 0.2, `row ${r} col ${c}: ${got.toFixed(2)} m vs ${truth.toFixed(2)} m`);
      const x = (c + 0.5 - grid.width / 2) / f;
      const y = (r + 0.5 - grid.height / 2) / f;
      const height = -(y / Math.hypot(x, y, 1)) * got;
      assert.ok(Math.abs(height + EYE_HEIGHT_M) < 0.35, `ground height ${height.toFixed(2)} m`);
      checked++;
    }
  }
  assert.ok(checked >= 16);

  // The box stands upright about 8 m ahead.
  const boxRow = Math.round(grid.height * 0.55);
  const boxDistance = grid.distance[boxRow * grid.width + grid.width / 2] as number;
  assert.ok(boxDistance > 6 && boxDistance < 10.5, `box at ${boxDistance.toFixed(2)} m`);
});

test('a frame without sky has no skyline', async () => {
  const w = 280;
  const h = 154;
  const rgb = Buffer.alloc(w * h * 3, 200);
  const data = new Float32Array(w * h);
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) data[v * w + u] = 0.6 + (2.4 * v) / h + 0.3 * Math.sin(u / 20);
  const jpeg = path.join(tmp, 'indoor.jpg');
  await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).jpeg().toFile(jpeg);
  const result = await buildSpaceGrid(jpeg, { width: w, height: h, data }, { columns: 96 });
  assert.equal(result.skyline, null);
  assert.equal(result.skyFraction, 0);
  const grid = parseSpaceGrid(result.buffer);
  assert.ok(grid.sky.every((s) => s === 0));
  assert.ok(grid.distance.every((d) => d >= 0.5 && d < grid.far && d <= 2000));
  assert.ok(grid.far <= 60, `indoor far plane ${grid.far}`);
});

const depthModelFile = path.join(config.modelCacheDir, 'onnx-community', 'depth-anything-v2-small', 'onnx', 'model.onnx');
const clip = path.join(repoRoot, 'dataset', 'man-on-horseback-trying-to-catch-free-wild-horses-on.mp4');
const realSkip = !existsSync(depthModelFile) || !existsSync(clip) ? 'depth model or test clip not available' : false;

test('real frame: Depth Anything V2 → grid (landscape with mountains)', { skip: realSkip }, async () => {
  const jpeg = path.join(tmp, 'horses.jpg');
  try {
    execFileSync(config.ffmpegPath, ['-loglevel', 'error', '-y', '-ss', '3', '-i', clip, '-frames:v', '1', '-vf', 'scale=640:-2', jpeg]);
  } catch {
    return; // no ffmpeg on this machine
  }
  const { estimateDisparity } = await import('../src/datum/depth.js');
  const disparity = await estimateDisparity(jpeg);
  assert.equal(disparity.width, 518);
  assert.equal(disparity.height, 294);
  assert.ok(disparity.ms < 10_000);
  const result = await buildSpaceGrid(jpeg, disparity);
  // Sky above the mountain range only (about a tenth of the frame), not the hazy mountains.
  assert.ok(result.skyFraction > 0.04 && result.skyFraction < 0.2, `sky ${result.skyFraction}`);
  assert.ok(result.skyline);
  const mean = result.skyline.reduce((s, y) => s + y, 0) / result.skyline.length;
  assert.ok(mean > 0.04 && mean < 0.2, `skyline ${mean}`);
  // The meadow comes out level at eye height below the camera.
  const grid = parseSpaceGrid(result.buffer);
  const f = grid.width / 2 / Math.tan((grid.fovDeg * DEG) / 2);
  const th = result.pitchDeg * DEG;
  const heights: number[] = [];
  for (let r = Math.floor(grid.height * 0.85); r < grid.height; r++) {
    for (let c = 0; c < grid.width; c += 4) {
      const d = grid.distance[r * grid.width + c] as number;
      const x = (c + 0.5 - grid.width / 2) / f;
      const y = (r + 0.5 - grid.height / 2) / f;
      const n = Math.hypot(x, y, 1);
      heights.push(-((y / n) * d * Math.cos(th) - (d / n) * Math.sin(th)));
    }
  }
  heights.sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] as number;
  assert.ok(Math.abs(median + EYE_HEIGHT_M) < 0.3, `ground at ${median.toFixed(2)} m`);
});
