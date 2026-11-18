import { useEffect, useMemo, useState } from 'react';
import { SOURCE_KINDS, createSource, deleteSource, updateSource, type SceneInfo, type SourceInfo, type SourceKind, type VideoInfo } from '../api';
import type { ViewProps } from '../App';
import { DatasetPanel } from '../components/DatasetPanel';
import { LiveAnalysis } from '../components/LiveAnalysis';
import { SceneBrowser } from '../components/SceneBrowser';
import type { Fix } from '../datum/api';
import { datasets, groupRecordings, useDatasets, type DatasetGroup } from '../datum/datasets';
import { DeleteDatasetDialog } from '../datum/DeleteDatasetDialog';
import { useTruthUpload } from '../datum/TruthUpload';
import { UploadDialog } from '../datum/UploadDialog';
import { useLang } from '../i18n';
import { toMgrs } from '../map/geo';
import { Dialog, Field, Glyph, KIND_LABEL, pressable, useAction } from '../ui';
import type { NodeConnection } from '../useNode';

const MODE_LABEL: Record<SourceInfo['mode'], string> = { archive: 'Archiv', exercise: 'Übung', live: 'Direktbild' };

function NewSource({ node, onClose }: { node: NodeConnection; onClose: () => void }) {
  const { t } = useLang();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SourceKind>('drone');
  const [owner, setOwner] = useState('');
  const [description, setDescription] = useState('');
  const [lat, setLat] = useState(String(node.info?.node.lat ?? ''));
  const [lon, setLon] = useState(String(node.info?.node.lon ?? ''));
  const [shared, setShared] = useState(false);
  const [streamUrl, setStreamUrl] = useState('');
  const action = useAction();
  const mayLive = node.can('source.live');
  /** Opening a source to the peers is the supervisor's decision. */
  const mayShare = node.can('federation.write');
  const number = (text: string): number | null => {
    const value = Number(text.replace(',', '.'));
    return text.trim() !== '' && Number.isFinite(value) ? value : null;
  };
  return (
    <Dialog title={t('Quelle anlegen')} onClose={onClose}>
      <div className="form">
        <div className="field-row">
          <Field label={t('Bezeichnung')}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Field label={t('Art')}>
            <select value={kind} onChange={(e) => setKind(e.target.value as SourceKind)}>
              {SOURCE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(KIND_LABEL[k])}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={t('Eigentümer des Sensors')}>
          <input value={owner} onChange={(e) => setOwner(e.target.value)} maxLength={80} />
        </Field>
        <Field label={t('Beschreibung')}>
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
        </Field>
        <div className="field-row">
          <Field label={t('Breite')}>
            <input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label={t('Länge')}>
            <input value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" />
          </Field>
        </div>
        {mayLive && (
          <Field
            label={t('Direktbild: Adresse des Stroms (leer = Archivquelle)')}
            hint={t('RTSP, HLS, RTMP, SRT oder MPEG-TS. Der Strom wird in kurze Abschnitte geschnitten und wie eine Aufzeichnung ausgewertet; Meldungen folgen mit einem Nachlauf von etwa einer halben Minute. Zugangsdaten in der Adresse bleiben auf dem Knoten.')}
          >
            <input value={streamUrl} onChange={(e) => setStreamUrl(e.target.value)} placeholder="rtsp://kamera.example/stream1" spellCheck={false} autoComplete="off" />
          </Field>
        )}
        {mayShare && (
          <label className="check">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            {t('Nachbarknoten dürfen diese Quelle im Verbund befragen')}
          </label>
        )}
        {action.error && <p className="note">{action.error}</p>}
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-solid"
            disabled={action.busy || name.trim().length < 2}
            onClick={() =>
              void action.run(async () => {
                await createSource({
                  name: name.trim(),
                  kind,
                  owner: owner.trim(),
                  description: description.trim(),
                  lat: number(lat),
                  lon: number(lon),
                  shared,
                  ...(streamUrl.trim() !== '' ? { streamUrl: streamUrl.trim() } : {}),
                });
                node.refreshIntel();
                onClose();
              })
            }
          >
            {t('Anlegen')}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {t('Abbrechen')}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

const NO_FIXES = new Map<string, Fix>();

/**
 * BESTAND on a DATUM node: the datasets in ORTUNG's words (Datensatz, Aufnahmen, Hochladen) with
 * the same upload and delete, and the recordings of the chosen one. Sources, owners, grid
 * references and sharing belong to SICHT and are not shown.
 */
function DatumHoldings({ node, archive, openScene, selectedVideoId, setSelectedVideoId }: {
  node: NodeConnection;
  archive: VideoInfo[];
  openScene: (scene: SceneInfo, video: VideoInfo | null) => void;
  selectedVideoId: string | null;
  setSelectedVideoId: (id: string | null) => void;
}) {
  const { t, pick, n } = useLang();
  const sets = useDatasets();
  const [target, setTarget] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: 'upload' } | { kind: 'delete'; group: DatasetGroup } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const truth = useTruthUpload((r) => setNotice(r.text));
  const may = node.can('source.write');
  const groups = useMemo(() => groupRecordings(archive, NO_FIXES, sets, { pick, t }), [archive, sets, pick, t]);
  // Counts and names follow new and deleted recordings once they pause.
  useEffect(() => {
    datasets.refreshSoon();
  }, [archive.length]);
  const chosen = groups.find((g) => g.id === target) ?? groups[0] ?? null;
  const selectedVideo = chosen?.videos.find((v) => v.id === selectedVideoId) ?? null;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">{t('Bestand')}</h1>
          {notice && <p className="page-sub">{notice}</p>}
        </div>
        {may && (
          <div className="btn-row">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setNotice(null);
                setDialog({ kind: 'upload' });
              }}
            >
              {t('Hochladen')}
            </button>
          </div>
        )}
      </header>

      <section className="section-gap">
        <table className="tbl">
          <thead>
            <tr>
              <th>{t('Datensatz')}</th>
              <th style={{ width: 124 }} className="num">
                {t('Aufnahmen')}
              </th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id} className={`clickable${chosen?.id === g.id ? ' sel' : ''}`} {...pressable(() => setTarget(g.id), chosen?.id === g.id)}>
                <td className="strong">{g.name}</td>
                <td className="num">{g.videos.length}</td>
                <td className="num">
                  {may && g.managed && (
                    <button
                      type="button"
                      className="text-btn"
                      aria-label={t('Datensatz {name} löschen', { name: g.name })}
                      title={t('Löschen …')}
                      onClick={(e) => {
                        e.stopPropagation();
                        setNotice(null);
                        setDialog({ kind: 'delete', group: g });
                      }}
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {groups.length === 0 && <p className="empty">{t('Noch keine Aufnahmen.')}</p>}
      </section>

      {chosen && (
        <div className="cols cols-side">
          <div className="section-gap">
            <header className="panel-head">
              <h2 className="label">
                {chosen.name} <span className="count">{chosen.videos.length}</span>
              </h2>
            </header>
            <DatasetPanel videos={chosen.videos} selectedVideoId={selectedVideoId} onSelect={setSelectedVideoId} sourceId={chosen.id} canWrite={false} />
          </div>
          <div className="section-gap" style={{ gap: 40 }}>
            {selectedVideo && (
              <SceneBrowser video={selectedVideo} refreshKey={node.indexVersion} onOpen={(scene) => openScene(scene, selectedVideo)} onClose={() => setSelectedVideoId(null)} />
            )}
          </div>
        </div>
      )}

      {dialog?.kind === 'upload' && <UploadDialog initial={null} list={sets.list} supported={sets.supported} sendTruth={truth.send} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && (
        <DeleteDatasetDialog
          group={dialog.group}
          onClose={() => setDialog(null)}
          onDone={(result) => {
            setDialog(null);
            const parts = [t('{deleted} gelöscht', { deleted: n(result.deleted, 'recording') })];
            if (result.kept > 0) parts.push(t('{kept} bleiben (in einem Vorgang gesichert)', { kept: result.kept }));
            setNotice(parts.join(' · '));
          }}
        />
      )}
    </div>
  );
}

export function Quellen(props: ViewProps) {
  const sets = useDatasets();
  const datum = props.node.info?.product !== undefined && props.node.info.product !== 'sicht';
  useEffect(() => {
    if (datum) void datasets.refresh();
  }, [datum]);
  // A DATUM node that lists its datasets gets the dataset view; SICHT and older nodes the sources.
  if (datum && sets.supported) return <DatumBestand {...props} />;
  return <SourcesView {...props} />;
}

function DatumBestand({ node, openFrame }: ViewProps) {
  const { pick } = useLang();
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const videos = node.app?.videos ?? [];
  const archive = useMemo(() => videos.filter((v) => v.scenario === null), [videos]);
  const sources = node.intel?.sources ?? [];
  const openScene = (scene: SceneInfo, video: VideoInfo | null): void => {
    const source = sources.find((s) => s.id === video?.sourceId);
    openFrame({
      videoId: scene.videoId,
      frameNumber: scene.keyframeNumber,
      frameUrl: scene.keyframeUrl,
      time: scene.keyframeTime,
      sceneIndex: scene.index,
      at: null,
      sourceName: source ? pick(source.name, source.nameEn) : null,
      lat: source?.lat ?? null,
      lon: source?.lon ?? null,
      query: null,
      confidence: null,
      score: null,
      box: null,
      alert: null,
    });
  };
  return <DatumHoldings node={node} archive={archive} openScene={openScene} selectedVideoId={selectedVideoId} setSelectedVideoId={setSelectedVideoId} />;
}

function SourcesView({ node, openFrame }: ViewProps) {
  const { t, pick } = useLang();
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState('eingang');
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const action = useAction();
  const sources = node.intel?.sources ?? [];
  const feeds = useMemo(() => new Map((node.intel?.feeds ?? []).map((f) => [f.sourceId, f])), [node.intel?.feeds]);
  const videos = node.app?.videos ?? [];
  const archive = useMemo(() => videos.filter((v) => v.scenario === null), [videos]);
  const may = node.can('source.write');
  /** Opening a source to the peers is the supervisor's decision. */
  const mayShare = node.can('federation.write');
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of videos) map.set(v.sourceId, (map.get(v.sourceId) ?? 0) + 1);
    return map;
  }, [videos]);
  const archiveSources = sources.filter((s) => s.mode === 'archive');
  const selectedVideo = archive.find((v) => v.id === selectedVideoId) ?? null;
  const shown = archive.filter((v) => v.sourceId === target);

  const openScene = (scene: SceneInfo): void => {
    const source = sources.find((s) => s.id === selectedVideo?.sourceId);
    openFrame({
      videoId: scene.videoId,
      frameNumber: scene.keyframeNumber,
      frameUrl: scene.keyframeUrl,
      time: scene.keyframeTime,
      sceneIndex: scene.index,
      at: null,
      sourceName: source ? pick(source.name, source.nameEn) : null,
      lat: source?.lat ?? null,
      lon: source?.lon ?? null,
      query: null,
      confidence: null,
      score: null,
      box: null,
      alert: null,
    });
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          {/* The tab is called BESTAND on DATUM and QUELLEN on SICHT; the page says the same. */}
          <h1 className="page-title">{node.info?.product === 'sicht' ? t('Quellen') : t('Bestand')}</h1>
        </div>
        {may && (
          <button type="button" className="btn btn-solid" onClick={() => setCreating(true)}>
            {t('Quelle anlegen')}
          </button>
        )}
      </header>

      <section className="section-gap">
        <table className="tbl">
          <thead>
            <tr>
              <th>{t('Quelle')}</th>
              <th style={{ width: 130 }}>{t('Art')}</th>
              <th>{t('Eigentümer')}</th>
              <th style={{ width: 150 }}>{t('UTMREF')}</th>
              <th style={{ width: 130 }}>{t('Betrieb')}</th>
              <th style={{ width: 124 }} className="num">
                {t('Aufzeichnungen')}
              </th>
              <th style={{ width: 150 }}>{t('Verbund')}</th>
              <th style={{ width: 30 }} />
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => {
              const feed = feeds.get(s.id);
              return (
                <tr key={s.id} className={`clickable${target === s.id ? ' sel' : ''}`} {...pressable(() => { if (s.mode === 'archive') setTarget(s.id); }, target === s.id)}>
                  <td className="strong" title={pick(s.description, s.descriptionEn)}>
                    <Glyph kind={s.kind} /> {pick(s.name, s.nameEn)}
                  </td>
                  <td className="dim">{t(KIND_LABEL[s.kind])}</td>
                  <td className="dim">{s.owner}</td>
                  <td className="dim">{s.lat !== null && s.lon !== null ? toMgrs(s.lat, s.lon) : '–'}</td>
                  <td className="dim" title={s.mode === 'live' ? `${s.stream ?? ''}${s.streamState?.detail ? ` · ${s.streamState.detail}` : ''}` : ''}>
                    {t(MODE_LABEL[s.mode])}
                    {s.mode === 'exercise' ? (feed?.online ? ` · ${t('sendet')}` : ` · ${t('still')}`) : ''}
                    {s.mode === 'live'
                      ? ` · ${s.streamState?.state === 'online' ? t('verbunden') : s.streamState?.state === 'connecting' ? t('verbindet') : t('getrennt')}`
                      : ''}
                  </td>
                  <td className="num">{counts.get(s.id) ?? 0}</td>
                  <td>
                    {mayShare && s.mode !== 'exercise' ? (
                      <button
                        type="button"
                        className="text-btn"
                        disabled={action.busy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void action.run(async () => {
                            await updateSource(s.id, { shared: !s.shared });
                            node.refreshIntel();
                          });
                        }}
                      >
                        {s.shared ? t('freigegeben') : t('nicht freigegeben')}
                      </button>
                    ) : (
                      <span className="dim">{s.shared ? t('freigegeben') : t('nicht freigegeben')}</span>
                    )}
                  </td>
                  <td>
                    {((may && s.mode === 'archive' && s.id !== 'eingang' && (counts.get(s.id) ?? 0) === 0) || (s.mode === 'live' && node.can('source.live'))) && (
                      <button
                        type="button"
                        className="text-btn"
                        aria-label={s.mode === 'live' ? t('Direktbild trennen') : t('löschen')}
                        title={s.mode === 'live' ? t('Direktbild trennen') : t('löschen')}
                        onClick={(e) => {
                          e.stopPropagation();
                          void action.run(async () => {
                            await deleteSource(s.id);
                            node.refreshIntel();
                          });
                        }}
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {action.error && <p className="note">{action.error}</p>}
      </section>

      <div className="cols cols-side">
        <div className="section-gap">
          <header className="panel-head">
            <h2 className="label">{t('Einspielen')}</h2>
            <span className="low">
              {t('nach')}{' '}
              <select
                aria-label={t('Zielquelle')}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                style={{ background: 'transparent', border: 0, color: 'var(--fg)', font: 'inherit', cursor: 'pointer' }}
              >
                {archiveSources.map((s) => (
                  <option key={s.id} value={s.id} style={{ background: '#050505' }}>
                    {pick(s.name, s.nameEn)}
                  </option>
                ))}
              </select>
            </span>
          </header>
          <DatasetPanel videos={shown} selectedVideoId={selectedVideoId} onSelect={setSelectedVideoId} sourceId={target} canWrite={may} />
          {shown.length === 0 && <p className="empty">{t('Kein Material in dieser Quelle.')}</p>}
        </div>
        <div className="section-gap" style={{ gap: 40 }}>
          <LiveAnalysis live={node.live} videos={videos} />
          {selectedVideo && (
            <SceneBrowser video={selectedVideo} refreshKey={node.indexVersion} onOpen={openScene} onClose={() => setSelectedVideoId(null)} />
          )}
        </div>
      </div>

      {creating && <NewSource node={node} onClose={() => setCreating(false)} />}
    </div>
  );
}
