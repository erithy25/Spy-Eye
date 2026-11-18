/** 83.4 -> "01:23", 3725 -> "1:02:05" */
export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatCount(n: number): string {
  return n.toLocaleString('de-DE');
}

/** 0.874 -> "0.87" */
export function formatScore(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '–';
}

export function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

export const VIDEO_FILE_PATTERN = /\.(mp4|m4v|mov|mkv|webm|avi|mpg|mpeg|ts|mts|m2ts|wmv|flv|3gp|ogv)$/i;

/** Wall-clock time of day, e.g. "14:03:27". */
export function formatClock(epochMs: number, locale: string): string {
  return new Date(epochMs).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

/** "18.11.2026, 14:03" */
export function formatDateTime(epochMs: number, locale: string): string {
  return new Date(epochMs).toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatDate(epochMs: number, locale: string): string {
  return new Date(epochMs).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Exercise clock: 192 -> "T+03:12" */
export function formatExercise(seconds: number): string {
  return `T+${formatTime(seconds)}`;
}

export function shortHash(hash: string | null | undefined, length = 10): string {
  return hash ? hash.slice(0, length) : '–';
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)} %`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${Math.round(bytes / 1e3)} kB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e9).toFixed(2)} GB`;
}
