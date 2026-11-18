import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Collection } from '../core/json.js';
import { SOURCE_KINDS, type FederatedHit, type FederatedResult, type Mandate, type NodeInfo, type PeerInfo, type SourceKind, type Tag, type UserInfo } from '../types.js';

/**
 * Federation ("Verbund") between nodes of different authorities.
 *
 * Raw footage never leaves the node that owns it. A federated search sends only the question,
 * together with who is asking and under which mandate. The peer decides with its own rules,
 * answers with masked previews of its matches, and writes the request to its own ledger. Both
 * sides exchange their current ledger head with every call, so each node holds witnessed copies
 * of the others' log state: nobody can quietly rewrite history afterwards.
 *
 * Requests are authenticated with an HMAC using a secret shared between the two nodes. The
 * signature covers the time, a one-time value, sender, recipient, path and body: a request cannot
 * be sent a second time, sent back to its sender, or moved to another path. What a peer answers
 * is data from another authority's machine and is checked field by field before it is used.
 */

export interface PeerRecord {
  id: string;
  name: string;
  operator: string;
  region: string;
  url: string;
  lat: number;
  lon: number;
  secret: string;
}

interface PeerStatus {
  online: boolean;
  latencyMs: number | null;
  lastSeen: number | null;
  witnessedHead: string | null;
  sources: number;
  frames: number;
}

export interface FederationRequest {
  query: string;
  limit: number;
  requester: { node: NodeInfo; user: { id: string; name: string; role: string; unit: string } };
  mandate: { id: string; title: string; legalBasis: string; purpose: string; exercise: boolean; personDescriptions: boolean };
  /** Ledger head of the requesting node at the time of the request. */
  head: string;
}

export interface FederationResponse {
  node: NodeInfo;
  head: string;
  receipt: number;
  matched: number;
  hits: FederatedHit[];
}

export interface FederationHello {
  node: NodeInfo;
  head: string;
  sources: number;
  frames: number;
}

const MAX_SKEW_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 8000;
/** Largest answer accepted from a peer; twelve previews of some tens of kilobytes fit many times. */
const MAX_ANSWER_BYTES = 2 * 1024 * 1024;
/** Questions one peer may ask within the window before it is put off. */
export const PEER_BUDGET = 60;
export const PEER_BUDGET_WINDOW_MS = 10 * 60 * 1000;
/** A preview is a JPEG carried in the answer itself, never an address to fetch. */
const PREVIEW = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]{1,400000}$/;
const HASH = /^[0-9a-f]{64}$/;

/** What a signature covers. None of the fields before the body may contain a line feed. */
export interface Envelope {
  timestamp: string;
  nonce: string;
  from: string;
  to: string;
  path: string;
  body: string;
}

export function sign(secret: string, envelope: Envelope): string {
  return createHmac('sha256', secret)
    .update([envelope.timestamp, envelope.nonce, envelope.from, envelope.to, envelope.path].join('\n'))
    .update('\n')
    .update(envelope.body)
    .digest('hex');
}

const clamp = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * Reduces the hits of a peer's answer to what this node is prepared to show: at most `limit`
 * entries, each with a preview that is an embedded JPEG, numbers that are numbers and texts of
 * bounded length. Anything else is dropped.
 */
export function acceptHits(raw: unknown, limit: number): FederatedHit[] {
  if (!Array.isArray(raw)) return [];
  const hits: FederatedHit[] = [];
  for (const item of raw as unknown[]) {
    if (hits.length >= limit) break;
    if (item === null || typeof item !== 'object') continue;
    const hit = item as Record<string, unknown>;
    const thumbnail = typeof hit['thumbnail'] === 'string' && PREVIEW.test(hit['thumbnail']) ? hit['thumbnail'] : null;
    const confidence = finite(hit['confidence']);
    if (thumbnail === null || confidence === null) continue;
    const kind = (SOURCE_KINDS as readonly string[]).includes(hit['sourceKind'] as string) ? (hit['sourceKind'] as SourceKind) : 'upload';
    const lat = finite(hit['lat']);
    const lon = finite(hit['lon']);
    const tags: Tag[] = [];
    if (Array.isArray(hit['tags'])) {
      for (const tag of (hit['tags'] as unknown[]).slice(0, 3)) {
        const label = clamp((tag as Record<string, unknown> | null)?.['label'], 60);
        const p = finite((tag as Record<string, unknown> | null)?.['p']);
        if (label !== '' && p !== null) tags.push({ label, p: Math.min(1, Math.max(0, p)) });
      }
    }
    hits.push({
      sourceName: clamp(hit['sourceName'], 120),
      sourceKind: kind,
      lat: lat !== null && Math.abs(lat) <= 90 ? lat : null,
      lon: lon !== null && Math.abs(lon) <= 180 ? lon : null,
      at: finite(hit['at']) ?? 0,
      confidence: Math.min(1, Math.max(0, confidence)),
      score: finite(hit['score']) ?? 0,
      thumbnail,
      tags,
    });
  }
  return hits;
}

export class Federation {
  private readonly peers: Collection<PeerRecord>;
  private readonly status = new Map<string, PeerStatus>();
  private pinger: NodeJS.Timeout | null = null;
  /** Peers that are being greeted out of turn right now. */
  private readonly greeting = new Set<string>();
  /** Extra rounds made in a row because a peer has not answered yet. */
  private quickRounds = 0;
  /** Signatures accepted within the time window, so that none is accepted twice. */
  private readonly seen = new Map<string, number>();
  /** Times of the questions each peer asked within the budget window. */
  private readonly asked = new Map<string, number[]>();

  constructor(
    file: string,
    private readonly self: () => NodeInfo,
    private readonly head: () => string,
    private readonly onWitness: (peer: PeerRecord, head: string) => void,
  ) {
    this.peers = new Collection<PeerRecord>(file);
  }

  async open(): Promise<void> {
    await this.peers.load();
  }

  /**
   * Starts greeting the peers. Called once this node accepts connections itself, because a peer
   * that is greeted answers by greeting back at once.
   */
  start(): void {
    if (this.pinger) return;
    this.pinger = setInterval(() => void this.pingAll(), 20_000);
    this.pinger.unref();
    void this.pingAll();
  }

  shutdown(): void {
    if (this.pinger) clearInterval(this.pinger);
    this.pinger = null;
  }

  /** Replaces the peer list (used when nodes are configured from a file). */
  configure(peers: PeerRecord[]): void {
    for (const existing of this.peers.all()) if (!peers.some((p) => p.id === existing.id)) this.peers.delete(existing.id);
    for (const peer of peers) this.peers.put(peer);
  }

  get count(): number {
    return this.peers.size;
  }

  list(): PeerInfo[] {
    return this.peers.all().map((peer): PeerInfo => {
      const s = this.status.get(peer.id);
      return {
        id: peer.id,
        name: peer.name,
        operator: peer.operator,
        region: peer.region,
        url: peer.url,
        lat: peer.lat,
        lon: peer.lon,
        online: s?.online ?? false,
        latencyMs: s?.latencyMs ?? null,
        lastSeen: s?.lastSeen ?? null,
        witnessedHead: s?.witnessedHead ?? null,
        sources: s?.sources ?? 0,
        frames: s?.frames ?? 0,
      };
    });
  }

  /**
   * Finds the peer a signed inbound request claims to come from and checks the signature for this
   * node as recipient and for the path it arrived on. A signature is accepted once.
   */
  authenticate(
    headers: { node: string | undefined; timestamp: string | undefined; nonce: string | undefined; signature: string | undefined },
    path: string,
    body: string,
  ): PeerRecord | null {
    const { node, timestamp, nonce, signature } = headers;
    if (!node || !timestamp || !nonce || !signature) return null;
    if (!/^\d{10,16}$/.test(timestamp) || !/^[0-9a-f]{16,64}$/.test(nonce) || !HASH.test(signature)) return null;
    const peer = this.peers.get(node);
    if (!peer) return null;
    const now = Date.now();
    if (Math.abs(now - Number(timestamp)) > MAX_SKEW_MS) return null;
    const expected = Buffer.from(sign(peer.secret, { timestamp, nonce, from: peer.id, to: this.self().id, path, body }), 'hex');
    const actual = Buffer.from(signature, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    for (const [known, expires] of this.seen) if (expires <= now) this.seen.delete(known);
    if (this.seen.has(signature)) return null;
    this.seen.set(signature, now + 2 * MAX_SKEW_MS);
    return peer;
  }

  /**
   * Counts one question of a peer against its budget. Returns false once the budget of the window
   * is used up; `first` tells whether this is the first refusal of the window (to record it once).
   */
  spend(peerId: string, now = Date.now()): { allowed: boolean; first: boolean } {
    const times = (this.asked.get(peerId) ?? []).filter((t) => now - t < PEER_BUDGET_WINDOW_MS);
    const refusedBefore = times.length > PEER_BUDGET;
    times.push(now);
    // Refusals are counted too, but the list does not grow without bound.
    this.asked.set(peerId, times.slice(-(PEER_BUDGET + 2)));
    const allowed = times.length <= PEER_BUDGET;
    return { allowed, first: !allowed && !refusedBefore };
  }

  private async call<T>(peer: PeerRecord, path: string, payload: unknown): Promise<T> {
    const body = JSON.stringify(payload);
    const timestamp = String(Date.now());
    const nonce = randomBytes(12).toString('hex');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${peer.url.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sicht-node': this.self().id,
          'x-sicht-timestamp': timestamp,
          'x-sicht-nonce': nonce,
          'x-sicht-signature': sign(peer.secret, { timestamp, nonce, from: this.self().id, to: peer.id, path, body }),
        },
        body,
        // A signed question goes to the peer it was signed for and nowhere else.
        redirect: 'error',
        signal: controller.signal,
      });
      const text = await readCapped(response, MAX_ANSWER_BYTES);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      if (!response.ok) {
        const message = clamp((parsed as { error?: unknown } | null)?.error, 300);
        throw new Error(message !== '' ? message : `HTTP ${response.status}`);
      }
      if (parsed === null || typeof parsed !== 'object') throw new Error('Antwort des Nachbarknotens ist kein JSON-Objekt.');
      return parsed as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private record(peer: PeerRecord, patch: Partial<PeerStatus>): void {
    const current = this.status.get(peer.id) ?? {
      online: false,
      latencyMs: null,
      lastSeen: null,
      witnessedHead: null,
      sources: 0,
      frames: 0,
    };
    this.status.set(peer.id, { ...current, ...patch });
  }

  private async ping(peer: PeerRecord): Promise<void> {
    const started = Date.now();
    try {
      const hello = await this.call<Partial<FederationHello>>(peer, '/api/federation/hello', { head: this.head() });
      this.record(peer, {
        online: true,
        latencyMs: Date.now() - started,
        lastSeen: Date.now(),
        sources: Math.max(0, Math.floor(finite(hello.sources) ?? 0)),
        frames: Math.max(0, Math.floor(finite(hello.frames) ?? 0)),
      });
      if (typeof hello.head === 'string' && HASH.test(hello.head)) this.witness(peer, hello.head);
    } catch {
      this.record(peer, { online: false, latencyMs: null });
    }
  }

  async pingAll(): Promise<void> {
    await Promise.all(this.peers.all().map((peer) => this.ping(peer)));
    // Nodes that are started together come up one after the other. Until every peer has answered
    // once, ask again after a moment instead of waiting for the next regular round.
    const missing = this.peers.all().some((peer) => this.status.get(peer.id)?.online !== true);
    if (!missing) {
      this.quickRounds = 0;
    } else if (this.pinger && this.quickRounds < 6) {
      this.quickRounds++;
      setTimeout(() => void this.pingAll(), 2500).unref();
    }
  }

  /**
   * A signed request from a peer shows that it is up. If this node still lists it as unreachable
   * (it started later, or was away), it is greeted at once instead of at the next round.
   */
  noteContact(peer: PeerRecord): void {
    if (this.status.get(peer.id)?.online === true || this.greeting.has(peer.id)) return;
    this.greeting.add(peer.id);
    void this.ping(peer).finally(() => this.greeting.delete(peer.id));
  }

  /** Remembers a peer's ledger head; a changed head is written to this node's ledger. */
  witness(peer: PeerRecord, head: string): void {
    if (this.status.get(peer.id)?.witnessedHead === head) return;
    this.record(peer, { witnessedHead: head });
    this.onWitness(peer, head);
  }

  /** Sends one question to every peer and collects their answers. */
  async search(query: string, limit: number, user: UserInfo, mandate: Mandate): Promise<FederatedResult[]> {
    const request: FederationRequest = {
      query,
      limit,
      requester: { node: this.self(), user: { id: user.id, name: user.name, role: user.role, unit: user.unit } },
      mandate: {
        id: mandate.id,
        title: mandate.title,
        legalBasis: mandate.legalBasis,
        purpose: mandate.purpose,
        exercise: mandate.exercise,
        personDescriptions: mandate.personDescriptions === true,
      },
      head: this.head(),
    };
    return Promise.all(
      this.peers.all().map(async (peer): Promise<FederatedResult> => {
        const started = Date.now();
        try {
          const response = await this.call<Partial<FederationResponse>>(peer, '/api/federation/search', request);
          this.record(peer, { online: true, latencyMs: Date.now() - started, lastSeen: Date.now() });
          if (typeof response.head === 'string' && HASH.test(response.head)) this.witness(peer, response.head);
          const hits = acceptHits(response.hits, limit);
          const receipt = finite(response.receipt);
          return {
            peerId: peer.id,
            peerName: peer.name,
            ok: true,
            error: null,
            tookMs: Date.now() - started,
            matched: Math.max(hits.length, Math.floor(finite(response.matched) ?? 0)),
            receipt: receipt !== null && Number.isInteger(receipt) && receipt > 0 ? receipt : null,
            hits,
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? (err.name === 'AbortError' ? 'Zeitüberschreitung' : err.message) : String(err);
          this.record(peer, { online: false });
          return {
            peerId: peer.id,
            peerName: peer.name,
            ok: false,
            error: message,
            tookMs: Date.now() - started,
            matched: 0,
            receipt: null,
            hits: [],
          };
        }
      }),
    );
  }
}

/** Reads an answer as text and gives up once it is longer than this node accepts. */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('Antwort des Nachbarknotens ist zu groß.');
  if (!response.body) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error('Antwort des Nachbarknotens ist zu groß.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
