import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react';
import { formatDecimal, formatScore } from '../../format';
import { useLang } from '../../i18n';
import { MapCanvas, type MapMarker } from '../../map/MapCanvas';
import { useAction } from '../../ui';
import { recompute, rel, fetchCountries, type CountryShape } from '../api';
import { caseLabel, countryText, placeText, radiusHint, radiusText, stageOf, zoneDoubt } from '../labels';
import { CandidateList, ClockDial, CountryBars, EvidenceList, FixSummary, SkylineFrame, SunDial } from '../panel';
import { SegmentTimeline } from '../panel/SegmentTimeline';
import { chosenStretch, dialClock, GLOBE_REACH_KM, nextKey, placesLowerBound, placesText, routeGeometry, segmentIndexAt, segmentSummary, spanText, stretchMapReach, stretchSpaces, timedStretches, wholeFileShapes, wholeFileShown } from '../segments';
import { kindMethod, referenceInstant, utcOffset } from '../panel/common';
import { bestWindowText, kmText, useFullFix, zoomForRadius } from '../useFixes';
import { fixShapes, type DatumViewProps, type StretchProps } from './Ortung';

/** The length of a recording as a clock reads it: 0:12, 4:05, 1:02:05. */
function lengthText(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function BefundView({ videos, can, byId, selected, go, stretch, chooseStretch }: DatumViewProps & StretchProps) {
  const lang = useLang();
  const { t, locale, pick } = lang;
  const summary = selected ? byId.get(selected) : undefined;
  const { fix, error } = useFullFix(selected, summary);
  const [keyIndex, setKeyIndex] = useState(0);
  // Where the video cannot play, the picture in its place: the chosen stretch's keyframe, or the
  // keyframe thumbnail clicked last (whichever was chosen last).
  const [keyPicked, setKeyPicked] = useState(false);
  const [candidate, setCandidate] = useState(0);
  // The picture under the video's place: the video itself, or the keyframe with its skyline drawn.
  const [showSkyline, setShowSkyline] = useState(false);
  /**
   * The node hands out the original recording only once it is fully checked for faces and none
   * were found (or with an approval); otherwise the request is refused and the keyframe is shown
   * with the reason instead of a player that does nothing. Kept in German and translated where it
   * is shown, so that it follows a change of language.
   */
  const [videoRefused, setVideoRefused] = useState<string | null>(null);
  useEffect(() => setVideoRefused(null), [selected]);
  const player = useRef<HTMLVideoElement | null>(null);
  // The chosen stretch of a recording of several places (index into fix.segments), kept by the
  // shell so that RAUM enters it; another recording or result starts at the stretch the fix shows.
  const segment = fix ? chosenStretch(fix, stretch) : 0;
  const setSegment = (index: number): void => {
    if (fix && index !== segment) chooseStretch({ videoId: fix.videoId, computedAt: fix.computedAt, index });
  };
  const [countries, setCountries] = useState<CountryShape[]>([]);
  const action = useAction();
  const video = videos.find((v) => v.id === selected) ?? null;

  useEffect(() => {
    void fetchCountries().then(setCountries);
  }, []);
  // Key frame and candidate index belong to one result: another recording, or a new result after
  // "Neu orten", starts again at the first ones. Reset while rendering, so that no frame shows an
  // index into the old candidate list applied to the new one.
  const resultKey = `${selected ?? ''}:${fix?.computedAt ?? ''}`;
  const [resultShown, setResultShown] = useState(resultKey);
  if (resultShown !== resultKey) {
    setResultShown(resultKey);
    // Open on the keyframe the heading was matched on, if any.
    const matched = fix?.heading ? (fix.heading.frame ?? fix.evidence.find((e) => e.kind === 'horizon')?.frame ?? null) : null;
    setKeyIndex(Math.max(0, fix?.keyframes.findIndex((k) => k.frame === matched) ?? 0));
    setKeyPicked(false);
    setCandidate(0);
  }
  const segments = fix?.segments && fix.segments.length > 1 ? fix.segments : null;
  const summarised = useMemo(() => segmentSummary(fix), [fix]);
  const places = summarised?.places.length ?? 0;
  // "mindestens": undetermined stretches, or a place the world model joined from far apart.
  const atLeast = summarised ? placesLowerBound(summarised) : false;
  const chosen = segments ? (segments[Math.min(segment, segments.length - 1)] ?? null) : null;
  // A fix that shows none of its stretches (engine 12: one recognised place that covers too little
  // of the recording): its place, time and spaces are the whole file's, said in the header and
  // drawn on the map besides the stretches.
  const whole = fix ? wholeFileShown(fix) : false;
  // With stretches the map turns to the chosen one (or the first located; a chosen candidate goes
  // first; an undetermined stretch of a fix that shows none: the fix's own place) and shows as far
  // as the farthest of the others, so that the route stays in view around it.
  const pickedCandidate = fix && candidate > 0 ? (fix.candidates[candidate] ?? null) : null;
  const segmentAt = pickedCandidate ?? chosen?.location ?? (whole && fix ? fix.location : null) ?? segments?.find((s) => s.location)?.location ?? null;
  const reach = fix && segments && segmentAt ? stretchMapReach(fix, segmentAt) : null;

  // A recording located stretch by stretch: every located stretch as a numbered marker, joined in
  // time order, the chosen one emphasised with its circle; otherwise the fix with its geometry.
  const route = useMemo(() => {
    if (!fix || !segments) return null;
    const stops = segments.flatMap((s, i) => (s.location ? [{ key: i + 1, lat: s.location.lat, lon: s.location.lon }] : []));
    return routeGeometry(stops, segment + 1, 'seg:', (key) => {
      const loc = segments[key - 1]?.location;
      return loc ? placeText(lang, loc, fix) : '';
    });
  }, [fix, segments, segment, lang]);
  const shapes = useMemo(() => {
    if (!fix) return [];
    if (!route) return fixShapes(fix, fix, countries, false, t, locale);
    // A fix that shows none of its stretches keeps the geometry of its own place (the whole
    // file's, in the header): its circle, sun, shadow, heading and the line to the truth; without
    // their labels where the map shows the whole globe (wholeFileShapes).
    const out = whole && segmentAt ? wholeFileShapes(fix, segmentAt, fixShapes(fix, fix, countries, false, t, locale)) : [];
    if (route.line) out.push(route.line);
    const loc = chosen?.location;
    if (loc) out.push({ kind: 'circle', lat: loc.lat, lon: loc.lon, radiusKm: Math.max(0.05, loc.radiusKm), style: 'dashed', label: `± ${kmText(loc.radiusKm, locale)}` });
    return out;
  }, [fix, route, whole, segmentAt, chosen, countries, t, locale]);
  const markers = useMemo<MapMarker[]>(() => {
    if (!fix?.location) return [];
    // With stretches their numbered markers stand for the fix, unless it shows none of them (its
    // place is then the whole file's, a marker of its own); the truth and a chosen candidate are
    // drawn as without them.
    // Chosen with an undetermined stretch, which has no marker of its own: the header's place then
    // goes with the dials.
    const own: MapMarker = { id: fix.videoId, lat: fix.location.lat, lon: fix.location.lon, shape: 'fix', label: placeText(lang, fix.location, fix), selected: !route || (whole && !chosen?.location) };
    const out: MapMarker[] = route ? [...route.markers, ...(whole ? [own] : [])] : [own];
    if (fix.truth) out.push({ id: 'truth', lat: fix.truth.lat, lon: fix.truth.lon, shape: 'truth', label: t('Wahrheit') });
    const c = fix.candidates[candidate];
    if (c && candidate > 0) out.push({ id: 'cand', lat: c.lat, lon: c.lon, shape: 'incident', label: placeText(lang, c, fix) });
    return out;
  }, [fix, route, whole, chosen, candidate, t, lang]);

  /**
   * Chooses a stretch and puts the video at its start (when the video plays here). The map turns
   * to it, also from a candidate chosen before.
   */
  const chooseSegment = (index: number): void => {
    setSegment(index);
    setKeyPicked(false);
    setCandidate(0);
    const s = segments?.[index];
    const el = player.current;
    if (s && el && !el.error) {
      try {
        el.currentTime = s.startSec + 0.05;
      } catch {
        // not seekable yet (metadata still loading)
      }
    }
  };

  /**
   * The stretch on screen follows the video: playing or scrubbed into another stretch, that one
   * is chosen (without seeking again).
   */
  const followVideo = (el: HTMLVideoElement): void => {
    if (!segments) return;
    const i = segmentIndexAt(segments, el.currentTime);
    if (i >= 0) setSegment(i);
  };

  if (!selected || !video) {
    return <div className="dt-empty-view">{t('Im Reiter ORTUNG eine Aufnahme wählen.')}</div>;
  }
  if (!fix) {
    return <div className="dt-empty-view">{error ? t(error) : t('Befund wird geladen …')}</div>;
  }

  const key = fix.keyframes[Math.min(keyIndex, Math.max(0, fix.keyframes.length - 1))] ?? null;
  const refuseVideo = (): void =>
    setVideoRefused(
      video.status === 'ready' && video.facesMasked > 0
        ? 'Im Video sind Gesichter maskiert; das Original gibt es nur mit Freigabe. Gezeigt wird das Schlüsselbild.'
        : video.status !== 'ready'
          ? 'Das Video wird noch auf Gesichter geprüft; bis dahin wird das Schlüsselbild gezeigt.'
          : 'Das Video lässt sich hier nicht abspielen. Gezeigt wird das Schlüsselbild.',
    );
  const focus = fix.candidates[candidate] ?? fix.location;
  // The map of a fix with stretches turns to segmentAt (above). zoomForRadius(r) - 0.6 puts r
  // about 112 px from the centre, inside the 280 px high map; beyond GLOBE_REACH_KM the whole globe.
  const segmentView =
    segmentAt && reach !== null
      ? { lat: segmentAt.lat, lon: segmentAt.lon, zoom: reach > GLOBE_REACH_KM ? 1.4 : zoomForRadius(Math.max(5, reach * 1.1, segmentAt.radiusKm * 0.3), segmentAt.lat) - 0.6 }
      : null;
  // The heading was matched on one keyframe; on the others its horizon would be drawn over a
  // picture it was not measured on. Older fixes name the frame only in the horizon evidence.
  const matchedFrame = fix.heading ? (fix.heading.frame ?? fix.evidence.find((e) => e.kind === 'horizon')?.frame ?? null) : null;
  const headingHere = fix.heading && key !== null && (matchedFrame === null || matchedFrame === key.frame) ? fix.heading : null;
  const loc = fix.location;
  // A place of ± 7 500 km fixes no time zone: said next to the time.
  const headerZoneDoubt = zoneDoubt(lang, loc);
  const trace = fix.trace ?? [];
  const quick = stageOf(fix) === 'quick';
  const hasSpace = fix.keyframes.some((k) => k.spaceUrl);
  // The header is one statement about the fix: its place, time and confidence (with stretches,
  // those of the stretch it shows, or the whole file's where it shows none). The clock and the sun
  // dial follow the chosen stretch (its own time from engine 11 on; none without a place, except
  // where the fix shows no stretch: the header's time, the whole file's, see dialClock), named
  // above them; and whether RAUM has a space for it.
  const clock = dialClock(fix, segments ? segment : null);
  const clockFor =
    segments && chosen && timedStretches(fix)
      ? [t('Abschnitt {n}', { n: segment + 1 }), spanText(chosen), chosen.location ? placeText(lang, chosen.location, fix) : t('Ort unbestimmt'), clock?.whole ? t('Uhrzeit aus der ganzen Datei') : ''].filter((x) => x !== '').join(' · ')
      : null;
  const stretchSpace = segments ? stretchSpaces(fix, segment).spaces.length > 0 : hasSpace;
  // The skyline is drawn on the keyframe in place of the video (one picture, switched), and only
  // when there is a line to draw.
  const skyline = key !== null && (fix.keyframes.some((k) => k.skyline) || headingHere !== null);
  const skylineOn = skyline && showSkyline;
  const keyThumbs =
    fix.keyframes.length > 1 ? (
      <div className="dt-keys">
        {fix.keyframes.map((k, i) => (
          <button
            key={k.frame}
            type="button"
            className={i === keyIndex ? 'on' : ''}
            onClick={() => {
              setKeyIndex(i);
              setKeyPicked(true);
            }}
            aria-label={`${t('Schlüsselbild')} ${i + 1}`}
          >
            <img src={rel(k.imageUrl)} alt="" loading="lazy" decoding="async" />
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div className="dt-befund-page">
      {/* The result first: where, when, how sure; everything below is the evidence for it. */}
      <header className="dt-result">
        <div className="dt-result-case">
          <span className="label">{t('Aufnahme')}</span>
          <b>{caseLabel(video.name)}</b>
          <span className="low dt-result-stage">
            {video.durationSec ? lengthText(video.durationSec) : ''}
            {fix.status === 'running' ? (
              <span className="dt-tag dt-tag-live">{t('wird geortet …')}</span>
            ) : quick ? (
              `${video.durationSec ? ' · ' : ''}${t('vorläufig')}`
            ) : null}
          </span>
        </div>
        <div className="dt-result-place">
          <span className="label">{t('Ort')}</span>
          <b>{loc ? placeText(lang, loc, fix) : t('Ort unbestimmt')}</b>
          {/* The parts break between them where the header is narrow (a long count of stretches
              next to a deviation); "aus der ganzen Datei" follows the radius, so that it is said
              of the place, not of the count. */}
          <span className="low dt-result-parts" title={loc ? radiusHint(lang, loc) : ''}>
            {loc
              ? [countryText(lang, loc), radiusText(lang, loc), whole ? t('aus der ganzen Datei') : '', segments ? placesText(fix, t) : '']
                  .filter((x) => x !== '')
                  .map((part, i, all) => (
                    // The dot stays with the part before it; the line may break at the space after it.
                    <Fragment key={i}>
                      <span>{i < all.length - 1 ? `${part}\u00a0·` : part}</span>
                      {i < all.length - 1 ? ' ' : ''}
                    </Fragment>
                  ))
              : ''}
          </span>
        </div>
        <div className="dt-result-time">
          <span className="label">{t('Uhrzeit')}</span>
          <b>{bestWindowText(fix) ?? '––:––'}</b>
          <span className="low" title={[fix.time.timezone ?? '', headerZoneDoubt?.hint ?? ''].filter((x) => x !== '').join(' · ')}>
            {fix.time.windows[0] ? t(fix.time.windows[0].label) : t('nicht bestimmbar')}
            {fix.time.timezone ? ` · ${utcOffset(fix.time.timezone, referenceInstant(fix.time, fix.sun))}` : ''}
            {fix.time.timezone && headerZoneDoubt ? ` · ${headerZoneDoubt.text}` : ''}
          </span>
        </div>
        <div className="dt-result-conf">
          <span className="label">{t('Konfidenz')}</span>
          <b>{loc ? formatScore(loc.confidence) : '–'}</b>
          <span className="low">{loc ? t(kindMethod(loc.method)) : ''}</span>
        </div>
        {fix.truth?.errorKm != null && (
          <div className="dt-result-truth">
            <span className="label">{t('Abweichung')}</span>
            <b>{kmText(fix.truth.errorKm, locale)}</b>
            <span className="low">{t('zur Grundwahrheit')}</span>
          </div>
        )}
        <div className="dt-result-actions">
          <button
            type="button"
            className="btn btn-solid"
            onClick={() => go('raum')}
            disabled={!hasSpace}
            title={!hasSpace ? t('Die Räume folgen, sobald die Auswertung des Videos fertig ist.') : stretchSpace ? '' : t('Für diesen Abschnitt ist kein Raum berechnet; RAUM bietet die Abschnitte mit Raum an.')}
          >
            {t('Raum betreten')}
          </button>
          {can('source.write') && (
            <button type="button" className="text-btn" disabled={action.busy || fix.status === 'running'} onClick={() => void action.run(() => recompute(fix.videoId))}>
              {t('Neu orten')}
            </button>
          )}
          {action.error && <span className="note">{t(action.error)}</span>}
        </div>
      </header>

      <div className="dt-befund">
        <div className="dt-col">
          <section className="dt-section">
            {skylineOn && key ? (
              <SkylineFrame imageUrl={rel(key.imageUrl)} skyline={key.skyline} horizonProfile={fix.horizon?.profile ?? null} heading={headingHere} />
            ) : video.playable && videoRefused === null ? (
              <video
                className="dt-video"
                src={`media/${video.id}/source`}
                poster={key ? rel(key.imageUrl) : undefined}
                controls
                muted
                playsInline
                preload="metadata"
                ref={(el) => {
                  player.current = el;
                  // The refusal can arrive before the element is in the page (switching tabs builds
                  // the view while the request is already running); React then never calls onError.
                  if (el?.error) refuseVideo();
                }}
                onError={refuseVideo}
                // The video opens at the stretch the page shows (that of the fix's place), and the
                // chosen stretch follows what plays.
                onLoadedMetadata={(e) => {
                  const el = e.currentTarget;
                  if (chosen && chosen.startSec > 0 && el.currentTime < 0.05) el.currentTime = chosen.startSec + 0.05;
                }}
                onTimeUpdate={(e) => followVideo(e.currentTarget)}
                onSeeked={(e) => followVideo(e.currentTarget)}
              />
            ) : chosen && !keyPicked ? (
              // The video does not play here: the chosen stretch's keyframe stands for it, until a
              // keyframe below is clicked.
              <img className="dt-video" src={rel(chosen.keyframe.imageUrl)} alt="" />
            ) : (
              key && <img className="dt-video" src={rel(key.imageUrl)} alt="" />
            )}
            {videoRefused !== null && !skylineOn && <p className="note">{t(videoRefused)}</p>}
            {skyline && (
              <div className="dt-media-switch" role="group" aria-label={t('Ansicht')}>
                <button type="button" className="text-btn" aria-pressed={!skylineOn} onClick={() => setShowSkyline(false)}>
                  {video.playable ? t('Video') : t('Bild')}
                </button>
                <button type="button" className="text-btn" aria-pressed={skylineOn} onClick={() => setShowSkyline(true)}>
                  {t('Himmelslinie und Horizont')}
                </button>
              </div>
            )}
            {segments && fix.status === 'ready' && (
              <SegmentTimeline fix={fix} segments={segments} selected={Math.min(segment, segments.length - 1)} onSelect={chooseSegment} places={places} atLeast={atLeast} />
            )}
            {keyThumbs}
          </section>
        </div>

        <div className="dt-col">
          <section className="dt-section">
            <EvidenceList evidence={fix.evidence} at={loc} />
          </section>
          <section className="dt-section">
            {/* With a time per stretch the dials show the chosen one: say which. */}
            {clockFor && <p className="dt-dial-for">{clockFor}</p>}
            {clock ? (
              <ClockDial time={clock.time} sun={clock.sun} compact />
            ) : (
              <p className="empty">
                {chosen?.location ? t('Für diesen Abschnitt ließ sich keine Uhrzeit bestimmen.') : t('Dieser Abschnitt hat keinen Ort und daher keine Uhrzeit.')}
              </p>
            )}
          </section>
          {clock?.sun && (
            <section className="dt-section">
              {/* The heading belongs to the keyframe of the stretch the fix shows. */}
              <SunDial sun={clock.sun} heading={clock.own ? null : fix.heading} time={clock.time} />
            </section>
          )}
          {trace.length > 0 && (
            <section className="dt-section">
              {/* The steps of the analysis are for checking, not for reading first: folded while the fix is done. */}
              <details className="dt-trace-box" open={fix.status === 'running'}>
                <summary className="label">
                  {t('Ablauf')} <span className="count">{trace.length}</span>
                  <span className="low">{formatDecimal(trace.reduce((a, s) => a + s.ms, 0) / 1000, 1)} s</span>
                </summary>
                <ol className="dt-trace">
                  {trace.map((s, i) => (
                    <li key={i}>
                      <span className="dt-trace-ms">{s.ms < 1000 ? `${s.ms.toLocaleString(locale)} ms` : `${formatDecimal(s.ms / 1000, 1)} s`}</span>
                      <span className="dt-trace-label">{t(s.label)}</span>
                      {s.detail && <span className="dt-trace-detail">{pick(s.detail, s.detailEn)}</span>}
                    </li>
                  ))}
                  {fix.status === 'running' && <li className="dt-trace-run">{t('läuft …')}</li>}
                </ol>
              </details>
            </section>
          )}
        </div>

        <div className="dt-col">
          <section className="dt-section">
            <div className="dt-mini-map">
              {segmentView ? (
                <MapCanvas
                  view={segmentView}
                  viewKey={`${fix.videoId}:${fix.computedAt}:seg${segment}:${candidate}`}
                  markers={markers}
                  shapes={shapes}
                  minZoom={1}
                  maxZoom={16}
                  readouts={false}
                  globe
                  onSelect={(id) => {
                    // A marker several stretches share: each click the next of them.
                    const key = id && route ? nextKey(route.keys.get(id) ?? [], segment + 1) : null;
                    if (key !== null) chooseSegment(key - 1);
                  }}
                />
              ) : focus ? (
                <MapCanvas
                  view={{ lat: focus.lat, lon: focus.lon, zoom: zoomForRadius(Math.max(0.3, (focus as { radiusKm: number }).radiusKm), focus.lat) - 0.6 }}
                  viewKey={`${fix.videoId}:${fix.computedAt}:${candidate}`}
                  markers={markers}
                  shapes={shapes}
                  minZoom={1}
                  maxZoom={16}
                  readouts={false}
                  globe
                />
              ) : (
                <div className="dt-empty-view">{t('Ort unbestimmt')}</div>
              )}
            </div>
          </section>
          <section className="dt-section">
            <FixSummary fix={fix} />
          </section>
          <section className="dt-section">
            <CandidateList candidates={fix.candidates} selected={candidate} onSelect={setCandidate} fix={fix} />
          </section>
          <section className="dt-section">
            <CountryBars countries={fix.countries} limit={5} />
          </section>
        </div>
      </div>
    </div>
  );
}

export const Befund = memo(BefundView);
