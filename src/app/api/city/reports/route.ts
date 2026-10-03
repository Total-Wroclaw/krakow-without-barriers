import { requireCity } from '@/lib/city-auth';
import { apiMessages } from '@/lib/i18n/request-locale';
import { cityFilterSchema, filterReports } from '@/lib/city-reports';
import { cityReport, listAllReports } from '@/lib/reports-server';
export const runtime = 'nodejs';

/** ?status=&type=&from=YYYY-MM-DD&to=YYYY-MM-DD&q= → { reports } newest first, full city view (with cityHistory). */
export async function GET(request: Request) {
  const denied = requireCity(request);
  if (denied) return denied;
  const filter = cityFilterSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!filter.success) return Response.json({ error: apiMessages(request).city.badFilters }, { status: 400 });
  if (filter.data.from && filter.data.to && filter.data.from > filter.data.to) return Response.json({ error: apiMessages(request).city.dateRange }, { status: 400 });
  return Response.json({ reports: filterReports(listAllReports(), filter.data).map(cityReport) }, { headers: { 'Cache-Control': 'no-store' } });
}
