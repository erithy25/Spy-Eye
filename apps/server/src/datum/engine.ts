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
 * its own while the image model embeds them; the full stage takes its prediction over. Its thread
 * starts when the engine is initialised, not with the first upload. The quick stage waits for it
 * at most QUICK_WORLD_WAIT_MS; a later answer goes into the full fix. Without its weights, or
 * while its place gallery is still being computed once (40-50 s on a fresh machine), a fix is
 * located without it and its trace says so; a fix computed during that build is computed again
 * once the gallery is ready.
 *
 * The full stage then compares the frames with public street-level pictures around a recognised
 * place (streetlevel.ts, when the node's setting allows it and the node is not offline), while it
 * builds the spaces; a match pins the place to a street before the horizon and the time are
 * computed. The stage has a budget of 20 s, and the engine waits no longer than that (plus half a
 * second): a slow, failing or unreachable service costs the fix the refinement, never the fix.
 * A background job stops waiting for the services as soon as a person's job is queued.
 *
 * Quick jobs go before full ones, and recordings a person has queued before background work
 * (the seeded reference set). A fix is written next to the recording (`<videoDir>/datum/fix.json`)
 * and broadcast to the console. Everything is computed on this machine; the street-level services
 * learn only which area is searched.
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { writeFileAtomic } from '../core/json.js';
import type { EventHub } from '../events.js';
import type { EmbeddingModel } from '../ml/model.js';
import { frameUrl, type Store, type VideoEntry } from '../store.js';
import { haversineKm } from '../core/geo.js';
import type { CountryProb, Evidence, Fix, FixCandidate, FixLocation, FixSegment, Keyframe, TimeEstimate, TraceStep } from './contract.js';
import { truthForName, truthNames } from './dataset.js';
import { Gallery } from './gallery.js';
import { acquireWorldModel, releaseWorldModel, worldModelFailure, worldModelPrecision, WorldModelService, type WorldModel, type WorldModelResult } from './geoclipService.js';
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
import {
  analyseSegments,
  clockText,
  coarseRegions,
  DEFAULT_SEGMENT_PARAMS,
  multiPlaceTimeEvidence,
  segmentCountries,
  segmentVerdict,
  spaceStretches,
  spreadIndices,
  stretchFrames,
  stretchSpacesNote,
  stretchTimes,
  summariseSegments,
  toSegments,
  wholeFileEvidence,
  type SegmentVerdict,
} from './segments.js';
import { regionAround } from './regions.js';
import { filenameHints, readMetadata, type VideoMetadata } from './metadata.js';
import { DAY_LABELS_EN, estimateTime, frameStatsFromJpeg, type FrameStats, type TimeResult } from './time.js';
import { estimateDisparity } from './depth.js';
import { buildSpaceGrid } from './space.js';
import { terrainAvailable } from './terrain.js';
import { horizonProfile, refinePosition } from './horizon.js';
import { loadWorld } from './world.js';
import { truthKey, type TruthBook } from './truth.js';
import { ENGINE_VERSION, OLDEST_SHOWN_VERSION } from './version.js';

/** Frames whose whole-frame and crop vectors go into the localisation (as in the evaluation). */
const LOCATE_FRAMES = 12;
const SPACE_FRAMES = 3;
/**
 * Located stretches of a recording of several places that get a walkable space of their own (one
 * keyframe each, the longest stretches first; the stretch the fix shows has the fix's keyframes).
 * Each space takes about a second (depth model and grid): twelve add some 12 s to the full fix.
 */
const SEGMENT_SPACES = 12;
/** Analysis frames per located stretch whose light gives its time of day (stats and vectors). */
const SEGMENT_TIME_FRAMES = 8;
/**
 * Step of the sun path of a stretch (FixSegment.sun), minutes: 49 points a day instead of the fix's
 * 145 (a 20-minute recording of 32 located stretches carries 32 of them; at 20 minutes they made
 * 114 of the full fix's 219 kB). The dials interpolate between the points.
 */
const SEGMENT_SUN_STEP_MIN = 30;
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
  /** Longest the quick stage waits for the world model (ms); default QUICK_WORLD_WAIT_MS (tests). */
  quickWorldWaitMs?: number;
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

/**
 * A recording with more scenes than this stops asking the world model for its windows as soon as
 * a job goes first (in the background any job of a person's, else a person's quick fix); the
 * windows then go without it. A shorter one finishes, which takes a few seconds.
 */
const BACKGROUND_WORLD_SCENES = 6;

/**
 * Whether the segment step of a recording stops asking the world model (and, in the background,
 * the gallery) for the windows still to come, given the jobs waiting. A short recording (the
 * reference clips: one to three windows, a few seconds of the world model) finishes. A long one
 * gives way: in the background to any job of a person's, and a person's own to the quick fix of
 * a new upload. The engine runs one job at a time, the world model takes up to two minutes on a
 * long recording, and the place of an upload should be known in seconds (see jobRank).
 */
export function segmentsGiveWay(scenes: number, background: boolean, waiting: readonly { kind: JobKind; background: boolean }[]): boolean {
  if (scenes <= BACKGROUND_WORLD_SCENES) return false;
  return background ? waiting.some((j) => !j.background) : waiting.some((j) => j.kind === 'quick' && !j.background);
}

/** How often a waiting background job looks again whether it may run. */
const BACKGROUND_POLL_MS = 500;

/**
 * Longest the quick stage waits for the world model, counted from when its frames were handed to
 * the model's thread. Twelve frames take about 5 s there (more on a loaded machine), and that
 * runs while the image model embeds the crops; a thread that is starting, busy with another call
 * or hung must not hold the quick fix of an upload, which should stand within about a minute.
 * The call goes on: the full stage takes its answer (see QuickFrames.late).
 */
export const QUICK_WORLD_WAIT_MS = 20_000;

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

/** Ends a fix whose engine stopped while it was computed (runFull drops it without an error). */
class EngineStopped extends Error {
  constructor() {
    super('Ortung angehalten.');
  }
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

/** The same spread within the frames first..last (inclusive). */
function spreadWithin(first: number, last: number, wanted: number): number[] {
  return spread(last - first + 1, wanted).map((i) => first + i);
}

/**
 * What the segments of a recording change in its full fix (see DatumEngine.segment): the verdict,
 * the stretches the fix carries (multi-place recordings only), the frames the spaces are built from
 * (those of the stretch shown, so that the horizon is matched where the place is) and, where the
 * place was replaced, the places as candidates.
 */
interface SegmentOutcome {
  verdict: SegmentVerdict;
  segments: FixSegment[] | null;
  /** Indices into the analysis frames (inclusive) for the keyframes; null: the whole recording. */
  keyRange: [number, number] | null;
  /** Per stretch (parallel to `segments`), its analysis frames (indices, inclusive). */
  ranges: [number, number][] | null;
  candidates: FixCandidate[] | null;
  /** The countries of the places (multi-place recordings only; the whole file's mix them). */
  countries: CountryProb[] | null;
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
 * `late` is the world model's call the quick stage stopped waiting for: it goes on, and the full
 * stage takes its answer instead of asking again.
 */
type QuickFrames = SampledFrames & { stats: FrameStats[]; geoclip: WorldModelResult | null; late?: Promise<WorldModelResult> };

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
  /** Told when a job for a person's recording is queued (see awaitStreet). */
  private readonly personListeners = new Set<() => void>();

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

  /**
   * The note that a stored fix is being computed again (Neu orten, an index rebuilt by the
   * pipeline, an outdated or provisional fix): the stored fix may be current by its version, so
   * without the note a stop before the new one is written would leave it as final at the next
   * start. Written when such a computation is queued (enqueue) and when init finds a full fix of
   * a recording whose index is being rebuilt; removed once the new fix is written, or when the
   * computation fails for good (runFull: the stored fix then stands, as it would have without
   * the note); read by init.
   */
  private redoPath(videoId: string): string {
    return path.join(this.dir(videoId), 'redo');
  }

  /** Writes the note of redoPath (a few bytes, at once: no later removal can overtake it). */
  private noteRedo(videoId: string): void {
    try {
      writeFileSync(this.redoPath(videoId), String(Date.now()));
    } catch (err: unknown) {
      this.opts.log(`Ortung: Neuberechnung von ${videoId} nicht vermerkt (${err instanceof Error ? err.message : String(err)}); nach einem Neustart gilt die bisherige Ortung`);
    }
  }

  /**
   * Removes the note of redoPath, unless another full computation of the recording is queued
   * (it needs the note). Synchronous, so that no enqueue can come between the check and the
   * removal.
   */
  private clearRedo(videoId: string): void {
    if (this.queue.some((j) => j.id === videoId && j.kind === 'full')) return;
    try {
      rmSync(this.redoPath(videoId), { force: true });
    } catch {
      // A note that cannot be removed only costs one more computation at the next start.
    }
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
    // The world model loads in its own thread meanwhile (see warmWorld).
    this.warmWorld();
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
        // ready; noted now, so that a stop between that report and the new fix does not leave
        // the old one as final. A quick fix came from the file alone and stays valid.
        if (stored && current && stored.stage === 'quick') this.fixes.set(info.id, withoutVersion(stored));
        else if (stored && stored.stage !== 'quick') this.noteRedo(info.id);
        continue;
      }
      if (stored && current) {
        this.fixes.set(info.id, withoutVersion(stored));
        // The node stopped between the quick and the full stage.
        if (stored.stage === 'quick') this.enqueue(info.id, true);
        // The node stopped while the fix was computed again: it stays on show and is computed
        // again now.
        else if (await exists(this.redoPath(info.id))) {
          this.stale.add(info.id);
          this.enqueue(info.id, true);
        }
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
    // A stored fix computed again (whether or not it is in memory: a recording whose index was
    // rebuilt has its old fix only on disk): noted first, so that a stop before the new fix is
    // written does not leave the old one as final (init).
    if (force && existsSync(path.join(this.dir(videoId), 'fix.json'))) this.noteRedo(videoId);
    // A quick or outdated fix stays on show until the full one replaces it; any other waits,
    // with the place it had (the console keeps showing it, "Neuortung steht an"). Set before the
    // job is queued: on an idle engine the job starts at once and announces 'running', which a
    // later 'pending' would overwrite (GET /api/datum/fixes said "steht an" during the run).
    if (!this.provisional(videoId)) {
      const current = this.fixes.get(videoId) ?? pending(videoId);
      // Announced, so that an open console shows the wait at once, not only after a reload.
      this.publish({ ...current, status: 'pending' });
    }
    this.push(videoId, 'full');
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
    const background = this.opts.background?.(videoId) ?? false;
    this.queue.push({ id: videoId, kind, background, seq: this.seq++ });
    this.wake?.();
    // A background job waiting on the street-level services lets a person's job go first.
    if (!background) for (const listener of [...this.personListeners]) listener();
    void this.drain();
  }

  /** Whether a job for a person's recording is waiting in the queue. */
  private personWaiting(): boolean {
    return this.queue.some((j) => !j.background);
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
   * Starts the world model's thread (and the reading of its gallery): at init, which the node
   * calls once the image model is ready, so that the first upload's quick fix does not pay the
   * thread start, the image tower's session and the gallery read; and at the beginning of every
   * localisation for engines that were not initialised (idempotent).
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

  /**
   * Writes a finished fix next to the recording. Writes nothing and returns false once the engine
   * has stopped: a fix that finished after stop() was computed while the node was shutting down
   * (the world model's thread closed, a stage cut short) and must not be stored, least of all a
   * full fix as final. Without a stored fix the recording is queued again at the next start.
   */
  private async persist(fix: Fix, worldBuilding = false): Promise<boolean> {
    if (this.stopped) return false;
    await this.ensureDir(fix.videoId);
    // Again right before the write: stop() may have come while the folder was being made.
    if (this.stopped) return false;
    const stored: StoredFix = { ...fix, engineVersion: ENGINE_VERSION, ...(worldBuilding ? { worldModel: 'building' as const } : {}) };
    await fs.writeFile(path.join(this.dir(fix.videoId), 'fix.json'), JSON.stringify(stored));
    return true;
  }

  /** Notes a result that was dropped because the engine stopped while it was computed. */
  private dropped(entry: VideoEntry, stage: string): void {
    this.opts.log(`${stage} "${entry.info.name}" nach dem Anhalten verworfen; sie wird beim nächsten Start neu berechnet`);
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
      if (!(await this.persist(fix))) {
        this.dropped(entry, 'Schnellortung');
        return;
      }
      this.publish(fix);
      this.opts.onFix?.(fix);
      this.opts.log(`Schnellortung "${entry.info.name}": ${whereText(fix)} in ${(fix.elapsedMs / 1000).toFixed(1)} s`);
    } catch (err: unknown) {
      if (this.gone(entry)) {
        this.forget(id);
        return;
      }
      // Failed because the node is shutting down (the world model's thread closed, a frame
      // reader stopped): no error to show, the recording is located at the next start.
      if (this.stopped) {
        this.dropped(entry, 'Schnellortung');
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
      // Finished after stop(): perhaps without the world model, whose thread was closed; it
      // would count as final. Dropped; the next start computes it again.
      if (!(await this.persist(fix, worldBuilding))) {
        this.dropped(entry, 'Ortung');
        return;
      }
      this.stale.delete(id);
      // The fix it replaces is gone: no note of a computation still to do, unless another one
      // was asked for meanwhile (queued again).
      this.clearRedo(id);
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
      // Stopped in the middle (EngineStopped, or a model closed under it): no error either.
      if (this.stopped) {
        this.dropped(entry, 'Ortung');
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.opts.log(`Ortung "${entry.info.name}" fehlgeschlagen: ${message}`);
      // Failed for good, not cut short: the stored fix stands at the next start, as without the
      // note; a note left behind would compute it again (and fail) at every start.
      this.clearRedo(id);
      // A quick fix is a result of its own and stays; without one the failure is shown. A fix
      // that was on show while it was computed again (outdated, or noted to be redone) stands as
      // it is in this run too: left stale it would count as outstanding until the end of the
      // process, and --prepare (which waits until nothing is outstanding) would never end.
      if (quiet) {
        if (this.fixes.get(id)?.stage !== 'quick') this.stale.delete(id);
        return;
      }
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
      // The place's German and English names (the selection's single label mixed languages).
      const names = truthNames(reference);
      return {
        lat: reference.lat,
        lon: reference.lon,
        label: names.de,
        labelEn: names.en,
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
    // A stand-in may throw; the real model never does. Either way the reason has its English twin.
    return world.predict(jpegs).catch((err: unknown): WorldModelResult => ({ state: 'failed', prediction: null, reason: worldModelFailure(err), ms: 0 }));
  }

  /**
   * Stores the world model's answer with the quick stage's frames. The JPEG bytes stay only when
   * the full stage may still ask (gallery being built, or a failure that a new thread may not
   * repeat); otherwise they are dropped.
   */
  private keepWorld(frames: QuickFrames, result: WorldModelResult | null, inFlight: Promise<WorldModelResult> | null = null): void {
    frames.geoclip = result;
    if (result?.state === 'late' && inFlight) {
      // The call goes on; the frames stay in case it fails and the full stage has to ask again.
      frames.late = inFlight;
      return;
    }
    if (!result || result.state === 'ok' || result.state === 'unavailable') frames.jpegs = [];
  }

  /**
   * The world model's answer for the full stage: the quick stage's when it had one (the same
   * frames are never looked at twice), the call the quick stage stopped waiting for when it was
   * late, else asked now from the kept frames.
   */
  private worldFor(kept: QuickFrames): { result: Promise<WorldModelResult | null>; reused: boolean } {
    const late = kept.late;
    if (late) {
      const jpegs = kept.jpegs;
      return { result: late.then((r) => (r.state === 'failed' && jpegs.length > 0 ? (this.askWorld(jpegs) ?? r) : r)), reused: false };
    }
    if (kept.geoclip && (kept.geoclip.state === 'ok' || kept.geoclip.state === 'unavailable' || kept.jpegs.length === 0)) {
      return { result: Promise.resolve(kept.geoclip), reused: true };
    }
    return { result: this.askWorld(kept.jpegs) ?? Promise.resolve(null), reused: false };
  }

  /**
   * The world model's answer as the quick stage waits for it: at most quickWorldWaitMs from now,
   * then a 'late' result (the call itself goes on, see QuickFrames.late). Never rejects.
   */
  private quickDeadline(asked: Promise<WorldModelResult>): Promise<WorldModelResult> {
    const waitMs = this.opts.quickWorldWaitMs ?? QUICK_WORLD_WAIT_MS;
    const started = performance.now();
    let timer: NodeJS.Timeout | null = null;
    const late = new Promise<WorldModelResult>((resolve) => {
      const t = setTimeout(() => {
        const secs = Math.round(waitMs / 1000);
        resolve({
          state: 'late',
          prediction: null,
          reason: {
            de: `keine Antwort des Weltmodells binnen ${secs} s; Schnellortung ohne Weltmodell, die vollständige Ortung übernimmt seine Antwort`,
            en: `no answer from the world model within ${secs} s; quick fix without it, the full fix takes its answer`,
          },
          ms: performance.now() - started,
        });
      }, waitMs);
      // A pending deadline must not keep the process alive on its own.
      t.unref();
      timer = t;
    });
    return Promise.race([asked, late]).finally(() => {
      if (timer) clearTimeout(timer);
    });
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

  /**
   * Waits for the street-level stage. The engine runs one job at a time, and this wait is mostly
   * idle network time of up to the stage's budget; a background job (the reference set) must not
   * hold a person's job for it. With `stop` (background jobs only), the stage is stopped as soon
   * as a person's job is waiting, or comes while it runs, and decides on the pictures it has
   * compared so far; the result says so.
   */
  private async awaitStreet(job: Promise<StreetLevelResult>, stop: (() => void) | null): Promise<{ result: StreetLevelResult; yielded: boolean }> {
    if (!stop) return { result: await job, yielded: false };
    let settled = false;
    const tracked = job.then((r) => {
      settled = true;
      return r;
    });
    // A stage that has finished already reports itself first; there is nothing left to stop.
    await Promise.resolve();
    let yielded = false;
    const yieldNow = (): void => {
      if (settled || yielded) return;
      yielded = true;
      stop();
    };
    this.personListeners.add(yieldNow);
    if (this.personWaiting()) yieldNow();
    try {
      const result = await tracked;
      if (!yielded) return { result, yielded };
      return {
        result: {
          ...result,
          reason: `${result.reason} Vorzeitig beendet: die Aufnahme einer Person wartete.`,
          reasonEn: `${result.reasonEn} Ended early: a person's recording was waiting.`,
        },
        yielded,
      };
    } finally {
      this.personListeners.delete(yieldNow);
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
    // while the image model embeds the crops and the gallery is searched. The quick stage waits
    // for it only up to a deadline (quickDeadline); the call itself is kept for the full stage.
    const worldJob: { current: Promise<WorldModelResult> | null; bounded: Promise<WorldModelResult> | null } = { current: null, bounded: null };
    const sampled = await sampleAndEmbedFrames(videoPath, model, {
      count: LOCATE_FRAMES,
      durationSec: meta?.durationSec ?? null,
      fps: meta?.fps ?? null,
      detail: 'standard',
      frameStats: true,
      onFrames: (jpegs) => {
        const asked = this.askWorld(jpegs);
        worldJob.current = asked;
        worldJob.bounded = asked ? this.quickDeadline(asked) : null;
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

    const world: Promise<WorldModelResult | null> = worldJob.bounded ?? Promise.resolve(null);
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
    this.keepWorld(frames, worldResult, worldJob.current);
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

    // Background work (the reference set) gives way to a person's job (street level, world model).
    const background = this.active?.id === id && this.active.background;

    // A recording that shows several places is located stretch by stretch (segments.ts). It keeps
    // its place where the answer for the whole file agrees with its longest located stretch.
    const parts = await this.segment(entry, located, { matrix, tiles, dim, background, exclude: this.opts.holdout && truthVideo ? [truthVideo.wikidata] : null });
    mark('Abschnitte geprüft', parts.verdict.note);
    const placed: LocateResult =
      parts.verdict.evidence.length > 0
        ? {
            ...located,
            location: parts.verdict.location,
            // Where a stretch's place replaced the whole file's answer, the whole file's entries
            // speak of that answer ("1 km from the result: a recognition", "which stands"): they
            // stay, said to be of the whole file and without weight.
            evidence: [...parts.verdict.evidence, ...(parts.verdict.replaced ? located.evidence.map(wholeFileEvidence) : located.evidence)],
            ...(parts.candidates ? { candidates: parts.candidates } : {}),
            ...(parts.countries ? { countries: parts.countries } : {}),
          }
        : located;

    // Street-level pictures around a recognised place (streetlevel.ts streetLevelPlan), when the
    // node's setting allows it. The stage is mostly waiting for the picture services, so it runs
    // while the spaces are built below; the horizon and the time need its answer and wait for it.
    // The quick stage never asks: it must not wait for any service. Not for a place taken from a
    // stretch: the frames it compares belong to the whole recording.
    const plan = this.streetLevelOn() && !parts.verdict.replaced ? streetLevelPlan(located) : null;
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
    // Background work (the reference set) stops waiting on the services for a person's job.
    const streetYield = background ? (): void => streetStop.abort() : null;
    try {
      const stretches = parts.segments && parts.ranges && parts.verdict.lead !== null ? { segments: parts.segments, ranges: parts.ranges, lead: parts.verdict.lead } : null;
      return await this.computeRest(entry, placed, streetJob, {
        mark,
        trace,
        frameNumbers,
        frameVectors,
        framePath,
        embedTexts,
        meta,
        hints,
        dim,
        matrix,
        tiles,
        streetYield,
        keyRange: parts.keyRange,
        stretches,
      });
    } finally {
      // Deleted meanwhile or failed: the stage stops asking the services (a finished one ignores it).
      streetStop.abort();
    }
  }

  /**
   * Locates the recording stretch by stretch (segments.ts): windows from the analysis's scenes,
   * each decided from its own frames with the gallery, the country prior and the world model, then
   * merged into places. Never fails the fix: without the analysis's scenes or on an error the
   * recording counts as one place and the trace says why.
   */
  private async segment(
    entry: VideoEntry,
    located: LocateResult,
    ctx: { matrix: Float32Array; tiles: number; dim: number; background: boolean; exclude: string[] | null },
  ): Promise<SegmentOutcome> {
    const single = (note: { de: string; en: string }): SegmentOutcome => ({
      verdict: { multi: false, places: 0, joined: 0, location: located.location, replaced: false, lead: null, evidence: [], note },
      segments: null,
      keyRange: null,
      ranges: null,
      candidates: null,
      countries: null,
    });
    const id = entry.info.id;
    const frames = entry.frames;
    if (frames.length < 2) return single({ de: 'zu wenige Bilder für Abschnitte', en: 'too few frames for segments' });
    try {
      const gallery = await this.opts.gallery();
      const world = await loadWorld();
      // The world model looks at a few frames per window. It is given up for the rest of the
      // recording when it has no answer (switched off, still building its gallery, failed), and a
      // background job stops asking as soon as a person's job is waiting.
      let worldGone = this.world === null;
      const giveWay = (): boolean => segmentsGiveWay(entry.scenes.length, ctx.background, this.queue);
      const analysis = await analyseSegments(
        { frames, scenes: entry.scenes, durationSec: entry.info.durationSec, matrix: ctx.matrix, tiles: ctx.tiles, dim: ctx.dim, ...(ctx.exclude ? { excludeWikidata: ctx.exclude } : {}) },
        {
          world,
          embedTexts: this.embedTexts,
          search: (vectors, k, opts) => gallery.searchAsync(vectors, k, opts),
          ...(this.world
            ? {
                predictWorld: async (indices: number[]) => {
                  const jpegs = await Promise.all(indices.map(async (i) => fs.readFile(await this.opts.store.analysisFramePath(id, (frames[i] as { n: number }).n))));
                  const result = await this.askWorld(jpegs);
                  if (!result?.prediction) worldGone = true;
                  return result?.prediction ?? null;
                },
              }
            : {}),
          stopWorld: () => worldGone || this.stopped || this.gone(entry) || giveWay(),
          // The search runs in parts of a few seconds: it ends when the engine stops or the
          // recording is deleted, and in the background when a person's job waits (the windows
          // left stay undetermined). A person's own recording is searched to the end.
          stopSearch: () => this.stopped || this.gone(entry) || (ctx.background && giveWay()),
        },
      );
      if (this.stopped) throw new EngineStopped();
      if (this.gone(entry)) throw new Error('Aufzeichnung gelöscht.');
      // Undetermined stretches name a coarse region where the gallery and the world model agree
      // on one (segments.ts coarseRegions), by the parts of the world its circle holds
      // (regions.ts regionAround); it is no place and changes nothing else.
      const coarseKm = DEFAULT_SEGMENT_PARAMS.coarseKm;
      const regions = coarseRegions(analysis.windows, analysis.merged, (lat, lon) => regionAround(world, lat, lon, coarseKm), coarseKm);
      const segments = toSegments(frames, analysis.windows, analysis.merged, (n) => frameUrl(id, n)).map((s, i) => (regions[i] ? { ...s, coarse: regions[i] } : s));
      const gps = located.diagnostics.method === 'metadata';
      // The gallery's answer for the whole file that the world model turned down: no stretch at
      // that place leads (see segmentVerdict).
      const rejected = located.diagnostics.worldModel?.replaced ? located.diagnostics.gallery : null;
      const verdict = segmentVerdict(segments, located.location, { gps, sameKm: DEFAULT_SEGMENT_PARAMS.sameKm, rejected });
      const secs = (ms: number): string => (ms / 1000).toFixed(1);
      const unsearched = analysis.searchSkipped;
      const how = {
        de: ` · ${analysis.windows.length} Fenster, Weltmodell auf ${analysis.worldFrames} Bildern${analysis.worldSkipped > 0 ? `, ${analysis.worldSkipped} Fenster ohne` : ''} (${secs(analysis.timing.worldMs).replace('.', ',')} s)${unsearched > 0 ? `, ${unsearched} Fenster ohne Galerie` : ''}`,
        en: ` · ${analysis.windows.length} windows, world model on ${analysis.worldFrames} frames${analysis.worldSkipped > 0 ? `, ${analysis.worldSkipped} windows without it` : ''} (${secs(analysis.timing.worldMs)} s)${unsearched > 0 ? `, ${unsearched} windows without the gallery` : ''}`,
      };
      this.opts.log(`Abschnitte "${entry.info.name}": ${verdict.note.de}${how.de}; Suche ${secs(analysis.timing.searchMs)} s in ${analysis.searches} Teilen, Entscheidung ${secs(analysis.timing.decideMs)} s`);
      const note = { de: `${verdict.note.de}${how.de}`, en: `${verdict.note.en}${how.en}` };
      if (!verdict.multi || verdict.lead === null) return { verdict: { ...verdict, note }, segments: null, keyRange: null, ranges: null, candidates: null, countries: null };
      const lead = analysis.merged.stretches[verdict.lead];
      const keyRange: [number, number] | null = lead ? [analysis.windows[lead.first]!.first, analysis.windows[lead.last]!.last] : null;
      return {
        verdict: { ...verdict, note },
        segments,
        keyRange,
        ranges: stretchFrames(analysis.windows, analysis.merged),
        candidates: verdict.replaced ? placeCandidates(segments, verdict.lead) : null,
        countries: segmentCountries(segments, verdict.lead),
      };
    } catch (err: unknown) {
      if (err instanceof EngineStopped || this.stopped || this.gone(entry)) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.opts.log(`Abschnitte für "${entry.info.name}" nicht geprüft: ${message}`);
      return single({ de: `nicht geprüft: ${message.slice(0, 120)}`, en: `not checked: ${message.slice(0, 120)}` });
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
      /** The analysis vectors (frames x tiles rows of dim floats; tile 0 is the whole frame). */
      matrix: Float32Array;
      tiles: number;
      /** Stops the street-level stage for a person's job (background jobs only, see awaitStreet). */
      streetYield: (() => void) | null;
      /** Analysis frames the keyframes come from (the stretch shown); null: the whole recording. */
      keyRange: [number, number] | null;
      /**
       * The stretches of a recording of several places: their frames (indices, inclusive) and the
       * one the fix shows. Each located one gets its own time and sun, and the longest their own
       * space; the fix's time is that of the stretch shown. Null for a recording of one place.
       */
      stretches: { segments: FixSegment[]; ranges: [number, number][]; lead: number } | null;
    },
  ): Promise<Fix> {
    const id = entry.info.id;
    const { mark, trace, frameNumbers, frameVectors, framePath, embedTexts, meta, hints, dim, matrix, tiles, streetYield, keyRange, stretches } = ctx;
    const segments: FixSegment[] | null = stretches ? stretches.segments.map((s) => ({ ...s, keyframe: { ...s.keyframe } })) : null;

    // Spaces from keyframes: depth → walkable grid, skyline. A recording of several places takes
    // them from the stretch whose place the fix shows, so that horizon and heading belong to it.
    const keyframes: Keyframe[] = [];
    let bestSky: SkyCandidate | null = null;
    for (const fi of keyRange ? spreadWithin(keyRange[0], keyRange[1], SPACE_FRAMES) : spread(entry.frames.length, SPACE_FRAMES)) {
      const frame = entry.frames[fi]!;
      const jpeg = framePath(frame.n);
      const key: Keyframe = { frame: frame.n, time: frame.t, imageUrl: `media/${id}/frames/${path.basename(jpeg)}`, spaceUrl: null, skyline: null };
      // Deleted meanwhile: stop before anything is written into its folder.
      if (this.gone(entry)) throw new Error('Aufzeichnung gelöscht.');
      // Stopped meanwhile: the fix will be dropped (see persist), so nothing of it is written.
      if (this.stopped) throw new EngineStopped();
      await breathe();
      try {
        const disparity = await estimateDisparity(jpeg);
        const grid = await buildSpaceGrid(jpeg, disparity);
        await this.ensureDir(id);
        // Right before the write: the depth model took a while, and stop() may have come.
        if (this.stopped) throw new EngineStopped();
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
        // A stop ends the whole fix, not only this picture's space.
        if (err instanceof EngineStopped) throw err;
        this.opts.log(`Raum für Bild ${frame.n} von "${entry.info.name}" nicht erzeugt: ${err instanceof Error ? err.message : String(err)}`);
      }
      keyframes.push(key);
    }

    // One space for each of the longest other located stretches (their keyframe), so that RAUM can
    // enter the stretch chosen in BEFUND. Their skylines are not matched against the terrain: the
    // horizon belongs to the stretch shown (see docs/DATUM.md, "Räume je Abschnitt").
    if (stretches && segments) {
      const started = performance.now();
      const chosen = spaceStretches(segments, stretches.lead, SEGMENT_SPACES);
      let built = 0;
      for (const i of chosen) {
        const seg = segments[i]!;
        const n = seg.keyframe.frame;
        if (this.gone(entry)) throw new Error('Aufzeichnung gelöscht.');
        if (this.stopped) throw new EngineStopped();
        const same = keyframes.find((k) => k.frame === n && k.spaceUrl);
        if (same?.spaceUrl) {
          seg.keyframe = { ...seg.keyframe, spaceUrl: same.spaceUrl, ...(same.pitchDeg !== undefined ? { pitchDeg: same.pitchDeg } : {}) };
          built++;
          continue;
        }
        await breathe();
        try {
          const jpeg = framePath(n);
          const disparity = await estimateDisparity(jpeg);
          const grid = await buildSpaceGrid(jpeg, disparity);
          await this.ensureDir(id);
          if (this.stopped) throw new EngineStopped();
          await fs.writeFile(this.spacePath(id, n), grid.buffer);
          seg.keyframe = { ...seg.keyframe, spaceUrl: `api/datum/space/${id}/${n}`, pitchDeg: grid.pitchDeg };
          built++;
        } catch (err: unknown) {
          if (err instanceof EngineStopped) throw err;
          this.opts.log(`Raum für Abschnitt ${i + 1} (Bild ${n}) von "${entry.info.name}" nicht erzeugt: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      const located = segments.filter((s) => s.location).length;
      mark('Räume der Abschnitte aufgebaut', stretchSpacesNote(built, located, chosen.length, performance.now() - started));
    }

    let evidence: Evidence[] = [...located.evidence];
    let location = located.location;
    if (streetJob && location) {
      const { result: street, yielded } = await this.awaitStreet(streetJob, streetYield);
      if (this.gone(entry)) throw new Error('Aufzeichnung gelöscht.');
      location = applyStreetLevel(location, street);
      // A match decides the place and leads the evidence; without one, the entry says why.
      evidence = street.matched ? [...streetLevelEvidence(street), ...evidence] : [...evidence, ...streetLevelEvidence(street)];
      const note = streetLevelNote(street);
      mark(
        'Mit Straßenbildern verglichen',
        yielded ? { de: `${note.de}, vorzeitig beendet für die Aufnahme einer Person`, en: `${note.en}, ended early for a person's recording` } : note,
      );
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
    // unless the file name has a date of its own. A time in the tags holds for the whole file and
    // decides for every stretch (estimateTime takes it first).
    const timeAt = (vectors: Float32Array, stats: FrameStats[], at: FixLocation | null, stepMin?: number): Promise<TimeResult> =>
      estimateTime({
        frameEmbeddings: vectors,
        dim,
        embedTexts,
        frameStats: stats,
        location: at ? { lat: at.lat, lon: at.lon } : null,
        country: at?.country ?? null,
        metadataUtc: meta?.creationUtc ?? null,
        filenameDate: hints.date,
        metadataDate: meta?.creationDate ?? null,
        textCacheKey: config.modelId,
        ...(stepMin !== undefined ? { pathStepMin: stepMin } : {}),
      });
    const stats = await Promise.all(frameNumbers.map((n) => frameStatsFromJpeg(framePath(n))));
    const whole = await timeAt(frameVectors, stats, location);
    let timed = whole;
    if (stretches && segments) {
      // A recording of several places: every located stretch from its own frames at its own place
      // (the whole file's twelve frames mix the light of all of them), and the fix the stretch it
      // shows. The whole file's estimate stays as evidence, said to be mixed and without weight.
      const started = performance.now();
      // Whole-frame vectors and light statistics of analysis frames (indices).
      const framesOf = async (picks: number[]): Promise<{ vectors: Float32Array; stats: FrameStats[] }> => {
        const vectors = new Float32Array(picks.length * dim);
        picks.forEach((fi, row) => vectors.set(matrix.subarray(fi * tiles * dim, fi * tiles * dim + dim), row * dim));
        return { vectors, stats: await Promise.all(picks.map((fi) => frameStatsFromJpeg(framePath(entry.frames[fi]!.n)))) };
      };
      const timedSegments = await stretchTimes(
        segments,
        stretches.ranges,
        async (picks, at) => {
          const own = await framesOf(picks);
          return timeAt(own.vectors, own.stats, at, SEGMENT_SUN_STEP_MIN);
        },
        SEGMENT_TIME_FRAMES,
        () => {
          if (this.gone(entry)) throw new Error('Aufzeichnung gelöscht.');
          if (this.stopped) throw new EngineStopped();
        },
        (i, err) => this.opts.log(`Uhrzeit für Abschnitt ${i + 1} von "${entry.info.name}" nicht bestimmt: ${err instanceof Error ? err.message : String(err)}`),
      );
      segments.splice(0, segments.length, ...timedSegments);
      const counted = segments.filter((s) => s.time).length;
      const lead = segments[stretches.lead]!;
      const [first, last] = stretches.ranges[stretches.lead]!;
      // The same frames as the stretch's own estimate (stretchTimes), so that both read the same light.
      const own = await framesOf(spreadIndices(first, last, SEGMENT_TIME_FRAMES));
      // The fix's own time: the stretch's frames at the fix's place (the stretch's place, or the
      // whole file's answer where it agrees with it), with the sun path in the fix's steps.
      timed = await timeAt(own.vectors, own.stats, location);
      const span = `${clockText(lead.startSec)}–${clockText(lead.endSec)}`;
      // A time from the file's tags is said once, for the whole file (multiPlaceTimeEvidence).
      evidence.push(...multiPlaceTimeEvidence(timeEvidence(timed.time), timeEvidence(whole.time), span));
      const ms = Math.round(performance.now() - started);
      const note = timeNote(timed.time);
      mark('Licht und Sonnenstand bestimmt', {
        de: `${note.de} (Abschnitt ${span}) · ${counted} Abschnitte mit Ort je für sich, ${ms.toLocaleString('de-DE')} ms`,
        en: `${note.en} (segment ${span}) · ${counted} segments with a place each on its own, ${ms.toLocaleString('en-GB')} ms`,
      });
    } else {
      mark('Licht und Sonnenstand bestimmt', timeNote(timed.time));
      evidence.push(...timeEvidence(timed.time));
    }

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
      ...(segments ? { segments } : {}),
    };
  }
}

function withoutVersion(stored: StoredFix): Fix {
  const { engineVersion: _version, worldModel: _world, ...fix } = stored;
  return fix;
}

/** Whether a file exists (any error reading it counts as no). */
async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * The place the reference gallery gave (what the trace step of the gallery comparison names);
 * the file's GPS when that decided. The world model's say follows in a step of its own.
 */
function galleryPlace(located: LocateResult): FixLocation | null {
  return located.diagnostics.method === 'metadata' ? located.location : located.diagnostics.gallery;
}

/**
 * The candidates of a recording of several places whose place was taken from a stretch: its
 * places, the fix's own first (with the stretch's point, which the console centres on), then by
 * the time they take up; the score is that share of the time with a place. The candidates of the
 * whole file mix the places and say nothing of any of them.
 */
function placeCandidates(segments: readonly FixSegment[], lead: number): FixCandidate[] {
  const summary = summariseSegments(segments, lead);
  const total = summary.places.reduce((s, p) => s + p.seconds, 0) || 1;
  const shown = segments[lead];
  const first = shown?.place ?? null;
  return [...summary.places]
    .sort((a, b) => Number(b.place === first) - Number(a.place === first) || b.seconds - a.seconds)
    .slice(0, 8)
    .map((p) => {
      const at = p.place === first && shown?.location ? shown.location : p;
      return {
        lat: at.lat,
        lon: at.lon,
        label: at.label,
        ...(at.labelEn ? { labelEn: at.labelEn } : {}),
        country: at.country,
        score: p.seconds / total,
        radiusKm: at.radiusKm,
      };
    });
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
    // The stretches' sun paths too (49 points each): the console reads them with the full fix.
    ...(fix.segments ? { segments: fix.segments.map((s) => (s.sun ? { ...s, sun: { ...s.sun, path: [] } } : s)) } : {}),
  };
}
