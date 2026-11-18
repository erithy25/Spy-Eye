import { useEffect, useState } from 'react';
import { fetchVideoScenes, type SceneInfo, type VideoInfo } from '../api';
import { formatTime } from '../format';
import { useLang } from '../i18n';

interface SceneBrowserProps {
  video: VideoInfo;
  /** Changes when the index changes so the list is refreshed. */
  refreshKey: number;
  onOpen: (scene: SceneInfo) => void;
  onClose: () => void;
}

export function SceneBrowser({ video, refreshKey, onOpen, onClose }: SceneBrowserProps) {
  const { t } = useLang();
  const [scenes, setScenes] = useState<SceneInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    fetchVideoScenes(video.id, controller.signal)
      .then((res) => setScenes(res.scenes))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => controller.abort();
  }, [video.id, refreshKey, video.sceneCount]);

  return (
    <section className="section">
      <header className="section-head">
        <h2 className="label">
          {t('Szenen')} <span className="count">{scenes ? scenes.length : ''}</span>
        </h2>
        <span className="meta">
          {video.name}&nbsp;&nbsp;
          <button type="button" className="text-btn" onClick={onClose}>
            {t('schließen')}
          </button>
        </span>
      </header>
      {error && <p className="note">{error}</p>}
      {scenes && scenes.length > 0 && (
        <div className="hits hits-dense">
          {scenes.map((scene) => (
            <button key={scene.id} type="button" className="hit" onClick={() => onOpen(scene)}>
              <span className="hit-frame">
                <img src={scene.keyframeUrl} alt={`Szene ${scene.index + 1}`} loading="lazy" />
              </span>
              <span className="hit-line">
                <span className="hit-score">{formatTime(scene.start)}</span>
                <span className="hit-name">{scene.tags.slice(0, 2).map((t) => t.label).join(', ')}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
