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
