import { useEffect, useState } from 'react';
import { useLang } from '../../i18n';
import { fetchTerrain, rel, type TerrainGrid } from '../api';
import { SpaceView } from '../space/SpaceView';
import { TerrainView } from '../space/TerrainView';
import { bestWindowText, kmText, useFullFix } from '../useFixes';
import type { DatumViewProps } from './Ortung';

type Mode = 'video' | 'gelaende';

export function Raum({ node, byId, selected, go }: DatumViewProps) {
  const { t, locale } = useLang();
  const summary = selected ? byId.get(selected) : undefined;
  const { fix } = useFullFix(selected, summary);
  const [mode, setMode] = useState<Mode>('video');
  const [keyIndex, setKeyIndex] = useState(0);
  const [terrain, setTerrain] = useState<{ grid: TerrainGrid | null; error: string | null; key: string } | null>(null);
  const video = node.app?.videos.find((v) => v.id === selected) ?? null;

  const spaces = (fix?.keyframes ?? []).filter((k) => k.spaceUrl);
  const key = spaces[Math.min(keyIndex, Math.max(0, spaces.length - 1))] ?? null;
  const loc = fix?.location ?? null;
  const terrainKey = loc ? `${loc.lat.toFixed(5)},${loc.lon.toFixed(5)}` : '';

  useEffect(() => {
    setKeyIndex(0);
  }, [selected]);

  useEffect(() => {
    if (mode !== 'gelaende' || !loc || terrain?.key === terrainKey) return;
    const ctrl = new AbortController();
    const radius = Math.max(2, Math.min(8, loc.radiusKm * 2.5));
    fetchTerrain(loc.lat, loc.lon, radius, ctrl.signal)
      .then((grid) => setTerrain({ grid, error: null, key: terrainKey }))
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) setTerrain({ grid: null, error: err instanceof Error ? err.message : String(err), key: terrainKey });
      });
    return () => ctrl.abort();
  }, [mode, loc, terrainKey, terrain?.key]);

  if (!selected || !video) return <div className="dt-empty-view">{t('Im Reiter ORTUNG eine Aufnahme wählen.')}</div>;
  if (!fix) return <div className="dt-empty-view">{t('Raum wird aufgebaut …')}</div>;

  const sun = fix.sun?.at ? { azimuthDeg: fix.sun.at.azimuthDeg, elevationDeg: fix.sun.at.elevationDeg } : null;

  return (
    <div className="dt-raum">
      <div className="dt-raum-bar">
        <span className="label">
          {t('Raum')} <span className="count">{video.name.replace(/\.mp4$/i, '').toUpperCase()}</span>
        </span>
        <div className="seg" role="group" aria-label={t('Ansicht')}>
          <button type="button" className={mode === 'video' ? 'on' : ''} onClick={() => setMode('video')}>
            {t('Aus dem Video')}
          </button>
          <button type="button" className={mode === 'gelaende' ? 'on' : ''} onClick={() => setMode('gelaende')} disabled={!loc}>
            {t('Gelände')}
          </button>
        </div>
        {mode === 'video' && spaces.length > 1 && (
          <div className="seg" role="group" aria-label={t('Schlüsselbild')}>
            {spaces.map((k, i) => (
              <button key={k.frame} type="button" className={i === keyIndex ? 'on' : ''} onClick={() => setKeyIndex(i)}>
                {`${t('Bild')} ${i + 1}`}
              </button>
            ))}
          </div>
        )}
        <span className="low" style={{ marginLeft: 'auto' }}>
          {loc ? `${loc.label} · ± ${kmText(loc.radiusKm, locale)}` : t('Ort unbestimmt')}
          {bestWindowText(fix) ? ` · ${bestWindowText(fix)}` : ''}
        </span>
        <button type="button" className="text-btn" onClick={() => go('befund')}>
          {t('Zum Befund')}
        </button>
      </div>
      <div className="dt-raum-stage">
        {mode === 'video' &&
          (key ? (
            <SpaceView
              key={`${fix.videoId}:${key.frame}`}
              gridUrl={rel(key.spaceUrl)}
              imageUrl={rel(key.imageUrl)}
              label={loc?.label ?? video.name}
              headingDeg={fix.heading?.deg ?? null}
              fovDeg={fix.heading?.fovDeg ?? 62}
              sun={sun}
              onExit={() => go('befund')}
            />
          ) : (
            <div className="dt-empty-view">{t('Für diese Aufnahme ist kein Raum berechnet.')}</div>
          ))}
        {mode === 'gelaende' &&
          (terrain?.grid && loc ? (
            <TerrainView
              key={terrainKey}
              terrain={terrain.grid}
              camera={{ lat: loc.lat, lon: loc.lon, headingDeg: fix.heading?.deg ?? null, fovDeg: fix.heading?.fovDeg ?? 62 }}
              sun={sun}
              sunPath={fix.sun?.path ?? []}
              horizonProfile={fix.horizon?.profile ?? null}
              skyline={key?.skyline ?? null}
              label={loc.label}
            />
          ) : (
            <div className="dt-empty-view">{terrain?.error ?? t('Gelände wird geladen …')}</div>
          ))}
      </div>
    </div>
  );
}
