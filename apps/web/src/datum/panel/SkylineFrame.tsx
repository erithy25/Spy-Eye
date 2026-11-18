import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Heading } from '../../../../server/src/datum/contract';
import { useLang } from '../../i18n';
import { fmtDeg, norm360 } from './common';
import './panel.css';

export interface SkylineFrameProps {
  imageUrl: string;
  /** Per column (left to right) the normalised y of the sky boundary (0 = top, 1 = bottom). */
  skyline: number[] | null;
  /** Terrain horizon at the fix: elevation angle (deg) for azimuth 0..359. */
  horizonProfile?: number[] | null;
  heading?: Heading | null;
  /** Camera pitch above the horizontal (deg); unknown in the contract, so level by default. */
  pitchDeg?: number;
  alt?: string;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Terrain elevation at an azimuth, linearly between whole degrees. */
function profileAt(profile: number[], az: number): number {
  const n = profile.length;
  const x = (norm360(az) / 360) * n;
  const i = Math.floor(x) % n;
  const f = x - Math.floor(x);
  return (profile[i] ?? 0) * (1 - f) + (profile[(i + 1) % n] ?? 0) * f;
}

export function SkylineFrame({ imageUrl, skyline, horizonProfile, heading, pitchDeg = 0, alt }: SkylineFrameProps) {
  const { t } = useLang();
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [imageUrl]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = (): void => {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) setSize({ w: Math.round(box.width), h: Math.round(box.height) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const parts: ReactNode[] = [];
  let projected = false;
  if (size) {
    const { w, h } = size;
    if (skyline && skyline.length > 1) {
      const n = skyline.length;
      const d = skyline
        .map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (n - 1)) * w).toFixed(1)} ${(Math.max(0, Math.min(1, v)) * h).toFixed(1)}`)
        .join('');
      parts.push(<path key="sky-under" d={d} className="dp-sky-under" />, <path key="sky" d={d} className="dp-sky-line" />);
    }
    if (heading) {
      const half = rad(heading.fovDeg / 2);
      const tanH = Math.tan(half);
      const tanV = tanH * (h / w);
      // Rectilinear lens: image column <-> azimuth.
      const azOfX = (x: number): number => heading.deg + (Math.atan(((x - w / 2) / (w / 2)) * tanH) * 180) / Math.PI;
      const xOfAz = (az: number): number | null => {
        const d = ((((az - heading.deg) % 360) + 540) % 360) - 180;
        if (Math.abs(d) >= heading.fovDeg / 2 + 0.001) return null;
        return w / 2 + (w / 2) * (Math.tan(rad(d)) / tanH);
      };
      if (horizonProfile && horizonProfile.length >= 36) {
        let d = '';
        for (let x = 0; x <= w; x += 3) {
          const e = profileAt(horizonProfile, azOfX(x)) - pitchDeg;
          const y = h / 2 - (h / 2) * (Math.tan(rad(e)) / tanV);
          d += `${x === 0 ? 'M' : 'L'}${x} ${y.toFixed(1)}`;
        }
        parts.push(<path key="terrain-under" d={d} className="dp-terrain-under" />, <path key="terrain" d={d} className="dp-terrain" />);
        projected = true;
      }
      // Azimuth scale along the top edge.
      const pxPerDeg = w / heading.fovDeg;
      const minorStep = pxPerDeg > 9 ? 1 : pxPerDeg > 3.5 ? 2 : 5;
      const labelStep = pxPerDeg > 6 ? 10 : 30;
      const scale: ReactNode[] = [];
      const from = Math.ceil((heading.deg - heading.fovDeg / 2) / minorStep) * minorStep;
      for (let a = from; a <= heading.deg + heading.fovDeg / 2; a += minorStep) {
        const x = xOfAz(a);
        if (x === null) continue;
        const az = norm360(a);
        const cardinal = az % 90 === 0;
        const label = az % labelStep === 0;
        const five = az % 5 === 0;
        const len = cardinal ? 11 : label ? 8 : five ? 5 : 3;
        scale.push(<line key={`t${a}`} x1={x} y1={0} x2={x} y2={len} className={label || cardinal ? 'dp-az-major' : 'dp-az-minor'} />);
        if (label || cardinal) {
          const names: Record<number, string> = { 0: 'N', 90: t('O'), 180: 'S', 270: 'W' };
          const near = Math.abs(x - w / 2) < 40;
          if (!near && x > 14 && x < w - 14)
            scale.push(
              <text key={`l${a}`} x={x} y={22} textAnchor="middle" className={cardinal ? 'dp-az-label dp-az-cardinal' : 'dp-az-label'}>
                {names[az] ?? `${az}°`}
              </text>,
            );
        }
      }
      parts.push(
        <g key="scale" className="dp-az">
          <rect x={0} y={0} width={w} height={27} className="dp-az-scrim" />
          {scale}
          <path d={`M${w / 2 - 4} 27L${w / 2 + 4} 27L${w / 2} 32Z`} className="dp-az-index" />
          <text x={w / 2} y={22} textAnchor="middle" className="dp-az-label dp-az-heading">
            {fmtDeg(heading.deg)}
          </text>
        </g>,
      );
    }
  }

  const style = ratio ? ({ aspectRatio: String(ratio) } as CSSProperties) : undefined;
  return (
    <figure className="dp dp-skyframe">
      <div className="dp-sky-stage" ref={stage} style={style}>
        {!failed ? (
          <img
            src={imageUrl}
            alt={alt ?? t('Schlüsselbild mit Silhouette')}
            onError={() => setFailed(true)}
            onLoad={(e) => {
              const { naturalWidth, naturalHeight } = e.currentTarget;
              if (naturalWidth > 0 && naturalHeight > 0) setRatio(naturalWidth / naturalHeight);
            }}
          />
        ) : (
          <span className="dp-sky-none">{t('Bild nicht verfügbar')}</span>
        )}
        {size && (
          <svg className="dp-sky-svg" viewBox={`0 0 ${size.w} ${size.h}`} width={size.w} height={size.h} aria-hidden="true">
            {parts}
          </svg>
        )}
      </div>
      <figcaption className="dp-sky-legend">
        <span className={skyline ? 'dp-leg' : 'dp-leg dp-leg-off'}>
          <i className="dp-leg-solid" />
          {skyline ? t('Silhouette') : t('keine Silhouette')}
        </span>
        {heading && horizonProfile && (
          <span className={projected ? 'dp-leg' : 'dp-leg dp-leg-off'}>
            <i className="dp-leg-dash" />
            {t('Geländehorizont')}
            <span className="dp-low"> {pitchDeg === 0 ? t('(Kamera waagerecht angenommen)') : `(${t('Neigung')} ${Math.round(pitchDeg)}°)`}</span>
          </span>
        )}
        <span className="dp-leg-right">
          {heading ? (
            <>
              {t('Blick')} {fmtDeg(heading.deg)} · {t('Sichtfeld')} {Math.round(heading.fovDeg)}°
            </>
          ) : (
            <span className="dp-low">{t('Blickrichtung unbekannt')}</span>
          )}
        </span>
      </figcaption>
    </figure>
  );
}
