// Supported interface languages. Polish is the default and the language of source data.
export const locales = ['pl', 'en', 'de'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'pl';
export const localeNames: Record<Locale, string> = { pl: 'Polski', en: 'English', de: 'Deutsch' };
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}
