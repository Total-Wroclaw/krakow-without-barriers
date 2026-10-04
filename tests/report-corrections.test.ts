import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Report } from '../src/lib/schemas';

process.env.KROK_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'krok-report-corrections-'));
delete process.env.OPENAI_API_KEY;
process.env.OPENAI_ENV_FILE = path.join(process.env.KROK_STORAGE_DIR, 'missing.env');
const { db } = await import('../src/lib/server');
const reports = await import('../src/lib/reports-server');
const autoRoute = await import('../src/app/api/reports/auto/route');
const reportRoute = await import('../src/app/api/reports/[id]/route');
const photoRoute = await import('../src/app/api/reports/[id]/photos/route');
const { reportsCsv } = await import('../src/lib/city-reports');
const { prepareReportSubmission, sendReportSubmission } = await import('../src/lib/report-submission');
const sharp = (await import('sharp')).default;
const image = `data:image/png;base64,${(await sharp({ create: { width: 40, height: 30, channels: 3, background: '#ddd' } }).png().toBuffer()).toString('base64')}`;
const base = 'http://localhost:3030';
const location = { id: 'test', name: 'Test', lat: 50.061, lon: 19.945, source: 'test' };
const body = { type: 'blocked' as const, location, locationSource: 'map' as const, comment: 'Original public comment', destination: 'Original destination', locale: 'en' as const };
const request = (url: string, method: string, data: unknown, headers: Record<string, string> = {}) => new Request(`${base}${url}`, { method, headers: { origin: base, 'content-type': 'application/json', ...headers }, body: JSON.stringify(data) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

test.after(() => { db().close(); rmSync(process.env.KROK_STORAGE_DIR!, { recursive: true, force: true }); });

test('submission uses secure v4 ids when randomUUID is unavailable on HTTP', () => {
  const original = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
  try {
    const submission = prepareReportSubmission(body, ['first photo', 'second photo']);
    const ids = [submission.id, ...submission.pending.map(photo => photo.id)];
    for (const id of ids) assert.match(id, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    assert.equal(new Set(ids).size, 3);
    assert.match(submission.token, /^[A-Za-z0-9_-]{43}$/);
  } finally {
    if (original) Object.defineProperty(crypto, 'randomUUID', original);
    else Reflect.deleteProperty(crypto, 'randomUUID');
  }
});

test('unavailable secure randomness fails before any submission can be sent', (t) => {
  t.mock.method(crypto, 'getRandomValues', () => { throw new Error('Secure randomness unavailable'); });
  assert.throws(() => prepareReportSubmission(body, []), /Secure randomness unavailable/);
});

async function create() {
  const res = await autoRoute.POST(request('/api/reports/auto', 'POST', body));
  assert.equal(res.status, 201);
  return await res.json() as { report: Report; editToken: string };
}

test('author corrects public words and destination everywhere without retaining the old comment', async () => {
  const { report, editToken } = await create();
  const corrected = { comment: 'Corrected public comment', destination: 'Corrected destination' };
  for (const token of ['', reports.newEditToken().token]) {
    assert.equal((await reportRoute.PATCH(request(`/api/reports/${report.id}`, 'PATCH', corrected, { 'x-report-token': token }), ctx(report.id))).status, 403);
  }
  const response = await reportRoute.PATCH(request(`/api/reports/${report.id}`, 'PATCH', corrected, { 'x-report-token': editToken }), ctx(report.id));
  assert.equal(response.status, 200);
  const updated = (await response.json()).report as Report;
  assert.equal(updated.comment, corrected.comment);
  assert.equal(updated.destination, corrected.destination);
  assert.equal(updated.observation.description, corrected.comment);
  assert.equal(updated.analysis, 'comment');
  const stored = reports.listAllReports().find(r => r.id === report.id)!;
  for (const readback of [reports.publicReport(stored), reports.cityReport(stored)]) {
    assert.ok(!JSON.stringify(readback).includes('Original public comment'));
    assert.equal(readback.comment, corrected.comment);
  }
  const csv = reportsCsv([stored], base);
  assert.match(csv, /Corrected public comment/);
  assert.match(csv, /Corrected destination/);
  assert.doesNotMatch(csv, /Original public comment|Original destination/);
  assert.equal((await reportRoute.PATCH(request(`/api/reports/${report.id}`, 'PATCH', { comment: '', destination: '' }, { 'x-report-token': editToken }), ctx(report.id))).status, 400);
  assert.equal((await reportRoute.PATCH(request(`/api/reports/${report.id}`, 'PATCH', { comment: 'x'.repeat(801) }, { 'x-report-token': editToken }), ctx(report.id))).status, 400);
  assert.equal((await reportRoute.PATCH(request(`/api/reports/${report.id}`, 'PATCH', { destination: '' }, { 'x-report-token': editToken }), ctx(report.id))).status, 200);
});

test('editing public words keeps an AI photo description and its provenance distinct', async () => {
  const { report } = await create();
  const ai = { ...report, analysis: 'ai' as const, observation: { ...report.observation, description: 'Description of a photo' } };
  db().prepare('UPDATE reports SET body=? WHERE id=?').run(JSON.stringify(ai), report.id);
  const updated = reports.updateReport(report.id, undefined, undefined, { comment: 'A corrected comment', destination: '' })!;
  assert.deepEqual(updated.observation, ai.observation);
  assert.equal(updated.analysis, 'ai');
  assert.equal(updated.comment, 'A corrected comment');
  assert.equal(updated.destination, undefined);
});

test('creation replay is authorized by the original token and cannot overwrite another submission', async () => {
  const id = randomUUID();
  const { token } = reports.newEditToken();
  const headers = { 'x-report-submission-id': id, 'x-report-token': token };
  const results = await Promise.all([autoRoute.POST(request('/api/reports/auto', 'POST', body, headers)), autoRoute.POST(request('/api/reports/auto', 'POST', body, headers))]);
  assert.deepEqual(results.map(r => r.status), [201, 201]);
  assert.equal((db().prepare('SELECT COUNT(*) AS n FROM reports WHERE id=?').get(id) as { n: number }).n, 1);
  const row = db().prepare('SELECT body, edit_hash FROM reports WHERE id=?').get(id) as { body: string; edit_hash: string };
  assert.ok(!row.body.includes(token));
  assert.notEqual(row.edit_hash, token);
  const attacked = await autoRoute.POST(request('/api/reports/auto', 'POST', { ...body, comment: 'Malicious replacement' }, { ...headers, 'x-report-token': reports.newEditToken().token }));
  assert.equal(attacked.status, 403);
  assert.ok(!(await attacked.text()).includes(token));
  assert.equal(reports.listAllReports().find(r => r.id === id)!.comment, body.comment);
  assert.equal((await autoRoute.POST(request('/api/reports/auto', 'POST', body, { 'x-report-submission-id': id }))).status, 400);
});

/** Exercise the real handlers behind the retry coordinator; the transport can lose a response after commit. */
const send = async (url: string, data: unknown, _timeout?: number, headers: Record<string, string> = {}) => {
  const response = url === '/api/reports/auto'
    ? await autoRoute.POST(request(url, 'POST', data, headers))
    : await photoRoute.POST(request(url, 'POST', data, headers), ctx(url.split('/')[3]));
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
};

test('lost creation response retries the same report and retains the author token', async () => {
  const submission = prepareReportSubmission(body, []);
  let loseResponse = true;
  const unreliable: typeof send = async (...args) => {
    const result = await send(...args);
    if (loseResponse) { loseResponse = false; throw new Error('lost response after commit'); }
    return result;
  };
  await assert.rejects(sendReportSubmission(submission, () => {}, unreliable));
  assert.equal(submission.report, null);
  const saved = await sendReportSubmission(submission, () => {}, unreliable);
  assert.equal(saved.id, submission.id);
  assert.equal(reports.checkEditToken(saved.id, submission.token), 'ok');
  assert.equal((db().prepare('SELECT COUNT(*) AS n FROM reports WHERE id=?').get(saved.id) as { n: number }).n, 1);
});

test('partial photo failure keeps only unsent work and response-loss retry does not duplicate photos', async () => {
  const submission = prepareReportSubmission(body, [image, image]);
  const firstUpload = submission.pending[0].id;
  const secondUpload = submission.pending[1].id;
  let lost = false;
  const attempts: string[] = [];
  const unreliable: typeof send = async (...args) => {
    const uploadId = (args[1] as { uploadId?: string }).uploadId;
    if (uploadId) attempts.push(uploadId);
    const result = await send(...args);
    if (uploadId === secondUpload && !lost) { lost = true; throw new Error('photo response lost after commit'); }
    return result;
  };
  await assert.rejects(sendReportSubmission(submission, () => {}, unreliable));
  assert.equal(submission.report?.id, submission.id);
  assert.deepEqual(submission.pending.map(p => p.id), [secondUpload]);
  const completed = await sendReportSubmission(submission, () => {}, unreliable);
  assert.equal(completed.photos?.length, 2);
  assert.deepEqual(submission.pending, []);
  assert.deepEqual(attempts, [firstUpload, secondUpload, secondUpload]);
  assert.equal((db().prepare('SELECT COUNT(*) AS n FROM report_photos WHERE report_id=?').get(submission.id) as { n: number }).n, 2);
});
