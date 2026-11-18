import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseMovieHeader, readMp4Info } from '../src/media/mp4.ts';

function box(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}

function movieHeader(timescale: number, duration: number): Buffer {
  const b = Buffer.alloc(100);
  b.writeUInt32BE(timescale, 12);
  b.writeUInt32BE(duration, 16);
  return box('mvhd', b);
}

function movieHeader64(timescale: number, duration: bigint): Buffer {
  const b = Buffer.alloc(112);
  b.writeUInt8(1, 0);
  b.writeUInt32BE(timescale, 20);
  b.writeBigUInt64BE(duration, 24);
  return box('mvhd', b);
}

function track(handler: string): Buffer {
  const hdlr = Buffer.alloc(24);
  hdlr.write(handler, 8, 'latin1');
  return box('trak', box('tkhd', Buffer.alloc(84)), box('mdia', box('mdhd', Buffer.alloc(24)), box('hdlr', hdlr)));
}

test('duration and video track are read from a movie header', () => {
  const info = parseMovieHeader(Buffer.concat([movieHeader(1000, 14_000), track('soun'), track('vide')]));
  assert.deepEqual(info, { durationSec: 14, hasVideo: true });
});

test('a 64-bit movie header is understood', () => {
  const info = parseMovieHeader(Buffer.concat([movieHeader64(90_000, 90_000n * 7200n), track('vide')]));
  assert.deepEqual(info, { durationSec: 7200, hasVideo: true });
});

test('a file with sound only has no video track', () => {
  assert.deepEqual(parseMovieHeader(Buffer.concat([movieHeader(600, 1200), track('soun')])), { durationSec: 2, hasVideo: false });
});

test('an unknown or missing duration is left open, so that ffmpeg is asked', () => {
  assert.equal(parseMovieHeader(Buffer.concat([movieHeader(1000, 0), track('vide')]))?.durationSec, null);
  assert.equal(parseMovieHeader(Buffer.concat([movieHeader(1000, 0xffffffff), track('vide')]))?.durationSec, null);
  assert.equal(parseMovieHeader(track('vide')), null);
});

test('the header is found before and after the media data, and other files are declined', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sicht-mp4-'));
  try {
    const moov = box('moov', movieHeader(1000, 5500), track('vide'));
    const ftyp = box('ftyp', Buffer.from('isom\0\0\0\0isomiso2', 'latin1'));
    const mdat = box('mdat', Buffer.alloc(4096, 7));
    const front = path.join(dir, 'front.mp4');
    const back = path.join(dir, 'back.mp4');
    const other = path.join(dir, 'other.webm');
    const cut = path.join(dir, 'cut.mp4');
    await fs.writeFile(front, Buffer.concat([ftyp, moov, mdat]));
    await fs.writeFile(back, Buffer.concat([ftyp, box('free', Buffer.alloc(8)), mdat, moov]));
    await fs.writeFile(other, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81]));
    await fs.writeFile(cut, Buffer.concat([ftyp, mdat, moov]).subarray(0, ftyp.length + mdat.length + 20));
    assert.deepEqual(await readMp4Info(front), { durationSec: 5.5, hasVideo: true });
    assert.deepEqual(await readMp4Info(back), { durationSec: 5.5, hasVideo: true });
    assert.equal(await readMp4Info(other), null);
    assert.equal(await readMp4Info(cut), null);
    assert.equal(await readMp4Info(path.join(dir, 'missing.mp4')), null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
