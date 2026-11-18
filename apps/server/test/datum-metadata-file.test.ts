import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readMetadata } from '../src/datum/metadata.js';

/**
 * The path that decides most real cases: a phone video carries its position and recording time
 * in the file. A short clip is written with ffmpeg and tagged the way phones and cameras tag
 * (ISO 6709 location, creation time), then read back.
 */
function ffmpegAvailable(): boolean {
  return spawnSync(process.env['FFMPEG_PATH'] ?? 'ffmpeg', ['-version']).status === 0;
}

test('GPS and recording time are read from the tags of a real file', { skip: !ffmpegAvailable() }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-meta-'));
  const file = path.join(dir, 'telefon.mp4');
  try {
    const run = spawnSync(process.env['FFMPEG_PATH'] ?? 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-metadata', 'location=+50.3644+007.6058+065.000/',
      '-metadata', 'creation_time=2024-06-21T14:30:15Z',
      '-movflags', '+use_metadata_tags',
      file,
    ]);
    assert.equal(run.status, 0, run.stderr.toString());
    const meta = await readMetadata(file);
    assert.ok(meta.location, JSON.stringify(meta.raw));
    assert.ok(Math.abs(meta.location.lat - 50.3644) < 1e-4 && Math.abs(meta.location.lon - 7.6058) < 1e-4, JSON.stringify(meta.location));
    assert.equal(meta.altitude, 65);
    assert.equal(meta.creationUtc, Date.parse('2024-06-21T14:30:15Z'));
    assert.equal(meta.width, 320);
    assert.equal(meta.height, 180);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a file without tags yields neither place nor time', { skip: !ffmpegAvailable() }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-meta-'));
  const file = path.join(dir, 'ohne.mp4');
  try {
    const run = spawnSync(process.env['FFMPEG_PATH'] ?? 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-map_metadata', '-1', '-fflags', '+bitexact',
      file,
    ]);
    assert.equal(run.status, 0, run.stderr.toString());
    const meta = await readMetadata(file);
    assert.equal(meta.location, null);
    assert.equal(meta.creationUtc, null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
