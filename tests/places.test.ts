import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { reverseGeocode, searchPlaces } from '../src/lib/places';
import { placeSchema } from '../src/lib/city-types';

test('diacritics and case do not matter', () => {
  for (const q of ['florianska', 'FLORIAŃSKA', 'ul. florianska']) {
    const top = searchPlaces(q)[0];
    assert.equal(top.name, 'Floriańska', q);
    assert.equal(top.kind, 'street');
  }
  assert.ok(searchPlaces('lagiewniki').some(p => p.name.startsWith('Łagiewniki')));
});

test('house numbers match in either order and with letters', () => {
  for (const q of ['floriańska 5', '5 florianska', 'ul. Floriańska 5']) {
    const top = searchPlaces(q)[0];
    assert.equal(top.kind, 'address', q);
    assert.equal(top.name, 'Floriańska 5', q);
    assert.match(top.detail ?? '', /Kraków/);
  }
  assert.equal(searchPlaces('Długa 10a')[0].name, 'Długa 10a');
  assert.ok(searchPlaces('czarnowiejska 50').some(p => p.kind === 'address' && /^Czarnowiejska 50/.test(p.name)));
});

test('named places and proximity ranking', () => {
  assert.ok(searchPlaces('galeria kra').some(p => p.kind === 'poi' && p.name === 'Galeria Krakowska'));
  const near = { lat: 50.0705, lon: 19.9367 };
  const dluga = searchPlaces('dluga', near)[0];
  assert.ok(Math.abs(dluga.lat - near.lat) < 0.01 && Math.abs(dluga.lon - near.lon) < 0.01);
});

const hasStops = existsSync(path.join(process.env.KROK_STORAGE_DIR ?? path.join(process.cwd(), '.runtime'), 'transit.sqlite'));
test('public transport stops are grouped by name', { skip: !hasStops && 'no local GTFS database' }, () => {
  const stops = searchPlaces('rondo mog').filter(p => p.kind === 'stop' && p.name === 'Rondo Mogilskie');
  assert.equal(stops.length, 1);
  assert.match(stops[0].detail ?? '', /^Przystanek · .*tramwaj/);
});

test('reverse geocoding returns the nearest address', () => {
  const place = reverseGeocode({ lat: 50.06323, lon: 19.94036 });
  assert.equal(place?.kind, 'address');
  assert.equal(place?.name, 'Floriańska 25');
  assert.equal(reverseGeocode({ lat: 50.1, lon: 20.2 }), null);
});

test('suggestions fit the place schema and are fast', () => {
  const start = performance.now();
  const queries = ['kr', 'ma', 'szpital', 'os centrum a 1', 'al. mickiewicza', 'plac centralny', 'wawel'];
  for (const q of queries) for (const p of searchPlaces(q, { lat: 50.06, lon: 19.94 }, 8)) placeSchema.parse(p);
  assert.ok((performance.now() - start) / queries.length < 20);
});

test('Kraków first: "rynek" ranks Rynek Główny and Kraków squares above other towns', () => {
  const results = searchPlaces('rynek');
  assert.equal(results[0].name, 'Rynek Główny');
  const firstOutside = results.findIndex(p => /Zabierzów|Liszki|Mogilany/.test(p.detail ?? ''));
  const krakowSquares = results.filter(p => /Stare Miasto|Dębniki|Podgórze|Kleparz/.test(p.detail ?? '')).length;
  assert.ok(firstOutside === -1 || firstOutside >= krakowSquares, results.map(p => `${p.name} | ${p.detail}`).join('\n'));
  // Naming another town turns the preference off.
  assert.match(searchPlaces('rynek zabierzów')[0].detail ?? '', /Zabierzów/);
  assert.match(searchPlaces('długa 10')[0].detail ?? '', /Kraków/);
  assert.match(searchPlaces('dluga 10 wieliczka')[0].detail ?? '', /Wieliczka/);
});

test('districts and quarters are suggested by name', () => {
  const top = searchPlaces('Kazimierz')[0];
  assert.equal(top.name, 'Kazimierz');
  assert.equal(top.detail, 'Część Krakowa');
  assert.ok(Math.abs(top.lat - 50.052) < 0.01 && Math.abs(top.lon - 19.945) < 0.01);
  assert.equal(searchPlaces('nowa huta')[0].name, 'Nowa Huta');
});

test('street-type abbreviations: "os." finds Osiedle …, prefixes are stripped mid-query', () => {
  const estate = searchPlaces('os. centrum a')[0];
  assert.equal(estate.name, 'Osiedle Centrum A');
  assert.match(estate.detail ?? '', /Nowa Huta/);
  assert.equal(searchPlaces('os centrum a 1')[0].name, 'Osiedle Centrum A 1');
  assert.equal(searchPlaces('osiedle centrum a 1')[0].name, 'Osiedle Centrum A 1');
  assert.equal(searchPlaces('dluga ul. 10')[0].name, 'Długa 10');
  assert.equal(searchPlaces('al. mickiewicza')[0].name, 'Aleja Adama Mickiewicza');
  assert.equal(searchPlaces('pl. nowy')[0].name, 'Plac Nowy');
  assert.equal(searchPlaces('kraków, ul. Floriańska 5')[0].name, 'Floriańska 5');
});
