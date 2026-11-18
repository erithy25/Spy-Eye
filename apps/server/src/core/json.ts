import fs from 'node:fs/promises';
import path from 'node:path';

const TRANSIENT_RENAME_ERRORS: ReadonlySet<string> = new Set(['EPERM', 'EBUSY', 'EACCES']);

/**
 * fs.rename that tolerates the short locks which virus scanners and indexers place on fresh files
 * under Windows: a few attempts with growing pauses (2.5 s in total) before the error is passed on.
 */
export async function renameRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (!TRANSIENT_RENAME_ERRORS.has(code) || attempt >= 6) throw err;
      await new Promise((resolve) => setTimeout(resolve, 40 * 2 ** attempt));
    }
  }
}

/** Writes a file so that readers never observe a half-written state. */
export async function writeFileAtomic(file: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await fs.writeFile(tmp, data);
  try {
    await renameRetry(tmp, file);
  } catch (err: unknown) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw new Error(`${file} is not readable JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * A small persistent list of records kept in memory and mirrored to one JSON file.
 * Saves are coalesced, so a burst of changes results in a single write.
 */
export class Collection<T extends { id: string }> {
  private items = new Map<string, T>();
  private saving: Promise<void> | null = null;
  private dirty = false;

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    const list = await readJson<T[]>(this.file, []);
    this.items = new Map(list.map((item) => [item.id, item]));
  }

  all(): T[] {
    return [...this.items.values()];
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  get size(): number {
    return this.items.size;
  }

  put(item: T): T {
    this.items.set(item.id, item);
    this.touch();
    return item;
  }

  delete(id: string): boolean {
    const removed = this.items.delete(id);
    if (removed) this.touch();
    return removed;
  }

  clear(): void {
    if (this.items.size === 0) return;
    this.items.clear();
    this.touch();
  }

  /** Marks the collection as changed after an in-place mutation of a record. */
  touch(): void {
    this.dirty = true;
    this.saving ??= this.flushSoon();
  }

  private async flushSoon(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 150));
    try {
      while (this.dirty) {
        this.dirty = false;
        await writeFileAtomic(this.file, JSON.stringify(this.all()));
      }
    } finally {
      this.saving = null;
    }
  }

  /** Waits until pending changes are on disk. */
  async flush(): Promise<void> {
    while (this.saving) await this.saving;
  }
}

/** Short random identifier with a readable prefix, e.g. `al_k3x9q2mz`. */
export function newId(prefix: string): string {
  let out = '';
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
  for (let i = 0; i < 10; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${prefix}_${out}`;
}
