import { z } from 'zod';
import { updateReport } from '@/lib/reports-server';
import { boundedJson, db, guard } from '@/lib/server';
export const runtime = 'nodejs';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const block = guard(request);
  if (block) return block;
  const { id } = await params;
  db().prepare('DELETE FROM reports WHERE id=?').run(id);
  return Response.json({ deleted: true });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const block = guard(request);
  if (block) return block;
  const { id } = await params;
  try {
    const body = z.object({ observation: z.unknown() }).parse(await boundedJson(request));
    const report = updateReport(id, body.observation);
    if (!report) return Response.json({ error: 'Nie znaleziono zgłoszenia.' }, { status: 404 });
    return Response.json({ report });
  } catch {
    return Response.json({ error: 'Sprawdź opis zgłoszenia.' }, { status: 400 });
  }
}
