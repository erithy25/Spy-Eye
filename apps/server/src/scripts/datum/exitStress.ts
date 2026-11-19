/**
 * Stops the DATUM node again and again while it works, and fails if one of those stops does not
 * end cleanly (exit code 0, no abort in onnxruntime's binding, within 20 s).
 *
 * Why: a process that ends while a model thread is inside an onnxruntime run can abort (SIGABRT
 * on Linux, 0xC0000409 on Windows). The node's shutdown closes the model threads and waits until
 * they have ended before it exits; the exit drain in ml/workerHost.ts is the fallback for any
 * other exit. Both depend on timing, so they are checked many times at many moments rather than
 * once.
 *
 * Two parts:
 *   1. The real node (apps/server/dist/index.js, built) on its own port and data directory, asked
 *      to shut down the way datum.cmd's Ctrl+C or the demonstration check does (the IPC message
 *      'shutdown', which Windows can deliver where it has no catchable signal), at moments from
 *      right after the start to deep into the analysis of the reference set.
 *   2. The fallback: a script that calls process.exit in the middle of a world-model prediction.
 *
 * Usage (from apps/server, after pnpm build and pnpm datum:fetch):
 *   tsx src/scripts/datum/exitStress.ts [--node-runs 12] [--raw-runs 12] [--port 8799]
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repoRoot } from '../../config.js';

interface Outcome {
  label: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  ms: number;
  problem: string | null;
}

const ABORT = /Napi::Error|terminate called|Assertion failed|FATAL ERROR/;
const STOP_LIMIT_MS = 20_000;

function argNumber(name: string, fallback: number): number {
  const at = process.argv.indexOf(name);
  const value = at >= 0 ? Number(process.argv[at + 1]) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function exitText(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) return `signal ${signal}`;
  if (code === null) return 'no exit code';
  // Windows reports NTSTATUS values as unsigned exit codes (0xC0000409: fail-fast abort).
  return code > 0xffff ? `code ${code} (0x${code.toString(16).toUpperCase()})` : `code ${code}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One start of the node, a shutdown after `afterMs` from the moment it serves, and its exit. */
async function nodeRun(nodesFile: string, port: number, afterMs: number): Promise<Outcome> {
  const label = `node, shutdown ${Math.round(afterMs / 1000)} s after it serves`;
  const child = spawn(process.execPath, [path.join(repoRoot, 'apps', 'server', 'dist', 'index.js'), '--nodes', nodesFile], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, SICHT_OFFLINE: '1' },
  });
  let out = '';
  let err = '';
  child.stdout?.setEncoding('utf8').on('data', (d: string) => (out += d));
  child.stderr?.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));

  // Serving: the node prints its address once its HTTP server listens.
  const servingBy = Date.now() + 180_000;
  while (!out.includes(`:${port}`) && Date.now() < servingBy) {
    const early = await Promise.race([exited.then(() => true), sleep(200).then(() => false)]);
    if (early) break;
  }
  if (!out.includes(`:${port}`)) {
    child.kill();
    const end = await exited;
    return { label, code: end.code, signal: end.signal, ms: 0, problem: `did not start serving: ${out.slice(-600)} ${err.slice(-600)}` };
  }
  await Promise.race([exited, sleep(afterMs)]);
  const asked = Date.now();
  if (child.connected) child.send('shutdown');
  const limit = sleep(STOP_LIMIT_MS).then(() => null);
  const end = await Promise.race([exited, limit]);
  const ms = Date.now() - asked;
  if (!end) {
    child.kill('SIGKILL');
    await exited;
    return { label, code: null, signal: null, ms, problem: `still running ${STOP_LIMIT_MS / 1000} s after the shutdown request` };
  }
  const work = (out.match(/(Schnellortung|Ortung|Ausgewertet) [„"]/g) ?? []).length;
  const problem =
    end.code !== 0 || end.signal !== null
      ? `${exitText(end.code, end.signal)}\n${err.slice(-1500)}`
      : ABORT.test(err)
        ? `abort text on stderr: ${err.slice(-1500)}`
        : !out.includes('Beende')
          ? 'ended without "Beende …"'
          : null;
  return { label: `${label} (${work} results printed before)`, code: end.code, signal: end.signal, ms, problem };
}

/** The fallback: process.exit in the middle of a world-model prediction. */
async function rawRuns(count: number, tmp: string): Promise<Outcome[]> {
  const clip = path.join(repoRoot, 'datasets', 'datum', 'clips', 'fr-eiffel-tower.mp4');
  const frames: string[] = [];
  for (const t of [1, 3, 5, 7, 9, 11]) {
    const file = path.join(tmp, `f${t}.jpg`);
    const r = spawnSync(process.env['FFMPEG_PATH'] ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(t), '-i', clip, '-frames:v', '1', '-vf', "scale=w='min(640,iw)':h=-2", '-q:v', '3', file]);
    if (r.status !== 0) throw new Error(`ffmpeg: ${String(r.stderr)}`);
    frames.push(file);
  }
  const service = new URL('../../datum/geoclipService.ts', import.meta.url).href;
  const script = path.join(tmp, 'exit-mid-run.mts');
  await fs.writeFile(
    script,
    [
      "import fs from 'node:fs/promises';",
      `const { WorldModelService } = await import(${JSON.stringify(service)});`,
      `const frames = await Promise.all(${JSON.stringify(frames)}.map((f) => fs.readFile(f)));`,
      "const wm = new WorldModelService({ precision: 'int8' });",
      'await wm.ensureGallery();',
      'void wm.predict(frames, { wait: true });',
      'setTimeout(() => process.exit(0), Number(process.argv[2]));',
    ].join('\n'),
  );
  const outcomes: Outcome[] = [];
  for (let i = 0; i < count; i++) {
    // Spread over the prediction: right at its start up to after its end.
    const delay = Math.round(100 + (i * 3400) / Math.max(1, count - 1));
    const started = Date.now();
    const r = spawnSync(process.execPath, ['--import', 'tsx', script, String(delay)], { cwd: path.join(repoRoot, 'apps', 'server'), encoding: 'utf8', timeout: 180_000 });
    const ms = Date.now() - started;
    const problem = r.status !== 0 || r.signal !== null ? `${exitText(r.status, r.signal)}\n${(r.stderr ?? '').slice(-1500)}` : ABORT.test(r.stderr ?? '') ? `abort text on stderr: ${(r.stderr ?? '').slice(-1500)}` : null;
    outcomes.push({ label: `process.exit ${delay} ms into a prediction`, code: r.status, signal: r.signal, ms, problem });
    process.stdout.write(`  ${problem ? 'FEHLER' : 'ok    '} ${outcomes[outcomes.length - 1]?.label} · ${exitText(r.status, r.signal)}\n`);
  }
  return outcomes;
}

async function main(): Promise<void> {
  const nodeCount = argNumber('--node-runs', 12);
  const rawCount = argNumber('--raw-runs', 12);
  const port = argNumber('--port', 8799);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'datum-exit-'));
  const outcomes: Outcome[] = [];
  try {
    if (nodeCount > 0) {
      const base = JSON.parse(await fs.readFile(path.join(repoRoot, 'nodes.datum.json'), 'utf8')) as { nodes: Array<Record<string, unknown>> };
      const dataDir = path.join(tmp, 'data');
      const nodesFile = path.join(tmp, 'nodes.json');
      await fs.writeFile(nodesFile, JSON.stringify({ ...base, nodes: base.nodes.map((n) => ({ ...n, port, dataDir })) }, null, 2));
      // From right after the start (models still loading) to well into the analysis.
      const moments = [0, 1_000, 3_000, 6_000, 10_000, 15_000, 20_000, 30_000, 45_000, 60_000, 90_000, 120_000];
      for (let i = 0; i < nodeCount; i++) {
        const outcome = await nodeRun(nodesFile, port, moments[i % moments.length] ?? 10_000);
        outcomes.push(outcome);
        process.stdout.write(`  ${outcome.problem ? 'FEHLER' : 'ok    '} ${outcome.label} · ${exitText(outcome.code, outcome.signal)} · beendet in ${outcome.ms} ms\n`);
      }
    }
    if (rawCount > 0) outcomes.push(...(await rawRuns(rawCount, tmp)));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
  const failed = outcomes.filter((o) => o.problem);
  process.stdout.write(`\nErgebnis: ${outcomes.length - failed.length} von ${outcomes.length} Beendigungen sauber.\n`);
  for (const f of failed) process.stdout.write(`\n--- ${f.label}\n${f.problem}\n`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
