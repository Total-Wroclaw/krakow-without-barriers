// Taxi (door to door) and car (drive, park, walk) options over the OSM road graph.
// Driving times are estimates (speed limits × urban factor + junction delays); no live traffic,
// no waiting for a taxi, no time to find a free space. Taxi fares are a range from the official
// Kraków maximum taxi prices (taxi.ts), not a quote.
import { metres, nearest, reach, type WalkGraph } from './routing';
import { drivesTo, driveGeometry, fastestDrive, roadName, roadNearest, roadPoint, type Drive, type RoadGraph } from './roads';
import { parkingInfo, parkingsNear, type Parking } from './parking';
import { makeOption, snap, straightWalk, walkBetween, walkLeg } from './walking';
import { serverMessages } from './i18n/server-messages';
import { rideLinks, taxiFare } from './taxi';
import type { Locale } from './i18n/locales';
import type { Preferences } from './schemas';
import type { CityPlace } from './city-types';
import type { DriveLeg, JourneyOption, Leg, LegPoint, ParkingInfo } from './journey-types';

/** How far a place may be from a road where a car can stop. */
const ROAD_SNAP = 400;
/** A car park further than this from any road node is not reachable by car in our data. */
const PARKING_ROAD_SNAP = 200;
export const PARKING_RADIUS = 600;
const PARKING_CANDIDATES = 12;
const MAX_CAR_OPTIONS = 3;
/** Car parks closer together than this count as the same choice. */
const DISTINCT_PARKING = 80;
/** Max routing cost of the walk from a car park to the destination (cost >= metres). */
const PARKING_WALK_COST = 2000;

export class DriveError extends Error {}

const point = (p: { name: string; lat: number; lon: number }): LegPoint => ({ name: p.name, lat: p.lat, lon: p.lon });

type Context = { walk: WalkGraph; roads: RoadGraph; p: Preferences; locale: Locale };

/** Even a short access walk can contain stairs or a kerb. Only identical endpoints need no walk. */
function kerbWalk(c: Context, from: LegPoint, to: LegPoint, departure: number, destination: boolean) {
  if (from.lat === to.lat && from.lon === to.lon) return null;
  try {
    return walkBetween(c.walk, from, to, c.p, { departure, destination, locale: c.locale }) ?? straightWalk(from, to, departure, c.locale);
  } catch {
    return straightWalk(from, to, departure, c.locale);
  }
}

function driveLeg(c: Context, mode: 'taxi' | 'car', drive: Drive, startNode: number, from: LegPoint, to: LegPoint, departure: number, parking?: ParkingInfo): DriveLeg {
  const geometry = driveGeometry(c.roads, drive, startNode);
  if (metres(from, { lat: geometry[0][0], lon: geometry[0][1] }) > 1) geometry.unshift([from.lat, from.lon]);
  const last = geometry.at(-1)!;
  if (metres(to, { lat: last[0], lon: last[1] }) > 1) geometry.push([to.lat, to.lon]);
  return {
    type: 'drive',
    mode,
    from,
    to,
    distance: Math.round(drive.distance),
    seconds: Math.round(drive.seconds),
    geometry,
    departure,
    ...(parking ? { parking } : {}),
  };
}

function kerbPoint(c: Context, node: number, fallback: string): LegPoint {
  const at = roadPoint(c.roads, node);
  return { name: roadName(c.roads, node) ?? fallback, lat: at.lat, lon: at.lon };
}

function roadNode(c: Context, place: { lat: number; lon: number }) {
  const node = roadNearest(c.roads, place, ROAD_SNAP);
  if (node < 0) throw new DriveError(serverMessages(c.locale).errors.offRoad);
  return node;
}

/** Road nodes considered as the kerb for a place, and how many of them. */
const KERB_RADIUS = 250;
const KERB_CANDIDATES = 40;

/**
 * Kerb (road node where a car can stop) with the shortest walk, honouring today's preferences,
 * to (`reverse` = false) or from the place. The nearest road can be a tunnel or the far side of a
 * building, so straight-line distance alone is not enough.
 */
function kerbNode(c: Context, place: CityPlace, reverse: boolean) {
  const fallback = roadNode(c, place);
  const start = nearest(c.walk, place, 100);
  if (start < 0) return fallback;
  const candidates = c.roads.stopGrid
    .within(place, KERB_RADIUS)
    .map(node => ({ node, d: metres(place, roadPoint(c.roads, node)) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, KERB_CANDIDATES)
    .map(x => ({ node: x.node, walkNode: nearest(c.walk, roadPoint(c.roads, x.node), 30) }))
    .filter(x => x.walkNode >= 0);
  if (!candidates.length) return fallback;
  const targets = new Set(candidates.map(x => x.walkNode));
  const walks = reach(c.walk, start, c.p, KERB_RADIUS * 4, targets, reverse);
  let best = fallback;
  let bestWalk = Infinity;
  for (const x of candidates) {
    const walked = walks.distance.get(x.walkNode);
    if (walked === undefined) continue;
    const total = walked + metres(roadPoint(c.roads, x.node), { lat: c.walk.lat[x.walkNode], lon: c.walk.lon[x.walkNode] });
    if (total < bestWalk) {
      best = x.node;
      bestWalk = total;
    }
  }
  return best;
}

/** Legs: optional walk to the kerb, the drive, optional walk from the kerb; times chained from `departure`. */
function timed(legs: (Leg | null)[], departure: number) {
  let clock = departure;
  const result: Leg[] = [];
  for (const leg of legs) {
    if (!leg) continue;
    leg.departure = clock;
    clock += leg.type === 'ride' ? leg.arrival - leg.departure : leg.seconds;
    result.push(leg);
  }
  return { legs: result, arrival: clock };
}

export function taxiOption(c: Context, from: CityPlace, to: CityPlace, departure: number): JourneyOption {
  const m = serverMessages(c.locale);
  const startNode = kerbNode(c, from, false);
  const endNode = kerbNode(c, to, true);
  const drive = fastestDrive(c.roads, startNode, endNode);
  if (!drive) throw new DriveError(m.errors.driveFailed);
  const origin = point(from);
  const destination = point(to);
  const pickup = kerbPoint(c, startNode, m.places.pickup);
  const dropOff = kerbPoint(c, endNode, m.places.dropOff);
  const before = kerbWalk(c, origin, pickup, departure, false);
  const after = kerbWalk(c, dropOff, destination, departure, true);
  const ride = driveLeg(c, 'taxi', drive, startNode, before ? pickup : origin, after ? dropOff : destination, departure);
  ride.fare = taxiFare(ride.distance, c.locale);
  const { legs, arrival } = timed([before, ride, after], departure);
  const soft = c.p.mobility === 'wheelchair' ? [m.issues.accessibleTaxi] : [];
  const option = makeOption('taxi', 'taxi', m.labels.taxi, legs, departure, arrival, c.p, c.locale, { soft });
  // Pickup and drop-off at the kerbs the walking legs lead to; destination named as the user chose it.
  option.rideLinks = rideLinks({ ...ride.from, name: from.name }, { ...ride.to, name: to.name }, c.locale);
  return option;
}

type ParkingChoice = { parking: Parking; walkNode: number; roadNode: number; walked: number; path: number[] };

/** Car parks near the destination ranked by the walk (with today's preferences) to the destination. */
function parkingChoices(c: Context, to: CityPlace, disabledOnly: boolean): ParkingChoice[] {
  const candidates = parkingsNear(to, PARKING_RADIUS, { disabledOnly }).slice(0, PARKING_CANDIDATES);
  if (!candidates.length) return [];
  const destinationNode = snap(c.walk, to, 100, c.locale);
  const located = candidates
    .map(parking => ({ parking, walkNode: nearest(c.walk, parking, 100), roadNode: roadNearest(c.roads, parking, PARKING_ROAD_SNAP) }))
    .filter(x => x.walkNode >= 0 && x.roadNode >= 0);
  const targets = new Set(located.map(x => x.walkNode));
  let walks = reach(c.walk, destinationNode, c.p, PARKING_WALK_COST, targets, true);
  if (![...targets].some(n => walks.distance.has(n))) walks = reach(c.walk, destinationNode, null, PARKING_WALK_COST, targets, true);
  const snapEnd = metres(to, { lat: c.walk.lat[destinationNode], lon: c.walk.lon[destinationNode] });
  const scored: ParkingChoice[] = [];
  for (const x of located) {
    const graphWalk = walks.distance.get(x.walkNode);
    if (graphWalk === undefined) continue;
    const walked = metres(x.parking, { lat: c.walk.lat[x.walkNode], lon: c.walk.lon[x.walkNode] }) + graphWalk + snapEnd;
    scored.push({ ...x, walked, path: walks.path(x.walkNode) ?? [] });
  }
  scored.sort((a, b) => a.walked - b.walked);
  const chosen: ParkingChoice[] = [];
  for (const s of scored) {
    if (chosen.length >= MAX_CAR_OPTIONS) break;
    if (chosen.some(x => metres(x.parking, s.parking) < DISTINCT_PARKING)) continue;
    chosen.push(s);
  }
  return chosen;
}

export function carOptions(c: Context, from: CityPlace, to: CityPlace, departure: number): JourneyOption[] {
  const m = serverMessages(c.locale);
  const startNode = kerbNode(c, from, false);
  const origin = point(from);
  const destination = point(to);
  const carStart = kerbPoint(c, startNode, m.places.carStart);
  const disabledOnly = c.p.mobility === 'wheelchair';
  const choices = parkingChoices(c, to, disabledOnly);
  const drives = drivesTo(c.roads, startNode, choices.map(x => x.roadNode));
  const options: JourneyOption[] = [];
  for (const choice of choices) {
    const drive = drives.get(choice.roadNode);
    if (!drive) continue;
    const info = parkingInfo(choice.parking, c.locale, metres(choice.parking, to));
    const near = m.distance(Math.round(choice.walked / 10) * 10 || Math.round(choice.walked));
    const name = choice.parking.name ?? (choice.parking.kind === 'disabled_space' ? m.places.disabledSpaceNear(near) : m.places.parkingNear(near));
    const parkingPoint: LegPoint = { name: info.name, lat: info.lat, lon: info.lon };
    const before = kerbWalk(c, origin, carStart, departure, false);
    const ride = driveLeg(c, 'car', drive, startNode, before ? carStart : origin, parkingPoint, departure, info);
    const after = walkLeg(c.walk, choice.path, parkingPoint, destination, c.p, { departure, destination: true, locale: c.locale });
    const { legs, arrival } = timed([before, ride, after], departure);
    options.push(makeOption(`car-${choice.parking.id.replace('/', '-')}`, 'car', m.labels.car(name), legs, departure, arrival, c.p, c.locale));
  }
  if (options.length) return options;

  // No (accessible) car park within reach: drive to the kerb nearest the destination, clearly labelled.
  const endNode = kerbNode(c, to, true);
  const drive = fastestDrive(c.roads, startNode, endNode);
  if (!drive) throw new DriveError(m.errors.driveFailed);
  const dropOff = kerbPoint(c, endNode, m.places.dropOff);
  const before = kerbWalk(c, origin, carStart, departure, false);
  const after = kerbWalk(c, dropOff, destination, departure, true);
  const ride = driveLeg(c, 'car', drive, startNode, before ? carStart : origin, after ? dropOff : destination, departure);
  const { legs, arrival } = timed([before, ride, after], departure);
  const radius = m.distance(PARKING_RADIUS);
  const hard = [disabledOnly ? m.issues.noDisabledParking(radius) : m.issues.noParking(radius)];
  return [makeOption('car-dropoff', 'car', m.labels.carDropOff, legs, departure, arrival, c.p, c.locale, { hard })];
}

export function driveOptions(walk: WalkGraph, roads: RoadGraph, from: CityPlace, to: CityPlace, p: Preferences, departure: number, mode: 'taxi' | 'car', locale: Locale = 'pl') {
  const c: Context = { walk, roads, p, locale };
  return mode === 'taxi' ? [taxiOption(c, from, to, departure)] : carOptions(c, from, to, departure);
}
