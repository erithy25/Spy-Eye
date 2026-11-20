import { useEffect, useState, type FormEvent } from 'react';
import { ApiRequestError, errorText } from '../api';
import { useLang } from '../i18n';
import { useAction } from '../ui';
import { fetchSettings, putMapillaryKey, putStreetLevel, type DatumSettings } from './api';

export interface DatumSettingsPanelProps {
  can: (permission: string) => boolean;
}

/** Where the free Mapillary client token is issued (opened by the analyst's browser on a click). */
const MAPILLARY_DEVELOPERS = 'https://www.mapillary.com/dashboard/developers';

/**
 * The settings of the node's location engine: the street-level comparison, the Mapillary key it
 * may use and whether the world model is on this machine. Every role reads them; only the
 * supervisor (permission datum.settings) changes them, and the node records each change in the
 * ledger. A stored key is never shown: the node answers only whether one is stored and where it
 * comes from.
 */
export function DatumSettingsPanel({ can }: DatumSettingsPanelProps) {
  const { t } = useLang();
  const [settings, setSettings] = useState<DatumSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [key, setKey] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const action = useAction();
  const mayChange = can('datum.settings');

  useEffect(() => {
    const ctrl = new AbortController();
    fetchSettings(ctrl.signal)
      .then((value) => {
        setSettings(value);
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        // A node of an earlier version has no such route; that is a state, not a failure.
        if (err instanceof ApiRequestError && err.status === 404) setUnsupported(true);
        else setLoadError(errorText(err));
      });
    return () => ctrl.abort();
  }, []);

  const toggle = (enabled: boolean): void => {
    setDone(null);
    void action.run(async () => {
      setSettings(await putStreetLevel(enabled));
    });
  };

  const storeKey = (event: FormEvent): void => {
    event.preventDefault();
    const value = key.trim();
    if (value === '') return;
    setDone(null);
    void action.run(async () => {
      const next = await putMapillaryKey(value);
      // The field is emptied once the node has the key: it is not kept in the page any longer
      // than needed and never shown again.
      setKey('');
      setSettings(next);
      setDone(t('Schlüssel hinterlegt.'));
    });
  };

  const removeKey = (): void => {
    setDone(null);
    void action.run(async () => {
      setSettings(await putMapillaryKey(''));
      setDone(t('Schlüssel entfernt.'));
    });
  };

  if (unsupported) {
    return (
      <section className="dt-settings" aria-label={t('Einstellungen der Ortung')}>
        <p className="hint">{t('Dieser Knoten bietet diese Einstellungen noch nicht an (ältere Version).')}</p>
      </section>
    );
  }
  if (!settings) {
    return (
      <section className="dt-settings" aria-label={t('Einstellungen der Ortung')}>
        {loadError ? <p className="note">{loadError}</p> : <p className="hint">{t('Wird geladen …')}</p>}
      </section>
    );
  }

  const street = settings.streetLevel;
  const active = street.enabled && !street.forcedOff;
  const keyState = street.mapillaryKeySource === 'env' ? t('aus der Umgebung (MAPILLARY_TOKEN)') : street.mapillaryKeySource === 'stored' ? t('hinterlegt') : t('keiner');
  const providers = street.providers.map((p) => (p === 'panoramax' ? 'Panoramax' : 'Mapillary')).join(', ');
  const world = settings.worldModel;

  return (
    <section className="dt-settings" aria-label={t('Einstellungen der Ortung')}>
      <div className="dt-set-row">
        <div className="dt-set-key">{t('Straßenbildvergleich')}</div>
        <div className="dt-set-body">
          <div className="dt-set-state">
            {/* The state that holds (switched off by the environment it is off, whatever is
                stored); the stored choice, which returns without that, is said after the reason. */}
            {mayChange ? (
              <label className="check">
                <input type="checkbox" checked={active} disabled={action.busy || street.forcedOff} onChange={(e) => toggle(e.target.checked)} />
                {active ? t('eingeschaltet') : t('ausgeschaltet')}
              </label>
            ) : (
              <b>{active ? t('eingeschaltet') : t('ausgeschaltet')}</b>
            )}
            {active && providers !== '' && <span className="low">· {providers}</span>}
            {street.forcedOff && (
              <span className="low">
                {street.offline ? t('abgeschaltet: der Knoten läuft offline (SICHT_OFFLINE)') : t('durch die Umgebung abgeschaltet (DATUM_STREETLEVEL)')}
              </span>
            )}
            {mayChange && street.forcedOff && <span className="low">· {street.enabled ? t('gespeicherte Wahl: ein') : t('gespeicherte Wahl: aus')}</span>}
          </div>
          <p className="hint" title={t('Panoramax und, mit Schlüssel, Mapillary erfahren dabei, welche Gegend untersucht wird.')}>
            {t('Vergleicht mit öffentlichen Straßenbildern rund um den Ort. Videos verlassen den Knoten nicht.')}
          </p>
        </div>
      </div>

      <div className="dt-set-row">
        <div className="dt-set-key">{t('Mapillary-Schlüssel')}</div>
        <div className="dt-set-body">
          <div className="dt-set-state">
            <b>{keyState}</b>
          </div>
          {street.mapillaryKeySource === 'env' ? (
            <p className="hint">{t('Der Schlüssel ist im Knoten als MAPILLARY_TOKEN gesetzt und hier nicht änderbar.')}</p>
          ) : mayChange ? (
            <>
              <form className="dt-set-key-form" onSubmit={storeKey}>
                <input
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="MLY|…"
                  aria-label={t('Mapillary-Schlüssel')}
                  autoComplete="new-password"
                  spellCheck={false}
                  maxLength={300}
                />
                <button type="submit" className="btn btn-small" disabled={action.busy || key.trim() === ''}>
                  {street.mapillaryKeySource === 'stored' ? t('Ersetzen') : t('Hinterlegen')}
                </button>
                {street.mapillaryKeySource === 'stored' && (
                  <button type="button" className="text-btn" disabled={action.busy} onClick={removeKey}>
                    {t('Entfernen')}
                  </button>
                )}
              </form>
              <p className="hint">
                {t('Kostenloser Client-Token:')}{' '}
                <a className="dp-link" href={MAPILLARY_DEVELOPERS} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
                  mapillary.com
                </a>
              </p>
            </>
          ) : street.mapillaryKeySource === 'none' ? (
            <p className="hint">{t('Ohne Schlüssel fragt der Knoten nur Panoramax.')}</p>
          ) : null}
        </div>
      </div>

      <div className="dt-set-row">
        <div className="dt-set-key">{t('Weltmodell')}</div>
        <div className="dt-set-body">
          <div className="dt-set-state" title={world.available ? `GeoCLIP · ${world.precision}` : 'GeoCLIP'}>
            <b>{world.available ? t('vorhanden') : t('nicht vorhanden')}</b>
          </div>
          {!world.available && <p className="hint">{t('Ohne Weltmodell bleibt es bei Landmarken, Länderschätzung und Gelände.')}</p>}
        </div>
      </div>

      {action.error && <p className="note">{action.error}</p>}
      {done && !action.error && <p className="hint dt-set-done">{done}</p>}
      {!mayChange && <p className="hint">{t('Nur die Leitung kann diese Einstellungen ändern.')}</p>}
    </section>
  );
}
