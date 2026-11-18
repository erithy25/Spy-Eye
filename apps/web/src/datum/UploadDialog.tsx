import { useRef, useState, type DragEvent } from 'react';
import { errorText } from '../api';
import { VIDEO_FILE_PATTERN } from '../format';
import { useLang } from '../i18n';
import { Dialog, Field } from '../ui';
import { VIDEO_ACCEPT, dragHasFiles, droppedFolderName, filesFromDrop, pickedFolderName, uploads } from '../uploads';
import { createDataset, type DatasetInfo } from './api';
import { INBOX_ID, datasets, freeName } from './datasets';
import { isTruthFile } from './truthFile';

/** Recordings of the console go in sampled and described as BESTAND does by default. */
export const UPLOAD_OPTIONS = { sampleFps: 1, detail: 'standard' } as const;

export interface Picked {
  files: File[];
  /** The one folder the files came from, if any: the default name of a new dataset. */
  folder: string | null;
}

interface UploadDialogProps {
  initial: Picked | null;
  list: DatasetInfo[] | null;
  /** The node lists datasets; without, everything goes into the inbox. */
  supported: boolean;
  sendTruth: (file: File, options?: { withVideos?: boolean }) => void;
  onClose: () => void;
}

/**
 * Upload into a new dataset or an existing one: choose or drop files and folders, name the new
 * dataset (the folder's name, else today's date), go. The dialog closes as soon as the files are
 * queued; their progress shows under the dataset in the list.
 */
export function UploadDialog({ initial, list, supported, sendTruth, onClose }: UploadDialogProps) {
  const { t, n, lang, locale } = useLang();
  const [picked, setPicked] = useState<Picked>(initial ?? { files: [], folder: null });
  const [target, setTarget] = useState<string>('');
  const [name, setName] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const own = (list ?? []).filter((d) => !d.reference);
  const videos = picked.files.filter((f) => VIDEO_FILE_PATTERN.test(f.name));
  const truthFile = picked.files.find((f) => isTruthFile(f.name)) ?? null;
  const today = new Date().toLocaleDateString(locale, lang === 'en' ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: '2-digit', month: '2-digit', year: 'numeric' });
  const suggested = freeName(picked.folder ?? t('Aufnahmen {date}', { date: today }), list);
  const newName = (name ?? suggested).trim();
  const creating = supported && target === '';
  const nameOk = !creating || (newName.length >= 2 && newName.length <= 80);
  const ready = (videos.length > 0 || truthFile !== null) && nameOk && !busy;

  const take = (files: File[], folder: string | null): void => {
    setError(null);
    setPicked({ files, folder });
  };

  const go = (): void => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        if (videos.length > 0) {
          let id = supported ? target : INBOX_ID;
          if (creating) {
            const info = await createDataset(newName);
            datasets.put(info);
            id = info.id;
          }
          uploads.add(videos, { ...UPLOAD_OPTIONS, sourceId: id });
          void datasets.refresh();
        }
        // Sent at once; the videos are still uploading, so the node matches it when they are located.
        if (truthFile) sendTruth(truthFile, { withVideos: videos.length > 0 });
        onClose();
      } catch (err: unknown) {
        setError(errorText(err));
        setBusy(false);
      }
    })();
  };

  const onDrop = (event: DragEvent): void => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setOver(false);
    const folder = droppedFolderName(event);
    void filesFromDrop(event).then((files) => take(files, folder));
  };

  let summary: string | null = null;
  if (picked.files.length > 0) {
    const what = n(videos.length, 'video');
    summary = picked.folder ? t('{what} aus »{folder}«', { what, folder: picked.folder }) : what;
  }

  return (
    <Dialog title={t('Hochladen')} onClose={onClose}>
      <div
        className={over ? 'drop drop-active' : 'drop'}
        title={t('Videodateien; eine CSV- oder JSON-Datei (name,lat,lon[,label]; name = Videodatei) gilt als Grundwahrheit.')}
        onDragOver={(e) => {
          if (!dragHasFiles(e)) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {summary ? (
          <span className="drop-text dt-drop-summary">
            <span>{summary}</span>
            {truthFile && <span className="low">{t('Grundwahrheit: {file}', { file: truthFile.name })}</span>}
          </span>
        ) : (
          <span className="drop-text">{t('Videos oder Ordner hier ablegen')}</span>
        )}
        <span className="drop-actions">
          <button type="button" className="text-btn" onClick={() => fileInput.current?.click()}>
            {t('Dateien')}
          </button>
          <button type="button" className="text-btn" onClick={() => folderInput.current?.click()}>
            {t('Ordner')}
          </button>
        </span>
        <input
          ref={fileInput}
          type="file"
          accept={`${VIDEO_ACCEPT},.csv,.json`}
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length > 0) take(files, null);
          }}
        />
        <input
          ref={(el) => {
            folderInput.current = el;
            if (el) el.setAttribute('webkitdirectory', '');
          }}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length > 0) take(files, pickedFolderName(files));
          }}
        />
      </div>
      {supported && (
        <Field label={t('Datensatz')}>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{t('Neuer Datensatz')}</option>
            {own.map((d) => (
              <option key={d.id} value={d.id}>
                {lang === 'en' && d.nameEn ? d.nameEn : d.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {creating && (
        <Field label={t('Name')}>
          <input value={name ?? suggested} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
      )}
      {error && <p className="note">{error}</p>}
      <div className="btn-row">
        <button type="button" className="btn btn-solid" disabled={!ready} onClick={go}>
          {t('Hochladen')}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {t('Abbrechen')}
        </button>
      </div>
    </Dialog>
  );
}
