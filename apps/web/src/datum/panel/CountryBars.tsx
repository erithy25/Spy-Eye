import type { CountryProb } from '../../../../server/src/datum/contract';
import { useLang } from '../../i18n';
import { fmtPct } from './common';
import './panel.css';

export interface CountryBarsProps {
  countries: CountryProb[];
  /** How many countries are listed; the rest is summed up. Default 5. */
  limit?: number;
}

export function CountryBars({ countries, limit = 5 }: CountryBarsProps) {
  const { t } = useLang();
  const sorted = [...countries].sort((a, b) => b.p - a.p);
  const shown = sorted.slice(0, limit);
  const rest = sorted.slice(limit).reduce((sum, c) => sum + c.p, 0);
  const top = shown[0]?.p ?? 1;
  return (
    <section className="dp dp-countries" aria-label={t('Länder')}>
      <header className="dp-head">
        <h3 className="label">{t('Länder')}</h3>
        <span className="dp-head-note">{t('Wahrscheinlichkeit')}</span>
      </header>
      {shown.length === 0 && <p className="dp-empty">{t('Keine Länderschätzung.')}</p>}
      <ol className="dp-country-list">
        {shown.map((c, i) => (
          <li key={c.iso} className={i === 0 ? 'dp-country dp-country-top' : 'dp-country'}>
            <span className="dp-country-iso">{c.iso}</span>
            <span className="dp-country-name">{c.name}</span>
            <span className="dp-country-bar" aria-hidden="true">
              <span style={{ width: `${Math.max(0, Math.min(1, c.p)) * 100}%`, opacity: 0.45 + 0.55 * (c.p / top) }} />
            </span>
            <span className="dp-val">{fmtPct(c.p)}</span>
          </li>
        ))}
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
    </section>
  );
}
