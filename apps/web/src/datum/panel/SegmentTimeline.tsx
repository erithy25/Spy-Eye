import { useEffect, useRef, useState } from 'react';
import type { Fix, FixSegment } from '../../../../server/src/datum/contract';
import { formatScore } from '../../format';
import { useLang } from '../../i18n';
import { rel } from '../api';
import { countryText, placeText, radiusHint, radiusText } from '../labels';
import { barLayout, coarseText, numberFits, spanText, stretchClock, timedStretches } from '../segments';
import { kmText, windowText } from '../useFixes';
import { kindMethod, referenceInstant, utcOffset } from './common';

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
  /** Whether the chosen stretch is described below the bar (BEFUND); RAUM shows the bar only. */
  detail?: boolean;
  /** In place of the count of places at the right of the head (RAUM: the chosen stretch). */
  caption?: string;
}

/**
 * The stretches of a recording of several places under its video: one bar per stretch, as wide as
 * it lasts, numbered where there is room; an undetermined stretch is drawn dashed. Below, the chosen
 * stretch: its span, its place with country, radius, confidence and time window, and its keyframe;
 * for an undetermined stretch the coarse regions its pictures point to, where there are any (never
 * a place). RAUM shows the bar only (`detail` false), with the chosen stretch as `caption`.
 */
export function SegmentTimeline({ fix, segments, selected, onSelect, places, atLeast, detail = true, caption }: SegmentTimelineProps) {
  const lang = useLang();
  const { t, locale } = lang;
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
  // The chosen stretch's time (its own from engine 11 on; the fix's for the stretch it shows).
  // Before engine 11 the stretches had no time of their own: the fix's, from the frames of the
  // whole file, is not said to be theirs.
  const timed = timedStretches(fix);
  const clock = chosen && loc && timed ? stretchClock(fix, selected) : null;
  const more = (chosen?.coarse?.length ?? 0) - 3;
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
          {caption ?? (
            <>
              {atLeast ? t('mindestens {n} Orte', { n: places }) : t('{n} Orte', { n: places })}
              {undetermined > 0 ? ` · ${t('{n} unbestimmt', { n: undetermined })}` : ''}
            </>
          )}
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
      {chosen && detail && (
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
                {clock ? (
                  <span className="dt-seg-sub" title={clock.time.timezone ?? ''}>
                    {t('Uhrzeit')} {windowText(clock.time) ?? '––:––'}
                    {clock.time.windows[0] ? ` · ${t(clock.time.windows[0].label)}` : ` · ${t('nicht bestimmbar')}`}
                    {clock.time.timezone ? ` · ${utcOffset(clock.time.timezone, referenceInstant(clock.time, clock.sun))}` : ''}
                  </span>
                ) : (
                  // A stretch with a place whose estimate failed (a frame unreadable): it has a place, no time.
                  timed && <span className="dt-seg-sub">{`${t('Uhrzeit')} ––:–– · ${t('nicht bestimmbar')}`}</span>
                )}
              </>
            ) : (
              <>
                <span className="dt-seg-sub">{t('Die Bilder dieses Abschnitts reichen für keinen Ort.')}</span>
                {/* Where the gallery and the world model agree on an area: named, but not a place. */}
                {(chosen.coarse ?? []).slice(0, 3).map((r) => (
                  <span
                    key={`${r.startSec}:${r.endSec}`}
                    className="dt-seg-sub"
                    title={t('Galerie und Weltmodell zeigen für diese Bilder in dieselbe Gegend. Das ist kein Ort: Es zählt nicht zu den Orten und wird nicht zum Ergebnis.')}
                  >
                    {coarseText(r, chosen, (de, vars) => t(de, vars), (km) => kmText(km, locale), (name) => lang.pick(name.label, name.labelEn))}
                  </span>
                ))}
                {more > 0 && <span className="dt-seg-sub low">{more === 1 ? t('und eine weitere grobe Region') : t('und {n} weitere grobe Regionen', { n: more })}</span>}
              </>
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
