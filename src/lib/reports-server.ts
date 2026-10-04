// User reports: a photo is analysed by AI and stored straight away as an unverified
// report; "blocked" reports (it stopped me getting somewhere) may be text only.
// The author can correct, extend with more photos or delete it afterwards; the city office
// reviews it in /city (status workflow with an audit trail).
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { draftPhoto } from './ai';
import { placeSchema } from './city-types';
import { locales, type Locale } from './i18n/locales';
import { cityStatuses, observationSchema, photoVisibilities, type CityStatus, type Observation, type PhotoPeople, type Report, type ReportPhoto } from './schemas';
import { cityPhotoPath, initialVisibility, isPublicPhoto, photoList, publicPhotoPath, publicPhotos } from './report-photos';
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
type AutoReportInput = z.infer<typeof autoReportSchema>;

export const addPhotoSchema = z.object({ photo: photoString, locale: z.enum(locales).default('pl'), uploadId: z.uuid().optional() });
export const reportCorrectionSchema = z.object({
  observation: observationSchema.optional(),
  location: placeSchema.optional(),
  comment: z.string().trim().max(800).optional(),
  destination: z.string().trim().max(200).optional(),
  locale: z.enum(locales).optional(),
}).refine(v => v.observation !== undefined || v.location !== undefined || v.comment !== undefined || v.destination !== undefined, { message: 'empty_update' });

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

type Analysis = { observation: Observation; people: PhotoPeople };
async function analyse(photo: string, locale: Locale): Promise<Analysis | null> {
  try {
    const { people, ...observation } = await draftPhoto(photo, locale);
    return { observation, people };
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

// ---- Author edit token -----------------------------------------------------------------
// No accounts: creating a report returns a random token once (`editToken`); the client keeps it
// (localStorage, keyed by report id) and sends it as `x-report-token` to edit, delete or add photos.
// Only its SHA-256 hash is stored, in reports.edit_hash (never in the JSON body). Reports created
// before tokens existed have no hash and can no longer be changed by anyone but the city.

export const REPORT_TOKEN_HEADER = 'x-report-token';
const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

/** 32 random bytes, base64url (43 characters). */
export function newEditToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

type ReportAccess = 'ok' | 'not_found' | 'forbidden';
/** Checks the author's token against the stored hash in constant time. */
export function checkEditToken(id: string, token: string | null | undefined): ReportAccess {
  const row = db().prepare('SELECT edit_hash FROM reports WHERE id=?').get(id) as { edit_hash: string | null } | undefined;
  if (!row) return 'not_found';
  return tokenMatches(row.edit_hash, token) ? 'ok' : 'forbidden';
}

/** Constant-time comparison of a presented token with a stored SHA-256 hash (also used for partner declarations). */
export function tokenMatches(storedHash: string | null | undefined, token: string | null | undefined) {
  if (!storedHash || !token || token.length > 200) return false;
  const expected = Buffer.from(storedHash, 'hex');
  const given = Buffer.from(hashToken(token), 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The author may delete only while the city has not started handling the report. */
export function authorCanDelete(id: string) {
  const report = readReport(id);
  return !!report && (report.cityStatus ?? 'new') === 'new';
}

export async function saveAutoReport(input: AutoReportInput, editTokenHash: string | null = null, id: string = randomUUID()): Promise<Report> {
  const photo = input.photo ? await photoBytes(input.photo) : null;
  let observation: Observation;
  let analysis: Report['analysis'];
  let people: PhotoPeople | undefined;
  if (input.photo) {
    const drafted = await analyse(input.photo, input.locale);
    observation = drafted?.observation ?? failedObservation;
    people = drafted?.people;
    analysis = drafted ? 'ai' : 'failed';
  } else {
    observation = commentObservation(input);
    analysis = 'comment';
  }
  const now = new Date().toISOString();
  const point = `point:${input.location.lat}:${input.location.lon}`;
  const photoPath = photo ? `/api/reports/${id}/photo` : null;
  const photos: ReportPhoto[] = photo ? [{ id: 'main', path: photoPath!, createdAt: now, ...(analysis === 'ai' ? { analysis: observation } : {}), ...(people ? { people } : {}), visibility: initialVisibility(people) }] : [];
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
  db().prepare('INSERT INTO reports (id,body,photo,edit_hash) VALUES (?,?,?,?)').run(id, JSON.stringify(report), photo, editTokenHash);
  return report;
}

/** A caller keeps this random id and token before sending, so a lost response can be retried safely. */
export const reportSubmissionSchema = z.object({ id: z.uuid(), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
const submissions = new Map<string, { hash: string; promise: Promise<Report> }>();
export async function saveAutoReportOnce(input: AutoReportInput, submission: z.infer<typeof reportSubmissionSchema>): Promise<Report | null> {
  const { id, token } = reportSubmissionSchema.parse(submission);
  const hash = hashToken(token);
  const existing = readReport(id);
  if (existing) return checkEditToken(id, token) === 'ok' ? existing : null;
  const pending = submissions.get(id);
  if (pending) return pending.hash === hash ? pending.promise : null;
  const promise = saveAutoReport(input, hash, id);
  submissions.set(id, { hash, promise });
  try {
    return await promise;
  } finally {
    submissions.delete(id);
  }
}

function photoCount(report: Report) {
  return report.photos?.length ?? (report.photoPath ? 1 : 0);
}

type AddPhotoResult = { report: Report; photo: ReportPhoto } | { error: 'not_found' | 'limit' };

/** Adds one photo (max MAX_PHOTOS per report), analysed by AI. The report's observation only changes if it had none from a photo. */
export async function addReportPhoto(reportId: string, input: z.infer<typeof addPhotoSchema>): Promise<AddPhotoResult> {
  // Namespace caller ids by report, so another author's upload cannot claim the same database key.
  const id = input.uploadId ? createHash('sha256').update(`${reportId}:${input.uploadId}`).digest('hex') : randomUUID();
  const before = readReport(reportId);
  if (!before) return { error: 'not_found' };
  const previous = photoList(before).find(p => p.id === id);
  if (previous) return { report: before, photo: previous };
  if (photoCount(before) >= MAX_PHOTOS) return { error: 'limit' };
  const bytes = await photoBytes(input.photo);
  const analysis = await analyse(input.photo, input.locale);
  // Re-read after the awaits: the check-and-insert below is synchronous, so concurrent uploads cannot pass the limit.
  const report = readReport(reportId);
  if (!report) return { error: 'not_found' };
  const completed = photoList(report).find(p => p.id === id);
  if (completed) return { report, photo: completed };
  if (photoCount(report) >= MAX_PHOTOS) return { error: 'limit' };
  const createdAt = new Date().toISOString();
  const photo: ReportPhoto = { id, path: `/api/reports/${reportId}/photos/${id}`, createdAt, ...(analysis ? { analysis: analysis.observation, people: analysis.people } : {}), visibility: initialVisibility(analysis?.people) };
  const photos = photoList(report);
  const next: Report = { ...report, photos: [...photos, photo] };
  if (!next.photoPath) next.photoPath = photo.path ?? null;
  // A text-only or failed report takes the first AI description; an AI or author-edited one stays as it is.
  if (analysis && (report.analysis === 'failed' || report.analysis === 'comment')) {
    next.observation = analysis.observation;
    next.analysis = 'ai';
  }
  db().prepare('INSERT INTO report_photos (id,report_id,photo,created_at,analysis) VALUES (?,?,?,?,?)').run(id, reportId, bytes, createdAt, analysis ? JSON.stringify(analysis.observation) : null);
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

/** Photo bytes only if the photo is publicly visible (see report-photos.ts); hidden and unknown photos → null. */
export function publicReportPhoto(reportId: string, photoId: string): Uint8Array | null {
  const report = readReport(reportId);
  const photo = report && photoList(report).find(p => p.id === photoId);
  return photo && isPublicPhoto(photo) ? reportPhoto(reportId, photoId) : null;
}

/** First publicly visible photo of a report (GET /api/reports/[id]/photo). */
export function firstReportPhoto(reportId: string): Uint8Array | null {
  const report = readReport(reportId);
  const photo = report && photoList(report).find(isPublicPhoto);
  return photo ? reportPhoto(reportId, photo.id) : null;
}

export function deleteReport(id: string) {
  db().prepare('DELETE FROM report_photos WHERE report_id=?').run(id);
  db().prepare('DELETE FROM reports WHERE id=?').run(id);
}

/** Author's corrections: the description and/or the location (e.g. GPS put it on the wrong side of the street). */
export function updateReport(id: string, observation: unknown, location?: unknown, words: { comment?: string; destination?: string } = {}): Report | null {
  const report = readReport(id);
  if (!report) return null;
  const parsed = observation === undefined ? report.observation : observationSchema.parse(observation);
  const place = location === undefined ? null : placeSchema.parse(location);
  const corrected = reportCorrectionSchema.parse({ ...(observation === undefined ? {} : { observation: parsed }), ...(place ? { location: place } : {}), ...words });
  const comment = corrected.comment === undefined ? report.comment : corrected.comment || undefined;
  const destination = corrected.destination === undefined ? report.destination : corrected.destination || undefined;
  // A text-only report derives its observation from these words. Photo/AI observations remain independent.
  const commentOnly = report.analysis === 'comment' && observation === undefined;
  if (commentOnly && corrected.comment !== undefined && (comment?.length ?? 0) < 3 && photoCount(report) === 0) throw new Error('comment_required');
  const next: Report = {
    ...report,
    comment,
    destination,
    observation: commentOnly ? commentObservation({ comment, destination, type: report.type ?? 'blocked' }) : parsed,
    ...(observation === undefined ? {} : { analysis: 'edited' as const }),
    ...(place ? { location: { ...place, id: `point:${place.lat}:${place.lon}` }, locationSource: 'map' as const, locationId: report.locationId.startsWith('point:') ? `point:${place.lat}:${place.lon}` : report.locationId } : {}),
    editedAt: new Date().toISOString(),
  };
  writeReport(next);
  return next;
}

/** Public view: city status and public reply are shown; the audit trail stays in the dashboard. Hidden photos have no path. */
export function publicReport(report: Report): Report {
  const { cityHistory: _history, ...rest } = report;
  return { ...rest, photoPath: publicPhotoPath(report), photos: publicPhotos(report) };
}

/** City dashboard view: every photo through the cookie-protected city route, with its visibility. */
export function cityReport(report: Report): Report {
  const photos = photoList(report).map(p => ({ ...p, path: cityPhotoPath(report.id, p.id), visibility: p.visibility ?? 'hidden' }));
  return { ...report, photos, photoPath: photos[0]?.path ?? null };
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

export const photoVisibilitySchema = z.object({ visibility: z.enum(photoVisibilities) });

/** City decision on one photo; recorded in cityHistory. null = report or photo not found. */
export function setPhotoVisibility(id: string, photoId: string, visibility: ReportPhoto['visibility'] & string, now = new Date()): Report | null {
  const report = readReport(id);
  if (!report) return null;
  const photos = photoList(report);
  const index = photos.findIndex(p => p.id === photoId);
  if (index < 0) return null;
  const at = now.toISOString();
  photos[index] = { ...photos[index], visibility, reviewedAt: at };
  const next: Report = {
    ...report,
    photos,
    cityUpdatedAt: at,
    cityHistory: [...(report.cityHistory ?? []), { at, status: report.cityStatus ?? 'new', note: report.cityNote ?? '', photo: { id: photoId, visibility } }],
  };
  writeReport(next);
  return next;
}

export const photoHeaders = { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
