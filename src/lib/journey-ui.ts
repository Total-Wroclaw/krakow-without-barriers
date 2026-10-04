// Client-side derivations from a JourneyOption for display (no routing decisions here).
import type { CityFact } from './city-types';
import type { JourneyOption, Leg } from './journey-types';
import { handrail } from './data';
import type { MessageKey } from './i18n/messages';

function haversine(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r;
  const dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Fraction (0..1) along a line where a point lies closest to a vertex. */
function fractionAlong(geometry: [number, number][], lat: number, lon: number) {
  if (geometry.length < 2) return 0;
  let best = 0;
  let bestDistance = Infinity;
  geometry.forEach((p, i) => {
    const d = (p[0] - lat) ** 2 + (p[1] - lon) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  });
  let total = 0;
  let before = 0;
  for (let i = 1; i < geometry.length; i++) {
    const d = haversine(geometry[i - 1], geometry[i]);
    total += d;
    if (i <= best) before += d;
  }
  return total ? before / total : 0;
}

function legSeconds(leg: Leg) {
  return leg.type === 'ride' ? leg.arrival - leg.departure : leg.seconds;
}

type StripSegment = { leg: Leg; start: number; length: number };
type StripMark = { fact: CityFact; at: number };

/** Proportional segments (by time) and fact marks for the barrier strip. */
export function strip(option: JourneyOption) {
  const total = Math.max(1, option.duration);
  const segments: StripSegment[] = [];
  const marks: StripMark[] = [];
  let cursor = 0;
  const origin = option.departure ?? null;
  for (const leg of option.legs) {
    const start = leg.type === 'ride' && origin !== null ? leg.departure - origin : cursor;
    const length = legSeconds(leg);
    segments.push({ leg, start: start / total, length: length / total });
    if (leg.type === 'walk') {
      for (const fact of leg.facts) {
        if (fact.kind === 'entrance' || fact.kind === 'surface' || fact.kind === 'toilet') continue;
        marks.push({ fact, at: (start + fractionAlong(leg.geometry, fact.lat, fact.lon) * length) / total });
      }
    }
    cursor = start + length;
  }
  return { segments, marks };
}

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;
type TP = (key: MessageKey, n: number, vars?: Record<string, string | number>) => string;

function stairLabel(fact: CityFact, t: T, tp?: TP) {
  const dir = t(fact.direction === 'down' ? 'fact.dirDown' : fact.direction === 'up' ? 'fact.dirUp' : 'fact.dirUnknown');
  const count = Number(fact.tags.step_count);
  const steps = Number.isInteger(count) && count > 0 ? (tp ? tp('fact.stepsN', count) : t('fact.stepsN', { n: count })) : null;
  const rail = handrail(fact.tags);
  return [t('fact.stairsTitle', { dir }), steps, rail === 'yes' ? t('fact.withRail') : rail === 'no' ? t('fact.withoutRail') : null].filter(Boolean).join(', ');
}

export function factTitle(fact: CityFact, t: T, tp?: TP) {
  if (fact.kind === 'stairs') return stairLabel(fact, t, tp);
  if (fact.kind === 'bench') {
    const bench = t(fact.tags.backrest === 'yes' ? 'fact.benchBack' : 'fact.bench');
    return fact.restAfterMinutes ? `${t('fact.restAfter', { n: fact.restAfterMinutes })}: ${bench.toLocaleLowerCase()}` : bench;
  }
  if (fact.kind === 'toilet') return fact.title || t('fact.toilet');
  if (fact.kind === 'entrance') return t(fact.tags.wheelchair === 'yes' ? 'fact.entranceFree' : 'fact.entrance');
  // Kerbs and surfaces arrive already localised from the server.
  return fact.title;
}

function walkLegs(option: JourneyOption) {
  return option.legs.filter((l): l is Extract<Leg, { type: 'walk' }> => l.type === 'walk');
}

export function allFacts(option: JourneyOption) {
  return walkLegs(option).flatMap(l => l.facts);
}
