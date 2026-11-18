/**
 * The prepared state of a demonstration node: everything in its data folder except the
 * recordings themselves, as it stood when "pnpm demo:prepare" finished. A rehearsal changes this
 * state (alerts, verdicts, a retrained watch, cases, the ledger); restoring it returns the node
 * to the start of the demonstration without analysing the footage again.
 *
 * This works on the files of a stopped node from outside, like deleting the data folder does. A
 * node in operation has no such function: its ledger cannot be rewound from within.
 *
 * The operator's own settings of the node are no part of a demonstration's state: the Mapillary
 * key (the only stored copy of a secret, see datum/settings.ts) and the street-level setting. They
 * are never copied into the snapshot and are left as they are by a restore: a key removed in the
 * console must not come back, a key stored later must not be lost, and no second plaintext copy
 * of it may lie in the snapshot.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const SNAPSHOT_DIR = '.prepared';
const RECORDINGS_DIR = 'videos';
const REMOVE = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 } as const;

/** Files of the operator (relative to the data folder, '/'-separated): see the module comment. */
export const OPERATOR_FILES: readonly string[] = ['datum/mapillary-key', 'datum/settings.json'];

/** `file` below `root`, '/'-separated, as OPERATOR_FILES names it. */
function relative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

/** Whether a path (relative, '/'-separated) stays out of the snapshot: an operator's file or a temporary file. */
function excluded(rel: string): boolean {
  return rel.endsWith('.tmp') || OPERATOR_FILES.includes(rel);
}

/** Copies a state entry, leaving out the operator's files. */
async function copyState(fromRoot: string, toRoot: string, name: string): Promise<void> {
  await fs.cp(path.join(fromRoot, name), path.join(toRoot, name), { recursive: true, filter: (src) => !excluded(relative(fromRoot, src)) });
}

/**
 * Removes everything in `dir` (`rel` below the data folder) except the operator's files and the
 * folders that hold them.
 */
async function removeAllBut(dir: string, rel: string): Promise<void> {
  for (const name of await entries(dir)) {
    const r = `${rel}/${name}`;
    if (OPERATOR_FILES.includes(r)) continue;
    const entry = path.join(dir, name);
    const isDir = await fs.stat(entry).then((st) => st.isDirectory(), () => false);
    if (isDir && OPERATOR_FILES.some((f) => f.startsWith(`${r}/`))) await removeAllBut(entry, r);
    else await fs.rm(entry, REMOVE);
  }
}

/** Whether a top-level entry of the data folder holds operator files (and is only emptied). */
const holdsOperatorFiles = (name: string): boolean => OPERATOR_FILES.some((f) => f.startsWith(`${name}/`));

interface Manifest {
  at: number;
  recordings: string[];
}

async function entries(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

/** Keeps a copy of the state files of a stopped node. */
export async function snapshotPreparedState(dataDir: string): Promise<void> {
  const target = path.join(dataDir, SNAPSHOT_DIR);
  await fs.rm(target, REMOVE);
  await fs.mkdir(path.join(target, 'state'), { recursive: true });
  for (const name of await entries(dataDir)) {
    if (name === SNAPSHOT_DIR || name === RECORDINGS_DIR || name.endsWith('.tmp')) continue;
    await copyState(dataDir, path.join(target, 'state'), name);
  }
  const manifest: Manifest = { at: Date.now(), recordings: (await entries(path.join(dataDir, RECORDINGS_DIR))).sort() };
  await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest));
}

export interface RestoreResult {
  /** When the restored state was prepared (epoch ms). */
  preparedAt: number;
  recordings: number;
  /** Recordings that were added after the preparation and have been removed. */
  removedRecordings: number;
}

/** Puts a stopped node back into its prepared state. Returns null when there is no such state. */
export async function restorePreparedState(dataDir: string): Promise<RestoreResult | null> {
  const source = path.join(dataDir, SNAPSHOT_DIR);
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8')) as Manifest;
  } catch {
    return null;
  }
  if (!Array.isArray(manifest.recordings) || typeof manifest.at !== 'number') return null;

  // A snapshot of an earlier version may hold copies of the operator's files: they are deleted
  // there, never restored.
  for (const f of OPERATOR_FILES) await fs.rm(path.join(source, 'state', ...f.split('/')), REMOVE);
  for (const name of await entries(dataDir)) {
    if (name === SNAPSHOT_DIR || name === RECORDINGS_DIR) continue;
    const entry = path.join(dataDir, name);
    const isDir = await fs.stat(entry).then((st) => st.isDirectory(), () => false);
    if (isDir && holdsOperatorFiles(name)) await removeAllBut(entry, name);
    else await fs.rm(entry, REMOVE);
  }
  for (const name of await entries(path.join(source, 'state'))) {
    await copyState(path.join(source, 'state'), dataDir, name);
  }
  const kept = new Set(manifest.recordings);
  let removed = 0;
  for (const name of await entries(path.join(dataDir, RECORDINGS_DIR))) {
    if (kept.has(name)) continue;
    await fs.rm(path.join(dataDir, RECORDINGS_DIR, name), REMOVE);
    removed++;
  }
  return { preparedAt: manifest.at, recordings: manifest.recordings.length, removedRecordings: removed };
}
