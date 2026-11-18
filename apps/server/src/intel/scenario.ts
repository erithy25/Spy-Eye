import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeFileAtomic } from '../core/json.js';
import type { EventHub } from '../events.js';
import type { Pipeline } from '../pipeline.js';
import { frameUrl, type Store, type VideoEntry } from '../store.js';
import type { DetailLevel, FeedState, ScenarioInfo, Severity, SourceKind } from '../types.js';
import type { SearchScope } from './scoring.js';
import type { Sources } from './sources.js';

/**
 * Exercise scenarios.
 *
 * A scenario is a script: sources at fixed positions, each with a playlist of recorded clips on a
 * common clock, plus the list of events an evaluator expects to be found. The clips are analysed
 * once when the scenario is installed. While the exercise runs, the engine reveals their frames in
 * real time as if they were arriving from the field, so watches, alerts and searches behave exactly
 * as in live operation, on a reproducible timeline with known ground truth.
 */

export interface ScenarioDefinition {
  id: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  durationSec: number;
  center: { lat: number; lon: number; zoom: number };
  /** Sampling for the clips of this scenario. */
  sampleFps: number;
  detail: DetailLevel;
  mandate: { title: string; titleEn: string; legalBasis: string; purpose: string; issuedBy: string };
  sources: {
    id: string;
    name: string;
    nameEn: string;
    kind: SourceKind;
    owner: string;
    description: string;
    lat: number;
    lon: number;
    /** What the source shows from which second of the exercise on; the last entry runs to the end. */
    playlist: { at: number; clip: string; loop?: boolean }[];
  }[];
  /** Clip key -> file name inside the scenario's clips/ directory, with provenance. */
  clips: Record<string, { file: string; credit: string; url: string }>;
  /** Events the exercise control injects; the ground truth for the evaluation. */
  events: {
    at: number;
    source: string;
    label: string;
    labelEn: string;
    /** Watch that is expected to report the event. */
    watch: string;
    /** Further watches for which a report on this event is correct (e.g. smoke at a fire). */
    accept?: string[];
  }[];
  watches: {
    key: string;
    name: string;
    nameEn: string;
    kind: 'text' | 'hazard';
    prompt: string;
    exclude: string[];
    hazardClass: string | null;
    severity: Severity;
    threshold: number;
    persistence: number;
    cooldownSec: number;
    sourceKinds: SourceKind[];
    /** Watches with the same group describe the same kind of event and share incidents. */
    group?: string;
  }[];
}

export interface Observation {
  sourceId: string;
  entry: VideoEntry;
  frameIdx: number;
  /** Wall-clock time of the observation (epoch ms). */
  at: number;
  /** Seconds on the exercise clock; null for footage outside an exercise. */
  exerciseSec: number | null;
}

interface Track {
  sourceId: string;
  /** `${videoId}:${frameIdx}` of the picture currently shown. */
  currentKey: string | null;
  current: { entry: VideoEntry; frameIdx: number; at: number } | null;
  /** Frames revealed so far, per recording, with the time they were last seen. */
  observed: Map<string, Map<number, number>>;
}

interface InstallState {
  scenarioId: string;
  clips: Record<string, string>;
}

const TICK_MS = 250;

export interface ScenarioDeps {
  store: Store;
  sources: Sources;
  pipeline: Pipeline;
  hub: EventHub;
  scenariosDir: string;
  stateFile: string;
  onObservation: (observation: Observation) => void;
  /** Called when exercise results are discarded (stop / restart). */
  onReset: () => void;
  /** Called once after installation with the scenario's mandate and default watches. */
  onInstalled: (definition: ScenarioDefinition) => void;
  activeAlerts: (sourceId: string) => number;
  log: (message: string) => void;
}

export class ScenarioEngine {
  definition: ScenarioDefinition | null = null;
  private install: InstallState | null = null;
  private status: ScenarioInfo['status'] = 'absent';
  private problem: string | null = null;
  private speed = 1;
  /** Exercise seconds accumulated before the current run segment. */
  private baseSec = 0;
  /** Wall time at which the current run segment began; null while not running. */
  private segmentStart: number | null = null;
  private startedAt: number | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly tracks = new Map<string, Track>();

  constructor(private readonly deps: ScenarioDeps) {}

  /** Loads the first scenario definition found and restores the installation state. */
  async open(): Promise<void> {
    let dirs: string[] = [];
    try {
      dirs = (await fs.readdir(this.deps.scenariosDir, { withFileTypes: true }))
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
    } catch {
      dirs = [];
    }
    for (const dir of dirs) {
      const definition = await readJson<ScenarioDefinition | null>(
        path.join(this.deps.scenariosDir, dir, 'scenario.json'),
        null,
      );
      if (definition) {
        this.definition = definition;
        break;
      }
    }
    if (!this.definition) {
      this.problem = 'Keine Übungsdefinition gefunden.';
      return;
    }
    const saved = await readJson<InstallState | null>(this.deps.stateFile, null);
    if (saved && saved.scenarioId === this.definition.id) {
      const complete = Object.keys(this.definition.clips).every((key) => {
        const id = saved.clips[key];
        return id !== undefined && this.deps.store.get(id) !== undefined;
      });
      if (complete) this.install = saved;
    }
    this.refreshStatus();
  }

  private clipEntry(key: string): VideoEntry | undefined {
    const id = this.install?.clips[key];
    return id ? this.deps.store.get(id) : undefined;
  }

  private clipCounts(): { total: number; ready: number; failed: string | null } {
    const keys = Object.keys(this.definition?.clips ?? {});
    let ready = 0;
    let failed: string | null = null;
    for (const key of keys) {
      const entry = this.clipEntry(key);
      if (entry?.info.status === 'ready') ready++;
      if (entry?.info.status === 'error') failed = `${key}: ${entry.info.error ?? 'Fehler'}`;
    }
    return { total: keys.length, ready, failed };
  }

  /** Moves between absent / installing / ready according to the clips' analysis state. */
  private refreshStatus(): void {
    if (!this.definition) return;
    if (this.status === 'running' || this.status === 'paused' || this.status === 'finished') return;
    if (!this.install) {
      this.status = 'absent';
      return;
    }
    const counts = this.clipCounts();
    this.problem = counts.failed;
    this.status = counts.ready === counts.total ? 'ready' : 'installing';
  }

  get elapsedSec(): number {
    const running = this.segmentStart !== null ? ((Date.now() - this.segmentStart) / 1000) * this.speed : 0;
    const total = this.baseSec + running;
    return this.definition ? Math.min(total, this.definition.durationSec) : total;
  }

  get isExerciseActive(): boolean {
    return this.status === 'running' || this.status === 'paused' || this.status === 'finished';
  }

  info(): ScenarioInfo {
    this.refreshStatus();
    const def = this.definition;
    const counts = this.clipCounts();
    return {
      id: def?.id ?? '',
      title: def?.title ?? '',
      titleEn: def?.titleEn ?? '',
      description: def?.description ?? '',
      descriptionEn: def?.descriptionEn ?? '',
      durationSec: def?.durationSec ?? 0,
      status: this.status,
      clipsTotal: counts.total,
      clipsReady: counts.ready,
      elapsedSec: Math.round(this.elapsedSec * 10) / 10,
      speed: this.speed,
      startedAt: this.startedAt,
      center: def?.center ?? { lat: 51, lon: 10, zoom: 6 },
      problem: this.problem,
    };
  }

  /** Copies the scenario's clips into the node, registers its sources and queues the analysis. */
  async installFootage(): Promise<void> {
    const def = this.definition;
    if (!def) throw new Error('Keine Übungsdefinition gefunden.');
    if (this.install) return;
    const clipsDir = path.join(this.deps.scenariosDir, def.id, 'clips');
    const missing: string[] = [];
    for (const clip of Object.values(def.clips)) {
      try {
        await fs.access(path.join(clipsDir, clip.file));
      } catch {
        missing.push(clip.file);
      }
    }
    if (missing.length > 0) {
      this.problem = `Übungsmaterial fehlt (${missing.length} Datei(en), z. B. ${missing[0]}). Mit "pnpm exercise:fetch" laden.`;
      throw new Error(this.problem);
    }

    this.deps.sources.removeByMode('exercise');
    for (const source of def.sources) {
      this.deps.sources.create({
        id: source.id,
        name: source.name,
        nameEn: source.nameEn,
        kind: source.kind,
        owner: source.owner,
        description: source.description,
        lat: source.lat,
        lon: source.lon,
        mode: 'exercise',
        shared: true,
      });
    }

    const owner = new Map<string, string>();
    for (const source of def.sources) for (const item of source.playlist) owner.set(item.clip, source.id);

    const clips: Record<string, string> = {};
    for (const [key, clip] of Object.entries(def.clips)) {
      const id = await this.deps.store.allocate();
      const ext = path.extname(clip.file).toLowerCase() || '.mp4';
      const sourceFile = `source${ext}`;
      const target = path.join(this.deps.store.videoDir(id), sourceFile);
      await fs.copyFile(path.join(clipsDir, clip.file), target);
      const { size } = await fs.stat(target);
      const entry = this.deps.store.register({
        id,
        name: clip.file,
        sourceFile,
        sizeBytes: size,
        sampleFps: def.sampleFps,
        detail: def.detail,
        sourceId: owner.get(key) ?? def.sources[0]?.id ?? 'eingang',
        scenario: def.id,
      });
      await this.deps.store.persistMeta(entry);
      clips[key] = id;
      this.deps.pipeline.enqueue(id);
    }
    this.install = { scenarioId: def.id, clips };
    await writeFileAtomic(this.deps.stateFile, JSON.stringify(this.install));
    this.problem = null;
    this.status = 'installing';
    this.deps.onInstalled(def);
    this.deps.log(`Exercise "${def.title}": ${Object.keys(clips).length} clips queued for analysis`);
    this.broadcast();
  }

  start(speed: number): void {
    this.refreshStatus();
    if (this.status !== 'ready' && this.status !== 'finished') {
      throw new Error('Die Übung kann erst gestartet werden, wenn das Material vollständig analysiert ist.');
    }
    this.resetRun();
    this.speed = speed;
    this.baseSec = 0;
    this.segmentStart = Date.now();
    this.startedAt = this.segmentStart;
    this.status = 'running';
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  pause(): void {
    if (this.status !== 'running') return;
    this.baseSec = this.elapsedSec;
    this.segmentStart = null;
    this.status = 'paused';
    this.broadcast();
  }

  resume(speed?: number): void {
    if (this.status !== 'paused') return;
    if (speed !== undefined) this.speed = speed;
    this.segmentStart = Date.now();
    this.status = 'running';
    this.broadcast();
  }

  /** Changes the clock rate without a jump in exercise time. */
  setSpeed(speed: number): void {
    if (this.status === 'running') {
      this.baseSec = this.elapsedSec;
      this.segmentStart = Date.now();
    }
    this.speed = speed;
    this.broadcast();
  }

  /** Ends the exercise and discards what it produced. */
  stop(): void {
    if (!this.isExerciseActive) return;
    this.resetRun();
    this.status = 'ready';
    this.refreshStatus();
    this.broadcast();
  }

  private resetRun(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.tracks.clear();
    this.baseSec = 0;
    this.segmentStart = null;
    this.startedAt = null;
    this.deps.onReset();
  }

  shutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private track(sourceId: string): Track {
    let track = this.tracks.get(sourceId);
    if (!track) {
      track = { sourceId, currentKey: null, current: null, observed: new Map() };
      this.tracks.set(sourceId, track);
    }
    return track;
  }

  private tick(): void {
    const def = this.definition;
    if (!def || this.status !== 'running') return;
    const elapsed = this.elapsedSec;
    const now = Date.now();
    let changed = false;

    for (const source of def.sources) {
      let item: ScenarioDefinition['sources'][number]['playlist'][number] | null = null;
      for (const candidate of source.playlist) if (candidate.at <= elapsed) item = candidate;
      if (!item) continue;
      const entry = this.clipEntry(item.clip);
      if (!entry || entry.info.status !== 'ready' || entry.frames.length === 0) continue;

      const lastFrame = entry.frames[entry.frames.length - 1] as { t: number };
      const duration = Math.max(entry.info.durationSec ?? 0, lastFrame.t + 1 / entry.info.sampleFps);
      let pos = elapsed - item.at;
      pos = item.loop === false ? Math.min(pos, duration - 0.001) : pos % duration;

      // Last frame whose timestamp is not after the playback position.
      let lo = 0;
      let hi = entry.frames.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((entry.frames[mid] as { t: number }).t <= pos) lo = mid;
        else hi = mid - 1;
      }
      const frameIdx = lo;
      const key = `${entry.info.id}:${frameIdx}`;
      const track = this.track(source.id);
      if (track.currentKey === key) continue;

      // At higher clock rates a tick can pass several frames; none of them may be skipped.
      const previous = track.current;
      const from =
        previous && previous.entry === entry && frameIdx > previous.frameIdx ? previous.frameIdx + 1 : frameIdx;
      for (let idx = from; idx <= frameIdx; idx++) {
        let seen = track.observed.get(entry.info.id);
        if (!seen) {
          seen = new Map();
          track.observed.set(entry.info.id, seen);
        }
        seen.set(idx, now);
        this.deps.onObservation({ sourceId: source.id, entry, frameIdx: idx, at: now, exerciseSec: elapsed });
      }
      track.currentKey = key;
      track.current = { entry, frameIdx, at: now };
      changed = true;
    }

    if (elapsed >= def.durationSec) {
      this.baseSec = def.durationSec;
      this.segmentStart = null;
      this.status = 'finished';
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      changed = true;
    }
    if (changed || Math.floor(elapsed * 2) % 2 === 0) this.broadcast();
  }

  feeds(): FeedState[] {
    const def = this.definition;
    if (!def || !this.install) return [];
    return def.sources.map((source): FeedState => {
      const track = this.tracks.get(source.id);
      const current = track?.current ?? null;
      const frame = current ? current.entry.frames[current.frameIdx] : undefined;
      const scene = current && frame ? current.entry.scenes[frame.s] : undefined;
      return {
        sourceId: source.id,
        online: current !== null,
        videoId: current ? current.entry.info.id : null,
        frameNumber: frame ? frame.n : null,
        frameUrl: current && frame ? frameUrl(current.entry.info.id, frame.n) : null,
        at: current ? current.at : null,
        label: scene?.tags[0]?.label ?? '',
        activeAlerts: this.deps.activeAlerts(source.id),
      };
    });
  }

  private broadcast(): void {
    this.deps.hub.broadcast({ type: 'feeds', feeds: this.feeds(), scenario: this.info() });
  }

  /** Frames of the exercise that have been revealed so far. */
  scopes(): SearchScope[] {
    const scopes: SearchScope[] = [];
    for (const track of this.tracks.values()) {
      for (const [videoId, seen] of track.observed) {
        const entry = this.deps.store.get(videoId);
        if (!entry) continue;
        scopes.push({
          entry,
          sourceId: track.sourceId,
          frames: [...seen.keys()].sort((a, b) => a - b),
          timeOf: (frameIdx) => seen.get(frameIdx) ?? Date.now(),
        });
      }
    }
    return scopes;
  }

  /** Recordings that belong to the installed exercise. */
  clipIds(): Set<string> {
    return new Set(Object.values(this.install?.clips ?? {}));
  }

  /** Removes the exercise footage and its sources from the node. */
  async uninstall(): Promise<void> {
    this.stop();
    for (const id of this.clipIds()) {
      this.deps.pipeline.cancel(id);
      await this.deps.store.remove(id);
    }
    this.deps.sources.removeByMode('exercise');
    this.install = null;
    await fs.rm(this.deps.stateFile, { force: true });
    this.status = 'absent';
    this.broadcast();
  }
}
