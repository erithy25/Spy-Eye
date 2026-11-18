import { useEffect, useState } from 'react';
import { useLang } from '../../i18n';
import { pressable } from '../../ui';
import { fetchDataset, fetchSummary, type DatasetRow, type DatumSummary } from '../api';
import { kmText } from '../useFixes';
import type { DatumViewProps } from './Ortung';

interface EvalMode {
  accuracy?: Record<string, number>;
  medianKm?: number;
  median_km?: number;
  n?: number;
}

/** Reads the summary block of the stored offline evaluation without trusting its exact shape. */
function evalModes(evaluation: unknown): { name: string; median: number | null; within: { km: number; share: number }[]; n: number | null }[] {
  if (!evaluation || typeof evaluation !== 'object') return [];
  const root = evaluation as Record<string, unknown>;
  const summary = (root['summary'] ?? root) as Record<string, unknown>;
  const out: { name: string; median: number | null; within: { km: number; share: number }[]; n: number | null }[] = [];
  for (const [name, value] of Object.entries(summary)) {
    if (!value || typeof value !== 'object') continue;
    const mode = value as EvalMode & Record<string, unknown>;
    const acc = (mode.accuracy ?? mode['within'] ?? null) as Record<string, number> | null;
    if (!acc || typeof acc !== 'object') continue;
    const within = Object.entries(acc)
      .map(([k, v]) => ({ km: Number(String(k).replace(/[^0-9.]/g, '')), share: typeof v === 'number' ? (v > 1 ? v / 100 : v) : NaN }))
      .filter((w) => Number.isFinite(w.km) && Number.isFinite(w.share))
      .sort((a, b) => a.km - b.km);
    const median = typeof mode.medianKm === 'number' ? mode.medianKm : typeof mode.median_km === 'number' ? mode.median_km : null;
    out.push({ name, median, within, n: typeof mode.n === 'number' ? mode.n : null });
  }
  return out;
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

  const modes = evalModes(summary?.evaluation);
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
          <section className="section-gap">
            <h3 className="label">{t('Gespeicherte Auswertung')}</h3>
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('Fall')}</th>
                  <th>n</th>
                  <th>{t('Median')}</th>
                  {modes[0]!.within.map((w) => (
                    <th key={w.km}>≤ {w.km.toLocaleString(locale)} km</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {modes.map((m) => (
                  <tr key={m.name}>
                    <td className="strong">{m.name}</td>
                    <td>{m.n ?? '–'}</td>
                    <td>{m.median == null ? '–' : kmText(m.median, locale)}</td>
                    {m.within.map((w) => (
                      <td key={w.km}>{pct(w.share)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="section-gap">
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
