// User reports: a photo is analysed by AI and stored straight away as an unverified
// report; "blocked" reports (it stopped me getting somewhere) may be text only.
// The author can correct, extend with more photos or delete it afterwards; the city office
// reviews it in /city (status workflow with an audit trail).
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { draftPhoto } from './ai';
import { placeSchema } from './city-types';
import { locales, type Locale } from './i18n/locales';
import { cityStatuses, observationSchema, type CityStatus, type Observation, type Report, type ReportPhoto } from './schemas';
import { db, photoBytes } from './server';

export const MAX_PHOTOS = 4;
const photoString = z.string().max(4_500_000);
const optionalText = (max: number) => z.string().trim().max(max).optional().transform(v => v || undefined);

export const autoReportSchema = z
  .object({
    photo: photoString.optional(),
    location: placeSchema,
    locationSource: z.enum(['gps', 'map', 'fact']),
    factId: z.string().max(100).optional(),
    locale: z.enum(locales).default('pl'),
    type: z.enum(['barrier', 'blocked']).default('barrier'),
    /** What the person wants to tell the city, in their own words. */
    comment: optionalText(800),
    /** What they were trying to reach (free text, e.g. "Przychodnia na Siemiradzkiego"). */
    destination: optionalText(200),
  })
  .refine(v => !!v.photo || v.type === 'blocked' || (v.comment?.length ?? 0) >= 3, { message: 'photo_or_comment', path: ['photo'] });
export type AutoReportInput = z.infer<typeof autoReportSchema>;

export const addPhotoSchema = z.object({ photo: photoString, locale: z.enum(locales).default('pl') });

const failedObservation: Observation = { kind: 'other', description: 'Zdjęcie bez opisu. Dodaj krótki opis, co utrudnia przejście.', direction: 'unknown', handrail: 'unknown', surface: 'unknown', uncertainty: '' };

/** Conservative observation from the person's own words: no AI, no inferred kind. */
function commentObservation(input: Pick<AutoReportInput, 'comment' | 'destination' | 'type'>): Observation {
  const description =
    input.comment && input.comment.length >= 3
      ? input.comment
      : input.destination
        ? `Nie udało się dotrzeć do celu: ${input.destination}`.slice(0, 800)
        : 'Zgłoszono przeszkodę, która uniemożliwiła dotarcie do celu (bez opisu).';
  return { kind: 'other', description, direction: 'unknown', handrail: 'unknown', surface: 'unknown', uncertainty: 'Opis osoby zgłaszającej, bez zdjęcia i bez weryfikacji w terenie.' };
}

async function analyse(photo: string, locale: Locale): Promise<Observation | null> {
  try {
    return await draftPhoto(photo, locale);
  } catch {
    return null; // Keep the photo even when AI is unavailable; the user can describe it later.
  }
}

function readReport(id: string): Report | null {
  const row = db().prepare('SELECT body FROM reports WHERE id=?').get(id) as { body: string } | undefined;
  return row ? (JSON.parse(row.body) as Report) : null;
}
function writeReport(report: Report) {
  db().prepare('UPDATE reports SET body=? WHERE id=?').run(JSON.stringify(report), report.id);
}

export async function saveAutoReport(input: AutoReportInput): Promise<Report> {
  const photo = input.photo ? await photoBytes(input.photo) : null;
  let observation: Observation;
  let analysis: Report['analysis'];
  if (input.photo) {
    const drafted = await analyse(input.photo, input.locale);
    observation = drafted ?? failedObservation;
    analysis = drafted ? 'ai' : 'failed';
  } else {
    observation = commentObservation(input);
    analysis = 'comment';
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  const point = `point:${input.location.lat}:${input.location.lon}`;
  const photoPath = photo ? `/api/reports/${id}/photo` : null;
  const photos: ReportPhoto[] = photo ? [{ id: 'main', path: photoPath!, createdAt: now, ...(analysis === 'ai' ? { analysis: observation } : {}) }] : [];
  const report: Report = {
    id,
    observation,
    locationId: input.factId ?? point,
    location: { ...input.location, id: point },
    locationSource: input.locationSource,
    photoPath,
    obtainedAt: now,
    confirmedAt: null,
    status: 'unverified',
    source: 'user',
    analysis,
    type: input.type,
    ...(input.comment ? { comment: input.comment } : {}),
    ...(input.destination ? { destination: input.destination } : {}),
    photos,
    cityStatus: 'new',
  };
  db().prepare('INSERT INTO reports (id,body,photo) VALUES (?,?,?)').run(id, JSON.stringify(report), photo);
  return report;
}

export function photoCount(report: Report) {
  return report.photos?.length ?? (report.photoPath ? 1 : 0);
}

export type AddPhotoResult = { report: Report; photo: ReportPhoto } | { error: 'not_found' | 'limit' };

/** Adds one photo (max MAX_PHOTOS per report), analysed by AI. The report's observation only changes if it had none from a photo. */
export async function addReportPhoto(reportId: string, input: z.infer<typeof addPhotoSchema>): Promise<AddPhotoResult> {
  const before = readReport(reportId);
  if (!before) return { error: 'not_found' };
  if (photoCount(before) >= MAX_PHOTOS) return { error: 'limit' };
  const bytes = await photoBytes(input.photo);
  const analysis = await analyse(input.photo, input.locale);
  // Re-read after the awaits: the check-and-insert below is synchronous, so concurrent uploads cannot pass the limit.
  const report = readReport(reportId);
  if (!report) return { error: 'not_found' };
  if (photoCount(report) >= MAX_PHOTOS) return { error: 'limit' };
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const photo: ReportPhoto = { id, path: `/api/reports/${reportId}/photos/${id}`, createdAt, ...(analysis ? { analysis } : {}) };
  const photos = report.photos ?? (report.photoPath ? [{ id: 'main', path: report.photoPath, createdAt: report.obtainedAt }] : []);
  const next: Report = { ...report, photos: [...photos, photo] };
  if (!next.photoPath) next.photoPath = photo.path;
  // A text-only or failed report takes the first AI description; an AI or author-edited one stays as it is.
  if (analysis && (report.analysis === 'failed' || report.analysis === 'comment')) {
    next.observation = analysis;
    next.analysis = 'ai';
  }
  db().prepare('INSERT INTO report_photos (id,report_id,photo,created_at,analysis) VALUES (?,?,?,?,?)').run(id, reportId, bytes, createdAt, analysis ? JSON.stringify(analysis) : null);
  writeReport(next);
  return { report: next, photo };
}

/** Photo bytes by id; 'main' is the photo stored with the report itself. */
export function reportPhoto(reportId: string, photoId: string): Uint8Array | null {
  if (photoId === 'main') {
    const row = db().prepare('SELECT photo FROM reports WHERE id=?').get(reportId) as { photo: Uint8Array | null } | undefined;
    return row?.photo ?? null;
  }
  const row = db().prepare('SELECT photo FROM report_photos WHERE id=? AND report_id=?').get(photoId, reportId) as { photo: Uint8Array } | undefined;
  return row?.photo ?? null;
}

/** First photo of a report: the original column, else the first added photo (text-only reports). */
export function firstReportPhoto(reportId: string): Uint8Array | null {
  const main = reportPhoto(reportId, 'main');
  if (main) return main;
  const row = db().prepare('SELECT photo FROM report_photos WHERE report_id=? ORDER BY created_at, rowid LIMIT 1').get(reportId) as { photo: Uint8Array } | undefined;
  return row?.photo ?? null;
}

export function deleteReport(id: string) {
  db().prepare('DELETE FROM report_photos WHERE report_id=?').run(id);
  db().prepare('DELETE FROM reports WHERE id=?').run(id);
}

export function updateReport(id: string, observation: unknown): Report | null {
  const parsed = observationSchema.parse(observation);
  const report = readReport(id);
  if (!report) return null;
  const next: Report = { ...report, observation: parsed, analysis: 'edited', editedAt: new Date().toISOString() };
  writeReport(next);
  return next;
}

/** Public view: city status and public reply are shown; the audit trail stays in the dashboard. */
export function publicReport(report: Report): Report {
  const { cityHistory: _history, ...rest } = report;
  return rest;
}

// ---- City office -------------------------------------------------------------------------

export const cityUpdateSchema = z
  .object({
    status: z.enum(cityStatuses).optional(),
    /** Public reply shown next to the report. Empty string clears it. */
    note: z.string().trim().max(1000).optional(),
  })
  .refine(v => v.status !== undefined || v.note !== undefined, { message: 'empty_update' });

/** All reports for the dashboard, newest first. */
export function listAllReports(limit = 5000): Report[] {
  return (db().prepare('SELECT body FROM reports ORDER BY rowid DESC LIMIT ?').all(limit) as { body: string }[]).map(r => JSON.parse(r.body) as Report);
}

/** Changes status and/or public note; every change is appended to cityHistory. */
export function updateCityReport(id: string, input: z.infer<typeof cityUpdateSchema>, now = new Date()): Report | null {
  const report = readReport(id);
  if (!report) return null;
  const status: CityStatus = input.status ?? report.cityStatus ?? 'new';
  const note = input.note ?? report.cityNote ?? '';
  if (status === (report.cityStatus ?? 'new') && note === (report.cityNote ?? '')) return report; // nothing changed, no audit entry
  const at = now.toISOString();
  const next: Report = { ...report, cityStatus: status, cityUpdatedAt: at, cityHistory: [...(report.cityHistory ?? []), { at, status, note }] };
  if (note) next.cityNote = note;
  else delete next.cityNote;
  writeReport(next);
  return next;
}

export const photoHeaders = { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
