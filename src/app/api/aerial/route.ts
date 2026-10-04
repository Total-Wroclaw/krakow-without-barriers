import { z } from 'zod';
import { aerialBbox, inFrame, project, roundPoint, unproject } from '@/lib/aerial-geo';
import {
  analysisHash, applyRefinement, cachedAnalysis, linesForPrompt, needsStepFree, objectForPrompt, overlayAt, overlayEvidence, pinsForPrompt, preferencesForPrompt, preferencesKey, weatherForPrompt,
  reportsDigest, reportsNear, sanitiseAnalysis, sanitiseObservations, storeAnalysis, type AnalysisKey,
} from '@/lib/aerial';
import { autoWidth, type AerialAnalysis, type AerialObservation } from '@/lib/aerial-types';
import { describeWayIn, locateOnPatch, spotObservations, type AerialPrompt } from '@/lib/ai';
import { pointSchema } from '@/lib/city-types';
import { locales } from '@/lib/i18n/locales';
import { orthoCrop, orthoPatch, PATCH, patchBbox, withPinRings } from '@/lib/imagery';
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
  // How the person travels (the planner's transport mode). Public transport unless they said otherwise.
  arrival: z.enum(['transit', 'walk', 'taxi', 'car']).default('transit'),
});

/** A reading in progress: the advice comes first, the close-up-checked observations after it. */
type Job = { advice: Promise<AerialAnalysis>; full: Promise<AerialAnalysis> };
const inflight = new Map<string, Job>();

const failed = () => Response.json({ error: 'Nie udało się przeanalizować zdjęcia lotniczego.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });

/**
 * POST /api/aerial {lat, lon, name, locale, objectId?, preferences?, arrival?} — AI recommendation of how to approach
 * and enter a place (which of its own entrances, from which stop — or car park when the person drives —, what to
 * avoid, what to ask), read from the auto-framed orthophoto tied to the numbered overlay pins and grounded in OSM/ZTP
 * facts, the place's listed facts, earlier user reports nearby, today's needs and the current weather.
 *
 * The answer is NDJSON, delivered as it gets ready: a line with the advice (`final: false`, no observations yet) as
 * soon as the first reading is done, then the full reading with the observations confirmed on close-ups
 * (`final: true`). A cached reading is a single final line. Readings are cached on disk per (place, frame,
 * language, needs, arrival, weather bucket, reports digest); only real model calls count towards the AI limit.
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
  // The place's own facts go into the cache key, so a corrected entrance or lift gives a new reading.
  const object = input.objectId ? await getObject(input.objectId, input.locale).catch(() => null) : null;
  const placeFacts = objectForPrompt(object);
  const key: AnalysisKey = {
    ...place, widthM, name: input.name, locale: input.locale, objectId: input.objectId ?? null,
    preferences: preferencesKey(preferences), arrival: input.arrival, weather: weatherBucket(weather), reports: reportsDigest(reports, place), evidence: overlayEvidence(overlay, placeFacts),
  };
  const cached = await cachedAnalysis(key);
  if (cached) return ndjson([{ analysis: cached, final: true, cached: true }]);
  const limited = guard(request, true);
  if (limited) return limited;

  const id = analysisHash(key);
  let job = inflight.get(id);
  if (!job) {
    const bbox = aerialBbox(place, widthM);
    const nearReports = reportsNear(place, reports);
    const basedOn = { mobility: preferences?.mobility ?? null, weather: weather?.condition ?? null, reports: nearReports.length };
    const prepared = (async () => {
      const jpeg = await orthoCrop(place, widthM);
      const image = await withPinRings(jpeg, overlay.pins.map(pin => project(pin, bbox)).filter(pos => inFrame(pos, 0)));
      const ctx: AerialPrompt = {
        placeName: input.name, widthMetres: widthM, pins: pinsForPrompt(overlay, bbox), hasEntrances: overlay.pins.some(p => p.kind === 'entrance'), arrival: input.arrival,
        lines: linesForPrompt(overlay, bbox), placeFacts, reports: nearReports, needs: preferencesForPrompt(preferences), weather: weatherForPrompt(weather),
      };
      return { image, ctx };
    })();
    // The advice and the observations are two calls side by side, so the advice is not held up by the close-ups.
    const advice = prepared.then(async ({ image, ctx }): Promise<AerialAnalysis> => ({
      ...sanitiseAnalysis(await describeWayIn(image, ctx, input.locale), overlay.pins, { stepFree: needsStepFree(preferences), arrival: input.arrival, locale: input.locale }),
      observations: [],
      widthM,
      basedOn,
      createdAt: new Date().toISOString(),
    }));
    // Positions read off the whole frame are rough; a sharper close-up of each confirms and pins it down (all in
    // parallel). Without that second look the observations are left out rather than shown in the wrong place.
    const observations = prepared
      .then(async ({ image, ctx }): Promise<AerialObservation[]> => {
        const seen = sanitiseObservations((await spotObservations(image, ctx, input.locale)).observations, bbox, overlay.pins);
        const found = await Promise.all(
          seen.map(async o => {
            const pos = await locateOnPatch({ kind: o.kind, label: o.label, jpeg: await orthoPatch(o) }, PATCH.px, PATCH.widthM).catch(() => null);
            return pos ? unproject(pos, patchBbox(o)) : null;
          }),
        );
        return applyRefinement(seen, found, bbox);
      })
      .catch(() => []);
    const full = Promise.all([advice, observations]).then(async ([reading, observations]) => {
      const analysis = { ...reading, observations };
      await storeAnalysis(key, analysis);
      return analysis;
    });
    job = { advice, full };
    inflight.set(id, job);
    // Kept until the whole reading is stored, even when the person closes the card early (the next open is instant).
    full.catch(() => {}).finally(() => inflight.delete(id));
  }

  const { advice, full } = job;
  let first: { analysis: AerialAnalysis; final: boolean };
  try {
    first = await Promise.race([advice.then(analysis => ({ analysis, final: false })), full.then(analysis => ({ analysis, final: true }))]);
  } catch {
    // The photo and the mapped pins stay useful without the AI reading.
    return failed();
  }
  if (first.final) return ndjson([{ ...first, cached: false }]);
  return ndjson([{ ...first, cached: false }, full.then(analysis => ({ analysis, final: true, cached: false }))]);
}

type Line = { analysis: AerialAnalysis; final: boolean; cached: boolean };

/** One JSON object per line, each sent as soon as it resolves. A line that fails ends the stream after an error line. */
function ndjson(lines: (Line | Promise<Line>)[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const line of lines) {
        let value: Line | { error: string };
        try {
          value = await line;
        } catch {
          value = { error: 'Nie udało się dokończyć analizy zdjęcia lotniczego.' };
        }
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        } catch {
          return; // The client went away.
        }
        if ('error' in value) break;
      }
      controller.close();
    },
  });
  return new Response(body, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  });
}
