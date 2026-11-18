import { useCallback, useRef, useState } from 'react';
import { useLang } from '../i18n';
import { postTruth } from './api';
import { parseTruthFile } from './truthFile';

export type TruthResult = { ok: boolean; text: string };

export interface TruthUpload {
  busy: boolean;
  /** Outcome of the last file: what the node took, or why it was refused. */
  result: TruthResult | null;
  /**
   * Reads and sends a file. `withVideos`: it comes with videos that are still being uploaded, so
   * the node cannot match it yet; the outcome says it is matched when they are located.
   */
  send: (file: File, options?: { withVideos?: boolean }) => void;
}

/**
 * Reads a ground-truth file and gives it to the node; used by the picker and by a drop.
 * `onResult` hears each outcome once, when it arrives (a view that stays mounted while hidden must
 * not show an old outcome again when it is shown again).
 */
export function useTruthUpload(onResult?: (result: TruthResult) => void): TruthUpload {
  const { t, n } = useLang();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TruthUpload['result']>(null);
  const listener = useRef(onResult);
  listener.current = onResult;
  const send = useCallback(
    (file: File, options: { withVideos?: boolean } = {}) => {
      setBusy(true);
      setResult(null);
      const done = (r: TruthResult): void => {
        setResult(r);
        listener.current?.(r);
      };
      void file
        .text()
        .then(async (text) => {
          const parsed = parseTruthFile(text, file.name);
          if ('fault' in parsed) {
            done({ ok: false, text: `${file.name}: ${t(parsed.fault.text, parsed.fault.vars)}` });
            return;
          }
          const answer = await postTruth(parsed.entries);
          const entries = n(answer.stored, 'entry');
          done({
            ok: true,
            text: options.withVideos
              ? t('Grundwahrheit gespeichert: {entries}. Sie gilt für die Aufnahmen, sobald sie geortet sind.', { entries })
              : t('Grundwahrheit gespeichert: {entries}, davon {matched} zu Aufnahmen auf dem Knoten.', { entries, matched: answer.matched }),
          });
        })
        .catch((err: unknown) => done({ ok: false, text: err instanceof Error ? t(err.message) : String(err) }))
        .finally(() => setBusy(false));
    },
    [t, n],
  );
  return { busy, result, send };
}

/** Accept list of the ground-truth picker. */
export const TRUTH_ACCEPT = '.csv,.json,.tsv,.txt,text/csv,application/json';

/** A text button that picks a ground-truth file; the format is in its title. */
export function TruthButton({ truth, className = 'text-btn' }: { truth: TruthUpload; className?: string }) {
  const { t } = useLang();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} disabled={truth.busy} title={t('CSV name,lat,lon[,label] oder JSON; name = Videodatei')} onClick={() => input.current?.click()}>
        {truth.busy ? t('Grundwahrheit wird gelesen …') : t('Grundwahrheit hinzufügen …')}
      </button>
      <input
        ref={input}
        type="file"
        accept={TRUTH_ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) truth.send(file);
          e.target.value = '';
        }}
      />
    </>
  );
}
