import { Collection, newId } from '../core/json.js';
import { DEFAULT_SOURCE_ID } from '../store.js';
import type { SourceInfo, SourceKind } from '../types.js';

/** Registry of the sensors and inboxes a node receives footage from. */
export class Sources {
  private readonly items: Collection<SourceInfo>;

  constructor(file: string) {
    this.items = new Collection<SourceInfo>(file);
  }

  async open(): Promise<void> {
    await this.items.load();
    if (!this.items.has(DEFAULT_SOURCE_ID)) {
      this.items.put({
        id: DEFAULT_SOURCE_ID,
        name: 'Eingang',
        nameEn: 'Inbox',
        kind: 'upload',
        owner: '',
        description: 'Hochgeladenes Material ohne Zuordnung zu einem Sensor.',
        lat: null,
        lon: null,
        mode: 'archive',
        shared: false,
        createdAt: Date.now(),
      });
    }
  }

  list(): SourceInfo[] {
    return this.items.all().sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name));
  }

  get(id: string): SourceInfo | undefined {
    return this.items.get(id);
  }

  /** Falls back to the upload inbox for recordings whose source no longer exists. */
  resolve(id: string): SourceInfo {
    return this.items.get(id) ?? (this.items.get(DEFAULT_SOURCE_ID) as SourceInfo);
  }

  create(input: {
    id?: string;
    name: string;
    nameEn?: string;
    kind: SourceKind;
    owner: string;
    description: string;
    lat: number | null;
    lon: number | null;
    mode: SourceInfo['mode'];
    shared: boolean;
  }): SourceInfo {
    const source: SourceInfo = {
      id: input.id ?? newId('src'),
      name: input.name,
      kind: input.kind,
      owner: input.owner,
      description: input.description,
      lat: input.lat,
      lon: input.lon,
      mode: input.mode,
      shared: input.shared,
      createdAt: Date.now(),
      ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
    };
    return this.items.put(source);
  }

  update(id: string, patch: Partial<Pick<SourceInfo, 'name' | 'kind' | 'owner' | 'description' | 'lat' | 'lon' | 'shared'>>): SourceInfo | null {
    const source = this.items.get(id);
    if (!source) return null;
    Object.assign(source, patch);
    this.items.touch();
    return source;
  }

  remove(id: string): boolean {
    if (id === DEFAULT_SOURCE_ID) return false;
    return this.items.delete(id);
  }

  /** Removes every source of the given mode (used when an exercise is uninstalled). */
  removeByMode(mode: SourceInfo['mode']): void {
    for (const source of this.items.all()) if (source.mode === mode) this.items.delete(source.id);
  }

  flush(): Promise<void> {
    return this.items.flush();
  }
}
