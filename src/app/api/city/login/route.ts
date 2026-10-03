import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkPassword, cityEnabled, clientKey, loginBlocked, loginDelayMs, recordFailure, sessionCookie, signSession } from '@/lib/city-auth';
import { apiMessages } from '@/lib/i18n/request-locale';
import { boundedJson, guard } from '@/lib/server';
export const runtime = 'nodejs';

/** { password } → 204 + HttpOnly session cookie. 5 failed attempts per client per 15 min; global slowdown (see city-auth.ts). */
export async function POST(request: Request) {
  const block = guard(request);
  if (block) return block;
  const m = apiMessages(request).city;
  if (!cityEnabled()) return Response.json({ error: m.disabled }, { status: 503 });
  const client = clientKey(request);
  if (loginBlocked(client)) return Response.json({ error: m.loginBlocked }, { status: 429 });
  const delay = loginDelayMs();
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  let password = '';
  try {
    password = z.object({ password: z.string().max(200) }).parse(await boundedJson(request)).password;
  } catch {
    return Response.json({ error: m.passwordRequired }, { status: 400 });
  }
  if (!checkPassword(password)) {
    recordFailure(client);
    return Response.json({ error: m.wrongPassword }, { status: 401 });
  }
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(sessionCookie(signSession()));
  return response;
}
