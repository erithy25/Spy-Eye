import { useEffect, useMemo, useState } from 'react';
import { useLang } from '../../i18n';
import { MapCanvas, type MapMarker, type MapShape } from '../../map/MapCanvas';
import { formatCoordinate } from '../../map/geo';
import { pressable } from '../../ui';
import type { NodeConnection } from '../../useNode';
import { fetchCountries, fetchTerrain, rel, type CountryShape, type Fix } from '../api';
import { terrainContours, type ContourSet } from '../contours';
import { bestWindowText, kmText, useFullFix, zoomForRadius } from '../useFixes';

export interface DatumViewProps {
  node: NodeConnection;
  fixes: Fix[];
  byId: Map<string, Fix>;
  selected: string | null;
  select: (videoId: string | null) => void;
  go: (tab: 'ortung' | 'befund' | 'raum') => void;
}

const WORLD = { lat: 24, lon: 12, zoom: 2.25 };

/** Map geometry for one fix: uncertainty, candidates, sun and shadow, view cone, ground truth. */
export function fixShapes(fix: Fix, full: Fix | null, countries: CountryShape[], withCountries: boolean, tr: (s: string) => string = (s) => s): MapShape[] {
  const shapes: MapShape[] = [];
  const loc = fix.location;
  if (withCountries && loc && loc.radiusKm > 150) {
    const probs = new Map(fix.countries.map((c) => [c.iso, c.p]));
    const top = Math.max(0.0001, ...fix.countries.map((c) => c.p));
    for (const c of countries) {
      const p = probs.get(c.iso);
      if (!p || p / top < 0.08) continue;
      shapes.push({ kind: 'area', rings: c.polygons, opacity: p / top, label: `${c.iso} ${Math.round(p * 100)} %`, labelAt: c.centroid });
    }
  }
  for (const c of fix.candidates.slice(1, 5)) {
    shapes.push({ kind: 'circle', lat: c.lat, lon: c.lon, radiusKm: Math.max(0.3, c.radiusKm), style: 'faint' });
  }
  if (loc) {
    shapes.push({ kind: 'circle', lat: loc.lat, lon: loc.lon, radiusKm: Math.max(0.05, loc.radiusKm), style: 'dashed', label: `± ${loc.radiusKm < 1 ? `${Math.round(loc.radiusKm * 1000)} m` : `${Math.round(loc.radiusKm)} km`}` });
    const len = Math.max(0.4, Math.min(1500, loc.radiusKm * 1.8));
    const sun = (full ?? fix).sun?.at ?? null;
    if (sun && sun.elevationDeg > -6) {
      shapes.push({ kind: 'ray', lat: loc.lat, lon: loc.lon, azimuthDeg: sun.azimuthDeg, lengthKm: len, style: 'strong', label: `☉ ${Math.round(sun.azimuthDeg)}°`, arrow: false });
      shapes.push({ kind: 'ray', lat: loc.lat, lon: loc.lon, azimuthDeg: sun.shadowAzimuthDeg, lengthKm: len * 0.6, style: 'dotted', label: tr('Schatten'), arrow: true });
    }
    const heading = (full ?? fix).heading;
    if (heading) {
      shapes.push({ kind: 'wedge', lat: loc.lat, lon: loc.lon, azimuthDeg: heading.deg, spreadDeg: heading.fovDeg, lengthKm: len * 0.8, style: 'solid' });
    }
    if (fix.truth) {
      shapes.push({ kind: 'line', points: [[loc.lat, loc.lon], [fix.truth.lat, fix.truth.lon]], style: 'faint' });
    }
  }
  return shapes;
}

function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function caseLabel(name: string): string {
  return name.replace(/\.mp4$/i, '').toUpperCase();
}

export function Ortung({ node, fixes, byId, selected, select, go }: DatumViewProps) {
  const { t, locale } = useLang();
  const videos = node.app?.videos ?? [];
  const [countries, setCountries] = useState<CountryShape[]>([]);
  const [showTruth, setShowTruth] = useState(true);
  useEffect(() => {
    void fetchCountries().then(setCountries);
  }, []);

  const summary = selected ? byId.get(selected) : undefined;
  const { fix: full } = useFullFix(selected, summary);
  const current = full ?? summary ?? null;

  const rows = useMemo(() => {
    const byVideo = new Map(videos.map((v) => [v.id, v]));
    return fixes
      .map((f) => ({ fix: f, video: byVideo.get(f.videoId) }))
      .filter((r) => r.video)
      .sort((a, b) => (a.video!.name < b.video!.name ? -1 : 1));
  }, [fixes, videos]);

  const located = rows.filter((r) => r.fix.location).length;
  const withTruth = rows.filter((r) => r.fix.truth?.errorKm != null);

  const markers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = [];
    for (const { fix, video } of rows) {
      if (!fix.location) continue;
      const isSel = fix.videoId === selected;
      out.push({
        id: fix.videoId,
        lat: fix.location.lat,
        lon: fix.location.lon,
        shape: 'fix',
        label: isSel || rows.length <= 12 ? caseLabel(video!.name) : '',
        ...(isSel ? { sub: bestWindowText(fix) ?? fix.location.label } : {}),
        selected: isSel,
        dim: selected !== null && !isSel,
      });
      if (showTruth && fix.truth && (isSel || selected === null)) {
        out.push({ id: `truth:${fix.videoId}`, lat: fix.truth.lat, lon: fix.truth.lon, shape: 'truth', label: isSel ? t('Wahrheit') : '', dim: !isSel });
      }
    }
    return out;
  }, [rows, selected, showTruth, t]);

  // Terrain outline around a fix that is located to a few kilometres: contour lines from the
  // local elevation model, under the other geometry.
  const [contours, setContours] = useState<{ key: string; set: ContourSet | null } | null>(null);
  const loc = current?.status === 'ready' ? current.location : null;
  const terrainKey = loc && loc.radiusKm <= 30 ? `${loc.lat.toFixed(4)},${loc.lon.toFixed(4)},${Math.round(loc.radiusKm * 10)}` : null;
  useEffect(() => {
    if (!terrainKey || !loc) return;
    const ctrl = new AbortController();
    const radiusKm = Math.min(12, Math.max(3, loc.radiusKm * 3));
    fetchTerrain(loc.lat, loc.lon, radiusKm, ctrl.signal)
      .then((grid) => setContours({ key: terrainKey, set: terrainContours(grid) }))
      .catch(() => {
        if (!ctrl.signal.aborted) setContours({ key: terrainKey, set: null });
      });
    return () => ctrl.abort();
    // loc is read through terrainKey, which captures everything that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrainKey]);
  const terrain = contours && contours.key === terrainKey ? contours.set : null;

  const shapes = useMemo<MapShape[]>(() => {
    if (!current) return [];
    const lines: MapShape[] = (terrain?.lines ?? []).map((l) => ({ kind: 'line', points: l.points, style: l.index ? 'contour-index' : 'contour' }));
    return [...lines, ...fixShapes(current, full, countries, true, t)];
  }, [current, full, countries, t, terrain]);

  const view = current?.location
    ? { lat: current.location.lat, lon: current.location.lon, zoom: zoomForRadius(Math.max(0.3, current.location.radiusKm), current.location.lat) }
    : WORLD;
  const viewKey = current?.location ? `${current.videoId}:${current.computedAt}` : 'world';
  const key = current?.keyframes[Math.floor((current.keyframes.length - 1) / 2)] ?? null;
  const sun = current?.sun?.at ?? null;

  return (
    <div className="dt-ortung">
      <aside className="dt-list">
        <div className="pane-head">
          <h2 className="label">
            {t('Bestand')} <span className="count">{rows.length}</span>
          </h2>
          <span className="low">
            {located} {t('geortet')}
            {withTruth.length > 0 && ` · ${withTruth.filter((r) => (r.fix.truth?.errorKm ?? Infinity) <= 25).length}/${withTruth.length} ≤ 25 km`}
          </span>
        </div>
        <div className="pane-body">
          {rows.length === 0 && <p className="empty dt-pad">{t('Noch keine Aufnahmen. Im Reiter BESTAND Videos oder einen Ordner ablegen.')}</p>}
          <ul className="dt-rows">
            {rows.map(({ fix, video }) => {
              const win = bestWindowText(fix);
              const isSel = fix.videoId === selected;
              return (
                <li key={fix.videoId} className={isSel ? 'dt-row on' : 'dt-row'} {...pressable(() => select(isSel ? null : fix.videoId), isSel)}>
                  {fix.keyframes[0] ? <img className="dt-row-img" src={rel(fix.keyframes[Math.floor((fix.keyframes.length - 1) / 2)]!.imageUrl)} alt="" loading="lazy" /> : <span className="dt-row-img" />}
                  <div className="dt-row-text">
                  <div className="dt-row-top">
                    <b>{caseLabel(video!.name)}</b>
                    <span className="dt-clock">{win ?? (fix.status === 'ready' ? '––:––' : '')}</span>
                  </div>
                  <div className="dt-row-mid">
                    {fix.status === 'ready' && fix.location ? (
                      <>
                        <span className="dt-place">{fix.location.label}</span>
                        <span className="low">± {kmText(fix.location.radiusKm, locale)}</span>
                      </>
                    ) : (
                      <span className="low">
                        {fix.status === 'error'
                          ? t('Fehler bei der Ortung')
                          : video!.status !== 'ready'
                            ? t('Bilder werden ausgewertet …')
                            : fix.status === 'running'
                              ? `${t('Ortung läuft …')}${fix.trace?.length ? ` ${t(fix.trace[fix.trace.length - 1]!.label)}` : ''}`
                              : fix.status === 'ready'
                                ? t('Kein Ort bestimmbar')
                                : t('Ortung steht an')}
                      </span>
                    )}
                  </div>
                  {fix.truth?.errorKm != null && (
                    <div className="dt-row-truth">
                      {t('Abweichung')} {kmText(fix.truth.errorKm, locale)} · {fix.truth.label}
                    </div>
                  )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>

      <section className="dt-map">
        <MapCanvas
          view={view}
          viewKey={viewKey}
          markers={markers}
          shapes={shapes}
          minZoom={1}
          maxZoom={16}
          fly
          onSelect={(id) => {
            if (id === null) return;
            select(id.startsWith('truth:') ? id.slice(6) : id);
          }}
        />
        {!current && rows.length > 0 && (
          <div className="dt-hud">
            <div className="dt-hud-clock">
              {located}
              <span className="dt-hud-of">/{rows.length}</span>
            </div>
            <div className="dt-hud-sub">{t('Aufnahmen verortet')}</div>
            {withTruth.length > 0 && (
              <>
                <div className="dt-hud-coord">
                  {t('Abweichung im Median')} {kmText(medianOf(withTruth.map((r) => r.fix.truth!.errorKm!)), locale)}
                </div>
                <div className="dt-hud-sun">
                  ≤ 25 km {withTruth.filter((r) => r.fix.truth!.errorKm! <= 25).length} · ≤ 200 km {withTruth.filter((r) => r.fix.truth!.errorKm! <= 200).length} · ≤ 750 km{' '}
                  {withTruth.filter((r) => r.fix.truth!.errorKm! <= 750).length} {t('von')} {withTruth.length}
                </div>
              </>
            )}
            <div className="dt-hud-truth">{t('Eine Aufnahme wählen: Ort, Uhrzeit, Sonne, Raum.')}</div>
          </div>
        )}
        {current && current.status === 'ready' && (
          <div className="dt-hud">
            <div className="dt-hud-clock">{bestWindowText(current) ?? '––:––'}</div>
            <div className="dt-hud-sub">
              {current.time.method === 'metadata' ? t('Uhrzeit aus den Metadaten') : current.time.method === 'sun' ? t('Uhrzeit aus dem Sonnenstand') : t('Uhrzeit nicht bestimmbar')}
              {current.time.timezone ? ` · ${current.time.timezone}` : ''}
            </div>
            {current.location && (
              <div className="dt-hud-coord">
                {formatCoordinate(current.location.lat, current.location.lon)} · ± {kmText(current.location.radiusKm, locale)}
              </div>
            )}
            {sun && (
              <div className="dt-hud-sun">
                {t('Sonne')} {Math.round(sun.azimuthDeg)}° / {Math.round(sun.elevationDeg)}° · {t('Schatten')} {Math.round(sun.shadowAzimuthDeg)}°
              </div>
            )}
            {terrain && (
              <div className="dt-hud-sun">
                {t('Gelände {min}–{max} m · Höhenlinien alle {step} m', {
                  min: Math.round(terrain.minHeight).toLocaleString(locale),
                  max: Math.round(terrain.maxHeight).toLocaleString(locale),
                  step: terrain.interval,
                })}
              </div>
            )}
            {current.truth?.errorKm != null && (
              <div className="dt-hud-truth">
                {t('Abweichung zur Wahrheit')} {kmText(current.truth.errorKm, locale)}
              </div>
            )}
          </div>
        )}
        {current && key && (
          <div className="dt-strip">
            <img src={rel(key.imageUrl)} alt="" />
            <div className="dt-strip-text">
              <div className="label">{current.location?.label ?? t('Ort unbestimmt')}</div>
              <div className="low">{current.location?.countryName ?? ''}</div>
              <div className="btn-row">
                <button type="button" className="btn" onClick={() => go('befund')}>
                  {t('Befund')}
                </button>
                <button type="button" className="btn btn-solid" onClick={() => go('raum')} disabled={!current.keyframes.some((k) => k.spaceUrl)}>
                  {t('Raum betreten')}
                </button>
              </div>
            </div>
          </div>
        )}
        <div className="dt-map-tools">
          <label className="check">
            <input type="checkbox" checked={showTruth} onChange={(e) => setShowTruth(e.target.checked)} />
            {t('Wahrheit zeigen')}
          </label>
          {selected && (
            <button type="button" className="text-btn" onClick={() => select(null)}>
              {t('Weltansicht')}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
