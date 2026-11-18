/**
 * DATUM: the shared contract between the localisation engine, the time and sun engine, the
 * spatial reconstruction, the HTTP routes and the console.
 *
 * Everything a fix contains is derived on this machine from the video itself, from data shipped
 * with the node (reference gallery, country shapes, elevation and map tiles) and from
 * astronomical arithmetic. No service is asked at run time.
 *
 * Conventions:
 *   - Latitude/longitude in decimal degrees (WGS 84).
 *   - Azimuth in degrees clockwise from true north (0 = N, 90 = E).
 *   - Elevation in degrees above the astronomical horizon.
 *   - Times: epoch milliseconds (UTC) where an absolute instant is known; minutes after local
 *     midnight (0..1439) for clock windows; local civil time uses `timezone` (IANA).
 *   - Every estimate carries its uncertainty; nothing is presented as exact unless it is.
 */

export interface GeoPoint {
  lat: number;
  lon: number;
}

/** One place the engine considers possible, best first. */
export interface FixCandidate extends GeoPoint {
  /** Human-readable name: nearest reference landmark or region, e.g. "Brandenburger Tor, Berlin". */
  label: string;
  /** ISO 3166-1 alpha-2 country code, or null over sea / unknown. */
  country: string | null;
  /** Normalised support 0..1 (candidates sum to <= 1). */
  score: number;
  /** Radius of the region this candidate stands for (km). */
  radiusKm: number;
}

export type EvidenceKind =
  | 'metadata' // GPS or time stored in the file
  | 'landmark' // nearest neighbours in the reference gallery
  | 'region' // zero-shot country / landscape prior
  | 'horizon' // terrain skyline matched against elevation data
  | 'sun' // sun elevation / azimuth read from light and shadows
  | 'season' // vegetation, snow, light
  | 'text' // signs, scripts, file name
  | 'filename'; // a date or place written in the file name

export interface Evidence {
  kind: EvidenceKind;
  /** Short statement, e.g. "Referenzbild: Kölner Dom (0,82)". */
  label: string;
  /** One sentence on what was measured and how strongly it counts. */
  detail: string;
  /** Contribution to the decision, 0..1. */
  weight: number;
  /** Frame number in the video this evidence was read from, if any. */
  frame?: number;
  /** Gallery reference: thumbnail URL served by the node, label and position. */
  refImage?: string;
  refLabel?: string;
  refLat?: number;
  refLon?: number;
  /** Similarity of the frame to the reference (cosine), if any. */
  similarity?: number;
}

export interface CountryProb {
  iso: string;
  name: string;
  p: number;
}

export interface TimeWindow {
  /** Minutes after local midnight (local civil time of `TimeEstimate.timezone`). */
  startMin: number;
  endMin: number;
  /** e.g. "Vormittag", "Nachmittag". */
  label: string;
  probability: number;
}

export type LightPhase = 'night' | 'twilight' | 'golden' | 'day' | 'unknown';

export interface TimeEstimate {
  /** How the time was obtained: exact from file metadata, derived from the sun, or not at all. */
  method: 'metadata' | 'sun' | 'none';
  /** Exact instant when known (metadata), else null. */
  utc: number | null;
  /** Calendar date when known from metadata or file name (YYYY-MM-DD), else null. */
  date: string | null;
  /** Where the date came from. */
  dateSource: 'metadata' | 'filename' | 'season' | 'none';
  /** Estimated months (1..12, inclusive, may wrap: [11, 2]) when the date is unknown. */
  monthRange: [number, number] | null;
  /** IANA zone used for local civil time, e.g. "Europe/Berlin"; null if the place is unknown. */
  timezone: string | null;
  /** Local civil time windows, best first. */
  windows: TimeWindow[];
  /** Sun elevation band read from the picture (degrees), null if not measurable. */
  sunElevationBand: [number, number] | null;
  phase: LightPhase;
  /** 0..1 */
  confidence: number;
  /** Short reasoning lines shown in the console. */
  notes: string[];
}

export interface SunState {
  /** Instant the state refers to (epoch ms, UTC). */
  at: number;
  azimuthDeg: number;
  elevationDeg: number;
  /** Direction shadows point to (azimuth + 180, normalised). */
  shadowAzimuthDeg: number;
  /** Shadow length divided by object height (1 / tan(elevation)); null when the sun is down. */
  shadowRatio: number | null;
}

export interface SunPathPoint {
  /** Epoch ms (UTC). */
  t: number;
  az: number;
  el: number;
}

export interface SunReport {
  /** Date the path is computed for (YYYY-MM-DD, local). */
  date: string;
  /** Sun at the best time estimate (null when no time could be estimated). */
  at: SunState | null;
  /** Path over the day in 10-minute steps. */
  path: SunPathPoint[];
  sunrise: number | null;
  sunset: number | null;
  solarNoon: number | null;
}

export interface Heading {
  /** Viewing direction of the camera at the keyframe (azimuth). */
  deg: number;
  /** Horizontal field of view assumed or measured. */
  fovDeg: number;
  method: 'horizon' | 'landmark' | 'sun' | 'metadata';
  confidence: number;
}

export interface HorizonMatch {
  /** Whether the skyline of the video matched the terrain horizon at the fix. */
  matched: boolean;
  /** Mean angular error of the match (degrees). */
  errorDeg: number | null;
  /** Terrain horizon at the fix: elevation angle (deg) for azimuth 0..359. */
  profile: number[] | null;
}

export interface Keyframe {
  frame: number;
  /** Seconds into the video. */
  time: number;
  imageUrl: string;
  /** Depth grid for the walkable space (binary, see SpaceGrid), null until computed. */
  spaceUrl: string | null;
  /** Skyline: per column (left to right) the normalised y of the sky boundary (0 = top, 1 = bottom), null if no sky. */
  skyline: number[] | null;
}

export interface FixLocation extends GeoPoint {
  radiusKm: number;
  /** 0..1 */
  confidence: number;
  method: EvidenceKind;
  label: string;
  country: string | null;
  countryName: string | null;
}

export interface Fix {
  videoId: string;
  status: 'pending' | 'running' | 'ready' | 'error';
  error: string | null;
  computedAt: number;
  /** Wall time the analysis took (ms). */
  elapsedMs: number;
  location: FixLocation | null;
  candidates: FixCandidate[];
  countries: CountryProb[];
  time: TimeEstimate;
  sun: SunReport | null;
  heading: Heading | null;
  horizon: HorizonMatch | null;
  evidence: Evidence[];
  keyframes: Keyframe[];
  /** Ground truth, present only for videos of the reference dataset (evaluation). */
  truth: (GeoPoint & { label: string; errorKm: number | null; source: string }) | null;
}

/**
 * Binary layout of a space grid (`Keyframe.spaceUrl`), little endian:
 *   bytes 0..3   magic "DSG1"
 *   uint32       width (columns)
 *   uint32       height (rows)
 *   float32      horizontal field of view (degrees)
 *   float32      near distance (m) of the grid
 *   float32      far distance (m) of the grid (sky and anything beyond is clamped here)
 *   float32[w*h] distance along the viewing ray in metres, row-major from the top-left;
 *                values >= far mark sky / unknown
 *   uint8[w*h]   sky mask (1 = sky)
 * The colour comes from `Keyframe.imageUrl`, sampled with the same normalised coordinates.
 */
export const SPACE_GRID_MAGIC = 'DSG1';

/** Terrain grid served by `/api/datum/terrain` (JSON). */
export interface TerrainGrid {
  /** Centre the grid was requested for. */
  center: GeoPoint;
  /** west, south, east, north */
  bbox: [number, number, number, number];
  /** Samples per side. */
  size: number;
  /** Heights in metres, row-major from the north-west corner, `size * size` values. */
  heights: number[];
  minHeight: number;
  maxHeight: number;
  /** Metres per sample along x and y. */
  cellMetres: number;
  /** Elevation zoom level of the source tiles. */
  sourceZoom: number;
}
