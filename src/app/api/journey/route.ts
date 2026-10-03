import { z } from 'zod';
import { journeyRequestSchema, planJourney } from '@/lib/journey';
import { serverMessages } from '@/lib/i18n/server-messages';
import { boundedJson, guard } from '@/lib/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const block = guard(request);
  if (block) return block;
  let body: unknown;
  let input: z.infer<typeof journeyRequestSchema>;
  try {
    body = await boundedJson(request);
    input = journeyRequestSchema.parse(body);
  } catch {
    const locale = body && typeof body === 'object' ? (body as { locale?: unknown }).locale : undefined;
    return Response.json({ error: serverMessages(locale).errors.badRequest }, { status: 400 });
  }
  try {
    return Response.json(planJourney(input), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: serverMessages(input.locale).errors.serverError }, { status: 500 });
  }
}
