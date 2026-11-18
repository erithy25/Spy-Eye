import { Collection, newId } from '../core/json.js';
import { DEFAULT_SOURCE_ID } from '../store.js';
import type { SourceInfo, SourceKind } from '../types.js';

/** The upload inbox every node has, in both languages. */
const INBOX = {
  name: 'Eingang',
  nameEn: 'Inbox',
  description: 'Hochgeladenes Material ohne Zuordnung zu einem Sensor.',
  descriptionEn: 'Uploaded footage not assigned to a sensor.',
} as const;

/** Registry of the sensors and inboxes a node receives footage from. */
export class Sources {
  private readonly items: Collection<SourceInfo>;

  constructor(file: string) {
    this.items = new Collection<SourceInfo>(file);
  }

  async open(): Promise<void> {
    await this.items.load();
    const inbox = this.items.get(DEFAULT_SOURCE_ID);
    if (inbox) {
      // Stored before the English description existed: add it while the text is still the seeded one.
      this.addEnglish(DEFAULT_SOURCE_ID, INBOX);
    } else {
      this.items.put({
        id: DEFAULT_SOURCE_ID,
        name: INBOX.name,
        nameEn: INBOX.nameEn,
        kind: 'upload',
        owner: '',
        description: INBOX.description,
        descriptionEn: INBOX.descriptionEn,
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

  /**
   * Adds the English name and description of a seeded source stored before they existed. Only
   * missing fields are filled, and only while the German text is the seeded one: a source an
   * operator renamed or described anew keeps what they wrote.
   */
  addEnglish(id: string, seeded: { name: string; nameEn?: string; description: string; descriptionEn?: string }): void {
    const source = this.items.get(id);
    if (!source) return;
    let changed = false;
    if (source.nameEn === undefined && seeded.nameEn !== undefined && source.name === seeded.name) {
      source.nameEn = seeded.nameEn;
      changed = true;
    }
    if (source.descriptionEn === undefined && seeded.descriptionEn !== undefined && source.description === seeded.description) {
      source.descriptionEn = seeded.descriptionEn;
      changed = true;
    }
    if (changed) this.items.touch();
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
    descriptionEn?: string;
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
      ...(input.descriptionEn !== undefined ? { descriptionEn: input.descriptionEn } : {}),
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

  /** Gives a source a new name; an English name given with the old one no longer fits and goes. */
  rename(id: string, name: string): SourceInfo | null {
    const source = this.items.get(id);
    if (!source) return null;
    source.name = name;
    delete source.nameEn;
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
