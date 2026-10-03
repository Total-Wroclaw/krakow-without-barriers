import { z } from 'zod';
import { DEFAULT_WIDTH, roundPoint } from '@/lib/aerial-geo';
import { aerialQuerySchema, widthSchema } from '@/lib/aerial-types';
import { orthoCrop } from '@/lib/imagery';
import { guard } from '@/lib/server';
export const runtime = 'nodejs';

const schema = aerialQuerySchema.extend({ w: widthSchema.default(DEFAULT_WIDTH) });

/** GET /api/aerial/image?lat=&lon=&w= — the orthophoto crop (w = frame width step in metres) as JPEG, cacheable by the browser. */
export async function GET(request: Request) {
  const block = guard(request);
  if (block) return block;
  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(Object.fromEntries(new URL(request.url).searchParams));
  } catch {
    return Response.json({ error: 'Wybierz miejsce w Krakowie.' }, { status: 400 });
  }
  try {
    const jpeg = await orthoCrop(roundPoint(input), input.w);
    return new Response(new Uint8Array(jpeg), {
      headers: {
        'Content-Type': 'image/jpeg',
        // The orthophoto changes every few years; the URL fully identifies the crop.
        'Cache-Control': 'public, max-age=2592000, stale-while-revalidate=604800',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return Response.json({ error: 'Ortofotomapa GUGiK jest teraz niedostępna.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
