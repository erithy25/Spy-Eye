import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { Evidence, EvidenceKind, GeoPoint } from '../../../../server/src/datum/contract';
import { useLang } from '../../i18n';
import { haversineKm } from '../../map/geo';
import { pressable } from '../../ui';
import { rel } from '../api';
import { nameText } from '../labels';
import { Meter, fmtCoord, fmtKm, fmtScore, kindMethod, kindRank, webLink } from './common';
import './panel.css';

export interface EvidenceListProps {
  evidence: Evidence[];
  /** Optional: an entry was chosen (Enter, space or click), e.g. to jump to its frame. */
  onSelect?: (item: Evidence) => void;
  /** Place of the fix; with it a street-level picture says how far from the fix it was taken. */
  at?: GeoPoint | null;
}

interface Group {
  kind: EvidenceKind;
  items: Evidence[];
  total: number;
}

function groupEvidence(evidence: Evidence[]): Group[] {
  const groups = new Map<EvidenceKind, Group>();
  for (const item of evidence) {
    const group = groups.get(item.kind) ?? { kind: item.kind, items: [], total: 0 };
    group.items.push(item);
    group.total += item.weight;
    groups.set(item.kind, group);
  }
  for (const group of groups.values()) group.items.sort((a, b) => b.weight - a.weight);
  // What decided the fix first; equal weight keeps the order of KIND_ORDER.
  return [...groups.values()].sort((a, b) => b.total - a.total || kindRank(a.kind) - kindRank(b.kind));
}

/**
 * The name of an entry's reference in the console language: a gallery reference's place has an
 * English twin (refLabelEn); a street-level attribution reads the same in both languages.
 */
function refName(lang: ReturnType<typeof useLang>, item: Evidence): string {
  return item.refLabel !== undefined ? nameText(lang, item.refLabel, item.refLabelEn) : lang.pick(item.label, item.labelEn);
}

/**
 * The reference picture of an entry with what it says: a gallery picture (landmark) with its name,
 * or a public street-level picture with its attribution under it. The picture always comes from
 * the node (`refImage`); a street-level picture is fetched by the node from its source, never by
 * the browser. `refUrl` opens the picture at its source, on a click only.
 */
function Reference({ item, at, named }: { item: Evidence; at: GeoPoint | null; named: boolean }) {
  const lang = useLang();
  const { t } = lang;
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const page = webLink(item.refUrl);
  const street = item.kind === 'streetlevel';
  if (!item.refImage && !page) return null;
  const name = refName(lang, item);
  const hasPicture = item.refImage !== undefined && item.refImage !== '' && !failed;
  // A street-level picture the source no longer has (an expired Mapillary link, a deleted
  // Panoramax picture) is said as such; the link to its page may still work.
  const none = street ? (item.refImage ? t('Bild nicht mehr verfügbar') : t('kein Bild')) : t('kein Bild');
  const distanceKm = street && at && item.refLat !== undefined && item.refLon !== undefined ? haversineKm(at.lat, at.lon, item.refLat, item.refLon) : null;
  return (
    <div className={open && hasPicture ? 'dp-ref dp-ref-open' : 'dp-ref'}>
      <div className="dp-ref-fig">
        {hasPicture ? (
          <button
            type="button"
            className="dp-ref-thumb"
            aria-expanded={open}
            aria-label={open ? t('Referenzbild verkleinern: {name}', { name }) : t('Referenzbild vergrößern: {name}', { name })}
            onClick={() => setOpen((v) => !v)}
          >
            {/* The server names the picture with a leading slash; relative, it also loads when the
                console is served under a path prefix. */}
            <img src={rel(item.refImage)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
          </button>
        ) : (
          <span className="dp-ref-thumb dp-ref-thumb-none">
            <span className="dp-ref-none">{none}</span>
          </span>
        )}
        {/* The licence of a street-level picture asks for its attribution wherever it is shown. */}
        {street && item.refLabel && <span className="dp-ref-attr">{item.refLabel}</span>}
      </div>
      <div className="dp-ref-cap">
        {!street && !named && <span className="dp-ref-name">{name}</span>}
        {item.similarity !== undefined && (
          <span>
            <span className="dp-low">{t('Ähnlichkeit')} </span>
            {fmtScore(item.similarity)}
          </span>
        )}
        {distanceKm !== null && (
          <span>
            {distanceKm < 0.05 ? t('am Ort des Fixes') : t('{d} vom Fix', { d: fmtKm(distanceKm) })}
          </span>
        )}
        {item.refLat !== undefined && item.refLon !== undefined && <span className="dp-low">{fmtCoord(item.refLat, item.refLon)}</span>}
        {page && (
          <a
            className="dp-link dp-ref-link"
            href={page}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            title={t('Öffnet die Seite des Bildes bei seiner Quelle.')}
            onClick={(event) => event.stopPropagation()}
          >
            {t('Quelle öffnen')}
          </a>
        )}
      </div>
    </div>
  );
}

/** Details longer than this are cut to two lines until clicked. */
const LONG_DETAIL = 150;

function Detail({ text, frame }: { text: string; frame: number | undefined }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const long = text.length > LONG_DETAIL;
  // The frame is named once: at the end only when the text does not name it already.
  const frameText = frame !== undefined ? t('Bild {n}', { n: frame }) : '';
  const showFrame = frameText !== '' && !text.toLocaleLowerCase().includes(frameText.toLocaleLowerCase());
  const toggle = (): void => setOpen((v) => !v);
  return (
    <p
      className={long && !open ? 'dp-ev-detail dp-ev-clamp' : 'dp-ev-detail'}
      {...(long
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-expanded': open,
            title: open ? '' : t('Ganzen Text zeigen'),
            onClick: (event: MouseEvent) => {
              event.stopPropagation();
              toggle();
            },
            onKeyDown: (event: KeyboardEvent) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                toggle();
              }
            },
          }
        : {})}
    >
      {text}
      {showFrame && <span className="dp-ev-frame"> · {frameText}</span>}
    </p>
  );
}

/** The model behind the world-model entries is a detail of the engine, not of the finding. */
const MODEL_NAME = /\s*\(GeoCLIP\)/g;

/**
 * An entry of the whole file in a fix whose place came from a stretch of the recording (server:
 * segments.ts wholeFileEvidence): the prefix stays in front of a title the console words itself.
 */
const WHOLE_FILE = /^(?:Ganze Datei \(gemischt\)|Whole file \(mixed\)): /;

/**
 * Title and explanation of an entry as the console words them. The node's texts are used, except
 * where they repeat what the entry shows anyway: a reference picture is named by its place (the
 * similarity is in the caption under the picture, and the distance is written in the console's
 * number format); the first country estimate drops its shares, which the fused countries of the
 * panel give, so that the page does not show two sets of percentages for the same thing.
 */
function entryText(entry: Evidence, lang: ReturnType<typeof useLang>, at: GeoPoint | null): { title: string; detail: string } {
  const { t, pick } = lang;
  let title = pick(entry.label, entry.labelEn).replace(MODEL_NAME, '');
  let detail = pick(entry.detail, entry.detailEn).replace(MODEL_NAME, '');
  const whole = WHOLE_FILE.exec(title)?.[0] ?? '';
  title = title.slice(whole.length);
  if (entry.kind === 'landmark' && entry.refLabel && entry.similarity !== undefined) {
    title = t('Referenzbild: {name}', { name: nameText(lang, entry.refLabel, entry.refLabelEn) });
    const km = at && entry.refLat !== undefined && entry.refLon !== undefined ? haversineKm(at.lat, at.lon, entry.refLat, entry.refLon) : null;
    const where = km === null ? '' : km < 1 ? t('am Ergebnisort') : t('{d} vom Ergebnis', { d: fmtKm(km) });
    const what = entry.frame !== undefined ? t('Bild {n} ähnelt diesem Referenzbild', { n: entry.frame }) : t('Ein Bild ähnelt diesem Referenzbild');
    detail = where ? `${what}; ${where}.` : `${what}.`;
  } else if (entry.kind === 'region') {
    const m = /^(?:Länderschätzung|Country estimate):\s*(.+)$/.exec(title);
    if (m) title = t('Erste Länderschätzung: {list}', { list: m[1]!.replace(/\s*\d+(?:[.,]\d+)?\s?%/g, '') });
  }
  return { title: `${whole}${title}`, detail };
}

export function EvidenceList({ evidence, onSelect, at = null }: EvidenceListProps) {
  const lang = useLang();
  const { t } = lang;
  const groups = groupEvidence(evidence);
  const item = (entry: Evidence, i: number, withPicture: boolean) => {
    const nil = entry.weight <= 0.0001;
    const text = entryText(entry, lang, at);
    const name = refName(lang, entry);
    return (
      <li key={i} className={nil ? 'dp-ev-item dp-ev-nil' : 'dp-ev-item'} {...(onSelect ? pressable(() => onSelect(entry)) : {})}>
        <div className="dp-ev-top">
          <span className="dp-ev-label">{text.title}</span>
          <Meter value={entry.weight} label={t('Gewicht')} />
          <span className="dp-val">{fmtScore(entry.weight)}</span>
        </div>
        <Detail text={text.detail} frame={entry.frame} />
        {/* Keyed by the picture: a new result at the same place in the list starts without the
            failure state of the picture before it. */}
        {withPicture && <Reference key={entry.refImage ?? entry.refUrl ?? ''} item={entry} at={at} named={text.title.includes(name)} />}
      </li>
    );
  };
  return (
    <section className="dp dp-evidence" aria-label={t('Evidenz')}>
      <header className="dp-head">
        <h3 className="label">
          {t('Evidenz')} <span className="count">{evidence.length}</span>
        </h3>
        <span className="dp-head-note">{t('Gewicht')}</span>
      </header>
      {groups.length === 0 && <p className="dp-empty">{t('Keine Evidenz.')}</p>}
      {groups.map((group) => {
        const weighed = group.items.filter((e) => e.weight > 0.0001);
        const nil = group.items.filter((e) => e.weight <= 0.0001);
        return (
          // The titles name their method ("Referenzbild: …", "Sonnenhöhe …"); the group's name is
          // only its label for screen readers.
          <div className="dp-ev-group" key={group.kind} role="group" aria-label={t(kindMethod(group.kind))}>
            <div className="dp-ev-body">
              {weighed.length > 0 && <ul className="dp-ev-items">{weighed.map((e, i) => item(e, i, i < 2 || e.kind === 'streetlevel'))}</ul>}
              {nil.length > 0 &&
                (weighed.length === 0 && nil.length === 1 ? (
                  <ul className="dp-ev-items">{item(nil[0]!, 0, false)}</ul>
                ) : (
                  <details className="dp-ev-fold">
                    <summary>{t('{n} ohne Gewicht', { n: nil.length })}</summary>
                    <ul className="dp-ev-items">{nil.map((e, i) => item(e, i, false))}</ul>
                  </details>
                ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
