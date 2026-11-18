import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { searchScenes, type MapPoint, type SceneInfo, type SearchResponse, type SearchResult } from './api';
import { DatasetPanel } from './components/DatasetPanel';
import { EmbeddingMap } from './components/EmbeddingMap';
import { LiveAnalysis } from './components/LiveAnalysis';
import { Results } from './components/Results';
import { SceneBrowser } from './components/SceneBrowser';
import { SceneModal, type ModalTarget } from './components/SceneModal';
import { useServer } from './useServer';

const EXAMPLES = ['man with a cup', 'black car', 'green bus', 'person riding a bicycle'];
const RESULT_LIMIT = 120;

export function App() {
  const { state, connected, indexVersion, live } = useServer();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0.5);
  const [modal, setModal] = useState<ModalTarget | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const videos = state?.videos ?? [];
  const modelReady = state?.model.phase === 'ready';
  const hasIndex = (state?.stats.vectors ?? 0) > 0;

  // Run the search when the query changes and refresh it when the index changes.
  useEffect(() => {
    if (query === '') {
      setResponse(null);
      setSearchError(null);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    searchScenes(query, RESULT_LIMIT, controller.signal)
      .then((res) => {
        setResponse(res);
        setSearchError(null);
        setSearching(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setSearchError(err instanceof Error ? err.message : String(err));
        setSearching(false);
      });
    return () => controller.abort();
  }, [query, indexVersion]);

  const submit = useCallback((text: string) => {
    const trimmed = text.trim();
    setInput(trimmed);
    setQuery(trimmed);
    if (trimmed !== '') {
      window.requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }, []);

  const onSubmit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      submit(input);
    },
    [input, submit],
  );

  const visibleResults = useMemo(() => response?.results ?? [], [response]);

  const openResult = useCallback(
    (result: SearchResult) => {
      setModal({
        videoId: result.videoId,
        sceneIndex: result.sceneIndex,
        frameNumber: result.frameNumber,
        frameUrl: result.frameUrl,
        time: result.time,
        query: response?.query ?? null,
        confidence: result.confidence,
        score: result.score,
        box: result.box,
      });
    },
    [response],
  );

  const openScene = useCallback((scene: SceneInfo) => {
    setModal({
      videoId: scene.videoId,
      sceneIndex: scene.index,
      frameNumber: scene.keyframeNumber,
      frameUrl: scene.keyframeUrl,
      time: scene.keyframeTime,
      query: null,
      confidence: null,
      score: null,
      box: null,
    });
  }, []);

  const openMapPoint = useCallback(
    (point: MapPoint) => {
      const result = visibleResults.find((r) => r.sceneId === point.sceneId);
      if (result) {
        openResult(result);
        return;
      }
      setModal({
        videoId: point.videoId,
        sceneIndex: point.sceneIndex,
        frameNumber: point.frameNumber,
        frameUrl: point.keyframeUrl,
        time: point.time,
        query: null,
        confidence: null,
        score: null,
        box: null,
      });
    },
    [openResult, visibleResults],
  );

  const modalIndex = useMemo(() => {
    if (!modal || modal.query === null) return -1;
    return visibleResults.findIndex((r) => r.videoId === modal.videoId && r.sceneIndex === modal.sceneIndex);
  }, [modal, visibleResults]);

  const stepModal = useCallback(
    (delta: number) => {
      const next = visibleResults[modalIndex + delta];
      if (next) openResult(next);
    },
    [modalIndex, openResult, visibleResults],
  );
  const onPrev = useMemo(() => (modalIndex > 0 ? () => stepModal(-1) : null), [modalIndex, stepModal]);
  const onNext = useMemo(
    () => (modalIndex >= 0 && modalIndex < visibleResults.length - 1 ? () => stepModal(1) : null),
    [modalIndex, stepModal, visibleResults.length],
  );
  const closeModal = useCallback(() => setModal(null), []);

  const selectedVideo = videos.find((v) => v.id === selectedVideoId) ?? null;

  // One quiet status line instead of a header: it only speaks up when something is not ready.
  let status = '';
  if (!state) status = 'verbinde';
  else if (!connected) status = 'verbindung getrennt';
  else if (state.model.phase === 'loading') status = state.model.message.toLowerCase();
  else if (state.model.phase === 'error') status = state.model.message;
  else if (state.model.notice !== '') status = state.model.notice;
  else if (!hasIndex) status = 'bereit · noch kein video indexiert';
  const loading = state?.model.phase === 'loading' ? state.model.progress : null;

  return (
    <div className="app">
      {loading !== null && (
        <div className="boot" aria-hidden="true">
          <span style={{ width: `${Math.round(loading * 100)}%` }} />
        </div>
      )}

      <form className="query" onSubmit={onSubmit}>
        <span className="query-prompt" aria-hidden="true">
          ›
        </span>
        <input
          className="query-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="man with a cup"
          maxLength={300}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          aria-label="Suchbegriff"
        />
        {query !== '' && (
          <button type="button" className="text-btn" onClick={() => submit('')}>
            leeren
          </button>
        )}
        <button type="submit" className="btn btn-solid" disabled={!modelReady || input.trim() === ''}>
          {searching ? '…' : 'Suchen'}
        </button>
      </form>
      <div className="query-foot">
        <span className="examples">
          {EXAMPLES.map((example) => (
            <button key={example} type="button" className="text-btn" disabled={!modelReady} onClick={() => submit(example)}>
              {example}
            </button>
          ))}
        </span>
        <span className="status">{status}</span>
      </div>

      <main className="layout">
        <aside className="sidebar">
          <DatasetPanel videos={videos} selectedVideoId={selectedVideoId} onSelect={setSelectedVideoId} />
        </aside>
        <div className="content">
          <div ref={resultsRef} className="anchor" />
          {searchError && <p className="note">Suche fehlgeschlagen: {searchError}</p>}
          {response && query !== '' && (
            <Results response={response} threshold={threshold} onThresholdChange={setThreshold} onOpen={openResult} />
          )}
          {selectedVideo && (
            <SceneBrowser
              video={selectedVideo}
              refreshKey={indexVersion}
              onOpen={openScene}
              onClose={() => setSelectedVideoId(null)}
            />
          )}
          <LiveAnalysis live={live} videos={videos} />
          <EmbeddingMap
            videos={videos}
            modelReady={modelReady}
            refreshKey={indexVersion}
            sceneScores={response && query !== '' ? response.sceneScores : null}
            onOpen={openMapPoint}
          />
          {state && videos.length === 0 && (
            <p className="empty">Lege links Videos ab. Analyse, Szenen und Suche erscheinen hier.</p>
          )}
        </div>
      </main>

      {modal && <SceneModal target={modal} onClose={closeModal} onPrev={onPrev} onNext={onNext} />}
    </div>
  );
}
