import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { deleteVideo, retryVideo, type DetailLevel, type VideoInfo } from '../api';
import { formatDate, formatPercent, formatTime } from '../format';
import { useLang } from '../i18n';
import { VIDEO_ACCEPT, filesFromDrop, uploads as uploadQueue, useUploads } from '../uploads';

interface DatasetPanelProps {
  videos: VideoInfo[];
  selectedVideoId: string | null;
  onSelect: (videoId: string | null) => void;
  /** Source the uploaded recordings are filed under. */
  sourceId: string;
  canWrite: boolean;
}

const DETAIL_OPTIONS: { value: DetailLevel; label: string; hint: string }[] = [
  { value: 'fast', label: 'schnell', hint: '1 Vektor je Bild' },
  { value: 'standard', label: 'standard', hint: '4 Vektoren je Bild' },
  { value: 'detail', label: 'fein', hint: '12 Vektoren je Bild: findet kleine Gegenstände, dreimal langsamer' },
];

const FPS_OPTIONS: readonly number[] = [0.5, 1, 2, 4];

function statusText(video: VideoInfo, t: (de: string) => string, n: (count: number, noun: 'scene') => string): string {
  switch (video.status) {
    case 'queued':
      // "grob": already searchable through the quick first pass, dense analysis pending.
      return video.coarse ? t('grob') : t('wartet');
    case 'processing':
      return formatPercent(video.progress);
    case 'error':
      return t('Fehler');
    case 'ready':
      return n(video.sceneCount, 'scene');
  }
}

export function DatasetPanel({ videos, selectedVideoId, onSelect, sourceId, canWrite }: DatasetPanelProps) {
  const { t, locale, n } = useLang();
  const [detail, setDetail] = useState<DetailLevel>('standard');
  const [sampleFps, setSampleFps] = useState(1);
  const [dragging, setDragging] = useState(false);
  // The shared queue also holds uploads started on ORTUNG; a finished upload shows here as the
  // recording itself, so only the ones still in transit or refused are listed.
  const uploads = useUploads().filter((u) => u.status !== 'done');
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    (files: File[]) => {
      const { accepted, skipped } = uploadQueue.add(files, { sampleFps, detail, sourceId });
      setNotice(
        accepted === 0
          ? t('Keine Videodateien gefunden.')
          : skipped > 0
            ? t('{n} Datei(en) übersprungen, kein Videoformat.', { n: skipped })
            : null,
      );
    },
    [detail, sampleFps, sourceId, t],
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      void filesFromDrop(event).then(addFiles);
    },
    [addFiles],
  );

  const onInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      addFiles(Array.from(event.target.files ?? []));
      event.target.value = '';
    },
    [addFiles],
  );

  const onDelete = useCallback(
    (video: VideoInfo) => {
      if (!window.confirm(t('„{name}“ samt Verzeichnis löschen?', { name: video.name }))) return;
      if (selectedVideoId === video.id) onSelect(null);
      deleteVideo(video.id).catch((err: unknown) => setNotice(err instanceof Error ? err.message : String(err)));
    },
    [onSelect, selectedVideoId, t],
  );

  const onRetry = useCallback((video: VideoInfo) => {
    retryVideo(video.id).catch((err: unknown) => setNotice(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <section className="dataset">
      {canWrite && (
      <>
      <div
        className={`drop${dragging ? ' drop-active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span className="drop-text">{t('Aufzeichnungen oder Ordner hier ablegen')}</span>
        <span className="drop-actions">
          <button type="button" className="text-btn" onClick={() => fileInput.current?.click()}>
            {t('Dateien')}
          </button>
          <button type="button" className="text-btn" onClick={() => folderInput.current?.click()}>
            {t('Ordner')}
          </button>
        </span>
        <input ref={fileInput} type="file" accept={VIDEO_ACCEPT} multiple hidden onChange={onInputChange} />
        <input
          ref={(el) => {
            folderInput.current = el;
            if (el) el.setAttribute('webkitdirectory', '');
          }}
          type="file"
          multiple
          hidden
          onChange={onInputChange}
        />
      </div>

      <dl className="settings">
        <div>
          <dt>{t('Auflösung')}</dt>
          <dd className="segments">
            {DETAIL_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={detail === o.value ? 'segment segment-on' : 'segment'}
                title={t(o.hint)}
                onClick={() => setDetail(o.value)}
              >
                {t(o.label)}
              </button>
            ))}
          </dd>
        </div>
        <div>
          <dt>{t('Abtastung')}</dt>
          <dd className="segments">
            {FPS_OPTIONS.map((fps) => (
              <button
                key={fps}
                type="button"
                className={sampleFps === fps ? 'segment segment-on' : 'segment'}
                title={t('{n} Bild(er) je Sekunde', { n: fps })}
                onClick={() => setSampleFps(fps)}
              >
                {fps}
              </button>
            ))}
            <span className="segment-unit">{t('Bilder/s')}</span>
          </dd>
        </div>
      </dl>
      </>
      )}
      {notice && <p className="note">{notice}</p>}

      {uploads.length > 0 && (
        <ul className="rows">
          {uploads.map((u) => (
            <li key={u.key} className="row">
              <div className="row-line">
                <span className="row-name" title={u.name}>
                  {u.name}
                </span>
                <span className="row-state">
                  {u.status === 'failed' ? t('Fehler') : u.status === 'waiting' ? t('wartet') : `↑ ${formatPercent(u.progress)}`}
                </span>
                {u.status === 'failed' && (
                  <button
                    type="button"
                    className="row-x"
                    aria-label={t('Hinweis entfernen')}
                    onClick={() => uploadQueue.dismiss(u.key)}
                  >
                    ×
                  </button>
                )}
              </div>
              {u.status === 'failed' ? (
                <p className="note">{u.error ? t(u.error) : t('Fehler')}</p>
              ) : (
                <div className="bar">
                  <span style={{ width: `${Math.round(u.progress * 100)}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {videos.length > 0 && (
        <ul className="rows">
          {videos.map((video) => (
            <li key={video.id} className={`row${selectedVideoId === video.id ? ' row-on' : ''}`}>
              <div className="row-line">
                <button
                  type="button"
                  className="row-name row-name-btn"
                  disabled={video.sceneCount === 0}
                  onClick={() => onSelect(selectedVideoId === video.id ? null : video.id)}
                  title={video.sceneCount > 0 ? t('Szenen anzeigen') : video.name}
                >
                  {video.name}
                </button>
                <span className="row-state">{statusText(video, t, n)}</span>
                {canWrite && (
                  <button type="button" className="row-x" aria-label={t('löschen')} onClick={() => onDelete(video)}>
                    ×
                  </button>
                )}
              </div>
              {/* Length, masked faces and the deletion date in words, on a line of their own. */}
              <div className="row-sub">
                {[
                  video.durationSec !== null ? formatTime(video.durationSec) : '',
                  video.facesMasked > 0 ? t('{faces} maskiert', { faces: n(video.facesMasked, 'face') }) : '',
                  video.deleteAfter !== null ? t('gelöscht ab {date}', { date: formatDate(video.deleteAfter, locale) }) : '',
                ]
                  .filter((x) => x !== '')
                  .join(' · ')}
              </div>
              {video.status === 'processing' && (
                <div className="bar">
                  <span style={{ width: `${Math.round(video.progress * 100)}%` }} />
                </div>
              )}
              {video.status === 'error' && (
                <p className="note">
                  {video.error}{' '}
                  <button type="button" className="text-btn" onClick={() => onRetry(video)}>
                    {t('wiederholen')}
                  </button>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
