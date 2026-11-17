import { useEffect, useRef, useState } from 'react';
import {
  explainFrame,
  fetchSceneFrames,
  type ExplainResponse,
  type NormRect,
  type SceneFrame,
  type SceneFramesResponse,
} from '../api';
import { formatScore, formatTime, pad } from '../format';

export interface ModalTarget {
  videoId: string;
  sceneIndex: number;
  frameNumber: number;
  frameUrl: string;
  time: number;
  /** Query that led here; enables the localisation overlay. */
  query: string | null;
  confidence: number | null;
  score: number | null;
  box: NormRect | null;
}

interface SceneModalProps {
  target: ModalTarget;
  onClose: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
}

/** Darkens everything the query does not respond to, so the match stays lit. */
function drawFocus(canvas: HTMLCanvasElement, explain: ExplainResponse): void {
  canvas.width = explain.cols;
  canvas.height = explain.rows;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const image = ctx.createImageData(explain.cols, explain.rows);
  for (let i = 0; i < explain.grid.length; i++) {
    const v = explain.grid[i] ?? 0;
    const lit = Math.min(1, Math.max(0, (v - 0.35) / 0.45));
    image.data[i * 4 + 3] = Math.round(255 * 0.82 * (1 - lit));
  }
  ctx.putImageData(image, 0, 0);
}

export function SceneModal({ target, onClose, onPrev, onNext }: SceneModalProps) {
  const [details, setDetails] = useState<SceneFramesResponse | null>(null);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [frame, setFrame] = useState<SceneFrame>({ frameNumber: target.frameNumber, time: target.time, url: target.frameUrl });
  const [explain, setExplain] = useState<ExplainResponse | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [showFocus, setShowFocus] = useState(true);
  const [mode, setMode] = useState<'frame' | 'video'>('frame');
  const [videoError, setVideoError] = useState(false);
  const focusCanvas = useRef<HTMLCanvasElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  // Reset when navigating to another result.
  useEffect(() => {
    setFrame({ frameNumber: target.frameNumber, time: target.time, url: target.frameUrl });
    setMode('frame');
    setVideoError(false);
    setDetails(null);
    setDetailsError(null);
    const controller = new AbortController();
    fetchSceneFrames(target.videoId, target.sceneIndex, controller.signal)
      .then(setDetails)
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setDetailsError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [target]);

  // Localize the query in the currently shown frame.
  useEffect(() => {
    setExplain(null);
    setExplainError(null);
    if (target.query === null) return;
    const controller = new AbortController();
    setExplaining(true);
    explainFrame(target.videoId, frame.frameNumber, target.query, controller.signal)
      .then((res) => {
        setExplain(res);
        setExplaining(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setExplainError(err instanceof Error ? err.message : String(err));
        setExplaining(false);
      });
    return () => controller.abort();
  }, [target.videoId, target.query, frame.frameNumber]);

  useEffect(() => {
    if (explain && focusCanvas.current) drawFocus(focusCanvas.current, explain);
  }, [explain, showFocus, mode]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowLeft' && onPrev) onPrev();
      else if (event.key === 'ArrowRight' && onNext) onNext();
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, onPrev, onNext]);

  const scene = details?.scene ?? null;
  const video = details?.video ?? null;
  const isOriginalFrame = frame.frameNumber === target.frameNumber;
  const box = explain ? explain.box : isOriginalFrame ? target.box : null;
  const canPlay = video?.playable === true && !videoError;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Szene" tabIndex={-1} ref={dialog}>
        <header className="sheet-head">
          <span className="sheet-title" title={video?.name ?? ''}>
            {video?.name ?? ''}
          </span>
          <span className="meta">
            SC {pad(target.sceneIndex + 1, 3)}
            {scene ? `  ${formatTime(scene.start)}–${formatTime(scene.end)}` : ''}
          </span>
          <span className="sheet-nav">
            <button type="button" className="text-btn" disabled={!onPrev} onClick={() => onPrev?.()} aria-label="Vorheriger Treffer">
              ←
            </button>
            <button type="button" className="text-btn" disabled={!onNext} onClick={() => onNext?.()} aria-label="Nächster Treffer">
              →
            </button>
            <button type="button" className="text-btn" onClick={onClose} aria-label="Schließen">
              esc
            </button>
          </span>
        </header>

        <div className="sheet-body">
          <div className="sheet-main">
            {mode === 'video' && scene ? (
              <video
                key={`${target.videoId}-${target.sceneIndex}`}
                className="player"
                src={`media/${target.videoId}/source#t=${Math.max(0, scene.start).toFixed(2)}`}
                controls
                autoPlay
                onError={() => {
                  setVideoError(true);
                  setMode('frame');
                }}
              />
            ) : (
              <div className="stage">
                <img src={frame.url} alt={`Frame bei ${formatTime(frame.time)}`} />
                {explain && showFocus && <canvas ref={focusCanvas} className="focus" aria-hidden="true" />}
                {box && (showFocus || !explain) && (
                  <div
                    className="reticle reticle-target"
                    style={{
                      left: `${box.x * 100}%`,
                      top: `${box.y * 100}%`,
                      width: `${box.w * 100}%`,
                      height: `${box.h * 100}%`,
                    }}
                  >
                    {target.query && <span className="reticle-label">{target.query}</span>}
                  </div>
                )}
                <div className="readout readout-tl">
                  T {formatTime(frame.time)}&nbsp;&nbsp;F {pad(frame.frameNumber, 5)}
                </div>
                {explaining && <div className="readout readout-bl">lokalisiere …</div>}
              </div>
            )}

            {details && details.frames.length > 1 && (
              <ul className="strip">
                {details.frames.map((f) => (
                  <li key={f.frameNumber}>
                    <button
                      type="button"
                      className={`strip-item strip-btn${f.frameNumber === frame.frameNumber && mode === 'frame' ? ' strip-on' : ''}`}
                      onClick={() => {
                        setFrame(f);
                        setMode('frame');
                      }}
                    >
                      <img src={f.url} alt="" loading="lazy" />
                      <span className="strip-line">
                        <span>{formatTime(f.time)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <aside className="sheet-side">
            <div className="actions">
              <button
                type="button"
                className="btn"
                disabled={!canPlay || !scene}
                onClick={() => setMode((m) => (m === 'video' ? 'frame' : 'video'))}
              >
                {mode === 'video' ? 'Frame' : 'Abspielen'}
              </button>
              {target.query !== null && (
                <button type="button" className="btn" disabled={mode === 'video' || !explain} onClick={() => setShowFocus((v) => !v)}>
                  {showFocus ? 'Fokus aus' : 'Fokus an'}
                </button>
              )}
            </div>
            {video && !canPlay && <p className="note">Der Browser kann dieses Format nicht abspielen. Die Frames der Szene stehen links.</p>}
            {detailsError && <p className="note">{detailsError}</p>}
            {explainError && <p className="note">{explainError}</p>}

            <dl className="kv">
              {target.query !== null && (
                <div>
                  <dt>Query</dt>
                  <dd>{target.query}</dd>
                </div>
              )}
              {target.confidence !== null && (
                <div>
                  <dt>Relevanz</dt>
                  <dd>{formatScore(target.confidence)}</dd>
                </div>
              )}
              {target.score !== null && (
                <div>
                  <dt>Cosine</dt>
                  <dd>{target.score.toFixed(4)}</dd>
                </div>
              )}
              {scene && (
                <div>
                  <dt>Frames</dt>
                  <dd>{scene.frameCount}</dd>
                </div>
              )}
            </dl>

            {scene && scene.tags.length > 0 && (
              <ul className="scores">
                {scene.tags.map((tag) => (
                  <li key={tag.label}>
                    <span className="scores-name">{tag.label}</span>
                    <span className="scores-bar">
                      <span style={{ width: `${Math.round(tag.p * 100)}%` }} />
                    </span>
                    <span className="scores-value">{tag.p.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
