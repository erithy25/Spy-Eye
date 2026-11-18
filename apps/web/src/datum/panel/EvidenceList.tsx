import { useState } from 'react';
import type { Evidence, EvidenceKind, GeoPoint } from '../../../../server/src/datum/contract';
import { useLang } from '../../i18n';
import { haversineKm } from '../../map/geo';
import { pressable } from '../../ui';
import { rel } from '../api';
import { Meter, fmtCoord, fmtKm, fmtScore, kindCode, kindMethod, kindRank, webLink } from './common';
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
 * The reference picture of an entry with what it says: a gallery picture (landmark) with its name,
 * or a public street-level picture with its attribution under it. The picture always comes from
 * the node (`refImage`); a street-level picture is fetched by the node from its source, never by
 * the browser. `refUrl` opens the picture at its source, on a click only.
 */
function Reference({ item, at }: { item: Evidence; at: GeoPoint | null }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const page = webLink(item.refUrl);
  const street = item.kind === 'streetlevel';
  if (!item.refImage && !page) return null;
  const name = item.refLabel ?? item.label;
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
        {!street && <span className="dp-ref-name">{name}</span>}
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

export function EvidenceList({ evidence, onSelect, at = null }: EvidenceListProps) {
  const { t, pick } = useLang();
  const groups = groupEvidence(evidence);
  return (
    <section className="dp dp-evidence" aria-label={t('Evidenz')}>
      <header className="dp-head">
        <h3 className="label">
          {t('Evidenz')} <span className="count">{evidence.length}</span>
        </h3>
        <span className="dp-head-note">{t('Gewicht')}</span>
      </header>
      {groups.length === 0 && <p className="dp-empty">{t('Keine Evidenz.')}</p>}
      {groups.map((group) => (
        <div className="dp-ev-group" key={group.kind}>
          <div className="dp-ev-kind">
            <span className="dp-code">{t(kindCode(group.kind))}</span>
            <span className="dp-ev-kind-name">{t(kindMethod(group.kind))}</span>
            {group.items.length > 1 && <span className="dp-ev-sum">Σ {fmtScore(group.total)}</span>}
          </div>
          <ul className="dp-ev-items">
            {group.items.map((item, i) => {
              const nil = item.weight <= 0.0001;
              return (
                <li
                  key={i}
                  className={nil ? 'dp-ev-item dp-ev-nil' : 'dp-ev-item'}
                  {...(onSelect ? pressable(() => onSelect(item)) : {})}
                >
                  <div className="dp-ev-top">
                    <span className="dp-ev-label">{pick(item.label, item.labelEn)}</span>
                    <Meter value={item.weight} label={t('Gewicht')} />
                    <span className="dp-val">{fmtScore(item.weight)}</span>
                  </div>
                  <p className="dp-ev-detail">
                    {pick(item.detail, item.detailEn)}
                    {item.frame !== undefined && <span className="dp-ev-frame"> · {t('Bild {n}', { n: item.frame })}</span>}
                  </p>
                  {/* Keyed by the picture: a new result at the same place in the list starts without the
                      failure state of the picture before it. */}
                  <Reference key={item.refImage ?? item.refUrl ?? ''} item={item} at={at} />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
