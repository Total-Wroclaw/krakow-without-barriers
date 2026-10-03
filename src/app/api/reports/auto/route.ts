import { z } from 'zod';
import { autoReportSchema, saveAutoReport } from '@/lib/reports-server';
import { boundedJson, guard } from '@/lib/server';
export const runtime = 'nodejs';

/** { photo?, location, locationSource, factId?, locale?, type?: 'barrier'|'blocked', comment?, destination? }
 *  A photo is required unless type is 'blocked' or a comment (≥ 3 characters) is given. */
export async function POST(request: Request) {
  const block = guard(request, true);
  if (block) return block;
  try {
    const input = autoReportSchema.parse(await boundedJson(request));
    return Response.json({ report: await saveAutoReport(input) }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'Zgłoszenie musi mieć miejsce w Krakowie oraz zdjęcie albo krótki opis.' }, { status: 400 });
    return Response.json({ error: 'Nie udało się zapisać zdjęcia. Użyj JPEG, PNG lub WebP do 3 MB.' }, { status: 400 });
  }
}
