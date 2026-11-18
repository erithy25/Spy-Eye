import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { VideoInfo } from '../../api';
import { formatPercent, formatScore } from '../../format';
import { useLang } from '../../i18n';
import { MapCanvas, type MapMarker, type MapShape } from '../../map/MapCanvas';
import { formatCoordinate } from '../../map/geo';
import { Dialog, pressable } from '../../ui';
import { VIDEO_ACCEPT, dragHasFiles, filesFromDrop, uploads, useUploads, type UploadItem, type UploadOptions } from '../../uploads';
import { fetchCountries, fetchTerrain, rel, type CountryShape, type Fix } from '../api';
import { terrainContours, type ContourSet } from '../contours';
import { caseLabel, countryText, isReference, placeText, radiusText, stageOf } from '../labels';
import { CheckLinks } from '../panel/CheckLinks';
import { DatumSettingsPanel } from '../Settings';
import { TruthControl, useTruthUpload } from '../TruthUpload';
import { isTruthFile } from '../truthFile';
import { bestWindowText, kmText, useFullFix, zoomForRadius } from '../useFixes';

export interface DatumViewProps {
  /** Recordings of the node (for names, analysis progress and playback). */
  videos: VideoInfo[];
  can: (permission: string) => boolean;
  fixes: Fix[];
  byId: Map<string, Fix>;
  selected: string | null;
  select: (videoId: string | null) => void;
  go: (tab: 'ortung' | 'befund' | 'raum') => void;
}

// The whole Earth: the globe is sized to fit the map area (`fit`), centred on Europe and Africa.
const WORLD = { lat: 24, lon: 12, zoom: 2.25, fit: true };

/**
 * Own recordings go into the inbox source, sampled and described as BESTAND does by default; the
 * quick fix of the node does not depend on these settings.
 */
const OWN_UPLOAD: UploadOptions = { sampleFps: 1, detail: 'standard', sourceId: 'eingang' };

/** Map geometry for one fix: uncertainty, candidates, sun and shadow, view cone, ground truth. */
export function fixShapes(fix: Fix, full: Fix | null, countries: CountryShape[], withCountries: boolean, tr: (s: string) => string, locale: string): MapShape[] {
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
    shapes.push({ kind: 'circle', lat: loc.lat, lon: loc.lon, radiusKm: Math.max(0.05, loc.radiusKm), style: 'dashed', label: `± ${kmText(loc.radiusKm, locale)}` });
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

/**
 * The picture of a recording: its middle keyframe, chosen as the node chooses the one keyframe of
 * a slim list entry (floor(n / 2)), so that a row keeps its picture when a full summary from the
 * event stream replaces the slim entry.
 */
function middleFrame(fix: Fix | null): string | null {
  if (!fix || fix.keyframes.length === 0) return null;
  return rel(fix.keyframes[Math.floor(fix.keyframes.length / 2)]!.imageUrl);
}

/** What a recording is waiting for, or how its analysis went, in one short line. */
function progressText(fix: Fix | null, video: VideoInfo, t: (de: string, vars?: Record<string, string | number>) => string): string {
  if (fix?.status === 'error') return t('Fehler bei der Ortung');
  if (video.status === 'error') return t('Fehler bei der Auswertung');
  if (fix?.status === 'running') {
    const step = fix.trace?.[fix.trace.length - 1];
    return step ? `${t('wird geortet …')} ${t(step.label)}` : t('wird geortet …');
  }
  if (fix?.status === 'ready') return t('Kein Ort bestimmbar');
  if (video.status === 'processing') return `${t('Bilder werden ausgewertet …')} ${formatPercent(video.progress)}`;
  return t('Ortung steht an');
}

interface RowProps {
  video: VideoInfo;
  fix: Fix | null;
  selected: boolean;
  select: (videoId: string | null) => void;
}

/**
 * One recording in the list: picture, case name, place and clock; the deviation small below.
 * Memoised: while recordings are analysed and located, only the rows whose recording or fix
 * changed render again, not the whole list.
 */
const FixRow = memo(function FixRow({ video, fix, selected, select }: RowProps) {
  const lang = useLang();
  const { t, locale } = lang;
  const loc = fix?.status === 'ready' || fix?.status === 'running' ? (fix.location ?? null) : null;
  const win = fix && loc ? bestWindowText(fix) : null;
  const quick = fix !== null && loc !== null && stageOf(fix) === 'quick';
  const image = middleFrame(fix);
  const country = loc ? countryText(lang, loc) : '';
  const place = loc ? placeText(lang, loc, fix) : '';
  return (
    <li className={selected ? 'dt-row on' : 'dt-row'} {...pressable(() => select(selected ? null : video.id), selected)}>
      {image ? <img className="dt-row-img" src={image} alt="" loading="lazy" decoding="async" /> : <span className="dt-row-img" />}
      <div className="dt-row-text">
        <div className="dt-row-top">
          <b className="dt-row-name">{caseLabel(video.name)}</b>
          {quick && <span className="dt-tag">{t('schnell geortet')}</span>}
          <span className="dt-clock">{win ?? (loc ? '––:––' : '')}</span>
        </div>
        {loc ? (
          <div className="dt-row-mid">
            <span className="dt-place">
              {place}
              {country !== '' && country !== place ? <span className="low"> · {country}</span> : null}
            </span>
          </div>
        ) : (
          <div className="dt-row-mid">
            <span className="dt-place low">{progressText(fix, video, t)}</span>
          </div>
        )}
        {loc && (
          <div className="dt-row-sub">
            {radiusText(lang, loc)}
            {fix?.status === 'running' && ` · ${t('wird neu geortet …')}`}
            {fix?.truth?.errorKm != null && ` · ${t('Abweichung')} ${kmText(fix.truth.errorKm, locale)}`}
          </div>
        )}
      </div>
    </li>
  );
});

/** The four stations of an own recording, from the file to the walkable spaces. */
const STATIONS = ['hochgeladen', 'wird geortet', 'geortet', 'Räume fertig'] as const;

function uploadStation(item: UploadItem, video: VideoInfo | undefined, fix: Fix | undefined, t: (de: string, vars?: Record<string, string | number>) => string): { reached: number; text: string; failed: boolean } {
  if (item.status === 'failed') return { reached: 0, text: item.error ? t(item.error) : t('Fehler'), failed: true };
  if (item.status === 'waiting') return { reached: 0, text: t('wartet auf das Hochladen'), failed: false };
  if (item.status === 'uploading') return { reached: 0, text: `${t('wird hochgeladen')} ${formatPercent(item.progress)}`, failed: false };
  if (fix?.status === 'error') return { reached: 1, text: t('Fehler bei der Ortung'), failed: true };
  if (video?.status === 'error' && !fix?.location) return { reached: 1, text: t('Fehler bei der Auswertung'), failed: true };
  if (fix?.location && (fix.status === 'ready' || fix.status === 'running')) {
    if (stageOf(fix) === 'full' && fix.status === 'ready') return { reached: 4, text: t('Räume fertig'), failed: false };
    return { reached: 3, text: fix.status === 'running' ? t('geortet · Räume werden gebaut') : t('schnell geortet · Räume folgen'), failed: false };
  }
  if (fix?.status === 'ready') return { reached: 3, text: t('Kein Ort bestimmbar'), failed: false };
  if (fix?.status === 'running') return { reached: 2, text: t('wird geortet …'), failed: false };
  return { reached: 1, text: t('hochgeladen · Ortung steht an'), failed: false };
}

function UploadTray({ items, videos, byId, select }: { items: UploadItem[]; videos: Map<string, VideoInfo>; byId: Map<string, Fix>; select: (id: string) => void }) {
  const { t } = useLang();
  const states = items.map((item) => {
    const video = item.videoId ? videos.get(item.videoId) : undefined;
    const fix = item.videoId ? byId.get(item.videoId) : undefined;
    return { item, ...uploadStation(item, video, fix, t) };
  });
  const finished = states.filter((s) => s.reached === 4 || s.failed).length;
  const located = states.filter((s) => s.reached >= 3).length;
  return (
    <section className="dt-tray" aria-label={t('Hochladen')}>
      <header className="dt-tray-head">
        <span className="label">
          {t('Eigene Videos')} <span className="count">{located}</span>
          <span className="count-of">/ {items.length} {t('geortet')}</span>
        </span>
        {finished === items.length && (
          <button type="button" className="text-btn" onClick={() => uploads.clearFinished()}>
            {t('Liste leeren')}
          </button>
        )}
      </header>
      <ul className="dt-tray-list">
        {states.map(({ item, reached, text, failed }) => (
          <li key={item.key} className={failed ? 'dt-tray-item failed' : 'dt-tray-item'}>
            <button type="button" className="dt-tray-name" disabled={!item.videoId} onClick={() => item.videoId && select(item.videoId)} title={item.name}>
              {caseLabel(item.name)}
            </button>
            <span className="dt-steps" role="img" aria-label={`${reached} / 4`}>
              {STATIONS.map((station, i) => (
                <i key={station} className={i < reached ? 'on' : ''} title={t(station)} />
              ))}
            </span>
            <span className="dt-tray-state">{text}</span>
            {(failed || reached === 4) && (
              <button type="button" className="row-x" aria-label={t('Hinweis entfernen')} onClick={() => uploads.dismiss(item.key)}>
                ×
              </button>
            )}
            {item.status === 'uploading' && (
              <div className="bar dt-tray-bar">
                <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function OrtungView({ videos, can, fixes, byId, selected, select, go }: DatumViewProps) {
  const lang = useLang();
  const { t, locale } = lang;
  const [countries, setCountries] = useState<CountryShape[]>([]);
  const [showTruth, setShowTruth] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const uploadItems = useUploads();
  const truth = useTruthUpload();
  const mayUpload = can('source.write');
  useEffect(() => {
    void fetchCountries().then(setCountries);
  }, []);

  const summary = selected ? byId.get(selected) : undefined;
  const { fix: full } = useFullFix(selected, summary);
  const current = full ?? summary ?? null;

  const videoById = useMemo(() => new Map(videos.map((v) => [v.id, v])), [videos]);

  // Own footage first, newest on top; the reference set after it, by case name.
  const groups = useMemo(() => {
    const own: VideoInfo[] = [];
    const reference: VideoInfo[] = [];
    for (const v of videos) (isReference(v) ? reference : own).push(v);
    own.sort((a, b) => b.createdAt - a.createdAt);
    reference.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { own, reference };
  }, [videos]);
  const total = videos.length;

  const located = useMemo(() => fixes.filter((f) => f.location && videoById.has(f.videoId)).length, [fixes, videoById]);
  const deviations = useMemo(() => fixes.map((f) => f.truth?.errorKm).filter((v): v is number => typeof v === 'number'), [fixes]);

  const markers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = [];
    for (const fix of fixes) {
      const video = videoById.get(fix.videoId);
      if (!fix.location || !video) continue;
      const isSel = fix.videoId === selected;
      out.push({
        id: fix.videoId,
        lat: fix.location.lat,
        lon: fix.location.lon,
        shape: 'fix',
        label: isSel || fixes.length <= 12 ? caseLabel(video.name) : '',
        ...(isSel ? { sub: bestWindowText(fix) ?? placeText(lang, fix.location, fix) } : {}),
        selected: isSel,
        dim: selected !== null && !isSel,
      });
      if (showTruth && fix.truth && (isSel || selected === null)) {
        out.push({ id: `truth:${fix.videoId}`, lat: fix.truth.lat, lon: fix.truth.lon, shape: 'truth', label: isSel ? t('Wahrheit') : '', dim: !isSel });
      }
    }
    return out;
  }, [fixes, videoById, selected, showTruth, t, lang]);

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
    return [...lines, ...fixShapes(current, full, countries, true, t, locale)];
  }, [current, full, countries, t, locale, terrain]);

  const onMapSelect = useCallback(
    (id: string | null) => {
      if (id === null) return;
      select(id.startsWith('truth:') ? id.slice(6) : id);
    },
    [select],
  );

  const take = useCallback(
    (files: File[]) => {
      const truthFiles = files.filter((f) => isTruthFile(f.name));
      const rest = files.filter((f) => !isTruthFile(f.name));
      if (truthFiles[0]) truth.send(truthFiles[0]);
      if (rest.length === 0) {
        setNotice(truthFiles.length > 0 ? null : t('Keine Videodateien gefunden.'));
        return;
      }
      const { accepted, skipped } = uploads.add(rest, OWN_UPLOAD);
      setNotice(accepted === 0 ? t('Keine Videodateien gefunden.') : skipped > 0 ? t('{n} Datei(en) übersprungen, kein Videoformat.', { n: skipped }) : null);
    },
    [t, truth],
  );

  // The whole view takes a drop: files or folders over the list or the map.
  const dropProps = mayUpload
    ? {
        onDragEnter: (e: DragEvent) => {
          if (!dragHasFiles(e)) return;
          e.preventDefault();
          dragDepth.current++;
          setDragging(true);
        },
        onDragOver: (e: DragEvent) => {
          if (!dragHasFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        },
        onDragLeave: () => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        },
        onDrop: (e: DragEvent) => {
          if (!dragHasFiles(e)) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          void filesFromDrop(e).then(take);
        },
      }
    : {};

  const view = current?.location
    ? { lat: current.location.lat, lon: current.location.lon, zoom: zoomForRadius(Math.max(0.3, current.location.radiusKm), current.location.lat) }
    : WORLD;
  const viewKey = current?.location ? `${current.videoId}:${current.computedAt}` : 'world';
  const keyImage = middleFrame(current);
  const sun = current?.sun?.at ?? null;
  const selectedVideo = selected ? (videoById.get(selected) ?? null) : null;
  const ownUploads = uploadItems.length > 0;

  const renderRows = (list: VideoInfo[]) => (
    <ul className="dt-rows">
      {list.map((v) => (
        <FixRow key={v.id} video={v} fix={byId.get(v.id) ?? null} selected={v.id === selected} select={select} />
      ))}
    </ul>
  );

  return (
    <div className={dragging ? 'dt-ortung dt-dragging' : 'dt-ortung'} {...dropProps}>
      <aside className="dt-list">
        <div className="dt-list-head">
          <h2 className="label">
            {t('Aufnahmen')} <span className="count">{total}</span>
            {total > 0 && (
              <span className="count-of">
                · {located} {t('geortet')}
              </span>
            )}
          </h2>
          {mayUpload && (
            <div className="dt-upload-btns">
              <button type="button" className="btn btn-solid" onClick={() => fileInput.current?.click()}>
                {t('Videos hochladen')}
              </button>
              <input
                ref={fileInput}
                type="file"
                accept={`${VIDEO_ACCEPT},.csv,.json`}
                multiple
                hidden
                onChange={(e) => {
                  take(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
              <input
                ref={(el) => {
                  folderInput.current = el;
                  if (el) el.setAttribute('webkitdirectory', '');
                }}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  take(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
            </div>
          )}
        </div>
        {mayUpload && (
          <div className="dt-intake">
            {/* A hint for the first own upload; once there is own footage it is known. */}
            {groups.own.length === 0 && <p className="dt-hint">{t('Videos oder ganze Ordner auf Liste oder Karte ziehen. Die Ortung beginnt sofort, auch bei langen Videos.')}</p>}
            <button type="button" className="text-btn dt-intake-btn" onClick={() => folderInput.current?.click()}>
              + {t('Einen ganzen Ordner hochladen')}
            </button>
            <TruthControl truth={truth} compact />
            {notice && <p className="note">{notice}</p>}
          </div>
        )}
        {ownUploads && <UploadTray items={uploadItems} videos={videoById} byId={byId} select={select} />}
        <div className="pane-body">
          {total === 0 && (
            <div className="dt-empty">
              <p className="dt-empty-title">{t('Noch keine Aufnahmen')}</p>
              <p className="low">{mayUpload ? t('Videos hochladen oder hierher ziehen. DATUM bestimmt Ort und Uhrzeit.') : t('Diese Rolle darf keine Videos hochladen.')}</p>
            </div>
          )}
          {groups.own.length > 0 && (
            <>
              {groups.reference.length > 0 && <div className="dt-group">{t('Eigene Aufnahmen')}</div>}
              {renderRows(groups.own)}
            </>
          )}
          {groups.reference.length > 0 && (
            <>
              {groups.own.length > 0 && <div className="dt-group">{t('Referenzbestand')}</div>}
              {renderRows(groups.reference)}
            </>
          )}
        </div>
      </aside>

      <section className="dt-map">
        <MapCanvas view={view} viewKey={viewKey} markers={markers} shapes={shapes} minZoom={1} maxZoom={16} fly globe onSelect={onMapSelect} />
        {!current && total > 0 && (
          <div className="dt-hud">
            <div className="dt-hud-clock">
              {located}
              <span className="dt-hud-of">/{total}</span>
            </div>
            <div className="dt-hud-sub">{t('Aufnahmen geortet')}</div>
            {deviations.length > 0 && (
              <div className="dt-hud-line">
                {t('Abweichung im Median')} <b>{kmText(medianOf(deviations), locale)}</b>
                <span className="low"> · {t('{n} mit Grundwahrheit', { n: deviations.length })}</span>
              </div>
            )}
            <div className="dt-hud-hint">{t('Eine Aufnahme wählen: Ort, Uhrzeit, Sonne, Raum.')}</div>
          </div>
        )}
        {current && current.location && (current.status === 'ready' || current.status === 'running') && (
          <div className="dt-hud">
            <div className="dt-hud-stage">
              {current.status === 'running' ? (
                <span className="dt-tag dt-tag-live">{t('wird geortet …')}</span>
              ) : stageOf(current) === 'quick' ? (
                <span className="dt-tag dt-tag-live">{t('schnell geortet · Räume folgen')}</span>
              ) : (
                <span className="dt-tag">{t('vollständig')}</span>
              )}
            </div>
            <div className="dt-hud-place">{placeText(lang, current.location, current)}</div>
            <div className="dt-hud-sub">
              {[countryText(lang, current.location), radiusText(lang, current.location)].filter((x) => x !== '').join(' · ')}
            </div>
            <div className="dt-hud-clock">{bestWindowText(current) ?? '––:––'}</div>
            <div className="dt-hud-sub">
              {current.time.method === 'metadata' ? t('Uhrzeit aus den Metadaten') : current.time.method === 'sun' ? t('Uhrzeit aus dem Sonnenstand') : t('Uhrzeit nicht bestimmbar')}
              {current.time.timezone ? ` · ${current.time.timezone}` : ''}
            </div>
            <div className="dt-hud-conf">
              <span>{t('Konfidenz')}</span>
              <span className="dt-meter" aria-hidden="true">
                <span style={{ width: `${Math.round(current.location.confidence * 100)}%` }} />
              </span>
              <b>{formatScore(current.location.confidence)}</b>
            </div>
            <div className="dt-hud-detail">
              <div>{formatCoordinate(current.location.lat, current.location.lon)}</div>
              <div className="dt-hud-checks">
                <CheckLinks lat={current.location.lat} lon={current.location.lon} />
              </div>
              {sun && (
                <div>
                  {t('Sonne')} {Math.round(sun.azimuthDeg)}° / {Math.round(sun.elevationDeg)}° · {t('Schatten')} {Math.round(sun.shadowAzimuthDeg)}°
                </div>
              )}
              {terrain && (
                <div>
                  {t('Gelände {min}–{max} m · Höhenlinien alle {step} m', {
                    min: Math.round(terrain.minHeight).toLocaleString(locale),
                    max: Math.round(terrain.maxHeight).toLocaleString(locale),
                    step: terrain.interval.toLocaleString(locale),
                  })}
                </div>
              )}
              {current.truth?.errorKm != null && (
                <div className="dt-hud-truth">
                  {t('Abweichung zur Wahrheit')} <b>{kmText(current.truth.errorKm, locale)}</b>
                </div>
              )}
            </div>
          </div>
        )}
        {current && !current.location && (
          <div className="dt-hud">
            <div className="dt-hud-place">{selectedVideo ? caseLabel(selectedVideo.name) : ''}</div>
            <div className="dt-hud-sub">{selectedVideo ? progressText(current, selectedVideo, t) : t('Ort unbestimmt')}</div>
          </div>
        )}
        {current && (
          <div className="dt-strip">
            {keyImage && <img src={keyImage} alt="" />}
            <div className="dt-strip-text">
              <div className="label">{selectedVideo ? caseLabel(selectedVideo.name) : ''}</div>
              <div className="btn-row">
                <button type="button" className="btn" onClick={() => go('befund')}>
                  {t('Befund')}
                </button>
                <button type="button" className="btn" onClick={() => go('raum')} disabled={!current.keyframes.some((k) => k.spaceUrl)}>
                  {t('Raum betreten')}
                </button>
              </div>
              {stageOf(current) === 'quick' && <div className="low">{t('Die Räume folgen, sobald die Auswertung des Videos fertig ist.')}</div>}
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
          <button type="button" className="text-btn" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog">
            {t('Einstellungen')}
          </button>
        </div>
        {total === 0 && mayUpload && (
          <div className="dt-map-empty">
            <p className="dt-empty-title">{t('Videos hierher ziehen')}</p>
            <p className="low">{t('oder')}</p>
            <button type="button" className="btn btn-solid" onClick={() => fileInput.current?.click()}>
              {t('Videos hochladen')}
            </button>
          </div>
        )}
      </section>
      {settingsOpen && (
        <Dialog title={t('Einstellungen der Ortung')} onClose={() => setSettingsOpen(false)}>
          <DatumSettingsPanel can={can} />
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => setSettingsOpen(false)}>
              {t('Schließen')}
            </button>
          </div>
        </Dialog>
      )}
      {dragging && (
        <div className="dt-drop" aria-hidden="true">
          <div className="dt-drop-box">
            <b>{t('Loslassen zum Hochladen')}</b>
            <span>{t('Videos und Ordner; eine CSV- oder JSON-Datei gilt als Grundwahrheit.')}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Memoised: the shell re-renders on every batch of events; this view only when its inputs change. */
export const Ortung = memo(OrtungView);
