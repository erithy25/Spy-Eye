import fs from 'node:fs/promises';

/**
 * Free space in bytes on the volume that holds a directory, as an unprivileged process may use
 * it. Null where the platform cannot tell or the directory does not exist; callers treat that as
 * "unknown", not as "full".
 */
export async function freeBytes(dir: string): Promise<number | null> {
  try {
    const stats = await fs.statfs(dir);
    const free = Number(stats.bavail) * Number(stats.bsize);
    return Number.isFinite(free) && free >= 0 ? free : null;
  } catch {
    return null;
  }
}
