import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeServices, connectionTable, emptyFootpaths, gtfsTime, scan, type Footpaths, type ScanOptions } from '../src/lib/transit-scan';
import { pointSchema } from '../src/lib/city-types';

// Stops are single letters A..H mapped to indices; trips are interned by name.
const stops = 'ABCDEFGH';
const s = (id: string) => stops.indexOf(id);
type Row = [trip: string, from: string, to: string, departure: number, arrival: number, extra?: { sequence?: number; pickup?: number; dropoff?: number }];

function timetable(rows: Row[]) {
  const trips = [...new Set(rows.map(r => r[0]))];
  return connectionTable(
    rows.map(([trip, from, to, departure, arrival, extra]) => ({
      trip: trips.indexOf(trip),
      from: s(from),
      to: s(to),
      departure,
      arrival,
      sequence: extra?.sequence ?? 1,
      pickup: extra?.pickup ?? 0,
      dropoff: extra?.dropoff ?? 0,
    })),
    trips.length,
    stops.length,
  );
}

function footpaths(pairs: [string, string, number][]): Footpaths {
  const offsets = new Int32Array(stops.length + 1);
  const sorted = [...pairs].sort((a, b) => s(a[0]) - s(b[0]));
  for (const [from] of sorted) offsets[s(from) + 1]++;
  for (let i = 0; i < stops.length; i++) offsets[i + 1] += offsets[i];
  return { offsets, targets: Int32Array.from(sorted, p => s(p[1])), seconds: Int32Array.from(sorted, p => p[2]) };
}

function run(rows: Row[], access: Record<string, number>, egress: Record<string, number>, departure: number, extra: Partial<ScanOptions> = {}) {
  return scan({
    table: timetable(rows),
    footpaths: emptyFootpaths(stops.length),
    access: new Map(Object.entries(access).map(([k, v]) => [s(k), v])),
    egress: new Map(Object.entries(egress).map(([k, v]) => [s(k), v])),
    departure,
    boardingBuffer: 0,
    ...extra,
  });
}

test('service exceptions override weekly calendar including cancelled services', () => {
  const active = activeServices(
    [
      { service: 'weekly', start: '20260101', end: '20261231', days: '0,0,0,0,0,1,0' },
      { service: 'expired', start: '20250101', end: '20251231', days: '1,1,1,1,1,1,1' },
    ],
    [{ service: 'weekly', type: 2 }, { service: 'special', type: 1 }],
    '20261003',
  );
  assert.deepEqual([...active], ['special']);
});

test('includes access/egress walking, stays aboard through a pickup restriction, and reports leave time', () => {
  const rows: Row[] = [['tram', 'A', 'B', 100, 200], ['tram', 'B', 'C', 210, 300, { sequence: 2, pickup: 1 }]];
  const [journey] = run(rows, { A: 30 }, { C: 40 }, 50, { boardingBuffer: 10 });
  assert.equal(journey.arrival, 340);
  assert.equal(journey.boardings, 1);
  assert.equal(journey.leave, 100 - 30 - 10);
  assert.deepEqual(journey.parts.map(p => p.kind), ['ride']);
  assert.deepEqual(run(rows, { A: 51 }, { C: 0 }, 50), []);
});

test('same-platform transfers need the change allowance', () => {
  const rows: Row[] = [['bus', 'A', 'B', 100, 200], ['early', 'B', 'C', 250, 300], ['tram', 'B', 'C', 330, 400]];
  const [journey] = run(rows, { A: 0 }, { C: 0 }, 50, { sameStopTransfer: 120 });
  assert.equal(journey.arrival, 400);
  assert.equal(journey.boardings, 2);
});

test('walking transfers between different platforms use footpaths only when nearby', () => {
  const rows: Row[] = [['bus', 'A', 'B', 100, 200], ['tram', 'D', 'C', 400, 500]];
  assert.deepEqual(run(rows, { A: 0 }, { C: 0 }, 0), []);
  const [journey] = run(rows, { A: 0 }, { C: 0 }, 0, { footpaths: footpaths([['B', 'D', 150]]) });
  assert.equal(journey.arrival, 500);
  assert.deepEqual(journey.parts.map(p => p.kind), ['ride', 'walk', 'ride']);
  assert.deepEqual(journey.parts[1], { kind: 'walk', from: s('B'), to: s('D'), seconds: 150 });
  // The walk must fit before departure.
  assert.deepEqual(run(rows, { A: 0 }, { C: 0 }, 0, { footpaths: footpaths([['B', 'D', 250]]) }), []);
});

test('at most three boardings', () => {
  const chain: Row[] = [['t1', 'A', 'B', 100, 110], ['t2', 'B', 'C', 300, 310], ['t3', 'C', 'D', 500, 510], ['t4', 'D', 'E', 700, 710]];
  assert.equal(run(chain, { A: 0 }, { D: 0 }, 0)[0].boardings, 3);
  assert.deepEqual(run(chain, { A: 0 }, { E: 0 }, 0), []);
  assert.equal(run(chain, { A: 0 }, { E: 0 }, 0, { maxBoardings: 4 })[0].boardings, 4);
});

test('returns the Pareto set over boardings: slower direct plus faster transfer', () => {
  const rows: Row[] = [['direct', 'A', 'C', 100, 900], ['fast1', 'A', 'B', 120, 200], ['fast2', 'B', 'C', 400, 500]];
  const journeys = run(rows, { A: 0 }, { C: 0 }, 0);
  assert.deepEqual(journeys.map(j => [j.boardings, j.arrival]), [[1, 900], [2, 500]]);
  // A transfer journey that is not faster is not returned.
  const slow = run([['direct', 'A', 'C', 100, 400], ['fast1', 'A', 'B', 120, 200], ['fast2', 'B', 'C', 400, 500]], { A: 0 }, { C: 0 }, 0);
  assert.deepEqual(slow.map(j => j.boardings), [1]);
});

test('GTFS times beyond midnight are kept beyond 24:00', () => {
  const [journey] = run([['night', 'A', 'B', 87000, 88000]], { A: 0 }, { B: 0 }, 86000);
  assert.equal(journey.arrival, 88000);
  assert.equal(gtfsTime(90000), '01:00 (+1 dzień)');
});

test('pickup/drop-off type 1 prevents boarding/alighting; on-request stops are allowed', () => {
  assert.deepEqual(run([['trip', 'A', 'B', 100, 200, { pickup: 1 }]], { A: 0 }, { B: 0 }, 0), []);
  assert.deepEqual(run([['trip', 'A', 'B', 100, 200, { dropoff: 1 }]], { A: 0 }, { B: 0 }, 0), []);
  assert.equal(run([['trip', 'A', 'B', 100, 200, { pickup: 3, dropoff: 3 }]], { A: 0 }, { B: 0 }, 0).length, 1);
});

test('city point schema rejects points outside Kraków', () => {
  assert.equal(pointSchema.safeParse({ lat: 52, lon: 21 }).success, false);
});
