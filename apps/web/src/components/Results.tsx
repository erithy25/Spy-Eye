import { useMemo, useState } from 'react';
import type { SearchResponse, SearchResult } from '../api';
import { formatClock, formatCount, formatDecimal, formatScore } from '../format';
import { useLang } from '../i18n';
import { Glyph } from '../ui';

interface ResultsProps {
  response: SearchResponse;
  threshold: number;
  onThresholdChange: (value: number) => void;
  onOpen: (result: SearchResult) => void;
}

function Hit({ result, weak, onOpen }: { result: SearchResult; weak: boolean; onOpen: (r: SearchResult) => void }) {
  const { locale, t } = useLang();
  return (
    <button type="button" className={weak ? 'hit hit-weak' : 'hit'} onClick={() => onOpen(result)}>
      <span className="hit-frame">
        <img src={result.frameUrl} alt="" loading="lazy" />
        {result.box && (
          <span
            className="reticle"
            style={{
              left: `${result.box.x * 100}%`,
              top: `${result.box.y * 100}%`,
              width: `${result.box.w * 100}%`,
              height: `${result.box.h * 100}%`,
            }}
          />
        )}
      </span>
      <span className="hit-line">
        <span className="hit-score">{formatScore(result.confidence)}</span>
        <span className="hit-name" title={t(result.sourceName)}>
          <Glyph kind={result.sourceKind} /> {t(result.sourceName)}
        </span>
        <span className="hit-time">{formatClock(result.at, locale)}</span>
      </span>
    </button>
  );
}

function Distribution({ bins, threshold }: { bins: number[]; threshold: number }) {
  const max = Math.max(1, ...bins);
  return (
    <span className="histogram">
      {bins.map((count, i) => {
        const above = (i + 0.5) / bins.length >= threshold;
        const height = count === 0 ? 0 : Math.max(6, (Math.log1p(count) / Math.log1p(max)) * 100);
        return <i key={i} className={above ? 'on' : ''} style={{ height: `${height}%` }} />;
      })}
    </span>
  );
}

export function Results({ response, threshold, onThresholdChange, onOpen }: ResultsProps) {
  const { t } = useLang();
  const [showWeak, setShowWeak] = useState(false);
  const { hits, weak } = useMemo(() => {
    const strong: SearchResult[] = [];
    const rest: SearchResult[] = [];
    for (const r of response.results) (r.confidence >= threshold ? strong : rest).push(r);
    return { hits: strong, weak: rest };
  }, [response.results, threshold]);

  const totalAbove = useMemo(
    () => Object.values(response.sceneScores).filter((c) => c >= threshold).length,
    [response.sceneScores, threshold],
  );
  const weakVisible = showWeak || hits.length === 0;

  return (
    <section className="section">
      <header className="section-head">
        <h2 className="label">
          {t('Treffer')} <span className="count">{formatCount(totalAbove)}</span>
          <span className="count-of">/ {formatCount(response.scenesSearched)}</span>
        </h2>
        <label className="threshold" title={t('Verteilung der Sicherheit über alle Szenen')}>
          <Distribution bins={response.distribution} threshold={threshold} />
          <input
            type="range"
            min={0.05}
            max={0.95}
            step={0.05}
            value={threshold}
            aria-label={t('Mindestsicherheit')}
            onChange={(e) => onThresholdChange(Number(e.target.value))}
          />
          <span className="threshold-value">≥ {formatScore(threshold)}</span>
        </label>
      </header>
      <p className="meta">
        {formatCount(response.vectorsSearched)} {t('Vektoren')} · {formatDecimal(response.tookMs, 0)} ms · cos ≥ {formatScore(response.threshold)}
        {totalAbove > hits.length ? ` · ${t('beste {n} gezeigt', { n: hits.length })}` : ''}
      </p>

      {hits.length > 0 ? (
        <div className="hits">
          {hits.map((r) => (
            <Hit key={r.sceneId} result={r} weak={false} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <p className="empty">{t('Keine Szene über der Schwelle.')}</p>
      )}

      {weak.length > 0 && (
        <>
          {hits.length > 0 && (
            <button type="button" className="text-btn more" onClick={() => setShowWeak((v) => !v)}>
              {showWeak ? `− ${t('Kandidaten unter der Schwelle')}` : `+ ${weak.length} ${t('Kandidaten unter der Schwelle')}`}
            </button>
          )}
          {weakVisible && (
            <div className="hits">
              {weak.map((r) => (
                <Hit key={r.sceneId} result={r} weak onOpen={onOpen} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
