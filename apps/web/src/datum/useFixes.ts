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

/** All fixes of the node: the full list, kept current from the event stream and read again when announcements may have been missed. */
export function useFixes(node: NodeConnection): { fixes: Fix[]; byId: Map<string, Fix>; loading: boolean; error: string | null } {
  const [base, setBase] = useState<Base | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoCount = node.app?.videos.length ?? 0;
  const announced = useRef(node.fixes);
  announced.current = node.fixes;

  useEffect(() => {
    const ctrl = new AbortController();
    // Everything announced so far reached the console before this request left it.
    const seen = announced.current;
    fetchFixes(ctrl.signal)
      .then((list) => {
        setBase({ list, seen });
        setError(null);
      })
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      });
    return () => ctrl.abort();
  }, [videoCount, node.fixesEpoch]);

  return useMemo(() => {
    const byId = new Map<string, Fix>();
    for (const f of base?.list ?? []) byId.set(f.videoId, f);
    for (const f of Object.values(node.fixes)) {
      if (announcementWins(f, byId.get(f.videoId), base?.seen)) byId.set(f.videoId, f);
    }
    // Recordings that were removed meanwhile drop out.
    const known = new Set((node.app?.videos ?? []).map((v) => v.id));
    const fixes = [...byId.values()].filter((f) => known.size === 0 || known.has(f.videoId));
    return { fixes, byId, loading: base === null && error === null, error };
  }, [base, node.fixes, node.app?.videos, error]);
}

/**
 * The full fix with the steps its summary has announced since it was read. While a fix is computed,
 * every finished step is announced as a summary with the same status and computedAt, so the full fix
 * is not read again until the run ends; the summary's longer trace of the same run is shown instead.
 */
export function withLiveTrace(full: Fix, summary: Fix | undefined): Fix {
  if (!summary || summary.videoId !== full.videoId) return full;
  if (summary.status !== 'running' || full.status !== 'running' || summary.computedAt !== full.computedAt) return full;
  const trace = summary.trace;
  if (!trace || trace.length <= (full.trace?.length ?? 0)) return full;
  return { ...full, trace };
}

/** The full fix of one recording (with sun path and horizon profile), refreshed when its summary changes. */
export function useFullFix(videoId: string | null, summary: Fix | undefined): { fix: Fix | null; error: string | null } {
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stamp = summary ? `${summary.status}:${summary.computedAt}` : '';
  useEffect(() => {
    if (!videoId) {
      setFix(null);
      return;
    }
    const ctrl = new AbortController();
    fetchFix(videoId, ctrl.signal)
      .then((f) => {
        setFix(f);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      });
    return () => ctrl.abort();
  }, [videoId, stamp]);
  const current = fix && fix.videoId === videoId ? fix : null;
  const shown = useMemo(() => (current ? withLiveTrace(current, summary) : null), [current, summary]);
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
