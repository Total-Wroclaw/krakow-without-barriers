import { z } from 'zod';
import { guard } from '@/lib/server';
import { pointSchema } from '@/lib/city-types';
import { locales } from '@/lib/i18n/locales';
import { listObjectPage } from '@/lib/objects';
export const runtime = 'nodejs';
const categories = ['museum', 'landmark', 'culture', 'office', 'toilet', 'hotel', 'food', 'health', 'park', 'parking', 'other'] as const;
const schema = z.object({
  category: z.enum(categories).optional(),
  q: z.string().trim().max(120).optional(),
  lat: z.coerce.number().pipe(pointSchema.shape.lat).optional(),
  lon: z.coerce.number().pipe(pointSchema.shape.lon).optional(),
  locale: z.enum(locales).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
  withData: z.enum(['0', '1', 'true', 'false']).transform(v => v === '1' || v === 'true').optional(),
}).refine(v => (v.lat === undefined) === (v.lon === undefined));
export async function GET(request: Request) {
  const block = guard(request); if (block) return block;
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: 'Nieprawidłowe parametry wyszukiwania.' }, { status: 400 });
  try {
    // ObjectPage: { objects, total, nextOffset } (nextOffset null on the last page).
    return Response.json(await listObjectPage(parsed.data), { headers: { 'Cache-Control': 'private, max-age=30' } });
  } catch {
    return Response.json({ error: 'Lista miejsc jest chwilowo niedostępna.' }, { status: 503 });
  }
}
