import { guard } from '@/lib/server';
import { currentWeather } from '@/lib/weather';
export const runtime = 'nodejs';

/** GET /api/aerial/weather — current weather in Kraków (Open-Meteo, CC BY 4.0), cached 15 minutes on the server. */
export async function GET(request: Request) {
  const block = guard(request);
  if (block) return block;
  const weather = await currentWeather();
  if (!weather) return Response.json({ error: 'Pogoda jest teraz niedostępna.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  return Response.json(weather, { headers: { 'Cache-Control': 'public, max-age=600' } });
}
