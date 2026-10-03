import { z } from 'zod';
import { addPhotoSchema, addReportPhoto, MAX_PHOTOS, publicReport } from '@/lib/reports-server';
import { boundedJson, guard } from '@/lib/server';
export const runtime = 'nodejs';

/** { photo: data URL (JPEG/PNG/WebP ≤ 3 MB), locale? } → 201 { report, photo } */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const block = guard(request, true);
  if (block) return block;
  const { id } = await params;
  try {
    const result = await addReportPhoto(id, addPhotoSchema.parse(await boundedJson(request)));
    if ('error' in result) {
      if (result.error === 'not_found') return Response.json({ error: 'Nie znaleziono zgłoszenia.' }, { status: 404 });
      return Response.json({ error: `Zgłoszenie może mieć najwyżej ${MAX_PHOTOS} zdjęcia.` }, { status: 409 });
    }
    return Response.json({ report: publicReport(result.report), photo: result.photo }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'Dodaj zdjęcie.' }, { status: 400 });
    return Response.json({ error: 'Nie udało się zapisać zdjęcia. Użyj JPEG, PNG lub WebP do 3 MB.' }, { status: 400 });
  }
}
