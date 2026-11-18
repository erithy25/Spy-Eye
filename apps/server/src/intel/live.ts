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

/**
 * Accepts stream addresses only; local files and device names are not streams. The node connects
 * to a stream, it does not wait for one: an address that would make ffmpeg open a listening port
 * (`?listen`, `mode=listener`) is refused.
 */
export function parseStreamAddress(raw: string): URL | null {
  try {
    const url = new URL(raw.trim());
    if (!ALLOWED_PROTOCOLS.includes(url.protocol) || url.hostname === '') return null;
    const listen = url.searchParams.get('listen');
    if (listen !== null && listen !== '0') return null;
    const mode = (url.searchParams.get('mode') ?? '').toLowerCase();
    if (mode === 'listener' || mode === 'rendezvous') return null;
    return url;
  } catch {
    return null;
  }
}

function ipv4(text: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return null;
  return (((parts[0] ?? 0) << 24) | ((parts[1] ?? 0) << 16) | ((parts[2] ?? 0) << 8) | (parts[3] ?? 0)) >>> 0;
}

/**
 * Whether a stream may come from this host. `allowed` is the operator's list: host names, a
 * leading dot for a domain with its subdomains, single addresses, IPv4 ranges in CIDR form. An
 * empty list allows every host. Names are not resolved here, so a range matches only an address
 * written as numbers; a camera known by name has to be listed by name.
 */
export function streamHostAllowed(hostname: string, allowed: readonly string[]): boolean {
  if (allowed.length === 0) return true;
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  for (const entry of allowed) {
    const rule = entry.trim().toLowerCase();
    if (rule === '') continue;
    if (rule.includes('/')) {
      const [base = '', bitsText = ''] = rule.split('/');
      const bits = Number(bitsText);
      const address = ipv4(host);
      const network = ipv4(base);
      if (address === null || network === null || bitsText === '' || !Number.isInteger(bits) || bits < 0 || bits > 32) continue;
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      if (((address & mask) >>> 0) === ((network & mask) >>> 0)) return true;
    } else if (rule.startsWith('.')) {
      if (host === rule.slice(1) || host.endsWith(rule)) return true;
    } else if (host === rule) {
      return true;
    }
  }
  return false;
}

/**
 * The address without anything that grants access, for display and for the ledger: no user name,
 * no password, no query string, and for RTMP no stream key (everything after the application
 * name is the key there).
 */
export function redactStreamAddress(raw: string): string {
  const url = parseStreamAddress(raw);
  if (!url) return '';
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  if (url.protocol === 'rtmp:' || url.protocol === 'rtmps:') {
    const [app] = url.pathname.split('/').filter((part) => part !== '');
    url.pathname = app !== undefined ? `/${app}/…` : '/';
  }
  return decodeURI(url.toString());
}

/**
 * A line of ffmpeg's output for display. ffmpeg names the input it failed on, and with it the
 * credentials in the address; every address in the text is replaced by its redacted form.
 */
export function redactStreamText(text: string): string {
  return text
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]+/gi, (address) => {
      // Punctuation that follows the address in the sentence is not part of it.
      const tail = /[:,.;)\]]+$/.exec(address)?.[0] ?? '';
      const core = tail === '' ? address : address.slice(0, -tail.length);
      return (redactStreamAddress(core) || '[Adresse]') + tail;
    })
    .slice(0, 240);
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
    // A source saved before the operator narrowed the list stays in the list of sources but is
    // not connected again.
    if (!streamHostAllowed(url.hostname, config.streamHosts)) {
      stream.state = 'offline';
      stream.lastError = 'Der Betreiber lässt Direktbilder von dieser Adresse nicht zu.';
      this.deps.onChange();
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
      stream.lastError = redactStreamText(err.message);
    });
    child.on('exit', (code) => {
      stream.child = null;
      if (stream.stopped) return;
      stream.state = 'offline';
      const lastLine = stderr.trim().split('\n').pop() ?? '';
      stream.lastError = lastLine !== '' ? redactStreamText(lastLine) : code === 0 ? 'Der Strom ist zu Ende.' : `ffmpeg endete mit Code ${code ?? '?'}`;
      this.deps.log(`Stream von „${this.deps.sources.get(stream.sourceId)?.name ?? stream.sourceId}“ beendet: ${stream.lastError}`);
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
            this.deps.log(`Abschnitt ${file} nicht abgelegt: ${err instanceof Error ? err.message : String(err)}`);
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
