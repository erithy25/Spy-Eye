/**
 * DATUM engine: turns an analysed recording into a fix — where and when it was recorded, the
 * sun at that moment, the camera's heading, the terrain horizon, and walkable spaces built from
 * keyframes.
 *
 * It runs after the analysis pipeline has indexed a recording (the frame vectors are reused, so
 * nothing is embedded twice), one recording at a time, in the background. A fix is written next
 * to the recording (`<videoDir>/datum/fix.json`) and broadcast to the console. Everything is
 * computed on this machine.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { EventHub } from '../events.js';
import type { EmbeddingModel } from '../ml/model.js';
import type { Store, VideoEntry } from '../store.js';
import { haversineKm } from '../core/geo.js';
import type { Evidence, Fix, Keyframe, TimeEstimate, TraceStep } from './contract.js';
import { truthForName } from './dataset.js';
import { Gallery } from './gallery.js';
import { locate, sampleAndEmbedFrames } from './locate.js';
import { filenameHints, readMetadata } from './metadata.js';
import { estimateTime, frameStatsFromJpeg } from './time.js';
import { estimateDisparity } from './depth.js';
import { buildSpaceGrid } from './space.js';
import { terrainAvailable } from './terrain.js';
import { horizonProfile, refinePosition } from './horizon.js';
import { ENGINE_VERSION } from './version.js';

/** Frames whose whole-frame and crop vectors go into the localisation (as in the evaluation). */
const LOCATE_FRAMES = 12;
const SPACE_FRAMES = 3;

type StoredFix = Fix & { engineVersion: number };

export interface DatumEngineOptions {
  store: Store;
  model: EmbeddingModel;
  hub: EventHub;
  gallery: () => Promise<Gallery>;
  log: (message: string) => void;
  /** Leave the reference picture of the same place out (evaluation of unknown places). */
  holdout: boolean;
  onFix?: (fix: Fix) => void;
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

export class DatumEngine {
  private readonly fixes = new Map<string, Fix>();
  private readonly queue: string[] = [];
  private running = false;
  private stopped = false;
  /** One function for the whole process lifetime: prompt vectors are cached per function. */
  private readonly embedTexts = (texts: string[]): Promise<Float32Array> => this.opts.model.embedTexts(texts);

  constructor(private readonly opts: DatumEngineOptions) {}

  dir(videoId: string): string {
    return path.join(this.opts.store.videoDir(videoId), 'datum');
  }

  spacePath(videoId: string, frame: number): string {
    return path.join(this.dir(videoId), `space-${frame}.dsg`);
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

  /** Recordings that are analysed but have no finished fix yet. */
  get outstanding(): number {
    let n = 0;
    for (const info of this.opts.store.infos()) {
      if (info.status !== 'ready') continue;
      const s = this.fixes.get(info.id)?.status;
      if (s !== 'ready' && s !== 'error') n++;
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

  /** Reads stored fixes and queues every analysed recording that has none (or an outdated one). */
  async init(): Promise<void> {
    for (const info of this.opts.store.infos()) {
      // Already queued or computed in this run (its index was rebuilt before init): the stored
      // fix is older than that.
      if (this.fixes.has(info.id)) continue;
      // Index being (re)built (other model, unreadable or degenerate vectors): a stored fix came
      // from the old index. The recording is located again once the pipeline reports it ready.
      if (info.status !== 'ready') continue;
      try {
        const stored = JSON.parse(await fs.readFile(path.join(this.dir(info.id), 'fix.json'), 'utf8')) as StoredFix;
        if (stored.engineVersion === ENGINE_VERSION && stored.status === 'ready') {
          const { engineVersion: _version, ...fix } = stored;
          this.fixes.set(info.id, fix);
          continue;
        }
      } catch {
        // no fix yet
      }
      this.enqueue(info.id);
    }
  }

  enqueue(videoId: string, force = false): void {
    if (this.queue.includes(videoId)) return;
    if (!force && this.fixes.get(videoId)?.status === 'ready') return;
    this.queue.push(videoId);
    const current = this.fixes.get(videoId) ?? pending(videoId);
    this.fixes.set(videoId, { ...current, status: 'pending' });
    void this.drain();
  }

  /** Drops the fix of a deleted recording; a computation still running for it is discarded. */
  forget(videoId: string): void {
    this.fixes.delete(videoId);
    const i = this.queue.indexOf(videoId);
    if (i >= 0) this.queue.splice(i, 1);
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
        const id = this.queue.shift();
        if (id === undefined) break;
        const entry = this.opts.store.get(id);
        if (!entry || entry.info.status !== 'ready') continue;
        const started = Date.now();
        this.publish({ ...(this.fixes.get(id) ?? pending(id)), status: 'running' });
        try {
          const fix = await this.compute(entry);
          // Deleted while it was being located: nothing is written, nothing announced.
          if (this.gone(entry)) {
            this.forget(id);
            continue;
          }
          fix.elapsedMs = Date.now() - started;
          await this.ensureDir(id);
          const stored: StoredFix = { ...fix, engineVersion: ENGINE_VERSION };
          await fs.writeFile(path.join(this.dir(id), 'fix.json'), JSON.stringify(stored));
          this.publish(fix);
          this.opts.onFix?.(fix);
          const where = fix.location ? `${fix.location.lat.toFixed(4)}, ${fix.location.lon.toFixed(4)} ±${fix.location.radiusKm.toFixed(1)} km` : 'kein Ort';
          this.opts.log(`Ortung "${entry.info.name}": ${where} in ${(fix.elapsedMs / 1000).toFixed(1)} s`);
        } catch (err: unknown) {
          // A deletion in the middle of the work makes it fail (frames gone); that is no error.
          if (this.gone(entry)) {
            this.forget(id);
            continue;
          }
          const message = err instanceof Error ? err.message : String(err);
          this.opts.log(`Ortung "${entry.info.name}" fehlgeschlagen: ${message}`);
          this.publish({ ...pending(id), status: 'error', error: message.slice(0, 300), computedAt: Date.now(), elapsedMs: Date.now() - started });
        }
      }
    } finally {
      this.running = false;
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

  private async compute(entry: VideoEntry): Promise<Fix> {
    const { store, model } = this.opts;
    const id = entry.info.id;
    const trace: TraceStep[] = [];
    let last = Date.now();
    // Each finished step is announced, so that the console can show the analysis as it runs.
    const mark = (label: string, detail?: string): void => {
      const now = Date.now();
      trace.push({ label, ms: now - last, ...(detail ? { detail } : {}) });
      last = now;
      const current = this.fixes.get(id) ?? pending(id);
      this.publish({ ...current, status: 'running', trace: [...trace] });
    };
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

    mark('Bildmerkmale übernommen', `${picks.length} Bilder aus der Auswertung, ${dim} Dimensionen`);
    const truthVideo = await truthForName(entry.info.name);
    const gallery = await this.opts.gallery();
    const videoPath = store.sourcePath(entry);
    const meta = await readMetadata(videoPath).catch(() => null);
    const hints = filenameHints(entry.info.name);
    mark(
      'Metadaten gelesen',
      meta?.location ? 'GPS in der Datei' : meta?.creationUtc ? 'Aufnahmezeit in der Datei' : meta?.creationDate ? 'Aufnahmedatum ohne Uhrzeit in der Datei' : 'kein Ort, keine Zeit in der Datei',
    );

    // The localisation looks at the same frames as its measurement (docs/DATUM.md): twelve frames
    // from the middle of equal segments of the video, each whole and in three square crops. The
    // analysis frames start at second 0 in the pipeline's rhythm, and in close cases (the true
    // landmark a hundredth ahead of a look-alike) the choice of frames decides; what runs should
    // be what was measured. If sampling fails, the stored vectors of the analysis are used.
    let locateFrames: { frameVectors: Float32Array; frameNumbers: number[]; tiles: { vectors: Float32Array; frameRow: number[]; tile: number[] } } = {
      frameVectors,
      frameNumbers,
      tiles: { vectors: tileVectors, frameRow: tileFrameRow, tile: tileIndex },
    };
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
      mark('Bilder für die Ortung gezogen', `${sampled.frameNumbers.length} Bilder, ${sampled.tiles?.frameRow.length ?? sampled.frameNumbers.length} Ausschnitte`);
    } catch (err: unknown) {
      this.opts.log(`Bilder für die Ortung von "${entry.info.name}" nicht gezogen, nehme die der Auswertung: ${err instanceof Error ? err.message : String(err)}`);
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
      ...(this.opts.holdout && truthVideo ? { excludeWikidata: [truthVideo.wikidata] } : {}),
    });
    mark(
      'Mit der Referenzgalerie verglichen',
      `${gallery.size.toLocaleString('de-DE')} Referenzbilder · ${located.location ? `${located.location.label}, ± ${located.location.radiusKm < 1 ? `${Math.round(located.location.radiusKm * 1000)} m` : `${Math.round(located.location.radiusKm)} km`}` : 'kein Ort'}`,
    );

    // Spaces from keyframes: depth → walkable grid, skyline.
    const keyframes: Keyframe[] = [];
    let bestSky: SkyCandidate | null = null;
    for (const fi of spread(entry.frames.length, SPACE_FRAMES)) {
      const frame = entry.frames[fi]!;
      const jpeg = framePath(frame.n);
      const key: Keyframe = { frame: frame.n, time: frame.t, imageUrl: `media/${id}/frames/${path.basename(jpeg)}`, spaceUrl: null, skyline: null };
      // Deleted meanwhile: stop before anything is written into its folder.
      if (this.gone(entry)) throw new Error('Aufzeichnung gelöscht.');
      try {
        const disparity = await estimateDisparity(jpeg);
        const grid = await buildSpaceGrid(jpeg, disparity);
        await this.ensureDir(id);
        await fs.writeFile(this.spacePath(id, frame.n), grid.buffer);
        key.spaceUrl = `api/datum/space/${id}/${frame.n}`;
        key.skyline = grid.skyline;
        // The grid's rays are those of the pitched camera; the console levels them with this.
        key.pitchDeg = grid.pitchDeg;
        mark(`Raum aus Bild ${keyframes.length + 1} aufgebaut`, `Tiefe in ${Math.round(disparity.ms)} ms, Himmel ${Math.round(grid.skyFraction * 100)} %, Neigung ${Math.round(grid.pitchDeg)}°`);
        const aspect = entry.info.frameWidth > 0 && entry.info.frameHeight > 0 ? entry.info.frameWidth / entry.info.frameHeight : 16 / 9;
        if (grid.skyline) bestSky = moreSky(bestSky, { skyline: grid.skyline, aspect, frame: frame.n, skyFraction: grid.skyFraction });
      } catch (err: unknown) {
        this.opts.log(`Raum für Bild ${frame.n} von "${entry.info.name}" nicht erzeugt: ${err instanceof Error ? err.message : String(err)}`);
      }
      keyframes.push(key);
    }

    const evidence: Evidence[] = [...located.evidence];
    let location = located.location;
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
            evidence.push({
              kind: 'horizon',
              label: `Geländehorizont passt bei Blickrichtung ${Math.round(refined.match.headingDeg)}°`,
              detail: `Die Himmelslinie des Videos wurde mit den aus Höhendaten berechneten Horizonten an ${steps * steps} Punkten bis ${distanceText(searchKm)} um den geschätzten Ort verglichen; am besten passt der Horizont ${where} (mittlere Abweichung ${refined.match.errorDeg.toFixed(2)}°, Bildwinkel ${Math.round(refined.match.fovDeg)}°, Kameraneigung ${Math.round(refined.match.pitchDeg)}°). Die Blickrichtung gilt nur, wenn der Ort stimmt; in Städten enthalten die Höhendaten auch Gebäude.`,
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

    if (location) mark('Gelände geprüft', heading ? `Horizont passt, Blickrichtung ${Math.round(heading.deg)}°` : horizon?.profile ? 'Horizont berechnet, keine eindeutige Übereinstimmung' : 'kein Höhenmodell oder keine Himmelslinie');

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
    mark('Licht und Sonnenstand bestimmt', timed.time.windows[0] ? `${timed.time.windows[0].label}, ${timed.time.timezone ?? 'Sonnenzeit'}` : 'keine Uhrzeit');
    if (timed.time.method !== 'none' && timed.time.windows.length > 0) {
      evidence.push({
        kind: timed.time.method === 'metadata' ? 'metadata' : 'sun',
        label: timed.time.method === 'metadata' ? 'Aufnahmezeit aus den Metadaten' : `Sonnenhöhe ${bandText(timed.time.sunElevationBand)}`,
        detail: timed.time.notes.join(' '),
        weight: timed.time.confidence,
      });
    }
    if (timed.time.monthRange && timed.time.dateSource === 'season') {
      evidence.push({
        kind: 'season',
        label: `Jahreszeit: ${monthRangeText(timed.time.monthRange)}`,
        detail: 'Aus Vegetation, Schnee und Licht geschätzt; auf der Südhalbkugel gespiegelt.',
        weight: 0.15,
      });
    }

    const truth = truthVideo
      ? {
          lat: truthVideo.lat,
          lon: truthVideo.lon,
          label: truthVideo.label,
          source: truthVideo.sourceUrl ?? `https://www.wikidata.org/wiki/${truthVideo.wikidata}`,
          errorKm: location ? haversineKm(location.lat, location.lon, truthVideo.lat, truthVideo.lon) : null,
        }
      : null;

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
      truth,
    };
  }
}

/** "800 m", "2,4 km". */
function distanceText(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace('.', ',')} km`;
}

function bandText(band: [number, number] | null): string {
  if (!band) return 'unbestimmt';
  return `${Math.round(band[0])}–${Math.round(band[1])}°`;
}

const MONTHS = ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'];
function monthRangeText(range: [number, number]): string {
  return `${MONTHS[range[0] - 1] ?? '?'} – ${MONTHS[range[1] - 1] ?? '?'}`;
}

/** What the list and the event stream carry: the fix without the heavy arrays. */
export function summarise(fix: Fix): Fix {
  return {
    ...fix,
    sun: fix.sun ? { ...fix.sun, path: [] } : null,
    horizon: fix.horizon ? { ...fix.horizon, profile: null } : null,
  };
}
