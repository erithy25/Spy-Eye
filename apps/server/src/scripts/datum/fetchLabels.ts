/**
 * German and English names of the reference set's places, from Wikidata.
 *
 *   tsx src/scripts/datum/fetchLabels.ts          fetches the names that are still missing
 *   tsx src/scripts/datum/fetchLabels.ts --all    fetches every name again
 *
 * The reference gallery (datasets/datum/gallery.json) and the ground truths (manifest.json) were
 * selected with one label per item, in whatever language the query returned first: "Eiffel Tower"
 * next to "Kölner Dom". A fix that names a landmark then mixes languages ("Novodevichy Convent,
 * Moskau"). This script asks Wikidata once for the German and the English label of every item and
 * stores them as `labelDe` and `labelEn` next to the existing `label`, which stays for older
 * readers. Fallbacks: German, else the language-neutral label ("mul", which Wikidata uses for
 * names that are the same in every language), else English, else the existing label; English
 * likewise with English first.
 *
 * Idempotent: only entries without both fields are asked for, and a file is written only when an
 * entry changed. Without a connection (or with SICHT_OFFLINE) nothing is written and the script
 * says so; it ends with exit code 0 either way, so that `pnpm datum:fetch` goes on. Only fields are
 * added: the ids and the order of gallery.json, which the shipped gallery vectors are bound to,
 * stay exactly as they are.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, repoRoot } from '../../config.js';

/** Generic on purpose: it names the software and the purpose, nothing about who runs it. */
export const LABELS_USER_AGENT = 'DATUM-Erprobung/0.5 (dataset preparation)';
const API = 'https://www.wikidata.org/w/api.php';
/** Most ids wbgetentities answers in one request for an anonymous client. */
const BATCH = 50;
/** Pause between two requests, so that the run stays far below the API's rate limits. */
const PAUSE_MS = 1_000;
/** Attempts per request; a 429 or 503 waits as long as the server asks (Retry-After), at least the backoff. */
const MAX_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 120_000;
const REQUEST_TIMEOUT_MS = 30_000;

const QID = /^Q[1-9]\d*$/;

/** The labels Wikidata has for one item (null where it has none in that language). */
export interface WikidataLabels {
  de: string | null;
  en: string | null;
  mul: string | null;
}

/** An entry of gallery.json or manifest.json, as far as the labels are concerned. */
export type LabelledEntry = Record<string, unknown> & { wikidata?: unknown; label?: unknown; labelDe?: unknown; labelEn?: unknown };

const filled = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** The entry's Wikidata id, or null when it has none. */
export function wikidataId(entry: LabelledEntry): string | null {
  return typeof entry.wikidata === 'string' && QID.test(entry.wikidata) ? entry.wikidata : null;
}

/** Whether the entry still lacks one of its two names. */
export function needsLabels(entry: LabelledEntry): boolean {
  return wikidataId(entry) !== null && !(filled(entry.labelDe) && filled(entry.labelEn));
}

/** Both names of an entry from what Wikidata returned, with the fallbacks of the module comment. */
export function bilingualLabels(existing: string, found: WikidataLabels | undefined): { labelDe: string; labelEn: string } {
  return {
    labelDe: found?.de ?? found?.mul ?? found?.en ?? existing,
    labelEn: found?.en ?? found?.mul ?? found?.de ?? existing,
  };
}

/**
 * The entry with `labelDe` and `labelEn` placed right after `label` (the order of the other keys
 * stays, so that a diff of the file shows only the two new lines per entry).
 */
export function withLabels(entry: LabelledEntry, names: { labelDe: string; labelEn: string }): LabelledEntry {
  const out: LabelledEntry = {};
  let placed = false;
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'labelDe' || key === 'labelEn') continue;
    out[key] = value;
    if (key === 'label') {
      out['labelDe'] = names.labelDe;
      out['labelEn'] = names.labelEn;
      placed = true;
    }
  }
  if (!placed) {
    out['labelDe'] = names.labelDe;
    out['labelEn'] = names.labelEn;
  }
  return out;
}

/** The labels of a wbgetentities answer by requested id (a redirected item under the id asked for). */
export function parseEntities(body: unknown): Map<string, WikidataLabels> {
  const out = new Map<string, WikidataLabels>();
  const entities = body !== null && typeof body === 'object' ? (body as Record<string, unknown>)['entities'] : undefined;
  if (entities === null || typeof entities !== 'object') return out;
  for (const [key, raw] of Object.entries(entities as Record<string, unknown>)) {
    if (raw === null || typeof raw !== 'object') continue;
    const entity = raw as Record<string, unknown>;
    if ('missing' in entity) continue;
    const labels = (entity['labels'] ?? {}) as Record<string, { value?: unknown } | undefined>;
    const value = (lang: string): string | null => {
      const v = labels[lang]?.value;
      return filled(v) ? v.trim() : null;
    };
    const redirect = entity['redirects'] as { from?: unknown } | undefined;
    const id = typeof redirect?.from === 'string' ? redirect.from : key;
    out.set(id, { de: value('de'), en: value('en'), mul: value('mul') });
  }
  return out;
}

/** No connection at all (as opposed to an answer the server refused). */
export class OfflineError extends Error {}

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Seconds of a Retry-After header (a number or an HTTP date), 0 when absent or unreadable. */
function retryAfterMs(header: string | null): number {
  if (!header) return 0;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
}

/**
 * The labels of up to 50 items. Retries a throttled (429, 503) or failed request with backoff;
 * throws OfflineError when the network is not there at all.
 */
export async function fetchLabelBatch(
  ids: readonly string[],
  deps: { fetch?: FetchLike; sleep?: (ms: number) => Promise<void>; log?: (line: string) => void } = {},
): Promise<Map<string, WikidataLabels>> {
  const doFetch = deps.fetch ?? (fetch as unknown as FetchLike);
  const wait = deps.sleep ?? sleep;
  const url = `${API}?${new URLSearchParams({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels', languages: 'de|en|mul', format: 'json' }).toString()}`;
  let networkFailures = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const backoff = Math.min(MAX_BACKOFF_MS, 5_000 * 2 ** (attempt - 1));
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await doFetch(url, { headers: { 'User-Agent': LABELS_USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err: unknown) {
      // Two failed connections in a row are no hiccup: there is no network (or no route to it).
      networkFailures++;
      if (networkFailures >= 2) throw new OfflineError(err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err));
      await wait(backoff);
      continue;
    }
    networkFailures = 0;
    if (response.status === 429 || response.status === 503) {
      const pause = Math.max(retryAfterMs(response.headers.get('retry-after')), backoff);
      deps.log?.(`  Wikidata drosselt (HTTP ${response.status}); nächster Versuch in ${Math.round(pause / 1000)} s`);
      await wait(pause);
      continue;
    }
    if (!response.ok) throw new Error(`Wikidata antwortet mit HTTP ${response.status}`);
    const body = await response.json();
    const error = body !== null && typeof body === 'object' ? (body as Record<string, unknown>)['error'] : undefined;
    if (error !== undefined) {
      const code = (error as { code?: unknown }).code;
      // maxlag: the servers are busy; the documented answer is to wait and ask again.
      if (code === 'maxlag' || code === 'ratelimited') {
        await wait(backoff);
        continue;
      }
      throw new Error(`Wikidata: ${String(code ?? 'Fehler')}`);
    }
    return parseEntities(body);
  }
  throw new Error(`Wikidata: nach ${MAX_ATTEMPTS} Versuchen keine Antwort`);
}

/** Puts the names into every entry that lacks them (or into all with `all`); returns the changed count. */
export function applyLabels(entries: LabelledEntry[], labels: ReadonlyMap<string, WikidataLabels>, asked: ReadonlySet<string>, all = false): number {
  let changed = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as LabelledEntry;
    const id = wikidataId(entry);
    if (!id || !asked.has(id) || (!all && !needsLabels(entry))) continue;
    const existing = filled(entry.label) ? entry.label : id;
    const next = withLabels(entry, bilingualLabels(existing, labels.get(id)));
    if (next['labelDe'] === entry.labelDe && next['labelEn'] === entry.labelEn) continue;
    entries[i] = next;
    changed++;
  }
  return changed;
}

async function writeAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, text);
  await fs.rename(tmp, file);
}

interface LabelFile {
  file: string;
  name: string;
  data: Record<string, unknown>;
  entries: LabelledEntry[];
}

async function readLabelFile(file: string, key: 'images' | 'videos'): Promise<LabelFile | null> {
  try {
    const data = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>;
    const entries = data[key];
    if (!Array.isArray(entries)) return null;
    return { file, name: path.basename(file), data, entries: entries as LabelledEntry[] };
  } catch {
    return null;
  }
}

export interface FetchLabelsReport {
  /** Items asked for. */
  asked: number;
  /** Items with a German, an English, only a language-neutral label, none at all (or unknown to Wikidata). */
  withDe: number;
  withEn: number;
  mulOnly: number;
  notFound: number;
  /** Entries changed per file. */
  changed: Record<string, number>;
  /** Why the run stopped early (offline, refused), or null. */
  stopped: string | null;
}

/** The whole run on a dataset directory; writes the files that changed. */
export async function fetchLabels(
  datasetDir: string,
  opts: { all?: boolean; fetch?: FetchLike; sleep?: (ms: number) => Promise<void>; log?: (line: string) => void; pauseMs?: number } = {},
): Promise<FetchLabelsReport> {
  const log = opts.log ?? (() => undefined);
  const files = (await Promise.all([readLabelFile(path.join(datasetDir, 'gallery.json'), 'images'), readLabelFile(path.join(datasetDir, 'manifest.json'), 'videos')])).filter(
    (f): f is LabelFile => f !== null,
  );
  const ids = new Set<string>();
  for (const f of files) {
    for (const entry of f.entries) {
      const id = wikidataId(entry);
      if (id && (opts.all || needsLabels(entry))) ids.add(id);
    }
  }
  const report: FetchLabelsReport = { asked: ids.size, withDe: 0, withEn: 0, mulOnly: 0, notFound: 0, changed: {}, stopped: null };
  if (ids.size === 0) return report;

  const list = [...ids];
  const labels = new Map<string, WikidataLabels>();
  const answered = new Set<string>();
  for (let i = 0; i < list.length; i += BATCH) {
    const batch = list.slice(i, i + BATCH);
    if (i > 0) await (opts.sleep ?? sleep)(opts.pauseMs ?? PAUSE_MS);
    try {
      const found = await fetchLabelBatch(batch, { ...(opts.fetch ? { fetch: opts.fetch } : {}), ...(opts.sleep ? { sleep: opts.sleep } : {}), log });
      for (const [id, l] of found) labels.set(id, l);
      for (const id of batch) answered.add(id);
    } catch (err: unknown) {
      report.stopped = err instanceof OfflineError ? `offline (${err.message})` : err instanceof Error ? err.message : String(err);
      break;
    }
    log(`  ${Math.min(list.length, i + BATCH)}/${list.length} Einträge abgefragt`);
  }
  // Offline from the first request on: nothing was learned, nothing is written.
  if (answered.size === 0) return report;

  for (const id of answered) {
    const l = labels.get(id);
    if (!l) report.notFound++;
    else {
      if (l.de) report.withDe++;
      if (l.en) report.withEn++;
      if (!l.de && !l.en && l.mul) report.mulOnly++;
    }
  }
  for (const f of files) {
    const changed = applyLabels(f.entries, labels, answered, opts.all ?? false);
    report.changed[f.name] = changed;
    if (changed === 0) continue;
    // The same formatting as fetchDataset.ts writes (two spaces, final newline).
    await writeAtomic(f.file, `${JSON.stringify(f.data, null, 2)}\n`);
  }
  return report;
}

async function main(): Promise<void> {
  const datasetDir = path.join(repoRoot, 'datasets', 'datum');
  const say = (line: string): void => void process.stdout.write(`${line}\n`);
  if (config.offline) {
    say('Namen der Referenzorte: Offline-Betrieb (SICHT_OFFLINE); Wikidata wird nicht gefragt, die Dateien bleiben unverändert.');
    return;
  }
  const report = await fetchLabels(datasetDir, { all: process.argv.includes('--all'), log: say });
  if (report.asked === 0) {
    say('Namen der Referenzorte: alle Einträge haben ihren deutschen und englischen Namen.');
    return;
  }
  const changed = Object.entries(report.changed).map(([file, n]) => `${file} ${n}`).join(', ');
  if (report.stopped && Object.keys(report.changed).length === 0) {
    say(`Namen der Referenzorte: Wikidata nicht erreichbar (${report.stopped}); die Dateien bleiben unverändert. Später erneut: pnpm datum:fetch`);
    return;
  }
  say(
    `Namen der Referenzorte: ${report.asked} Einträge gefragt; deutsch ${report.withDe}, englisch ${report.withEn}, nur sprachneutral ${report.mulOnly}, ohne Namen ${report.notFound}. Geändert: ${changed || 'nichts'}.`,
  );
  if (report.stopped) say(`  Abgebrochen: ${report.stopped}; der Rest folgt beim nächsten pnpm datum:fetch.`);
}

// Run as a script, not when a test imports the functions above.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exitCode = 1;
  });
}
