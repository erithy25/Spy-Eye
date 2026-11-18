import type { MouseEvent } from 'react';
import { useLang } from '../../i18n';
import { googleMapsUrl, streetViewUrl } from './common';
import './panel.css';

export interface CheckLinksProps {
  lat: number;
  lon: number;
  /**
   * Short link texts ("Street View", "Google Maps") for narrow rows such as the candidate list;
   * the full wording stays in the accessible name.
   */
  compact?: boolean;
  className?: string;
}

/**
 * Two links that let a person check a place in Google's own viewers. The node never fetches or
 * compares Google imagery (the Maps Platform terms forbid that); only the analyst's browser opens
 * Google, on a click, and it learns nothing but the coordinates in the URL. No referrer and no
 * opener go with it.
 */
export function CheckLinks({ lat, lon, compact = false, className }: CheckLinksProps) {
  const { t } = useLang();
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const hint = t('Öffnet Google im Browser und übergibt ihm die Koordinaten.');
  const street = t('In Street View prüfen');
  const maps = t('In Google Maps öffnen');
  // Inside a row that is chosen by a click (a candidate), following a link must not choose the row too.
  const keep = (event: MouseEvent): void => event.stopPropagation();
  return (
    <span className={className ? `dp-checks ${className}` : 'dp-checks'}>
      <a
        className="dp-link dp-check"
        href={streetViewUrl(lat, lon)}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        title={hint}
        {...(compact ? { 'aria-label': `${street}: ${hint}` } : {})}
        onClick={keep}
      >
        {compact ? t('Street View') : street}
      </a>
      <a
        className="dp-link dp-check"
        href={googleMapsUrl(lat, lon)}
        target="_blank"
        rel="noopener noreferrer"
        referrerPolicy="no-referrer"
        title={hint}
        {...(compact ? { 'aria-label': `${maps}: ${hint}` } : {})}
        onClick={keep}
      >
        {compact ? t('Google Maps') : maps}
      </a>
    </span>
  );
}
