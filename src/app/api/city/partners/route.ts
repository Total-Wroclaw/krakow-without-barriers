import { requireCity } from '@/lib/city-auth';
import { listPartnerDeclarations } from '@/lib/objects';
export const runtime = 'nodejs';

/** → { partners } every live owner declaration, newest first, with hidden ones flagged (city session only). */
export async function GET(request: Request) {
  const denied = requireCity(request);
  if (denied) return denied;
  return Response.json({ partners: await listPartnerDeclarations() }, { headers: { 'Cache-Control': 'no-store' } });
}
