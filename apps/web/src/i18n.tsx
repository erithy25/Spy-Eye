import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { EN } from './en';

export type Lang = 'de' | 'en';

interface LangValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Translates a German source string; `{name}` placeholders are filled from `vars`. */
  t: (de: string, vars?: Record<string, string | number>) => string;
  /** Chooses between a German and an English value supplied by the server. */
  pick: (de: string, en?: string | null) => string;
  locale: string;
}

const LangContext = createContext<LangValue | null>(null);

function initialLang(): Lang {
  const stored = /(?:^|;\s*)sicht_lang=(de|en)/.exec(document.cookie)?.[1];
  if (stored === 'de' || stored === 'en') return stored;
  return navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en';
}

function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (vars[key] !== undefined ? String(vars[key]) : match));
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((next: Lang) => {
    // The server reads the same cookie to localise reports and error messages.
    document.cookie = `sicht_lang=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = next;
    setLangState(next);
  }, []);

  const value = useMemo<LangValue>(
    () => ({
      lang,
      setLang,
      t: (de, vars) => fill(lang === 'en' ? (EN[de] ?? de) : de, vars),
      pick: (de, en) => (lang === 'en' && en !== undefined && en !== null && en !== '' ? en : de),
      locale: lang === 'en' ? 'en-GB' : 'de-DE',
    }),
    [lang, setLang],
  );
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangValue {
  const value = useContext(LangContext);
  if (!value) throw new Error('LangProvider is missing');
  return value;
}
