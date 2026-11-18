import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { createMandate, errorText, fetchMandates, selectMandate, type Mandate, type Role } from './api';
import { FrameSheet, type FrameTarget } from './components/FrameSheet';
import { formatCount, formatExercise, shortHash } from './format';
import { LangProvider, useLang } from './i18n';
import { MapCanvas, type MapMarker } from './map/MapCanvas';
import { Dialog, Field, useAction } from './ui';
import { useNode, type NodeConnection } from './useNode';
import { Lage } from './views/Lage';
import { Protokoll } from './views/Protokoll';
import { Quellen } from './views/Quellen';
import { Suche } from './views/Suche';
import { Verbund } from './views/Verbund';
import { Vorgaenge } from './views/Vorgaenge';
import { Wachen } from './views/Wachen';
import { Wirkung } from './views/Wirkung';

type TabId = 'lage' | 'suche' | 'wachen' | 'vorgaenge' | 'verbund' | 'protokoll' | 'quellen' | 'wirkung';

const TABS: { id: TabId; label: string; permission: string | null }[] = [
  { id: 'lage', label: 'Lage', permission: 'media' },
  { id: 'suche', label: 'Suche', permission: 'search' },
  { id: 'wachen', label: 'Wachen', permission: 'watch.read' },
  { id: 'vorgaenge', label: 'Vorgänge', permission: 'case.read' },
  { id: 'verbund', label: 'Verbund', permission: 'federation.read' },
  { id: 'protokoll', label: 'Protokoll', permission: null },
  { id: 'quellen', label: 'Quellen', permission: 'source.read' },
  { id: 'wirkung', label: 'Wirkung', permission: 'metrics.read' },
];

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
  const [skipMandate, setSkipMandate] = useState(false);

  if (node.phase === 'loading' || node.phase === 'unreachable') {
    return (
      <div className="gate">
        <div className="gate-map" />
        <div className="gate-side">
          <div>
            <div className="gate-mark">SICHT</div>
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
    () => (info ? [{ id: info.id, lat: info.lat, lon: info.lon, shape: 'node', label: info.name, sub: info.operator }] : []),
    [info],
  );
  if (!info) return <div className="gate-map" />;
  return (
    <div className="gate-map">
      <MapCanvas view={{ lat: info.lat, lon: info.lon, zoom: 11.4 }} viewKey={info.id} markers={markers} readouts={false} />
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
          <div className="gate-mark">SICHT</div>
          <p className="gate-claim">{t('Keine Sicht ohne Aufsicht.')}</p>
        </div>
        {info && (
          <div className="gate-node">
            <div className="strong">{info.node.name}</div>
            <div className="dim">{info.node.operator}</div>
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
                    onClick={() => {
                      setUser(u.id);
                      setPassword(info.demo?.passwordHint ?? '');
                    }}
                  >
                    <td className="strong" style={{ width: 92 }}>
                      {u.id}
                    </td>
                    <td>{t(ROLE_LABEL[u.role])}</td>
                    <td className="dim">{u.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">
              {t('Passwort für alle Vorführzugänge')}: <span className="strong">{info.demo.passwordHint}</span>.{' '}
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
          <div className="alert-line">{m.legalBasis}</div>
          <div className="alert-line" style={{ whiteSpace: 'normal' }}>
            {m.purpose}
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
          <div className="gate-mark">SICHT</div>
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
  const fromHash = window.location.hash.replace('#', '') as TabId;
  return allowed.includes(fromHash) ? fromHash : (allowed[0] ?? 'protokoll');
}

function Shell({ node }: { node: NodeConnection }) {
  const { t, pick } = useLang();
  const session = node.session;
  const allowed = useMemo(() => TABS.filter((tab) => tab.permission === null || node.can(tab.permission)).map((tab) => tab.id), [node]);
  const [tab, setTab] = useState<TabId>(() => initialTab(allowed));
  const [sheet, setSheet] = useState<{ list: FrameTarget[]; index: number } | null>(null);
  const [mandateDialog, setMandateDialog] = useState(false);

  useEffect(() => {
    if (!allowed.includes(tab)) setTab(allowed[0] ?? 'protokoll');
  }, [allowed, tab]);

  useEffect(() => {
    window.history.replaceState(null, '', `#${tab}`);
  }, [tab]);

  const openFrame = useCallback((target: FrameTarget, list?: FrameTarget[]) => {
    const all = list && list.length > 0 ? list : [target];
    const index = Math.max(0, all.findIndex((x) => x.videoId === target.videoId && x.frameNumber === target.frameNumber));
    setSheet({ list: all, index });
  }, []);

  if (!session) return null;
  const scenario = node.intel?.scenario ?? null;
  const exerciseRunning = scenario !== null && (scenario.status === 'running' || scenario.status === 'paused' || scenario.status === 'finished');
  const exerciseContext = session.mandate?.exercise === true || exerciseRunning;
  const newAlerts = (node.intel?.alerts ?? []).filter((a) => a.status === 'new' && a.active).length;
  const model = node.app?.model ?? null;
  const current = sheet ? (sheet.list[sheet.index] ?? null) : null;
  const props: ViewProps = { node, openFrame };

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
          <b>SICHT</b>
          <span>{node.info?.node.name ?? ''}</span>
        </div>
        <nav className="tabs" aria-label={t('Bereiche')}>
          {TABS.filter((x) => allowed.includes(x.id)).map((x) => (
            <button key={x.id} type="button" className={tab === x.id ? 'tab tab-on' : 'tab'} onClick={() => setTab(x.id)}>
              {t(x.label)}
              {x.id === 'lage' && newAlerts > 0 && <span className="tab-n">{newAlerts}</span>}
            </button>
          ))}
        </nav>
        <div className="top-right">
          {node.can('mandate.read') && (
            <button type="button" className="text-btn who" onClick={() => setMandateDialog(true)} title={session.mandate?.purpose ?? ''}>
              {t('Mandat')}: <b>{session.mandate ? pick(session.mandate.title, session.mandate.titleEn) : t('keines')}</b>
            </button>
          )}
          <span className="who">
            <b>{session.user.name}</b> · {t(ROLE_LABEL[session.user.role])}
          </span>
          <LangSwitch />
          <button type="button" className="text-btn" onClick={() => void node.signOut()}>
            {t('Abmelden')}
          </button>
        </div>
      </header>

      <main className="view">
        {tab === 'lage' && <Lage {...props} />}
        {tab === 'suche' && <Suche {...props} />}
        {tab === 'wachen' && <Wachen {...props} />}
        {tab === 'vorgaenge' && <Vorgaenge {...props} />}
        {tab === 'verbund' && <Verbund {...props} />}
        {tab === 'protokoll' && <Protokoll {...props} />}
        {tab === 'quellen' && <Quellen {...props} />}
        {tab === 'wirkung' && <Wirkung {...props} />}
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
        <FrameSheet
          target={current}
          node={node}
          onClose={() => setSheet(null)}
          onPrev={sheet.index > 0 ? () => setSheet({ list: sheet.list, index: sheet.index - 1 }) : null}
          onNext={sheet.index < sheet.list.length - 1 ? () => setSheet({ list: sheet.list, index: sheet.index + 1 }) : null}
        />
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
