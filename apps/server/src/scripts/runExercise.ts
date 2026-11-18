/**
 * Runs the exercise scenario without a console and reports what the watches found.
 *
 *   pnpm exercise:evaluate [--speed 8] [--data .cache/exercise-eval] [--keep] [--require 12] [--max-false 1]
 *
 * Installs the scenario footage into a scratch node, waits for the analysis, plays the exercise
 * on the accelerated clock and compares the alerts with the events of the script. The result is
 * printed and written to docs/measurements/exercise.json, so that every figure quoted about the
 * exercise can be reproduced on the machine it is quoted for.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config, repoRoot } from '../config.js';
import { evaluateExercise } from '../intel/metrics.js';
import { PlatformNode } from '../node.js';
import { createSharedRuntime } from '../runtime.js';

function argument(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  const value = idx >= 0 ? process.argv[idx + 1] : undefined;
  return value !== undefined && !value.startsWith('--') ? value : fallback;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const say = (line: string): void => void process.stdout.write(`${line}\n`);

async function main(): Promise<void> {
  const speed = Number(argument('speed', '8'));
  const dataDir = path.resolve(repoRoot, argument('data', path.join('.cache', 'exercise-eval')));
  const keep = process.argv.includes('--keep');
  if (![1, 2, 4, 8].includes(speed)) throw new Error('--speed must be 1, 2, 4 or 8');
  if (!keep) await fs.rm(dataDir, { recursive: true, force: true });

  const shared = await createSharedRuntime(say);
  const node = new PlatformNode(
    { id: 'messlauf', name: 'Messlauf', operator: 'Messlauf', region: '', lat: 50.3569, lon: 7.589, host: '127.0.0.1', port: 0, dataDir, peers: [] },
    shared,
  );
  await node.start(false);
  await shared.ready;
  await node.settled;

  const definition = node.scenario.definition;
  if (!definition) throw new Error('Keine Übungsdefinition gefunden (scenarios/*/scenario.json).');

  const installStarted = Date.now();
  if (node.scenario.info().status === 'absent') await node.scenario.installFootage();
  for (;;) {
    const info = node.scenario.info();
    if (info.problem) throw new Error(info.problem);
    if (info.status === 'ready') break;
    process.stdout.write(`\r  Analyse ${info.clipsReady}/${info.clipsTotal} Aufnahmen …   `);
    await sleep(1000);
  }
  const analysisSec = (Date.now() - installStarted) / 1000;
  const clips = [...node.scenario.clipIds()].map((id) => node.store.get(id)).filter((e) => e !== undefined);
  const footageSec = clips.reduce((sum, e) => sum + (e.info.durationSec ?? 0), 0);
  const frames = clips.reduce((sum, e) => sum + e.info.framesIndexed, 0);
  const faces = clips.reduce((sum, e) => sum + e.info.facesMasked, 0);
  say(`\r  ${clips.length} Aufnahmen, ${footageSec.toFixed(0)} s Material, ${frames} Bilder im Verzeichnis, ${faces} Gesichter maskiert.`);
  if (analysisSec > 5) say(`  Analyse: ${analysisSec.toFixed(0)} s (${(footageSec / analysisSec).toFixed(1)}-fache Echtzeit)`);

  // Watches derive their cut-off from the indexed footage, so they are calibrated once it is complete.
  await sleep(1500);
  await node.settled;
  node.watches.recalibrateAll();

  node.scenario.start(speed);
  say(`  Übung „${definition.title}“ läuft mit ${speed}-facher Geschwindigkeit (${definition.durationSec} s Übungszeit) …`);
  for (;;) {
    const info = node.scenario.info();
    if (info.status === 'finished') break;
    process.stdout.write(`\r  T+${String(Math.floor(info.elapsedSec)).padStart(3)} s · ${node.watches.listAlerts().length} Meldungen   `);
    await sleep(500);
  }
  await sleep(1500);

  const alerts = node.watches.listAlerts();
  const evaluation = evaluateExercise(node.scenario, node.sources, alerts);
  if (!evaluation) throw new Error('Keine Auswertung verfügbar.');
  const incidents = node.incidents.list();

  say('\r                                                        ');
  say('Ereignis                                                  Quelle                        Beginn  Meldung  Verzug');
  for (const e of evaluation.events) {
    say(
      `${e.label.padEnd(57).slice(0, 57)} ${e.sourceName.padEnd(29).slice(0, 29)} ${String(e.onsetSec).padStart(5)}s ${
        e.detectedSec === null ? '     —' : `${e.detectedSec.toFixed(0).padStart(5)}s`
      } ${e.latencySec === null ? '     —' : `${e.latencySec.toFixed(1).padStart(5)}s`}`,
    );
  }
  say('');
  say(`Erkannt: ${evaluation.detected}/${evaluation.total} · Verzug (Median): ${evaluation.medianLatencySec ?? '—'} s · Fehlmeldungen: ${evaluation.falseAlarms} · Meldungen gesamt: ${evaluation.alerts} · Lagen: ${incidents.length}`);

  const scenarioAlerts = alerts
    .filter((a) => a.exercise)
    .sort((a, b) => (a.exerciseSec ?? 0) - (b.exerciseSec ?? 0))
    .map((a) => ({
      at: a.exerciseSec,
      watch: a.watchName,
      source: a.sourceName,
      confidence: Math.round(a.confidence * 1000) / 1000,
      score: Math.round(a.score * 10000) / 10000,
      frames: a.frames,
      explained: definition.events.some(
        (e) => e.source === a.sourceId && [e.watch, ...(e.accept ?? [])].some((key) => `wa_exercise_${key}` === a.watchId) && (a.exerciseSec ?? 0) >= e.at - 2,
      ),
    }));
  say('');
  say('Meldungen:');
  for (const a of scenarioAlerts) {
    say(`  T+${String(Math.round(a.at ?? 0)).padStart(3)}s  ${a.explained ? ' ' : '!'} ${a.watch.padEnd(34).slice(0, 34)} ${a.source.padEnd(30).slice(0, 30)} p=${a.confidence.toFixed(2)} s=${a.score.toFixed(3)} n=${a.frames}`);
  }

  const result = {
    measuredAt: new Date().toISOString(),
    machine: { cpu: os.cpus()[0]?.model ?? 'unknown', cores: os.cpus().length, threads: config.threads, device: shared.model.state.device },
    model: config.modelId,
    scenario: { id: definition.id, title: definition.title, durationSec: definition.durationSec, speed },
    footage: { clips: clips.length, seconds: Math.round(footageSec), framesIndexed: frames, facesMasked: faces },
    analysis: analysisSec > 5 ? { seconds: Math.round(analysisSec), realtimeFactor: Math.round((footageSec / analysisSec) * 10) / 10 } : null,
    evaluation,
    incidents: incidents.map((i) => ({ title: i.title, place: i.place, mgrs: i.mgrs, alerts: i.alertIds.length, corroboration: i.corroboration })),
    alerts: scenarioAlerts,
  };
  const outFile = path.join(repoRoot, 'docs', 'measurements', 'exercise.json');
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, `${JSON.stringify(result, null, 2)}\n`);
  say(`\nErgebnis: ${path.relative(repoRoot, outFile)}`);

  await node.stop();
  // For automated runs: fail when fewer events were recognised, or more false alerts raised, than asked for.
  const required = Number(argument('require', '0'));
  if (Number.isFinite(required) && required > 0 && evaluation.detected < required) {
    say(`Erwartet waren mindestens ${required} erkannte Ereignisse, erkannt wurden ${evaluation.detected}.`);
    process.exit(1);
  }
  const allowedFalse = Number(argument('max-false', '-1'));
  if (Number.isFinite(allowedFalse) && allowedFalse >= 0 && evaluation.falseAlarms > allowedFalse) {
    say(`Erwartet waren höchstens ${allowedFalse} Fehlmeldungen, gemeldet wurden ${evaluation.falseAlarms}.`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err: unknown) => {
  process.stderr.write(`\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
