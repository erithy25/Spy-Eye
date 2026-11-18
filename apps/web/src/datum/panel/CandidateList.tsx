import { useRef, type KeyboardEvent } from 'react';
import type { Fix, FixCandidate } from '../../../../server/src/datum/contract';
import { useLang } from '../../i18n';
import { placeText } from '../labels';
import { pressable } from '../../ui';
import { CheckLinks } from './CheckLinks';
import { fmtCoord, fmtKm, fmtScore } from './common';
import './panel.css';

export interface CandidateListProps {
  candidates: FixCandidate[];
  /** Index of the chosen candidate (highlighted). */
  selected?: number;
  onSelect?: (index: number) => void;
  /** The fix the candidates belong to; its country list names candidates that stand for a country. */
  fix?: Fix;
}

export function CandidateList({ candidates, selected, onSelect, fix }: CandidateListProps) {
  const lang = useLang();
  const { t, region } = lang;
  const list = useRef<HTMLOListElement>(null);

  // Arrow keys walk the list; Enter or space choose (see `pressable`).
  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    const items = [...(list.current?.querySelectorAll<HTMLElement>(':scope > li') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    const next =
      event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)));
    items[next]?.focus();
  };

  return (
    <section className="dp dp-cands" aria-label={t('Kandidaten')}>
      <header className="dp-head">
        <h3 className="label">
          {t('Kandidaten')} <span className="count">{candidates.length}</span>
        </h3>
        <span className="dp-head-note">{t('Stützung')}</span>
      </header>
      {candidates.length === 0 && <p className="dp-empty">{t('Keine Kandidaten.')}</p>}
      <ol className="dp-cand-list" ref={list} onKeyDown={onSelect ? onKeyDown : undefined}>
        {candidates.map((c, i) => {
          const on = selected === i;
          // One tab stop for the whole list (the chosen candidate); the arrow keys reach the others.
          const stop = i === (selected !== undefined && selected >= 0 && selected < candidates.length ? selected : 0);
          return (
            <li
              key={i}
              className={on ? 'dp-cand dp-cand-on' : 'dp-cand'}
              {...(onSelect ? { ...pressable(() => onSelect(i), on), tabIndex: stop ? 0 : -1 } : {})}
            >
              <span className="dp-cand-rank">{String(i + 1).padStart(2, '0')}</span>
              <span className="dp-cand-label">{placeText(lang, c, fix)}</span>
              <span className="dp-cand-iso" title={c.country ? region(c.country) : ''}>
                {c.country ?? '—'}
              </span>
              <span className="dp-cand-score">{fmtScore(c.score)}</span>
              <span className="dp-cand-pos">
                <span className="dp-cand-coord">
                  {fmtCoord(c.lat, c.lon)}
                  <span className="dp-low"> · ± {fmtKm(c.radiusKm)}</span>
                </span>
                <CheckLinks lat={c.lat} lon={c.lon} compact />
              </span>
              <span className="dp-cand-bar" aria-hidden="true">
                <span style={{ width: `${Math.max(0, Math.min(1, c.score)) * 100}%` }} />
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
