import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, metres, shortestPath, type WalkGraph } from '../src/lib/routing';
import { walkingOptions } from '../src/lib/walking';
import { addRestStops, addToilets, applyExtras } from '../src/lib/journey-extras';
import { buildCatalog, accessibleToiletsOf, queryCatalogPage, DEMO_PARTNER, type OsmRecord } from '../src/lib/objects';
import { KRAKOW_TAXI_TARIFF, rideLinks, taxiFare, tariffPrice } from '../src/lib/taxi';
import { defaultPreferences, preferencesSchema, type Preferences } from '../src/lib/schemas';
import type { Dataset, OsmNode, Way } from '../src/lib/data';
import type { JourneyOption, RideLeg, WalkLeg } from '../src/lib/journey-types';

const free: Preferences = { ...defaultPreferences, avoidStairs: false, avoidDown: false, avoidUp: false, preferHandrails: false, preferRest: false };
const crutches: Preferences = { ...free, mobility: 'crutches' };

const node = (id: string, lat: number, lon: number, tags: Record<string, string> = {}): OsmNode => ({ id, lat, lon, tags, editedAt: null });
const way = (id: string, nodes: string[], tags: Record<string, string>): Way => ({ id, nodes, tags, editedAt: null });
const dataset = (nodes: OsmNode[], ways: Way[], features: OsmNode[] = []): Dataset => ({
  obtainedAt: '2026-10-03', url: 'fixture', bbox: [], context: [], features, ways,
  nodes: Object.fromEntries(nodes.map(n => [n.id, n])),
});
const idx = (g: WalkGraph, id: string) => g.index.get(id)!;
const route = (g: WalkGraph, p: Preferences | null) => shortestPath(g, idx(g, 'a'), idx(g, 'b'), p)?.map(e => g.ways[g.edgeWay[e]].id);
const place = (d: Dataset, id: string) => ({ id, name: id, lat: d.nodes[id].lat, lon: d.nodes[id].lon, source: 'fixture' });

/** a → b directly (`direct`, length set by `dLat`) or via c (footway detour of `detour` metres east). */
function pair(direct: Record<string, string>, dLat = 0.001, detourLon = 0.0006) {
  return dataset(
    [node('a', 50, 19), node('b', 50 + dLat, 19), node('c', 50 + dLat / 2, 19 + detourLon)],
    [way('direct', ['a', 'b'], { highway: 'footway', ...direct }), way('detour', ['a', 'c', 'b'], { highway: 'footway' })],
  );
}

test('preferences accept crutches, restEvery 0..30 and showToilets', () => {
  assert.ok(preferencesSchema.safeParse({ ...defaultPreferences, mobility: 'crutches', restEvery: 10, showToilets: true }).success);
  assert.equal(preferencesSchema.safeParse({ ...defaultPreferences, restEvery: 31 }).success, false);
  assert.equal(preferencesSchema.safeParse({ ...defaultPreferences, restEvery: -1 }).success, false);
});

test('crutches: stairs allowed by preference, but no known handrail and long flights cost much more', () => {
  // 111 m of stairs vs a ~140 m footway detour.
  const plain = buildGraph(pair({ highway: 'steps' }));
  assert.deepEqual(route(plain, free), ['direct']);
  assert.deepEqual(route(plain, crutches), ['detour', 'detour']);
  // Short flight (≈ 11 m) vs ≈ 70 m detour: with a handrail crutches take the stairs, without one they walk around.
  const short = (tags: Record<string, string>) => buildGraph(pair({ highway: 'steps', ...tags }, 0.0001, 0.0006));
  assert.deepEqual(route(short({ handrail: 'yes', step_count: '10' }), crutches), ['direct']);
  assert.deepEqual(route(short({ step_count: '10' }), crutches), ['detour', 'detour']);
  assert.deepEqual(route(short({ handrail: 'no', step_count: '10' }), crutches), ['detour', 'detour']);
  assert.deepEqual(route(short({ handrail: 'yes', step_count: '30' }), crutches), ['detour', 'detour'], 'long flight');
  // Stair preferences still apply.
  assert.equal(route(short({ handrail: 'yes' }), { ...crutches, avoidStairs: true })!.includes('direct'), false);
  // Walking is unchanged by these tags.
  assert.deepEqual(route(short({ step_count: '30' }), free), ['direct']);
});

test('crutches: rough surfaces cost moderately, raised kerbs mildly; issues name what is hard', () => {
  const sett = pair({ surface: 'sett' });
  const g = buildGraph(sett);
  assert.deepEqual(route(g, free), ['direct']);
  assert.deepEqual(route(g, crutches), ['detour', 'detour']);
  // Moderate: a much longer smooth detour is not worth it.
  assert.deepEqual(route(buildGraph(pair({ surface: 'sett' }, 0.001, 0.003)), crutches), ['direct']);
  const { options } = walkingOptions(buildGraph(pair({ surface: 'sett' }, 0.001, 0.003)), place(sett, 'a'), place(sett, 'b'), crutches, 0);
  assert.ok(options[0].issues.includes('Bruk na 111 m'));
  assert.equal(options[0].fits, true);
  const leg = options[0].legs[0] as WalkLeg;
  assert.equal(leg.facts.find(f => f.kind === 'surface')?.title, 'Bruk · 111 m');

  const stairsOnly = (tags: Record<string, string>) => {
    const d = dataset([node('a', 50, 19), node('b', 50.0002, 19)], [way('s', ['a', 'b'], { highway: 'steps', incline: 'up', ...tags })]);
    return walkingOptions(buildGraph(d), place(d, 'a'), place(d, 'b'), crutches, 0).options[0];
  };
  assert.ok(stairsOnly({}).issues.includes('Schody bez danych o poręczy'));
  assert.ok(stairsOnly({ handrail: 'no' }).issues.includes('Schody bez poręczy'));
  assert.ok(stairsOnly({ handrail: 'yes', step_count: '20' }).issues.includes('Długie schody, ponad 15 stopni'));
  assert.deepEqual(stairsOnly({ handrail: 'yes', step_count: '8' }).issues, []);
  assert.equal(stairsOnly({}).fits, true, 'notes do not make it unfit');

  // Raised kerb: mild (15 m) penalty — a 30 m detour is not taken, a 5 m one would be.
  const kerb = dataset(
    [node('a', 50, 19), node('k', 50.0005, 19, { barrier: 'kerb', kerb: 'raised' }), node('b', 50.001, 19), node('c', 50.0005, 19.0006)],
    [way('direct', ['a', 'k', 'b'], { highway: 'footway' }), way('detour', ['a', 'c', 'b'], { highway: 'footway' })],
  );
  assert.deepEqual(route(buildGraph(kerb), crutches), ['direct', 'direct']);
  const kerbOption = walkingOptions(buildGraph(kerb), place(kerb, 'a'), place(kerb, 'b'), crutches, 0).options[0];
  assert.ok(kerbOption.issues.includes('Krawężnik bez obniżenia'));
  // Walking ignores kerbs entirely.
  assert.deepEqual(walkingOptions(buildGraph(kerb), place(kerb, 'a'), place(kerb, 'b'), free, 0).options[0].issues, []);
});

// A straight 1500 m footway north from a; benches at ~290 m (no backrest, 10 m off), ~320 m (backrest, 30 m off), ~900 m (5 m off).
const M_LAT = 1 / 111_195;
const M_LON = 1 / (111_195 * Math.cos((50 * Math.PI) / 180));
function line() {
  const nodes = Array.from({ length: 31 }, (_, i) => node(`n${i}`, 50 + i * 50 * M_LAT, 19));
  nodes[0] = { ...nodes[0], id: 'a' };
  nodes[30] = { ...nodes[30], id: 'b' };
  const benches = [
    node('bench1', 50 + 290 * M_LAT, 19 + 10 * M_LON, { amenity: 'bench', backrest: 'no' }),
    node('bench2', 50 + 320 * M_LAT, 19 + 30 * M_LON, { amenity: 'bench', backrest: 'yes' }),
    node('bench3', 50 + 900 * M_LAT, 19 - 5 * M_LON, { amenity: 'bench' }),
  ];
  return dataset(nodes, [way('long', nodes.map(n => n.id), { highway: 'footway', name: 'Aleja' })], benches);
}

test('rest stops: best bench near each mark, +2 min each, notes for marks without a bench', () => {
  const d = line();
  const g = buildGraph(d);
  const p = { ...free, restEvery: 5, maxDistance: 3000 };
  const [option] = walkingOptions(g, place(d, 'a'), place(d, 'b'), p, 36000).options;
  const leg = option.legs[0] as WalkLeg;
  const walked = leg.seconds;
  assert.ok(Math.abs(walked - 1500) < 2);
  addRestStops(option, g, p, 'pl');
  const rests = leg.facts.filter(f => f.restAfterMinutes !== undefined);
  assert.deepEqual(rests.map(f => [f.id, f.kind, f.restAfterMinutes]), [['node:bench2', 'bench', 5], ['node:bench3', 'bench', 15]], 'backrest wins near the 5-minute mark; next mark counted from the rest');
  assert.equal(rests[0].title, 'Ławka z oparciem');
  assert.equal(option.restStops, 2);
  assert.equal(option.restMinutes, 4);
  assert.equal(option.rests, 2);
  assert.equal(leg.seconds, walked + 240);
  assert.equal(option.duration, walked + 240);
  assert.equal(option.arrival, 36000 + walked + 240);
  assert.deepEqual(option.issues, ['Brak ławki ok. 10. minuty', 'Brak ławki ok. 20. minuty']);
  assert.equal(option.fits, true);
  const rested = JSON.stringify(option);
  addRestStops(option, g, p, 'pl');
  assert.equal(JSON.stringify(option), rested, 'a timetable-planned rest is not applied again by extras');

  // restEvery = 0: nothing changes.
  const [plain] = walkingOptions(g, place(d, 'a'), place(d, 'b'), free, 36000).options;
  const before = JSON.stringify(plain);
  addRestStops(plain, g, free, 'pl');
  assert.equal(JSON.stringify(plain), before);

  // A bench already shown for preferRest is marked, not duplicated.
  const both = { ...p, preferRest: true };
  const [shown] = walkingOptions(g, place(d, 'a'), place(d, 'b'), both, 36000).options;
  addRestStops(shown, g, both, 'en');
  const ids = (shown.legs[0] as WalkLeg).facts.map(f => f.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(shown.issues.includes('No bench around minute 10'));
});

test('rest stops before the first ride make the journey leave earlier; after the last ride arrive later', () => {
  const d = line();
  const g = buildGraph(d);
  const p = { ...free, restEvery: 5 };
  const [walkOption] = walkingOptions(g, place(d, 'a'), place(d, 'b'), p, 1000).options;
  const access = walkOption.legs[0] as WalkLeg;
  const ride: RideLeg = { type: 'ride', mode: 'tram', line: '1', headsign: 'X', from: { id: 's1', name: 'S1', code: '', lat: 0, lon: 0, wheelchair: '0' }, to: { id: 's2', name: 'S2', code: '', lat: 0, lon: 0, wheelchair: '0' }, departure: 1000 + access.seconds + 60, arrival: 4000, geometry: [], stops: [], wheelchair: '0' };
  const egress: WalkLeg = { ...access, facts: [], geometry: [[50, 19], [50 + 100 * M_LAT, 19]], distance: 100, seconds: 100, departure: 4000 };
  const option: JourneyOption = { ...walkOption, kind: 'transit', legs: [access, ride, egress], departure: 1000, arrival: 4100, duration: 3100 };
  addRestStops(option, g, p, 'pl');
  assert.equal(option.restStops, 2);
  assert.equal(access.departure, 1000 - 240);
  assert.equal(option.departure, 760);
  assert.equal(option.arrival, 4100);
  assert.equal(option.duration, 4100 - 760);
  assert.equal(egress.departure, 4000);
});

const OBTAINED = '2026-10-03T00:00:00Z';
const rec = (id: string, extra: Partial<OsmRecord>): OsmRecord => ({ id, c: 'toilet', k: 'amenity=toilets', n: null, la: 50, lo: 19, ts: '2025-01-01T00:00:00Z', t: {}, e: [], ...extra });

test('toilets: only those a source states as accessible, near the walk and the destination', () => {
  const at = (m: number, east: number) => ({ la: 50 + m * M_LAT, lo: 19 + east * M_LON });
  const cat = buildCatalog({ osm: { obtainedAt: OBTAINED, sourceDate: null, objects: [
    rec('node:1', { n: 'WC Aleja', ...at(400, 50), t: { wheelchair: 'yes' } }),
    rec('node:2', { n: 'WC bez danych', ...at(600, 20) }),
    rec('node:3', { n: 'WC niedostępne', ...at(800, 20), t: { wheelchair: 'no' } }),
    rec('node:4', { n: 'WC częściowo', ...at(1000, 40), t: { wheelchair: 'limited' } }),
    rec('node:5', { n: 'WC blisko', ...at(1100, 40), t: { wheelchair: 'yes' } }),
    rec('node:6', { c: 'museum', k: 'tourism=museum', n: 'Muzeum', ...at(1750, 0), t: { 'toilets:wheelchair': 'yes' } }),
    rec('node:7', { c: 'museum', k: 'tourism=museum', n: 'Muzeum bez toalety', ...at(1700, 0), t: { wheelchair: 'yes' } }),
  ] } });
  const toilets = accessibleToiletsOf(cat);
  assert.deepEqual(toilets.map(t => [t.objectId, t.value]).sort(), [['osm-node-1', 'yes'], ['osm-node-4', 'limited'], ['osm-node-5', 'yes'], ['osm-node-6', 'yes']]);
  assert.equal(toilets.find(t => t.objectId === 'osm-node-1')!.sourceUrl, 'https://www.openstreetmap.org/node/1');

  const d = line();
  const g = buildGraph(d);
  const [option] = walkingOptions(g, place(d, 'a'), place(d, 'b'), free, 0).options;
  addToilets(option, toilets, 'pl');
  const facts = (option.legs[0] as WalkLeg).facts.filter(f => f.kind === 'toilet');
  // Route: node:1 (~400 m), node:4 (~1000 m); node:5 is only 100 m further, too close to node:4. Destination: museum 250 m past b.
  assert.deepEqual(facts.map(f => f.objectId), ['osm-node-1', 'osm-node-4', 'osm-node-6']);
  assert.deepEqual(facts.map(f => f.title), ['Toaleta przystosowana · WC Aleja', 'Toaleta częściowo przystosowana · WC częściowo', 'Toaleta przystosowana · Muzeum']);
  assert.ok(facts.every(f => f.sourceUrl.startsWith('https://www.openstreetmap.org/') && f.id === `toilet:${f.objectId}`));

  // showToilets off: the provider is never called.
  const [off] = walkingOptions(g, place(d, 'a'), place(d, 'b'), free, 0).options;
  applyExtras([off], g, free, 'pl', () => { throw new Error('must not load'); });
  assert.equal((off.legs[0] as WalkLeg).facts.filter(f => f.kind === 'toilet').length, 0);
  const [on] = walkingOptions(g, place(d, 'a'), place(d, 'b'), free, 0).options;
  applyExtras([on], g, { ...free, showToilets: true }, 'de', () => toilets);
  assert.equal((on.legs[0] as WalkLeg).facts.find(f => f.kind === 'toilet')!.title, 'Rollstuhlgerechte Toilette · WC Aleja');
});

test('taxi fare follows the Kraków maximum tariff (zone I): min tariff 1, max tariff 2 + 20 %', () => {
  assert.equal(KRAKOW_TAXI_TARIFF.initialFee, 9);
  assert.equal(KRAKOW_TAXI_TARIFF.perKmTariff1, 4);
  assert.equal(KRAKOW_TAXI_TARIFF.perKmTariff2, 6);
  assert.equal(tariffPrice(200, 4), 9, 'initial fee covers the first 200 m');
  assert.equal(tariffPrice(2200, 6), 21, 'city leaflet example: ~2 km at night ≈ 21 zł');
  const fare = taxiFare(5200, 'pl');
  assert.equal(fare.min, 29); // 9 + 5 × 4
  assert.equal(fare.max, 47); // ceil((9 + 5 × 6) × 1.2) = ceil(46.8)
  assert.equal(fare.currency, 'PLN');
  assert.equal(fare.sourceUrl, 'https://www.bip.krakow.pl/zalaczniki/dokumenty/n/343506');
  assert.match(fare.basis, /taryfa 1–2/);
  assert.match(taxiFare(5200, 'de').basis, /Tarif 1–2/);
  assert.deepEqual([taxiFare(100).min, taxiFare(100).max], [9, 11]);
  const links = rideLinks({ name: 'Dom & Ogród', lat: 50.061234567, lon: 19.9 }, { name: 'Rynek', lat: 50.0617, lon: 19.9373 }, 'en');
  const uber = new URL(links[0].url);
  assert.deepEqual(JSON.parse(uber.searchParams.get('pickup')!), { latitude: 50.061235, longitude: 19.9, addressLine1: 'Dom & Ogród' });
  assert.equal(links[1].url, 'https://bolt.eu/en/cities/krakow/');
  assert.equal(links[2].url, 'https://www.free-now.com/pl/pasazer/taxi-krakowie/');
});

test('explore paging: stable total order, no overlaps or gaps, nextOffset null on the last page', () => {
  // Many equal-score objects (same name, same distance) to exercise the tie-break.
  const objects = Array.from({ length: 75 }, (_, i) => rec(`node:${100 + i}`, { c: 'museum', k: 'tourism=museum', n: i % 3 ? 'Muzeum' : `Muzeum ${i}`, la: 50.06 + (i % 5) * 0.0001, lo: 19.94, t: i % 2 ? { wheelchair: 'yes' } : {} }));
  const cat = buildCatalog({ osm: { obtainedAt: OBTAINED, sourceDate: null, objects } });
  const query = { category: 'museum' as const, lat: 50.06, lon: 19.94, limit: 30 };
  const all = queryCatalogPage(cat, { ...query, limit: 100 });
  assert.equal(all.total, 75);
  assert.equal(all.nextOffset, null);
  const pages = [0, 30, 60].map(offset => queryCatalogPage(cat, { ...query, offset }));
  assert.deepEqual(pages.map(p => p.nextOffset), [30, 60, null]);
  assert.deepEqual(pages.map(p => p.objects.length), [30, 30, 15]);
  assert.deepEqual(pages.flatMap(p => p.objects.map(o => o.id)), all.objects.map(o => o.id));
  // Same result when the catalogue is rebuilt in a different input order.
  const reversed = buildCatalog({ osm: { obtainedAt: OBTAINED, sourceDate: null, objects: [...objects].reverse() } });
  assert.deepEqual(queryCatalogPage(reversed, { ...query, offset: 30 }).objects.map(o => o.id), pages[1].objects.map(o => o.id));
  assert.equal(queryCatalogPage(cat, { ...query, offset: 500 }).objects.length, 0);
  assert.equal(queryCatalogPage(cat, { ...query, limit: 1000 }).objects.length, 75, 'limit capped at 100');
});

test('metres helper sanity for fixtures', () => {
  assert.ok(Math.abs(metres({ lat: 50, lon: 19 }, { lat: 50 + 100 * M_LAT, lon: 19 }) - 100) < 0.5);
  assert.ok(Math.abs(metres({ lat: 50, lon: 19 }, { lat: 50, lon: 19 + 100 * M_LON }) - 100) < 0.5);
});

test('operational toilets exclude examples and retain map, city and owner provenance', () => {
  const cat = buildCatalog({
    osm: {obtainedAt:OBTAINED,sourceDate:null,objects:[rec('node:11',{n:'Mapped WC',la:50+300*M_LAT,lo:19,t:{wheelchair:'yes','check_date:wheelchair':'2026-09-01'}})]},
    city: {
      v:1,source:{url:'https://www.krakow.pl/fixture',title:'City list',obtainedAt:OBTAINED,sha256:'fixture',publisher:'UMK'},unresolved:[],
      venues:[{id:'office',name:'City office',address:'Fixture 1',lat:50+700*M_LAT,lon:19,adaptations:['WC'],features:[{key:'accessible_toilet',value:'yes',detail:'WC'}],unmapped:[],geocode:{status:'resolved',match:'Fixture 1',osmRef:'node:20'}}],
    },
    partners: [
      DEMO_PARTNER,
      {...DEMO_PARTNER,id:'real-owner',name:'Actual owner declaration',example:false,lat:50+1000*M_LAT,lon:19,website:undefined,obtainedAt:OBTAINED},
    ],
  });
  const toilets = accessibleToiletsOf(cat);
  assert.ok(!toilets.some(t=>t.objectId==='partner-demo-hotel'));
  assert.deepEqual(toilets.map(t=>t.status).sort(),['city','osm','partner']);
  const d = line();
  const g = buildGraph(d);
  for (const toilet of toilets) {
    const option = walkingOptions(g,place(d,'a'),place(d,'b'),free,0).options[0];
    addToilets(option,[toilet],'en');
    const fact = (option.legs[0] as WalkLeg).facts.find(f=>f.kind==='toilet')!;
    assert.equal(fact.status,toilet.status);
    assert.equal(fact.sourceLabel,toilet.sourceLabel);
    assert.equal(fact.obtainedAt,OBTAINED);
    if (toilet.status==='partner') {
      assert.equal(fact.sourceUrl,'','no website is not evidence from OpenStreetMap');
      assert.equal(fact.confirmedAt,null);
      assert.match(fact.sourceLabel!,/właściciela/);
    } else if (toilet.status==='city') {
      assert.equal(fact.sourceUrl,'https://www.krakow.pl/fixture');
    } else {
      assert.equal(fact.sourceUrl,'https://www.openstreetmap.org/node/11');
      assert.equal(fact.confirmedAt,'2026-09-01');
    }
  }
});
