import type {
  Alert,
  ApiError,
  AppState,
  CaseFile,
  DetailLevel,
  ExplainResponse,
  Incident,
  IntelSnapshot,
  LedgerEntryInfo,
  LedgerPage,
  LedgerVerificationInfo,
  Mandate,
  MapResponse,
  Metrics,
  NormRect,
  PeerInfo,
  PublicInfo,
  SceneFramesResponse,
  SearchResponse,
  SessionInfo,
  Severity,
  SourceInfo,
  SourceKind,
  UploadResponse,
  VideoScenesResponse,
  Watch,
  WatchPreview,
} from '../../server/src/types';

export type * from '../../server/src/types';

/** Mirrors the server's list; the server module is imported for its types only. */
export const SOURCE_KINDS: readonly SourceKind[] = ['drone', 'helicopter', 'fixed', 'vehicle', 'bodycam', 'citizen', 'satellite', 'upload'];

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Machine-readable reason, e.g. "refused" or "mandate-required". */
    readonly code: string | null = null,
    /** Rule of the prompt guard that refused the request. */
    readonly rule: string | null = null,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function parseError(response: Response): Promise<ApiRequestError> {
  let message = `HTTP ${response.status}`;
  let code: string | null = null;
  let rule: string | null = null;
  try {
    const body = (await response.json()) as Partial<ApiError> & { code?: unknown; rule?: unknown };
    if (typeof body.error === 'string' && body.error !== '') message = body.error;
    if (typeof body.code === 'string') code = body.code;
    if (typeof body.rule === 'string') rule = body.rule;
  } catch {
    // Response had no JSON body; keep the generic message.
  }
  return new ApiRequestError(message, response.status, code, rule);
}

async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiRequestError('Server nicht erreichbar.', 0);
  }
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const get = <T>(url: string, signal?: AbortSignal): Promise<T> => request<T>('GET', url, undefined, signal);
const post = <T>(url: string, body: unknown = {}): Promise<T> => request<T>('POST', url, body);

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------- session

export const fetchPublicInfo = (): Promise<PublicInfo> => get('api/public/info');
export const fetchSession = (): Promise<SessionInfo> => get('api/session');
export const login = (user: string, password: string): Promise<SessionInfo> => post('api/login', { user, password });
export const logout = (): Promise<void> => post('api/logout');
export const fetchMandates = (): Promise<Mandate[]> => get('api/mandates');
export const selectMandate = (id: string): Promise<SessionInfo> => post('api/session/mandate', { id });
export const closeMandate = (id: string): Promise<Mandate> => post(`api/mandates/${id}/close`);
export const createMandate = (input: {
  title: string;
  legalBasis: string;
  purpose: string;
  validHours: number;
  exercise: boolean;
  personDescriptions: boolean;
}): Promise<Mandate> => post('api/mandates', input);

// ---------------------------------------------------------------- recordings and search

export const fetchState = (signal?: AbortSignal): Promise<AppState> => get('api/state', signal);

export function searchScenes(
  query: string,
  options: { limit: number; federated: boolean },
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, limit: String(options.limit) });
  if (options.federated) params.set('federated', '1');
  return get(`api/search?${params.toString()}`, signal);
}

export function explainFrame(videoId: string, frameNumber: number, query: string, signal?: AbortSignal): Promise<ExplainResponse> {
  const params = new URLSearchParams({ videoId, frame: String(frameNumber), q: query });
  return get(`api/explain?${params.toString()}`, signal);
}

export const fetchEmbeddingMap = (signal?: AbortSignal): Promise<MapResponse> => get('api/embedding-map', signal);
export const fetchVideoScenes = (videoId: string, signal?: AbortSignal): Promise<VideoScenesResponse> =>
  get(`api/videos/${videoId}/scenes`, signal);
export const fetchSceneFrames = (videoId: string, sceneIndex: number, signal?: AbortSignal): Promise<SceneFramesResponse> =>
  get(`api/videos/${videoId}/scenes/${sceneIndex}/frames`, signal);

export async function deleteVideo(videoId: string): Promise<void> {
  await request<void>('DELETE', `api/videos/${videoId}`);
}

export const retryVideo = (videoId: string): Promise<void> => post(`api/videos/${videoId}/retry`);

export interface UploadHandle {
  promise: Promise<UploadResponse>;
  abort(): void;
}

/** Uploads one file with progress reporting (XHR, because fetch has no upload progress). */
export function uploadVideo(
  file: File,
  options: { sampleFps: number; detail: DetailLevel; sourceId: string },
  onProgress: (fraction: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadResponse>((resolve, reject) => {
    const params = new URLSearchParams({ fps: String(options.sampleFps), detail: options.detail, source: options.sourceId });
    xhr.open('POST', `api/videos?${params.toString()}`);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      const body = xhr.response as (Partial<UploadResponse> & Partial<ApiError>) | null;
      if (body && Array.isArray(body.accepted) && Array.isArray(body.rejected)) {
        resolve({ accepted: body.accepted, rejected: body.rejected });
      } else {
        reject(new ApiRequestError(body?.error ?? `HTTP ${xhr.status}`, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiRequestError('Server nicht erreichbar.', 0));
    xhr.onabort = () => reject(new ApiRequestError('Abgebrochen.', 0));
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

// ---------------------------------------------------------------- sources, exercise, watches, alerts

export const fetchIntel = (signal?: AbortSignal): Promise<IntelSnapshot> => get('api/intel', signal);

export const createSource = (input: {
  name: string;
  kind: SourceKind;
  owner: string;
  description: string;
  lat: number | null;
  lon: number | null;
  shared: boolean;
}): Promise<SourceInfo> => post('api/sources', input);

export const updateSource = (id: string, patch: { shared?: boolean; name?: string }): Promise<SourceInfo> =>
  request('PATCH', `api/sources/${id}`, patch);

export async function deleteSource(id: string): Promise<void> {
  await request<void>('DELETE', `api/sources/${id}`);
}

export type ExerciseAction = 'install' | 'start' | 'pause' | 'resume' | 'speed' | 'stop' | 'uninstall';
export const exercise = (action: ExerciseAction, speed?: number): Promise<IntelSnapshot> =>
  post(`api/exercise/${action}`, speed !== undefined ? { speed } : {});

export interface WatchInput {
  name: string;
  kind: 'text' | 'hazard';
  prompt: string;
  exclude: string[];
  hazardClass: string | null;
  severity: Severity;
  threshold: number;
  persistence: number;
  cooldownSec: number;
  sourceKinds: SourceKind[];
}

export const fetchWatches = (): Promise<Watch[]> => get('api/watches');
export const previewWatch = (prompt: string, exclude: string[]): Promise<WatchPreview> => post('api/watches/preview', { prompt, exclude });
export const createWatch = (input: WatchInput): Promise<Watch> => post('api/watches', input);
export const updateWatch = (
  id: string,
  patch: Partial<Pick<Watch, 'enabled' | 'threshold' | 'persistence' | 'cooldownSec' | 'severity'>>,
): Promise<Watch> => request('PATCH', `api/watches/${id}`, patch);
export async function deleteWatch(id: string): Promise<void> {
  await request<void>('DELETE', `api/watches/${id}`);
}
export const retrainWatch = (id: string): Promise<Watch> => post(`api/watches/${id}/retrain`);
export const resetWatch = (id: string): Promise<Watch> => post(`api/watches/${id}/reset`);
export const reviewAlert = (id: string, verdict: 'confirmed' | 'dismissed'): Promise<{ alert: Alert; watch: Watch | null }> =>
  post(`api/alerts/${id}/review`, { verdict });
export const setIncidentStatus = (id: string, status: Incident['status']): Promise<Incident> =>
  post(`api/incidents/${id}/status`, { status });

// ---------------------------------------------------------------- cases

export const fetchCases = (): Promise<CaseFile[]> => get('api/cases');
export const createCase = (title: string): Promise<CaseFile> => post('api/cases', { title });
export const addCaseItem = (
  caseId: string,
  item: { videoId: string; frameNumber: number; at: number; note: string; query: string | null; box: NormRect | null },
): Promise<CaseFile> => post(`api/cases/${caseId}/items`, item);
export const removeCaseItem = (caseId: string, itemId: string): Promise<CaseFile> =>
  request('DELETE', `api/cases/${caseId}/items/${itemId}`);
export const addCaseNote = (caseId: string, text: string): Promise<CaseFile> => post(`api/cases/${caseId}/notes`, { text });
export const sealCase = (caseId: string): Promise<CaseFile> => post(`api/cases/${caseId}/seal`);

// ---------------------------------------------------------------- ledger, metrics, federation, privacy

export function fetchLedger(options: { limit: number; before?: number; action?: string }): Promise<LedgerPage> {
  const params = new URLSearchParams({ limit: String(options.limit) });
  if (options.before !== undefined) params.set('before', String(options.before));
  if (options.action) params.set('action', options.action);
  return get(`api/ledger?${params.toString()}`);
}
export const verifyLedger = (): Promise<LedgerVerificationInfo> => post('api/ledger/verify');
export const sampleLedger = (n: number): Promise<{ population: number; entries: LedgerEntryInfo[] }> => get(`api/ledger/sample?n=${n}`);
export const fetchMetrics = (): Promise<Metrics> => get('api/metrics');
export const fetchPeers = (): Promise<PeerInfo[]> => get('api/peers');
export const requestUnmask = (input: {
  videoId: string;
  reason: string;
  approver: string;
  password: string;
}): Promise<{ grantId: string; videoId: string; expires: number }> => post('api/unmask', input);
