import { useEffect, useMemo, useRef, useState } from 'react';
import { useLang } from '../../i18n';
import { Dialog, pressable } from '../../ui';
import { fetchDataset, fetchSummary, type DatasetRow, type DatumSummary } from '../api';
import { datasets, groupRecordings, useDatasets } from '../datasets';
import { caseLabel } from '../labels';
import { DatumSettingsPanel } from '../Settings';
import { TruthButton, useTruthUpload } from '../TruthUpload';
import { kmText } from '../useFixes';
import type { DatumViewProps } from './Ortung';

interface EvalRow {
  name: string;
  n: number | null;
  median: number | null;
  within: { km: number; share: number }[];
  country: number | null;
  inside: number | null;
}

const MODE_LABEL: Record<string, string> = {
  open: 'Galerie mit Referenzbild des Ortes',
  unknown: 'Ort ohne Referenzbild (unbekannt)',
};
const SPLIT_LABEL: Record<string, string> = { all: 'alle', test: 'Prüfhälfte', train: 'Abstimmungshälfte' };

/** Reads the summary of the stored evaluation (docs/measurements/datum-geolocation.json). */
function evalRows(evaluation: unknown, t: (s: string) => string): EvalRow[] {
  if (!evaluation || typeof evaluation !== 'object') return [];
  const summary = (evaluation as Record<string, unknown>)['summary'];
  if (!summary || typeof summary !== 'object') return [];
  const rows: EvalRow[] = [];
  for (const [mode, splits] of Object.entries(summary as Record<string, unknown>)) {
    if (!splits || typeof splits !== 'object') continue;
    for (const split of ['all', 'test']) {
      const s = (splits as Record<string, Record<string, unknown>>)[split];
      if (!s) continue;
      const num = (k: string): number | null => (typeof s[k] === 'number' ? (s[k] as number) : null);
      rows.push({
        name: `${t(MODE_LABEL[mode] ?? mode)} · ${t(SPLIT_LABEL[split] ?? split)}`,
        n: num('n'),
        median: num('medianKm'),
        within: [1, 25, 200, 750, 2500].map((km) => ({ km, share: num(`acc${km}km`) ?? NaN })),
        country: num('countryAcc'),
        inside: num('withinRadius'),
      });
    }
  }
  return rows;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** One table of cases with a known place: the reference set, or the analyst's own truths. */
function TruthTable({ rows, names, select, go }: { rows: DatasetRow[]; names: Map<string, string>; select: (id: string | null) => void; go: DatumViewProps['go'] }) {
  const { t, locale, region } = useLang();
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>{t('Fall')}</th>
          <th>{t('Grundwahrheit')}</th>
          <th>{t('Land')}</th>
          <th>{t('Abweichung')}</th>
          <th style={{ width: 160 }} />
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.index}
            className={r.videoId ? 'clickable' : ''}
            {...(r.videoId
              ? pressable(() => {
                  select(r.videoId);
                  go('befund');
                })
              : {})}
          >
            <td className="strong">{caseLabel(r.videoId ? (names.get(r.videoId) ?? r.name) : r.name)}</td>
            <td>{r.label}</td>
            <td title={r.country ?? ''}>{r.country ? region(r.country) : '–'}</td>
            <td>
              {r.errorKm != null ? kmText(r.errorKm, locale) : r.videoId ? <span className="low">{t('wird geortet …')}</span> : '–'}
              {r.stage === 'quick' && <span className="low"> · {t('vorläufig')}</span>}
            </td>
            <td>
              {r.errorKm != null && (
                <div className="dt-bar" title={kmText(r.errorKm, locale)}>
                  <i style={{ width: `${Math.min(100, (Math.log10(1 + r.errorKm) / Math.log10(1 + 5000)) * 100)}%` }} />
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Messung({ videos, can, fixes, byId, select, go }: DatumViewProps) {
  const { t, locale, pick } = useLang();
  const truth = useTruthUpload();
  const sets = useDatasets();
  const [summary, setSummary] = useState<DatumSummary | null>(null);
  const [rows, setRows] = useState<DatasetRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The figures are read again when a fix starts, ends or is replaced by a recomputation, and when
  // a ground truth arrives for it (that keeps computedAt). The steps announced while a fix runs
  // keep status and computedAt and do not count.
  const version = useMemo(
    () =>
      fixes
        .map((f) => `${f.videoId}:${f.status}:${f.computedAt}:${f.truth?.errorKm ?? ''}`)
        .sort()
        .join('|'),
    [fixes],
  );
  // A truth list for files not on the node yet changes no fix; it still belongs in the table.
  const truthStamp = truth.result?.ok ? truth.result.text : '';

  useEffect(() => {
    if (sets.list === null && sets.supported) void datasets.refresh();
  }, [sets.list, sets.supported]);

  const firstRead = useRef(true);
  useEffect(() => {
    const ctrl = new AbortController();
    // While a folder of recordings is located, fixes finish one after another; the figures are
    // read once the changes pause, not for every fix (the first read happens at once).
    const delay = firstRead.current ? 0 : 1500;
    firstRead.current = false;
    const timer = window.setTimeout(() => {
      Promise.all([fetchSummary(ctrl.signal), fetchDataset(ctrl.signal)])
        .then(([s, d]) => {
          setSummary(s);
          setRows(d);
          setError(null);
        })
        .catch((err: unknown) => {
          if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : String(err));
        });
    }, delay);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [version, truthStamp]);

  const ownRows = useMemo(() => rows.filter((r) => r.kind === 'eigene'), [rows]);
  const referenceRows = useMemo(() => rows.filter((r) => r.kind !== 'eigene'), [rows]);
  // Headline figures are those of the reference set; older nodes have no split and count all.
  const reference = summary ? (summary.bySource?.referenz ?? summary) : null;
  const videoNames = useMemo(() => new Map(videos.map((v) => [v.id, v.name])), [videos]);

  // Own truths by the dataset of their recording; truths without a recording are listed apart.
  const ownGroups = useMemo(() => {
    const groups = groupRecordings(videos, byId, sets, { pick, t });
    const home = new Map<string, { id: string; name: string }>();
    for (const g of groups) for (const v of g.videos) home.set(v.id, { id: g.id, name: g.name });
    const out = new Map<string, { id: string; name: string; rows: DatasetRow[] }>();
    const loose: DatasetRow[] = [];
    for (const r of ownRows) {
      const g = r.videoId ? home.get(r.videoId) : undefined;
      if (!g) {
        loose.push(r);
        continue;
      }
      const entry = out.get(g.id) ?? { ...g, rows: [] };
      entry.rows.push(r);
      out.set(g.id, entry);
    }
    const order = new Map(groups.map((g, i) => [g.id, i]));
    return { groups: [...out.values()].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)), loose };
  }, [ownRows, videos, byId, sets, pick, t]);

  const modes = evalRows(summary?.evaluation, t);
  const pct = (v: number | null | undefined): string => (v == null ? '–' : `${Math.round(v * 100).toLocaleString(locale)} %`);
  const refLocated = referenceRows.filter((r) => r.errorKm != null).length;
  const mayWrite = can('source.write');

  return (
    <div className="page dt-messung">
      {/* The page head of BESTAND and PROTOKOLL: title, a line for the last outcome, page actions. */}
      <header className="page-head">
        <div>
          <h1 className="page-title">{t('Messung')}</h1>
          {truth.result && <p className={truth.result.ok ? 'page-sub' : 'note'}>{truth.result.text}</p>}
          {error && <p className="note">{error}</p>}
        </div>
        <div className="btn-row">
          {mayWrite && <TruthButton truth={truth} className="btn" />}
          <button type="button" className="btn" aria-haspopup="dialog" onClick={() => setSettingsOpen(true)}>
            {t('Einstellungen der Ortung')}
          </button>
        </div>
      </header>

      <section className="dt-msection">
        <h3 className="label">
          {t('Referenzbestand')} <span className="count">{referenceRows.length}</span>
          {referenceRows.length > 0 && refLocated < referenceRows.length && (
            <span className="count-of">· {t('{located}/{n} geortet', { located: refLocated, n: referenceRows.length })}</span>
          )}
        </h3>
        {summary && referenceRows.length === 0 ? (
          <p className="hint">{t('Kein Referenzbestand auf diesem Knoten.')}</p>
        ) : (
          <>
            <p className="hint">{t('Wahrer Ort aus Wikidata; der Ortung nicht mitgegeben.')}</p>
            {summary && (
              <div className="dt-figures">
                <div className="dt-figure">
                  <b>{reference?.medianErrorKm == null ? '–' : kmText(reference.medianErrorKm, locale)}</b>
                  <span>{t('Median')}</span>
                </div>
                {[25, 750].map((km) => (
                  <div className="dt-figure" key={km}>
                    <b>{reference?.withTruth ? pct(reference.within.find((w) => w.km === km)?.share) : '–'}</b>
                    <span>
                      ≤ {km.toLocaleString(locale)} <span className="unit">km</span>
                    </span>
                  </div>
                ))}
                <div className="dt-figure">
                  <b>{pct(reference?.insideRadius)}</b>
                  <span>{t('Grundwahrheit im Kreis')}</span>
                </div>
              </div>
            )}
            <TruthTable rows={referenceRows} names={videoNames} select={select} go={go} />
            <p className="hint">
              {t('Quelle der Videos: Wikimedia Commons, verknüpft über Wikidata (Eigenschaften P10 und P625). Lizenzen je Datei auf der jeweiligen Dateiseite.')}
            </p>
          </>
        )}
      </section>

      {ownGroups.groups.map((g) => {
        const errors = g.rows.map((r) => r.errorKm).filter((v): v is number => v != null);
        const mid = median(errors);
        const near = errors.length > 0 ? errors.filter((e) => e <= 25).length / errors.length : null;
        return (
          <section className="dt-msection" key={g.id}>
            <h3 className="label">
              {g.name} <span className="count">{g.rows.length}</span>
            </h3>
            {errors.length > 0 && (
              <p className="dt-own-figures">
                {t('Median')} <b>{mid == null ? '–' : kmText(mid, locale)}</b>
                {' · '}≤ 25 km <b>{pct(near)}</b>
              </p>
            )}
            <TruthTable rows={g.rows} names={videoNames} select={select} go={go} />
          </section>
        );
      })}
      {ownGroups.loose.length > 0 && (
        <section className="dt-msection">
          <details className="dt-trace-box dt-fold">
            <summary className="label">{t('{n} ohne passende Aufnahme', { n: ownGroups.loose.length })}</summary>
            <TruthTable rows={ownGroups.loose} names={videoNames} select={select} go={go} />
          </details>
        </section>
      )}

      {(modes.length > 0 || summary) && (
        <section className="dt-msection">
        <details className="dt-trace-box dt-fold">
          <summary className="label">{t('Gespeicherte Auswertung')}</summary>
          <p className="hint">
            {t('Die Schwellen der Ortung wurden nur an der Abstimmungshälfte eingestellt; die Prüfhälfte zeigt, was ohne Anpassung herauskommt.')}{' '}
            {summary?.holdout
              ? t('Gemessen wie bei einem unbekannten Ort: Das Referenzbild desselben Bauwerks ist aus der Galerie genommen.')
              : t('Gemessen mit vollständiger Galerie: Das Referenzbild desselben Bauwerks ist enthalten.')}{' '}
            {t('Schwellen 1, 25, 200, 750 und 2 500 km wie in der Fachliteratur zur Bildverortung (Im2GPS).')}
          </p>
          {summary?.medianSeconds != null && (
            <p className="dt-own-figures">
              {t('Rechenzeit je Aufnahme')} <b>{summary.medianSeconds.toLocaleString(locale, { maximumFractionDigits: 1 })} s</b>
            </p>
          )}
          {modes.length > 0 && (
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('Fall')}</th>
                  <th className="num dt-num-col">n</th>
                  <th className="num dt-num-col">{t('Median')}</th>
                  {modes[0]!.within.map((w) => (
                    <th key={w.km} className="num dt-num-col">
                      ≤ {w.km.toLocaleString(locale)} <span className="unit">km</span>
                    </th>
                  ))}
                  <th className="num dt-num-col">{t('Land richtig')}</th>
                  <th className="num dt-num-col">{t('im Kreis')}</th>
                </tr>
              </thead>
              <tbody>
                {modes.map((m) => (
                  <tr key={m.name}>
                    <td className="strong nowrap">{m.name}</td>
                    <td className="num">{m.n ?? '–'}</td>
                    <td className="num nowrap">{m.median == null ? '–' : kmText(m.median, locale)}</td>
                    {m.within.map((w) => (
                      <td key={w.km} className="num">
                        {Number.isFinite(w.share) ? pct(w.share) : '–'}
                      </td>
                    ))}
                    <td className="num">{pct(m.country)}</td>
                    <td className="num">{pct(m.inside)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </details>
        </section>
      )}

      {settingsOpen && (
        <Dialog title={t('Einstellungen der Ortung')} onClose={() => setSettingsOpen(false)}>
          <DatumSettingsPanel can={can} />
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => setSettingsOpen(false)}>
              {t('Schließen')}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
