import { photoHeaders, publicReportPhoto } from '@/lib/reports-server';
export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; photoId: string }> }) {
  const { id, photoId } = await params;
  // Hidden photos (possible people, not yet approved by the city) are not served publicly.
  const photo = publicReportPhoto(id, photoId);
  if (!photo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(photo), { headers: photoHeaders });
}
