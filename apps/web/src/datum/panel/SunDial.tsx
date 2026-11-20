import type { ReactNode } from 'react';
import type { Heading, SunPathPoint, SunReport, TimeEstimate } from '../../../../server/src/datum/contract';
import { formatDecimal } from '../../format';
import { useLang } from '../../i18n';
import { fmtDeg, fmtElev, fmtLongDate, hhmm, instantOfMinute, localMinutes, norm360, polar, rivalWindow, sunInWindow, sunOnPath, windowSpan } from './common';
import './panel.css';

export interface SunDialProps {
  sun: SunReport;
  heading: Heading | null;
  time: TimeEstimate;
}

const W = 380;
const H = 340;
const CX = 190;
const CY = 168;
const R = 116; // horizon

const HEADING_METHOD: Record<Heading['method'], string> = {
  horizon: 'aus Horizont',
  landmark: 'aus Landmarke',
  sun: 'aus Sonnenstand',
  metadata: 'aus Metadaten',
};

/** Polar projection: azimuth around (north up, east right), elevation as radius (zenith in the centre). */
function xy(az: number, el: number): [number, number] {
  return polar(CX, CY, (R * (90 - Math.max(0, Math.min(90, el)))) / 90, az);
}

/** Sun position at an instant, interpolated along the path. */
const sampleAt = sunOnPath;

/** Polyline through the sun positions of local minutes `from`..`from + span`, above the horizon only. */
function trace(path: readonly SunPathPoint[], tOf: (m: number) => number, from: number, span: number, step: number): string {
  let d = '';
  let pen = false;
  for (let m = from; m <= from + span + 0.001; m += step) {
    const p = sampleAt(path, tOf(Math.min(m, from + span)));
    if (!p || p.el < 0) {
      pen = false;
      continue;
    }
    const [x, y] = xy(p.az, p.el);
    d += `${pen ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
    pen = true;
  }
  return d;
}

export function SunDial({ sun, heading, time }: SunDialProps) {
  const { t, locale } = useLang();
  const zone = time.timezone;
  const path = [...sun.path].sort((a, b) => a.t - b.t);
  const first = path[0];
  // Local minute -> instant on the path's day, with the change of offset of a day the clocks go
  // forward or back (instantOfMinute).
  const tOf = (m: number): number => (first ? instantOfMinute(first.t, zone, m) : 0);
  const sorted = first ? [...path].sort((a, b) => localMinutes(a.t, zone) - localMinutes(b.t, zone)) : [];
  const dayFrom = sorted[0] ? localMinutes(sorted[0].t, zone) : 0;
  const daySpan = sorted.length > 1 ? localMinutes((sorted[sorted.length - 1] as SunPathPoint).t, zone) - dayFrom : 0;

  const at = sun.at;

  // ---- grid ----
  const grid: ReactNode[] = [];
  for (let a = 0; a < 360; a += 5) {
    const major = a % 30 === 0;
    const cardinal = a % 90 === 0;
    const len = cardinal ? 9 : major ? 6 : a % 10 === 0 ? 3.5 : 2;
    const [x1, y1] = polar(CX, CY, R + 1.5, a);
    const [x2, y2] = polar(CX, CY, R + 1.5 + len, a);
    grid.push(<line key={`t${a}`} x1={x1} y1={y1} x2={x2} y2={y2} className={cardinal ? 'dp-tk-major' : major ? 'dp-tk-hour' : 'dp-tk-minor'} />);
    if (major) {
      const [lx, ly] = polar(CX, CY, R + 19, a);
      const names: Record<number, string> = { 0: 'N', 90: t('O'), 180: 'S', 270: 'W' };
      grid.push(
        <text key={`l${a}`} x={lx} y={ly + 3.2} textAnchor="middle" className={cardinal ? 'dp-num dp-num-major' : 'dp-num dp-num-small'}>
          {names[a] ?? String(a).padStart(3, '0')}
        </text>,
      );
    }
  }

  // ---- hour marks on the path ----
  const hours: ReactNode[] = [];
  const sunXY = at && at.elevationDeg >= 0 ? xy(at.azimuthDeg, at.elevationDeg) : null;
  if (first) {
    for (let h = 0; h < 24; h++) {
      const p = sampleAt(path, tOf(h * 60));
      if (!p || p.el < 2) continue;
      const a = sampleAt(path, tOf(h * 60 - 6));
      const b = sampleAt(path, tOf(h * 60 + 6));
      if (!a || !b) continue;
      const [px, py] = xy(p.az, p.el);
      const [ax, ay] = xy(a.az, a.el);
      const [bx, by] = xy(b.az, b.el);
      let nx = -(by - ay);
      let ny = bx - ax;
      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;
      // Labels go to the side away from the zenith.
      if (nx * (px - CX) + ny * (py - CY) < 0) {
        nx = -nx;
        ny = -ny;
      }
      hours.push(
        <g key={h} className="dp-path-hour">
          <line x1={px - nx * 3} y1={py - ny * 3} x2={px + nx * 3.5} y2={py + ny * 3.5} />
          {h % 2 === 0 && p.el >= 8 && (!sunXY || Math.hypot(px + nx * 11 - sunXY[0], py + ny * 11 - sunXY[1]) > 16) && (
            <text x={px + nx * 11} y={py + ny * 11 + 3} textAnchor="middle">
              {String(h).padStart(2, '0')}
            </text>
          )}
        </g>,
      );
    }
  }

  // ---- events on the horizon ----
  const horizonEvent = (instant: number | null, name: string, key: string) => {
    if (instant === null) return null;
    const p = sampleAt(path, instant);
    if (!p) return null;
    const a = p.az;
    const [x1, y1] = polar(CX, CY, R - 5, a);
    const [x2, y2] = polar(CX, CY, R + 12, a);
    // The times of sunrise and sunset are on the clock dial; here only their direction, the
    // time in the title.
    return (
      <g key={key} className="dp-ev">
        <title>{`${name} ${hhmm(localMinutes(instant, zone))}`}</title>
        <line x1={x1} y1={y1} x2={x2} y2={y2} />
      </g>
    );
  };

  // ---- camera ----
  let camera: ReactNode = null;
  if (heading) {
    const a0 = heading.deg - heading.fovDeg / 2;
    const a1 = heading.deg + heading.fovDeg / 2;
    const [x0, y0] = polar(CX, CY, R, a0);
    const [x1, y1] = polar(CX, CY, R, a1);
    const [hx, hy] = polar(CX, CY, R, heading.deg);
    const [lx, ly] = polar(CX, CY, R * 0.42, heading.deg);
    camera = (
      <g className="dp-cam">
        <path d={`M${CX} ${CY}L${x0} ${y0}A${R} ${R} 0 ${heading.fovDeg > 180 ? 1 : 0} 1 ${x1} ${y1}Z`} className="dp-cam-wedge" />
        <line x1={CX} y1={CY} x2={hx} y2={hy} className="dp-cam-axis" />
        <text x={lx} y={ly + 3} textAnchor="middle" className="dp-cam-label">
          {t('Kamera')}
        </text>
      </g>
    );
  }

  // ---- shadow ----
  const shadowArrow = (a: number, ratio: number, alt: boolean): ReactNode => {
    const length = R * Math.max(0.2, Math.min(0.9, 0.16 + ratio * 0.24));
    const [tx, ty] = polar(CX, CY, length, a);
    const [h0x, h0y] = polar(tx, ty, 7, a + 180 - 24);
    const [h1x, h1y] = polar(tx, ty, 7, a + 180 + 24);
    // Label along the shaft, never upside down.
    const [mx, my] = polar(CX, CY, length / 2, a);
    const flip = norm360(a) > 180;
    const rotation = a - 90 + (flip ? 180 : 0);
    return (
      <g className={alt ? 'dp-shadow dp-shadow-alt' : 'dp-shadow'}>
        <line x1={CX} y1={CY} x2={tx} y2={ty} />
        <path d={`M${h0x} ${h0y}L${tx} ${ty}L${h1x} ${h1y}`} className="dp-shadow-head" />
        {/* The second window's shadow carries no label: it points roughly towards the shown sun,
            where a label would lie on the sun's time; the shadow row below names it. */}
        {!alt && (
          <text x={0} y={-4} textAnchor="middle" transform={`translate(${mx.toFixed(2)} ${my.toFixed(2)}) rotate(${rotation.toFixed(2)})`} className="dp-shadow-label">
            {t('Schatten')}
          </text>
        )}
      </g>
    );
  };
  const shadow: ReactNode = at && at.shadowRatio !== null && at.elevationDeg > 0 ? shadowArrow(at.shadowAzimuthDeg, at.shadowRatio, false) : null;
  // A second window as likely as the first, on the other side of noon (rivalWindow): its shadow,
  // fainter, so that the dial does not present one side of an even split as the answer.
  const rival = rivalWindow(time);
  const rivalSun = rival ? sunInWindow(sun, zone, rival) : null;
  const rivalShadow: ReactNode = shadow && rivalSun && rivalSun.shadowRatio !== null ? shadowArrow(rivalSun.shadowAzimuthDeg, rivalSun.shadowRatio, true) : null;

  // ---- sun now ----
  let sunMark: ReactNode = null;
  if (at) {
    const up = at.elevationDeg >= 0;
    const [sx, sy] = xy(at.azimuthDeg, at.elevationDeg);
    const ticks = [0, 90, 180, 270].map((a) => {
      const [x1, y1] = polar(sx, sy, 9, a);
      const [x2, y2] = polar(sx, sy, 13, a);
      return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2} />;
    });
    // Readout beside the ring on the side of the zenith: the hour labels of the path sit outside.
    // Below the horizon the ring sits on the horizon circle and the readout goes inside, under it.
    const side = sx > CX + 2 ? -1 : 1;
    const [ix, iy] = polar(CX, CY, R - 24, at.azimuthDeg);
    const lx = up ? sx + side * 17 : ix;
    const ly = up ? sy - 2 : iy - 2;
    const anchor = up ? (side > 0 ? 'start' : 'end') : 'middle';
    sunMark = (
      <g className={up ? 'dp-sun' : 'dp-sun dp-sun-down'}>
        <circle cx={sx} cy={sy} r={6} />
        {ticks}
        <text x={lx} y={ly} textAnchor={anchor} className="dp-sun-label">
          {fmtDeg(at.azimuthDeg)} / {fmtElev(at.elevationDeg)}
        </text>
        <text x={lx} y={ly + 11} textAnchor={anchor} className="dp-sun-time">
          {hhmm(localMinutes(at.at, zone))}
        </text>
      </g>
    );
  }

  const windows = time.windows.map((w, i) => (
    <path key={i} d={trace(path, tOf, w.startMin, windowSpan(w.startMin, w.endMin), 2)} className={i === 0 ? 'dp-path-win dp-path-best' : 'dp-path-win'} />
  ));

  const label = at
    ? `${t('Sonnenstand')}: ${t('Azimut')} ${fmtDeg(at.azimuthDeg)}, ${t('Höhe')} ${fmtElev(at.elevationDeg)}`
    : t('Sonnenstand');

  return (
    <section className="dp dp-sundial" aria-label={t('Sonnenstand')}>
      <header className="dp-head">
        <h3 className="label">{t('Sonnenstand')}</h3>
        {/* Without a known date the path is drawn for an assumed day, and says so. */}
        <span className="dp-head-note">{time.date ? fmtLongDate(sun.date, locale) : t('angenommen: {date}', { date: fmtLongDate(sun.date, locale) })}</span>
      </header>
      <svg className="dp-sun-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <line x1={CX - R} y1={CY} x2={CX + R} y2={CY} className="dp-cross" />
        <line x1={CX} y1={CY - R} x2={CX} y2={CY + R} className="dp-cross" />
        <circle cx={CX} cy={CY} r={(R * 2) / 3} className="dp-ring-el" />
        <circle cx={CX} cy={CY} r={R / 3} className="dp-ring-el" />
        <text x={CX + 3} y={CY - (R * 2) / 3 - 3} className="dp-el-label">
          30°
        </text>
        <text x={CX + 3} y={CY - R / 3 - 3} className="dp-el-label">
          60°
        </text>
        <circle cx={CX} cy={CY} r={R} className="dp-ring" />
        {grid}
        {camera}
        <path d={trace(path, tOf, dayFrom, daySpan, 4)} className="dp-path" />
        {windows}
        {hours}
        {horizonEvent(sun.sunrise, t('Aufgang'), 'rise')}
        {horizonEvent(sun.sunset, t('Untergang'), 'set')}
        {rivalShadow}
        {shadow}
        <path d={`M${CX - 3} ${CY}H${CX + 3}M${CX} ${CY - 3}V${CY + 3}`} className="dp-zenith" />
        {sunMark}
      </svg>

      <dl className="dp-kv">
        <div>
          <dt>{t('Sonne')}</dt>
          <dd>
            {at ? (
              <>
                <span className="dp-strong">
                  {fmtDeg(at.azimuthDeg)} / {fmtElev(at.elevationDeg)}
                </span>
                <span className="dp-low"> {t('Azimut / Höhe')}</span>
              </>
            ) : (
              <span className="dp-low">{t('keine Zeitschätzung')}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>{t('Schatten')}</dt>
          <dd>
            {at && at.shadowRatio !== null && at.elevationDeg > 0 ? (
              <>
                {t('{az}, Länge {ratio} × Objekthöhe', { az: fmtDeg(at.shadowAzimuthDeg), ratio: formatDecimal(at.shadowRatio, 1) })}
                {rival && rivalSun && rivalSun.shadowRatio !== null && (
                  <span className="dp-low">
                    {' '}
                    {t('oder {az}, Länge {ratio} ({range})', { az: fmtDeg(rivalSun.shadowAzimuthDeg), ratio: formatDecimal(rivalSun.shadowRatio, 1), range: `${hhmm(rival.startMin)}–${hhmm(rival.endMin)}` })}
                  </span>
                )}
              </>
            ) : (
              // A sun up to 0.5° above the horizon casts shadows too long to state (the server gives
              // no ratio there): it is at the horizon, not below it.
              <span className="dp-low">{at ? (at.elevationDeg > 0 ? t('Sonne am Horizont, Schatten sehr lang') : t('Sonne unter dem Horizont')) : '—'}</span>
            )}
          </dd>
        </div>
        {heading && (
          <div>
            <dt>{t('Kamera')}</dt>
            <dd>
              {fmtDeg(heading.deg)} · {t('Sichtfeld')} {Math.round(heading.fovDeg)}°
              <span className="dp-low">
                {' · '}
                {t(HEADING_METHOD[heading.method])}
              </span>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
