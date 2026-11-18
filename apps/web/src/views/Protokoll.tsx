import { useEffect, useState } from 'react';
import { fetchLedger, sampleLedger, verifyLedger, type LedgerEntryInfo, type LedgerVerificationInfo } from '../api';
import type { ViewProps } from '../App';
import { formatDecimal, shortHash } from '../format';
import { useLang } from '../i18n';
import { useAction } from '../ui';

const FILTERS: { action: string; label: string }[] = [
  { action: '', label: 'alle' },
  { action: 'search.query', label: 'Suchen' },
  { action: 'search.refused', label: 'Ablehnungen' },
  { action: 'federation.inbound', label: 'Fremdanfragen' },
  { action: 'privacy.unmask', label: 'Freigaben' },
  { action: 'watch.retrain', label: 'Nachschärfen' },
  { action: 'case.seal', label: 'Siegel' },
];

function EntryRows({ entries, open, onToggle }: { entries: LedgerEntryInfo[]; open: number | null; onToggle: (seq: number) => void }) {
  const { locale } = useLang();
  return (
    <>
      {entries.map((e) => (
        <tbody key={e.seq}>
          <tr className={`clickable${open === e.seq ? ' sel' : ''}`} onClick={() => onToggle(e.seq)}>
            <td className="num dim">{e.seq}</td>
            <td className="dim">{new Date(e.ts).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</td>
            <td>{e.actor}</td>
            <td className="dim">{e.action}</td>
            <td title={e.summary}>{e.summary}</td>
            <td className="hash">{shortHash(e.hash, 12)}</td>
          </tr>
          {open === e.seq && (
            <tr>
              <td />
              <td colSpan={5} className="wrap">
                <div className="pre">
                  {`prev  ${e.prev}\nhash  ${e.hash}\nrole  ${e.role}${e.mandateId ? `\nmandate  ${e.mandateId}` : ''}\n\n${JSON.stringify(e.data, null, 2)}`}
                </div>
              </td>
            </tr>
          )}
        </tbody>
      ))}
    </>
  );
}

export function Protokoll({ node }: ViewProps) {
  const { t, n } = useLang();
  const [entries, setEntries] = useState<LedgerEntryInfo[]>([]);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [verification, setVerification] = useState<LedgerVerificationInfo | null>(null);
  const [sample, setSample] = useState<{ population: number; entries: LedgerEntryInfo[] } | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const load = useAction();
  const verify = useAction();
  const full = node.can('ledger.read');
  const head = node.ledger;

  // Reload the first page when the filter changes or the node announces new entries.
  useEffect(() => {
    let cancelled = false;
    fetchLedger({ limit: 80, ...(filter !== '' ? { action: filter } : {}) })
      .then((page) => {
        if (cancelled) return;
        setEntries(page.entries);
        setExhausted(page.entries.length < 80);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [filter, head?.length]);

  const more = (): void => {
    const last = entries[entries.length - 1];
    if (!last) return;
    void load.run(async () => {
      const page = await fetchLedger({ limit: 80, before: last.seq, ...(filter !== '' ? { action: filter } : {}) });
      setEntries((list) => [...list, ...page.entries]);
      setExhausted(page.entries.length < 80);
    });
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">
            <small>{t('Aufsicht')}</small>
            {t('Protokoll')}
          </h1>
          <p className="lede">
            {t(
              'Jeder Eintrag enthält die Prüfsumme seines Vorgängers. Wer einen Eintrag ändert oder entfernt, bricht die Kette ab dieser Stelle; die Prüfung zeigt, wo. Nachbarknoten bezeugen den jeweils letzten Stand.',
            )}
            {!full && ` ${t('Sie sehen Ihre eigenen Einträge; Leitung und Aufsicht sehen alle.')}`}
          </p>
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn-solid" disabled={verify.busy} onClick={() => void verify.run(async () => setVerification(await verifyLedger()))}>
            {verify.busy ? t('prüfe …') : t('Kette prüfen')}
          </button>
          {full && (
            <>
              <button type="button" className="btn" onClick={() => void load.run(async () => setSample(await sampleLedger(10)))}>
                {t('Stichprobe ziehen')}
              </button>
              <a className="btn" href="api/ledger/export">
                {t('Export')}
              </a>
            </>
          )}
        </div>
      </header>

      <div className="kpis">
        <div>
          <div className="label">{t('Einträge')}</div>
          <div className="figure">{head?.length ?? entries[0]?.seq ?? '–'}</div>
        </div>
        <div>
          <div className="label">{t('Letzter Stand')}</div>
          <div className="hash" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>
            {head?.head ?? entries[0]?.hash ?? '–'}
          </div>
        </div>
        <div>
          <div className="label">{t('Prüfung')}</div>
          {verification ? (
            <>
              <div className="figure" style={{ fontSize: 22 }}>
                {verification.ok ? t('Kette unversehrt') : t('Kette gebrochen')}
              </div>
              <p>
                {n(verification.entries, 'entry')} · {formatDecimal(verification.tookMs, 0)} ms
                {verification.brokenAt !== null ? ` · ${t('ab Eintrag')} ${verification.brokenAt}: ${verification.reason ?? ''}` : ''}
              </p>
            </>
          ) : (
            <p style={{ marginTop: 0 }}>{verify.error ?? t('Noch nicht geprüft. Die Prüfung rechnet alle Prüfsummen nach und wird selbst protokolliert.')}</p>
          )}
        </div>
      </div>

      {sample && (
        <section className="section-gap">
          <header className="panel-head">
            <h2 className="label">
              {t('Stichprobe')} <span className="count">{sample.entries.length}</span>
              <span className="count-of">/ {n(sample.population, 'query')}</span>
            </h2>
            <button type="button" className="text-btn" onClick={() => setSample(null)}>
              {t('schließen')}
            </button>
          </header>
          <p className="hint">{t('Zufällig gezogene Suchen, Ablehnungen und Fremdanfragen für die Kontrolle durch die Aufsicht. Auch das Ziehen ist protokolliert.')}</p>
          <table className="tbl">
            <colgroup>
              <col style={{ width: 56 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 170 }} />
              <col />
              <col style={{ width: 120 }} />
            </colgroup>
            <EntryRows entries={sample.entries} open={open} onToggle={(seq) => setOpen((v) => (v === seq ? null : seq))} />
          </table>
        </section>
      )}

      <section className="section-gap">
        <header className="panel-head">
          <h2 className="label">{t('Einträge')}</h2>
          <span className="segments">
            {FILTERS.map((f) => (
              <button key={f.action} type="button" className={filter === f.action ? 'segment segment-on' : 'segment'} onClick={() => setFilter(f.action)}>
                {t(f.label)}
              </button>
            ))}
          </span>
        </header>
        <table className="tbl">
          <colgroup>
            <col style={{ width: 56 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 170 }} />
            <col />
            <col style={{ width: 120 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>{t('Zeit')}</th>
              <th>{t('Wer')}</th>
              <th>{t('Was')}</th>
              <th>{t('Inhalt')}</th>
              <th>{t('Prüfsumme')}</th>
            </tr>
          </thead>
          <EntryRows entries={entries} open={open} onToggle={(seq) => setOpen((v) => (v === seq ? null : seq))} />
        </table>
        {entries.length === 0 && <p className="empty">{t('Keine Einträge.')}</p>}
        {!exhausted && entries.length > 0 && (
          <div>
            <button type="button" className="text-btn" disabled={load.busy} onClick={more}>
              + {t('ältere Einträge')}
            </button>
          </div>
        )}
        {load.error && <p className="note">{load.error}</p>}
      </section>
    </div>
  );
}
