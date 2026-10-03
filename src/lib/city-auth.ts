// Access to the city office dashboard (/city, /api/city/*): one shared password from
// CITY_DASHBOARD_PASSWORD, exchanged for a signed HttpOnly session cookie (HMAC-SHA256, 12 h).
// No user accounts in the prototype; see docs/ARCHITECTURE.md.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { clientIp } from './client-ip';
import { apiMessages } from './i18n/request-locale';

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
  const m = apiMessages(request).city;
  if (!cityEnabled()) return Response.json({ error: m.disabled }, { status: 503 });
  if (!verifySession(cookieFrom(request))) return Response.json({ error: m.loginRequired }, { status: 401 });
  return null;
}

// Failed-login limiter.
// - Per client (see client-ip.ts): 5 failures per 15 min, then 429 for that client.
// - Globally (many addresses, e.g. a botnet): no hard lock, which would let anyone lock staff out.
//   After GLOBAL_FREE failures in the window, every login attempt is delayed by 250 ms per extra failure,
//   up to MAX_DELAY_MS, which caps the guessing rate without refusing the right password.
const WINDOW = 15 * 60_000;
const PER_CLIENT = 5;
const GLOBAL_FREE = 20;
const MAX_DELAY_MS = 3000;
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
  return clientIp(request);
}
export function loginBlocked(client: string, now = Date.now()) {
  return bucket(`c:${client}`, now).count >= PER_CLIENT;
}
/** Delay before answering a login attempt while many failures happen city-wide. */
export function loginDelayMs(now = Date.now()) {
  const extra = bucket('all', now).count - GLOBAL_FREE;
  return extra > 0 ? Math.min(MAX_DELAY_MS, extra * 250) : 0;
}
export function recordFailure(client: string, now = Date.now()) {
  bucket(`c:${client}`, now).count++;
  bucket('all', now).count++;
}
export function resetLoginLimits() {
  failures.clear();
}
