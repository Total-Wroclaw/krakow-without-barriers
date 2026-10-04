import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, metres } from '../src/lib/routing';
import { buildRoadGraph, fastestDrive, ROAD_CLASSES, urbanFactor } from '../src/lib/roads';
import { driveOptions } from '../src/lib/drive';
import { taxiFare } from '../src/lib/taxi';
import { planJourney } from '../src/lib/journey';
import { defaultPreferences, type Preferences } from '../src/lib/schemas';
import type { Dataset, OsmNode, Way } from '../src/lib/data';
import type { DriveLeg, JourneyOption, WalkLeg } from '../src/lib/journey-types';

// Fixture outside the Kraków envelope so no real car parks or stops are near.
const LAT = 49.5;
const LON = 19.5;
const cls = (name: (typeof ROAD_CLASSES)[number]) => ROAD_CLASSES.indexOf(name);

/** 5 × 5 street grid, ~111 m blocks; row 0 is one-way eastbound. A house sits 80 m north of the grid, reached by a footway. */
function fixture(houseOffset = 0.00072, accessTags: Record<string, string> = {}) {
  const coords: [number, number][] = [];
  const id = (r: number, c: number) => r * 5 + c;
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) coords.push([LAT + r * 0.001, LON + c * 0.0015]);
  const roadWays: { nodes: number[]; oneway: number }[] = [];
  for (let r = 0; r < 5; r++) roadWays.push({ nodes: [0, 1, 2, 3, 4].map(c => id(r, c)), oneway: r === 0 ? 1 : 0 });
  for (let c = 0; c < 5; c++) roadWays.push({ nodes: [0, 1, 2, 3, 4].map(r => id(r, c)), oneway: 0 });
  const roads = buildRoadGraph({
    obtainedAt: 'fixture',
    sourceDate: null,
    classes: [...ROAD_CLASSES],
    names: ['Ulica'],
    lat: coords.map(c => Math.round(c[0] * 1e6)),
    lon: coords.map(c => Math.round(c[1] * 1e6)),
    signals: [],
    ways: {
      id: roadWays.map((_, i) => i + 1),
      cls: roadWays.map(() => cls('residential')),
      oneway: roadWays.map(w => w.oneway),
      maxspeed: roadWays.map(() => 0),
      dest: roadWays.map(() => 0),
      name: roadWays.map(() => 0),
      offsets: roadWays.reduce((o, w) => [...o, o.at(-1)! + w.nodes.length], [0]),
      nodes: roadWays.flatMap(w => w.nodes),
    },
  });

  const nodes: OsmNode[] = coords.map((c, i) => ({ id: `n${i}`, lat: c[0], lon: c[1], tags: {}, editedAt: null }));
  const house = { id: 'house', lat: LAT + 4 * 0.001 + houseOffset, lon: LON + 4 * 0.0015, tags: {}, editedAt: null };
  nodes.push(house);
  const ways: Way[] = roadWays.map((w, i) => ({ id: `w${i}`, nodes: w.nodes.map(n => `n${n}`), tags: { highway: 'residential', name: 'Ulica' }, editedAt: null }));
  ways.push({ id: 'path', nodes: [`n${id(4, 4)}`, 'house'], tags: { highway: 'footway', ...accessTags }, editedAt: null });
  const data: Dataset = { obtainedAt: 'fixture', url: 'fixture', bbox: [], context: [], features: [], ways, nodes: Object.fromEntries(nodes.map(n => [n.id, n])) };
  return { roads, walk: buildGraph(data), house, corner: { lat: coords[0][0], lon: coords[0][1] }, id };
}

const place = (name: string, p: { lat: number; lon: number }) => ({ id: name, name, lat: p.lat, lon: p.lon, source: 'fixture' });
const free: Preferences = { ...defaultPreferences, avoidStairs: false, avoidDown: false, preferRest: false };

function assertChained(option: JourneyOption, departure: number) {
  let clock = departure;
  for (const leg of option.legs) {
    assert.notEqual(leg.type, 'ride');
    if (leg.type === 'ride') continue;
    assert.equal(leg.departure, clock);
    clock += leg.seconds;
  }
  assert.equal(option.departure, departure);
  assert.equal(option.arrival, clock);
  assert.equal(option.duration, clock - departure);
}

test('speed model: limit or class default × urban factor, plus junction delays; one-way respected', () => {
  const { roads, id } = fixture();
  assert.equal(urbanFactor(30), 0.65);
  assert.equal(urbanFactor(70), 0.8);
  assert.equal(urbanFactor(120), 0.9);
  // Row 1, straight from column 0 to 4: 4 blocks at 30 km/h × 0.65, three junctions on the way plus the T at the end.
  const drive = fastestDrive(roads, id(1, 0), id(1, 4))!;
  const expected = drive.distance / ((30 / 3.6) * 0.65) + 4 * 4;
  assert.ok(Math.abs(drive.seconds - expected) < 0.5, `${drive.seconds} vs ${expected}`);
  // Row 0 is one-way eastbound: westbound must detour via row 1.
  const east = fastestDrive(roads, id(0, 0), id(0, 4))!;
  const west = fastestDrive(roads, id(0, 4), id(0, 0))!;
  assert.ok(west.distance > east.distance + 200);
});

test('taxi: walk to the kerb when it is meaningfully far, then a door-to-door drive', () => {
  const f = fixture();
  const [taxi] = driveOptions(f.walk, f.roads, place('Dom', f.house), place('Róg', f.corner), free, 36000, 'taxi');
  assert.equal(taxi.kind, 'taxi');
  assert.equal(taxi.id, 'taxi');
  assert.equal(taxi.label, 'Taksówka');
  assert.deepEqual(taxi.legs.map(l => l.type), ['walk', 'drive']); // the corner itself is on the road: no final walk
  const [walk, drive] = taxi.legs as [WalkLeg, DriveLeg];
  assert.ok(walk.distance >= 70 && walk.distance <= 90);
  assert.equal(drive.mode, 'taxi');
  assert.equal(drive.parking, undefined);
  assert.equal(drive.from.name, 'Ulica');
  assert.deepEqual(drive.from, walk.to);
  assert.ok(drive.distance > 600 && drive.seconds > 60);
  assert.ok(metres(drive.to, f.corner) < 1);
  assert.deepEqual(drive.geometry[0], [drive.from.lat, drive.from.lon]);
  assert.equal(taxi.walkingDistance, walk.distance);
  assert.equal(taxi.transfers, 0);
  assertChained(taxi, 36000);
  // Fare from the Kraków maximum tariff for the driven distance; Uber prefilled with the kerb and the destination.
  assert.deepEqual(drive.fare, taxiFare(drive.distance, 'pl'));
  assert.equal(drive.fare!.currency, 'PLN');
  assert.ok(drive.fare!.min >= 9 && drive.fare!.min < drive.fare!.max);
  assert.deepEqual(taxi.rideLinks!.map(l => l.provider), ['uber', 'bolt', 'freenow']);
  const uber = new URL(taxi.rideLinks![0].url);
  assert.equal(uber.origin + uber.pathname, 'https://m.uber.com/looking');
  assert.equal(JSON.parse(uber.searchParams.get('pickup')!).latitude, Math.round(drive.from.lat * 1e6) / 1e6);
  assert.equal(JSON.parse(uber.searchParams.get('drop[0]')!).addressLine1, 'Róg');
  // Wheelchair: still fits, with a note to book an accessible vehicle.
  const [accessible] = driveOptions(f.walk, f.roads, place('Dom', f.house), place('Róg', f.corner), { ...free, mobility: 'wheelchair' }, 0, 'taxi', 'en');
  assert.equal(accessible.label, 'Taxi');
  assert.equal(accessible.fits, true);
  assert.deepEqual(accessible.issues, ['Book a wheelchair-accessible vehicle']);
});

test('car without any car park nearby: clearly labelled kerbside drop-off that does not fit', () => {
  const f = fixture();
  const [car] = driveOptions(f.walk, f.roads, place('Róg', f.corner), place('Dom', f.house), free, 0, 'car');
  assert.equal(car.id, 'car-dropoff');
  assert.equal(car.kind, 'car');
  assert.equal(car.label, 'Samochód · podjazd pod cel');
  assert.deepEqual(car.legs.map(l => l.type), ['drive', 'walk']);
  assert.equal(car.fits, false);
  assert.deepEqual(car.issues, ['Brak parkingu w promieniu 600 m']);
  const [wheel] = driveOptions(f.walk, f.roads, place('Róg', f.corner), place('Dom', f.house), { ...free, mobility: 'wheelchair' }, 0, 'car', 'de');
  assert.deepEqual(wheel.issues, ['Kein Parkplatz mit Behindertenstellplätzen im Umkreis von 600 m']);
  assertChained(car, 0);
});

test('planJourney lists drive options first and still returns walking for comparison', () => {
  const f = fixture();
  const result = planJourney({ from: place('Dom', f.house), to: place('Róg', f.corner), preferences: free, date: '2026-10-03', time: '10:00', transport: 'taxi' }, f.walk, () => f.roads);
  assert.equal(result.options[0].kind, 'taxi');
  assert.ok(result.options.some(o => o.kind === 'walk'));
  const missing = planJourney({ from: place('Dom', f.house), to: place('Róg', f.corner), preferences: free, date: '2026-10-03', time: '10:00', transport: 'car', locale: 'en' }, f.walk, () => null);
  assert.ok(missing.errors.includes('Road data is unavailable. Showing public transport and walking routes.'));
  assert.ok(missing.options.every(o => o.kind === 'walk'));
});

test('short taxi and car access retains mapped stairs and the real kerb pickup', () => {
  const f = fixture(0.0002, { highway: 'steps', step_count: '10' });
  const p = { ...free, mobility: 'wheelchair' as const };
  for (const mode of ['taxi', 'car'] as const) {
    const [option] = driveOptions(f.walk, f.roads, place('House', f.house), place('Corner', f.corner), p, 36000, mode, 'en');
    const access = option.legs[0] as WalkLeg;
    assert.equal(access.type, 'walk');
    assert.ok(access.distance > 20 && access.distance < 40);
    assert.equal(option.fits, false);
    assert.ok(option.issues.includes('Stairs on the route'));
    const drive = option.legs[1] as DriveLeg;
    assert.deepEqual(drive.from, access.to);
    if (mode === 'taxi') {
      const pickup = JSON.parse(new URL(option.rideLinks![0].url).searchParams.get('pickup')!);
      assert.notEqual(pickup.latitude, f.house.lat, 'request the taxi at the road, not beyond the stairs');
    }
  }
  const [reverse] = driveOptions(f.walk, f.roads, place('Corner', f.corner), place('House', f.house), p, 36000, 'taxi', 'en');
  assert.equal(reverse.legs.at(-1)!.type, 'walk');
  assert.equal(reverse.fits, false);
});

test('short unmapped taxi access is retained with its unknown-path instruction', () => {
  const f = fixture(0.0002);
  const empty = buildGraph({ obtainedAt: 'fixture', url: 'fixture', bbox: [], context: [], features: [], ways: [], nodes: {} });
  const [option] = driveOptions(empty, f.roads, place('House', f.house), place('Corner', f.corner), free, 36000, 'taxi', 'en');
  const access = option.legs[0] as WalkLeg;
  assert.equal(access.type, 'walk');
  assert.ok(access.distance > 0 && access.distance < 40);
  assert.match(access.steps[0].instruction, /path unknown/);
});
