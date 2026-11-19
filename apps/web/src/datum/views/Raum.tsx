import { useEffect, useMemo, useState } from 'react';
import { useLang } from '../../i18n';
import { fetchTerrain, rel, type Fix, type TerrainGrid } from '../api';
import { SpaceView } from '../space/SpaceView';
import { TerrainView } from '../space/TerrainView';
import { caseLabel, placeText, zoneDoubt } from '../labels';
import { SegmentTimeline } from '../panel/SegmentTimeline';
import { chosenStretch, placesLowerBound, segmentSummary, spacedStretches, spanText, stretchClock, stretchSpaces, timedStretches } from '../segments';
import { useFullFix, windowText } from '../useFixes';
import type { DatumViewProps, StretchProps } from './Ortung';

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

export function Raum({ videos, byId, selected, go, stretch, chooseStretch }: DatumViewProps & StretchProps) {
  const lang = useLang();
  const { t } = lang;
  const summary = selected ? byId.get(selected) : undefined;
  const { fix } = useFullFix(selected, summary);
  const [mode, setMode] = useState<Mode>('video');
  const [keyIndex, setKeyIndex] = useState(0);
  const [terrain, setTerrain] = useState<{ grid: TerrainGrid | null; error: string | null; key: string } | null>(null);
  const video = videos.find((v) => v.id === selected) ?? null;

  // A recording of several places whose stretches have their own time and spaces (engine 11): RAUM
  // enters the stretch chosen in BEFUND and offers the others. Older fixes show the fix's spaces.
  const segments = fix?.segments && fix.segments.length > 1 && timedStretches(fix) ? fix.segments : null;
  const index = fix && segments ? chosenStretch(fix, stretch) : null;
  const chosen = segments && index !== null ? (segments[index] ?? null) : null;
  const offered = useMemo(() => (fix && segments ? stretchSpaces(fix, index) : { fix: true, spaces: (fix?.keyframes ?? []).filter((k) => k.spaceUrl).map((k) => ({ frame: k.frame, imageUrl: k.imageUrl, spaceUrl: k.spaceUrl as string, pitchDeg: k.pitchDeg ?? 0 })) }), [fix, segments, index]);
  const spaces = offered.spaces;
  const key = spaces[Math.min(keyIndex, Math.max(0, spaces.length - 1))] ?? null;
  // The place of the chosen stretch (the fix's own where the fix's spaces are shown).
  const loc = offered.fix ? (fix?.location ?? null) : (chosen?.location ?? null);
  const clock = fix ? stretchClock(fix, index) : null;
  const terrainKey = loc ? `${loc.lat.toFixed(5)},${loc.lon.toFixed(5)}` : '';
  // The terrain needs a place: a stretch without one (chosen in the timeline while the terrain
  // was shown) shows the video's view, which says why; the choice of view stays for the next
  // stretch with a place.
  const view: Mode = loc ? mode : 'video';
  const matchedFrame = fix && offered.fix ? headingFrame(fix) : null;
  const matchedIndex = matchedFrame === null ? -1 : spaces.findIndex((k) => k.frame === matchedFrame);

  // Open on the keyframe the heading belongs to, where the compass and the sun are absolute.
  useEffect(() => {
    setKeyIndex(Math.max(0, matchedIndex));
  }, [selected, index, matchedIndex]);

  useEffect(() => {
    if (view !== 'gelaende' || !loc || terrain?.key === terrainKey) return;
    const ctrl = new AbortController();
    const radius = Math.max(2, Math.min(8, loc.radiusKm * 2.5));
    fetchTerrain(loc.lat, loc.lon, radius, ctrl.signal)
      .then((grid) => setTerrain({ grid, error: null, key: terrainKey }))
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) setTerrain({ grid: null, error: err instanceof Error ? err.message : String(err), key: terrainKey });
      });
    return () => ctrl.abort();
  }, [view, loc, terrainKey, terrain?.key]);

  if (!selected || !video) return <div className="dt-empty-view">{t('Im Reiter ORTUNG eine Aufnahme wählen.')}</div>;
  if (!fix) return <div className="dt-empty-view">{t('Raum wird aufgebaut …')}</div>;

  const sun = clock?.sun?.at ? { azimuthDeg: clock.sun.at.azimuthDeg, elevationDeg: clock.sun.at.elevationDeg } : null;
  // The heading is applied to the keyframe it was matched on only (one of the fix's); the other
  // keyframes and the stretches' own spaces keep a relative compass. Without a recorded frame
  // (older fixes) it is applied to the fix's keyframes as before.
  const heading = offered.fix && fix.heading && key && (matchedFrame === null || matchedFrame === key.frame) ? fix.heading : null;
  // The skyline the heading was matched with, for the terrain view (which has no keyframe choice).
  const matchedKey = offered.fix ? (matchedFrame === null ? (fix.keyframes.find((k) => k.frame === key?.frame) ?? null) : (fix.keyframes.find((k) => k.frame === matchedFrame) ?? null)) : null;
  // The horizon profile and the heading were computed at `horizon.at`, which may lie a few
  // kilometres from the fix location; the terrain camera stands there. A stretch's own place has
  // no horizon match (it is computed for the stretch the fix shows).
  const standpoint = offered.fix ? (fix.horizon?.at ?? loc) : loc;
  const place = loc ? placeText(lang, loc, fix) : t('Ort unbestimmt');
  const time = clock ? windowText(clock.time) : null;
  // A place of ± 7 500 km fixes no time zone: said next to the time, as in BEFUND.
  const doubt = time && clock?.time.timezone ? zoneDoubt(lang, loc) : null;
  const summarised = segments ? segmentSummary(fix) : null;
  const withSpace = segments ? spacedStretches(fix) : [];
  const choose = (i: number): void => chooseStretch({ videoId: fix.videoId, computedAt: fix.computedAt, index: i });

  return (
    <div className={segments ? 'dt-raum with-segs' : 'dt-raum'}>
      <div className="dt-raum-bar">
        <span className="label">
          {t('Raum')} <span className="count">{caseLabel(video.name)}</span>
        </span>
        <div className="seg" role="group" aria-label={t('Ansicht')}>
          <button type="button" className={view === 'video' ? 'on' : ''} onClick={() => setMode('video')}>
            {t('Aus dem Video')}
          </button>
          <button type="button" className={view === 'gelaende' ? 'on' : ''} onClick={() => setMode('gelaende')} disabled={!loc}>
            {t('Gelände')}
          </button>
        </div>
        {view === 'video' && spaces.length > 1 && (
          <div className="seg" role="group" aria-label={t('Schlüsselbild')}>
            {spaces.map((k, i) => (
              <button key={k.frame} type="button" className={i === keyIndex ? 'on' : ''} onClick={() => setKeyIndex(i)}>
                {`${t('Bild')} ${i + 1}`}
              </button>
            ))}
          </div>
        )}
        <span className="low dt-raum-where" title={doubt?.hint ?? undefined}>
          {place}
          {time ? ` · ${time}` : ''}
          {doubt ? ` · ${doubt.text}` : ''}
        </span>
        <button type="button" className="text-btn" onClick={() => go('befund')}>
          {t('Zum Befund')}
        </button>
      </div>
      {segments && index !== null && summarised && (
        <div className="dt-raum-segs">
          <SegmentTimeline
            fix={fix}
            segments={segments}
            selected={index}
            onSelect={choose}
            places={summarised.places.length}
            atLeast={placesLowerBound(summarised)}
            detail={false}
            caption={
              chosen
                ? `${t('Abschnitt {n} von {total}', { n: index + 1, total: segments.length })} · ${spanText(chosen)}${spaces.length > 0 ? '' : ` · ${t('kein Raum')}`}`
                : ''
            }
          />
        </div>
      )}
      <div className="dt-raum-stage">
        {view === 'video' &&
          (key ? (
            <SpaceView
              key={`${fix.videoId}:${key.frame}`}
              gridUrl={rel(key.spaceUrl)}
              imageUrl={rel(key.imageUrl)}
              label={loc ? placeText(lang, loc, fix) : video.name}
              headingDeg={heading?.deg ?? null}
              fovDeg={offered.fix ? (fix.heading?.fovDeg ?? 62) : 62}
              pitchDeg={key.pitchDeg}
              sun={sun}
              onExit={() => go('befund')}
              embedded
            />
          ) : segments && chosen ? (
            // A stretch without a space of its own: say why, and offer those that have one.
            <div className="dt-empty-view dt-raum-none">
              <p>{chosen.location ? t('Für diesen Abschnitt ist kein Raum berechnet: Räume gibt es für die längsten Abschnitte mit Ort.') : t('Dieser Abschnitt hat keinen Ort und keinen Raum.')}</p>
              {withSpace.length > 0 && (
                <div className="dt-raum-offer" role="group" aria-label={t('Abschnitte mit Raum')}>
                  <span className="label">{t('Abschnitte mit Raum')}</span>
                  {withSpace.map((i) => {
                    const s = segments[i]!;
                    const name = s.location ? placeText(lang, s.location, fix) : '';
                    return (
                      <button key={i} type="button" className="text-btn" onClick={() => choose(i)} title={`${spanText(s)} · ${name}`}>
                        {`${i + 1} · ${name}`}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="dt-empty-view">
              {fix.stage === 'quick' ? t('Die Räume folgen, sobald die Auswertung des Videos fertig ist.') : t('Für diese Aufnahme ist kein Raum berechnet.')}
            </div>
          ))}
        {view === 'gelaende' &&
          (terrain?.grid && loc && standpoint && terrain.key === terrainKey ? (
            <TerrainView
              key={terrainKey}
              terrain={terrain.grid}
              camera={{
                lat: standpoint.lat,
                lon: standpoint.lon,
                headingDeg: offered.fix ? (fix.heading?.deg ?? null) : null,
                fovDeg: offered.fix ? (fix.heading?.fovDeg ?? 62) : 62,
                pitchDeg: offered.fix ? fix.heading?.pitchDeg : undefined,
                aspect: offered.fix ? fix.heading?.aspect : undefined,
              }}
              sun={sun}
              sunPath={clock?.sun?.path ?? []}
              sunrise={clock?.sun?.sunrise ?? null}
              sunset={clock?.sun?.sunset ?? null}
              timezone={clock?.time.timezone ?? null}
              horizonProfile={offered.fix ? (fix.horizon?.profile ?? null) : null}
              skyline={matchedKey?.skyline ?? null}
              label={placeText(lang, loc, fix)}
              embedded
            />
          ) : (
            <div className="dt-empty-view">{terrain?.error && terrain.key === terrainKey ? t(terrain.error) : t('Gelände wird geladen …')}</div>
          ))}
      </div>
    </div>
  );
}
