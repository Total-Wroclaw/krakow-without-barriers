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

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) setLocaleState(saved);
    else if (navigator.language.startsWith('de')) setLocaleState('de');
    else if (!navigator.language.startsWith('pl') && navigator.language) setLocaleState('en');
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = messages[locale]['meta.title'];
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const t = useCallback((key: MessageKey, vars?: Vars) => format(messages[locale][key] ?? messages.pl[key] ?? key, vars), [locale]);
  const tp = useCallback(
    (key: MessageKey, n: number, vars?: Vars) => format((messages[locale][key] ?? messages.pl[key]).split('|')[pluralIndex(locale, n)] ?? key, { n, ...vars }),
    [locale],
  );
  const value = useMemo(() => ({ locale, setLocale, t, tp }), [locale, setLocale, t, tp]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}

/** Plural form index for Polish (one, few, many) and English/German (one, other). */
export function pluralIndex(locale: Locale, n: number): 0 | 1 | 2 {
  if (locale !== 'pl') return n === 1 ? 0 : 2;
  if (n === 1) return 0;
  const tens = n % 100;
  const units = n % 10;
  return units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? 1 : 2;
}
