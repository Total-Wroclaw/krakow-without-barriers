import { boundedJson, guard, listReports, saveReport } from '@/lib/server';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return Response.json({ reports: listReports() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Nie udało się odczytać zgłoszeń. Spróbuj ponownie.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const block = guard(request);
  if (block) return block;
  try {
    return Response.json({ report: await saveReport(await boundedJson(request)) }, { status: 201 });
  } catch {
    return Response.json(
      { error: 'Nie udało się zapisać. Sprawdź miejsce, opis, potwierdzenie i zdjęcie (JPEG/PNG/WebP, maks. 3 MB). Formularz pozostał otwarty.' },
      { status: 400 },
    );
  }
}
