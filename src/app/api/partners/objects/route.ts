import { ZodError } from 'zod';
import { boundedJson, guard } from '@/lib/server';
import { defaultLocale, isLocale } from '@/lib/i18n/locales';
import { PartnerInputError, savePartnerObject } from '@/lib/objects';
export const runtime = 'nodejs';
// Venue owners add accessibility data (prototype of the partner model). Stored as owner-declared, not field-verified.
export async function POST(request: Request) {
  const block = guard(request, true); if (block) return block;
  const locale = new URL(request.url).searchParams.get('locale');
  try {
    const object = await savePartnerObject(await boundedJson(request), isLocale(locale) ? locale : defaultLocale);
    return Response.json({ object }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) return Response.json({ error: 'Sprawdź nazwę, kategorię, położenie w Krakowie, e-mail kontaktowy i opis dostępności.', fields: error instanceof ZodError ? [...new Set(error.issues.map(i => i.path.join('.')))] : [] }, { status: 400 });
    if (error instanceof PartnerInputError) return Response.json({ error: 'Nie znaleziono wskazanego miejsca.', fields: [error.message] }, { status: 400 });
    return Response.json({ error: 'Nie udało się zapisać danych. Spróbuj ponownie.' }, { status: 500 });
  }
}
