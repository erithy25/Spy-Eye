import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { Pipeline } from '../pipeline.js';
import { frameUrl, type Store } from '../store.js';
import type { FeedState, SourceInfo } from '../types.js';
import type { Sources } from './sources.js';

/**
 * Connected streams ("Direktbild").
 *
 * A stream is not analysed frame by frame as it arrives. ffmpeg cuts it into short segments;
 * every finished segment is filed as a recording of its source and takes the same path as an
 * uploaded file: masking, embedding, index, watches. Alerts therefore trail the camera by one
 * segment plus the analysis time, in exchange for one code path, deletion rules and evidence
 * handling that are identical for live and recorded footage.
 */

export interface LiveDeps {
  store: Store;
  sources: Sources;
  pipeline: Pipeline;
  /** Directory in which segments are written before they are filed. */
  spoolDir: string;
  /** Stream address per source id; kept out of the source record that the console can read. */
  addressOf: (sourceId: string) => string | null;
  activeAlerts: (sourceId: string) => number;
  onChange: () => void;
  log: (message: string) => void;
}

interface Stream {
  sourceId: string;
  child: ChildProcess | null;
  /** connecting: ffmpeg started, no segment yet · online: segments arrive · offline: waiting to retry. */
  state: 'connecting' | 'online' | 'offline';
  lastSegmentAt: number;
  lastError: string;
  retryTimer: NodeJS.Timeout | null;
  retryDelayMs: number;
  stopped: boolean;
  /** Recordings filed from this stream, newest last. */
  recordings: string[];
}

const SEGMENT_SEC = Math.min(120, Math.max(5, Number(process.env['SICHT_LIVE_SEGMENT_SEC'] ?? '20') || 20));
const SCAN_MS = 2000;
const ALLOWED_PROTOCOLS = ['rtsp:', 'rtsps:', 'http:', 'https:', 'rtmp:', 'rtmps:', 'srt:', 'udp:', 'tcp:'];

/** Accepts stream addresses only; local files and device names are not streams. */
export function parseStreamAddress(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    return ALLOWED_PROTOCOLS.includes(url.protocol) && url.hostname !== '' ? url : null;
  } catch {
    return null;
  }
}

/** The address without credentials, for display and for the ledger. */
export function redactStreamAddress(raw: string): string {
  const url = parseStreamAddress(raw);
  if (!url) return '';
  url.username = '';
  url.password = '';
  url.search = '';
  return url.toString();
}

/** `20261118T142233.mp4` -> epoch ms (local time, as ffmpeg's strftime writes it). */
function segmentTime(file: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.mp4$/.exec(file);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const time = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)).getTime();
  return Number.isFinite(time) ? time : null;
}

export class LiveIngest {
  private readonly streams = new Map<string, Stream>();
  private scanTimer: NodeJS.Timeout | null = null;
  private scanning = false;

  constructor(private readonly deps: LiveDeps) {}

  /** Starts a stream for every live source that has an address. */
  async open(): Promise<void> {
    await fs.mkdir(this.deps.spoolDir, { recursive: true });
    for (const source of this.deps.sources.list()) {
      if (source.mode === 'live') this.start(source.id);
    }
    this.scanTimer = setInterval(() => void this.scan(), SCAN_MS);
    this.scanTimer.unref();
  }

  private dirOf(sourceId: string): string {
    return path.join(this.deps.spoolDir, sourceId.replace(/[^a-zA-Z0-9_-]/g, '_'));
  }

  start(sourceId: string): void {
    if (this.streams.has(sourceId)) return;
    const stream: Stream = {
      sourceId,
      child: null,
      state: 'offline',
      lastSegmentAt: 0,
      lastError: '',
      retryTimer: null,
      retryDelayMs: 3000,
      stopped: false,
      recordings: [],
    };
    // Recordings of this source from earlier runs still provide its last picture.
    for (const entry of this.deps.store.all()) {
      if (entry.info.sourceId === sourceId && entry.info.scenario === null) stream.recordings.push(entry.info.id);
    }
    this.streams.set(sourceId, stream);
    void this.connect(stream);
  }

  async stop(sourceId: string): Promise<void> {
    const stream = this.streams.get(sourceId);
    if (!stream) return;
    stream.stopped = true;
    if (stream.retryTimer) clearTimeout(stream.retryTimer);
    stream.child?.kill('SIGTERM');
    this.streams.delete(sourceId);
    await fs.rm(this.dirOf(sourceId), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    this.deps.onChange();
  }

  shutdown(): void {
    if (this.scanTimer) clearInterval(this.scanTimer);
    for (const stream of this.streams.values()) {
      stream.stopped = true;
      if (stream.retryTimer) clearTimeout(stream.retryTimer);
      stream.child?.kill('SIGTERM');
    }
  }

  private async connect(stream: Stream): Promise<void> {
    if (stream.stopped) return;
    const address = this.deps.addressOf(stream.sourceId);
    const url = address ? parseStreamAddress(address) : null;
    if (!url) {
      stream.state = 'offline';
      stream.lastError = 'Keine gültige Adresse hinterlegt.';
      return;
    }
    const dir = this.dirOf(stream.sourceId);
    await fs.mkdir(dir, { recursive: true });
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      ...(url.protocol.startsWith('rtsp') ? ['-rtsp_transport', 'tcp'] : []),
      '-i', url.toString(),
      '-an',
      // Re-encoding gives regular key frames and a bounded size whatever the camera sends.
      '-vf', `fps=5,scale=-2:'min(720,ih)'`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-g', '25', '-pix_fmt', 'yuv420p',
      '-f', 'segment', '-segment_time', String(SEGMENT_SEC), '-segment_format', 'mp4', '-reset_timestamps', '1',
      '-strftime', '1', path.join(dir, '%Y%m%dT%H%M%S.mp4'),
    ];
    stream.state = 'connecting';
    stream.lastError = '';
    this.deps.onChange();
    let stderr = '';
    const child = spawn(config.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    stream.child = child;
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-600);
    });
    child.on('error', (err) => {
      stream.lastError = err.message;
    });
    child.on('exit', (code) => {
      stream.child = null;
      if (stream.stopped) return;
      stream.state = 'offline';
      stream.lastError = stderr.trim().split('\n').pop() ?? (code === 0 ? 'Der Strom ist zu Ende.' : `ffmpeg endete mit Code ${code ?? '?'}`);
      this.deps.log(`Stream of "${this.deps.sources.get(stream.sourceId)?.name ?? stream.sourceId}" ended: ${stream.lastError}`);
      this.deps.onChange();
      // A segment that was being written when the stream ended is complete now.
      void this.scan();
      stream.retryTimer = setTimeout(() => void this.connect(stream), stream.retryDelayMs);
      stream.retryTimer.unref();
      stream.retryDelayMs = Math.min(60_000, stream.retryDelayMs * 2);
    });
  }

  /** Files every finished segment as a recording of its source. */
  private async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      for (const stream of this.streams.values()) {
        const dir = this.dirOf(stream.sourceId);
        let files: string[];
        try {
          files = (await fs.readdir(dir)).filter((f) => segmentTime(f) !== null).sort();
        } catch {
          continue;
        }
        // While ffmpeg runs, the newest file is still being written.
        const finished = stream.child ? files.slice(0, -1) : files;
        if (stream.child && files.length > 0 && stream.state === 'connecting') {
          stream.state = 'online';
          stream.retryDelayMs = 3000;
          this.deps.onChange();
        }
        for (const file of finished) {
          const from = path.join(dir, file);
          try {
            const { size } = await fs.stat(from);
            if (size < 2000) {
              await fs.rm(from, { force: true });
              continue;
            }
            const source = this.deps.sources.get(stream.sourceId);
            const id = await this.deps.store.allocate();
            const target = path.join(this.deps.store.videoDir(id), 'source.mp4');
            await fs.copyFile(from, target);
            await fs.rm(from, { force: true });
            const capturedAt = segmentTime(file) ?? Date.now();
            const stamp = new Date(capturedAt).toISOString().slice(11, 19);
            const entry = this.deps.store.register({
              id,
              name: `${source?.name ?? stream.sourceId} ${stamp}`,
              sourceFile: 'source.mp4',
              sizeBytes: size,
              sampleFps: 1,
              detail: 'standard',
              sourceId: stream.sourceId,
              capturedAt,
            });
            await this.deps.store.persistMeta(entry);
            this.deps.pipeline.enqueue(id);
            stream.recordings.push(id);
            if (stream.recordings.length > 400) stream.recordings.splice(0, stream.recordings.length - 400);
            stream.lastSegmentAt = Date.now();
          } catch (err: unknown) {
            this.deps.log(`Could not file segment ${file}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    } finally {
      this.scanning = false;
    }
  }

  stateOf(sourceId: string): { state: Stream['state']; lastError: string; lastSegmentAt: number } | null {
    const stream = this.streams.get(sourceId);
    return stream ? { state: stream.state, lastError: stream.lastError, lastSegmentAt: stream.lastSegmentAt } : null;
  }

  /** Latest analysed picture of every connected stream. */
  feeds(): FeedState[] {
    const feeds: FeedState[] = [];
    for (const stream of this.streams.values()) {
      const source: SourceInfo | undefined = this.deps.sources.get(stream.sourceId);
      if (!source) continue;
      let feed: FeedState = {
        sourceId: stream.sourceId,
        online: stream.state === 'online',
        videoId: null,
        frameNumber: null,
        frameUrl: null,
        at: null,
        label: stream.state === 'offline' ? stream.lastError : '',
        activeAlerts: this.deps.activeAlerts(stream.sourceId),
      };
      for (let i = stream.recordings.length - 1; i >= 0; i--) {
        const entry = this.deps.store.get(stream.recordings[i] as string);
        const frame = entry?.frames[entry.frames.length - 1];
        if (!entry || !frame) continue;
        const scene = entry.scenes[frame.s];
        feed = {
          ...feed,
          videoId: entry.info.id,
          frameNumber: frame.n,
          frameUrl: frameUrl(entry.info.id, frame.n),
          at: entry.info.capturedAt + Math.round(frame.t * 1000),
          label: stream.state === 'offline' ? stream.lastError : (scene?.tags[0]?.label ?? ''),
        };
        break;
      }
      feeds.push(feed);
    }
    return feeds;
  }
}
