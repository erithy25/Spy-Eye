/**
 * DATUM engine: turns a recording into a fix — where and when it was recorded, the sun at that
 * moment, the camera's heading, the terrain horizon, and walkable spaces built from keyframes.
 *
 * Two stages, one recording at a time, in the background:
 *
 *   quick  As soon as a recording is stored (upload, seed footage), it is located from the file
 *          alone: twelve frames sampled straight from the video, the reference gallery, the
 *          country prior, the light and the sun. No walkable space and no horizon, because those
 *          need the analysis frames (face-masked and served). This takes seconds, however long
 *          the video is, while the full analysis of a long video takes minutes.
 *   full   When the analysis pipeline reports the recording ready, the fix is computed again
 *          with spaces and horizon. The sampled frames of the quick stage are reused, so its
 *          localisation is the same and is not computed twice.
 *
 * The world model (GeoCLIP, geoclipService.ts) looks at the quick stage's frames in a thread of
 * its own while the image model embeds them; the full stage takes its prediction over. Without
 * its weights, or while its place gallery is still being computed once (40-50 s on a fresh
 * machine), a fix is located without it and its trace says so; a fix computed during that build
 * is computed again once the gallery is ready.
 *
 * The full stage then compares the frames with public street-level pictures around a recognised
 * place (streetlevel.ts, when the node's setting allows it and the node is not offline), while it
 * builds the spaces; a match pins the place to a street before the horizon and the time are
 * computed. The stage has a budget of 20 s, and the engine waits no longer than that (plus half a
 * second): a slow, failing or unreachable service costs the fix the refinement, never the fix.
 *
 * Quick jobs go before full ones, and recordings a person has queued before background work
 * (the seeded reference set). A fix is written next to the recording (`<videoDir>/datum/fix.json`)
 * and broadcast to the console. Everything is computed on this machine; the street-level services
 * learn only which area is searched.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { writeFileAtomic } from '../core/json.js';
import type { EventHub } from '../events.js';
import type { EmbeddingModel } from '../ml/model.js';
import type { Store, VideoEntry } from '../store.js';
import { haversineKm } from '../core/geo.js';
import type { Evidence, Fix, FixLocation, Keyframe, TimeEstimate, TraceStep } from './contract.js';
import { truthForName } from './dataset.js';
import { Gallery } from './gallery.js';
import { acquireWorldModel, releaseWorldModel, worldModelPrecision, WorldModelService, type WorldModel, type WorldModelResult } from './geoclipService.js';
import { reportWorldModel, streetLevelEnabled } from './settings.js';
import {
  applyStreetLevel,
  DEFAULT_STREETLEVEL_OPTIONS,
  refineStreetLevel,
  streetLevelCutOff,
  streetLevelEvidence,
  streetLevelNote,
  streetLevelPlan,
  withStreetImagePaths,
  type StreetLevelDeps,
  type StreetLevelInput,
  type StreetLevelOptions,
  type StreetLevelResult,
} from './streetlevel.js';
import { breathe, locate, sampleAndEmbedFrames, type LocateResult, type SampledFrames } from './locate.js';
import { filenameHints, readMetadata, type VideoMetadata } from './metadata.js';
import { DAY_LABELS_EN, estimateTime, frameStatsFromJpeg, type FrameStats } from './time.js';
import { estimateDisparity } from './depth.js';
import { buildSpaceGrid } from './space.js';
import { terrainAvailable } from './terrain.js';
import { horizonProfile, refinePosition } from './horizon.js';
import { truthKey, type TruthBook } from './truth.js';
import { ENGINE_VERSION, OLDEST_SHOWN_VERSION } from './version.js';

/** Frames whose whole-frame and crop vectors go into the localisation (as in the evaluation). */
const LOCATE_FRAMES = 12;
const SPACE_FRAMES = 3;
/**
 * Sampled frames kept from the quick stage for the full one (about 0.2 MB each). Beyond this the
 * oldest are dropped; the full stage then samples again, with the same result.
 */
const SAMPLED_CACHE = 96;

/**
 * A fix as written to disk. `worldModel: 'building'` marks one located while the world model's
 * gallery was still being computed: it is computed again (see DatumEngine.init).
 */
type StoredFix = Fix & { engineVersion: number; worldModel?: 'building' };

export type JobKind = 'quick' | 'full';

interface Job {
  id: string;
  kind: JobKind;
  background: boolean;
  seq: number;
}

/**
 * Order of the engine's queue: a quick fix for something a person brought in comes first, then
 * that recording's full fix, then the quick and full fixes of background work (the seeded
 * reference set). Lower runs first; jobs of one rank run in the order they came.
 */
export function jobRank(job: { kind: JobKind; background: boolean }): number {
  if (!job.background) return job.kind === 'quick' ? 0 : 1;
  return job.kind === 'quick' ? 2 : 3;
}

export interface DatumEngineOptions {
  store: Store;
  model: EmbeddingModel;
  hub: EventHub;
  gallery: () => Promise<Gallery>;
  log: (message: string) => void;
  /** Leave the reference picture of the same place out (evaluation of unknown places). */
  holdout: boolean;
  onFix?: (fix: Fix) => void;
  /** Own ground truths (POST /api/datum/truth); without it only the reference set has a truth. */
  truths?: TruthBook;
  /** Whether a recording is background work (seeded reference footage) rather than a person's. */
  background?: (videoId: string) => boolean;
  /**
   * Whether other work on this machine for a person's recording is running (the analysis
   * pipeline). Background jobs wait while it is, so the person's recording has every core.
   */
  foregroundElsewhere?: () => boolean;
  /**
   * The world model. Absent: the process-wide GeoCLIP thread (acquireWorldModel); null: none
   * (every fix says so in its trace). Tests give a stand-in.
   */
  worldModel?: WorldModel | null;
  /** The street-level comparison of the full stage; absent: the node's settings and the network. */
  streetLevel?: StreetLevelHooks;
}

/** What tests replace of the street-level comparison (streetlevel.ts). */
export interface StreetLevelHooks {
  /**
   * Whether the full stage may ask street-level services. Default: the node's setting
   * (settings.ts streetLevelEnabled), and never in offline mode (SICHT_OFFLINE).
   */
  enabled?: () => boolean;
  /** Network of the stage (a mock fetch, a resolver stub) and the Mapillary key. */
  deps?: Pick<StreetLevelDeps, 'fetch' | 'lookup' | 'mapillaryKey'>;
  options?: Partial<StreetLevelOptions>;
  /** The stage itself (default refineStreetLevel). */
  refine?: (input: StreetLevelInput, deps: StreetLevelDeps) => Promise<StreetLevelResult>;
}

/**
 * How long the engine waits for the street-level stage beyond the stage's own budget: the stage
 * stops its network work at budget − reserve and decides within the reserve; this margin only
 * catches a step that cannot be interrupted (the image model, the disk) running late.
 */
const STREET_GRACE_MS = 500;

/** How often a waiting background job looks again whether it may run. */
const BACKGROUND_POLL_MS = 500;

function emptyTime(): TimeEstimate {
  return {
    method: 'none',
    utc: null,
    date: null,
    dateSource: 'none',
    monthRange: null,
    timezone: null,
    windows: [],
    sunElevationBand: null,
    phase: 'unknown',
    confidence: 0,
    notes: [],
    notesEn: [],
  };
}

function pending(videoId: string): Fix {
  return {
    videoId,
    status: 'pending',
    error: null,
    computedAt: 0,
    elapsedMs: 0,
    location: null,
    candidates: [],
    countries: [],
    time: emptyTime(),
    sun: null,
    heading: null,
    horizon: null,
    evidence: [],
    keyframes: [],
    truth: null,
  };
}

/** The skyline of a keyframe as a candidate for the horizon match. */
export interface SkyCandidate {
  skyline: number[];
  /** Width / height of the frame. */
  aspect: number;
  /** Keyframe.frame */
  frame: number;
  /** Share of the frame that is sky (0..1). */
  skyFraction: number;
}

/**
 * The keyframe whose skyline goes into the horizon match: of those with more than 5 % sky, the
 * one with the most (the earlier one on a tie). More sky usually means more columns whose
 * boundary is terrain, and too few of them give no match at all.
 */
export function moreSky(best: SkyCandidate | null, candidate: SkyCandidate): SkyCandidate | null {
  if (candidate.skyFraction <= 0.05) return best;
  return !best || candidate.skyFraction > best.skyFraction ? candidate : best;
}

/** Evenly spread indices into `frames`, avoiding the very first and last frame. */
function spread(count: number, wanted: number): number[] {
  if (count <= 0) return [];
  if (count <= wanted) return Array.from({ length: count }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < wanted; i++) out.push(Math.min(count - 1, Math.round(((i + 0.5) / wanted) * (count - 1))));
  return [...new Set(out)];
}

/** A text in both languages. */
interface Named {
  de: string;
  en: string;
}

/** What the trace says about the file's own tags. */
function metadataNote(meta: VideoMetadata | null): Named {
  if (meta?.location) return { de: 'GPS in der Datei', en: 'GPS in the file' };
  if (meta?.creationUtc) return { de: 'Aufnahmezeit in der Datei', en: 'Recording time in the file' };
  if (meta?.creationDate) return { de: 'Aufnahmedatum ohne Uhrzeit in der Datei', en: 'Recording date without a time of day in the file' };
  return { de: 'kein Ort, keine Zeit in der Datei', en: 'no place and no time in the file' };
}

/** "± 800 m", "± 25 km" after the place, in both languages. */
function placeNote(location: FixLocation | null, gallerySize: number): Named {
  const radius = (r: number): string => (r < 1 ? `${Math.round(r * 1000)} m` : `${Math.round(r).toLocaleString('de-DE')} km`);
  const radiusEn = (r: number): string => (r < 1 ? `${Math.round(r * 1000)} m` : `${Math.round(r).toLocaleString('en-GB')} km`);
  return {
    de: `${gallerySize.toLocaleString('de-DE')} Referenzbilder · ${location ? `${location.label}, ± ${radius(location.radiusKm)}` : 'kein Ort'}`,
    en: `${gallerySize.toLocaleString('en-GB')} reference pictures · ${location ? `${location.labelEn ?? location.label}, ± ${radiusEn(location.radiusKm)}` : 'no place'}`,
  };
}

/** The time of a fix as evidence: the clock (from metadata or the sun) and the season. */
export function timeEvidence(time: TimeEstimate): Evidence[] {
  const out: Evidence[] = [];
  if (time.method !== 'none' && time.windows.length > 0) {
    const fromMetadata = time.method === 'metadata';
    out.push({
      kind: fromMetadata ? 'metadata' : 'sun',
      label: fromMetadata ? 'Aufnahmezeit aus den Metadaten' : `Sonnenhöhe ${bandText(time.sunElevationBand)}`,
      labelEn: fromMetadata ? 'Recording time from the metadata' : `Sun elevation ${bandTextEn(time.sunElevationBand)}`,
      detail: time.notes.join(' '),
      detailEn: (time.notesEn ?? time.notes).join(' '),
      weight: time.confidence,
    });
  }
  if (time.monthRange && time.dateSource === 'season') {
    out.push({
      kind: 'season',
      label: `Jahreszeit: ${monthRangeText(time.monthRange)}`,
      labelEn: `Season: ${monthRangeTextEn(time.monthRange)}`,
      detail: 'Aus Vegetation, Schnee und Licht geschätzt; auf der Südhalbkugel gespiegelt.',
      detailEn: 'Estimated from vegetation, snow and light; mirrored for the southern hemisphere.',
      weight: 0.15,
    });
  }
  return out;
}

/** What the trace says about the time. */
function timeNote(time: TimeEstimate): Named {
  const best = time.windows[0];
  if (!best) return { de: 'keine Uhrzeit', en: 'no time of day' };
  return {
    de: `${best.label}, ${time.timezone ?? 'Sonnenzeit'}`,
    en: `${DAY_LABELS_EN[best.label] ?? best.label}, ${time.timezone ?? 'solar time'}`,
  };
}

/**
 * Frames sampled from the file with their light statistics and the world model's prediction for
 * them: what the quick stage hands on. The JPEG bytes are kept only while the world model still
 * has to look at them (its gallery was being built), otherwise dropped (about 0.5 MB a video).
 */
type QuickFrames = SampledFrames & { stats: FrameStats[]; geoclip: WorldModelResult | null };

/** What the trace says about the world model's answer. */
function worldModelNote(result: WorldModelResult | null, located: LocateResult): Named {
  if (!result) return { de: 'Weltmodell abgeschaltet', en: 'world model switched off' };
  if (!result.prediction) return result.reason ?? { de: 'ohne Weltmodell', en: 'without the world model' };
  const wm = located.diagnostics.worldModel;
  const secs = `${(result.ms / 1000).toFixed(1).replace('.', ',')} s`;
  const secsEn = `${(result.ms / 1000).toFixed(1)} s`;
  if (!wm) return { de: `GeoCLIP gerechnet in ${secs}`, en: `GeoCLIP computed in ${secsEn}` };
  const place = located.location && wm.replaced ? located.location : null;
  const pct = (p: number): string => `${Math.round(p * 100)} %`;
  const pctEn = (p: number): string => `${Math.round(p * 100)}%`;
  if (place) {
    return {
      de: `GeoCLIP: ${place.label}, ersetzt das Ergebnis der Referenzgalerie (${pct(wm.agreeMass)} dort) · ${secs}`,
      en: `GeoCLIP: ${place.labelEn ?? place.label}, replaces the reference gallery's result (${pctEn(wm.agreeMass)} there) · ${secsEn}`,
    };
  }
  return {
    de: `GeoCLIP bestätigt das Ergebnis der Referenzgalerie (${pct(wm.agreeMass)} im Umkreis) · ${secs}`,
    en: `GeoCLIP confirms the reference gallery's result (${pctEn(wm.agreeMass)} around it) · ${secsEn}`,
  };
}

export class DatumEngine {
  private readonly fixes = new Map<string, Fix>();
  private readonly queue: Job[] = [];
  private seq = 0;
  private running = false;
  /** Ends the wait of a held-back background job early when a new job arrives. */
  private wake: (() => void) | null = null;
  /** The job being computed, if any. */
  private active: Job | null = null;
  private stopped = false;
  /** Shown fixes of an older engine version whose new fix is still being computed. */
  private readonly stale = new Set<string>();
  /** Frames the quick stage sampled, for the full stage of the same recording. */
  private readonly sampled = new Map<string, QuickFrames>();
  /** One function for the whole process lifetime: prompt vectors are cached per function. */
  private readonly embedTexts = (texts: string[]): Promise<Float32Array> => this.opts.model.embedTexts(texts);
  /** The world model, or null when there is none (see DatumEngineOptions.worldModel). */
  private readonly world: WorldModel | null;
  /** The process-wide world model acquired by this engine, released at stop(). */
  private readonly ownWorld: WorldModelService | null;
  private warmed = false;
  /**
   * Full fixes located while the world model's gallery was being computed: computed again once
   * it is ready (they stay on show meanwhile and do not count as final).
   */
  private readonly awaitingWorld = new Set<string>();
  private worldListening = false;
  /** Set by compute() when the world model's gallery was still being built (read by runFull). */
  private readonly locatedDuringBuild = new Set<string>();

  constructor(private readonly opts: DatumEngineOptions) {
    // DATUM_WORLDMODEL=0 switches the world model off for the whole node (every fix says so).
    if (opts.worldModel === undefined && process.env['DATUM_WORLDMODEL'] === '0') {
      this.ownWorld = null;
      this.world = null;
      reportWorldModel({ available: false, precision: worldModelPrecision() });
    } else if (opts.worldModel === undefined) {
      this.ownWorld = acquireWorldModel((line) => opts.log(line));
      this.world = this.ownWorld;
    } else {
      this.ownWorld = null;
      this.world = opts.worldModel;
    }
  }

  dir(videoId: string): string {
    return path.join(this.opts.store.videoDir(videoId), 'datum');
  }

  spacePath(videoId: string, frame: number): string {
    return path.join(this.dir(videoId), `space-${frame}.dsg`);
  }

  /** The node's own ground truths, if it keeps any. */
  get truths(): TruthBook | null {
    return this.opts.truths ?? null;
  }

  list(): Fix[] {
    const out: Fix[] = [];
    for (const info of this.opts.store.infos()) {
      out.push(this.fixes.get(info.id) ?? pending(info.id));
    }
    return out;
  }

  get(videoId: string): Fix | null {
    if (!this.opts.store.get(videoId)) return null;
    return this.fixes.get(videoId) ?? pending(videoId);
  }

  /** Whether the shown fix is final: ready, from the full stage and of this engine version. */
  private final(videoId: string): boolean {
    const fix = this.fixes.get(videoId);
    return fix?.status === 'ready' && fix.stage !== 'quick' && !this.stale.has(videoId);
  }

  /** A ready fix that stays on show while its full (or current) version is computed. */
  private provisional(videoId: string): boolean {
    const fix = this.fixes.get(videoId);
    return fix?.status === 'ready' && (fix.stage === 'quick' || this.stale.has(videoId));
  }

  /** Recordings that are analysed but have no final fix yet (a quick fix still counts as open). */
  get outstanding(): number {
    let n = 0;
    for (const info of this.opts.store.infos()) {
      if (info.status !== 'ready') continue;
      if (this.final(info.id) || this.fixes.get(info.id)?.status === 'error') continue;
      n++;
    }
    return n;
  }

  /** Whether the reference picture of the same place is left out (see DATUM_HOLDOUT). */
  get holdout(): boolean {
    return this.opts.holdout;
  }

  get queueLength(): number {
    return this.queue.length + (this.running ? 1 : 0);
  }

  /**
   * Whether the engine is locating a person's recording from its file right now (the quick
   * stage). The analysis pipeline pauses between batches meanwhile: these few seconds decide how
   * soon the place of an upload is known.
   */
  get locatingForeground(): boolean {
    return this.active !== null && this.active.kind === 'quick' && !this.active.background;
  }

  /** The waiting jobs in the order they will run (for tests and diagnostics). */
  get waiting(): { id: string; kind: JobKind }[] {
    return [...this.queue].sort((a, b) => jobRank(a) - jobRank(b) || a.seq - b.seq).map(({ id, kind }) => ({ id, kind }));
  }

  /**
   * Reads stored fixes. An analysed recording without a current full fix is queued for one; a
   * recording whose analysis is still outstanding shows its stored quick fix, if it has one (the
   * quick fix does not depend on the analysis). Must run before the pipeline queues the
   * recordings it has to analyse, so that their quick fixes are not computed twice.
   */
  async init(): Promise<void> {
    for (const info of this.opts.store.infos()) {
      // Already queued or computed in this run (its index was rebuilt before init): the stored
      // fix is older than that.
      if (this.fixes.has(info.id)) continue;
      let stored: StoredFix | null = null;
      try {
        stored = JSON.parse(await fs.readFile(path.join(this.dir(info.id), 'fix.json'), 'utf8')) as StoredFix;
      } catch {
        // no fix yet
      }
      const current = stored !== null && stored.engineVersion === ENGINE_VERSION && stored.status === 'ready';
      if (info.status !== 'ready') {
        // Index being (re)built (other model, unreadable or degenerate vectors): a stored full fix
        // came from the old index. The recording is located again once the pipeline reports it
        // ready. A quick fix came from the file alone and stays valid.
        if (stored && current && stored.stage === 'quick') this.fixes.set(info.id, withoutVersion(stored));
        continue;
      }
      if (stored && current) {
        this.fixes.set(info.id, withoutVersion(stored));
        // The node stopped between the quick and the full stage.
        if (stored.stage === 'quick') this.enqueue(info.id, true);
        // Located while the world model's gallery was being computed: it stays on show and is
        // computed again with the world model.
        else if (stored.worldModel === 'building' && this.world) {
          this.stale.add(info.id);
          this.enqueue(info.id, true);
        }
        continue;
      }
      if (stored && stored.status === 'ready' && stored.engineVersion >= OLDEST_SHOWN_VERSION) {
        this.fixes.set(info.id, withoutVersion(stored));
        this.stale.add(info.id);
      }
      this.enqueue(info.id, true);
    }
  }

  /** Queues the full fix (spaces, horizon) of an analysed recording. */
  enqueue(videoId: string, force = false): void {
    if (this.stopped) return;
    if (this.queue.some((j) => j.id === videoId && j.kind === 'full')) return;
    if (!force && this.final(videoId)) return;
    this.push(videoId, 'full');
    // A quick or outdated fix stays on show until the full one replaces it.
    if (this.provisional(videoId)) return;
    const current = this.fixes.get(videoId) ?? pending(videoId);
    this.fixes.set(videoId, { ...current, status: 'pending' });
  }

  /**
   * Queues the quick fix of a recording whose file has just been stored: located from the file
   * alone, before (and while) the analysis runs. Nothing happens when it has a fix already.
   */
  quick(videoId: string): void {
    if (this.stopped) return;
    if (this.queue.some((j) => j.id === videoId && j.kind === 'quick')) return;
    if (this.fixes.get(videoId)?.status === 'ready') return;
    this.push(videoId, 'quick');
    if (!this.fixes.has(videoId)) this.fixes.set(videoId, pending(videoId));
  }

  private push(videoId: string, kind: JobKind): void {
    this.queue.push({ id: videoId, kind, background: this.opts.background?.(videoId) ?? false, seq: this.seq++ });
    this.wake?.();
    void this.drain();
  }

  /** Index of the job that runs next (see jobRank), or -1 when the queue is empty. */
  private nextIndex(): number {
    let best = -1;
    for (let i = 0; i < this.queue.length; i++) {
      const job = this.queue[i] as Job;
      const lead = best >= 0 ? (this.queue[best] as Job) : null;
      if (!lead || jobRank(job) < jobRank(lead) || (jobRank(job) === jobRank(lead) && job.seq < lead.seq)) best = i;
    }
    return best;
  }

  /** Drops the fix of a deleted recording; a computation still running for it is discarded. */
  forget(videoId: string): void {
    this.fixes.delete(videoId);
    this.stale.delete(videoId);
    this.sampled.delete(videoId);
    this.awaitingWorld.delete(videoId);
    for (let i = this.queue.length - 1; i >= 0; i--) if (this.queue[i]?.id === videoId) this.queue.splice(i, 1);
  }

  /**
   * Forgets the fixes of every recording that no longer exists, whichever way it was deleted.
   * Returns how many were dropped.
   */
  prune(): number {
    let dropped = 0;
    for (const id of [...this.fixes.keys()]) {
      if (this.opts.store.get(id)) continue;
      this.forget(id);
      dropped++;
    }
    return dropped;
  }

  /** Whether a recording was deleted after it was taken from the queue. */
  private gone(entry: VideoEntry): boolean {
    return entry.cancelled || this.opts.store.get(entry.info.id) !== entry;
  }

  /**
   * Creates `<videoDir>/datum`, never the recording's folder itself: when the recording has been
   * deleted meanwhile, this fails instead of bringing its folder back.
   */
  private async ensureDir(videoId: string): Promise<void> {
    try {
      await fs.mkdir(this.dir(videoId));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }

  stop(): void {
    if (!this.stopped && this.ownWorld) releaseWorldModel(this.ownWorld);
    this.stopped = true;
    this.queue.length = 0;
    this.wake?.();
  }

  /**
   * Starts the world model's thread (and the reading of its gallery) at the beginning of the first
   * localisation, so that it loads while the frames are sampled.
   */
  private warmWorld(): void {
    if (this.warmed || !this.world) return;
    this.warmed = true;
    this.world.warm();
  }

  /**
   * Remembers a full fix located while the world model's gallery was being computed; once the
   * gallery is ready, such fixes are computed again (in the background), and if it fails they
   * stay as they are.
   */
  private awaitWorld(videoId: string): void {
    const world = this.world;
    if (!world) return;
    this.awaitingWorld.add(videoId);
    this.stale.add(videoId);
    if (this.worldListening) return;
    this.worldListening = true;
    world.onGallerySettled((ready) => {
      this.worldListening = false;
      const ids = [...this.awaitingWorld];
      this.awaitingWorld.clear();
      for (const id of ids) {
        if (!this.opts.store.get(id)) continue;
        if (ready) this.enqueue(id, true);
        else this.stale.delete(id);
      }
    });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.stopped) {
        const index = this.nextIndex();
        if (index < 0) break;
        // Only background work is left, and a person's recording is being analysed: it waits,
        // and a job of the person's that comes meanwhile goes first.
        if ((this.queue[index] as Job).background && this.opts.foregroundElsewhere?.()) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, BACKGROUND_POLL_MS);
            this.wake = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          this.wake = null;
          continue;
        }
        const job = this.queue.splice(index, 1)[0] as Job;
        const entry = this.opts.store.get(job.id);
        if (!entry) continue;
        this.active = job;
        try {
          if (job.kind === 'quick') await this.runQuick(entry);
          else if (entry.info.status === 'ready') await this.runFull(entry);
        } finally {
          this.active = null;
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Writes a finished fix next to the recording. */
  private async persist(fix: Fix, worldBuilding = false): Promise<void> {
    await this.ensureDir(fix.videoId);
    const stored: StoredFix = { ...fix, engineVersion: ENGINE_VERSION, ...(worldBuilding ? { worldModel: 'building' as const } : {}) };
    await fs.writeFile(path.join(this.dir(fix.videoId), 'fix.json'), JSON.stringify(stored));
  }

  private async runQuick(entry: VideoEntry): Promise<void> {
    const id = entry.info.id;
    // Located meanwhile (the full stage, or a quick fix read at start): nothing to gain.
    if (this.fixes.get(id)?.status === 'ready') return;
    const started = Date.now();
    this.publish({ ...(this.fixes.get(id) ?? pending(id)), status: 'running', stage: 'quick', trace: [] });
    try {
      const fix = await this.computeQuick(entry);
      if (this.gone(entry)) {
        this.forget(id);
        return;
      }
      fix.elapsedMs = Date.now() - started;
      // The truth may have been given while the fix was computed.
      fix.truth = await this.truthFor(entry, fix.location);
      await this.persist(fix);
      this.publish(fix);
      this.opts.onFix?.(fix);
      this.opts.log(`Schnellortung "${entry.info.name}": ${whereText(fix)} in ${(fix.elapsedMs / 1000).toFixed(1)} s`);
    } catch (err: unknown) {
      if (this.gone(entry)) {
        this.forget(id);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.opts.log(`Schnellortung "${entry.info.name}" fehlgeschlagen: ${message}`);
      // The full stage still follows once the analysis is ready, and replaces this.
      this.publish({ ...pending(id), status: 'error', stage: 'quick', error: message.slice(0, 300), computedAt: Date.now(), elapsedMs: Date.now() - started });
    }
  }

  private async runFull(entry: VideoEntry): Promise<void> {
    const id = entry.info.id;
    const started = Date.now();
    // A quick (or outdated) fix stays on the map while the full one is computed; the console
    // learns of the full one when it is there. Without one, the run is shown as it goes.
    const quiet = this.provisional(id);
    if (!quiet) this.publish({ ...(this.fixes.get(id) ?? pending(id)), status: 'running', stage: 'full' });
    try {
      const fix = await this.compute(entry, { announce: !quiet });
      // Deleted while it was being located: nothing is written, nothing announced.
      if (this.gone(entry)) {
        this.forget(id);
        return;
      }
      fix.elapsedMs = Date.now() - started;
      fix.truth = await this.truthFor(entry, fix.location);
      const worldBuilding = this.locatedDuringBuild.delete(id);
      await this.persist(fix, worldBuilding);
      this.stale.delete(id);
      // Located without the world model while its gallery is built: the frames stay for the
      // second run, which then only adds the world model's answer.
      if (worldBuilding) this.awaitWorld(id);
      else this.sampled.delete(id);
      this.publish(fix);
      this.opts.onFix?.(fix);
      this.opts.log(`Ortung "${entry.info.name}": ${whereText(fix)} in ${(fix.elapsedMs / 1000).toFixed(1)} s`);
    } catch (err: unknown) {
      this.locatedDuringBuild.delete(id);
      // A deletion in the middle of the work makes it fail (frames gone); that is no error.
      if (this.gone(entry)) {
        this.forget(id);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.opts.log(`Ortung "${entry.info.name}" fehlgeschlagen: ${message}`);
      // A quick fix is a result of its own and stays; without one the failure is shown.
      if (quiet) return;
      this.publish({ ...pending(id), status: 'error', error: message.slice(0, 300), computedAt: Date.now(), elapsedMs: Date.now() - started });
    }
  }

  private publish(fix: Fix): void {
    // A computation still running for a deleted recording must not bring its fix back.
    if (!this.opts.store.get(fix.videoId)) {
      this.forget(fix.videoId);
      return;
    }
    this.fixes.set(fix.videoId, fix);
    this.opts.hub.broadcast({ type: 'datum-fix', fix: summarise(fix) });
  }

  /**
   * Ground truth for a recording: the reference set's first (its neutral names are reserved),
   * else an own truth given for its file name.
   */
  private async truthFor(entry: VideoEntry, location: FixLocation | null): Promise<Fix['truth']> {
    const errorKm = (lat: number, lon: number): number | null => (location ? haversineKm(location.lat, location.lon, lat, lon) : null);
    const reference = await truthForName(entry.info.name);
    if (reference) {
      return {
        lat: reference.lat,
        lon: reference.lon,
        label: reference.label,
        source: 'referenz',
        url: reference.sourceUrl ?? `https://www.wikidata.org/wiki/${reference.wikidata}`,
        errorKm: errorKm(reference.lat, reference.lon),
      };
    }
    const own = this.opts.truths?.lookup(entry.info.name) ?? null;
    if (!own) return null;
    return { lat: own.lat, lon: own.lon, label: own.label ?? own.name, source: 'eigene', errorKm: errorKm(own.lat, own.lon) };
  }

  /**
   * Attaches the own truths given for `names` to the recordings of those file names, without
   * computing anything again: every ready fix gets its truth (with the error against it), is
   * written and announced. Fixes still being computed take theirs when they are written. Returns
   * the number of recordings in the node these truths apply to (the reference set's neutral names
   * keep the reference truth).
   */
  async applyTruths(names: readonly string[]): Promise<number> {
    const keys = new Set(names.map(truthKey));
    let matched = 0;
    for (const entry of this.opts.store.all()) {
      const id = entry.info.id;
      if (!keys.has(truthKey(entry.info.name))) continue;
      if (await truthForName(entry.info.name)) continue;
      if (!this.opts.truths?.lookup(entry.info.name)) continue;
      matched++;
      const fix = this.fixes.get(id);
      if (!fix || fix.status !== 'ready') continue;
      const truth = await this.truthFor(entry, fix.location);
      if (JSON.stringify(truth) === JSON.stringify(fix.truth)) continue;
      const file = path.join(this.dir(id), 'fix.json');
      try {
        const stored = JSON.parse(await fs.readFile(file, 'utf8')) as StoredFix;
        // Only the truth changes; the stored version stays, so an outdated fix is still recomputed.
        await writeFileAtomic(file, JSON.stringify({ ...stored, truth }));
      } catch (err: unknown) {
        this.opts.log(`Grundwahrheit für "${entry.info.name}" nicht gespeichert: ${err instanceof Error ? err.message : String(err)}`);
      }
      // The recording may have been deleted while the file was written.
      if (this.gone(entry)) continue;
      this.publish({ ...fix, truth });
    }
    return matched;
  }

  /** Each finished step is recorded and, when `announce`, shown in the console as the fix runs. */
  private marker(id: string, trace: TraceStep[], announce: boolean): (label: string, detail?: Named) => void {
    let last = Date.now();
    return (label, detail) => {
      const now = Date.now();
      trace.push({ label, ms: now - last, ...(detail ? { detail: detail.de, detailEn: detail.en } : {}) });
      last = now;
      if (!announce) return;
      const current = this.fixes.get(id) ?? pending(id);
      this.publish({ ...current, status: 'running', trace: [...trace] });
    };
  }

  /** Asks the world model about these frames; never rejects (null without a world model). */
  private askWorld(jpegs: readonly Buffer[]): Promise<WorldModelResult> | null {
    const world = this.world;
    if (!world || jpegs.length === 0) return null;
    return world.predict(jpegs).catch((err: unknown): WorldModelResult => {
      const message = err instanceof Error ? err.message : String(err);
      return { state: 'failed', prediction: null, reason: { de: `Weltmodell fehlgeschlagen: ${message}`, en: `world model failed: ${message}` }, ms: 0 };
    });
  }

  /**
   * Stores the world model's answer with the quick stage's frames. The JPEG bytes stay only when
   * the full stage may still ask (gallery being built, or a failure that a new thread may not
   * repeat); otherwise they are dropped.
   */
  private keepWorld(frames: QuickFrames, result: WorldModelResult | null): void {
    frames.geoclip = result;
    if (!result || result.state === 'ok' || result.state === 'unavailable') frames.jpegs = [];
  }

  /**
   * The world model's answer for the full stage: the quick stage's when it had one (the same
   * frames are never looked at twice), else asked now from the kept frames.
   */
  private worldFor(kept: QuickFrames): { result: Promise<WorldModelResult | null>; reused: boolean } {
    if (kept.geoclip && (kept.geoclip.state === 'ok' || kept.geoclip.state === 'unavailable' || kept.jpegs.length === 0)) {
      return { result: Promise.resolve(kept.geoclip), reused: true };
    }
    return { result: this.askWorld(kept.jpegs) ?? Promise.resolve(null), reused: false };
  }

  /**
   * Whether the full stage may compare with street-level pictures now: the node's setting, read
   * at every fix (an operator may switch it off at any time), and never in offline mode, which
   * promises no network access at all.
   */
  private streetLevelOn(): boolean {
    const hook = this.opts.streetLevel?.enabled;
    if (hook) return hook();
    if (config.offline) return false;
    return streetLevelEnabled(this.opts.store.dataDir);
  }

  /**
   * Runs the street-level stage, waiting at most its budget plus STREET_GRACE_MS: at that point the
   * stage is told to stop and the fix goes on without it. Never rejects (the stage itself does not
   * either). `signal` stops it early (the recording was deleted meanwhile).
   */
  private async streetLevel(input: StreetLevelInput, name: string, signal: AbortSignal): Promise<StreetLevelResult> {
    const hooks = this.opts.streetLevel;
    const refine = hooks?.refine ?? refineStreetLevel;
    const options: Partial<StreetLevelOptions> = { ...hooks?.options, ...input.options };
    const budgetMs = options.budgetMs ?? DEFAULT_STREETLEVEL_OPTIONS.budgetMs;
    const stop = new AbortController();
    const onAbort = (): void => stop.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const started = performance.now();
    let timer: NodeJS.Timeout | null = null;
    const cutOff = new Promise<StreetLevelResult>((resolve) => {
      timer = setTimeout(() => {
        stop.abort();
        resolve(streetLevelCutOff(budgetMs, performance.now() - started));
      }, budgetMs + STREET_GRACE_MS);
    });
    // The stage's own lines (one per failed request) stay out of the node's log; the outcome is
    // logged once below and is part of the fix.
    const deps: StreetLevelDeps = { ...hooks?.deps, dataDir: this.opts.store.dataDir, signal: stop.signal };
    try {
      const stage = refine({ ...input, options }, deps).catch((err: unknown): StreetLevelResult => {
        // A stand-in stage may throw; the real one never does.
        const message = (err instanceof Error ? err.message : String(err)).slice(0, 200);
        const failed = streetLevelCutOff(budgetMs, performance.now() - started);
        return {
          ...failed,
          reason: `Straßenbilder nicht auswertbar: ${message}.`,
          reasonEn: `Street-level pictures could not be compared: ${message}.`,
          timing: { ...failed.timing, budgetExhausted: false },
        };
      });
      const result = await Promise.race([stage, cutOff]);
      this.opts.log(`Straßenbilder "${name}": ${result.reason} (${(result.timing.totalMs / 1000).toFixed(1)} s)`);
      return result;
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  }

  /** Keeps the quick stage's frames for the full stage, oldest dropped first. */
  private rememberSampled(id: string, frames: QuickFrames): void {
    this.sampled.delete(id);
    this.sampled.set(id, frames);
    while (this.sampled.size > SAMPLED_CACHE) {
      const oldest = this.sampled.keys().next().value;
      if (oldest === undefined) break;
      this.sampled.delete(oldest);
    }
  }

  /** The quick stage: the file alone, no analysis frames (see the module comment). */
  private async computeQuick(entry: VideoEntry): Promise<Fix> {
    const { store, model } = this.opts;
    const id = entry.info.id;
    const trace: TraceStep[] = [];
    const mark = this.marker(id, trace, true);
    this.warmWorld();
    // The gallery waits for the model, which everything below needs.
    const gallery = await this.opts.gallery();
    const videoPath = store.sourcePath(entry);
    const meta = await readMetadata(videoPath).catch(() => null);
    const hints = filenameHints(entry.info.name);
    mark('Metadaten gelesen', metadataNote(meta));
    const truthVideo = await truthForName(entry.info.name);

    // The world model starts on the frames as soon as they are read and works in its own thread
    // while the image model embeds the crops and the gallery is searched.
    const worldJob: { current: Promise<WorldModelResult> | null } = { current: null };
    const sampled = await sampleAndEmbedFrames(videoPath, model, {
      count: LOCATE_FRAMES,
      durationSec: meta?.durationSec ?? null,
      fps: meta?.fps ?? null,
      detail: 'standard',
      frameStats: true,
      onFrames: (jpegs) => {
        worldJob.current = this.askWorld(jpegs);
      },
    });
    if (this.gone(entry)) throw new Error('Aufzeichnung gelöscht.');
    const frames: QuickFrames = { ...sampled, stats: sampled.stats ?? [], geoclip: null };
    this.rememberSampled(id, frames);
    const crops = sampled.tiles?.frameRow.length ?? sampled.frameNumbers.length;
    mark('Bilder für die Ortung gezogen', {
      de: `${sampled.frameNumbers.length} Bilder, ${crops} Ausschnitte`,
      en: `${sampled.frameNumbers.length} frames, ${crops} crops`,
    });

    const world: Promise<WorldModelResult | null> = worldJob.current ?? Promise.resolve(null);
    const located = await locate({
      videoPath,
      frameVectors: sampled.vectors,
      dim: sampled.dim,
      frameNumbers: sampled.frameNumbers,
      ...(sampled.tiles ? { tiles: sampled.tiles } : {}),
      embedTexts: this.embedTexts,
      gallery,
      fileName: entry.info.name,
      metadata: meta,
      ...(this.opts.holdout && truthVideo ? { excludeWikidata: [truthVideo.wikidata] } : {}),
      geoclip: world.then((r) => r?.prediction ?? null),
    });
    const worldResult = await world;
    this.keepWorld(frames, worldResult);
    mark('Mit der Referenzgalerie verglichen', placeNote(galleryPlace(located), gallery.size));
    mark('Weltmodell befragt', worldModelNote(worldResult, located));
    await breathe();

    const location = located.location;
    const timed = await estimateTime({
      frameEmbeddings: sampled.vectors,
      dim: sampled.dim,
      embedTexts: this.embedTexts,
      frameStats: frames.stats,
      location: location ? { lat: location.lat, lon: location.lon } : null,
      country: location?.country ?? null,
      metadataUtc: meta?.creationUtc ?? null,
      filenameDate: hints.date,
      metadataDate: meta?.creationDate ?? null,
      textCacheKey: config.modelId,
    });
    mark('Licht und Sonnenstand bestimmt', timeNote(timed.time));

    return {
      videoId: id,
      status: 'ready',
      error: null,
      computedAt: Date.now(),
      elapsedMs: 0,
      location,
      candidates: located.candidates,
      countries: located.countries.slice(0, 12),
      time: timed.time,
      sun: timed.sun,
      heading: null,
      horizon: null,
      evidence: [...located.evidence, ...timeEvidence(timed.time)],
      keyframes: [],
      trace,
      stage: 'quick',
      truth: null,
    };
  }

  /** The full stage: localisation as in the quick stage, plus spaces, horizon and heading. */
  private async compute(entry: VideoEntry, opts: { announce: boolean } = { announce: true }): Promise<Fix> {
    const { store, model } = this.opts;
    const id = entry.info.id;
    const trace: TraceStep[] = [];
    const mark = this.marker(id, trace, opts.announce);
    this.warmWorld();
    const dim = model.dim;
    const tiles = Math.max(1, entry.info.tilesPerFrame);
    const matrix = entry.embeddings?.view() ?? null;
    if (!matrix || entry.frames.length === 0) throw new Error('Keine ausgewerteten Bilder vorhanden.');

    // Frame vectors: tile 0 is always the whole frame; the other tiles are square crops of it,
    // stored by the pipeline, and go into retrieval as well.
    const picks = spread(entry.frames.length, LOCATE_FRAMES);
    const frameVectors = new Float32Array(picks.length * dim);
    picks.forEach((fi, row) => frameVectors.set(matrix.subarray(fi * tiles * dim, fi * tiles * dim + dim), row * dim));
    const tileVectors = new Float32Array(picks.length * tiles * dim);
    const tileFrameRow: number[] = [];
    const tileIndex: number[] = [];
    picks.forEach((fi, row) => {
      for (let t = 0; t < tiles; t++) {
        tileVectors.set(matrix.subarray((fi * tiles + t) * dim, (fi * tiles + t + 1) * dim), (row * tiles + t) * dim);
        tileFrameRow.push(row);
        tileIndex.push(t);
      }
    });
    const frameNumbers = picks.map((fi) => entry.frames[fi]!.n);
    const framePath = (n: number): string => store.framePath(id, n);
    const embedTexts = this.embedTexts;

    mark('Bildmerkmale übernommen', { de: `${picks.length} Bilder aus der Auswertung, ${dim} Dimensionen`, en: `${picks.length} frames from the analysis, ${dim} dimensions` });
    const truthVideo = await truthForName(entry.info.name);
    const gallery = await this.opts.gallery();
    const videoPath = store.sourcePath(entry);
    const meta = await readMetadata(videoPath).catch(() => null);
    const hints = filenameHints(entry.info.name);
    mark('Metadaten gelesen', metadataNote(meta));

    // The localisation looks at the same frames as its measurement (docs/DATUM.md): twelve frames
    // from the middle of equal segments of the video, each whole and in three square crops. The
    // analysis frames start at second 0 in the pipeline's rhythm, and in close cases (the true
    // landmark a hundredth ahead of a look-alike) the choice of frames decides; what runs should
    // be what was measured. The quick stage sampled exactly these frames already; without its
    // frames they are sampled now, and if that fails, the stored vectors of the analysis are used.
    let locateFrames: { frameVectors: Float32Array; frameNumbers: number[]; tiles: { vectors: Float32Array; frameRow: number[]; tile: number[] } } = {
      frameVectors,
      frameNumbers,
      tiles: { vectors: tileVectors, frameRow: tileFrameRow, tile: tileIndex },
    };
    // The world model's answer for the frames the localisation looks at (none for the analysis
    // vectors: their pictures are not these frames).
    let world: Promise<WorldModelResult | null> = Promise.resolve(null);
    let worldReused = false;
    let worldSampled = false;
    const kept = this.sampled.get(id);
    if (kept?.tiles && kept.tiles.frameRow.length > 0 && kept.dim === dim) {
      locateFrames = { frameVectors: kept.vectors, frameNumbers: kept.frameNumbers, tiles: kept.tiles };
      const asked = this.worldFor(kept);
      world = asked.result;
      worldReused = asked.reused;
      worldSampled = true;
      mark('Bilder für die Ortung gezogen', {
        de: `${kept.frameNumbers.length} Bilder, ${kept.tiles.frameRow.length} Ausschnitte, aus der Schnellortung übernommen`,
        en: `${kept.frameNumbers.length} frames, ${kept.tiles.frameRow.length} crops, taken over from the quick localisation`,
      });
    } else {
      try {
        const worldJob: { current: Promise<WorldModelResult> | null } = { current: null };
        const sampled = await sampleAndEmbedFrames(videoPath, model, {
          count: LOCATE_FRAMES,
          durationSec: meta?.durationSec ?? null,
          fps: meta?.fps ?? null,
          detail: 'standard',
          onFrames: (jpegs) => {
            worldJob.current = this.askWorld(jpegs);
          },
        });
        if (sampled.tiles && sampled.tiles.frameRow.length > 0 && sampled.dim === dim) {
          locateFrames = { frameVectors: sampled.vectors, frameNumbers: sampled.frameNumbers, tiles: sampled.tiles };
          const asked: Promise<WorldModelResult | null> = worldJob.current ?? Promise.resolve(null);
          world = asked;
          worldSampled = true;
          // While the world model's gallery is built, the frames are kept for the second run.
          void asked.then((r) => {
            if (r?.state !== 'building' || this.gone(entry)) return;
            const frames: QuickFrames = { ...sampled, stats: [], geoclip: null };
            this.keepWorld(frames, r);
            this.rememberSampled(id, frames);
          });
        }
        const crops = sampled.tiles?.frameRow.length ?? sampled.frameNumbers.length;
        mark('Bilder für die Ortung gezogen', {
          de: `${sampled.frameNumbers.length} Bilder, ${crops} Ausschnitte`,
          en: `${sampled.frameNumbers.length} frames, ${crops} crops`,
        });
      } catch (err: unknown) {
        this.opts.log(`Bilder für die Ortung von "${entry.info.name}" nicht gezogen, nehme die der Auswertung: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const located = await locate({
      videoPath,
      frameVectors: locateFrames.frameVectors,
      dim,
      frameNumbers: locateFrames.frameNumbers,
      tiles: locateFrames.tiles,
      embedTexts,
      gallery,
      fileName: entry.info.name,
      metadata: meta,
      ...(this.opts.holdout && truthVideo ? { excludeWikidata: [truthVideo.wikidata] } : {}),
      geoclip: world.then((r) => r?.prediction ?? null),
    });
    const worldResult = await world;
    if (worldResult?.state === 'building') this.locatedDuringBuild.add(id);
    mark('Mit der Referenzgalerie verglichen', placeNote(galleryPlace(located), gallery.size));
    const worldNote = this.world && !worldSampled ? { de: 'keine gezogenen Bilder für das Weltmodell', en: 'no sampled frames for the world model' } : worldModelNote(worldResult, located);
    mark(
      'Weltmodell befragt',
      worldReused && worldResult?.prediction
        ? { de: `aus der Schnellortung übernommen · ${worldNote.de}`, en: `taken over from the quick localisation · ${worldNote.en}` }
        : worldNote,
    );

    // Street-level pictures around a recognised place (streetlevel.ts streetLevelPlan), when the
    // node's setting allows it. The stage is mostly waiting for the picture services, so it runs
    // while the spaces are built below; the horizon and the time need its answer and wait for it.
    // The quick stage never asks: it must not wait for any service.
    const plan = this.streetLevelOn() ? streetLevelPlan(located) : null;
    const streetStop = new AbortController();
    const streetJob: Promise<StreetLevelResult> | null = plan
      ? this.streetLevel(
          {
            frameVectors: locateFrames.frameVectors,
            dim,
            frameNumbers: locateFrames.frameNumbers,
            tiles: { vectors: locateFrames.tiles.vectors, frameRow: locateFrames.tiles.frameRow },
            candidates: [plan.candidate],
            model,
          },
          entry.info.name,
          streetStop.signal,
        )
      : null;
    try {
      return await this.computeRest(entry, located, streetJob, { mark, trace, frameNumbers, frameVectors, framePath, embedTexts, meta, hints, dim });
    } finally {
      // Deleted meanwhile or failed: the stage stops asking the services (a finished one ignores it).
      streetStop.abort();
    }
  }

  /** The full stage after the localisation: street-level pictures, spaces, horizon and time. */
  private async computeRest(
    entry: VideoEntry,
    located: LocateResult,
    streetJob: Promise<StreetLevelResult> | null,
    ctx: {
      mark: (label: string, detail?: Named) => void;
      trace: TraceStep[];
      frameNumbers: number[];
      frameVectors: Float32Array;
      framePath: (n: number) => string;
      embedTexts: (texts: string[]) => Promise<Float32Array>;
      meta: VideoMetadata | null;
      hints: ReturnType<typeof filenameHints>;
      dim: number;
    },
  ): Promise<Fix> {
    const id = entry.info.id;
    const { mark, trace, frameNumbers, frameVectors, framePath, embedTexts, meta, hints, dim } = ctx;

    // Spaces from keyframes: depth → walkable grid, skyline.
    const keyframes: Keyframe[] = [];
    let bestSky: SkyCandidate | null = null;
    for (const fi of spread(entry.frames.length, SPACE_FRAMES)) {
      const frame = entry.frames[fi]!;
      const jpeg = framePath(frame.n);
      const key: Keyframe = { frame: frame.n, time: frame.t, imageUrl: `media/${id}/frames/${path.basename(jpeg)}`, spaceUrl: null, skyline: null };
      // Deleted meanwhile: stop before anything is written into its folder.
      if (this.gone(entry)) throw new Error('Aufzeichnung gelöscht.');
      await breathe();
      try {
        const disparity = await estimateDisparity(jpeg);
        const grid = await buildSpaceGrid(jpeg, disparity);
        await this.ensureDir(id);
        await fs.writeFile(this.spacePath(id, frame.n), grid.buffer);
        key.spaceUrl = `api/datum/space/${id}/${frame.n}`;
        key.skyline = grid.skyline;
        // The grid's rays are those of the pitched camera; the console levels them with this.
        key.pitchDeg = grid.pitchDeg;
        const depthMs = Math.round(disparity.ms);
        const sky = Math.round(grid.skyFraction * 100);
        const pitch = Math.round(grid.pitchDeg);
        mark(`Raum aus Bild ${keyframes.length + 1} aufgebaut`, {
          de: `Tiefe in ${depthMs} ms, Himmel ${sky} %, Neigung ${pitch}°`,
          en: `depth in ${depthMs} ms, sky ${sky}%, pitch ${pitch}°`,
        });
        const aspect = entry.info.frameWidth > 0 && entry.info.frameHeight > 0 ? entry.info.frameWidth / entry.info.frameHeight : 16 / 9;
        if (grid.skyline) bestSky = moreSky(bestSky, { skyline: grid.skyline, aspect, frame: frame.n, skyFraction: grid.skyFraction });
      } catch (err: unknown) {
        this.opts.log(`Raum für Bild ${frame.n} von "${entry.info.name}" nicht erzeugt: ${err instanceof Error ? err.message : String(err)}`);
      }
      keyframes.push(key);
    }

    let evidence: Evidence[] = [...located.evidence];
    let location = located.location;
    if (streetJob && location) {
      const street = await streetJob;
      if (this.gone(entry)) throw new Error('Aufzeichnung gelöscht.');
      location = applyStreetLevel(location, street);
      // A match decides the place and leads the evidence; without one, the entry says why.
      evidence = street.matched ? [...streetLevelEvidence(street), ...evidence] : [...evidence, ...streetLevelEvidence(street)];
      mark('Mit Straßenbildern verglichen', streetLevelNote(street));
    }
    let heading: Fix['heading'] = null;
    let horizon: Fix['horizon'] = null;

    // Terrain: horizon profile at the fix, and a skyline match where elevation data exists. The
    // match searches a grid of points around the fix; the profile and the heading belong to the
    // best of them, which is recorded as `horizon.at`. The fix location itself is not moved.
    if (location && (await terrainAvailable(location.lat, location.lon)) !== null) {
      try {
        if (bestSky && location.radiusKm <= 15) {
          const searchKm = Math.min(3, Math.max(0.6, location.radiusKm));
          const steps = 5;
          await breathe();
          const refined = await refinePosition(bestSky.skyline, bestSky.aspect, { lat: location.lat, lon: location.lon }, { radiusKm: searchKm, steps });
          if (refined && refined.match.errorDeg <= 0.5 && refined.match.score >= 0.5) {
            heading = {
              deg: refined.match.headingDeg,
              fovDeg: refined.match.fovDeg,
              method: 'horizon',
              confidence: Math.max(0.2, Math.min(0.9, refined.match.score * (1 - refined.match.errorDeg))),
              // The heading holds only together with the pitch and on the frame it was solved for.
              pitchDeg: refined.match.pitchDeg,
              frame: bestSky.frame,
              aspect: bestSky.aspect,
            };
            const offsetKm = haversineKm(location.lat, location.lon, refined.point.lat, refined.point.lon);
            const where = offsetKm < 0.05 ? 'am geschätzten Ort selbst' : `${distanceText(offsetKm)} vom geschätzten Ort`;
            const whereEn = offsetKm < 0.05 ? 'at the estimated place itself' : `${distanceTextEn(offsetKm)} from the estimated place`;
            const headingDeg = Math.round(refined.match.headingDeg);
            const fov = Math.round(refined.match.fovDeg);
            const pitch = Math.round(refined.match.pitchDeg);
            evidence.push({
              kind: 'horizon',
              label: `Geländehorizont passt bei Blickrichtung ${headingDeg}°`,
              labelEn: `Terrain horizon matches at heading ${headingDeg}°`,
              detail: `Die Himmelslinie des Videos wurde mit den aus Höhendaten berechneten Horizonten an ${steps * steps} Punkten bis ${distanceText(searchKm)} um den geschätzten Ort verglichen; am besten passt der Horizont ${where} (mittlere Abweichung ${refined.match.errorDeg.toFixed(2).replace('.', ',')}°, Bildwinkel ${fov}°, Kameraneigung ${pitch}°). Die Blickrichtung gilt nur, wenn der Ort stimmt; in Städten enthalten die Höhendaten auch Gebäude.`,
              detailEn: `The skyline of the video was compared with the horizons computed from elevation data at ${steps * steps} points up to ${distanceTextEn(searchKm)} around the estimated place; the horizon ${whereEn} fits best (mean deviation ${refined.match.errorDeg.toFixed(2)}°, field of view ${fov}°, camera pitch ${pitch}°). The heading holds only if the place is right; in cities the elevation data include buildings.`,
              weight: 0.35,
              frame: bestSky.frame,
            });
            horizon = {
              matched: true,
              errorDeg: refined.match.errorDeg,
              at: { lat: refined.point.lat, lon: refined.point.lon },
              profile: await horizonProfile(refined.point.lat, refined.point.lon),
            };
          }
        }
        if (!horizon) horizon = { matched: false, errorDeg: null, at: { lat: location.lat, lon: location.lon }, profile: await horizonProfile(location.lat, location.lon) };
      } catch (err: unknown) {
        this.opts.log(`Horizont für "${entry.info.name}" nicht berechnet: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (location) {
      mark(
        'Gelände geprüft',
        heading
          ? { de: `Horizont passt, Blickrichtung ${Math.round(heading.deg)}°`, en: `horizon matches, heading ${Math.round(heading.deg)}°` }
          : horizon?.profile
            ? { de: 'Horizont berechnet, keine eindeutige Übereinstimmung', en: 'horizon computed, no clear match' }
            : { de: 'kein Höhenmodell oder keine Himmelslinie', en: 'no elevation model or no skyline' },
      );
    }
    await breathe();

    // Time and sun. A tag with a date but no time of day names the day, not the instant: it goes
    // in where a date from the file name would (sun path of that day, clock from the light),
    // unless the file name has a date of its own.
    const stats = await Promise.all(frameNumbers.map((n) => frameStatsFromJpeg(framePath(n))));
    const timed = await estimateTime({
      frameEmbeddings: frameVectors,
      dim,
      embedTexts,
      frameStats: stats,
      location: location ? { lat: location.lat, lon: location.lon } : null,
      country: location?.country ?? null,
      metadataUtc: meta?.creationUtc ?? null,
      filenameDate: hints.date,
      metadataDate: meta?.creationDate ?? null,
      textCacheKey: config.modelId,
    });
    mark('Licht und Sonnenstand bestimmt', timeNote(timed.time));
    evidence.push(...timeEvidence(timed.time));

    return {
      videoId: id,
      status: 'ready',
      error: null,
      computedAt: Date.now(),
      elapsedMs: 0,
      location,
      candidates: located.candidates,
      countries: located.countries.slice(0, 12),
      time: timed.time,
      sun: timed.sun,
      heading,
      horizon,
      // Last, on the final order: the street-level pictures are numbered as the route that serves
      // them counts (GET /api/datum/fixes/:videoId/street/:n, streetImage.ts streetSources).
      evidence: withStreetImagePaths(id, evidence),
      keyframes,
      trace,
      stage: 'full',
      truth: null,
    };
  }
}

function withoutVersion(stored: StoredFix): Fix {
  const { engineVersion: _version, worldModel: _world, ...fix } = stored;
  return fix;
}

/**
 * The place the reference gallery gave (what the trace step of the gallery comparison names);
 * the file's GPS when that decided. The world model's say follows in a step of its own.
 */
function galleryPlace(located: LocateResult): FixLocation | null {
  return located.diagnostics.method === 'metadata' ? located.location : located.diagnostics.gallery;
}

function whereText(fix: Fix): string {
  return fix.location ? `${fix.location.lat.toFixed(4)}, ${fix.location.lon.toFixed(4)} ±${fix.location.radiusKm.toFixed(1)} km` : 'kein Ort';
}

/** "800 m", "2,4 km". */
function distanceText(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace('.', ',')} km`;
}

/** "800 m", "2.4 km". */
function distanceTextEn(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function bandText(band: [number, number] | null): string {
  if (!band) return 'unbestimmt';
  return `${Math.round(band[0])}–${Math.round(band[1])}°`;
}

function bandTextEn(band: [number, number] | null): string {
  if (!band) return 'undetermined';
  return `${Math.round(band[0])}–${Math.round(band[1])}°`;
}

const MONTHS = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthRangeText(range: [number, number]): string {
  return `${MONTHS[range[0] - 1] ?? '?'} – ${MONTHS[range[1] - 1] ?? '?'}`;
}
function monthRangeTextEn(range: [number, number]): string {
  return `${MONTHS_EN[range[0] - 1] ?? '?'} – ${MONTHS_EN[range[1] - 1] ?? '?'}`;
}

/** What the list and the event stream carry: the fix without the heavy arrays. */
export function summarise(fix: Fix): Fix {
  return {
    ...fix,
    sun: fix.sun ? { ...fix.sun, path: [] } : null,
    horizon: fix.horizon ? { ...fix.horizon, profile: null } : null,
  };
}
