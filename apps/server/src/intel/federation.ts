import { createHmac, timingSafeEqual } from 'node:crypto';
import { Collection } from '../core/json.js';
import type { FederatedHit, FederatedResult, Mandate, NodeInfo, PeerInfo, UserInfo } from '../types.js';

/**
 * Federation ("Verbund") between nodes of different authorities.
 *
 * Raw footage never leaves the node that owns it. A federated search sends only the question,
 * together with who is asking and under which mandate. The peer decides with its own rules,
 * answers with masked previews of its matches, and writes the request to its own ledger. Both
 * sides exchange their current ledger head with every call, so each node holds witnessed copies
 * of the others' log state: nobody can quietly rewrite history afterwards.
 *
 * Requests are authenticated with an HMAC over timestamp and body using a secret shared between
 * the two nodes.
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

export function sign(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(timestamp).update('\n').update(body).digest('hex');
}

export class Federation {
  private readonly peers: Collection<PeerRecord>;
  private readonly status = new Map<string, PeerStatus>();
  private pinger: NodeJS.Timeout | null = null;
  /** Peers that are being greeted out of turn right now. */
  private readonly greeting = new Set<string>();

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
    this.pinger = setInterval(() => void this.pingAll(), 20_000);
    this.pinger.unref();
    setTimeout(() => void this.pingAll(), 1500).unref();
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

  /** Finds the peer a signed inbound request claims to come from and checks the signature. */
  authenticate(nodeId: string | undefined, timestamp: string | undefined, signature: string | undefined, body: string): PeerRecord | null {
    if (!nodeId || !timestamp || !signature) return null;
    const peer = this.peers.get(nodeId);
    if (!peer) return null;
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) return null;
    const expected = Buffer.from(sign(peer.secret, timestamp, body), 'hex');
    const actual = Buffer.from(signature, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    return peer;
  }

  private async call<T>(peer: PeerRecord, path: string, payload: unknown): Promise<T> {
    const body = JSON.stringify(payload);
    const timestamp = String(Date.now());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`${peer.url.replace(/\/$/, '')}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sicht-node': this.self().id,
          'x-sicht-timestamp': timestamp,
          'x-sicht-signature': sign(peer.secret, timestamp, body),
        },
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const parsed = (await response.json()) as { error?: string };
          if (parsed.error) detail = parsed.error;
        } catch {
          // keep the status code
        }
        throw new Error(detail);
      }
      return (await response.json()) as T;
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
      const hello = await this.call<FederationHello>(peer, '/api/federation/hello', { head: this.head() });
      this.record(peer, {
        online: true,
        latencyMs: Date.now() - started,
        lastSeen: Date.now(),
        sources: hello.sources,
        frames: hello.frames,
      });
      this.witness(peer, hello.head);
    } catch {
      this.record(peer, { online: false, latencyMs: null });
    }
  }

  async pingAll(): Promise<void> {
    await Promise.all(this.peers.all().map((peer) => this.ping(peer)));
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
          const response = await this.call<FederationResponse>(peer, '/api/federation/search', request);
          this.record(peer, { online: true, latencyMs: Date.now() - started, lastSeen: Date.now() });
          this.witness(peer, response.head);
          return {
            peerId: peer.id,
            peerName: peer.name,
            ok: true,
            error: null,
            tookMs: Date.now() - started,
            matched: response.matched,
            receipt: response.receipt,
            hits: response.hits,
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
