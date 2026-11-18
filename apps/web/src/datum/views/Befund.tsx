import { memo, useEffect, useMemo, useState } from 'react';
import { formatDecimal, formatDuration, formatScore } from '../../format';
import { useLang } from '../../i18n';
import { MapCanvas, type MapMarker } from '../../map/MapCanvas';
import { useAction } from '../../ui';
import { recompute, rel, fetchCountries, type CountryShape } from '../api';
import { caseLabel, countryText, placeText, stageOf } from '../labels';
import { CandidateList, ClockDial, CountryBars, EvidenceList, FixSummary, SkylineFrame, SunDial } from '../panel';
import { KIND_METHOD } from '../panel/common';
import { bestWindowText, kmText, useFullFix, zoomForRadius } from '../useFixes';
import { fixShapes, type DatumViewProps } from './Ortung';

function BefundView({ videos, can, byId, selected, go }: DatumViewProps) {
  const lang = useLang();
  const { t, locale, pick } = lang;
  const summary = selected ? byId.get(selected) : undefined;
  const { fix, error } = useFullFix(selected, summary);
  const [keyIndex, setKeyIndex] = useState(0);
  const [candidate, setCandidate] = useState(0);
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
    setCandidate(0);
  }

  const shapes = useMemo(() => (fix ? fixShapes(fix, fix, countries, false, t, locale) : []), [fix, countries, t, locale]);
  const markers = useMemo<MapMarker[]>(() => {
    if (!fix?.location) return [];
    const out: MapMarker[] = [{ id: fix.videoId, lat: fix.location.lat, lon: fix.location.lon, shape: 'fix', label: placeText(lang, fix.location, fix), selected: true }];
    if (fix.truth) out.push({ id: 'truth', lat: fix.truth.lat, lon: fix.truth.lon, shape: 'truth', label: t('Wahrheit') });
    const c = fix.candidates[candidate];
    if (c && candidate > 0) out.push({ id: 'cand', lat: c.lat, lon: c.lon, shape: 'incident', label: placeText(lang, c, fix) });
    return out;
  }, [fix, candidate, t, lang]);

  if (!selected || !video) {
    return <div className="dt-empty-view">{t('Im Reiter ORTUNG eine Aufnahme wählen.')}</div>;
  }
  if (!fix) {
    return <div className="dt-empty-view">{error ? t(error) : t('Befund wird geladen …')}</div>;
  }

  const key = fix.keyframes[Math.min(keyIndex, Math.max(0, fix.keyframes.length - 1))] ?? null;
  const focus = fix.candidates[candidate] ?? fix.location;
  // The heading was matched on one keyframe; on the others its horizon would be drawn over a
  // picture it was not measured on. Older fixes name the frame only in the horizon evidence.
  const matchedFrame = fix.heading ? (fix.heading.frame ?? fix.evidence.find((e) => e.kind === 'horizon')?.frame ?? null) : null;
  const headingHere = fix.heading && key !== null && (matchedFrame === null || matchedFrame === key.frame) ? fix.heading : null;
  const loc = fix.location;
  const trace = fix.trace ?? [];
  const quick = stageOf(fix) === 'quick';
  const hasSpace = fix.keyframes.some((k) => k.spaceUrl);

  return (
    <div className="dt-befund-page">
      {/* The result first: where, when, how sure; everything below is the evidence for it. */}
      <header className="dt-result">
        <div className="dt-result-case">
          <span className="label">{t('Aufnahme')}</span>
          <b>{caseLabel(video.name)}</b>
          <span className="dt-result-stage">
            {fix.status === 'running' ? (
              <span className="dt-tag dt-tag-live">{t('wird geortet …')}</span>
            ) : quick ? (
              <span className="dt-tag dt-tag-live">{t('schnell geortet · Räume folgen')}</span>
            ) : (
              <span className="dt-tag">{t('vollständig')}</span>
            )}
            {video.durationSec ? <span className="low"> {formatDuration(video.durationSec)}</span> : null}
          </span>
        </div>
        <div className="dt-result-place">
          <span className="label">{t('Ort')}</span>
          <b>{loc ? placeText(lang, loc, fix) : t('Ort unbestimmt')}</b>
          <span className="low">{loc ? [countryText(lang, loc), `± ${kmText(loc.radiusKm, locale)}`].filter((x) => x !== '').join(' · ') : ''}</span>
        </div>
        <div className="dt-result-time">
          <span className="label">{t('Uhrzeit')}</span>
          <b>{bestWindowText(fix) ?? '––:––'}</b>
          <span className="low">
            {fix.time.windows[0] ? t(fix.time.windows[0].label) : t('nicht bestimmbar')}
            {fix.time.timezone ? ` · ${fix.time.timezone}` : ''}
          </span>
        </div>
        <div className="dt-result-conf">
          <span className="label">{t('Konfidenz')}</span>
          <b>{loc ? formatScore(loc.confidence) : '–'}</b>
          <span className="low">{loc ? t(KIND_METHOD[loc.method]) : ''}</span>
        </div>
        {fix.truth?.errorKm != null && (
          <div className="dt-result-truth">
            <span className="label">{t('Abweichung')}</span>
            <b>{kmText(fix.truth.errorKm, locale)}</b>
            <span className="low">{t('zur Grundwahrheit')}</span>
          </div>
        )}
        <div className="dt-result-actions">
          <button type="button" className="btn btn-solid" onClick={() => go('raum')} disabled={!hasSpace} title={hasSpace ? '' : t('Die Räume folgen, sobald die Auswertung des Videos fertig ist.')}>
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
            {video.playable ? (
              <video className="dt-video" src={`media/${video.id}/source`} poster={key ? rel(key.imageUrl) : undefined} controls muted playsInline preload="metadata" />
            ) : (
              key && <img className="dt-video" src={rel(key.imageUrl)} alt="" />
            )}
          </section>
          {key && (
            <section className="dt-section">
              <div className="label">{t('Himmelslinie und Horizont')}</div>
              <SkylineFrame imageUrl={rel(key.imageUrl)} skyline={key.skyline} horizonProfile={fix.horizon?.profile ?? null} heading={headingHere} />
              {fix.keyframes.length > 1 && (
                <div className="dt-keys">
                  {fix.keyframes.map((k, i) => (
                    <button key={k.frame} type="button" className={i === keyIndex ? 'on' : ''} onClick={() => setKeyIndex(i)} aria-label={`${t('Schlüsselbild')} ${i + 1}`}>
                      <img src={rel(k.imageUrl)} alt="" loading="lazy" decoding="async" />
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        <div className="dt-col">
          <section className="dt-section">
            <EvidenceList evidence={fix.evidence} />
          </section>
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
          <section className="dt-section">
            <ClockDial time={fix.time} sun={fix.sun} />
          </section>
          {fix.sun && (
            <section className="dt-section">
              <div className="label">{t('Sonnenstand')}</div>
              <SunDial sun={fix.sun} heading={fix.heading} time={fix.time} />
            </section>
          )}
        </div>

        <div className="dt-col">
          <section className="dt-section">
            <div className="dt-mini-map">
              {focus ? (
                <MapCanvas
                  view={{ lat: focus.lat, lon: focus.lon, zoom: zoomForRadius(Math.max(0.3, (focus as { radiusKm: number }).radiusKm), focus.lat) - 0.6 }}
                  viewKey={`${fix.videoId}:${fix.computedAt}:${candidate}`}
                  markers={markers}
                  shapes={shapes}
                  minZoom={1}
                  maxZoom={16}
                  readouts={false}
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
            <CountryBars countries={fix.countries} limit={6} />
          </section>
        </div>
      </div>
    </div>
  );
}

export const Befund = memo(BefundView);
