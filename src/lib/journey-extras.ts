// Post-processing of journey options: planned rest stops (preferences.restEvery) and accessible toilets
// (preferences.showToilets). Works on the finished legs, so walking, transit and drive options share it.
import { metres, PointGrid, type WalkGraph } from './routing';
import { WALK_SPEED } from './walking';
import { serverMessages } from './i18n/server-messages';
import type { Locale } from './i18n/locales';
import type { Preferences } from './schemas';
import type { CityFact } from './city-types';
import type { OsmNode } from './data';
import type { AccessibleToilet } from './objects';
import type { JourneyOption, WalkLeg } from './journey-types';

/** Time added for each planned rest. */
export const REST_SECONDS = 120;
/** A rest bench may be this far from the route. */
export const REST_RADIUS = 60;
/** Benches are searched this share of the interval before and after each mark. */
export const REST_WINDOW = 0.25;
/** At most this many "no bench" notes per option. */
const MAX_REST_ISSUES = 3;
export const TOILET_ROUTE_RADIUS = 150;
export const TOILET_DESTINATION_RADIUS = 300;
export const MAX_ROUTE_TOILETS = 3;
export const MAX_DESTINATION_TOILETS = 2;
/** Toilets along the route are at least this far apart (metres along the walk). */
export const TOILET_SPACING = 400;
const SAMPLE_STEP = 20;

/** A point on a walking leg: `at` = metres walked since the start of the journey. */
type Sample = { leg: number; at: number; lat: number; lon: number };

/** Points every ~20 m along all walking legs, with cumulative walked distance. */
function sampleWalks(legs: JourneyOption['legs']): Sample[] {
  const out: Sample[] = [];
  let walked = 0;
  legs.forEach((leg, index) => {
    if (leg.type !== 'walk') return;
    const g = leg.geometry;
    let length = 0;
    for (let i = 1; i < g.length; i++) length += metres({ lat: g[i - 1][0], lon: g[i - 1][1] }, { lat: g[i][0], lon: g[i][1] });
    // Placeholder legs (straight line × 1.3) report more distance than their geometry: scale to the leg distance.
    const scale = length > 0 ? leg.distance / length : 0;
    let along = 0;
    if (g.length) out.push({ leg: index, at: walked, lat: g[0][0], lon: g[0][1] });
    for (let i = 1; i < g.length; i++) {
      const a = { lat: g[i - 1][0], lon: g[i - 1][1] };
      const b = { lat: g[i][0], lon: g[i][1] };
      const d = metres(a, b);
      const pieces = Math.max(1, Math.ceil(d / SAMPLE_STEP));
      for (let k = 1; k <= pieces; k++) {
        const t = k / pieces;
        out.push({ leg: index, at: walked + (along + d * t) * scale, lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
      }
      along += d;
    }
    walked += leg.distance;
  });
  return out;
}

function totalWalk(legs: JourneyOption['legs']) {
  return legs.reduce((s, l) => s + (l.type === 'walk' ? l.distance : 0), 0);
}

export type PlannedRest = { bench: OsmNode; leg: number; at: number; minutes: number };

/**
 * Choose a bench near every `restEvery`-minute mark of cumulative walking: within 60 m of the route,
 * within ±25 % of the interval along it; a backrest and closeness to the mark win. The next mark is counted
 * from the chosen bench. `capacity(leg)` limits rests on a leg (transfer walks only have so much slack).
 * Marks in the last quarter-interval of the walk are skipped (the destination is near).
 */
export function planRests(g: WalkGraph, legs: JourneyOption['legs'], restEvery: number, capacity: (leg: number) => number = () => Infinity) {
  const rests: PlannedRest[] = [];
  const missing: number[] = [];
  if (!(restEvery > 0)) return { rests, missing };
  const interval = restEvery * 60 * WALK_SPEED;
  const total = totalWalk(legs);
  const samples = sampleWalks(legs);
  const used = new Set<number>();
  const perLeg = new Map<number, number>();
  let mark = interval;
  while (mark < total - interval * REST_WINDOW) {
    const lo = mark - interval * REST_WINDOW;
    const hi = mark + interval * REST_WINDOW;
    let best: { b: number; s: Sample; score: number } | null = null;
    for (const s of samples) {
      if (s.at < lo || s.at > hi) continue;
      if ((perLeg.get(s.leg) ?? 0) >= capacity(s.leg)) continue;
      for (const b of g.benchGrid.within(s, REST_RADIUS)) {
        if (used.has(b)) continue;
        const bench = g.benches[b];
        const score = Math.abs(s.at - mark) * 0.5 + metres(s, bench) * 1.5 - (bench.tags.backrest === 'yes' ? 60 : 0);
        if (!best || score < best.score) best = { b, s, score };
      }
    }
    if (best) {
      used.add(best.b);
      perLeg.set(best.s.leg, (perLeg.get(best.s.leg) ?? 0) + 1);
      rests.push({ bench: g.benches[best.b], leg: best.s.leg, at: best.s.at, minutes: Math.max(1, Math.round(best.s.at / WALK_SPEED / 60)) });
      mark = best.s.at + interval;
    } else {
      missing.push(Math.round(mark / WALK_SPEED / 60));
      mark += interval;
    }
  }
  return { rests, missing };
}

/** Insert a fact into a leg's fact list near its position along the leg (entrances stay last). */
function insertFact(leg: WalkLeg, fact: CityFact) {
  const g = leg.geometry;
  const position = (p: { lat: number; lon: number }) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < g.length; i++) {
      const d = metres(p, { lat: g[i][0], lon: g[i][1] });
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  const at = position(fact);
  const index = leg.facts.findIndex(f => f.kind === 'entrance' || position(f) > at);
  if (index < 0) leg.facts.push(fact);
  else leg.facts.splice(index, 0, fact);
}

function benchFact(g: WalkGraph, bench: OsmNode, minutes: number, locale: Locale): CityFact {
  const m = serverMessages(locale);
  return {
    id: `node:${bench.id}`,
    kind: 'bench',
    title: bench.tags.backrest === 'yes' ? m.facts.benchBackrest : m.facts.bench,
    lat: bench.lat,
    lon: bench.lon,
    tags: bench.tags,
    direction: 'unknown',
    editedAt: bench.editedAt,
    obtainedAt: g.obtainedAt,
    confirmedAt: null,
    status: 'osm',
    sourceUrl: `https://www.openstreetmap.org/node/${bench.id}`,
    restAfterMinutes: minutes,
  };
}

/** Rides bound walking legs: before the first ride time is added earlier, after the last later, in between only within slack. */
function rideBounds(option: JourneyOption) {
  const rides = option.legs.flatMap((l, i) => (l.type === 'ride' ? [i] : []));
  return { first: rides.length ? rides[0] : -1, last: rides.length ? rides.at(-1)! : -1 };
}

/** Planned rests: bench facts with `restAfterMinutes`, +2 min each, `restStops`/`restMinutes`, notes for marks without a bench. */
export function addRestStops(option: JourneyOption, g: WalkGraph, p: Preferences, locale: Locale = 'pl') {
  // Transit options already include these rests when the timetable search accepts them.
  if (!((p.restEvery ?? 0) > 0) || option.restStops !== undefined) return option;
  const m = serverMessages(locale);
  const { first, last } = rideBounds(option);
  const transferSlack = (leg: number) => {
    const walk = option.legs[leg];
    const next = option.legs.slice(leg + 1).find(l => l.type === 'ride');
    if (walk.type !== 'walk' || !next || next.type !== 'ride' || walk.departure === null) return 0;
    return Math.floor((next.departure - (walk.departure + walk.seconds)) / REST_SECONDS);
  };
  const capacity = (leg: number) => (first >= 0 && leg > first && leg < last ? transferSlack(leg) : Infinity);
  const { rests, missing } = planRests(g, option.legs, p.restEvery, capacity);

  const added = new Map<number, number>();
  for (const rest of rests) {
    const leg = option.legs[rest.leg] as WalkLeg;
    const existing = leg.facts.find(f => f.id === `node:${rest.bench.id}`);
    if (existing) existing.restAfterMinutes = rest.minutes;
    else insertFact(leg, benchFact(g, rest.bench, rest.minutes, locale));
    added.set(rest.leg, (added.get(rest.leg) ?? 0) + REST_SECONDS);
  }

  let before = 0;
  let after = 0;
  // Before the first ride: leave earlier so the same vehicle is caught.
  if (first >= 0) {
    let shift = 0;
    for (let i = first - 1; i >= 0; i--) {
      const leg = option.legs[i];
      const extra = added.get(i) ?? 0;
      if (leg.type === 'walk') leg.seconds += extra;
      shift += extra;
      if (leg.departure !== null && leg.type !== 'ride') leg.departure -= shift;
    }
    before = shift;
    for (let i = first + 1; i < last; i++) {
      const leg = option.legs[i];
      if (leg.type === 'walk') leg.seconds += added.get(i) ?? 0;
    }
  }
  // After the last ride (or the whole option without rides): arrive later.
  let shift = 0;
  for (let i = last + 1; i < option.legs.length; i++) {
    const leg = option.legs[i];
    if (leg.type !== 'ride' && leg.departure !== null) leg.departure += shift;
    const extra = added.get(i) ?? 0;
    if (leg.type === 'walk') leg.seconds += extra;
    shift += extra;
  }
  after = shift;

  if (option.departure !== null) option.departure -= before;
  if (option.arrival !== null) option.arrival += after;
  option.duration = option.departure !== null && option.arrival !== null ? option.arrival - option.departure : option.duration + before + after;
  option.restStops = rests.length;
  option.restMinutes = (rests.length * REST_SECONDS) / 60;
  option.rests = option.legs.reduce((s, l) => s + (l.type === 'walk' ? l.facts.filter(f => f.kind === 'bench').length : 0), 0);
  option.issues = [...option.issues, ...missing.slice(0, MAX_REST_ISSUES).map(minute => m.issues.noBench(minute))];
  return option;
}

const toiletGrids = new WeakMap<AccessibleToilet[], PointGrid>();
function toiletGrid(toilets: AccessibleToilet[]) {
  let grid = toiletGrids.get(toilets);
  if (!grid) {
    grid = new PointGrid(Float64Array.from(toilets, t => t.lat), Float64Array.from(toilets, t => t.lon), 0.002);
    toiletGrids.set(toilets, grid);
  }
  return grid;
}

function toiletFact(t: AccessibleToilet, locale: Locale): CityFact {
  return {
    id: `toilet:${t.objectId}`,
    kind: 'toilet',
    title: serverMessages(locale).facts.toilet(t.name, t.value === 'limited'),
    lat: t.lat,
    lon: t.lon,
    tags: { accessible_toilet: t.value },
    direction: 'unknown',
    editedAt: t.editedAt,
    obtainedAt: t.obtainedAt,
    confirmedAt: t.confirmedAt,
    status: t.status,
    sourceUrl: t.sourceUrl,
    sourceLabel: t.sourceLabel,
    objectId: t.objectId,
  };
}

/**
 * Accessible toilets (only those a source states as accessible) within 150 m of the walking legs
 * (up to 3, at least 400 m apart along the walk) and within 300 m of the destination (up to 2,
 * on the final walking leg).
 */
export function addToilets(option: JourneyOption, toilets: AccessibleToilet[], locale: Locale = 'pl') {
  if (!toilets.length) return option;
  const grid = toiletGrid(toilets);
  const seen = new Map<number, Sample>();
  const samples = sampleWalks(option.legs);
  for (let i = 0; i < samples.length; i += 2) {
    for (const t of grid.within(samples[i], TOILET_ROUTE_RADIUS)) if (!seen.has(t)) seen.set(t, samples[i]);
  }
  const chosen = new Set<number>();
  let lastAt = -Infinity;
  for (const [t, s] of [...seen].sort((a, b) => a[1].at - b[1].at)) {
    if (chosen.size >= MAX_ROUTE_TOILETS) break;
    if (s.at - lastAt < TOILET_SPACING) continue;
    chosen.add(t);
    lastAt = s.at;
    insertFact(option.legs[s.leg] as WalkLeg, toiletFact(toilets[t], locale));
  }
  const final = option.legs.at(-1);
  if (final?.type === 'walk') {
    const near = grid
      .within(final.to, TOILET_DESTINATION_RADIUS)
      .filter(t => !chosen.has(t))
      .sort((a, b) => metres(final.to, toilets[a]) - metres(final.to, toilets[b]))
      .slice(0, MAX_DESTINATION_TOILETS);
    for (const t of near) final.facts.push(toiletFact(toilets[t], locale));
  }
  return option;
}

/** Apply today's extras to every option (rests first, so toilets do not shift rest positions). */
export function applyExtras(options: JourneyOption[], g: WalkGraph, p: Preferences, locale: Locale, toilets: () => AccessibleToilet[]) {
  let list: AccessibleToilet[] = [];
  if (p.showToilets) {
    try {
      list = toilets();
    } catch {
      list = [];
    }
  }
  for (const option of options) {
    addRestStops(option, g, p, locale);
    if (list.length) addToilets(option, list, locale);
  }
  return options;
}
