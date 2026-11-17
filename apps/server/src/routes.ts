import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { VIDEO_EXTENSIONS, config } from './config.js';
import type { EventHub } from './events.js';
import type { EmbeddingModel } from './ml/model.js';
import type { Pipeline } from './pipeline.js';
import { SearchError, type SearchEngine } from './search.js';
import { frameFileName, isValidVideoId, type Store } from './store.js';
import {
  DETAIL_LEVELS,
  SAMPLE_FPS_OPTIONS,
  type ApiError,
  type AppState,
  type DetailLevel,
  type SceneFramesResponse,
  type SceneInfo,
  type UploadResponse,
  type VideoScenesResponse,
} from './types.js';

export interface RouteDeps {
  store: Store;
  model: EmbeddingModel;
  pipeline: Pipeline;
  search: SearchEngine;
  hub: EventHub;
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
};

function sendError(reply: FastifyReply, status: number, message: string): FastifyReply {
  const body: ApiError = { error: message };
  return reply.code(status).send(body);
}

function queryString(query: unknown, key: string): string | null {
  if (query === null || typeof query !== 'object') return null;
  const value = (query as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

/** Keeps the user-visible name readable while removing anything path-like or control characters. */
function cleanDisplayName(raw: string): string {
  const base = raw.replace(/\\/g, '/').split('/').pop() ?? raw;
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned.slice(0, 200) || 'video';
}

export async function registerRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { store, model, pipeline, search, hub } = deps;

  const appState = (): AppState => ({
    model: model.state,
    videos: store.infos(),
    stats: store.stats(),
    queueLength: pipeline.queueLength,
  });

  // Registered before the routes so that every route inherits them.
  app.setNotFoundHandler((request, reply) => {
    void sendError(reply, 404, `Nicht gefunden: ${request.method} ${request.url.split('?')[0]}`);
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof SearchError) return sendError(reply, error.statusCode, error.message);
    const err = error as { statusCode?: number; message?: string };
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) request.log.error(error);
    return sendError(reply, status, status >= 500 ? 'Interner Fehler.' : (err.message ?? 'Fehlerhafte Anfrage.'));
  });

  await app.register(fastifyMultipart, {
    limits: { fileSize: config.maxUploadBytes, files: 500, fields: 20, parts: 600 },
  });

  await app.register(fastifyStatic, { root: store.videosDir, serve: false });

  app.get('/api/state', async () => appState());

  app.get('/api/events', (request, reply) => {
    reply.hijack();
    hub.add(reply.raw, { type: 'state', state: appState() });
    request.raw.on('close', () => reply.raw.end());
  });

  app.post('/api/videos', async (request, reply) => {
    if (!request.isMultipart()) return sendError(reply, 415, 'Erwartet multipart/form-data.');

    const fpsRaw = Number(queryString(request.query, 'fps') ?? '1');
    const sampleFps = SAMPLE_FPS_OPTIONS.includes(fpsRaw) ? fpsRaw : null;
    if (sampleFps === null) {
      return sendError(reply, 400, `Ungültige Abtastrate. Erlaubt: ${SAMPLE_FPS_OPTIONS.join(', ')} fps.`);
    }
    const detailRaw = queryString(request.query, 'detail') ?? 'standard';
    const detail = (DETAIL_LEVELS as readonly string[]).includes(detailRaw) ? (detailRaw as DetailLevel) : null;
    if (detail === null) {
      return sendError(reply, 400, `Ungültiger Detailgrad. Erlaubt: ${DETAIL_LEVELS.join(', ')}.`);
    }

    const response: UploadResponse = { accepted: [], rejected: [] };
    for await (const part of request.files()) {
      const name = cleanDisplayName(part.filename);
      const ext = path.extname(name).toLowerCase();
      if (!VIDEO_EXTENSIONS.has(ext)) {
        part.file.resume();
        response.rejected.push({ name, reason: `Dateityp "${ext || 'unbekannt'}" wird nicht unterstützt.` });
        continue;
      }
      const id = await store.allocate();
      const sourceFile = `source${ext}`;
      const target = path.join(store.videoDir(id), sourceFile);
      try {
        await streamPipeline(part.file, createWriteStream(target));
        if (part.file.truncated) {
          throw new Error(`Datei ist größer als das Limit von ${(config.maxUploadBytes / 1024 ** 3).toFixed(0)} GB.`);
        }
        const { size } = await fs.stat(target);
        if (size === 0) throw new Error('Datei ist leer.');
        const entry = store.register({ id, name, sourceFile, sizeBytes: size, sampleFps, detail });
        await store.persistMeta(entry);
        pipeline.enqueue(id);
        response.accepted.push(entry.info);
        hub.broadcast({ type: 'video', video: entry.info, stats: store.stats(), queueLength: pipeline.queueLength });
      } catch (err: unknown) {
        await fs.rm(store.videoDir(id), { recursive: true, force: true });
        response.rejected.push({ name, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    if (response.accepted.length === 0 && response.rejected.length === 0) {
      return sendError(reply, 400, 'Keine Datei übermittelt.');
    }
    return reply.code(response.accepted.length > 0 ? 201 : 400).send(response);
  });

  app.delete<{ Params: { id: string } }>('/api/videos/:id', async (request, reply) => {
    const { id } = request.params;
    if (!isValidVideoId(id) || !store.get(id)) return sendError(reply, 404, 'Video nicht gefunden.');
    pipeline.cancel(id);
    await store.remove(id);
    hub.broadcast({ type: 'video-removed', videoId: id, stats: store.stats() });
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/videos/:id/retry', async (request, reply) => {
    const { id } = request.params;
    const entry = isValidVideoId(id) ? store.get(id) : undefined;
    if (!entry) return sendError(reply, 404, 'Video nicht gefunden.');
    if (entry.info.status !== 'error') return sendError(reply, 409, 'Nur fehlgeschlagene Videos können neu gestartet werden.');
    entry.info.status = 'queued';
    entry.info.error = null;
    await store.persistMeta(entry);
    pipeline.enqueue(id);
    hub.broadcast({ type: 'video', video: entry.info, stats: store.stats(), queueLength: pipeline.queueLength });
    return entry.info;
  });

  app.get<{ Params: { id: string } }>('/api/videos/:id/scenes', async (request, reply) => {
    const { id } = request.params;
    const entry = isValidVideoId(id) ? store.get(id) : undefined;
    if (!entry) return sendError(reply, 404, 'Video nicht gefunden.');
    const scenes: SceneInfo[] = entry.scenes.map((s) => store.sceneInfo(entry, s));
    const body: VideoScenesResponse = { video: entry.info, scenes };
    return body;
  });

  app.get<{ Params: { id: string; index: string } }>('/api/videos/:id/scenes/:index/frames', async (request, reply) => {
    const { id } = request.params;
    const entry = isValidVideoId(id) ? store.get(id) : undefined;
    const index = Number(request.params.index);
    const scene = entry && Number.isInteger(index) ? entry.scenes[index] : undefined;
    if (!entry || !scene) return sendError(reply, 404, 'Szene nicht gefunden.');
    const frames = entry.frames
      .slice(scene.firstFrame, scene.lastFrame + 1)
      .map((f) => ({ frameNumber: f.n, time: f.t, url: `/media/${id}/frames/${frameFileName(f.n)}` }));
    const body: SceneFramesResponse = { video: entry.info, scene: store.sceneInfo(entry, scene), frames };
    return body;
  });

  app.get('/api/search', async (request, reply) => {
    const query = (queryString(request.query, 'q') ?? '').trim();
    if (query.length === 0) return sendError(reply, 400, 'Suchbegriff fehlt.');
    if (query.length > 300) return sendError(reply, 400, 'Suchbegriff ist zu lang (max. 300 Zeichen).');
    const limitRaw = Number(queryString(request.query, 'limit') ?? '60');
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.floor(limitRaw))) : 60;
    const videoId = queryString(request.query, 'videoId');
    if (videoId !== null && (!isValidVideoId(videoId) || !store.get(videoId))) {
      return sendError(reply, 404, 'Video nicht gefunden.');
    }
    return search.search({ query, limit, videoId });
  });

  app.get('/api/explain', async (request, reply) => {
    const query = (queryString(request.query, 'q') ?? '').trim();
    const videoId = queryString(request.query, 'videoId') ?? '';
    const frameNumber = Number(queryString(request.query, 'frame') ?? '');
    if (query.length === 0 || query.length > 300) return sendError(reply, 400, 'Suchbegriff fehlt oder ist zu lang.');
    if (!isValidVideoId(videoId) || !Number.isInteger(frameNumber) || frameNumber < 1) {
      return sendError(reply, 400, 'Ungültige Frame-Referenz.');
    }
    return search.explain({ videoId, frameNumber, query });
  });

  app.get('/api/map', async (_request, reply) => {
    if (!model.ready) return sendError(reply, 503, 'Das Modell wird noch geladen.');
    return search.map();
  });

  app.get<{ Params: { id: string; file: string } }>('/media/:id/frames/:file', async (request, reply) => {
    const { id, file } = request.params;
    if (!isValidVideoId(id) || !/^\d{7}\.jpg$/.test(file) || !store.get(id)) {
      return sendError(reply, 404, 'Frame nicht gefunden.');
    }
    return reply.header('Cache-Control', 'private, max-age=3600').sendFile(`${id}/frames/${file}`);
  });

  app.get<{ Params: { id: string } }>('/media/:id/source', async (request, reply) => {
    const { id } = request.params;
    const entry = isValidVideoId(id) ? store.get(id) : undefined;
    if (!entry) return sendError(reply, 404, 'Video nicht gefunden.');
    const ext = path.extname(entry.sourceFile).toLowerCase();
    return reply
      .type(MIME_BY_EXTENSION[ext] ?? 'application/octet-stream')
      .header('Cache-Control', 'private, max-age=3600')
      .sendFile(`${id}/${entry.sourceFile}`);
  });

  // Built web client (production). In development Vite serves the client and proxies /api.
  let hasWebDist = false;
  try {
    await fs.access(path.join(config.webDistDir, 'index.html'));
    hasWebDist = true;
  } catch {
    hasWebDist = false;
  }
  if (hasWebDist) {
    await app.register(fastifyStatic, { root: config.webDistDir, prefix: '/', decorateReply: false });
  } else {
    app.get('/', async (_request, reply) =>
      reply
        .type('text/plain; charset=utf-8')
        .send('Spy-Eye API läuft. Web-Client: "pnpm dev" (Entwicklung) oder "pnpm build" und Server neu starten.'),
    );
  }
}
