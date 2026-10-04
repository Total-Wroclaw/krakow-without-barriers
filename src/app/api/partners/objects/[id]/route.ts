import { ZodError } from 'zod';
import { boundedJson, guard } from '@/lib/server';
import { requestLocale } from '@/lib/i18n/request-locale';
import { serverMessages } from '@/lib/i18n/server-messages';
import { partnerFieldErrors, readPartnerDeclaration, updatePartnerObject, withdrawPartnerObject, type PartnerAccess } from '@/lib/objects';
export const runtime = 'nodejs';

// Correct or withdraw an owner's declaration. No accounts: the edit token returned by POST proves "same browser as
// the submitter" (it is not a proof of owning the venue). 404 unknown/withdrawn/demo id, 403 wrong or missing token.
const TOKEN_HEADER = 'x-partner-token';
type Context = { params: Promise<{ id: string }> };

const denied = (access: PartnerAccess, m: ReturnType<typeof serverMessages>['api']['partner']) =>
  access === 'not_found' ? Response.json({ error: m.declNotFound }, { status: 404 })
    : access === 'forbidden' ? Response.json({ error: m.declForbidden }, { status: 403 })
      : null;

/** → { declaration } the owner's own record incl. the private contact e-mail, to prefill the correction form. */
export async function GET(request: Request, { params }: Context) {
  const block = guard(request); if (block) return block;
  const { id } = await params;
  const m = serverMessages(requestLocale(request)).api.partner;
  const { access, record } = await readPartnerDeclaration(id, request.headers.get(TOKEN_HEADER));
  const no = denied(access, m); if (no) return no;
  return Response.json({ declaration: record }, { headers: { 'Cache-Control': 'no-store' } });
}

/** Body: PartnerSubmission (as for create; existingObjectId is ignored) → 200 { object }; 400 like create. */
export async function PATCH(request: Request, { params }: Context) {
  const block = guard(request, true); if (block) return block;
  const { id } = await params;
  let body: unknown;
  try {
    body = await boundedJson(request);
  } catch {}
  const locale = requestLocale(request, body);
  const m = serverMessages(locale).api.partner;
  try {
    const { access, object } = await updatePartnerObject(id, request.headers.get(TOKEN_HEADER), body, locale);
    const no = denied(access, m); if (no) return no;
    return Response.json({ object: object ?? null }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: m.invalid, fields: partnerFieldErrors(error, m.fields) }, { status: 400 });
    return Response.json({ error: m.saveFailed }, { status: 500 });
  }
}

/** Soft delete: the declaration leaves the catalogue, the record stays for audit (without the contact e-mail). */
export async function DELETE(request: Request, { params }: Context) {
  const block = guard(request, true); if (block) return block;
  const { id } = await params;
  const m = serverMessages(requestLocale(request)).api.partner;
  try {
    const access = await withdrawPartnerObject(id, request.headers.get(TOKEN_HEADER));
    const no = denied(access, m); if (no) return no;
    return Response.json({ withdrawn: true });
  } catch {
    return Response.json({ error: m.saveFailed }, { status: 500 });
  }
}
