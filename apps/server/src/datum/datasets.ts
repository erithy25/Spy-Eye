/**
 * DATUM datasets: the sets of recordings an analyst brings into the node, names and deletes as a
 * whole. A dataset is an archive source of the platform (no live feed, not shared with peers);
 * its recordings are uploaded with POST /api/videos?source=<id>. The reference set is the source
 * (or sources) seeded from datasets/datum/seed.json; the upload inbox ('eingang') counts as the
 * own dataset "Eigene Aufnahmen" / "Own recordings" while it holds recordings.
 *
 *   GET    /api/datum/datasets       -> DatasetInfo[] (reference first, then oldest first)
 *   POST   /api/datum/datasets       { name } -> 201 DatasetInfo
 *   PATCH  /api/datum/datasets/:id   { name } -> DatasetInfo
 *   DELETE /api/datum/datasets/:id   -> DatasetDeleteResult
 *
 * Reading needs the right to see footage ('media'); creating, renaming and deleting the right to
 * bring footage in ('source.write'), as for POST /api/sources.
 */
import { setImmediate as nextTurn } from 'node:timers/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Permission } from '../core/auth.js';
import { readJson } from '../core/json.js';
import type { PlatformNode, RequestContext, SeedFile } from '../node.js';
import type { Sources } from '../intel/sources.js';
import { DEFAULT_SOURCE_ID } from '../store.js';
import type { SourceInfo } from '../types.js';
import { DATASET_DIR } from './dataset.js';
import { truthKey } from './truth.js';

type Need = (request: FastifyRequest, reply: FastifyReply, permission: Permission | null) => RequestContext | null;
type SendError = (reply: FastifyReply, status: number, message: string) => FastifyReply;

/** One dataset as the console lists it. */
export interface DatasetInfo {
  /** The id of its source; recordings carry it as `sourceId`, fixes of the list as `datasetId`. */
  id: string;
  name: string;
  /** English name, when there is one (the reference set, the own recordings of the inbox). */
  nameEn?: string;
  /** The DATUM reference set (videos with a known place, seeded from datasets/datum/seed.json). */
  reference: boolean;
  /** Recordings in the dataset. */
  recordings: number;
  /** Of these, the ones with a place: a ready fix with a location (quick or full stage). */
  located: number;
  /** When the dataset was created (epoch ms); null for sources stored without the time. */
  createdAt: number | null;
}

/**
 * What DELETE /api/datum/datasets/:id did. `deleted`: recordings deleted. `kept`: recordings a
 * case holds a frame from, which stay for as long as the case exists. `removed`: the dataset is
 * gone (nothing was kept), so it is no longer listed; the inbox stays as a source of the node but
 * is not listed while empty.
 */
export interface DatasetDeleteResult {
  deleted: number;
  kept: number;
  removed: boolean;
}

/** Names of the own recordings in the inbox, while it carries its seeded name. */
const OWN = { name: 'Eigene Aufnahmen', nameEn: 'Own recordings' } as const;
/** The name the inbox is created with (see Sources.open). */
const INBOX_NAME = 'Eingang';
const NAME_MIN = 2;
const NAME_MAX = 80;
/** Body limit of POST and PATCH: a name of at most 80 characters. */
const BODY_LIMIT = 4 * 1024;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;

/** The name of a dataset as given: no control characters, single spaces; null unless 2 to 80 characters. */
export function cleanDatasetName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(CONTROL, ' ').normalize('NFC').replace(/\s+/g, ' ').trim();
  return name.length >= NAME_MIN && name.length <= NAME_MAX ? name : null;
}

/**
 * The dataset a recording of this source belongs to: the source itself, or the inbox when the
 * source no longer exists (as Sources.resolve has it).
 */
export function datasetIdOf(sources: Sources, sourceId: string): string {
  return sources.get(sourceId) ? sourceId : DEFAULT_SOURCE_ID;
}

/** Whether a source is a dataset: an archive of uploaded recordings. */
function isDataset(source: SourceInfo | undefined): source is SourceInfo {
  return source !== undefined && source.mode === 'archive';
}

/** The ids of the sources a seed file brings; none when it cannot be read (asked again next time). */
const seeded = new Map<string, Promise<Set<string>>>();
function seedSourceIds(file: string): Promise<Set<string>> {
  let ids = seeded.get(file);
  if (!ids) {
    ids = readJson<SeedFile | null>(file, null).then(
      (seed) => new Set((seed?.sources ?? []).map((s) => s.id)),
      () => {
        seeded.delete(file);
        return new Set<string>();
      },
    );
    seeded.set(file, ids);
  }
  return ids;
}

/** What can be swapped in tests: the seed file that names the reference set. */
export interface DatasetRouteDeps {
  referenceSeed?: string;
}

export function registerDatasetRoutes(app: FastifyInstance, node: PlatformNode, need: Need, sendError: SendError, deps: DatasetRouteDeps = {}): void {
  const referenceSeed = deps.referenceSeed ?? path.join(DATASET_DIR, 'seed.json');
  /** Datasets being deleted right now: a second request for one of them is refused. */
  const deleting = new Set<string>();
  const say = (ctx: RequestContext, de: string, en: string): string => (ctx.lang === 'en' ? en : de);

  /** Display names of a source as a dataset. */
  const namesOf = (source: SourceInfo): { name: string; nameEn?: string } => {
    if (source.id === DEFAULT_SOURCE_ID && source.name === INBOX_NAME) return { ...OWN };
    return { name: source.name, ...(source.nameEn !== undefined ? { nameEn: source.nameEn } : {}) };
  };

  /** Counts of every dataset in one pass over the recordings and the fixes. */
  const counts = (): Map<string, { recordings: number; located: number }> => {
    const fixes = new Map(node.datum.list().map((f) => [f.videoId, f]));
    const out = new Map<string, { recordings: number; located: number }>();
    for (const entry of node.store.all()) {
      if (entry.info.scenario !== null) continue;
      const id = datasetIdOf(node.sources, entry.info.sourceId);
      const c = out.get(id) ?? { recordings: 0, located: 0 };
      c.recordings++;
      const fix = fixes.get(entry.info.id);
      if (fix?.status === 'ready' && fix.location) c.located++;
      out.set(id, c);
    }
    return out;
  };

  const infoOf = (source: SourceInfo, reference: Set<string>, count = counts().get(source.id)): DatasetInfo => ({
    id: source.id,
    ...namesOf(source),
    reference: reference.has(source.id),
    recordings: count?.recordings ?? 0,
    located: count?.located ?? 0,
    createdAt: typeof source.createdAt === 'number' ? source.createdAt : null,
  });

  /** Another dataset already carries this name (German or English, any letter case). */
  const nameTaken = (name: string, except: string | null): boolean => {
    const wanted = name.toLocaleLowerCase('de-DE');
    return node.sources.list().some((s) => {
      if (!isDataset(s) || s.id === except) return false;
      const n = namesOf(s);
      return n.name.toLocaleLowerCase('de-DE') === wanted || n.nameEn?.toLocaleLowerCase('de-DE') === wanted;
    });
  };

  const badName = (ctx: RequestContext): string =>
    say(ctx, `Der Name eines Datensatzes hat ${NAME_MIN} bis ${NAME_MAX} Zeichen.`, `The name of a dataset has ${NAME_MIN} to ${NAME_MAX} characters.`);
  const takenName = (ctx: RequestContext): string => say(ctx, 'Ein Datensatz dieses Namens besteht schon.', 'A dataset of this name exists already.');
  const notFound = (ctx: RequestContext): string => say(ctx, 'Datensatz nicht gefunden.', 'Dataset not found.');
  const nameFrom = (body: unknown): unknown => (body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>)['name'] : undefined);

  app.get('/api/datum/datasets', async (request, reply) => {
    if (!need(request, reply, 'media')) return reply;
    const reference = await seedSourceIds(referenceSeed);
    const all = counts();
    const list: DatasetInfo[] = [];
    for (const source of node.sources.list()) {
      if (!isDataset(source)) continue;
      const count = all.get(source.id);
      // The inbox is a dataset of its own only while it holds recordings.
      if (source.id === DEFAULT_SOURCE_ID && !count) continue;
      list.push(infoOf(source, reference, count));
    }
    // Sources come oldest first; the reference set leads.
    return list.sort((a, b) => Number(b.reference) - Number(a.reference));
  });

  app.post('/api/datum/datasets', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const ctx = need(request, reply, 'source.write');
    if (!ctx) return reply;
    const name = cleanDatasetName(nameFrom(request.body));
    if (name === null) return sendError(reply, 400, badName(ctx));
    if (nameTaken(name, null)) return sendError(reply, 409, takenName(ctx));
    const source = node.sources.create({ name, kind: 'upload', owner: '', description: '', lat: null, lon: null, mode: 'archive', shared: false });
    await node.record(ctx, 'datum.dataset.create', { de: `Datensatz „${name}“ angelegt`, en: `Dataset "${name}" created` }, { datasetId: source.id, name });
    return reply.code(201).send(infoOf(source, await seedSourceIds(referenceSeed)));
  });

  app.patch<{ Params: { id: string } }>('/api/datum/datasets/:id', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const ctx = need(request, reply, 'source.write');
    if (!ctx) return reply;
    const source = node.sources.get(request.params.id);
    if (!isDataset(source)) return sendError(reply, 404, notFound(ctx));
    const name = cleanDatasetName(nameFrom(request.body));
    if (name === null) return sendError(reply, 400, badName(ctx));
    const before = namesOf(source);
    if (name !== before.name && nameTaken(name, source.id)) return sendError(reply, 409, takenName(ctx));
    if (name !== before.name) {
      node.sources.rename(source.id, name);
      await node.record(
        ctx,
        'datum.dataset.rename',
        { de: `Datensatz „${before.name}“ in „${name}“ umbenannt`, en: `Dataset "${before.nameEn ?? before.name}" renamed to "${name}"` },
        { datasetId: source.id, name, previous: before.name },
      );
    }
    return infoOf(source, await seedSourceIds(referenceSeed));
  });

  /**
   * Deletes every recording of a dataset exactly as DELETE /api/videos/:id deletes one (see
   * PlatformNode.deleteRecording: exercise footage refused, recordings a case holds kept, ledger
   * entry first, analysis cancelled, files and DATUM fix removed), one after the other so the node
   * keeps answering meanwhile. The own ground truths given for these recordings go as well, unless
   * a recording of the same file name remains elsewhere. The dataset's source is removed when
   * nothing is left. The reference set may be deleted like any other: it is seeded once per data
   * directory (marker seeded.json) and does not come back by itself; only a fresh data directory,
   * or removing that marker, seeds it again.
   */
  app.delete<{ Params: { id: string } }>('/api/datum/datasets/:id', async (request, reply) => {
    const ctx = need(request, reply, 'source.write');
    if (!ctx) return reply;
    const id = request.params.id;
    const source = node.sources.get(id);
    if (!isDataset(source)) return sendError(reply, 404, notFound(ctx));
    if (deleting.has(id)) return sendError(reply, 409, say(ctx, 'Dieser Datensatz wird gerade gelöscht.', 'This dataset is being deleted already.'));
    deleting.add(id);
    try {
      const reference = (await seedSourceIds(referenceSeed)).has(id);
      const names = namesOf(source);
      const held = new Set<string>();
      for (const file of node.cases.list()) for (const item of file.items) held.add(item.videoId);
      const members = node.store.all().filter((e) => e.info.scenario === null && datasetIdOf(node.sources, e.info.sourceId) === id);
      const doomed = members.filter((e) => !held.has(e.info.id));
      let kept = members.length - doomed.length;
      // Own truths that only these recordings answer to.
      const doomedIds = new Set(doomed.map((e) => e.info.id));
      const others = new Set(node.store.all().filter((e) => !doomedIds.has(e.info.id)).map((e) => truthKey(e.info.name)));
      const truths = node.datum.truths;
      const truthNames = truths ? [...new Set(doomed.map((e) => e.info.name))].filter((n) => truths.lookup(n) && !others.has(truthKey(n))) : [];

      // One entry for the whole dataset, before anything is deleted; each recording gets its own.
      const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
      const what = { de: doomed.length === 0 ? 'leer' : count(doomed.length, 'Aufzeichnung', 'Aufzeichnungen'), en: doomed.length === 0 ? 'empty' : count(doomed.length, 'recording', 'recordings') };
      const keep = kept === 0 ? { de: '', en: '' } : { de: `; ${kept} ${kept === 1 ? 'bleibt' : 'bleiben'}, da ein Vorgang sie hält`, en: `; ${kept} kept, held by a case` };
      await node.record(
        ctx,
        'datum.dataset.delete',
        { de: `Datensatz „${names.name}“ gelöscht (${what.de}${keep.de})`, en: `Dataset "${names.nameEn ?? names.name}" deleted (${what.en}${keep.en})` },
        { datasetId: id, name: names.name, reference, recordings: doomed.length, kept, truths: truthNames.length },
      );

      let deleted = 0;
      for (const entry of doomed) {
        const result = await node.deleteRecording(ctx, entry.info.id, { datasetId: id });
        if ('deleted' in result) deleted++;
        // A case took a frame from it meanwhile; one deleted meanwhile is simply gone.
        else if (result.refused === 'held-by-case') kept++;
        await nextTurn();
      }

      if (truths && truthNames.length > 0) {
        // A recording of the same name may have arrived meanwhile: its truth stays.
        const left = new Set(node.store.all().map((e) => truthKey(e.info.name)));
        await truths.remove(truthNames.filter((n) => !left.has(truthKey(n))));
      }

      const empty = !node.store.all().some((e) => e.info.scenario === null && datasetIdOf(node.sources, e.info.sourceId) === id);
      // The inbox stays (every node has one); emptied, it is no longer listed as a dataset.
      const removed = empty && (id === DEFAULT_SOURCE_ID || node.sources.remove(id));
      const body: DatasetDeleteResult = { deleted, kept, removed };
      return body;
    } finally {
      deleting.delete(id);
    }
  });
}
