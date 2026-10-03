import { z } from 'zod';
import { describeAerial } from '@/lib/ai';
import { pointSchema } from '@/lib/city-types';
import { locales } from '@/lib/i18n/locales';
import { orthoCrop } from '@/lib/imagery';
import { boundedJson, guard } from '@/lib/server';
export const runtime = 'nodejs';

const schema = pointSchema.extend({ name: z.string().trim().min(1).max(200), locale: z.enum(locales).default('pl') });

export async function POST(request: Request) {
  const block = guard(request, true);
  if (block) return block;
  let input;
  try {
    input = schema.parse(await boundedJson(request));
  } catch {
    return Response.json({ error: 'Wybierz miejsce w Krakowie.' }, { status: 400 });
  }
  let jpeg: Buffer;
  try {
    jpeg = await orthoCrop(input);
  } catch {
    return Response.json({ error: 'Ortofotomapa GUGiK jest teraz niedostępna.' }, { status: 503 });
  }
  const image = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  const meta = { image, obtainedAt: new Date().toISOString(), source: 'GUGiK ortofotomapa (WMS StandardResolution)', photoDate: null };
  try {
    return Response.json({ ...meta, draft: await describeAerial(jpeg, input.name, input.locale) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // The image is still useful on its own when AI is unavailable.
    return Response.json({ ...meta, draft: null }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
