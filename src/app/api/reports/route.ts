import { apiMessages } from '@/lib/i18n/request-locale';
import { newEditToken, publicReport } from '@/lib/reports-server';
import { boundedJson, guard, listReports, saveReport } from '@/lib/server';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    return Response.json({ reports: listReports().map(publicReport) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: apiMessages(request).reports.readFailed }, { status: 500 });
  }
}

/** Legacy form. → 201 { report, editToken } (editToken is shown only once; see reports-server.ts). */
export async function POST(request: Request) {
  const block = guard(request);
  if (block) return block;
  let body: unknown;
  try {
    body = await boundedJson(request);
    const { token, hash } = newEditToken();
    return Response.json({ report: publicReport(await saveReport(body, hash)), editToken: token }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: apiMessages(request, body).reports.saveFailed }, { status: 400 });
  }
}
