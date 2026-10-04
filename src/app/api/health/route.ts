import { health } from '@/lib/health';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health — data freshness per source, storage and AI availability, for uptime monitoring and the
 * container health check. Always 200 while the server answers; "degraded" means stale data, not downtime.
 */
export function GET() {
  return Response.json(health(), { headers: { 'Cache-Control': 'no-store' } });
}
