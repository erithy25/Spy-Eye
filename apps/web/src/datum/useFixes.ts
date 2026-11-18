import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeConnection } from '../useNode';
import { fetchFix, fetchFixes, type Fix } from './api';

/** The full list of fixes, with the announcements the console had received when it asked for it. */
interface Base {
  list: Fix[];
  seen: Record<string, Fix>;
}

/**
 * Whether an announced fix is newer than the one in the list. An announcement received before the
 * list was requested is older than the list or equal to it. A later one wins unless the list holds a
 * later computation: a recomputation is announced as running with the computedAt of the result it
 * replaces, so on equal computedAt the announcement wins.
 */
export function announcementWins(announced: Fix, listed: Fix | undefined, seen: Record<string, Fix> | undefined): boolean {
  if (!listed) return true;
  if (seen?.[announced.videoId] === announced) return false;
  return announced.computedAt >= listed.computedAt;
}

/** After recordings appeared, the list is read once they stop appearing for this long ... */
const LIST_SETTLE_MS = 1_500;
/** ... and not more often than this: a folder upload adds one recording after another. */
const LIST_SPACING_MS = 10_000;

/**
 * All fixes of the node: the slimmed list (see `fetchFixes`), kept current from the event stream
 * and read again when announcements may have been missed (the stream reconnected) and, as a
 * safety net, after new recordings appeared. In full the list was about 10 kB per recording;
 * reading it for every recording of a folder upload made the node serialise and the console parse
 * tens of megabytes. Slimmed it is a fraction of that, and an unchanged list costs a 304. New
 * recordings are announced through the stream anyway, so their read waits until the uploads settle.
 */
export function useFixes(node: NodeConnection): { fixes: Fix[]; byId: Map<string, Fix>; loading: boolean; error: string | null } {
  const [base, setBase] = useState<Base | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videos = node.app?.videos;
  const videoCount = videos?.length ?? 0;
  const announced = useRef(node.fixes);
  announced.current = node.fixes;
  const lastRead = useRef(0);
  const readEpoch = useRef<number | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    // A new epoch (first read, stream reconnected) is read at once; new recordings wait.
    const urgent = readEpoch.current !== node.fixesEpoch;
    const delay = urgent ? 0 : Math.max(LIST_SETTLE_MS, LIST_SPACING_MS - (Date.now() - lastRead.current));
    const timer = window.setTimeout(() => {
      // Everything announced so far reached the console before this request left it.
      const seen = announced.current;
      readEpoch.current = node.fixesEpoch;
      lastRead.current = Date.now();
      fetchFixes(ctrl.signal)
        .then((list) => {
          setBase({ list, seen });
          setError(null);
        })
        .catch((err: unknown) => {
          if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : String(err));
        });
    }, delay);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [videoCount, node.fixesEpoch]);

  // The set of recordings changes rarely; their progress changes often. Keying on the ids keeps
  // the list of fixes (and every view that renders it) still while recordings are analysed.
  const idsKey = useMemo(() => (videos ?? []).map((v) => v.id).join(','), [videos]);
  const known = useMemo(() => new Set(idsKey === '' ? [] : idsKey.split(',')), [idsKey]);

  return useMemo(() => {
    const byId = new Map<string, Fix>();
    for (const f of base?.list ?? []) byId.set(f.videoId, f);
    for (const f of Object.values(node.fixes)) {
      if (announcementWins(f, byId.get(f.videoId), base?.seen)) byId.set(f.videoId, f);
    }
    // Recordings that were removed meanwhile drop out.
    const fixes = [...byId.values()].filter((f) => known.size === 0 || known.has(f.videoId));
    return { fixes, byId, loading: base === null && error === null, error };
  }, [base, node.fixes, known, error]);
}

/**
 * What the console shows of one fix: the latest summary from the event stream with the two parts
 * only the full fix carries (the sun path and the horizon profile), as long as both belong to the
 * same computation. Steps of a running analysis, a ground truth added later and the stage arrive
 * with the summary and show at once, without reading the full fix again.
 */
export function withLiveSummary(full: Fix, summary: Fix | undefined): Fix {
  if (!summary || summary.videoId !== full.videoId || summary === full) return full;
  // A newer result (the full analysis after the quick fix, a recomputation) shows at once from
  // its summary; the sun path and horizon profile follow when its full fix has been read.
  if (summary.computedAt > full.computedAt) return summary;
  if (summary.computedAt !== full.computedAt) return full;
  // A slim entry of the list (GET /api/datum/fixes?slim=1) leaves out what only the detail views
  // show; for the same computation those parts come from the full fix. What a slim entry does
  // carry (status, ground truth, stage) is as current as the list.
  const { slim, ...live } = summary;
  const parts: Fix = slim
    ? {
        ...live,
        evidence: full.evidence,
        keyframes: full.keyframes,
        candidates: full.candidates,
        countries: full.countries,
        ...(full.trace ? { trace: full.trace } : {}),
      }
    : live;
  return {
    ...parts,
    sun: parts.sun ? { ...parts.sun, path: parts.sun.path.length > 0 ? parts.sun.path : (full.sun?.path ?? []) } : full.sun,
    horizon: parts.horizon ? { ...parts.horizon, profile: parts.horizon.profile ?? full.horizon?.profile ?? null } : full.horizon,
  };
}

/** Full fixes read before, by recording; switching between ORTUNG, BEFUND and RAUM reads none again. */
const fullCache = new Map<string, { key: string; fix: Fix }>();
const fullRequests = new Map<string, Promise<Fix>>();
const FULL_CACHE_SIZE = 40;

/** The computation a full fix belongs to: a new result (or one that became ready) is read anew. */
function fullKey(videoId: string, summary: Fix | undefined): string {
  return summary ? `${videoId}:${summary.computedAt}:${summary.status === 'ready' ? 'ready' : 'open'}` : `${videoId}:?`;
}

function readFull(videoId: string, key: string): Promise<Fix> {
  let request = fullRequests.get(key);
  if (!request) {
    // Not tied to one view: the request outlives a tab switch and the next view takes its result.
    request = fetchFix(videoId).then(
      (fix) => {
        fullRequests.delete(key);
        fullCache.delete(videoId);
        fullCache.set(videoId, { key, fix });
        while (fullCache.size > FULL_CACHE_SIZE) {
          const oldest = fullCache.keys().next().value;
          if (oldest === undefined) break;
          fullCache.delete(oldest);
        }
        return fix;
      },
      (err: unknown) => {
        fullRequests.delete(key);
        throw err;
      },
    );
    fullRequests.set(key, request);
  }
  return request;
}

/**
 * The full fix of one recording (with sun path and horizon profile), merged with its latest
 * summary. It is read once per computation and kept, so that the three views of a recording do
 * not each read it again; until a new computation has been read, the previous one stands.
 */
export function useFullFix(videoId: string | null, summary: Fix | undefined): { fix: Fix | null; error: string | null } {
  const key = videoId ? fullKey(videoId, summary) : '';
  const cached = videoId ? (fullCache.get(videoId) ?? null) : null;
  const [loaded, setLoaded] = useState<Fix | null>(cached?.fix ?? null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!videoId) return;
    if (fullCache.get(videoId)?.key === key) return;
    // A failure to read another recording (or an earlier result) does not hold for this one.
    setError(null);
    let live = true;
    readFull(videoId, key)
      .then((f) => {
        if (!live) return;
        setLoaded(f);
        setError(null);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      live = false;
    };
  }, [videoId, key]);
  // The cache may hold a newer read than this view's state (another view read it meanwhile).
  const candidate = cached && (!loaded || loaded.videoId !== videoId || cached.fix.computedAt >= loaded.computedAt) ? cached.fix : loaded;
  const current = candidate && candidate.videoId === videoId ? candidate : null;
  const shown = useMemo(() => (current ? withLiveSummary(current, summary) : null), [current, summary]);
  return { fix: shown, error };
}

/** Map zoom at which a circle of `radiusKm` fills about a third of a 1000 px wide view. */
export function zoomForRadius(radiusKm: number, lat: number): number {
  const mpp = (radiusKm * 1000) / 170;
  const z = Math.log2((156543.03 * Math.cos((lat * Math.PI) / 180)) / Math.max(1, mpp));
  return Math.max(1.2, Math.min(15, z));
}

export function minutesText(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Best clock window of a fix as "14:10–15:40", or null. */
export function bestWindowText(fix: Fix): string | null {
  const w = fix.time.windows[0];
  if (!w) return null;
  if (fix.time.method === 'metadata') return minutesText(w.startMin + (w.endMin - w.startMin) / 2);
  return `${minutesText(w.startMin)}–${minutesText(w.endMin)}`;
}

export function kmText(km: number, locale: string): string {
  if (km < 1) return `${Math.round(km * 1000).toLocaleString(locale)} m`;
  if (km < 10) return `${km.toLocaleString(locale, { maximumFractionDigits: 1 })} km`;
  return `${Math.round(km).toLocaleString(locale)} km`;
}
