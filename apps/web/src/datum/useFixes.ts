import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapView } from '../map/MapCanvas';
import type { NodeConnection } from '../useNode';
import type { TimeEstimate } from '../../../server/src/datum/contract';
import { fetchFix, fetchFixes, type Fix } from './api';
import { rivalWindow } from './panel/common';

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
        // The stretches of a recording of several places (the slim entry has only their summary).
        ...(full.segments ? { segments: full.segments } : {}),
      }
    : live;
  return {
    ...parts,
    sun: parts.sun ? { ...parts.sun, path: parts.sun.path.length > 0 ? parts.sun.path : (full.sun?.path ?? []) } : full.sun,
    horizon: parts.horizon ? { ...parts.horizon, profile: parts.horizon.profile ?? full.horizon?.profile ?? null } : full.horizon,
    // The stretches' sun paths, which the summaries leave out as the fix's own (same computation).
    ...(parts.segments && full.segments && parts.segments !== full.segments
      ? {
          segments: parts.segments.map((s, i) => {
            const path = full.segments?.[i]?.sun?.path;
            return s.sun && s.sun.path.length === 0 && path && full.segments?.[i]?.startSec === s.startSec ? { ...s, sun: { ...s.sun, path } } : s;
          }),
        }
      : {}),
  };
}

/** Best clock window of a time estimate as "14:10–15:40" (a time from the tags: "14:32"), or null. */
export function windowText(time: TimeEstimate): string | null {
  const w = time.windows[0];
  if (!w) return null;
  if (time.method === 'metadata') return minutesText(w.startMin + (w.endMin - w.startMin) / 2);
  return `${minutesText(w.startMin)}–${minutesText(w.endMin)}`;
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

/**
 * Whether a fix's first candidate is its own place (within 1 km): so for an answer of the pictures;
 * never where the file's GPS gave the place (method 'metadata'): the candidates are the pictures'
 * own answers, which the list offers to choose even where the first agrees with the position.
 */
export function firstCandidateIsFix(fix: Pick<Fix, 'location' | 'candidates'>): boolean {
  const loc = fix.location;
  const first = fix.candidates[0];
  if (!loc || !first || loc.method === 'metadata') return false;
  const r = Math.PI / 180;
  const x = Math.sin(((first.lat - loc.lat) * r) / 2) ** 2 + Math.cos(loc.lat * r) * Math.cos(first.lat * r) * Math.sin(((first.lon - loc.lon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(x))) < 1;
}

/**
 * The view of BEFUND's map for a fix without stretches: the fix's own place and radius, so that
 * its circle is in view (as ORTUNG shows it), or the candidate chosen in the list (`candidate`,
 * -1 for none); beyond `globeKm` the whole globe. zoomForRadius(r) - 0.6 puts r about 112 px from
 * the centre, inside the 280 px high map. Null without a place.
 */
export function fixMapView(fix: Pick<Fix, 'location' | 'candidates'>, candidate: number, globeKm: number): { lat: number; lon: number; zoom: number } | null {
  const focus = (candidate >= 0 ? fix.candidates[candidate] : undefined) ?? fix.location ?? fix.candidates[0] ?? null;
  if (!focus) return null;
  return { lat: focus.lat, lon: focus.lon, zoom: focus.radiusKm > globeKm ? 1.4 : zoomForRadius(Math.max(0.3, focus.radiusKm), focus.lat) - 0.6 };
}

/**
 * The map's right side the result card of the ORTUNG covers (CSS pixels): its width and its
 * distance from the right edge (datum.css .dt-hud: 312 + 64) and a gap.
 */
export const RESULT_CARD_PX = 312 + 64 + 16;

/**
 * The ORTUNG's view of a recording of several places (segments.ts routeFrame): all of them in the
 * area left of the result card (MapView.insetRight), around their middle; a route reaching farther
 * than 2 500 km shows the whole Earth there (`fit`, sized to that area; `worldZoom` until the map
 * has a size).
 */
export function routeMapView(frame: { lat: number; lon: number; reachKm: number }, worldZoom: number): MapView {
  return frame.reachKm > 2500
    ? { lat: frame.lat, lon: frame.lon, zoom: worldZoom, fit: true, insetRight: RESULT_CARD_PX }
    : { lat: frame.lat, lon: frame.lon, zoom: zoomForRadius(Math.max(5, frame.reachKm), frame.lat), reachKm: Math.max(5, frame.reachKm * 1.12), insetRight: RESULT_CARD_PX };
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
  return windowText(fix.time);
}

/**
 * The second clock window as "14:30–18:15" where it is as likely as the first and lies on the
 * other side of noon (rivalWindow), else null: said beside the first wherever the time is shown.
 */
export function rivalText(time: TimeEstimate): string | null {
  const w = rivalWindow(time);
  return w ? `${minutesText(w.startMin)}–${minutesText(w.endMin)}` : null;
}

/** The time of day in one line: "06:25–10:15 oder 14:30–18:15" for an even split, else the best window. */
export function windowsText(time: TimeEstimate, t: (de: string, vars?: Record<string, string | number>) => string): string | null {
  const best = windowText(time);
  const rival = rivalText(time);
  return best !== null && rival !== null ? t('{a} oder {b}', { a: best, b: rival }) : best;
}

/**
 * The name of the best window ("Morgen"), and with an even split the other one with its span:
 * "Morgen · oder 14:30–18:15 (Nachmittag)". '' without a window.
 */
export function windowLabelText(time: TimeEstimate, t: (de: string, vars?: Record<string, string | number>) => string): string {
  const first = time.windows[0];
  if (!first) return '';
  const rival = rivalWindow(time);
  const range = rivalText(time);
  return rival && range ? t('{a} · oder {range} ({b})', { a: t(first.label), b: t(rival.label), range }) : t(first.label);
}

export function kmText(km: number, locale: string): string {
  if (km < 1) return `${Math.round(km * 1000).toLocaleString(locale)} m`;
  if (km < 10) return `${km.toLocaleString(locale, { maximumFractionDigits: 1 })} km`;
  return `${Math.round(km).toLocaleString(locale)} km`;
}
