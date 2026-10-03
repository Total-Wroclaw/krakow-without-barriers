import { z } from 'zod';
import { apiMessages } from '@/lib/i18n/request-locale';
import { authorCanDelete, checkEditToken, deleteReport, publicReport, REPORT_TOKEN_HEADER, updateReport } from '@/lib/reports-server';
import { boundedJson, guard } from '@/lib/server';
export const runtime = 'nodejs';

type Context = { params: Promise<{ id: string }> };

/** Author only (header x-report-token). 404 unknown id, 403 wrong/missing token, 409 once the city has changed the status. */
export async function DELETE(request: Request, { params }: Context) {
  const block = guard(request);
  if (block) return block;
  const { id } = await params;
  const m = apiMessages(request).reports;
  const access = checkEditToken(id, request.headers.get(REPORT_TOKEN_HEADER));
  if (access === 'not_found') return Response.json({ error: m.notFound }, { status: 404 });
  if (access === 'forbidden') return Response.json({ error: m.forbidden }, { status: 403 });
  if (!authorCanDelete(id)) return Response.json({ error: m.deleteLocked, code: 'city_handling' }, { status: 409 });
  deleteReport(id);
  return Response.json({ deleted: true });
}

/** Author only (header x-report-token). { observation, locale? } → { report } */
export async function PATCH(request: Request, { params }: Context) {
  const block = guard(request);
  if (block) return block;
  const { id } = await params;
  let body: unknown;
  try {
    body = await boundedJson(request);
  } catch {}
  const m = apiMessages(request, body).reports;
  const access = checkEditToken(id, request.headers.get(REPORT_TOKEN_HEADER));
  if (access === 'not_found') return Response.json({ error: m.notFound }, { status: 404 });
  if (access === 'forbidden') return Response.json({ error: m.forbidden }, { status: 403 });
  try {
    const input = z.object({ observation: z.unknown().optional(), location: z.unknown().optional(), locale: z.string().optional() }).parse(body);
    if (input.observation === undefined && input.location === undefined) throw new Error('empty');
    const report = updateReport(id, input.observation, input.location);
    if (!report) return Response.json({ error: m.notFound }, { status: 404 });
    return Response.json({ report: publicReport(report) });
  } catch {
    return Response.json({ error: m.observationInvalid }, { status: 400 });
  }
}
