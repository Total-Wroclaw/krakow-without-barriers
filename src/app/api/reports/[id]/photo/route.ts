import { firstReportPhoto, photoHeaders } from '@/lib/reports-server';
export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const photo = firstReportPhoto(id);
  if (!photo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(photo), { headers: photoHeaders });
}
