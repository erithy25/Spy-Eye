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
import { DATASET_DIR, loadManifest } from './dataset.js';
import { terrainGrid } from './terrain.js';
import { horizonProfile } from './horizon.js';

type Need = (request: FastifyRequest, reply: FastifyReply, permission: Permission | null) => RequestContext | null;
type SendError = (reply: FastifyReply, status: number, message: string) => FastifyReply;

/** Accuracy over the fixes that have ground truth (the reference dataset). */
export interface DatumSummary {
  recordings: number;
  ready: number;
  pending: number;
  failed: number;
  withTruth: number;
  medianErrorKm: number | null;
  /** Share of fixes within 1, 25, 200, 750, 2500 km of the truth. */
  within: { km: number; share: number; count: number }[];
  /** Share of truths inside the stated uncertainty radius. */
  insideRadius: number | null;
  medianRadiusKm: number | null;
  timeKnown: number;
  medianSeconds: number | null;
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

export function summariseFixes(fixes: Fix[], holdout: boolean, evaluation: unknown): DatumSummary {
  const ready = fixes.filter((f) => f.status === 'ready');
  const truthed = ready.filter((f) => f.truth && f.truth.errorKm !== null);
  const errors = truthed.map((f) => f.truth!.errorKm!);
  const inside = truthed.filter((f) => f.location && f.truth!.errorKm! <= f.location.radiusKm).length;
  return {
    recordings: fixes.length,
    ready: ready.length,
    pending: fixes.filter((f) => f.status === 'pending' || f.status === 'running').length,
    failed: fixes.filter((f) => f.status === 'error').length,
    withTruth: truthed.length,
    medianErrorKm: median(errors),
    within: THRESHOLDS.map((km) => {
      const count = errors.filter((e) => e <= km).length;
      return { km, count, share: errors.length ? count / errors.length : 0 };
    }),
    insideRadius: truthed.length ? inside / truthed.length : null,
    medianRadiusKm: median(ready.filter((f) => f.location).map((f) => f.location!.radiusKm)),
    timeKnown: ready.filter((f) => f.time.method !== 'none' && f.time.windows.length > 0).length,
    medianSeconds: median(ready.map((f) => f.elapsedMs / 1000)),
    evaluation,
    holdout,
  };
}

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
    return summariseFixes(datum.list(), datum.holdout, evaluation);
  });

  /** The reference dataset (ground truth), for the measurement view. */
  app.get('/api/datum/dataset', async (request, reply) => {
    if (!need(request, reply, 'media')) return reply;
    const videos = await loadManifest();
    const fixes = datum.list();
    return videos.map((v, i) => {
      const name = `datum-${String(i + 1).padStart(3, '0')}.mp4`;
      const info = store.infos().find((x) => x.name === name) ?? null;
      const fix = info ? fixes.find((f) => f.videoId === info.id) ?? null : null;
      return {
        index: i + 1,
        name,
        label: v.label,
        country: v.country,
        lat: v.lat,
        lon: v.lon,
        source: v.sourceUrl ?? null,
        license: v.license ?? null,
        videoId: info?.id ?? null,
        errorKm: fix?.location ? haversineKm(fix.location.lat, fix.location.lon, v.lat, v.lon) : null,
      };
    });
  });
}
