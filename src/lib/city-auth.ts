// Access to the city office dashboard (/city, /api/city/*): one shared password from
// CITY_DASHBOARD_PASSWORD, exchanged for a signed HttpOnly session cookie (HMAC-SHA256, 12 h).
// No user accounts in the prototype; see docs/ARCHITECTURE.md.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const CITY_COOKIE = 'kk_city';
export const CITY_SESSION_SECONDS = 12 * 60 * 60;

export function cityPassword() {
  const value = process.env.CITY_DASHBOARD_PASSWORD?.trim();
  return value ? value : null;
}
export function cityEnabled() {
  return cityPassword() !== null;
}

/** CITY_DASHBOARD_SECRET if set, otherwise derived from the password (changing it logs everyone out). */
function secret() {
  const password = cityPassword();
  if (!password) return null;
  const explicit = process.env.CITY_DASHBOARD_SECRET?.trim();
  return createHash('sha256').update(explicit ? `secret:${explicit}` : `kazdy-krok-city:${password}`).digest();
}

function hmac(key: Buffer, payload: string) {
  return createHmac('sha256', key).update(payload).digest('base64url');
}
function same(a: string, b: string) {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y) && a.length === b.length;
}

export function checkPassword(input: string) {
  const password = cityPassword();
  return !!password && same(input, password);
}

/** Token: v1.<expiry seconds>.<nonce>.<signature> */
export function signSession(now = Date.now()) {
  const key = secret();
  if (!key) throw new Error('City dashboard disabled');
  const payload = `v1.${Math.floor(now / 1000) + CITY_SESSION_SECONDS}.${randomBytes(12).toString('base64url')}`;
  return `${payload}.${hmac(key, payload)}`;
}

export function verifySession(token: string | undefined | null, now = Date.now()) {
  const key = secret();
  if (!key || !token) return false;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1' || !/^\d{1,12}$/.test(parts[1])) return false;
  const payload = parts.slice(0, 3).join('.');
  if (!same(parts[3], hmac(key, payload))) return false;
  return Number(parts[1]) * 1000 > now;
}

export function cookieFrom(request: Request) {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === CITY_COOKIE) return value.join('=');
  }
  return null;
}

export function sessionCookie(token: string) {
  return { name: CITY_COOKIE, value: token, httpOnly: true, sameSite: 'strict' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: CITY_SESSION_SECONDS };
}

/** null when the request carries a valid session; otherwise the response to return. */
export function requireCity(request: Request): Response | null {
  if (!cityEnabled()) return Response.json({ error: 'Panel miasta jest wyłączony. Ustaw CITY_DASHBOARD_PASSWORD.' }, { status: 503 });
  if (!verifySession(cookieFrom(request))) return Response.json({ error: 'Zaloguj się do panelu miasta.' }, { status: 401 });
  return null;
}

// Failed-login limiter: 5 per client per 15 min, plus 50 overall (X-Forwarded-For can be spoofed).
const WINDOW = 15 * 60_000;
const failures = new Map<string, { count: number; until: number }>();
function bucket(key: string, now: number) {
  const value = failures.get(key);
  if (value && value.until > now) return value;
  if (failures.size > 5000) failures.clear();
  const fresh = { count: 0, until: now + WINDOW };
  failures.set(key, fresh);
  return fresh;
}
export function clientKey(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
}
export function loginBlocked(client: string, now = Date.now()) {
  return bucket(`c:${client}`, now).count >= 5 || bucket('all', now).count >= 50;
}
export function recordFailure(client: string, now = Date.now()) {
  bucket(`c:${client}`, now).count++;
  bucket('all', now).count++;
}
export function resetLoginLimits() {
  failures.clear();
}
