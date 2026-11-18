import type { DatumSettings, Fix, TerrainGrid } from '../../../server/src/datum/contract';
import { ApiRequestError } from '../api';

export type { DatumSettings, Fix, TerrainGrid };

/** Accuracy of the fixes against one set of truths. */
export interface TruthAccuracy {
  withTruth: number;
  medianErrorKm: number | null;
  within: { km: number; share: number; count: number }[];
  insideRadius: number | null;
}

export interface DatumSummary extends TruthAccuracy {
  recordings: number;
  ready: number;
  /** Ready fixes still at the quick stage (engine 6 on; absent on older nodes). */
  quick?: number;
  pending: number;
  failed: number;
  medianRadiusKm: number | null;
  timeKnown: number;
  medianSeconds: number | null;
  /** Accuracy split by where the truth comes from (engine 6 on; absent on older nodes). */
  bySource?: { referenz: TruthAccuracy; eigene: TruthAccuracy };
  /** Own truths stored on the node, matched to a recording or not (engine 6 on). */
  ownTruths?: number;
  evaluation: unknown;
  holdout: boolean;
}

export interface DatasetRow {
  index: number;
  /** 'referenz': the reference set; 'eigene': an own truth (POST /api/datum/truth). Absent on older nodes: reference. */
  kind?: 'referenz' | 'eigene';
  name: string;
  label: string;
  /** English name of a reference place; absent for own truths and on older nodes (label serves both). */
  labelEn?: string;
  country: string | null;
  lat: number;
  lon: number;
  source: string | null;
  license: string | null;
  videoId: string | null;
  errorKm: number | null;
  /** Stage of the fix the error belongs to; null without one (engine 6 on). */
  stage?: 'quick' | 'full' | null;
}

export interface CountryShape {
  iso: string;
  name_de: string;
  name_en: string;
  continent: string;
  centroid: [number, number];
  areaKm2: number;
  bbox: [number, number, number, number];
  polygons: [number, number][][];
}

/**
 * The error of a failed request: the node's message (in the session's language) and the status,
 * so that a caller can tell a route an older node does not have (404) from a refusal.
 */
async function failure(response: Response): Promise<ApiRequestError> {
  let message = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error !== '') message = body.error;
  } catch {
    // keep the status line
  }
  return new ApiRequestError(message, response.status);
}

async function getJson<T>(url: string, signal?: AbortSignal, cache?: RequestCache): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...(signal ? { signal } : {}), ...(cache ? { cache } : {}) });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

async function sendJson<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

/** Server URLs in fixes may start with a slash; the console works under any path prefix. */
export function rel(url: string | null | undefined): string {
  if (!url) return '';
  return url.startsWith('/') ? url.slice(1) : url;
}

/**
 * The list of fixes, slimmed (?slim=1: no evidence, trace, sun path or horizon profile, one
 * keyframe, the top five candidates and countries); the detail views read the full fix. An older
 * node ignores the parameter and sends the same shape in full. 'no-cache' keeps the browser's copy
 * but asks the node each time with its ETag, which answers 304 without a body when nothing changed.
 */
export const fetchFixes = (signal?: AbortSignal): Promise<Fix[]> => getJson('api/datum/fixes?slim=1', signal, 'no-cache');
export const fetchFix = (id: string, signal?: AbortSignal): Promise<Fix> => getJson(`api/datum/fix/${id}`, signal);
export const fetchSummary = (signal?: AbortSignal): Promise<DatumSummary> => getJson('api/datum/summary', signal);
export const fetchDataset = (signal?: AbortSignal): Promise<DatasetRow[]> => getJson('api/datum/dataset', signal);
export const fetchTerrain = (lat: number, lon: number, radiusKm: number, signal?: AbortSignal): Promise<TerrainGrid> =>
  getJson(`api/datum/terrain?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&radiusKm=${radiusKm}`, signal);

let countries: Promise<CountryShape[]> | null = null;
/** Country outlines shipped with the console (Natural Earth, public domain). */
export function fetchCountries(): Promise<CountryShape[]> {
  countries ??= getJson<CountryShape[]>('map/countries.json').catch(() => {
    countries = null;
    return [];
  });
  return countries;
}

export async function recompute(id: string): Promise<void> {
  const response = await fetch(`api/datum/fix/${id}/recompute`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

export interface TruthResult {
  /** Entries the node now holds from this list. */
  stored: number;
  /** Of these, how many name a recording already on the node (their fixes show the deviation at once). */
  matched: number;
}

/**
 * Gives the node the true places of own recordings (POST /api/datum/truth). They are compared with
 * the fixes on MESSUNG and never go into the localisation.
 */
export function postTruth(entries: { name: string; lat: number; lon: number; label?: string }[]): Promise<TruthResult> {
  return sendJson<TruthResult>('POST', 'api/datum/truth', { entries });
}

/**
 * A set of recordings as the node lists it (GET /api/datum/datasets): an archive source the
 * analyst uploads into, the seeded reference set, or the inbox ("Eigene Aufnahmen") while it holds
 * recordings. Mirrors DatasetInfo of the server (datum/datasets.ts), which is not imported here
 * because that module pulls in the server's routes.
 */
export interface DatasetInfo {
  id: string;
  name: string;
  nameEn?: string;
  reference: boolean;
  recordings: number;
  located: number;
  createdAt: number | null;
}

/** What deleting a dataset did: recordings deleted, recordings kept (a case holds them), dataset gone. */
export interface DatasetDeleteResult {
  deleted: number;
  kept: number;
  removed: boolean;
}

export const fetchDatasets = (signal?: AbortSignal): Promise<DatasetInfo[]> => getJson('api/datum/datasets', signal, 'no-store');
export const createDataset = (name: string): Promise<DatasetInfo> => sendJson('POST', 'api/datum/datasets', { name });
export const renameDataset = (id: string, name: string): Promise<DatasetInfo> => sendJson('PATCH', `api/datum/datasets/${encodeURIComponent(id)}`, { name });
export const deleteDataset = (id: string): Promise<DatasetDeleteResult> => sendJson('DELETE', `api/datum/datasets/${encodeURIComponent(id)}`);

/** The engine settings of the node (GET /api/datum/settings); never the Mapillary key itself. */
export const fetchSettings = (signal?: AbortSignal): Promise<DatumSettings> => getJson('api/datum/settings', signal, 'no-store');

/** Street-level comparison on or off; the supervisor only (permission datum.settings). */
export const putStreetLevel = (enabled: boolean): Promise<DatumSettings> => sendJson('PUT', 'api/datum/settings/streetlevel', { enabled });

/**
 * Stores a Mapillary key on the node, or removes the stored one with an empty string. The key goes
 * to the node only, in the body; the answer says whether one is stored, never which.
 */
export const putMapillaryKey = (key: string): Promise<DatumSettings> => sendJson('PUT', 'api/datum/settings/mapillary-key', { key });
