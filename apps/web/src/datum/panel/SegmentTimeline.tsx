import { useEffect, useRef, useState } from 'react';
import type { Fix, FixSegment } from '../../../../server/src/datum/contract';
import { formatScore } from '../../format';
import { useLang } from '../../i18n';
import { rel } from '../api';
import { countryText, placeText, radiusHint, radiusText } from '../labels';
import { barLayout, numberFits, spanText } from '../segments';
import { kindMethod } from './common';

export interface SegmentTimelineProps {
  fix: Fix;
  segments: FixSegment[];
  /** Index of the chosen stretch. */
  selected: number;
  onSelect: (index: number) => void;
  /** Distinct places (the fix's verdict). */
  places: number;
  /** Whether the count of places is a lower bound (segments.ts placesLowerBound). */
  atLeast: boolean;
}

/**
 * The stretches of a recording of several places under its video: one bar per stretch, as wide as
 * it lasts, numbered where there is room; an undetermined stretch is drawn dashed. Below, the chosen
 * stretch: its span, its place with country, radius and confidence, and its keyframe.
 */
export function SegmentTimeline({ fix, segments, selected, onSelect, places, atLeast }: SegmentTimelineProps) {
  const lang = useLang();
  const { t } = lang;
  const bar = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  const start = segments[0]?.startSec ?? 0;
  const total = Math.max(1, (segments[segments.length - 1]?.endSec ?? 1) - start);
  // The bars share the width less the gaps between them; many stretches get 1 px bars and gaps.
  const { dense, usable } = barLayout(segments.length, width);
  const chosen = segments[selected] ?? null;
  const undetermined = segments.filter((s) => !s.location).length;
  const loc = chosen?.location ?? null;
  const name = (s: FixSegment, i: number): string =>
    `${t('Abschnitt {n} von {total}', { n: i + 1, total: segments.length })} · ${spanText(s)} · ${s.location ? placeText(lang, s.location, fix) : t('unbestimmt')}`;

  const go = (index: number): void => {
    const next = Math.min(segments.length - 1, Math.max(0, index));
    if (next !== selected) onSelect(next);
  };

  return (
    <div className="dt-seg">
      <div className="label dt-seg-head">
        <span>
          {t('Abschnitte')} <span className="count">{segments.length}</span>
        </span>
        <span className="low">
          {atLeast ? t('mindestens {n} Orte', { n: places }) : t('{n} Orte', { n: places })}
          {undetermined > 0 ? ` · ${t('{n} unbestimmt', { n: undetermined })}` : ''}
        </span>
      </div>
      <div
        className={dense ? 'dt-seg-bar dense' : 'dt-seg-bar'}
        ref={bar}
        role="listbox"
        aria-label={t('Abschnitte der Aufnahme')}
        tabIndex={0}
        aria-activedescendant={`dt-seg-${selected}`}
        onKeyDown={(e) => {
          const to =
            e.key === 'ArrowRight' || e.key === 'ArrowDown'
              ? selected + 1
              : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                ? selected - 1
                : e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? segments.length - 1
                    : null;
          if (to === null) return;
          e.preventDefault();
          go(to);
        }}
      >
        {segments.map((s, i) => {
          const px = (usable * (s.endSec - s.startSec)) / total;
          const cls = ['dt-seg-cell', s.location ? '' : 'none', i === selected ? 'on' : ''].filter(Boolean).join(' ');
          return (
            <button
              key={`${s.startSec}:${s.firstFrame}`}
              id={`dt-seg-${i}`}
              type="button"
              role="option"
              aria-selected={i === selected}
              tabIndex={-1}
              className={cls}
              style={{ flexGrow: Math.max(0.001, s.endSec - s.startSec) }}
              title={name(s, i)}
              aria-label={name(s, i)}
              // Focus stays on the list, which carries aria-activedescendant: a clicked bar taking
              // it would leave the arrow keys moving the choice while focus (and what a screen
              // reader says) stayed on the bar clicked.
              onMouseDown={(e) => {
                e.preventDefault();
                bar.current?.focus();
              }}
              onClick={() => onSelect(i)}
            >
              {numberFits(px, i + 1) ? i + 1 : ''}
            </button>
          );
        })}
      </div>
      {chosen && (
        <div className="dt-seg-detail">
          <img src={rel(chosen.keyframe.imageUrl)} alt={t('Schlüsselbild von Abschnitt {n}', { n: selected + 1 })} loading="lazy" decoding="async" />
          <div className="dt-seg-where">
            <span className="dt-seg-span">
              {t('Abschnitt {n} von {total}', { n: selected + 1, total: segments.length })} · {spanText(chosen)}
            </span>
            <b>{loc ? placeText(lang, loc, fix) : t('Ort unbestimmt')}</b>
            {loc ? (
              <>
                <span className="dt-seg-sub" title={radiusHint(lang, loc)}>
                  {[countryText(lang, loc), radiusText(lang, loc)].filter((x) => x !== '').join(' · ')}
                </span>
                <span className="dt-seg-sub">
                  {t('Konfidenz')} {formatScore(loc.confidence)} · {t(kindMethod(loc.method))}
                </span>
              </>
            ) : (
              <span className="dt-seg-sub">{t('Die Bilder dieses Abschnitts reichen für keinen Ort.')}</span>
            )}
            {chosen.place !== null && (
              <span className="dt-seg-sub low">
                {t('Ort {n} von {total}', { n: chosen.place, total: places })}
                {chosen.joined ? ` · ${t('vom Weltmodell aus weiter entfernten Antworten zusammengefasst, vielleicht mehrere Orte')}` : ''}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
