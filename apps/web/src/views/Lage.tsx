import { useEffect, useMemo, useRef, useState } from 'react';
import {
  exercise,
  reviewAlert,
  setIncidentStatus,
  type Alert,
  type ExerciseAction,
  type FeedState,
  type Incident,
  type ScenarioInfo,
  type SourceInfo,
  type Watch,
} from '../api';
import type { ViewProps } from '../App';
import type { FrameTarget } from '../components/FrameSheet';
import { formatClock, formatExercise, formatScore, formatTime } from '../format';
import { useLang } from '../i18n';
import { MapCanvas, type MapMarker, type MapView } from '../map/MapCanvas';
import { tagLabel } from '../tags';
import { Frame, Glyph, KIND_LABEL, pressable, Sev, useAction } from '../ui';
import type { NodeConnection } from '../useNode';

const SPEEDS = [1, 2, 4, 8];
export const HAZARD_LABEL: Record<string, string> = { flood: 'Überflutung', fire: 'Brand', collapse: 'Einsturz', normal: 'Unauffällig' };

/** `pick` words the source in the console language (sourceNameEn where the node sends one). */
export function alertTarget(alert: Alert, watches: Watch[], pick: (de: string, en?: string | null) => string): FrameTarget {
  const watch = watches.find((w) => w.id === alert.watchId);
  return {
    videoId: alert.videoId,
    frameNumber: alert.frameNumber,
    frameUrl: alert.frameUrl,
    time: null,
    sceneIndex: null,
    at: alert.lastSeen,
    sourceName: pick(alert.sourceName, alert.sourceNameEn),
    lat: alert.lat,
    lon: alert.lon,
    // A text watch can show where in the picture it responded.
    query: watch && watch.kind === 'text' && watch.prompt !== '' ? watch.prompt : null,
    confidence: alert.confidence,
    score: alert.score,
    box: alert.box,
    alert,
  };
}

/** Exercise clock that keeps running between the node's updates. */
function useExerciseClock(scenario: ScenarioInfo | null): number {
  const [now, setNow] = useState(() => Date.now());
  const [anchor, setAnchor] = useState({ elapsed: 0, at: Date.now() });
  useEffect(() => {
    setAnchor({ elapsed: scenario?.elapsedSec ?? 0, at: Date.now() });
  }, [scenario?.elapsedSec, scenario?.status, scenario?.speed]);
  const running = scenario?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [running]);
  if (!scenario) return 0;
  if (!running) return scenario.elapsedSec;
  return Math.min(scenario.durationSec, anchor.elapsed + ((now - anchor.at) / 1000) * scenario.speed);
}

function ExerciseControl({ node, scenario, elapsed }: { node: NodeConnection; scenario: ScenarioInfo; elapsed: number }) {
  const { t, pick } = useLang();
  const [speed, setSpeed] = useState(4);
  const action = useAction();
  const may = node.can('scenario.control');
  const call = (what: ExerciseAction, withSpeed?: number): void => {
    void action.run(async () => node.applyIntel(await exercise(what, withSpeed)));
  };
  const alerts = (node.intel?.alerts ?? []).filter((a) => a.exercise && a.exerciseSec !== null);
  const active = scenario.status === 'running' || scenario.status === 'paused' || scenario.status === 'finished';

  return (
    <div className="control">
      <span className="label">{pick(scenario.title, scenario.titleEn)}</span>
      {scenario.status === 'absent' && (
        <>
          <button type="button" className="btn btn-solid" disabled={!may || action.busy} onClick={() => call('install')}>
            {t('Übungsmaterial einspielen')}
          </button>
          <span className="low" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {action.error ?? scenario.problem ?? pick(scenario.description, scenario.descriptionEn)}
          </span>
        </>
      )}
      {scenario.status === 'installing' && (
        <>
          <span className="blink" />
          <span>
            {t('Material wird ausgewertet')} · {scenario.clipsReady}/{scenario.clipsTotal}
          </span>
          <span className="bar" style={{ flex: 1, maxWidth: 360 }}>
            <span style={{ width: `${Math.round((scenario.clipsReady / Math.max(1, scenario.clipsTotal)) * 100)}%` }} />
          </span>
          {scenario.problem && <span className="note">{scenario.problem}</span>}
        </>
      )}
      {scenario.status === 'ready' && (
        <>
          <button type="button" className="btn btn-solid" disabled={!may || action.busy} onClick={() => call('start', speed)}>
            {t('Übung starten')}
          </button>
          <span className="segments">
            {SPEEDS.map((s) => (
              <button key={s} type="button" className={speed === s ? 'segment segment-on' : 'segment'} onClick={() => setSpeed(s)}>
                {s}×
              </button>
            ))}
          </span>
          <span className="low">
            {scenario.clipsTotal} {t('Aufnahmen bereit')} · {formatTime(scenario.durationSec)} {t('Übungszeit')}
          </span>
          {action.error && <span className="note">{action.error}</span>}
        </>
      )}
      {active && (
        <>
          <span className="clock">
            {formatExercise(elapsed)} <small>/ {formatTime(scenario.durationSec)}</small>
          </span>
          <div className="timeline" aria-hidden="true">
            {Array.from({ length: Math.floor(scenario.durationSec / 60) + 1 }, (_, i) => (
              <span key={i} className="tick" style={{ left: `${((i * 60) / scenario.durationSec) * 100}%` }} />
            ))}
            {alerts.map((a) => (
              <i
                key={a.id}
                style={{
                  left: `${Math.min(100, ((a.exerciseSec ?? 0) / scenario.durationSec) * 100)}%`,
                  height: `${3 + a.severity * 3}px`,
                  opacity: a.status === 'dismissed' ? 0.3 : 1,
                }}
              />
            ))}
            <span className="now" style={{ left: `${Math.min(100, (elapsed / scenario.durationSec) * 100)}%` }} />
          </div>
          {may && (
            <>
              <span className="segments">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={scenario.speed === s ? 'segment segment-on' : 'segment'}
                    disabled={scenario.status === 'finished'}
                    onClick={() => call('speed', s)}
                  >
                    {s}×
                  </button>
                ))}
              </span>
              {scenario.status === 'running' && (
                <button type="button" className="btn" disabled={action.busy} onClick={() => call('pause')}>
                  {t('Pause')}
                </button>
              )}
              {scenario.status === 'paused' && (
                <button type="button" className="btn btn-solid" disabled={action.busy} onClick={() => call('resume')}>
                  {t('Fortsetzen')}
                </button>
              )}
              {scenario.status === 'finished' && (
                <button type="button" className="btn btn-solid" disabled={action.busy} onClick={() => call('start', scenario.speed)}>
                  {t('Neu starten')}
                </button>
              )}
              <button
                type="button"
                className="btn"
                disabled={action.busy}
                onClick={() => {
                  if (window.confirm(t('Übung beenden? Meldungen und Lagen dieses Laufs werden verworfen.'))) call('stop');
                }}
              >
                {t('Ende')}
              </button>
            </>
          )}
        </>
      )}
      <span className="right">
        {node.can('search') && (
          <>
            <a className="btn" href="api/report/situation" target="_blank" rel="noreferrer">
              {t('Lagebericht')}
            </a>
            <a className="btn" href="api/export/incidents.geojson" target="_blank" rel="noreferrer">
              GeoJSON
            </a>
          </>
        )}
      </span>
    </div>
  );
}

function AlertRow({ alert, node, onOpen }: { alert: Alert; node: NodeConnection; onOpen: () => void }) {
  const { t, pick, locale, n } = useLang();
  const action = useAction();
  const verdict = (value: 'confirmed' | 'dismissed'): void => {
    void action.run(async () => {
      const result = await reviewAlert(alert.id, value);
      node.patchAlert(result.alert);
      if (result.watch) node.patchWatch(result.watch);
    });
  };
  const cls = alert.status === 'dismissed' ? 'alert alert-off' : alert.status === 'new' && alert.active ? 'alert alert-new' : 'alert';
  // The alert keeps the name its source had when it was raised; the list shows the name in the chosen language.
  const source = node.intel?.sources.find((s) => s.id === alert.sourceId);
  const sourceName = source ? pick(source.name, source.nameEn) : pick(alert.sourceName, alert.sourceNameEn);
  return (
    <li className={cls}>
      <Frame src={alert.frameUrl} box={alert.box} onClick={onOpen} />
      <div className="alert-main">
        <div className="alert-title">
          <b title={pick(alert.watchName, alert.watchNameEn)}>
            <Sev level={alert.severity} /> {pick(alert.watchName, alert.watchNameEn)}
          </b>
          <span className="low">{alert.exerciseSec !== null ? formatExercise(alert.exerciseSec) : formatClock(alert.firstSeen, locale)}</span>
        </div>
        <div className="alert-line">
          <Glyph kind={alert.sourceKind} /> {sourceName}
        </div>
        <div className="alert-line low">
          {t('Sicherheit')} {formatScore(alert.confidence)} · {n(alert.frames, 'frame')} · {alert.active ? t('dauert an') : t('beendet')}
        </div>
        {alert.secondOpinion && (
          <div className="alert-line low" title={t('Unabhängige Einschätzung des trainierten Gefahrenmodells für Luftbilder')}>
            {t('Zweitmeinung Modell')}: {t(HAZARD_LABEL[alert.secondOpinion.label] ?? alert.secondOpinion.label)} {formatScore(alert.secondOpinion.p)}
          </div>
        )}
        {node.can('alert.triage') && alert.status === 'new' ? (
          <div className="btn-row">
            <button type="button" className="btn btn-small" disabled={action.busy} onClick={() => verdict('confirmed')}>
              {t('Bestätigen')}
            </button>
            <button type="button" className="btn btn-small" disabled={action.busy} onClick={() => verdict('dismissed')}>
              {t('Verwerfen')}
            </button>
          </div>
        ) : (
          <div className="alert-line">
            {alert.status === 'confirmed' ? t('Bestätigt') : alert.status === 'dismissed' ? t('Verworfen') : t('Offen')}
            {alert.reviewedBy ? ` · ${alert.reviewedBy}` : ''}
          </div>
        )}
        {action.error && <p className="note">{action.error}</p>}
      </div>
    </li>
  );
}

function IncidentRow({ incident, node, selected, onSelect }: { incident: Incident; node: NodeConnection; selected: boolean; onSelect: () => void }) {
  const { t, pick, locale, n } = useLang();
  const action = useAction();
  const set = (status: Incident['status']): void => {
    void action.run(async () => node.patchIncident(await setIncidentStatus(incident.id, status)));
  };
  return (
    <li className={`incident${selected ? ' incident-on' : ''}${incident.status === 'closed' ? ' incident-closed' : ''}`} {...pressable(onSelect, selected)}>
      <h4>
        <Sev level={incident.severity} />
        <span title={pick(incident.title, incident.titleEn)}>{pick(incident.title, incident.titleEn)}</span>
        {incident.corroboration > 1 && (
          <span className="pill pill-on">
            {n(incident.corroboration, 'source')}
          </span>
        )}
      </h4>
      <div className="alert-line">{incident.mgrs}</div>
      <div className="alert-line low">
        {n(incident.alertIds.length, 'alert')} · {t('seit')} {formatClock(incident.firstSeen, locale)} ·{' '}
        {incident.status === 'open' ? t('offen') : incident.status === 'acknowledged' ? t('zur Kenntnis genommen') : t('abgeschlossen')}
      </div>
      {selected && (
        <div className="btn-row" style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
          {node.can('alert.triage') && incident.status === 'open' && (
            <button type="button" className="btn btn-small" disabled={action.busy} onClick={() => set('acknowledged')}>
              {t('Zur Kenntnis')}
            </button>
          )}
          {node.can('alert.triage') && incident.status !== 'closed' && (
            <button type="button" className="btn btn-small" disabled={action.busy} onClick={() => set('closed')}>
              {t('Abschließen')}
            </button>
          )}
          {node.can('search') && (
            <a className="btn btn-small" href={`api/export/incidents/${incident.id}/cap`} target="_blank" rel="noreferrer">
              CAP
            </a>
          )}
        </div>
      )}
      {action.error && <p className="note">{action.error}</p>}
    </li>
  );
}

export function Lage({ node, openFrame }: ViewProps) {
  const { t, pick, locale, lang } = useLang();
  const intel = node.intel;
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<string | null>(null);
  const [jump, setJump] = useState<{ view: MapView; key: string } | null>(null);
  const scenario = intel?.scenario ?? null;
  const elapsed = useExerciseClock(scenario);

  const sources = intel?.sources ?? [];
  const feeds = useMemo(() => new Map((intel?.feeds ?? []).map((f) => [f.sourceId, f])), [intel?.feeds]);
  const alerts = intel?.alerts ?? [];
  const incidents = intel?.incidents ?? [];
  const watches = intel?.watches ?? [];

  // Says a new alert aloud for people who do not see the list change. Alerts that were already
  // there when the view opened are not announced.
  const announced = useRef<Set<string> | null>(null);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (!intel) return;
    if (announced.current === null) {
      announced.current = new Set(alerts.map((a) => a.id));
      return;
    }
    const known = announced.current;
    const fresh = alerts.filter((a) => !known.has(a.id));
    if (fresh.length === 0) return;
    for (const a of fresh) known.add(a.id);
    const newest = fresh.reduce((best, a) => (a.firstSeen > best.firstSeen ? a : best));
    setAnnouncement(`${t('Neue Meldung')}: ${pick(newest.watchName, newest.watchNameEn)} · ${pick(newest.sourceName, newest.sourceNameEn)}`);
  }, [intel, alerts, pick, t]);

  const severityBySource = useMemo(() => {
    const map = new Map<string, { severity: 1 | 2 | 3; name: string; nameEn: string }>();
    for (const a of alerts) {
      if (!a.active || a.status === 'dismissed') continue;
      const current = map.get(a.sourceId);
      if (!current || a.severity > current.severity) map.set(a.sourceId, { severity: a.severity, name: a.watchName, nameEn: a.watchNameEn });
    }
    return map;
  }, [alerts]);

  const markers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = [];
    for (const incident of incidents) {
      if (incident.status === 'closed') continue;
      list.push({ id: `in:${incident.id}`, lat: incident.lat, lon: incident.lon, shape: 'incident', label: '', selected: incident.id === selectedIncident });
    }
    for (const s of sources) {
      if (s.lat === null || s.lon === null) continue;
      const feed = feeds.get(s.id);
      const alert = severityBySource.get(s.id);
      list.push({
        id: s.id,
        lat: s.lat,
        lon: s.lon,
        shape: s.kind,
        label: pick(s.name, s.nameEn),
        ...(alert ? { sub: pick(alert.name, alert.nameEn), alert: alert.severity } : {}),
        dim: s.mode !== 'archive' && feed?.online !== true,
        selected: s.id === selectedSource,
      });
    }
    return list;
  }, [sources, feeds, severityBySource, incidents, selectedSource, selectedIncident, pick]);

  const view = useMemo<MapView>(() => {
    if (jump) return jump.view;
    if (scenario && scenario.status !== 'absent') return scenario.center;
    const info = node.info?.node;
    return { lat: info?.lat ?? 51, lon: info?.lon ?? 10, zoom: 12 };
  }, [jump, scenario, node.info]);
  const viewKey = jump ? jump.key : scenario && scenario.status !== 'absent' ? `scenario:${scenario.id}` : 'home';

  const sortedAlerts = useMemo(
    () =>
      [...alerts]
        .sort((a, b) => Number(b.active && b.status === 'new') - Number(a.active && a.status === 'new') || b.firstSeen - a.firstSeen)
        .slice(0, 80),
    [alerts],
  );
  const sortedIncidents = useMemo(
    () => [...incidents].sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || b.severity - a.severity || b.lastSeen - a.lastSeen),
    [incidents],
  );
  const alertTargets = useMemo(() => sortedAlerts.map((a) => alertTarget(a, watches, pick)), [sortedAlerts, watches, pick]);

  const source: SourceInfo | null = sources.find((s) => s.id === selectedSource) ?? null;
  const sourceFeed: FeedState | null = source ? (feeds.get(source.id) ?? null) : null;
  const sourceAlerts = source ? alerts.filter((a) => a.sourceId === source.id && a.active && a.status !== 'dismissed') : [];
  const wallSources = sources.filter((s) => s.mode !== 'archive' || s.id !== 'eingang').filter((s) => feeds.has(s.id));

  if (!intel) return <div className="page empty">{t('Lade Lage …')}</div>;

  return (
    <div className="lage">
      <div className="lage-map">
        <MapCanvas
          view={view}
          viewKey={viewKey}
          markers={markers}
          grid
          label={`${t('Übersicht')} · ${node.info?.node.region || node.info?.node.name || ''}`}
          onSelect={(id) => {
            if (id === null) {
              setSelectedSource(null);
              return;
            }
            if (id.startsWith('in:')) {
              setSelectedIncident(id.slice(3));
              return;
            }
            setSelectedSource(id);
          }}
        >
          {source && (
            <div className="float" onPointerDown={(e) => e.stopPropagation()} onPointerMove={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
              <h4>
                <span>
                  <Glyph kind={source.kind} /> {pick(source.name, source.nameEn)}
                </span>
                <button type="button" className="text-btn" onClick={() => setSelectedSource(null)} aria-label={t('Schließen')}>
                  ×
                </button>
              </h4>
              <Frame
                src={sourceFeed?.frameUrl ?? null}
                empty={source.mode === 'exercise' ? t('kein Bild') : t('Archivquelle')}
                {...(sourceFeed?.videoId && sourceFeed.frameNumber !== null && sourceFeed.frameUrl
                  ? {
                      onClick: () =>
                        openFrame({
                          videoId: sourceFeed.videoId as string,
                          frameNumber: sourceFeed.frameNumber as number,
                          frameUrl: sourceFeed.frameUrl as string,
                          time: null,
                          sceneIndex: null,
                          at: sourceFeed.at,
                          sourceName: pick(source.name, source.nameEn),
                          lat: source.lat,
                          lon: source.lon,
                          query: null,
                          confidence: null,
                          score: null,
                          box: null,
                          alert: null,
                        }),
                    }
                  : {})}
              />
              <div className="alert-line">
                {t(KIND_LABEL[source.kind])} · {source.owner}
              </div>
              {source.description !== '' && (
                <div className="alert-line low" style={{ whiteSpace: 'normal' }}>
                  {pick(source.description, source.descriptionEn)}
                </div>
              )}
              {sourceFeed?.label ? (
                <div className="alert-line low">
                  {t('im Bild')}: {tagLabel(sourceFeed.label, lang)}
                  {sourceFeed.at !== null ? ` · ${formatClock(sourceFeed.at, locale)}` : ''}
                </div>
              ) : null}
              {sourceAlerts.map((a) => (
                <div key={a.id} className="alert-line strong">
                  <Sev level={a.severity} /> {pick(a.watchName, a.watchNameEn)}
                </div>
              ))}
            </div>
          )}
        </MapCanvas>
      </div>

      <aside className="lage-side">
        <section className="lage-pane">
          <header className="pane-head">
            <h2 className="label">
              {t('Meldungen')} <span className="count">{alerts.filter((a) => a.active && a.status !== 'dismissed').length}</span>
              <span className="count-of">/ {alerts.length}</span>
            </h2>
            <span className="low">{t('Vorsicht')}</span>
          </header>
          <p className="sr-only" role="status" aria-live="polite">
            {announcement}
          </p>
          <ul className="pane-body">
            {sortedAlerts.length === 0 && <li className="pane-empty">{t('Keine Meldungen. Wachen melden hier, sobald sie etwas sehen.')}</li>}
            {sortedAlerts.map((a, i) => (
              <AlertRow key={a.id} alert={a} node={node} onOpen={() => openFrame(alertTargets[i] as FrameTarget, alertTargets)} />
            ))}
          </ul>
        </section>
        <section className="lage-pane">
          <header className="pane-head">
            <h2 className="label">
              {t('Lagen')} <span className="count">{incidents.filter((i) => i.status !== 'closed').length}</span>
            </h2>
            <span className="low">{t('Meldungen gleicher Art am selben Ort')}</span>
          </header>
          <ul className="pane-body">
            {sortedIncidents.length === 0 && <li className="pane-empty">{t('Keine Lagen.')}</li>}
            {sortedIncidents.map((incident) => (
              <IncidentRow
                key={incident.id}
                incident={incident}
                node={node}
                selected={incident.id === selectedIncident}
                onSelect={() => {
                  setSelectedIncident(incident.id);
                  setJump({ view: { lat: incident.lat, lon: incident.lon, zoom: 14 }, key: `in:${incident.id}:${Date.now()}` });
                }}
              />
            ))}
          </ul>
        </section>
      </aside>

      <div className="lage-bottom">
        {scenario && scenario.id !== '' && <ExerciseControl node={node} scenario={scenario} elapsed={elapsed} />}
        {wallSources.length > 0 && (
          <div className="wall">
            {wallSources.map((s) => {
              const feed = feeds.get(s.id);
              const alert = severityBySource.get(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`feed${s.id === selectedSource ? ' feed-on' : ''}${alert ? ' feed-alert' : ''}${feed?.online ? '' : ' feed-off'}`}
                  onClick={() => {
                    setSelectedSource(s.id);
                    if (s.lat !== null && s.lon !== null) setJump({ view: { lat: s.lat, lon: s.lon, zoom: 14 }, key: `src:${s.id}:${Date.now()}` });
                  }}
                >
                  <Frame src={feed?.frameUrl ?? null} empty={t('kein Bild')} />
                  <span className="feed-name">
                    <span>
                      <b>{pick(s.name, s.nameEn).split(' · ')[0]}</b>
                      <em>{pick(s.name, s.nameEn).split(' · ').slice(1).join(' · ') || '\u00a0'}</em>
                    </span>
                    {alert ? <Sev level={alert.severity} /> : <Glyph kind={s.kind} />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
