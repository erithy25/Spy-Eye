/**
 * HTTP routes of DATUM. Registered by `registerRoutes`; every route checks the session like the
 * rest of the node. Results are read from what the engine stored; nothing here contacts a
 * service outside this machine.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Permission } from '../core/auth.js';
import { haversineKm } from '../core/geo.js';
import type { PlatformNode, RequestContext } from '../node.js';
import { isValidVideoId } from '../store.js';
import type { Fix } from './contract.js';
import { summarise } from './engine.js';
import { DATASET_DIR, caseName, loadManifest } from './dataset.js';
import { terrainGrid } from './terrain.js';
import { horizonProfile } from './horizon.js';
import { parseTruthBody, truthKey, type TruthRefusal } from './truth.js';
import { loadWorld } from './world.js';

type Need = (request: FastifyRequest, reply: FastifyReply, permission: Permission | null) => RequestContext | null;
type SendError = (reply: FastifyReply, status: number, message: string) => FastifyReply;

/** Accuracy of the fixes against one set of truths. */
export interface TruthAccuracy {
  withTruth: number;
  medianErrorKm: number | null;
  /** Share of fixes within 1, 25, 200, 750, 2500 km of the truth. */
  within: { km: number; share: number; count: number }[];
  /** Share of truths inside the stated uncertainty radius. */
  insideRadius: number | null;
}

/** Accuracy over the fixes that have ground truth (the reference dataset and own truths). */
export interface DatumSummary extends TruthAccuracy {
  recordings: number;
  ready: number;
  /** Ready fixes that are still the quick stage (full analysis outstanding). */
  quick: number;
  pending: number;
  failed: number;
  medianRadiusKm: number | null;
  timeKnown: number;
  medianSeconds: number | null;
  /** The same accuracy split by the source of the truth: reference set and own truths. */
  bySource: { referenz: TruthAccuracy; eigene: TruthAccuracy };
  /** Own truths stored in the node (POST /api/datum/truth), matched to a recording or not. */
  ownTruths: number;
  /** Stored offline evaluation (docs/measurements/datum-geolocation.json), if present. */
  evaluation: unknown;
  holdout: boolean;
}

const THRESHOLDS = [1, 25, 200, 750, 2500];

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function accuracy(ready: readonly Fix[]): TruthAccuracy {
  const truthed = ready.filter((f) => f.truth && f.truth.errorKm !== null);
  const errors = truthed.map((f) => f.truth!.errorKm!);
  const inside = truthed.filter((f) => f.location && f.truth!.errorKm! <= f.location.radiusKm).length;
  return {
    withTruth: truthed.length,
    medianErrorKm: median(errors),
    within: THRESHOLDS.map((km) => {
      const count = errors.filter((e) => e <= km).length;
      return { km, count, share: errors.length ? count / errors.length : 0 };
    }),
    insideRadius: truthed.length ? inside / truthed.length : null,
  };
}

export function summariseFixes(fixes: Fix[], holdout: boolean, evaluation: unknown, ownTruths = 0): DatumSummary {
  const ready = fixes.filter((f) => f.status === 'ready');
  // Fixes of older engine versions name the reference URL as their source.
  const own = ready.filter((f) => f.truth?.source === 'eigene');
  const reference = ready.filter((f) => f.truth && f.truth.source !== 'eigene');
  return {
    recordings: fixes.length,
    ready: ready.length,
    quick: ready.filter((f) => f.stage === 'quick').length,
    pending: fixes.filter((f) => f.status === 'pending' || f.status === 'running').length,
    failed: fixes.filter((f) => f.status === 'error').length,
    ...accuracy(ready),
    medianRadiusKm: median(ready.filter((f) => f.location).map((f) => f.location!.radiusKm)),
    timeKnown: ready.filter((f) => f.time.method !== 'none' && f.time.windows.length > 0).length,
    medianSeconds: median(ready.map((f) => f.elapsedMs / 1000)),
    bySource: { referenz: accuracy(reference), eigene: accuracy(own) },
    ownTruths,
    evaluation,
    holdout,
  };
}

/** One row of the measurement view: a video with a known place, its fix and the error. */
export interface DatasetRow {
  index: number;
  /** 'referenz': the reference set; 'eigene': an own truth given with POST /api/datum/truth. */
  kind: 'referenz' | 'eigene';
  name: string;
  label: string;
  country: string | null;
  lat: number;
  lon: number;
  /** Where a reference truth comes from (URL); null for own truths. */
  source: string | null;
  license: string | null;
  videoId: string | null;
  errorKm: number | null;
  /** Stage of the fix the error belongs to, null without one. */
  stage: 'quick' | 'full' | null;
}

/** Body limit of the truth upload: 10 000 entries with long names and labels. */
const TRUTH_BODY_LIMIT = 4 * 1024 * 1024;

export function registerDatumRoutes(app: FastifyInstance, node: PlatformNode, need: Need, sendError: SendError): void {
  const datum = node.datum;
  const store = node.store;

  app.get('/api/datum/fixes', async (request, reply) => {
    if (!need(request, reply, 'media')) return reply;
    return datum.list().map(summarise);
  });

  app.get<{ Params: { id: string } }>('/api/datum/fix/:id', async (request, reply) => {
    if (!need(request, reply, 'media')) return reply;
    const fix = isValidVideoId(request.params.id) ? datum.get(request.params.id) : null;
    if (!fix) return sendError(reply, 404, 'Aufzeichnung nicht gefunden.');
    return fix;
  });

  app.post<{ Params: { id: string } }>('/api/datum/fix/:id/recompute', async (request, reply) => {
    const ctx = need(request, reply, 'source.write');
    if (!ctx) return reply;
    if (!isValidVideoId(request.params.id) || !store.get(request.params.id)) return sendError(reply, 404, 'Aufzeichnung nicht gefunden.');
    datum.enqueue(request.params.id, true);
    await node.ledger.append({
      actor: ctx.user.id,
      role: ctx.user.role,
      mandateId: ctx.mandate?.id ?? null,
      action: 'datum.recompute',
      summary: 'Ortung neu angestoßen',
      data: { videoId: request.params.id },
    });
    return { queued: true };
  });

  app.get<{ Params: { id: string; frame: string } }>('/api/datum/space/:id/:frame', async (request, reply) => {
    if (!need(request, reply, 'media')) return reply;
    const { id, frame } = request.params;
    if (!isValidVideoId(id) || !/^\d{1,7}$/.test(frame) || !store.get(id)) return sendError(reply, 404, 'Raum nicht gefunden.');
    try {
      const buffer = await fs.readFile(datum.spacePath(id, Number(frame)));
      return reply.header('Cache-Control', 'private, no-cache').header('Vary', 'Cookie').type('application/octet-stream').send(buffer);
    } catch {
      return sendError(reply, 404, 'Für dieses Bild ist kein Raum berechnet.');
    }
  });

  app.get<{ Querystring: { lat?: string; lon?: string; radiusKm?: string; size?: string } }>('/api/datum/terrain', async (request, reply) => {
    if (!need(request, reply, 'media')) return reply;
    const lat = Number(request.query.lat);
    const lon = Number(request.query.lon);
    const radiusKm = Math.min(30, Math.max(0.5, Number(request.query.radiusKm ?? '4') || 4));
    const size = Math.min(257, Math.max(33, Math.round(Number(request.query.size ?? '161') || 161)));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return sendError(reply, 400, 'Ungültige Koordinaten.');
    const grid = await terrainGrid({ lat, lon }, radiusKm, size);
    if (!grid) return sendError(reply, 404, 'Kein Höhenmodell für diesen Ort vorhanden.');
    return grid;
  });

  app.get<{ Querystring: { lat?: string; lon?: string } }>('/api/datum/horizon', async (request, reply) => {
    if (!need(request, reply, 'media')) return reply;
    const lat = Number(request.query.lat);
    const lon = Number(request.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return sendError(reply, 400, 'Ungültige Koordinaten.');
    const profile = await horizonProfile(lat, lon);
    if (!profile) return sendError(reply, 404, 'Kein Höhenmodell für diesen Ort vorhanden.');
    return { lat, lon, profile };
  });

  app.get<{ Params: { file: string } }>('/api/datum/gallery/:file', async (request, reply) => {
    if (!need(request, reply, 'media')) return reply;
    const file = request.params.file;
    if (!/^Q\d{1,12}\.jpg$/.test(file)) return sendError(reply, 404, 'Referenzbild nicht gefunden.');
    try {
      const buffer = await fs.readFile(path.join(DATASET_DIR, 'gallery', file));
      return reply.header('Cache-Control', 'private, max-age=3600').type('image/jpeg').send(buffer);
    } catch {
      return sendError(reply, 404, 'Referenzbild nicht gefunden.');
    }
  });

  app.get('/api/datum/summary', async (request, reply) => {
    if (!need(request, reply, 'media')) return reply;
    let evaluation: unknown = null;
    try {
      evaluation = JSON.parse(await fs.readFile(path.join(DATASET_DIR, '..', '..', 'docs', 'measurements', 'datum-geolocation.json'), 'utf8'));
    } catch {
      evaluation = null;
    }
    return summariseFixes(datum.list(), datum.holdout, evaluation, datum.truths?.size ?? 0);
  });

  /**
   * The videos with a known place, for the measurement view: the reference set, then the own
   * truths (each with the first recording of that file name, if there is one).
   */
  app.get('/api/datum/dataset', async (request, reply) => {
    if (!need(request, reply, 'media')) return reply;
    const videos = await loadManifest();
    const fixes = new Map(datum.list().map((f) => [f.videoId, f]));
    const infos = store.infos();
    const row = (base: Omit<DatasetRow, 'index' | 'videoId' | 'errorKm' | 'stage'>, videoId: string | null, index: number): DatasetRow => {
      const fix = videoId ? (fixes.get(videoId) ?? null) : null;
      const located = fix?.status === 'ready' && fix.location ? fix.location : null;
      return {
        index,
        ...base,
        videoId,
        errorKm: located ? haversineKm(located.lat, located.lon, base.lat, base.lon) : null,
        stage: located ? (fix?.stage ?? 'full') : null,
      };
    };
    const rows: DatasetRow[] = videos.map((v, i) => {
      const name = caseName(i);
      const info = infos.find((x) => x.name === name) ?? null;
      return row(
        { kind: 'referenz', name, label: v.label, country: v.country, lat: v.lat, lon: v.lon, source: v.sourceUrl ?? null, license: v.license ?? null },
        info?.id ?? null,
        i + 1,
      );
    });
    const own = datum.truths?.list() ?? [];
    if (own.length > 0) {
      const world = await loadWorld().catch(() => null);
      const byKey = new Map<string, string>();
      for (const info of infos) {
        const key = truthKey(info.name);
        if (!byKey.has(key)) byKey.set(key, info.id);
      }
      for (const t of own) {
        rows.push(
          row(
            { kind: 'eigene', name: t.name, label: t.label ?? t.name, country: world?.countryNear(t.lat, t.lon)?.iso ?? null, lat: t.lat, lon: t.lon, source: null, license: null },
            byKey.get(truthKey(t.name)) ?? null,
            rows.length + 1,
          ),
        );
      }
    }
    return rows;
  });

  /** The own truths stored in the node. */
  app.get('/api/datum/truth', async (request, reply) => {
    if (!need(request, reply, 'media')) return reply;
    return { entries: datum.truths?.list() ?? [] };
  });

  /**
   * Own ground truth for own videos: { entries: [{ name, lat, lon, label? }] }, matched by file
   * name with or without extension, in any letter case. Applied to the fixes at once (the error
   * against the truth is added; nothing is located again). Needs the right to upload footage.
   */
  app.post('/api/datum/truth', { bodyLimit: TRUTH_BODY_LIMIT }, async (request, reply) => {
    const ctx = need(request, reply, 'source.write');
    if (!ctx) return reply;
    const say = (refusal: TruthRefusal): string => (ctx.lang === 'en' ? refusal.en : refusal.de);
    const book = datum.truths;
    if (!book) return sendError(reply, 404, say({ de: 'Dieser Knoten nimmt keine Grundwahrheit an.', en: 'This node accepts no ground truth.' }));
    const parsed = parseTruthBody(request.body);
    if (!('entries' in parsed)) return sendError(reply, 400, say(parsed));
    const result = await book.put(parsed.entries);
    if (!('stored' in result)) return sendError(reply, 400, say(result));
    const matched = await datum.applyTruths(parsed.entries.map((e) => e.name));
    await node.ledger.append({
      actor: ctx.user.id,
      role: ctx.user.role,
      mandateId: ctx.mandate?.id ?? null,
      action: 'datum.truth',
      summary: `Grundwahrheit für ${result.stored} ${result.stored === 1 ? 'Video' : 'Videos'} hinterlegt`,
      data: { stored: result.stored, matched, total: book.size },
    });
    return { stored: result.stored, matched };
  });
}
