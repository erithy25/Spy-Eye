/**
 * DATUM street-level refinement: pins a coarse place (a few kilometres) down to a street, where
 * open street-level imagery exists.
 *
 * Given the frame vectors of a video and a few candidate places (centre and radius up to about
 * 5 km), the stage lists street-level pictures around each candidate from free open services,
 * picks a spatially spread sample (recent pictures first), embeds their thumbnails with the same
 * image tower and preprocessing as the frames and the gallery, and compares every picture with
 * every frame. A picture counts as a match only when it stands out from the typical picture of
 * the same area (the gap); without such a picture the stage says so and changes nothing.
 *
 * Services (no Google imagery: its terms forbid automated matching):
 *   - Panoramax, the federated French-led catalogue, through its meta-catalogue STAC API (no key).
 *     Dense in France, sparse elsewhere. The licence travels with every picture (mostly
 *     CC-BY-SA-4.0 or Licence Ouverte 2.0); pictures without a licence or with a non-commercial
 *     one are skipped.
 *   - Mapillary API v4, only with a key (a free client token "MLY|…"): MAPILLARY_TOKEN in the
 *     environment, or the key an operator stored in the console (settings.ts). The key goes in
 *     the Authorization header, never into a URL, a log line or an error text, and is not sent
 *     along when a redirect leaves the host. Its bbox search must stay under 0.01 square degrees,
 *     so larger boxes are split.
 *
 * Whether the stage runs at all is the node's setting (settings.ts `streetLevelEnabled`); this
 * module does not check it, the engine does before calling.
 *
 * What is kept: the vectors of the pictures (on disk, per provider and picture id, under
 * .cache/datum/streetlevel/), and in the result the id, position, thumbnail URL and attribution of
 * the best pictures. The pictures themselves are downloaded into memory only and dropped after
 * embedding; nothing is unblurred, nothing is copied in bulk. The evidence of a fix names the
 * remote thumbnail in `refSource` and the viewer page in `refUrl`; the console shows the picture
 * through the node (streetImage.ts), never from the remote host.
 *
 * Every URL is checked before it is asked (https, named public host, see streetImage.ts
 * `isSafeRemoteUrl`), redirects are followed one by one (at most two) with the same check, and
 * with the real network the host's addresses must be public.
 *
 * Every network step runs under a per-request timeout and a total budget; at the end of the
 * budget the stage decides on what it has. No network error leaves this module as an exception:
 * the result is then { matched: false, reason }.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config, repoRoot } from '../config.js';
import { tileLayout, writeTile, type DecodedFrame, type PixelRect } from '../ml/preprocess.js';
import type { Evidence, EvidenceKind, FixLocation, GeoPoint } from './contract.js';
import { modelSlug, type ImageEmbedder } from './gallery.js';
import { datumSettings, envMapillaryToken } from './settings.js';
import { checkHost, defaultLookup, isSafeRemoteUrl, type HostLookup } from './streetImage.js';

export { isSafeRemoteUrl, streetImagePath, withStreetImagePaths } from './streetImage.js';

// ------------------------------------------------------------------ public types

export type StreetLevelProviderName = 'panoramax' | 'mapillary';

/** [minLon, minLat, maxLon, maxLat] in degrees. */
export type BBox = readonly [number, number, number, number];

/** A place to search around: centre and radius (clamped to options.maxRadiusKm). */
export interface StreetLevelCandidate extends GeoPoint {
  radiusKm: number;
  label?: string;
}

/** One street-level picture as listed by a provider (metadata only, no pixels). */
export interface StreetLevelListing {
  provider: StreetLevelProviderName;
  /** The provider's picture id. */
  id: string;
  lat: number;
  lon: number;
  /** Thumbnail at the provider (remote; Mapillary URLs are signed and expire after a while). */
  thumbUrl: string;
  /** Page where a person can look at the picture in the provider's viewer. */
  pageUrl: string;
  /** Capture time (epoch ms, UTC), null if unknown. */
  capturedAt: number | null;
  /** Camera heading (degrees clockwise from north), null if unknown. */
  headingDeg: number | null;
  /** 360° picture (its thumbnail shows the forward part). */
  panorama: boolean;
  /** Author as the provider publishes it, null if unknown. */
  author: string | null;
  /** Licence identifier as given by the provider, e.g. "CC-BY-SA-4.0", "etalab-2.0". */
  license: string;
  /** Licence page, if the provider names one. */
  licenseUrl: string | null;
  /** Ready-made credit line, e.g. "© jdupont, CC BY-SA 4.0, Panoramax". */
  attribution: string;
}

/** A listing compared with the video. */
export interface StreetLevelPicture extends StreetLevelListing {
  /** Best cosine over the picture's rows (whole picture and crops) and the video's query rows. */
  similarity: number;
  /** Row of frameVectors whose frame matched best. */
  frameRow: number;
  /** Frame number of that row, when frameNumbers were given. */
  frame?: number;
  /** Index of the candidate the picture was found for. */
  candidateIndex: number;
  /** Distance from that candidate's centre (km). */
  distanceKm: number;
  /** 1: spread sample over the candidate area; 2: densified around the best pictures. */
  pass: 1 | 2;
}

export interface StreetLevelStats {
  /** Pictures compared for the candidate (both passes). */
  pictures: number;
  /** Pictures of the spread sample (pass 1), on which `typical` and `spread` are measured. */
  spreadPictures: number;
  best: number;
  /** Median similarity of the spread sample without its best picture. */
  typical: number;
  /** Robust spread of the spread sample: 1.4826 × median absolute deviation (at least 0.005). */
  spread: number;
  /** best − typical. */
  gap: number;
  /** gap / spread. */
  z: number;
  /** Share of the next best pictures (top `agreementTop` − 1) within `agreementKm` of the best. */
  agreement: number;
}

export interface StreetLevelCandidateReport {
  index: number;
  lat: number;
  lon: number;
  radiusKm: number;
  /** Search boxes asked (per provider each). */
  tiles: number;
  /** Distinct pictures the providers listed. */
  listed: number;
  /** Pictures chosen for comparison. */
  sampled: number;
  /** Pictures with vectors (embedded now or taken from the cache). */
  compared: number;
  stats: StreetLevelStats | null;
  matched: boolean;
}

export interface StreetLevelProviderReport {
  name: StreetLevelProviderName;
  enabled: boolean;
  /** Why the provider was not used (missing token, rejected token, rate limit), if so. */
  note: string | null;
  noteEn: string | null;
  requests: number;
  errors: number;
  listed: number;
  /** Last error, without any credential. */
  lastError: string | null;
}

export type StreetLevelReasonCode = 'matched' | 'no-candidates' | 'no-providers' | 'no-coverage' | 'too-few' | 'no-match' | 'error';

export interface StreetLevelResult {
  matched: boolean;
  reasonCode: StreetLevelReasonCode;
  /** One honest sentence on the outcome (German), and its English version. */
  reason: string;
  reasonEn: string;
  /** Refined place: similarity-weighted position of the top matches. Null without a match. */
  location: { lat: number; lon: number; radiusKm: number; confidence: number } | null;
  /** Candidate the answer (or the best attempt) belongs to. */
  candidateIndex: number | null;
  /** The three best pictures of that candidate, best first (also without a match, for diagnosis). */
  top: StreetLevelPicture[];
  /** Statistics of that candidate. */
  stats: StreetLevelStats | null;
  /** Every compared picture of every candidate, best first; only with options.returnAll. */
  all?: StreetLevelPicture[];
  candidates: StreetLevelCandidateReport[];
  providers: StreetLevelProviderReport[];
  timing: {
    totalMs: number;
    /** Wall time of listing the areas (both passes). */
    searchMs: number;
    /** Wall time of getting the vectors: cache, download, decoding and embedding (both passes). */
    picturesMs: number;
    /** Time inside the image model (part of picturesMs). */
    embedMs: number;
    /** Requests made (searches and thumbnails). */
    requests: number;
    downloaded: number;
    fromCache: number;
    failed: number;
    /** True when the budget ended before every chosen picture was compared. */
    budgetExhausted: boolean;
  };
}

export interface StreetLevelOptions {
  providers: readonly StreetLevelProviderName[];
  /** Total wall time of a call (ms); network work stops `reserveMs` earlier. */
  budgetMs: number;
  /** Time kept back for the last embedding and the decision (ms). */
  reserveMs: number;
  /** Share of the budget the listing (search) phase may take at most. */
  searchShare: number;
  /** Timeout of a single request (ms). */
  requestTimeoutMs: number;
  /** Parallel requests (searches and downloads together). */
  concurrency: number;
  maxRadiusKm: number;
  /** Search boxes per candidate (each asked from every provider). */
  maxTilesPerCandidate: number;
  /** Smallest search box side (km). */
  minTileKm: number;
  /** Pictures listed per search box. */
  perTileLimit: number;
  maxPicturesPerCandidate: number;
  maxPicturesTotal: number;
  /** Also embed square crops of every picture (pipeline tiling 'standard'); about 3× the cost. */
  pictureCrops: boolean;
  /** Coarse-to-fine: densify around the best pictures so far, round by round. */
  refine: boolean;
  /**
   * The rounds: around the `places` best pictures (at least `radiusKm` apart), up to `perPlace`
   * new pictures within `radiusKm` each. The first round looks wide, the later ones close.
   */
  refineRounds: readonly { places: number; perPlace: number; radiusKm: number }[];
  /** Minimum remaining budget (ms) to start a refinement round. */
  refineMinMs: number;
  /**
   * Decision: a match needs at least this many pictures in the spread sample (on which the
   * typical similarity is measured) and all of the thresholds.
   */
  minPictures: number;
  minSimilarity: number;
  minGap: number;
  minZ: number;
  /** Agreement of the top pictures in position (reported; enters the decision via minAgreement). */
  agreementTop: number;
  agreementKm: number;
  minAgreement: number;
  /** Refined point: pictures within this distance of the best and this close in similarity. */
  pointKm: number;
  pointSimilarityWindow: number;
  pointTemperature: number;
  /** Radius of a refined place: max(minRadiusKm, radiusFactor × weighted spread of the pictures). */
  minRadiusKm: number;
  radiusFactor: number;
  /**
   * Confidence of a match (probability that the truth lies within the radius): confidenceMin at
   * the gap threshold, rising linearly to confidenceMax at minGap + confidenceRampGap.
   */
  confidenceMin: number;
  confidenceMax: number;
  confidenceRampGap: number;
  userAgent: string;
  panoramaxApi: string;
  mapillaryApi: string;
  /** Vector cache directory; null disables the cache. */
  cacheDir: string | null;
  /** Model id the cache is keyed by. */
  modelId: string;
  /** Listings are kept in memory this long (ms); 0 disables. Only metadata, never pixels. */
  searchCacheTtlMs: number;
  /** Largest thumbnail accepted (bytes). */
  maxImageBytes: number;
  /** Also return every compared picture (result.all), for evaluation and diagnosis. */
  returnAll: boolean;
}

/** Generic on purpose: it names the software, nothing about the installation or its people. */
export const STREETLEVEL_USER_AGENT = 'DATUM/0.5 (Ortung von Videos)';

/**
 * Defaults. The decision thresholds were chosen on the tuning half of the reference videos with
 * Panoramax coverage (scripts/datum/evaluateStreetlevel.ts, docs/measurements/datum-streetlevel.json):
 * the true place with a 3 km radius against two wrong places 50 km away. Among the rules with no
 * false match and no wrong pin on that half, gap >= 0.10, z >= 3 and best >= 0.70 found the most
 * true places. z matters: a landmark visible from everywhere (a television tower, an arch at the
 * end of an avenue) gives a large gap but a wide spread, and its best picture lies kilometres from
 * the camera. Matches lay 0.35 to 0.9 km from the filmed object (the reference truth is the
 * object, not the camera), hence the minimum radius of 1 km. The confidence follows the share of
 * matches within 1 km of the truth (5 of 7 over both halves, false matches included).
 */
export const DEFAULT_STREETLEVEL_OPTIONS: StreetLevelOptions = {
  providers: ['panoramax', 'mapillary'],
  budgetMs: 20_000,
  reserveMs: 1_500,
  searchShare: 0.4,
  requestTimeoutMs: 8_000,
  concurrency: 4,
  maxRadiusKm: 5,
  maxTilesPerCandidate: 25,
  minTileKm: 0.25,
  perTileLimit: 25,
  maxPicturesPerCandidate: 40,
  maxPicturesTotal: 120,
  pictureCrops: false,
  refine: true,
  refineRounds: [
    { places: 3, perPlace: 5, radiusKm: 0.7 },
    { places: 2, perPlace: 5, radiusKm: 0.3 },
  ],
  refineMinMs: 3_000,
  minPictures: 8,
  minSimilarity: 0.7,
  minGap: 0.1,
  minZ: 3,
  agreementTop: 3,
  agreementKm: 0.5,
  minAgreement: 0,
  pointKm: 0.5,
  pointSimilarityWindow: 0.03,
  pointTemperature: 0.01,
  minRadiusKm: 1,
  radiusFactor: 2,
  confidenceMin: 0.6,
  confidenceMax: 0.8,
  confidenceRampGap: 0.1,
  userAgent: STREETLEVEL_USER_AGENT,
  panoramaxApi: 'https://api.panoramax.xyz/api',
  mapillaryApi: 'https://graph.mapillary.com',
  // DATUM_STREETLEVEL_CACHE moves it (an installation that keeps caches elsewhere, or a
  // measurement that must start without cached vectors).
  cacheDir: process.env['DATUM_STREETLEVEL_CACHE']?.trim() || path.join(repoRoot, '.cache', 'datum', 'streetlevel'),
  modelId: config.modelId,
  searchCacheTtlMs: 15 * 60_000,
  maxImageBytes: 4_000_000,
  returnAll: false,
};

export interface StreetLevelInput {
  /** n × dim, L2-normalised, one row per sampled frame (whole frames). */
  frameVectors: Float32Array;
  dim: number;
  /** Frame number in the video for each row of frameVectors. */
  frameNumbers?: readonly number[];
  /**
   * Optional crops of the same frames (as SampledFrames.tiles): m × dim, with the frameVectors
   * row of each. When given, they are the query rows (tile 0 of a frame is the whole frame).
   */
  tiles?: { vectors: Float32Array; frameRow: readonly number[] };
  candidates: readonly StreetLevelCandidate[];
  model: ImageEmbedder;
  options?: Partial<StreetLevelOptions>;
}

/** The part of fetch the stage uses (tests pass a mock). */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface StreetLevelDeps {
  fetch?: FetchLike;
  /**
   * The Mapillary key to use (null: none). When absent, the key comes from `env` if that is given
   * (MAPILLARY_TOKEN, as before the settings existed), else from the settings of the node with
   * `dataDir` (MAPILLARY_TOKEN first, then the key stored from the console).
   */
  mapillaryKey?: string | null;
  /** Data directory of the node whose settings provide the key; default config.dataDir. */
  dataDir?: string;
  /** Environment to read MAPILLARY_TOKEN from instead of the settings (tests). */
  env?: Readonly<Record<string, string | undefined>>;
  /**
   * Address check of each host before a request. Default: the system resolver with the real
   * fetch; none with a mock fetch (it has no network to protect).
   */
  lookup?: HostLookup | null;
  /** Progress lines (never contain a credential). */
  log?: (line: string) => void;
  /** Cancels the whole call (the result is still returned, never thrown). */
  signal?: AbortSignal;
}

// ------------------------------------------------------------------ geometry

const RAD = Math.PI / 180;
const KM_PER_DEG_LAT = 111.32;

/** Great-circle distance (km). */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function kmPerDegLon(lat: number): number {
  return KM_PER_DEG_LAT * Math.max(0.01, Math.cos(Math.min(85, Math.abs(lat)) * RAD));
}

/** Point `km` away from (lat, lon) towards `bearingDeg` (spherical). */
export function destinationPoint(lat: number, lon: number, bearingDeg: number, km: number): GeoPoint {
  const d = km / 6371.0088;
  const b = bearingDeg * RAD;
  const p1 = lat * RAD;
  const l1 = lon * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  let lonOut = l2 / RAD;
  if (lonOut > 180) lonOut -= 360;
  if (lonOut < -180) lonOut += 360;
  return { lat: p2 / RAD, lon: lonOut };
}

const clampLat = (v: number): number => Math.max(-85, Math.min(85, v));
const clampLon = (v: number): number => Math.max(-180, Math.min(180, v));

function bboxAround(lat: number, lon: number, halfKm: number): BBox {
  const dLat = halfKm / KM_PER_DEG_LAT;
  const dLon = halfKm / kmPerDegLon(lat);
  return [clampLon(lon - dLon), clampLat(lat - dLat), clampLon(lon + dLon), clampLat(lat + dLat)];
}

export function bboxAreaDeg2(b: BBox): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

/**
 * Search boxes covering the disk of `radiusKm` around `center`: a square grid of equal cells, as
 * fine as `maxTiles` cells touching the disk allow (cells never under `minTileKm`), ordered from
 * the centre outwards so that the middle is listed first when the budget runs short.
 */
export function planSearchTiles(center: GeoPoint, radiusKm: number, maxTiles: number, minTileKm = 0.25): BBox[] {
  const r = Math.max(0.05, radiusKm);
  const limit = Math.max(1, Math.floor(maxTiles));
  const cellsFor = (n: number): { x: number; y: number }[] => {
    const side = (2 * r) / n;
    const out: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x0 = -r + i * side;
        const y0 = -r + j * side;
        // Nearest point of the cell to the centre: inside the disk means the cell touches it.
        const nx = Math.max(x0, Math.min(0, x0 + side));
        const ny = Math.max(y0, Math.min(0, y0 + side));
        if (nx * nx + ny * ny <= r * r + 1e-9) out.push({ x: x0 + side / 2, y: y0 + side / 2 });
      }
    }
    return out;
  };
  const maxN = Math.max(1, Math.ceil((2 * r) / Math.max(0.01, minTileKm)));
  let n = 1;
  for (let cand = maxN; cand >= 1; cand--) {
    if (cellsFor(cand).length <= limit) {
      n = cand;
      break;
    }
  }
  const half = r / n;
  return cellsFor(n)
    .sort((a, b) => a.x * a.x + a.y * a.y - (b.x * b.x + b.y * b.y))
    .map((c) => {
      const lat = center.lat + c.y / KM_PER_DEG_LAT;
      const lon = center.lon + c.x / kmPerDegLon(center.lat);
      return bboxAround(lat, lon, half);
    });
}

/** Splits a box into equal parts, each with an area below `maxAreaDeg2` (Mapillary's limit). */
export function splitBbox(b: BBox, maxAreaDeg2: number): BBox[] {
  const area = bboxAreaDeg2(b);
  if (area < maxAreaDeg2) return [b];
  const parts = Math.ceil(Math.sqrt(area / maxAreaDeg2) + 1e-9);
  const w = (b[2] - b[0]) / parts;
  const h = (b[3] - b[1]) / parts;
  const out: BBox[] = [];
  for (let i = 0; i < parts; i++) {
    for (let j = 0; j < parts; j++) out.push([b[0] + i * w, b[1] + j * h, b[0] + (i + 1) * w, b[1] + (j + 1) * h]);
  }
  return out;
}

const fmtBbox = (b: BBox): string => b.map((v) => v.toFixed(6)).join(',');

// ------------------------------------------------------------------ provider responses

const LICENSE_LABELS: Record<string, string> = {
  'CC-BY-SA-4.0': 'CC BY-SA 4.0',
  'CC-BY-4.0': 'CC BY 4.0',
  'CC-BY-SA-3.0': 'CC BY-SA 3.0',
  'CC-BY-3.0': 'CC BY 3.0',
  'CC-BY-SA-2.0': 'CC BY-SA 2.0',
  'CC0-1.0': 'CC0 1.0',
  'etalab-2.0': 'Licence Ouverte 2.0',
};

export function licenseLabel(license: string): string {
  return LICENSE_LABELS[license] ?? license;
}

/** A picture may be used when it carries a licence that is neither non-commercial nor proprietary. */
export function usableLicense(license: string | null): boolean {
  if (!license || license.trim() === '') return false;
  return !/(^|[^a-z])nc([^a-z]|$)/i.test(license) && !/proprietary|all rights reserved|unknown/i.test(license);
}

/** Something that contains an e-mail address. */
const EMAIL = /[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[a-z]{2,}/i;

/**
 * The author as an attribution may name them: a producer name that is (or contains) an e-mail
 * address is personal contact data the producer did not publish as a name, so `fallback` (the
 * instance that hosts the picture) stands in for it.
 */
export function publicAuthor(name: string | null, fallback: string | null): string | null {
  if (name === null) return null;
  return EMAIL.test(name) ? fallback : name;
}

function attributionLine(author: string | null, license: string, provider: string): string {
  return `${author ? `© ${author}, ` : ''}${licenseLabel(license)}, ${provider}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const SAFE_PROVIDER_ID = /^[A-Za-z0-9_-]{1,100}$/;

function pointOf(geometry: unknown): GeoPoint | null {
  if (!isRecord(geometry)) return null;
  const c = geometry['coordinates'];
  if (!Array.isArray(c) || !finite(c[0]) || !finite(c[1])) return null;
  const lon = c[0];
  const lat = c[1];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function httpsUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  return isSafeRemoteUrl(v) ? v : null;
}

/** Listings of a Panoramax STAC search response (FeatureCollection of pictures). */
export function parsePanoramaxSearch(raw: unknown): StreetLevelListing[] {
  if (!isRecord(raw) || !Array.isArray(raw['features'])) return [];
  const out: StreetLevelListing[] = [];
  for (const f of raw['features']) {
    if (!isRecord(f)) continue;
    const id = f['id'];
    if (typeof id !== 'string' || !SAFE_PROVIDER_ID.test(id)) continue;
    const at = pointOf(f['geometry']);
    if (!at) continue;
    const props = isRecord(f['properties']) ? f['properties'] : {};
    if (typeof props['geovisio:status'] === 'string' && props['geovisio:status'] !== 'ready') continue;
    if (typeof props['geovisio:visibility'] === 'string' && props['geovisio:visibility'] !== 'anyone') continue;
    const license = typeof props['license'] === 'string' ? props['license'] : null;
    if (!usableLicense(license)) continue;
    const assets = isRecord(f['assets']) ? f['assets'] : {};
    const thumbAsset = isRecord(assets['thumb']) ? assets['thumb'] : isRecord(assets['sd']) ? assets['sd'] : null;
    const thumbUrl = httpsUrl(thumbAsset?.['href']) ?? httpsUrl(props['geovisio:thumbnail']);
    if (!thumbUrl) continue;
    const providers = Array.isArray(f['providers']) ? f['providers'] : [];
    const withRole = (role: string): string | null => {
      const p = providers.find((x) => isRecord(x) && Array.isArray(x['roles']) && x['roles'].includes(role));
      return isRecord(p) && typeof p['name'] === 'string' && p['name'].trim() !== '' ? p['name'].trim() : null;
    };
    const producer =
      withRole('producer') ?? (typeof props['geovisio:producer'] === 'string' && props['geovisio:producer'].trim() !== '' ? props['geovisio:producer'].trim() : null);
    // The instance: its host provider entry, else the host name of the thumbnail.
    const hostName = withRole('host');
    const instance = hostName !== null && !EMAIL.test(hostName) ? hostName : new URL(thumbUrl).hostname;
    const author = publicAuthor(producer, instance);
    const links = Array.isArray(f['links']) ? f['links'] : [];
    const licenseLink = links.find((l) => isRecord(l) && l['rel'] === 'license');
    const captured = typeof props['datetime'] === 'string' ? Date.parse(props['datetime']) : Number.NaN;
    const orientation = isRecord(props['pers:interior_orientation']) ? props['pers:interior_orientation'] : {};
    const heading = props['view:azimuth'];
    const lic = license as string;
    out.push({
      provider: 'panoramax',
      id,
      lat: at.lat,
      lon: at.lon,
      thumbUrl,
      pageUrl: `https://api.panoramax.xyz/#focus=pic&pic=${encodeURIComponent(id)}&map=18/${at.lat.toFixed(6)}/${at.lon.toFixed(6)}`,
      capturedAt: Number.isFinite(captured) ? captured : null,
      headingDeg: finite(heading) ? ((heading % 360) + 360) % 360 : null,
      panorama: orientation['field_of_view'] === 360,
      author,
      license: lic,
      licenseUrl: isRecord(licenseLink) ? httpsUrl(licenseLink['href']) : null,
      attribution: attributionLine(author, lic, 'Panoramax'),
    });
  }
  return out;
}

/** Listings of a Mapillary API v4 image search response ({ data: [...] }). */
export function parseMapillarySearch(raw: unknown, preferLarge = false): StreetLevelListing[] {
  if (!isRecord(raw) || !Array.isArray(raw['data'])) return [];
  const out: StreetLevelListing[] = [];
  for (const item of raw['data']) {
    if (!isRecord(item)) continue;
    const rawId = item['id'];
    const id = typeof rawId === 'string' ? rawId : finite(rawId) ? String(rawId) : null;
    if (!id || !SAFE_PROVIDER_ID.test(id)) continue;
    const at = pointOf(item['computed_geometry']) ?? pointOf(item['geometry']);
    if (!at) continue;
    const small = httpsUrl(item['thumb_256_url']);
    const large = httpsUrl(item['thumb_1024_url']);
    const thumbUrl = preferLarge ? (large ?? small) : (small ?? large);
    if (!thumbUrl) continue;
    const creator = isRecord(item['creator']) ? item['creator'] : null;
    const author = publicAuthor(creator && typeof creator['username'] === 'string' && creator['username'].trim() !== '' ? creator['username'].trim() : null, null);
    const captured = item['captured_at'];
    const heading = item['compass_angle'];
    const license = 'CC-BY-SA-4.0';
    out.push({
      provider: 'mapillary',
      id,
      lat: at.lat,
      lon: at.lon,
      thumbUrl,
      pageUrl: `https://www.mapillary.com/app/?pKey=${encodeURIComponent(id)}`,
      capturedAt: finite(captured) ? captured : typeof captured === 'string' && Number.isFinite(Date.parse(captured)) ? Date.parse(captured) : null,
      headingDeg: finite(heading) ? ((heading % 360) + 360) % 360 : null,
      panorama: item['is_pano'] === true,
      author,
      license,
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      attribution: attributionLine(author, license, 'Mapillary'),
    });
  }
  return out;
}

// ------------------------------------------------------------------ sampling

const keyOf = (l: { provider: StreetLevelProviderName; id: string }): string => `${l.provider}:${l.id}`;

/**
 * Picks up to `n` pictures spread over the area: farthest-point sampling that starts at the picture
 * nearest the centre and then always takes the picture farthest from those already taken, its
 * distance weighted by recency (a picture of today counts fully, one ten years old two thirds).
 * Pictures in `exclude` (keys "provider:id") are left out.
 */
export function selectSpread(
  listings: readonly StreetLevelListing[],
  n: number,
  center: GeoPoint,
  now: number = Date.now(),
  exclude: ReadonlySet<string> = new Set(),
): StreetLevelListing[] {
  const seen = new Set<string>();
  const pool: StreetLevelListing[] = [];
  for (const l of listings) {
    const k = keyOf(l);
    if (seen.has(k) || exclude.has(k)) continue;
    seen.add(k);
    pool.push(l);
  }
  if (n <= 0 || pool.length === 0) return [];
  const kx = kmPerDegLon(center.lat);
  const xy = pool.map((l) => ({ x: (l.lon - center.lon) * kx, y: (l.lat - center.lat) * KM_PER_DEG_LAT }));
  const recency = pool.map((l) => {
    const years = l.capturedAt !== null ? Math.max(0, (now - l.capturedAt) / (365.25 * 86_400_000)) : 10;
    return 1 / (1 + years / 20);
  });
  const taken = new Uint8Array(pool.length);
  const minD = new Float64Array(pool.length).fill(Number.POSITIVE_INFINITY);
  const out: StreetLevelListing[] = [];
  // First: nearest the centre, recency breaking near-ties.
  let first = 0;
  let firstScore = Number.POSITIVE_INFINITY;
  pool.forEach((_, i) => {
    const p = xy[i] as { x: number; y: number };
    const s = Math.hypot(p.x, p.y) / (recency[i] as number);
    if (s < firstScore) {
      firstScore = s;
      first = i;
    }
  });
  let pick = first;
  while (out.length < Math.min(n, pool.length)) {
    taken[pick] = 1;
    out.push(pool[pick] as StreetLevelListing);
    const pp = xy[pick] as { x: number; y: number };
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < pool.length; i++) {
      if (taken[i]) continue;
      const q = xy[i] as { x: number; y: number };
      const d = Math.hypot(q.x - pp.x, q.y - pp.y);
      if (d < (minD[i] as number)) minD[i] = d;
      const s = (minD[i] as number) * (recency[i] as number);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    if (best < 0) break;
    pick = best;
  }
  return out;
}

// ------------------------------------------------------------------ vector cache

/**
 * Vectors of street-level pictures on disk, one small file per picture:
 * <dir>/<model>/<variant>/<provider>/<xx>/<id>.f32 with the rows (whole picture first, then the
 * crops) as little-endian float32. Nothing else is stored: no pixels, no metadata.
 */
export class StreetLevelVectorCache {
  constructor(
    readonly dir: string,
    readonly modelId: string,
    readonly dim: number,
  ) {}

  private file(provider: StreetLevelProviderName, id: string, variant: 'whole' | 'crops'): string {
    const hash = createHash('sha1').update(`${provider}:${id}`).digest('hex');
    const name = SAFE_PROVIDER_ID.test(id) ? id : hash;
    return path.join(this.dir, modelSlug(this.modelId), variant, provider, hash.slice(0, 2), `${name}.f32`);
  }

  /** Rows of a picture, or null. With variant 'whole', a crops entry also serves (its row 0). */
  async get(provider: StreetLevelProviderName, id: string, variant: 'whole' | 'crops'): Promise<Float32Array | null> {
    const variants: ('whole' | 'crops')[] = variant === 'whole' ? ['whole', 'crops'] : ['crops'];
    for (const v of variants) {
      try {
        const buf = await fs.readFile(this.file(provider, id, v));
        if (buf.byteLength === 0 || buf.byteLength % (this.dim * 4) !== 0) continue;
        const rows = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        return variant === 'whole' ? rows.slice(0, this.dim) : rows;
      } catch {
        // not cached in this variant
      }
    }
    return null;
  }

  async put(provider: StreetLevelProviderName, id: string, variant: 'whole' | 'crops', rows: Float32Array): Promise<void> {
    if (rows.length === 0 || rows.length % this.dim !== 0) return;
    const file = this.file(provider, id, variant);
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, new Uint8Array(rows.buffer, rows.byteOffset, rows.byteLength));
      await fs.rename(tmp, file);
    } catch {
      // A cache that cannot be written only costs time on the next call.
    }
  }
}

// ------------------------------------------------------------------ network plumbing

class BudgetError extends Error {
  constructor() {
    super('budget');
  }
}

/** A queued request of a provider that was stopped meanwhile (rate limit, rejected key). */
class SkippedError extends Error {
  constructor() {
    super('skipped');
  }
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/** At most `n` tasks at a time, first come first served. */
class Limiter {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly n: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.n) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

interface ProviderState extends StreetLevelProviderReport {
  stopped: boolean;
}

interface CallContext {
  opts: StreetLevelOptions;
  fetch: FetchLike;
  limiter: Limiter;
  abort: AbortController;
  /** performance.now() after which no request starts or continues. */
  deadline: number;
  secrets: readonly string[];
  log: (line: string) => void;
  requests: number;
  budgetHit: boolean;
  /** Address check of hosts (null: none), with the verdicts of this call. */
  lookup: HostLookup | null;
  hosts: Map<string, Promise<'ok' | 'refused' | 'error'>>;
}

/** Most redirects followed for one request; each target is checked like the first URL. */
const MAX_REDIRECTS = 2;

class RefusedUrlError extends Error {
  constructor() {
    super('Adresse nicht erlaubt');
  }
}

/**
 * Settles with `promise`, or rejects with the signal's reason (a timeout, or the end of the
 * budget) as soon as `signal` aborts. The system resolver takes no signal and can hang for many
 * seconds on a broken network; a request must not wait for it beyond its timeout and budget.
 */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  const reason = (): Error => (signal.reason instanceof Error ? signal.reason : new BudgetError());
  if (signal.aborted) return Promise.reject(reason());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(reason());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/** The host of `url` may be contacted (checked once per host and call). */
async function allowedHost(ctx: CallContext, url: string, signal: AbortSignal): Promise<void> {
  if (!isSafeRemoteUrl(url)) throw new RefusedUrlError();
  if (!ctx.lookup) return;
  const host = new URL(url).hostname;
  let verdict = ctx.hosts.get(host);
  if (!verdict) {
    verdict = checkHost(url, ctx.lookup);
    ctx.hosts.set(host, verdict);
  }
  const v = await untilAborted(verdict, signal);
  if (v === 'refused') throw new RefusedUrlError();
  if (v === 'error') throw new Error('Name nicht auflösbar');
}

/** Removes every credential from a text (error messages may quote request details). */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) if (s.length >= 4) out = out.split(s).join('***');
  return out.replace(/access_token=[^&\s"']+/gi, 'access_token=***').replace(/(OAuth|Bearer)\s+[^\s"']+/g, '$1 ***');
}

function errorText(err: unknown, secrets: readonly string[]): string {
  if (err instanceof BudgetError) return 'Zeitbudget erschöpft';
  if (err instanceof HttpError) return err.message;
  if (err instanceof RefusedUrlError) return err.message;
  const e = err as { name?: unknown; message?: unknown; cause?: { message?: unknown } } | null;
  if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'Zeitüberschreitung';
  const msg = e && typeof e.message === 'string' ? e.message : String(err);
  const cause = e?.cause && typeof e.cause.message === 'string' ? ` (${e.cause.message})` : '';
  return redact(`${msg}${cause}`, secrets).slice(0, 200);
}

/** Request bookkeeping of a provider: queued requests are dropped once it is stopped. */
interface RequestTracker {
  stopped: boolean;
  requests: number;
}

async function httpGet(
  ctx: CallContext,
  url: string,
  headers: Record<string, string>,
  maxBytes: number,
  until = ctx.deadline,
  tracker: RequestTracker | null = null,
): Promise<{ status: number; body: Buffer; type: string }> {
  return ctx.limiter.run(async () => {
    if (tracker?.stopped) throw new SkippedError();
    const remaining = Math.min(until, ctx.deadline) - performance.now();
    if (remaining <= 50 || ctx.abort.signal.aborted) {
      ctx.budgetHit = true;
      throw new BudgetError();
    }
    ctx.requests++;
    if (tracker) tracker.requests++;
    const signal = AbortSignal.any([ctx.abort.signal, AbortSignal.timeout(Math.max(1, Math.floor(Math.min(ctx.opts.requestTimeoutMs, remaining))))]);
    try {
      // Redirects are followed here, one by one: every target passes the same address check, and
      // the key (Authorization) is not sent to another host.
      let current = url;
      let sent: Record<string, string> = { 'User-Agent': ctx.opts.userAgent, ...headers };
      let res: Response;
      for (let hop = 0; ; hop++) {
        await allowedHost(ctx, current, signal);
        res = await ctx.fetch(current, { headers: sent, signal, redirect: 'manual' });
        const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
        if (location === null) break;
        await res.body?.cancel().catch(() => undefined);
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new RefusedUrlError();
        }
        if (hop >= MAX_REDIRECTS) throw new Error('Zu viele Weiterleitungen');
        if (next.origin !== new URL(current).origin) {
          const { Authorization: _dropped, ...rest } = sent;
          sent = rest;
        }
        current = next.href;
      }
      const declared = Number(res.headers.get('content-length') ?? '');
      if (Number.isFinite(declared) && declared > maxBytes) {
        await res.body?.cancel().catch(() => undefined);
        throw new Error(`Antwort zu groß (${declared} B)`);
      }
      // A rejected key or a rate limit will not change within this call: requests of the
      // provider still waiting for a slot are dropped (the caller reports why).
      if (tracker && (res.status === 401 || res.status === 403 || res.status === 429)) tracker.stopped = true;
      const body = Buffer.from(await res.arrayBuffer());
      if (body.byteLength > maxBytes) throw new Error(`Antwort zu groß (${body.byteLength} B)`);
      return { status: res.status, body, type: res.headers.get('content-type') ?? '' };
    } catch (err) {
      // Cut off by the end of the budget (or the caller): not an error of the service.
      if (ctx.abort.signal.aborted) {
        ctx.budgetHit = true;
        throw new BudgetError();
      }
      throw err;
    }
  });
}

// ------------------------------------------------------------------ providers

interface Provider {
  readonly name: StreetLevelProviderName;
  /** Searches one box; may split it. Throws on HTTP or network errors. */
  search(ctx: CallContext, b: BBox, limit: number, until: number, tracker: RequestTracker): Promise<StreetLevelListing[]>;
}

const searchCache = new Map<string, { at: number; items: StreetLevelListing[] }>();
const SEARCH_CACHE_MAX = 4_000;

/** Forgets the listings kept in memory (tests, or after changing providers). */
export function clearStreetLevelSearchCache(): void {
  searchCache.clear();
}

function cachedSearch(ctx: CallContext, key: string): StreetLevelListing[] | null {
  if (ctx.opts.searchCacheTtlMs <= 0) return null;
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ctx.opts.searchCacheTtlMs) {
    searchCache.delete(key);
    return null;
  }
  return hit.items;
}

function rememberSearch(ctx: CallContext, key: string, items: StreetLevelListing[]): void {
  if (ctx.opts.searchCacheTtlMs <= 0) return;
  searchCache.set(key, { at: Date.now(), items });
  while (searchCache.size > SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value;
    if (oldest === undefined) break;
    searchCache.delete(oldest);
  }
}

function parseJson(body: Buffer): unknown {
  return JSON.parse(body.toString('utf8')) as unknown;
}

const panoramax: Provider = {
  name: 'panoramax',
  async search(ctx, b, limit, until, tracker) {
    // Unsorted on purpose: sorting by date makes the meta-catalogue 3-10 times slower and returns
    // fewer sequences; recency is weighed in selectSpread instead.
    const url = `${ctx.opts.panoramaxApi}/search?bbox=${fmtBbox(b)}&limit=${Math.max(1, Math.min(1000, Math.round(limit)))}`;
    const hit = cachedSearch(ctx, url);
    if (hit) return hit;
    const res = await httpGet(ctx, url, { Accept: 'application/geo+json, application/json' }, 16_000_000, until, tracker);
    if (res.status !== 200) throw new HttpError(res.status);
    const items = parsePanoramaxSearch(parseJson(res.body));
    rememberSearch(ctx, url, items);
    return items;
  },
};

/** Mapillary allows bboxes below 0.01 square degrees; a margin keeps rounding on the safe side. */
const MAPILLARY_MAX_AREA = 0.0095;

function mapillary(token: string): Provider {
  return {
    name: 'mapillary',
    async search(ctx, b, limit, until, tracker) {
      const fields = 'id,computed_geometry,geometry,thumb_256_url,thumb_1024_url,captured_at,creator,compass_angle,is_pano';
      const parts = splitBbox(b, MAPILLARY_MAX_AREA);
      const perPart = Math.max(1, Math.min(100, Math.ceil(limit / parts.length)));
      const lists = await Promise.all(
        parts.map(async (part) => {
          const url = `${ctx.opts.mapillaryApi}/images?fields=${fields}&bbox=${fmtBbox(part)}&limit=${perPart}`;
          const key = `${url}#${ctx.opts.pictureCrops ? 'L' : 'S'}`;
          const hit = cachedSearch(ctx, key);
          if (hit) return hit;
          // The token travels in the header only, so it never appears in a URL or a log line.
          const res = await httpGet(ctx, url, { Accept: 'application/json', Authorization: `OAuth ${token}` }, 16_000_000, until, tracker);
          if (res.status !== 200) throw new HttpError(res.status);
          const items = parseMapillarySearch(parseJson(res.body), ctx.opts.pictureCrops);
          rememberSearch(ctx, key, items);
          return items;
        }),
      );
      return lists.flat();
    },
  };
}

/** Where the key of a call comes from, and whether a key was given that cannot be used. */
interface KeyChoice {
  key: string | null;
  /** A key was configured but is malformed (it is not used). */
  malformed: boolean;
}

function chooseKey(deps: StreetLevelDeps): KeyChoice {
  if (deps.mapillaryKey !== undefined) {
    // Given by the caller (the engine, from the settings): still checked, it goes into a header.
    const checked = deps.mapillaryKey === null ? { set: false, key: null } : envMapillaryToken({ MAPILLARY_TOKEN: deps.mapillaryKey });
    return { key: checked.key, malformed: checked.set && checked.key === null };
  }
  if (deps.env) {
    const fromEnv = envMapillaryToken(deps.env);
    return { key: fromEnv.key, malformed: fromEnv.set && fromEnv.key === null };
  }
  const settings = datumSettings(deps.dataDir ?? config.dataDir);
  return { key: settings.mapillaryKey(), malformed: settings.envKeyMalformed() };
}

// ------------------------------------------------------------------ pixels and vectors

async function decodeBuffer(encoded: Buffer): Promise<DecodedFrame> {
  // The same decoding as ml/preprocess.ts decodeFrame, from memory instead of a file.
  const { data, info } = await sharp(encoded, { failOn: 'none', limitInputPixels: 40_000_000 })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`Unerwartete Kanalzahl ${info.channels}`);
  return { data, width: info.width, height: info.height };
}

interface Prepared {
  key: string;
  pixels: Float32Array;
  rows: number;
}

// ------------------------------------------------------------------ similarity and decision

interface QueryRows {
  vectors: Float32Array;
  frameRow: readonly number[];
  count: number;
}

/** Best cosine of a picture's rows against the query rows, with the frame row of the best. */
function bestAgainst(rows: Float32Array, q: QueryRows, dim: number): { similarity: number; frameRow: number } {
  let best = -2;
  let bestRow = 0;
  const pictureRows = rows.length / dim;
  for (let p = 0; p < pictureRows; p++) {
    const po = p * dim;
    for (let r = 0; r < q.count; r++) {
      const qo = r * dim;
      let s = 0;
      for (let d = 0; d < dim; d++) s += (rows[po + d] as number) * (q.vectors[qo + d] as number);
      if (s > best) {
        best = s;
        bestRow = q.frameRow[r] ?? r;
      }
    }
  }
  return { similarity: best, frameRow: bestRow };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/** Statistics of one candidate's compared pictures (sorted best first). */
export function candidateStats(pictures: readonly StreetLevelPicture[], opts: Pick<StreetLevelOptions, 'agreementTop' | 'agreementKm'>): StreetLevelStats | null {
  if (pictures.length === 0) return null;
  const sorted = [...pictures].sort((a, b) => b.similarity - a.similarity);
  const best = sorted[0] as StreetLevelPicture;
  const spreadSample = sorted.filter((p) => p.pass === 1);
  const others = spreadSample.filter((p) => p !== best).map((p) => p.similarity);
  const typical = others.length > 0 ? median(others) : best.similarity;
  const mad = median(others.map((s) => Math.abs(s - typical)));
  const spread = Math.max(0.005, 1.4826 * mad);
  const gap = best.similarity - typical;
  const next = sorted.slice(1, Math.max(1, opts.agreementTop));
  const agreeing = next.filter((p) => distanceKm(best.lat, best.lon, p.lat, p.lon) <= opts.agreementKm).length;
  return {
    pictures: pictures.length,
    spreadPictures: spreadSample.length,
    best: best.similarity,
    typical,
    spread,
    gap,
    z: gap / spread,
    agreement: next.length > 0 ? agreeing / next.length : 0,
  };
}

/** The decision rule on a candidate's statistics. */
export function isMatch(stats: StreetLevelStats | null, opts: Pick<StreetLevelOptions, 'minPictures' | 'minSimilarity' | 'minGap' | 'minZ' | 'minAgreement'>): boolean {
  if (!stats) return false;
  return (
    stats.spreadPictures >= opts.minPictures &&
    stats.best >= opts.minSimilarity &&
    stats.gap >= opts.minGap &&
    stats.z >= opts.minZ &&
    stats.agreement >= opts.minAgreement
  );
}

/** Similarity-weighted position of the pictures close to the best one, with a radius. */
export function refinedPoint(
  pictures: readonly StreetLevelPicture[],
  opts: Pick<StreetLevelOptions, 'pointKm' | 'pointSimilarityWindow' | 'pointTemperature' | 'minRadiusKm' | 'radiusFactor'>,
): { lat: number; lon: number; radiusKm: number; support: number } | null {
  const sorted = [...pictures].sort((a, b) => b.similarity - a.similarity);
  const best = sorted[0];
  if (!best) return null;
  const support = sorted.filter(
    (p) => p.similarity >= best.similarity - opts.pointSimilarityWindow && distanceKm(best.lat, best.lon, p.lat, p.lon) <= opts.pointKm,
  );
  let w = 0;
  let lat = 0;
  let lon = 0;
  for (const p of support) {
    const pw = Math.exp((p.similarity - best.similarity) / Math.max(1e-4, opts.pointTemperature));
    w += pw;
    lat += pw * p.lat;
    lon += pw * p.lon;
  }
  lat /= w;
  lon /= w;
  let s2 = 0;
  for (const p of support) {
    const pw = Math.exp((p.similarity - best.similarity) / Math.max(1e-4, opts.pointTemperature));
    s2 += pw * distanceKm(lat, lon, p.lat, p.lon) ** 2;
  }
  const rms = Math.sqrt(s2 / w);
  return { lat, lon, radiusKm: Math.max(opts.minRadiusKm, opts.radiusFactor * rms), support: support.length };
}

function confidenceOf(stats: StreetLevelStats, opts: StreetLevelOptions): number {
  const t = Math.max(0, Math.min(1, (stats.gap - opts.minGap) / Math.max(1e-3, opts.confidenceRampGap)));
  return opts.confidenceMin + t * (opts.confidenceMax - opts.confidenceMin);
}

// ------------------------------------------------------------------ texts

const fmt = (v: number, digits = 2): string => v.toFixed(digits).replace('.', ',');
const fmtEn = (v: number, digits = 2): string => v.toFixed(digits);

function providerList(states: readonly ProviderState[], lang: 'de' | 'en'): string {
  const used = states.filter((s) => s.enabled).map((s) => (s.name === 'panoramax' ? 'Panoramax' : 'Mapillary'));
  if (used.length === 0) return lang === 'de' ? 'keinem Dienst' : 'no service';
  return used.join(lang === 'de' ? ' und ' : ' and ');
}

// ------------------------------------------------------------------ the stage

function emptyResult(reasonCode: StreetLevelReasonCode, reason: string, reasonEn: string, started: number, providers: StreetLevelProviderReport[] = []): StreetLevelResult {
  return {
    matched: false,
    reasonCode,
    reason,
    reasonEn,
    location: null,
    candidateIndex: null,
    top: [],
    stats: null,
    candidates: [],
    providers,
    timing: {
      totalMs: performance.now() - started,
      searchMs: 0,
      picturesMs: 0,
      embedMs: 0,
      requests: 0,
      downloaded: 0,
      fromCache: 0,
      failed: 0,
      budgetExhausted: false,
    },
  };
}

/**
 * The result of a call its caller stopped waiting for (the engine's hard limit, see
 * DatumEngine): no match, reason 'error', with the time the caller waited.
 */
export function streetLevelCutOff(budgetMs: number, waitedMs: number): StreetLevelResult {
  const result = emptyResult(
    'error',
    `Zeitbudget von ${fmt(budgetMs / 1000, 0)} s überschritten; ohne Straßenbilder weitergerechnet.`,
    `Time budget of ${fmtEn(budgetMs / 1000, 0)} s exceeded; continued without street-level pictures.`,
    performance.now(),
  );
  result.timing.totalMs = waitedMs;
  result.timing.budgetExhausted = true;
  return result;
}

/**
 * Compares the video with street-level pictures around the candidates. Never throws: every
 * failure ends in { matched: false, reason }.
 */
export async function refineStreetLevel(input: StreetLevelInput, deps: StreetLevelDeps = {}): Promise<StreetLevelResult> {
  const started = performance.now();
  let choice: KeyChoice;
  try {
    choice = chooseKey(deps);
  } catch {
    // Unreadable settings: go on without Mapillary rather than fail the whole stage.
    choice = { key: null, malformed: false };
  }
  const raw = deps.mapillaryKey ?? deps.env?.['MAPILLARY_TOKEN'] ?? null;
  const secrets = [choice.key ?? '', raw?.trim() ?? ''].filter((s) => s !== '');
  try {
    return await run(input, deps, started, choice, secrets);
  } catch (err) {
    const text = errorText(err, secrets);
    return emptyResult('error', `Straßenbilder nicht auswertbar: ${text}.`, `Street-level pictures could not be compared: ${text}.`, started);
  }
}

async function run(input: StreetLevelInput, deps: StreetLevelDeps, started: number, choice: KeyChoice, secrets: string[]): Promise<StreetLevelResult> {
  const token = choice.key;
  const opts: StreetLevelOptions = { ...DEFAULT_STREETLEVEL_OPTIONS, ...input.options };
  const log = (line: string): void => deps.log?.(redact(line, secrets));
  const { model, dim } = input;

  // ---- providers
  const states: ProviderState[] = [];
  const active: Provider[] = [];
  if (opts.providers.includes('panoramax')) {
    states.push({ name: 'panoramax', enabled: true, note: null, noteEn: null, requests: 0, errors: 0, listed: 0, lastError: null, stopped: false });
    active.push(panoramax);
  }
  if (opts.providers.includes('mapillary')) {
    const note = token
      ? null
      : choice.malformed
        ? 'Der Mapillary-Schlüssel (MAPILLARY_TOKEN) hat kein gültiges Format; Mapillary nicht gefragt.'
        : 'Kein Mapillary-Schlüssel hinterlegt (Einstellungen oder MAPILLARY_TOKEN); Mapillary nicht gefragt.';
    const noteEn = token
      ? null
      : choice.malformed
        ? 'The Mapillary key (MAPILLARY_TOKEN) is malformed; Mapillary not asked.'
        : 'No Mapillary key stored (settings or MAPILLARY_TOKEN); Mapillary not asked.';
    states.push({ name: 'mapillary', enabled: token !== null, note, noteEn, requests: 0, errors: 0, listed: 0, lastError: null, stopped: false });
    if (token) active.push(mapillary(token));
  }
  const report = (): StreetLevelProviderReport[] => states.map(({ stopped: _stopped, ...r }) => r);

  // ---- input checks
  if (!(dim > 0) || input.frameVectors.length === 0 || input.frameVectors.length % dim !== 0) {
    return emptyResult('error', 'Keine Bildvektoren des Videos übergeben.', 'No frame vectors of the video were given.', started, report());
  }
  if (model.dim !== dim) {
    return emptyResult('error', `Modell (${model.dim}) und Bildvektoren (${dim}) passen nicht zusammen.`, `Model (${model.dim}) and frame vectors (${dim}) do not match.`, started, report());
  }
  const candidates = input.candidates
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon) && Math.abs(c.lat) <= 90 && Math.abs(c.lon) <= 180 && Number.isFinite(c.radiusKm) && c.radiusKm > 0)
    .filter((c) => c.radiusKm <= opts.maxRadiusKm * 1.5);
  if (candidates.length === 0) {
    return emptyResult(
      'no-candidates',
      `Kein Kandidatenort mit höchstens ${fmt(opts.maxRadiusKm, 0)} km Radius; Straßenbilder nicht gesucht.`,
      `No candidate place with a radius of at most ${fmtEn(opts.maxRadiusKm, 0)} km; street-level pictures not searched.`,
      started,
      report(),
    );
  }
  if (active.length === 0) {
    return emptyResult('no-providers', 'Kein Dienst für Straßenbilder verfügbar.', 'No street-level service available.', started, report());
  }

  const query: QueryRows = input.tiles && input.tiles.vectors.length > 0 && input.tiles.vectors.length % dim === 0
    ? { vectors: input.tiles.vectors, frameRow: input.tiles.frameRow, count: input.tiles.vectors.length / dim }
    : { vectors: input.frameVectors, frameRow: Array.from({ length: input.frameVectors.length / dim }, (_, i) => i), count: input.frameVectors.length / dim };

  const abort = new AbortController();
  const onOuterAbort = (): void => abort.abort();
  deps.signal?.addEventListener('abort', onOuterAbort, { once: true });
  if (deps.signal?.aborted) abort.abort();
  const deadline = started + Math.max(0, opts.budgetMs - opts.reserveMs);
  const ctx: CallContext = {
    opts,
    fetch: deps.fetch ?? ((url, init) => fetch(url, init)),
    limiter: new Limiter(Math.max(1, Math.floor(opts.concurrency))),
    abort,
    deadline,
    secrets,
    log,
    requests: 0,
    budgetHit: false,
    // The real network gets the address check; a mock fetch has no network to protect.
    lookup: deps.lookup !== undefined ? deps.lookup : deps.fetch ? null : defaultLookup,
    hosts: new Map(),
  };
  // At the end of the budget every request still running is cut off.
  const timer = setTimeout(() => {
    ctx.budgetHit = true;
    abort.abort();
  }, Math.max(0, deadline - performance.now()));
  const timing = { searchMs: 0, picturesMs: 0, embedMs: 0, downloaded: 0, fromCache: 0, failed: 0 };
  const cache = opts.cacheDir ? new StreetLevelVectorCache(opts.cacheDir, opts.modelId, dim) : null;
  const variant: 'whole' | 'crops' = opts.pictureCrops ? 'crops' : 'whole';
  const vectors = new Map<string, Float32Array>();
  const failed = new Set<string>();

  /** Lists one box from every active provider; errors are counted, never thrown. */
  const listBox = async (b: BBox, limit: number, until: number): Promise<StreetLevelListing[]> => {
    const lists = await Promise.all(
      active.map(async (p) => {
        const st = states.find((s) => s.name === p.name) as ProviderState;
        if (st.stopped) return [];
        try {
          const items = await p.search(ctx, b, limit, until, st);
          st.listed += items.length;
          return items;
        } catch (err) {
          if (err instanceof BudgetError || err instanceof SkippedError) return [];
          if (st.stopped && st.note !== null) return [];
          st.errors++;
          st.lastError = errorText(err, secrets);
          if (err instanceof HttpError && (err.status === 401 || err.status === 403 || err.status === 429)) {
            // A rejected key or a rate limit will not change within this call.
            st.stopped = true;
            st.note =
              err.status === 429
                ? `${p.name === 'panoramax' ? 'Panoramax' : 'Mapillary'} drosselt die Abfragen (429); für diesen Aufruf eingestellt.`
                : `${p.name === 'panoramax' ? 'Panoramax' : 'Mapillary'} lehnt den Zugang ab (${err.status}); Schlüssel prüfen.`;
            st.noteEn =
              err.status === 429
                ? `${p.name === 'panoramax' ? 'Panoramax' : 'Mapillary'} is rate limiting (429); stopped for this call.`
                : `${p.name === 'panoramax' ? 'Panoramax' : 'Mapillary'} refuses access (${err.status}); check the key.`;
          }
          log(`streetlevel: ${p.name} search failed: ${st.lastError}`);
          return [];
        }
      }),
    );
    return lists.flat();
  };

  /** Downloads, decodes and tiles one picture; null when it cannot be used. */
  const prepare = async (l: StreetLevelListing): Promise<Prepared | null> => {
    const key = keyOf(l);
    try {
      const res = await httpGet(ctx, l.thumbUrl, { Accept: 'image/jpeg, image/*' }, opts.maxImageBytes);
      if (res.status !== 200) throw new HttpError(res.status);
      if (res.type !== '' && !res.type.startsWith('image/') && !res.type.startsWith('application/octet-stream')) throw new Error(`kein Bild (${res.type})`);
      const decoded = await decodeBuffer(res.body);
      const size = model.imageSize;
      const plane = 3 * size * size;
      const rects: PixelRect[] = opts.pictureCrops ? tileLayout(decoded.width, decoded.height, 'standard') : [{ left: 0, top: 0, width: decoded.width, height: decoded.height }];
      const pixels = new Float32Array(rects.length * plane);
      for (const [i, rect] of rects.entries()) await writeTile(decoded, rect, size, model.imageMean, model.imageStd, pixels, i * plane);
      timing.downloaded++;
      return { key, pixels, rows: rects.length };
    } catch (err) {
      if (!(err instanceof BudgetError)) {
        timing.failed++;
        failed.add(key);
        log(`streetlevel: ${l.provider} picture ${l.id} skipped: ${errorText(err, secrets)}`);
      }
      return null;
    }
  };

  /** Vectors for the listings (cache first, then download and embed in pipelined chunks). */
  const embedAll = async (items: readonly StreetLevelListing[]): Promise<void> => {
    const tAll = performance.now();
    try {
      await embedInto(items);
    } finally {
      timing.picturesMs += performance.now() - tAll;
    }
  };
  const embedInto = async (items: readonly StreetLevelListing[]): Promise<void> => {
    const todo: StreetLevelListing[] = [];
    for (const l of items) {
      const key = keyOf(l);
      if (vectors.has(key) || failed.has(key)) continue;
      const hit = cache ? await cache.get(l.provider, l.id, variant) : null;
      if (hit) {
        vectors.set(key, hit);
        timing.fromCache++;
      } else todo.push(l);
    }
    const chunk = Math.max(4, Math.min(16, opts.concurrency * 3));
    const chunks: StreetLevelListing[][] = [];
    for (let i = 0; i < todo.length; i += chunk) chunks.push(todo.slice(i, i + chunk));
    const byKey = new Map(todo.map((l) => [keyOf(l), l]));
    const prepareChunk = (c: StreetLevelListing[]): Promise<(Prepared | null)[]> => Promise.all(c.map((l) => prepare(l)));
    let pending: Promise<(Prepared | null)[]> | null = chunks[0] ? prepareChunk(chunks[0]) : null;
    for (let i = 0; i < chunks.length && pending; i++) {
      const ready = (await pending).filter((p): p is Prepared => p !== null);
      // Download the next chunk while this one runs through the model.
      pending = i + 1 < chunks.length && performance.now() < ctx.deadline - 250 ? prepareChunk(chunks[i + 1] as StreetLevelListing[]) : null;
      if (ready.length === 0) continue;
      const plane = 3 * model.imageSize * model.imageSize;
      const total = ready.reduce((s, p) => s + p.rows, 0);
      const pixels = new Float32Array(total * plane);
      let at = 0;
      for (const p of ready) {
        pixels.set(p.pixels, at * plane);
        at += p.rows;
      }
      const t0 = performance.now();
      const out = await model.embedPixels(pixels, total);
      timing.embedMs += performance.now() - t0;
      at = 0;
      for (const p of ready) {
        const rows = out.slice(at * dim, (at + p.rows) * dim);
        at += p.rows;
        vectors.set(p.key, rows);
        const l = byKey.get(p.key);
        if (l && cache) await cache.put(l.provider, l.id, variant, rows);
      }
    }
    if (pending) await pending;
  };

  try {
    // ---- pass 1: list every candidate's area, choose a spread sample
    const tSearch = performance.now();
    const searchUntil = started + opts.budgetMs * opts.searchShare;
    const perCandidate = Math.max(1, Math.min(opts.maxPicturesPerCandidate, Math.floor(opts.maxPicturesTotal / candidates.length)));
    const tilesPer = candidates.map((c) => planSearchTiles(c, Math.min(c.radiusKm, opts.maxRadiusKm), opts.maxTilesPerCandidate, opts.minTileKm));
    const listedPer = await Promise.all(
      candidates.map(async (_c, ci) => {
        const lists = await Promise.all((tilesPer[ci] as BBox[]).map((b) => listBox(b, opts.perTileLimit, searchUntil)));
        return lists.flat();
      }),
    );
    timing.searchMs += performance.now() - tSearch;
    const now = Date.now();
    const samplePer = candidates.map((c, ci) => {
      const r = Math.min(c.radiusKm, opts.maxRadiusKm);
      const inside = (listedPer[ci] as StreetLevelListing[]).filter((l) => distanceKm(c.lat, c.lon, l.lat, l.lon) <= r);
      return { inside, sample: selectSpread(inside, perCandidate, c, now) };
    });
    const totalListed = samplePer.reduce((s, x) => s + x.inside.length, 0);
    log(`streetlevel: ${totalListed} pictures listed around ${candidates.length} candidate(s) in ${Math.round(timing.searchMs)} ms`);

    // Interleave the candidates so a short budget still compares some pictures of each.
    const order: { l: StreetLevelListing; ci: number }[] = [];
    for (let k = 0; k < perCandidate; k++) {
      samplePer.forEach((x, ci) => {
        const l = x.sample[k];
        if (l) order.push({ l, ci });
      });
    }
    await embedAll(order.map((o) => o.l));

    const scored: StreetLevelPicture[] = [];
    const score = (l: StreetLevelListing, ci: number, pass: 1 | 2): void => {
      const rows = vectors.get(keyOf(l));
      if (!rows) return;
      const c = candidates[ci] as StreetLevelCandidate;
      const best = bestAgainst(rows, query, dim);
      const frame = input.frameNumbers?.[best.frameRow];
      scored.push({
        ...l,
        similarity: best.similarity,
        frameRow: best.frameRow,
        ...(frame !== undefined ? { frame } : {}),
        candidateIndex: ci,
        distanceKm: distanceKm(c.lat, c.lon, l.lat, l.lon),
        pass,
      });
    };
    for (const o of order) score(o.l, o.ci, 1);

    // ---- refinement: densify around the best pictures so far, wide first, then close
    const have = new Set(order.map((o) => keyOf(o.l)));
    for (const round of opts.refine ? opts.refineRounds : []) {
      // Without a spread sample large enough to judge, densifying cannot make a decision possible.
      if (scored.length < opts.minPictures || ctx.deadline - performance.now() < opts.refineMinMs) break;
      const places: StreetLevelPicture[] = [];
      for (const p of [...scored].sort((a, b) => b.similarity - a.similarity)) {
        if (places.length >= round.places) break;
        if (places.some((q) => distanceKm(q.lat, q.lon, p.lat, p.lon) < round.radiusKm)) continue;
        places.push(p);
      }
      const t1 = performance.now();
      const nearLists = await Promise.all(
        places.map(async (p) => {
          const boxes = planSearchTiles(p, round.radiusKm, round.radiusKm >= 0.5 ? 4 : 1, opts.minTileKm);
          const lists = await Promise.all(boxes.map((b) => listBox(b, opts.perTileLimit, ctx.deadline)));
          return lists.flat();
        }),
      );
      timing.searchMs += performance.now() - t1;
      const extra: { l: StreetLevelListing; ci: number }[] = [];
      places.forEach((p, i) => {
        const near = (nearLists[i] as StreetLevelListing[]).filter((l) => distanceKm(p.lat, p.lon, l.lat, l.lon) <= round.radiusKm);
        for (const l of selectSpread(near, round.perPlace, p, now, have)) {
          have.add(keyOf(l));
          extra.push({ l, ci: p.candidateIndex });
        }
      });
      await embedAll(extra.map((e) => e.l));
      for (const e of extra) score(e.l, e.ci, 2);
    }

    // ---- decision
    const reports: StreetLevelCandidateReport[] = candidates.map((c, ci) => {
      const mine = scored.filter((p) => p.candidateIndex === ci);
      const stats = candidateStats(mine, opts);
      return {
        index: ci,
        lat: c.lat,
        lon: c.lon,
        radiusKm: Math.min(c.radiusKm, opts.maxRadiusKm),
        tiles: (tilesPer[ci] as BBox[]).length,
        listed: (samplePer[ci] as { inside: StreetLevelListing[] }).inside.length,
        sampled: (samplePer[ci] as { sample: StreetLevelListing[] }).sample.length,
        compared: mine.length,
        stats,
        matched: isMatch(stats, opts),
      };
    });
    const sampledTotal = samplePer.reduce((s, x) => s + x.sample.length, 0);
    const budgetExhausted = ctx.budgetHit;
    const finish = (partial: Omit<StreetLevelResult, 'candidates' | 'providers' | 'timing'>): StreetLevelResult => ({
      ...partial,
      ...(opts.returnAll ? { all: [...scored].sort((a, b) => b.similarity - a.similarity) } : {}),
      candidates: reports,
      providers: report(),
      timing: {
        totalMs: performance.now() - started,
        searchMs: timing.searchMs,
        picturesMs: timing.picturesMs,
        embedMs: timing.embedMs,
        requests: ctx.requests,
        downloaded: timing.downloaded,
        fromCache: timing.fromCache,
        failed: timing.failed,
        budgetExhausted,
      },
    });
    const cancelled = deps.signal?.aborted === true;
    const budgetNote = budgetExhausted
      ? cancelled
        ? { de: ` Vom Aufrufer abgebrochen; ${scored.length} von ${sampledTotal} gewählten Bildern verglichen.`, en: ` Cancelled by the caller; ${scored.length} of ${sampledTotal} chosen pictures compared.` }
        : { de: ` Zeitbudget von ${fmt(opts.budgetMs / 1000, 0)} s erschöpft; ${scored.length} von ${sampledTotal} gewählten Bildern verglichen.`, en: ` Time budget of ${fmtEn(opts.budgetMs / 1000, 0)} s used up; ${scored.length} of ${sampledTotal} chosen pictures compared.` }
      : { de: '', en: '' };
    const errorsNote = states.some((s) => s.errors > 0)
      ? {
          de: ` Fehler beim Abruf: ${states.filter((s) => s.errors > 0).map((s) => `${s.name} ${s.errors}× (${s.lastError ?? ''})`).join(', ')}.`,
          en: ` Request errors: ${states.filter((s) => s.errors > 0).map((s) => `${s.name} ${s.errors}× (${s.lastError ?? ''})`).join(', ')}.`,
        }
      : { de: '', en: '' };

    if (totalListed === 0 && budgetExhausted) {
      return finish({
        matched: false,
        reasonCode: 'error',
        reason: `Zeitbudget von ${fmt(opts.budgetMs / 1000, 0)} s erschöpft, bevor Straßenbilder gelistet waren.${errorsNote.de}`,
        reasonEn: `Time budget of ${fmtEn(opts.budgetMs / 1000, 0)} s used up before street-level pictures were listed.${errorsNote.en}`,
        location: null,
        candidateIndex: null,
        top: [],
        stats: null,
      });
    }
    if (totalListed === 0) {
      return finish({
        matched: false,
        reasonCode: states.every((s) => !s.enabled || s.errors > 0) && states.some((s) => s.errors > 0) ? 'error' : 'no-coverage',
        reason: `Keine Straßenbilder im Umkreis der Kandidaten bei ${providerList(states, 'de')}.${errorsNote.de}${budgetNote.de}`,
        reasonEn: `No street-level pictures around the candidates at ${providerList(states, 'en')}.${errorsNote.en}${budgetNote.en}`,
        location: null,
        candidateIndex: null,
        top: [],
        stats: null,
      });
    }

    // The candidate whose best picture stands out most; a matching one always wins.
    const ranked = reports.filter((r) => r.stats !== null).sort((a, b) => Number(b.matched) - Number(a.matched) || (b.stats as StreetLevelStats).gap - (a.stats as StreetLevelStats).gap);
    const chosen = ranked[0];
    if (!chosen || !chosen.stats || chosen.stats.spreadPictures < opts.minPictures) {
      const n = chosen?.stats?.spreadPictures ?? 0;
      return finish({
        matched: false,
        reasonCode: 'too-few',
        reason: `Nur ${n} Straßenbild${n === 1 ? '' : 'er'} auswertbar (${totalListed} gelistet); zu wenige für einen Vergleich, mindestens ${opts.minPictures}.${errorsNote.de}${budgetNote.de}`,
        reasonEn: `Only ${n} street-level picture${n === 1 ? '' : 's'} could be compared (${totalListed} listed); too few for a comparison, at least ${opts.minPictures}.${errorsNote.en}${budgetNote.en}`,
        location: null,
        candidateIndex: chosen?.index ?? null,
        top: scored.filter((p) => p.candidateIndex === chosen?.index).sort((a, b) => b.similarity - a.similarity).slice(0, 3),
        stats: chosen?.stats ?? null,
      });
    }
    const stats = chosen.stats;
    const mine = scored.filter((p) => p.candidateIndex === chosen.index).sort((a, b) => b.similarity - a.similarity);
    const top = mine.slice(0, 3);
    if (!chosen.matched) {
      return finish({
        matched: false,
        reasonCode: 'no-match',
        reason: `Kein Straßenbild hebt sich ab: bestes ${fmt(stats.best)}, typisch ${fmt(stats.typical)} (Abstand ${fmt(stats.gap)}, nötig ${fmt(opts.minGap)}); ${stats.pictures} Bilder von ${providerList(states, 'de')} verglichen. Der Ort bleibt, wie er ist.${errorsNote.de}${budgetNote.de}`,
        reasonEn: `No street-level picture stands out: best ${fmtEn(stats.best)}, typical ${fmtEn(stats.typical)} (gap ${fmtEn(stats.gap)}, needed ${fmtEn(opts.minGap)}); ${stats.pictures} pictures from ${providerList(states, 'en')} compared. The place stays as it was.${errorsNote.en}${budgetNote.en}`,
        location: null,
        candidateIndex: chosen.index,
        top,
        stats,
      });
    }
    const point = refinedPoint(mine, opts);
    const confidence = confidenceOf(stats, opts);
    return finish({
      matched: true,
      reasonCode: 'matched',
      reason: `Straßenbild passt: ${fmt(stats.best)} gegen typisch ${fmt(stats.typical)} (Abstand ${fmt(stats.gap)}, ${fmt(stats.z, 1)} Streuungen); ${stats.pictures} Bilder von ${providerList(states, 'de')} verglichen.${errorsNote.de}${budgetNote.de}`,
      reasonEn: `A street-level picture matches: ${fmtEn(stats.best)} against a typical ${fmtEn(stats.typical)} (gap ${fmtEn(stats.gap)}, ${fmtEn(stats.z, 1)} spreads); ${stats.pictures} pictures from ${providerList(states, 'en')} compared.${errorsNote.en}${budgetNote.en}`,
      location: point ? { lat: point.lat, lon: point.lon, radiusKm: point.radiusKm, confidence } : null,
      candidateIndex: chosen.index,
      top,
      stats,
    });
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener('abort', onOuterAbort);
    abort.abort();
  }
}

// ------------------------------------------------------------------ helpers for the engine

/** A short trace note for the engine's step list, in both languages. */
export function streetLevelNote(result: StreetLevelResult): { de: string; en: string } {
  const n = result.stats?.pictures ?? 0;
  const secs = (result.timing.totalMs / 1000).toFixed(1);
  if (result.matched && result.location) {
    return {
      de: `Straßenbild passt (${fmt(result.stats?.best ?? 0)}), ${n} Bilder, ${secs.replace('.', ',')} s`,
      en: `street-level match (${fmtEn(result.stats?.best ?? 0)}), ${n} pictures, ${secs} s`,
    };
  }
  const why: Record<StreetLevelReasonCode, { de: string; en: string }> = {
    matched: { de: 'Treffer', en: 'match' },
    'no-candidates': { de: 'kein enger Kandidat', en: 'no narrow candidate' },
    'no-providers': { de: 'kein Dienst', en: 'no service' },
    'no-coverage': { de: 'keine Straßenbilder in der Nähe', en: 'no street-level pictures nearby' },
    'too-few': { de: 'zu wenige Straßenbilder', en: 'too few street-level pictures' },
    'no-match': { de: `kein Straßenbild passt (${n} verglichen)`, en: `no street-level picture matches (${n} compared)` },
    error: { de: 'Abruf fehlgeschlagen', en: 'retrieval failed' },
  };
  const w = why[result.reasonCode];
  return { de: `${w.de}, ${secs.replace('.', ',')} s`, en: `${w.en}, ${secs} s` };
}

/**
 * Evidence entries for a fix, kind 'streetlevel'. With a match: one entry per top picture, best
 * first (refSource = the remote thumbnail, refUrl = the provider's viewer page, refLabel = the
 * attribution, weights sum to the confidence). refImage is left out: the engine sets it to the
 * node's proxy path (`withStreetImagePaths`, `streetImagePath`), because the console never loads a
 * picture from the remote host. Without a match: a single entry of weight 0 that says why,
 * without a picture.
 */
export function streetLevelEvidence(result: StreetLevelResult, opts: { kind?: EvidenceKind } = {}): Evidence[] {
  const kind = opts.kind ?? 'streetlevel';
  if (!result.matched || !result.location || !result.stats) {
    if (result.reasonCode === 'no-candidates' || result.reasonCode === 'no-providers') return [];
    const label: Record<StreetLevelReasonCode, { de: string; en: string }> = {
      matched: { de: 'Straßenbilder: Treffer ohne Ort', en: 'Street-level pictures: match without a place' },
      'no-candidates': { de: '', en: '' },
      'no-providers': { de: '', en: '' },
      'no-coverage': { de: 'Straßenbilder: keine in der Nähe', en: 'Street-level pictures: none nearby' },
      'too-few': { de: 'Straßenbilder: zu wenige', en: 'Street-level pictures: too few' },
      'no-match': { de: 'Straßenbilder: kein Treffer', en: 'Street-level pictures: no match' },
      error: { de: 'Straßenbilder: nicht abrufbar', en: 'Street-level pictures: not retrievable' },
    };
    return [
      {
        kind,
        label: label[result.reasonCode].de,
        labelEn: label[result.reasonCode].en,
        detail: result.reason,
        detailEn: result.reasonEn,
        weight: 0,
      },
    ];
  }
  const loc = result.location;
  const stats = result.stats;
  const best = result.top[0]?.similarity ?? 0;
  const weights = result.top.map((p) => Math.exp((p.similarity - best) / 0.02));
  const wSum = weights.reduce((s, w) => s + w, 0) || 1;
  return result.top.map((p, i) => {
    const provider = p.provider === 'panoramax' ? 'Panoramax' : 'Mapillary';
    const when = p.capturedAt !== null ? new Date(p.capturedAt).toISOString().slice(0, 7) : null;
    const dist = distanceKm(loc.lat, loc.lon, p.lat, p.lon);
    const distDe = dist < 0.05 ? 'am verfeinerten Ort' : `${Math.round(dist * 1000)} m vom verfeinerten Ort`;
    const distEn = dist < 0.05 ? 'at the refined place' : `${Math.round(dist * 1000)} m from the refined place`;
    const frameDe = p.frame !== undefined ? `Bild ${p.frame}` : `Bild ${p.frameRow + 1}`;
    const frameEn = p.frame !== undefined ? `Frame ${p.frame}` : `Frame ${p.frameRow + 1}`;
    return {
      kind,
      label: `Straßenbild: ${provider} (${fmt(p.similarity)})`,
      labelEn: `Street-level picture: ${provider} (${fmtEn(p.similarity)})`,
      detail: `${frameDe} gleicht einem Straßenbild von ${provider}${when ? ` (aufgenommen ${when})` : ''} mit Kosinus ${fmt(p.similarity)}, ${distDe}. Das typische Bild der Umgebung erreicht ${fmt(stats.typical)}; ${stats.pictures} Bilder verglichen. ${p.attribution}.`,
      detailEn: `${frameEn} resembles a street-level picture from ${provider}${when ? ` (taken ${when})` : ''} with a cosine of ${fmtEn(p.similarity)}, ${distEn}. The typical picture of the area reaches ${fmtEn(stats.typical)}; ${stats.pictures} pictures compared. ${p.attribution}.`,
      weight: (loc.confidence * (weights[i] as number)) / wSum,
      ...(p.frame !== undefined ? { frame: p.frame } : {}),
      refLabel: p.attribution,
      ...(p.pageUrl !== '' ? { refUrl: p.pageUrl } : {}),
      refSource: p.thumbUrl,
      refLat: p.lat,
      refLon: p.lon,
      similarity: p.similarity,
    };
  });
}

/**
 * The fix location after the stage: with a match, the refined point and radius (the label and
 * country of the coarse fix stay; method 'streetlevel', since the street-level picture now pins
 * the place); without one, the location unchanged.
 */
export function applyStreetLevel(location: FixLocation, result: StreetLevelResult): FixLocation {
  if (!result.matched || !result.location) return location;
  return {
    ...location,
    lat: result.location.lat,
    lon: result.location.lon,
    radiusKm: Math.min(location.radiusKm, result.location.radiusKm),
    confidence: Math.max(location.confidence, result.location.confidence),
    method: 'streetlevel',
  };
}

// ------------------------------------------------------------------ when the engine asks

/** The coarse answer of the localisation, as far as the decision below needs it. */
export interface StreetLevelSituation {
  location: FixLocation | null;
  diagnostics: {
    method: 'metadata' | 'landmark' | 'region' | 'worldmodel' | 'none';
    radiusTier: string | null;
    worldModel: { concentration: number; best: GeoPoint } | null;
  };
}

export interface StreetLevelRule {
  /** Radius searched around the coarse place (km). */
  radiusKm: number;
  /** Tiers of a gallery (landmark) answer that are close enough to search around. */
  landmarkTiers: readonly string[];
  /**
   * A world-model answer is searched around GeoCLIP's best point when its mass within 25 km is at
   * least this much; null: never.
   */
  worldModelMinConcentration: number | null;
}

/**
 * When the full stage compares with street-level pictures. A landmark recognised clearly (tier
 * 'strong') is searched 3 km around (docs/measurements/datum-streetlevel.json: with the true place
 * among the candidates 6 of 29 covered places matched, 5 within 1 km; around a wrong place 50 km
 * away 1 of 18 matched). On the engine's own answers for the reference videos
 * (docs/measurements/datum-streetlevel-open.json, the gallery as the live node uses it) the 8
 * 'strong' answers all lay within 3 km of the truth; 5 had enough Panoramax pictures and 1
 * matched, 0.3 km from the truth (the answer had been 1.0 km off).
 *
 * Tier 'recognised' is not searched: its answers are far more often wrong (radius 7500 km), and a
 * look-alike place is just where street-level pictures look alike too. Of the 3 'recognised'
 * answers, the one match was a wrong pin: a station 20 km from the filmed one, pinned with a
 * 1 km radius (the same in unknown mode, datum-streetlevel-worldmodel.json).
 *
 * World-model answers stay off (worldModelMinConcentration null). Measured on the reference
 * videos in unknown mode (the place not in the gallery; docs/measurements/
 * datum-streetlevel-worldmodel.json, scripts/datum/evaluateStreetlevel.ts --worldmodel), 3 km
 * around GeoCLIP's best point of the answers with a concentration of at least 0.2: on the train
 * half 4 such answers, 2 with enough Panoramax pictures, 1 match (0.5 km from the truth); on the
 * test half 5, 3 and 1 match, and that one a wrong pin (1.9 km from the truth with a 1 km
 * radius, where GeoCLIP's own point was 1.0 km off with 25 km). Both matches moved the point away
 * from the truth and only narrowed the circle. One match on train cannot show the wanted rate of
 * at most one wrong pin in ten; switch it on only after a measurement with ten matches or more
 * (with a Mapillary key, which this one did not have).
 */
export const STREETLEVEL_RULE: StreetLevelRule = {
  radiusKm: 3,
  landmarkTiers: ['strong'],
  worldModelMinConcentration: null,
};

/**
 * The candidate the full stage searches around for this answer, with why; null when it does not
 * search (no place, GPS in the file, a country- or continent-level answer, a diffuse world-model
 * answer).
 */
export function streetLevelPlan(
  located: StreetLevelSituation,
  rule: StreetLevelRule = STREETLEVEL_RULE,
): { candidate: StreetLevelCandidate; source: 'landmark' | 'worldmodel' } | null {
  const loc = located.location;
  if (!loc) return null;
  const d = located.diagnostics;
  if (d.method === 'landmark' && d.radiusTier !== null && rule.landmarkTiers.includes(d.radiusTier)) {
    return { candidate: { lat: loc.lat, lon: loc.lon, radiusKm: rule.radiusKm, label: loc.label }, source: 'landmark' };
  }
  if (d.method === 'worldmodel' && d.worldModel && rule.worldModelMinConcentration !== null && d.worldModel.concentration >= rule.worldModelMinConcentration) {
    return { candidate: { lat: d.worldModel.best.lat, lon: d.worldModel.best.lon, radiusKm: rule.radiusKm, label: loc.label }, source: 'worldmodel' };
  }
  return null;
}
