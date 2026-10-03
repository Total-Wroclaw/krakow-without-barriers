import { z } from 'zod';
import { aerialBbox, inFrame, project, roundPoint } from '@/lib/aerial-geo';
import {
  analysisHash, cachedAnalysis, linesForPrompt, objectForPrompt, overlayAt, pinsForPrompt, preferencesForPrompt, preferencesKey, weatherForPrompt,
  reportsDigest, reportsNear, sanitiseAnalysis, storeAnalysis, type AnalysisKey,
} from '@/lib/aerial';
import { autoWidth, type AerialAnalysis } from '@/lib/aerial-types';
import { describeAerial } from '@/lib/ai';
import { pointSchema } from '@/lib/city-types';
import { locales } from '@/lib/i18n/locales';
import { orthoCrop, withPinRings } from '@/lib/imagery';
import { getObject } from '@/lib/objects';
import { preferencesSchema, type Report } from '@/lib/schemas';
import { boundedJson, guard, listReports } from '@/lib/server';
import { currentWeather, weatherBucket } from '@/lib/weather';
export const runtime = 'nodejs';

const schema = pointSchema.extend({
  name: z.string().trim().min(1).max(200),
  locale: z.enum(locales).default('pl'),
  objectId: z.string().regex(/^[\w:.-]{1,120}$/).nullish(),
  preferences: preferencesSchema.nullish(),
});
const inflight = new Map<string, Promise<AerialAnalysis>>();

/**
 * POST /api/aerial {lat, lon, name, locale, objectId?, preferences?} — AI reading of the auto-framed orthophoto
 * around a place, tied to the numbered overlay pins and grounded in OSM/ZTP facts, the place's listed facts,
 * earlier user reports nearby, today's needs and the current weather. Readings are cached on disk per
 * (place, frame, language, needs, weather bucket, reports digest); only real model calls count towards the AI limit.
 */
export async function POST(request: Request) {
  const block = guard(request);
  if (block) return block;
  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await boundedJson(request));
  } catch {
    return Response.json({ error: 'Wybierz miejsce w Krakowie.' }, { status: 400 });
  }
  const place = roundPoint(input);
  const preferences = input.preferences ?? null;
  // Every source is optional: the reading still works without weather, reports or the place's facts.
  const [overlay, weather] = await Promise.all([overlayAt(place), currentWeather()]);
  let reports: Report[] = [];
  try {
    reports = listReports();
  } catch {}
  const widthM = autoWidth(overlay);
  const key: AnalysisKey = {
    ...place, widthM, name: input.name, locale: input.locale, objectId: input.objectId ?? null,
    preferences: preferencesKey(preferences), weather: weatherBucket(weather), reports: reportsDigest(reports, place),
  };
  const cached = await cachedAnalysis(key);
  if (cached) return Response.json({ analysis: cached, cached: true }, { headers: { 'Cache-Control': 'no-store' } });
  const limited = guard(request, true);
  if (limited) return limited;

  const id = analysisHash(key);
  let job = inflight.get(id);
  if (!job) {
    job = (async () => {
      const bbox = aerialBbox(place, widthM);
      const object = input.objectId ? await getObject(input.objectId, input.locale).catch(() => null) : null;
      const nearReports = reportsNear(place, reports);
      const jpeg = await orthoCrop(place, widthM);
      const rings = overlay.pins.map(pin => project(pin, bbox)).filter(pos => inFrame(pos, 0));
      const raw = await describeAerial(
        await withPinRings(jpeg, rings),
        {
          placeName: input.name, widthMetres: widthM, pins: pinsForPrompt(overlay, bbox), lines: linesForPrompt(overlay, bbox),
          placeFacts: objectForPrompt(object), reports: nearReports, needs: preferencesForPrompt(preferences), weather: weatherForPrompt(weather),
        },
        input.locale,
      );
      const analysis: AerialAnalysis = {
        ...sanitiseAnalysis(raw, bbox, overlay.pins.map(pin => pin.kind)),
        widthM,
        basedOn: { mobility: preferences?.mobility ?? null, weather: weather?.condition ?? null, reports: nearReports.length },
        createdAt: new Date().toISOString(),
      };
      await storeAnalysis(key, analysis);
      return analysis;
    })().finally(() => inflight.delete(id));
    inflight.set(id, job);
  }
  try {
    return Response.json({ analysis: await job, cached: false }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // The photo and the mapped pins stay useful without the AI reading.
    return Response.json({ error: 'Nie udało się przeanalizować zdjęcia lotniczego.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
