import { useEffect } from 'react';
import { fetchMetrics } from '../api';
import type { ViewProps } from '../App';
import { formatDecimal, formatDuration, formatExercise, formatPercent } from '../format';
import { useLang } from '../i18n';
import { useLoad } from '../ui';

const HAZARD_LABEL: Record<string, string> = { flood: 'Überflutung', fire: 'Brand', collapse: 'Einsturz', normal: 'Unauffällig' };

export function Wirkung({ node }: ViewProps) {
  const { t, locale } = useLang();
  const metrics = useLoad(() => fetchMetrics(), []);
  const m = metrics.data;
  const scenarioStatus = node.intel?.scenario.status;

  // Figures move while an exercise runs or footage is analysed.
  useEffect(() => {
    const timer = window.setInterval(metrics.reload, scenarioStatus === 'running' ? 3000 : 10_000);
    return () => window.clearInterval(timer);
  }, [metrics.reload, scenarioStatus]);

  const videos = (node.app?.videos ?? []).filter((v) => v.status !== 'error');
  const analysed = videos.filter((v) => v.status === 'ready').length;
  const evaluation = m?.evaluation ?? null;
  const card = m?.hazardModel ?? null;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">
            <small>{t('Messwerte dieses Knotens')}</small>
            {t('Wirkung')}
          </h1>
          <p className="lede">
            {t(
              'Der Zweck des Systems ist messbar: die Zeit zwischen dem ersten Bild eines Ereignisses und der Meldung auf der Lagekarte. Jede Übung liefert diese Zahl je Ereignis, zusammen mit dem, was übersehen und was fälschlich gemeldet wurde.',
            )}
          </p>
        </div>
        <div className="btn-row">
          <a className="btn" href="api/report/measurement" target="_blank" rel="noreferrer">
            {t('Messbericht')}
          </a>
          <button type="button" className="btn" onClick={metrics.reload}>
            {t('Aktualisieren')}
          </button>
        </div>
      </header>
      {metrics.error && <p className="note">{metrics.error}</p>}

      <div className="kpis">
        <div>
          <div className="label">{t('Erkennungsverzug')}</div>
          <div className="figure">
            {evaluation?.medianLatencySec !== null && evaluation?.medianLatencySec !== undefined ? formatDecimal(evaluation.medianLatencySec, 1) : '–'}
            <small>{t('s im Median')}</small>
          </div>
          <p>
            {evaluation
              ? t('{d} von {n} Ereignissen der Übung erkannt. Fehlmeldungen: {f}.', { d: evaluation.detected, n: evaluation.total, f: evaluation.falseAlarms })
              : t('Wird gemessen, sobald eine Übung läuft.')}
          </p>
        </div>
        <div>
          <div className="label">{t('Sichtungsquote')}</div>
          <div className="figure">
            {videos.length > 0 ? formatPercent(analysed / videos.length) : '–'}
            <small>{t('des Materials ausgewertet')}</small>
          </div>
          <p>
            {m
              ? t('{n} Aufzeichnungen, {d} Material, {f} Bilder im Verzeichnis.', {
                  n: videos.length,
                  d: formatDuration(m.footageSec),
                  f: m.framesAnalysed.toLocaleString(locale),
                })
              : ''}
          </p>
        </div>
        <div>
          <div className="label">{t('Protokollierte Abfragen')}</div>
          <div className="figure">
            {m ? m.searches.count + m.searches.blocked : '–'}
            <small>{m ? t('davon {b} abgelehnt', { b: m.searches.blocked }) : ''}</small>
          </div>
          <p>{t('Eine Antwort wird erst ausgeliefert, nachdem der Protokolleintrag geschrieben ist. Abfragen ohne Eintrag gibt es bauartbedingt nicht.')}</p>
        </div>
      </div>

      <div className="cols">
        <section className="section-gap">
          <header className="panel-head">
            <h2 className="label">{t('Übung: Ereignis und Meldung')}</h2>
            {evaluation && (
              <span className="low">
                {evaluation.alerts} {t('Meldungen')}
              </span>
            )}
          </header>
          {evaluation && evaluation.events.length > 0 ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('Ereignis')}</th>
                  <th style={{ width: 150 }}>{t('Quelle')}</th>
                  <th style={{ width: 70 }} className="num">
                    {t('Beginn')}
                  </th>
                  <th style={{ width: 70 }} className="num">
                    {t('Meldung')}
                  </th>
                  <th style={{ width: 64 }} className="num">
                    {t('Verzug')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {evaluation.events.map((e, i) => (
                  <tr key={i}>
                    <td title={e.label}>{e.label}</td>
                    <td className="dim" title={e.sourceName}>
                      {e.sourceName}
                    </td>
                    <td className="num dim">{formatExercise(e.onsetSec)}</td>
                    <td className="num">{e.detectedSec !== null ? formatExercise(e.detectedSec) : '—'}</td>
                    <td className="num strong">{e.latencySec !== null ? `${formatDecimal(e.latencySec, 1)} s` : t('nicht erkannt')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty">{t('Keine laufende oder abgeschlossene Übung. Die Übung wird im Bereich Lage gestartet.')}</p>
          )}
          <p className="hint">
            {t('Die Ereignisse und ihre Zeitpunkte stehen im Drehbuch der Übung. Eine Meldung zählt, wenn die dafür vorgesehene Wache sie an der betroffenen Quelle auslöst. Die Wachen der Übung wurden am Übungsmaterial formuliert; der Wert beschreibt das Betriebsverhalten, nicht die Übertragbarkeit auf fremdes Material.')}
          </p>
        </section>

        <section className="section-gap">
          <header className="panel-head">
            <h2 className="label">{t('Betrieb')}</h2>
          </header>
          {m && (
            <dl className="kv">
              <div>
                <dt>{t('Auswertung')}</dt>
                <dd>{m.analysisSpeed !== null ? t('{x}-fache Echtzeit auf diesem Rechner', { x: formatDecimal(m.analysisSpeed, 1) }) : '–'}</dd>
              </div>
              <div>
                <dt>{t('Suchdauer')}</dt>
                <dd>
                  {m.searches.medianMs !== null ? `${Math.round(m.searches.medianMs)} ms ${t('im Median')}` : '–'}
                  {m.searches.p95Ms !== null ? ` · ${Math.round(m.searches.p95Ms)} ms (95 %)` : ''}
                </dd>
              </div>
              <div>
                <dt>{t('Verbundfragen')}</dt>
                <dd>{m.searches.federated}</dd>
              </div>
              <div>
                <dt>{t('Meldungen')}</dt>
                <dd>
                  {m.alerts.total} · {m.alerts.confirmed} {t('bestätigt')} · {m.alerts.dismissed} {t('verworfen')} · {m.alerts.open} {t('offen')}
                </dd>
              </div>
              <div>
                <dt>{t('Maskierung')}</dt>
                <dd>
                  {m.maskingActive ? t('aktiv') : t('NICHT aktiv')} · {m.facesMasked.toLocaleString(locale)} {t('Gesichter maskiert')}
                </dd>
              </div>
              <div>
                <dt>{t('Aufhebungen')}</dt>
                <dd>
                  {m.unmaskEvents} {t('mit Vier-Augen-Freigabe')}
                </dd>
              </div>
              <div>
                <dt>{t('Löschfrist')}</dt>
                <dd>{m.retentionDays > 0 ? t('{n} Tage, ausgenommen Aufnahmen in Vorgängen', { n: m.retentionDays }) : t('keine automatische Löschung')}</dd>
              </div>
              <div>
                <dt>{t('Quellen')}</dt>
                <dd>{m.sources}</dd>
              </div>
              <div>
                <dt>{t('Protokoll')}</dt>
                <dd>
                  {m.ledgerEntries} {t('Einträge')}
                </dd>
              </div>
            </dl>
          )}
        </section>
      </div>

      {card && (
        <section className="section-gap">
          <header className="panel-head">
            <h2 className="label">
              {t('Gefahrenmodell')} <span className="count">{card.name}</span> <span className="count-of">{card.version}</span>
            </h2>
            <span className="low">{t('Modellkarte')}</span>
          </header>
          <div className="cols">
            <div className="section-gap">
              <dl className="kv">
                <div>
                  <dt>{t('Trainiert auf')}</dt>
                  <dd style={{ whiteSpace: 'normal' }}>{card.trainedOn}</dd>
                </div>
                <div>
                  <dt>{t('Lizenz der Daten')}</dt>
                  <dd style={{ whiteSpace: 'normal' }}>{card.license}</dd>
                </div>
                <div>
                  <dt>{t('Bilder')}</dt>
                  <dd>
                    {card.trainImages.toLocaleString(locale)} {t('Training')} · {card.testImages.toLocaleString(locale)} {t('Test')}
                  </dd>
                </div>
                <div>
                  <dt>{t('Trefferquote')}</dt>
                  <dd>
                    {formatPercent(card.accuracy, 1)} · Makro-F1 {formatDecimal(card.macroF1, 3)}
                  </dd>
                </div>
                <div>
                  <dt>{t('Ohne Training')}</dt>
                  <dd>
                    {formatPercent(card.zeroShotAccuracy, 1)} · Makro-F1 {formatDecimal(card.zeroShotMacroF1, 3)}
                  </dd>
                </div>
                <div>
                  <dt>{t('Bildkodierer')}</dt>
                  <dd>{card.encoder}</dd>
                </div>
              </dl>
              <p className="hint">
                {t(
                  'Der Wert gilt für die Testmenge des Datensatzes, die den Trainingsbildern ähnelt. Auf fremdem Material liegt er niedriger: Im Übungsmaterial hält das Modell einen ruhigen Fluss für eine Überflutung und übersieht überflutete Wiesen; auf Bodenaufnahmen ist es nicht anwendbar. Es löst deshalb keine Meldungen aus, sondern steht als Zweitmeinung neben jeder Meldung aus einer Luftbildquelle. Frei formulierte Wachen sind der Regelfall.',
                )}
              </p>
            </div>
            <div className="section-gap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{t('Klasse')}</th>
                    <th className="num">{t('Genauigkeit')}</th>
                    <th className="num">{t('Abdeckung')}</th>
                    <th className="num">F1</th>
                    <th className="num">{t('Bilder')}</th>
                  </tr>
                </thead>
                <tbody>
                  {card.perClass.map((c) => (
                    <tr key={c.name}>
                      <td>{t(HAZARD_LABEL[c.name] ?? c.name)}</td>
                      <td className="num">{formatDecimal(c.precision, 3)}</td>
                      <td className="num">{formatDecimal(c.recall, 3)}</td>
                      <td className="num">{formatDecimal(c.f1, 3)}</td>
                      <td className="num dim">{c.support}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div>
                <div className="label" style={{ marginBottom: 8 }}>
                  {t('Verwechslungen (Zeile: tatsächlich, Spalte: erkannt)')}
                </div>
                <div className="matrix" style={{ gridTemplateColumns: `repeat(${card.classes.length}, 64px)` }}>
                  {card.confusion.flatMap((row, i) => {
                    const total = row.reduce((a, b) => a + b, 0) || 1;
                    return row.map((value, j) => {
                      const share = value / total;
                      return (
                        <span
                          key={`${i}-${j}`}
                          title={`${t(HAZARD_LABEL[card.classes[i] ?? ''] ?? '')} → ${t(HAZARD_LABEL[card.classes[j] ?? ''] ?? '')}`}
                          style={{ background: `rgba(237,237,237,${share.toFixed(3)})`, color: share > 0.5 ? '#050505' : '#8a8a8a' }}
                        >
                          {value}
                        </span>
                      );
                    });
                  })}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
