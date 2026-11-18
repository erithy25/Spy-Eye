import { useEffect, useMemo, useState } from 'react';
import {
  ApiRequestError,
  SOURCE_KINDS,
  createWatch,
  deleteWatch,
  fetchMetrics,
  fetchWatches,
  previewWatch,
  resetWatch,
  retrainWatch,
  updateWatch,
  type Severity,
  type SourceKind,
  type Watch,
  type WatchPreview,
} from '../api';
import type { ViewProps } from '../App';
import { formatClock, formatScore } from '../format';
import { useLang } from '../i18n';
import { Field, Frame, KIND_LABEL, Sev, useAction, useLoad } from '../ui';
import type { NodeConnection } from '../useNode';
import { alertTarget } from './Lage';

const HAZARD_LABEL: Record<string, string> = { flood: 'Überflutung', fire: 'Brand', collapse: 'Einsturz' };

function Editor({ node, hazardClasses, onCreated }: { node: NodeConnection; hazardClasses: string[]; onCreated: (watch: Watch) => void }) {
  const { t, locale } = useLang();
  const [kind, setKind] = useState<'text' | 'hazard'>('text');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [exclude, setExclude] = useState('');
  const [hazardClass, setHazardClass] = useState(hazardClasses[0] ?? '');
  const [severity, setSeverity] = useState<Severity>(2);
  const [threshold, setThreshold] = useState(0.6);
  const [persistence, setPersistence] = useState(2);
  const [kinds, setKinds] = useState<SourceKind[]>([]);
  const [preview, setPreview] = useState<WatchPreview | null>(null);
  const previewAction = useAction();
  const createAction = useAction();
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    if (hazardClass === '' && hazardClasses[0]) setHazardClass(hazardClasses[0]);
  }, [hazardClasses, hazardClass]);

  const excludeList = exclude
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s !== '');

  const guard = async (action: () => Promise<void>): Promise<void> => {
    setRefusal(null);
    try {
      await action();
    } catch (err: unknown) {
      if (err instanceof ApiRequestError && err.code === 'refused') {
        setRefusal(err.message);
        return;
      }
      throw err;
    }
  };

  const runPreview = (): void => {
    void previewAction.run(() => guard(async () => setPreview(await previewWatch(prompt.trim(), excludeList))));
  };

  const submit = (): void => {
    void createAction.run(() =>
      guard(async () => {
        const watch = await createWatch({
          name: name.trim(),
          kind,
          prompt: kind === 'text' ? prompt.trim() : '',
          exclude: kind === 'text' ? excludeList : [],
          hazardClass: kind === 'hazard' ? hazardClass : null,
          severity,
          threshold: kind === 'hazard' ? Math.max(threshold, 0.8) : threshold,
          persistence,
          cooldownSec: 30,
          sourceKinds: kind === 'hazard' && kinds.length === 0 ? ['drone', 'helicopter', 'satellite'] : kinds,
        });
        onCreated(watch);
      }),
    );
  };

  const hasMandate = node.session?.mandate !== null;

  return (
    <div className="section-gap" style={{ gap: 22 }}>
      <header className="panel-head">
        <h2 className="label">{t('Neue Wache')}</h2>
        <span className="segments">
          <button type="button" className={kind === 'text' ? 'segment segment-on' : 'segment'} onClick={() => setKind('text')}>
            {t('frei formuliert')}
          </button>
          <button
            type="button"
            className={kind === 'hazard' ? 'segment segment-on' : 'segment'}
            disabled={hazardClasses.length === 0}
            onClick={() => setKind('hazard')}
          >
            {t('Gefahrenmodell')}
          </button>
        </span>
      </header>
      {!hasMandate && <p className="note">{t('Kein Mandat gewählt: Wachen können nur unter einem Mandat aufgestellt werden.')}</p>}
      <div className="form">
        <Field label={t('Bezeichnung')}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t('z. B. Wasser auf der Fahrbahn')} />
        </Field>
        {kind === 'text' ? (
          <>
            <Field
              label={t('Was gemeldet werden soll')}
              hint={t('Eine Beschreibung dessen, was im Bild zu sehen ist, auf Deutsch oder Englisch; englische Beschreibungen trennen meist etwas schärfer. Keine Personenmerkmale, keine Namen.')}
            >
              <input value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={200} placeholder="a flooded underpass with a stuck car" spellCheck={false} />
            </Field>
            <Field label={t('Nicht gemeint (eine Zeile je Ausschluss)')} hint={t('Verwechslungen, die besser passen als die Beschreibung, unterdrücken die Meldung.')}>
              <textarea value={exclude} onChange={(e) => setExclude(e.target.value)} rows={2} spellCheck={false} placeholder="a wet road in the rain" />
            </Field>
          </>
        ) : (
          <Field
            label={t('Klasse des Gefahrenmodells')}
            hint={t('Das Modell wurde auf Luftbildern trainiert und wird nur auf ganze Bilder von Luftbildquellen angewandt.')}
          >
            <select value={hazardClass} onChange={(e) => setHazardClass(e.target.value)}>
              {hazardClasses.map((c) => (
                <option key={c} value={c}>
                  {t(HAZARD_LABEL[c] ?? c)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="field-row">
          <Field label={t('Dringlichkeit')}>
            <span className="segments" style={{ paddingTop: 4 }}>
              {([1, 2, 3] as Severity[]).map((s) => (
                <button key={s} type="button" className={severity === s ? 'segment segment-on' : 'segment'} onClick={() => setSeverity(s)}>
                  {[t('Hinweis'), t('Erheblich'), t('Kritisch')][s - 1]}
                </button>
              ))}
            </span>
          </Field>
          <Field label={`${t('Mindestsicherheit')} · ${formatScore(threshold)}`}>
            <input type="range" min={0.3} max={0.95} step={0.05} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
          </Field>
        </div>
        <div className="field-row">
          <Field label={`${t('Aufeinanderfolgende Bilder bis zur Meldung')} · ${persistence}`}>
            <input type="range" min={1} max={6} step={1} value={persistence} onChange={(e) => setPersistence(Number(e.target.value))} />
          </Field>
          <Field label={t('Nur diese Quellenarten (leer = alle)')}>
            <span className="btn-row" style={{ paddingTop: 4, gap: '4px 14px' }}>
              {SOURCE_KINDS.filter((k) => k !== 'upload').map((k) => (
                <label key={k} className="check">
                  <input
                    type="checkbox"
                    checked={kinds.includes(k)}
                    onChange={(e) => setKinds((list) => (e.target.checked ? [...list, k] : list.filter((x) => x !== k)))}
                  />
                  {t(KIND_LABEL[k])}
                </label>
              ))}
            </span>
          </Field>
        </div>
        {refusal && (
          <div className="refusal" role="alert">
            <h3>{t('Wache abgelehnt')}</h3>
            <p>{refusal}</p>
          </div>
        )}
        {previewAction.error && <p className="note">{previewAction.error}</p>}
        {createAction.error && <p className="note">{createAction.error}</p>}
        <div className="btn-row">
          {kind === 'text' && (
            <button type="button" className="btn" disabled={!hasMandate || previewAction.busy || prompt.trim().length < 3} onClick={runPreview}>
              {previewAction.busy ? t('prüfe …') : t('Am Bestand prüfen')}
            </button>
          )}
          <button
            type="button"
            className="btn btn-solid"
            disabled={!hasMandate || createAction.busy || name.trim().length < 2 || (kind === 'text' && prompt.trim().length < 3)}
            onClick={submit}
          >
            {t('Wache aufstellen')}
          </button>
        </div>
      </div>
      {preview && kind === 'text' && (
        <div className="section-gap">
          <p className="dim">
            {t('{n} von {m} Bildern im Bestand hätten gemeldet.', { n: preview.matches, m: preview.framesChecked })}{' '}
            <span className="low">
              {t('Trennwert')} {preview.cutoff.toFixed(3)}
            </span>
          </p>
          {preview.samples.length > 0 && (
            <div className="thumbs">
              {preview.samples.map((s, i) => (
                <div key={i}>
                  <Frame src={s.frameUrl} />
                  <div className="thumb-line">
                    <span title={s.sourceName}>{s.sourceName}</span>
                    <span>{formatScore(s.confidence)}</span>
                  </div>
                  <div className="thumb-line low">
                    <span>{formatClock(s.at, locale)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({ watch, node, openFrame, onChanged, onRemoved }: { watch: Watch; onChanged: (w: Watch) => void; onRemoved: () => void } & ViewProps) {
  const { t, pick, locale } = useLang();
  const action = useAction();
  const may = node.can('watch.write');
  const alerts = useMemo(
    () => (node.intel?.alerts ?? []).filter((a) => a.watchId === watch.id).slice(0, 24),
    [node.intel?.alerts, watch.id],
  );
  const watches = node.intel?.watches ?? [];
  const targets = useMemo(() => alerts.map((a) => alertTarget(a, watches)), [alerts, watches]);

  const patch = (change: Parameters<typeof updateWatch>[1]): void => {
    void action.run(async () => onChanged(await updateWatch(watch.id, change)));
  };

  return (
    <div className="section-gap" style={{ gap: 24 }}>
      <header className="panel-head">
        <h2 className="label">
          <Sev level={watch.severity} /> <span className="count">{pick(watch.name, watch.nameEn)}</span>
        </h2>
        <span className="panel-tools">
          <span className="pill">{watch.kind === 'hazard' ? t('Gefahrenmodell') : t('frei formuliert')}</span>
          <span className="pill">
            {t('Version')} {watch.version}
          </span>
          {may && (
            <>
              <button type="button" className="text-btn" disabled={action.busy} onClick={() => patch({ enabled: !watch.enabled })}>
                {watch.enabled ? t('ruhen lassen') : t('wieder einsetzen')}
              </button>
              <button
                type="button"
                className="text-btn"
                disabled={action.busy}
                onClick={() => {
                  if (!window.confirm(t('Wache „{name}“ abziehen?', { name: watch.name }))) return;
                  void action.run(async () => {
                    await deleteWatch(watch.id);
                    onRemoved();
                  });
                }}
              >
                {t('abziehen')}
              </button>
            </>
          )}
        </span>
      </header>
      {action.error && <p className="note">{action.error}</p>}

      <dl className="kv">
        {watch.kind === 'text' ? (
          <>
            <div>
              <dt>{t('Beschreibung')}</dt>
              <dd>{watch.prompt}</dd>
            </div>
            {watch.exclude.length > 0 && (
              <div>
                <dt>{t('Nicht gemeint')}</dt>
                <dd>{watch.exclude.join(' · ')}</dd>
              </div>
            )}
            <div>
              <dt>{t('Trennwert')}</dt>
              <dd title={t('Aus dem eigenen Bildbestand abgeleitet; passt sich an, wenn Material hinzukommt.')}>{watch.cutoff.toFixed(4)}</dd>
            </div>
          </>
        ) : (
          <div>
            <dt>{t('Klasse')}</dt>
            <dd>{t(HAZARD_LABEL[watch.hazardClass ?? ''] ?? watch.hazardClass ?? '')}</dd>
          </div>
        )}
        <div>
          <dt>{t('Mindestsicherheit')}</dt>
          <dd>{formatScore(watch.threshold)}</dd>
        </div>
        <div>
          <dt>{t('Bilder bis Meldung')}</dt>
          <dd>{watch.persistence}</dd>
        </div>
        <div>
          <dt>{t('Quellenarten')}</dt>
          <dd>{watch.sourceKinds.length === 0 ? t('alle') : watch.sourceKinds.map((k) => t(KIND_LABEL[k])).join(', ')}</dd>
        </div>
        <div>
          <dt>{t('Aufgestellt')}</dt>
          <dd>
            {new Date(watch.createdAt).toLocaleString(locale)} · {watch.createdBy}
          </dd>
        </div>
        <div>
          <dt>{t('Zustand')}</dt>
          <dd>{watch.enabled ? t('im Einsatz') : t('ruht')}</dd>
        </div>
      </dl>

      {watch.kind === 'text' && (
        <section className="section-gap">
          <header className="panel-head">
            <h3 className="label">{t('Nachschärfen')}</h3>
            <span className="low">
              {watch.feedback.confirmed} {t('bestätigt')} · {watch.feedback.dismissed} {t('verworfen')}
            </span>
          </header>
          <p className="dim" style={{ maxWidth: '72ch' }}>
            {t(
              'Urteile über Meldungen werden gesammelt, verändern die Wache aber nicht von selbst. Erst das Nachschärfen trainiert aus ihnen eine neue Version; der Schritt steht im Protokoll und lässt sich zurücknehmen.',
            )}
          </p>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn-solid"
              disabled={!may || action.busy || watch.pendingFeedback === 0}
              onClick={() => void action.run(async () => onChanged(await retrainWatch(watch.id)))}
            >
              {t('Nachschärfen')} · {watch.pendingFeedback} {t('neue Urteile')}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!may || action.busy || !watch.learned}
              onClick={() => void action.run(async () => onChanged(await resetWatch(watch.id)))}
            >
              {t('Gelerntes verwerfen')}
            </button>
            <span className="low">{watch.learned ? t('arbeitet mit gelerntem Zusatz') : t('arbeitet nur mit der Beschreibung')}</span>
          </div>
        </section>
      )}

      <section className="section-gap">
        <header className="panel-head">
          <h3 className="label">
            {t('Meldungen dieser Wache')} <span className="count">{alerts.length}</span>
          </h3>
        </header>
        {alerts.length === 0 ? (
          <p className="empty">{t('Noch keine Meldung.')}</p>
        ) : (
          <div className="thumbs">
            {alerts.map((a, i) => (
              <div key={a.id} style={{ opacity: a.status === 'dismissed' ? 0.4 : 1 }}>
                <Frame src={a.frameUrl} box={a.box} onClick={() => openFrame(targets[i] as (typeof targets)[number], targets)} />
                <div className="thumb-line">
                  <span title={a.sourceName}>{a.sourceName}</span>
                  <span>{formatScore(a.confidence)}</span>
                </div>
                <div className="thumb-line low">
                  <span>{a.status === 'confirmed' ? t('Bestätigt') : a.status === 'dismissed' ? t('Verworfen') : t('Offen')}</span>
                  <span>{formatClock(a.firstSeen, locale)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function Wachen({ node, openFrame }: ViewProps) {
  const { t, pick } = useLang();
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const own = useLoad(() => fetchWatches(), []);
  const metrics = useLoad(() => fetchMetrics(), []);
  // Operators receive live updates through the intel stream; auditors only have the list.
  const watches = node.intel?.watches ?? own.data ?? [];
  const hazardClasses = (metrics.data?.hazardModel?.classes ?? []).filter((c) => c !== 'normal');
  const may = node.can('watch.write');
  const current = selected !== null && selected !== 'new' ? (watches.find((w) => w.id === selected) ?? null) : null;

  useEffect(() => {
    if (selected === null && watches.length > 0) setSelected((watches[0] as Watch).id);
  }, [selected, watches]);

  const changed = (watch: Watch): void => {
    node.patchWatch(watch);
    own.reload();
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">
            <small>{t('Vorsicht')}</small>
            {t('Wachen')}
          </h1>
          <p className="lede">
            {t(
              'Eine Wache ist ein stehender Suchauftrag. Sie sieht jedes eingehende Bild und meldet, wenn es zur Beschreibung passt. Aufgestellt wird sie in Worten, ohne Training; nachgeschärft wird sie aus den Urteilen der Auswertenden.',
            )}
          </p>
        </div>
        {may && (
          <button type="button" className="btn btn-solid" onClick={() => setSelected('new')}>
            {t('Neue Wache')}
          </button>
        )}
      </header>

      <div className="cols cols-side">
        <div>
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('Wache')}</th>
                <th style={{ width: 54 }} className="num">
                  ✓ / ✗
                </th>
                <th style={{ width: 34 }} className="num">
                  V
                </th>
              </tr>
            </thead>
            <tbody>
              {watches.map((w) => (
                <tr key={w.id} className={`clickable${selected === w.id ? ' sel' : ''}`} onClick={() => setSelected(w.id)} style={{ opacity: w.enabled ? 1 : 0.45 }}>
                  <td title={pick(w.name, w.nameEn)}>
                    <Sev level={w.severity} /> {pick(w.name, w.nameEn)}
                  </td>
                  <td className="num dim">
                    {w.feedback.confirmed} / {w.feedback.dismissed}
                  </td>
                  <td className="num dim">{w.version}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {watches.length === 0 && <p className="empty" style={{ marginTop: 12 }}>{t('Keine Wache aufgestellt.')}</p>}
        </div>
        <div>
          {selected === 'new' && may ? (
            <Editor
              node={node}
              hazardClasses={hazardClasses}
              onCreated={(w) => {
                changed(w);
                node.refreshIntel();
                setSelected(w.id);
              }}
            />
          ) : current ? (
            <Detail
              watch={current}
              node={node}
              openFrame={openFrame}
              onChanged={changed}
              onRemoved={() => {
                setSelected(null);
                node.refreshIntel();
                own.reload();
              }}
            />
          ) : (
            <p className="empty">{t('Wache wählen.')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
