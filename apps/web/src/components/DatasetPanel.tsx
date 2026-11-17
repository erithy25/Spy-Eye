import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { deleteVideo, retryVideo, uploadVideo, type DetailLevel, type VideoInfo } from '../api';
import { VIDEO_FILE_PATTERN, formatTime } from '../format';

interface DatasetPanelProps {
  videos: VideoInfo[];
  selectedVideoId: string | null;
  onSelect: (videoId: string | null) => void;
}

interface UploadItem {
  key: string;
  name: string;
  progress: number;
  status: 'waiting' | 'uploading' | 'failed';
  error: string | null;
}

const DETAIL_OPTIONS: { value: DetailLevel; label: string; hint: string }[] = [
  { value: 'fast', label: 'schnell', hint: '1 Vektor pro Frame' },
  { value: 'standard', label: 'standard', hint: '4 Vektoren pro Frame' },
  { value: 'detail', label: 'detail', hint: '12 Vektoren pro Frame, findet kleine Objekte, 3× langsamer' },
];

const FPS_OPTIONS: readonly number[] = [0.5, 1, 2, 4];

/** Recursively collects files from dropped directories. */
async function filesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) => {
      (entry as FileSystemFileEntry).file(
        (file) => resolve([file]),
        () => resolve([]),
      );
    });
  }
  if (!entry.isDirectory) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
    if (batch.length === 0) break;
    children.push(...batch);
  }
  const nested = await Promise.all(children.map(filesFromEntry));
  return nested.flat();
}

async function filesFromDrop(event: DragEvent): Promise<File[]> {
  const items = Array.from(event.dataTransfer.items);
  const entries = items
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => entry !== null);
  if (entries.length === 0) return Array.from(event.dataTransfer.files);
  const nested = await Promise.all(entries.map(filesFromEntry));
  return nested.flat();
}

function statusText(video: VideoInfo): string {
  switch (video.status) {
    case 'queued':
      return 'wartet';
    case 'processing':
      return `${Math.round(video.progress * 100)} %`;
    case 'error':
      return 'fehler';
    case 'ready':
      return `${video.sceneCount} sz`;
  }
}

export function DatasetPanel({ videos, selectedVideoId, onSelect }: DatasetPanelProps) {
  const [detail, setDetail] = useState<DetailLevel>('standard');
  const [sampleFps, setSampleFps] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const queue = useRef<{ item: UploadItem; file: File; options: { sampleFps: number; detail: DetailLevel } }[]>([]);
  const busy = useRef(false);

  const patchUpload = useCallback((key: string, patch: Partial<UploadItem>) => {
    setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...patch } : u)));
  }, []);

  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      for (;;) {
        const next = queue.current.shift();
        if (!next) break;
        const { item, file, options } = next;
        patchUpload(item.key, { status: 'uploading' });
        try {
          const result = await uploadVideo(file, options, (fraction) => patchUpload(item.key, { progress: fraction })).promise;
          const rejected = result.rejected[0];
          if (rejected) {
            patchUpload(item.key, { status: 'failed', error: rejected.reason });
          } else {
            setUploads((list) => list.filter((u) => u.key !== item.key));
          }
        } catch (err: unknown) {
          patchUpload(item.key, { status: 'failed', error: err instanceof Error ? err.message : String(err) });
        }
      }
    } finally {
      busy.current = false;
    }
  }, [patchUpload]);

  const addFiles = useCallback(
    (files: File[]) => {
      const accepted = files.filter((f) => VIDEO_FILE_PATTERN.test(f.name));
      const skipped = files.length - accepted.length;
      setNotice(
        accepted.length === 0
          ? 'Keine Videodateien gefunden.'
          : skipped > 0
            ? `${skipped} Datei(en) übersprungen, kein Videoformat.`
            : null,
      );
      if (accepted.length === 0) return;
      const options = { sampleFps, detail };
      const items = accepted.map((file, i) => {
        const item: UploadItem = {
          key: `${Date.now()}-${i}-${file.name}`,
          name: file.name,
          progress: 0,
          status: 'waiting',
          error: null,
        };
        queue.current.push({ item, file, options });
        return item;
      });
      setUploads((list) => [...list, ...items]);
      void pump();
    },
    [detail, sampleFps, pump],
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
      if (!window.confirm(`"${video.name}" samt Index löschen?`)) return;
      if (selectedVideoId === video.id) onSelect(null);
      deleteVideo(video.id).catch((err: unknown) => setNotice(err instanceof Error ? err.message : String(err)));
    },
    [onSelect, selectedVideoId],
  );

  const onRetry = useCallback((video: VideoInfo) => {
    retryVideo(video.id).catch((err: unknown) => setNotice(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <section className="dataset">
      <h2 className="label">Dataset</h2>

      <div
        className={`drop${dragging ? ' drop-active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <span className="drop-text">Videos oder Ordner ablegen</span>
        <span className="drop-actions">
          <button type="button" className="text-btn" onClick={() => fileInput.current?.click()}>
            Dateien
          </button>
          <button type="button" className="text-btn" onClick={() => folderInput.current?.click()}>
            Ordner
          </button>
        </span>
        <input ref={fileInput} type="file" accept="video/*,.mkv,.avi,.ts,.mts,.m2ts,.flv,.wmv" multiple hidden onChange={onInputChange} />
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
          <dt>Detail</dt>
          <dd className="segments">
            {DETAIL_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={detail === o.value ? 'segment segment-on' : 'segment'}
                title={o.hint}
                onClick={() => setDetail(o.value)}
              >
                {o.label}
              </button>
            ))}
          </dd>
        </div>
        <div>
          <dt>Rate</dt>
          <dd className="segments">
            {FPS_OPTIONS.map((fps) => (
              <button
                key={fps}
                type="button"
                className={sampleFps === fps ? 'segment segment-on' : 'segment'}
                title={`${fps} Frame(s) pro Sekunde`}
                onClick={() => setSampleFps(fps)}
              >
                {fps}
              </button>
            ))}
            <span className="segment-unit">fps</span>
          </dd>
        </div>
      </dl>
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
                  {u.status === 'failed' ? 'fehler' : u.status === 'waiting' ? 'wartet' : `↑ ${Math.round(u.progress * 100)} %`}
                </span>
                {u.status === 'failed' && (
                  <button
                    type="button"
                    className="row-x"
                    aria-label="Meldung entfernen"
                    onClick={() => setUploads((list) => list.filter((x) => x.key !== u.key))}
                  >
                    ×
                  </button>
                )}
              </div>
              {u.status === 'failed' ? (
                <p className="note">{u.error}</p>
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
                  title={video.sceneCount > 0 ? 'Szenen anzeigen' : video.name}
                >
                  {video.name}
                </button>
                {video.durationSec !== null && <span className="row-dim">{formatTime(video.durationSec)}</span>}
                <span className="row-state">{statusText(video)}</span>
                <button type="button" className="row-x" aria-label={`${video.name} löschen`} onClick={() => onDelete(video)}>
                  ×
                </button>
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
                    wiederholen
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
