import type {
  ApiError,
  AppState,
  DetailLevel,
  ExplainResponse,
  MapResponse,
  SceneFramesResponse,
  SearchResponse,
  UploadResponse,
  VideoScenesResponse,
} from '../../server/src/types';

export type * from '../../server/src/types';

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function parseError(response: Response): Promise<ApiRequestError> {
  let message = `Anfrage fehlgeschlagen (HTTP ${response.status})`;
  try {
    const body = (await response.json()) as Partial<ApiError>;
    if (typeof body.error === 'string' && body.error !== '') message = body.error;
  } catch {
    // Response had no JSON body; keep the generic message.
  }
  return new ApiRequestError(message, response.status);
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, signal ? { signal } : {});
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiRequestError('Server nicht erreichbar.', 0);
  }
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

export function fetchState(signal?: AbortSignal): Promise<AppState> {
  return getJson<AppState>('/api/state', signal);
}

export function searchScenes(query: string, limit: number, signal?: AbortSignal): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return getJson<SearchResponse>(`/api/search?${params.toString()}`, signal);
}

export function explainFrame(
  videoId: string,
  frameNumber: number,
  query: string,
  signal?: AbortSignal,
): Promise<ExplainResponse> {
  const params = new URLSearchParams({ videoId, frame: String(frameNumber), q: query });
  return getJson<ExplainResponse>(`/api/explain?${params.toString()}`, signal);
}

export function fetchMap(signal?: AbortSignal): Promise<MapResponse> {
  return getJson<MapResponse>('/api/map', signal);
}

export function fetchVideoScenes(videoId: string, signal?: AbortSignal): Promise<VideoScenesResponse> {
  return getJson<VideoScenesResponse>(`/api/videos/${videoId}/scenes`, signal);
}

export function fetchSceneFrames(videoId: string, sceneIndex: number, signal?: AbortSignal): Promise<SceneFramesResponse> {
  return getJson<SceneFramesResponse>(`/api/videos/${videoId}/scenes/${sceneIndex}/frames`, signal);
}

export async function deleteVideo(videoId: string): Promise<void> {
  const response = await fetch(`/api/videos/${videoId}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw await parseError(response);
}

export async function retryVideo(videoId: string): Promise<void> {
  const response = await fetch(`/api/videos/${videoId}/retry`, { method: 'POST' });
  if (!response.ok) throw await parseError(response);
}

export interface UploadHandle {
  promise: Promise<UploadResponse>;
  abort(): void;
}

/** Uploads one file with progress reporting (XHR, because fetch has no upload progress). */
export function uploadVideo(
  file: File,
  options: { sampleFps: number; detail: DetailLevel },
  onProgress: (fraction: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadResponse>((resolve, reject) => {
    const params = new URLSearchParams({ fps: String(options.sampleFps), detail: options.detail });
    xhr.open('POST', `/api/videos?${params.toString()}`);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      const body = xhr.response as (Partial<UploadResponse> & Partial<ApiError>) | null;
      if (body && Array.isArray(body.accepted) && Array.isArray(body.rejected)) {
        resolve({ accepted: body.accepted, rejected: body.rejected });
      } else {
        reject(new ApiRequestError(body?.error ?? `Upload fehlgeschlagen (HTTP ${xhr.status})`, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiRequestError('Upload fehlgeschlagen: Server nicht erreichbar.', 0));
    xhr.onabort = () => reject(new ApiRequestError('Upload abgebrochen.', 0));
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}
