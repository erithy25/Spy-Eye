import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Append-only, hash-chained record of everything that happens on a node.
 *
 * Each entry commits to its predecessor: hash = SHA-256(prev || canonical(entry body)).
 * Changing, removing or reordering any past entry breaks every later hash, so the file can be
 * verified by anyone who holds a copy of a later head hash (a peer node, an oversight body).
 */

export interface LedgerBody {
  seq: number;
  /** ISO 8601 UTC. */
  ts: string;
  /** User id, `system`, or `node:<id>` for requests arriving from a peer. */
  actor: string;
  role: string;
  mandateId: string | null;
  /** Dotted action name, e.g. `search.query`. */
  action: string;
  /** One human-readable line, in German: the wording on record. */
  summary: string;
  /**
   * The same line in English, for the console's English view. Optional: entries written before it
   * existed have none, and an entry without it hashes exactly as before (canonical() leaves
   * absent keys out). Where present it is part of the hashed body like every other field.
   */
  summaryEn?: string;
  data: Record<string, unknown>;
}

export interface LedgerEntry extends LedgerBody {
  prev: string;
  hash: string;
}

export interface LedgerVerification {
  ok: boolean;
  entries: number;
  head: string;
  /** Sequence number of the first broken entry, when not ok. */
  brokenAt: number | null;
  reason: string | null;
  checkedAt: string;
  tookMs: number;
}

export const GENESIS_HASH = '0'.repeat(64);

/** Deterministic JSON: object keys sorted, no whitespace. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

export function entryHash(prev: string, body: LedgerBody): string {
  return createHash('sha256').update(prev).update('\n').update(canonical(body)).digest('hex');
}

function bodyOf(entry: LedgerEntry): LedgerBody {
  return {
    seq: entry.seq,
    ts: entry.ts,
    actor: entry.actor,
    role: entry.role,
    mandateId: entry.mandateId,
    action: entry.action,
    summary: entry.summary,
    ...(entry.summaryEn !== undefined ? { summaryEn: entry.summaryEn } : {}),
    data: entry.data,
  };
}

export type LedgerListener = (entry: LedgerEntry) => void;

/**
 * One entry as a line of the file. JSON leaves the separators U+2028 and U+2029 as they are, and
 * some readers end a line there; written as escapes they parse to the same text, so the hash of
 * the entry is unaffected.
 */
export function entryLine(entry: LedgerEntry): string {
  return JSON.stringify(entry).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * The lines of the file, ended by a line feed and by nothing else. Reading bytes instead of text
 * keeps the split independent of what a runtime considers a line ending.
 */
async function* fileLines(file: string): AsyncGenerator<string> {
  let rest: Buffer = Buffer.alloc(0);
  for await (const chunk of createReadStream(file) as AsyncIterable<Buffer>) {
    let data: Buffer = rest.length > 0 ? Buffer.concat([rest, chunk]) : chunk;
    let at = data.indexOf(0x0a);
    while (at >= 0) {
      yield data.subarray(0, at).toString('utf8');
      data = data.subarray(at + 1);
      at = data.indexOf(0x0a);
    }
    rest = data;
  }
  if (rest.length > 0) yield rest.toString('utf8');
}

export class Ledger {
  private head = GENESIS_HASH;
  private seq = 0;
  /** Most recent entries, newest last; older ones are read from disk on demand. */
  private recent: LedgerEntry[] = [];
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<LedgerListener>();
  private static readonly RECENT_LIMIT = 4000;

  constructor(private readonly file: string) {}

  get headHash(): string {
    return this.head;
  }

  get length(): number {
    return this.seq;
  }

  onAppend(listener: LedgerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Reads the existing file and restores head and sequence. Throws if the chain is already broken. */
  async open(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const result = await this.scan((entry) => {
      this.recent.push(entry);
      if (this.recent.length > Ledger.RECENT_LIMIT) this.recent.shift();
    });
    this.head = result.head;
    this.seq = result.entries;
    if (!result.ok) {
      throw new Error(`Ledger ${this.file} failed verification at entry ${result.brokenAt}: ${result.reason}`);
    }
  }

  /** Appends one entry. Calls are serialized so that concurrent writers cannot fork the chain. */
  append(input: Omit<LedgerBody, 'seq' | 'ts'>): Promise<LedgerEntry> {
    const run = this.queue.then(async () => {
      const body: LedgerBody = { seq: this.seq + 1, ts: new Date().toISOString(), ...input };
      const hash = entryHash(this.head, body);
      const entry: LedgerEntry = { ...body, prev: this.head, hash };
      await fs.appendFile(this.file, `${entryLine(entry)}\n`);
      this.head = hash;
      this.seq = body.seq;
      this.recent.push(entry);
      if (this.recent.length > Ledger.RECENT_LIMIT) this.recent.shift();
      for (const l of this.listeners) l(entry);
      return entry;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Newest first. */
  list(options: { limit: number; before?: number; action?: string; actor?: string; mandateId?: string }): LedgerEntry[] {
    const out: LedgerEntry[] = [];
    for (let i = this.recent.length - 1; i >= 0 && out.length < options.limit; i--) {
      const e = this.recent[i] as LedgerEntry;
      if (options.before !== undefined && e.seq >= options.before) continue;
      if (options.action && !e.action.startsWith(options.action)) continue;
      if (options.actor && e.actor !== options.actor) continue;
      if (options.mandateId && e.mandateId !== options.mandateId) continue;
      out.push(e);
    }
    return out;
  }

  /**
   * Recomputes the whole chain from the file and compares its end with the state this node holds.
   * A file that was cut off or replaced while the node runs is consistent in itself; it is the
   * comparison that shows it. The check takes its turn in the write queue, so no entry is
   * appended while it reads.
   */
  verify(): Promise<LedgerVerification> {
    const run = this.queue.then(async () => {
      const result = await this.scan(() => undefined);
      if (result.ok && (result.head !== this.head || result.entries !== this.seq)) {
        return {
          ...result,
          ok: false,
          brokenAt: Math.min(result.entries, this.seq) + 1,
          reason: `Die Datei endet bei Eintrag ${result.entries}, der Knoten hält Eintrag ${this.seq}`,
        };
      }
      return result;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async scan(visit: (entry: LedgerEntry) => void): Promise<LedgerVerification> {
    const started = performance.now();
    let prev = GENESIS_HASH;
    let count = 0;
    let brokenAt: number | null = null;
    let reason: string | null = null;
    try {
      await fs.access(this.file);
    } catch {
      return { ok: true, entries: 0, head: prev, brokenAt: null, reason: null, checkedAt: new Date().toISOString(), tookMs: 0 };
    }
    for await (const line of fileLines(this.file)) {
      if (line.trim() === '') continue;
      let entry: LedgerEntry;
      try {
        entry = JSON.parse(line) as LedgerEntry;
      } catch {
        brokenAt = count + 1;
        reason = 'Zeile ist kein gültiges JSON';
        break;
      }
      if (entry.seq !== count + 1) {
        brokenAt = count + 1;
        reason = `Sequenznummer ${entry.seq} statt ${count + 1}`;
        break;
      }
      if (entry.prev !== prev) {
        brokenAt = entry.seq;
        reason = 'Verweis auf den Vorgänger stimmt nicht';
        break;
      }
      if (entryHash(prev, bodyOf(entry)) !== entry.hash) {
        brokenAt = entry.seq;
        reason = 'Inhalt passt nicht zum Hashwert';
        break;
      }
      prev = entry.hash;
      count++;
      visit(entry);
    }
    return {
      ok: brokenAt === null,
      entries: count,
      head: prev,
      brokenAt,
      reason,
      checkedAt: new Date().toISOString(),
      tookMs: Math.round(performance.now() - started),
    };
  }

  /**
   * A random sample of the entries that satisfy `test`, drawn from the whole file and not only
   * from the recent entries held in memory: an oversight sample must reach back as far as the
   * ledger does, however much has been written since. One pass, each matching entry equally
   * likely. Returns the sample newest first and the number of entries it was drawn from.
   */
  async sample(test: (entry: LedgerEntry) => boolean, size: number, random: () => number = Math.random): Promise<{ population: number; entries: LedgerEntry[] }> {
    await this.queue;
    const chosen: LedgerEntry[] = [];
    let population = 0;
    try {
      await fs.access(this.file);
    } catch {
      return { population: 0, entries: [] };
    }
    for await (const line of fileLines(this.file)) {
      if (line.trim() === '') continue;
      let entry: LedgerEntry;
      try {
        entry = JSON.parse(line) as LedgerEntry;
      } catch {
        continue; // a damaged line is the business of verify(), not of the sample
      }
      if (!test(entry)) continue;
      population++;
      if (chosen.length < size) chosen.push(entry);
      else {
        const slot = Math.floor(random() * population);
        if (slot < size) chosen[slot] = entry;
      }
    }
    chosen.sort((a, b) => b.seq - a.seq);
    return { population, entries: chosen };
  }

  /** Full file content for export to an oversight body. */
  async exportText(): Promise<string> {
    await this.queue;
    try {
      return await fs.readFile(this.file, 'utf8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw err;
    }
  }
}
