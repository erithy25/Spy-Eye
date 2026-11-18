/**
 * DATUM: what the file itself says about place and time. Reads container and stream tags with
 * ffprobe (a local process, no network) and parses dates and places written in the file name.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { GeoPoint } from './contract.js';

export interface VideoMetadata {
  /** Recording instant (epoch ms, UTC), null when absent or implausible. */
  creationUtc: number | null;
  /**
   * Recording date without a time of day (YYYY-MM-DD) from a tag that holds only a date (AVI
   * ICRD, MP4 ©day); null when there is none or when `creationUtc` is known. A day, not an instant.
   */
  creationDate: string | null;
  location: GeoPoint | null;
  /** Metres above sea level from the ISO 6709 string, if given. */
  altitude: number | null;
  /** "Apple iPhone 12", "DJI FC3170", … */
  device: string | null;
  /** All tags found (format first, then streams), keys lower-cased. */
  raw: Record<string, string>;
  /** Why a creation time that was present was not used, if so. */
  creationRejected?: string;
  durationSec: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
}

export interface FilenameHints {
  /** YYYY-MM-DD */
  date: string | null;
  /** Words of the name that are neither a date, a counter nor a camera prefix. */
  place: string | null;
}

/** ffprobe lives next to ffmpeg; FFMPEG_PATH=/opt/ffmpeg/bin/ffmpeg gives /opt/ffmpeg/bin/ffprobe. */
export function ffprobePath(): string {
  const ff = config.ffmpegPath;
  const base = path.basename(ff);
  if (/^ffmpeg(\.exe)?$/i.test(base)) return path.join(path.dirname(ff), base.replace(/ffmpeg/i, 'ffprobe')).replace(/^\.[\\/]/, '');
  return 'ffprobe';
}

interface ProbeJson {
  format?: { tags?: Record<string, unknown>; duration?: string };
  streams?: {
    codec_type?: string;
    tags?: Record<string, unknown>;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    width?: number;
    height?: number;
    duration?: string;
  }[];
}

/** Runs ffprobe on a local file and returns its JSON (format and streams). */
export function probeJson(videoPath: string, timeoutMs = 30_000): Promise<ProbeJson> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'quiet',
      '-protocol_whitelist', 'file',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      videoPath,
    ];
    const child = spawn(ffprobePath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`ffprobe timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (c: string) => {
      if (out.length < 4_000_000) out += c;
    });
    child.stderr.resume();
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`ffprobe exited with code ${code}`));
      try {
        resolve(JSON.parse(out) as ProbeJson);
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

export interface Iso6709 {
  lat: number;
  lon: number;
  altitude: number | null;
}

/** One signed coordinate of ISO 6709: ±DD[.d], ±DDMM[.m], ±DDMMSS[.s] (lat) or ±DDD… (lon). */
function iso6709Component(sign: string, digits: string, degreeDigits: number): number | null {
  const [intPart = '', frac = ''] = digits.split('.');
  const fraction = frac === '' ? 0 : Number(`0.${frac}`);
  let value: number;
  if (intPart.length === degreeDigits) {
    value = Number(intPart) + fraction;
  } else if (intPart.length === degreeDigits + 2) {
    const deg = Number(intPart.slice(0, degreeDigits));
    const min = Number(intPart.slice(degreeDigits)) + fraction;
    if (min >= 60) return null;
    value = deg + min / 60;
  } else if (intPart.length === degreeDigits + 4) {
    const deg = Number(intPart.slice(0, degreeDigits));
    const min = Number(intPart.slice(degreeDigits, degreeDigits + 2));
    const sec = Number(intPart.slice(degreeDigits + 2)) + fraction;
    if (min >= 60 || sec >= 60) return null;
    value = deg + min / 60 + sec / 3600;
  } else {
    return null;
  }
  if (!Number.isFinite(value)) return null;
  return sign === '-' ? -value : value;
}

/**
 * Parses an ISO 6709 point such as "+50.3644+007.6058+065.000/", "+50.3644+007.6058/",
 * "+5021.864+00736.348/" or "+27.5916+086.5640+8850CRSWGS_84/".
 */
export function parseIso6709(text: string): Iso6709 | null {
  const m = /([+-])(\d{2}(?:\d{2}){0,2}(?:\.\d+)?)([+-])(\d{3}(?:\d{2}){0,2}(?:\.\d+)?)(?:([+-])(\d+(?:\.\d+)?))?/.exec(text.trim());
  if (!m) return null;
  const lat = iso6709Component(m[1] as string, m[2] as string, 2);
  const lon = iso6709Component(m[3] as string, m[4] as string, 3);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  // 0/0 is what some writers put when they have no fix.
  if (lat === 0 && lon === 0) return null;
  const altitude = m[5] && m[6] ? Number(`${m[5]}${m[6]}`) : null;
  return { lat, lon, altitude: altitude !== null && Number.isFinite(altitude) ? altitude : null };
}

const LOCATION_KEYS = [
  'com.apple.quicktime.location.iso6709',
  'location',
  'location-eng',
  '©xyz',
  'xyz',
  'com.android.location',
];

const CREATION_KEYS = ['com.apple.quicktime.creationdate', 'creation_time', 'date', 'creationdate'];

/** Encoders that rewrite a file (and often stamp it with the time of rewriting). */
const TRANSCODER = /lavf|libav|ffmpeg|handbrake|x264|x265|youtube|google|premiere|davinci|imovie|shotcut|kdenlive|vlc|mencoder/i;

const MIN_PLAUSIBLE = Date.UTC(1990, 0, 1);

/**
 * Parses a date tag ("2018-06-17T12:34:56.000000Z", "2018-06-17T14:34:56+0200",
 * "2018:06:17 12:34:56") to epoch ms; null when unreadable or when it has no time of day.
 */
export function parseTagDate(value: string): number | null {
  let v = value.trim();
  if (v === '') return null;
  // EXIF style "2018:06:17 12:34:56"
  v = v.replace(/^(\d{4}):(\d{2}):(\d{2})[ T]/, '$1-$2-$3T');
  // "+0200" → "+02:00"
  v = v.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  if (/^\d{4}-\d{2}-\d{2} \d/.test(v)) v = v.replace(' ', 'T');
  // A date or a year alone ("2019-07-04", "2018", "July 4, 2019") is no recording instant:
  // Date.parse would turn it into midnight UTC, and that would be reported as the exact time.
  // (A zone offset such as "+02:00" is no time of day.)
  if (!/\d{1,2}:\d{2}/.test(v.replace(/[+-]\d{2}:\d{2}$/, ''))) return null;
  // Without a zone, QuickTime and ffmpeg mean UTC.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v)) v += 'Z';
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * A tag that holds a full calendar date and nothing else ("2019-07-04", "2019:07:04") as
 * YYYY-MM-DD; null for anything else, including a year or a month alone.
 */
export function parseTagDay(value: string): string | null {
  const m = /^(\d{4})[-:](\d{2})[-:](\d{2})$/.exec(value.trim());
  return m ? validDate(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/**
 * Decides whether a creation time is believable: not before 1990 (encoder defaults of 1904 and
 * 1970 fall here), not in the future, and not the moment a transcoder rewrote the file.
 */
export function judgeCreationTime(
  t: number,
  context: { encoder: string | null; fileMtimeMs: number | null; now?: number },
): string | null {
  const now = context.now ?? Date.now();
  if (t < MIN_PLAUSIBLE) return 'Zeitstempel vor 1990 (Standardwert des Encoders)';
  if (t > now + 24 * 3600_000) return 'Zeitstempel in der Zukunft';
  if (context.encoder && TRANSCODER.test(context.encoder) && context.fileMtimeMs !== null) {
    if (Math.abs(t - context.fileMtimeMs) < 15 * 60_000) return `Zeitpunkt der Umkodierung (${context.encoder})`;
  }
  return null;
}

function parseRate(rate: string | undefined): number | null {
  if (!rate) return null;
  const [a, b] = rate.split('/').map(Number);
  if (a === undefined || !Number.isFinite(a) || a <= 0) return null;
  const v = b !== undefined && Number.isFinite(b) && b > 0 ? a / b : a;
  return v > 0 && v < 1000 ? v : null;
}

/** Reads GPS, recording time and device from the container and stream tags. */
export async function readMetadata(videoPath: string): Promise<VideoMetadata> {
  const [probe, stat] = await Promise.all([probeJson(videoPath), fs.stat(videoPath).catch(() => null)]);
  return metadataFromProbe(probe, stat ? stat.mtimeMs : null);
}

/** The pure part of readMetadata (testable without a file). */
export function metadataFromProbe(probe: ProbeJson, fileMtimeMs: number | null, now?: number): VideoMetadata {
  const raw: Record<string, string> = {};
  const add = (tags: Record<string, unknown> | undefined): void => {
    if (!tags) return;
    for (const [k, v] of Object.entries(tags)) {
      const key = k.toLowerCase();
      if (raw[key] === undefined && (typeof v === 'string' || typeof v === 'number')) raw[key] = String(v);
    }
  };
  add(probe.format?.tags);
  for (const s of probe.streams ?? []) add(s.tags);

  let location: GeoPoint | null = null;
  let altitude: number | null = null;
  for (const key of LOCATION_KEYS) {
    const v = raw[key];
    if (!v) continue;
    const p = parseIso6709(v);
    if (p) {
      location = { lat: p.lat, lon: p.lon };
      altitude = p.altitude;
      break;
    }
  }

  const encoder = raw['encoder'] ?? raw['com.apple.quicktime.software'] ?? raw['software'] ?? null;
  const nowMs = now ?? Date.now();
  let creationUtc: number | null = null;
  let creationDate: string | null = null;
  let creationRejected: string | undefined;
  for (const key of CREATION_KEYS) {
    const v = raw[key];
    if (!v) continue;
    const t = parseTagDate(v);
    if (t === null) {
      // A date without a time of day still names the day (for the sun path), as a date in the
      // file name does. Not one in the future, and not the day a transcoder rewrote the file.
      const day = parseTagDay(v);
      const rewriteDay = encoder && TRANSCODER.test(encoder) && fileMtimeMs !== null ? new Date(fileMtimeMs).toISOString().slice(0, 10) : null;
      if (day !== null && Date.parse(`${day}T00:00:00Z`) <= nowMs + 24 * 3600_000 && day !== rewriteDay) creationDate ??= day;
      continue;
    }
    const reason = judgeCreationTime(t, { encoder, fileMtimeMs, ...(now !== undefined ? { now } : {}) });
    if (reason) {
      creationRejected ??= reason;
      continue;
    }
    creationUtc = t;
    break;
  }

  const make = raw['com.apple.quicktime.make'] ?? raw['com.android.manufacturer'] ?? raw['make'] ?? null;
  const model = raw['com.apple.quicktime.model'] ?? raw['com.android.model'] ?? raw['model'] ?? null;
  let device: string | null = null;
  if (make || model) {
    device = make && model && !model.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${model}` : (model ?? make);
  }

  const video = (probe.streams ?? []).find((s) => s.codec_type === 'video');
  const fpsTag = raw['com.android.capture.fps'] ? Number(raw['com.android.capture.fps']) : NaN;
  const fps = parseRate(video?.avg_frame_rate) ?? parseRate(video?.r_frame_rate) ?? (Number.isFinite(fpsTag) && fpsTag > 0 ? fpsTag : null);
  const durationRaw = Number(probe.format?.duration ?? video?.duration);

  return {
    creationUtc,
    creationDate: creationUtc === null ? creationDate : null,
    location,
    altitude,
    device,
    raw,
    ...(creationRejected !== undefined && creationUtc === null ? { creationRejected } : {}),
    durationSec: Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : null,
    fps,
    width: typeof video?.width === 'number' ? video.width : null,
    height: typeof video?.height === 'number' ? video.height : null,
  };
}

function validDate(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2049 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Camera and app prefixes and other words that say nothing about a place. */
const NOISE_WORDS = new Set([
  'vid', 'img', 'mov', 'pxl', 'dji', 'gopr', 'gp', 'dsc', 'dscn', 'mvi', 'clip', 'video', 'movie', 'film',
  'trim', 'edit', 'final', 'export', 'copy', 'kopie', 'signal', 'whatsapp', 'wa', 'telegram', 'screen',
  'recording', 'record', 'hd', 'uhd', 'fhd', 'mp4', 'mov', 'mkv', 'webm', 'mts', 'avi', 'part', 'cut',
  'sd', 'hevc', 'lrv', 'thm', 'snapchat', 'insta', 'reel', 'shorts', 'p', 'fps',
]);

/**
 * Dates and place words written in a file name: "2018-06-17", "20180617", "17.06.2018",
 * "VID_20180617_123456", "Koblenz Deutsches Eck 2018.mp4".
 */
export function filenameHints(name: string): FilenameHints {
  const base = path.basename(name).replace(/\.[A-Za-z0-9]{2,5}$/, '');
  let date: string | null = null;
  let rest = base;
  const patterns: { re: RegExp; pick: (m: RegExpExecArray) => [number, number, number] }[] = [
    // 2018-06-17, 2018_06_17, 2018.06.17
    { re: /(?<!\d)((?:19|20)\d{2})[-_.]([01]\d)[-_.]([0-3]\d)(?!\d)/, pick: (m) => [Number(m[1]), Number(m[2]), Number(m[3])] },
    // 17.06.2018, 17-06-2018, 17_06_2018
    { re: /(?<!\d)([0-3]\d)[-_.]([01]\d)[-_.]((?:19|20)\d{2})(?!\d)/, pick: (m) => [Number(m[3]), Number(m[2]), Number(m[1])] },
    // 20180617 (possibly followed by a time: 20180617_123456 or 20180617123456)
    { re: /(?<!\d)((?:19|20)\d{2})([01]\d)([0-3]\d)(?:[_-]?\d{6}(?:\d{3})?)?(?!\d)/, pick: (m) => [Number(m[1]), Number(m[2]), Number(m[3])] },
  ];
  for (const { re, pick } of patterns) {
    const m = re.exec(base);
    if (!m) continue;
    const [y, mo, d] = pick(m);
    const v = validDate(y, mo, d);
    if (v) {
      date = v;
      rest = base.slice(0, m.index) + ' ' + base.slice(m.index + m[0].length);
      break;
    }
  }
  const words = rest
    .replace(/([a-zäöüß])([A-ZÄÖÜ])/g, '$1 $2')
    .split(/[\s_\-.,()[\]{}+]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && /\p{L}/u.test(w) && !/\d{3,}/.test(w) && !NOISE_WORDS.has(w.toLowerCase()))
    // Hex hashes and ids ("a3f9c2e1", "Q42") are no place names.
    .filter((w) => !/^[0-9a-f]{8,}$/i.test(w) && !/^Q\d+$/.test(w));
  const place = words.length > 0 ? words.join(' ') : null;
  return { date, place };
}
