import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, edgeAt, forbidden, inclinePercent, shortestPath, widthMetres, type WalkGraph } from '../src/lib/routing';
import type { Dataset, OsmNode, Way } from '../src/lib/data';
import { walkingOptions, walkLeg, formatDistance } from '../src/lib/walking';
import { connectionTable, emptyFootpaths, scan, usableConnections } from '../src/lib/transit-scan';
import { serverMessages } from '../src/lib/i18n/server-messages';
import { journeyRequestSchema, planJourney } from '../src/lib/journey';
import { defaultPreferences, type Preferences } from '../src/lib/schemas';
import type { WalkLeg } from '../src/lib/journey-types';

const free: Preferences = { ...defaultPreferences, avoidStairs: false, avoidDown: false, avoidUp: false, preferHandrails: false, preferRest: false };
const wheelchair: Preferences = { ...free, mobility: 'wheelchair' };
const stroller: Preferences = { ...free, mobility: 'stroller' };

const node = (id: string, lat: number, lon: number, tags: Record<string, string> = {}): OsmNode => ({ id, lat, lon, tags, editedAt: null });
const way = (id: string, nodes: string[], tags: Record<string, string>): Way => ({ id, nodes, tags, editedAt: null });
const dataset = (nodes: OsmNode[], ways: Way[]): Dataset => ({
  obtainedAt: '2026-10-03', url: 'fixture', bbox: [], context: [], features: [], ways,
  nodes: Object.fromEntries(nodes.map(n => [n.id, n])),
});
const idx = (g: WalkGraph, id: string) => g.index.get(id)!;
const route = (g: WalkGraph, p: Preferences | null, from = 'a', to = 'b') => shortestPath(g, idx(g, from), idx(g, to), p)?.map(e => g.ways[g.edgeWay[e]].id);
const place = (d: Dataset, id: string) => ({ id, name: id, lat: d.nodes[id].lat, lon: d.nodes[id].lon, source: 'fixture' });

// a → b directly (~111 m, way "direct") or via c (~140 m footway "detour").
function pair(direct: Record<string, string>, extraNodes: OsmNode[] = [], directNodes = ['a', 'b']) {
  return dataset(
    [node('a', 50, 19), node('b', 50.001, 19), node('c', 50.0005, 19.0006), ...extraNodes],
    [way('direct', directNodes, { highway: 'footway', ...direct }), way('detour', ['a', 'c', 'b'], { highway: 'footway', surface: 'asphalt' })],
  );
}

test('wheelchair and pushchair never take stairs, even with every stair setting off', () => {
  const data = pair({ highway: 'steps', incline: 'up' });
  const g = buildGraph(data);
  assert.deepEqual(route(g, free), ['direct']);
  assert.deepEqual(route(g, wheelchair), ['detour', 'detour']);
  assert.deepEqual(route(g, stroller), ['detour', 'detour']);
  const stairs = edgeAt(g, shortestPath(g, idx(g, 'a'), idx(g, 'b'), free)![0]);
  assert.equal(forbidden(stairs, free), false);
  assert.equal(forbidden(stairs, wheelchair), true);
  // Only stairs remain: no barrier-free walk, the shortest is shown and flagged as not fitting.
  const only = dataset([node('a', 50, 19), node('b', 50.001, 19)], [way('direct', ['a', 'b'], { highway: 'steps', incline: 'up' })]);
  const result = walkingOptions(buildGraph(only), place(only, 'a'), place(only, 'b'), wheelchair, 0);
  assert.deepEqual(result.errors, [serverMessages('pl').errors.noBarrierFreeWalk]);
  assert.equal(result.options[0].fits, false);
  assert.ok(result.options[0].issues.includes('Schody na trasie'));
});

test('stairs with an integrated ramp: ramp:wheelchair=yes for both, ramp=yes only for a pushchair', () => {
  const ramp = buildGraph(pair({ highway: 'steps', 'ramp:wheelchair': 'yes' }));
  assert.deepEqual(route(ramp, wheelchair), ['direct']);
  const rails = buildGraph(pair({ highway: 'steps', ramp: 'yes' }));
  assert.deepEqual(route(rails, stroller), ['direct']);
  assert.deepEqual(route(rails, wheelchair), ['detour', 'detour']);
});

test('rough surfaces are penalised on wheels and reported with their length', () => {
  const data = pair({ surface: 'sett' });
  const g = buildGraph(data);
  assert.deepEqual(route(g, free), ['direct']);
  assert.deepEqual(route(g, wheelchair), ['detour', 'detour']);
  assert.deepEqual(route(g, stroller), ['detour', 'detour']);
  const { options } = walkingOptions(g, place(data, 'a'), place(data, 'b'), wheelchair, 0);
  const shortest = options.find(o => o.id === 'walk-shortest')!;
  const leg = shortest.legs[0] as WalkLeg;
  const surface = leg.facts.find(f => f.kind === 'surface')!;
  assert.equal(surface.barrier, 'sett');
  assert.equal(surface.length, 111);
  assert.equal(surface.title, 'Bruk · 111 m');
  assert.ok(shortest.issues.includes('Bruk na 111 m'));
  assert.equal(shortest.fits, true, 'cobbles are listed, not a hard barrier');
  // Walking ignores surfaces: no surface facts, same issues as before.
  const walk = walkingOptions(g, place(data, 'a'), place(data, 'b'), free, 0).options[0];
  assert.equal((walk.legs[0] as WalkLeg).facts.filter(f => f.kind === 'surface').length, 0);
});

test('raised kerbs block a wheelchair, cost a pushchair, and are reported', () => {
  const kerb = node('k', 50.0005, 19, { barrier: 'kerb', kerb: 'raised' });
  const data = pair({}, [kerb], ['a', 'k', 'b']);
  const g = buildGraph(data);
  assert.deepEqual(route(g, free), ['direct', 'direct']);
  assert.deepEqual(route(g, wheelchair), ['detour', 'detour']);
  assert.deepEqual(route(g, stroller), ['detour', 'detour']);
  const lowered = buildGraph(pair({}, [{ ...kerb, tags: { barrier: 'kerb', kerb: 'lowered' } }], ['a', 'k', 'b']));
  assert.deepEqual(route(lowered, wheelchair), ['direct', 'direct']);

  const only = dataset([node('a', 50, 19), kerb, node('b', 50.001, 19)], [way('direct', ['a', 'k', 'b'], { highway: 'footway' })]);
  const option = walkingOptions(buildGraph(only), place(only, 'a'), place(only, 'b'), wheelchair, 0).options[0];
  const fact = (option.legs[0] as WalkLeg).facts.find(f => f.kind === 'kerb')!;
  assert.equal(fact.barrier, 'kerbRaised');
  assert.equal(fact.id, 'node:k');
  assert.ok(option.issues.includes('Krawężnik bez obniżenia'));
  assert.equal(option.fits, false);
  const pushchair = walkingOptions(buildGraph(only), place(only, 'a'), place(only, 'b'), stroller, 0).options[0];
  assert.equal(pushchair.fits, true);
  assert.ok(pushchair.issues.includes('Krawężnik bez obniżenia'));
});

test('narrow (< 0.9 m) and wheelchair=no ways are excluded for a wheelchair only', () => {
  assert.deepEqual(route(buildGraph(pair({ width: '0.7' })), wheelchair), ['detour', 'detour']);
  assert.deepEqual(route(buildGraph(pair({ width: '1.2' })), wheelchair), ['direct']);
  assert.deepEqual(route(buildGraph(pair({ wheelchair: 'no' })), wheelchair), ['detour', 'detour']);
  assert.deepEqual(route(buildGraph(pair({ wheelchair: 'no' })), free), ['direct']);
  assert.deepEqual(route(buildGraph(pair({ incline: '12%' })), wheelchair), ['detour', 'detour']);
  assert.equal(widthMetres('70 cm'), 0.7);
  assert.equal(widthMetres('1,5'), 1.5);
  assert.equal(widthMetres('narrow'), null);
  assert.equal(inclinePercent('-8%'), 8);
  assert.ok(Math.abs(inclinePercent('5°')! - 8.75) < 0.01);
  assert.equal(inclinePercent('up'), null);
});

test('wheelchair drops trips marked wheelchair_accessible=2; unknown and accessible trips stay', () => {
  // Stops A=0, B=1. Trip 0 (not accessible) arrives first, trip 1 (unknown) later, trip 2 (accessible) last.
  const table = connectionTable(
    [
      { trip: 0, from: 0, to: 1, departure: 100, arrival: 200, sequence: 1, pickup: 0, dropoff: 0 },
      { trip: 1, from: 0, to: 1, departure: 150, arrival: 300, sequence: 1, pickup: 0, dropoff: 0 },
      { trip: 2, from: 0, to: 1, departure: 160, arrival: 400, sequence: 1, pickup: 0, dropoff: 0 },
    ],
    3,
    2,
  );
  const access = Uint8Array.from([2, 0, 1]);
  const run = (t: typeof table) => scan({ table: t, footpaths: emptyFootpaths(2), access: new Map([[0, 0]]), egress: new Map([[1, 0]]), departure: 0, boardingBuffer: 0 })[0];
  assert.equal(run(usableConnections(table, access, 'walk')).arrival, 200);
  assert.equal(run(usableConnections(table, access, 'stroller')).arrival, 200);
  const filtered = usableConnections(table, access, 'wheelchair');
  assert.equal(filtered.count, 2);
  assert.equal(run(filtered).arrival, 300);
  assert.equal(usableConnections(table, Uint8Array.from([0, 0, 1]), 'wheelchair'), table, 'no copy when nothing is excluded');
});

// North along Floriańska, then east along Szpitalna (right turn), with stairs down at the end.
const streets = dataset(
  [node('a', 50, 19.9), node('b', 50.001, 19.9), node('d', 50.001, 19.902), node('e', 50.0011, 19.902)],
  [
    way('f', ['a', 'b'], { highway: 'residential', name: 'Floriańska' }),
    way('s', ['b', 'd'], { highway: 'residential', name: 'Szpitalna' }),
    way('st', ['e', 'd'], { highway: 'steps', incline: 'up', step_count: '22' }),
  ],
);

function streetLeg(locale: 'pl' | 'en' | 'uk') {
  const g = buildGraph(streets);
  const path = shortestPath(g, idx(g, 'a'), idx(g, 'e'), free)!;
  return walkLeg(g, path, { name: 'Start', lat: 50, lon: 19.9 }, { name: 'Muzeum', lat: 50.0011, lon: 19.902 }, free, { departure: null, destination: true, locale });
}

const polish = /[ąćęłńóśźż]|Idź|Skręć|Prosto|Schody|Cel:|stopni|poręcz/i;

test('walking instructions and facts follow the requested locale; names stay as in the data', () => {
  const pl = streetLeg('pl');
  assert.deepEqual(pl.steps.map(s => s.instruction), ['Idź: Floriańska', 'Skręć w prawo: Szpitalna', 'Schody w dół · 22 stopnie · poręcz: brak danych', 'Cel: Muzeum']);
  assert.equal(pl.facts[0].title, 'Schody w dół · 22 stopnie');

  const en = streetLeg('en');
  assert.equal(en.steps[0].instruction, 'Head: Floriańska');
  assert.equal(en.steps[1].instruction, 'Turn right: Szpitalna');
  assert.equal(en.steps[2].instruction, 'Stairs down · 22 steps · handrail: no data');
  assert.equal(en.steps.at(-1)!.instruction, 'Destination: Muzeum');
  for (const s of en.steps) assert.doesNotMatch(s.instruction.replace(/Floriańska|Szpitalna/, ''), polish);

  const uk = streetLeg('uk');
  assert.equal(uk.steps[0].instruction, 'Ідіть: Floriańska');
  assert.equal(uk.steps[1].instruction, 'Поверніть праворуч: Szpitalna');
  assert.equal(uk.steps[2].instruction, 'Сходи вниз · 22 сходинки · поручень: немає даних');
  assert.equal(uk.steps.at(-1)!.instruction, 'Місце призначення: Muzeum');
  for (const s of uk.steps) assert.doesNotMatch(s.instruction.replace(/Floriańska|Szpitalna/, ''), polish);
});

test('plural forms and number formats per locale', () => {
  const stairs = (locale: 'pl' | 'en' | 'uk', n: number) => serverMessages(locale).facts.stairs('up', n);
  assert.deepEqual([1, 2, 5, 12, 22, 25, 101].map(n => stairs('pl', n).split(' · ')[1]), ['1 stopień', '2 stopnie', '5 stopni', '12 stopni', '22 stopnie', '25 stopni', '101 stopni']);
  assert.deepEqual([1, 3, 5, 11, 21, 24, 111].map(n => stairs('uk', n).split(' · ')[1]), ['1 сходинка', '3 сходинки', '5 сходинок', '11 сходинок', '21 сходинка', '24 сходинки', '111 сходинок']);
  assert.deepEqual([1, 2].map(n => stairs('en', n).split(' · ')[1]), ['1 step', '2 steps']);
  assert.equal(formatDistance(1234, 'pl'), '1,2 km');
  assert.equal(formatDistance(1234, 'en'), '1.2 km');
  assert.equal(formatDistance(1234, 'uk'), '1,2 км');
  assert.equal(formatDistance(80, 'uk'), '80 м');
  assert.equal(serverMessages('xx').labels.preferred, 'Dopasowana do dzisiaj', 'unknown locale falls back to Polish');
});

test('journey request defaults to transit in Polish; off-network errors are localised', () => {
  const at = { id: 'x', name: 'X', lat: 50.06, lon: 19.94, source: 'test' };
  const parsed = journeyRequestSchema.parse({ from: at, to: at, preferences: defaultPreferences, date: '2026-10-03', time: '14:00' });
  assert.equal(parsed.transport, 'transit');
  assert.equal(parsed.locale, 'pl');
  assert.equal(journeyRequestSchema.safeParse({ ...parsed, locale: 'de' }).success, false);
  assert.equal(journeyRequestSchema.safeParse({ ...parsed, transport: 'bike' }).success, false);

  const g = buildGraph(streets);
  const far = { id: 'far', name: 'Far', lat: 49.5, lon: 19.5, source: 'test' };
  const roads = () => {
    throw new Error('road graph must not load for transit requests');
  };
  const pl = planJourney({ from: far, to: far, preferences: defaultPreferences, date: '2026-10-03', time: '14:00' }, g, roads);
  assert.equal(pl.options.length, 0);
  assert.ok(pl.errors.includes(serverMessages('pl').errors.offNetwork));
  const en = planJourney({ from: far, to: far, preferences: defaultPreferences, date: '2026-10-03', time: '14:00', locale: 'en' }, g, roads);
  assert.ok(en.errors.includes('This point is too far from the known walking network. Choose a nearby street or stop.'));
});
