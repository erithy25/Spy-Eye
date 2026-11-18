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
  /** Source (camera, drone, upload inbox) this recording belongs to. */
  sourceId: string;
  /** Wall-clock time of the first frame (epoch ms); the upload time when unknown. */
  capturedAt: number;
  /** Set for clips that belong to an exercise scenario; they are replayed by the scenario clock. */
  scenario: string | null;
  /** Faces masked in the stored frames of this recording. */
  facesMasked: number;
  /** When the recording will be deleted (epoch ms); null while it is held as evidence or retention is off. */
  deleteAfter: number | null;
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
  family: 'siglip' | 'siglip2' | 'clip' | 'mobileclip' | null;
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
  | { type: 'feeds'; feeds: FeedState[]; scenario: ScenarioInfo }
  | { type: 'alert'; alert: Alert }
  | { type: 'incident'; incident: Incident }
  | { type: 'intel-reset' }
  | { type: 'ledger'; head: string; length: number }
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
  sourceId: string;
  sourceName: string;
  sourceKind: SourceKind;
  lat: number | null;
  lon: number | null;
  /** Wall-clock time of the frame (epoch ms). */
  at: number;
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
  /** Best confidence per source, for highlighting sources on the map. */
  sourceScores: Record<string, number>;
  /** Results from peer nodes, when the search was federated. */
  federated: FederatedResult[];
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

// ---------------------------------------------------------------- platform

export type Role = 'operator' | 'supervisor' | 'auditor';

export interface UserInfo {
  id: string;
  name: string;
  role: Role;
  unit: string;
}

export interface Mandate {
  id: string;
  /** Short name of the operation or exercise. */
  title: string;
  titleEn?: string;
  /** Legal basis as cited by the authority, e.g. a section of a disaster-control act. */
  legalBasis: string;
  /** What the system may be used for under this mandate. */
  purpose: string;
  issuedBy: string;
  validFrom: number;
  validTo: number | null;
  status: 'open' | 'closed';
  createdAt: number;
  closedAt: number | null;
  /** True for exercise / demonstration mandates. */
  exercise: boolean;
  /**
   * Whether prompts may describe persons by sex or age group ("a child", "an elderly man").
   * Identifying features and protected attributes are refused regardless.
   */
  personDescriptions: boolean;
}

export interface NodeInfo {
  id: string;
  /** Display name of the installation, e.g. the control centre operating it. */
  name: string;
  /** Operating authority. */
  operator: string;
  /** Short location label. */
  region: string;
  lat: number;
  lon: number;
  version: string;
}

export interface SessionInfo {
  user: UserInfo;
  permissions: string[];
  mandate: Mandate | null;
}

export interface PublicInfo {
  node: NodeInfo;
  /** Present while the node only has seeded demonstration accounts. */
  demo: { users: UserInfo[]; passwordHint: string } | null;
}

export interface LedgerEntryInfo {
  seq: number;
  ts: string;
  actor: string;
  role: string;
  mandateId: string | null;
  action: string;
  summary: string;
  data: Record<string, unknown>;
  prev: string;
  hash: string;
}

export interface LedgerPage {
  head: string;
  length: number;
  entries: LedgerEntryInfo[];
}

export interface LedgerVerificationInfo {
  ok: boolean;
  entries: number;
  head: string;
  brokenAt: number | null;
  reason: string | null;
  checkedAt: string;
  tookMs: number;
}

// ---------------------------------------------------------------- sources, exercise, watches

export type SourceKind = 'drone' | 'helicopter' | 'fixed' | 'vehicle' | 'bodycam' | 'citizen' | 'satellite' | 'upload';
export const SOURCE_KINDS: readonly SourceKind[] = [
  'drone', 'helicopter', 'fixed', 'vehicle', 'bodycam', 'citizen', 'satellite', 'upload',
];

export interface SourceInfo {
  id: string;
  name: string;
  /** English display name, when it differs. */
  nameEn?: string;
  kind: SourceKind;
  /** Organisation that owns the sensor. */
  owner: string;
  description: string;
  lat: number | null;
  lon: number | null;
  /** archive: uploaded recordings · exercise: driven by the scenario clock · live: connected stream. */
  mode: 'archive' | 'exercise' | 'live';
  /** Whether peer nodes may search this source. */
  shared: boolean;
  createdAt: number;
}

/** Current picture of one source, for the live wall and the map. */
export interface FeedState {
  sourceId: string;
  online: boolean;
  videoId: string | null;
  frameNumber: number | null;
  frameUrl: string | null;
  /** Wall-clock time of the frame (epoch ms). */
  at: number | null;
  label: string;
  activeAlerts: number;
}

export interface ScenarioInfo {
  id: string;
  title: string;
  titleEn: string;
  description: string;
  descriptionEn: string;
  durationSec: number;
  /** absent: footage not installed · installing: clips are being analysed. */
  status: 'absent' | 'installing' | 'ready' | 'running' | 'paused' | 'finished';
  clipsTotal: number;
  clipsReady: number;
  elapsedSec: number;
  speed: number;
  startedAt: number | null;
  center: { lat: number; lon: number; zoom: number };
  /** Why the footage cannot be installed, if so. */
  problem: string | null;
}

export type Severity = 1 | 2 | 3;

export interface Watch {
  id: string;
  name: string;
  nameEn?: string;
  /** What to look for, in the model's language (English). Empty for hazard-model watches. */
  prompt: string;
  /** Phrases that must match less well than the prompt (suppresses look-alikes). */
  exclude: string[];
  /** text: open-vocabulary prompt · hazard: class of the trained hazard model. */
  kind: 'text' | 'hazard';
  hazardClass: string | null;
  severity: Severity;
  /** Minimum confidence (0..1) for a frame to count. */
  threshold: number;
  /** Consecutive matching frames before an alert is raised. */
  persistence: number;
  /** Seconds without a match after which an alert ends. */
  cooldownSec: number;
  /** Restrict to these source kinds; empty means all. */
  sourceKinds: SourceKind[];
  enabled: boolean;
  mandateId: string;
  createdBy: string;
  createdAt: number;
  /** Similarity above which a frame counts as a match, derived from the indexed footage. */
  cutoff: number;
  feedback: { confirmed: number; dismissed: number };
  /** True once analyst feedback has been used to train this watch. */
  learned: boolean;
  /** Increases with every explicit retraining or reset; version 1 is the plain prompt. */
  version: number;
  /** Verdicts recorded since the last retraining; they have no effect until someone retrains. */
  pendingFeedback: number;
  /**
   * Watches of one group describe the same kind of event (fire, smoke, a trained fire model).
   * Only their alerts are combined into one incident. Defaults to the watch's own id.
   */
  group: string;
}

export interface WatchPreview {
  cutoff: number;
  /** Frames in the current index that would have matched. */
  matches: number;
  framesChecked: number;
  samples: { frameUrl: string; confidence: number; sourceName: string; at: number }[];
}

export interface Alert {
  id: string;
  watchId: string;
  watchName: string;
  watchNameEn: string;
  /** Seconds on the exercise clock when the alert was raised; null outside exercises. */
  exerciseSec: number | null;
  severity: Severity;
  sourceId: string;
  sourceName: string;
  sourceKind: SourceKind;
  lat: number | null;
  lon: number | null;
  videoId: string;
  frameNumber: number;
  frameUrl: string;
  box: NormRect | null;
  confidence: number;
  score: number;
  firstSeen: number;
  lastSeen: number;
  /** Matching frames so far. */
  frames: number;
  /** True while the condition is still being observed. */
  active: boolean;
  status: 'new' | 'confirmed' | 'dismissed';
  reviewedBy: string | null;
  incidentId: string | null;
  exercise: boolean;
  /** Group of the watch that raised the alert. */
  group: string;
  /**
   * What the trained hazard model sees in the evidence frame, for alerts from aerial sources.
   * It is an independent second opinion and may disagree with the watch.
   */
  secondOpinion: { label: string; p: number } | null;
}

export interface Incident {
  id: string;
  title: string;
  titleEn: string;
  /** Nearest named place. */
  place: string;
  mgrs: string;
  severity: Severity;
  status: 'open' | 'acknowledged' | 'closed';
  lat: number;
  lon: number;
  alertIds: string[];
  sourceIds: string[];
  watchNames: string[];
  firstSeen: number;
  lastSeen: number;
  /** Independent sources reporting the same thing. */
  corroboration: number;
  exercise: boolean;
  /** Watch group whose alerts form this incident. */
  group: string;
}

export interface IntelSnapshot {
  sources: SourceInfo[];
  feeds: FeedState[];
  scenario: ScenarioInfo;
  watches: Watch[];
  alerts: Alert[];
  incidents: Incident[];
}

// ---------------------------------------------------------------- cases

export interface CaseItem {
  id: string;
  videoId: string;
  frameNumber: number;
  frameUrl: string;
  sourceId: string;
  sourceName: string;
  /** Wall-clock time of the frame (epoch ms). */
  at: number;
  note: string;
  /** SHA-256 of the unmasked frame as stored at ingest. */
  sha256: string;
  query: string | null;
  box: NormRect | null;
  addedBy: string;
  addedAt: number;
}

export interface CaseNote {
  id: string;
  text: string;
  by: string;
  at: number;
}

export interface CaseFile {
  id: string;
  title: string;
  mandateId: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  items: CaseItem[];
  notes: CaseNote[];
  sealedAt: number | null;
  sealedBy: string | null;
  /** SHA-256 over the canonical content at sealing time; also written to the ledger. */
  sealHash: string | null;
}

// ---------------------------------------------------------------- federation

export interface PeerInfo {
  id: string;
  name: string;
  operator: string;
  region: string;
  url: string;
  lat: number;
  lon: number;
  online: boolean;
  latencyMs: number | null;
  lastSeen: number | null;
  /** Latest ledger head of the peer that this node has witnessed. */
  witnessedHead: string | null;
  sources: number;
  frames: number;
}

export interface FederatedHit {
  sourceName: string;
  sourceKind: SourceKind;
  lat: number | null;
  lon: number | null;
  at: number;
  confidence: number;
  score: number;
  /** Small masked preview as a data URL; raw footage stays on the peer. */
  thumbnail: string;
  tags: Tag[];
}

export interface FederatedResult {
  peerId: string;
  peerName: string;
  ok: boolean;
  error: string | null;
  tookMs: number;
  matched: number;
  /** Ledger sequence under which the peer recorded this request. */
  receipt: number | null;
  hits: FederatedHit[];
}

// ---------------------------------------------------------------- measurement

export interface HazardModelCard {
  name: string;
  version: string;
  trainedOn: string;
  license: string;
  classes: string[];
  trainImages: number;
  testImages: number;
  accuracy: number;
  macroF1: number;
  zeroShotAccuracy: number;
  zeroShotMacroF1: number;
  perClass: { name: string; precision: number; recall: number; f1: number; support: number }[];
  confusion: number[][];
  encoder: string;
}

export interface ExerciseEvaluation {
  events: {
    label: string;
    sourceName: string;
    onsetSec: number;
    detectedSec: number | null;
    latencySec: number | null;
    watchName: string | null;
  }[];
  total: number;
  detected: number;
  medianLatencySec: number | null;
  falseAlarms: number;
  alerts: number;
}

export interface Metrics {
  /** Days after which recordings are deleted unless held in a case; 0 = no automatic deletion. */
  retentionDays: number;
  footageSec: number;
  framesAnalysed: number;
  vectors: number;
  sources: number;
  facesMasked: number;
  maskingActive: boolean;
  searches: { count: number; blocked: number; federated: number; medianMs: number | null; p95Ms: number | null };
  alerts: { total: number; confirmed: number; dismissed: number; open: number };
  unmaskEvents: number;
  ledgerEntries: number;
  /** Seconds of footage per second of analysis on this machine, from completed recordings. */
  analysisSpeed: number | null;
  evaluation: ExerciseEvaluation | null;
  hazardModel: HazardModelCard | null;
}
