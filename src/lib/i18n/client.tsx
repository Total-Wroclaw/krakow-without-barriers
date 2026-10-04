'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { defaultLocale, isLocale, type Locale } from './locales';
import { messages, type MessageKey } from './messages';

const STORAGE_KEY = 'krok-locale-v1';

type Vars = Record<string, string | number>;
type Ctx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, vars?: Vars) => string;
  /** Plural message stored as "one|few|many" (English: "one|other|other"); {n} is filled in. */
  tp: (key: MessageKey, n: number, vars?: Vars) => string;
};

const I18nContext = createContext<Ctx | null>(null);

function format(template: string, vars?: Vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? String(vars[name]) : `{${name}}`));
}

/** An explicit page locale (embedded widgets) takes precedence over saved/browser preferences. */
export function preferredLocale(initial: Locale | undefined, saved: unknown, browserLanguage: string): Locale {
  if (initial) return initial;
  if (isLocale(saved)) return saved;
  if (browserLanguage.startsWith('de')) return 'de';
  if (browserLanguage && !browserLanguage.startsWith('pl')) return 'en';
  return defaultLocale;
}

export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const scoped = useContext(I18nContext) !== null;
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? defaultLocale);

  useEffect(() => {
    let saved: unknown;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch {}
    setLocaleState(preferredLocale(initialLocale, saved, navigator.language));
  }, [initialLocale]);

  useEffect(() => {
    if (!scoped) {
      document.documentElement.lang = locale;
      document.title = messages[locale]['meta.title'];
    }
  }, [locale, scoped]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
  }, []);

  const t = useCallback((key: MessageKey, vars?: Vars) => format(messages[locale][key] ?? messages.pl[key] ?? key, vars), [locale]);
  const tp = useCallback(
    (key: MessageKey, n: number, vars?: Vars) => format((messages[locale][key] ?? messages.pl[key]).split('|')[pluralIndex(locale, n)] ?? key, { n, ...vars }),
    [locale],
  );
  const value = useMemo(() => ({ locale, setLocale, t, tp }), [locale, setLocale, t, tp]);
  return <I18nContext.Provider value={value}>{scoped ? <div lang={locale} className="contents">{children}</div> : children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}

/** Plural form index for Polish (one, few, many) and English/German (one, other). */
function pluralIndex(locale: Locale, n: number): 0 | 1 | 2 {
  if (locale !== 'pl') return n === 1 ? 0 : 2;
  if (n === 1) return 0;
  const tens = n % 100;
  const units = n % 10;
  return units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? 1 : 2;
}
