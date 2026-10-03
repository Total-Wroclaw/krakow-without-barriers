import { z } from 'zod';
import { draftPhoto, draftPreferences } from '@/lib/ai';
import { locales } from '@/lib/i18n/locales';
import { preferencesSchema } from '@/lib/schemas';
import { boundedJson, guard } from '@/lib/server';
import { apiMessages } from '@/lib/i18n/request-locale';
export const runtime = 'nodejs';

const locale = z.enum(locales).default('pl');
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preferences'), text: z.string().min(2).max(1500), base: preferencesSchema, locale }),
  z.object({ action: z.literal('photo'), photo: z.string().max(4_500_000), locale }),
]);

export async function POST(request: Request) {
  const block = guard(request, true);
  if (block) return block;
  let body: unknown;
  try {
    body = await boundedJson(request);
    const input = schema.parse(body);
    const result = input.action === 'preferences' ? await draftPreferences(input.text, input.base, input.locale) : await draftPhoto(input.photo, input.locale);
    return Response.json({ result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const m = apiMessages(request, body).ai;
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: m.badRequest }, { status: 400 });
    // No provider exception details or user inputs enter logs/responses.
    return Response.json({ error: m.unavailable }, { status: 503 });
  }
}
