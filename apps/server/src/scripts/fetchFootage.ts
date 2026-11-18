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
import { renameRetry } from '../core/json.js';
import { collectFootage, footagePresent, type FootageJob } from './footage.js';

async function download(job: FootageJob): Promise<number> {
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
      await renameRetry(partial, target);
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
  const jobs = await collectFootage();
  if (jobs.length === 0) {
    process.stdout.write('Keine Übungsdefinition gefunden (scenarios/*/scenario.json).\n');
    return;
  }
  const missing: FootageJob[] = [];
  for (const job of jobs) {
    await fs.mkdir(job.dir, { recursive: true });
    if (!(await footagePresent(job))) missing.push(job);
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
        // Not `bytes += await …`: the left side would be read before the download finishes.
        const size = await download(job);
        bytes += size;
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
