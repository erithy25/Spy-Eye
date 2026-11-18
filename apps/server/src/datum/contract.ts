/**
 * DATUM: the shared contract between the localisation engine, the time and sun engine, the
 * spatial reconstruction, the HTTP routes and the console.
 *
 * Almost everything a fix contains is derived on this machine from the video itself, from data
 * and models shipped with or downloaded once by the node (reference gallery, world model, country
 * shapes, elevation and map tiles) and from astronomical arithmetic. The one exception is the
 * street-level comparison (evidence kind 'streetlevel'): when it is switched on (DatumSettings),
 * the full stage asks public street-level picture services (Panoramax, and Mapillary when a key
 * is stored) for pictures around a recognised place. Those services then learn which area is
 * being examined; no video, frame or vector ever leaves the node.
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
  /**
   * English version of label (landmark names stay as they are; "bei Köln" becomes "near Cologne").
   * Missing on fixes of older engine versions.
   */
  labelEn?: string;
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
  | 'filename' // a date or place written in the file name
  | 'worldmodel' // GeoCLIP: the frames scored against 100 000 places on Earth
  | 'streetlevel'; // frames compared with public street-level pictures around a recognised place

export interface Evidence {
  kind: EvidenceKind;
  /** Short statement, e.g. "Referenzbild: Kölner Dom (0,82)". */
  label: string;
  /** One sentence on what was measured and how strongly it counts. */
  detail: string;
  /** English versions of label and detail; the console shows them when its language is English. */
  labelEn?: string;
  detailEn?: string;
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
  /**
   * Page where a person can look at the reference at its source (e.g. the Panoramax or Mapillary
   * viewer for a street-level picture). Opened by the analyst's browser on request only.
   */
  refUrl?: string;
  /**
   * Remote thumbnail behind `refImage` for street-level evidence. Only the node fetches it (through
   * GET /api/datum/fixes/:videoId/street/:n, see `refImage`); the console never loads it directly.
   */
  refSource?: string;
}

/** Settings of the node's DATUM engine that an operator can change (GET/PUT /api/datum/settings). */
export interface DatumSettings {
  streetLevel: {
    /** Whether the full stage compares frames with public street-level pictures. */
    enabled: boolean;
    /** True when the environment (DATUM_STREETLEVEL=0) switches it off, whatever `enabled` says. */
    forcedOff: boolean;
    /** Services that would be asked: Panoramax always, Mapillary only with a stored key. */
    providers: Array<'panoramax' | 'mapillary'>;
    /** Whether a Mapillary key is stored (from MAPILLARY_TOKEN or saved by an operator). Never the key. */
    mapillaryKey: boolean;
    /** Where the key comes from; 'env' cannot be changed from the console. */
    mapillaryKeySource: 'env' | 'stored' | 'none';
  };
  worldModel: {
    /** Whether the GeoCLIP weights are on this machine. */
    available: boolean;
    precision: 'int8' | 'fp32';
  };
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
  /**
   * Calendar date when known from metadata or file name (YYYY-MM-DD), else null. A date from the
   * metadata without a time of day (a date-only tag) comes with method 'sun' or 'none'.
   */
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
  /** English versions of notes, same order. */
  notesEn?: string[];
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
  /** Viewing direction of the camera at the keyframe (azimuth of the image centre). */
  deg: number;
  /** Horizontal field of view assumed or measured. */
  fovDeg: number;
  method: 'horizon' | 'landmark' | 'sun' | 'metadata';
  confidence: number;
  /**
   * Camera pitch solved together with the heading (degrees): positive = looking up (the horizon
   * then lies below the image centre), 0 = level, negative = looking down. The heading holds only
   * with this pitch, on the keyframe `frame`, with the aspect `aspect`. Set for method 'horizon'.
   *
   * Projection used by the match (pinhole, square pixels, no roll; see horizon.ts `imageRay`):
   * a point at u (0..1, left to right) and y (0..1, top to bottom) of the frame has, with
   * f = 0.5 / tan(fovDeg / 2), X = (u − 0.5) / f, Y = (y − 0.5) / (aspect · f), p = pitchDeg,
   * forward = Y·sin p + cos p and up = sin p − Y·cos p:
   *   azimuth   = deg + atan2(X, forward)
   *   elevation = atan2(up, hypot(X, forward))   (degrees above the horizon)
   */
  pitchDeg?: number;
  /** `Keyframe.frame` of the keyframe whose skyline the heading was matched on. */
  frame?: number;
  /** Image aspect (width / height) the match assumed for that keyframe. */
  aspect?: number;
}

export interface HorizonMatch {
  /** Whether the skyline of the video matched the terrain horizon around the fix. */
  matched: boolean;
  /** Mean angular error of the match (degrees). */
  errorDeg: number | null;
  /**
   * Point the profile was computed at, and with it the skyline match and the heading. After a
   * match it is the best point of the search grid around the fix (up to about 4 km from
   * `Fix.location`, which keeps its place); without a match it is the fix location. A camera that
   * shows this profile or the heading belongs here. Absent in fixes of older engine versions.
   */
  at?: GeoPoint;
  /** Terrain horizon at `at`: elevation angle (deg) for azimuth 0..359. */
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
  /**
   * Camera pitch the space grid was built with (degrees): positive = looking up (the horizon
   * lies below the image centre), 0 = level, negative = looking down. Absent when no grid was
   * built. Estimated from the picture by space.ts, independently of `Heading.pitchDeg`.
   *
   * The grid's distances run along the rays of this pitched camera. To place a grid point in a
   * level world frame (x right, y up, the camera at the origin looking along −z at yaw 0, as in
   * three.js), take the point p in the camera frame (x right, y up, viewing direction −z) and
   * rotate it about the x axis by θ = pitchDeg:
   *   x_w = p.x
   *   y_w = p.y · cos θ − p.z · sin θ
   *   z_w = p.y · sin θ + p.z · cos θ
   * (the same as a three.js camera with rotation.x = θ). The flat ground the grid was scaled with
   * then lies at y_w = −1.6 m (EYE_HEIGHT_M below the camera).
   */
  pitchDeg?: number;
}

/** One step of the analysis, as it ran (shown live in the console). */
export interface TraceStep {
  label: string;
  /** Wall time of the step (ms). */
  ms: number;
  detail?: string;
  /** English version of detail (the label is a fixed phrase the console translates itself). */
  detailEn?: string;
}

export interface FixLocation extends GeoPoint {
  radiusKm: number;
  /** 0..1 */
  confidence: number;
  method: EvidenceKind;
  label: string;
  /** English version of label, as FixCandidate.labelEn. */
  labelEn?: string;
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
  /** The steps of the analysis with their times; grows while the fix is running. */
  trace?: TraceStep[];
  /**
   * 'quick': located from frames sampled straight from the file, right after the upload, before
   * the full analysis (no walkable spaces yet). 'full': after the full analysis, with spaces.
   * Missing on fixes of older engine versions (= 'full').
   */
  stage?: 'quick' | 'full';
  /**
   * Ground truth, present for videos of the reference dataset (source 'referenz') and for uploaded
   * videos whose true place was given with the upload (source 'eigene', POST /api/datum/truth).
   * `url` names where a reference truth comes from (Wikimedia Commons or Wikidata); own truths
   * have none.
   */
  truth: (GeoPoint & { label: string; errorKm: number | null; source: string; url?: string }) | null;
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
 * The rays are those of the pitched camera; the grid carries no pitch, see `Keyframe.pitchDeg`.
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
