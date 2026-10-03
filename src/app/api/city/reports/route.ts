import { requireCity } from '@/lib/city-auth';
import { cityFilterSchema, filterReports } from '@/lib/city-reports';
import { listAllReports } from '@/lib/reports-server';
export const runtime = 'nodejs';

/** ?status=&type=&from=YYYY-MM-DD&to=YYYY-MM-DD&q= → { reports } newest first, full city view (with cityHistory). */
export async function GET(request: Request) {
  const denied = requireCity(request);
  if (denied) return denied;
  const filter = cityFilterSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!filter.success) return Response.json({ error: 'Nieprawidłowe filtry.' }, { status: 400 });
  return Response.json({ reports: filterReports(listAllReports(), filter.data) }, { headers: { 'Cache-Control': 'no-store' } });
}
