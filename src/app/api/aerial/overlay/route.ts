import { roundPoint } from '@/lib/aerial-geo';
import { overlayAt } from '@/lib/aerial';
import { aerialQuerySchema } from '@/lib/aerial-types';
import { guard } from '@/lib/server';
export const runtime = 'nodejs';

/** GET /api/aerial/overlay?lat=&lon= — sourced facts to draw over the photo (no AI). */
export async function GET(request: Request) {
  const block = guard(request);
  if (block) return block;
  const parsed = aerialQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: 'Wybierz miejsce w Krakowie.' }, { status: 400 });
  return Response.json(await overlayAt(roundPoint(parsed.data)), { headers: { 'Cache-Control': 'public, max-age=600' } });
}
