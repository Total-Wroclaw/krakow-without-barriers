import { guard } from '@/lib/server';
import { defaultLocale, isLocale } from '@/lib/i18n/locales';
import { getObject } from '@/lib/objects';
import { apiMessages } from '@/lib/i18n/request-locale';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const block = guard(request); if (block) return block;
  const { id } = await params;
  const m = apiMessages(request).objects;
  if (!/^[a-z0-9:-]{3,120}$/i.test(id)) return Response.json({ error: m.badId }, { status: 400 });
  const locale = new URL(request.url).searchParams.get('locale');
  try {
    const object = await getObject(id, isLocale(locale) ? locale : defaultLocale);
    if (!object) return Response.json({ error: m.notFound }, { status: 404 });
    return Response.json({ object }, { headers: { 'Cache-Control': 'private, max-age=30' } });
  } catch {
    return Response.json({ error: m.detailUnavailable }, { status: 503 });
  }
}
