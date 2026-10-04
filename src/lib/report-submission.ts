import { postJson } from './client';
import type { CityPlace } from './city-types';
import type { Locale } from './i18n/locales';
import type { Report } from './schemas';

type SubmissionBody = { type: 'blocked'; comment?: string; destination?: string; location: CityPlace; locationSource: 'gps' | 'fact' | 'map'; factId?: string; locale: Locale };
export type ReportSubmission = {
  id: string;
  token: string;
  body: SubmissionBody;
  pending: { id: string; photo: string }[];
  report: Report | null;
};

function submissionId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // getRandomValues also works on HTTP LAN previews, where randomUUID is unavailable.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Keep the same ids and token until every response is acknowledged, including after timeouts. */
export function prepareReportSubmission(body: SubmissionBody, photos: string[]): ReportSubmission {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  return { id: submissionId(), token, body, pending: photos.map(photo => ({ id: submissionId(), photo })), report: null };
}

/** Mutates only acknowledged progress. Failed photos stay queued with their original id for a safe retry. */
export async function sendReportSubmission(submission: ReportSubmission, onProgress: (report: Report) => void, send = postJson): Promise<Report> {
  const headers = { 'x-report-token': submission.token };
  if (!submission.report) {
    // Save the words first; each photo has a separately retryable upload, including the first one.
    const data = await send('/api/reports/auto', submission.body, 60000, { ...headers, 'x-report-submission-id': submission.id });
    if (!data.report || data.report.id !== submission.id) throw new Error();
    submission.report = data.report as Report;
    onProgress(submission.report);
  }
  while (submission.pending.length) {
    const next = submission.pending[0];
    const data = await send(`/api/reports/${submission.id}/photos?locale=${submission.body.locale}`, { photo: next.photo, uploadId: next.id, locale: submission.body.locale }, 60000, headers);
    if (!data.report || data.report.id !== submission.id) throw new Error();
    submission.report = data.report as Report;
    submission.pending.shift();
    onProgress(submission.report);
  }
  return submission.report;
}
