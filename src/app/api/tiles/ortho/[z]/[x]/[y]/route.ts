import { orthoTile, tileAllowed } from '@/lib/tile-cache';
export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const p = await params;
  const [z, x, y] = [p.z, p.x, p.y.replace(/\.jpg$/, '')].map(Number);
  if (!tileAllowed(z, x, y)) return new Response(null, { status: 404 });
  try {
    const { jpeg, hit } = await orthoTile(z, x, y);
    return new Response(new Uint8Array(jpeg), {
      headers: {
        'Content-Type': 'image/jpeg',
        // Orthophoto tiles change rarely; let browsers and proxies keep them for 30 days.
        'Cache-Control': 'public, max-age=2592000, stale-while-revalidate=604800',
        'X-Tile-Cache': hit ? 'hit' : 'miss',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response(null, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
