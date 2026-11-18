import { Activity, Suspense, lazy, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createMandate, errorText, fetchMandates, selectMandate, type Mandate, type Role } from './api';
import type { FrameTarget } from './components/FrameSheet';
import { formatCount, formatExercise, shortHash } from './format';
import { LangProvider, useLang } from './i18n';
import { MapCanvas, type MapMarker } from './map/MapCanvas';
import { Dialog, Field, pressable, useAction } from './ui';
import { useNode, type NodeConnection } from './useNode';
import './datum/datum.css';
import { useFixes } from './datum/useFixes';
import { Ortung, type DatumViewProps } from './datum/views/Ortung';

// Every view but ORTUNG, the first one, is loaded when it is first opened: the 3D views alone are
// a large part of the console, and a slow machine should not parse them before the map shows.
const Befund = lazy(() => import('./datum/views/Befund').then((m) => ({ default: m.Befund })));
const Raum = lazy(() => import('./datum/views/Raum').then((m) => ({ default: m.Raum })));
const Messung = lazy(() => import('./datum/views/Messung').then((m) => ({ default: m.Messung })));
const Suche = lazy(() => import('./views/Suche').then((m) => ({ default: m.Suche })));
const Quellen = lazy(() => import('./views/Quellen').then((m) => ({ default: m.Quellen })));
const Protokoll = lazy(() => import('./views/Protokoll').then((m) => ({ default: m.Protokoll })));
const Lage = lazy(() => import('./views/Lage').then((m) => ({ default: m.Lage })));
const Wachen = lazy(() => import('./views/Wachen').then((m) => ({ default: m.Wachen })));
const Vorgaenge = lazy(() => import('./views/Vorgaenge').then((m) => ({ default: m.Vorgaenge })));
const Verbund = lazy(() => import('./views/Verbund').then((m) => ({ default: m.Verbund })));
const Wirkung = lazy(() => import('./views/Wirkung').then((m) => ({ default: m.Wirkung })));
const FrameSheet = lazy(() => import('./components/FrameSheet').then((m) => ({ default: m.FrameSheet })));

type TabId = 'ortung' | 'befund' | 'raum' | 'suche' | 'quellen' | 'messung' | 'protokoll' | 'lage' | 'wachen' | 'vorgaenge' | 'verbund' | 'wirkung';

/** The console of the predecessor platform, shown by nodes that run the civil operating picture. */
const SICHT_TABS: { id: TabId; label: string; permission: string | null }[] = [
  { id: 'lage', label: 'Lage', permission: 'media' },
  { id: 'suche', label: 'Suche', permission: 'search' },
  { id: 'wachen', label: 'Wachen', permission: 'watch.read' },
  { id: 'vorgaenge', label: 'Vorgänge', permission: 'case.read' },
  { id: 'verbund', label: 'Verbund', permission: 'federation.read' },
  { id: 'protokoll', label: 'Protokoll', permission: null },
  { id: 'quellen', label: 'Quellen', permission: 'source.read' },
  { id: 'wirkung', label: 'Wirkung', permission: 'metrics.read' },
];

const TABS: { id: TabId; label: string; permission: string | null }[] = [
  { id: 'ortung', label: 'Ortung', permission: 'media' },
  { id: 'befund', label: 'Befund', permission: 'media' },
  { id: 'raum', label: 'Raum', permission: 'media' },
  { id: 'suche', label: 'Suche', permission: 'search' },
  { id: 'quellen', label: 'Bestand', permission: 'source.read' },
  { id: 'messung', label: 'Messung', permission: 'media' },
  { id: 'protokoll', label: 'Protokoll', permission: null },
];

let MARK = 'DATUM';

function isSicht(node: NodeConnection): boolean {
  return node.info?.product === 'sicht';
}

const ROLE_LABEL: Record<Role, string> = { operator: 'Auswertung', supervisor: 'Leitung', auditor: 'Aufsicht' };

export interface ViewProps {
  node: NodeConnection;
  openFrame: (target: FrameTarget, list?: FrameTarget[]) => void;
}

export function App() {
  return (
    <LangProvider>
      <Root />
    </LangProvider>
  );
}

function Root() {
  const node = useNode();
  const { t } = useLang();
  MARK = isSicht(node) ? 'SICHT' : 'DATUM';
  const title = node.info ? (isSicht(node) ? 'Sicht' : 'DATUM') : null;
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
  const [skipMandate, setSkipMandate] = useState(false);

  if (node.phase === 'loading' || node.phase === 'unreachable') {
    return (
      <div className="gate">
        <div className="gate-map" />
        <div className="gate-side">
          <div>
            <div className="gate-mark">{MARK}</div>
            <p className="gate-claim">{node.phase === 'unreachable' ? t('Knoten nicht erreichbar. Neuer Versuch …') : t('Verbinde …')}</p>
          </div>
        </div>
      </div>
    );
  }
  if (node.phase === 'signed-out' || !node.session) return <Login node={node} />;
  if (node.session.mandate === null && node.can('search') && !skipMandate) {
    return <MandateGate node={node} onSkip={() => setSkipMandate(true)} />;
  }
  return <Shell node={node} />;
}

function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <span className="lang">
      <button type="button" className={lang === 'de' ? 'on' : ''} onClick={() => setLang('de')}>
        DE
      </button>
      <button type="button" className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>
        EN
      </button>
    </span>
  );
}

function GateMap({ node }: { node: NodeConnection }) {
  const info = node.info?.node;
  const markers = useMemo<MapMarker[]>(
    () => (info ? [{ id: info.id, lat: info.lat, lon: info.lon, shape: 'node', label: '', sub: info.operator }] : []),
    [info],
  );
  if (!info) return <div className="gate-map" />;
  return (
    <div className="gate-map">
      {isSicht(node) ? (
        <MapCanvas view={{ lat: info.lat, lon: info.lon, zoom: 11.4 }} viewKey={info.id} markers={markers} readouts={false} />
      ) : (
        <MapCanvas view={{ lat: 30, lon: 10, zoom: 1.8 }} viewKey={info.id} markers={markers} minZoom={1} readouts={false} />
      )}
    </div>
  );
}

function Login({ node }: { node: NodeConnection }) {
  const { t } = useLang();
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const action = useAction();
  const info = node.info;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void action.run(() => node.signIn(user.trim(), password));
  };

  return (
    <div className="gate">
      <GateMap node={node} />
      <div className="gate-side">
        <div>
          <div className="gate-mark">{MARK}</div>
          <p className="gate-claim">{isSicht(node) ? t('Keine Sicht ohne Aufsicht.') : t('Jedes Bild hat einen Ort und eine Uhrzeit.')}</p>
        </div>
        {info && (
          <div className="gate-node">
            <div className="strong">{t(info.node.name)}</div>
            <div className="dim">{t(info.node.operator)}</div>
          </div>
        )}
        <form className="form" onSubmit={submit}>
          <Field label={t('Kennung')}>
            <input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" autoFocus />
          </Field>
          <Field label={t('Passwort')}>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          {action.error && <p className="note">{action.error}</p>}
          <div className="btn-row">
            <button type="submit" className="btn btn-solid" disabled={action.busy || user === '' || password === ''}>
              {t('Anmelden')}
            </button>
            <LangSwitch />
          </div>
        </form>
        {info?.demo && (
          <div className="section-gap">
            <div className="label">{t('Vorführzugänge')}</div>
            <table className="tbl">
              <tbody>
                {info.demo.users.map((u) => (
                  <tr
                    key={u.id}
                    className="clickable"
                    {...pressable(() => {
                      setUser(u.id);
                      setPassword(info.demo?.passwordHint ?? '');
                    }, user === u.id)}
                  >
                    <td className="strong" style={{ width: 92 }}>
                      {u.id}
                    </td>
                    <td>{t(ROLE_LABEL[u.role])}</td>
                    <td className="dim">{t(u.name)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">
              {info.demo.passwordHint !== '' ? (
                <>
                  {t('Passwort für alle Vorführzugänge')}: <span className="strong">{info.demo.passwordHint}</span>.{' '}
                </>
              ) : (
                <>{t('Das Passwort der Vorführzugänge hat der Betreiber gesetzt.')} </>
              )}
              {t('Dieser Knoten läuft mit Übungsdaten; im Betrieb werden die Zugänge durch die der Behörde ersetzt.')}
            </p>
          </div>
        )}
        <p className="gate-foot">
          {t('Jede Anmeldung, jede Abfrage und jede Freigabe wird in einem verketteten Protokoll festgehalten.')}
          {info ? ` · v${info.node.version}` : ''}
        </p>
      </div>
    </div>
  );
}

function MandateForm({ onCreated }: { onCreated: (mandate: Mandate) => void }) {
  const { t } = useLang();
  const [title, setTitle] = useState('');
  const [legalBasis, setLegalBasis] = useState('');
  const [purpose, setPurpose] = useState('');
  const [hours, setHours] = useState('72');
  const [exercise, setExercise] = useState(false);
  const [persons, setPersons] = useState(false);
  const action = useAction();

  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        void action.run(async () => {
          onCreated(
            await createMandate({
              title: title.trim(),
              legalBasis: legalBasis.trim(),
              purpose: purpose.trim(),
              validHours: Math.max(0, Number(hours) || 0),
              exercise,
              personDescriptions: persons,
            }),
          );
        });
      }}
    >
      <Field label={t('Bezeichnung des Einsatzes')}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
      </Field>
      <Field label={t('Rechtsgrundlage')} hint={t('So, wie die Behörde sie zitiert, etwa die Vorschrift des Brand- und Katastrophenschutzgesetzes.')}>
        <input value={legalBasis} onChange={(e) => setLegalBasis(e.target.value)} maxLength={200} />
      </Field>
      <Field label={t('Zweck der Auswertung')}>
        <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3} maxLength={500} />
      </Field>
      <div className="field-row">
        <Field label={t('Gültig für (Stunden, 0 = unbefristet)')}>
          <input value={hours} onChange={(e) => setHours(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" />
        </Field>
        <div className="section-gap" style={{ justifyContent: 'flex-end' }}>
          <label className="check">
            <input type="checkbox" checked={exercise} onChange={(e) => setExercise(e.target.checked)} />
            {t('Übung')}
          </label>
          <label className="check">
            <input type="checkbox" checked={persons} onChange={(e) => setPersons(e.target.checked)} />
            {t('Personenbeschreibung nach Geschlecht und Altersgruppe zulässig')}
          </label>
        </div>
      </div>
      {action.error && <p className="note">{action.error}</p>}
      <div className="btn-row">
        <button type="submit" className="btn btn-solid" disabled={action.busy}>
          {t('Mandat anlegen')}
        </button>
      </div>
    </form>
  );
}

function MandateList({ node, onChosen }: { node: NodeConnection; onChosen: () => void }) {
  const { t, pick, locale } = useLang();
  const [mandates, setMandates] = useState<Mandate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const action = useAction();

  const load = useCallback(() => {
    fetchMandates()
      .then((list) => setMandates(list.filter((m) => m.status === 'open' && (m.validTo === null || m.validTo > Date.now()))))
      .catch((err: unknown) => setError(errorText(err)));
  }, []);
  useEffect(load, [load]);

  const choose = (id: string): void => {
    void action.run(async () => {
      node.setSession(await selectMandate(id));
      onChosen();
    });
  };

  return (
    <div className="section-gap">
      {error && <p className="note">{error}</p>}
      {action.error && <p className="note">{action.error}</p>}
      {mandates !== null && mandates.length === 0 && <p className="empty">{t('Kein gültiges Mandat vorhanden.')}</p>}
      {(mandates ?? []).map((m) => (
        <button key={m.id} type="button" className="incident" style={{ textAlign: 'left', padding: '12px 0' }} disabled={action.busy} onClick={() => choose(m.id)}>
          <h4>
            <span>{pick(m.title, m.titleEn)}</span>
            <span />
            {m.exercise && <span className="pill">{t('Übung')}</span>}
            {m.personDescriptions && <span className="pill">{t('Personenbeschreibung zulässig')}</span>}
            {node.session?.mandate?.id === m.id && <span className="pill pill-solid">{t('aktiv')}</span>}
          </h4>
          <div className="alert-line">{pick(m.legalBasis, m.legalBasisEn)}</div>
          <div className="alert-line" style={{ whiteSpace: 'normal' }}>
            {pick(m.purpose, m.purposeEn)}
          </div>
          <div className="alert-line low">
            {t('erteilt von')} {m.issuedBy} · {m.validTo === null ? t('unbefristet') : `${t('bis')} ${new Date(m.validTo).toLocaleString(locale)}`}
          </div>
        </button>
      ))}
      {node.can('mandate.write') &&
        (creating ? (
          <MandateForm
            onCreated={(m) => {
              setCreating(false);
              load();
              choose(m.id);
            }}
          />
        ) : (
          <div>
            <button type="button" className="btn" onClick={() => setCreating(true)}>
              {t('Neues Mandat')}
            </button>
          </div>
        ))}
    </div>
  );
}

function MandateGate({ node, onSkip }: { node: NodeConnection; onSkip: () => void }) {
  const { t } = useLang();
  return (
    <div className="gate">
      <GateMap node={node} />
      <div className="gate-side" style={{ justifyContent: 'flex-start', overflowY: 'auto', maxHeight: '100vh' }}>
        <div>
          <div className="gate-mark">{MARK}</div>
          <p className="gate-claim">{t('Unter welchem Mandat arbeiten Sie?')}</p>
        </div>
        <p className="dim">
          {t(
            'Ohne Zweck keine Auswertung. Jede Suche, jede Wache und jeder Vorgang wird dem gewählten Mandat zugeordnet und mit ihm protokolliert.',
          )}
        </p>
        <MandateList node={node} onChosen={() => undefined} />
        <div className="btn-row">
          <button type="button" className="text-btn" onClick={onSkip}>
            {t('Ohne Mandat fortfahren (nur Einsicht in Protokoll und Bestand)')}
          </button>
          <button type="button" className="text-btn" onClick={() => void node.signOut()}>
            {t('Abmelden')}
          </button>
        </div>
      </div>
    </div>
  );
}

function initialTab(allowed: TabId[]): TabId {
  const fromHash = window.location.hash.replace('#', '').split('/')[0] as TabId;
  return allowed.includes(fromHash) ? fromHash : (allowed[0] ?? 'protokoll');
}

function initialSelection(): string | null {
  const part = window.location.hash.replace('#', '').split('/')[1] ?? '';
  return /^[a-f0-9]{16}$/.test(part) ? part : null;
}

function ViewLoading() {
  const { t } = useLang();
  return <div className="dt-empty-view">{t('Wird geladen …')}</div>;
}

function Shell({ node }: { node: NodeConnection }) {
  const { t, pick } = useLang();
  const session = node.session;
  const tabs = isSicht(node) ? SICHT_TABS : TABS;
  const allowed = useMemo(() => tabs.filter((tab) => tab.permission === null || node.can(tab.permission)).map((tab) => tab.id), [node, tabs]);
  const [tab, setTab] = useState<TabId>(() => initialTab(allowed));
  const [selected, setSelected] = useState<string | null>(() => initialSelection());
  const datum = useFixes(node);
  const [sheet, setSheet] = useState<{ list: FrameTarget[]; index: number } | null>(null);
  const [mandateDialog, setMandateDialog] = useState(false);

  useEffect(() => {
    if (!allowed.includes(tab)) setTab(allowed[0] ?? 'protokoll');
  }, [allowed, tab]);

  useEffect(() => {
    window.history.replaceState(null, '', `#${tab}${selected ? `/${selected}` : ''}`);
  }, [tab, selected]);

  // A link to another tab or recording (#raum/<id>) followed within the page. replaceState above
  // does not fire this event, so the two do not chase each other.
  useEffect(() => {
    const onHash = (): void => {
      const [name, part] = window.location.hash.replace('#', '').split('/');
      if (name && allowed.includes(name as TabId)) setTab(name as TabId);
      setSelected(part && /^[a-f0-9]{16}$/.test(part) ? part : null);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [allowed]);

  const openFrame = useCallback((target: FrameTarget, list?: FrameTarget[]) => {
    const all = list && list.length > 0 ? list : [target];
    const index = Math.max(0, all.findIndex((x) => x.videoId === target.videoId && x.frameNumber === target.frameNumber));
    setSheet({ list: all, index });
  }, []);

  if (!session) return null;
  const scenario = node.intel?.scenario ?? null;
  const exerciseRunning = scenario !== null && (scenario.status === 'running' || scenario.status === 'paused' || scenario.status === 'finished');
  const exerciseContext = session.mandate?.exercise === true || exerciseRunning;
  const model = node.app?.model ?? null;
  const current = sheet ? (sheet.list[sheet.index] ?? null) : null;
  const props: ViewProps = { node, openFrame };
  const newAlerts = (node.intel?.alerts ?? []).filter((a) => a.status === 'new' && a.active).length;
  const go = useCallback((next: 'ortung' | 'befund' | 'raum') => setTab(next), []);
  // Stable as long as fixes, recordings and the selection stay; the memoised DATUM views then
  // skip the renders the shell does for the ledger, the connection and other events.
  const videos = node.app?.videos;
  const datumProps = useMemo<DatumViewProps>(
    () => ({ videos: videos ?? [], can: node.can, fixes: datum.fixes, byId: datum.byId, selected, select: setSelected, go }),
    [videos, node.can, datum.fixes, datum.byId, selected, go],
  );
  const located = datum.fixes.filter((f) => f.status === 'ready').length;
  const locating = datum.fixes.filter((f) => f.status === 'pending' || f.status === 'running').length;

  return (
    <div className="shell">
      {exerciseContext ? (
        <div className="band">
          {t('Übung')} · {t('keine Echtlage')}
          {session.mandate ? ` · ${pick(session.mandate.title, session.mandate.titleEn)}` : ''}
        </div>
      ) : (
        <div />
      )}
      <header className="top">
        <div className="wordmark">
          <b>{MARK}</b>
          <span>{t(node.info?.node.name ?? '')}</span>
        </div>
        <nav className="tabs" aria-label={t('Bereiche')}>
          {tabs.filter((x) => allowed.includes(x.id)).map((x) => (
            <button key={x.id} type="button" className={tab === x.id ? 'tab tab-on' : 'tab'} onClick={() => setTab(x.id)}>
              {t(x.label)}
              {x.id === 'ortung' && locating > 0 && <span className="tab-n">{locating}</span>}
              {x.id === 'lage' && newAlerts > 0 && <span className="tab-n">{newAlerts}</span>}
            </button>
          ))}
        </nav>
        <div className="top-right">
          {node.can('mandate.read') && (
            <button type="button" className="text-btn who" onClick={() => setMandateDialog(true)} title={session.mandate ? pick(session.mandate.purpose, session.mandate.purposeEn) : ''}>
              {t('Mandat')}: <b>{session.mandate ? pick(session.mandate.title, session.mandate.titleEn) : t('keines')}</b>
            </button>
          )}
          <span className="who">
            <b>{t(session.user.name)}</b> · {t(ROLE_LABEL[session.user.role])}
          </span>
          <LangSwitch />
          <button type="button" className="text-btn" onClick={() => void node.signOut()}>
            {t('Abmelden')}
          </button>
        </div>
      </header>

      <main className="view">
        {/* ORTUNG stays mounted while another tab is open: going back shows the map and the list as
            they were, without building them again. */}
        {allowed.includes('ortung') && (
          <Activity mode={tab === 'ortung' ? 'visible' : 'hidden'}>
            <Ortung {...datumProps} />
          </Activity>
        )}
        <Suspense fallback={<ViewLoading />}>
          {tab === 'befund' && <Befund {...datumProps} />}
          {tab === 'raum' && <Raum {...datumProps} />}
          {tab === 'suche' && <Suche {...props} />}
          {tab === 'quellen' && <Quellen {...props} />}
          {tab === 'messung' && <Messung {...datumProps} />}
          {tab === 'protokoll' && <Protokoll {...props} />}
          {tab === 'lage' && <Lage {...props} />}
          {tab === 'wachen' && <Wachen {...props} />}
          {tab === 'vorgaenge' && <Vorgaenge {...props} />}
          {tab === 'verbund' && <Verbund {...props} />}
          {tab === 'wirkung' && <Wirkung {...props} />}
        </Suspense>
      </main>

      <footer className="foot">
        <span>
          {t('Protokoll')} <b>#{node.ledger?.length ?? '–'}</b> <b className="hash">{shortHash(node.ledger?.head)}</b>
        </span>
        <span>
          {t('Modell')}{' '}
          <b>
            {model ? (model.phase === 'ready' ? `${model.modelId.split('/').pop() ?? ''} · ${model.device}` : model.message) : '–'}
          </b>
        </span>
        <span>
          {t('Verzeichnis')} <b>{node.app ? `${formatCount(node.app.stats.frames)} ${t('Bilder')}` : '–'}</b>
        </span>
        {!isSicht(node) && (
          <span>
            {t('Ortung')} <b>{located}/{datum.fixes.length}</b>
            {locating > 0 && <b> · {t('offen')} {locating}</b>}
          </span>
        )}
        {scenario && exerciseRunning && (
          <span>
            {t('Übungsuhr')} <b>{formatExercise(scenario.elapsedSec)}</b> <b>{scenario.speed}×</b>
          </span>
        )}
        <span className="right">
          {node.connected ? t('verbunden') : t('getrennt')} · v{node.info?.node.version ?? ''}
        </span>
      </footer>

      {model && model.phase === 'loading' && (
        <div className="boot">
          <span style={{ width: `${Math.round(model.progress * 100)}%` }} />
        </div>
      )}

      {current && sheet && (
        <Suspense fallback={null}>
        <FrameSheet
          target={current}
          node={node}
          onClose={() => setSheet(null)}
          onPrev={sheet.index > 0 ? () => setSheet({ list: sheet.list, index: sheet.index - 1 }) : null}
          onNext={sheet.index < sheet.list.length - 1 ? () => setSheet({ list: sheet.list, index: sheet.index + 1 }) : null}
        />
        </Suspense>
      )}
      {mandateDialog && (
        <Dialog title={t('Mandat wählen')} onClose={() => setMandateDialog(false)}>
          <MandateList node={node} onChosen={() => setMandateDialog(false)} />
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => setMandateDialog(false)}>
              {t('Schließen')}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
