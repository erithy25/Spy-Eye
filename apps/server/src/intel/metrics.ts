import type { Ledger } from '../core/ledger.js';
import type { FaceDetector } from '../ml/faces.js';
import type { HazardHead } from '../ml/head.js';
import { DEFAULT_SOURCE_ID, type Store } from '../store.js';
import type { Alert, ExerciseEvaluation, Metrics } from '../types.js';
import type { ScenarioEngine } from './scenario.js';
import type { Sources } from './sources.js';
import type { WatchEngine } from './watches.js';

/** Identifier of the watch that the scenario installs for one of its watch keys. */
export function scenarioWatchId(key: string): string {
  return `wa_exercise_${key}`;
}

function percentile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx] as number;
}

/**
 * Compares the alerts of an exercise run with the events the exercise control injected.
 * An event counts as detected when the watch assigned to it raised an alert on the same source
 * after the event began. Alerts of scenario watches that belong to no event are false alarms.
 */
export function evaluateExercise(scenario: ScenarioEngine, sources: Sources, alerts: Alert[]): ExerciseEvaluation | null {
  const def = scenario.definition;
  if (!def || !scenario.isExerciseActive) return null;
  const elapsed = scenario.elapsedSec;
  const exerciseAlerts = alerts.filter((a) => a.exercise && a.exerciseSec !== null).sort((a, b) => (a.exerciseSec as number) - (b.exerciseSec as number));
  const used = new Set<string>();
  const events: ExerciseEvaluation['events'] = [];
  const latencies: number[] = [];
  const TOLERANCE = 2;

  for (const event of def.events) {
    if (event.at > elapsed) continue;
    const next = def.events
      .filter((e) => e.source === event.source && e.watch === event.watch && e.at > event.at)
      .reduce((min, e) => Math.min(min, e.at), Infinity);
    const hit = exerciseAlerts.find(
      (a) =>
        !used.has(a.id) &&
        a.sourceId === event.source &&
        a.watchId === scenarioWatchId(event.watch) &&
        (a.exerciseSec as number) >= event.at - TOLERANCE &&
        (a.exerciseSec as number) < next,
    );
    if (hit) used.add(hit.id);
    const detectedSec = hit ? (hit.exerciseSec as number) : null;
    const latencySec = detectedSec !== null ? Math.max(0, Math.round((detectedSec - event.at) * 10) / 10) : null;
    if (latencySec !== null) latencies.push(latencySec);
    events.push({
      label: event.label,
      sourceName: sources.get(event.source)?.name ?? event.source,
      onsetSec: event.at,
      detectedSec: detectedSec !== null ? Math.round(detectedSec * 10) / 10 : null,
      latencySec,
      watchName: hit ? hit.watchName : null,
    });
  }

  const scenarioWatchIds = new Set(def.watches.map((w) => scenarioWatchId(w.key)));
  const scored = exerciseAlerts.filter((a) => scenarioWatchIds.has(a.watchId));
  // An alert that continues or repeats a scripted event is not a false alarm; neither is an alert
  // of a watch the script accepts for that event (smoke at a fire, a second detector for a flood).
  const explained = (alert: Alert): boolean =>
    def.events.some(
      (e) =>
        e.source === alert.sourceId &&
        [e.watch, ...(e.accept ?? [])].some((key) => scenarioWatchId(key) === alert.watchId) &&
        (alert.exerciseSec as number) >= e.at - TOLERANCE,
    );
  latencies.sort((a, b) => a - b);
  const unexplained = scored.filter((a) => !explained(a));
  return {
    events,
    total: events.length,
    detected: events.filter((e) => e.detectedSec !== null).length,
    medianLatencySec: percentile(latencies, 0.5),
    falseAlarms: unexplained.length,
    alerts: scored.length,
    unexplained: unexplained.map((a) => ({
      watchName: a.watchName,
      watchNameEn: a.watchNameEn,
      sourceName: a.sourceName,
      exerciseSec: Math.round((a.exerciseSec as number) * 10) / 10,
      confidence: Math.round(a.confidence * 1000) / 1000,
      status: a.status,
    })),
  };
}

export function collectMetrics(deps: {
  store: Store;
  sources: Sources;
  ledger: Ledger;
  watches: WatchEngine;
  scenario: ScenarioEngine;
  faces: FaceDetector;
  hazard: HazardHead | null;
  retentionDays: number;
}): Metrics {
  const stats = deps.store.stats();
  const footage = deps.store.footage();
  const entries = deps.ledger.list({ limit: 4000 });
  const searchTimes: number[] = [];
  let blocked = 0;
  let federated = 0;
  let unmask = 0;
  for (const entry of entries) {
    if (entry.action === 'search.query') {
      const took = entry.data['tookMs'];
      if (typeof took === 'number') searchTimes.push(took);
      if (entry.data['federated'] === true) federated++;
    } else if (entry.action === 'search.refused') blocked++;
    else if (entry.action === 'privacy.unmask') unmask++;
  }
  searchTimes.sort((a, b) => a - b);
  const alerts = deps.watches.listAlerts();
  const inboxUsed = deps.store.all().some((entry) => entry.info.sourceId === DEFAULT_SOURCE_ID);
  return {
    retentionDays: deps.retentionDays,
    footageSec: Math.round(footage.footageSec),
    framesAnalysed: stats.frames,
    vectors: stats.vectors,
    // The inbox for uploads without a sensor exists on every node; it counts as a source only
    // once something has been filed there, so that an exercise with eleven sources shows eleven.
    sources: deps.sources.list().filter((source) => source.id !== DEFAULT_SOURCE_ID || inboxUsed).length,
    facesMasked: footage.facesMasked,
    maskingActive: deps.faces.ready,
    searches: {
      count: searchTimes.length,
      blocked,
      federated,
      medianMs: percentile(searchTimes, 0.5),
      p95Ms: percentile(searchTimes, 0.95),
    },
    alerts: {
      total: alerts.length,
      confirmed: alerts.filter((a) => a.status === 'confirmed').length,
      dismissed: alerts.filter((a) => a.status === 'dismissed').length,
      open: alerts.filter((a) => a.status === 'new').length,
    },
    unmaskEvents: unmask,
    ledgerEntries: deps.ledger.length,
    analysisSpeed: footage.processingSec > 0 ? Math.round((footage.footageSec / footage.processingSec) * 100) / 100 : null,
    evaluation: evaluateExercise(deps.scenario, deps.sources, alerts),
    hazardModel: deps.hazard?.card ?? null,
  };
}
