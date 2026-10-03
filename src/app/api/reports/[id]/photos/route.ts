import { z } from 'zod';
import { apiMessages } from '@/lib/i18n/request-locale';
import { addPhotoSchema, addReportPhoto, checkEditToken, MAX_PHOTOS, publicReport, REPORT_TOKEN_HEADER } from '@/lib/reports-server';
import { boundedJson, guard } from '@/lib/server';
export const runtime = 'nodejs';

/** Author only (header x-report-token), also after the city changed the status.
 *  { photo: data URL (JPEG/PNG/WebP ≤ 3 MB), locale? } → 201 { report, photo } */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const block = guard(request);
  if (block) return block;
  const { id } = await params;
  const early = apiMessages(request).reports;
  const access = checkEditToken(id, request.headers.get(REPORT_TOKEN_HEADER));
  if (access === 'not_found') return Response.json({ error: early.notFound }, { status: 404 });
  if (access === 'forbidden') return Response.json({ error: early.forbidden }, { status: 403 });
  // AI rate limit only after the token check, so strangers cannot use up the author's budget.
  const limited = guard(request, true);
  if (limited) return limited;
  let body: unknown;
  try {
    body = await boundedJson(request);
    const result = await addReportPhoto(id, addPhotoSchema.parse(body));
    const m = apiMessages(request, body).reports;
    if ('error' in result) {
      if (result.error === 'not_found') return Response.json({ error: m.notFound }, { status: 404 });
      return Response.json({ error: m.photoLimit(MAX_PHOTOS) }, { status: 409 });
    }
    const report = publicReport(result.report);
    return Response.json({ report, photo: report.photos?.find(p => p.id === result.photo.id) }, { status: 201 });
  } catch (error) {
    const m = apiMessages(request, body).reports;
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: m.photoRequired }, { status: 400 });
    return Response.json({ error: m.photoFailed }, { status: 400 });
  }
}
