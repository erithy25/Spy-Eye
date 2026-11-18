import { useEffect, useState } from 'react';
import { useLang } from '../../i18n';
import { pressable } from '../../ui';
import { fetchDataset, fetchSummary, type DatasetRow, type DatumSummary } from '../api';
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

export function Messung({ node, select, go }: DatumViewProps) {
  const { t, locale } = useLang();
  const [summary, setSummary] = useState<DatumSummary | null>(null);
  const [rows, setRows] = useState<DatasetRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const version = Object.keys(node.fixes).length;

  useEffect(() => {
    const ctrl = new AbortController();
    Promise.all([fetchSummary(ctrl.signal), fetchDataset(ctrl.signal)])
      .then(([s, d]) => {
        setSummary(s);
        setRows(d);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      });
    return () => ctrl.abort();
  }, [version]);

  const modes = evalRows(summary?.evaluation, t);
  const pct = (v: number | null | undefined): string => (v == null ? '–' : `${Math.round(v * 100)} %`);

  return (
    <div className="view">
      <div className="dt-messung">
        <div className="section-head">
          <h2 className="label">{t('Messung gegen die Grundwahrheit')}</h2>
          <span className="low">
            {t('Referenzbestand mit bekanntem Aufnahmeort (Wikidata); der Ort wird der Ortung nicht mitgegeben.')}
          </span>
        </div>
        {error && <p className="note">{error}</p>}
        {summary && (
          <>
            <div className="dt-figures">
              <div className="dt-figure">
                <b>
                  {summary.ready}/{summary.recordings}
                </b>
                <span>{t('Aufnahmen geortet')}</span>
              </div>
              <div className="dt-figure">
                <b>{summary.medianErrorKm == null ? '–' : kmText(summary.medianErrorKm, locale)}</b>
                <span>{t('Abweichung im Median')}</span>
              </div>
              {summary.within.map((w) => (
                <div className="dt-figure" key={w.km}>
                  <b>{summary.withTruth ? pct(w.share) : '–'}</b>
                  <span>
                    {t('innerhalb')} {w.km.toLocaleString(locale)} km
                  </span>
                </div>
              ))}
              <div className="dt-figure">
                <b>{pct(summary.insideRadius)}</b>
                <span>{t('Wahrheit im angegebenen Kreis')}</span>
              </div>
              <div className="dt-figure">
                <b>{summary.medianSeconds == null ? '–' : `${summary.medianSeconds.toLocaleString(locale, { maximumFractionDigits: 1 })} s`}</b>
                <span>{t('Rechenzeit je Aufnahme')}</span>
              </div>
            </div>
            <p className="hint">
              {summary.holdout
                ? t('Gemessen wie bei einem unbekannten Ort: Das Referenzbild desselben Bauwerks ist aus der Galerie genommen.')
                : t('Gemessen mit vollständiger Galerie: Das Referenzbild desselben Bauwerks ist enthalten.')}{' '}
              {t('Schwellen 1, 25, 200, 750 und 2 500 km wie in der Fachliteratur zur Bildverortung (Im2GPS).')}
            </p>
          </>
        )}

        {modes.length > 0 && (
          <section className="section-gap" style={{ marginTop: 26 }}>
            <h3 className="label">{t('Gespeicherte Auswertung')}</h3>
            <p className="hint">
              {t('Mit pnpm datum:evaluate gemessen. Die Schwellen der Ortung wurden nur an der Abstimmungshälfte eingestellt; die Prüfhälfte zeigt, was ohne Anpassung herauskommt.')}
            </p>
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 330 }}>{t('Fall')}</th>
                  <th>n</th>
                  <th>{t('Median')}</th>
                  {modes[0]!.within.map((w) => (
                    <th key={w.km}>≤ {w.km.toLocaleString(locale)} km</th>
                  ))}
                  <th>{t('Land richtig')}</th>
                  <th>{t('im Kreis')}</th>
                </tr>
              </thead>
              <tbody>
                {modes.map((m) => (
                  <tr key={m.name}>
                    <td className="strong">{m.name}</td>
                    <td>{m.n ?? '–'}</td>
                    <td>{m.median == null ? '–' : kmText(m.median, locale)}</td>
                    {m.within.map((w) => (
                      <td key={w.km}>{Number.isFinite(w.share) ? pct(w.share) : '–'}</td>
                    ))}
                    <td>{pct(m.country)}</td>
                    <td>{pct(m.inside)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="section-gap" style={{ marginTop: 26 }}>
          <h3 className="label">
            {t('Einzelfälle')} <span className="count">{rows.length}</span>
          </h3>
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('Fall')}</th>
                <th>{t('Wahrer Ort')}</th>
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
                  <td className="strong">{r.name.replace(/\.mp4$/i, '').toUpperCase()}</td>
                  <td>{r.label}</td>
                  <td>{r.country ?? '–'}</td>
                  <td>{r.errorKm == null ? '–' : kmText(r.errorKm, locale)}</td>
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
          <p className="hint">
            {t('Quelle der Videos: Wikimedia Commons, verknüpft über Wikidata (Eigenschaften P10 und P625). Lizenzen je Datei auf der jeweiligen Dateiseite.')}
          </p>
        </section>
      </div>
    </div>
  );
}
