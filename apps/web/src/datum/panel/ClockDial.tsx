import type { ReactNode } from 'react';
import type { SunReport, TimeEstimate } from '../../../../server/src/datum/contract';
import { useLang } from '../../i18n';
import {
  Meter,
  anchorFor,
  annulusPath,
  arcPath,
  bestMinute,
  fmtElev,
  fmtLongDate,
  fmtPct,
  fmtScore,
  hhmm,
  hhmmss,
  localMinutes,
  localSeconds,
  monthName,
  polar,
  referenceInstant,
  useSvgId,
  utcOffset,
  windowSpan,
} from './common';
import './panel.css';

export interface ClockDialProps {
  time: TimeEstimate;
  sun: SunReport | null;
}

// Geometry of the dial (SVG user units).
const W = 380;
const H = 336;
const CX = 190;
const CY = 168;
const R = 126; // outer edge of the light band
const BAND = 12; // width of the light band
const R_HOURS = 100; // hour numerals
const R_WIN = 78; // time windows
const R_PROB = 60; // probability of each window

const ang = (minute: number): number => (minute / 1440) * 360;

type Light = 0 | 1 | 2; // night (sun below −6°), civil twilight, day

interface LightRun {
  from: number;
  to: number;
  light: Light;
}

const SUNRISE_EL = -0.833;

function lightOf(el: number): Light {
  return el < -6 ? 0 : el < SUNRISE_EL ? 1 : 2;
}

/** Night, twilight and day around the local day, read from the sun path with interpolated edges. */
function lightRuns(sun: SunReport, zone: string | null): LightRun[] {
  const pts = sun.path.map((p) => ({ m: localMinutes(p.t, zone), el: p.el })).sort((a, b) => a.m - b.m);
  const first = pts[0];
  if (!first || pts.length < 2) {
    if (sun.sunrise === null || sun.sunset === null) return [];
    const rise = localMinutes(sun.sunrise, zone);
    const set = localMinutes(sun.sunset, zone);
    return [
      { from: set, to: rise, light: 0 },
      { from: rise, to: set, light: 2 },
    ];
  }
  const runs: LightRun[] = [];
  const thresholds = [-6, SUNRISE_EL];
  let start = first.m <= 15 ? 0 : first.m;
  let current = lightOf(first.el);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as { m: number; el: number };
    const b = pts[i] as { m: number; el: number };
    const target = lightOf(b.el);
    while (current !== target) {
      const next = (target > current ? current + 1 : current - 1) as Light;
      const threshold = thresholds[Math.min(current, next)] as number;
      const f = b.el === a.el ? 0.5 : (threshold - a.el) / (b.el - a.el);
      const m = a.m + Math.max(0, Math.min(1, f)) * (b.m - a.m);
      runs.push({ from: start, to: m, light: current });
      start = m;
      current = next;
    }
  }
  const last = pts[pts.length - 1] as { m: number };
  runs.push({ from: start, to: last.m >= 1425 ? 1440 : last.m, light: current });
  // The dial is a circle: the run before midnight continues after it.
  const head = runs[0];
  const tail = runs[runs.length - 1];
  if (runs.length > 1 && head && tail && head.light === tail.light && head.from === 0 && tail.to === 1440) {
    runs.shift();
    tail.to = head.to;
  }
  return runs.filter((run) => run.light !== 2 && run.to !== run.from);
}

export function ClockDial({ time, sun }: ClockDialProps) {
  const { t, locale, pickList } = useLang();
  const id = useSvgId('dp-clock');
  const zone = time.timezone;
  const best = bestMinute(time, sun?.at?.at ?? null);
  const instant = referenceInstant(time, sun);
  const offset = utcOffset(zone, instant);
  const rise = sun?.sunrise != null ? localMinutes(sun.sunrise, zone) : null;
  const set = sun?.sunset != null ? localMinutes(sun.sunset, zone) : null;
  const noon = sun?.solarNoon != null ? localMinutes(sun.solarNoon, zone) : null;
  const runs = sun ? lightRuns(sun, zone) : [];
  const maxP = Math.max(0.0001, ...time.windows.map((w) => w.probability));
  const exact = time.method === 'metadata' && time.utc !== null;
  const top = time.windows[0];

  // ---- readout ----
  let readout: string;
  let plusMinus: string | null = null;
  if (exact && time.utc !== null) readout = hhmmss(localSeconds(time.utc, zone));
  else if (top) {
    readout = `${hhmm(top.startMin)} – ${hhmm(top.endMin)}`;
    const half = Math.max(1, Math.round(windowSpan(top.startMin, top.endMin) / 2));
    plusMinus = half < 90 ? `± ${half} min` : `± ${Math.floor(half / 60)} h${half % 60 ? ` ${half % 60} min` : ''}`;
  } else readout = '––:––';

  const methodText =
    time.method === 'metadata' ? t('aus Metadaten') : time.method === 'sun' ? t('aus Sonnenhöhe') : t('keine Schätzung');

  let dateText: string;
  let dateNote: string | null = null;
  if (time.date) {
    dateText = fmtLongDate(time.date, locale);
    dateNote =
      time.dateSource === 'metadata'
        ? t('aus Metadaten')
        : time.dateSource === 'filename'
          ? t('aus Dateiname')
          : time.dateSource === 'season'
            ? t('geschätzt')
            : null;
  } else if (time.monthRange) {
    const [a, b] = time.monthRange;
    dateText = a === b ? monthName(a, locale) : `${monthName(a, locale)} – ${monthName(b, locale)}`;
    dateNote = t('geschätzt');
  } else dateText = t('Datum unbekannt');

  const phaseText: Record<TimeEstimate['phase'], string> = {
    night: t('Nacht'),
    twilight: t('Dämmerung'),
    golden: t('Goldene Stunde'),
    day: t('Tag'),
    unknown: t('unbekannt'),
  };

  // ---- dial parts ----
  const ticks: ReactNode[] = [];
  for (let q = 0; q < 96; q++) {
    const hour = q % 4 === 0;
    const six = q % 24 === 0;
    const len = six ? 9 : hour ? 5 : 2.5;
    const [x1, y1] = polar(CX, CY, R + 1.5, q * 3.75);
    const [x2, y2] = polar(CX, CY, R + 1.5 + len, q * 3.75);
    ticks.push(<line key={q} x1={x1} y1={y1} x2={x2} y2={y2} className={six ? 'dp-tk-major' : hour ? 'dp-tk-hour' : 'dp-tk-minor'} />);
  }
  const numerals = Array.from({ length: 8 }, (_, i) => i * 3).map((h) => {
    const [x, y] = polar(CX, CY, R_HOURS, h * 15);
    return (
      <text key={h} x={x} y={y + 3.2} textAnchor="middle" className={h % 6 === 0 ? 'dp-num dp-num-major' : 'dp-num'}>
        {String(h).padStart(2, '0')}
      </text>
    );
  });

  const event = (minute: number | null, name: string, key: string, strong: boolean) => {
    if (minute === null) return null;
    const a = ang(minute);
    const [x1, y1] = polar(CX, CY, R - BAND - 4, a);
    const [x2, y2] = polar(CX, CY, R + 13, a);
    const [lx, ly] = polar(CX, CY, R + 22, a);
    const anchor = anchorFor(a);
    const below = Math.cos((a * Math.PI) / 180) < -0.3;
    const dy = below ? 9 : Math.cos((a * Math.PI) / 180) > 0.3 ? -6 : 1;
    return (
      <g key={key} className={strong ? 'dp-ev' : 'dp-ev dp-ev-soft'}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} />
        <text x={lx} y={ly + dy} textAnchor={anchor} className="dp-ev-time">
          {hhmm(minute)}
        </text>
        <text x={lx} y={ly + dy + 10} textAnchor={anchor} className="dp-ev-name">
          {name}
        </text>
      </g>
    );
  };

  const windowArcs = time.windows.map((w, i) => {
    const rel = w.probability / maxP;
    const a0 = ang(w.startMin);
    let a1 = ang(w.startMin + windowSpan(w.startMin, w.endMin));
    if (a1 - a0 < 1.2) a1 = a0 + 1.2;
    const strokeWidth = 1.5 + 8 * w.probability;
    const opacity = 0.32 + 0.68 * rel;
    const [p0x0, p0y0] = polar(CX, CY, R_WIN - 7, a0);
    const [p0x1, p0y1] = polar(CX, CY, R_WIN + 7, a0);
    const [p1x0, p1y0] = polar(CX, CY, R_WIN - 7, a1);
    const [p1x1, p1y1] = polar(CX, CY, R_WIN + 7, a1);
    // Past the end edge, clockwise, so the hand (in the middle of the best window) never covers it.
    const [lx, ly] = polar(CX, CY, R_PROB, a1 + 12);
    return (
      <g key={i} opacity={opacity}>
        <path d={arcPath(CX, CY, R_WIN, a0, a1)} className="dp-win" strokeWidth={strokeWidth} />
        <line x1={p0x0} y1={p0y0} x2={p0x1} y2={p0y1} className="dp-win-edge" />
        <line x1={p1x0} y1={p1y0} x2={p1x1} y2={p1y1} className="dp-win-edge" />
        {!exact && (
          <text x={lx} y={ly + 3} textAnchor="middle" className="dp-win-p">
            {fmtPct(w.probability)}
          </text>
        )}
      </g>
    );
  });

  let hand: ReactNode = null;
  if (best !== null) {
    const a = ang(best);
    const [tx, ty] = polar(CX, CY, R - 4, a);
    const [bx, by] = polar(CX, CY, -12, a);
    const [i0x, i0y] = polar(CX, CY, R + 12, a - 2.2);
    const [i1x, i1y] = polar(CX, CY, R + 12, a + 2.2);
    const [i2x, i2y] = polar(CX, CY, R + 4, a);
    hand = (
      <g className="dp-hand">
        <line x1={bx} y1={by} x2={tx} y2={ty} />
        <path d={`M${i0x} ${i0y}L${i1x} ${i1y}L${i2x} ${i2y}Z`} className="dp-hand-index" />
        <circle cx={CX} cy={CY} r={3.2} className="dp-hand-pivot" />
      </g>
    );
  }

  const label = `${t('Uhrzeit')}: ${readout}${plusMinus ? ` ${plusMinus}` : ''}, ${zone ?? 'UTC'}`;

  return (
    <section className="dp dp-clock" aria-label={t('Uhrzeit')}>
      <header className="dp-head">
        <h3 className="label">{t('Uhrzeit')}</h3>
        <span className="dp-head-note">{methodText}</span>
      </header>
      <svg className="dp-clock-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <defs>
          <pattern id={`${id}-night`} width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0.5" y1="0" x2="0.5" y2="3" className="dp-hatch-night" />
          </pattern>
          <pattern id={`${id}-dusk`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0.5" y1="0" x2="0.5" y2="5" className="dp-hatch-dusk" />
          </pattern>
        </defs>
        {runs.map((run, i) => (
          <path
            key={i}
            d={annulusPath(CX, CY, R - BAND, R, ang(run.from), ang(run.to))}
            fill={`url(#${id}-${run.light === 0 ? 'night' : 'dusk'})`}
          />
        ))}
        <circle cx={CX} cy={CY} r={R} className="dp-ring" />
        <circle cx={CX} cy={CY} r={R - BAND} className="dp-ring-inner" />
        <circle cx={CX} cy={CY} r={R_WIN} className="dp-ring-faint" />
        {ticks}
        {numerals}
        {windowArcs}
        {event(rise, t('Aufgang'), 'rise', true)}
        {event(set, t('Untergang'), 'set', true)}
        {event(noon, t('Mittag'), 'noon', false)}
        {hand}
      </svg>

      <div className="dp-clock-read">
        <div className="dp-big-row">
          <span className={time.method === 'none' ? 'dp-big dp-big-off' : 'dp-big'}>{readout}</span>
          {exact && <span className="dp-tag dp-tag-on">{t('exakt')}</span>}
          {plusMinus && <span className="dp-pm">{plusMinus}</span>}
        </div>
        <div className="dp-line">
          <span>{zone ?? t('Zeitzone unbekannt')}</span>
          <span className="dp-sep">,</span>
          <span>{offset}</span>
          {!zone && <span className="dp-low"> · {t('Ort unbekannt')}</span>}
        </div>
        <div className="dp-line">
          <span>{dateText}</span>
          {dateNote && <span className="dp-low"> · {dateNote}</span>}
        </div>
        <div className="dp-line dp-low">
          {t('Licht')}: {phaseText[time.phase]}
          {time.sunElevationBand && (
            <>
              {' · '}
              {t('Sonnenhöhe')} {fmtElev(time.sunElevationBand[0])}–{fmtElev(time.sunElevationBand[1])}
            </>
          )}
        </div>
        <div className="dp-conf">
          <span className="dp-key">{t('Konfidenz')}</span>
          <Meter value={time.confidence} label={t('Konfidenz')} ticks />
          <span className="dp-val">{fmtScore(time.confidence)}</span>
        </div>
        {time.windows.length > 0 && !exact && (
          <ol className="dp-windows" aria-label={t('Zeitfenster')}>
            {time.windows.map((w, i) => (
              <li key={i} className={i === 0 ? 'dp-window dp-window-best' : 'dp-window'}>
                <span className="dp-rank">{i + 1}</span>
                <span className="dp-window-time">
                  {hhmm(w.startMin)}–{hhmm(w.endMin)}
                </span>
                <span className="dp-window-label">{t(w.label)}</span>
                <Meter value={w.probability} label={t('Wahrscheinlichkeit')} />
                <span className="dp-val">{fmtPct(w.probability)}</span>
              </li>
            ))}
          </ol>
        )}
        {time.notes.length > 0 && (
          <ul className="dp-notes">
            {pickList(time.notes, time.notesEn).map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
