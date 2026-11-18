import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ApiRequestError, searchScenes, type FederatedResult, type MapPoint, type SearchResponse, type SearchResult } from '../api';
import type { ViewProps } from '../App';
import { EmbeddingMap } from '../components/EmbeddingMap';
import type { FrameTarget } from '../components/FrameSheet';
import { Results } from '../components/Results';
import { formatClock, formatScore } from '../format';
import { useLang } from '../i18n';
import { MapCanvas, type MapMarker } from '../map/MapCanvas';
import { Frame, Glyph } from '../ui';

const EXAMPLES = ['überflutete Wiese', 'umgestürzter Baum auf einer Straße', 'Rauch über Gebäuden', 'umgekippter Lastwagen', 'Löschfahrzeug', 'Trümmer'];
const RESULT_LIMIT = 120;

const RULE_LABEL: Record<string, string> = {
  identification: 'Identifizierung von Personen',
  'protected-attribute': 'Geschützte Merkmale',
  'named-person': 'Namentlich genannte Person',
  'identifying-feature': 'Identifizierende Merkmale',
  'person-description': 'Personenbeschreibung',
  'licence-plate': 'Kennzeichen',
};

function resultTarget(r: SearchResult, query: string): FrameTarget {
  return {
    videoId: r.videoId,
    frameNumber: r.frameNumber,
    frameUrl: r.frameUrl,
    time: r.time,
    sceneIndex: r.sceneIndex,
    at: r.at,
    sourceName: r.sourceName,
    lat: r.lat,
    lon: r.lon,
    query,
    confidence: r.confidence,
    score: r.score,
    box: r.box,
    alert: null,
  };
}

function Federated({ results }: { results: FederatedResult[] }) {
  const { t, locale } = useLang();
  return (
    <section className="section-gap">
      <header className="panel-head">
        <h2 className="label">{t('Antworten aus dem Verbund')}</h2>
        <span className="low">{t('Weitsicht')}</span>
      </header>
      <p className="hint">
        {t('Nur die Frage hat diesen Knoten verlassen. Die Nachbarn haben sie nach eigenen Regeln geprüft, protokolliert und maskierte Vorschaubilder zurückgegeben; die Aufnahmen bleiben dort.')}
      </p>
      {results.map((peer) => (
        <div key={peer.peerId} className="section-gap">
          <div className="alert-title">
            <b>
              <Glyph kind="node" /> {peer.peerName}
            </b>
            <span className="low">
              {peer.ok
                ? `${peer.matched} ${t('Treffer')} · ${peer.tookMs} ms${peer.receipt !== null ? ` · ${t('Beleg')} #${peer.receipt}` : ''}`
                : t('keine Antwort')}
            </span>
          </div>
          {!peer.ok && <p className="note">{peer.error}</p>}
          {peer.ok && peer.hits.length === 0 && <p className="empty">{t('Nichts gefunden.')}</p>}
          {peer.hits.length > 0 && (
            <div className="thumbs">
              {peer.hits.map((hit, i) => (
                <div key={i}>
                  <Frame src={hit.thumbnail} />
                  <div className="thumb-line">
                    <span title={hit.sourceName}>{hit.sourceName}</span>
                    <span>{formatScore(hit.confidence)}</span>
                  </div>
                  <div className="thumb-line low">
                    <span>{new Date(hit.at).toLocaleDateString(locale)}</span>
                    <span>{formatClock(hit.at, locale)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

export function Suche({ node, openFrame }: ViewProps) {
  const { t, pick } = useLang();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [federated, setFederated] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [failure, setFailure] = useState<ApiRequestError | Error | null>(null);
  const [threshold, setThreshold] = useState(0.5);
  const [run, setRun] = useState(0);

  const videos = node.app?.videos ?? [];
  const modelReady = node.app?.model.phase === 'ready';
  const hasMandate = node.session?.mandate !== null;
  const mayFederate = node.can('federation.read');

  // The query runs when it is submitted; new footage does not repeat it silently, because every
  // run is written to the ledger.
  useEffect(() => {
    if (query === '') {
      setResponse(null);
      setFailure(null);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    searchScenes(query, { limit: RESULT_LIMIT, federated: federated && mayFederate }, controller.signal)
      .then((res) => {
        setResponse(res);
        setFailure(null);
        setSearching(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setResponse(null);
        setFailure(err instanceof Error ? err : new Error(String(err)));
        setSearching(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, run]);

  const submit = useCallback((text: string) => {
    const trimmed = text.trim();
    setInput(trimmed);
    setQuery(trimmed);
    setRun((v) => v + 1);
  }, []);

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    submit(input);
  };

  const targets = useMemo(() => (response ? response.results.map((r) => resultTarget(r, response.query)) : []), [response]);
  const openResult = useCallback(
    (result: SearchResult) => {
      if (!response) return;
      openFrame(resultTarget(result, response.query), targets);
    },
    [openFrame, response, targets],
  );
  const openPoint = useCallback(
    (point: MapPoint) =>
      openFrame({
        videoId: point.videoId,
        frameNumber: point.frameNumber,
        frameUrl: point.keyframeUrl,
        time: point.time,
        sceneIndex: point.sceneIndex,
        at: null,
        sourceName: null,
        lat: null,
        lon: null,
        query: response?.query ?? null,
        confidence: response?.sceneScores[point.sceneId] ?? null,
        score: null,
        box: null,
        alert: null,
      }),
    [openFrame, response],
  );

  const markers = useMemo<MapMarker[]>(() => {
    const scores = response?.sourceScores ?? {};
    return (node.intel?.sources ?? [])
      .filter((s) => s.lat !== null && s.lon !== null)
      .map((s) => ({
        id: s.id,
        lat: s.lat as number,
        lon: s.lon as number,
        shape: s.kind,
        label: (scores[s.id] ?? 0) >= threshold ? pick(s.name, s.nameEn) : '',
        glow: (scores[s.id] ?? 0) >= threshold ? (scores[s.id] ?? 0) : 0,
        dim: response !== null && (scores[s.id] ?? 0) < threshold,
      }));
  }, [node.intel?.sources, response, threshold, pick]);

  const center = node.intel?.scenario && node.intel.scenario.status !== 'absent' ? node.intel.scenario.center : null;
  const info = node.info?.node;
  const refused = failure instanceof ApiRequestError && failure.code === 'refused';
  const mandateMissing = failure instanceof ApiRequestError && failure.code === 'mandate-required';

  return (
    <div className="page">
      <div>
        <form className="query" onSubmit={onSubmit}>
          <span className="query-prompt" aria-hidden="true">
            /
          </span>
          <input
            className="query-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('Was soll auf den Bildern zu sehen sein?')}
            aria-label={t('Suchanfrage')}
            maxLength={300}
            spellCheck={false}
            autoFocus
          />
          <button type="submit" className="btn btn-solid" disabled={!modelReady || input.trim() === '' || !hasMandate}>
            {t('Suchen')}
          </button>
        </form>
        <div className="query-foot">
          <span className="examples">
            {EXAMPLES.map((example) => (
              <button key={example} type="button" className="text-btn" disabled={!modelReady || !hasMandate} onClick={() => submit(example)}>
                {example}
              </button>
            ))}
          </span>
          {mayFederate && (
            <label className="check" style={{ whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={federated} onChange={(e) => setFederated(e.target.checked)} />
              {t('im Verbund fragen')}
            </label>
          )}
        </div>
        <p className="query-note">
          {!hasMandate
            ? t('Kein Mandat gewählt: keine Suche.')
            : searching
              ? t('suche …')
              : !modelReady
                ? (node.app?.model.message ?? '')
                : t('Deutsch oder Englisch, in ganzen Wendungen. Jede Anfrage wird mit Mandat und Person protokolliert.')}
        </p>
      </div>

      {!response && !failure && (
        <div className="primer">
          <div>
            <div className="label">{t('Gesucht wird')}</div>
            <p>{t('Lagen, Schäden, Gegenstände, Fahrzeuge und Tätigkeiten, so wie man sie einem Kollegen beschreiben würde.')}</p>
            <p>{t('Die Bilder müssen dafür nicht verschlagwortet sein; das Modell vergleicht die Bedeutung der Anfrage mit dem Inhalt jedes Bildes.')}</p>
          </div>
          <div>
            <div className="label">{t('Abgelehnt wird')}</div>
            <p>{t('Namen, Gesichter, Kennzeichen. Herkunft, Religion und andere geschützte Merkmale. Haarfarbe, Tätowierungen und andere körperliche Merkmale. Das Wiederfinden oder Verfolgen einer bestimmten Person.')}</p>
            <p>{t('Jede Ablehnung steht mit der auslösenden Regel im Protokoll.')}</p>
          </div>
          <div>
            <div className="label">{t('Durchsucht wird')}</div>
            <p>
              {t('{f} Bilder aus {s} Quellen dieses Knotens.', {
                f: (node.app?.stats.frames ?? 0).toLocaleString('de-DE'),
                s: node.intel?.sources.length ?? 0,
              })}{' '}
              {t('Material einer laufenden Übung zählt ab dem Augenblick, in dem es eingeht.')}
            </p>
            <p>{t('Im Verbund reist die Frage zu den Nachbarknoten; deren Aufnahmen bleiben dort.')}</p>
          </div>
        </div>
      )}

      {refused && failure instanceof ApiRequestError && (
        <div className="refusal" role="alert">
          <h3>
            {t('Anfrage abgelehnt')} · {t(RULE_LABEL[failure.rule ?? ''] ?? 'Regelverstoß')}
          </h3>
          <p>{failure.message}</p>
          <p>{t('Sicht sucht Lagen, Gegenstände und Schäden, keine bestimmten Menschen. Die Ablehnung ist im Protokoll festgehalten.')}</p>
        </div>
      )}
      {mandateMissing && (
        <div className="refusal" role="alert">
          <h3>{t('Kein Mandat')}</h3>
          <p>{failure?.message}</p>
        </div>
      )}
      {failure && !refused && !mandateMissing && <p className="note">{failure.message}</p>}

      {response && (
        <div className="cols cols-wide">
          <Results response={response} threshold={threshold} onThresholdChange={setThreshold} onOpen={openResult} />
          <div className="section-gap" style={{ gap: 36 }}>
            <section className="section-gap">
              <header className="panel-head">
                <h2 className="label">{t('Wo es zu sehen ist')}</h2>
                <span className="low">
                  {Object.values(response.sourceScores).filter((v) => v >= threshold).length} {t('Quellen')}
                </span>
              </header>
              <div style={{ position: 'relative', height: 300 }}>
                <MapCanvas
                  view={center ? { ...center, zoom: center.zoom - 1.1 } : { lat: info?.lat ?? 51, lon: info?.lon ?? 10, zoom: 11 }}
                  viewKey={center ? 'scenario' : 'home'}
                  markers={markers}
                  readouts={false}
                />
              </div>
            </section>
            {response.federated.length > 0 && <Federated results={response.federated} />}
            {federated && mayFederate && response.federated.length === 0 && (
              <p className="hint">{t('Dieser Knoten hat keine Nachbarn im Verbund.')}</p>
            )}
          </div>
        </div>
      )}

      {node.can('media') && (
        <EmbeddingMap
          videos={videos}
          modelReady={modelReady}
          refreshKey={node.indexVersion}
          sceneScores={response ? response.sceneScores : null}
          onOpen={openPoint}
        />
      )}
    </div>
  );
}
