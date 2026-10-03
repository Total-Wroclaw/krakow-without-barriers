import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.KROK_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'krok-security-test-'));
delete process.env.OPENAI_API_KEY;
process.env.OPENAI_ENV_FILE = path.join(process.env.KROK_STORAGE_DIR, 'missing.env');
process.env.CITY_DASHBOARD_PASSWORD = 'test-haslo-miasta';
process.env.KROK_DEMO_PARTNER = '0';

const sharp = (await import('sharp')).default;
const { db, guard } = await import('../src/lib/server');
const reports = await import('../src/lib/reports-server');
const auth = await import('../src/lib/city-auth');
const { clientIp } = await import('../src/lib/client-ip');
const { acceptLanguage, requestLocale } = await import('../src/lib/i18n/request-locale');
const { partnerSubmissionSchema } = await import('../src/lib/objects');
const { initialVisibility } = await import('../src/lib/report-photos');
const autoRoute = await import('../src/app/api/reports/auto/route');
const reportRoute = await import('../src/app/api/reports/[id]/route');
const photosRoute = await import('../src/app/api/reports/[id]/photos/route');
const listRoute = await import('../src/app/api/reports/route');
const publicPhotoRoute = await import('../src/app/api/reports/[id]/photo/route');
const publicPhotoByIdRoute = await import('../src/app/api/reports/[id]/photos/[photoId]/route');
const cityPhotoRoute = await import('../src/app/api/city/reports/[id]/photos/[photoId]/route');
const cityReportsRoute = await import('../src/app/api/city/reports/route');
const partnerRoute = await import('../src/app/api/partners/objects/route');

const base = 'http://localhost:3030';
const location = { id: 'x', name: 'Rondo Mogilskie', lat: 50.0659, lon: 19.9592, source: 'Test' };
const photo = `data:image/png;base64,${(await sharp({ create: { width: 40, height: 30, channels: 3, background: '#888' } }).png().toBuffer()).toString('base64')}`;
const request = (url: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`${base}${url}`, { method, headers: { 'content-type': 'application/json', origin: base, host: 'localhost:3030', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const cookie = () => `${auth.CITY_COOKIE}=${auth.signSession()}`;
const observation = { kind: 'other', description: 'Wysoki krawężnik przy przejściu', direction: 'unknown', handrail: 'unknown', surface: 'unknown', uncertainty: '' };

async function createReport(body: Record<string, unknown> = { location, locationSource: 'map', type: 'blocked', comment: 'Rozkopany chodnik' }) {
  const response = await autoRoute.POST(request('/api/reports/auto', 'POST', body));
  assert.equal(response.status, 201);
  return (await response.json()) as { report: { id: string; photos?: { id: string; path?: string; hidden?: boolean; reason?: string }[]; photoPath: string | null }; editToken: string };
}

test.after(() => {
  db().close();
  rmSync(process.env.KROK_STORAGE_DIR!, { recursive: true, force: true });
});

test('creating a report returns an edit token once; only its hash is stored, outside the body', async () => {
  const { report, editToken } = await createReport();
  assert.match(editToken, /^[A-Za-z0-9_-]{43}$/);
  const row = db().prepare('SELECT body, edit_hash FROM reports WHERE id=?').get(report.id) as { body: string; edit_hash: string };
  assert.match(row.edit_hash, /^[0-9a-f]{64}$/);
  assert.ok(!row.body.includes(row.edit_hash) && !row.body.includes(editToken));
  const listed = await (await listRoute.GET(new Request(`${base}/api/reports`))).text();
  assert.ok(!listed.includes(row.edit_hash) && !listed.includes(editToken));
  assert.equal(reports.checkEditToken(report.id, editToken), 'ok');
  assert.equal(reports.checkEditToken(report.id, `${editToken}x`), 'forbidden');
  assert.equal(reports.checkEditToken('missing', editToken), 'not_found');
});

test('PATCH, DELETE and photo upload require the author token', async () => {
  const { report, editToken } = await createReport();
  const id = report.id;
  // Unknown id → 404, missing or wrong token → 403.
  assert.equal((await reportRoute.PATCH(request('/api/reports/missing', 'PATCH', { observation }, { 'x-report-token': editToken }), ctx({ id: 'missing' }))).status, 404);
  assert.equal((await reportRoute.PATCH(request(`/api/reports/${id}`, 'PATCH', { observation }), ctx({ id }))).status, 403);
  assert.equal((await reportRoute.PATCH(request(`/api/reports/${id}`, 'PATCH', { observation }, { 'x-report-token': 'nope' }), ctx({ id }))).status, 403);
  assert.equal((await reportRoute.DELETE(request(`/api/reports/${id}`, 'DELETE'), ctx({ id }))).status, 403);
  assert.equal((await photosRoute.POST(request(`/api/reports/${id}/photos`, 'POST', { photo }), ctx({ id }))).status, 403);
  // Another report's token does not work.
  const other = await createReport();
  assert.equal((await reportRoute.DELETE(request(`/api/reports/${id}`, 'DELETE', undefined, { 'x-report-token': other.editToken }), ctx({ id }))).status, 403);
  // Localised errors: body locale, then Accept-Language.
  const en = await reportRoute.PATCH(request(`/api/reports/${id}`, 'PATCH', { observation, locale: 'en' }), ctx({ id }));
  assert.equal(((await en.json()) as { error: string }).error, 'You can only change reports sent from this device.');
  const de = await reportRoute.DELETE(request(`/api/reports/${id}`, 'DELETE', undefined, { 'accept-language': 'de-DE,de;q=0.9' }), ctx({ id }));
  assert.match(((await de.json()) as { error: string }).error, /Gerät/);
  // Correct token.
  const patched = await reportRoute.PATCH(request(`/api/reports/${id}`, 'PATCH', { observation }, { 'x-report-token': editToken }), ctx({ id }));
  assert.equal(patched.status, 200);
  const added = await photosRoute.POST(request(`/api/reports/${id}/photos`, 'POST', { photo }, { 'x-report-token': editToken }), ctx({ id }));
  assert.equal(added.status, 201);
  assert.equal((await reportRoute.DELETE(request(`/api/reports/${id}`, 'DELETE', undefined, { 'x-report-token': editToken }), ctx({ id }))).status, 200);
  assert.equal((await reportRoute.DELETE(request(`/api/reports/${id}`, 'DELETE', undefined, { 'x-report-token': editToken }), ctx({ id }))).status, 404);
});

test('once the city handles a report the author cannot delete it but can still add photos', async () => {
  const { report, editToken } = await createReport();
  reports.updateCityReport(report.id, { status: 'in_review' });
  const del = await reportRoute.DELETE(request(`/api/reports/${report.id}`, 'DELETE', undefined, { 'x-report-token': editToken }), ctx({ id: report.id }));
  assert.equal(del.status, 409);
  assert.match(((await del.json()) as { error: string }).error, /Miasto zajmuje się już/);
  const added = await photosRoute.POST(request(`/api/reports/${report.id}/photos`, 'POST', { photo, locale: 'pl' }, { 'x-report-token': editToken }), ctx({ id: report.id }));
  assert.equal(added.status, 201);
});

test('photos are hidden unless the AI saw no people; the city can view and publish them', async () => {
  assert.equal(initialVisibility('none'), 'public');
  assert.equal(initialVisibility('present'), 'hidden');
  assert.equal(initialVisibility('unclear'), 'hidden');
  assert.equal(initialVisibility(undefined), 'hidden');
  // No AI in tests → analysis failed → hidden.
  const { report } = await createReport({ photo, location, locationSource: 'gps', comment: 'Brak podjazdu' });
  const id = report.id;
  assert.equal(report.photoPath, null);
  assert.deepEqual(report.photos?.map(p => ({ id: p.id, hidden: p.hidden, reason: p.reason, path: p.path })), [{ id: 'main', hidden: true, reason: 'privacy', path: undefined }]);
  assert.equal((await publicPhotoRoute.GET(new Request(`${base}/api/reports/${id}/photo`), ctx({ id }))).status, 404);
  assert.equal((await publicPhotoByIdRoute.GET(new Request(`${base}/api/reports/${id}/photos/main`), ctx({ id, photoId: 'main' }))).status, 404);
  // City only.
  assert.equal((await cityPhotoRoute.GET(new Request(`${base}/api/city/reports/${id}/photos/main`), ctx({ id, photoId: 'main' }))).status, 401);
  const seen = await cityPhotoRoute.GET(new Request(`${base}/api/city/reports/${id}/photos/main`, { headers: { cookie: cookie() } }), ctx({ id, photoId: 'main' }));
  assert.equal(seen.status, 200);
  assert.equal(seen.headers.get('content-type'), 'image/jpeg');
  const listed = (await (await cityReportsRoute.GET(new Request(`${base}/api/city/reports`, { headers: { cookie: cookie() } }))).json()) as { reports: { id: string; photoPath: string; photos: { path: string; visibility: string }[] }[] };
  const mine = listed.reports.find(r => r.id === id)!;
  assert.equal(mine.photoPath, `/api/city/reports/${id}/photos/main`);
  assert.equal(mine.photos[0].visibility, 'hidden');
  // Approve: needs a session and a valid value.
  assert.equal((await cityPhotoRoute.PATCH(request(`/api/city/reports/${id}/photos/main`, 'PATCH', { visibility: 'public' }), ctx({ id, photoId: 'main' }))).status, 401);
  assert.equal((await cityPhotoRoute.PATCH(request(`/api/city/reports/${id}/photos/main`, 'PATCH', { visibility: 'maybe' }, { cookie: cookie() }), ctx({ id, photoId: 'main' }))).status, 400);
  assert.equal((await cityPhotoRoute.PATCH(request(`/api/city/reports/${id}/photos/nope`, 'PATCH', { visibility: 'public' }, { cookie: cookie() }), ctx({ id, photoId: 'nope' }))).status, 404);
  const approved = await cityPhotoRoute.PATCH(request(`/api/city/reports/${id}/photos/main`, 'PATCH', { visibility: 'public' }, { cookie: cookie() }), ctx({ id, photoId: 'main' }));
  assert.equal(approved.status, 200);
  const body = (await approved.json()) as { report: { cityHistory: { photo?: { id: string; visibility: string } }[] } };
  assert.deepEqual(body.report.cityHistory.at(-1)?.photo, { id: 'main', visibility: 'public' });
  assert.equal((await publicPhotoRoute.GET(new Request(`${base}/api/reports/${id}/photo`), ctx({ id }))).status, 200);
  const pub = reports.publicReport(reports.listAllReports().find(r => r.id === id)!);
  assert.equal(pub.photoPath, `/api/reports/${id}/photo`);
  assert.equal(pub.photos?.[0].hidden, undefined);
  // Hide again.
  reports.setPhotoVisibility(id, 'main', 'hidden');
  assert.equal((await publicPhotoRoute.GET(new Request(`${base}/api/reports/${id}/photo`), ctx({ id }))).status, 404);
});

test('guard: cross-site requests without Origin are refused; production requires a same-origin proof', () => {
  const post = (headers: Record<string, string>) => new Request(`${base}/api/reports`, { method: 'POST', headers: { host: 'localhost:3030', ...headers } });
  assert.equal(guard(post({ 'sec-fetch-site': 'cross-site' }))?.status, 403);
  assert.equal(guard(post({ 'sec-fetch-site': 'same-site' }))?.status, 403);
  assert.equal(guard(post({})), null, 'tools and tests outside production');
  assert.equal(guard(post({ origin: 'http://evil.test' }))?.status, 403);
  const env = process.env as Record<string, string | undefined>;
  const saved = env.NODE_ENV;
  env.NODE_ENV = 'production';
  try {
    assert.equal(guard(post({}))?.status, 403);
    assert.equal(guard(post({ referer: 'http://evil.test/page' }))?.status, 403);
    assert.equal(guard(post({ referer: 'http://localhost:3030/city' })), null);
    assert.equal(guard(post({ origin: 'http://localhost:3030' })), null);
    assert.equal(guard(post({ 'sec-fetch-site': 'same-origin' })), null);
    assert.equal(guard(new Request(`${base}/api/places?q=ab`, { headers: { host: 'localhost:3030' } })), null, 'GET needs no proof');
  } finally {
    env.NODE_ENV = saved;
  }
});

test('client IP: Cloudflare header, else the last X-Forwarded-For entry added by our proxy', () => {
  const ip = (headers: Record<string, string>) => clientIp(new Request(base, { headers }));
  assert.equal(ip({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.1.1.1, 198.51.100.2' }), '203.0.113.9');
  assert.equal(ip({ 'x-forwarded-for': '6.6.6.6, 198.51.100.2' }), '198.51.100.2', 'spoofed first entry is ignored');
  assert.equal(ip({ 'x-forwarded-for': '2001:db8::1' }), '2001:db8::1');
  assert.equal(ip({}), 'local');
  // Rotating a spoofed first entry does not escape the AI limit.
  for (let i = 0; i < 20; i++) assert.equal(guard(new Request(`${base}/api/ai`, { headers: { 'x-forwarded-for': `10.0.0.${i}, 192.0.2.50` } }), true), null);
  assert.equal(guard(new Request(`${base}/api/ai`, { headers: { 'x-forwarded-for': '10.9.9.9, 192.0.2.50' } }), true)?.status, 429);
});

test('login: per-client lock, global slowdown instead of a global lock-out', () => {
  auth.resetLoginLimits();
  const now = Date.now();
  for (let i = 0; i < 60; i++) auth.recordFailure(`198.51.100.${i % 30}`, now);
  assert.equal(auth.loginBlocked('192.0.2.1', now), false, 'a fresh client is never locked out by others');
  assert.equal(auth.loginDelayMs(now), 3000);
  for (let i = 0; i < 5; i++) auth.recordFailure('192.0.2.7', now);
  assert.equal(auth.loginBlocked('192.0.2.7', now), true);
  auth.resetLoginLimits();
  assert.equal(auth.loginDelayMs(now), 0);
});

test('request locale: body, then ?locale, then Accept-Language, else Polish', () => {
  assert.equal(acceptLanguage('de-DE,de;q=0.9,en;q=0.8'), 'de');
  assert.equal(acceptLanguage('fr-FR,fr;q=0.9,en;q=0.5'), 'en');
  assert.equal(acceptLanguage('fr'), null);
  assert.equal(acceptLanguage('en;q=0.2, de;q=0.8'), 'de');
  const r = new Request(`${base}/x?locale=en`, { headers: { 'accept-language': 'de' } });
  assert.equal(requestLocale(r, { locale: 'de' }), 'de');
  assert.equal(requestLocale(r, {}), 'en');
  assert.equal(requestLocale(new Request(`${base}/x`, { headers: { 'accept-language': 'de' } })), 'de');
  assert.equal(requestLocale(new Request(`${base}/x`)), 'pl');
});

test('partner form: optional locale accepted (still strict otherwise); localised field errors', async () => {
  const valid = { name: 'Kawiarnia Testowa', category: 'food', lat: 50.06, lon: 19.94, contactEmail: 'owner@example.com', features: [], promote: false, plan: 'free' };
  assert.equal(partnerSubmissionSchema.safeParse({ ...valid, locale: 'en' }).success, true);
  assert.equal(partnerSubmissionSchema.safeParse({ ...valid, locale: 'fr' }).success, false);
  assert.equal(partnerSubmissionSchema.safeParse({ ...valid, admin: true }).success, false);
  const bad = await partnerRoute.POST(request('/api/partners/objects', 'POST', { ...valid, contactEmail: 'nope', lat: 52, admin: true, locale: 'en' }));
  assert.equal(bad.status, 400);
  const body = (await bad.json()) as { error: string; fields: { path: string; message: string }[] };
  assert.equal(body.error, 'Correct the highlighted fields.');
  assert.deepEqual(Object.fromEntries(body.fields.map(f => [f.path, f.message])), { contactEmail: 'Enter a valid e-mail address.', lat: 'Choose a place in Kraków.', admin: 'The form contains unknown fields.' });
  const ok = await partnerRoute.POST(request('/api/partners/objects', 'POST', { ...valid, locale: 'de' }));
  assert.equal(ok.status, 201);
  assert.equal(((await ok.json()) as { object: { categoryLabel: string } }).object.categoryLabel.length > 0, true);
});

test('city filters: from later than to is a localised 400', async () => {
  const response = await cityReportsRoute.GET(new Request(`${base}/api/city/reports?from=2026-10-05&to=2026-10-01`, { headers: { cookie: cookie() } }));
  assert.equal(response.status, 400);
  assert.match(((await response.json()) as { error: string }).error, /od/);
  assert.equal((await cityReportsRoute.GET(new Request(`${base}/api/city/reports?from=2026-10-01&to=2026-10-01`, { headers: { cookie: cookie() } }))).status, 200);
});
