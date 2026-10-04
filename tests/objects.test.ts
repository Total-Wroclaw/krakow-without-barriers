import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.KROK_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'krok-objects-test-'));
const { parseUmkHtml, mapAdaptation, addressQuery } = await import('../src/lib/city-venues');
const objects = await import('../src/lib/objects');
const { buildCatalog, queryCatalog, getFromCatalog, osmObjectFeatures, osmEntranceFeatures, DEMO_PARTNER, DEMO_PARTNER_OBJECT_ID } = objects;
import type { CityVenuesFile } from '../src/lib/city-venues';
import type { OsmRecord, PartnerRecord } from '../src/lib/objects';
import type { Report } from '../src/lib/schemas';

const html = readFileSync(path.join(import.meta.dirname, 'fixtures/umk-dostepnosc-2848.html'), 'utf8');
const venues = parseUmkHtml(html);
const byName = (name: string) => venues.find(v => v.name === name)!;
const keys = (fs: { key: string; value: string }[]) => fs.map(f => `${f.key}=${f.value}`).sort();

test('UMK page parses into 20 venues with original phrases, addresses and entity-decoded names', () => {
  assert.equal(venues.length, 20);
  assert.equal(venues[0].name, 'Budynek Magistratu');
  assert.equal(venues[0].address, 'Plac Wszystkich Świętych 3-4');
  assert.ok(byName('Wydział Kultury i Dziedzictwa Narodowego'), '&nbsp; in the heading is decoded');
  assert.deepEqual(venues.flatMap(v => v.unmapped), [], 'every phrase on the page maps to at least one fact');
  assert.ok(venues.every(v => v.adaptations.length && v.features.every(f => v.adaptations.includes(f.detail))), 'original phrase kept as detail');
  assert.equal(addressQuery('Ulica Wielicka 28 a'), 'Wielicka 28a');
});

test('UMK phrases map conservatively to concrete facts', () => {
  assert.deepEqual(keys(byName('Wydział Kultury i Dziedzictwa Narodowego').features), ['difficult_building=yes', 'stair_lift=yes']);
  assert.deepEqual(keys(byName('Zarząd Infrastruktury Sportowej').features), ['accessible_toilet=yes', 'lift=no', 'step_free_entrance=yes']);
  assert.equal(byName('Zarząd Infrastruktury Sportowej').features.find(f => f.key === 'lift')!.detail, 'brak możliwości wjazdu na wyższe piętra');
  // Inline "dostosowania: budynek niedostosowany" (no list).
  assert.deepEqual(byName('Grodzki Urząd Pracy').adaptations, ['budynek niedostosowany']);
  assert.deepEqual(keys(byName('Grodzki Urząd Pracy').features), ['difficult_building=yes', 'step_free_entrance=no']);
  assert.deepEqual(keys(byName('Wydział Architektury i Urbanistyki').features), ['accessible_toilet=yes', 'lift=yes', 'ramp=yes', 'sign_language=yes', 'staff_assistance=yes']);
  assert.deepEqual(keys(mapAdaptation('schodołaz')), ['stair_lift=yes']);
  assert.deepEqual(mapAdaptation('fontanna na dziedzińcu'), [], 'unknown phrases are not guessed');
  assert.throws(() => parseUmkHtml('<html><body>Strona chwilowo niedostępna</body></html>'), /Unrecognised/);
});

test('OSM tags become facts only when explicitly tagged', () => {
  assert.deepEqual(osmObjectFeatures({ name: 'X', website: 'https://x' }, 'museum', 's'), []);
  assert.deepEqual(osmObjectFeatures({ wheelchair: 'maybe' }, 'museum', 's'), []);
  const f = osmObjectFeatures({ wheelchair: 'limited', 'wheelchair:description': 'Wejście od podwórza', 'toilets:wheelchair': 'yes', 'door:width': '0.8', automatic_door: 'button', step_count: '3' }, 'museum', 's');
  assert.deepEqual(keys(f), ['accessible_toilet=yes', 'automatic_door=yes', 'door_width=limited', 'entrance_steps=yes', 'step_free_entrance=limited']);
  assert.equal(f.find(x => x.key === 'step_free_entrance')!.detail, 'Wejście od podwórza');
  assert.equal(f.find(x => x.key === 'entrance_steps')!.detail, '3 stopnie');
  assert.equal(f.find(x => x.key === 'door_width')!.detail, '80 cm');
  // On a toilet, wheelchair=* describes the toilet itself.
  assert.deepEqual(keys(osmObjectFeatures({ wheelchair: 'no' }, 'toilet', 's')), ['accessible_toilet=no']);
  const e = osmEntranceFeatures({ id: 'node:1', d: 12.4, ts: null, t: { entrance: 'main', step_count: '0', width: '95 cm' } }, 'osm:node:1');
  assert.deepEqual(keys(e), ['door_width=yes', 'entrance_steps=no']);
  assert.match(e[0].detail!, /wejście główne, ok\. 12 m od punktu obiektu/);
});

const OBTAINED = '2026-10-03T00:00:00Z';
const osmRec = (id: string, extra: Partial<OsmRecord>): OsmRecord => ({ id, c: 'museum', k: 'tourism=museum', n: 'Obiekt', la: 50.06, lo: 19.94, ts: '2025-01-01T00:00:00Z', t: {}, e: [], ...extra });
const city = (list: CityVenuesFile['venues']): CityVenuesFile => ({ v: 1, source: { url: 'https://www.krakow.pl/getHtml?dok_id=2848', title: 't', obtainedAt: OBTAINED, sha256: 'x', publisher: 'UMK' }, venues: list, unresolved: [] });
const venue = (id: string, name: string, lat: number, lon: number, phrases: string[], address = 'Ulica Testowa 1') => ({ id, name, address, adaptations: phrases, features: phrases.flatMap(mapAdaptation), unmapped: [], lat, lon, geocode: { status: 'resolved' as const, match: '', osmRef: '' } });

test('city venue merges into a nearby OSM object with a similar name; conflicts are reported, not resolved', () => {
  const cat = buildCatalog({
    osm: { obtainedAt: OBTAINED, sourceDate: null, objects: [
      osmRec('way:1', { c: 'office', k: 'office=government', n: 'Urząd Miasta Krakowa - Wydział Geodezji', t: { wheelchair: 'no', check_date: '2025-05-01' } }),
      osmRec('node:2', { n: 'Muzeum Inne', la: 50.0603, lo: 19.94 }),
    ] },
    city: city([
      venue('wydzial-geodezji', 'Wydział Geodezji', 50.0602, 19.9401, ['wejście do budynku dostosowane do potrzeb osób niepełnosprawnych poruszających się na wózkach', 'winda']),
      venue('zarzad-x', 'Zarząd Zupełnie Inny', 50.0601, 19.94, ['podjazd'], 'Ulica Inna 5'),
    ]),
  });
  const merged = getFromCatalog(cat, 'osm-way-1')!;
  assert.deepEqual(merged.sources.map(s => [s.kind, s.status]), [['osm', 'map'], ['city', 'city']]);
  assert.equal(merged.sources[0].confirmedAt, '2025-05-01', 'check_date is the only confirmation date');
  assert.equal(merged.sources[0].editedAt, '2025-01-01T00:00:00Z');
  assert.equal(merged.sources[0].url, 'https://www.openstreetmap.org/way/1');
  assert.deepEqual(merged.conflicts, ['step_free_entrance']);
  assert.equal(merged.hasConflict, true);
  assert.equal(merged.wheelchair, 'yes', 'city source ranks first for the summary value; the conflict flag stays');
  assert.equal(merged.features.filter(f => f.key === 'step_free_entrance').length, 2, 'both claims are kept');
  assert.ok(getFromCatalog(cat, 'city-zarzad-x'), 'dissimilar name stays a separate object');
  assert.equal(queryCatalog(cat, { q: 'zarzad' }).length, 1);
});

test('differing entrances of one building are details, not conflicts', () => {
  const cat = buildCatalog({ osm: { obtainedAt: OBTAINED, sourceDate: null, objects: [osmRec('way:5', { t: { wheelchair: 'yes' }, e: [
    { id: 'node:51', d: 0, ts: null, t: { entrance: 'main', wheelchair: 'no', step_count: '4' } },
    { id: 'node:52', d: 0, ts: null, t: { entrance: 'service', wheelchair: 'yes' } },
    { id: 'node:53', d: 0, ts: null, t: { entrance: 'yes' } },
  ] })] } });
  const o = getFromCatalog(cat, 'osm-way-5')!;
  assert.equal(o.hasConflict, false);
  assert.equal(o.wheelchair, 'yes', 'object tag beats entrance tags');
  assert.deepEqual(o.sources.map(s => s.id), ['osm:way:5', 'osm:node:51', 'osm:node:52'], 'entrances without facts are not listed as sources');
  assert.ok(o.features.some(f => f.key === 'entrance_steps' && f.detail?.includes('4 stopnie')));
});

test('missing data stays missing (never shown as accessible)', () => {
  const cat = buildCatalog({ osm: { obtainedAt: OBTAINED, sourceDate: null, objects: [osmRec('node:9', { c: 'toilet', k: 'amenity=toilets', n: null })] } });
  const o = getFromCatalog(cat, 'osm-node-9', 'en')!;
  assert.equal(o.name, 'Public toilet');
  assert.equal(o.categoryLabel, 'Toilet');
  assert.equal(o.wheelchair, 'unknown');
  assert.equal(o.knownCount, 0);
  assert.deepEqual(o.features, []);
  assert.deepEqual(o.highlights, []);
  assert.equal(o.hasConflict, false);
});

const partner = (id: string, extra: Partial<PartnerRecord>): PartnerRecord => ({ id, name: `Partner ${id}`, category: 'museum', lat: 50.07, lon: 19.95, contactEmail: `owner-${id}@example.com`, features: [{ key: 'lift', value: 'yes', detail: 'winda' }], promote: true, plan: 'partner', obtainedAt: OBTAINED, ...extra });

test('promoted partners float to the top of the matched set, flagged; free plan and far-away promotions are not lifted', () => {
  const osm = { obtainedAt: OBTAINED, sourceDate: null, objects: [osmRec('node:1', { n: 'Muzeum Bliskie', la: 50.0601, lo: 19.9401, t: { wheelchair: 'yes' } })] };
  const cat = buildCatalog({ osm, partners: [partner('a', { name: 'Muzeum Partnerskie' }), partner('b', { name: 'Muzeum Darmowe', plan: 'free' }), partner('far', { name: 'Muzeum Daleko', lat: 50.19, lon: 20.2 }), partner('h', { name: 'Hotel Partner', category: 'hotel' })] });
  const list = queryCatalog(cat, { category: 'museum', lat: 50.06, lon: 19.94 });
  assert.equal(list[0].name, 'Muzeum Partnerskie');
  assert.equal(list[0].partner?.promoted, true);
  assert.equal(list[0].partner?.example, false);
  assert.equal(list[1].name, 'Muzeum Bliskie', 'then by distance');
  assert.equal(list.find(o => o.name === 'Muzeum Darmowe')?.partner?.promoted, false);
  assert.equal(list.at(-1)!.name, 'Muzeum Daleko', 'promotion is local when the user point is known');
  assert.ok(!queryCatalog(cat, { q: 'zamek' }).length, 'promotion never adds unmatched objects');
  assert.ok(!queryCatalog(cat, { category: 'museum' }).some(o => o.name === 'Hotel Partner'));
  assert.ok(!JSON.stringify(cat.recs.map(r => getFromCatalog(cat, r.id))).includes('@example.com'), 'contact e-mail never public');
  const p = getFromCatalog(cat, 'partner-a')!;
  assert.deepEqual(p.sources.map(s => [s.kind, s.status, s.confirmedAt]), [['partner', 'partner', null]]);
});

test('user reports near an object are unverified sources, not facts', () => {
  const osm = { obtainedAt: OBTAINED, sourceDate: null, objects: [osmRec('way:7', { n: 'Teatr', c: 'culture', k: 'amenity=theatre' })] };
  const observation = { kind: 'stairs' as const, description: 'Trzy stopnie przy wejściu', direction: 'unknown' as const, handrail: 'no' as const, surface: 'unknown' as const, uncertainty: '' };
  const report = (id: string, extra: Partial<Report>): Report => ({ id, observation, locationId: 'point:0:0', photoPath: null, obtainedAt: OBTAINED, confirmedAt: null, status: 'unverified', source: 'user', ...extra });
  const cat = buildCatalog({ osm, reports: [
    report('r1', { locationId: 'way:7' }),
    report('r2', { location: { id: 'p', name: 'p', source: 's', lat: 50.06015, lon: 19.94 } }),
    report('r3', { location: { id: 'p', name: 'p', source: 's', lat: 50.07, lon: 19.94 } }),
  ] });
  const o = getFromCatalog(cat, 'osm-way-7', 'pl')!;
  assert.deepEqual(o.sources.filter(s => s.kind === 'user').map(s => [s.id, s.status, s.note]), [['user:r1', 'unverified', 'Trzy stopnie przy wejściu'], ['user:r2', 'unverified', 'Trzy stopnie przy wejściu']]);
  assert.match(o.sources[1].label, /niezweryfikowane.*schody/);
  assert.deepEqual(o.features, []);
});

test('partner submissions are validated, stored and returned without the contact e-mail', async () => {
  const valid = { name: 'Kawiarnia Testowa', category: 'food', lat: 50.06, lon: 19.94, contactEmail: 'secret-owner@example.com', features: [{ key: 'step_free_entrance', value: 'yes', detail: 'próg 1 cm' }], promote: true, plan: 'partner', description: 'Opis' };
  for (const bad of [
    { ...valid, lat: 52.2 },
    { ...valid, contactEmail: 'not-an-email' },
    { ...valid, contactEmail: undefined },
    { ...valid, features: [{ key: 'teleporter', value: 'yes' }] },
    { ...valid, features: [{ key: 'lift', value: 'yes' }, { key: 'lift', value: 'no' }] },
    { ...valid, description: 'x'.repeat(601) },
    { ...valid, website: 'javascript:alert(1)' },
    { ...valid, plan: 'gold' },
    { ...valid, admin: true },
  ]) await assert.rejects(() => objects.savePartnerObject(bad), String(JSON.stringify(bad)).slice(0, 80));
  await assert.rejects(() => objects.savePartnerObject({ ...valid, existingObjectId: 'osm-node-0' }), objects.PartnerInputError);
  const saved = await objects.savePartnerObject(valid);
  assert.ok(saved.id.startsWith('partner-'));
  assert.equal(saved.partner?.promoted, true);
  assert.equal(saved.sources[0].status, 'partner');
  assert.ok(!JSON.stringify(saved).includes('secret-owner'));
  const listed = await objects.listObjects({ q: 'kawiarnia testowa' });
  assert.equal(listed[0].id, saved.id);
  assert.ok(!JSON.stringify(await objects.getObject(saved.id)).includes('secret-owner'));
  // Attach owner data to an existing object.
  const attached = await objects.savePartnerObject({ ...valid, name: 'Muzeum Narodowe', category: 'museum', existingObjectId: saved.id, features: [{ key: 'lift', value: 'yes' }], promote: false, plan: 'free' });
  assert.equal(attached.id, saved.id);
  assert.equal(attached.sources.filter(s => s.kind === 'partner').length, 2);
});

test('the demo partner is clearly labelled example data and promoted', async () => {
  assert.match(DEMO_PARTNER.name, /dane demonstracyjne/);
  const demo = (await objects.getObject(DEMO_PARTNER_OBJECT_ID, 'en'))!;
  assert.equal(demo.partner?.example, true);
  assert.equal(demo.partner?.promoted, true);
  assert.deepEqual(demo.sources.map(s => s.status), ['example']);
  assert.match(demo.sources[0].label, /Demo data/);
  assert.ok(!JSON.stringify(demo).includes('demo@example.invalid'));
  const hotels = await objects.listObjects({ category: 'hotel', lat: 50.0614, lon: 19.9366, limit: 3 });
  assert.equal(hotels[0].id, DEMO_PARTNER_OBJECT_ID);
});

test.after(async () => { (await import('../src/lib/server')).db().close(); rmSync(process.env.KROK_STORAGE_DIR!, { recursive: true, force: true }); });

test('without a query, objects with more known facts rank before nearer "no data" ones; withData filters them out', () => {
  const osm = { obtainedAt: OBTAINED, sourceDate: null, objects: [
    osmRec('node:1', { n: 'Muzeum Puste', la: 50.06, lo: 19.94 }),
    osmRec('node:2', { n: 'Muzeum Opisane', la: 50.07, lo: 19.95, t: { wheelchair: 'yes', 'toilets:wheelchair': 'yes' } }),
    osmRec('node:3', { n: 'Muzeum Jeden Fakt', la: 50.065, lo: 19.945, t: { wheelchair: 'no' } }),
  ] };
  const cat = buildCatalog({ osm });
  const near = { lat: 50.06, lon: 19.94 };
  assert.deepEqual(queryCatalog(cat, { category: 'museum', ...near }).map(o => o.name), ['Muzeum Opisane', 'Muzeum Jeden Fakt', 'Muzeum Puste']);
  const filtered = queryCatalog(cat, { category: 'museum', ...near, withData: true });
  assert.deepEqual(filtered.map(o => o.name), ['Muzeum Opisane', 'Muzeum Jeden Fakt']);
  assert.ok(filtered.every(o => typeof o.distance === 'number'));
  // With a text query relevance and distance lead.
  assert.equal(queryCatalog(cat, { q: 'muzeum', ...near })[0].name, 'Muzeum Puste');
});

test('a map area (bbox) limits the list to visible objects, pages stay inside it and the rest is counted as "outside"', () => {
  const osm = { obtainedAt: OBTAINED, sourceDate: null, objects: [
    osmRec('node:1', { n: 'Muzeum Rynek', la: 50.0617, lo: 19.9373, t: { wheelchair: 'yes' } }),
    osmRec('node:2', { n: 'Muzeum Kazimierz', la: 50.0513, lo: 19.9449, t: { wheelchair: 'no' } }),
    osmRec('node:3', { n: 'Muzeum Nowa Huta', la: 50.0717, lo: 20.0371, t: { wheelchair: 'limited' } }),
    osmRec('node:4', { n: 'Hotel Rynek', c: 'hotel', k: 'tourism=hotel', la: 50.0615, lo: 19.938, t: { wheelchair: 'yes' } }),
  ] };
  const cat = buildCatalog({ osm });
  const centre: [number, number, number, number] = [19.9, 50.04, 19.98, 50.08];
  const page = objects.queryCatalogPage(cat, { category: 'museum', bbox: centre, lat: 50.06, lon: 19.94 });
  assert.deepEqual(page.objects.map(o => o.name).sort(), ['Muzeum Kazimierz', 'Muzeum Rynek']);
  assert.equal(page.total, 2);
  assert.equal(page.outside, 1, 'Nowa Huta matches the search but lies outside the area');
  // Zooming out widens the area; zooming in narrows it.
  assert.equal(objects.queryCatalogPage(cat, { category: 'museum', bbox: [19.8, 50.0, 20.1, 50.1] }).total, 3);
  assert.deepEqual(objects.queryCatalogPage(cat, { category: 'museum', bbox: [19.935, 50.06, 19.94, 50.063] }).objects.map(o => o.name), ['Muzeum Rynek']);
  // A text search in an area with no match reports where the matches are.
  const none = objects.queryCatalogPage(cat, { q: 'huta', bbox: centre });
  assert.equal(none.total, 0);
  assert.equal(none.outside, 1);
  assert.equal(objects.queryCatalogPage(cat, { q: 'huta' }).outside, undefined, 'no bbox: no outside count');
  // Paging inside an area never overlaps or leaks outside it.
  const p1 = objects.queryCatalogPage(cat, { bbox: centre, limit: 2 });
  const p2 = objects.queryCatalogPage(cat, { bbox: centre, limit: 2, offset: p1.nextOffset! });
  assert.equal(p1.total, 3);
  assert.equal(p2.nextOffset, null);
  const ids = [...p1.objects, ...p2.objects].map(o => o.id);
  assert.equal(new Set(ids).size, 3);
  assert.ok(!ids.includes('osm-node-3'));
});

test('the bbox parameter accepts "west,south,east,north" and rejects malformed or inverted areas', () => {
  const { bboxParamSchema } = objects;
  assert.deepEqual(bboxParamSchema.parse('19.9,50.04,19.98,50.08'), [19.9, 50.04, 19.98, 50.08]);
  for (const bad of ['19.98,50.04,19.9,50.08', '19.9,50.08,19.98,50.04', '19.9,50.04,19.98', '19.9,50.04,19.98,50.08,1', 'a,b,c,d', '19.9,,19.98,50.08', '200,50,201,51', '19.9,-91,19.98,50.08', ''])
    assert.equal(bboxParamSchema.safeParse(bad).success, false, bad);
});

test('a text search within a map area ranks by relevance, then distance from the map centre; shown distances stay from the user', () => {
  const osm = { obtainedAt: OBTAINED, sourceDate: null, objects: [
    osmRec('node:1', { n: 'Muzeum Rynek', la: 50.0617, lo: 19.9373, t: { wheelchair: 'yes', 'toilets:wheelchair': 'yes', ramp: 'yes' } }),
    osmRec('node:2', { n: 'Muzeum Kazimierz', la: 50.0513, lo: 19.9449, t: { wheelchair: 'limited' } }),
    osmRec('node:3', { n: 'Galeria Muzeum', la: 50.0514, lo: 19.945, t: {} }),
  ] };
  const cat = buildCatalog({ osm });
  const area: [number, number, number, number] = [19.9, 50.04, 19.98, 50.08];
  const kazimierz = { lat: 50.0512, lon: 19.9448 };
  const page = objects.queryCatalogPage(cat, { q: 'muzeum', bbox: area, center: kazimierz, lat: 50.0617, lon: 19.9373 });
  // All match the word; exact name-word matches score the same, so the nearest to the centre leads.
  assert.deepEqual(page.objects.map(o => o.name), ['Muzeum Kazimierz', 'Galeria Muzeum', 'Muzeum Rynek']);
  assert.ok(page.objects[2].distance! < 20, 'distance is measured from lat/lon (the user), not the map centre');
  const { centerParamSchema } = objects;
  assert.deepEqual(centerParamSchema.parse('50.06,19.94'), { lat: 50.06, lon: 19.94 });
  for (const bad of ['50.06', '50.06,19.94,1', '91,19.94', 'x,y', ''])
    assert.equal(centerParamSchema.safeParse(bad).success, false, bad);
});

// A dense cluster in the middle of the area (many places with lots of facts) and single places spread around it.
function clusteredCatalog(partners: PartnerRecord[] = []) {
  const recs: OsmRecord[] = [];
  for (let i = 0; i < 60; i++) recs.push(osmRec(`node:${100 + i}`, { n: `Centrum ${i}`, la: 50.06 + (i % 8) * 0.0001, lo: 19.94 + Math.floor(i / 8) * 0.0001, t: { wheelchair: 'yes', 'toilets:wheelchair': 'yes', ramp: 'yes' } }));
  let id = 500;
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) recs.push(osmRec(`node:${id++}`, { n: `Kraniec ${x}-${y}`, la: 50.02 + y * 0.0133 + 0.003, lo: 19.88 + x * 0.02 + 0.005, t: { wheelchair: 'limited' } }));
  for (let i = 0; i < 10; i++) recs.push(osmRec(`node:${900 + i}`, { n: `Bez danych ${i}`, la: 50.03 + i * 0.005, lo: 19.9 + i * 0.01, t: {} }));
  return buildCatalog({ osm: { obtainedAt: OBTAINED, sourceDate: null, objects: recs }, partners });
}
const AREA: [number, number, number, number] = [19.88, 50.02, 20.0, 50.1];
const cellsOf = (list: { lat: number; lon: number }[], bbox: [number, number, number, number], n = 6) =>
  new Set(list.map(o => `${Math.min(n - 1, Math.floor(((o.lon - bbox[0]) / (bbox[2] - bbox[0])) * n))},${Math.min(n - 1, Math.floor(((o.lat - bbox[1]) / (bbox[3] - bbox[1])) * n))}`)).size;

test('browsing a map area spreads the first page over the whole area instead of the densest spot', () => {
  const cat = clusteredCatalog();
  const page = objects.queryCatalogPage(cat, { bbox: AREA, limit: 20, center: { lat: 50.06, lon: 19.94 } });
  // Ranked by facts alone the first 20 would all be in the central cluster (1 cell of 36).
  assert.ok(cellsOf(page.objects, AREA) >= 18, `first page covers ${cellsOf(page.objects, AREA)} of 36 cells`);
  assert.ok(page.objects.some(o => o.name.startsWith('Centrum')), 'the dense spot is still represented');
  // The best place of the cluster (most facts) is the one shown for it.
  assert.equal(page.objects.filter(o => o.name.startsWith('Centrum')).length <= 3, true);
  // Places with facts come before places without any, even when those would fill empty cells.
  const all = [...objects.queryCatalogPage(cat, { bbox: AREA, limit: 100 }).objects, ...objects.queryCatalogPage(cat, { bbox: AREA, limit: 100, offset: 100 }).objects];
  assert.equal(all.length, 106);
  assert.equal(all.findIndex(o => o.knownCount === 0), 96);
  // Zoomed in on the cluster, the same rule lists the cluster itself, spread over that smaller area.
  const zoomed: [number, number, number, number] = [19.9398, 50.0598, 19.9409, 50.0609];
  const near = objects.queryCatalogPage(cat, { bbox: zoomed, limit: 20 });
  assert.equal(near.total, 60);
  const possible = cellsOf(objects.queryCatalogPage(cat, { bbox: zoomed, limit: 100 }).objects, zoomed);
  assert.ok(cellsOf(near.objects, zoomed) >= possible * 0.7, `zoomed first page covers ${cellsOf(near.objects, zoomed)} of ${possible} occupied cells`);
});

test('spread paging is stable: every place exactly once, the same order on every request, promoted partners first', () => {
  const promotedPartner: PartnerRecord = { id: 'p1', name: 'Partner w rogu', category: 'hotel', lat: 50.09, lon: 19.99, contactEmail: 'a@b.pl', features: [{ key: 'lift', value: 'yes' }], promote: true, plan: 'partner', obtainedAt: OBTAINED };
  const withPartner = clusteredCatalog([promotedPartner]);
  const ids: string[] = [];
  for (let offset: number | null = 0; offset !== null;) {
    const page = objects.queryCatalogPage(withPartner, { bbox: AREA, limit: 7, offset });
    ids.push(...page.objects.map(o => o.id));
    offset = page.nextOffset;
  }
  assert.equal(ids.length, 107);
  assert.equal(new Set(ids).size, 107, 'no duplicates between pages');
  assert.equal(ids[0], 'partner-p1');
  const again = objects.queryCatalogPage(withPartner, { bbox: AREA, limit: 100 }).objects.map(o => o.id);
  assert.deepEqual(again, ids.slice(0, 100), 'paging gives the same order as one big page');
  // The map centre does not change the browsing order; only the area does.
  const moved = objects.queryCatalogPage(withPartner, { bbox: AREA, limit: 100, center: { lat: 50.03, lon: 19.89 } }).objects.map(o => o.id);
  assert.deepEqual(moved, again);
});

test('spreadOrder: picks one place per tile first, keeps rank order within a pass, keeps every item', () => {
  const { spreadOrder } = objects;
  const items = [
    { id: 'a1', lat: 50.06, lon: 19.94 }, { id: 'a2', lat: 50.0601, lon: 19.9401 }, { id: 'a3', lat: 50.0602, lon: 19.9402 },
    { id: 'b', lat: 50.095, lon: 19.995 }, { id: 'c', lat: 50.025, lon: 19.885 },
  ];
  const order = spreadOrder(items, AREA).map(i => i.id);
  assert.equal(order.length, 5);
  assert.deepEqual(order.slice(0, 3).sort(), ['a1', 'b', 'c'], 'one per area before the second of the cluster');
  assert.ok(order.indexOf('a1') < order.indexOf('a2') && order.indexOf('a1') < order.indexOf('a3'), 'the best of the cluster stands for it');
  assert.deepEqual(spreadOrder(items, AREA), spreadOrder(items, AREA));
  assert.deepEqual(spreadOrder(items.slice(0, 2), AREA), items.slice(0, 2));
});

test('place card facts: one line per feature, conflicts and split entrances stay visible, nothing is filled in', async () => {
  const { groupFacts, groupSources, keyFactKeys } = await import('../src/lib/place-facts');
  // Conflict between whole-place sources (city says step-free, the map says no).
  const conflictCat = buildCatalog({
    osm: { obtainedAt: OBTAINED, sourceDate: null, objects: [osmRec('way:1', { c: 'office', k: 'office=government', n: 'Urząd Miasta Krakowa - Wydział Geodezji', t: { wheelchair: 'no' } })] },
    city: city([venue('wydzial-geodezji', 'Wydział Geodezji', 50.0602, 19.9401, ['wejście do budynku dostosowane do potrzeb osób niepełnosprawnych poruszających się na wózkach', 'winda'])]),
  });
  const merged = getFromCatalog(conflictCat, 'osm-way-1')!;
  const entrance = groupFacts(merged.features, merged.sources).find(g => g.key === 'step_free_entrance')!;
  assert.equal(entrance.conflict, true);
  assert.equal(entrance.value, 'yes', 'the city list ranks first, the conflict flag stays');
  assert.equal(entrance.tone, 'warn');
  assert.deepEqual(entrance.statements.map(s => s.value), ['yes', 'no'], 'both claims are kept');
  // The list's original wording moves to its source instead of a description that repeats the facts.
  assert.equal(merged.description, undefined);
  assert.match(merged.sources.find(s => s.kind === 'city')!.note!, /^Wydział Geodezji: wejście do budynku/);

  // Entrances: the whole-place tag leads; differing entrances mark the fact as mixed, identical details are counted.
  const doors = buildCatalog({ osm: { obtainedAt: OBTAINED, sourceDate: null, objects: [osmRec('way:5', { t: { wheelchair: 'yes' }, e: [
    { id: 'node:51', d: 0, ts: '2024-01-01T00:00:00Z', t: { entrance: 'main', wheelchair: 'no', automatic_door: 'no' } },
    { id: 'node:52', d: 0, ts: '2025-06-01T00:00:00Z', t: { entrance: 'yes', automatic_door: 'no' } },
    { id: 'node:53', d: 0, ts: null, t: { entrance: 'yes', automatic_door: 'no' } },
  ] })] } });
  const o = getFromCatalog(doors, 'osm-way-5')!;
  assert.deepEqual(o.sources.map(s => s.part ?? 'place'), ['place', 'entrance', 'entrance', 'entrance']);
  const groups = groupFacts(o.features, o.sources);
  assert.deepEqual(groups.map(g => g.key), ['step_free_entrance', 'automatic_door'], 'one line per feature');
  const step = groups[0];
  assert.equal(step.value, 'yes');
  assert.equal(step.mixed, true);
  assert.equal(step.byEntrance, false);
  const auto = groups[1];
  assert.equal(auto.byEntrance, true);
  assert.equal(auto.mixed, false);
  assert.equal(auto.tone, 'bad');
  assert.deepEqual(auto.statements[0].details, [{ text: 'wejście główne', count: 1 }, { text: 'wejście', count: 2 }]);
  // Missing key facts are absent, never guessed.
  assert.deepEqual(keyFactKeys.filter(k => !groups.some(g => g.key === k)), ['accessible_toilet', 'lift', 'disabled_parking']);
  // Provenance: map data is one entry (place + entrances, latest edit), not one per entrance.
  const sources = groupSources(o.sources);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].entrances.length, 3);
  assert.equal(sources[0].editedAt, '2025-06-01T00:00:00Z');
});
