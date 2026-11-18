/**
 * The footage an installation needs for the exercise scenarios and for the demonstration peers:
 * one list for the command that fetches it and for the check that asks whether it is complete.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, repoRoot } from '../config.js';

export interface FootageClip {
  file: string;
  url: string;
  credit: string;
}

export interface FootageJob extends FootageClip {
  /** Directory the file belongs in. */
  dir: string;
  /** Scenario title or peer archive the clip belongs to, for the progress lines. */
  group: string;
}

async function readJsonFile<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function subdirectories(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return [];
  }
}

/** Every clip named by a scenario definition or by the seed archive of a demonstration peer. */
export async function collectFootage(): Promise<FootageJob[]> {
  const jobs: FootageJob[] = [];
  for (const name of await subdirectories(config.scenariosDir)) {
    const definition = await readJsonFile<{ title?: string; clips?: Record<string, FootageClip> }>(path.join(config.scenariosDir, name, 'scenario.json'));
    if (!definition?.clips) continue;
    for (const clip of Object.values(definition.clips)) {
      jobs.push({ ...clip, dir: path.join(config.scenariosDir, name, 'clips'), group: definition.title ?? name });
    }
  }
  const seedsDir = path.join(repoRoot, 'seeds');
  for (const name of await subdirectories(seedsDir)) {
    const seed = await readJsonFile<{ sources?: { clips?: FootageClip[] }[] }>(path.join(seedsDir, name, 'seed.json'));
    for (const source of seed?.sources ?? []) {
      for (const clip of source.clips ?? []) jobs.push({ ...clip, dir: path.join(seedsDir, name, 'clips'), group: `Bestand ${name}` });
    }
  }
  return jobs;
}

/** True when the clip is on disk and not an aborted download. */
export async function footagePresent(job: FootageJob): Promise<boolean> {
  try {
    return (await fs.stat(path.join(job.dir, job.file))).size > 10_000;
  } catch {
    return false;
  }
}
