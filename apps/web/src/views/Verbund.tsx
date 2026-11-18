import { useEffect, useMemo } from 'react';
import { fetchLedger, fetchPeers } from '../api';
import type { ViewProps } from '../App';
import { formatClock, shortHash } from '../format';
import { useLang } from '../i18n';
import { ledgerEnglish } from '../ledgerText';
import { MapCanvas, type MapLink, type MapMarker, type MapView } from '../map/MapCanvas';
import { Glyph, useLoad } from '../ui';

export function Verbund({ node }: ViewProps) {
  const { t, locale, lang } = useLang();
  const peers = useLoad(() => fetchPeers(), []);
  const full = node.can('ledger.read');
  const inbound = useLoad(
    async () => (full ? (await fetchLedger({ limit: 30, action: 'federation.inbound' })).entries : []),
    [full, node.ledger?.length],
  );
  const info = node.info?.node;
  const list = peers.data ?? [];

  // Peer state (reachability, witnessed heads) changes without events; refresh while the tab is open.
  useEffect(() => {
    const timer = window.setInterval(peers.reload, 5000);
    return () => window.clearInterval(timer);
  }, [peers.reload]);

  const markers = useMemo<MapMarker[]>(() => {
    if (!info) return [];
    return [
      { id: info.id, lat: info.lat, lon: info.lon, shape: 'node', label: info.name, sub: t('dieser Knoten'), selected: true },
      ...list.map((p): MapMarker => ({ id: p.id, lat: p.lat, lon: p.lon, shape: 'node', label: p.name, sub: p.online ? `${p.latencyMs ?? '–'} ms` : t('nicht erreichbar'), dim: !p.online })),
    ];
  }, [info, list, t]);
  const links = useMemo<MapLink[]>(() => (info ? list.map((p) => ({ from: info.id, to: p.id, active: p.online, dim: !p.online })) : []), [info, list]);

  const view = useMemo<MapView>(() => {
    if (!info) return { lat: 50.2, lon: 7.6, zoom: 8 };
    const lats = [info.lat, ...list.map((p) => p.lat)];
    const lons = [info.lon, ...list.map((p) => p.lon)];
    const span = Math.max(Math.max(...lats) - Math.min(...lats), (Math.max(...lons) - Math.min(...lons)) * 0.6);
    return {
      lat: (Math.max(...lats) + Math.min(...lats)) / 2,
      lon: (Math.max(...lons) + Math.min(...lons)) / 2,
      zoom: list.length === 0 ? 9 : Math.max(6, Math.min(10, 8.6 - Math.log2(Math.max(0.2, span)))),
    };
  }, [info, list]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">
            <small>{t('Weitsicht')}</small>
            {t('Verbund')}
          </h1>
          <p className="lede">
            {t(
              'Jede Behörde betreibt ihren eigenen Knoten. Im Verbund reist nur die Frage: signiert, mit Mandat und anfragender Person. Der Nachbar prüft sie nach seinen Regeln, protokolliert sie und gibt maskierte Vorschaubilder mit einer Belegnummer zurück. Aufnahmen, Verzeichnis und Protokoll verlassen ihn nicht.',
            )}
          </p>
        </div>
      </header>

      <div className="cols cols-wide">
        <div style={{ position: 'relative', height: 440, border: '1px solid var(--line)' }}>
          <MapCanvas view={view} viewKey={`${list.length}:${info?.id ?? ''}`} markers={markers} links={links} label={t('Knoten im Verbund')} />
        </div>
        <div className="section-gap" style={{ gap: 0 }}>
          {[
            [t('Es reist'), t('Die Frage in Worten. Mandat, Rechtsgrundlage und anfragende Person. Der eigene Protokollstand. Eine Signatur mit dem gemeinsamen Schlüssel der beiden Knoten.')],
            [t('Es bleibt'), t('Alle Aufnahmen und Standbilder. Das Verzeichnis der Bildmerkmale. Das Protokoll. Die Entscheidung, welche Quellen der Nachbar überhaupt freigibt.')],
            [t('Es kommt zurück'), t('Höchstens zwölf verkleinerte, maskierte Vorschaubilder mit Quelle, Ort und Zeit. Die Nummer des Eintrags, unter dem der Nachbar die Anfrage protokolliert hat. Sein Protokollstand, den dieser Knoten bezeugt.')],
          ].map(([title, text]) => (
            <div key={title} style={{ borderTop: '1px solid var(--line)', padding: '14px 0' }}>
              <div className="label" style={{ marginBottom: 6 }}>
                {title}
              </div>
              <div className="dim">{text}</div>
            </div>
          ))}
          <p className="hint" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
            {t('Gefragt wird im Bereich Suche mit dem Haken „im Verbund fragen“.')}
          </p>
        </div>
      </div>

      <section className="section-gap">
        <header className="panel-head">
          <h2 className="label">
            {t('Nachbarknoten')} <span className="count">{list.filter((p) => p.online).length}</span>
            <span className="count-of">/ {list.length}</span>
          </h2>
        </header>
        {peers.error && <p className="note">{peers.error}</p>}
        {list.length === 0 && !peers.error && (
          <p className="empty">{t('Dieser Knoten ist mit keinem anderen verbunden. Die Vorführung mit drei Knoten startet mit „pnpm demo“.')}</p>
        )}
        {list.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('Knoten')}</th>
                <th>{t('Betreiber')}</th>
                <th style={{ width: 110 }}>{t('Zustand')}</th>
                <th style={{ width: 90 }} className="num">
                  {t('Laufzeit')}
                </th>
                <th style={{ width: 170 }} className="num">
                  {t('Freigegebene Quellen')}
                </th>
                <th style={{ width: 80 }} className="num">
                  {t('Bilder')}
                </th>
                <th style={{ width: 210 }}>{t('Bezeugter Protokollstand')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} style={{ opacity: p.online ? 1 : 0.5 }}>
                  <td className="strong">
                    <Glyph kind="node" /> {p.name}
                  </td>
                  <td className="dim">{p.operator}</td>
                  <td>{p.online ? t('erreichbar') : t('nicht erreichbar')}</td>
                  <td className="num dim">{p.latencyMs !== null ? `${p.latencyMs} ms` : '–'}</td>
                  <td className="num">{p.sources}</td>
                  <td className="num">{p.frames.toLocaleString(locale)}</td>
                  <td className="hash">{shortHash(p.witnessedHead, 14)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {full && (
        <section className="section-gap">
          <header className="panel-head">
            <h2 className="label">
              {t('Anfragen anderer Knoten an diesen')} <span className="count">{inbound.data?.length ?? 0}</span>
            </h2>
          </header>
          {(inbound.data ?? []).length === 0 ? (
            <p className="empty">{t('Keine Fremdanfragen protokolliert.')}</p>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 60 }} className="num">
                    #
                  </th>
                  <th style={{ width: 100 }}>{t('Zeit')}</th>
                  <th style={{ width: 150 }}>{t('Knoten')}</th>
                  <th>{t('Inhalt')}</th>
                  <th style={{ width: 220 }}>{t('Mandat')}</th>
                </tr>
              </thead>
              <tbody>
                {(inbound.data ?? []).map((e) => {
                  const mandate = e.data['mandate'] as { title?: string } | undefined;
                  return (
                    <tr key={e.seq}>
                      <td className="num dim">{e.seq}</td>
                      <td className="dim">{formatClock(Date.parse(e.ts), locale)}</td>
                      <td>{e.actor.replace('node:', '')}</td>
                      <td title={e.summary}>{lang === 'en' ? ledgerEnglish(e, t) : e.summary}</td>
                      <td className="dim">{mandate?.title ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
