/**
 * Downloads the footage of the exercise scenarios and of the demonstration peers.
 *
 *   pnpm exercise:fetch
 *
 * The clips are freely licensed stock videos. They are not part of the repository: their licence
 * allows use but not redistribution as files, so every installation fetches them from the
 * publisher. Files that are already present are kept, so the command can be repeated.
 */
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config, repoRoot } from '../config.js';

interface Clip {
  file: string;
  url: string;
  credit: string;
}

interface Job extends Clip {
  dir: string;
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

async function collect(): Promise<Job[]> {
  const jobs: Job[] = [];
  for (const name of await subdirectories(config.scenariosDir)) {
    const definition = await readJsonFile<{ title?: string; clips?: Record<string, Clip> }>(path.join(config.scenariosDir, name, 'scenario.json'));
    if (!definition?.clips) continue;
    for (const clip of Object.values(definition.clips)) {
      jobs.push({ ...clip, dir: path.join(config.scenariosDir, name, 'clips'), group: definition.title ?? name });
    }
  }
  const seedsDir = path.join(repoRoot, 'seeds');
  for (const name of await subdirectories(seedsDir)) {
    const seed = await readJsonFile<{ sources?: { clips?: Clip[] }[] }>(path.join(seedsDir, name, 'seed.json'));
    for (const source of seed?.sources ?? []) {
      for (const clip of source.clips ?? []) jobs.push({ ...clip, dir: path.join(seedsDir, name, 'clips'), group: `Bestand ${name}` });
    }
  }
  return jobs;
}

async function exists(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).size > 10_000;
  } catch {
    return false;
  }
}

async function download(job: Job): Promise<number> {
  const target = path.join(job.dir, job.file);
  const partial = `${target}.part`;
  let lastError = 'unbekannter Fehler';
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(job.url, { headers: { 'user-agent': 'Mozilla/5.0 (footage fetch)' }, redirect: 'follow' });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(partial));
      const { size } = await fs.stat(partial);
      if (size < 10_000) throw new Error('Datei unvollständig');
      await fs.rename(partial, target);
      return size;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
      await fs.rm(partial, { force: true });
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw new Error(`${job.file}: ${lastError}`);
}

async function main(): Promise<void> {
  const jobs = await collect();
  if (jobs.length === 0) {
    process.stdout.write('Keine Übungsdefinition gefunden (scenarios/*/scenario.json).\n');
    return;
  }
  const missing: Job[] = [];
  for (const job of jobs) {
    await fs.mkdir(job.dir, { recursive: true });
    if (!(await exists(path.join(job.dir, job.file)))) missing.push(job);
  }
  process.stdout.write(`Übungsmaterial: ${jobs.length} Aufnahmen, ${jobs.length - missing.length} vorhanden, ${missing.length} zu laden.\n`);
  if (missing.length === 0) return;

  let done = 0;
  let bytes = 0;
  const failed: string[] = [];
  const queue = [...missing];
  const worker = async (): Promise<void> => {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      try {
        bytes += await download(job);
      } catch (err: unknown) {
        failed.push(err instanceof Error ? err.message : String(err));
      }
      done++;
      process.stdout.write(`  ${String(done).padStart(2)}/${missing.length}  ${job.file}  (${job.group})\n`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  process.stdout.write(`${(bytes / 1e6).toFixed(0)} MB geladen.\n`);
  if (failed.length > 0) {
    process.stdout.write(`\n${failed.length} Aufnahme(n) konnten nicht geladen werden:\n${failed.map((f) => `  ${f}`).join('\n')}\n`);
    process.stdout.write('Bitte Netzverbindung prüfen und den Befehl wiederholen; vorhandene Dateien bleiben erhalten.\n');
    process.exitCode = 1;
  }
}

await main();
