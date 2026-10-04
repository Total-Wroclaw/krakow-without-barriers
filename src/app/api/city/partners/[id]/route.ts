import { z } from 'zod';
import { requireCity } from '@/lib/city-auth';
import { apiMessages } from '@/lib/i18n/request-locale';
import { setPartnerHidden } from '@/lib/objects';
import { boundedJson, guard } from '@/lib/server';
export const runtime = 'nodejs';

/** { hidden: boolean } → { partner }. Hidden declarations leave the catalogue but stay stored for audit. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const block = guard(request);
  if (block) return block;
  const denied = requireCity(request);
  if (denied) return denied;
  const { id } = await params;
  const m = apiMessages(request);
  const input = z.object({ hidden: z.boolean() }).strict().safeParse(await boundedJson(request).catch(() => null));
  if (!input.success) return Response.json({ error: m.city.updateInvalid }, { status: 400 });
  const partner = await setPartnerHidden(id, input.data.hidden);
  if (!partner) return Response.json({ error: m.partner.declNotFound }, { status: 404 });
  return Response.json({ partner });
}
