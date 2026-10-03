import { requireCity } from '@/lib/city-auth';
import { cityFilterSchema, filterReports, reportsCsv } from '@/lib/city-reports';
import { listAllReports } from '@/lib/reports-server';
export const runtime = 'nodejs';

/** Same filters as GET /api/city/reports. */
export async function GET(request: Request) {
  const denied = requireCity(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const filter = cityFilterSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!filter.success) return Response.json({ error: 'Nieprawidłowe filtry.' }, { status: 400 });
  const host = request.headers.get('host');
  const origin = host ? `${request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')}://${host}` : url.origin;
  const day = new Date().toISOString().slice(0, 10);
  return new Response(reportsCsv(filterReports(listAllReports(), filter.data), origin), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="zgloszenia-${day}.csv"`, 'Cache-Control': 'no-store' },
  });
}
