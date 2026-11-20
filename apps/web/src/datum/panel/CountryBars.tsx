import type { CountryProb } from '../../../../server/src/datum/contract';
import { useLang } from '../../i18n';
import { countryRows, type CountryList } from '../segments';
import { fmtPct } from './common';
import './panel.css';

export interface CountryBarsProps {
  countries: CountryProb[];
  /** How many countries are listed; the rest is summed up. Default 5. */
  limit?: number;
  /**
   * Country of the place the result states (the header's), if any. Its row is marked, and listed
   * even where it is not among the first `limit`: the list's first country need not be the place's
   * (a probability per country over all the evidence, or the world model's mass per country where
   * it gave the place).
   */
  answer?: string | null;
  /**
   * What the list is (segments.ts countryListOf): the probability per country (default), the
   * world model's mass per country (it gave the place), or the stretches' shares of the recording
   * time, which keep the server's order (the place's own country first).
   */
  list?: CountryList;
}

export function CountryBars({ countries, limit = 5, answer = null, list = 'probability' }: CountryBarsProps) {
  const { t, region } = useLang();
  const { sorted, shown, extra, rest, answerRow, apart } = countryRows(countries, list, limit, answer);
  const top = Math.max(1e-9, ...shown.map((c) => c.p));
  // Where the place's country is not the list's first, the list says what it is.
  const note = (land: string, p: string): string =>
    list === 'shares'
      ? t('Der Ort oben liegt in {land} ({p} der Aufnahmezeit); die Liste ist die Aufnahmezeit je Land.', { land, p })
      : list === 'worldmodel'
        ? t('Der Ort oben liegt in {land} ({p}): dort hat das Weltmodell seine stärkste Häufung, in anderen Ländern mehr verteilte Wahrscheinlichkeit.', { land, p })
        : t('Der Ort oben liegt in {land} ({p}); die Liste ist die Wahrscheinlichkeit je Land über alle Hinweise.', { land, p });
  return (
    <section className="dp dp-countries" aria-label={t('Länder')}>
      <header className="dp-head">
        <h3 className="label">{t('Länder')}</h3>
        <span className="dp-head-note">{list === 'shares' ? t('Anteil der Aufnahmezeit') : list === 'worldmodel' ? t('Weltmodell, je Land') : t('Wahrscheinlichkeit')}</span>
      </header>
      {shown.length === 0 && <p className="dp-empty">{t('Keine Länderschätzung.')}</p>}
      <ol className="dp-country-list">
        {shown.map((c, i) => {
          const classes = ['dp-country', i === 0 ? 'dp-country-top' : '', c === answerRow ? 'dp-country-answer' : '', c === extra ? 'dp-country-extra' : ''].filter((x) => x !== '');
          return (
            <li key={c.iso} className={classes.join(' ')} title={c === answerRow ? t('Land des Orts oben') : undefined}>
              <span className="dp-country-iso">{c.iso}</span>
              <span className="dp-country-name">{region(c.iso, c.name)}</span>
              <span className="dp-country-bar" aria-hidden="true">
                <span style={{ width: `${Math.max(0, Math.min(1, c.p)) * 100}%`, opacity: 0.45 + 0.55 * (c.p / top) }} />
              </span>
              <span className="dp-val">{fmtPct(c.p)}</span>
            </li>
          );
        })}
        {rest > 0.0005 && (
          <li className="dp-country dp-country-rest">
            <span className="dp-country-iso">··</span>
            <span className="dp-country-name">{t('Übrige ({n})', { n: sorted.length - shown.length })}</span>
            <span className="dp-country-bar" aria-hidden="true">
              <span style={{ width: `${Math.min(1, rest) * 100}%` }} />
            </span>
            <span className="dp-val">{fmtPct(rest)}</span>
          </li>
        )}
      </ol>
      {apart && answerRow && <p className="dp-country-note">{note(region(answerRow.iso, answerRow.name), fmtPct(answerRow.p))}</p>}
    </section>
  );
}
