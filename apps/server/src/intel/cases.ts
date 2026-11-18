import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { newId, readJson, writeFileAtomic } from '../core/json.js';
import { canonical } from '../core/ledger.js';
import { frameUrl, type Store } from '../store.js';
import type { CaseFile, CaseItem, NormRect, UserInfo } from '../types.js';
import type { Sources } from './sources.js';

/**
 * Case files ("Vorgänge"): evidence frames collected for one matter, with notes.
 *
 * Every frame is recorded with the SHA-256 of the picture as it was extracted at ingest, so a
 * later copy can be checked against the file. Sealing freezes the case and writes a hash of its
 * whole content to the ledger.
 */
export class Cases {
  private readonly cases = new Map<string, CaseFile>();

  constructor(
    private readonly dir: string,
    private readonly store: Store,
    private readonly sources: Sources,
  ) {}

  async open(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    for (const name of await fs.readdir(this.dir)) {
      if (!name.endsWith('.json')) continue;
      const file = await readJson<CaseFile | null>(path.join(this.dir, name), null);
      if (file) this.cases.set(file.id, file);
    }
  }

  list(): CaseFile[] {
    return [...this.cases.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): CaseFile | undefined {
    return this.cases.get(id);
  }

  private async save(file: CaseFile): Promise<void> {
    file.updatedAt = Date.now();
    await writeFileAtomic(path.join(this.dir, `${file.id}.json`), JSON.stringify(file));
  }

  async create(title: string, mandateId: string, user: UserInfo): Promise<CaseFile> {
    const now = Date.now();
    const file: CaseFile = {
      id: newId('vg'),
      title,
      mandateId,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
      items: [],
      notes: [],
      sealedAt: null,
      sealedBy: null,
      sealHash: null,
    };
    this.cases.set(file.id, file);
    await this.save(file);
    return file;
  }

  /** SHA-256 of the frame as extracted (before masking). */
  async frameDigest(videoId: string, frameNumber: number): Promise<string> {
    const bytes = await fs.readFile(await this.store.analysisFramePath(videoId, frameNumber));
    return createHash('sha256').update(bytes).digest('hex');
  }

  async addFrame(
    caseId: string,
    input: { videoId: string; frameNumber: number; at: number; note: string; query: string | null; box: NormRect | null },
    user: UserInfo,
  ): Promise<CaseItem | null> {
    const file = this.cases.get(caseId);
    if (!file || file.sealedAt !== null) return null;
    const entry = this.store.get(input.videoId);
    if (!entry || !entry.frames.some((f) => f.n === input.frameNumber)) return null;
    const existing = file.items.find((i) => i.videoId === input.videoId && i.frameNumber === input.frameNumber);
    if (existing) return existing;
    const source = this.sources.resolve(entry.info.sourceId);
    const item: CaseItem = {
      id: newId('ev'),
      videoId: input.videoId,
      frameNumber: input.frameNumber,
      frameUrl: frameUrl(input.videoId, input.frameNumber),
      sourceId: source.id,
      sourceName: source.name,
      at: input.at,
      note: input.note,
      sha256: await this.frameDigest(input.videoId, input.frameNumber),
      query: input.query,
      box: input.box,
      addedBy: user.id,
      addedAt: Date.now(),
    };
    file.items.push(item);
    await this.save(file);
    return item;
  }

  async removeItem(caseId: string, itemId: string): Promise<boolean> {
    const file = this.cases.get(caseId);
    if (!file || file.sealedAt !== null) return false;
    const before = file.items.length;
    file.items = file.items.filter((i) => i.id !== itemId);
    if (file.items.length === before) return false;
    await this.save(file);
    return true;
  }

  async addNote(caseId: string, text: string, user: UserInfo): Promise<CaseFile | null> {
    const file = this.cases.get(caseId);
    if (!file || file.sealedAt !== null) return null;
    file.notes.push({ id: newId('no'), text, by: user.id, at: Date.now() });
    await this.save(file);
    return file;
  }

  /** Hash over everything that makes up the case, independent of key order. */
  contentHash(file: CaseFile): string {
    return createHash('sha256')
      .update(canonical({ id: file.id, title: file.title, mandateId: file.mandateId, items: file.items, notes: file.notes }))
      .digest('hex');
  }

  async seal(caseId: string, user: UserInfo): Promise<CaseFile | null> {
    const file = this.cases.get(caseId);
    if (!file || file.sealedAt !== null) return null;
    file.sealHash = this.contentHash(file);
    file.sealedAt = Date.now();
    file.sealedBy = user.id;
    await this.save(file);
    return file;
  }
}
