import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Fix } from '../../server/src/datum/contract';
import {
  ApiRequestError,
  fetchIntel,
  fetchPublicInfo,
  fetchSession,
  fetchState,
  login,
  logout,
  type Alert,
  type AppState,
  type FrameEvent,
  type Incident,
  type IntelSnapshot,
  type PublicInfo,
  type SceneInfo,
  type ServerEvent,
  type SessionInfo,
  type VideoStatus,
  type Watch,
} from './api';

export type LiveListener = (event: { kind: 'frames'; frames: FrameEvent[] } | { kind: 'scene'; scene: SceneInfo }) => void;

export interface LiveFeed {
  subscribe(listener: LiveListener): () => void;
}

export interface NodeConnection {
  phase: 'loading' | 'unreachable' | 'signed-out' | 'ready';
  info: PublicInfo | null;
  session: SessionInfo | null;
  app: AppState | null;
  intel: IntelSnapshot | null;
  /** Latest head of the ledger as announced by the node. */
  ledger: { head: string; length: number } | null;
  connected: boolean;
  /** Increments whenever the searchable index changed in a way that warrants a refresh. */
  indexVersion: number;
  live: LiveFeed;
  /** DATUM fixes announced by the node since the console connected (summaries, by video id). */
  fixes: Record<string, Fix>;
  /**
   * Increments whenever announcements may have been missed, so the full list of fixes has to be
   * read again: the event stream (re)connected (the node replays no events), or the state was
   * polled because the stream is not getting through.
   */
  fixesEpoch: number;
  can: (permission: string) => boolean;
  signIn: (user: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setSession: (session: SessionInfo) => void;
  refreshIntel: () => void;
  applyIntel: (snapshot: IntelSnapshot) => void;
  patchAlert: (alert: Alert) => void;
  patchIncident: (incident: Incident) => void;
  patchWatch: (watch: Watch) => void;
}

/** The node pings every 5 s; a longer silence means the event stream is not getting through. */
const STREAM_SILENCE_MS = 12_000;
const POLL_INTERVAL_MS = 2_000;
/** While the stream is not getting through, the list of fixes is read at most this often. */
const FIXES_POLL_MS = 8_000;

function upsert<T extends { id: string }>(list: T[], item: T, front: boolean): T[] {
  const index = list.findIndex((x) => x.id === item.id);
  if (index < 0) return front ? [item, ...list] : [...list, item];
  const next = list.slice();
  next[index] = item;
  return next;
}

/**
 * Session and live state of the node this console talks to. State changes arrive through the
 * server-sent event stream; if a proxy buffers the stream, the state is polled instead.
 */
export function useNode(): NodeConnection {
  const [phase, setPhase] = useState<NodeConnection['phase']>('loading');
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [session, setSessionState] = useState<SessionInfo | null>(null);
  const [app, setApp] = useState<AppState | null>(null);
  const [intel, setIntel] = useState<IntelSnapshot | null>(null);
  const [ledger, setLedger] = useState<{ head: string; length: number } | null>(null);
  const [connected, setConnected] = useState(false);
  const [indexVersion, setIndexVersion] = useState(0);
  const [fixes, setFixes] = useState<Record<string, Fix>>({});
  const [fixesEpoch, setFixesEpoch] = useState(0);
  const listeners = useRef(new Set<LiveListener>());
  const statuses = useRef(new Map<string, VideoStatus>());
  const coarse = useRef(new Set<string>());
  const live = useRef<LiveFeed>({
    subscribe(listener) {
      listeners.current.add(listener);
      return () => listeners.current.delete(listener);
    },
  });

  // Who are we talking to, and is there a session already?
  useEffect(() => {
    let disposed = false;
    const boot = (): void => {
      fetchPublicInfo()
        .then(async (publicInfo) => {
          if (disposed) return;
          setInfo(publicInfo);
          try {
            const current = await fetchSession();
            if (disposed) return;
            setSessionState(current);
            setPhase('ready');
          } catch {
            if (!disposed) setPhase('signed-out');
          }
        })
        .catch(() => {
          if (disposed) return;
          setPhase('unreachable');
          window.setTimeout(boot, 2000);
        });
    };
    boot();
    return () => {
      disposed = true;
    };
  }, []);

  const signedIn = phase === 'ready';
  const mayReadIntel = session?.permissions.includes('media') === true;

  const refreshIntel = useCallback(() => {
    if (!mayReadIntel) return;
    fetchIntel()
      .then(setIntel)
      .catch(() => undefined);
  }, [mayReadIntel]);

  useEffect(() => {
    if (!signedIn) {
      setApp(null);
      setIntel(null);
      setLedger(null);
      // Announcements of an ended session must not outlive it (the node may have been restarted).
      setFixes({});
      return;
    }
    let lastStreamMessage = 0;
    let lastFixesPoll = 0;
    let disposed = false;

    // Many recordings change state at once (a whole first-pass batch); coalesce the refreshes.
    let bumpTimer: number | null = null;
    const bump = (): void => {
      if (bumpTimer !== null) return;
      bumpTimer = window.setTimeout(() => {
        bumpTimer = null;
        if (!disposed) setIndexVersion((v) => v + 1);
      }, 250);
    };

    const applySnapshot = (next: AppState): void => {
      const previous = statuses.current;
      const current = new Map(next.videos.map((v) => [v.id, v.status]));
      let changed = previous.size !== current.size;
      for (const [id, status] of current) {
        if (previous.get(id) !== status && (status === 'ready' || status === 'error' || !previous.has(id))) changed = true;
      }
      const coarseNow = new Set(next.videos.filter((v) => v.coarse).map((v) => v.id));
      for (const id of coarseNow) if (!coarse.current.has(id)) changed = true;
      coarse.current = coarseNow;
      statuses.current = current;
      setApp(next);
      if (changed) bump();
    };

    const poll = (withIntel: boolean, withFixes = false): void => {
      fetchState()
        .then((next) => {
          if (disposed) return;
          applySnapshot(next);
          setConnected(true);
          // Without the stream no fix is announced, so the list of fixes is read again; not with
          // every poll, though: the list is large (about 10 kB per recording) and the state
          // poll runs every two seconds.
          if (withFixes && Date.now() - lastFixesPoll >= FIXES_POLL_MS) {
            lastFixesPoll = Date.now();
            setFixesEpoch((n) => n + 1);
          }
        })
        .catch((err: unknown) => {
          if (disposed) return;
          if (err instanceof ApiRequestError && err.status === 401) {
            // The session ended (expired, or the node was restarted).
            setSessionState(null);
            setPhase('signed-out');
          } else if (Date.now() - lastStreamMessage > STREAM_SILENCE_MS) {
            setConnected(false);
          }
        });
      if (withIntel && mayReadIntel) {
        fetchIntel()
          .then((snapshot) => {
            if (!disposed) setIntel(snapshot);
          })
          .catch(() => undefined);
      }
    };
    poll(true);
    const pollTimer = window.setInterval(() => {
      if (Date.now() - lastStreamMessage > STREAM_SILENCE_MS) poll(true, true);
    }, POLL_INTERVAL_MS);

    // Events are applied in batches, once per animation frame: while recordings are uploaded and
    // located the node sends progress and every finished step of every fix, and applying each
    // on its own re-rendered the whole console dozens of times a second. React renders the
    // updates of one batch once. In a hidden tab, where frames do not run, a timer takes over.
    const pending: ServerEvent[] = [];
    let flushFrame: number | null = null;
    let flushTimer: number | null = null;

    const apply = (event: ServerEvent, fixPatch: Record<string, Fix>): void => {
      switch (event.type) {
        case 'ping':
          break;
        case 'state':
          applySnapshot(event.state);
          // The node sends the state only when a stream (re)connects and replays no events:
          // fixes announced while the console was not connected are only in the full list.
          setFixesEpoch((n) => n + 1);
          break;
        case 'model': {
          const model = event.model;
          setApp((current) => (current ? { ...current, model } : current));
          break;
        }
        case 'video': {
          const { video, stats, queueLength } = event;
          const previousStatus = statuses.current.get(video.id);
          statuses.current.set(video.id, video.status);
          const becameSearchable = video.coarse && !coarse.current.has(video.id);
          if (video.coarse) coarse.current.add(video.id);
          else coarse.current.delete(video.id);
          if (becameSearchable || (previousStatus !== video.status && (video.status === 'ready' || video.status === 'error'))) bump();
          setApp((current) => {
            if (!current) return current;
            const exists = current.videos.some((v) => v.id === video.id);
            const videos = exists ? current.videos.map((v) => (v.id === video.id ? video : v)) : [...current.videos, video];
            return { ...current, videos, stats, queueLength };
          });
          break;
        }
        case 'video-removed': {
          const { videoId, stats } = event;
          statuses.current.delete(videoId);
          coarse.current.delete(videoId);
          setApp((current) => (current ? { ...current, videos: current.videos.filter((v) => v.id !== videoId), stats } : current));
          bump();
          break;
        }
        case 'frames':
          for (const l of listeners.current) l({ kind: 'frames', frames: event.frames });
          break;
        case 'scene':
          for (const l of listeners.current) l({ kind: 'scene', scene: event.scene });
          break;
        case 'feeds': {
          const { feeds, scenario } = event;
          setIntel((current) => (current ? { ...current, feeds, scenario } : current));
          break;
        }
        case 'alert': {
          const { alert } = event;
          setIntel((current) => (current ? { ...current, alerts: upsert(current.alerts, alert, true) } : current));
          break;
        }
        case 'incident': {
          const { incident } = event;
          setIntel((current) => (current ? { ...current, incidents: upsert(current.incidents, incident, true) } : current));
          break;
        }
        case 'intel-reset':
          poll(true);
          break;
        case 'ledger':
          setLedger({ head: event.head, length: event.length });
          break;
        case 'datum-fix': {
          // Collected and applied once per batch: a running fix announces every step.
          fixPatch[event.fix.videoId] = event.fix;
          break;
        }
      }
    };

    const flush = (): void => {
      if (flushFrame !== null) cancelAnimationFrame(flushFrame);
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      flushFrame = null;
      flushTimer = null;
      if (disposed) return;
      const events = pending.splice(0);
      const fixPatch: Record<string, Fix> = {};
      for (const event of events) apply(event, fixPatch);
      if (Object.keys(fixPatch).length > 0) setFixes((current) => ({ ...current, ...fixPatch }));
    };

    const scheduleFlush = (): void => {
      if (flushFrame !== null || flushTimer !== null) return;
      if (document.hidden) flushTimer = window.setTimeout(flush, 250);
      else flushFrame = requestAnimationFrame(flush);
    };

    const source = new EventSource('api/events');
    source.onmessage = (message: MessageEvent<string>) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(message.data) as ServerEvent;
      } catch {
        return;
      }
      lastStreamMessage = Date.now();
      setConnected(true);
      if (event.type === 'ping') return;
      pending.push(event);
      scheduleFlush();
    };
    return () => {
      disposed = true;
      if (flushFrame !== null) cancelAnimationFrame(flushFrame);
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      if (bumpTimer !== null) window.clearTimeout(bumpTimer);
      window.clearInterval(pollTimer);
      source.close();
    };
  }, [signedIn, mayReadIntel]);

  const signIn = useCallback(async (user: string, password: string) => {
    const next = await login(user, password);
    setSessionState(next);
    setPhase('ready');
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      setSessionState(null);
      setPhase('signed-out');
    }
  }, []);

  const can = useCallback((permission: string) => session?.permissions.includes(permission) === true, [session]);

  return useMemo<NodeConnection>(
    () => ({
      phase,
      info,
      session,
      app,
      intel,
      ledger,
      connected,
      indexVersion,
      live: live.current,
      fixes,
      fixesEpoch,
      can,
      signIn,
      signOut,
      setSession: setSessionState,
      refreshIntel,
      applyIntel: setIntel,
      patchAlert: (alert) => setIntel((current) => (current ? { ...current, alerts: upsert(current.alerts, alert, true) } : current)),
      patchIncident: (incident) =>
        setIntel((current) => (current ? { ...current, incidents: upsert(current.incidents, incident, true) } : current)),
      patchWatch: (watch) => setIntel((current) => (current ? { ...current, watches: upsert(current.watches, watch, false) } : current)),
    }),
    [phase, info, session, app, intel, ledger, connected, indexVersion, fixes, fixesEpoch, can, signIn, signOut, refreshIntel],
  );
}
