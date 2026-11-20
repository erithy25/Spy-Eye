/**
 * The order of the BEFUND evidence list (EvidenceList): groups of one kind, what decided the place
 * first. Pure, so that the server's tests can check it.
 */
import type { Evidence, EvidenceKind } from '../../../../server/src/datum/contract';

/**
 * Evidence kinds in the order the console lists groups of equal weight: what pins a place down
 * (metadata, a recognised landmark and the street-level pictures that refine it, the terrain
 * horizon) before what only narrows a region.
 */
export const KIND_ORDER: readonly EvidenceKind[] = ['metadata', 'segments', 'landmark', 'streetlevel', 'horizon', 'sun', 'worldmodel', 'region', 'season', 'text', 'filename'];

/** Position of a kind in KIND_ORDER; a kind of a newer engine that this console does not know goes last. */
export function kindRank(kind: string): number {
  const i = (KIND_ORDER as readonly string[]).indexOf(kind);
  return i < 0 ? KIND_ORDER.length : i;
}

export interface Group {
  kind: EvidenceKind;
  items: Evidence[];
  total: number;
}

/** Kinds that speak of the time of day, not of the place: listed after the place's evidence. */
const TIME_KINDS: ReadonlySet<string> = new Set<EvidenceKind>(['sun', 'season']);

export function groupEvidence(evidence: Evidence[], decided: EvidenceKind | null = null): Group[] {
  const groups = new Map<EvidenceKind, Group>();
  for (const item of evidence) {
    const group = groups.get(item.kind) ?? { kind: item.kind, items: [], total: 0 };
    group.items.push(item);
    group.total += item.weight;
    groups.set(item.kind, group);
  }
  for (const group of groups.values()) group.items.sort((a, b) => b.weight - a.weight);
  // What decided the fix first. Two exceptions lead: a weighed file tag (GPS, recording time) is
  // a fact of the file, and the stretches' entry says how the place above relates to the timeline
  // (which stretch it is, or why the whole file's answer stays above); that entry can carry no
  // weight, which would otherwise put it last. Then the method that decided the place (a
  // recognised landmark's reference pictures, whose weights are their shares among all the
  // gallery's neighbours and small even where they decided), then the other evidence of the place,
  // then that of the time (sun, season): weights of place and time are not on one scale. Within
  // these by weight, equal weight in the order of KIND_ORDER; groups without weight last.
  const head = (g: Group): number => {
    if (g.kind === 'segments') return 1;
    if (g.total <= 0.0001) return 6;
    if (g.kind === 'metadata') return 0;
    if (decided !== null && g.kind === decided) return 2;
    if (TIME_KINDS.has(g.kind)) return 4;
    return g.kind === 'filename' || g.kind === 'text' ? 5 : 3;
  };
  return [...groups.values()].sort((a, b) => head(a) - head(b) || b.total - a.total || kindRank(a.kind) - kindRank(b.kind));
}

