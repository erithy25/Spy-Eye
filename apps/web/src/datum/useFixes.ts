import { useEffect, useMemo, useState } from 'react';
import type { NodeConnection } from '../useNode';
import { fetchFix, fetchFixes, type Fix } from './api';

/** All fixes of the node: loaded once, then kept current from the event stream. */
export function useFixes(node: NodeConnection): { fixes: Fix[]; byId: Map<string, Fix>; loading: boolean; error: string | null } {
  const [base, setBase] = useState<Fix[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoCount = node.app?.videos.length ?? 0;

  useEffect(() => {
    const ctrl = new AbortController();
    fetchFixes(ctrl.signal)
      .then((list) => {
        setBase(list);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      });
    return () => ctrl.abort();
  }, [videoCount]);

  return useMemo(() => {
    const byId = new Map<string, Fix>();
    for (const f of base ?? []) byId.set(f.videoId, f);
    for (const f of Object.values(node.fixes)) byId.set(f.videoId, f);
    // Recordings that were removed meanwhile drop out.
    const known = new Set((node.app?.videos ?? []).map((v) => v.id));
    const fixes = [...byId.values()].filter((f) => known.size === 0 || known.has(f.videoId));
    return { fixes, byId, loading: base === null && error === null, error };
  }, [base, node.fixes, node.app?.videos, error]);
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
  return { fix: fix && fix.videoId === videoId ? fix : null, error };
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
