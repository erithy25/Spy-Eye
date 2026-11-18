import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { EN } from './en';
import { formatCount, setNumberLocale } from './format';

export type Lang = 'de' | 'en';

interface LangValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Translates a German source string; `{name}` placeholders are filled from `vars`. */
  t: (de: string, vars?: Record<string, string | number>) => string;
  /** Chooses between a German and an English value supplied by the server. */
  pick: (de: string, en?: string | null) => string;
  /** Chooses between German lines and their English versions (same order) supplied by the server. */
  pickList: (de: string[], en?: string[] | null) => string[];
  /** A count with its noun in the right number: "1 Quelle", "3 Quellen", "1 source". */
  n: (count: number, noun: CountNoun) => string;
  /**
   * Name of a country in the console language from its ISO 3166-1 alpha-2 code ("DE" -> "Germany"),
   * so that names the server writes in German never show in the English console. Falls back to
   * `fallback` (or the code) when the code is unknown.
   */
  region: (iso: string | null | undefined, fallback?: string | null) => string;
  locale: string;
}

const regionNames = new Map<string, Intl.DisplayNames | null>();

function regionName(locale: string, iso: string): string | null {
  let names = regionNames.get(locale);
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames([locale], { type: 'region' });
    } catch {
      // Very old engines lack DisplayNames; the server's German name stands in.
      names = null;
    }
    regionNames.set(locale, names);
  }
  if (!names) return null;
  try {
    const name = names.of(iso.toUpperCase());
    // DisplayNames echoes codes it does not know.
    return name && name.toUpperCase() !== iso.toUpperCase() ? name : null;
  } catch {
    return null;
  }
}

/** Nouns that follow a count somewhere in the console: singular and plural in both languages. */
const COUNT_NOUNS = {
  source: { de: ['Quelle', 'Quellen'], en: ['source', 'sources'] },
  face: { de: ['Gesicht', 'Gesichter'], en: ['face', 'faces'] },
  alert: { de: ['Meldung', 'Meldungen'], en: ['alert', 'alerts'] },
  frame: { de: ['Bild', 'Bilder'], en: ['frame', 'frames'] },
  entry: { de: ['Eintrag', 'Einträge'], en: ['entry', 'entries'] },
  query: { de: ['Abfrage', 'Abfragen'], en: ['query', 'queries'] },
  hit: { de: ['Treffer', 'Treffer'], en: ['hit', 'hits'] },
  recording: { de: ['Aufnahme', 'Aufnahmen'], en: ['recording', 'recordings'] },
  file: { de: ['Datei', 'Dateien'], en: ['file', 'files'] },
  dataset: { de: ['Datensatz', 'Datensätze'], en: ['dataset', 'datasets'] },
  video: { de: ['Video', 'Videos'], en: ['video', 'videos'] },
} as const;

export type CountNoun = keyof typeof COUNT_NOUNS;

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

  // Numbers follow the language as well: decimal comma in German, decimal point in English.
  setNumberLocale(lang === 'en' ? 'en-GB' : 'de-DE');
  // Screen readers and the browser's hyphenation read the page in the chosen language from the start.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<LangValue>(
    () => ({
      lang,
      setLang,
      t: (de, vars) => fill(lang === 'en' ? (EN[de] ?? de) : de, vars),
      // Without an English version from the server, the console's own dictionary may still know
      // the text (names of seeded sources, accounts and mandates).
      pick: (de, en) => (lang === 'en' ? (en !== undefined && en !== null && en !== '' ? en : (EN[de] ?? de)) : de),
      pickList: (de, en) => (lang === 'en' && en && en.length === de.length ? en : de),
      n: (count, noun) => `${formatCount(count)} ${COUNT_NOUNS[noun][lang][count === 1 ? 0 : 1]}`,
      region: (iso, fallback) => (iso ? (regionName(lang === 'en' ? 'en-GB' : 'de-DE', iso) ?? fallback ?? iso) : (fallback ?? '')),
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
