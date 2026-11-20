import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { deleteVideo, errorText, type VideoInfo } from '../../api';
import { formatPercent } from '../../format';
import { useLang } from '../../i18n';
import { uploads, useUploads, type UploadItem } from '../../uploads';
import { rel, renameDataset, type Fix } from '../api';
import { datasets, type DatasetGroup } from '../datasets';
import { caseLabel, countryText, placeText, radiusHint, radiusText, stageOf } from '../labels';
import { placesText, wholeFilePlace } from '../segments';
import { bestWindowText, kmText, rivalText } from '../useFixes';

/**
 * The picture of a recording: its middle keyframe, chosen as the node chooses the one keyframe of
 * a slim list entry (floor(n / 2)), so that a row keeps its picture when a full summary from the
 * event stream replaces the slim entry.
 */
export function middleFrame(fix: Fix | null): string | null {
  if (!fix || fix.keyframes.length === 0) return null;
  return rel(fix.keyframes[Math.floor(fix.keyframes.length / 2)]!.imageUrl);
}

type T = (de: string, vars?: Record<string, string | number>) => string;

/** What a recording is waiting for, or how its analysis went, in one short line. */
export function progressText(fix: Fix | null, video: VideoInfo, t: T): string {
  if (fix?.status === 'error') return t('Fehler bei der Ortung');
  if (video.status === 'error') return t('Fehler bei der Auswertung');
  if (fix?.status === 'running') {
    const step = fix.trace?.[fix.trace.length - 1];
    return step ? `${t('wird geortet …')} ${t(step.label)}` : t('wird geortet …');
  }
  if (fix?.status === 'ready') return t('Kein Ort bestimmbar');
  if (video.status === 'processing') return `${t('Bilder werden ausgewertet …')} ${formatPercent(video.progress)}`;
  return t('Ortung steht an');
}

interface RowProps {
  video: VideoInfo;
  fix: Fix | null;
  selected: boolean;
  select: (videoId: string | null) => void;
  mayDelete: boolean;
}

/**
 * One recording in the list: picture, case name, place and clock; the radius small below. A
 * recording is deleted from its row (× on hover, focus or selection, or the Delete key), after an
 * inline question. Memoised: while recordings are analysed and located, only the rows whose
 * recording or fix changed render again, not the whole list.
 */
const FixRow = memo(function FixRow({ video, fix, selected, select, mayDelete }: RowProps) {
  const lang = useLang();
  const { t, locale } = lang;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A fix being computed again keeps its place on show, waiting ('pending') or running; a
  // recording that waits for its first fix has none.
  const loc = fix?.status === 'ready' || fix?.status === 'running' || fix?.status === 'pending' ? (fix.location ?? null) : null;
  const win = fix && loc ? bestWindowText(fix) : null;
  const quick = fix !== null && loc !== null && stageOf(fix) === 'quick';
  const image = middleFrame(fix);
  const country = loc ? countryText(lang, loc) : '';
  const place = loc ? placeText(lang, loc, fix) : '';
  // A recording of several places says how many (its place is that of the longest stretch); one of
  // one recognised place, how many stretches stay undetermined, in the timeline's short words
  // (the row has room for no more; the title has them in full). Where the fix shows none of its
  // stretches, its place is the whole file's: said after the radius, so that "1 erkannter Ort"
  // is not read as that place.
  const places = placesText(fix, t, true);
  const whole = wholeFilePlace(fix);

  const remove = (event: ReactMouseEvent): void => {
    event.stopPropagation();
    setBusy(true);
    setError(null);
    deleteVideo(video.id)
      .then(() => {
        // The row goes when the node announces the removal; the selection goes with it.
        if (selected) select(null);
      })
      .catch((err: unknown) => {
        setError(errorText(err));
        setConfirming(false);
        setBusy(false);
      });
  };
  const ask = (event: ReactMouseEvent): void => {
    event.stopPropagation();
    setError(null);
    setConfirming(true);
  };
  const cancel = (event: ReactMouseEvent): void => {
    event.stopPropagation();
    setConfirming(false);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(selected ? null : video.id);
    } else if (event.key === 'Delete' && mayDelete) {
      event.preventDefault();
      setError(null);
      setConfirming(true);
    } else if (event.key === 'Escape' && confirming) {
      setConfirming(false);
    }
  };

  let sub: ReactNode = null;
  if (confirming) {
    sub = (
      <div className="dt-row-sub dt-row-ask" onClick={(e) => e.stopPropagation()}>
        <span>{busy ? t('wird gelöscht …') : t('Aufnahme löschen?')}</span>
        {!busy && (
          <>
            <button type="button" className="text-btn dt-row-yes" onClick={remove}>
              {t('Löschen')}
            </button>
            <button type="button" className="text-btn" onClick={cancel}>
              {t('Abbrechen')}
            </button>
          </>
        )}
      </div>
    );
  } else if (loc) {
    // The parts break between them rather than be cut: the deviation from a ground truth comes
    // before the count of places, so that it stays on the first line.
    // Morning and afternoon as likely (rivalWindow): the other window beside the clock's.
    const rival = fix ? rivalText(fix.time) : null;
    const parts = [
      radiusText(lang, loc),
      rival ? t('oder {range}', { range: rival }) : '',
      whole ? t('aus der ganzen Datei') : '',
      fix?.truth?.errorKm != null ? `${t('Abweichung')} ${kmText(fix.truth.errorKm, locale)}` : '',
      places,
      fix?.status === 'running' ? t('wird neu geortet …') : '',
      fix?.status === 'pending' ? t('Neuortung steht an') : '',
      quick && fix?.status === 'ready' ? t('vorläufig') : '',
    ].filter((x) => x !== '');
    const title = [radiusHint(lang, loc), whole ? t('aus der ganzen Datei') : '', placesText(fix, t)].filter((x) => x !== '').join(' · ');
    sub = (
      <div className="dt-row-sub dt-row-parts" title={title}>
        {/* The dot stays with the part before it; the line may break at the space after it. */}
        {parts.map((part, i) => (
          <Fragment key={i}>
            <span>{i < parts.length - 1 ? `${part}\u00a0·` : part}</span>
            {i < parts.length - 1 ? ' ' : ''}
          </Fragment>
        ))}
      </div>
    );
  }

  return (
    <li
      className={selected ? 'dt-row on' : 'dt-row'}
      tabIndex={0}
      onClick={() => select(selected ? null : video.id)}
      onKeyDown={onKeyDown}
      {...(selected ? { 'aria-current': 'true' as const } : {})}
    >
      {image ? <img className="dt-row-img" src={image} alt="" loading="lazy" decoding="async" /> : <span className="dt-row-img" />}
      <div className="dt-row-text">
        <div className="dt-row-top">
          <b className="dt-row-name">{caseLabel(video.name)}</b>
          <span className="dt-clock">{win ?? (loc ? '––:––' : '')}</span>
        </div>
        <div className="dt-row-mid">
          {loc ? (
            <span className="dt-place">
              {place}
              {country !== '' && country !== place ? <span className="low"> · {country}</span> : null}
            </span>
          ) : (
            <span className="dt-place low">{progressText(fix, video, t)}</span>
          )}
        </div>
        {sub}
        {error && <p className="note">{error}</p>}
      </div>
      {mayDelete && !confirming && (
        <button type="button" className="row-x" aria-label={t('Aufnahme {name} löschen', { name: caseLabel(video.name) })} title={t('Löschen')} onClick={ask}>
          ×
        </button>
      )}
    </li>
  );
});

/** The progress of the uploads into one dataset, in one line, and the uploads that failed. */
function UploadLine({ items, byId }: { items: UploadItem[]; byId: Map<string, Fix> }) {
  const { t } = useLang();
  const active = items.filter((u) => u.status === 'waiting' || u.status === 'uploading');
  const failed = items.filter((u) => u.status === 'failed');
  const batch = items.filter((u) => u.status !== 'failed');
  const done = batch.filter((u) => u.status === 'done').length;
  const located = batch.filter((u) => u.videoId && byId.get(u.videoId)?.location).length;
  const sent = batch.reduce((sum, u) => sum + (u.status === 'done' ? 1 : u.status === 'uploading' ? u.progress : 0), 0);
  return (
    <>
      {active.length > 0 && (
        <div className="dt-upload-line" role="status">
          <span>
            {t('{done} von {n} hochgeladen', { done, n: batch.length })}
            {located > 0 && ` · ${located} ${t('geortet')}`}
          </span>
          <div className="bar">
            <span style={{ width: `${Math.round((sent / Math.max(1, batch.length)) * 100)}%` }} />
          </div>
        </div>
      )}
      {failed.map((u) => (
        <div key={u.key} className="dt-upload-failed">
          <span title={u.error ? t(u.error) : ''}>
            {u.name} — {t('Fehler')}
          </span>
          <button type="button" className="row-x" aria-label={t('Hinweis entfernen')} onClick={() => uploads.dismiss(u.key)}>
            ×
          </button>
        </div>
      ))}
    </>
  );
}

export interface GroupActions {
  addVideos: (group: DatasetGroup) => void;
  addFolder: (group: DatasetGroup) => void;
  addTruth: () => void;
  remove: (group: DatasetGroup) => void;
}

/** The small menu of a dataset: upload into it, rename, delete. */
function GroupMenu({ group, actions, rename, mayManage }: { group: DatasetGroup; actions: GroupActions; rename: () => void; mayManage: boolean }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent): void => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        // The arrow keys walk the items, round the end.
        const items = [...(box.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
        if (items.length === 0) return;
        event.preventDefault();
        const at = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    box.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const item = (label: string, run: () => void, cls = '') => (
    <button
      type="button"
      role="menuitem"
      className={cls ? `dt-menu-item ${cls}` : 'dt-menu-item'}
      onClick={() => {
        setOpen(false);
        run();
      }}
    >
      {label}
    </button>
  );
  const uploadable = group.own;
  if (!uploadable && !mayManage) return null;
  return (
    <div className="dt-menu-box" ref={box}>
      <button
        ref={button}
        type="button"
        className="text-btn dt-group-more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('Aktionen für {name}', { name: group.name })}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div className="dt-menu" role="menu" aria-label={group.name}>
          {uploadable && item(t('Videos hinzufügen'), () => actions.addVideos(group))}
          {uploadable && item(t('Ordner hinzufügen'), () => actions.addFolder(group))}
          {uploadable && item(t('Grundwahrheit hinzufügen …'), actions.addTruth)}
          {mayManage && item(t('Umbenennen'), rename)}
          {mayManage && <hr className="dt-menu-sep" />}
          {mayManage && item(t('Löschen …'), () => actions.remove(group), 'dt-menu-danger')}
        </div>
      )}
    </div>
  );
}

interface GroupProps {
  group: DatasetGroup;
  collapsed: boolean;
  toggle: (id: string) => void;
  byId: Map<string, Fix>;
  selected: string | null;
  select: (videoId: string | null) => void;
  mayWrite: boolean;
  /** The node lists datasets (create, rename, delete). */
  managed: boolean;
  actions: GroupActions;
  items: UploadItem[];
  dropping: boolean;
}

const Group = memo(function Group({ group, collapsed, toggle, byId, selected, select, mayWrite, managed, actions, items, dropping }: GroupProps) {
  const { t } = useLang();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = group.videos.length;
  const mayManage = mayWrite && managed && group.managed;

  const startRename = (): void => {
    setDraft(group.name);
    setError(null);
    setRenaming(true);
  };
  const save = (): void => {
    const name = draft.trim().replace(/\s+/g, ' ');
    if (name === group.name) {
      setRenaming(false);
      return;
    }
    if (name.length < 2 || name.length > 80) {
      setError(t('Der Name hat 2 bis 80 Zeichen.'));
      return;
    }
    setBusy(true);
    renameDataset(group.id, name)
      .then((info) => {
        datasets.put(info);
        setRenaming(false);
        setError(null);
      })
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };

  const classes = ['dt-ds'];
  if (dropping) classes.push('dt-ds-drop');
  return (
    <section className={classes.join(' ')} {...(mayWrite && group.own ? { 'data-drop-group': group.id } : {})} aria-label={group.name}>
      <div className="dt-group">
        {renaming ? (
          <input
            className="dt-group-input"
            value={draft}
            autoFocus
            disabled={busy}
            maxLength={80}
            aria-label={t('Name des Datensatzes')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                save();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setRenaming(false);
                setError(null);
              }
            }}
            onBlur={() => {
              if (!busy && draft.trim() === group.name) setRenaming(false);
            }}
          />
        ) : (
          <button type="button" className="dt-group-toggle" aria-expanded={!collapsed} onClick={() => toggle(group.id)}>
            <span className="dt-group-sign" aria-hidden="true" />
            <span className="dt-group-name">{group.name}</span>
            <span className="count">{n}</span>
            {n > 0 && group.located < n && <span className="count-of">· {t('{located}/{n} geortet', { located: group.located, n })}</span>}
          </button>
        )}
        {mayWrite && !renaming && <GroupMenu group={group} actions={actions} rename={startRename} mayManage={mayManage} />}
      </div>
      {error && <p className="note dt-group-note">{error}</p>}
      <UploadLine items={items} byId={byId} />
      {!collapsed && n > 0 && (
        <ul className="dt-rows">
          {group.videos.map((v) => (
            <FixRow key={v.id} video={v} fix={byId.get(v.id) ?? null} selected={v.id === selected} select={select} mayDelete={mayWrite} />
          ))}
        </ul>
      )}
    </section>
  );
});

const COLLAPSED_KEY = 'datum.collapsed';

function readCollapsed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export interface OrtungListProps {
  groups: DatasetGroup[];
  byId: Map<string, Fix>;
  selected: string | null;
  select: (videoId: string | null) => void;
  mayWrite: boolean;
  managed: boolean;
  actions: GroupActions;
  /** The group a drag hovers over. */
  dropGroup: string | null;
}

/** The recordings by dataset; a group folds away with a click on its head (remembered). */
export function OrtungList({ groups, byId, selected, select, mayWrite, managed, actions, dropGroup }: OrtungListProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  const items = useUploads();

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // Private mode: the state holds for this page only.
      }
      return next;
    });
  }, []);

  // A recording chosen on the map opens its group. Only a new selection does: folding the group of
  // the selection afterwards stays, also when the view is shown again (ORTUNG stays mounted while
  // hidden, and its effects run again when it comes back).
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (selected === handled.current) return;
    handled.current = selected;
    if (!selected) return;
    const home = groups.find((g) => g.videos.some((v) => v.id === selected));
    if (home && collapsed.has(home.id)) toggle(home.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const bySource = useMemo(() => {
    const map = new Map<string, UploadItem[]>();
    for (const u of items) {
      const list = map.get(u.sourceId) ?? [];
      list.push(u);
      map.set(u.sourceId, list);
    }
    return map;
  }, [items]);

  // A finished batch is forgotten; its recordings are rows of the list now.
  useEffect(() => {
    for (const [sourceId, list] of bySource) {
      if (!list.some((u) => u.status === 'waiting' || u.status === 'uploading') && list.some((u) => u.status === 'done')) uploads.forgetDone(sourceId);
    }
  }, [bySource]);

  const none: UploadItem[] = useMemo(() => [], []);
  return (
    <>
      {groups.map((g) => (
        <Group
          key={g.id}
          group={g}
          collapsed={collapsed.has(g.id)}
          toggle={toggle}
          byId={byId}
          selected={selected}
          select={select}
          mayWrite={mayWrite}
          managed={managed}
          actions={actions}
          items={bySource.get(g.id) ?? none}
          dropping={dropGroup === g.id}
        />
      ))}
    </>
  );
}
