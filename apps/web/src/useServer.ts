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

/**
 * Keeps the app state in sync through the server-sent event stream.
 * High-frequency analysis events bypass React state and go to `live` subscribers.
 */
export function useServer(): ServerConnection {
  const [state, setState] = useState<AppState | null>(null);
  const [connected, setConnected] = useState(false);
  const [indexVersion, setIndexVersion] = useState(0);
  const listeners = useRef(new Set<LiveListener>());
  const statuses = useRef(new Map<string, VideoStatus>());
  const live = useRef<LiveFeed>({
    subscribe(listener) {
      listeners.current.add(listener);
      return () => listeners.current.delete(listener);
    },
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchState(controller.signal)
      .then((initial) => setState((current) => current ?? initial))
      .catch(() => undefined);

    const source = new EventSource('/api/events');
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (message: MessageEvent<string>) => {
      let event: ServerEvent;
      try {
        event = JSON.parse(message.data) as ServerEvent;
      } catch {
        return;
      }
      switch (event.type) {
        case 'state':
          statuses.current = new Map(event.state.videos.map((v) => [v.id, v.status]));
          setState(event.state);
          setIndexVersion((v) => v + 1);
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
          if (previousStatus !== video.status && (video.status === 'ready' || video.status === 'error')) {
            setIndexVersion((v) => v + 1);
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
          setState((current) =>
            current ? { ...current, videos: current.videos.filter((v) => v.id !== videoId), stats } : current,
          );
          setIndexVersion((v) => v + 1);
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
      controller.abort();
      source.close();
    };
  }, []);

  return { state, connected, indexVersion, live: live.current };
}
