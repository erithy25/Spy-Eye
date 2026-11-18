import fs from 'node:fs/promises';

/**
 * Duration and video track of an MP4 or QuickTime file, read from its header.
 *
 * Asking ffmpeg for the same costs a process start per file; for the first pass over a large
 * upload that is a third of the work. Anything this reader does not understand (other containers,
 * fragmented files, damaged headers) yields null, and the caller asks ffmpeg instead.
 */
export interface ContainerInfo {
  durationSec: number | null;
  hasVideo: boolean;
}

interface Box {
  type: string;
  body: Buffer;
}

/** A movie header larger than this is not read into memory. */
const MAX_MOVIE_HEADER_BYTES = 64 * 1024 * 1024;

function* boxes(buf: Buffer): Generator<Box> {
  let offset = 0;
  while (offset + 8 <= buf.length) {
    let size = buf.readUInt32BE(offset);
    const type = buf.toString('latin1', offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > buf.length) return;
      size = Number(buf.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = buf.length - offset;
    }
    if (size < header || offset + size > buf.length) return;
    yield { type, body: buf.subarray(offset + header, offset + size) };
    offset += size;
  }
}

/** Reads the movie header box (`moov`) that has already been loaded. */
export function parseMovieHeader(moov: Buffer): ContainerInfo | null {
  let durationSec: number | null = null;
  let hasVideo = false;
  let sawHeader = false;
  for (const box of boxes(moov)) {
    if (box.type === 'mvhd') {
      const b = box.body;
      if (b.length < 20) return null;
      let timescale: number;
      let duration: number;
      if (b.readUInt8(0) === 1) {
        if (b.length < 32) return null;
        timescale = b.readUInt32BE(20);
        duration = Number(b.readBigUInt64BE(24));
      } else {
        timescale = b.readUInt32BE(12);
        duration = b.readUInt32BE(16);
        // All bits set means "unknown" in a version 0 header.
        if (duration === 0xffffffff) duration = 0;
      }
      sawHeader = true;
      if (timescale > 0 && duration > 0) durationSec = duration / timescale;
    } else if (box.type === 'trak') {
      for (const media of boxes(box.body)) {
        if (media.type !== 'mdia') continue;
        for (const handler of boxes(media.body)) {
          // hdlr: version and flags (4), pre-defined (4), handler type (4).
          if (handler.type === 'hdlr' && handler.body.length >= 12 && handler.body.toString('latin1', 8, 12) === 'vide') hasVideo = true;
        }
      }
    }
  }
  return sawHeader ? { durationSec, hasVideo } : null;
}

/** Walks the top-level boxes of a file to its movie header. Null when the file is no such container. */
export async function readMp4Info(file: string): Promise<ContainerInfo | null> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(file, 'r');
  } catch {
    return null;
  }
  try {
    const { size } = await handle.stat();
    const head = Buffer.alloc(16);
    let offset = 0;
    // A sane file has a handful of top-level boxes; the limit guards against nonsense sizes.
    for (let guard = 0; guard < 256 && offset + 8 <= size; guard++) {
      const { bytesRead } = await handle.read(head, 0, 16, offset);
      if (bytesRead < 8) return null;
      let boxSize = head.readUInt32BE(0);
      const type = head.toString('latin1', 4, 8);
      let headerSize = 8;
      if (boxSize === 1) {
        if (bytesRead < 16) return null;
        boxSize = Number(head.readBigUInt64BE(8));
        headerSize = 16;
      } else if (boxSize === 0) {
        boxSize = size - offset;
      }
      if (boxSize < headerSize || !/^[\x20-\x7e]{4}$/.test(type)) return null;
      // The first box of an MP4 or QuickTime file is one of these; anything else is another format.
      if (guard === 0 && !['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'pnot'].includes(type)) return null;
      if (type === 'moov') {
        const length = boxSize - headerSize;
        if (length > MAX_MOVIE_HEADER_BYTES || offset + boxSize > size) return null;
        const body = Buffer.alloc(length);
        const read = await handle.read(body, 0, length, offset + headerSize);
        return read.bytesRead === length ? parseMovieHeader(body) : null;
      }
      offset += boxSize;
    }
    return null;
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}
