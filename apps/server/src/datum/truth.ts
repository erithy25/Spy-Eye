/**
 * DATUM own ground truth: the true recording places of an analyst's own videos, given after the
 * upload (POST /api/datum/truth). They are attached to the fixes for comparison, exactly like the
 * truth of the reference set, and never go into the localisation itself.
 *
 * A truth names its video by file name, with or without the extension and in any letter case,
 * because that is what an analyst has at hand in a spreadsheet next to the footage. The list is
 * stored in `<dataDir>/datum/truth.json`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { VIDEO_EXTENSIONS } from '../config.js';
import { readJson, writeFileAtomic } from '../core/json.js';

/** Most entries one request may carry, and the most the node keeps. */
export const MAX_TRUTH_ENTRIES = 10_000;
const MAX_NAME = 200;
const MAX_LABEL = 200;

export interface TruthEntry {
  /** File name as given (cleaned), with or without extension. */
  name: string;
  lat: number;
  lon: number;
  label?: string;
}

interface StoredTruth extends TruthEntry {
  /** When the entry was given (epoch ms). */
  at: number;
}

interface TruthFile {
  version: 1;
  entries: StoredTruth[];
}

/** A refusal in both languages; the route answers in the language of the session. */
export interface TruthRefusal {
  de: string;
  en: string;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;

/** The file name of a path as a person would type it: no folders, no control characters. */
export function cleanTruthName(raw: string): string {
  const base = raw.replace(/\\/g, '/').split('/').pop() ?? raw;
  return base.replace(CONTROL, '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

/**
 * The key a truth and a recording are matched by: the cleaned file name without a video
 * extension, in lower case. Only known video extensions are cut off, so "Fahrt 1.2" stays itself.
 */
export function truthKey(name: string): string {
  const clean = cleanTruthName(name);
  // ".mp4" alone is an extension without a name (extname sees a hidden file and returns '').
  const ext = VIDEO_EXTENSIONS.has(clean.toLowerCase()) ? clean.toLowerCase() : path.extname(clean).toLowerCase();
  const stem = VIDEO_EXTENSIONS.has(ext) ? clean.slice(0, -ext.length) : clean;
  return stem.trim().toLowerCase();
}

function cleanLabel(raw: string): string {
  return raw.replace(CONTROL, ' ').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
}

/**
 * Reads `{ entries: [{ name, lat, lon, label? }] }`. Every entry must be valid; the first fault is
 * reported with its position, so the analyst can correct the list instead of guessing which rows
 * were dropped. Later entries for the same video replace earlier ones.
 */
export function parseTruthBody(body: unknown): { entries: TruthEntry[] } | TruthRefusal {
  const list = body !== null && typeof body === 'object' ? (body as Record<string, unknown>)['entries'] : undefined;
  if (!Array.isArray(list)) {
    return { de: 'Erwartet { entries: [{ name, lat, lon, label? }] }.', en: 'Expected { entries: [{ name, lat, lon, label? }] }.' };
  }
  if (list.length === 0) return { de: 'Die Liste ist leer.', en: 'The list is empty.' };
  if (list.length > MAX_TRUTH_ENTRIES) {
    return {
      de: `Höchstens ${MAX_TRUTH_ENTRIES.toLocaleString('de-DE')} Einträge je Liste (erhalten: ${list.length.toLocaleString('de-DE')}).`,
      en: `At most ${MAX_TRUTH_ENTRIES.toLocaleString('en-GB')} entries per list (received: ${list.length.toLocaleString('en-GB')}).`,
    };
  }
  const byKey = new Map<string, TruthEntry>();
  for (const [i, item] of list.entries()) {
    const row = i + 1;
    if (item === null || typeof item !== 'object') return { de: `Eintrag ${row}: kein Objekt.`, en: `Entry ${row}: not an object.` };
    const o = item as Record<string, unknown>;
    const name = typeof o['name'] === 'string' ? cleanTruthName(o['name']) : '';
    if (name === '' || truthKey(name) === '') return { de: `Eintrag ${row}: Dateiname fehlt.`, en: `Entry ${row}: file name missing.` };
    const lat = o['lat'];
    const lon = o['lon'];
    if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
      return { de: `Eintrag ${row} („${name}“): Breite muss zwischen −90 und 90 liegen.`, en: `Entry ${row} ("${name}"): latitude must lie between −90 and 90.` };
    }
    if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      return { de: `Eintrag ${row} („${name}“): Länge muss zwischen −180 und 180 liegen.`, en: `Entry ${row} ("${name}"): longitude must lie between −180 and 180.` };
    }
    const rawLabel = o['label'];
    if (rawLabel !== undefined && rawLabel !== null && typeof rawLabel !== 'string') {
      return { de: `Eintrag ${row} („${name}“): Bezeichnung muss Text sein.`, en: `Entry ${row} ("${name}"): label must be text.` };
    }
    const label = typeof rawLabel === 'string' ? cleanLabel(rawLabel) : '';
    // Six decimals are about 10 cm; more only pretends precision.
    const entry: TruthEntry = { name, lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, ...(label ? { label } : {}) };
    const key = truthKey(name);
    byKey.delete(key);
    byKey.set(key, entry);
  }
  return { entries: [...byKey.values()] };
}

/** The node's own truths, kept in memory and mirrored to one file. */
export class TruthBook {
  private readonly byKey = new Map<string, StoredTruth>();
  private writing: Promise<void> = Promise.resolve();

  constructor(readonly file: string) {}

  /**
   * Reads the stored truths. An unreadable file is moved aside (`truth.json.unreadable-<time>`)
   * and reported, so that the next upload does not overwrite what may still be recovered by hand.
   */
  async open(): Promise<void> {
    let stored: TruthFile | null;
    try {
      stored = await readJson<TruthFile | null>(this.file, null);
    } catch (err: unknown) {
      const aside = `${this.file}.unreadable-${Date.now()}`;
      await fs.rename(this.file, aside).catch(() => undefined);
      throw new Error(`${err instanceof Error ? err.message : String(err)} (moved to ${path.basename(aside)})`);
    }
    this.byKey.clear();
    for (const e of stored?.entries ?? []) {
      if (typeof e?.name !== 'string' || typeof e.lat !== 'number' || typeof e.lon !== 'number') continue;
      const key = truthKey(e.name);
      if (key) this.byKey.set(key, e);
    }
  }

  get size(): number {
    return this.byKey.size;
  }

  list(): TruthEntry[] {
    return [...this.byKey.values()].map(({ name, lat, lon, label }) => ({ name, lat, lon, ...(label ? { label } : {}) }));
  }

  /** The truth for a recording's file name, if one was given. */
  lookup(fileName: string): TruthEntry | null {
    const found = this.byKey.get(truthKey(fileName));
    if (!found) return null;
    return { name: found.name, lat: found.lat, lon: found.lon, ...(found.label ? { label: found.label } : {}) };
  }

  /**
   * Adds or replaces entries (matched by file name) and writes the file. Refuses, without
   * changing anything, when the node would then hold more than MAX_TRUTH_ENTRIES.
   */
  async put(entries: readonly TruthEntry[]): Promise<{ stored: number } | TruthRefusal> {
    const added = entries.filter((e) => !this.byKey.has(truthKey(e.name))).length;
    if (this.byKey.size + added > MAX_TRUTH_ENTRIES) {
      return {
        de: `Der Knoten hält höchstens ${MAX_TRUTH_ENTRIES.toLocaleString('de-DE')} Grundwahrheiten; ${this.byKey.size.toLocaleString('de-DE')} sind schon hinterlegt.`,
        en: `The node holds at most ${MAX_TRUTH_ENTRIES.toLocaleString('en-GB')} ground truths; ${this.byKey.size.toLocaleString('en-GB')} are stored already.`,
      };
    }
    const at = Date.now();
    for (const e of entries) this.byKey.set(truthKey(e.name), { ...e, at });
    await this.write();
    return { stored: entries.length };
  }

  /**
   * Removes the truths given for these file names (matched like `lookup`) and writes the file.
   * Returns how many were removed; nothing is written when none was there.
   */
  async remove(names: readonly string[]): Promise<number> {
    let removed = 0;
    for (const name of names) if (this.byKey.delete(truthKey(name))) removed++;
    if (removed > 0) await this.write();
    return removed;
  }

  private async write(): Promise<void> {
    const data: TruthFile = { version: 1, entries: [...this.byKey.values()] };
    // Writes are chained, so two quick requests cannot leave the older list on disk.
    const write = this.writing.then(() => writeFileAtomic(this.file, `${JSON.stringify(data)}\n`));
    this.writing = write.catch(() => undefined);
    await write;
  }
}
