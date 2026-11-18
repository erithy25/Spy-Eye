import { useEffect, useRef, useState } from 'react';
import type { FrameEvent, SceneInfo, VideoInfo } from '../api';
import { formatDecimal, formatTime, pad } from '../format';
import { useLang } from '../i18n';
import type { LiveFeed } from '../useNode';

interface LiveAnalysisProps {
  live: LiveFeed;
  videos: VideoInfo[];
}

const HISTORY = 200;
const MAX_SCENES = 16;
const FRAME_INTERVAL_MS = 110;

function setupCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

/** Frame-to-frame distance as bars, scene cuts as full-height hairlines. */
function drawSignal(canvas: HTMLCanvasElement, history: FrameEvent[]): void {
  const setup = setupCanvas(canvas);
  if (!setup) return;
  const { ctx, width, height } = setup;
  const maxValue = 0.7;
  const step = width / HISTORY;
  const y = (v: number): number => height - (Math.min(v, maxValue) / maxValue) * (height - 2);
  const offset = HISTORY - history.length;

  history.forEach((frame, i) => {
    const x = Math.round((offset + i) * step);
    if (frame.skipped) {
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(x, height - 1, Math.max(1, step - 1), 1);
      return;
    }
    if (frame.cut) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, 0, 1, height);
    }
    const top = y(frame.distance);
    ctx.fillStyle = '#6b6b6b';
    ctx.fillRect(x, top, Math.max(1, step - 1), height - top);
  });

  ctx.strokeStyle = '#cfcfcf';
  ctx.lineWidth = 1;
  ctx.beginPath();
  let started = false;
  history.forEach((frame, i) => {
    if (frame.skipped) return;
    const x = (offset + i + 0.5) * step;
    if (started) ctx.lineTo(x, y(frame.drift));
    else ctx.moveTo(x, y(frame.drift));
    started = true;
  });
  ctx.stroke();
}

function drawFingerprint(canvas: HTMLCanvasElement, values: number[]): void {
  const setup = setupCanvas(canvas);
  if (!setup || values.length === 0) return;
  const { ctx, width, height } = setup;
  const step = width / values.length;
  const mid = Math.round(height / 2);
  values.forEach((v, i) => {
    const magnitude = Math.max(1, Math.abs(v) * (mid - 1));
    ctx.fillStyle = v >= 0 ? '#e8e8e8' : '#5a5a5a';
    ctx.fillRect(Math.round(i * step), v >= 0 ? mid - magnitude : mid, Math.max(1, Math.floor(step) - 1), magnitude);
  });
}

export function LiveAnalysis({ live, videos }: LiveAnalysisProps) {
  const { t } = useLang();
  const [current, setCurrent] = useState<FrameEvent | null>(null);
  const [scenes, setScenes] = useState<SceneInfo[]>([]);
  const [tick, setTick] = useState(0);
  const pending = useRef<FrameEvent[]>([]);
  const history = useRef<FrameEvent[]>([]);
  const signalCanvas = useRef<HTMLCanvasElement>(null);
  const fingerprintCanvas = useRef<HTMLCanvasElement>(null);

  const processing = videos.find((v) => v.status === 'processing') ?? null;

  useEffect(() => {
    const unsubscribe = live.subscribe((event) => {
      if (event.kind === 'frames') {
        pending.current.push(...event.frames);
      } else {
        setScenes((list) => [event.scene, ...list.filter((s) => s.id !== event.scene.id)].slice(0, MAX_SCENES));
      }
    });
    // Frames arrive in bursts (one per inference batch); play them back at a steady pace.
    const timer = window.setInterval(() => {
      const queue = pending.current;
      if (queue.length === 0) return;
      const batch = queue.splice(0, queue.length > 60 ? queue.length - 20 : 1);
      let lastShown: FrameEvent | null = null;
      for (const frame of batch) {
        history.current.push(frame);
        if (!frame.skipped) lastShown = frame;
      }
      if (history.current.length > HISTORY) history.current.splice(0, history.current.length - HISTORY);
      if (lastShown) setCurrent(lastShown);
      setTick((t) => t + 1);
    }, FRAME_INTERVAL_MS);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [live]);

  // Start with a clean signal when the next video begins.
  const currentVideoId = current?.videoId ?? null;
  const processingId = processing?.id ?? null;
  useEffect(() => {
    if (processingId !== null && currentVideoId !== null && processingId !== currentVideoId) history.current = [];
  }, [processingId, currentVideoId]);

  useEffect(() => {
    if (signalCanvas.current) drawSignal(signalCanvas.current, history.current);
  }, [tick]);

  useEffect(() => {
    if (fingerprintCanvas.current) drawFingerprint(fingerprintCanvas.current, current?.fingerprint ?? []);
  }, [current]);

  if (!processing && !current) return null;

  const video = videos.find((v) => v.id === (current?.videoId ?? processing?.id)) ?? processing;
  const active = processing !== null;

  return (
    <section className="section">
      <header className="section-head">
        <h2 className="label">
          {t('Auswertung')}
          {active && <i className="blink" aria-hidden="true" />}
        </h2>
        <span className="meta">
          {video?.name}
          {active && processing ? `  ${pad(Math.round(processing.progress * 100), 2)} %` : `  ${t('abgeschlossen')}`}
        </span>
      </header>

      <div className="live">
        <div className="stage">
          {current ? (
            <>
              <img src={current.url} alt="" />
              <div className="stage-layer" key={current.frameNumber} aria-hidden="true">
                {current.tiles.slice(1).map((tile, i) => (
                  <div
                    key={i}
                    className="reticle reticle-scan"
                    style={{
                      left: `${tile.x * 100}%`,
                      top: `${tile.y * 100}%`,
                      width: `${tile.w * 100}%`,
                      height: `${tile.h * 100}%`,
                      animationDelay: `${i * 50}ms`,
                    }}
                  />
                ))}
              </div>
              {active && <div className="sweep" aria-hidden="true" />}
              <div className="readout readout-tl">
                T {formatTime(current.time)}&nbsp;&nbsp;F {pad(current.frameNumber, 5)}&nbsp;&nbsp;SC {pad(current.sceneIndex + 1, 3)}
              </div>
              <div className="readout readout-bl">{current.msPerFrame} ms</div>
              {current.cut && (
                <div className="readout readout-tr cut" key={`cut-${current.frameNumber}`}>
                  CUT
                </div>
              )}
            </>
          ) : (
            <div className="stage-wait">{t('warte auf Bilder')}</div>
          )}
        </div>

        <div className="live-side">
          <ul className="scores">
            {(current?.tags ?? []).map((tag) => (
              <li key={tag.label}>
                <span className="scores-name">{tag.label}</span>
                <span className="scores-bar">
                  <span style={{ width: `${Math.round(tag.p * 100)}%` }} />
                </span>
                <span className="scores-value">{formatDecimal(tag.p, 2)}</span>
              </li>
            ))}
          </ul>
          <canvas ref={fingerprintCanvas} className="fingerprint" title="Embedding des Frames (erste 64 Dimensionen)" />
        </div>
      </div>

      <canvas
        ref={signalCanvas}
        className="signal"
        title="Distanz zum vorherigen Frame (Balken), Drift zum Szenenzentrum (Linie), Schnitte (weiße Linien)"
      />

      {scenes.length > 0 && (
        <ul className="strip">
          {scenes.map((scene) => (
            <li key={scene.id} className="strip-item">
              <img src={scene.keyframeUrl} alt="" loading="lazy" />
              <span className="strip-line">
                <span>{formatTime(scene.start)}</span>
                <span className="strip-tag">{scene.tags[0]?.label ?? ''}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
