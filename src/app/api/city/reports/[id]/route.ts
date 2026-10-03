import { requireCity } from '@/lib/city-auth';
import { apiMessages } from '@/lib/i18n/request-locale';
import { cityReport, cityUpdateSchema, updateCityReport } from '@/lib/reports-server';
import { boundedJson, guard } from '@/lib/server';
export const runtime = 'nodejs';

/** { status?: 'new'|'in_review'|'forwarded'|'resolved'|'rejected', note?: string ≤ 1000 } → { report } */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const block = guard(request);
  if (block) return block;
  const denied = requireCity(request);
  if (denied) return denied;
  const { id } = await params;
  let input;
  try {
    input = cityUpdateSchema.parse(await boundedJson(request));
  } catch {
    return Response.json({ error: apiMessages(request).city.updateInvalid }, { status: 400 });
  }
  const report = updateCityReport(id, input);
  if (!report) return Response.json({ error: apiMessages(request).reports.notFound }, { status: 404 });
  return Response.json({ report: cityReport(report) });
}
