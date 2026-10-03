// Automatic photo reports: the photo is analysed by AI and stored straight away
// as an unverified user report. The user can correct or delete it afterwards.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { draftPhoto } from './ai';
import { placeSchema } from './city-types';
import { locales } from './i18n/locales';
import { observationSchema, type Report } from './schemas';
import { db, photoBytes } from './server';

export const autoReportSchema = z.object({
  photo: z.string().max(4_500_000),
  location: placeSchema,
  locationSource: z.enum(['gps', 'map', 'fact']),
  factId: z.string().max(100).optional(),
  locale: z.enum(locales).default('pl'),
});

export async function saveAutoReport(input: z.infer<typeof autoReportSchema>): Promise<Report> {
  const photo = await photoBytes(input.photo);
  let observation;
  let analysis: Report['analysis'] = 'ai';
  try {
    observation = await draftPhoto(input.photo, input.locale);
  } catch {
    // Keep the report even when AI is unavailable; the user can describe it later.
    analysis = 'failed';
    observation = { kind: 'other' as const, description: 'Zdjęcie bez opisu. Dodaj krótki opis, co utrudnia przejście.', direction: 'unknown' as const, handrail: 'unknown' as const, surface: 'unknown' as const, uncertainty: '' };
  }
  const id = randomUUID();
  const point = `point:${input.location.lat}:${input.location.lon}`;
  const report: Report = {
    id,
    observation,
    locationId: input.factId ?? point,
    location: { ...input.location, id: point },
    locationSource: input.locationSource,
    photoPath: `/api/reports/${id}/photo`,
    obtainedAt: new Date().toISOString(),
    confirmedAt: null,
    status: 'unverified',
    source: 'user',
    analysis,
  };
  db().prepare('INSERT INTO reports (id,body,photo) VALUES (?,?,?)').run(id, JSON.stringify(report), photo);
  return report;
}

export function updateReport(id: string, observation: unknown): Report | null {
  const parsed = observationSchema.parse(observation);
  const row = db().prepare('SELECT body FROM reports WHERE id=?').get(id) as { body: string } | undefined;
  if (!row) return null;
  const report: Report = { ...JSON.parse(row.body), observation: parsed, analysis: 'edited', editedAt: new Date().toISOString() };
  db().prepare('UPDATE reports SET body=? WHERE id=?').run(JSON.stringify(report), id);
  return report;
}
