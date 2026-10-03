import { ZodError } from 'zod';
import { boundedJson, guard } from '@/lib/server';
import { requestLocale } from '@/lib/i18n/request-locale';
import { serverMessages } from '@/lib/i18n/server-messages';
import { PartnerInputError, partnerFieldErrors, savePartnerObject } from '@/lib/objects';
export const runtime = 'nodejs';

// Venue owners add accessibility data (prototype of the partner model). Stored as owner-declared, not field-verified.
// Body: PartnerSubmission (+ optional locale) → 201 { object }; 400 { error, fields: [{ path, message }] }.
export async function POST(request: Request) {
  const block = guard(request, true); if (block) return block;
  let body: unknown;
  try {
    body = await boundedJson(request);
  } catch {}
  const locale = requestLocale(request, body);
  const m = serverMessages(locale).api.partner;
  try {
    const object = await savePartnerObject(body, locale);
    return Response.json({ object }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: m.invalid, fields: partnerFieldErrors(error, m.fields) }, { status: 400 });
    if (error instanceof PartnerInputError) return Response.json({ error: m.notFound, fields: [{ path: error.message, message: m.fields.existingObjectId }] }, { status: 400 });
    return Response.json({ error: m.saveFailed }, { status: 500 });
  }
}
