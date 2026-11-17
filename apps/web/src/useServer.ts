import { useEffect, useRef, useState } from 'react';
import {
  fetchState,
  type AppState,
  type FrameEvent,
  type SceneInfo,
  type ServerEvent,
  type VideoStatus,
} from './api';

export type LiveListener = (event: { kind: 'frames'; frames: FrameEvent[] } | { kind: 'scene'; scene: SceneInfo }) => void;

export interface LiveFeed {
  subscribe(listener: LiveListener): () => void;
}

export interface ServerConnection {
  state: AppState | null;
  connected: boolean;
  /** Increments whenever the searchable index changed in a way that warrants a refresh. */
  indexVersion: number;
  live: LiveFeed;
}

/** The server pings every 5 s; a longer silence means the event stream is not getting through. */
const STREAM_SILENCE_MS = 12_000;
const POLL_INTERVAL_MS = 2_000;

/**
 * Keeps the app state in sync through the server-sent event stream.
 * High-frequency analysis events bypass React state and go to `live` subscribers.
 * If the stream is blocked or buffered (some proxies do that), the state is polled instead.
 */
export function useServer(): ServerConnection {
  const [state, setState] = useState<AppState | null>(null);
  const [connected, setConnected] = useState(false);
  const [indexVersion, setIndexVersion] = useState(0);
  const listeners = useRef(new Set<LiveListener>());
  const statuses = useRef(new Map<string, VideoStatus>());
  const coarse = useRef(new Set<string>());
  const live = useRef<LiveFeed>({
    subscribe(listener) {
      listeners.current.add(listener);
      return () => listeners.current.delete(listener);
    },
  });

  useEffect(() => {
    let lastStreamMessage = 0;
    let disposed = false;

    // Many videos change state at once (a whole first-pass batch); coalesce the refreshes.
    let bumpTimer: number | null = null;
    const bump = (): void => {
      if (bumpTimer !== null) return;
      bumpTimer = window.setTimeout(() => {
        bumpTimer = null;
        if (!disposed) setIndexVersion((v) => v + 1);
      }, 250);
    };

    /** Replaces the whole state and reports index changes (used for snapshots and polling). */
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
      setState(next);
      if (changed) bump();
    };

    const poll = (): void => {
      fetchState()
        .then((next) => {
          if (disposed) return;
          applySnapshot(next);
          setConnected(true);
        })
        .catch(() => {
          if (!disposed && Date.now() - lastStreamMessage > STREAM_SILENCE_MS) setConnected(false);
        });
    };
    poll();
    const pollTimer = window.setInterval(() => {
      if (Date.now() - lastStreamMessage > STREAM_SILENCE_MS) poll();
    }, POLL_INTERVAL_MS);

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
      switch (event.type) {
        case 'ping':
          break;
        case 'state':
          applySnapshot(event.state);
          break;
        case 'model': {
          const model = event.model;
          setState((current) => (current ? { ...current, model } : current));
          break;
        }
        case 'video': {
          const { video, stats, queueLength } = event;
          const previousStatus = statuses.current.get(video.id);
          statuses.current.set(video.id, video.status);
          const becameSearchable = video.coarse && !coarse.current.has(video.id);
          if (video.coarse) coarse.current.add(video.id);
          else coarse.current.delete(video.id);
          if (becameSearchable || (previousStatus !== video.status && (video.status === 'ready' || video.status === 'error'))) {
            bump();
          }
          setState((current) => {
            if (!current) return current;
            const exists = current.videos.some((v) => v.id === video.id);
            const videos = exists
              ? current.videos.map((v) => (v.id === video.id ? video : v))
              : [...current.videos, video];
            return { ...current, videos, stats, queueLength };
          });
          break;
        }
        case 'video-removed': {
          const { videoId, stats } = event;
          statuses.current.delete(videoId);
          coarse.current.delete(videoId);
          setState((current) =>
            current ? { ...current, videos: current.videos.filter((v) => v.id !== videoId), stats } : current,
          );
          bump();
          break;
        }
        case 'frames':
          for (const l of listeners.current) l({ kind: 'frames', frames: event.frames });
          break;
        case 'scene':
          for (const l of listeners.current) l({ kind: 'scene', scene: event.scene });
          break;
      }
    };
    return () => {
      disposed = true;
      if (bumpTimer !== null) window.clearTimeout(bumpTimer);
      window.clearInterval(pollTimer);
      source.close();
    };
  }, []);

  return { state, connected, indexVersion, live: live.current };
}
