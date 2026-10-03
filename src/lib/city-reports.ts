// Shared by the /city dashboard (client) and /api/city/* (server): labels, filters, summary, CSV.
import { z } from 'zod';
import { cityStatuses, type CityStatus, type Report } from './schemas';

export const cityStatusLabel: Record<CityStatus, string> = {
  new: 'Nowe',
  in_review: 'W trakcie analizy',
  forwarded: 'Przekazane do jednostki',
  resolved: 'Rozwiązane',
  rejected: 'Odrzucone',
};
export const reportTypeLabel = { barrier: 'Utrudnienie na trasie', blocked: 'Uniemożliwiło dotarcie' } as const;
export const kindLabel: Record<Report['observation']['kind'], string> = { stairs: 'Schody', entrance: 'Wejście', bench: 'Ławka', surface: 'Nawierzchnia', other: 'Inne' };

export const statusOf = (r: Report): CityStatus => r.cityStatus ?? 'new';
export const typeOf = (r: Report) => r.type ?? 'barrier';

export const cityFilterSchema = z.object({
  status: z.enum([...cityStatuses, 'all']).default('all'),
  type: z.enum(['barrier', 'blocked', 'all']).default('all'),
  /** Inclusive local dates YYYY-MM-DD. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  q: z.string().trim().max(200).default(''),
});
export type CityFilter = z.infer<typeof cityFilterSchema>;
export const emptyCityFilter: CityFilter = { status: 'all', type: 'all', q: '' };

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase();

const warsawDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Calendar day (YYYY-MM-DD) in Kraków time. */
export const reportDay = (r: Report) => warsawDay.format(new Date(r.obtainedAt));

/** from/to compare with the Kraków calendar day of obtainedAt. */
export function filterReports(reports: Report[], f: CityFilter) {
  const words = fold(f.q).split(/\s+/).filter(Boolean);
  return reports.filter(r => {
    if (f.status !== 'all' && statusOf(r) !== f.status) return false;
    if (f.type !== 'all' && typeOf(r) !== f.type) return false;
    const day = reportDay(r);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (words.length) {
      const text = fold([r.observation.description, r.comment, r.destination, r.location?.name, r.cityNote, r.id].filter(Boolean).join(' '));
      if (!words.every(w => text.includes(w))) return false;
    }
    return true;
  });
}

export function summary(reports: Report[], now = Date.now()) {
  const weekAgo = new Date(now - 7 * 86_400_000).toISOString();
  return {
    total: reports.length,
    new: reports.filter(r => statusOf(r) === 'new').length,
    inReview: reports.filter(r => statusOf(r) === 'in_review').length,
    blockedWeek: reports.filter(r => typeOf(r) === 'blocked' && r.obtainedAt >= weekAgo).length,
  };
}

export function mapLinks(lat: number, lon: number) {
  return {
    osm: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=19/${lat}/${lon}`,
    google: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`,
  };
}

/** RFC 4180 field; text starting with = + - @ tab or CR is prefixed with ' so spreadsheets don't run it as a formula. */
export function csvField(value: string | number | null | undefined) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

const columns = ['id', 'utworzono', 'typ', 'status', 'rodzaj', 'opis', 'komentarz', 'cel_podrozy', 'miejsce', 'lat', 'lon', 'osm', 'zdjecia', 'odpowiedz_miasta', 'zmiana_statusu'];

/** UTF-8 with BOM so Excel opens Polish characters correctly. Photo links are relative to the app origin. */
export function reportsCsv(reports: Report[], origin = '') {
  const rows = reports.map(r => {
    const photos = (r.photos?.map(p => p.path) ?? (r.photoPath ? [r.photoPath] : [])).map(p => `${origin}${p}`).join(' ');
    return [
      r.id,
      r.obtainedAt,
      reportTypeLabel[typeOf(r)],
      cityStatusLabel[statusOf(r)],
      kindLabel[r.observation.kind],
      r.observation.description,
      r.comment,
      r.destination,
      r.location?.name,
      r.location?.lat,
      r.location?.lon,
      r.location ? mapLinks(r.location.lat, r.location.lon).osm : '',
      photos,
      r.cityNote,
      r.cityUpdatedAt,
    ].map(csvField).join(',');
  });
  return `﻿${[columns.join(','), ...rows].join('\r\n')}\r\n`;
}
