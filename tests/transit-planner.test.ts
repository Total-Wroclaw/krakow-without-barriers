// Integration over a tiny GTFS database: connection indices, accessibility and scheduled rests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGraph } from '../src/lib/routing';
import { defaultPreferences } from '../src/lib/schemas';
import type { Dataset, OsmNode } from '../src/lib/data';
import type { RideLeg, WalkLeg } from '../src/lib/journey-types';

const storage = mkdtempSync(path.join(os.tmpdir(), 'krok-transit-planner-'));
process.env.KROK_STORAGE_DIR = storage;
process.env.KROK_TRANSIT_DB = path.join(storage, 'transit.sqlite');
const database = new DatabaseSync(process.env.KROK_TRANSIT_DB);
database.exec(`
  CREATE TABLE stops(id TEXT, name TEXT, code TEXT, lat REAL, lon REAL, wheelchair TEXT);
  CREATE TABLE calendar(service TEXT, start TEXT, end TEXT, days TEXT);
  CREATE TABLE exceptions(service TEXT, date TEXT, type INTEGER);
  CREATE TABLE routes(id TEXT, name TEXT, type INTEGER);
  CREATE TABLE trips(id TEXT, service TEXT, route TEXT, headsign TEXT, shape TEXT, wheelchair TEXT);
  CREATE TABLE connections(trip TEXT, from_id TEXT, to_id TEXT, departure INTEGER, arrival INTEGER, sequence INTEGER, pickup INTEGER, dropoff INTEGER);
  CREATE TABLE shapes(id TEXT, points TEXT);
  INSERT INTO calendar VALUES ('daily','20260101','20261231','1,1,1,1,1,1,1');
`);
const place = (id: string, lat: number, lon: number) => ({ id, name: id, lat, lon, source: 'fixture' });
const a = place('A', 50.06, 19.9), b = place('B', 50.06, 19.94);
const origin = place('Origin', 50.12, 19.9), c = place('C', 50.124, 19.9), d = place('D', 50.124, 19.94);
for (const stop of [a,b,c,d]) database.prepare('INSERT INTO stops VALUES (?,?,?,?,?,?)').run(stop.id, stop.name, '', stop.lat, stop.lon, '1');
const trip = (id: string, from: string, to: string, departure: number, arrival: number, wheelchair: string) => {
  database.prepare('INSERT INTO routes VALUES (?,?,3)').run(id,id);
  database.prepare("INSERT INTO trips VALUES (?,'daily',?,?,'',?)").run(id,id,to,wheelchair);
  database.prepare('INSERT INTO connections VALUES (?,?,?,?,?,1,0,0)').run(id,from,to,departure,arrival);
};
trip('INACCESSIBLE','A','B',28920,29400,'2');
trip('ACCESSIBLE','A','B',28980,29460,'1');
trip('TOO_EARLY_WITH_REST','C','D',29310,29760,'1');
trip('REACHABLE_WITH_REST','C','D',29520,30000,'1');
database.close();
const { transitOptions } = await import('../src/lib/transit');
const { planJourney } = await import('../src/lib/journey');

function graph(points: ReturnType<typeof place>[], benches: OsmNode[] = []) {
  const data: Dataset = {
    obtainedAt: '2026-10-04', url: 'fixture', bbox: [], context: [], features: benches,
    nodes: Object.fromEntries(points.map(p => [p.id,{...p,tags:{},editedAt:null}])),
    ways: [{id:'footway',nodes:points.map(p=>p.id),tags:{highway:'footway'},editedAt:null}],
  };
  return buildGraph(data);
}

test.after(() => rmSync(storage, {recursive:true,force:true}));

test('wheelchair reconstruction uses the filtered table for line, time and accessibility', () => {
  const result = transitOptions(graph([a,b]),a,b,{...defaultPreferences,mobility:'wheelchair'},'2026-10-04','08:00','en');
  assert.equal(result.options.length,1);
  const option = result.options[0];
  const ride = option.legs.find((l): l is RideLeg => l.type === 'ride')!;
  assert.equal(ride.line,'ACCESSIBLE');
  assert.equal(ride.departure,28980);
  assert.equal(ride.arrival,29460);
  assert.equal(ride.wheelchair,'1');
  assert.equal(option.fits,true);
  assert.deepEqual(option.issues,[]);
});

test('rest timing participates in vehicle selection and is applied exactly once', () => {
  const bench = {id:'rest',lat:50.1227,lon:19.9,tags:{amenity:'bench'},editedAt:null};
  const g = graph([origin,c,d],[bench]);
  const preferences = {...defaultPreferences,restEvery:5};
  const input = {from:origin,to:d,preferences,date:'2026-10-04',time:'08:00',locale:'en' as const};
  const result = planJourney(input,g,()=>null,()=>[]);
  const options = result.options.filter(o=>o.kind==='transit');
  assert.ok(options.length > 0,'keep the later reachable service');
  for (const option of options) {
    assert.ok(option.departure! >= 28800,'never require departure before the requested time');
    const access = option.legs[0] as WalkLeg;
    const ride = option.legs.find((l): l is RideLeg => l.type === 'ride')!;
    assert.equal(ride.line,'REACHABLE_WITH_REST');
    assert.equal(option.restStops,1);
    assert.equal(option.restMinutes,2);
    assert.equal(access.seconds,access.distance+120);
    assert.ok(access.departure!+access.seconds+60<=ride.departure);
    assert.equal(option.duration,option.arrival!-option.departure!);
  }
  const without = transitOptions(g,origin,d,{...preferences,restEvery:0},input.date,input.time,'en');
  assert.equal(without.options[0].legs.find((l):l is RideLeg=>l.type==='ride')!.line,'TOO_EARLY_WITH_REST');
});
