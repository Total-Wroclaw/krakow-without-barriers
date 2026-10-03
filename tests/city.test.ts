import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.KROK_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'krok-city-test-'));
// No AI in tests: photo analysis fails fast and the report keeps its photo without a description.
delete process.env.OPENAI_API_KEY;
process.env.OPENAI_ENV_FILE = path.join(process.env.KROK_STORAGE_DIR, 'missing.env');
process.env.CITY_DASHBOARD_PASSWORD = 'test-haslo-miasta';
delete process.env.CITY_DASHBOARD_SECRET;

const sharp = (await import('sharp')).default;
const { db } = await import('../src/lib/server');
const reports = await import('../src/lib/reports-server');
const auth = await import('../src/lib/city-auth');
const { csvField, reportsCsv, filterReports, emptyCityFilter } = await import('../src/lib/city-reports');
const cityReportsRoute = await import('../src/app/api/city/reports/route');
const cityReportRoute = await import('../src/app/api/city/reports/[id]/route');
const csvRoute = await import('../src/app/api/city/reports.csv/route');
const loginRoute = await import('../src/app/api/city/login/route');
const photosRoute = await import('../src/app/api/reports/[id]/photos/route');

const location = { id: 'x', name: 'Rondo Mogilskie', lat: 50.0659, lon: 19.9592, source: 'Test' };
const photo = `data:image/png;base64,${(await sharp({ create: { width: 40, height: 30, channels: 3, background: '#888' } }).png().toBuffer()).toString('base64')}`;
const base = 'http://localhost:3030';
const json = (url: string, method: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${base}${url}`, { method, headers: { 'content-type': 'application/json', origin: base, host: 'localhost:3030', ...headers }, body: JSON.stringify(body) });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

test.after(() => {
  db().close();
  rmSync(process.env.KROK_STORAGE_DIR!, { recursive: true, force: true });
});

test('blocked report saves without a photo, no AI, comment as conservative observation', async () => {
  const input = reports.autoReportSchema.parse({ location, locationSource: 'map', type: 'blocked', comment: 'Winda na przystanku nie działa, nie dojechałam.', destination: 'Przychodnia na Lubicz' });
  const r = await reports.saveAutoReport(input);
  assert.equal(r.type, 'blocked');
  assert.equal(r.photoPath, null);
  assert.deepEqual(r.photos, []);
  assert.equal(r.analysis, 'comment');
  assert.equal(r.observation.kind, 'other');
  assert.equal(r.observation.description, input.comment);
  assert.equal(r.destination, 'Przychodnia na Lubicz');
  assert.equal(r.cityStatus, 'new');
  assert.equal(r.status, 'unverified');
  // Blocked with nothing else still gets a valid description.
  const bare = await reports.saveAutoReport(reports.autoReportSchema.parse({ location, locationSource: 'gps', type: 'blocked' }));
  assert.ok(bare.observation.description.length >= 3);
  // A plain barrier needs a photo or a comment.
  assert.equal(reports.autoReportSchema.safeParse({ location, locationSource: 'map' }).success, false);
  assert.equal(reports.autoReportSchema.safeParse({ location, locationSource: 'map', comment: 'Wysoki krawężnik' }).success, true);
  assert.equal(reports.autoReportSchema.safeParse({ location, locationSource: 'map', type: 'blocked', comment: 'x'.repeat(801) }).success, false);
  assert.equal(reports.autoReportSchema.safeParse({ location: { ...location, lat: 52.2 }, locationSource: 'map', type: 'blocked' }).success, false);
});

test('photo report keeps the first photo as photoPath; at most 4 photos per report', async () => {
  const r = await reports.saveAutoReport(reports.autoReportSchema.parse({ photo, location, locationSource: 'gps', comment: 'Brak podjazdu' }));
  assert.equal(r.analysis, 'failed');
  assert.equal(r.photoPath, `/api/reports/${r.id}/photo`);
  assert.equal(r.photos?.length, 1);
  assert.ok(reports.firstReportPhoto(r.id));
  for (let i = 0; i < 3; i++) {
    const added = await reports.addReportPhoto(r.id, { photo, locale: 'pl' });
    assert.ok(!('error' in added));
    assert.ok(reports.reportPhoto(r.id, added.photo.id));
    assert.equal(added.report.photos?.length, i + 2);
    assert.equal(added.report.photoPath, r.photoPath);
  }
  assert.deepEqual(await reports.addReportPhoto(r.id, { photo, locale: 'pl' }), { error: 'limit' });
  const response = await photosRoute.POST(json(`/api/reports/${r.id}/photos`, 'POST', { photo }), ctx({ id: r.id }));
  assert.equal(response.status, 409);
  assert.deepEqual(await reports.addReportPhoto('missing', { photo, locale: 'pl' }), { error: 'not_found' });
  // Photos are scoped to their report.
  const other = await reports.saveAutoReport(reports.autoReportSchema.parse({ location, locationSource: 'map', type: 'blocked' }));
  await assert.rejects(() => reports.addReportPhoto(other.id, { photo: 'data:image/jpeg;base64,aGVsbG8=', locale: 'pl' }));
  const first = await reports.addReportPhoto(other.id, { photo, locale: 'pl' });
  assert.ok(!('error' in first));
  assert.equal(first.report.photoPath, first.photo.path, 'text-only report gets its first added photo as photoPath');
  assert.ok(reports.firstReportPhoto(other.id));
  assert.equal(reports.reportPhoto(r.id, first.photo.id), null);
  reports.deleteReport(other.id);
  assert.equal(reports.reportPhoto(other.id, first.photo.id), null);
});

test('session cookie: signed, tamper-proof, expires after 12 h, tied to the password', () => {
  const now = Date.now();
  const token = auth.signSession(now);
  assert.ok(auth.verifySession(token, now));
  assert.ok(auth.verifySession(token, now + 11 * 3600_000));
  assert.equal(auth.verifySession(token, now + 12 * 3600_000 + 1000), false);
  const [v, exp, nonce, sig] = token.split('.');
  assert.equal(auth.verifySession(`${v}.${Number(exp) + 3600}.${nonce}.${sig}`, now), false);
  assert.equal(auth.verifySession(`${v}.${exp}.${nonce}.${sig.slice(0, -2)}AA`, now), false);
  assert.equal(auth.verifySession('', now), false);
  assert.equal(auth.verifySession('v1.9999999999.x', now), false);
  process.env.CITY_DASHBOARD_PASSWORD = 'inne-haslo';
  assert.equal(auth.verifySession(token, now), false);
  process.env.CITY_DASHBOARD_PASSWORD = 'test-haslo-miasta';
  assert.ok(auth.verifySession(token, now));
  assert.ok(auth.checkPassword('test-haslo-miasta'));
  assert.equal(auth.checkPassword('test-haslo-miast'), false);
});

test('city APIs require a session; disabled without CITY_DASHBOARD_PASSWORD', async () => {
  const r = await reports.saveAutoReport(reports.autoReportSchema.parse({ location, locationSource: 'map', type: 'blocked' }));
  const cookie = `${auth.CITY_COOKIE}=${auth.signSession()}`;
  assert.equal((await cityReportsRoute.GET(new Request(`${base}/api/city/reports`))).status, 401);
  assert.equal((await csvRoute.GET(new Request(`${base}/api/city/reports.csv`))).status, 401);
  assert.equal((await cityReportRoute.PATCH(json(`/api/city/reports/${r.id}`, 'PATCH', { status: 'resolved' }), ctx({ id: r.id }))).status, 401);
  assert.equal((await cityReportsRoute.GET(new Request(`${base}/api/city/reports`, { headers: { cookie: `${auth.CITY_COOKIE}=forged.token` } }))).status, 401);
  const ok = await cityReportsRoute.GET(new Request(`${base}/api/city/reports?type=blocked`, { headers: { cookie } }));
  assert.equal(ok.status, 200);
  assert.ok(((await ok.json()) as { reports: { id: string }[] }).reports.some(x => x.id === r.id));
  const csv = await csvRoute.GET(new Request(`${base}/api/city/reports.csv`, { headers: { cookie } }));
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type')!, /text\/csv/);
  // Cross-origin writes are refused even with a session.
  assert.equal((await cityReportRoute.PATCH(json(`/api/city/reports/${r.id}`, 'PATCH', { status: 'resolved' }, { origin: 'http://evil.test', cookie }), ctx({ id: r.id }))).status, 403);
  const patched = await cityReportRoute.PATCH(json(`/api/city/reports/${r.id}`, 'PATCH', { status: 'in_review' }, { cookie }), ctx({ id: r.id }));
  assert.equal(patched.status, 200);
  assert.equal((await cityReportRoute.PATCH(json(`/api/city/reports/${r.id}`, 'PATCH', { status: 'done' }, { cookie }), ctx({ id: r.id }))).status, 400);
  const saved = process.env.CITY_DASHBOARD_PASSWORD;
  delete process.env.CITY_DASHBOARD_PASSWORD;
  assert.equal((await cityReportsRoute.GET(new Request(`${base}/api/city/reports`, { headers: { cookie } }))).status, 503);
  process.env.CITY_DASHBOARD_PASSWORD = saved;
});

test('login sets a strict HttpOnly cookie and rate-limits failures', async () => {
  auth.resetLoginLimits();
  const headers = { 'x-forwarded-for': '203.0.113.7' };
  const good = await loginRoute.POST(json('/api/city/login', 'POST', { password: 'test-haslo-miasta' }, headers));
  assert.equal(good.status, 204);
  const setCookie = good.headers.get('set-cookie') ?? '';
  assert.match(setCookie, new RegExp(`^${auth.CITY_COOKIE}=v1\\.`));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Max-Age=43200/);
  for (let i = 0; i < 5; i++) assert.equal((await loginRoute.POST(json('/api/city/login', 'POST', { password: 'zle' }, headers))).status, 401);
  assert.equal((await loginRoute.POST(json('/api/city/login', 'POST', { password: 'test-haslo-miasta' }, headers))).status, 429);
  assert.equal((await loginRoute.POST(json('/api/city/login', 'POST', { password: 'test-haslo-miasta' }, { 'x-forwarded-for': '198.51.100.1' }))).status, 204);
  auth.resetLoginLimits();
});

test('CSV escapes quotes, separators, newlines and spreadsheet formulas', () => {
  assert.equal(csvField('zwykły tekst'), 'zwykły tekst');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('powiedział "nie"'), '"powiedział ""nie"""');
  assert.equal(csvField('linia 1\nlinia 2'), '"linia 1\nlinia 2"');
  assert.equal(csvField('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvField('+48 123'), "'+48 123");
  assert.equal(csvField('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvField(-1.5), '-1.5');
  assert.equal(csvField(undefined), '');
  assert.equal(csvField(' spacja'), '" spacja"');
  const csv = reportsCsv(
    [{ id: 'abc', observation: { kind: 'other', description: 'Opis, z przecinkiem', direction: 'unknown', handrail: 'unknown', surface: 'unknown', uncertainty: '' }, locationId: 'p', photoPath: '/api/reports/abc/photo', obtainedAt: '2026-10-03T10:00:00.000Z', confirmedAt: null, status: 'unverified', source: 'user', type: 'blocked', comment: 'Nie "dało się"\nprzejść', location: { ...location, id: 'p' } }],
    'https://example.test',
  );
  assert.ok(csv.startsWith('﻿id,utworzono,typ,status'));
  const row = csv.split('\r\n')[1];
  assert.ok(row.includes('"Opis, z przecinkiem"'));
  assert.ok(csv.includes('"Nie ""dało się""\nprzejść"'));
  assert.ok(row.includes('Uniemożliwiło dotarcie'));
  assert.ok(row.includes('https://example.test/api/reports/abc/photo'));
});

test('status changes are audited; public view hides the history', async () => {
  const r = await reports.saveAutoReport(reports.autoReportSchema.parse({ location, locationSource: 'map', type: 'blocked', comment: 'Rozkopany chodnik' }));
  const t1 = new Date('2026-10-03T08:00:00Z');
  const a = reports.updateCityReport(r.id, { status: 'in_review' }, t1)!;
  assert.equal(a.cityStatus, 'in_review');
  assert.equal(a.cityUpdatedAt, t1.toISOString());
  assert.deepEqual(a.cityHistory, [{ at: t1.toISOString(), status: 'in_review', note: '' }]);
  // Unchanged values do not add an entry.
  assert.equal(reports.updateCityReport(r.id, { status: 'in_review' }, new Date('2026-10-03T09:00:00Z'))!.cityHistory?.length, 1);
  const t2 = new Date('2026-10-04T08:00:00Z');
  const b = reports.updateCityReport(r.id, { status: 'forwarded', note: 'Przekazano do ZDMK.' }, t2)!;
  assert.equal(b.cityNote, 'Przekazano do ZDMK.');
  assert.equal(b.cityHistory?.length, 2);
  assert.deepEqual(b.cityHistory?.[1], { at: t2.toISOString(), status: 'forwarded', note: 'Przekazano do ZDMK.' });
  const c = reports.updateCityReport(r.id, { note: '' }, new Date('2026-10-05T08:00:00Z'))!;
  assert.equal(c.cityNote, undefined);
  assert.equal(c.cityStatus, 'forwarded');
  assert.equal(c.cityHistory?.length, 3);
  assert.equal(reports.updateCityReport('missing', { status: 'resolved' }), null);
  assert.equal(reports.cityUpdateSchema.safeParse({}).success, false);
  const pub = reports.publicReport(c);
  assert.equal(pub.cityHistory, undefined);
  assert.equal(pub.cityStatus, 'forwarded');
  // Filters used by dashboard and CSV.
  const all = reports.listAllReports();
  assert.ok(filterReports(all, { ...emptyCityFilter, status: 'forwarded' }).every(x => x.cityStatus === 'forwarded'));
  assert.ok(filterReports(all, { ...emptyCityFilter, q: 'rozkopany' }).some(x => x.id === r.id));
  assert.equal(filterReports(all, { ...emptyCityFilter, from: '2099-01-01' }).length, 0);
});
