import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type { VideoInfo } from '../../api';
import { formatScore } from '../../format';
import { useLang } from '../../i18n';
import { MapCanvas, type MapMarker, type MapShape } from '../../map/MapCanvas';
import { Dialog } from '../../ui';
import { VIDEO_ACCEPT, dragHasFiles, droppedFolderName, filesFromDrop, pickedFolderName, uploads, useUploads } from '../../uploads';
import { fetchCountries, fetchTerrain, type CountryShape, type DatasetDeleteResult, type Fix } from '../api';
import { terrainContours, type ContourSet } from '../contours';
import { datasets, groupRecordings, useDatasets, type DatasetGroup } from '../datasets';
import { DeleteDatasetDialog } from '../DeleteDatasetDialog';
import { caseLabel, countryText, placeText, radiusHint, radiusText, stageOf, zoneDoubt } from '../labels';
import { referenceInstant, utcOffset } from '../panel/common';
import { DatumSettingsPanel } from '../Settings';
import { TRUTH_ACCEPT, useTruthUpload } from '../TruthUpload';
import { isTruthFile } from '../truthFile';
import { UPLOAD_OPTIONS, UploadDialog, type Picked } from '../UploadDialog';
import { nearestWithin, placesText, reachKm, routeGeometry, segmentSummary, type StretchChoice } from '../segments';
import { bestWindowText, kmText, useFullFix, zoomForRadius } from '../useFixes';
import { OrtungList, progressText, type GroupActions } from './OrtungList';

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

/** What BEFUND and RAUM share beyond that: the stretch chosen in BEFUND, which RAUM enters. */
export interface StretchProps {
  stretch: StretchChoice | null;
  chooseStretch: (choice: StretchChoice) => void;
}

// The whole Earth: the globe is sized to fit the map area (`fit`), centred on Europe and Africa.
const WORLD = { lat: 24, lon: 12, zoom: 2.25, fit: true };

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

/**
 * The result of the chosen recording over the map: place, clock, how sure, and the way on to its
 * findings. Coordinates, sun and terrain belong to BEFUND; the picture is in the row.
 */
function ResultCard({ fix, video, go }: { fix: Fix; video: VideoInfo | null; go: DatumViewProps['go'] }) {
  const lang = useLang();
  const { t, locale } = lang;
  const loc = fix.location;
  const befund = (
    <button type="button" className="btn" onClick={() => go('befund')}>
      {t('Befund')}
    </button>
  );
  // A fix being computed again ('pending', 'running') keeps its place on show.
  if (!loc || (fix.status !== 'ready' && fix.status !== 'running' && fix.status !== 'pending')) {
    return (
      <div className="dt-hud">
        <div className="dt-hud-place">{video ? caseLabel(video.name) : ''}</div>
        <div className="dt-hud-sub">{video ? progressText(fix, video, t) : t('Ort unbestimmt')}</div>
        <div className="dt-hud-actions">{befund}</div>
      </div>
    );
  }
  const hasSpace = fix.keyframes.some((k) => k.spaceUrl);
  const method = fix.time.method === 'metadata' ? t('Metadaten') : fix.time.method === 'sun' ? t('Sonnenstand') : t('Uhrzeit nicht bestimmbar');
  const state = fix.status === 'running' ? t('wird geortet …') : fix.status === 'pending' ? t('Neuortung steht an') : stageOf(fix) === 'quick' ? t('vorläufig') : '';
  // A recording of several places: the card names the longest stretch's place and how many there
  // are, kept on one line ("mindestens 3 Orte" broke after "3").
  const places = placesText(fix, t).replace(/ /g, '\u00a0');
  // The zone as an offset; its name (Europe/Paris) is in the title.
  const zone = fix.time.timezone ? utcOffset(fix.time.timezone, referenceInstant(fix.time, fix.sun)) : '';
  // A place wider than ± 1 500 km fixes no time zone: said next to the offset, as in BEFUND.
  const doubt = zone !== '' ? zoneDoubt(lang, loc) : null;
  return (
    <div className="dt-hud">
      <div className="dt-hud-place">{placeText(lang, loc, fix)}</div>
      <div className="dt-hud-sub" title={radiusHint(lang, loc)}>
        {[countryText(lang, loc), radiusText(lang, loc), places, state].filter((x) => x !== '').join(' · ')}
      </div>
      <div className="dt-hud-clock">{bestWindowText(fix) ?? '––:––'}</div>
      <div className="dt-hud-note" title={[fix.time.timezone ?? '', doubt?.hint ?? ''].filter((x) => x !== '').join(' · ')}>
        {[method, zone, doubt?.text ?? ''].filter((x) => x !== '').join(' · ')}
      </div>
      {/* Confidence and, with a ground truth, the deviation: one grid, so that both rows align. */}
      <div className="dt-hud-conf">
        <span>{t('Konfidenz')}</span>
        <span className="dt-meter" aria-hidden="true">
          <span style={{ width: `${Math.round(loc.confidence * 100)}%` }} />
        </span>
        <b>{formatScore(loc.confidence)}</b>
        {fix.truth?.errorKm != null && (
          <>
            <span>{t('Abweichung')}</span>
            <span />
            <b>{kmText(fix.truth.errorKm, locale)}</b>
          </>
        )}
      </div>
      <div className="dt-hud-actions">
        {befund}
        <span title={hasSpace ? '' : t('Die Räume folgen, sobald die Auswertung des Videos fertig ist.')}>
          <button type="button" className="text-btn" disabled={!hasSpace} onClick={() => go('raum')}>
            {t('Raum')}
          </button>
        </span>
      </div>
    </div>
  );
}

type OpenDialog = { kind: 'upload'; initial: Picked | null } | { kind: 'delete'; group: DatasetGroup } | { kind: 'settings' };

function OrtungView({ videos, can, fixes, byId, selected, select, go }: DatumViewProps) {
  const lang = useLang();
  const { t, locale, pick, n } = lang;
  const [countries, setCountries] = useState<CountryShape[]>([]);
  const [showTruth, setShowTruth] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [dropGroup, setDropGroup] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const dragDepth = useRef(0);
  // Where the files of the hidden pickers go: a dataset's id, or 'new' (the upload dialog).
  const pickTarget = useRef<string>('new');
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const truthInput = useRef<HTMLInputElement>(null);
  // Each outcome of a ground-truth file shows once, when it arrives.
  const truth = useTruthUpload(useCallback((r: { ok: boolean; text: string }) => setNotice(r), []));
  const mayUpload = can('source.write');
  const sets = useDatasets();
  useEffect(() => {
    void fetchCountries().then(setCountries);
    void datasets.refresh();
  }, []);

  const summary = selected ? byId.get(selected) : undefined;
  const { fix: full } = useFullFix(selected, summary);
  const current = full ?? summary ?? null;

  const videoById = useMemo(() => new Map(videos.map((v) => [v.id, v])), [videos]);
  const groups = useMemo(() => groupRecordings(videos, byId, sets, { pick, t }), [videos, byId, sets, pick, t]);
  const total = videos.length;
  const located = useMemo(() => fixes.filter((f) => f.location && videoById.has(f.videoId)).length, [fixes, videoById]);
  const anyTruth = useMemo(() => fixes.some((f) => f.truth), [fixes]);

  // The node's counts and names follow new recordings, fixes and finished uploads, once they pause.
  const changeKey = `${total}:${located}`;
  const firstChange = useRef(true);
  useEffect(() => {
    if (firstChange.current) {
      firstChange.current = false;
      return;
    }
    datasets.refreshSoon();
  }, [changeKey]);
  const uploaded = useUploads().filter((u) => u.status === 'done').length;
  useEffect(() => {
    if (uploaded > 0) datasets.refreshSoon();
  }, [uploaded]);

  // The places of the chosen recording when it shows several: numbered markers and the route.
  const route = useMemo(() => {
    const summary = segmentSummary(current);
    if (!current || !summary || summary.places.length < 2) return null;
    const byPlace = new Map(summary.places.map((p) => [p.place, p]));
    const stops = summary.route.flatMap((n) => {
      const p = byPlace.get(n);
      return p ? [{ key: n, lat: p.lat, lon: p.lon }] : [];
    });
    // The fix's own place: the summary names it (and puts it at the stretch the fix shows);
    // summaries without it, the place nearest to the fix.
    const loc = current.location;
    const lead = summary.lead ?? (loc ? (nearestWithin(loc, summary.places, 50)?.place ?? null) : null);
    const video = videoById.get(current.videoId);
    const geometry = routeGeometry(stops, lead, `place:${current.videoId}:`, () => (video ? caseLabel(video.name) : ''));
    return { ...geometry, places: summary.places };
  }, [current, videoById]);

  const markers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = [];
    for (const fix of fixes) {
      const video = videoById.get(fix.videoId);
      if (!fix.location || !video) continue;
      const isSel = fix.videoId === selected;
      // The truth first: the chosen recording of several places skips its own marker below, and
      // the line from its fix to the truth (fixShapes) should still end at one.
      if (showTruth && fix.truth && (isSel || selected === null)) {
        out.push({ id: `truth:${fix.videoId}`, lat: fix.truth.lat, lon: fix.truth.lon, shape: 'truth', label: isSel ? t('Wahrheit') : '', dim: !isSel });
      }
      // The chosen recording of several places stands as its places (route below).
      if (isSel && route) continue;
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
    }
    if (route) out.push(...route.markers);
    return out;
  }, [fixes, videoById, selected, showTruth, t, lang, route]);

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
    return [...lines, ...(route?.line ? [route.line] : []), ...fixShapes(current, full, countries, true, t, locale)];
  }, [current, full, countries, t, locale, terrain, route]);

  const onMapSelect = useCallback(
    (id: string | null) => {
      if (id === null) return;
      // A place of a recording of several: `place:<videoId>:<n>`.
      if (id.startsWith('place:')) select(id.split(':')[1] ?? null);
      else select(id.startsWith('truth:') ? id.slice(6) : id);
    },
    [select],
  );

  /** Files straight into an existing dataset: no dialog. A ground-truth file among them is sent as such. */
  const addInto = useCallback(
    (datasetId: string, files: File[]) => {
      setNotice(null);
      const truthFiles = files.filter((f) => isTruthFile(f.name));
      const rest = files.filter((f) => !isTruthFile(f.name));
      if (truthFiles[0]) truth.send(truthFiles[0], { withVideos: rest.length > 0 });
      if (rest.length === 0) {
        if (truthFiles.length === 0) setNotice({ text: t('Keine Videodateien gefunden.'), ok: false });
        return;
      }
      const { accepted, skipped } = uploads.add(rest, { ...UPLOAD_OPTIONS, sourceId: datasetId });
      if (accepted === 0) setNotice({ text: t('Keine Videodateien gefunden.'), ok: false });
      else if (skipped > 0) setNotice({ text: t('{n} Datei(en) übersprungen, kein Videoformat.', { n: skipped }), ok: false });
    },
    [t, truth],
  );

  const openUpload = useCallback((initial: Picked | null) => {
    setNotice(null);
    setDialog({ kind: 'upload', initial });
  }, []);

  const picked = (files: File[], folder: string | null): void => {
    if (files.length === 0) return;
    if (pickTarget.current === 'new') openUpload({ files, folder });
    else addInto(pickTarget.current, files);
  };

  const actions = useMemo<GroupActions>(
    () => ({
      addVideos: (group) => {
        pickTarget.current = group.id;
        fileInput.current?.click();
      },
      addFolder: (group) => {
        pickTarget.current = group.id;
        folderInput.current?.click();
      },
      addTruth: () => truthInput.current?.click(),
      remove: (group) => {
        setNotice(null);
        setDialog({ kind: 'delete', group });
      },
    }),
    [],
  );

  const groupAt = (e: DragEvent): string | null => {
    const el = e.target instanceof Element ? e.target.closest('[data-drop-group]') : null;
    return el?.getAttribute('data-drop-group') ?? null;
  };

  // The whole view takes a drop: on a dataset it goes into that dataset, elsewhere into a new one.
  const dropProps = mayUpload
    ? {
        onDragEnter: (e: DragEvent) => {
          if (!dragHasFiles(e)) return;
          e.preventDefault();
          if (dialog) return;
          dragDepth.current++;
          setDragging(true);
        },
        onDragOver: (e: DragEvent) => {
          if (!dragHasFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          if (dialog) return;
          const at = groupAt(e);
          setDropGroup((prev) => (prev === at ? prev : at));
        },
        onDragLeave: () => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) {
            setDragging(false);
            setDropGroup(null);
          }
        },
        onDrop: (e: DragEvent) => {
          if (!dragHasFiles(e)) return;
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          setDropGroup(null);
          if (dialog) return;
          const at = groupAt(e);
          const folder = droppedFolderName(e);
          void filesFromDrop(e).then((files) => {
            if (files.length === 0) return;
            if (at) addInto(at, files);
            else openUpload({ files, folder });
          });
        },
      }
    : {};

  const deleted = (group: DatasetGroup, result: DatasetDeleteResult): void => {
    setDialog(null);
    if (selected && group.videos.some((v) => v.id === selected)) select(null);
    const parts = [t('{deleted} gelöscht', { deleted: n(result.deleted, 'recording') })];
    if (result.kept > 0) parts.push(t('{kept} bleiben (in einem Vorgang gesichert)', { kept: result.kept }));
    setNotice({ text: parts.join(' · '), ok: true });
  };

  // A recording of several places: turned to its place, as far out as its farthest place.
  const reach = current?.location && route ? reachKm(current.location, route.places) : 0;
  const view = current?.location
    ? {
        lat: current.location.lat,
        lon: current.location.lon,
        // A route around the world shows the whole Earth (sized to the map, as the world view).
        ...(route && reach > 2500
          ? { zoom: WORLD.zoom, fit: true }
          : { zoom: route ? zoomForRadius(Math.max(5, reach * 0.6), current.location.lat) : zoomForRadius(Math.max(0.3, current.location.radiusKm), current.location.lat) }),
      }
    : WORLD;
  const viewKey = current?.location ? `${current.videoId}:${current.computedAt}` : 'world';
  const selectedVideo = selected ? (videoById.get(selected) ?? null) : null;
  const hoverName = dropGroup ? (groups.find((g) => g.id === dropGroup)?.name ?? null) : null;

  return (
    <div className={dragging ? 'dt-ortung dt-dragging' : 'dt-ortung'} {...dropProps}>
      <aside className="dt-list">
        <div className="dt-list-head">
          <h2 className="label">
            {t('Aufnahmen')} <span className="count">{total}</span>
          </h2>
          {mayUpload && (
            <button type="button" className="btn btn-solid" onClick={() => openUpload(null)}>
              {t('Hochladen')}
            </button>
          )}
        </div>
        {notice && <p className={notice.ok ? 'dt-notice' : 'note dt-notice'}>{notice.text}</p>}
        <div className="pane-body">
          {total === 0 && <p className="dt-empty">{mayUpload ? t('Noch keine Aufnahmen. Videos oder einen Ordner hierher ziehen.') : t('Noch keine Aufnahmen.')}</p>}
          <OrtungList groups={groups} byId={byId} selected={selected} select={select} mayWrite={mayUpload} managed={sets.supported && sets.list !== null} actions={actions} dropGroup={dropGroup} />
        </div>
        {mayUpload && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={`${VIDEO_ACCEPT},.csv,.json`}
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                picked(files, null);
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
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                picked(files, pickedFolderName(files));
              }}
            />
            <input
              ref={truthInput}
              type="file"
              accept={TRUTH_ACCEPT}
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) {
                  setNotice(null);
                  truth.send(file);
                }
              }}
            />
          </>
        )}
      </aside>

      <section className="dt-map">
        <MapCanvas view={view} viewKey={viewKey} markers={markers} shapes={shapes} minZoom={1} maxZoom={16} fly globe onSelect={onMapSelect} />
        {current && <ResultCard fix={current} video={selectedVideo} go={go} />}
        <div className="dt-map-tools">
          {anyTruth && (
            <label className="check">
              <input type="checkbox" checked={showTruth} onChange={(e) => setShowTruth(e.target.checked)} />
              {t('Wahrheit zeigen')}
            </label>
          )}
          {selected && (
            <button type="button" className="text-btn" onClick={() => select(null)}>
              {t('Weltansicht')}
            </button>
          )}
          <button type="button" className="text-btn" onClick={() => setDialog({ kind: 'settings' })} aria-haspopup="dialog">
            {t('Einstellungen')}
          </button>
        </div>
        {dragging && (
          <div className="dt-drop" aria-hidden="true">
            <div className="dt-drop-box">
              <b>{hoverName ? t('Loslassen: in »{name}«', { name: hoverName }) : sets.supported ? t('Loslassen: neuer Datensatz') : t('Loslassen zum Hochladen')}</b>
            </div>
          </div>
        )}
        {total === 0 && mayUpload && (
          <div className="dt-map-empty">
            <p className="dt-empty-title">{t('Videos hierher ziehen')}</p>
            <p className="low">{t('oder')}</p>
            <button
              type="button"
              className="text-btn"
              onClick={() => {
                pickTarget.current = 'new';
                fileInput.current?.click();
              }}
            >
              {t('Dateien wählen')}
            </button>
          </div>
        )}
      </section>
      {dialog?.kind === 'settings' && (
        <Dialog title={t('Einstellungen der Ortung')} onClose={() => setDialog(null)}>
          <DatumSettingsPanel can={can} />
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => setDialog(null)}>
              {t('Schließen')}
            </button>
          </div>
        </Dialog>
      )}
      {dialog?.kind === 'upload' && (
        <UploadDialog
          initial={dialog.initial}
          list={sets.list}
          supported={sets.supported}
          sendTruth={truth.send}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete' && <DeleteDatasetDialog group={dialog.group} onClose={() => setDialog(null)} onDone={(result) => deleted(dialog.group, result)} />}
    </div>
  );
}

/** Memoised: the shell re-renders on every batch of events; this view only when its inputs change. */
export const Ortung = memo(OrtungView);
