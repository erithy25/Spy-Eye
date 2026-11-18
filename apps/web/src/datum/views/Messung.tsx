import { useEffect, useMemo, useRef, useState } from 'react';
import { useLang } from '../../i18n';
import { pressable } from '../../ui';
import { fetchDataset, fetchSummary, type DatasetRow, type DatumSummary } from '../api';
import { caseLabel } from '../labels';
import { TruthControl, useTruthUpload } from '../TruthUpload';
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

export function Messung({ videos, can, fixes, select, go }: DatumViewProps) {
  const { t, locale, region } = useLang();
  const truth = useTruthUpload();
  // Own recordings with a true place the analyst gave (POST /api/datum/truth), best first.
  const own = useMemo(() => {
    const names = new Map(videos.map((v) => [v.id, v.name]));
    return fixes
      .filter((f) => f.truth && f.truth.source === 'eigene' && names.has(f.videoId))
      .map((f) => ({ fix: f, name: names.get(f.videoId)! }))
      .sort((a, b) => (a.fix.truth?.errorKm ?? Infinity) - (b.fix.truth?.errorKm ?? Infinity));
  }, [fixes, videos]);
  const [summary, setSummary] = useState<DatumSummary | null>(null);
  const [rows, setRows] = useState<DatasetRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The figures are read again when a fix starts, ends or is replaced by a recomputation. The
  // steps announced while a fix runs keep status and computedAt and do not count.
  const version = useMemo(
    () =>
      fixes
        .map((f) => `${f.videoId}:${f.status}:${f.computedAt}`)
        .sort()
        .join('|'),
    [fixes],
  );

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
  }, [version]);

  const modes = evalRows(summary?.evaluation, t);
  const pct = (v: number | null | undefined): string => (v == null ? '–' : `${Math.round(v * 100).toLocaleString(locale)} %`);

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
              {/* Two thresholds here; all five are in the stored evaluation below. */}
              {summary.within.filter((w) => w.km === 25 || w.km === 750).map((w) => (
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

        <section className="section-gap dt-own" style={{ marginTop: 26 }}>
          <h3 className="label">
            {t('Eigene Aufnahmen mit Grundwahrheit')} <span className="count">{own.length}</span>
          </h3>
          {can('source.write') && <TruthControl truth={truth} />}
          {own.length === 0 ? (
            <p className="hint">{t('Noch keine. Mit einer Grundwahrheit zu eigenen Videos steht hier, wie weit die Ortung danebenliegt.')}</p>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('Fall')}</th>
                  <th>{t('Wahrer Ort')}</th>
                  <th>{t('Abweichung')}</th>
                  <th style={{ width: 160 }} />
                </tr>
              </thead>
              <tbody>
                {own.map(({ fix, name }) => (
                  <tr
                    key={fix.videoId}
                    className="clickable"
                    {...pressable(() => {
                      select(fix.videoId);
                      go('befund');
                    })}
                  >
                    <td className="strong">{caseLabel(name)}</td>
                    <td>{fix.truth?.label || '–'}</td>
                    <td>{fix.truth?.errorKm == null ? (fix.status === 'ready' ? '–' : t('wird geortet …')) : kmText(fix.truth.errorKm, locale)}</td>
                    <td>
                      {fix.truth?.errorKm != null && (
                        <div className="dt-bar" title={kmText(fix.truth.errorKm, locale)}>
                          <i style={{ width: `${Math.min(100, (Math.log10(1 + fix.truth.errorKm) / Math.log10(1 + 5000)) * 100)}%` }} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

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
            {t('Referenzbestand: Einzelfälle')} <span className="count">{rows.length}</span>
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
                  <td className="strong">{caseLabel(r.name)}</td>
                  <td>{r.label}</td>
                  <td title={r.country ?? ''}>{r.country ? region(r.country) : '–'}</td>
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
