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
 * Quick jobs go before full ones, and recordings a person has queued before background work
 * (the seeded reference set). A fix is written next to the recording (`<videoDir>/datum/fix.json`)
 * and broadcast to the console. Everything is computed on this machine.
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
import { breathe, locate, sampleAndEmbedFrames, type SampledFrames } from './locate.js';
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

type StoredFix = Fix & { engineVersion: number };

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
}

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

/** Frames sampled from the file with their light statistics: what the quick stage hands on. */
type QuickFrames = SampledFrames & { stats: FrameStats[] };

export class DatumEngine {
  private readonly fixes = new Map<string, Fix>();
  private readonly queue: Job[] = [];
  private seq = 0;
  private running = false;
  private stopped = false;
  /** Shown fixes of an older engine version whose new fix is still being computed. */
  private readonly stale = new Set<string>();
  /** Frames the quick stage sampled, for the full stage of the same recording. */
  private readonly sampled = new Map<string, QuickFrames>();
  /** One function for the whole process lifetime: prompt vectors are cached per function. */
  private readonly embedTexts = (texts: string[]): Promise<Float32Array> => this.opts.model.embedTexts(texts);

  constructor(private readonly opts: DatumEngineOptions) {}

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
    void this.drain();
  }

  private takeNext(): Job | null {
    let best = -1;
    for (let i = 0; i < this.queue.length; i++) {
      const job = this.queue[i] as Job;
      const lead = best >= 0 ? (this.queue[best] as Job) : null;
      if (!lead || jobRank(job) < jobRank(lead) || (jobRank(job) === jobRank(lead) && job.seq < lead.seq)) best = i;
    }
    return best >= 0 ? (this.queue.splice(best, 1)[0] as Job) : null;
  }

  /** Drops the fix of a deleted recording; a computation still running for it is discarded. */
  forget(videoId: string): void {
    this.fixes.delete(videoId);
    this.stale.delete(videoId);
    this.sampled.delete(videoId);
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
    this.stopped = true;
    this.queue.length = 0;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.stopped) {
        const job = this.takeNext();
        if (!job) break;
        const entry = this.opts.store.get(job.id);
        if (!entry) continue;
        if (job.kind === 'quick') await this.runQuick(entry);
        else if (entry.info.status === 'ready') await this.runFull(entry);
      }
    } finally {
      this.running = false;
    }
  }

  /** Writes a finished fix next to the recording. */
  private async persist(fix: Fix): Promise<void> {
    await this.ensureDir(fix.videoId);
    const stored: StoredFix = { ...fix, engineVersion: ENGINE_VERSION };
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
    if (!quiet) this.publish({ ...(this.fixes.get(id) ?? pending(id)), status: 'running' });
    try {
      const fix = await this.compute(entry, { announce: !quiet });
      // Deleted while it was being located: nothing is written, nothing announced.
      if (this.gone(entry)) {
        this.forget(id);
        return;
      }
      fix.elapsedMs = Date.now() - started;
      fix.truth = await this.truthFor(entry, fix.location);
      await this.persist(fix);
      this.stale.delete(id);
      this.sampled.delete(id);
      this.publish(fix);
      this.opts.onFix?.(fix);
      this.opts.log(`Ortung "${entry.info.name}": ${whereText(fix)} in ${(fix.elapsedMs / 1000).toFixed(1)} s`);
    } catch (err: unknown) {
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
    // The gallery waits for the model, which everything below needs.
    const gallery = await this.opts.gallery();
    const videoPath = store.sourcePath(entry);
    const meta = await readMetadata(videoPath).catch(() => null);
    const hints = filenameHints(entry.info.name);
    mark('Metadaten gelesen', metadataNote(meta));
    const truthVideo = await truthForName(entry.info.name);

    const sampled = await sampleAndEmbedFrames(videoPath, model, {
      count: LOCATE_FRAMES,
      durationSec: meta?.durationSec ?? null,
      fps: meta?.fps ?? null,
      detail: 'standard',
      frameStats: true,
    });
    if (this.gone(entry)) throw new Error('Aufzeichnung gelöscht.');
    const frames: QuickFrames = { ...sampled, stats: sampled.stats ?? [] };
    this.rememberSampled(id, frames);
    const crops = sampled.tiles?.frameRow.length ?? sampled.frameNumbers.length;
    mark('Bilder für die Ortung gezogen', {
      de: `${sampled.frameNumbers.length} Bilder, ${crops} Ausschnitte`,
      en: `${sampled.frameNumbers.length} frames, ${crops} crops`,
    });

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
    });
    mark('Mit der Referenzgalerie verglichen', placeNote(located.location, gallery.size));
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
    const kept = this.sampled.get(id);
    if (kept?.tiles && kept.tiles.frameRow.length > 0 && kept.dim === dim) {
      locateFrames = { frameVectors: kept.vectors, frameNumbers: kept.frameNumbers, tiles: kept.tiles };
      mark('Bilder für die Ortung gezogen', {
        de: `${kept.frameNumbers.length} Bilder, ${kept.tiles.frameRow.length} Ausschnitte, aus der Schnellortung übernommen`,
        en: `${kept.frameNumbers.length} frames, ${kept.tiles.frameRow.length} crops, taken over from the quick localisation`,
      });
    } else {
      try {
        const sampled = await sampleAndEmbedFrames(videoPath, model, {
          count: LOCATE_FRAMES,
          durationSec: meta?.durationSec ?? null,
          fps: meta?.fps ?? null,
          detail: 'standard',
        });
        if (sampled.tiles && sampled.tiles.frameRow.length > 0 && sampled.dim === dim) {
          locateFrames = { frameVectors: sampled.vectors, frameNumbers: sampled.frameNumbers, tiles: sampled.tiles };
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
    });
    mark('Mit der Referenzgalerie verglichen', placeNote(located.location, gallery.size));

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

    const evidence: Evidence[] = [...located.evidence];
    const location = located.location;
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
      evidence,
      keyframes,
      trace,
      stage: 'full',
      truth: null,
    };
  }
}

function withoutVersion(stored: StoredFix): Fix {
  const { engineVersion: _version, ...fix } = stored;
  return fix;
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
