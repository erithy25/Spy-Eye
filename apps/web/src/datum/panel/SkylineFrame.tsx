import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Heading } from '../../../../server/src/datum/contract';
import { useLang } from '../../i18n';
import { fmtDeg, norm360 } from './common';
import './panel.css';

export interface SkylineFrameProps {
  imageUrl: string;
  /** Per column (left to right) the normalised y of the sky boundary (0 = top, 1 = bottom). */
  skyline: number[] | null;
  /** Terrain horizon where the heading was computed (`HorizonMatch.profile`): elevation angle (deg) for azimuth 0..359. */
  horizonProfile?: number[] | null;
  /** The heading; pass it only for the keyframe it was matched on (`Heading.frame`). */
  heading?: Heading | null;
  /** Camera pitch (deg, positive = looking up); defaults to the pitch the match solved (`Heading.pitchDeg`), else level. */
  pitchDeg?: number;
  alt?: string;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Where a direction (azimuth offset from the heading, elevation; degrees) appears in the frame,
 * as normalised u (0..1, left to right) and y (0..1, top to bottom), or null behind the camera.
 * The inverse of the camera model of the skyline match (horizon.ts `imageRay`, documented at
 * `Heading.pitchDeg`): pinhole, square pixels, no roll, focal length f = 0.5 / tan(fov / 2) in
 * image widths.
 */
function frameOf(azOffDeg: number, elDeg: number, f: number, aspect: number, pitchDeg: number): { u: number; y: number } | null {
  const a = rad(azOffDeg);
  const e = rad(elDeg);
  // Level frame of the heading: right, forward (horizontal), up.
  const right = Math.cos(e) * Math.sin(a);
  const ahead = Math.cos(e) * Math.cos(a);
  const up = Math.sin(e);
  // Into the camera pitched by p: its axis is (ahead cos p, up sin p), its up (−ahead sin p, up cos p).
  const p = rad(pitchDeg);
  const depth = ahead * Math.cos(p) + up * Math.sin(p);
  if (depth < 1e-6) return null;
  const camUp = -ahead * Math.sin(p) + up * Math.cos(p);
  return { u: 0.5 + (right / depth) * f, y: 0.5 - (camUp / depth) * aspect * f };
}

/** Terrain elevation at an azimuth, linearly between whole degrees. */
function profileAt(profile: number[], az: number): number {
  const n = profile.length;
  const x = (norm360(az) / 360) * n;
  const i = Math.floor(x) % n;
  const f = x - Math.floor(x);
  return (profile[i] ?? 0) * (1 - f) + (profile[(i + 1) % n] ?? 0) * f;
}

export function SkylineFrame({ imageUrl, skyline, horizonProfile, heading, pitchDeg, alt }: SkylineFrameProps) {
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
  const pitch = pitchDeg ?? heading?.pitchDeg ?? 0;
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
      const f = 0.5 / Math.tan(rad(heading.fovDeg / 2));
      // The aspect the match assumed; the stage takes the picture's own once it has loaded.
      const aspect = heading.aspect !== undefined && heading.aspect > 0 ? heading.aspect : w / h;
      if (horizonProfile && horizonProfile.length >= 36) {
        // Terrain horizon projected into the frame with the solved camera: sweep the azimuth and
        // place each point (azimuth, terrain elevation) in the picture. With a pitched camera an
        // image column does not hold one azimuth, so the line cannot be drawn column by column.
        const reach = Math.min(89, heading.fovDeg / 2 + 30);
        const step = Math.max(0.05, heading.fovDeg / Math.max(60, w / 3));
        let d = '';
        let open = false;
        for (let a = -reach; a <= reach; a += step) {
          const q = frameOf(a, profileAt(horizonProfile, heading.deg + a), f, aspect, pitch);
          if (!q || q.u < -0.1 || q.u > 1.1) {
            open = false;
            continue;
          }
          d += `${open ? 'L' : 'M'}${(q.u * w).toFixed(1)} ${(q.y * h).toFixed(1)}`;
          open = true;
        }
        if (d) {
          parts.push(<path key="terrain-under" d={d} className="dp-terrain-under" />, <path key="terrain" d={d} className="dp-terrain" />);
          projected = true;
        }
      }
      // Azimuth scale along the top edge, where its ticks are drawn: on that row of a pitched
      // camera the azimuth offset a lies at X = tan(a) · (Y sin p + cos p).
      const Y0 = -0.5 / (aspect * f);
      const ahead0 = Y0 * Math.sin(rad(pitch)) + Math.cos(rad(pitch));
      const xOfAz = (az: number): number | null => {
        const d = ((((az - heading.deg) % 360) + 540) % 360) - 180;
        if (Math.abs(d) >= 89 || ahead0 <= 0) return null;
        const x = w * (0.5 + Math.tan(rad(d)) * ahead0 * f);
        return x >= 0 && x <= w ? x : null;
      };
      // Half the azimuth span of that row: wider than half the field of view when looking up.
      const halfTop = ahead0 > 0 ? Math.min(89, (Math.atan(0.5 / (f * ahead0)) * 180) / Math.PI) : 0;
      const pxPerDeg = w / Math.max(1, 2 * halfTop);
      const minorStep = pxPerDeg > 9 ? 1 : pxPerDeg > 3.5 ? 2 : 5;
      const labelStep = pxPerDeg > 6 ? 10 : 30;
      const scale: ReactNode[] = [];
      const from = Math.ceil((heading.deg - halfTop) / minorStep) * minorStep;
      for (let a = from; a <= heading.deg + halfTop; a += minorStep) {
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
            <span className="dp-low"> {pitch === 0 ? t('(Kamera waagerecht angenommen)') : `(${t('Neigung')} ${Math.round(pitch)}°)`}</span>
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
