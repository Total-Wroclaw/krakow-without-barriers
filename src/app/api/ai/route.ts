import { z } from 'zod';
import { draftPhoto, draftPreferences } from '@/lib/ai';
import { locales } from '@/lib/i18n/locales';
import { preferencesSchema } from '@/lib/schemas';
import { boundedJson, guard } from '@/lib/server';
export const runtime = 'nodejs';

const locale = z.enum(locales).default('pl');
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preferences'), text: z.string().min(2).max(1500), base: preferencesSchema, locale }),
  z.object({ action: z.literal('photo'), photo: z.string().max(4_500_000), locale }),
]);

export async function POST(request: Request) {
  const block = guard(request, true);
  if (block) return block;
  try {
    const input = schema.parse(await boundedJson(request));
    const result = input.action === 'preferences' ? await draftPreferences(input.text, input.base, input.locale) : await draftPhoto(input.photo, input.locale);
    return Response.json({ result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'Sprawdź treść formularza.' }, { status: 400 });
    // No provider exception details or user inputs enter logs/responses.
    return Response.json({ error: 'AI nie jest teraz dostępne. Spróbuj ponownie albo ustaw potrzeby ręcznie.' }, { status: 503 });
  }
}
