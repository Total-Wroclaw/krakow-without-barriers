import { z } from 'zod';
import { autoReportSchema, saveAutoReport } from '@/lib/reports-server';
import { boundedJson, guard } from '@/lib/server';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const block = guard(request, true);
  if (block) return block;
  try {
    const input = autoReportSchema.parse(await boundedJson(request));
    return Response.json({ report: await saveAutoReport(input) }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'Zgłoszenie musi mieć zdjęcie i miejsce w Krakowie.' }, { status: 400 });
    return Response.json({ error: 'Nie udało się zapisać zdjęcia. Użyj JPEG, PNG lub WebP do 3 MB.' }, { status: 400 });
  }
}
