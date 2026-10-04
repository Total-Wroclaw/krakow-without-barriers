// Timetable journeys over the local ZTP GTFS snapshot (.runtime/transit.sqlite).
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { runtimeDir } from './server';
import { metres, nearest, onWheels, PointGrid, reach, shortestPath, wantsRest, type Reach, type WalkGraph } from './routing';
import { activeServices, connectionTable, scan, usableConnections, type ConnectionTable, type Footpaths, type ScanJourney } from './transit-scan';
import { makeOption, snap, straightWalk, walkBetween, walkLeg, WALK_SPEED } from './walking';
import { addRestStops } from './journey-extras';
import { serverMessages } from './i18n/server-messages';
import type { Locale } from './i18n/locales';
import type { Preferences } from './schemas';
import type { CityPlace, Point, Stop } from './city-types';
import type { JourneyOption, Leg, LegPoint, RideLeg } from './journey-types';

/** Straight-line radius for candidate access/egress stops. */
const STOP_RADIUS = 900;
/** Max routing cost of an access/egress walk (cost >= metres). */
const ACCESS_COST = 1500;
const TRANSFER_RADIUS = 400;
const SAME_STOP_TRANSFER = 120;
const BOARDING_BUFFER = 60;
const MAX_OPTIONS = 4;
const MAX_SCANS = 6;
/** Scans including re-runs after correcting an underestimated walking transfer. */
const MAX_SCAN_RUNS = 14;
/** Below this straight distance two stop ids are treated as the same physical stop. */
const SAME_PLACE = 15;
const WINDOW_SECONDS = 5 * 3600;

class TransitUnavailableError extends Error {}

type Calendar = { service: string; start: string; end: string; days: string };

type TransitData = {
  db: DatabaseSync;
  stops: Stop[];
  stopIndex: Map<string, number>;
  grid: PointGrid;
  footpaths: Footpaths;
  calendars: Calendar[];
  /** Walking-graph node per stop (-1 off-network, -2 not computed yet). */
  stopNodes: Int32Array;
  stopNodesGraph: WalkGraph | null;
};

let transit: TransitData | undefined;

function transitData(): TransitData {
  if (transit) return transit;
  // KROK_TRANSIT_DB lets a container bake the timetable into the image while reports live on a volume.
  const file = process.env.KROK_TRANSIT_DB ?? path.join(runtimeDir, 'transit.sqlite');
  if (!existsSync(file)) throw new TransitUnavailableError('Brak lokalnego rozkładu ZTP.');
  const db = new DatabaseSync(file, { readOnly: true });
  const stops = db.prepare('SELECT id, name, code, lat, lon, wheelchair FROM stops').all() as Stop[];
  const grid = new PointGrid(Float64Array.from(stops, s => s.lat), Float64Array.from(stops, s => s.lon), 0.003);

  // Walking transfers: straight line × 1.3 at walking speed plus a 60 s buffer,
  // never quicker than staying on the same platform.
  const offsets = new Int32Array(stops.length + 1);
  const targets: number[] = [];
  const seconds: number[] = [];
  stops.forEach((stop, i) => {
    for (const j of grid.within(stop, TRANSFER_RADIUS)) {
      if (j === i) continue;
      targets.push(j);
      seconds.push(Math.max(SAME_STOP_TRANSFER, Math.round((metres(stop, stops[j]) * 1.3) / WALK_SPEED + 60)));
    }
    offsets[i + 1] = targets.length;
  });

  transit = {
    db,
    stops,
    stopIndex: new Map(stops.map((s, i) => [s.id, i])),
    grid,
    footpaths: { offsets, targets: Int32Array.from(targets), seconds: Int32Array.from(seconds) },
    calendars: db.prepare('SELECT service, start, end, days FROM calendar').all() as Calendar[],
    stopNodes: new Int32Array(stops.length).fill(-2),
    stopNodesGraph: null,
  };
  return transit;
}

export function transitStops(): Stop[] {
  return transitData().stops;
}

function stopNode(data: TransitData, g: WalkGraph, stop: number) {
  if (data.stopNodesGraph !== g) {
    data.stopNodes.fill(-2);
    data.stopNodesGraph = g;
  }
  if (data.stopNodes[stop] === -2) data.stopNodes[stop] = nearest(g, data.stops[stop], 100);
  return data.stopNodes[stop];
}

function dayKey(date: string, offset: number) {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10).replaceAll('-', '');
}

/** GTFS wheelchair_accessible per interned trip: 1 yes, 2 no, 0 unknown. */
type Window = { table: ConnectionTable; trips: string[]; tripAccess: Uint8Array; start: number; end: number; accessibleTable?: ConnectionTable };

function accessCode(value: string | null | undefined) {
  return value === '1' ? 1 : value === '2' ? 2 : 0;
}

const windows = new Map<string, Window>();

/** Connections of services active on `date` (and adjacent days, for trips crossing midnight) departing in [start, end]. */
function timetableWindow(data: TransitData, date: string, start: number, end: number): Window {
  const key = `${date}:${start}:${end}`;
  const hit = windows.get(key);
  if (hit) {
    windows.delete(key);
    windows.set(key, hit);
    return hit;
  }
  const stopIndex = data.stopIndex;
  const tripIndex = new Map<string, number>();
  const trips: string[] = [];
  const access: number[] = [];
  const rows: Parameters<typeof connectionTable>[0] = [];
  for (const offset of [-1, 0, 1]) {
    const day = dayKey(date, offset);
    const exceptions = data.db.prepare('SELECT service, type FROM exceptions WHERE date = ?').all(day) as { service: string; type: number }[];
    const services = [...activeServices(data.calendars, exceptions, day)];
    if (!services.length) continue;
    const statement = data.db.prepare(
      `SELECT c.trip, c.from_id, c.to_id, c.departure, c.arrival, c.sequence, c.pickup, c.dropoff, t.wheelchair
       FROM connections c JOIN trips t ON t.id = c.trip
       WHERE t.service IN (${services.map(() => '?').join(',')}) AND c.departure >= ? AND c.departure <= ?`,
    );
    statement.setReturnArrays(true);
    const shift = offset * 86400;
    for (const row of statement.all(...services, start - shift, end - shift) as unknown as [string, string, string, number, number, number, number, number, string | null][]) {
      const from = stopIndex.get(row[1]);
      const to = stopIndex.get(row[2]);
      if (from === undefined || to === undefined) continue;
      const tripKey = `${row[0]}@${offset}`;
      let trip = tripIndex.get(tripKey);
      if (trip === undefined) {
        trip = trips.length;
        tripIndex.set(tripKey, trip);
        trips.push(tripKey);
        access.push(accessCode(row[8]));
      }
      rows.push({ trip, from, to, departure: row[3] + shift, arrival: row[4] + shift, sequence: row[5], pickup: row[6], dropoff: row[7] });
    }
  }
  const window: Window = { table: connectionTable(rows, trips.length, data.stops.length), trips, tripAccess: Uint8Array.from(access), start, end };
  windows.set(key, window);
  if (windows.size > 6) windows.delete(windows.keys().next().value!);
  return window;
}

const transferCache = new Map<string, number>();

function preferenceKey(p: Preferences) {
  return [p.avoidStairs, p.avoidDown, p.avoidUp, p.preferHandrails, wantsRest(p)].map(Number).join('') + p.mobility;
}

/**
 * Real walking-transfer seconds (graph route honouring preferences, plus the
 * 60 s buffer), or Infinity when no acceptable walk exists. Cached per process.
 */
function transferSeconds(data: TransitData, g: WalkGraph, a: number, b: number, p: Preferences, estimate: number) {
  if (metres(data.stops[a], data.stops[b]) < SAME_PLACE) return estimate;
  const key = `${preferenceKey(p)}:${a}:${b}`;
  const hit = transferCache.get(key);
  if (hit !== undefined) return hit;
  const start = stopNode(data, g, a);
  const end = stopNode(data, g, b);
  let seconds = estimate;
  if (start >= 0 && end >= 0) {
    const edges = shortestPath(g, start, end, p);
    if (!edges) seconds = Infinity;
    else {
      const walked = edges.reduce((s, e) => s + g.edgeLength[e], 0);
      const distance = metres(data.stops[a], { lat: g.lat[start], lon: g.lon[start] }) + walked + metres(data.stops[b], { lat: g.lat[end], lon: g.lon[end] });
      seconds = Math.max(SAME_STOP_TRANSFER, Math.round(distance / WALK_SPEED + 60));
    }
  }
  if (transferCache.size > 20_000) transferCache.clear();
  transferCache.set(key, seconds);
  return seconds;
}

function footpathSlot(footpaths: Footpaths, a: number, b: number) {
  for (let f = footpaths.offsets[a]; f < footpaths.offsets[a + 1]; f++) if (footpaths.targets[f] === b) return f;
  return -1;
}

/**
 * Check the walking transfers a journey relies on against the real graph walk.
 * Underestimated footpaths are corrected in `footpaths`; returns false if any was.
 */
function verifyTransfers(data: TransitData, g: WalkGraph, journey: ScanJourney, footpaths: Footpaths, p: Preferences) {
  let valid = true;
  for (const part of journey.parts) {
    if (part.kind !== 'walk') continue;
    const real = transferSeconds(data, g, part.from, part.to, p, part.seconds);
    if (real <= part.seconds) continue;
    const slot = footpathSlot(footpaths, part.from, part.to);
    if (slot >= 0) footpaths.seconds[slot] = real === Infinity ? 2_000_000_000 : real;
    valid = false;
  }
  return valid;
}

type Endpoint = { node: number; reach: Reach; seconds: Map<number, number>; walkingSeconds: Map<number, number> };

/** Walking seconds between a place and every reachable stop within STOP_RADIUS. */
function endpoint(data: TransitData, g: WalkGraph, place: Point, p: Preferences, reverse: boolean, locale: Locale): Endpoint {
  const node = snap(g, place, 100, locale);
  // Stops explicitly marked without step-free boarding are skipped for a wheelchair.
  const candidates = data.grid.within(place, STOP_RADIUS).filter(s => p.mobility !== 'wheelchair' || data.stops[s].wheelchair !== '2');
  const byNode = new Map<number, number[]>();
  for (const s of candidates) {
    const n = stopNode(data, g, s);
    if (n < 0) continue;
    byNode.set(n, [...(byNode.get(n) ?? []), s]);
  }
  const targets = new Set(byNode.keys());
  let result = reach(g, node, p, ACCESS_COST, targets, reverse);
  // Stops unreachable without excluded stairs fall back to an unrestricted walk (flagged later by issues).
  if (![...targets].some(n => result.distance.has(n))) result = reach(g, node, null, ACCESS_COST, targets, reverse);
  const seconds = new Map<number, number>();
  const snapPlace = metres(place, { lat: g.lat[node], lon: g.lon[node] });
  for (const [n, stops] of byNode) {
    const walked = result.distance.get(n);
    if (walked === undefined) continue;
    for (const s of stops) {
      const total = snapPlace + walked + metres(data.stops[s], { lat: g.lat[n], lon: g.lon[n] });
      seconds.set(s, Math.round(total / WALK_SPEED));
    }
  }
  return { node, reach: result, seconds, walkingSeconds: new Map(seconds) };
}

function walkingSeconds(j: ScanJourney) {
  return j.accessSeconds + j.egressSeconds + j.parts.reduce((s, p) => s + (p.kind === 'walk' ? p.seconds : 0), 0);
}

type Candidate = { journey: ScanJourney; window: Window; signature: string; option: JourneyOption };

function signature(j: ScanJourney, w: Window) {
  return j.parts
    .filter(p => p.kind === 'ride')
    .map(p => (p.kind === 'ride' ? `${w.trips[w.table.trip[p.board]]}:${w.table.departure[p.board]}:${w.table.arrival[p.alight]}` : ''))
    .join('|');
}

/** Drop duplicates and options another option beats on leave time, arrival and transfers. */
function nonDominated(candidates: Candidate[]) {
  const unique = new Map<string, Candidate>();
  for (const c of candidates) {
    const existing = unique.get(c.signature);
    if (!existing || walkingSeconds(c.journey) < walkingSeconds(existing.journey)) unique.set(c.signature, c);
  }
  const list = [...unique.values()];
  return list.filter((b, ib) =>
    !list.some((a, ia) => {
      if (ia === ib) return false;
      const A = a.journey;
      const B = b.journey;
      if (A.leave < B.leave || A.arrival > B.arrival || A.boardings > B.boardings) return false;
      if (A.leave > B.leave || A.arrival < B.arrival || A.boardings < B.boardings) return true;
      const wa = walkingSeconds(A);
      const wb = walkingSeconds(B);
      return wa < wb || (wa === wb && ia < ib);
    }),
  );
}

/**
 * 0 = every ride marked accessible, 1 = some ride without information, 2 = some ride marked not accessible.
 * Wheelchair journeys never contain 2 (those trips are removed before the scan).
 */
function accessRank(c: Candidate) {
  let rank = 0;
  for (const part of c.journey.parts) {
    if (part.kind !== 'ride') continue;
    const code = c.window.tripAccess[c.window.table.trip[part.board]];
    rank = Math.max(rank, code === 1 ? 0 : code === 2 ? 2 : 1);
  }
  return rank;
}

function nearestShape(points: [number, number][], start: Stop, end: Stop): [number, number][] {
  let a = 0;
  let best = Infinity;
  points.forEach((p, i) => {
    const d = metres({ lat: p[0], lon: p[1] }, start);
    if (d < best) {
      a = i;
      best = d;
    }
  });
  let b = a;
  best = Infinity;
  for (let i = a; i < points.length; i++) {
    const d = metres({ lat: points[i][0], lon: points[i][1] }, end);
    if (d < best) {
      b = i;
      best = d;
    }
  }
  return points.slice(a, Math.max(a + 1, b + 1));
}

function rideLeg(data: TransitData, w: Window, board: number, alight: number): RideLeg {
  const t = w.table;
  const tripId = w.trips[t.trip[board]].replace(/@-?\d+$/, '');
  const info = data.db
    .prepare('SELECT t.headsign, t.shape, t.wheelchair, r.name AS line, r.type FROM trips t JOIN routes r ON r.id = t.route WHERE t.id = ?')
    .get(tripId) as { headsign: string; shape: string; wheelchair: string; line: string; type: number };
  const rows = data.db
    .prepare('SELECT from_id, to_id FROM connections WHERE trip = ? AND sequence >= ? AND sequence <= ? ORDER BY sequence')
    .all(tripId, t.sequence[board], t.sequence[alight]) as { from_id: string; to_id: string }[];
  const byId = (id: string) => data.stops[data.stopIndex.get(id) ?? -1];
  const from = data.stops[t.from[board]];
  const to = data.stops[t.to[alight]];
  const stops = rows.length ? [byId(rows[0].from_id), ...rows.map(r => byId(r.to_id))].filter(Boolean) : [from, to];
  const shape = info.shape ? (data.db.prepare('SELECT points FROM shapes WHERE id = ?').get(info.shape) as { points: string } | undefined) : undefined;
  const tram = info.type === 0 || (info.type >= 900 && info.type < 1000);
  return {
    type: 'ride',
    mode: tram ? 'tram' : 'bus',
    line: info.line,
    headsign: info.headsign,
    from,
    to,
    departure: t.departure[board],
    arrival: t.arrival[alight],
    geometry: shape ? nearestShape(JSON.parse(shape.points), from, to) : stops.map(s => [s.lat, s.lon]),
    stops,
    wheelchair: info.wheelchair ?? '',
  };
}

const stopPoint = (s: Stop): LegPoint => ({ name: s.name, lat: s.lat, lon: s.lon });

function buildOption(data: TransitData, g: WalkGraph, c: Pick<Candidate, 'journey' | 'window'>, from: CityPlace, to: CityPlace, access: Endpoint, egress: Endpoint, p: Preferences, locale: Locale): JourneyOption {
  const m = serverMessages(locale);
  const { journey: j, window: w } = c;
  const origin: LegPoint = { name: from.name, lat: from.lat, lon: from.lon };
  const destination: LegPoint = { name: to.name, lat: to.lat, lon: to.lon };
  const legs: Leg[] = [];
  // The scan reserves access rests in accessSeconds. Build the bare walk at its original
  // departure; addRestStops then consumes the reservation exactly once.
  const reservedRest = j.accessSeconds - access.walkingSeconds.get(j.startStop)!;
  const departure = j.leave + reservedRest;

  const startStop = data.stops[j.startStop];
  const accessPath = access.reach.path(stopNode(data, g, j.startStop)) ?? [];
  legs.push(walkLeg(g, accessPath, origin, stopPoint(startStop), p, { departure, destination: false, locale }));

  let lastArrival = j.leave;
  for (const part of j.parts) {
    if (part.kind === 'ride') {
      const ride = rideLeg(data, w, part.board, part.alight);
      legs.push(ride);
      lastArrival = ride.arrival;
      continue;
    }
    const a = data.stops[part.from];
    const b = data.stops[part.to];
    if (metres(a, b) < SAME_PLACE) continue; // same physical stop under another feed/platform id
    const nodes = { start: stopNode(data, g, part.from), end: stopNode(data, g, part.to) };
    const leg = nodes.start >= 0 && nodes.end >= 0 ? walkBetween(g, stopPoint(a), stopPoint(b), p, { departure: lastArrival, destination: false, locale }, nodes) : null;
    legs.push(leg ?? straightWalk(stopPoint(a), stopPoint(b), lastArrival, locale));
  }

  const endStop = data.stops[j.endStop];
  const egressPath = egress.reach.path(stopNode(data, g, j.endStop)) ?? [];
  const egressLeg = walkLeg(g, egressPath, stopPoint(endStop), destination, p, { departure: lastArrival, destination: true, locale });
  legs.push(egressLeg);

  const rides = legs.filter((l): l is RideLeg => l.type === 'ride');
  const label = rides.map(r => (r.mode === 'tram' ? m.labels.tram(r.line) : m.labels.bus(r.line))).join(' → ');
  // Line and time alone can repeat (same vehicle, another stop to get on or off), so the stops are part of the id.
  const id = `transit-${rides.map(r => `${r.line}@${r.departure}:${r.from.id}>${r.to.id}`).join('+')}`;
  // GTFS accessibility, only where it matters today. Unknown is listed but does not make the option unfit.
  const hard: string[] = [];
  const soft: string[] = [];
  if (onWheels(p.mobility)) {
    if (rides.some(r => r.wheelchair === '2')) soft.push(m.issues.tripNotAccessible);
    else if (rides.some(r => r.wheelchair !== '1')) soft.push(m.issues.tripUnknown);
    if (rides.some(r => r.from.wheelchair === '2' || r.to.wheelchair === '2')) (p.mobility === 'wheelchair' ? hard : soft).push(m.issues.stopNotAccessible);
  }
  return makeOption(id, 'transit', label, legs, departure, lastArrival + egressLeg.seconds, p, locale, { hard, soft });
}

/**
 * Up to four timed public-transport options leaving at or after `time` on `date`
 * (Europe/Warsaw, GTFS service day). Each option has at least one ride.
 */
export function transitOptions(g: WalkGraph, from: CityPlace, to: CityPlace, p: Preferences, date: string, time: string, locale: Locale = 'pl'): { options: JourneyOption[]; errors: string[] } {
  const m = serverMessages(locale);
  let data: TransitData;
  try {
    data = transitData();
  } catch {
    return { options: [], errors: [m.errors.transitUnavailable] };
  }
  const access = endpoint(data, g, from, p, false, locale);
  const egress = endpoint(data, g, to, p, true, locale);
  if (!access.seconds.size) return { options: [], errors: [m.errors.noStartStop] };
  if (!egress.seconds.size) return { options: [], errors: [m.errors.noEndStop] };

  const departure = Number(time.slice(0, 2)) * 3600 + Number(time.slice(3, 5)) * 60;
  const windowStart = Math.floor(departure / 1800) * 1800;
  const window = timetableWindow(data, date, windowStart, windowStart + WINDOW_SECONDS);
  if (!window.table.count) return { options: [], errors: [m.errors.noService] };
  // A wheelchair cannot use trips explicitly marked not accessible (GTFS wheelchair_accessible=2).
  let table = window.table;
  if (p.mobility === 'wheelchair') table = window.accessibleTable ??= usableConnections(window.table, window.tripAccess, p.mobility);
  // Scan results store connection indices, so every subsequent lookup must use this exact table.
  const scannedWindow = table === window.table ? window : { ...window, table };

  // Per-query copy: footpath estimates are corrected as real walks are checked.
  const footpaths: Footpaths = { ...data.footpaths, seconds: data.footpaths.seconds.slice() };
  const candidates: Candidate[] = [];
  let t = departure;
  let scans = 0;
  for (let runs = 0; runs < MAX_SCAN_RUNS && scans < MAX_SCANS; runs++) {
    const found = scan({
      table,
      footpaths,
      access: access.seconds,
      egress: egress.seconds,
      departure: t,
      sameStopTransfer: SAME_STOP_TRANSFER,
      boardingBuffer: BOARDING_BUFFER,
    });
    if (!found.length) break;
    const verified = found.map(j => verifyTransfers(data, g, j, footpaths, p));
    if (verified.includes(false)) continue; // re-run the same departure with corrected transfers
    let restTimesChanged = false;
    const next = found.map(journey => {
      const option = buildOption(data, g, { journey, window: scannedWindow }, from, to, access, egress, p, locale);
      const bareDeparture = option.departure!;
      addRestStops(option, g, p, locale);
      const requiredAccess = access.walkingSeconds.get(journey.startStop)! + bareDeparture - option.departure!;
      if (requiredAccess > access.seconds.get(journey.startStop)!) {
        access.seconds.set(journey.startStop, requiredAccess);
        restTimesChanged = true;
      }
      return {
        // Rank the actual rested journey, including rests after the last vehicle.
        journey: { ...journey, leave: option.departure!, arrival: option.arrival! },
        window: scannedWindow, signature: signature(journey, scannedWindow), option,
      };
    });
    // Like transfer validation, rest validation corrects access times before accepting options.
    // Re-scan the same departure so a later reachable vehicle is found instead of dropping a trip.
    if (restTimesChanged) continue;
    scans++;
    candidates.push(...next);
    if (nonDominated(candidates).length >= MAX_OPTIONS + 1) break;
    t = Math.min(...next.map(c => c.journey.leave)) + 60;
    if (t > windowStart + WINDOW_SECONDS - 3 * 3600) break;
  }

  // On wheels, trips known to be accessible rank above unknown ones (and, for a pushchair, above trips marked not accessible).
  const rank = (c: Candidate) => (onWheels(p.mobility) ? accessRank(c) : 0);
  const chosen = nonDominated(candidates)
    .sort((a, b) => rank(a) - rank(b) || a.journey.leave - b.journey.leave || a.journey.arrival - b.journey.arrival)
    .slice(0, MAX_OPTIONS);
  if (!chosen.length) return { options: [], errors: [m.errors.noConnection] };
  return { options: chosen.map(c => c.option), errors: [] };
}
