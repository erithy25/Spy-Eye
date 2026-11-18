import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { config } from '../config.js';

export class FfmpegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FfmpegError';
  }
}

function runCapture(args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new FfmpegError(`ffmpeg timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (c: string) => (stdout += c));
    child.stderr.setEncoding('utf8').on('data', (c: string) => {
      if (stderr.length < 200_000) stderr += c;
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        err.code === 'ENOENT'
          ? new FfmpegError(
              `ffmpeg wurde nicht gefunden ("${config.ffmpegPath}"). Bitte ffmpeg installieren (Windows: "winget install Gyan.FFmpeg", danach ein neues Terminal öffnen; macOS: "brew install ffmpeg"; Ubuntu: "apt install ffmpeg") oder FFMPEG_PATH setzen.`,
            )
          : err,
      );
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** Verifies that ffmpeg is runnable and returns its version line. */
export async function checkFfmpeg(): Promise<string> {
  const { code, stdout } = await runCapture(['-hide_banner', '-version'], 15_000);
  if (code !== 0) throw new FfmpegError(`"${config.ffmpegPath} -version" exited with code ${code}`);
  return stdout.split('\n')[0]?.trim() ?? 'ffmpeg';
}

export interface ProbeResult {
  durationSec: number | null;
  hasVideo: boolean;
}

/** Reads container duration and checks for a video stream by parsing `ffmpeg -i` output. */
export async function probeVideo(inputPath: string): Promise<ProbeResult> {
  // ffmpeg exits with 1 because no output file is given; the stream info is on stderr.
  const { stderr } = await runCapture(['-hide_banner', '-nostdin', '-i', inputPath], 60_000);
  const duration = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  let durationSec: number | null = null;
  if (duration) {
    const value = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]);
    if (Number.isFinite(value) && value > 0) durationSec = value;
  }
  const hasVideo = /Stream #\d+:\d+.*: Video:/.test(stderr);
  return { durationSec, hasVideo };
}

export interface FrameExtraction {
  /** Number of frames that are completely written to disk. */
  available(): number;
  /** True once ffmpeg has exited (successfully or not). */
  finished(): boolean;
  /** Resolves with the total frame count; rejects when ffmpeg fails. */
  done: Promise<number>;
  /** Resolves on the next progress update or exit. */
  waitForProgress(): Promise<void>;
  kill(): void;
}

export interface ExtractOptions {
  inputPath: string;
  /** printf-style output pattern, e.g. /data/frames/%07d.jpg */
  outputPattern: string;
  fps: number;
  maxWidth: number;
}

/**
 * Starts ffmpeg to sample frames at a fixed rate and write them as JPEGs.
 * Frames become available incrementally so analysis can start while extraction is running.
 */
export function extractFrames(options: ExtractOptions): FrameExtraction {
  const args = [
    '-hide_banner',
    '-nostdin',
    '-loglevel', 'error',
    '-y',
    '-i', options.inputPath,
    '-map', '0:v:0',
    '-an',
    '-sn',
    '-vf', `fps=${options.fps},scale=w='min(${options.maxWidth},iw)':h=-2:flags=bicubic`,
    '-pix_fmt', 'yuvj420p',
    '-q:v', '3',
    '-progress', 'pipe:1',
    '-stats_period', '0.25',
    '-nostats',
    options.outputPattern,
  ];
  const child: ChildProcessByStdio<null, Readable, Readable> = spawn(config.ffmpegPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let reported = 0;
  let exited = false;
  let stderr = '';
  let waiters: (() => void)[] = [];
  const notify = (): void => {
    const pending = waiters;
    waiters = [];
    for (const w of pending) w();
  };

  let buffer = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('frame=')) {
        const n = Number(line.slice(6));
        if (Number.isFinite(n) && n > reported) reported = n;
      }
    }
    notify();
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    if (stderr.length < 20_000) stderr += chunk;
  });

  const done = new Promise<number>((resolve, reject) => {
    child.on('error', (err: NodeJS.ErrnoException) => {
      exited = true;
      notify();
      reject(err.code === 'ENOENT' ? new FfmpegError(`ffmpeg wurde nicht gefunden ("${config.ffmpegPath}").`) : err);
    });
    child.on('close', (code, signal) => {
      exited = true;
      notify();
      if (code === 0) {
        resolve(reported);
      } else if (signal) {
        reject(new FfmpegError(`ffmpeg wurde beendet (${signal}).`));
      } else {
        const lines = stderr.trim().split('\n').filter((l) => l.trim() !== '');
        const detail = lines.slice(-3).join(' | ') || `Exit-Code ${code}`;
        reject(new FfmpegError(`Video konnte nicht dekodiert werden: ${detail}`));
      }
    });
  });
  // The caller always awaits `done`; this avoids an unhandled rejection if it fails earlier.
  done.catch(() => undefined);

  return {
    // While ffmpeg is running the most recently reported frame may still be in flight.
    available: () => (exited ? reported : Math.max(0, reported - 1)),
    finished: () => exited,
    done,
    waitForProgress: () =>
      exited
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 500);
            waiters.push(() => {
              clearTimeout(timer);
              resolve();
            });
          }),
    kill: () => {
      if (!exited) child.kill('SIGKILL');
    },
  };
}

export interface KeyframeRequest {
  /** Timestamp in seconds. */
  time: number;
  outputPath: string;
}

/**
 * Grabs one keyframe near each of the given timestamps with a single ffmpeg process. The cost is
 * independent of the video length. A request without a keyframe after its timestamp produces no
 * file; callers must check which outputs exist.
 */
export async function extractKeyframes(inputPath: string, requests: KeyframeRequest[], maxWidth: number): Promise<void> {
  if (requests.length === 0) return;
  const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y'];
  // -skip_frame nokey: the decoder only touches keyframes, so each request yields the first
  // keyframe at or after its timestamp without decoding the frames in between. For a preview any
  // nearby picture will do, and it cuts the decode time by a factor of three or more.
  for (const request of requests) {
    args.push('-threads', '1', '-skip_frame', 'nokey', '-ss', Math.max(0, request.time).toFixed(3), '-i', inputPath);
  }
  requests.forEach((request, i) => {
    args.push(
      '-map', `${i}:v:0`,
      '-frames:v', '1',
      '-an',
      '-sn',
      '-vf', `scale=w='min(${maxWidth},iw)':h=-2:flags=bicubic`,
      '-pix_fmt', 'yuvj420p',
      '-q:v', '3',
      request.outputPath,
    );
  });
  const { code, stderr } = await runCapture(args, 120_000);
  if (code !== 0) {
    const lines = stderr.trim().split('\n').filter((l) => l.trim() !== '');
    throw new FfmpegError(`Video konnte nicht dekodiert werden: ${lines.slice(-2).join(' | ') || `Exit-Code ${code}`}`);
  }
}
