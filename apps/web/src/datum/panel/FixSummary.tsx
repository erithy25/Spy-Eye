import type { Fix } from '../../../../server/src/datum/contract';
import { formatDateTime, formatDecimal } from '../../format';
import { useLang } from '../../i18n';
import { haversineKm, toMgrs } from '../../map/geo';
import { placeText } from '../labels';
import { Meter, coordParts, fmtCoord, fmtKm, fmtScore, kindCode, kindMethod } from './common';
import './panel.css';

export interface FixSummaryProps {
  fix: Fix;
}

const STATUS: Record<Fix['status'], string> = {
  pending: 'Wartet',
  running: 'Läuft',
  ready: 'Bereit',
  error: 'Fehler',
};

// Precision scale: 10 m .. 1000 km, logarithmic.
const LOG_MIN = -2;
const LOG_MAX = 3;
const scalePos = (km: number): number => (Math.max(LOG_MIN, Math.min(LOG_MAX, Math.log10(Math.max(km, 1e-6)))) - LOG_MIN) / (LOG_MAX - LOG_MIN);
const DECADES = [
  { km: 0.01, text: '10 m' },
  { km: 0.1, text: '100 m' },
  { km: 1, text: '1 km' },
  { km: 10, text: '10 km' },
  { km: 100, text: '100 km' },
  { km: 1000, text: '1000 km' },
];

/** Radius of the fix (and the error against the truth) on a logarithmic scale from a building to a continent. */
function PrecisionScale({ radiusKm, errorKm }: { radiusKm: number; errorKm: number | null }) {
  const { t } = useLang();
  const minor: number[] = [];
  for (let d = LOG_MIN; d < LOG_MAX; d++) for (let k = 2; k <= 9; k++) minor.push(scalePos(k * 10 ** d));
  const at = scalePos(radiusKm);
  return (
    <div className="dp-scale" role="img" aria-label={t('Radius {r} auf der Skala von 10 m bis 1000 km', { r: fmtKm(radiusKm) })}>
      <div className="dp-scale-track">
        <span className="dp-scale-fill" style={{ width: `${at * 100}%` }} />
        {minor.map((p, i) => (
          <i key={i} className="dp-scale-minor" style={{ left: `${p * 100}%` }} />
        ))}
        {DECADES.map((d) => (
          <i key={d.km} className="dp-scale-major" style={{ left: `${scalePos(d.km) * 100}%` }} />
        ))}
        <b className="dp-scale-mark" style={{ left: `${at * 100}%` }} />
        {errorKm !== null && <b className="dp-scale-err" style={{ left: `${scalePos(errorKm) * 100}%` }} title={t('Abweichung')} />}
      </div>
      <div className="dp-scale-labels" aria-hidden="true">
        {DECADES.map((d, i) => (
          <span key={d.km} style={{ left: `${scalePos(d.km) * 100}%` }} className={i === 0 ? 'dp-first' : i === DECADES.length - 1 ? 'dp-last' : undefined}>
            {d.text}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Decimal places that the radius still supports (one degree of latitude is 111 km); the places
 * beyond are shown faint, so five decimals never pretend to be metre-exact.
 */
function significantDecimals(radiusKm: number): number {
  const deg = Math.max(radiusKm, 0.001) / 111.32;
  return Math.max(0, Math.min(5, Math.floor(-Math.log10(deg)) + 1));
}

function Digits({ value, decimals }: { value: string; decimals: number }) {
  const dot = value.indexOf('.');
  const cut = dot < 0 ? value.length : decimals === 0 ? dot : dot + 1 + decimals;
  return (
    <span className="dp-coord-v">
      {value.slice(0, cut)}
      <span className="dp-coord-x">{value.slice(cut)}</span>
    </span>
  );
}

/** Where a ground truth comes from, in words: the reference set, the analyst's own list, or a link. */
function TruthSource({ source, url }: { source: string; url: string | undefined }) {
  const { t } = useLang();
  const link = url ?? (/^https?:\/\//.test(source) ? source : null);
  const name = source === 'referenz' ? t('Referenzbestand') : source === 'eigene' ? t('eigene Angabe') : link ? null : source;
  return (
    <>
      {name}
      {link && (
        <>
          {name ? ' · ' : ''}
          <a href={link} target="_blank" rel="noreferrer noopener" className="dp-link">
            {/commons\.wikimedia/.test(link) ? 'Wikimedia Commons' : /wikidata/.test(link) ? 'Wikidata' : t('Quelle')}
          </a>
        </>
      )}
    </>
  );
}

export function FixSummary({ fix }: FixSummaryProps) {
  const lang = useLang();
  const { t, locale, region } = lang;
  const loc = fix.location;
  const truth = fix.truth;
  const errorKm = truth && loc ? (truth.errorKm ?? haversineKm(loc.lat, loc.lon, truth.lat, truth.lon)) : (truth?.errorKm ?? null);
  const head = (
    <header className="dp-head">
      <h3 className="label">{t('Fix')}</h3>
      <span className="dp-head-note">
        <span className={`dp-status dp-status-${fix.status}`}>
          {fix.status === 'running' && <span className="blink" aria-hidden="true" />}
          {t(STATUS[fix.status])}
        </span>
        {fix.status === 'ready' && (
          <>
            {' · '}
            {formatDecimal(fix.elapsedMs / 1000, 1)} s · {formatDateTime(fix.computedAt, locale)}
          </>
        )}
      </span>
    </header>
  );

  if (fix.status !== 'ready') {
    const text =
      fix.status === 'pending'
        ? t('Das Video wartet auf die Auswertung.')
        : fix.status === 'running'
          ? t('Auswertung läuft: Schlüsselbilder, Referenzabgleich, Horizont und Sonnenstand.')
          : t('Die Auswertung ist fehlgeschlagen.');
    return (
      <section className="dp dp-fix" aria-label={t('Fix')} aria-busy={fix.status === 'running'}>
        {head}
        <div className={`dp-fix-state dp-fix-state-${fix.status}`} role={fix.status === 'error' ? 'alert' : 'status'}>
          <span className="dp-big dp-big-off">{fix.status === 'error' ? '×' : '––.–––––  ––.–––––'}</span>
          <p>{text}</p>
          {fix.status === 'error' && fix.error && <p className="dp-fix-error">{fix.error}</p>}
        </div>
      </section>
    );
  }

  if (!loc) {
    return (
      <section className="dp dp-fix" aria-label={t('Fix')}>
        {head}
        <div className="dp-fix-state" role="status">
          <span className="dp-big dp-big-off">––.–––––  ––.–––––</span>
          <p>{t('Kein Ort bestimmbar: die Evidenz reicht für keine Ortung.')}</p>
        </div>
      </section>
    );
  }

  const c = coordParts(loc.lat, loc.lon);
  const mgrs = toMgrs(loc.lat, loc.lon);
  const sig = significantDecimals(loc.radiusKm);
  return (
    <section className="dp dp-fix" aria-label={t('Fix')}>
      {head}
      <div
        className="dp-coord"
        role="group"
        aria-label={`${t('Position')} ${fmtCoord(loc.lat, loc.lon)}`}
        title={t('Blasse Stellen liegen unterhalb der Genauigkeit des Fixes.')}
      >
        <Digits value={c.lat} decimals={sig} />
        <span className="dp-coord-h">°{c.ns}</span>
        <Digits value={c.lon} decimals={sig} />
        <span className="dp-coord-h">°{c.ew}</span>
      </div>
      <div className="dp-fix-grid">
        <div>
          <span className="dp-key">MGRS</span>
          <span className="dp-mgrs">{mgrs}</span>
        </div>
        <div>
          <span className="dp-key">{t('Radius')}</span>
          <span className="dp-radius">± {fmtKm(loc.radiusKm)}</span>
        </div>
      </div>
      <PrecisionScale radiusKm={loc.radiusKm} errorKm={errorKm} />
      <p className="dp-place">
        <span className="dp-strong">{placeText(lang, loc, fix)}</span>
        {loc.country && (
          <span className="dp-mid">
            {' · '}
            {region(loc.country, loc.countryName)} ({loc.country})
          </span>
        )}
      </p>
      <dl className="dp-kv">
        <div>
          <dt>{t('Methode')}</dt>
          <dd>
            <span className="dp-code">{t(kindCode(loc.method))}</span> {t(kindMethod(loc.method))}
          </dd>
        </div>
        <div>
          <dt>{t('Konfidenz')}</dt>
          <dd className="dp-kv-meter">
            <Meter value={loc.confidence} label={t('Konfidenz')} ticks />
            <span className="dp-val">{fmtScore(loc.confidence)}</span>
          </dd>
        </div>
      </dl>
      {truth && (
        <div className="dp-truth">
          <span className="dp-key">{t('Grundwahrheit')}</span>
          <p>
            <span className="dp-strong">{truth.label}</span>
            <span className="dp-low"> · {fmtCoord(truth.lat, truth.lon)}</span>
          </p>
          <p>
            <i className="dp-diamond" aria-hidden="true" />
            {t('Abweichung')} <span className="dp-strong">{errorKm !== null ? fmtKm(errorKm) : '—'}</span>
            <span className="dp-low">
              {' · '}
              {t('Quelle')}: <TruthSource source={truth.source} url={truth.url} />
            </span>
          </p>
        </div>
      )}
    </section>
  );
}
