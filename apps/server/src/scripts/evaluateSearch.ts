/**
 * Measures the free-text search on a folder of recordings with a list of labelled queries.
 *
 *   pnpm search:evaluate --dir dataset [--queries docs/measurements/search-queries.json] [--data .cache/search-eval]
 *
 * Files the recordings in a scratch node and asks every query twice: once after the fast first
 * pass (one picture per recording) and once after the complete analysis. A query counts as
 * answered when a recording it expects lies above the cut-off; recordings above the cut-off that
 * are neither expected nor acceptable count as false matches. The result is printed and written
 * to docs/measurements/search.json.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { VIDEO_EXTENSIONS, config, repoRoot } from '../config.js';
import { PlatformNode } from '../node.js';
import { createSharedRuntime } from '../runtime.js';
import { DEFAULT_SOURCE_ID } from '../store.js';

interface LabelledQuery {
  q: string;
  /** Fragments of the names of recordings that show what is asked for; empty: not in the footage. */
  expect: string[];
  /** Fragments of names that are defensible answers: counted neither as right nor as wrong. */
  accept?: string[];
}

interface PassResult {
  queries: number;
  /** Queries with at least one expected recording above the cut-off. */
  answered: number;
  /** Queries whose first result is an expected or acceptable recording. */
  topCorrect: number;
  expectedRecordings: number;
  expectedFound: number;
  falseMatches: number;
  absentQueries: number;
  absentWithMatches: number;
  /** Median time of a query that has not been asked before, and the part spent comparing. */
  medianMs: number;
  medianCompareMs: number;
  misses: string[];
}

function argument(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  const value = idx >= 0 ? process.argv[idx + 1] : undefined;
  return value !== undefined && !value.startsWith('--') ? value : fallback;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const say = (line: string): void => void process.stdout.write(`${line}\n`);

async function runQueries(node: PlatformNode, queries: LabelledQuery[]): Promise<PassResult> {
  // Every pass measures queries that have not been asked before.
  node.shared.model.forgetQueries();
  const result: PassResult = {
    queries: 0,
    answered: 0,
    topCorrect: 0,
    expectedRecordings: 0,
    expectedFound: 0,
    falseMatches: 0,
    absentQueries: 0,
    absentWithMatches: 0,
    medianMs: 0,
    medianCompareMs: 0,
    misses: [],
  };
  const times: number[] = [];
  const compareTimes: number[] = [];
  for (const query of queries) {
    const response = await node.search.search({ query: query.q, limit: 2000, videoId: null });
    times.push(response.tookMs);
    compareTimes.push(response.tookMs - response.embedMs);
    // Best scene per recording, in the order of the results.
    const best = new Map<string, { name: string; confidence: number }>();
    for (const r of response.results) if (!best.has(r.videoId)) best.set(r.videoId, { name: r.videoName, confidence: r.confidence });
    const ranked = [...best.values()];
    const expected = (name: string): boolean => query.expect.some((part) => name.includes(part));
    const acceptable = (name: string): boolean => (query.accept ?? []).some((part) => name.includes(part));
    const matched = ranked.filter((r) => r.confidence >= 0.5);
    if (query.expect.length === 0) {
      result.absentQueries++;
      if (matched.some((r) => !acceptable(r.name))) {
        result.absentWithMatches++;
        result.misses.push(`„${query.q}“ kommt nicht vor, gemeldet: ${matched.filter((r) => !acceptable(r.name)).map((r) => r.name).join(', ')}`);
      }
      continue;
    }
    result.queries++;
    const wanted = ranked.filter((r) => expected(r.name));
    result.expectedRecordings += wanted.length;
    result.expectedFound += wanted.filter((r) => r.confidence >= 0.5).length;
    const first = ranked[0];
    if (first && (expected(first.name) || acceptable(first.name))) result.topCorrect++;
    if (wanted.some((r) => r.confidence >= 0.5)) result.answered++;
    else result.misses.push(`„${query.q}“: bester passender Kandidat ${wanted[0] ? `${wanted[0].name} (${wanted[0].confidence.toFixed(2)})` : 'fehlt'}`);
    const wrong = matched.filter((r) => !expected(r.name) && !acceptable(r.name));
    result.falseMatches += wrong.length;
    if (wrong.length > 0) result.misses.push(`„${query.q}“: unpassend gemeldet ${wrong.map((r) => `${r.name} (${r.confidence.toFixed(2)})`).join(', ')}`);
  }
  const middle = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
  result.medianMs = Math.round(middle(times) * 10) / 10;
  result.medianCompareMs = Math.round(middle(compareTimes) * 10) / 10;
  return result;
}

function summary(label: string, r: PassResult): string {
  return [
    `${label}`,
    `  beantwortet:        ${r.answered} von ${r.queries} Anfragen`,
    `  erster Treffer passt: ${r.topCorrect} von ${r.queries}`,
    `  passende Aufnahmen über der Schwelle: ${r.expectedFound} von ${r.expectedRecordings}`,
    `  unpassende Aufnahmen über der Schwelle: ${r.falseMatches}`,
    `  nicht Vorhandenes gemeldet: bei ${r.absentWithMatches} von ${r.absentQueries} Anfragen`,
    `  Suchdauer (Median): ${r.medianMs.toFixed(1)} ms, davon Vergleich mit dem Verzeichnis ${r.medianCompareMs.toFixed(1)} ms`,
  ].join('\n');
}

async function main(): Promise<void> {
  const dir = path.resolve(repoRoot, argument('dir', 'dataset'));
  const queriesFile = path.resolve(repoRoot, argument('queries', path.join('docs', 'measurements', 'search-queries.json')));
  const dataDir = path.resolve(repoRoot, argument('data', path.join('.cache', 'search-eval')));
  const queries = (JSON.parse(await fs.readFile(queriesFile, 'utf8')) as { queries: LabelledQuery[] }).queries;
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter((f) => VIDEO_EXTENSIONS.has(path.extname(f).toLowerCase())).sort();
  } catch {
    files = [];
  }
  if (files.length === 0) throw new Error(`Keine Aufnahmen in ${dir}. Ordner mit --dir angeben.`);

  await fs.rm(dataDir, { recursive: true, force: true });
  const shared = await createSharedRuntime(say);
  const node = new PlatformNode(
    { id: 'suchmessung', name: 'Suchmessung', operator: 'Messlauf', region: '', lat: 50.3569, lon: 7.589, host: '127.0.0.1', port: 0, dataDir, peers: [] },
    shared,
  );
  await node.start(false);
  await shared.ready;
  await node.settled;

  const started = Date.now();
  for (const file of files) {
    const id = await node.store.allocate();
    const sourceFile = `source${path.extname(file).toLowerCase()}`;
    const target = path.join(node.store.videoDir(id), sourceFile);
    await fs.copyFile(path.join(dir, file), target);
    const { size } = await fs.stat(target);
    const entry = node.store.register({ id, name: file, sourceFile, sizeBytes: size, sampleFps: 1, detail: 'standard', sourceId: DEFAULT_SOURCE_ID });
    await node.store.persistMeta(entry);
    node.pipeline.enqueue(id);
  }
  const indexed = (): number => node.store.infos().filter((v) => v.framesIndexed > 0 || v.status === 'error').length;
  while (indexed() < files.length) await sleep(50);
  const firstPassSec = (Date.now() - started) / 1000;
  say(`\n${files.length} Aufnahmen, erster Durchgang nach ${firstPassSec.toFixed(1)} s durchsuchbar.`);
  const first = await runQueries(node, queries);
  say(summary('Nach dem ersten Durchgang (ein Bild je Aufnahme)', first));

  for (;;) {
    const infos = node.store.infos();
    const done = infos.filter((v) => v.status === 'ready' || v.status === 'error').length;
    process.stdout.write(`\r  Auswertung ${done}/${files.length} …   `);
    if (done >= files.length) break;
    await sleep(1000);
  }
  const completeSec = (Date.now() - started) / 1000;
  const failed = node.store.infos().filter((v) => v.status === 'error').length;
  say(`\r  Vollständig ausgewertet nach ${completeSec.toFixed(0)} s${failed > 0 ? `, ${failed} Aufnahme(n) mit Fehler` : ''}.          `);
  const complete = await runQueries(node, queries);
  say(summary('Nach der vollständigen Auswertung', complete));
  if (complete.misses.length > 0) say(`\nOffen nach der vollständigen Auswertung:\n${complete.misses.map((m) => `  ${m}`).join('\n')}`);

  const stats = node.store.stats();
  const outFile = path.join(repoRoot, 'docs', 'measurements', 'search.json');
  await fs.writeFile(
    outFile,
    `${JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        machine: { cpu: os.cpus()[0]?.model ?? 'unknown', cores: os.cpus().length, threads: config.threads, device: shared.model.state.device },
        model: config.modelId,
        footage: { recordings: files.length, vectors: stats.vectors, firstPassSec: Math.round(firstPassSec * 10) / 10, completeSec: Math.round(completeSec) },
        queries: { file: path.relative(repoRoot, queriesFile).split(path.sep).join('/'), total: queries.length },
        firstPass: first,
        complete,
      },
      null,
      2,
    )}\n`,
  );
  say(`\nErgebnis: ${path.relative(repoRoot, outFile)}`);
  await node.stop();
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(`\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
