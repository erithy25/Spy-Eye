import type { Fix, TerrainGrid } from '../../../server/src/datum/contract';

export type { Fix, TerrainGrid };

export interface DatumSummary {
  recordings: number;
  ready: number;
  pending: number;
  failed: number;
  withTruth: number;
  medianErrorKm: number | null;
  within: { km: number; share: number; count: number }[];
  insideRadius: number | null;
  medianRadiusKm: number | null;
  timeKnown: number;
  medianSeconds: number | null;
  evaluation: unknown;
  holdout: boolean;
}

export interface DatasetRow {
  index: number;
  name: string;
  label: string;
  country: string | null;
  lat: number;
  lon: number;
  source: string | null;
  license: string | null;
  videoId: string | null;
  errorKm: number | null;
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

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...(signal ? { signal } : {}) });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the status line
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

/** Server URLs in fixes may start with a slash; the console works under any path prefix. */
export function rel(url: string | null | undefined): string {
  if (!url) return '';
  return url.startsWith('/') ? url.slice(1) : url;
}

export const fetchFixes = (signal?: AbortSignal): Promise<Fix[]> => getJson('api/datum/fixes', signal);
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
export async function postTruth(entries: { name: string; lat: number; lon: number; label?: string }[]): Promise<TruthResult> {
  const response = await fetch('api/datum/truth', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entries }),
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // keep the status line
    }
    throw new Error(message);
  }
  return (await response.json()) as TruthResult;
}
