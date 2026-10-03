import { requireCity } from '@/lib/city-auth';
import { apiMessages } from '@/lib/i18n/request-locale';
import { cityReport, photoHeaders, photoVisibilitySchema, reportPhoto, setPhotoVisibility } from '@/lib/reports-server';
import { boundedJson, guard } from '@/lib/server';
export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string; photoId: string }> };

/** Any photo of a report, including hidden ones (city session only). */
export async function GET(request: Request, { params }: Context) {
  const denied = requireCity(request);
  if (denied) return denied;
  const { id, photoId } = await params;
  const photo = reportPhoto(id, photoId);
  if (!photo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(photo), { headers: photoHeaders });
}

/** { visibility: 'public' | 'hidden' } → { report } (city view); recorded in cityHistory. */
export async function PATCH(request: Request, { params }: Context) {
  const block = guard(request);
  if (block) return block;
  const denied = requireCity(request);
  if (denied) return denied;
  const { id, photoId } = await params;
  let body: unknown;
  try {
    body = await boundedJson(request);
  } catch {}
  const parsed = photoVisibilitySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: apiMessages(request, body).city.photoVisibilityInvalid }, { status: 400 });
  const report = setPhotoVisibility(id, photoId, parsed.data.visibility);
  if (!report) return Response.json({ error: apiMessages(request, body).city.photoNotFound }, { status: 404 });
  return Response.json({ report: cityReport(report) });
}
