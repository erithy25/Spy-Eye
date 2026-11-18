/**
 * The datasets of the node, shared by ORTUNG (the groups of the list) and MESSUNG (the groups of
 * the own truths). Kept outside React like the upload queue, so that both views show the same
 * names and a rename on one is seen on the other without a second request.
 */
import { useSyncExternalStore } from 'react';
import type { VideoInfo } from '../api';
import { ApiRequestError } from '../api';
import { fetchDatasets, type DatasetInfo, type Fix } from './api';

/** The upload inbox of every node; its recordings count as the own dataset "Eigene Aufnahmen". */
export const INBOX_ID = 'eingang';
/** The source of the shipped reference set, for nodes without the dataset list. */
export const REFERENCE_ID = 'referenz';

export interface DatasetState {
  /** The node's list; null until read or when the node has no dataset routes. */
  list: DatasetInfo[] | null;
  /** False on a node of an earlier version (no GET /api/datum/datasets): no create, rename or delete. */
  supported: boolean;
}

type Listener = () => void;

/** Changes of fixes and recordings are followed by one read once they pause this long. */
const SETTLE_MS = 1_500;

class DatasetStore {
  private state: DatasetState = { list: null, supported: true };
  private readonly listeners = new Set<Listener>();
  private timer: number | null = null;
  private running: Promise<void> | null = null;
  private again = false;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = (): DatasetState => this.state;

  private set(next: DatasetState): void {
    this.state = next;
    for (const l of this.listeners) l();
  }

  /** Reads the list now; a read asked for while one runs follows it. */
  refresh(): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = fetchDatasets()
      .then((list) => this.set({ list, supported: true }))
      .catch((err: unknown) => {
        // An earlier node has no such route: its recordings are grouped by their source instead.
        if (err instanceof ApiRequestError && err.status === 404) this.set({ list: null, supported: false });
      })
      .finally(() => {
        this.running = null;
        if (this.again) {
          this.again = false;
          void this.refresh();
        }
      });
    return this.running;
  }

  /** Reads the list once changes pause (a folder upload, a run of fixes). */
  refreshSoon(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, SETTLE_MS);
  }

  /** Takes an answer of the node (create, rename) into the list at once. */
  put(info: DatasetInfo): void {
    const list = this.state.list ?? [];
    const at = list.findIndex((d) => d.id === info.id);
    this.set({ ...this.state, list: at < 0 ? [...list, info] : list.map((d) => (d.id === info.id ? info : d)) });
  }

  drop(id: string): void {
    if (!this.state.list) return;
    this.set({ ...this.state, list: this.state.list.filter((d) => d.id !== id) });
  }
}

export const datasets = new DatasetStore();

export function useDatasets(): DatasetState {
  return useSyncExternalStore(datasets.subscribe, datasets.snapshot);
}

/** One group of the ORTUNG list: a dataset with its recordings. */
export interface DatasetGroup {
  id: string;
  name: string;
  /** The shipped reference set: no uploads into it; its deletion is guarded. */
  reference: boolean;
  /** Listed by the node, so it can be renamed and deleted (and uploaded into, unless reference). */
  managed: boolean;
  /** Takes uploads (an own dataset, the inbox included). */
  own: boolean;
  createdAt: number | null;
  videos: VideoInfo[];
  located: number;
}

/**
 * The dataset a recording belongs to: its source when the node lists it, else the dataset the fix
 * names (the node files recordings of a removed source under the inbox), else its source.
 */
export function datasetOf(video: VideoInfo, fix: Fix | undefined, known: ReadonlySet<string>): string {
  if (known.has(video.sourceId)) return video.sourceId;
  if (fix?.datasetId && known.has(fix.datasetId)) return fix.datasetId;
  return video.sourceId;
}

const byName = (a: VideoInfo, b: VideoInfo): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * The groups of the list: own datasets newest first, then the inbox, then the reference set;
 * recordings of a source the node does not list as a dataset come last, under the source's id.
 * Own recordings are listed newest first, the reference set by case name.
 */
export function groupRecordings(
  videos: VideoInfo[],
  byId: Map<string, Fix>,
  state: DatasetState,
  names: { pick: (de: string, en?: string | null) => string; t: (de: string) => string },
): DatasetGroup[] {
  const groups = new Map<string, DatasetGroup>();
  const list = state.list ?? [];
  for (const d of list) {
    groups.set(d.id, {
      id: d.id,
      name: names.pick(d.name, d.nameEn),
      reference: d.reference,
      managed: true,
      own: !d.reference,
      createdAt: d.createdAt,
      videos: [],
      located: 0,
    });
  }
  const known = new Set(groups.keys());
  for (const v of videos) {
    const fix = byId.get(v.id);
    const id = datasetOf(v, fix, known);
    let g = groups.get(id);
    if (!g) {
      // A node without the dataset list, or a source that is no dataset (live or exercise footage).
      const reference = id === REFERENCE_ID;
      const inbox = id === INBOX_ID;
      g = {
        id,
        name: reference ? names.t('Referenzbestand') : inbox ? names.t('Eigene Aufnahmen') : id,
        reference,
        managed: false,
        own: inbox,
        createdAt: null,
        videos: [],
        located: 0,
      };
      groups.set(id, g);
    }
    g.videos.push(v);
    if (fix?.location) g.located++;
  }
  const all = [...groups.values()];
  for (const g of all) {
    if (g.reference) g.videos.sort(byName);
    else g.videos.sort((a, b) => b.createdAt - a.createdAt);
  }
  const rank = (g: DatasetGroup): number => (g.reference ? 3 : g.id === INBOX_ID ? 2 : g.managed ? 1 : 4);
  return all.sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    // Own datasets newest first; one without a date after the dated ones.
    if (a.createdAt !== b.createdAt) return a.createdAt === null ? 1 : b.createdAt === null ? -1 : b.createdAt - a.createdAt;
    return a.name.localeCompare(b.name);
  });
}

/** A name for a new dataset that no listed dataset carries yet: "Name", else "Name (2)", "Name (3)" … */
export function freeName(base: string, list: DatasetInfo[] | null): string {
  const taken = new Set<string>();
  for (const d of list ?? []) {
    taken.add(d.name.toLocaleLowerCase('de-DE'));
    if (d.nameEn) taken.add(d.nameEn.toLocaleLowerCase('de-DE'));
  }
  if (!taken.has(base.toLocaleLowerCase('de-DE'))) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} (${i})`;
    if (!taken.has(candidate.toLocaleLowerCase('de-DE'))) return candidate;
  }
  return base;
}
