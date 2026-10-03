import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, edgeAt, forbidden, metres, nearest, reach, shortestPath, type WalkGraph } from '../src/lib/routing';
import { handrail, type Dataset, type OsmNode, type Way } from '../src/lib/data';
import { assess, walkLeg, walkingOptions, walkLabels } from '../src/lib/walking';
import { orderOptions } from '../src/lib/journey';
import { defaultPreferences, preferencesSchema, observationSchema, type Preferences } from '../src/lib/schemas';
import type { JourneyOption, WalkLeg } from '../src/lib/journey-types';

const unrestricted: Preferences = { ...defaultPreferences, avoidStairs: false, avoidDown: false, avoidUp: false, preferHandrails: false, preferRest: false };

const node = (id: string, lat: number, lon: number, tags: Record<string, string> = {}): OsmNode => ({ id, lat, lon, tags, editedAt: null });
const way = (id: string, nodes: string[], tags: Record<string, string>): Way => ({ id, nodes, tags, editedAt: null });
const dataset = (nodes: OsmNode[], ways: Way[], features: OsmNode[] = []): Dataset => ({
  obtainedAt: '2026-10-03',
  url: 'fixture',
  bbox: [],
  context: [],
  features,
  nodes: Object.fromEntries(nodes.map(n => [n.id, n])),
  ways,
});

// a --(steps, incline up)--> b, plus a footway detour a-c-b.
const small = dataset(
  [node('a', 50, 19), node('b', 50.0001, 19), node('c', 50.0001, 19.0001)],
  [way('s', ['a', 'b'], { highway: 'steps', incline: 'up', step_count: '8' }), way('detour', ['a', 'c', 'b'], { highway: 'footway' })],
);
const idx = (g: WalkGraph, id: string) => g.index.get(id)!;
const pathWays = (g: WalkGraph, path: number[] | null) => path?.map(e => g.ways[g.edgeWay[e]].id);
const outEdges = (g: WalkGraph, id: string) => {
  const n = idx(g, id);
  return Array.from({ length: g.offsets[n + 1] - g.offsets[n] }, (_, k) => edgeAt(g, g.offsets[n] + k));
};

test('stair direction is relative to OSM way order and reverses with travel', () => {
  const g = buildGraph(small);
  assert.equal(outEdges(g, 'a').find(e => e.way.id === 's')!.direction, 'up');
  assert.equal(outEdges(g, 'b').find(e => e.way.id === 's')!.direction, 'down');
  const p = { ...unrestricted, avoidDown: true };
  assert.deepEqual(pathWays(g, shortestPath(g, idx(g, 'a'), idx(g, 'b'), p)), ['s']);
  assert.deepEqual(pathWays(g, shortestPath(g, idx(g, 'b'), idx(g, 'a'), p)), ['detour', 'detour']);
});

test('avoid all stairs takes precedence over directional settings', () => {
  const g = buildGraph(small);
  const path = shortestPath(g, idx(g, 'a'), idx(g, 'b'), { ...unrestricted, avoidStairs: true })!;
  assert.ok(path.every(e => g.ways[g.edgeWay[e]].tags.highway !== 'steps'));
});

test('unknown stair direction cannot satisfy a directional exclusion', () => {
  const g = buildGraph({ ...small, ways: [way('s', ['a', 'b'], { highway: 'steps' })] });
  assert.equal(shortestPath(g, idx(g, 'a'), idx(g, 'b'), { ...unrestricted, avoidUp: true }), null);
  assert.equal(forbidden(outEdges(g, 'a')[0], unrestricted), false);
  assert.equal(forbidden(outEdges(g, 'a')[0], { ...unrestricted, avoidDown: true }), true);
});

test('honours one-way walking restrictions and blocked barrier nodes', () => {
  const oneway = buildGraph({ ...small, ways: [way('s', ['a', 'b'], { highway: 'steps', 'oneway:foot': 'yes' })] });
  assert.equal(shortestPath(oneway, idx(oneway, 'b'), idx(oneway, 'a'), unrestricted), null);
  const gated = buildGraph({ ...small, nodes: { ...small.nodes, b: node('b', 50.0001, 19, { access: 'private', barrier: 'gate' }) } });
  assert.equal(gated.index.has('b'), false);
});

test('handrail preference steers away from stairs without a marked handrail', () => {
  const data = dataset(
    [node('a', 50, 19), node('b', 50.0002, 19), node('c', 50.0001, 19.00005)],
    [way('bare', ['a', 'b'], { highway: 'steps', incline: 'up' }), way('rail', ['a', 'c', 'b'], { highway: 'steps', incline: 'up', handrail: 'yes' })],
  );
  const g = buildGraph(data);
  assert.equal(pathWays(g, shortestPath(g, idx(g, 'a'), idx(g, 'b'), unrestricted))![0], 'bare');
  assert.equal(pathWays(g, shortestPath(g, idx(g, 'a'), idx(g, 'b'), { ...unrestricted, preferHandrails: true }))![0], 'rail');
});

// A 10 × 10 grid of residential streets with ~111 m blocks.
function gridDataset() {
  const nodes: OsmNode[] = [];
  const ways: Way[] = [];
  for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) nodes.push(node(`${r}-${c}`, 50 + r * 0.001, 19.9 + c * 0.0015));
  for (let r = 0; r < 10; r++) ways.push(way(`row${r}`, Array.from({ length: 10 }, (_, c) => `${r}-${c}`), { highway: 'residential', name: `Ulica ${r}` }));
  for (let c = 0; c < 10; c++) ways.push(way(`col${c}`, Array.from({ length: 10 }, (_, r) => `${r}-${c}`), { highway: 'residential', name: `Aleja ${c}` }));
  return dataset(nodes, ways);
}

test('A* matches exhaustive Dijkstra distances and nearest() matches brute force', () => {
  const g = buildGraph(gridDataset());
  const start = idx(g, '0-0');
  const all = reach(g, start, null, Infinity, new Set(g.ids.map((_, i) => i)));
  for (const target of ['9-9', '4-7', '0-9']) {
    const path = shortestPath(g, start, idx(g, target), null)!;
    const length = path.reduce((s, e) => s + g.edgeLength[e], 0);
    assert.ok(Math.abs(length - all.distance.get(idx(g, target))!) < 1e-6);
  }
  for (const point of [{ lat: 50.0042, lon: 19.9061 }, { lat: 50.0001, lon: 19.9001 }]) {
    const brute = g.ids.map((_, i) => i).sort((a, b) => metres(point, { lat: g.lat[a], lon: g.lon[a] }) - metres(point, { lat: g.lat[b], lon: g.lon[b] }))[0];
    assert.equal(nearest(g, point, 200), brute);
  }
  assert.equal(nearest(g, { lat: 50.1, lon: 19.9 }, 100), -1);
});

const leg = (g: WalkGraph, path: number[], p: Preferences, destination = true): WalkLeg => {
  const from = { name: 'Start', lat: g.lat[g.edgeFrom[path[0]]], lon: g.lon[g.edgeFrom[path[0]]] };
  const last = g.edgeTo[path.at(-1)!];
  return walkLeg(g, path, from, { name: 'Cel', lat: g.lat[last], lon: g.lon[last] }, p, { departure: null, destination });
};

test('steps group by street with turn hints and fold tiny segments', () => {
  // North along Floriańska, a 5 m unnamed piece, then east along Szpitalna (right turn).
  const data = dataset(
    [node('a', 50, 19.9), node('b', 50.001, 19.9), node('c', 50.00105, 19.9), node('d', 50.00105, 19.902)],
    [way('f', ['a', 'b'], { highway: 'residential', name: 'Floriańska' }), way('x', ['b', 'c'], { highway: 'footway' }), way('s', ['c', 'd'], { highway: 'residential', name: 'Szpitalna' })],
  );
  const g = buildGraph(data);
  const result = leg(g, shortestPath(g, idx(g, 'a'), idx(g, 'd'), null)!, unrestricted);
  assert.deepEqual(result.steps.map(s => s.instruction), ['Idź: Floriańska', 'Skręć w prawo: Szpitalna', 'Cel: Cel']);
  const stepTotal = result.steps.reduce((s, x) => s + x.distance, 0);
  assert.ok(Math.abs(stepTotal - result.distance) <= 2, `steps ${stepTotal} vs leg ${result.distance}`);
  assert.equal(result.seconds, Math.round(result.distance)); // 1.0 m/s
});

test('stair facts are inline in steps with direction relative to travel', () => {
  const g = buildGraph(small);
  const down = leg(g, shortestPath(g, idx(g, 'b'), idx(g, 'a'), unrestricted)!, unrestricted);
  const stairs = down.facts.filter(f => f.kind === 'stairs');
  assert.equal(stairs.length, 1);
  assert.equal(stairs[0].direction, 'down');
  assert.equal(stairs[0].tags.step_count, '8');
  assert.equal(stairs[0].sourceUrl, 'https://www.openstreetmap.org/way/s');
  const step = down.steps.find(s => s.factId === stairs[0].id)!;
  assert.match(step.instruction, /^Schody w dół · 8 stopni · poręcz: brak danych$/);
  assert.deepEqual(assess([down], { ...unrestricted, avoidDown: true }).issues, ['Schody w dół']);
  assert.deepEqual(assess([down], { ...unrestricted, avoidUp: true }).issues, []);
});

test('benches only with preferRest, at most one per 150 m; entrances only at the destination', () => {
  const count = 61; // 600 m straight footway, nodes every 10 m
  const nodes = Array.from({ length: count }, (_, i) => node(`n${i}`, 50 + i * 0.00009, 19.9));
  const benches = Array.from({ length: 30 }, (_, i) => node(`bench${i}`, 50 + i * 0.00018, 19.90005, { amenity: 'bench' }));
  const entrances = [
    node('mid', 50 + 30 * 0.00009, 19.90005, { entrance: 'main' }),
    node('e1', 50 + 60 * 0.00009, 19.90008, { entrance: 'yes' }),
    node('e2', 50 + 60 * 0.00009, 19.89992, { entrance: 'main' }),
    node('e3', 50 + 60 * 0.00009 + 0.0002, 19.9, { entrance: 'yes' }),
    node('garage', 50 + 60 * 0.00009, 19.90001, { entrance: 'garage' }),
  ];
  const g = buildGraph(dataset(nodes, [way('line', nodes.map(n => n.id), { highway: 'footway' })], [...benches, ...entrances]));
  const path = shortestPath(g, idx(g, 'n0'), idx(g, `n${count - 1}`), null)!;
  const rest = leg(g, path, { ...unrestricted, preferRest: true });
  const benchFacts = rest.facts.filter(f => f.kind === 'bench');
  assert.ok(benchFacts.length >= 3 && benchFacts.length <= 4, `got ${benchFacts.length}`);
  for (let i = 1; i < benchFacts.length; i++) assert.ok(metres(benchFacts[i - 1], benchFacts[i]) >= 140);
  assert.equal(assess([rest], unrestricted).rests, benchFacts.length);
  assert.equal(leg(g, path, unrestricted).facts.filter(f => f.kind === 'bench').length, 0);
  const entranceIds = rest.facts.filter(f => f.kind === 'entrance').map(f => f.id).sort();
  assert.deepEqual(entranceIds, ['node:e1', 'node:e2']);
  assert.equal(leg(g, path, unrestricted, false).facts.filter(f => f.kind === 'entrance').length, 0);
});

test('walking options: preferred avoids stairs, shortest shown separately and flagged', () => {
  const g = buildGraph(small);
  const place = (id: string) => ({ id, name: id, lat: small.nodes[id].lat, lon: small.nodes[id].lon, source: 'fixture' });
  const { options } = walkingOptions(g, place('b'), place('a'), { ...unrestricted, avoidDown: true, maxDistance: 100 }, 36000);
  assert.deepEqual(options.map(o => o.label), [walkLabels.preferred, walkLabels.shortest]);
  assert.equal(options[0].stairs.down, 0);
  assert.equal(options[0].fits, true);
  assert.equal(options[1].stairs.down, 1);
  assert.equal(options[1].fits, false);
  assert.ok(options[1].issues.includes('Schody w dół'));
  assert.equal(options[0].departure, 36000);
  assert.equal(options[0].arrival, 36000 + options[0].duration);
  const limited = walkingOptions(g, place('b'), place('a'), { ...unrestricted, maxDistance: 100 }, 0);
  assert.equal(limited.options.length, 1); // identical routes: no fake alternative
  const long = assess(options[0].legs, { ...unrestricted, maxDistance: 1200 });
  assert.equal(long.fits, true);
  assert.deepEqual(assess([{ ...(options[0].legs[0] as WalkLeg), distance: 1500 }], { ...unrestricted, maxDistance: 1200 }).issues, ['Ponad Twój limit 1,2 km']);
});

test('walking options come first only when within 1.5 × the daily limit', () => {
  const option = (kind: 'walk' | 'transit', walkingDistance: number, departure: number) => ({ id: `${kind}${departure}`, kind, walkingDistance, departure }) as JourneyOption;
  const walk = [option('walk', 1500, 0)];
  const transit = [option('transit', 300, 200), option('transit', 300, 100)];
  assert.deepEqual(orderOptions(walk, transit, { ...defaultPreferences, maxDistance: 1200 }).map(o => o.id), ['walk0', 'transit100', 'transit200']);
  assert.deepEqual(orderOptions(walk, transit, { ...defaultPreferences, maxDistance: 900 }).map(o => o.id), ['transit100', 'transit200', 'walk0']);
});

test('handrail variants preserve yes/no/unknown', () => {
  assert.equal(handrail({ 'handrail:right': 'yes' }), 'yes');
  assert.equal(handrail({ handrail: 'no' }), 'no');
  assert.equal(handrail({}), 'unknown');
  assert.equal(handrail({ 'handrail:left': 'no' }), 'unknown');
});

test('schemas reject missing preferences, invalid ranges and malformed AI observations', () => {
  assert.equal(preferencesSchema.safeParse({}).success, false);
  assert.equal(preferencesSchema.safeParse({ ...defaultPreferences, maxDistance: -1 }).success, false);
  assert.equal(observationSchema.safeParse({ kind: 'diagnosis', description: 'abc' }).success, false);
});
