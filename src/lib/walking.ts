// Turns graph paths into user-facing walking legs and walking-only journey options.
import { handrail, type Way } from './data';
import {
  bearing, edgeAt, metres, nearest, nodePoint, onWheels, shortestPath, stairsPassable, strollerLift, type WalkGraph,
  IMPASSABLE, LONG_FLIGHT_STEPS, KERB_RAISED, KERB_ROLLED, KERB_UNKNOWN, NARROW, NODE_NO_WHEELCHAIR, NO_WHEELCHAIR, ROUGH, SETT, STEEP, STEP_BARRIER, VERY_ROUGH,
} from './routing';
import { serverMessages, type ServerMessages } from './i18n/server-messages';
import type { Locale } from './i18n/locales';
import type { Preferences } from './schemas';
import type { BarrierKind, CityFact, CityPlace, Point } from './city-types';
import type { JourneyOption, Leg, LegPoint, StairCounts, WalkLeg, WalkStep } from './journey-types';

/** Walking speed for people in recovery, metres per second. */
export const WALK_SPEED = 1.0;

/** Polish walking labels (default locale); see serverMessages(locale).labels for others. */
export const walkLabels = {
  preferred: serverMessages('pl').labels.preferred,
  shortest: serverMessages('pl').labels.shortest,
  alternative: serverMessages('pl').labels.alternative,
} as const;

const BENCH_RADIUS = 25;
const BENCH_SPACING = 150;
const ENTRANCE_RADIUS = 30;
const MAX_ENTRANCES = 2;
const TINY_SEGMENT = 15;
const TURN_ANGLE = 35;

export class OffNetworkError extends Error {}

/** Snap a point to the walking network or throw a user-facing error. */
export function snap(g: WalkGraph, point: Point, radius = 100, locale: Locale = 'pl') {
  const node = nearest(g, point, radius);
  if (node < 0) throw new OffNetworkError(serverMessages(locale).errors.offNetwork);
  return node;
}

export function formatDistance(m: number, locale: Locale = 'pl') {
  return serverMessages(locale).distance(m);
}

function stepCount(tags: Record<string, string>) {
  const n = Number(tags.step_count);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function stairsTitle(tags: Record<string, string>, direction: 'up' | 'down' | 'unknown', t: ServerMessages) {
  return t.facts.stairs(direction, stepCount(tags));
}

function osmFact(g: WalkGraph, kind: CityFact['kind'], type: 'way' | 'node', id: string, title: string, at: Point, tags: Record<string, string>, editedAt: string | null, direction: CityFact['direction'] = 'unknown'): CityFact {
  return {
    id: `${type}:${id}`,
    kind,
    title,
    lat: at.lat,
    lon: at.lon,
    tags,
    direction,
    editedAt,
    obtainedAt: g.obtainedAt,
    confirmedAt: null,
    status: 'osm',
    sourceUrl: `https://www.openstreetmap.org/${type}/${id}`,
  };
}

type Segment = { key: string; label: string; kind: 'stairs' | 'crossing' | 'way'; edges: number[]; distance: number };

function classify(way: Way, m: ServerMessages): Omit<Segment, 'edges' | 'distance'> {
  const t = way.tags;
  if (t.highway === 'steps') return { key: `steps:${way.id}`, label: m.steps.stairs, kind: 'stairs' };
  if (t.footway === 'crossing' || ((t.highway === 'footway' || t.highway === 'path') && t.crossing)) {
    return { key: 'crossing', label: m.steps.crossing, kind: 'crossing' };
  }
  if (t.name) return { key: `name:${t.name}`, label: t.name, kind: 'way' };
  if (['footway', 'path', 'pedestrian', 'living_street'].includes(t.highway)) return { key: 'foot', label: m.steps.foot, kind: 'way' };
  if (t.highway === 'service') return { key: 'service', label: m.steps.service, kind: 'way' };
  return { key: 'street', label: m.steps.street, kind: 'way' };
}

/** Group edges into named segments, folding segments shorter than 15 m into their neighbours. */
function segments(g: WalkGraph, edges: number[], m: ServerMessages): Segment[] {
  const raw: Segment[] = [];
  for (const e of edges) {
    const info = classify(g.ways[g.edgeWay[e]], m);
    const last = raw.at(-1);
    if (last && last.key === info.key) {
      last.edges.push(e);
      last.distance += g.edgeLength[e];
    } else raw.push({ ...info, edges: [e], distance: g.edgeLength[e] });
  }
  const merged: Segment[] = [];
  let carry: number[] = [];
  const flushCarry = () => {
    // Tiny pieces with no non-stair neighbour on one side stay as their own short segment.
    if (!carry.length) return;
    const info = classify(g.ways[g.edgeWay[carry[0]]], m);
    merged.push({ ...info, edges: carry, distance: carry.reduce((s, e) => s + g.edgeLength[e], 0) });
    carry = [];
  };
  for (const segment of raw) {
    if (segment.kind === 'stairs') flushCarry();
    if (segment.kind !== 'stairs' && segment.distance < TINY_SEGMENT) {
      const last = merged.at(-1);
      if (last && last.kind !== 'stairs') {
        last.edges.push(...segment.edges);
        last.distance += segment.distance;
      } else carry.push(...segment.edges);
      continue;
    }
    if (carry.length && segment.kind !== 'stairs') {
      segment.edges.unshift(...carry);
      segment.distance += carry.reduce((s, e) => s + g.edgeLength[e], 0);
      carry = [];
    }
    const last = merged.at(-1);
    if (last && last.key === segment.key) {
      last.edges.push(...segment.edges);
      last.distance += segment.distance;
    } else merged.push(segment);
  }
  flushCarry();
  return merged;
}

/** Bearing over roughly the first (or last) 20 m of a segment. */
function segmentBearing(g: WalkGraph, edges: number[], atEnd: boolean) {
  let travelled = 0;
  if (atEnd) {
    const end = g.edgeTo[edges.at(-1)!];
    let start = g.edgeFrom[edges.at(-1)!];
    for (let i = edges.length - 1; i >= 0 && travelled < 20; i--) {
      travelled += g.edgeLength[edges[i]];
      start = g.edgeFrom[edges[i]];
    }
    return bearing(nodePoint(g, start), nodePoint(g, end));
  }
  const start = g.edgeFrom[edges[0]];
  let end = g.edgeTo[edges[0]];
  for (let i = 0; i < edges.length && travelled < 20; i++) {
    travelled += g.edgeLength[edges[i]];
    end = g.edgeTo[edges[i]];
  }
  return bearing(nodePoint(g, start), nodePoint(g, end));
}

type Turn = 'go' | 'straight' | 'right' | 'left' | 'back';

function turnWord(delta: number): Turn {
  if (Math.abs(delta) > 150) return 'back';
  if (delta > TURN_ANGLE) return 'right';
  if (delta < -TURN_ANGLE) return 'left';
  return 'straight';
}

function buildSteps(g: WalkGraph, edges: number[], to: LegPoint, stairFactIds: Map<number, string>, m: ServerMessages): WalkStep[] {
  const steps: WalkStep[] = [];
  const parts = segments(g, edges, m);
  parts.forEach((segment, i) => {
    const distance = Math.round(segment.distance);
    if (segment.kind === 'stairs') {
      const edge = edgeAt(g, segment.edges[0]);
      const rail = m.facts.handrail(handrail(edge.way.tags));
      steps.push({ instruction: `${stairsTitle(edge.way.tags, edge.direction, m)} · ${rail}`, distance, factId: stairFactIds.get(segment.edges[0]) });
      return;
    }
    let turn: Turn = 'go';
    if (i > 0) {
      const delta = ((segmentBearing(g, segment.edges, false) - segmentBearing(g, parts[i - 1].edges, true) + 540) % 360) - 180;
      turn = turnWord(delta);
    }
    if (segment.kind === 'crossing') {
      const instruction = turn === 'go' || turn === 'straight' ? m.steps.cross : m.steps.turnAndCross(m.steps[turn]);
      steps.push({ instruction, distance });
    } else steps.push({ instruction: m.steps.along(m.steps[turn], segment.label), distance });
  });
  steps.push({ instruction: m.steps.destination(to.name), distance: 0 });
  return steps;
}

type NodeBarrierKind = 'kerbRaised' | 'step' | 'nodeNoWheelchair' | 'kerbUnknown' | 'kerbRolled';

function nodeBarrierKind(bits: number): NodeBarrierKind | null {
  if (bits & KERB_RAISED) return 'kerbRaised';
  if (bits & STEP_BARRIER) return 'step';
  if (bits & NODE_NO_WHEELCHAIR) return 'nodeNoWheelchair';
  if (bits & KERB_UNKNOWN) return 'kerbUnknown';
  if (bits & KERB_ROLLED) return 'kerbRolled';
  return null;
}

/** The most limiting property of a way stretch for wheels, or null. Stairs are reported separately. */
function surfaceKind(bits: number): BarrierKind | null {
  if (!bits) return null;
  if (bits & IMPASSABLE) return 'impassable';
  if (bits & NO_WHEELCHAIR) return 'noWheelchair';
  if (bits & NARROW) return 'narrow';
  if (bits & (ROUGH | VERY_ROUGH)) return bits & SETT ? 'sett' : 'rough';
  if (bits & STEEP) return 'steep';
  return null;
}

/** On crutches only what changes the effort matters: raised kerbs, steps, rough or steep stretches. */
function crutchNodeKind(bits: number): NodeBarrierKind | null {
  if (bits & KERB_RAISED) return 'kerbRaised';
  if (bits & STEP_BARRIER) return 'step';
  return null;
}

function crutchSurfaceKind(bits: number): BarrierKind | null {
  if (!bits) return null;
  if (bits & IMPASSABLE) return 'impassable';
  if (bits & (ROUGH | VERY_ROUGH)) return bits & SETT ? 'sett' : 'rough';
  if (bits & STEEP) return 'steep';
  return null;
}

/** Stretches shorter than this are not shown unless they block a wheelchair. */
const MIN_SURFACE = 10;

export type WalkLegOptions = {
  departure: number | null;
  /** True when the leg ends at the journey's final destination (entrances are shown). */
  destination: boolean;
  locale?: Locale;
};

/** Build a walking leg from a graph path between two (snapped) points. */
export function walkLeg(g: WalkGraph, edges: number[], from: LegPoint, to: LegPoint, p: Preferences, options: WalkLegOptions): WalkLeg {
  const m = serverMessages(options.locale);
  const nodes = edges.length ? [g.edgeFrom[edges[0]], ...edges.map(e => g.edgeTo[e])] : [];
  const points = nodes.map(n => nodePoint(g, n));
  const geometry: [number, number][] = [[from.lat, from.lon]];
  const position: number[] = [];
  let travelled = 0;
  let previous: Point = from;
  for (const point of points) {
    travelled += metres(previous, point);
    position.push(travelled);
    geometry.push([point.lat, point.lon]);
    previous = point;
  }
  travelled += metres(previous, to);
  geometry.push([to.lat, to.lon]);
  const distance = travelled;

  type Placed = { fact: CityFact; at: number };
  const placed: Placed[] = [];

  // Every stair way on the path, with direction relative to travel.
  const stairFactIds = new Map<number, string>();
  const seenStairs = new Set<string>();
  edges.forEach((e, i) => {
    const edge = edgeAt(g, e);
    if (edge.way.tags.highway !== 'steps') return;
    if (i > 0 && g.edgeWay[edges[i - 1]] === g.edgeWay[e]) return;
    const id = `way:${edge.way.id}`;
    stairFactIds.set(e, id);
    if (seenStairs.has(id)) return;
    seenStairs.add(id);
    placed.push({
      fact: osmFact(g, 'stairs', 'way', edge.way.id, stairsTitle(edge.way.tags, edge.direction, m), points[i], edge.way.tags, edge.way.editedAt, edge.direction),
      at: position[i],
    });
  });

  // Benches only when resting matters today, thinned along the route.
  if (p.preferRest) {
    const firstSeen = new Map<number, number>();
    points.forEach((point, i) => {
      for (const b of g.benchGrid.within(point, BENCH_RADIUS)) if (!firstSeen.has(b)) firstSeen.set(b, position[i]);
    });
    const candidates = [...firstSeen].sort((a, b) => a[1] - b[1]);
    const cap = Math.max(1, Math.floor(distance / BENCH_SPACING));
    let last = -Infinity;
    let kept = 0;
    for (const [b, at] of candidates) {
      if (kept >= cap) break;
      if (at - last < BENCH_SPACING) continue;
      const bench = g.benches[b];
      placed.push({ fact: osmFact(g, 'bench', 'node', bench.id, m.facts.bench, bench, bench.tags, bench.editedAt), at });
      last = at;
      kept++;
    }
  }

  // Kerbs, steps and surfaces matter on wheels and on crutches; listed once each, in route order.
  if (p.mobility !== 'walk') {
    const nodeKind = p.mobility === 'crutches' ? crutchNodeKind : nodeBarrierKind;
    const wayKind = p.mobility === 'crutches' ? crutchSurfaceKind : surfaceKind;
    const seenNodes = new Set<number>();
    edges.forEach((e, i) => {
      const node = g.edgeTo[e];
      const kind = nodeKind(g.nodeBarrier[node]);
      const source = g.barrierNodes.get(node);
      if (!kind || !source || seenNodes.has(node)) return;
      seenNodes.add(node);
      placed.push({ fact: { ...osmFact(g, 'kerb', 'node', source.id, m.facts[kind], source, source.tags, source.editedAt), barrier: kind }, at: position[i + 1] });
    });
    const surfaces = new Map<string, Placed>();
    let i = 0;
    while (i < edges.length) {
      const kind = g.ways[g.edgeWay[edges[i]]].tags.highway === 'steps' ? null : wayKind(g.edgeMobility[edges[i]]);
      let j = i;
      let length = 0;
      while (j < edges.length && (g.ways[g.edgeWay[edges[j]]].tags.highway === 'steps' ? null : wayKind(g.edgeMobility[edges[j]])) === kind) length += g.edgeLength[edges[j++]];
      const blocking = kind === 'impassable' || kind === 'narrow' || kind === 'noWheelchair';
      if (kind && (length >= MIN_SURFACE || blocking)) {
        const way = g.ways[g.edgeWay[edges[i]]];
        const existing = surfaces.get(`${way.id}:${kind}`);
        if (existing) existing.fact.length = (existing.fact.length ?? 0) + length;
        else {
          const fact: CityFact = { ...osmFact(g, 'surface', 'way', way.id, '', points[i], way.tags, way.editedAt), barrier: kind, length };
          const entry = { fact, at: position[i] };
          surfaces.set(`${way.id}:${kind}`, entry);
          placed.push(entry);
        }
      }
      i = j;
    }
    for (const { fact } of surfaces.values()) {
      fact.length = Math.round(fact.length!);
      fact.title = m.facts[fact.barrier as 'sett' | 'rough' | 'steep' | 'narrow' | 'noWheelchair' | 'impassable'](m.distance(fact.length));
    }
  }
  placed.sort((a, b) => a.at - b.at);

  // Entrances only around the final destination.
  if (options.destination) {
    const near = g.entranceGrid
      .within(to, ENTRANCE_RADIUS)
      .map(i => ({ node: g.entrances[i], d: metres(to, g.entrances[i]) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_ENTRANCES);
    for (const { node } of near) {
      const title = node.tags.entrance === 'main' ? m.facts.mainEntrance : m.facts.entrance;
      placed.push({ fact: osmFact(g, 'entrance', 'node', node.id, title, node, node.tags, node.editedAt), at: distance });
    }
  }

  return {
    type: 'walk',
    from,
    to,
    distance: Math.round(distance),
    seconds: Math.round(distance / WALK_SPEED),
    geometry,
    steps: buildSteps(g, edges, to, stairFactIds, m),
    facts: placed.map(x => x.fact),
    departure: options.departure,
  };
}

/** Summary fields shared by all options. `extra.hard` notes make it not fit; `extra.soft` are listed only. */
export function assess(legs: Leg[], p: Preferences, locale: Locale = 'pl', extra: { hard?: string[]; soft?: string[] } = {}) {
  const m = serverMessages(locale);
  const stairs: StairCounts = { up: 0, down: 0, unknown: 0 };
  let rests = 0;
  let walkingDistance = 0;
  let blockedStairs = 0;
  let noHandrail = 0;
  let handrailUnknown = 0;
  let longStairs = 0;
  const lifts: number[] = [];
  const kerbs: Partial<Record<BarrierKind, number>> = {};
  const stretches: Partial<Record<BarrierKind, number>> = {};
  for (const leg of legs) {
    if (leg.type !== 'walk') continue;
    walkingDistance += leg.distance;
    for (const fact of leg.facts) {
      if (fact.kind === 'stairs') {
        stairs[fact.direction]++;
        if (!stairsPassable(fact.tags, p.mobility)) blockedStairs++;
        else if (strollerLift(fact.tags, p.mobility)) lifts.push(stepCount(fact.tags)!);
        const rail = handrail(fact.tags);
        if (rail === 'no') noHandrail++;
        else if (rail === 'unknown') handrailUnknown++;
        if ((stepCount(fact.tags) ?? 0) > LONG_FLIGHT_STEPS) longStairs++;
      }
      if (fact.kind === 'bench') rests++;
      if (fact.kind === 'kerb' && fact.barrier) kerbs[fact.barrier] = (kerbs[fact.barrier] ?? 0) + 1;
      if (fact.kind === 'surface' && fact.barrier) stretches[fact.barrier] = (stretches[fact.barrier] ?? 0) + (fact.length ?? 0);
    }
  }
  const hard: string[] = [];
  const soft: string[] = [];
  const total = stairs.up + stairs.down + stairs.unknown;
  if (onWheels(p.mobility)) {
    const wheelchair = p.mobility === 'wheelchair';
    if (blockedStairs) hard.push(m.issues.stairs(blockedStairs));
    // Short flights a pushchair may use are always disclosed, without changing `fits`.
    if (lifts.length) soft.push(m.issues.shortSteps(lifts.length, lifts[0]));
    if (kerbs.kerbRaised) (wheelchair ? hard : soft).push(m.issues.kerbRaised(kerbs.kerbRaised));
    if (kerbs.step) (wheelchair ? hard : soft).push(m.issues.step(kerbs.step));
    if (kerbs.nodeNoWheelchair && wheelchair) hard.push(m.issues.noWheelchair);
    if (stretches.impassable) hard.push(m.issues.impassable);
    if (stretches.narrow) (wheelchair ? hard : soft).push(m.issues.narrow);
    if (stretches.noWheelchair) (wheelchair ? hard : soft).push(m.issues.noWheelchair);
    if ((stretches.sett ?? 0) >= 20) soft.push(m.issues.sett(m.distance(stretches.sett!)));
    if ((stretches.rough ?? 0) >= 20) soft.push(m.issues.rough(m.distance(stretches.rough!)));
    if ((stretches.steep ?? 0) >= 10) soft.push(m.issues.steep(m.distance(stretches.steep!)));
    if (kerbs.kerbUnknown) soft.push(m.issues.kerbUnknown(kerbs.kerbUnknown));
  } else {
    if (p.avoidStairs && total > 0) hard.push(m.issues.stairs(total));
    else {
      if (p.avoidUp && stairs.up) hard.push(m.issues.stairsUp);
      if (p.avoidDown && stairs.down) hard.push(m.issues.stairsDown);
      if ((p.avoidUp || p.avoidDown) && stairs.unknown) hard.push(m.issues.stairsUnknown);
    }
    // On crutches: what makes the stairs and the way harder, listed without changing `fits`.
    if (p.mobility === 'crutches') {
      if (noHandrail) soft.push(m.issues.stairsNoHandrail(noHandrail));
      if (handrailUnknown) soft.push(m.issues.stairsHandrailUnknown(handrailUnknown));
      if (longStairs) soft.push(m.issues.longStairs(longStairs));
      if (kerbs.kerbRaised) soft.push(m.issues.kerbRaised(kerbs.kerbRaised));
      if (kerbs.step) soft.push(m.issues.step(kerbs.step));
      if (stretches.impassable) soft.push(m.issues.impassable);
      if ((stretches.sett ?? 0) >= 20) soft.push(m.issues.sett(m.distance(stretches.sett!)));
      if ((stretches.rough ?? 0) >= 20) soft.push(m.issues.rough(m.distance(stretches.rough!)));
      if ((stretches.steep ?? 0) >= 10) soft.push(m.issues.steep(m.distance(stretches.steep!)));
    }
  }
  if (walkingDistance > p.maxDistance) hard.push(m.issues.overLimit(m.distance(p.maxDistance)));
  hard.push(...(extra.hard ?? []));
  soft.push(...(extra.soft ?? []));
  return { stairs, rests, walkingDistance, issues: [...hard, ...soft], fits: hard.length === 0 };
}

function pathLength(g: WalkGraph, edges: number[]) {
  return edges.reduce((s, e) => s + g.edgeLength[e], 0);
}

/** Share of the shorter path's length that also appears in the other path (either direction). */
export function overlap(g: WalkGraph, a: number[], b: number[]) {
  const n = g.ids.length;
  const pairs = new Set<number>();
  for (const e of b) {
    pairs.add(g.edgeFrom[e] * n + g.edgeTo[e]);
    pairs.add(g.edgeTo[e] * n + g.edgeFrom[e]);
  }
  const shared = a.reduce((s, e) => s + (pairs.has(g.edgeFrom[e] * n + g.edgeTo[e]) ? g.edgeLength[e] : 0), 0);
  return shared / Math.max(1, Math.min(pathLength(g, a), pathLength(g, b)));
}

function stairSignature(g: WalkGraph, edges: number[]) {
  return [...new Set(edges.filter(e => g.ways[g.edgeWay[e]].tags.highway === 'steps').map(e => g.edgeWay[e]))].join();
}

/** Walk between two points on the graph (prefs first, then unrestricted as a fallback). */
export function walkBetween(g: WalkGraph, from: LegPoint, to: LegPoint, p: Preferences, options: WalkLegOptions, nodes?: { start: number; end: number }) {
  const start = nodes?.start ?? snap(g, from, 100, options.locale);
  const end = nodes?.end ?? snap(g, to, 100, options.locale);
  const edges = shortestPath(g, start, end, p) ?? shortestPath(g, start, end, null);
  if (!edges) return null;
  return walkLeg(g, edges, from, to, p, options);
}

/** Straight-line placeholder walk when no graph route exists (distance × 1.3). */
export function straightWalk(from: LegPoint, to: LegPoint, departure: number | null, locale: Locale = 'pl'): WalkLeg {
  const distance = Math.round(metres(from, to) * 1.3);
  return {
    type: 'walk',
    from,
    to,
    distance,
    seconds: Math.round(distance / WALK_SPEED),
    geometry: [[from.lat, from.lon], [to.lat, to.lon]],
    steps: [{ instruction: serverMessages(locale).steps.walkTo(to.name), distance }],
    facts: [],
    departure,
  };
}

export function legDuration(leg: Leg) {
  return leg.type === 'ride' ? leg.arrival - leg.departure : leg.seconds;
}

export function makeOption(id: string, kind: JourneyOption['kind'], label: string, legs: Leg[], departure: number | null, arrival: number | null, p: Preferences, locale: Locale = 'pl', extra: { hard?: string[]; soft?: string[] } = {}): JourneyOption {
  const summary = assess(legs, p, locale, extra);
  const rides = legs.filter(l => l.type === 'ride').length;
  const duration = departure !== null && arrival !== null ? arrival - departure : legs.reduce((s, l) => s + legDuration(l), 0);
  return {
    id,
    kind,
    label,
    legs,
    departure,
    arrival,
    duration,
    walkingDistance: summary.walkingDistance,
    transfers: Math.max(0, rides - 1),
    stairs: summary.stairs,
    rests: summary.rests,
    fits: summary.fits,
    issues: summary.issues,
  };
}

/**
 * Walking-only options: the route honouring today's preferences plus a
 * meaningfully different alternative (shortest ignoring preferences, or a
 * penalised second route when the shortest is essentially the same).
 */
export function walkingOptions(g: WalkGraph, from: CityPlace, to: CityPlace, p: Preferences, departure: number, locale: Locale = 'pl') {
  const m = serverMessages(locale);
  const errors: string[] = [];
  const start = snap(g, from, 100, locale);
  const end = snap(g, to, 100, locale);
  const preferred = shortestPath(g, start, end, p);
  const shortest = shortestPath(g, start, end, null);
  const routes: { id: string; label: string; edges: number[] }[] = [];

  if (preferred) routes.push({ id: 'walk-preferred', label: m.labels.preferred, edges: preferred });
  else errors.push(p.mobility === 'walk' ? m.errors.noPreferredWalk : m.errors.noBarrierFreeWalk);

  if (shortest) {
    const different = !preferred || stairSignature(g, shortest) !== stairSignature(g, preferred) || overlap(g, shortest, preferred) < 0.9;
    if (different) routes.push({ id: 'walk-shortest', label: m.labels.shortest, edges: shortest });
    else if (preferred && preferred.length) {
      const penalise = new Uint8Array(g.ways.length);
      for (const e of preferred) penalise[g.edgeWay[e]] = 1;
      const alternative = shortestPath(g, start, end, p, penalise);
      if (alternative && overlap(g, alternative, preferred) < 0.8 && pathLength(g, alternative) <= pathLength(g, preferred) * 1.5) {
        routes.push({ id: 'walk-alternative', label: m.labels.alternative, edges: alternative });
      }
    }
  }

  const fromPoint: LegPoint = { name: from.name, lat: from.lat, lon: from.lon };
  const toPoint: LegPoint = { name: to.name, lat: to.lat, lon: to.lon };
  const options = routes.map(route => {
    const leg = walkLeg(g, route.edges, fromPoint, toPoint, p, { departure, destination: true, locale });
    return makeOption(route.id, 'walk', route.label, [leg], departure, departure + leg.seconds, p, locale);
  });
  return { options, errors };
}
