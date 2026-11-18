import { useState } from 'react';
import type { Evidence, EvidenceKind } from '../../../../server/src/datum/contract';
import { useLang } from '../../i18n';
import { pressable } from '../../ui';
import { rel } from '../api';
import { KIND_CODE, KIND_METHOD, Meter, fmtCoord, fmtScore } from './common';
import './panel.css';

export interface EvidenceListProps {
  evidence: Evidence[];
  /** Optional: an entry was chosen (Enter, space or click), e.g. to jump to its frame. */
  onSelect?: (item: Evidence) => void;
}

const ORDER: EvidenceKind[] = ['metadata', 'landmark', 'horizon', 'sun', 'region', 'season', 'text', 'filename'];

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
  // What decided the fix first; equal weight keeps the order of the contract.
  return [...groups.values()].sort((a, b) => b.total - a.total || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

function Reference({ item }: { item: Evidence }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!item.refImage) return null;
  const name = item.refLabel ?? item.label;
  return (
    <div className={open ? 'dp-ref dp-ref-open' : 'dp-ref'}>
      <button
        type="button"
        className="dp-ref-thumb"
        aria-expanded={open}
        aria-label={open ? t('Referenzbild verkleinern: {name}', { name }) : t('Referenzbild vergrößern: {name}', { name })}
        onClick={() => setOpen((v) => !v)}
      >
        {/* The server names the gallery picture with a leading slash; relative, it also loads when
            the console is served under a path prefix. */}
        {failed ? <span className="dp-ref-none">{t('kein Bild')}</span> : <img src={rel(item.refImage)} alt="" loading="lazy" onError={() => setFailed(true)} />}
      </button>
      <div className="dp-ref-cap">
        <span className="dp-ref-name">{name}</span>
        {item.similarity !== undefined && (
          <span>
            <span className="dp-low">{t('Ähnlichkeit')} </span>
            {fmtScore(item.similarity)}
          </span>
        )}
        {item.refLat !== undefined && item.refLon !== undefined && <span className="dp-low">{fmtCoord(item.refLat, item.refLon)}</span>}
      </div>
    </div>
  );
}

export function EvidenceList({ evidence, onSelect }: EvidenceListProps) {
  const { t } = useLang();
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
            <span className="dp-code">{t(KIND_CODE[group.kind])}</span>
            <span className="dp-ev-kind-name">{t(KIND_METHOD[group.kind])}</span>
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
                    <span className="dp-ev-label">{item.label}</span>
                    <Meter value={item.weight} label={t('Gewicht')} />
                    <span className="dp-val">{fmtScore(item.weight)}</span>
                  </div>
                  <p className="dp-ev-detail">
                    {item.detail}
                    {item.frame !== undefined && <span className="dp-ev-frame"> · {t('Bild {n}', { n: item.frame })}</span>}
                  </p>
                  <Reference item={item} />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
