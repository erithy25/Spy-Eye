import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { errorText, type NormRect, type Severity, type SourceKind } from './api';
import { useLang } from './i18n';

/** Three bars; how many are lit is the severity. Weight instead of colour. */
export function Sev({ level }: { level: Severity }) {
  const { t } = useLang();
  const names = ['', t('Hinweis'), t('Erheblich'), t('Kritisch')];
  return (
    <span className={`sev sev-${level}`} title={names[level]} aria-label={names[level]}>
      <i />
      <i />
      <i />
    </span>
  );
}

export const KIND_LABEL: Record<SourceKind, string> = {
  drone: 'Drohne',
  helicopter: 'Hubschrauber',
  fixed: 'Festkamera',
  vehicle: 'Fahrzeug',
  bodycam: 'Handkamera',
  citizen: 'Bürgerhinweis',
  satellite: 'Satellit',
  upload: 'Eingang',
};

/** The same shapes the map uses for sources. */
export function Glyph({ kind }: { kind: SourceKind | 'node' }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.2 };
  let shape: ReactNode;
  switch (kind) {
    case 'drone':
      shape = <path d="M6 1 11 6 6 11 1 6Z" {...common} />;
      break;
    case 'helicopter':
      shape = <path d="M6 1.5 10.5 6 6 10.5 1.5 6ZM0 6H12" {...common} />;
      break;
    case 'fixed':
    case 'upload':
      shape = <rect x="2" y="2" width="8" height="8" {...common} />;
      break;
    case 'vehicle':
      shape = <rect x="1" y="3" width="10" height="6" {...common} />;
      break;
    case 'bodycam':
      shape = <circle cx="6" cy="6" r="4.2" {...common} />;
      break;
    case 'citizen':
      shape = <path d="M6 1.5 11 10.5H1Z" {...common} />;
      break;
    case 'satellite':
      shape = <path d="M11 6 8.5 10.3H3.5L1 6 3.5 1.7H8.5Z" {...common} />;
      break;
    case 'node':
      shape = <path d="M1 1H11V11H1ZM4.5 4.5H7.5V7.5H4.5Z" {...common} />;
      break;
  }
  return (
    <svg className="glyph" viewBox="0 0 12 12" aria-hidden="true">
      {shape}
    </svg>
  );
}

interface FrameProps {
  src: string | null;
  alt?: string;
  box?: NormRect | null;
  boxLabel?: string;
  onClick?: () => void;
  empty?: string;
  children?: ReactNode;
}

/** A still with corner marks; optionally the matched region. */
export function Frame({ src, alt = '', box, boxLabel, onClick, empty, children }: FrameProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const body =
    src && !failed ? (
      <>
        <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
        {box && (
          <span
            className="reticle"
            style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}
          >
            {boxLabel && <span className="reticle-label">{boxLabel}</span>}
          </span>
        )}
        {children}
      </>
    ) : (
      <span>{empty ?? '—'}</span>
    );
  const cls = src && !failed ? 'frame' : 'frame frame-empty';
  return onClick ? (
    <button type="button" className={cls} onClick={onClick}>
      {body}
    </button>
  ) : (
    <span className={cls}>{body}</span>
  );
}

/** Runs an action with a busy flag and a visible error; refuses to start twice. */
export function useAction(): {
  busy: boolean;
  error: string | null;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
  clear: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (err: unknown) {
      if (alive.current) setError(errorText(err));
      return false;
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }, []);
  return { busy, error, run, clear: useCallback(() => setError(null), []) };
}

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function Dialog({ title, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  // The parent re-renders with every event from the node; the handler must not re-run the effect,
  // or the focus would jump back to the first field while someone is typing.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close.current();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="overlay overlay-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  children: ReactNode;
  hint?: string;
}

export function Field({ label, children, hint }: FieldProps) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <em className="hint">{hint}</em>}
    </label>
  );
}

/** Loads something when the component mounts and whenever `deps` change. */
export function useLoad<T>(load: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]): {
  data: T | null;
  error: string | null;
  reload: () => void;
  set: (value: T) => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setData(value);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(errorText(err));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: useCallback(() => setTick((v) => v + 1), []), set: setData };
}
