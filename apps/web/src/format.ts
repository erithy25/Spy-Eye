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
