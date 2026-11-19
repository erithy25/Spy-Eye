import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { metadataFromProbe, readMetadata, tagValues } from '../src/datum/metadata.js';

/**
 * The path that decides most real cases: a phone video carries its position and recording time
 * in the file. A short clip is written with ffmpeg and tagged the way phones and cameras tag
 * (ISO 6709 location, creation time), then read back.
 */
function ffmpegAvailable(): boolean {
  return spawnSync(process.env['FFMPEG_PATH'] ?? 'ffmpeg', ['-version']).status === 0;
}

/** First line of `ffmpeg -version`, for failure messages. */
function ffmpegVersion(): string {
  return String(spawnSync(process.env['FFMPEG_PATH'] ?? 'ffmpeg', ['-version']).stdout ?? '').split('\n')[0] ?? '';
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
    // The tags as ffprobe reported them go into the message: ffmpeg versions differ in where they
    // write a creation time, and a failure on another machine has to say which one it was.
    assert.equal(meta.creationUtc, Date.parse('2024-06-21T14:30:15Z'), JSON.stringify({ raw: meta.raw, rejected: meta.creationRejected ?? null, ffmpeg: ffmpegVersion() }));
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

test('ffprobe 9 joins a key that occurs twice with ";": every part is read', () => {
  // The tags ffprobe 9.0.2 (Windows, gyan.dev build) reported for the file of the test above: the
  // movie header's creation_time and the same key among the metadata items, joined into one value.
  const meta = metadataFromProbe(
    {
      format: {
        duration: '1',
        tags: {
          major_brand: 'isom',
          'location-eng': '+50.3644+007.6058+65.000000/',
          creation_time: '2024-06-21T14:30:15.000000Z;2024-06-21T14:30:15Z',
          encoder: 'Lavf63.1.102',
          location: '+50.3644+007.6058+65.000000/',
        },
      },
      streams: [{ codec_type: 'video', avg_frame_rate: '10/1', width: 320, height: 180 }],
    },
    Date.UTC(2026, 10, 18),
    Date.UTC(2026, 10, 18),
  );
  assert.equal(meta.creationUtc, Date.parse('2024-06-21T14:30:15Z'));
  assert.deepEqual(meta.location, { lat: 50.3644, lon: 7.6058 });
  assert.equal(meta.altitude, 65);

  // A first part that is no time (an encoder default) does not hide a good second one.
  const second = metadataFromProbe({ format: { tags: { creation_time: '1904-01-01T00:00:00.000000Z;2019-07-04T10:00:00Z' } } }, null, Date.UTC(2026, 0, 1));
  assert.equal(second.creationUtc, Date.parse('2019-07-04T10:00:00Z'));
  // Joined device names: the first one counts.
  const device = metadataFromProbe({ format: { tags: { 'com.apple.quicktime.make': 'Apple;Apple', 'com.apple.quicktime.model': 'iPhone 15;iPhone 15' } } }, null);
  assert.equal(device.device, 'Apple iPhone 15');

  assert.deepEqual(tagValues('a; b;;c '), ['a', 'b', 'c']);
  assert.deepEqual(tagValues(undefined), []);
  assert.deepEqual(tagValues(''), []);
});
