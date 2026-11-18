import { useCallback, useRef, useState } from 'react';
import { useLang } from '../i18n';
import { postTruth } from './api';
import { parseTruthFile } from './truthFile';

export interface TruthUpload {
  busy: boolean;
  /** Outcome of the last file: what the node took, or why it was refused. */
  result: { ok: boolean; text: string } | null;
  send: (file: File) => void;
}

/** Reads a ground-truth file and gives it to the node; used by the picker and by a drop. */
export function useTruthUpload(): TruthUpload {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TruthUpload['result']>(null);
  const send = useCallback(
    (file: File) => {
      setBusy(true);
      setResult(null);
      void file
        .text()
        .then(async (text) => {
          const parsed = parseTruthFile(text, file.name);
          if ('fault' in parsed) {
            setResult({ ok: false, text: `${file.name}: ${t(parsed.fault.text, parsed.fault.vars)}` });
            return;
          }
          const answer = await postTruth(parsed.entries);
          setResult({
            ok: true,
            text: t('{stored} Grundwahrheiten gespeichert, {matched} davon gehören zu Aufnahmen auf dem Knoten.', {
              stored: answer.stored,
              matched: answer.matched,
            }),
          });
        })
        .catch((err: unknown) => setResult({ ok: false, text: err instanceof Error ? t(err.message) : String(err) }))
        .finally(() => setBusy(false));
    },
    [t],
  );
  return { busy, result, send };
}

/** The picker for a ground-truth file with its one-line format note. */
export function TruthControl({ truth, compact = false }: { truth: TruthUpload; compact?: boolean }) {
  const { t } = useLang();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className={compact ? 'dt-truth-ctl dt-truth-ctl-compact' : 'dt-truth-ctl'}>
      <button type="button" className="text-btn" disabled={truth.busy} onClick={() => input.current?.click()}>
        {truth.busy ? t('Grundwahrheit wird gelesen …') : `+ ${t('Grundwahrheit hinzufügen')}`}
      </button>
      <span className="low">{t('CSV mit Kopfzeile name,lat,lon[,label] oder JSON; name ist der Dateiname des Videos.')}</span>
      <input
        ref={input}
        type="file"
        accept=".csv,.json,.tsv,.txt,text/csv,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) truth.send(file);
          e.target.value = '';
        }}
      />
      {truth.result && <p className={truth.result.ok ? 'dt-truth-ok' : 'note'}>{truth.result.text}</p>}
    </div>
  );
}
