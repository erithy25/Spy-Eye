import { useEffect, useMemo, useState } from 'react';
import { useLang } from '../../i18n';
import { MapCanvas, type MapMarker } from '../../map/MapCanvas';
import { useAction } from '../../ui';
import { recompute, rel, fetchCountries, type CountryShape } from '../api';
import { CandidateList, ClockDial, CountryBars, EvidenceList, FixSummary, SkylineFrame, SunDial } from '../panel';
import { useFullFix, zoomForRadius } from '../useFixes';
import { fixShapes, type DatumViewProps } from './Ortung';

export function Befund({ node, byId, selected, go }: DatumViewProps) {
  const { t, locale } = useLang();
  const summary = selected ? byId.get(selected) : undefined;
  const { fix, error } = useFullFix(selected, summary);
  const [keyIndex, setKeyIndex] = useState(0);
  const [candidate, setCandidate] = useState(0);
  const [countries, setCountries] = useState<CountryShape[]>([]);
  const action = useAction();
  const video = node.app?.videos.find((v) => v.id === selected) ?? null;

  useEffect(() => {
    void fetchCountries().then(setCountries);
  }, []);
  useEffect(() => {
    setKeyIndex(0);
    setCandidate(0);
  }, [selected]);

  const shapes = useMemo(() => (fix ? fixShapes(fix, fix, countries, false, t) : []), [fix, countries, t]);
  const markers = useMemo<MapMarker[]>(() => {
    if (!fix?.location) return [];
    const out: MapMarker[] = [{ id: fix.videoId, lat: fix.location.lat, lon: fix.location.lon, shape: 'fix', label: fix.location.label, selected: true }];
    if (fix.truth) out.push({ id: 'truth', lat: fix.truth.lat, lon: fix.truth.lon, shape: 'truth', label: t('Wahrheit') });
    const c = fix.candidates[candidate];
    if (c && candidate > 0) out.push({ id: 'cand', lat: c.lat, lon: c.lon, shape: 'incident', label: c.label });
    return out;
  }, [fix, candidate, t]);

  if (!selected || !video) {
    return <div className="dt-empty-view">{t('Im Reiter ORTUNG eine Aufnahme wählen.')}</div>;
  }
  if (!fix) {
    return <div className="dt-empty-view">{error ?? t('Befund wird geladen …')}</div>;
  }

  const key = fix.keyframes[Math.min(keyIndex, Math.max(0, fix.keyframes.length - 1))] ?? null;
  const focus = fix.candidates[candidate] ?? fix.location;

  return (
    <div className="dt-befund">
      <div className="dt-col">
        <section className="dt-section">
          <div className="label">
            {t('Aufnahme')} <span className="count">{video.name.replace(/\.mp4$/i, '').toUpperCase()}</span>
            {video.durationSec ? <span className="low">{Math.round(video.durationSec)} s</span> : null}
          </div>
          {video.playable ? (
            <video className="dt-video" src={`media/${video.id}/source`} poster={key ? rel(key.imageUrl) : undefined} controls muted playsInline preload="metadata" />
          ) : (
            key && <img className="dt-video" src={rel(key.imageUrl)} alt="" />
          )}
        </section>
        {key && (
          <section className="dt-section">
            <div className="label">{t('Himmelslinie und Horizont')}</div>
            <SkylineFrame imageUrl={rel(key.imageUrl)} skyline={key.skyline} horizonProfile={fix.horizon?.profile ?? null} heading={fix.heading} />
            {fix.keyframes.length > 1 && (
              <div className="dt-keys">
                {fix.keyframes.map((k, i) => (
                  <button key={k.frame} type="button" className={i === keyIndex ? 'on' : ''} onClick={() => setKeyIndex(i)} aria-label={`${t('Schlüsselbild')} ${i + 1}`}>
                    <img src={rel(k.imageUrl)} alt="" />
                  </button>
                ))}
              </div>
            )}
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button type="button" className="btn btn-solid" onClick={() => go('raum')} disabled={!fix.keyframes.some((k) => k.spaceUrl)}>
                {t('Raum betreten')}
              </button>
              {node.can('source.write') && (
                <button type="button" className="btn" disabled={action.busy} onClick={() => void action.run(() => recompute(fix.videoId))}>
                  {t('Neu orten')}
                </button>
              )}
            </div>
            {action.error && <p className="note">{action.error}</p>}
          </section>
        )}
        <section className="dt-section">
          <EvidenceList evidence={fix.evidence} />
        </section>
      </div>

      <div className="dt-col">
        <section className="dt-section">
          <FixSummary fix={fix} />
        </section>
        {(fix.trace?.length ?? 0) > 0 && (
          <section className="dt-section">
            <div className="label">
              {t('Ablauf')} <span className="count">{fix.trace!.length}</span>
              <span className="low">{(fix.trace!.reduce((a, s) => a + s.ms, 0) / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} s</span>
            </div>
            <ol className="dt-trace">
              {fix.trace!.map((s, i) => (
                <li key={i}>
                  <span className="dt-trace-ms">{s.ms < 1000 ? `${s.ms} ms` : `${(s.ms / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} s`}</span>
                  <span className="dt-trace-label">{t(s.label)}</span>
                  {s.detail && <span className="dt-trace-detail">{s.detail}</span>}
                </li>
              ))}
              {fix.status === 'running' && <li className="dt-trace-run">{t('läuft …')}</li>}
            </ol>
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
          <div className="label">{t('Ort')}</div>
          <div className="dt-mini-map">
            {focus ? (
              <MapCanvas
                view={{ lat: focus.lat, lon: focus.lon, zoom: zoomForRadius(Math.max(0.3, (focus as { radiusKm: number }).radiusKm), focus.lat) - 0.6 }}
                viewKey={`${fix.videoId}:${candidate}`}
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
          <CandidateList candidates={fix.candidates} selected={candidate} onSelect={setCandidate} />
        </section>
        <section className="dt-section">
          <CountryBars countries={fix.countries} limit={6} />
        </section>
      </div>
    </div>
  );
}
