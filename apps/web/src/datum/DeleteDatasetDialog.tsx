import { useState } from 'react';
import { errorText } from '../api';
import { useLang } from '../i18n';
import { Dialog, Field } from '../ui';
import { deleteDataset, type DatasetDeleteResult } from './api';
import { datasets, type DatasetGroup } from './datasets';

interface DeleteDatasetDialogProps {
  group: DatasetGroup;
  onClose: () => void;
  onDone: (result: DatasetDeleteResult) => void;
}

/**
 * Deleting a dataset with its recordings, fixes and ground truths. The reference set asks for its
 * name to be typed: without it MESSUNG has nothing to measure against, and it is not seeded again.
 */
export function DeleteDatasetDialog({ group, onClose, onDone }: DeleteDatasetDialogProps) {
  const { t, n } = useLang();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = !group.reference || typed.trim().toLocaleLowerCase() === group.name.toLocaleLowerCase();

  const go = (): void => {
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    deleteDataset(group.id)
      .then((result) => {
        if (result.removed) datasets.drop(group.id);
        void datasets.refresh();
        onDone(result);
      })
      .catch((err: unknown) => {
        setError(errorText(err));
        setBusy(false);
      });
  };

  return (
    // A destructive dialog opens on the typed name or on "Abbrechen", never on "Löschen".
    <Dialog title={t('Datensatz löschen')} onClose={busy ? () => undefined : onClose} initialFocus="input, .dt-cancel">
      <p>{t('»{name}« mit {n} wird gelöscht, mit Ortungen und Grundwahrheiten. Das lässt sich nicht rückgängig machen.', { name: group.name, n: n(group.videos.length, 'recording') })}</p>
      {group.reference && (
        <>
          <p className="dim">{t('MESSUNG zeigt danach keine Referenzwerte mehr. Der Referenzbestand kommt nicht von selbst zurück.')}</p>
          <Field label={t('Zum Bestätigen den Namen eingeben')}>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={group.name}
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === 'Enter') go();
              }}
            />
          </Field>
        </>
      )}
      {error && <p className="note">{error}</p>}
      <div className="btn-row">
        <button type="button" className="btn btn-solid" disabled={!confirmed || busy} onClick={go}>
          {busy ? t('wird gelöscht …') : t('Löschen')}
        </button>
        <button type="button" className="btn dt-cancel" disabled={busy} onClick={onClose}>
          {t('Abbrechen')}
        </button>
      </div>
    </Dialog>
  );
}
