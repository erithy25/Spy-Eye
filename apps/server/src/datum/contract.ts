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
  | 'streetlevel' // frames compared with public street-level pictures around a recognised place
  | 'segments'; // the recording shows several places, one after another (Fix.segments)

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
  /**
   * Reference picture: thumbnail URL served by the node, label and position. For a gallery
   * reference the label is the landmark's name. For street-level evidence `refImage` is the node's
   * proxy path GET /api/datum/fixes/:videoId/street/:n (n counts the items that have a `refSource`,
   * 0-based, in evidence order, so it is set last, on the final order) and `refLabel` is the
   * attribution (author, licence, service), which the console shows under the picture.
   */
  refImage?: string;
  /** For a gallery reference and the world model's place: the German name (see refLabelEn). */
  refLabel?: string;
  /**
   * English name of the place in `refLabel` (gallery reference, world model's place), so that the
   * English console does not name a reference in German. Absent for street-level evidence, whose
   * refLabel is an attribution that reads the same in both languages, and on older fixes.
   */
  refLabelEn?: string;
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
    /**
     * True when the environment switches it off, whatever `enabled` says: DATUM_STREETLEVEL=0, or
     * offline mode (SICHT_OFFLINE, see `offline`).
     */
    forcedOff: boolean;
    /** True when the node runs in offline mode and contacts no one. Missing on older nodes. */
    offline?: boolean;
    /** Services that would be asked: Panoramax always, Mapillary only with a stored key. */
    providers: Array<'panoramax' | 'mapillary'>;
    /** Whether a Mapillary key is stored (from MAPILLARY_TOKEN or saved by an operator). Never the key. */
    mapillaryKey: boolean;
    /** Where the key comes from; 'env' cannot be changed from the console. */
    mapillaryKeySource: 'env' | 'stored' | 'none';
  };
  worldModel: {
    /**
     * Whether the world model can be used: read from the GeoCLIP files on disk until the engine
     * reports what actually runs (false when switched off with DATUM_WORLDMODEL=0, when the
     * weights are missing or when its thread failed or was given up).
     */
    available: boolean;
    /** Precision of the image tower: int8 (the default download) or fp32. */
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
  /**
   * Radius of the uncertainty circle (km). Chosen per evidence tier on the tuning half of the
   * reference set, so that the truth lies inside in about 70 % of its cases: e.g. 3 km for a clear
   * landmark match, 25 km for a concentrated world-model answer, 1 500 km for a diffuse one.
   */
  radiusKm: number;
  /** 0..1 */
  confidence: number;
  /**
   * What decided the place: 'metadata' (GPS in the file), 'landmark' (reference gallery),
   * 'worldmodel' (GeoCLIP replaced the gallery's answer), 'region' (country prior),
   * 'streetlevel' (moved onto a matching street-level picture in the full stage).
   */
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
   * True on the slimmed fixes of the list (GET /api/datum/fixes?slim=1): evidence [], no trace,
   * only the middle keyframe, the top 5 candidates and countries, no sun path and no horizon
   * profile, the stretches only in their compact form (`segmentSummary`). The full fix is GET
   * /api/datum/fix/:id. Absent on full fixes.
   */
  slim?: boolean;
  /**
   * The dataset the recording belongs to (GET /api/datum/datasets): the id of its source, or the
   * inbox ('eingang') when that source no longer exists. Set on the entries of the list (GET
   * /api/datum/fixes, slim or not), so that the console can group without a request per
   * recording; absent elsewhere and on nodes before datasets.
   */
  datasetId?: string;
  /**
   * The places of a recording that shows several of them (travel, dashcam, drone footage, a
   * compilation): the recording cut into stretches, one per place, in time order, from the start
   * of the video to its end. Present only when its pictures show at least two distinct places with
   * reasonable confidence and the file carries no GPS position; `location` is then the place of
   * the longest located stretch (or the answer for the whole file, where it agrees with that one)
   * and an evidence entry of kind 'segments' says so. Absent for a recording of one place, on
   * slim fixes (they carry `segmentSummary`) and on fixes of engine versions before 10.
   */
  segments?: FixSegment[];
  /**
   * The compact form of `segments` on the slim fixes of the list (GET /api/datum/fixes?slim=1):
   * how many stretches and places, the places and the route through them. Absent on full fixes.
   */
  segmentSummary?: FixSegmentSummary;
  /**
   * Ground truth, present for videos of the reference dataset (source 'referenz') and for uploaded
   * videos whose true place was given with the upload (source 'eigene', POST /api/datum/truth).
   * `url` names where a reference truth comes from (Wikimedia Commons or Wikidata); own truths
   * have none.
   */
  truth:
    | (GeoPoint & {
        /** Name of the true place: German for a reference truth, as given for an own truth. */
        label: string;
        /**
         * English name of a reference truth (from Wikidata, the same as label where there is no
         * English one). Absent for own truths, whose label is the analyst's own text and is shown
         * in both languages, and on fixes of older engine versions.
         */
        labelEn?: string;
        errorKm: number | null;
        source: string;
        url?: string;
      })
    | null;
}

/**
 * One stretch of a recording that shows several places (Fix.segments). The stretches follow each
 * other without gaps: the first starts at 0, each ends where the next starts, the last ends at
 * the end of the video.
 */
export interface FixSegment {
  /** Seconds into the video where the stretch starts and ends. */
  startSec: number;
  endSec: number;
  /** Numbers of the first and the last analysis frame of the stretch (as Keyframe.frame). */
  firstFrame: number;
  lastFrame: number;
  /**
   * A frame from the middle of the stretch and its picture (face-masked, served by the node). From
   * engine 11 on, located stretches other than the one the fix shows (whose spaces are
   * `Fix.keyframes`) carry a walkable space built from this frame, the longest stretches first and
   * at most twelve per recording: `spaceUrl` and `pitchDeg` as on a Keyframe. Absent otherwise.
   */
  keyframe: { frame: number; time: number; imageUrl: string; spaceUrl?: string; pitchDeg?: number };
  /**
   * The place of the stretch, decided from its own frames as the place of a whole recording is
   * (reference gallery, country prior, world model); null when its pictures do not say where it
   * was ("unbestimmt"): a weak answer is not forced onto a neighbouring place.
   */
  location: FixLocation | null;
  /**
   * Number of the place (1-based, in the order the places first appear): a recording that comes
   * back to a place gives both stretches the same number. null for an undetermined stretch.
   */
  place: number | null;
  /** How many windows (groups of the analysis's scenes) the stretch was decided from. */
  windows: number;
  /**
   * True when the stretch's place joins answers farther apart than places are told apart (25 km)
   * because the world model of their windows puts them in the same region: it may be several
   * places, and the count of places is then a lower bound. Absent otherwise.
   */
  joined?: boolean;
  /**
   * The time of day and the sun of a located stretch, from its own frames at its own place (engine
   * 11 on): the light of the whole file mixes the places. A time in the file's tags holds for the
   * whole file and decides here too; the sun is then that of the stretch's place at that instant.
   * Compact: no notes (they stay with the fix's own time), the sun path in 30-minute steps with
   * angles to 0.1°. Absent for undetermined stretches and on older fixes.
   */
  time?: TimeEstimate;
  sun?: SunReport | null;
  /**
   * Coarse regions of an undetermined stretch (engine 11 on), one per run of its windows for which
   * the reference gallery and the world model point to the same area (their answers at most
   * `radiusKm` apart): the area around the middle of the two, named by its part of the world. Not
   * a place: it never counts among the places, never becomes the fix's location, and the
   * stretch stays undetermined. Absent when no window of the stretch has one.
   */
  coarse?: FixSegmentRegion[];
}

/**
 * A coarse region within an undetermined stretch (FixSegment.coarse): where its windows' pictures
 * point to at the scale of a part of the world, with a radius calibrated on measured recordings
 * (docs/DATUM.md, "Grobe Region").
 */
export interface FixSegmentRegion extends GeoPoint {
  /** Seconds into the video: the windows it covers (within the stretch). */
  startSec: number;
  endSec: number;
  radiusKm: number;
  /**
   * Name of the part of the world its circle holds, or of the two that share it (regions.ts
   * regionAround), e.g. "Westeuropa" / "Western Europe", "Westeuropa oder Osteuropa" / "Western
   * Europe or Eastern Europe".
   */
  label: string;
  labelEn: string;
}

/**
 * One distinct place of a recording with several (FixSegmentSummary.places), at the point of its
 * most confident stretch; the fix's own place (FixSegmentSummary.lead) at the stretch the fix shows.
 */
export interface FixSegmentPlace extends GeoPoint {
  /** FixSegment.place */
  place: number;
  radiusKm: number;
  confidence: number;
  label: string;
  labelEn?: string;
  country: string | null;
  /** Seconds of the recording that show this place, over all its stretches. */
  seconds: number;
}

/** The compact form of Fix.segments, as the list of fixes carries it. */
export interface FixSegmentSummary {
  /** Stretches of the timeline, undetermined ones included. */
  segments: number;
  /** Of these, the undetermined ones: with any, the places are a lower bound ("at least"). */
  undetermined: number;
  /** Places that may be several (FixSegment.joined): with any, the places are a lower bound too. */
  joined?: number;
  /**
   * Number of the place the fix's location comes from (its point is then that stretch's, see
   * FixSegmentPlace); absent where the fix names none of them (summaries before it existed).
   */
  lead?: number;
  /** The distinct places, numbered as FixSegment.place. */
  places: FixSegmentPlace[];
  /** Place numbers of the located stretches in time order: the route (a return repeats a number). */
  route: number[];
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
