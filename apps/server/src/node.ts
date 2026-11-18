import Fastify, { LogController, type FastifyInstance, type FastifyRequest } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, repoRoot } from './config.js';
import { Auth, can, PERMISSIONS, type Permission, type Session } from './core/auth.js';
import { readJson, writeFileAtomic } from './core/json.js';
import { Ledger } from './core/ledger.js';
import { Mandates } from './core/mandates.js';
import { EventHub } from './events.js';
import { Cases } from './intel/cases.js';
import { Federation, type PeerRecord } from './intel/federation.js';
import { Incidents } from './intel/incidents.js';
import { LiveIngest, redactStreamAddress } from './intel/live.js';
import { scenarioWatchId } from './intel/metrics.js';
import type { Lang } from './intel/report.js';
import { ScenarioEngine, type Observation, type ScenarioDefinition } from './intel/scenario.js';
import type { SearchScope } from './intel/scoring.js';
import { Sources } from './intel/sources.js';
import { WatchEngine } from './intel/watches.js';
import type { FaceDetector } from './ml/faces.js';
import type { HazardHead } from './ml/head.js';
import type { EmbeddingModel } from './ml/model.js';
import type { VocabularyIndex } from './ml/vocab.js';
import { Pipeline } from './pipeline.js';
import { registerRoutes } from './routes.js';
import { DatumEngine } from './datum/engine.js';
import { sharedGallery } from './datum/shared.js';
import { TruthBook } from './datum/truth.js';
import { SearchEngine } from './search.js';
import { Store, type VideoEntry } from './store.js';
import type { AppState, FeedState, Mandate, NodeInfo, SessionInfo, SourceInfo, SourceKind, UserInfo } from './types.js';

export const VERSION = '0.5.0';

/** How often the witnessed ledger head of one peer is written to this node's own ledger. */
const WITNESS_INTERVAL_MS = 15 * 60 * 1000;

/** `https` when the node was given a certificate, `http` otherwise. */
export function nodeScheme(): 'http' | 'https' {
  return config.tlsCertFile !== '' && config.tlsKeyFile !== '' ? 'https' : 'http';
}

/** Reads certificate and key when both are configured; one without the other is a mistake. */
async function loadTls(): Promise<{ cert: Buffer; key: Buffer } | null> {
  const { tlsCertFile, tlsKeyFile } = config;
  if (tlsCertFile === '' && tlsKeyFile === '') return null;
  if (tlsCertFile === '' || tlsKeyFile === '') {
    throw new Error('SICHT_TLS_CERT und SICHT_TLS_KEY gehören zusammen: Zertifikat und Schlüssel, beide als PEM-Datei.');
  }
  try {
    return { cert: await fs.readFile(path.resolve(repoRoot, tlsCertFile)), key: await fs.readFile(path.resolve(repoRoot, tlsKeyFile)) };
  } catch (err: unknown) {
    throw new Error(`Zertifikat oder Schlüssel nicht lesbar (SICHT_TLS_CERT, SICHT_TLS_KEY): ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface NodeConfig {
  id: string;
  name: string;
  operator: string;
  region: string;
  lat: number;
  lon: number;
  host: string;
  port: number;
  dataDir: string;
  peers: PeerRecord[];
  /** Directory with a seed.json and clips/ that fill the archive of a fresh demonstration node. */
  seedDir?: string;
  /** false: the node never receives the exercise footage (DATUM reference node). */
  exercise?: boolean;
  /**
   * true: the recordings that came from the seed footage are exempt from retention. For the
   * DATUM reference set, which is the ground truth of the evaluation: it is seeded once (see
   * `seedArchive`) and would otherwise be deleted for good when the retention period runs out.
   * Everything else on the node, uploads included, keeps the normal retention.
   */
  keepSeed?: boolean;
}

export interface SeedFile {
  sources: {
    id: string;
    name: string;
    nameEn?: string;
    kind: SourceKind;
    owner: string;
    description: string;
    lat: number;
    lon: number;
    shared: boolean;
    /** `name` is the file name the recording gets in the node (neutral names for reference sets). */
    clips: { file: string; name?: string; daysAgo?: number }[];
  }[];
}

/** Key of a recording by its source and its name in the node. */
export function seedKey(sourceId: string, name: string): string {
  return JSON.stringify([sourceId, name]);
}

/**
 * The recordings a seed puts into a node (see `seedArchive`), as `seedKey` values. A recording
 * is identified by both: an upload into another source, or under another name, is not part of
 * the seed.
 */
export function seedRecordingKeys(seed: SeedFile): Set<string> {
  const keys = new Set<string>();
  for (const source of seed.sources) for (const clip of source.clips) keys.add(seedKey(source.id, clip.name ?? clip.file));
  return keys;
}

/** Things every node in this process shares: the models are loaded once. */
export interface SharedRuntime {
  model: EmbeddingModel;
  faces: FaceDetector;
  hazard: HazardHead | null;
  /** Resolves when the model and the tag vocabulary are ready. */
  ready: Promise<VocabularyIndex>;
}

export interface RequestContext {
  user: UserInfo;
  session: Session;
  mandate: Mandate | null;
  lang: Lang;
}

export interface UnmaskGrant {
  id: string;
  videoId: string;
  userId: string;
  approver: string;
  expires: number;
}

/**
 * One installation of the platform: its own footage, index, users, mandates and ledger.
 * Several nodes can run in one process (each on its own port) and talk to each other only
 * through the federation protocol, exactly as nodes on different machines would.
 */
export class PlatformNode {
  readonly info: NodeInfo;
  readonly hub = new EventHub();
  readonly store: Store;
  readonly ledger: Ledger;
  readonly auth: Auth;
  readonly mandates: Mandates;
  readonly sources: Sources;
  readonly incidents: Incidents;
  readonly cases: Cases;
  readonly federation: Federation;
  readonly watches: WatchEngine;
  readonly scenario: ScenarioEngine;
  readonly pipeline: Pipeline;
  readonly search: SearchEngine;
  readonly live: LiveIngest;
  /** DATUM: where and when each recording was made. */
  readonly datum: DatumEngine;
  /** Stream addresses of live sources; they may carry credentials and never leave the node. */
  private streamAddresses: Record<string, string> = {};
  readonly grants = new Map<string, UnmaskGrant>();
  private readonly witnessRecorded = new Map<string, number>();
  /**
   * Resolves when the node has finished what it does once the model is loaded: watches prepared
   * and brought in line with the exercise script, pending recordings queued, seed footage read.
   */
  settled: Promise<void> = Promise.resolve();
  private app: FastifyInstance | null = null;
  private retentionTimer: NodeJS.Timeout | null = null;
  /** Seed recordings exempt from retention, see `keptSeedRecordings`. */
  private keptSeed: Promise<Set<string>> | null = null;
  /**
   * The recordings the seed brings (`seedKey` values), read at start: background work that the
   * pipeline and DATUM do after everything a person has brought in (see `isBackgroundRecording`).
   */
  private seedKeys = new Set<string>();
  private readonly cookieName: string;
  /** Whether the session cookie is marked `Secure`: the node speaks TLS, or TLS ends in front of it. */
  private secure = config.cookieSecure;

  constructor(
    readonly cfg: NodeConfig,
    readonly shared: SharedRuntime,
  ) {
    this.info = {
      id: cfg.id,
      name: cfg.name,
      operator: cfg.operator,
      region: cfg.region,
      lat: cfg.lat,
      lon: cfg.lon,
      version: VERSION,
    };
    this.cookieName = `sicht_${cfg.id.replace(/[^a-z0-9]/gi, '')}`;
    const d = (name: string): string => path.join(cfg.dataDir, name);

    this.store = new Store(cfg.dataDir);
    this.ledger = new Ledger(d('ledger.jsonl'));
    this.auth = new Auth(d('users.json'));
    this.mandates = new Mandates(d('mandates.json'));
    this.sources = new Sources(d('sources.json'));
    this.incidents = new Incidents(d('incidents.json'), path.join(config.assetsDir, 'places.json'), this.hub);
    this.cases = new Cases(d('cases'), this.store, this.sources);
    this.federation = new Federation(
      d('peers.json'),
      () => this.info,
      () => this.ledger.headHash,
      (peer, head) => {
        // Every recorded witness changes this node's own head, which the peer then witnesses in
        // turn. Recording each exchange would let two idle nodes fill each other's ledgers, so a
        // witnessed head is written down at most once per interval and peer.
        const last = this.witnessRecorded.get(peer.id) ?? 0;
        if (Date.now() - last < WITNESS_INTERVAL_MS) return;
        this.witnessRecorded.set(peer.id, Date.now());
        void this.ledger.append({
          actor: 'system',
          role: 'system',
          mandateId: null,
          action: 'ledger.witness',
          summary: `Protokollstand von ${peer.name} bezeugt`,
          data: { peer: peer.id, head },
        });
      },
    );

    const log = {
      info: (msg: string): void => this.log(msg),
      error: (msg: string): void => this.log(msg, true),
    };
    this.pipeline = new Pipeline(this.store, shared.model, shared.faces, this.hub, log, {
      onRecordingReady: (entry) => this.onRecordingReady(entry),
      onRecordingQueued: (entry) => this.onRecordingQueued(entry),
    });

    this.watches = new WatchEngine({
      model: shared.model,
      store: this.store,
      sources: this.sources,
      incidents: this.incidents,
      hub: this.hub,
      ledger: this.ledger,
      hazard: shared.hazard,
      scopes: () => this.scopes(),
      currentObservations: () => this.currentObservations(),
      clockRate: () => (this.scenario.isExerciseActive ? this.scenario.info().speed : 1),
      files: { watches: d('watches.json'), alerts: d('alerts.json'), feedback: d('feedback.json') },
    });

    this.scenario = new ScenarioEngine({
      store: this.store,
      sources: this.sources,
      pipeline: this.pipeline,
      hub: this.hub,
      scenariosDir: config.scenariosDir,
      stateFile: d('exercise.json'),
      onObservation: (observation) => this.watches.observe(observation),
      onReset: () => {
        this.watches.clearExercise();
        this.incidents.clearExercise();
        this.hub.broadcast({ type: 'intel-reset' });
      },
      onInstalled: (definition) => void this.installExerciseDefaults(definition),
      activeAlerts: (sourceId) => this.watches.activeAlertsOf(sourceId),
      log: (msg) => this.log(msg),
    });

    this.search = new SearchEngine(this.store, shared.model, this.sources, () => this.scopes());

    this.datum = new DatumEngine({
      store: this.store,
      model: shared.model,
      hub: this.hub,
      gallery: () => sharedGallery(shared.model, shared.ready, (line) => this.log(line.trim())),
      log: (msg) => this.log(msg),
      holdout: process.env['DATUM_HOLDOUT'] === '1',
      truths: new TruthBook(path.join(cfg.dataDir, 'datum', 'truth.json')),
      background: (videoId) => this.isBackgroundRecording(videoId),
    });

    this.live = new LiveIngest({
      store: this.store,
      sources: this.sources,
      pipeline: this.pipeline,
      spoolDir: d('streams'),
      addressOf: (sourceId) => this.streamAddresses[sourceId] ?? null,
      activeAlerts: (sourceId) => this.watches.activeAlertsOf(sourceId),
      onChange: () => this.broadcastFeeds(),
      log: (msg) => this.log(msg),
    });
  }

  /** Current picture of every source that delivers one: exercise sources and connected streams. */
  feeds(): FeedState[] {
    return this.scenario.feeds().concat(this.live.feeds());
  }

  broadcastFeeds(): void {
    this.hub.broadcast({ type: 'feeds', feeds: this.feeds(), scenario: this.scenario.info() });
  }

  /** Sources as the console sees them: live sources carry their stream state, never their credentials. */
  sourceList(): SourceInfo[] {
    return this.sources.list().map((source) => {
      if (source.mode !== 'live') return source;
      const state = this.live.stateOf(source.id);
      return {
        ...source,
        stream: redactStreamAddress(this.streamAddresses[source.id] ?? ''),
        streamState: { state: state?.state ?? 'offline', detail: state?.lastError ?? '' },
      };
    });
  }

  /** Connects a stream to a source and remembers its address. */
  async connectStream(sourceId: string, address: string): Promise<void> {
    this.streamAddresses[sourceId] = address;
    await writeFileAtomic(path.join(this.cfg.dataDir, 'streams.json'), JSON.stringify(this.streamAddresses));
    this.live.start(sourceId);
  }

  async disconnectStream(sourceId: string): Promise<void> {
    await this.live.stop(sourceId);
    delete this.streamAddresses[sourceId];
    await writeFileAtomic(path.join(this.cfg.dataDir, 'streams.json'), JSON.stringify(this.streamAddresses));
  }

  log(message: string, error = false): void {
    (error ? process.stderr : process.stdout).write(`  [${this.cfg.id}] ${message}\n`);
  }

  /** Footage that can be searched right now: the archive plus what an exercise has revealed. */
  scopes(): SearchScope[] {
    const scopes: SearchScope[] = [];
    for (const entry of this.store.all()) {
      if (entry.info.scenario !== null || !entry.embeddings) continue;
      const base = entry.info.capturedAt;
      scopes.push({
        entry,
        sourceId: entry.info.sourceId,
        frames: null,
        timeOf: (frameIdx) => base + Math.round((entry.frames[frameIdx]?.t ?? 0) * 1000),
      });
    }
    return scopes.concat(this.scenario.scopes());
  }

  private currentObservations(): Observation[] {
    const out: Observation[] = [];
    if (!this.scenario.isExerciseActive) return out;
    const elapsed = this.scenario.elapsedSec;
    for (const feed of this.scenario.feeds()) {
      if (!feed.videoId || feed.frameNumber === null || feed.at === null) continue;
      const entry = this.store.get(feed.videoId);
      const frameIdx = entry ? entry.frames.findIndex((f) => f.n === feed.frameNumber) : -1;
      if (entry && frameIdx >= 0) out.push({ sourceId: feed.sourceId, entry, frameIdx, at: feed.at, exerciseSec: elapsed });
    }
    return out;
  }

  /**
   * Seeded reference footage is background work: an analyst's own upload is analysed and
   * located before it, however many reference videos are still waiting.
   */
  isBackgroundRecording(videoId: string): boolean {
    const entry = this.store.get(videoId);
    return entry ? this.seedKeys.has(seedKey(entry.info.sourceId, entry.info.name)) : false;
  }

  /**
   * A recording's file is complete and queued for analysis: DATUM locates it from the file at
   * once (quick stage), so the place is known within seconds while the analysis of a long video
   * takes minutes. Exercise footage and live segments wait for the analysis as before: an
   * exercise replays them on its own clock, and a stream delivers a segment every few seconds.
   */
  private onRecordingQueued(entry: VideoEntry): void {
    if (entry.info.scenario !== null) return;
    if (this.sources.get(entry.info.sourceId)?.mode === 'live') return;
    this.datum.quick(entry.info.id);
  }

  /** A finished upload is run past every watch, in recording order, like a delayed live feed. */
  private onRecordingReady(entry: VideoEntry): void {
    // The pipeline has just (re)built the index (first analysis, other model, broken vectors):
    // a fix stored before was computed from the old one and is located again.
    this.datum.enqueue(entry.info.id, true);
    void this.enforceRetention();
    this.watches.recalibrateAll();
    if (entry.info.scenario !== null) {
      this.broadcastFeeds();
      return;
    }
    const live = this.sources.get(entry.info.sourceId)?.mode === 'live';
    this.watches.observeRecording(entry, undefined, live);
    if (live) this.broadcastFeeds();
  }

  /** Creates the exercise mandate and the scenario's standard watches (once). */
  private async installExerciseDefaults(definition: ScenarioDefinition): Promise<void> {
    const mandateId = `md_exercise_${definition.id}`;
    if (!this.mandates.get(mandateId)) {
      this.mandates.create(
        {
          title: definition.mandate.title,
          titleEn: definition.mandate.titleEn,
          legalBasis: definition.mandate.legalBasis,
          purpose: definition.mandate.purpose,
          issuedBy: definition.mandate.issuedBy,
          validFrom: Date.now(),
          validTo: null,
          exercise: true,
          personDescriptions: false,
        },
        mandateId,
      );
      await this.ledger.append({
        actor: 'system',
        role: 'system',
        mandateId,
        action: 'mandate.create',
        summary: `Übungsmandat „${definition.mandate.title}“ angelegt`,
        data: { legalBasis: definition.mandate.legalBasis },
      });
    }
    const wanted = new Set(definition.watches.map((w) => scenarioWatchId(w.key)));
    for (const existing of this.watches.listWatches()) {
      // Watches of an earlier version of the script that the current one no longer contains.
      if (existing.id.startsWith('wa_exercise_') && !wanted.has(existing.id)) this.watches.remove(existing.id);
    }
    for (const w of definition.watches) {
      const id = scenarioWatchId(w.key);
      const existing = this.watches.getWatch(id);
      if (existing) {
        // The script is the reference for its own watches, unless an analyst has trained one.
        const same =
          existing.prompt === w.prompt &&
          existing.kind === w.kind &&
          existing.hazardClass === w.hazardClass &&
          existing.name === w.name &&
          existing.group === `exercise:${w.group ?? w.key}` &&
          JSON.stringify(existing.exclude) === JSON.stringify(w.exclude) &&
          JSON.stringify(existing.sourceKinds) === JSON.stringify(w.sourceKinds);
        if (same || existing.learned) {
          // Operating values follow the script without discarding the watch.
          if (
            existing.threshold !== w.threshold ||
            existing.persistence !== w.persistence ||
            existing.cooldownSec !== w.cooldownSec ||
            existing.severity !== w.severity
          ) {
            this.watches.update(id, { threshold: w.threshold, persistence: w.persistence, cooldownSec: w.cooldownSec, severity: w.severity });
          }
          continue;
        }
        this.watches.remove(id);
      }
      if (w.kind === 'hazard' && !this.shared.hazard) continue;
      await this.watches.create(
        {
          name: w.name,
          nameEn: w.nameEn,
          kind: w.kind,
          prompt: w.prompt,
          exclude: w.exclude,
          hazardClass: w.hazardClass,
          severity: w.severity,
          threshold: w.threshold,
          persistence: w.persistence,
          cooldownSec: w.cooldownSec,
          sourceKinds: w.sourceKinds,
          group: `exercise:${w.group ?? w.key}`,
        },
        null,
        mandateId,
        id,
      );
    }
  }

  /**
   * Fills the archive of a fresh demonstration node from its seed directory (once). Peers in a
   * demonstration need footage of their own so that federated questions have something to find.
   */
  private async seedArchive(): Promise<void> {
    const dir = this.cfg.seedDir;
    if (!dir) return;
    const marker = path.join(this.cfg.dataDir, 'seeded.json');
    if ((await readJson<{ at: number } | null>(marker, null)) !== null) return;
    const seed = await readJson<SeedFile | null>(path.join(dir, 'seed.json'), null);
    if (!seed) return;
    let count = 0;
    let missing = 0;
    for (const source of seed.sources) {
      if (!this.sources.get(source.id)) {
        this.sources.create({
          id: source.id,
          name: source.name,
          ...(source.nameEn !== undefined ? { nameEn: source.nameEn } : {}),
          kind: source.kind,
          owner: source.owner,
          description: source.description,
          lat: source.lat,
          lon: source.lon,
          mode: 'archive',
          shared: source.shared,
        });
      }
      for (const clip of source.clips) {
        const from = path.join(dir, 'clips', clip.file);
        try {
          await fs.access(from);
        } catch {
          missing++;
          continue;
        }
        const id = await this.store.allocate();
        const sourceFile = `source${path.extname(clip.file).toLowerCase() || '.mp4'}`;
        const target = path.join(this.store.videoDir(id), sourceFile);
        await fs.copyFile(from, target);
        const { size } = await fs.stat(target);
        const entry = this.store.register({
          id,
          name: clip.name ?? clip.file,
          sourceFile,
          sizeBytes: size,
          sampleFps: 1,
          detail: 'standard',
          sourceId: source.id,
          capturedAt: Date.now() - Math.round((clip.daysAgo ?? 1) * 86_400_000),
        });
        await this.store.persistMeta(entry);
        // Reference footage: analysed after anything a person uploads meanwhile.
        this.pipeline.enqueue(id, { background: true });
        count++;
      }
    }
    if (missing > 0) {
      this.log(`Seed footage incomplete (${missing} file(s) missing); run "pnpm exercise:fetch" and restart.`);
      if (count === 0) return;
    }
    await writeFileAtomic(marker, JSON.stringify({ at: Date.now(), recordings: count }));
    await this.ledger.append({
      actor: 'system',
      role: 'system',
      mandateId: null,
      action: 'archive.seed',
      summary: `Vorführbestand eingespielt: ${count} Aufzeichnungen`,
      data: { recordings: count, sources: seed.sources.map((s) => s.id) },
    });
    this.log(`Seeded archive with ${count} recordings`);
  }

  // ---------------------------------------------------------------- request helpers

  langOf(request: FastifyRequest): Lang {
    const query = request.query as Record<string, unknown> | null;
    const explicit = typeof query?.['lang'] === 'string' ? query['lang'] : this.cookie(request, 'sicht_lang');
    if (explicit === 'en' || explicit === 'de') return explicit;
    return (request.headers['accept-language'] ?? '').toLowerCase().startsWith('en') ? 'en' : 'de';
  }

  cookie(request: FastifyRequest, name: string): string | undefined {
    const header = request.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0 && part.slice(0, eq).trim() === name) {
        try {
          return decodeURIComponent(part.slice(eq + 1).trim());
        } catch {
          // A value that is not valid percent-encoding is no cookie of ours.
          return undefined;
        }
      }
    }
    return undefined;
  }

  sessionCookie(token: string | null): string {
    const base = `${this.cookieName}=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax${this.secure ? '; Secure' : ''}`;
    return token === null ? `${base}; Max-Age=0` : `${base}; Max-Age=43200`;
  }

  contextOf(request: FastifyRequest): RequestContext | null {
    const resolved = this.auth.resolve(this.cookie(request, this.cookieName));
    if (!resolved) return null;
    const mandate = resolved.session.mandateId ? (this.mandates.get(resolved.session.mandateId) ?? null) : null;
    return {
      user: resolved.user,
      session: resolved.session,
      mandate: mandate && this.mandates.isUsable(mandate) ? mandate : null,
      lang: this.langOf(request),
    };
  }

  sessionInfo(ctx: RequestContext): SessionInfo {
    return { user: ctx.user, permissions: [...PERMISSIONS[ctx.user.role]], mandate: ctx.mandate };
  }

  allowed(ctx: RequestContext, permission: Permission): boolean {
    return can(ctx.user.role, permission);
  }

  /** Writes a ledger entry on behalf of a user. */
  record(ctx: RequestContext, action: string, summary: string, data: Record<string, unknown> = {}): Promise<unknown> {
    return this.ledger.append({
      actor: ctx.user.id,
      role: ctx.user.role,
      mandateId: ctx.mandate?.id ?? null,
      action,
      summary,
      data,
    });
  }

  hasGrant(ctx: RequestContext, videoId: string): boolean {
    const now = Date.now();
    for (const [id, grant] of this.grants) {
      if (grant.expires <= now) this.grants.delete(id);
      else if (grant.userId === ctx.user.id && grant.videoId === videoId) return true;
    }
    return false;
  }

  /** Reads which recordings the seed brings (see `seedKeys`); without a readable seed file, none. */
  private async loadSeedKeys(): Promise<void> {
    const dir = this.cfg.seedDir;
    if (!dir) return;
    try {
      const seed = await readJson<SeedFile | null>(path.join(dir, 'seed.json'), null);
      if (seed) this.seedKeys = seedRecordingKeys(seed);
    } catch (err: unknown) {
      // Then every recording counts as a person's: nothing waits longer than before.
      this.log(`Vorführbestand nicht lesbar, keine Hintergrundreihenfolge: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  }

  /** The seed recordings that retention leaves alone (`keepSeed`), read once from the seed file. */
  private keptSeedRecordings(): Promise<Set<string>> {
    const dir = this.cfg.seedDir;
    if (!this.cfg.keepSeed || !dir) return Promise.resolve(new Set<string>());
    this.keptSeed ??= readJson<SeedFile | null>(path.join(dir, 'seed.json'), null).then(
      (seed) => (seed ? seedRecordingKeys(seed) : new Set<string>()),
      (err: unknown) => {
        // Not kept: the next run reads the file again.
        this.keptSeed = null;
        throw err;
      },
    );
    return this.keptSeed;
  }

  /**
   * Applies the retention rule: sets the deletion date of every archive recording and deletes
   * those that are due. Recordings referenced by a case are held for as long as the case exists;
   * the seed recordings of a node with `keepSeed` (the DATUM reference set) are never due.
   */
  async enforceRetention(): Promise<void> {
    const days = config.retentionDays;
    let seed: Set<string>;
    try {
      seed = await this.keptSeedRecordings();
    } catch (err: unknown) {
      // Without the seed file the reference recordings cannot be told apart: nothing is deleted.
      this.log(`Löschfristen ausgesetzt, Vorführbestand nicht lesbar: ${err instanceof Error ? err.message : String(err)}`, true);
      return;
    }
    const held = new Set<string>();
    for (const file of this.cases.list()) for (const item of file.items) held.add(item.videoId);
    const now = Date.now();
    for (const entry of this.store.all()) {
      if (entry.info.scenario !== null) continue;
      const kept = held.has(entry.info.id) || seed.has(seedKey(entry.info.sourceId, entry.info.name));
      const due = days > 0 && !kept ? entry.info.capturedAt + days * 86_400_000 : null;
      if (entry.info.deleteAfter !== due) {
        entry.info.deleteAfter = due;
        this.hub.broadcast({ type: 'video', video: entry.info, stats: this.store.stats(), queueLength: this.pipeline.queueLength });
      }
      if (due !== null && due <= now && entry.info.status !== 'processing') {
        this.pipeline.cancel(entry.info.id);
        await this.store.remove(entry.info.id);
        this.datum.forget(entry.info.id);
        this.hub.broadcast({ type: 'video-removed', videoId: entry.info.id, stats: this.store.stats() });
        await this.ledger.append({
          actor: 'system',
          role: 'system',
          mandateId: null,
          action: 'retention.delete',
          summary: `Aufzeichnung „${entry.info.name}“ nach Ablauf der Löschfrist (${days} Tage) gelöscht`,
          data: { videoId: entry.info.id, capturedAt: entry.info.capturedAt, days },
        });
      }
    }
    // Recordings deleted another way (the delete route, removing an exercise) leave their fix
    // in the DATUM engine; this regular sweep drops those as well.
    this.datum.prune();
  }

  appState(): AppState {
    return {
      model: this.shared.model.state,
      videos: this.store.infos(),
      stats: this.store.stats(),
      queueLength: this.pipeline.queueLength,
    };
  }

  // ---------------------------------------------------------------- lifecycle

  async start(serveConsole: boolean): Promise<void> {
    await fs.mkdir(this.cfg.dataDir, { recursive: true });
    await this.ledger.open();
    await this.auth.open(config.demoPassword);
    await this.mandates.open();
    if (this.auth.demoMode && this.mandates.list().length === 0) {
      // A fresh demonstration node gets a trial mandate so that own test footage can be evaluated.
      this.mandates.create(
        {
          title: 'Erprobung',
          titleEn: 'Evaluation',
          legalBasis: 'Kein Echtbetrieb: Erprobung mit eigenem, frei verwendbarem Material',
          purpose:
            'Funktionsprüfung des Systems mit eigenem, frei verwendbarem Material ohne personenbezogene Echtdaten. Beschreibungen von Personen nach Geschlecht, Altersgruppe oder Kleidung sind für diese Erprobung ausdrücklich zugelassen.',
          issuedBy: 'System',
          validFrom: Date.now(),
          validTo: null,
          exercise: true,
          // The one built-in mandate that permits it, and says so in its purpose.
          personDescriptions: true,
        },
        'md_erprobung',
      );
      await this.ledger.append({
        actor: 'system',
        role: 'system',
        mandateId: 'md_erprobung',
        action: 'mandate.create',
        summary: 'Mandat „Erprobung“ für den Testbetrieb angelegt',
        data: {},
      });
    }
    await this.sources.open();
    try {
      await this.datum.truths?.open();
    } catch (err: unknown) {
      // An unreadable truth file must not keep the node from starting; it was moved aside.
      this.log(`Grundwahrheiten nicht lesbar: ${err instanceof Error ? err.message : String(err)}`, true);
    }
    this.streamAddresses = await readJson<Record<string, string>>(path.join(this.cfg.dataDir, 'streams.json'), {});
    await this.incidents.open();
    await this.cases.open();
    await this.federation.open();
    this.federation.configure(this.cfg.peers);
    await this.watches.open();

    const pending = await this.store.load((msg) => this.log(msg));
    for (const id of this.store.degenerateVideoIds()) {
      const entry = this.store.get(id);
      if (!entry) continue;
      this.log(`Index of "${entry.info.name}" consists of identical vectors (broken encoder run); re-indexing.`);
      this.store.resetAnalysis(entry);
      entry.info.status = 'queued';
      if (!pending.includes(id)) pending.push(id);
    }
    await this.scenario.open();
    // An exercise does not survive a restart; what its last run left behind is discarded with it.
    this.watches.clearExercise();
    this.incidents.clearExercise();

    const tls = await loadTls();
    this.secure = tls !== null || config.cookieSecure;
    // With a certificate the node speaks HTTPS itself; the routes are the same either way.
    const app = Fastify({
      ...(tls ? { https: tls } : {}),
      logger: { level: process.env['LOG_LEVEL'] ?? 'warn' },
      logController: new LogController({ disableRequestLogging: true }),
      bodyLimit: 1024 * 1024,
    }) as unknown as FastifyInstance;
    this.app = app;
    this.shared.model.onState((state) => this.hub.broadcast({ type: 'model', model: state }));
    this.ledger.onAppend((entry) => this.hub.broadcast({ type: 'ledger', head: entry.hash, length: entry.seq }));
    await registerRoutes(app, this, serveConsole);

    this.pipeline.setReadyGate(
      this.shared.ready.then((vocabulary) => {
        this.pipeline.setVocabulary(vocabulary);
      }),
    );
    this.settled = this.shared.ready
      .then(async () => {
        await this.watches.prepareAll();
        if (this.scenario.definition && this.scenario.info().status !== 'absent') {
          await this.installExerciseDefaults(this.scenario.definition);
        }
        this.watches.recalibrateAll();
        await this.loadSeedKeys();
        // Stored fixes first: a recording whose analysis is still outstanding keeps its stored
        // quick fix instead of being located from the file a second time when it is queued.
        await this.datum.init();
        for (const id of pending) this.pipeline.enqueue(id, { background: this.isBackgroundRecording(id) });
        await this.seedArchive();
        await this.live.open();
      })
      .catch((err: unknown) => this.log(`Model initialisation failed: ${err instanceof Error ? err.message : String(err)}`, true));

    await this.enforceRetention();
    this.retentionTimer = setInterval(() => void this.enforceRetention(), 10 * 60 * 1000);
    this.retentionTimer.unref();

    await app.listen({ host: this.cfg.host, port: this.cfg.port });
    this.federation.start();
    await this.ledger.append({
      actor: 'system',
      role: 'system',
      mandateId: null,
      action: 'node.start',
      summary: `Knoten ${this.cfg.name} gestartet (Version ${VERSION})`,
      data: { videos: this.store.all().length, masking: this.shared.faces.ready },
    });
  }

  async stop(): Promise<void> {
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.pipeline.shutdown();
    this.datum.stop();
    this.live.shutdown();
    this.scenario.shutdown();
    this.watches.shutdown();
    this.federation.shutdown();
    this.hub.close();
    await Promise.allSettled([this.watches.flush(), this.incidents.flush(), this.sources.flush(), this.mandates.flush()]);
    await this.app?.close();
  }
}
