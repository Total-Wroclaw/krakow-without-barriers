// Display helpers shared by the UI. Europe/Warsaw time, locale-aware numbers.
import type { Locale } from './i18n/locales';

const intlLocale: Record<Locale, string> = { pl: 'pl-PL', en: 'en-GB', de: 'de-DE' };
const units: Record<Locale, { min: string; h: string; m: string; km: string }> = {
  pl: { min: 'min', h: 'h', m: 'm', km: 'km' },
  en: { min: 'min', h: 'h', m: 'm', km: 'km' },
  de: { min: 'Min.', h: 'Std.', m: 'm', km: 'km' },
};

export function clock(seconds: number) {
  const within = ((seconds % 86400) + 86400) % 86400;
  return `${String(Math.floor(within / 3600)).padStart(2, '0')}:${String(Math.floor(within / 60) % 60).padStart(2, '0')}`;
}

export function duration(seconds: number, locale: Locale = 'pl') {
  const u = units[locale];
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} ${u.min}`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} ${u.h} ${rest} ${u.min}` : `${minutes / 60} ${u.h}`;
}

export function distance(metres: number, locale: Locale = 'pl') {
  const u = units[locale];
  if (metres < 1000) return `${Math.round(metres / 10) * 10 || Math.round(metres)} ${u.m}`;
  return `${(metres / 1000).toLocaleString(intlLocale[locale], { maximumFractionDigits: 1 })} ${u.km}`;
}

export function warsawNow() {
  const [date, time] = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date()).split(' ');
  return { date, time };
}

export function formatDate(value: string | null | undefined, locale: Locale = 'pl', fallback = '—') {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat(intlLocale[locale], { dateStyle: 'medium', timeZone: 'Europe/Warsaw' }).format(d);
}
