import { Collection, newId, readJson, writeFileAtomic } from '../core/json.js';
import type { Ledger } from '../core/ledger.js';
import type { EventHub } from '../events.js';
import { RELEVANCE, adaptiveCutoff } from '../ml/calibration.js';
import { BinaryHead, type HazardHead } from '../ml/head.js';
import { dotAt, sigmoid } from '../ml/math.js';
import type { EmbeddingModel } from '../ml/model.js';
import { toNormRect } from '../ml/preprocess.js';
import { frameUrl, type Store, type VideoEntry } from '../store.js';
import type { Alert, Severity, SourceKind, UserInfo, Watch, WatchPreview } from '../types.js';
import type { Incidents } from './incidents.js';
import type { Observation } from './scenario.js';
import { scoreFrame, tileOffset, type SearchScope } from './scoring.js';
import type { Sources } from './sources.js';

/**
 * Standing queries ("Wachen").
 *
 * A watch is a question that stays posted: every frame that arrives from a source is scored
 * against it, and when the answer is yes for long enough an alert is raised with the frame as
 * evidence. Text watches use the open-vocabulary encoder; hazard watches use the trained hazard
 * head.
 *
 * Analyst verdicts on alerts are kept as training examples, but nothing learns on its own: a watch
 * only changes when someone explicitly retrains it. Retraining produces a new numbered version of
 * the watch's classifier and is written to the ledger, so the behaviour of the system at any point
 * in time can be reconstructed (cf. BVerfG, 16 Feb 2023, on self-learning systems).
 */

export interface WatchInput {
  name: string;
  nameEn?: string;
  kind: 'text' | 'hazard';
  prompt: string;
  exclude: string[];
  hazardClass: string | null;
  severity: Severity;
  threshold: number;
  persistence: number;
  cooldownSec: number;
  sourceKinds: SourceKind[];
  /** Watches of one group describe the same kind of event; defaults to the watch itself. */
  group?: string;
}

const AERIAL_KINDS: readonly SourceKind[] = ['drone', 'helicopter', 'satellite'];
/** A connected stream that has delivered nothing for this long no longer keeps alerts open. */
const STREAM_SILENCE_MS = 90 * 1000;

interface Vectors {
  positive: Float32Array;
  negatives: Float32Array[];
}

interface Runtime {
  streak: number;
  alertId: string | null;
}

interface Evaluation {
  confidence: number;
  score: number;
  tile: number;
}

interface FeedbackExample {
  label: 0 | 1;
  /** base64 Float32 embedding of the tile the alert was raised on. */
  vector: string;
}

export interface WatchDeps {
  model: EmbeddingModel;
  store: Store;
  sources: Sources;
  incidents: Incidents;
  hub: EventHub;
  ledger: Ledger;
  hazard: HazardHead | null;
  /** Footage that can currently be searched; used for previews. */
  scopes: () => SearchScope[];
  /** The picture each source shows right now; a new watch is applied to it immediately. */
  currentObservations: () => Observation[];
  /** Multiplier of the exercise clock (cool-downs shrink accordingly); 1 outside exercises. */
  clockRate: () => number;
  files: { watches: string; alerts: string; feedback: string };
}

const MAX_ALERTS = 2000;
const FEEDBACK_BACKGROUND = 24;

function encodeVector(data: Float32Array, offset: number, dim: number): string {
  const copy = new Float32Array(data.subarray(offset, offset + dim));
  return Buffer.from(copy.buffer).toString('base64');
}

function decodeVector(text: string): Float32Array {
  const bytes = Buffer.from(text, 'base64');
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

export class WatchEngine {
  /** Time of the latest analysed frame per connected stream, and when it arrived. */
  private readonly streamClock = new Map<string, { at: number; wall: number }>();
  private readonly watches: Collection<Watch>;
  private readonly alerts: Collection<Alert>;
  private feedback: Record<string, FeedbackExample[]> = {};
  private readonly vectors = new Map<string, Vectors>();
  private readonly heads = new Map<string, BinaryHead>();
  private readonly runtime = new Map<string, Runtime>();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(private readonly deps: WatchDeps) {
    this.watches = new Collection<Watch>(deps.files.watches);
    this.alerts = new Collection<Alert>(deps.files.alerts);
  }

  async open(): Promise<void> {
    await this.watches.load();
    await this.alerts.load();
    this.feedback = await readJson<Record<string, FeedbackExample[]>>(this.deps.files.feedback, {});
    // Alerts cannot still be "being observed" after a restart.
    for (const alert of this.alerts.all()) {
      if (alert.active) {
        alert.active = false;
        this.alerts.touch();
      }
    }
    this.sweeper = setInterval(() => this.sweep(), 1000);
    this.sweeper.unref();
  }

  /** Embeds prompts and retrains feedback heads; call once the model is loaded. */
  async prepareAll(): Promise<void> {
    for (const watch of this.watches.all()) {
      await this.prepare(watch);
      // Restores the classifier of watches that had been retrained before the restart.
      if (watch.learned) this.retrain(watch);
    }
  }

  shutdown(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }

  listWatches(): Watch[] {
    return this.watches.all().sort((a, b) => b.severity - a.severity || a.createdAt - b.createdAt);
  }

  getWatch(id: string): Watch | undefined {
    return this.watches.get(id);
  }

  listAlerts(): Alert[] {
    return this.alerts.all().sort((a, b) => b.firstSeen - a.firstSeen);
  }

  getAlert(id: string): Alert | undefined {
    return this.alerts.get(id);
  }

  activeAlertsOf(sourceId: string): number {
    let n = 0;
    for (const alert of this.alerts.all()) if (alert.active && alert.sourceId === sourceId && alert.status !== 'dismissed') n++;
    return n;
  }

  private async prepare(watch: Watch): Promise<void> {
    if (watch.kind !== 'text' || !this.deps.model.ready) return;
    const positive = await this.deps.model.embedQuery(watch.prompt);
    const negatives: Float32Array[] = [];
    for (const phrase of watch.exclude) negatives.push(await this.deps.model.embedQuery(phrase));
    this.vectors.set(watch.id, { positive, negatives });
  }

  /** Similarity cut-off for a prompt, from the best score of every scene the node has analysed. */
  private calibrate(positive: Float32Array): number {
    const scores: number[] = [];
    for (const entry of this.deps.store.all()) {
      if (!entry.embeddings || entry.info.coarse) continue;
      const perScene = new Map<number, number>();
      for (let f = 0; f < entry.frames.length; f++) {
        const scene = (entry.frames[f] as { s: number }).s;
        const { score } = scoreFrame(entry, f, positive);
        if (score > (perScene.get(scene) ?? -1)) perScene.set(scene, score);
      }
      for (const s of perScene.values()) scores.push(s);
    }
    return adaptiveCutoff(Float64Array.from(scores), RELEVANCE[this.deps.model.family]);
  }

  async create(input: WatchInput, user: UserInfo | null, mandateId: string, id?: string): Promise<Watch> {
    const watchId = id ?? newId('wa');
    const watch: Watch = {
      id: watchId,
      group: input.group ?? watchId,
      name: input.name,
      prompt: input.prompt,
      exclude: input.exclude,
      kind: input.kind,
      hazardClass: input.hazardClass,
      severity: input.severity,
      threshold: input.threshold,
      persistence: input.persistence,
      cooldownSec: input.cooldownSec,
      sourceKinds: input.sourceKinds,
      enabled: true,
      mandateId,
      createdBy: user?.id ?? 'system',
      createdAt: Date.now(),
      cutoff: 0,
      feedback: { confirmed: 0, dismissed: 0 },
      learned: false,
      version: 1,
      pendingFeedback: 0,
      ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
    };
    this.watches.put(watch);
    await this.prepare(watch);
    this.recalibrate(watch);
    // Apply the new watch to what every source is showing at this moment …
    for (const observation of this.deps.currentObservations()) this.observeWatch(watch, observation, true);
    // … and to the recordings already in the archive, in the order they were taken.
    for (const entry of this.deps.store.all()) {
      if (entry.info.scenario !== null || entry.info.coarse || !entry.embeddings) continue;
      this.observeRecording(entry, watch);
    }
    return watch;
  }

  /** Recomputes the cut-off of a watch; call when the body of analysed footage has changed. */
  recalibrate(watch: Watch): void {
    const vectors = this.vectors.get(watch.id);
    if (watch.kind !== 'text' || !vectors) return;
    watch.cutoff = Math.round(this.calibrate(vectors.positive) * 10000) / 10000;
    this.watches.touch();
  }

  recalibrateAll(): void {
    for (const watch of this.watches.all()) this.recalibrate(watch);
  }

  update(id: string, patch: Partial<Pick<Watch, 'name' | 'threshold' | 'persistence' | 'cooldownSec' | 'severity' | 'enabled' | 'sourceKinds'>>): Watch | null {
    const watch = this.watches.get(id);
    if (!watch) return null;
    Object.assign(watch, patch);
    this.watches.touch();
    return watch;
  }

  remove(id: string): boolean {
    this.vectors.delete(id);
    this.heads.delete(id);
    delete this.feedback[id];
    for (const key of [...this.runtime.keys()]) if (key.startsWith(`${id}|`)) this.runtime.delete(key);
    return this.watches.delete(id);
  }

  /** What a prompt would match in the footage that is searchable right now. */
  async preview(prompt: string, exclude: string[]): Promise<WatchPreview> {
    const positive = await this.deps.model.embedQuery(prompt);
    const negatives: Float32Array[] = [];
    for (const phrase of exclude) negatives.push(await this.deps.model.embedQuery(phrase));
    const cutoff = this.calibrate(positive);
    const width = RELEVANCE[this.deps.model.family].width;
    const hits: { entry: VideoEntry; frameIdx: number; confidence: number; sourceId: string; at: number }[] = [];
    let framesChecked = 0;
    for (const scope of this.deps.scopes()) {
      const indices = scope.frames ?? scope.entry.frames.map((_, i) => i);
      for (const frameIdx of indices) {
        framesChecked++;
        const evaluation = this.evaluateText(scope.entry, frameIdx, { positive, negatives }, cutoff, width, null);
        if (evaluation.confidence >= 0.5) {
          hits.push({ entry: scope.entry, frameIdx, confidence: evaluation.confidence, sourceId: scope.sourceId, at: scope.timeOf(frameIdx) });
        }
      }
    }
    hits.sort((a, b) => b.confidence - a.confidence);
    const samples: WatchPreview['samples'] = [];
    const seenScenes = new Set<string>();
    for (const hit of hits) {
      const frame = hit.entry.frames[hit.frameIdx];
      if (!frame) continue;
      const sceneKey = `${hit.entry.info.id}:${frame.s}`;
      if (seenScenes.has(sceneKey)) continue;
      seenScenes.add(sceneKey);
      samples.push({
        frameUrl: frameUrl(hit.entry.info.id, frame.n),
        confidence: Math.round(hit.confidence * 1000) / 1000,
        sourceName: this.deps.sources.resolve(hit.sourceId).name,
        at: hit.at,
      });
      if (samples.length >= 8) break;
    }
    return { cutoff: Math.round(cutoff * 10000) / 10000, matches: hits.length, framesChecked, samples };
  }

  private evaluateText(
    entry: VideoEntry,
    frameIdx: number,
    vectors: Vectors,
    cutoff: number,
    width: number,
    head: BinaryHead | null,
  ): Evaluation {
    const { score, tile } = scoreFrame(entry, frameIdx, vectors.positive);
    const emb = entry.embeddings;
    if (!emb || score < 0) return { confidence: 0, score, tile };
    const offset = tileOffset(entry, frameIdx, tile);
    // A look-alike phrase that fits the same region better means this is not what was asked for.
    for (const negative of vectors.negatives) {
      if (dotAt(emb.data, offset, negative, 0, emb.dim) >= score) return { confidence: 0, score, tile };
    }
    let confidence = sigmoid((score - cutoff) / width);
    if (head) {
      // Retraining is an explicit decision of an analyst, so its result counts from the first
      // verdict on, and more with every further one. The prompt always keeps a share.
      const weight = Math.min(0.8, 0.5 + 0.05 * head.examples);
      confidence = (1 - weight) * confidence + weight * head.predict(emb.data, offset);
    }
    return { confidence, score, tile };
  }

  private evaluate(watch: Watch, entry: VideoEntry, frameIdx: number): Evaluation | null {
    if (watch.kind === 'hazard') {
      const hazard = this.deps.hazard;
      const emb = entry.embeddings;
      const cls = hazard && watch.hazardClass ? hazard.classIndex(watch.hazardClass) : -1;
      if (!hazard || !emb || cls < 0 || emb.dim !== hazard.dim) return null;
      // The model was trained on whole aerial images; crops are outside what it has seen.
      const p = hazard.classify(emb.data, tileOffset(entry, frameIdx, 0))[cls] as number;
      return { confidence: p, score: p, tile: 0 };
    }
    const vectors = this.vectors.get(watch.id);
    if (!vectors) return null;
    return this.evaluateText(
      entry,
      frameIdx,
      vectors,
      watch.cutoff,
      RELEVANCE[this.deps.model.family].width,
      this.heads.get(watch.id) ?? null,
    );
  }

  /** Scores one arriving frame against every enabled watch. */
  observe(observation: Observation): void {
    for (const watch of this.watches.all()) this.observeWatch(watch, observation, false);
  }

  /**
   * Runs an archived recording past one watch (or all), frame by frame in recording order. Alerts
   * carry the time of the footage, not the time of the scan, and end with the recording.
   */
  /**
   * Runs a finished recording past the watches, frame by frame in recording order.
   *
   * `continuous` marks a segment of a connected stream: what a watch sees at the end of one
   * segment carries over into the next, so one event yields one alert however many segments it
   * spans. For a stand-alone recording the alert ends with the recording.
   */
  observeRecording(entry: VideoEntry, only?: Watch, continuous = false): void {
    const targets = only ? [only] : this.watches.all();
    for (let f = 0; f < entry.frames.length; f++) {
      const observation: Observation = {
        sourceId: entry.info.sourceId,
        entry,
        frameIdx: f,
        at: entry.info.capturedAt + Math.round((entry.frames[f]?.t ?? 0) * 1000),
        exerciseSec: null,
      };
      for (const watch of targets) this.observeWatch(watch, observation, false);
    }
    if (continuous) {
      const last = entry.frames[entry.frames.length - 1];
      this.streamClock.set(entry.info.sourceId, {
        at: entry.info.capturedAt + Math.round((last?.t ?? 0) * 1000),
        wall: Date.now(),
      });
      return;
    }
    for (const watch of targets) {
      const key = `${watch.id}|${entry.info.sourceId}`;
      const state = this.runtime.get(key);
      const alert = state?.alertId ? this.alerts.get(state.alertId) : undefined;
      if (alert?.active) {
        alert.active = false;
        this.alerts.touch();
        this.deps.hub.broadcast({ type: 'alert', alert });
      }
      this.runtime.delete(key);
    }
  }

  private observeWatch(watch: Watch, observation: Observation, immediate: boolean): void {
    if (!watch.enabled) return;
    const source = this.deps.sources.resolve(observation.sourceId);
    if (watch.sourceKinds.length > 0 && !watch.sourceKinds.includes(source.kind)) return;
    const evaluation = this.evaluate(watch, observation.entry, observation.frameIdx);
    if (!evaluation) return;

    const key = `${watch.id}|${observation.sourceId}`;
    let state = this.runtime.get(key);
    if (!state) {
      state = { streak: 0, alertId: null };
      this.runtime.set(key, state);
    }
    const matches = evaluation.confidence >= watch.threshold;
    state.streak = matches ? state.streak + 1 : 0;
    if (!matches) return;

    const frame = observation.entry.frames[observation.frameIdx];
    if (!frame) return;
    const open = state.alertId ? this.alerts.get(state.alertId) : undefined;
    if (open?.active) {
      open.lastSeen = observation.at;
      open.frames++;
      this.deps.incidents.touch(open.incidentId, observation.at);
      if (evaluation.confidence > open.confidence + 0.02) {
        // A clearer picture of the same thing replaces the evidence frame.
        this.setEvidence(open, observation, evaluation);
        this.deps.hub.broadcast({ type: 'alert', alert: open });
      }
      this.alerts.touch();
      return;
    }
    if (state.streak < watch.persistence && !immediate) return;

    const alert: Alert = {
      id: newId('al'),
      watchId: watch.id,
      watchName: watch.name,
      watchNameEn: watch.nameEn ?? watch.name,
      exerciseSec: observation.exerciseSec,
      severity: watch.severity,
      sourceId: source.id,
      sourceName: source.name,
      ...(source.nameEn !== undefined ? { sourceNameEn: source.nameEn } : {}),
      sourceKind: source.kind,
      lat: source.lat,
      lon: source.lon,
      videoId: observation.entry.info.id,
      frameNumber: frame.n,
      frameUrl: frameUrl(observation.entry.info.id, frame.n),
      box: null,
      confidence: 0,
      score: 0,
      firstSeen: observation.at,
      lastSeen: observation.at,
      frames: state.streak,
      active: true,
      status: 'new',
      reviewedBy: null,
      incidentId: null,
      exercise: observation.exerciseSec !== null,
      group: watch.group ?? watch.id,
      secondOpinion: null,
    };
    this.setEvidence(alert, observation, evaluation);
    this.alerts.put(alert);
    state.alertId = alert.id;
    const incident = this.deps.incidents.attach(alert);
    alert.incidentId = incident?.id ?? null;
    this.trim();
    // The entry first, the display after it. An alert that cannot be written down is shown all
    // the same, because the staff has to see it; the failure is reported instead of swallowed.
    void this.deps.ledger
      .append({
        actor: 'system',
        role: 'system',
        mandateId: watch.mandateId,
        action: 'alert.raise',
        summary: `Meldung „${watch.name}“ von ${source.name} (${Math.round(alert.confidence * 100)} %)`,
        summaryEn: `Alert "${watch.nameEn ?? watch.name}" from ${source.nameEn ?? source.name} (${Math.round(alert.confidence * 100)} %)`,
        data: { alertId: alert.id, watchId: watch.id, sourceId: source.id, videoId: alert.videoId, frame: alert.frameNumber, confidence: alert.confidence },
      })
      .catch((err: unknown) => {
        console.error(`  Meldung ${alert.id} konnte nicht protokolliert werden: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => this.deps.hub.broadcast({ type: 'alert', alert }));
  }

  private setEvidence(alert: Alert, observation: Observation, evaluation: Evaluation): void {
    const { entry } = observation;
    const frame = entry.frames[observation.frameIdx];
    if (!frame) return;
    const layout = this.deps.store.layout(entry);
    const tile = evaluation.tile > 0 ? layout[evaluation.tile] : undefined;
    alert.videoId = entry.info.id;
    alert.frameNumber = frame.n;
    alert.frameUrl = frameUrl(entry.info.id, frame.n);
    alert.box = tile ? toNormRect(tile, entry.info.frameWidth, entry.info.frameHeight) : null;
    alert.confidence = Math.round(evaluation.confidence * 1000) / 1000;
    alert.score = Math.round(evaluation.score * 10000) / 10000;
    alert.secondOpinion = this.secondOpinion(alert.sourceKind, entry, observation.frameIdx);
  }

  /** The hazard model's reading of a whole aerial frame; it has not been trained on anything else. */
  private secondOpinion(kind: SourceKind, entry: VideoEntry, frameIdx: number): Alert['secondOpinion'] {
    const hazard = this.deps.hazard;
    const emb = entry.embeddings;
    if (!hazard || !emb || emb.dim !== hazard.dim || !AERIAL_KINDS.includes(kind)) return null;
    const p = hazard.classify(emb.data, tileOffset(entry, frameIdx, 0));
    let best = 0;
    for (let c = 1; c < p.length; c++) if ((p[c] as number) > (p[best] as number)) best = c;
    return { label: hazard.classes[best] as string, p: Math.round((p[best] as number) * 1000) / 1000 };
  }

  /** Ends alerts whose condition has not been seen for the watch's cool-down. */
  private sweep(): void {
    const now = Date.now();
    const rate = Math.max(1, this.deps.clockRate());
    for (const alert of this.alerts.all()) {
      if (!alert.active) continue;
      const watch = this.watches.get(alert.watchId);
      const cooldownMs = ((watch?.cooldownSec ?? 30) * 1000) / rate;
      // Alerts of a connected stream are timed on the stream's own clock, which trails the wall
      // clock by one segment and the analysis; a stream that has gone silent ends its alerts.
      const clock = alert.exercise ? undefined : this.streamClock.get(alert.sourceId);
      const ended = clock
        ? clock.at - alert.lastSeen > (watch?.cooldownSec ?? 30) * 1000 || now - clock.wall > STREAM_SILENCE_MS
        : now - alert.lastSeen > cooldownMs;
      if (ended) {
        alert.active = false;
        this.alerts.touch();
        this.deps.hub.broadcast({ type: 'alert', alert });
      }
    }
  }

  private trim(): void {
    if (this.alerts.size <= MAX_ALERTS) return;
    const oldest = this.alerts.all().sort((a, b) => a.firstSeen - b.firstSeen);
    for (const alert of oldest.slice(0, this.alerts.size - MAX_ALERTS)) this.alerts.delete(alert.id);
  }

  /** Records an analyst's verdict and trains the watch on it. */
  async review(alertId: string, verdict: 'confirmed' | 'dismissed', user: UserInfo): Promise<Alert | null> {
    const alert = this.alerts.get(alertId);
    if (!alert) return null;
    const previous = alert.status;
    alert.status = verdict;
    alert.reviewedBy = user.id;
    this.alerts.touch();
    const watch = this.watches.get(alert.watchId);
    if (watch && watch.kind === 'text' && previous !== verdict) {
      const entry = this.deps.store.get(alert.videoId);
      const frameIdx = entry ? entry.frames.findIndex((f) => f.n === alert.frameNumber) : -1;
      const vectors = this.vectors.get(watch.id);
      if (entry?.embeddings && frameIdx >= 0 && vectors) {
        const { tile } = scoreFrame(entry, frameIdx, vectors.positive);
        const examples = (this.feedback[watch.id] ??= []);
        examples.push({
          label: verdict === 'confirmed' ? 1 : 0,
          vector: encodeVector(entry.embeddings.data, tileOffset(entry, frameIdx, tile), entry.embeddings.dim),
        });
        if (previous === 'new') watch.feedback[verdict]++;
        watch.pendingFeedback = (watch.pendingFeedback ?? 0) + 1;
        await writeFileAtomic(this.deps.files.feedback, JSON.stringify(this.feedback));
        this.watches.touch();
      }
    }
    this.deps.hub.broadcast({ type: 'alert', alert });
    return alert;
  }

  /**
   * Explicit retraining step requested by a user. Returns the watch with its new version, or null
   * when there is nothing to learn from.
   */
  retrainNow(id: string): Watch | null {
    const watch = this.watches.get(id);
    if (!watch || watch.kind !== 'text' || (this.feedback[watch.id] ?? []).length === 0) return null;
    this.retrain(watch);
    watch.version = (watch.version ?? 1) + 1;
    watch.pendingFeedback = 0;
    this.watches.touch();
    return watch;
  }

  /** Removes what a watch has learned and returns it to the plain prompt. */
  resetLearning(id: string): Watch | null {
    const watch = this.watches.get(id);
    if (!watch) return null;
    delete this.feedback[watch.id];
    this.heads.delete(watch.id);
    watch.learned = false;
    watch.pendingFeedback = 0;
    watch.feedback = { confirmed: 0, dismissed: 0 };
    watch.version = (watch.version ?? 1) + 1;
    this.watches.touch();
    void writeFileAtomic(this.deps.files.feedback, JSON.stringify(this.feedback));
    return watch;
  }

  /**
   * Fits the watch's feedback classifier. Positives: confirmed alerts plus the prompt vector itself.
   * Negatives: dismissed alerts plus a sample of ordinary footage at reduced weight.
   */
  private retrain(watch: Watch): void {
    const examples = this.feedback[watch.id] ?? [];
    const vectors = this.vectors.get(watch.id);
    if (examples.length === 0 || !vectors) {
      this.heads.delete(watch.id);
      watch.learned = false;
      return;
    }
    const features: Float32Array[] = [vectors.positive];
    const labels: number[] = [1];
    const weights: number[] = [1];
    for (const example of examples) {
      features.push(decodeVector(example.vector));
      labels.push(example.label);
      weights.push(1);
    }
    // Ordinary footage as weak negatives keeps the classifier from collapsing onto few examples.
    const entries = this.deps.store.all().filter((e) => e.embeddings && e.frames.length > 0 && !e.info.coarse);
    let added = 0;
    for (let i = 0; i < entries.length && added < FEEDBACK_BACKGROUND; i++) {
      const entry = entries[(i * 7) % entries.length] as VideoEntry;
      const emb = entry.embeddings;
      if (!emb) continue;
      const frameIdx = (i * 13) % entry.frames.length;
      if (scoreFrame(entry, frameIdx, vectors.positive).score >= watch.cutoff - 0.02) continue;
      features.push(new Float32Array(emb.data.subarray(tileOffset(entry, frameIdx, 0), tileOffset(entry, frameIdx, 0) + emb.dim)));
      labels.push(0);
      weights.push(0.3);
      added++;
    }
    const head = BinaryHead.train(features, labels, weights);
    this.heads.set(watch.id, new BinaryHead(head.weights, head.bias, examples.length));
    watch.learned = true;
  }

  /** Discards the alerts of an exercise run and the transient state of all watches. */
  clearExercise(): void {
    for (const alert of this.alerts.all()) if (alert.exercise) this.alerts.delete(alert.id);
    this.runtime.clear();
  }

  async flush(): Promise<void> {
    await this.watches.flush();
    await this.alerts.flush();
  }
}
