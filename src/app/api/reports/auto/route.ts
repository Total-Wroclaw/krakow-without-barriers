import { z } from 'zod';
import { apiMessages } from '@/lib/i18n/request-locale';
import { autoReportSchema, newEditToken, publicReport, saveAutoReport } from '@/lib/reports-server';
import { boundedJson, guard } from '@/lib/server';
export const runtime = 'nodejs';

/** { photo?, location, locationSource, factId?, locale?, type?: 'barrier'|'blocked', comment?, destination? }
 *  A photo is required unless type is 'blocked' or a comment (≥ 3 characters) is given.
 *  → 201 { report, editToken }. editToken is returned only here; send it as `x-report-token` to edit/delete/add photos. */
export async function POST(request: Request) {
  const block = guard(request, true);
  if (block) return block;
  let body: unknown;
  try {
    body = await boundedJson(request);
    const input = autoReportSchema.parse(body);
    const { token, hash } = newEditToken();
    return Response.json({ report: publicReport(await saveAutoReport(input, hash)), editToken: token }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const m = apiMessages(request, body).reports;
    return Response.json({ error: error instanceof z.ZodError || error instanceof SyntaxError ? m.invalid : m.photoFailed }, { status: 400 });
  }
}
