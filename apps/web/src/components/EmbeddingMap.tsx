import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { fetchMap, type MapPoint, type MapResponse, type VideoInfo } from '../api';
import { formatScore, formatTime } from '../format';

interface EmbeddingMapProps {
  videos: VideoInfo[];
  modelReady: boolean;
  /** Changes whenever the index changed and the projection should be refetched. */
  refreshKey: number;
  /** Per-scene relevance of the active query; null when no search is active. */
  sceneScores: Record<string, number> | null;
  onOpen: (point: MapPoint) => void;
}

const HEIGHT = 340;
const PADDING = 22;

interface Projected {
  point: MapPoint;
  px: number;
  py: number;
}

function grey(level: number): string {
  const v = Math.round(Math.max(0, Math.min(1, level)) * 255);
  return `rgb(${v},${v},${v})`;
}

export function EmbeddingMap({ videos, modelReady, refreshKey, sceneScores, onOpen }: EmbeddingMapProps) {
  const [data, setData] = useState<MapResponse | null>(null);
  const [hover, setHover] = useState<Projected | null>(null);
  const [width, setWidth] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);

  const hasScenes = useMemo(() => videos.some((v) => v.sceneCount > 0), [videos]);
  const videoNames = useMemo(() => new Map(videos.map((v) => [v.id, v.name])), [videos]);

  useEffect(() => {
    if (!modelReady || !hasScenes) {
      setData(null);
      return;
    }
    const controller = new AbortController();
    fetchMap(controller.signal)
      .then(setData)
      .catch(() => undefined);
    return () => controller.abort();
  }, [modelReady, hasScenes, refreshKey]);

  const visible = data !== null && data.points.length > 1;

  useEffect(() => {
    const el = wrapper.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    setWidth(Math.floor(el.clientWidth));
    return () => observer.disconnect();
  }, [visible]);

  const projected = useMemo<Projected[]>(() => {
    if (!data || width === 0) return [];
    const w = width - PADDING * 2;
    const h = HEIGHT - PADDING * 2;
    return data.points.map((point) => ({
      point,
      px: PADDING + ((point.x + 1) / 2) * w,
      py: PADDING + ((1 - point.y) / 2) * h,
    }));
  }, [data, width]);

  useEffect(() => {
    const el = canvas.current;
    if (!el || width === 0) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(width * dpr);
    el.height = Math.round(HEIGHT * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    // Axis ticks along the frame instead of a full grid.
    ctx.fillStyle = '#3a3a3a';
    for (let x = 0; x <= width; x += 40) ctx.fillRect(Math.round(x), HEIGHT - 4, 1, 4);
    for (let y = 0; y <= HEIGHT; y += 40) ctx.fillRect(0, Math.round(y), 4, 1);

    if (hover) {
      ctx.fillStyle = '#2e2e2e';
      ctx.fillRect(0, Math.round(hover.py), width, 1);
      ctx.fillRect(Math.round(hover.px), 0, 1, HEIGHT);
    }

    const ordered = sceneScores
      ? [...projected].sort((a, b) => (sceneScores[a.point.sceneId] ?? 0) - (sceneScores[b.point.sceneId] ?? 0))
      : projected;
    for (const p of ordered) {
      const score = sceneScores ? (sceneScores[p.point.sceneId] ?? 0) : null;
      const hit = score !== null && score >= 0.5;
      ctx.beginPath();
      ctx.arc(p.px, p.py, score === null ? 2 : 1.5 + score * 3, 0, Math.PI * 2);
      ctx.fillStyle = score === null ? '#9a9a9a' : grey(0.22 + score * 0.78);
      ctx.fill();
      if (hit) {
        ctx.beginPath();
        ctx.arc(p.px, p.py, 8, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    if (hover) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(hover.px) - 6.5, Math.round(hover.py) - 6.5, 13, 13);
    }
  }, [projected, sceneScores, hover, width]);

  const nearest = useCallback(
    (event: MouseEvent<HTMLCanvasElement>): Projected | null => {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      let best: Projected | null = null;
      let bestDist = 16 * 16;
      for (const p of projected) {
        const d = (p.px - x) ** 2 + (p.py - y) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = p;
        }
      }
      return best;
    },
    [projected],
  );

  if (!visible || !data) return null;

  return (
    <section className="section">
      <header className="section-head">
        <h2 className="label">
          Raum <span className="count">{data.points.length}</span>
        </h2>
        <span className="meta">
          {hover
            ? `x ${hover.point.x.toFixed(3)}  y ${hover.point.y.toFixed(3)}`
            : `pca · ${Math.round(data.explainedVariance * 100)} % varianz`}
        </span>
      </header>
      <div className="map" ref={wrapper}>
        <canvas
          ref={canvas}
          style={{ width: '100%', height: HEIGHT, cursor: hover ? 'pointer' : 'crosshair' }}
          onMouseMove={(e) => setHover(nearest(e))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            const p = nearest(e);
            if (p) onOpen(p.point);
          }}
        />
        {hover && (
          <div
            className="probe"
            style={{
              left: Math.min(Math.max(0, hover.px + 16), Math.max(0, width - 180)),
              top: hover.py > HEIGHT / 2 ? hover.py - 136 : hover.py + 16,
            }}
          >
            <img src={hover.point.keyframeUrl} alt="" />
            <span className="probe-line">
              <span className="probe-name">{videoNames.get(hover.point.videoId) ?? ''}</span>
              <span>{formatTime(hover.point.time)}</span>
            </span>
            <span className="probe-line probe-dim">
              <span className="probe-name">{hover.point.label}</span>
              {sceneScores && <span>{formatScore(sceneScores[hover.point.sceneId] ?? 0)}</span>}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
