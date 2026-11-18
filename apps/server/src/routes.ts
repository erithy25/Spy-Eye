import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline as streamPipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { VIDEO_EXTENSIONS, config } from './config.js';
import type { Permission } from './core/auth.js';
import { freeBytes } from './core/disk.js';
import { newId } from './core/json.js';
import { foreignRequest } from './core/origin.js';
import { PEER_BUDGET, PEER_BUDGET_WINDOW_MS, type FederationHello, type FederationResponse } from './intel/federation.js';
import { screenPrompt } from './intel/guard.js';
import { parseStreamAddress, redactStreamAddress, streamHostAllowed } from './intel/live.js';
import { collectMetrics } from './intel/metrics.js';
import { caseReport, measurementReport, situationReport } from './intel/report.js';
import type { PlatformNode, RequestContext } from './node.js';
import { SearchError } from './search.js';
import { registerDatumRoutes } from './datum/routes.js';
import { registerDatasetRoutes } from './datum/datasets.js';
import { DEFAULT_SOURCE_ID, RM_OPTIONS, frameUrl, isValidVideoId, originalFrameFileName } from './store.js';
import {
  DETAIL_LEVELS,
  SAMPLE_FPS_OPTIONS,
  SOURCE_KINDS,
  type ApiError,
  type DetailLevel,
  type FederatedHit,
  type IntelSnapshot,
  type LedgerPage,
  type PublicInfo,
  type SceneFramesResponse,
  type SceneInfo,
  type Severity,
  type SourceKind,
  type UploadResponse,
  type VideoScenesResponse,
} from './types.js';

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
};

const UNMASK_TTL_MS = 15 * 60 * 1000;
const EXERCISE_SPEEDS = [1, 2, 4, 8];

function sendError(reply: FastifyReply, status: number, message: string, extra: Record<string, unknown> = {}): FastifyReply {
  const body: ApiError & Record<string, unknown> = { error: message, ...extra };
  return reply.code(status).send(body);
}

function queryString(query: unknown, key: string): string | null {
  if (query === null || typeof query !== 'object') return null;
  const value = (query as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

/** Typed access to JSON bodies; every field is validated where it is read. */
class Body {
  private readonly data: Record<string, unknown>;

  constructor(raw: unknown) {
    this.data = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  }

  text(key: string, max = 300): string {
    const value = this.data[key];
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
  }

  number(key: string, fallback: number, min: number, max: number): number {
    const value = this.data[key];
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  }

  nullableNumber(key: string, min: number, max: number): number | null {
    const value = this.data[key];
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
  }

  flag(key: string, fallback: boolean): boolean {
    const value = this.data[key];
    return typeof value === 'boolean' ? value : fallback;
  }

  has(key: string): boolean {
    return this.data[key] !== undefined;
  }

  texts(key: string, maxItems: number, maxLength: number): string[] {
    const value = this.data[key];
    if (!Array.isArray(value)) return [];
    return value
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim().slice(0, maxLength))
      .filter((v) => v !== '')
      .slice(0, maxItems);
  }

  raw(key: string): unknown {
    return this.data[key];
  }
}

/** Keeps the user-visible name readable while removing anything path-like or control characters. */
function cleanDisplayName(raw: string): string {
  const base = raw.replace(/\\/g, '/').split('/').pop() ?? raw;
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned.slice(0, 200) || 'video';
}

export async function registerRoutes(app: FastifyInstance, node: PlatformNode, serveConsole: boolean): Promise<void> {
  const { store, pipeline, search, hub, ledger, auth, mandates, sources, watches, incidents, cases, scenario, federation } = node;
  const model = node.shared.model;

  const say = (ctx: { lang: 'de' | 'en' } | null, de: string, en: string): string => (ctx?.lang === 'en' ? en : de);

  /** Resolves the session and checks one permission; answers 401/403 itself when it fails. */
  const need = (request: FastifyRequest, reply: FastifyReply, permission: Permission | null): RequestContext | null => {
    const ctx = node.contextOf(request);
    if (!ctx) {
      void sendError(reply, 401, node.langOf(request) === 'en' ? 'Not signed in.' : 'Nicht angemeldet.');
      return null;
    }
    if (permission !== null && !node.allowed(ctx, permission)) {
      void sendError(reply, 403, say(ctx, 'Für diese Rolle nicht zulässig.', 'Not permitted for this role.'));
      return null;
    }
    return ctx;
  };

  /** Like `need`, and additionally requires a usable mandate on the session (purpose binding). */
  const needMandate = (request: FastifyRequest, reply: FastifyReply, permission: Permission): (RequestContext & { mandate: NonNullable<RequestContext['mandate']> }) | null => {
    const ctx = need(request, reply, permission);
    if (!ctx) return null;
    if (!ctx.mandate) {
      void sendError(
        reply,
        409,
        say(ctx, 'Kein gültiges Mandat gewählt. Ohne Zweckbindung ist keine Auswertung möglich.', 'No valid mandate selected. No analysis without a stated purpose.'),
        { code: 'mandate-required' },
      );
      return null;
    }
    return ctx as RequestContext & { mandate: NonNullable<RequestContext['mandate']> };
  };

  /** Describing persons by sex, age group or clothing needs a mandate that says so explicitly. */
  const guardOptions = (ctx: RequestContext): { personDescriptions: boolean } => ({
    personDescriptions: ctx.mandate?.personDescriptions === true,
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

  // JSON bodies are parsed here so the exact bytes stay available for signature checks.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    (request as FastifyRequest & { rawBody?: string }).rawBody = text;
    if (text.trim() === '') {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch {
      const err = new Error('Ungültiges JSON.') as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  await app.register(fastifyMultipart, {
    limits: { fileSize: config.maxUploadBytes, files: 500, fields: 20, parts: 600 },
  });
  await app.register(fastifyStatic, { root: store.videosDir, serve: false });

  // Nobody but the console itself, a person at the address bar or a program with its own
  // credentials starts requests to the interface (see core/origin.ts).
  app.addHook('onRequest', async (request, reply) => {
    const foreign = foreignRequest(request.headers, request.url, request.method);
    if (foreign === null) return;
    const en = node.langOf(request) === 'en';
    return sendError(
      reply,
      403,
      foreign === 'cross-site'
        ? en
          ? 'Refused: the request was started by another site.'
          : 'Abgelehnt: Die Anfrage wurde von einer fremden Seite ausgelöst.'
        : en
          ? 'Refused: queries are made in the console, not by following a link.'
          : 'Abgelehnt: Abfragen werden in der Konsole gestellt, nicht über einen Verweis.',
      { code: 'foreign-request' },
    );
  });

  // Headers for every answer: the console needs nothing from other origins.
  app.addHook('onSend', async (_request, reply) => {
    void reply.header('X-Content-Type-Options', 'nosniff');
    void reply.header('X-Frame-Options', 'DENY');
    void reply.header('Referrer-Policy', 'no-referrer');
    void reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    void reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
  });

  /** Failed sign-ins per user id and per address; five in a row lock that key for a minute. */
  const failures = new Map<string, { count: number; until: number }>();
  const lockedFor = (key: string): number => {
    const entry = failures.get(key);
    return entry && entry.until > Date.now() ? Math.ceil((entry.until - Date.now()) / 1000) : 0;
  };
  const noteFailure = (key: string): void => {
    const entry = failures.get(key) ?? { count: 0, until: 0 };
    entry.count++;
    if (entry.count >= 5) {
      entry.until = Date.now() + 60_000;
      entry.count = 0;
    }
    failures.set(key, entry);
    if (failures.size > 5000) failures.clear();
  };

  // ================================================================ session

  registerDatumRoutes(app, node, need, sendError);
  registerDatasetRoutes(app, node, need, sendError);

  app.get('/api/public/info', async () => {
    const body: PublicInfo = {
      node: node.info,
      product: node.cfg.exercise === false ? 'datum' : 'sicht',
      demo: auth.demoMode ? { users: auth.listUsers(), passwordHint: auth.demoHint } : null,
    };
    return body;
  });

  app.post('/api/login', async (request, reply) => {
    const body = new Body(request.body);
    const lang = node.langOf(request);
    const userKey = `user:${body.text('user', 64).toLowerCase()}`;
    const addressKey = `addr:${request.ip}`;
    const wait = Math.max(lockedFor(userKey), lockedFor(addressKey));
    if (wait > 0) {
      void reply.header('Retry-After', String(wait));
      return sendError(
        reply,
        429,
        lang === 'en' ? `Too many failed attempts. Try again in ${wait} s.` : `Zu viele Fehlversuche. Neuer Versuch in ${wait} s.`,
      );
    }
    const result = auth.login(body.text('user', 64), body.text('password', 200));
    if (!result) {
      noteFailure(userKey);
      noteFailure(addressKey);
      await ledger.append({
        actor: body.text('user', 64) || 'unbekannt',
        role: 'none',
        mandateId: null,
        action: 'auth.failed',
        summary: 'Anmeldung abgelehnt',
        summaryEn: 'Sign-in refused',
        data: {},
      });
      return sendError(reply, 401, lang === 'en' ? 'Unknown user or wrong password.' : 'Unbekannter Benutzer oder falsches Passwort.');
    }
    failures.delete(userKey);
    failures.delete(addressKey);
    // An open mandate is preselected only if there is exactly one; otherwise the user must choose.
    const usable = mandates.list().filter((m) => mandates.isUsable(m));
    if (usable.length === 1) result.session.mandateId = (usable[0] as { id: string }).id;
    void reply.header('Set-Cookie', node.sessionCookie(result.session.token));
    const ctx = node.contextOf(Object.assign(request, { headers: { ...request.headers, cookie: node.sessionCookie(result.session.token) } }));
    await ledger.append({
      actor: result.user.id,
      role: result.user.role,
      mandateId: result.session.mandateId,
      action: 'auth.login',
      summary: `${result.user.name} angemeldet`,
      // The account's English name where it has one, as the English console shows it.
      summaryEn: `${result.user.nameEn ?? result.user.name} signed in`,
      data: {},
    });
    return ctx ? node.sessionInfo(ctx) : { user: result.user, permissions: [], mandate: null };
  });

  app.post('/api/logout', async (request, reply) => {
    const ctx = node.contextOf(request);
    if (ctx) {
      auth.logout(ctx.session.token);
      await node.record(ctx, 'auth.logout', { de: `${ctx.user.name} abgemeldet`, en: `${ctx.user.nameEn ?? ctx.user.name} signed out` });
    }
    return reply.header('Set-Cookie', node.sessionCookie(null)).code(204).send();
  });

  app.get('/api/session', async (request, reply) => {
    const ctx = need(request, reply, null);
    return ctx ? node.sessionInfo(ctx) : reply;
  });

  app.get('/api/mandates', async (request, reply) => {
    const ctx = need(request, reply, 'mandate.read');
    return ctx ? mandates.list() : reply;
  });

  app.post('/api/mandates', async (request, reply) => {
    const ctx = need(request, reply, 'mandate.write');
    if (!ctx) return reply;
    const body = new Body(request.body);
    const title = body.text('title', 120);
    const legalBasis = body.text('legalBasis', 200);
    const purpose = body.text('purpose', 500);
    if (title.length < 3 || legalBasis.length < 3 || purpose.length < 10) {
      return sendError(reply, 400, say(ctx, 'Titel, Rechtsgrundlage und Zweck sind erforderlich.', 'Title, legal basis and purpose are required.'));
    }
    const hours = body.number('validHours', 0, 0, 24 * 365);
    const mandate = mandates.create({
      title,
      legalBasis,
      purpose,
      issuedBy: ctx.user.name,
      validFrom: Date.now(),
      validTo: hours > 0 ? Date.now() + hours * 3600_000 : null,
      exercise: body.flag('exercise', false),
      personDescriptions: body.flag('personDescriptions', false),
    });
    await node.record({ ...ctx, mandate }, 'mandate.create', { de: `Mandat „${title}“ angelegt`, en: `Mandate "${title}" created` }, {
      legalBasis,
      purpose,
      validHours: hours,
      personDescriptions: mandate.personDescriptions,
    });
    return reply.code(201).send(mandate);
  });

  app.post<{ Params: { id: string } }>('/api/mandates/:id/close', async (request, reply) => {
    const ctx = need(request, reply, 'mandate.write');
    if (!ctx) return reply;
    const mandate = mandates.close(request.params.id);
    if (!mandate) return sendError(reply, 404, say(ctx, 'Mandat nicht gefunden.', 'Mandate not found.'));
    await node.record({ ...ctx, mandate }, 'mandate.close', { de: `Mandat „${mandate.title}“ geschlossen`, en: `Mandate "${mandate.titleEn ?? mandate.title}" closed` });
    return mandate;
  });

  app.post('/api/session/mandate', async (request, reply) => {
    const ctx = need(request, reply, 'mandate.read');
    if (!ctx) return reply;
    const id = new Body(request.body).text('id', 80);
    const mandate = mandates.get(id);
    if (!mandate || !mandates.isUsable(mandate)) {
      return sendError(reply, 404, say(ctx, 'Mandat nicht gefunden oder nicht mehr gültig.', 'Mandate not found or no longer valid.'));
    }
    ctx.session.mandateId = mandate.id;
    await node.record({ ...ctx, mandate }, 'mandate.select', { de: `Arbeit unter Mandat „${mandate.title}“ aufgenommen`, en: `Work started under mandate "${mandate.titleEn ?? mandate.title}"` });
    return node.sessionInfo({ ...ctx, mandate });
  });

  // ================================================================ state + events

  app.get('/api/state', async (request, reply) => {
    const ctx = need(request, reply, null);
    return ctx ? node.appState() : reply;
  });

  app.get('/api/events', (request, reply) => {
    const ctx = node.contextOf(request);
    if (!ctx) {
      void sendError(reply, 401, 'Nicht angemeldet.');
      return;
    }
    reply.hijack();
    // The ledger head is otherwise only announced when an entry is written; a console that has just
    // signed in would show none until then.
    hub.add(reply.raw, { type: 'state', state: node.appState() }, { type: 'ledger', head: ledger.headHash, length: ledger.length });
    request.raw.on('close', () => reply.raw.end());
  });

  // ================================================================ recordings

  app.post('/api/videos', async (request, reply) => {
    const ctx = need(request, reply, 'source.write');
    if (!ctx) return reply;
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
    const sourceId = queryString(request.query, 'source') ?? DEFAULT_SOURCE_ID;
    const source = sources.get(sourceId);
    if (!source || source.mode === 'exercise') return sendError(reply, 400, say(ctx, 'Unbekannte Quelle.', 'Unknown source.'));

    // A full disk stops more than the upload: the ledger could no longer be written either.
    if (config.minFreeMb > 0) {
      const free = await freeBytes(config.dataDir);
      if (free !== null && free < config.minFreeMb * 1024 * 1024) {
        return sendError(
          reply,
          507,
          say(
            ctx,
            `Auf dem Datenträger des Knotens sind nur noch ${Math.floor(free / 1024 / 1024)} MB frei; unter ${config.minFreeMb} MB nimmt er keine Aufzeichnungen an.`,
            `Only ${Math.floor(free / 1024 / 1024)} MB are free on the node's volume; below ${config.minFreeMb} MB it accepts no recordings.`,
          ),
        );
      }
    }

    const response: UploadResponse = { accepted: [], rejected: [] };
    pipeline.uploadStarted();
    try {
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
          const entry = store.register({ id, name, sourceFile, sizeBytes: size, sampleFps, detail, sourceId: source.id });
          await store.persistMeta(entry);
          pipeline.enqueue(id);
          response.accepted.push(entry.info);
          hub.broadcast({ type: 'video', video: entry.info, stats: store.stats(), queueLength: pipeline.queueLength });
          await node.record(ctx, 'recording.upload', { de: `Aufzeichnung „${name}“ übernommen (${source.name})`, en: `Recording "${name}" taken in (${source.nameEn ?? source.name})` }, { videoId: id, bytes: size, sourceId: source.id });
        } catch (err: unknown) {
          await fs.rm(store.videoDir(id), RM_OPTIONS);
          response.rejected.push({ name, reason: err instanceof Error ? err.message : String(err) });
        }
      }
    } finally {
      pipeline.uploadFinished();
    }
    void node.enforceRetention();
    if (response.accepted.length === 0 && response.rejected.length === 0) {
      return sendError(reply, 400, 'Keine Datei übermittelt.');
    }
    return reply.code(response.accepted.length > 0 ? 201 : 400).send(response);
  });

  app.delete<{ Params: { id: string } }>('/api/videos/:id', async (request, reply) => {
    const ctx = need(request, reply, 'source.write');
    if (!ctx) return reply;
    // The same path as deleting a whole DATUM dataset: ledger first, analysis cancelled, files and
    // fix removed (see PlatformNode.deleteRecording).
    const result = await node.deleteRecording(ctx, request.params.id);
    if ('deleted' in result) return reply.code(204).send();
    if (result.refused === 'not-found') return sendError(reply, 404, say(ctx, 'Video nicht gefunden.', 'Video not found.'));
    if (result.refused === 'exercise') return sendError(reply, 409, say(ctx, 'Übungsmaterial wird über die Übung entfernt.', 'Exercise footage is removed with the exercise.'));
    // A recording that a case holds a picture from stays, as it does past the retention period.
    return sendError(
      reply,
      409,
      say(
        ctx,
        `Aus dieser Aufzeichnung ist ein Bild in einem Vorgang gesichert („${result.caseTitle}“). Sie bleibt erhalten, solange der Vorgang besteht.`,
        `A case holds a frame from this recording ("${result.caseTitle}"). It is kept for as long as the case exists.`,
      ),
      { code: 'held-by-case' },
    );
  });

  app.post<{ Params: { id: string } }>('/api/videos/:id/retry', async (request, reply) => {
    const ctx = need(request, reply, 'source.write');
    if (!ctx) return reply;
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
    const ctx = need(request, reply, 'media');
    if (!ctx) return reply;
    const { id } = request.params;
    const entry = isValidVideoId(id) ? store.get(id) : undefined;
    if (!entry) return sendError(reply, 404, 'Video nicht gefunden.');
    const scenes: SceneInfo[] = entry.scenes.map((s) => store.sceneInfo(entry, s));
    const body: VideoScenesResponse = { video: entry.info, scenes };
    return body;
  });

  app.get<{ Params: { id: string; index: string } }>('/api/videos/:id/scenes/:index/frames', async (request, reply) => {
    const ctx = need(request, reply, 'media');
    if (!ctx) return reply;
    const { id } = request.params;
    const entry = isValidVideoId(id) ? store.get(id) : undefined;
    const index = Number(request.params.index);
    const scene = entry && Number.isInteger(index) ? entry.scenes[index] : undefined;
    if (!entry || !scene) return sendError(reply, 404, 'Szene nicht gefunden.');
    // For exercise footage only what has been revealed so far may be shown.
    let visible: Set<number> | null = null;
    if (entry.info.scenario !== null) {
      visible = new Set();
      for (const scope of scenario.scopes()) if (scope.entry === entry && scope.frames) for (const f of scope.frames) visible.add(f);
    }
    const frames = entry.frames
      .map((f, idx) => ({ f, idx }))
      .slice(scene.firstFrame, scene.lastFrame + 1)
      .filter(({ idx }) => visible === null || visible.has(idx))
      .map(({ f }) => ({ frameNumber: f.n, time: f.t, url: frameUrl(id, f.n) }));
    const body: SceneFramesResponse = { video: entry.info, scene: store.sceneInfo(entry, scene), frames };
    return body;
  });

  // ================================================================ search

  app.get('/api/search', async (request, reply) => {
    const ctx = needMandate(request, reply, 'search');
    if (!ctx) return reply;
    const query = (queryString(request.query, 'q') ?? '').trim();
    if (query.length === 0) return sendError(reply, 400, say(ctx, 'Suchbegriff fehlt.', 'Query is missing.'));
    if (query.length > 300) return sendError(reply, 400, say(ctx, 'Suchbegriff ist zu lang (max. 300 Zeichen).', 'Query is too long (300 characters max).'));
    const limitRaw = Number(queryString(request.query, 'limit') ?? '60');
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.floor(limitRaw))) : 60;
    const videoId = queryString(request.query, 'videoId');
    if (videoId !== null && (!isValidVideoId(videoId) || !store.get(videoId))) {
      return sendError(reply, 404, 'Video nicht gefunden.');
    }

    const verdict = screenPrompt(query, guardOptions(ctx));
    if (!verdict.allowed) {
      await node.record(ctx, 'search.refused', { de: `Anfrage abgelehnt (${verdict.rule})`, en: `Query refused (${verdict.rule})` }, { query, rule: verdict.rule });
      return sendError(reply, 422, say(ctx, verdict.reason ?? '', verdict.reasonEn ?? ''), { code: 'refused', rule: verdict.rule });
    }

    const response = await search.search({ query, limit, videoId });
    const wantFederated = queryString(request.query, 'federated') === '1' && node.allowed(ctx, 'federation.read');
    if (wantFederated && federation.count > 0) {
      response.federated = await federation.search(query, 12, ctx.user, ctx.mandate);
    }
    await node.record(ctx, 'search.query', { de: `Suche „${query}“: ${response.matched} Treffer`, en: `Search "${query}": ${response.matched} ${response.matched === 1 ? 'hit' : 'hits'}` }, {
      query,
      matched: response.matched,
      scenesSearched: response.scenesSearched,
      tookMs: response.tookMs,
      top: response.results.slice(0, 8).map((r) => `${r.sceneId}#${r.frameNumber}`),
      federated: wantFederated && federation.count > 0,
      peers: response.federated.map((f) => ({ peer: f.peerId, ok: f.ok, matched: f.matched, receipt: f.receipt })),
      flags: verdict.flags,
    });
    return response;
  });

  app.get('/api/explain', async (request, reply) => {
    const ctx = needMandate(request, reply, 'search');
    if (!ctx) return reply;
    const query = (queryString(request.query, 'q') ?? '').trim();
    const videoId = queryString(request.query, 'videoId') ?? '';
    const frameNumber = Number(queryString(request.query, 'frame') ?? '');
    if (query.length === 0 || query.length > 300) return sendError(reply, 400, 'Suchbegriff fehlt oder ist zu lang.');
    if (!isValidVideoId(videoId) || !Number.isInteger(frameNumber) || frameNumber < 1) {
      return sendError(reply, 400, 'Ungültige Frame-Referenz.');
    }
    const verdict = screenPrompt(query, guardOptions(ctx));
    if (!verdict.allowed) {
      await node.record(ctx, 'search.refused', { de: `Anfrage abgelehnt (${verdict.rule})`, en: `Query refused (${verdict.rule})` }, { query, rule: verdict.rule, via: 'explain' });
      return sendError(reply, 422, say(ctx, verdict.reason ?? '', verdict.reasonEn ?? ''), { code: 'refused', rule: verdict.rule });
    }
    const result = await search.explain({ videoId, frameNumber, query });
    // Showing where a text applies in one picture is a query of its own. The console asks this for
    // texts that are on record already (the person's own search, the description of a watch); only
    // a text that is on record nowhere gets an entry here, so that no question goes unrecorded.
    const onRecord =
      watches.listWatches().some((watch) => watch.prompt === query) ||
      ledger.list({ limit: 200, actor: ctx.user.id, action: 'search.query' }).some((entry) => entry.data['query'] === query);
    if (!onRecord) {
      await node.record(ctx, 'search.explain', { de: `Fundstelle zu „${query}“ in einem Bild gezeigt`, en: `Match for "${query}" shown in a frame` }, { query, videoId, frame: frameNumber, flags: verdict.flags });
    }
    return result;
  });

  app.get('/api/embedding-map', async (request, reply) => {
    const ctx = need(request, reply, 'media');
    if (!ctx) return reply;
    if (!model.ready) return sendError(reply, 503, 'Das Modell wird noch geladen.');
    return search.map();
  });

  // ================================================================ sources, exercise, watches, alerts

  const snapshot = (): IntelSnapshot => ({
    sources: node.sourceList(),
    feeds: node.feeds(),
    scenario: scenario.info(),
    watches: watches.listWatches(),
    alerts: watches.listAlerts().slice(0, 400),
    incidents: incidents.list(),
  });

  app.get('/api/intel', async (request, reply) => {
    const ctx = need(request, reply, 'media');
    return ctx ? snapshot() : reply;
  });

  app.post('/api/sources', async (request, reply) => {
    const ctx = need(request, reply, 'source.write');
    if (!ctx) return reply;
    const body = new Body(request.body);
    const name = body.text('name', 80);
    const kind = body.text('kind', 20) as SourceKind;
    if (name.length < 2 || !SOURCE_KINDS.includes(kind)) return sendError(reply, 400, say(ctx, 'Name und Art der Quelle sind erforderlich.', 'Name and kind of the source are required.'));
    // A stream address makes the node open a connection of its own; that is reserved to supervisors.
    const streamUrl = body.text('streamUrl', 500);
    if (streamUrl !== '') {
      if (!node.allowed(ctx, 'source.live')) {
        return sendError(reply, 403, say(ctx, 'Direktbilder darf nur die Leitung anschließen.', 'Only a supervisor may connect live streams.'));
      }
      const streamAddress = parseStreamAddress(streamUrl);
      if (streamAddress && !streamHostAllowed(streamAddress.hostname, config.streamHosts)) {
        return sendError(
          reply,
          403,
          say(
            ctx,
            'Der Betreiber dieses Knotens lässt Direktbilder nur von benannten Adressen zu; diese gehört nicht dazu.',
            'The operator of this node accepts live streams from named addresses only; this one is not among them.',
          ),
        );
      }
      if (!streamAddress) {
        return sendError(
          reply,
          400,
          say(ctx, 'Die Adresse ist kein unterstützter Strom (rtsp, rtsps, http, https, rtmp, srt, udp, tcp).', 'The address is not a supported stream (rtsp, rtsps, http, https, rtmp, srt, udp, tcp).'),
        );
      }
    }
    // Opening a source to the peers is a decision about what leaves the house.
    if (body.flag('shared', false) && !node.allowed(ctx, 'federation.write')) {
      return sendError(reply, 403, say(ctx, 'Eine Quelle für den Verbund freigeben darf nur die Leitung.', 'Only a supervisor may release a source to the federation.'));
    }
    const source = sources.create({
      name,
      kind,
      owner: body.text('owner', 80),
      description: body.text('description', 300),
      lat: body.nullableNumber('lat', -90, 90),
      lon: body.nullableNumber('lon', -180, 180),
      mode: streamUrl !== '' ? 'live' : 'archive',
      shared: body.flag('shared', false),
    });
    if (streamUrl !== '') await node.connectStream(source.id, streamUrl);
    await node.record(ctx, 'source.create', { de: `Quelle „${name}“ angelegt`, en: `Source "${name}" created` }, {
      sourceId: source.id,
      kind,
      shared: source.shared,
      ...(streamUrl !== '' ? { stream: redactStreamAddress(streamUrl) } : {}),
    });
    return reply.code(201).send(node.sourceList().find((s) => s.id === source.id) ?? source);
  });

  app.patch<{ Params: { id: string } }>('/api/sources/:id', async (request, reply) => {
    const ctx = need(request, reply, 'source.write');
    if (!ctx) return reply;
    const body = new Body(request.body);
    const patch: Parameters<typeof sources.update>[1] = {};
    if (body.has('name') && body.text('name', 80).length >= 2) patch.name = body.text('name', 80);
    if (body.has('shared')) {
      if (!node.allowed(ctx, 'federation.write')) {
        return sendError(reply, 403, say(ctx, 'Eine Quelle für den Verbund freigeben oder sperren darf nur die Leitung.', 'Only a supervisor may release a source to the federation or withdraw it.'));
      }
      patch.shared = body.flag('shared', false);
    }
    if (body.has('lat')) patch.lat = body.nullableNumber('lat', -90, 90);
    if (body.has('lon')) patch.lon = body.nullableNumber('lon', -180, 180);
    const source = sources.update(request.params.id, patch);
    if (!source) return sendError(reply, 404, say(ctx, 'Quelle nicht gefunden.', 'Source not found.'));
    await node.record(ctx, 'source.update', { de: `Quelle „${source.name}“ geändert`, en: `Source "${source.nameEn ?? source.name}" changed` }, { sourceId: source.id, ...patch });
    return source;
  });

  app.delete<{ Params: { id: string } }>('/api/sources/:id', async (request, reply) => {
    const ctx = need(request, reply, 'source.write');
    if (!ctx) return reply;
    const source = sources.get(request.params.id);
    if (!source || source.mode === 'exercise' || source.id === DEFAULT_SOURCE_ID) {
      return sendError(reply, 404, say(ctx, 'Quelle nicht gefunden oder nicht löschbar.', 'Source not found or cannot be removed.'));
    }
    const hasRecordings = store.all().some((e) => e.info.sourceId === source.id);
    if (source.mode === 'live') {
      if (!node.allowed(ctx, 'source.live')) {
        return sendError(reply, 403, say(ctx, 'Direktbilder darf nur die Leitung trennen.', 'Only a supervisor may disconnect live streams.'));
      }
      await node.disconnectStream(source.id);
      if (hasRecordings) {
        // What the stream delivered stays as the archive of this source.
        source.mode = 'archive';
        sources.update(source.id, {});
        await node.record(ctx, 'source.disconnect', { de: `Direktbild „${source.name}“ getrennt`, en: `Live feed "${source.nameEn ?? source.name}" disconnected` }, { sourceId: source.id });
        node.broadcastFeeds();
        return reply.code(200).send(source);
      }
    } else if (hasRecordings) {
      return sendError(reply, 409, say(ctx, 'Der Quelle sind noch Aufzeichnungen zugeordnet.', 'The source still has recordings.'));
    }
    sources.remove(source.id);
    await node.record(ctx, 'source.delete', { de: `Quelle „${source.name}“ entfernt`, en: `Source "${source.nameEn ?? source.name}" removed` }, { sourceId: source.id });
    return reply.code(204).send();
  });

  app.post<{ Params: { action: string } }>('/api/exercise/:action', async (request, reply) => {
    const ctx = need(request, reply, 'scenario.control');
    if (!ctx) return reply;
    const body = new Body(request.body);
    const speedRaw = body.number('speed', 1, 1, 8);
    const speed = EXERCISE_SPEEDS.includes(speedRaw) ? speedRaw : 1;
    const title = scenario.definition?.title ?? 'Übung';
    const titleEn = scenario.definition?.titleEn || (scenario.definition?.title ?? 'Exercise');
    try {
      switch (request.params.action) {
        case 'install':
          await scenario.installFootage();
          await node.record(ctx, 'exercise.install', { de: `Übungsmaterial „${title}“ eingespielt`, en: `Exercise footage "${titleEn}" installed` });
          break;
        case 'start':
          // Watches must be in place before the first picture of the exercise arrives.
          await node.settled;
          scenario.start(speed);
          await node.record(ctx, 'exercise.start', { de: `Übung „${title}“ gestartet (${speed}×)`, en: `Exercise "${titleEn}" started (${speed}×)` }, { speed });
          break;
        case 'pause':
          scenario.pause();
          break;
        case 'resume':
          scenario.resume(body.has('speed') ? speed : undefined);
          break;
        case 'speed':
          scenario.setSpeed(speed);
          break;
        case 'stop':
          scenario.stop();
          await node.record(ctx, 'exercise.stop', { de: `Übung „${title}“ beendet, Ergebnisse verworfen`, en: `Exercise "${titleEn}" ended, results discarded` });
          break;
        case 'uninstall':
          await scenario.uninstall();
          await node.record(ctx, 'exercise.uninstall', { de: `Übungsmaterial „${title}“ entfernt`, en: `Exercise footage "${titleEn}" removed` });
          break;
        default:
          return sendError(reply, 404, 'Unbekannte Aktion.');
      }
    } catch (err: unknown) {
      return sendError(reply, 409, err instanceof Error ? err.message : String(err));
    }
    return snapshot();
  });

  const readWatchInput = (body: Body): { input: Parameters<typeof watches.create>[0] | null; problem: string | null } => {
    const name = body.text('name', 80);
    const prompt = body.text('prompt', 200);
    const exclude = body.texts('exclude', 6, 120);
    // The trained hazard model misjudges footage it was not trained on; it comments on alerts as a
    // second opinion and does not raise any of its own.
    if (body.text('kind', 10) === 'hazard') {
      return { input: null, problem: 'Das Gefahrenmodell steht nur als Zweitmeinung zu Meldungen zur Verfügung, nicht als eigene Wache.' };
    }
    if (name.length < 2) return { input: null, problem: 'Name fehlt.' };
    if (prompt.length < 3) return { input: null, problem: 'Beschreibung fehlt.' };
    const kinds = body.texts('sourceKinds', 8, 20).filter((k): k is SourceKind => (SOURCE_KINDS as readonly string[]).includes(k));
    return {
      input: {
        name,
        kind: 'text',
        prompt,
        exclude,
        hazardClass: null,
        severity: Math.round(body.number('severity', 2, 1, 3)) as Severity,
        threshold: body.number('threshold', 0.6, 0.05, 0.99),
        persistence: Math.round(body.number('persistence', 2, 1, 20)),
        cooldownSec: Math.round(body.number('cooldownSec', 30, 5, 3600)),
        sourceKinds: kinds,
      },
      problem: null,
    };
  };

  app.get('/api/watches', async (request, reply) => {
    const ctx = need(request, reply, 'watch.read');
    return ctx ? watches.listWatches() : reply;
  });

  app.post('/api/watches/preview', async (request, reply) => {
    const ctx = needMandate(request, reply, 'watch.write');
    if (!ctx) return reply;
    if (!model.ready) return sendError(reply, 503, 'Das Modell wird noch geladen.');
    const body = new Body(request.body);
    const prompt = body.text('prompt', 200);
    const exclude = body.texts('exclude', 6, 120);
    if (prompt.length < 3) return sendError(reply, 400, say(ctx, 'Beschreibung fehlt.', 'Description is missing.'));
    for (const text of [prompt, ...exclude]) {
      const verdict = screenPrompt(text, guardOptions(ctx));
      if (!verdict.allowed) {
        await node.record(ctx, 'watch.refused', { de: `Wache abgelehnt (${verdict.rule})`, en: `Watch refused (${verdict.rule})` }, { prompt: text, rule: verdict.rule, via: 'preview' });
        return sendError(reply, 422, say(ctx, verdict.reason ?? '', verdict.reasonEn ?? ''), { code: 'refused', rule: verdict.rule });
      }
    }
    // Trying a description on the stock answers with a count and sample pictures: that is a
    // search, and it is recorded as one before the answer goes out.
    const preview = await watches.preview(prompt, exclude);
    await node.record(ctx, 'watch.preview', { de: `Beschreibung am Bestand geprüft: „${prompt}“, ${preview.matches} von ${preview.framesChecked} Bildern`, en: `Description tested on the archive: "${prompt}", ${preview.matches} of ${preview.framesChecked} frames` }, {
      prompt,
      exclude,
      matches: preview.matches,
      framesChecked: preview.framesChecked,
    });
    return preview;
  });

  app.post('/api/watches', async (request, reply) => {
    const ctx = needMandate(request, reply, 'watch.write');
    if (!ctx) return reply;
    if (!model.ready) return sendError(reply, 503, 'Das Modell wird noch geladen.');
    const { input, problem } = readWatchInput(new Body(request.body));
    if (!input) return sendError(reply, 400, problem ?? 'Ungültige Wache.');
    for (const text of [input.prompt, ...input.exclude]) {
      if (text === '') continue;
      const verdict = screenPrompt(text, guardOptions(ctx));
      if (!verdict.allowed) {
        await node.record(ctx, 'watch.refused', { de: `Wache abgelehnt (${verdict.rule})`, en: `Watch refused (${verdict.rule})` }, { prompt: text, rule: verdict.rule });
        return sendError(reply, 422, say(ctx, verdict.reason ?? '', verdict.reasonEn ?? ''), { code: 'refused', rule: verdict.rule });
      }
    }
    const watch = await watches.create(input, ctx.user, ctx.mandate.id);
    await node.record(ctx, 'watch.create', { de: `Wache „${watch.name}“ aufgestellt`, en: `Watch "${watch.nameEn ?? watch.name}" set up` }, {
      watchId: watch.id,
      kind: watch.kind,
      prompt: watch.prompt,
      exclude: watch.exclude,
      hazardClass: watch.hazardClass,
      threshold: watch.threshold,
    });
    return reply.code(201).send(watch);
  });

  app.patch<{ Params: { id: string } }>('/api/watches/:id', async (request, reply) => {
    const ctx = need(request, reply, 'watch.write');
    if (!ctx) return reply;
    const body = new Body(request.body);
    const patch: Parameters<typeof watches.update>[1] = {};
    if (body.has('enabled')) patch.enabled = body.flag('enabled', true);
    if (body.has('threshold')) patch.threshold = body.number('threshold', 0.6, 0.05, 0.99);
    if (body.has('persistence')) patch.persistence = Math.round(body.number('persistence', 2, 1, 20));
    if (body.has('cooldownSec')) patch.cooldownSec = Math.round(body.number('cooldownSec', 30, 5, 3600));
    if (body.has('severity')) patch.severity = Math.round(body.number('severity', 2, 1, 3)) as Severity;
    const watch = watches.update(request.params.id, patch);
    if (!watch) return sendError(reply, 404, say(ctx, 'Wache nicht gefunden.', 'Watch not found.'));
    await node.record(ctx, 'watch.update', { de: `Wache „${watch.name}“ geändert`, en: `Watch "${watch.nameEn ?? watch.name}" changed` }, { watchId: watch.id, ...patch });
    return watch;
  });

  app.delete<{ Params: { id: string } }>('/api/watches/:id', async (request, reply) => {
    const ctx = need(request, reply, 'watch.write');
    if (!ctx) return reply;
    const watch = watches.getWatch(request.params.id);
    if (!watch) return sendError(reply, 404, say(ctx, 'Wache nicht gefunden.', 'Watch not found.'));
    watches.remove(watch.id);
    await node.record(ctx, 'watch.delete', { de: `Wache „${watch.name}“ abgezogen`, en: `Watch "${watch.nameEn ?? watch.name}" withdrawn` }, { watchId: watch.id });
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/watches/:id/retrain', async (request, reply) => {
    const ctx = need(request, reply, 'watch.write');
    if (!ctx) return reply;
    const before = watches.getWatch(request.params.id);
    if (!before) return sendError(reply, 404, say(ctx, 'Wache nicht gefunden.', 'Watch not found.'));
    const previousVersion = before.version ?? 1;
    const watch = watches.retrainNow(before.id);
    if (!watch) return sendError(reply, 409, say(ctx, 'Für diese Wache liegen keine Rückmeldungen vor.', 'There is no feedback for this watch yet.'));
    await node.record(ctx, 'watch.retrain', { de: `Wache „${watch.name}“ nachgeschärft (Version ${previousVersion} → ${watch.version})`, en: `Watch "${watch.nameEn ?? watch.name}" refined (version ${previousVersion} → ${watch.version})` }, {
      watchId: watch.id,
      fromVersion: previousVersion,
      toVersion: watch.version,
      confirmed: watch.feedback.confirmed,
      dismissed: watch.feedback.dismissed,
    });
    return watch;
  });

  app.post<{ Params: { id: string } }>('/api/watches/:id/reset', async (request, reply) => {
    const ctx = need(request, reply, 'watch.write');
    if (!ctx) return reply;
    const watch = watches.resetLearning(request.params.id);
    if (!watch) return sendError(reply, 404, say(ctx, 'Wache nicht gefunden.', 'Watch not found.'));
    await node.record(ctx, 'watch.reset', { de: `Gelerntes der Wache „${watch.name}“ verworfen (Version ${watch.version})`, en: `Training of watch "${watch.nameEn ?? watch.name}" discarded (version ${watch.version})` }, { watchId: watch.id, toVersion: watch.version });
    return watch;
  });

  app.post<{ Params: { id: string } }>('/api/alerts/:id/review', async (request, reply) => {
    const ctx = need(request, reply, 'alert.triage');
    if (!ctx) return reply;
    const verdictRaw = new Body(request.body).text('verdict', 12);
    if (verdictRaw !== 'confirmed' && verdictRaw !== 'dismissed') return sendError(reply, 400, 'verdict: confirmed | dismissed');
    const alert = await watches.review(request.params.id, verdictRaw, ctx.user);
    if (!alert) return sendError(reply, 404, say(ctx, 'Meldung nicht gefunden.', 'Alert not found.'));
    await node.record(
      ctx,
      `alert.${verdictRaw === 'confirmed' ? 'confirm' : 'dismiss'}`,
      {
        de: `Meldung „${alert.watchName}“ von ${alert.sourceName} ${verdictRaw === 'confirmed' ? 'bestätigt' : 'verworfen'}`,
        en: `Alert "${alert.watchNameEn ?? alert.watchName}" from ${alert.sourceNameEn ?? alert.sourceName} ${verdictRaw === 'confirmed' ? 'confirmed' : 'dismissed'}`,
      },
      { alertId: alert.id, watchId: alert.watchId },
    );
    return { alert, watch: watches.getWatch(alert.watchId) ?? null };
  });

  app.post<{ Params: { id: string } }>('/api/incidents/:id/status', async (request, reply) => {
    const ctx = need(request, reply, 'alert.triage');
    if (!ctx) return reply;
    const status = new Body(request.body).text('status', 14);
    if (status !== 'open' && status !== 'acknowledged' && status !== 'closed') return sendError(reply, 400, 'status: open | acknowledged | closed');
    const incident = incidents.setStatus(request.params.id, status);
    if (!incident) return sendError(reply, 404, say(ctx, 'Lage nicht gefunden.', 'Incident not found.'));
    await node.record(ctx, 'incident.status', { de: `Lage „${incident.title}“: ${status}`, en: `Incident "${incident.titleEn || incident.title}": ${status}` }, { incidentId: incident.id, status });
    return incident;
  });

  // ================================================================ cases + reports

  app.get('/api/cases', async (request, reply) => {
    const ctx = need(request, reply, 'case.read');
    return ctx ? cases.list() : reply;
  });

  app.post('/api/cases', async (request, reply) => {
    const ctx = needMandate(request, reply, 'case.write');
    if (!ctx) return reply;
    const title = new Body(request.body).text('title', 140);
    if (title.length < 3) return sendError(reply, 400, say(ctx, 'Titel fehlt.', 'Title is missing.'));
    const file = await cases.create(title, ctx.mandate.id, ctx.user);
    await node.record(ctx, 'case.create', { de: `Vorgang „${title}“ angelegt`, en: `Case "${title}" opened` }, { caseId: file.id });
    return reply.code(201).send(file);
  });

  app.post<{ Params: { id: string } }>('/api/cases/:id/items', async (request, reply) => {
    const ctx = need(request, reply, 'case.write');
    if (!ctx) return reply;
    const body = new Body(request.body);
    const videoId = body.text('videoId', 32);
    const frameNumber = Math.round(body.number('frameNumber', 0, 0, 1e9));
    if (!isValidVideoId(videoId) || frameNumber < 1) return sendError(reply, 400, 'Ungültige Frame-Referenz.');
    const rawBox = body.raw('box') as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | null | undefined;
    const box =
      rawBox && [rawBox.x, rawBox.y, rawBox.w, rawBox.h].every((v) => typeof v === 'number' && Number.isFinite(v))
        ? { x: rawBox.x as number, y: rawBox.y as number, w: rawBox.w as number, h: rawBox.h as number }
        : null;
    // When the picture was taken is read from the recording, not from what the browser says:
    // for exercise footage the moment the exercise showed it, otherwise recording start plus offset.
    const scope = node.scopes().find((candidate) => candidate.entry.info.id === videoId);
    const frameIdx = scope ? scope.entry.frames.findIndex((frame) => frame.n === frameNumber) : -1;
    const recorded = store.get(videoId);
    const offsetMs = Math.round((recorded?.frames.find((frame) => frame.n === frameNumber)?.t ?? 0) * 1000);
    const at = scope && frameIdx >= 0 ? scope.timeOf(frameIdx) : (recorded?.info.capturedAt ?? Date.now()) + offsetMs;
    const item = await cases.addFrame(
      request.params.id,
      { videoId, frameNumber, at, note: body.text('note', 500), query: body.text('query', 300) || null, box },
      ctx.user,
    );
    if (!item) return sendError(reply, 409, say(ctx, 'Vorgang nicht gefunden, versiegelt oder Bild unbekannt.', 'Case not found, sealed, or frame unknown.'));
    await node.record(ctx, 'case.evidence', { de: `Beweisstück zu Vorgang ${request.params.id} genommen`, en: `Evidence added to case ${request.params.id}` }, {
      caseId: request.params.id,
      videoId,
      frame: frameNumber,
      sha256: item.sha256,
    });
    void node.enforceRetention();
    return reply.code(201).send(cases.get(request.params.id));
  });

  app.delete<{ Params: { id: string; itemId: string } }>('/api/cases/:id/items/:itemId', async (request, reply) => {
    const ctx = need(request, reply, 'case.write');
    if (!ctx) return reply;
    const removed = await cases.removeItem(request.params.id, request.params.itemId);
    if (!removed) return sendError(reply, 409, say(ctx, 'Nicht entfernbar.', 'Cannot be removed.'));
    await node.record(ctx, 'case.evidence-removed', { de: `Beweisstück aus Vorgang ${request.params.id} entfernt`, en: `Evidence removed from case ${request.params.id}` }, { caseId: request.params.id, itemId: request.params.itemId });
    return cases.get(request.params.id);
  });

  app.post<{ Params: { id: string } }>('/api/cases/:id/notes', async (request, reply) => {
    const ctx = need(request, reply, 'case.write');
    if (!ctx) return reply;
    const text = new Body(request.body).text('text', 2000);
    if (text.length < 1) return sendError(reply, 400, say(ctx, 'Text fehlt.', 'Text is missing.'));
    const file = await cases.addNote(request.params.id, text, ctx.user);
    if (!file) return sendError(reply, 409, say(ctx, 'Vorgang nicht gefunden oder versiegelt.', 'Case not found or sealed.'));
    await node.record(ctx, 'case.note', { de: `Vermerk zu Vorgang ${file.id}`, en: `Note on case ${file.id}` }, { caseId: file.id });
    return file;
  });

  app.post<{ Params: { id: string } }>('/api/cases/:id/seal', async (request, reply) => {
    // Sealing closes a case for good; it is the supervisor's step, not the analyst's.
    const ctx = need(request, reply, 'case.seal');
    if (!ctx) return reply;
    const file = await cases.seal(request.params.id, ctx.user);
    if (!file) return sendError(reply, 409, say(ctx, 'Vorgang nicht gefunden oder bereits versiegelt.', 'Case not found or already sealed.'));
    await node.record(ctx, 'case.seal', { de: `Vorgang „${file.title}“ versiegelt`, en: `Case "${file.title}" sealed` }, { caseId: file.id, sealHash: file.sealHash, items: file.items.length });
    return file;
  });

  app.get<{ Params: { id: string } }>('/api/cases/:id/report', async (request, reply) => {
    const ctx = need(request, reply, 'case.read');
    if (!ctx) return reply;
    const file = cases.get(request.params.id);
    if (!file) return sendError(reply, 404, say(ctx, 'Vorgang nicht gefunden.', 'Case not found.'));
    const related = ledger
      .list({ limit: 4000 })
      .filter((e) => e.data['caseId'] === file.id)
      .reverse();
    const html = await caseReport({
      lang: ctx.lang,
      node: node.info,
      file,
      mandate: mandates.get(file.mandateId) ?? null,
      contentHash: file.sealHash ?? cases.contentHash(file),
      ledger: related,
      ledgerHead: ledger.headHash,
      store,
      userName: (id) => auth.getUser(id)?.name ?? id,
      // Oversight may read case files but never sees imagery; its copy lists the exhibits without pictures.
      pictures: node.allowed(ctx, 'media'),
    });
    await node.record(ctx, 'case.export', { de: `Vorgang „${file.title}“ als Bericht ausgegeben`, en: `Case "${file.title}" exported as a report` }, { caseId: file.id, pictures: node.allowed(ctx, 'media') });
    return reply.type('text/html; charset=utf-8').send(html);
  });

  app.get('/api/report/situation', async (request, reply) => {
    const ctx = need(request, reply, 'search');
    if (!ctx) return reply;
    const html = await situationReport({
      lang: ctx.lang,
      node: node.info,
      mandate: ctx.mandate,
      incidents: incidents.list(),
      alerts: watches.listAlerts(),
      sources: sources.list().filter((s) => s.mode !== 'archive' || s.id !== DEFAULT_SOURCE_ID),
      onlineSources: node.feeds().filter((f) => f.online).length,
      framesAnalysed: store.stats().frames,
      ledgerHead: ledger.headHash,
      ledgerLength: ledger.length,
      author: `${ctx.user.name} (${ctx.user.unit})`,
      store,
    });
    await node.record(ctx, 'report.situation', { de: 'Lagebericht erzeugt', en: 'Situation report generated' }, { incidents: incidents.list().filter((i) => i.status !== 'closed').length });
    return reply.type('text/html; charset=utf-8').send(html);
  });

  app.get('/api/report/measurement', async (request, reply) => {
    const ctx = need(request, reply, 'metrics.read');
    if (!ctx) return reply;
    const metrics = collectMetrics({
      store,
      sources,
      ledger,
      watches,
      scenario,
      faces: node.shared.faces,
      hazard: node.shared.hazard,
      retentionDays: config.retentionDays,
    });
    const videos = store.infos().filter((v) => v.status !== 'error');
    const html = measurementReport({
      lang: ctx.lang,
      node: node.info,
      mandate: ctx.mandate,
      author: `${ctx.user.name} (${ctx.user.unit})`,
      scenario: scenario.info(),
      metrics,
      recordings: { total: videos.length, analysed: videos.filter((v) => v.status === 'ready').length },
      machine: { cpu: os.cpus()[0]?.model.trim() ?? 'unbekannt', threads: config.threads, device: model.state.device, modelId: config.modelId },
      ledgerHead: ledger.headHash,
      ledgerLength: ledger.length,
    });
    await node.record(ctx, 'report.measurement', { de: 'Messbericht erzeugt', en: 'Measurement report generated' }, {
      detected: metrics.evaluation?.detected ?? null,
      events: metrics.evaluation?.total ?? null,
      falseAlarms: metrics.evaluation?.falseAlarms ?? null,
    });
    return reply.type('text/html; charset=utf-8').send(html);
  });

  // ================================================================ ledger + metrics

  app.get('/api/ledger', async (request, reply) => {
    const ctx = need(request, reply, null);
    if (!ctx) return reply;
    // Operators see their own trail; supervisors and auditors see everything.
    const full = node.allowed(ctx, 'ledger.read');
    const limitRaw = Number(queryString(request.query, 'limit') ?? '100');
    const beforeRaw = Number(queryString(request.query, 'before') ?? '');
    const action = queryString(request.query, 'action') ?? undefined;
    const actor = full ? (queryString(request.query, 'actor') ?? undefined) : ctx.user.id;
    const body: LedgerPage = {
      head: ledger.headHash,
      length: ledger.length,
      entries: ledger.list({
        limit: Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.floor(limitRaw))) : 100,
        ...(Number.isFinite(beforeRaw) && beforeRaw > 0 ? { before: beforeRaw } : {}),
        ...(action ? { action } : {}),
        ...(actor ? { actor } : {}),
      }),
    };
    return body;
  });

  app.post('/api/ledger/verify', async (request, reply) => {
    const ctx = need(request, reply, null);
    if (!ctx) return reply;
    const result = await ledger.verify();
    await node.record(ctx, 'ledger.verify', {
      de: `Protokoll geprüft: ${result.ok ? 'unversehrt' : 'BESCHÄDIGT'} (${result.entries} Einträge)`,
      en: `Ledger verified: ${result.ok ? 'intact' : 'DAMAGED'} (${result.entries} ${result.entries === 1 ? 'entry' : 'entries'})`,
    }, {
      ok: result.ok,
      entries: result.entries,
      brokenAt: result.brokenAt,
    });
    return result;
  });

  app.get('/api/ledger/export', async (request, reply) => {
    const ctx = need(request, reply, 'ledger.read');
    if (!ctx) return reply;
    await node.record(ctx, 'ledger.export', { de: 'Protokoll exportiert', en: 'Ledger exported' }, { entries: ledger.length });
    return reply
      .type('application/x-ndjson; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="sicht-ledger-${node.info.id}.jsonl"`)
      .send(await ledger.exportText());
  });

  /** Random sample of recorded searches for an oversight review. */
  app.get('/api/ledger/sample', async (request, reply) => {
    const ctx = need(request, reply, 'ledger.read');
    if (!ctx) return reply;
    const sizeRaw = Number(queryString(request.query, 'n') ?? '10');
    const size = Number.isFinite(sizeRaw) ? Math.min(50, Math.max(1, Math.floor(sizeRaw))) : 10;
    const QUERIES = ['search.query', 'search.refused', 'search.explain', 'watch.preview', 'watch.refused', 'federation.inbound', 'federation.refused'];
    // Drawn from the whole ledger file, so that old queries cannot be pushed out of reach by new ones.
    const { population, entries: sample } = await ledger.sample((e) => QUERIES.includes(e.action), size);
    await node.record(ctx, 'audit.sample', { de: `Stichprobe gezogen: ${sample.length} von ${population} Abfragen`, en: `Sample drawn: ${sample.length} of ${population} queries` }, { entries: sample.map((e) => e.seq) });
    return { population, entries: sample };
  });

  // ---- interfaces to existing situation-picture and warning systems

  app.get('/api/export/incidents.geojson', async (request, reply) => {
    const ctx = need(request, reply, 'search');
    if (!ctx) return reply;
    const features = incidents
      .list()
      .filter((i) => i.status !== 'closed')
      .map((i) => ({
        type: 'Feature',
        id: i.id,
        geometry: { type: 'Point', coordinates: [i.lon, i.lat] },
        properties: {
          title: ctx.lang === 'en' ? i.titleEn : i.title,
          severity: i.severity,
          status: i.status,
          place: i.place,
          mgrs: i.mgrs,
          firstSeen: new Date(i.firstSeen).toISOString(),
          lastSeen: new Date(i.lastSeen).toISOString(),
          corroboration: i.corroboration,
          alerts: i.alertIds.length,
          exercise: i.exercise,
          source: node.info.id,
        },
      }));
    await node.record(ctx, 'export.geojson', { de: `Lagen als GeoJSON ausgegeben (${features.length})`, en: `Incidents exported as GeoJSON (${features.length})` }, { incidents: features.length });
    return reply.type('application/geo+json; charset=utf-8').send({ type: 'FeatureCollection', features });
  });

  /** One incident as a CAP 1.2 message, the format used by public warning systems. */
  app.get<{ Params: { id: string } }>('/api/export/incidents/:id/cap', async (request, reply) => {
    const ctx = need(request, reply, 'search');
    if (!ctx) return reply;
    const incident = incidents.get(request.params.id);
    if (!incident) return sendError(reply, 404, say(ctx, 'Lage nicht gefunden.', 'Incident not found.'));
    const xml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const severity = incident.severity === 3 ? 'Severe' : incident.severity === 2 ? 'Moderate' : 'Minor';
    const certainty = incident.corroboration >= 2 ? 'Likely' : 'Possible';
    const cap = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>${xml(`${node.info.id}-${incident.id}`)}</identifier>
  <sender>${xml(node.info.id)}</sender>
  <sent>${new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00')}</sent>
  <status>${incident.exercise ? 'Exercise' : 'Actual'}</status>
  <msgType>Alert</msgType>
  <scope>Restricted</scope>
  <restriction>${xml(node.info.operator)}</restriction>
  <info>
    <language>${ctx.lang === 'en' ? 'en-GB' : 'de-DE'}</language>
    <category>Safety</category>
    <event>${xml(ctx.lang === 'en' ? incident.titleEn : incident.title)}</event>
    <urgency>Immediate</urgency>
    <severity>${severity}</severity>
    <certainty>${certainty}</certainty>
    <onset>${new Date(incident.firstSeen).toISOString().replace(/\.\d{3}Z$/, '+00:00')}</onset>
    <senderName>${xml(node.info.name)}</senderName>
    <headline>${xml(ctx.lang === 'en' ? incident.titleEn : incident.title)}</headline>
    <description>${xml(
      ctx.lang === 'en'
        ? `Detected by automated image analysis; reported by ${incident.corroboration} independent source(s). Requires assessment by the staff.`
        : `Durch automatische Bildauswertung erkannt; gemeldet von ${incident.corroboration} unabhängigen Quelle(n). Bewertung durch den Stab erforderlich.`,
    )}</description>
    <parameter><valueName>MGRS</valueName><value>${xml(incident.mgrs)}</value></parameter>
    <area>
      <areaDesc>${xml(incident.place || incident.mgrs)}</areaDesc>
      <circle>${incident.lat.toFixed(5)},${incident.lon.toFixed(5)} 0.5</circle>
    </area>
  </info>
</alert>
`;
    await node.record(ctx, 'export.cap', { de: `Lage „${incident.title}“ als CAP-Meldung ausgegeben`, en: `Incident "${incident.titleEn || incident.title}" exported as a CAP message` }, { incidentId: incident.id });
    return reply.type('application/cap+xml; charset=utf-8').send(cap);
  });

  app.get('/api/metrics', async (request, reply) => {
    const ctx = need(request, reply, 'metrics.read');
    if (!ctx) return reply;
    return collectMetrics({
      store,
      sources,
      ledger,
      watches,
      scenario,
      faces: node.shared.faces,
      hazard: node.shared.hazard,
      retentionDays: config.retentionDays,
    });
  });

  // ================================================================ federation

  app.get('/api/peers', async (request, reply) => {
    const ctx = need(request, reply, 'federation.read');
    return ctx ? federation.list() : reply;
  });

  const header = (request: FastifyRequest, name: string): string | undefined => {
    const value = request.headers[name];
    return typeof value === 'string' ? value : undefined;
  };
  /** The peer that signed this request for this node and this path, or null. */
  const peerOf = (request: FastifyRequest, path: string): ReturnType<typeof federation.authenticate> =>
    federation.authenticate(
      {
        node: header(request, 'x-sicht-node'),
        timestamp: header(request, 'x-sicht-timestamp'),
        nonce: header(request, 'x-sicht-nonce'),
        signature: header(request, 'x-sicht-signature'),
      },
      path,
      (request as FastifyRequest & { rawBody?: string }).rawBody ?? '',
    );
  /** Text from another node: a string of bounded length, or nothing. */
  const peerText = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');

  app.post('/api/federation/hello', async (request, reply) => {
    const peer = peerOf(request, '/api/federation/hello');
    if (!peer) return sendError(reply, 401, 'Unbekannter Knoten oder ungültige Signatur.');
    federation.noteContact(peer);
    const head = new Body(request.body).text('head', 64);
    if (/^[0-9a-f]{64}$/.test(head)) federation.witness(peer, head);
    const stats = store.stats();
    const body: FederationHello = {
      node: node.info,
      head: ledger.headHash,
      sources: sources.list().filter((s) => s.shared).length,
      frames: stats.frames,
    };
    return body;
  });

  app.post('/api/federation/search', async (request, reply) => {
    const peer = peerOf(request, '/api/federation/search');
    if (!peer) return sendError(reply, 401, 'Unbekannter Knoten oder ungültige Signatur.');
    federation.noteContact(peer);
    const actor = `node:${peer.id}`;

    // A peer may ask often, not without limit: every answer hands out previews of shared sources.
    const budget = federation.spend(peer.id);
    if (!budget.allowed) {
      if (budget.first) {
        await ledger.append({
          actor,
          role: 'peer',
          mandateId: null,
          action: 'federation.throttled',
          summary: `Fremdanfragen von ${peer.name} ausgesetzt: mehr als ${PEER_BUDGET} in ${PEER_BUDGET_WINDOW_MS / 60000} Minuten`,
          summaryEn: `Peer queries from ${peer.name} suspended: more than ${PEER_BUDGET} in ${PEER_BUDGET_WINDOW_MS / 60000} minutes`,
          data: { limit: PEER_BUDGET, windowMinutes: PEER_BUDGET_WINDOW_MS / 60000 },
        });
      }
      void reply.header('Retry-After', String(Math.ceil(PEER_BUDGET_WINDOW_MS / 1000)));
      return sendError(reply, 429, 'Zu viele Fremdanfragen in kurzer Zeit.', { code: 'throttled' });
    }

    // Everything a peer states is taken as text of bounded length; nothing is stored as sent.
    const incoming = request.body as { query?: unknown; limit?: unknown; head?: unknown; mandate?: Record<string, unknown> | null; requester?: { node?: Record<string, unknown> | null; user?: Record<string, unknown> | null } | null } | null;
    const query = peerText(incoming?.query, 300);
    const mandate = {
      title: peerText(incoming?.mandate?.['title'], 140),
      legalBasis: peerText(incoming?.mandate?.['legalBasis'], 200),
      exercise: incoming?.mandate?.['exercise'] === true,
    };
    const requester = {
      node: peerText(incoming?.requester?.node?.['id'], 64),
      id: peerText(incoming?.requester?.user?.['id'], 64),
      name: peerText(incoming?.requester?.user?.['name'], 80),
      unit: peerText(incoming?.requester?.user?.['unit'], 120),
    };
    if (query === '' || mandate.title === '' || mandate.legalBasis === '' || requester.id === '') {
      return sendError(reply, 400, 'Anfrage unvollständig: Frage, Mandat mit Rechtsgrundlage und anfragende Person sind erforderlich.');
    }
    if (requester.node !== peer.id) {
      return sendError(reply, 400, 'Der genannte Knoten ist nicht der, der die Anfrage unterschrieben hat.');
    }
    if (typeof incoming?.head === 'string' && /^[0-9a-f]{64}$/.test(incoming.head)) federation.witness(peer, incoming.head);

    // The answering node applies its own rules, whatever the asking node allowed. Descriptions of
    // persons are not answered for a peer at all: whether its mandate permits them is a statement
    // this node cannot check.
    const verdict = screenPrompt(query, { personDescriptions: false });
    if (!verdict.allowed) {
      await ledger.append({
        actor,
        role: 'peer',
        mandateId: null,
        action: 'federation.refused',
        summary: `Fremdanfrage von ${peer.name} abgelehnt (${verdict.rule})`,
        summaryEn: `Peer query from ${peer.name} refused (${verdict.rule})`,
        data: { query, rule: verdict.rule, user: requester.id, mandate: mandate.title },
      });
      return sendError(reply, 422, verdict.reason ?? 'Anfrage nicht zulässig.', { code: 'refused', rule: verdict.rule });
    }
    if (!model.ready) return sendError(reply, 503, 'Das Modell wird noch geladen.');

    const limit = Math.min(12, Math.max(1, Math.floor(typeof incoming?.limit === 'number' && Number.isFinite(incoming.limit) ? incoming.limit : 12)));
    const result = await search.search({ query, limit: 60, videoId: null, sharedOnly: true });
    const matches = result.results.filter((r) => r.confidence >= 0.5).slice(0, limit);
    const hits: FederatedHit[] = [];
    for (const match of matches) {
      // Peers receive a small masked preview, never the stored frame or the recording.
      let thumbnail = '';
      try {
        // Decoded from memory: handing sharp a path keeps the file open on Windows for a while.
        const stored = await fs.readFile(store.framePath(match.videoId, match.frameNumber));
        const bytes = await sharp(stored).resize({ width: 360 }).jpeg({ quality: 70 }).toBuffer();
        thumbnail = `data:image/jpeg;base64,${bytes.toString('base64')}`;
      } catch {
        continue;
      }
      hits.push({
        sourceName: match.sourceName,
        sourceKind: match.sourceKind,
        lat: match.lat,
        lon: match.lon,
        at: match.at,
        confidence: match.confidence,
        score: match.score,
        thumbnail,
        tags: match.tags.slice(0, 3),
      });
    }
    const entry = await ledger.append({
      actor,
      role: 'peer',
      mandateId: null,
      action: 'federation.inbound',
      summary: `Fremdanfrage von ${peer.name}: „${query}“, ${hits.length} Treffer freigegeben`,
      summaryEn: `Peer query from ${peer.name}: "${query}", ${hits.length} ${hits.length === 1 ? 'hit' : 'hits'} released`,
      data: {
        query,
        released: hits.length,
        requester: { user: requester.id, name: requester.name, unit: requester.unit },
        mandate: { title: mandate.title, legalBasis: mandate.legalBasis, exercise: mandate.exercise },
      },
    });
    const body: FederationResponse = {
      node: node.info,
      head: ledger.headHash,
      receipt: entry.seq,
      matched: result.results.filter((r) => r.confidence >= 0.5).length,
      hits,
    };
    return body;
  });

  // ================================================================ privacy: unmasking

  app.post('/api/unmask', async (request, reply) => {
    const ctx = needMandate(request, reply, 'media');
    if (!ctx) return reply;
    const body = new Body(request.body);
    const videoId = body.text('videoId', 32);
    const reason = body.text('reason', 500);
    const entry = isValidVideoId(videoId) ? store.get(videoId) : undefined;
    if (!entry) return sendError(reply, 404, 'Video nicht gefunden.');
    if (reason.length < 12) {
      return sendError(reply, 400, say(ctx, 'Bitte den Grund ausführen (mindestens 12 Zeichen).', 'Please state the reason (at least 12 characters).'));
    }
    // The approver's password is guarded like a sign-in: a wrong one counts against that account,
    // and after five in a row it is locked for a minute here as well.
    const approverId = body.text('approver', 64).toLowerCase();
    const approverKey = `user:${approverId}`;
    const wait = lockedFor(approverKey);
    if (wait > 0) {
      void reply.header('Retry-After', String(wait));
      return sendError(reply, 429, say(ctx, `Zu viele Fehlversuche für diese Freigabe. Neuer Versuch in ${wait} s.`, `Too many failed attempts for this approval. Try again in ${wait} s.`));
    }
    const approver = auth.verify(approverId, body.text('password', 200));
    if (!approver || !['supervisor'].includes(approver.role)) {
      if (!approver) noteFailure(approverKey);
      await node.record(ctx, 'privacy.unmask-denied', { de: 'Aufhebung der Maskierung abgelehnt: Freigabe ungültig', en: 'Unmasking refused: approval invalid' }, { videoId, approver: approverId });
      return sendError(reply, 403, say(ctx, 'Freigabe ungültig: Kennung oder Passwort der freigebenden Person stimmt nicht, oder ihr fehlt die Berechtigung.', 'Approval invalid: wrong credentials, or the approver lacks the permission.'));
    }
    failures.delete(approverKey);
    if (approver.id === ctx.user.id) {
      await node.record(ctx, 'privacy.unmask-denied', { de: 'Aufhebung der Maskierung abgelehnt: Freigabe durch die anfragende Person selbst', en: 'Unmasking refused: approved by the requesting person themselves' }, { videoId, approver: approver.id });
      return sendError(reply, 403, say(ctx, 'Vier-Augen-Prinzip: Die Freigabe muss von einer zweiten Person kommen.', 'Four-eyes principle: approval must come from a second person.'));
    }
    // The entry first, the grant after it: no original is shown under a grant that is not on record.
    const grant = { id: newId('gr'), videoId, userId: ctx.user.id, approver: approver.id, expires: Date.now() + UNMASK_TTL_MS };
    await node.record(ctx, 'privacy.unmask', { de: `Maskierung für „${entry.info.name}“ aufgehoben (Freigabe: ${approver.name})`, en: `Masking lifted for "${entry.info.name}" (approved by ${approver.name})` }, {
      videoId,
      reason,
      approver: approver.id,
      minutes: UNMASK_TTL_MS / 60000,
    });
    node.grants.set(grant.id, grant);
    return { grantId: grant.id, videoId, expires: grant.expires };
  });

  // ================================================================ media

  app.get<{ Params: { id: string; file: string } }>('/media/:id/frames/:file', async (request, reply) => {
    const ctx = need(request, reply, 'media');
    if (!ctx) return reply;
    const { id, file } = request.params;
    if (!isValidVideoId(id) || !/^\d{7}\.jpg$/.test(file) || !store.get(id)) {
      return sendError(reply, 404, 'Frame nicht gefunden.');
    }
    // Revalidated on every use: the next person at the same browser must not get pictures from its
    // cache without this check.
    return reply.header('Cache-Control', 'private, no-cache').header('Vary', 'Cookie').sendFile(`${id}/frames/${file}`);
  });

  /** Unmasked frame; only with a current grant for the recording. Falls back to the served frame when nothing was masked. */
  app.get<{ Params: { id: string; file: string } }>('/media/:id/original/:file', async (request, reply) => {
    const ctx = need(request, reply, 'media');
    if (!ctx) return reply;
    const { id, file } = request.params;
    const number = /^(\d{7})\.jpg$/.exec(file);
    if (!isValidVideoId(id) || !number || !store.get(id)) return sendError(reply, 404, 'Frame nicht gefunden.');
    if (!node.hasGrant(ctx, id)) return sendError(reply, 403, say(ctx, 'Keine gültige Freigabe für diese Aufzeichnung.', 'No valid approval for this recording.'));
    const original = originalFrameFileName(Number(number[1]));
    try {
      await fs.access(path.join(store.framesDir(id), original));
      return reply.header('Cache-Control', 'no-store').sendFile(`${id}/frames/${original}`);
    } catch {
      return reply.header('Cache-Control', 'no-store').sendFile(`${id}/frames/${file}`);
    }
  });

  /**
   * The recording itself is unmasked footage. It is handed out without approval only once it has
   * been analysed in full with the face detector running and no face was found. Until then, and
   * whenever something was masked, it needs a grant: a count of zero says nothing while the
   * analysis is still running, has failed or ran without the detector.
   */
  app.get<{ Params: { id: string } }>('/media/:id/source', async (request, reply) => {
    const ctx = need(request, reply, 'media');
    if (!ctx) return reply;
    const { id } = request.params;
    const entry = isValidVideoId(id) ? store.get(id) : undefined;
    if (!entry) return sendError(reply, 404, 'Video nicht gefunden.');
    const checked = entry.info.status === 'ready' && !entry.info.coarse && node.shared.faces.ready;
    if (!(checked && entry.info.facesMasked === 0) && !node.hasGrant(ctx, id)) {
      return sendError(
        reply,
        403,
        checked
          ? say(ctx, 'Die Aufzeichnung enthält maskierte Gesichter; das Original erfordert eine Freigabe.', 'The recording contains masked faces; the original requires approval.')
          : say(
              ctx,
              'Die Aufzeichnung ist noch nicht vollständig auf Gesichter geprüft; bis dahin erfordert sie eine Freigabe.',
              'The recording has not been checked for faces in full yet; until then it requires approval.',
            ),
        { code: checked ? 'masked' : 'unchecked' },
      );
    }
    const ext = path.extname(entry.sourceFile).toLowerCase();
    return reply
      .type(MIME_BY_EXTENSION[ext] ?? 'application/octet-stream')
      .header('Cache-Control', 'private, no-store')
      .sendFile(`${id}/${entry.sourceFile}`);
  });

  // ================================================================ console

  let hasWebDist = false;
  if (serveConsole) {
    try {
      await fs.access(path.join(config.webDistDir, 'index.html'));
      hasWebDist = true;
    } catch {
      hasWebDist = false;
    }
  }
  if (hasWebDist) {
    await app.register(fastifyStatic, {
      root: config.webDistDir,
      prefix: '/',
      decorateReply: false,
      // The page is asked for anew on every load: after an update it names new script files, and
      // a cached page would keep showing the old console. The scripts themselves carry a content
      // hash in their names and never change, so the browser may keep them.
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.header('Cache-Control', 'no-cache');
        else if (/[\\/]assets[\\/]/.test(filePath)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
      },
    });
  } else {
    app.get('/', async (_request, reply) =>
      reply
        .type('text/plain; charset=utf-8')
        .send(`Sicht-Knoten ${node.info.name} läuft. Konsole: "pnpm dev" (Entwicklung) oder "pnpm build" und neu starten.`),
    );
  }
}
