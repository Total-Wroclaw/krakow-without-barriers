// Journey planner: walking options, timed public-transport options and, on request, taxi/car options.
import { z } from 'zod';
import { cityGraph } from './city-graph';
import { placeSchema } from './city-types';
import { preferencesSchema, type Preferences } from './schemas';
import { transitOptions } from './transit';
import { OffNetworkError, walkingOptions } from './walking';
import { DriveError, driveOptions } from './drive';
import { roadGraph, type RoadGraph } from './roads';
import { applyExtras } from './journey-extras';
import { accessibleToilets, type AccessibleToilet } from './objects';
import { serverMessages } from './i18n/server-messages';
import { defaultLocale, locales, type Locale } from './i18n/locales';
import { onWheels, stairsPassable, type WalkGraph } from './routing';
import type { CityPlace } from './city-types';
import type { JourneyOption, JourneyResult, TransportMode } from './journey-types';

export const transportModes = ['walk', 'transit', 'taxi', 'car'] as const satisfies readonly TransportMode[];

export const journeyRequestSchema = z.object({
  from: placeSchema,
  to: placeSchema,
  preferences: preferencesSchema,
  date: z.iso.date(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  /** 'transit' (default): walking + trams/buses. 'walk': walking options only. 'taxi'/'car' add drive options first. */
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

/**
 * Stairs on the option that today's needs rule out: on wheels only the flights the mobility rule
 * forbids (a pushchair may use short flights and ramps), otherwise every flight when stairs are avoided.
 */
export function hasAvoidedStairs(option: JourneyOption, p: Preferences) {
  if (!onWheels(p.mobility)) return option.stairs.up + option.stairs.down + option.stairs.unknown > 0;
  return option.legs.some(leg => leg.type === 'walk' && leg.facts.some(f => f.kind === 'stairs' && !stairsPassable(f.tags, p.mobility)));
}

export function planJourney(
  input: { from: CityPlace; to: CityPlace; preferences: Preferences; date: string; time: string; transport?: TransportMode; locale?: Locale },
  graph: WalkGraph = cityGraph(),
  roads: () => RoadGraph | null = roadGraph,
  toilets: () => AccessibleToilet[] = accessibleToilets,
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
  if (transport === 'taxi' || transport === 'car') {
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

  // On foot only: no rides, so every walking option is kept (orderOptions drops long walks only next to a ride).
  let transit: JourneyOption[] = [];
  if (transport !== 'walk') {
    try {
      const result = transitOptions(graph, from, to, preferences, date, time, locale);
      transit = result.options;
      result.errors.forEach(addError);
    } catch (error) {
      addError(message(error, m.errors.transitFailed));
    }
  }

  const all = applyExtras([...drive, ...orderOptions(walking, transit, preferences)], graph, preferences, locale, toilets);
  // Options that fit today's needs come first; the original order is kept within each group.
  const options = [...all.filter(o => o.fits), ...all.filter(o => !o.fits)];
  // When stairs cannot be avoided at all, say so instead of leaving people to guess from red labels.
  const avoidsStairs = preferences.avoidStairs || preferences.mobility === 'wheelchair' || preferences.mobility === 'stroller';
  if (avoidsStairs && options.length && options.every(o => hasAvoidedStairs(o, preferences))) addError(m.errors.stairsOnly);
  return { from, to, date, options, errors };
}
