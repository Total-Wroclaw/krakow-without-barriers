// Journey planner: walking options, timed public-transport options and, on request, taxi/car options.
import { z } from 'zod';
import { cityGraph } from './city-graph';
import { placeSchema } from './city-types';
import { preferencesSchema, type Preferences } from './schemas';
import { transitOptions } from './transit';
import { OffNetworkError, walkingOptions } from './walking';
import { DriveError, driveOptions } from './drive';
import { roadGraph, type RoadGraph } from './roads';
import { serverMessages } from './i18n/server-messages';
import { defaultLocale, locales, type Locale } from './i18n/locales';
import type { WalkGraph } from './routing';
import type { CityPlace } from './city-types';
import type { JourneyOption, JourneyResult, TransportMode } from './journey-types';

export const transportModes = ['transit', 'taxi', 'car'] as const satisfies readonly TransportMode[];

export const journeyRequestSchema = z.object({
  from: placeSchema,
  to: placeSchema,
  preferences: preferencesSchema,
  date: z.iso.date(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  /** 'transit' (default): walking + trams/buses. 'taxi'/'car' add drive options first. */
  transport: z.enum(transportModes).default('transit'),
  locale: z.enum(locales).default(defaultLocale),
});

export type JourneyRequest = z.input<typeof journeyRequestSchema>;

function message(error: unknown, fallback: string) {
  return error instanceof OffNetworkError || error instanceof DriveError ? error.message : fallback;
}

/**
 * Order: walking first when the walk is within 1.5 × today's limit, otherwise
 * after transit. Transit options are ordered by departure.
 */
export function orderOptions(walking: JourneyOption[], transit: JourneyOption[], p: Preferences) {
  const byDeparture = [...transit].sort((a, b) => (a.departure ?? 0) - (b.departure ?? 0) || (a.arrival ?? 0) - (b.arrival ?? 0));
  const walkFirst = walking.length > 0 && walking[0].walkingDistance <= p.maxDistance * 1.5;
  if (walkFirst) return [...walking, ...byDeparture];
  // Long walks far beyond today's limit only add clutter when a ride exists; keep the best one as a fallback.
  const tooFar = (o: JourneyOption) => o.walkingDistance > Math.max(3000, p.maxDistance * 3);
  const extraWalks = byDeparture.length ? walking.filter(o => !tooFar(o)) : walking;
  return [...byDeparture, ...extraWalks];
}

export function planJourney(
  input: { from: CityPlace; to: CityPlace; preferences: Preferences; date: string; time: string; transport?: TransportMode; locale?: Locale },
  graph: WalkGraph = cityGraph(),
  roads: () => RoadGraph | null = roadGraph,
): JourneyResult {
  const { from, to, preferences, date, time } = input;
  const transport = input.transport ?? 'transit';
  const locale = input.locale ?? defaultLocale;
  const m = serverMessages(locale);
  const departure = Number(time.slice(0, 2)) * 3600 + Number(time.slice(3, 5)) * 60;
  const errors: string[] = [];
  const addError = (text: string) => {
    if (!errors.includes(text)) errors.push(text);
  };

  let drive: JourneyOption[] = [];
  if (transport !== 'transit') {
    try {
      const road = roads();
      if (!road) addError(m.errors.roadsUnavailable);
      else drive = driveOptions(graph, road, from, to, preferences, departure, transport, locale);
    } catch (error) {
      addError(message(error, m.errors.driveFailed));
    }
  }

  let walking: JourneyOption[] = [];
  try {
    const result = walkingOptions(graph, from, to, preferences, departure, locale);
    walking = result.options;
    result.errors.forEach(addError);
  } catch (error) {
    addError(message(error, m.errors.walkFailed));
  }

  let transit: JourneyOption[] = [];
  try {
    const result = transitOptions(graph, from, to, preferences, date, time, locale);
    transit = result.options;
    result.errors.forEach(addError);
  } catch (error) {
    addError(message(error, m.errors.transitFailed));
  }

  return { from, to, date, options: [...drive, ...orderOptions(walking, transit, preferences)], errors };
}
