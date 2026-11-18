/**
 * The prepared state of a demonstration node: everything in its data folder except the
 * recordings themselves, as it stood when "pnpm demo:prepare" finished. A rehearsal changes this
 * state (alerts, verdicts, a retrained watch, cases, the ledger); restoring it returns the node
 * to the start of the demonstration without analysing the footage again.
 *
 * This works on the files of a stopped node from outside, like deleting the data folder does. A
 * node in operation has no such function: its ledger cannot be rewound from within.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const SNAPSHOT_DIR = '.prepared';
const RECORDINGS_DIR = 'videos';
const REMOVE = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 } as const;

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
    await fs.cp(path.join(dataDir, name), path.join(target, 'state', name), { recursive: true });
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

  for (const name of await entries(dataDir)) {
    if (name === SNAPSHOT_DIR || name === RECORDINGS_DIR) continue;
    await fs.rm(path.join(dataDir, name), REMOVE);
  }
  for (const name of await entries(path.join(source, 'state'))) {
    await fs.cp(path.join(source, 'state', name), path.join(dataDir, name), { recursive: true });
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
