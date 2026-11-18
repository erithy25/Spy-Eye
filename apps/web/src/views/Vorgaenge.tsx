import { useEffect, useState } from 'react';
import { addCaseNote, createCase, fetchCases, removeCaseItem, sealCase, type CaseFile } from '../api';
import type { ViewProps } from '../App';
import { formatClock, formatDateTime, shortHash } from '../format';
import { useLang } from '../i18n';
import { Field, Frame, useAction, useLoad } from '../ui';

export function Vorgaenge({ node, openFrame }: ViewProps) {
  const { t, locale } = useLang();
  const cases = useLoad(() => fetchCases(), []);
  const [selected, setSelected] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const action = useAction();
  const may = node.can('case.write');
  const list = cases.data ?? [];
  const current = list.find((c) => c.id === selected) ?? null;

  useEffect(() => {
    if (selected === null && list.length > 0) setSelected((list[0] as CaseFile).id);
  }, [selected, list]);

  const replace = (file: CaseFile): void => {
    cases.set(list.map((c) => (c.id === file.id ? file : c)));
  };

  const create = (): void => {
    void action.run(async () => {
      const file = await createCase(title.trim());
      setTitle('');
      cases.set([file, ...list]);
      setSelected(file.id);
    });
  };

  const targets = (current?.items ?? []).map((item) => ({
    videoId: item.videoId,
    frameNumber: item.frameNumber,
    frameUrl: item.frameUrl,
    time: null,
    sceneIndex: null,
    at: item.at,
    sourceName: item.sourceName,
    lat: null,
    lon: null,
    query: item.query,
    confidence: null,
    score: null,
    box: item.box,
    alert: null,
  }));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">
            <small>{t('Durchsicht')}</small>
            {t('Vorgänge')}
          </h1>
          <p className="lede">
            {t(
              'Ein Vorgang hält fest, welche Bilder eine Entscheidung getragen haben. Jedes Beweisstück trägt die Prüfsumme des unmaskierten Bildes; ein versiegelter Vorgang ist unveränderlich und sein Siegel steht im Protokoll. Aufnahmen in einem Vorgang sind von der Löschfrist ausgenommen.',
            )}
          </p>
        </div>
      </header>

      <div className="cols cols-side">
        <div className="section-gap" style={{ gap: 20 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('Vorgang')}</th>
                <th style={{ width: 40 }} className="num">
                  {t('Bilder')}
                </th>
                <th style={{ width: 76 }}>{t('Stand')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className={`clickable${selected === c.id ? ' sel' : ''}`} onClick={() => setSelected(c.id)}>
                  <td title={c.title}>{c.title}</td>
                  <td className="num dim">{c.items.length}</td>
                  <td className="dim">{c.sealedAt !== null ? t('versiegelt') : t('offen')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {cases.error && <p className="note">{cases.error}</p>}
          {list.length === 0 && !cases.error && <p className="empty">{t('Noch kein Vorgang. Bilder werden aus der Suche oder aus einer Meldung heraus gesichert.')}</p>}
          {may && (
            <div className="form">
              <Field label={t('Neuer Vorgang')}>
                <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} placeholder={t('z. B. Hangrutsch Güls, Sperrung der Zufahrt')} />
              </Field>
              <div className="btn-row">
                <button type="button" className="btn" disabled={action.busy || title.trim().length < 3 || node.session?.mandate === null} onClick={create}>
                  {t('Anlegen')}
                </button>
                {node.session?.mandate === null && <span className="low">{t('Kein Mandat gewählt.')}</span>}
              </div>
            </div>
          )}
          {action.error && <p className="note">{action.error}</p>}
        </div>

        <div>
          {current ? (
            <div className="section-gap" style={{ gap: 26 }}>
              <header className="panel-head">
                <h2 className="label">
                  <span className="count">{current.title}</span>
                </h2>
                <span className="panel-tools">
                  <a className="btn" href={`api/cases/${current.id}/report`} target="_blank" rel="noreferrer">
                    {t('Bericht')}
                  </a>
                  {may && current.sealedAt === null && (
                    <button
                      type="button"
                      className="btn btn-solid"
                      disabled={action.busy || current.items.length === 0}
                      onClick={() => {
                        if (!window.confirm(t('Vorgang versiegeln? Danach sind keine Änderungen mehr möglich.'))) return;
                        void action.run(async () => replace(await sealCase(current.id)));
                      }}
                    >
                      {t('Versiegeln')}
                    </button>
                  )}
                </span>
              </header>

              <dl className="kv">
                <div>
                  <dt>{t('Angelegt')}</dt>
                  <dd>
                    {formatDateTime(current.createdAt, locale)} · {current.createdBy}
                  </dd>
                </div>
                <div>
                  <dt>{t('Mandat')}</dt>
                  <dd>{current.mandateId}</dd>
                </div>
                {current.sealedAt !== null && (
                  <>
                    <div>
                      <dt>{t('Versiegelt')}</dt>
                      <dd>
                        {formatDateTime(current.sealedAt, locale)} · {current.sealedBy}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('Siegel')}</dt>
                      <dd className="hash" title={current.sealHash ?? ''}>
                        {shortHash(current.sealHash, 32)}…
                      </dd>
                    </div>
                  </>
                )}
              </dl>

              <section className="section-gap">
                <header className="panel-head">
                  <h3 className="label">
                    {t('Beweisstücke')} <span className="count">{current.items.length}</span>
                  </h3>
                </header>
                {current.items.length === 0 && <p className="empty">{t('Keine Bilder gesichert.')}</p>}
                <div className="thumbs" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                  {current.items.map((item, i) => (
                    <div key={item.id}>
                      <Frame src={item.frameUrl} box={item.box} onClick={() => openFrame(targets[i] as (typeof targets)[number], targets)} />
                      <div className="thumb-line">
                        <span title={item.sourceName}>{item.sourceName}</span>
                        <span>{formatClock(item.at, locale)}</span>
                      </div>
                      <div className="thumb-line low">
                        <span className="hash" title={item.sha256}>
                          sha256 {shortHash(item.sha256, 16)}…
                        </span>
                        {may && current.sealedAt === null && (
                          <button
                            type="button"
                            className="text-btn"
                            onClick={() => void action.run(async () => replace(await removeCaseItem(current.id, item.id)))}
                          >
                            {t('entfernen')}
                          </button>
                        )}
                      </div>
                      {item.note !== '' && <div className="alert-line" style={{ whiteSpace: 'normal', marginTop: 4 }}>{item.note}</div>}
                      {item.query && <div className="alert-line low">{t('gefunden mit')}: {item.query}</div>}
                    </div>
                  ))}
                </div>
              </section>

              <section className="section-gap">
                <header className="panel-head">
                  <h3 className="label">
                    {t('Vermerke')} <span className="count">{current.notes.length}</span>
                  </h3>
                </header>
                {current.notes.map((n) => (
                  <div key={n.id}>
                    <div className="low">
                      {formatDateTime(n.at, locale)} · {n.by}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{n.text}</div>
                  </div>
                ))}
                {may && current.sealedAt === null && (
                  <div className="form">
                    <Field label={t('Vermerk hinzufügen')}>
                      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} />
                    </Field>
                    <div className="btn-row">
                      <button
                        type="button"
                        className="btn"
                        disabled={action.busy || note.trim() === ''}
                        onClick={() =>
                          void action.run(async () => {
                            replace(await addCaseNote(current.id, note.trim()));
                            setNote('');
                          })
                        }
                      >
                        {t('Vermerken')}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </div>
          ) : (
            <p className="empty">{t('Vorgang wählen.')}</p>
          )}
        </div>
      </div>
    </div>
  );
}
