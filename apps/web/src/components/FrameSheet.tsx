import { useEffect, useRef, useState } from 'react';
import {
  addCaseItem,
  createCase,
  explainFrame,
  fetchCases,
  fetchSceneFrames,
  requestUnmask,
  reviewAlert,
  type Alert,
  type CaseFile,
  type ExplainResponse,
  type NormRect,
  type SceneFrame,
  type SceneFramesResponse,
} from '../api';
import { formatClock, formatDecimal, formatScore, formatTime, pad } from '../format';
import { useLang } from '../i18n';
import { toMgrs } from '../map/geo';
import { Dialog, Field, Sev, useAction, useStageRatio } from '../ui';
import type { NodeConnection } from '../useNode';
import { tagLabel } from '../tags';

const HAZARD_NAMES: Record<string, string> = { flood: 'Überflutung', fire: 'Brand', collapse: 'Einsturz', normal: 'Unauffällig' };

export interface FrameTarget {
  videoId: string;
  frameNumber: number;
  frameUrl: string;
  /** Seconds into the recording; null when unknown (alerts). */
  time: number | null;
  sceneIndex: number | null;
  /** Wall-clock time of the frame (epoch ms). */
  at: number | null;
  sourceName: string | null;
  lat: number | null;
  lon: number | null;
  /** Query that led here; enables the localisation overlay. */
  query: string | null;
  confidence: number | null;
  score: number | null;
  box: NormRect | null;
  alert: Alert | null;
}

interface FrameSheetProps {
  target: FrameTarget;
  node: NodeConnection;
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

export function FrameSheet({ target, node, onClose, onPrev, onNext }: FrameSheetProps) {
  const { t, pick, locale, lang, n } = useLang();
  const [stageStyle, onStageLoad] = useStageRatio();
  const [details, setDetails] = useState<SceneFramesResponse | null>(null);
  const [frame, setFrame] = useState<SceneFrame>({ frameNumber: target.frameNumber, time: target.time ?? 0, url: target.frameUrl });
  const [explain, setExplain] = useState<ExplainResponse | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [showFocus, setShowFocus] = useState(true);
  const [mode, setMode] = useState<'frame' | 'video'>('frame');
  const [videoError, setVideoError] = useState(false);
  const [alert, setAlert] = useState<Alert | null>(target.alert);
  const [grantUntil, setGrantUntil] = useState<number | null>(null);
  const [dialog, setDialog] = useState<'case' | 'unmask' | null>(null);
  const [filed, setFiled] = useState<string | null>(null);
  const focusCanvas = useRef<HTMLCanvasElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const review = useAction();

  const video = details?.video ?? node.app?.videos.find((v) => v.id === target.videoId) ?? null;
  const masked = (video?.facesMasked ?? 0) > 0;
  /** Only a recording that has been analysed in full is known to be free of faces. */
  const checked = video !== null && video.status === 'ready' && !video.coarse;
  const unmasked = grantUntil !== null && grantUntil > Date.now();

  // Reset when navigating to another frame.
  useEffect(() => {
    setFrame({ frameNumber: target.frameNumber, time: target.time ?? 0, url: target.frameUrl });
    setMode('frame');
    setVideoError(false);
    setDetails(null);
    setAlert(target.alert);
    setFiled(null);
    setGrantUntil(null);
    if (target.sceneIndex === null) return;
    const controller = new AbortController();
    fetchSceneFrames(target.videoId, target.sceneIndex, controller.signal)
      .then(setDetails)
      .catch(() => undefined);
    return () => controller.abort();
  }, [target]);

  // Localise the query in the frame that is shown.
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

  // The handlers change identity with every re-render of the shell (the node sends events several
  // times a second). They are read through a ref so that this effect runs once: re-running it
  // would move the focus back to the sheet and swallow what is being typed in a dialog.
  const handlers = useRef({ onClose, onPrev, onNext, dialogOpen: dialog !== null });
  handlers.current = { onClose, onPrev, onNext, dialogOpen: dialog !== null };
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const h = handlers.current;
      if (h.dialogOpen) return;
      const target = event.target as HTMLElement | null;
      const typing = target !== null && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (event.key === 'Escape') h.onClose();
      else if (typing) return;
      else if (event.key === 'ArrowLeft' && h.onPrev) h.onPrev();
      else if (event.key === 'ArrowRight' && h.onNext) h.onNext();
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sheet.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const scene = details?.scene ?? null;
  const isOriginalFrame = frame.frameNumber === target.frameNumber;
  const box = explain ? explain.box : isOriginalFrame ? target.box : null;
  const canPlay = video?.playable === true && !videoError && scene !== null && ((checked && !masked) || unmasked);
  const shownUrl = unmasked ? `media/${target.videoId}/original/${pad(frame.frameNumber, 7)}.jpg` : frame.url;
  const title = alert ? pick(alert.watchName, alert.watchNameEn) : (target.sourceName ?? video?.name ?? '');

  const verdict = (value: 'confirmed' | 'dismissed'): void => {
    if (!alert) return;
    void review.run(async () => {
      const result = await reviewAlert(alert.id, value);
      setAlert(result.alert);
      node.patchAlert(result.alert);
      if (result.watch) node.patchWatch(result.watch);
    });
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={sheet}>
        <header className="sheet-head">
          <span className="sheet-title" title={title}>
            {alert && <Sev level={alert.severity} />} {title}
          </span>
          <span className="meta">
            {target.sourceName && alert ? `${target.sourceName}  ` : ''}
            {target.at !== null ? formatClock(target.at, locale) : ''}
          </span>
          <span className="sheet-nav">
            <button type="button" className="text-btn" disabled={!onPrev} onClick={() => onPrev?.()} aria-label={t('Zurück')}>
              ←
            </button>
            <button type="button" className="text-btn" disabled={!onNext} onClick={() => onNext?.()} aria-label={t('Weiter')}>
              →
            </button>
            <button type="button" className="text-btn" onClick={onClose} title={t('Schließen')}>
              esc
            </button>
          </span>
        </header>

        <div className="sheet-body">
          <div className="sheet-main">
            {mode === 'video' && scene ? (
              <video
                key={`${target.videoId}-${scene.index}`}
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
              <div className="stage" style={stageStyle}>
                <img src={shownUrl} alt="" onLoad={onStageLoad} />
                {explain && showFocus && <canvas ref={focusCanvas} className="focus" aria-hidden="true" />}
                {box && (showFocus || !explain) && (
                  <div
                    className="reticle reticle-target"
                    style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
                  >
                    {target.query && <span className="reticle-label">{target.query}</span>}
                  </div>
                )}
                <div className="readout readout-tl">
                  {target.time !== null || details ? `T ${formatTime(frame.time)}  ` : ''}F {pad(frame.frameNumber, 5)}
                </div>
                <div className="readout readout-tr">{unmasked ? t('Original · Freigabe aktiv') : masked ? t('Gesichter maskiert') : ''}</div>
                {explaining && <div className="readout readout-bl">{t('lokalisiere …')}</div>}
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
            {alert && node.can('alert.triage') && (
              <div className="section-gap">
                <div className="btn-row">
                  <button type="button" className={`btn${alert.status === 'confirmed' ? ' btn-solid' : ''}`} disabled={review.busy} onClick={() => verdict('confirmed')}>
                    {alert.status === 'confirmed' ? t('Bestätigt') : t('Bestätigen')}
                  </button>
                  <button type="button" className={`btn${alert.status === 'dismissed' ? ' btn-solid' : ''}`} disabled={review.busy} onClick={() => verdict('dismissed')}>
                    {alert.status === 'dismissed' ? t('Verworfen') : t('Verwerfen')}
                  </button>
                </div>
                <p className="hint">
                  {t('Das Urteil wird protokolliert. Es verändert die Wache erst, wenn jemand sie ausdrücklich nachschärft.')}
                </p>
                {review.error && <p className="note">{review.error}</p>}
              </div>
            )}

            <div className="actions">
              {scene && (
                <button type="button" className="btn" disabled={!canPlay} onClick={() => setMode((m) => (m === 'video' ? 'frame' : 'video'))}>
                  {mode === 'video' ? t('Standbild') : t('Abspielen')}
                </button>
              )}
              {target.query !== null && (
                <button type="button" className="btn" disabled={mode === 'video' || !explain} onClick={() => setShowFocus((v) => !v)}>
                  {showFocus ? t('Fokus aus') : t('Fokus an')}
                </button>
              )}
              {node.can('case.write') && (
                <button type="button" className="btn" onClick={() => setDialog('case')}>
                  {t('Zum Vorgang')}
                </button>
              )}
              {masked && !unmasked && node.can('media') && (
                <button type="button" className="btn" onClick={() => setDialog('unmask')}>
                  {t('Original anfordern')}
                </button>
              )}
            </div>
            {filed && <p className="hint">{filed}</p>}
            {masked && !unmasked && scene && (
              <p className="hint">{t('Die Aufzeichnung enthält maskierte Gesichter. Abspielen und Original erfordern eine Freigabe durch eine zweite Person.')}</p>
            )}
            {!masked && !checked && !unmasked && scene && (
              <p className="hint">{t('Die Aufzeichnung wird noch ausgewertet. Abspielen ist möglich, sobald sie vollständig auf Gesichter geprüft ist.')}</p>
            )}
            {explainError && <p className="note">{explainError}</p>}

            <dl className="kv">
              {target.sourceName && (
                <div>
                  <dt>{t('Quelle')}</dt>
                  <dd>{target.sourceName}</dd>
                </div>
              )}
              {target.lat !== null && target.lon !== null && (
                <div>
                  <dt>UTMREF</dt>
                  <dd>{toMgrs(target.lat, target.lon)}</dd>
                </div>
              )}
              {target.query !== null && (
                <div>
                  <dt>{t('Anfrage')}</dt>
                  <dd>{target.query}</dd>
                </div>
              )}
              {(alert?.confidence ?? target.confidence) !== null && (
                <div>
                  <dt>{t('Sicherheit')}</dt>
                  <dd>{formatScore(alert?.confidence ?? target.confidence)}</dd>
                </div>
              )}
              {target.score !== null && target.score <= 1 && !alert && (
                <div>
                  <dt>{t('Ähnlichkeit')}</dt>
                  <dd>{formatDecimal(target.score, 4)}</dd>
                </div>
              )}
              {alert?.secondOpinion && (
                <div>
                  <dt title={t('Unabhängige Einschätzung des trainierten Gefahrenmodells für Luftbilder')}>{t('Zweitmeinung Modell')}</dt>
                  <dd>
                    {t(HAZARD_NAMES[alert.secondOpinion.label] ?? alert.secondOpinion.label)} {formatScore(alert.secondOpinion.p)}
                  </dd>
                </div>
              )}
              {alert && (
                <div>
                  <dt>{t('Bilder')}</dt>
                  <dd>
                    {alert.frames} · {alert.active ? t('dauert an') : t('beendet')}
                  </dd>
                </div>
              )}
              {video && (
                <div>
                  <dt>{t('Aufzeichnung')}</dt>
                  <dd title={video.name}>{video.name}</dd>
                </div>
              )}
              {video && video.facesMasked > 0 && (
                <div>
                  <dt>{t('Maskiert')}</dt>
                  <dd>
                    {n(video.facesMasked, 'face')}
                  </dd>
                </div>
              )}
            </dl>

            {scene && scene.tags.length > 0 && (
              <ul className="scores">
                {scene.tags.map((tag) => (
                  <li key={tag.label}>
                    <span className="scores-name">{tagLabel(tag.label, lang)}</span>
                    <span className="scores-bar">
                      <span style={{ width: `${Math.round(tag.p * 100)}%` }} />
                    </span>
                    <span className="scores-value">{formatDecimal(tag.p, 2)}</span>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      </div>

      {dialog === 'case' && (
        <CaseDialog
          target={target}
          frameNumber={frame.frameNumber}
          box={box}
          onClose={() => setDialog(null)}
          onFiled={(file) => {
            setFiled(t('Im Vorgang „{title}“ gesichert.', { title: file.title }));
            setDialog(null);
          }}
        />
      )}
      {dialog === 'unmask' && (
        <UnmaskDialog
          videoId={target.videoId}
          userId={node.session?.user.id ?? ''}
          onClose={() => setDialog(null)}
          onGranted={(expires) => {
            setGrantUntil(expires);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

function CaseDialog({
  target,
  frameNumber,
  box,
  onClose,
  onFiled,
}: {
  target: FrameTarget;
  frameNumber: number;
  box: NormRect | null;
  onClose: () => void;
  onFiled: (file: CaseFile) => void;
}) {
  const { t } = useLang();
  const [cases, setCases] = useState<CaseFile[] | null>(null);
  const [caseId, setCaseId] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const action = useAction();

  useEffect(() => {
    fetchCases()
      .then((list) => {
        const open = list.filter((c) => c.sealedAt === null);
        setCases(open);
        setCaseId(open[0]?.id ?? '');
      })
      .catch(() => setCases([]));
  }, []);

  const submit = (): void => {
    void action.run(async () => {
      let id = caseId;
      if (id === '') {
        if (title.trim().length < 3) throw new Error(t('Bitte einen Titel für den neuen Vorgang angeben.'));
        id = (await createCase(title.trim())).id;
      }
      const file = await addCaseItem(id, {
        videoId: target.videoId,
        frameNumber,
        at: target.at ?? Date.now(),
        note: note.trim(),
        query: target.query,
        box,
      });
      onFiled(file);
    });
  };

  return (
    <Dialog title={t('Bild als Beweisstück sichern')} onClose={onClose}>
      <div className="form">
        <Field label={t('Vorgang')}>
          <select value={caseId} onChange={(e) => setCaseId(e.target.value)} disabled={cases === null}>
            {(cases ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
            <option value="">{t('+ Neuer Vorgang')}</option>
          </select>
        </Field>
        {caseId === '' && (
          <Field label={t('Titel des neuen Vorgangs')}>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} />
          </Field>
        )}
        <Field label={t('Vermerk')} hint={t('Die Prüfsumme des unmaskierten Bildes wird mit dem Vermerk im Vorgang und im Protokoll festgehalten.')}>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={500} />
        </Field>
        {action.error && <p className="note">{action.error}</p>}
        <div className="btn-row">
          <button type="button" className="btn btn-solid" disabled={action.busy} onClick={submit}>
            {t('Sichern')}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {t('Abbrechen')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

export function UnmaskDialog({
  videoId,
  userId,
  onClose,
  onGranted,
}: {
  videoId: string;
  userId: string;
  onClose: () => void;
  onGranted: (expires: number) => void;
}) {
  const { t } = useLang();
  const [reason, setReason] = useState('');
  const [approver, setApprover] = useState('');
  const [password, setPassword] = useState('');
  const action = useAction();

  const submit = (): void => {
    void action.run(async () => {
      const grant = await requestUnmask({ videoId, reason: reason.trim(), approver: approver.trim(), password });
      onGranted(grant.expires);
    });
  };

  return (
    <Dialog title={t('Maskierung aufheben · Vier-Augen-Freigabe')} onClose={onClose}>
      <p className="dim">
        {t(
          'Gesichter sind in allen Bildern maskiert. Das Original wird nur für diese Aufzeichnung, nur für 15 Minuten und nur mit Zustimmung einer zweiten, leitenden Person gezeigt. Grund und Freigabe stehen im Protokoll.',
        )}
      </p>
      <div className="form">
        <Field label={t('Grund (mindestens 12 Zeichen)')}>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
        </Field>
        <div className="field-row">
          <Field label={t('Freigebende Person (Kennung)')} hint={t('Nicht {user}.', { user: userId })}>
            <input value={approver} onChange={(e) => setApprover(e.target.value)} autoComplete="off" />
          </Field>
          <Field label={t('Ihr Passwort')}>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
          </Field>
        </div>
        {action.error && <p className="note">{action.error}</p>}
        <div className="btn-row">
          <button type="button" className="btn btn-solid" disabled={action.busy || reason.trim().length < 12 || approver === '' || password === ''} onClick={submit}>
            {t('Freigeben')}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {t('Abbrechen')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
