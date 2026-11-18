/**
 * Types shared between the server and the web client. The web app imports this file type-only,
 * so it must not depend on Node-specific types.
 */

export type DetailLevel = 'fast' | 'standard' | 'detail';
export const DETAIL_LEVELS: readonly DetailLevel[] = ['fast', 'standard', 'detail'];
export const SAMPLE_FPS_OPTIONS: readonly number[] = [0.5, 1, 2, 4];

export type VideoStatus = 'queued' | 'processing' | 'ready' | 'error';

/** Rectangle in normalized frame coordinates (0..1). */
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Tag {
  label: string;
  /** Calibrated match confidence, 0..1. */
  p: number;
}

export interface VideoInfo {
  id: string;
  name: string;
  sizeBytes: number;
  status: VideoStatus;
  error: string | null;
  createdAt: number;
  durationSec: number | null;
  frameWidth: number;
  frameHeight: number;
  sampleFps: number;
  detail: DetailLevel;
  tilesPerFrame: number;
  /** Frames extracted from the video so far. */
  framesSeen: number;
  /** Frames embedded and searchable (static duplicates are skipped). */
  framesIndexed: number;
  sceneCount: number;
  /** 0..1 while processing. */
  progress: number;
  /** Processing wall time in ms (running or final). */
  processingMs: number;
  /** Whether the browser can likely play the source file directly. */
  playable: boolean;
  /**
   * True while only the quick first-pass index exists (a few whole-frame keyframes).
   * The video is already searchable; the dense analysis replaces this index when it finishes.
   */
  coarse: boolean;
}

export interface SceneInfo {
  id: string;
  videoId: string;
  index: number;
  start: number;
  end: number;
  frameCount: number;
  keyframeUrl: string;
  keyframeNumber: number;
  keyframeTime: number;
  tags: Tag[];
}

export type ModelPhase = 'loading' | 'ready' | 'error';

export interface ModelState {
  phase: ModelPhase;
  modelId: string;
  family: 'siglip' | 'clip' | 'mobileclip' | null;
  /** Execution provider actually in use (cpu, dml, cuda, ...). */
  device: string;
  /** Non-fatal remark from start-up, e.g. that a GPU provider was rejected. Empty when all is well. */
  notice: string;
  dim: number | null;
  imageSize: number | null;
  dtype: string;
  threads: number;
  /** Download / load progress 0..1 while phase === 'loading'. */
  progress: number;
  message: string;
  vocabSize: number;
}

export interface Stats {
  videos: number;
  scenes: number;
  frames: number;
  vectors: number;
  indexBytes: number;
}

export interface AppState {
  model: ModelState;
  videos: VideoInfo[];
  stats: Stats;
  queueLength: number;
}

/** Live analysis event for one processed frame. */
export interface FrameEvent {
  videoId: string;
  /** Sequential number of the extracted frame (1-based). */
  frameNumber: number;
  time: number;
  url: string;
  /** True when the frame was a near-duplicate of the previous one and not embedded. */
  skipped: boolean;
  /** Cosine distance to the previously indexed frame (scene-change signal). */
  distance: number;
  /** Cosine distance to the running scene centroid. */
  drift: number;
  /** True when this frame starts a new scene. */
  cut: boolean;
  sceneIndex: number;
  tags: Tag[];
  /** Compact signed view of the embedding (values scaled to -1..1) for the fingerprint display. */
  fingerprint: number[];
  /** Tile rectangles analysed for this frame. */
  tiles: NormRect[];
  /** Milliseconds of model inference per frame (moving average). */
  msPerFrame: number;
}

export type ServerEvent =
  | { type: 'state'; state: AppState }
  | { type: 'ping' }
  | { type: 'model'; model: ModelState }
  | { type: 'video'; video: VideoInfo; stats: Stats; queueLength: number }
  | { type: 'video-removed'; videoId: string; stats: Stats }
  | { type: 'frames'; frames: FrameEvent[] }
  | { type: 'scene'; scene: SceneInfo };

export interface SearchResult {
  sceneId: string;
  videoId: string;
  videoName: string;
  sceneIndex: number;
  start: number;
  end: number;
  frameCount: number;
  /** Best matching frame of the scene. */
  frameNumber: number;
  frameUrl: string;
  time: number;
  /** Raw cosine similarity between query and best tile. */
  score: number;
  /** Calibrated confidence 0..1. */
  confidence: number;
  /** Region of the frame that matched best; null when the whole frame matched best. */
  box: NormRect | null;
  tags: Tag[];
  playable: boolean;
}

export interface SearchResponse {
  query: string;
  tookMs: number;
  embedMs: number;
  scenesSearched: number;
  framesSearched: number;
  vectorsSearched: number;
  threshold: number;
  /** Number of scenes above the threshold (before the limit is applied). */
  matched: number;
  results: SearchResult[];
  /** Histogram of best-per-scene confidence over all scenes (bins over 0..1). */
  distribution: number[];
  /** Per-scene confidence keyed by scene id, for colouring the embedding map. */
  sceneScores: Record<string, number>;
}

export interface ExplainResponse {
  videoId: string;
  frameNumber: number;
  query: string;
  cols: number;
  rows: number;
  /** Row-major grid of values normalized to 0..1 (relative relevance within the frame). */
  grid: number[];
  /** Tightest box around the most relevant region. */
  box: NormRect;
  peakConfidence: number;
  tookMs: number;
}

export interface MapPoint {
  sceneId: string;
  videoId: string;
  x: number;
  y: number;
  keyframeUrl: string;
  frameNumber: number;
  sceneIndex: number;
  time: number;
  label: string;
}

export interface MapResponse {
  version: number;
  points: MapPoint[];
  /** Fraction of variance captured by the two plotted components. */
  explainedVariance: number;
}

export interface UploadResponse {
  accepted: VideoInfo[];
  rejected: { name: string; reason: string }[];
}

export interface ApiError {
  error: string;
}

export interface SceneFrame {
  frameNumber: number;
  time: number;
  url: string;
}

export interface VideoScenesResponse {
  video: VideoInfo;
  scenes: SceneInfo[];
}

export interface SceneFramesResponse {
  video: VideoInfo;
  scene: SceneInfo;
  frames: SceneFrame[];
}
