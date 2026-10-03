import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkPassword, cityEnabled, clientKey, loginBlocked, recordFailure, sessionCookie, signSession } from '@/lib/city-auth';
import { boundedJson, guard } from '@/lib/server';
export const runtime = 'nodejs';

/** { password } → 204 + HttpOnly session cookie. 5 failed attempts per client per 15 min. */
export async function POST(request: Request) {
  const block = guard(request);
  if (block) return block;
  if (!cityEnabled()) return Response.json({ error: 'Panel miasta jest wyłączony. Ustaw CITY_DASHBOARD_PASSWORD.' }, { status: 503 });
  const client = clientKey(request);
  if (loginBlocked(client)) return Response.json({ error: 'Zbyt wiele nieudanych prób. Spróbuj za 15 minut.' }, { status: 429 });
  let password = '';
  try {
    password = z.object({ password: z.string().max(200) }).parse(await boundedJson(request)).password;
  } catch {
    return Response.json({ error: 'Podaj hasło.' }, { status: 400 });
  }
  if (!checkPassword(password)) {
    recordFailure(client);
    return Response.json({ error: 'Nieprawidłowe hasło.' }, { status: 401 });
  }
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(sessionCookie(signSession()));
  return response;
}
