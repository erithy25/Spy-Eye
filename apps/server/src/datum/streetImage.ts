/**
 * Street-level thumbnails for the console, fetched by the node (GET
 * /api/datum/fixes/:videoId/street/:n). The console never contacts the picture hosts itself: its
 * CSP allows images from the node only, and an analyst's browser would otherwise tell Panoramax
 * instances and Mapillary's CDN which fix is being looked at, from the analyst's address.
 *
 * What may be fetched (the SSRF guard, in this order):
 *   1. Only a URL that the engine stored in a fix (`Evidence.refSource`); the route never takes a
 *      URL from the request.
 *   2. https on a named public host: no IP literals, no localhost or internal names, no
 *      credentials in the URL (`isSafeRemoteUrl`).
 *   3. The host's addresses are public (no loopback, private, link-local, carrier-grade NAT,
 *      multicast or documentation ranges), checked before each request. The check and the
 *      connection resolve the name separately, so a host that changes its answer in between could
 *      still reach an internal address once; rules 1 and 2 keep that to names a picture service
 *      published in its own listing.
 *   4. At most two redirects, each target checked by 2 and 3 again.
 * Each picture: 8 s for the whole exchange, at most 3 MB, JPEG, PNG or WebP only (the declared
 * type and the first bytes must agree). Pictures are kept in memory only (a small LRU), never on
 * disk; no request carries a key or anything of the analyst.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import type { Evidence, Fix } from './contract.js';

/** The part of fetch this module uses (tests pass a mock). */
export type StreetFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Resolves a host name to its addresses (tests pass a stub). */
export type HostLookup = (host: string) => Promise<string[]>;

/** Generic, as every outbound request of the node: nothing about the installation or its people. */
export const STREET_IMAGE_USER_AGENT = 'DATUM/0.5 (street-level thumbnail)';

export const STREET_IMAGE_LIMITS = {
  timeoutMs: 8_000,
  maxBytes: 3 * 1024 * 1024,
  maxRedirects: 2,
  cacheEntries: 64,
  cacheBytes: 20 * 1024 * 1024,
  cacheTtlMs: 60 * 60_000,
  /** A picture the source no longer has is not asked for again for this long. */
  goneTtlMs: 10 * 60_000,
} as const;

export type StreetImageFailure =
  /** The source answered 404/410 (Mapillary's signed URLs expire) or 403 for an expired signature. */
  | 'gone'
  /** The URL or a redirect target is not allowed (rules 2 to 4 above). */
  | 'refused'
  | 'too-large'
  /** Not a JPEG, PNG or WebP. */
  | 'type'
  | 'timeout'
  /** Network error or another status of the source. */
  | 'error';

export type StreetImageResult = { ok: true; body: Buffer; type: StreetImageType } | { ok: false; failure: StreetImageFailure };

export type StreetImageType = 'image/jpeg' | 'image/png' | 'image/webp';

const ALLOWED_TYPES: ReadonlySet<string> = new Set<StreetImageType>(['image/jpeg', 'image/png', 'image/webp']);

// ------------------------------------------------------------------ paths and fix lookups

/**
 * Where the console loads the n-th street-level picture of a fix (n counts the evidence items
 * with a `refSource`, 0-based, in evidence order). The engine puts this into `Evidence.refImage`.
 */
export function streetImagePath(videoId: string, n: number): string {
  return `/api/datum/fixes/${encodeURIComponent(videoId)}/street/${n}`;
}

/** The remote thumbnails of a fix, in evidence order (index = n of `streetImagePath`). */
export function streetSources(fix: Pick<Fix, 'evidence'>): string[] {
  return fix.evidence.filter((e) => typeof e.refSource === 'string' && e.refSource !== '').map((e) => e.refSource as string);
}

/**
 * The evidence with `refImage` pointing at the node for every item that has a `refSource`, numbered
 * as `streetSources` numbers them. Items without one are returned unchanged.
 */
export function withStreetImagePaths(videoId: string, evidence: readonly Evidence[]): Evidence[] {
  let n = 0;
  return evidence.map((e) => (typeof e.refSource === 'string' && e.refSource !== '' ? { ...e, refImage: streetImagePath(videoId, n++) } : e));
}

// ------------------------------------------------------------------ address checks

/**
 * Only https URLs on named hosts are fetched: a federated instance must not be able to point the
 * node at an address on its own network (no IP literals, no localhost or internal names, no
 * credentials in the URL). The street-level stage checks every listed URL with this too.
 */
export function isSafeRemoteUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return false;
  if (url.port !== '' && url.port !== '443') return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '' || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa') || host.endsWith('.lan')) return false;
  if (/^[0-9.]+$/.test(host) || /^0x/i.test(host) || host.includes(':') || host.startsWith('[')) return false;
  return host.includes('.');
}

const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(net, prefix, 'ipv6');
}

/** The IPv4 address inside an IPv4-mapped (::ffff:a.b.c.d) or NAT64 (64:ff9b::a.b.c.d) address. */
function embeddedV4(ip: string): string | null {
  const m = /^(?:::ffff:|64:ff9b::)(?:0:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (m) return m[1] as string;
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip);
  if (!hex) return null;
  const hi = parseInt(hex[1] as string, 16);
  const lo = parseInt(hex[2] as string, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** Whether an address may be contacted: a public unicast address, IPv4 or IPv6. */
export function isPublicAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return !BLOCKED.check(ip, 'ipv4');
  if (version === 6) {
    const v4 = embeddedV4(ip);
    if (v4 !== null) return isIP(v4) === 4 && !BLOCKED.check(v4, 'ipv4');
    return !BLOCKED.check(ip, 'ipv6');
  }
  return false;
}

export const defaultLookup: HostLookup = async (host) => (await dnsLookup(host, { all: true, verbatim: true })).map((a) => a.address);

/**
 * Every address of the host is public (a name with one internal address is refused as a whole).
 * A resolver failure is 'error', not 'refused': it may pass, and is not remembered.
 */
export async function checkHost(url: string, lookup: HostLookup | null): Promise<'ok' | 'refused' | 'error'> {
  if (!isSafeRemoteUrl(url)) return 'refused';
  if (!lookup) return 'ok';
  let addresses: string[];
  try {
    addresses = await lookup(new URL(url).hostname);
  } catch {
    return 'error';
  }
  return addresses.length > 0 && addresses.every(isPublicAddress) ? 'ok' : 'refused';
}

// ------------------------------------------------------------------ content checks

/** The type the first bytes show, if it is one of the allowed raster formats. */
export function sniffImageType(body: Buffer): StreetImageType | null {
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (body.length >= 12 && body.toString('latin1', 0, 4) === 'RIFF' && body.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

class TooLarge extends Error {}

/** Reads a body up to `max` bytes; stops reading (and throws) as soon as it is larger. */
async function readLimited(res: Response, max: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined);
    throw new TooLarge();
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new TooLarge();
    }
    parts.push(value);
  }
  return Buffer.concat(parts, size);
}

// ------------------------------------------------------------------ fetching

export interface StreetImageDeps {
  fetch?: StreetFetch;
  /**
   * Address check of each host. Default: the system resolver when the real fetch is used; none
   * when a mock fetch is given without a lookup (a mock has no network to protect).
   */
  lookup?: HostLookup | null;
  timeoutMs?: number;
  maxBytes?: number;
}

/**
 * Fetches one thumbnail into memory under the rules of this module. Never throws: every failure
 * is a `failure` code.
 */
export async function fetchStreetImage(url: string, deps: StreetImageDeps = {}): Promise<StreetImageResult> {
  const doFetch: StreetFetch = deps.fetch ?? ((u, init) => fetch(u, init));
  const lookup = deps.lookup !== undefined ? deps.lookup : deps.fetch ? null : defaultLookup;
  const maxBytes = deps.maxBytes ?? STREET_IMAGE_LIMITS.maxBytes;
  const signal = AbortSignal.timeout(deps.timeoutMs ?? STREET_IMAGE_LIMITS.timeoutMs);
  let current = url;
  try {
    for (let hop = 0; ; hop++) {
      const host = await checkHost(current, lookup);
      if (host !== 'ok') return { ok: false, failure: host };
      const res = await doFetch(current, {
        // Redirects are followed here, one by one, so that every target passes the same checks.
        redirect: 'manual',
        signal,
        headers: { 'User-Agent': STREET_IMAGE_USER_AGENT, Accept: 'image/webp, image/jpeg, image/png' },
      });
      if (res.status >= 300 && res.status < 400) {
        await res.body?.cancel().catch(() => undefined);
        const location = res.headers.get('location');
        if (!location || hop >= STREET_IMAGE_LIMITS.maxRedirects) return { ok: false, failure: 'refused' };
        try {
          current = new URL(location, current).href;
        } catch {
          return { ok: false, failure: 'refused' };
        }
        continue;
      }
      if (res.status === 404 || res.status === 410 || res.status === 403) {
        // 403 is what an expired Mapillary signature answers.
        await res.body?.cancel().catch(() => undefined);
        return { ok: false, failure: 'gone' };
      }
      if (res.status !== 200) {
        await res.body?.cancel().catch(() => undefined);
        return { ok: false, failure: 'error' };
      }
      const declared = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
      if (!ALLOWED_TYPES.has(declared)) {
        await res.body?.cancel().catch(() => undefined);
        return { ok: false, failure: 'type' };
      }
      const body = await readLimited(res, maxBytes);
      const sniffed = sniffImageType(body);
      // The first bytes decide what is served (with nosniff); a declared type they contradict is refused.
      if (!sniffed || sniffed !== declared) return { ok: false, failure: 'type' };
      return { ok: true, body, type: sniffed };
    }
  } catch (err: unknown) {
    if (err instanceof TooLarge) return { ok: false, failure: 'too-large' };
    const name = (err as { name?: unknown } | null)?.name;
    if (signal.aborted || name === 'TimeoutError' || name === 'AbortError') return { ok: false, failure: 'timeout' };
    return { ok: false, failure: 'error' };
  }
}

// ------------------------------------------------------------------ memory cache

interface CacheEntry {
  at: number;
  result: StreetImageResult;
  bytes: number;
}

/**
 * Pictures and "gone" answers in memory, least recently used out first, bounded by count and bytes.
 * Transient failures (timeout, network) are not kept, so the next look tries again. Requests for a
 * URL already in flight share that request.
 */
export class StreetImageCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<StreetImageResult>>();
  private bytes = 0;

  constructor(
    private readonly deps: StreetImageDeps = {},
    private readonly limits: { entries: number; bytes: number; ttlMs: number; goneTtlMs: number } = {
      entries: STREET_IMAGE_LIMITS.cacheEntries,
      bytes: STREET_IMAGE_LIMITS.cacheBytes,
      ttlMs: STREET_IMAGE_LIMITS.cacheTtlMs,
      goneTtlMs: STREET_IMAGE_LIMITS.goneTtlMs,
    },
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  get byteSize(): number {
    return this.bytes;
  }

  private drop(url: string): void {
    const e = this.entries.get(url);
    if (!e) return;
    this.entries.delete(url);
    this.bytes -= e.bytes;
  }

  private keep(url: string, result: StreetImageResult): void {
    const bytes = result.ok ? result.body.byteLength : 0;
    if (bytes > this.limits.bytes) return;
    this.drop(url);
    this.entries.set(url, { at: this.now(), result, bytes });
    this.bytes += bytes;
    while (this.entries.size > this.limits.entries || this.bytes > this.limits.bytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.drop(oldest);
    }
  }

  async get(url: string): Promise<StreetImageResult> {
    const hit = this.entries.get(url);
    if (hit) {
      const ttl = hit.result.ok ? this.limits.ttlMs : this.limits.goneTtlMs;
      if (this.now() - hit.at <= ttl) {
        // Most recently used goes to the end of the order.
        this.entries.delete(url);
        this.entries.set(url, hit);
        return hit.result;
      }
      this.drop(url);
    }
    const running = this.inFlight.get(url);
    if (running) return running;
    const job = fetchStreetImage(url, this.deps).then((result) => {
      if (result.ok || result.failure === 'gone' || result.failure === 'refused' || result.failure === 'type' || result.failure === 'too-large') this.keep(url, result);
      return result;
    });
    this.inFlight.set(url, job);
    try {
      return await job;
    } finally {
      this.inFlight.delete(url);
    }
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }
}

/** The process-wide cache the route uses (pictures are the same whatever node asks). */
export const streetImages = new StreetImageCache();
