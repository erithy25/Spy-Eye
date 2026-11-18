import { useEffect, useState } from 'react';
import { useLang } from '../../i18n';
import { fetchTerrain, rel, type Fix, type TerrainGrid } from '../api';
import { SpaceView } from '../space/SpaceView';
import { TerrainView } from '../space/TerrainView';
import { caseLabel, placeText, radiusText } from '../labels';
import { bestWindowText, useFullFix } from '../useFixes';
import type { DatumViewProps } from './Ortung';

type Mode = 'video' | 'gelaende';

/**
 * `Keyframe.frame` of the keyframe the heading was matched on; the heading (absolute compass,
 * sun) holds only for that frame's picture and skyline. Fixes of older engine versions record it
 * only on the horizon evidence. Null when there is no heading or the frame is unknown.
 */
function headingFrame(fix: Fix): number | null {
  if (!fix.heading) return null;
  return fix.heading.frame ?? fix.evidence.find((e) => e.kind === 'horizon')?.frame ?? null;
}

export function Raum({ videos, byId, selected, go }: DatumViewProps) {
  const lang = useLang();
  const { t } = lang;
  const summary = selected ? byId.get(selected) : undefined;
  const { fix } = useFullFix(selected, summary);
  const [mode, setMode] = useState<Mode>('video');
  const [keyIndex, setKeyIndex] = useState(0);
  const [terrain, setTerrain] = useState<{ grid: TerrainGrid | null; error: string | null; key: string } | null>(null);
  const video = videos.find((v) => v.id === selected) ?? null;

  const spaces = (fix?.keyframes ?? []).filter((k) => k.spaceUrl);
  const key = spaces[Math.min(keyIndex, Math.max(0, spaces.length - 1))] ?? null;
  const loc = fix?.location ?? null;
  const terrainKey = loc ? `${loc.lat.toFixed(5)},${loc.lon.toFixed(5)}` : '';
  const matchedFrame = fix ? headingFrame(fix) : null;
  const matchedIndex = matchedFrame === null ? -1 : spaces.findIndex((k) => k.frame === matchedFrame);

  // Open on the keyframe the heading belongs to, where the compass and the sun are absolute.
  useEffect(() => {
    setKeyIndex(Math.max(0, matchedIndex));
  }, [selected, matchedIndex]);

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
  // The heading is applied to the keyframe it was matched on only; the other keyframes keep a
  // relative compass. Without a recorded frame (older fixes) it is applied as before.
  const heading = fix.heading && key && (matchedFrame === null || matchedFrame === key.frame) ? fix.heading : null;
  // The skyline the heading was matched with, for the terrain view (which has no keyframe choice).
  const matchedKey = matchedFrame === null ? key : (fix.keyframes.find((k) => k.frame === matchedFrame) ?? null);
  // The horizon profile and the heading were computed at `horizon.at`, which may lie a few
  // kilometres from the fix location; the terrain camera stands there.
  const standpoint = fix.horizon?.at ?? loc;

  return (
    <div className="dt-raum">
      <div className="dt-raum-bar">
        <span className="label">
          {t('Raum')} <span className="count">{caseLabel(video.name)}</span>
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
          {loc ? `${placeText(lang, loc, fix)} · ${radiusText(lang, loc)}` : t('Ort unbestimmt')}
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
              label={loc ? placeText(lang, loc, fix) : video.name}
              headingDeg={heading?.deg ?? null}
              fovDeg={fix.heading?.fovDeg ?? 62}
              pitchDeg={key.pitchDeg ?? 0}
              sun={sun}
              onExit={() => go('befund')}
            />
          ) : (
            <div className="dt-empty-view">
              {fix.stage === 'quick' ? t('Die Räume folgen, sobald die Auswertung des Videos fertig ist.') : t('Für diese Aufnahme ist kein Raum berechnet.')}
            </div>
          ))}
        {mode === 'gelaende' &&
          (terrain?.grid && loc && standpoint ? (
            <TerrainView
              key={terrainKey}
              terrain={terrain.grid}
              camera={{
                lat: standpoint.lat,
                lon: standpoint.lon,
                headingDeg: fix.heading?.deg ?? null,
                fovDeg: fix.heading?.fovDeg ?? 62,
                pitchDeg: fix.heading?.pitchDeg,
                aspect: fix.heading?.aspect,
              }}
              sun={sun}
              sunPath={fix.sun?.path ?? []}
              horizonProfile={fix.horizon?.profile ?? null}
              skyline={matchedKey?.skyline ?? null}
              label={placeText(lang, loc, fix)}
            />
          ) : (
            <div className="dt-empty-view">{terrain?.error ? t(terrain.error) : t('Gelände wird geladen …')}</div>
          ))}
      </div>
    </div>
  );
}
