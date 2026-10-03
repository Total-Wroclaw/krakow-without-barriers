// Integration tests on the real citywide graph and local ZTP timetable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cityGraph } from '../src/lib/city-graph';
import { initialFrom, initialTo, type CityPlace } from '../src/lib/city-types';
import { defaultPreferences } from '../src/lib/schemas';
import { metres, nearest } from '../src/lib/routing';
import { walkingOptions, walkLabels } from '../src/lib/walking';
import { planJourney } from '../src/lib/journey';
import type { DriveLeg, JourneyOption, RideLeg, WalkLeg } from '../src/lib/journey-types';
import { roadGraph } from '../src/lib/roads';
import { parkingNear } from '../src/lib/parking';
import { driveOptions } from '../src/lib/drive';

const hasTransit = existsSync(path.join(process.cwd(), '.runtime/transit.sqlite'));
const hasRoads = existsSync(path.join(process.cwd(), 'data/krakow-roads.json.gz')) && existsSync(path.join(process.cwd(), 'data/krakow-parking.json.gz'));
const place = (id: string, lat: number, lon: number): CityPlace => ({ id, name: id, lat, lon, source: 'test' });
const rynek = place('Rynek Główny', 50.06168, 19.93731);
const wawel = place('Wawel', 50.05409, 19.93541);
const geometryLength = (g: [number, number][]) => g.reduce((s, p, i) => (i ? s + metres({ lat: g[i - 1][0], lon: g[i - 1][1] }, { lat: p[0], lon: p[1] }) : 0), 0);

test('city graph excludes private, paid or broken ways and indexes nodes for nearest()', () => {
  const g = cityGraph();
  assert.ok(g.ways.length > 100_000);
  assert.ok(g.ways.every(w => !['no', 'private', 'customers'].includes(w.tags.access) && w.tags.fee !== 'yes'));
  const connected = g.connected.reduce((s, x) => s + x, 0);
  assert.ok(connected > g.ids.length * 0.9);
  const started = performance.now();
  for (let i = 0; i < 1000; i++) nearest(g, { lat: 50.03 + (i % 50) * 0.002, lon: 19.85 + Math.floor(i / 50) * 0.01 }, 100);
  assert.ok(performance.now() - started < 500, 'nearest() should use the grid index');
  const n = nearest(g, initialFrom, 100);
  assert.ok(n >= 0 && g.connected[n] === 1 && metres(initialFrom, { lat: g.lat[n], lon: g.lon[n] }) < 100);
  assert.equal(nearest(g, { lat: 50.3, lon: 20.3 }, 100), -1);
});

test('citywide walking options: stair-free preferred route plus a shortest route with stairs', () => {
  const g = cityGraph();
  const { options } = walkingOptions(g, initialFrom, initialTo, defaultPreferences, 36000);
  assert.deepEqual(options.map(o => o.label), [walkLabels.preferred, walkLabels.shortest]);
  const [preferred, shortest] = options;
  assert.equal(preferred.stairs.up + preferred.stairs.down + preferred.stairs.unknown, 0);
  assert.ok(shortest.stairs.up + shortest.stairs.down > 0);
  assert.ok(preferred.walkingDistance > 6000 && preferred.walkingDistance < 9000);
  for (const option of options) {
    const leg = option.legs[0] as WalkLeg;
    assert.ok(Math.abs(geometryLength(leg.geometry) - leg.distance) < 2);
    assert.equal(leg.seconds, leg.distance); // 1.0 m/s
    assert.ok(leg.facts.every(f => f.confirmedAt === null && f.sourceUrl.startsWith('https://www.openstreetmap.org/')));
    assert.ok(option.issues.some(i => i.startsWith('Ponad Twój limit')));
    // De-cluttered: benches thinned to at most one per 150 m, steps grouped.
    assert.ok(option.rests <= Math.floor(leg.distance / 150));
    assert.ok(leg.steps.length < leg.distance / 40, `${leg.steps.length} steps for ${leg.distance} m`);
    for (const fact of leg.facts.filter(f => f.kind === 'stairs')) assert.ok(leg.steps.some(s => s.factId === fact.id));
  }
});

test('stair directions flip when the same route is walked the other way', () => {
  const g = cityGraph();
  const p = { ...defaultPreferences, avoidStairs: false, avoidDown: false, avoidUp: false, preferRest: false };
  const there = walkingOptions(g, rynek, wawel, p, 0).options[0].legs[0] as WalkLeg;
  const back = walkingOptions(g, wawel, rynek, p, 0).options[0].legs[0] as WalkLeg;
  const directions = (leg: WalkLeg) => new Map(leg.facts.filter(f => f.kind === 'stairs').map(f => [f.id, f.direction]));
  const a = directions(there);
  const b = directions(back);
  const flip = { up: 'down', down: 'up', unknown: 'unknown' } as const;
  let compared = 0;
  for (const [id, direction] of a) {
    if (!b.has(id)) continue;
    compared++;
    assert.equal(b.get(id), flip[direction]);
  }
  assert.ok(compared > 0, 'expected shared stairs between Rynek and Wawel');
});

function assertTransitShape(option: JourneyOption, requested: number) {
  assert.equal(option.kind, 'transit');
  assert.equal(option.legs[0].type, 'walk');
  assert.equal(option.legs.at(-1)!.type, 'walk');
  const rides = option.legs.filter((l): l is RideLeg => l.type === 'ride');
  assert.ok(rides.length >= 1 && rides.length <= 3);
  assert.equal(option.transfers, rides.length - 1);
  assert.ok(option.departure! >= requested);
  assert.equal(option.duration, option.arrival! - option.departure!);
  let clock = option.departure!;
  for (let i = 0; i < option.legs.length; i++) {
    const leg = option.legs[i];
    if (leg.type === 'walk') {
      assert.ok(i === 0 || i === option.legs.length - 1 || option.legs[i - 1].type === 'ride', 'walk transfers sit between rides');
      clock = Math.max(clock, leg.departure ?? clock) + leg.seconds;
    } else {
      assert.equal(leg.type, 'ride');
      if (leg.type !== 'ride') continue;
      assert.ok(leg.departure >= clock - 1, 'boarding after the previous leg ends');
      assert.equal(leg.stops[0].id, leg.from.id);
      assert.equal(leg.stops.at(-1)!.id, leg.to.id);
      assert.ok(leg.geometry.length >= 2);
      assert.ok(['tram', 'bus'].includes(leg.mode));
      clock = leg.arrival;
    }
  }
  assert.ok(Math.abs(clock - option.arrival!) <= 1);
}

test('cross-city journey: up to 4 timed transit options by departure, very long walks omitted, fast', { skip: !hasTransit }, () => {
  cityGraph();
  const started = performance.now();
  const result = planJourney({ from: initialFrom, to: initialTo, preferences: defaultPreferences, date: '2026-10-03', time: '14:00' });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 2500, `took ${Math.round(elapsed)} ms`);
  const transit = result.options.filter(o => o.kind === 'transit');
  assert.ok(transit.length >= 2 && transit.length <= 4);
  assert.equal(result.options[0].kind, 'transit'); // 7.6 km walk > 1.5 × 1.2 km
  assert.ok(result.options.every(o => o.kind === 'transit' || o.walkingDistance <= 3600), '7.6 km walks are not listed next to rides');
  for (let i = 1; i < transit.length; i++) assert.ok(transit[i].departure! >= transit[i - 1].departure!);
  const signatures = transit.map(o => o.legs.filter((l): l is RideLeg => l.type === 'ride').map(r => `${r.line}@${r.departure}-${r.arrival}`).join('|'));
  assert.equal(new Set(signatures).size, signatures.length, 'no duplicate options');
  for (const option of transit) assertTransitShape(option, 14 * 3600);
});

test('short trip lists walking first; transfer journeys include walking transfers between platforms', { skip: !hasTransit }, () => {
  const short = planJourney({ from: rynek, to: wawel, preferences: defaultPreferences, date: '2026-10-03', time: '14:00' });
  assert.equal(short.options[0].kind, 'walk');
  assert.equal(short.options[0].label, walkLabels.preferred);

  const result = planJourney({ from: place('Plac Nowy', 50.05165, 19.94471), to: place('Bronowice Małe', 50.08143, 19.88104), preferences: defaultPreferences, date: '2026-10-03', time: '14:00' });
  const transit = result.options.filter(o => o.kind === 'transit');
  assert.ok(transit.some(o => o.transfers >= 1));
  const walkTransfers = transit.flatMap(o => o.legs.filter((l, i) => l.type === 'walk' && i > 0 && i < o.legs.length - 1) as WalkLeg[]);
  assert.ok(walkTransfers.length > 0);
  for (const leg of walkTransfers) assert.ok(metres(leg.from, leg.to) <= 400);
  for (const option of transit) assertTransitShape(option, 14 * 3600);
});

test('missing timetable and off-network points become errors, never exceptions', { skip: !hasTransit }, () => {
  const off = planJourney({ from: place('Poza siecią', 50.19, 20.24), to: initialTo, preferences: defaultPreferences, date: '2026-10-03', time: '12:00' });
  assert.equal(off.options.length, 0);
  assert.ok(off.errors.some(e => e.includes('zbyt daleko')));
  const noService = planJourney({ from: rynek, to: wawel, preferences: defaultPreferences, date: '2030-01-01', time: '12:00' });
  assert.ok(noService.options.every(o => o.kind === 'walk'));
  assert.ok(noService.errors.length > 0);
});

test('default request (transit, Polish) returns only walking and transit options', { skip: !hasTransit }, () => {
  const result = planJourney({ from: rynek, to: wawel, preferences: defaultPreferences, date: '2026-10-03', time: '14:00' });
  assert.ok(result.options.every(o => o.kind === 'walk' || o.kind === 'transit'));
  assert.ok(result.options.every(o => o.legs.every(l => l.type !== 'drive')));
});

test('car for a wheelchair parks only where disabled spaces are mapped; taxi and car add little time', { skip: !hasRoads }, () => {
  const g = cityGraph();
  const roads = roadGraph()!;
  const wheelchair = { ...defaultPreferences, mobility: 'wheelchair' as const };
  const nearby = parkingNear(rynek, 600, { disabledOnly: true });
  assert.ok(nearby.length > 0);
  assert.ok(nearby.every(p => p.disabled === 'yes' && p.sourceUrl.startsWith('https://www.openstreetmap.org/')));
  for (let i = 1; i < nearby.length; i++) assert.ok(nearby[i].distance! >= nearby[i - 1].distance!);

  driveOptions(g, roads, initialTo, rynek, wheelchair, 36000, 'car'); // warm caches
  let started = performance.now();
  const cars = driveOptions(g, roads, initialTo, rynek, wheelchair, 36000, 'car', 'en');
  const carMs = performance.now() - started;
  started = performance.now();
  const [taxi] = driveOptions(g, roads, initialFrom, initialTo, defaultPreferences, 36000, 'taxi');
  const taxiMs = performance.now() - started;
  assert.ok(carMs < 400 && taxiMs < 400, `car ${Math.round(carMs)} ms, taxi ${Math.round(taxiMs)} ms`);

  assert.ok(cars.length >= 1 && cars.length <= 3);
  assert.equal(new Set(cars.map(o => o.id)).size, cars.length);
  for (const option of cars) {
    assert.equal(option.kind, 'car');
    assert.ok(option.label.startsWith('Car · '));
    const drive = option.legs.find((l): l is DriveLeg => l.type === 'drive')!;
    assert.equal(drive.mode, 'car');
    assert.equal(drive.parking?.disabled, 'yes');
    assert.equal(option.legs.at(-1)!.type, 'walk');
    const walk = option.legs.at(-1) as WalkLeg;
    assert.deepEqual([walk.from.lat, walk.from.lon], [drive.parking!.lat, drive.parking!.lon]);
    assert.equal(walk.to.name, rynek.name);
    for (const step of walk.steps) assert.doesNotMatch(step.instruction, /^(Idź|Skręć|Prosto|Cel:)/);
  }
  assert.equal(taxi.kind, 'taxi');
  const ride = taxi.legs.find((l): l is DriveLeg => l.type === 'drive')!;
  assert.ok(ride.distance > 5000 && ride.distance < 12000, `${ride.distance} m`);
  assert.ok(ride.seconds > 600 && ride.seconds < 2400, `${ride.seconds} s`);
});

test('wheelchair transit options flag trips without accessibility information', { skip: !hasTransit }, () => {
  const result = planJourney({ from: initialFrom, to: initialTo, preferences: { ...defaultPreferences, mobility: 'wheelchair' }, date: '2026-10-03', time: '14:00', locale: 'de' });
  const transit = result.options.filter(o => o.kind === 'transit');
  assert.ok(transit.length > 0);
  for (const option of transit) {
    const rides = option.legs.filter((l): l is RideLeg => l.type === 'ride');
    assert.ok(rides.every(r => r.wheelchair !== '2'));
    if (rides.some(r => r.wheelchair !== '1')) assert.ok(option.issues.includes('Keine Angaben zur Barrierefreiheit dieser Fahrt'));
    assert.ok(option.label.startsWith('Straßenbahn') || option.label.startsWith('Bus'));
  }
});
