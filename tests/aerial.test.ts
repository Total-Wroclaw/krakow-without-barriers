import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.KROK_STORAGE_DIR = mkdtempSync(path.join(os.tmpdir(), 'krok-aerial-test-'));
const { aerialBbox, AERIAL_WIDTHS, compass, distance, fitWidth, frameCorners, inFrame, project, roundPoint, unproject } = await import('../src/lib/aerial-geo');
const { analysisHash, buildOverlay, cachedAnalysis, cleanSentence, needsStepFree, preferencesForPrompt, preferencesKey, reportsDigest, reportsNear, sanitiseAnalysis, storeAnalysis } = await import('../src/lib/aerial');
const { aerialQuerySchema, autoWidth, overlaySummary, widthSchema } = await import('../src/lib/aerial-types');
const { conditionOf, parseOpenMeteo, weatherBucket } = await import('../src/lib/weather');
const { defaultPreferences } = await import('../src/lib/schemas');
const { wmsUrl } = await import('../src/lib/imagery');
import type { AnalysisKey, OverlayInputs, RawAnalysis } from '../src/lib/aerial';
import type { AerialPin } from '../src/lib/aerial-types';
import type { Report } from '../src/lib/schemas';
import type { Stop } from '../src/lib/city-types';

const place = { lat: 50.06713, lon: 19.94508 };
/** A point `east` / `north` metres away (small offsets). */
const offset = (east: number, north: number) => ({ lat: place.lat + north / 111_320, lon: place.lon + east / (111_320 * Math.cos((place.lat * Math.PI) / 180)) });
const near = (a: number, b: number, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('the place is in the centre of every frame and north is up', () => {
  for (const width of AERIAL_WIDTHS) {
    const bbox = aerialBbox(place, width);
    const c = project(place, bbox);
    near(c.x, 0.5, 1e-9);
    near(c.y, 0.5, 1e-9);
    // 4:3 frame in Mercator units.
    near((bbox[2] - bbox[0]) / (bbox[3] - bbox[1]), 4 / 3, 1e-9);
  }
  const bbox = aerialBbox(place, 130);
  assert.ok(project(offset(0, 20), bbox).y < 0.5);
  assert.ok(project(offset(20, 0), bbox).x > 0.5);
});

test('projection is in ground metres: half the frame width east lands on the right edge', () => {
  const width = 130;
  const bbox = aerialBbox(place, width);
  near(project(offset(width / 2, 0), bbox).x, 1, 0.005);
  near(project(offset(0, -(width * 0.75) / 2), bbox).y, 1, 0.005);
  assert.equal(inFrame(project(offset(width, 0), bbox)), false);
  const [sw, ne] = frameCorners(place, width);
  near(project(sw, bbox).x, 0, 1e-9);
  near(project(ne, bbox).y, 0, 1e-9);
});

test('unproject inverts project (AI positions become coordinates)', () => {
  const bbox = aerialBbox(place, 200);
  const p = offset(-37, 22);
  const back = unproject(project(p, bbox), bbox);
  assert.ok(distance(p, back) < 0.01);
});

test('compass directions and rounding', () => {
  assert.equal(compass(place, offset(0, 50)), 'n');
  assert.equal(compass(place, offset(50, 50)), 'ne');
  assert.equal(compass(place, offset(-50, -2)), 'w');
  assert.equal(compass(place, offset(-30, -30)), 'sw');
  assert.deepEqual(roundPoint({ lat: 50.0671349, lon: 19.9450761 }), { lat: 50.06713, lon: 19.94508 });
});

test('query validation keeps requests inside the Kraków envelope and the zoom steps', () => {
  assert.ok(aerialQuerySchema.safeParse({ lat: '50.06', lon: '19.94' }).success);
  assert.equal(aerialQuerySchema.safeParse({ lat: '52.2', lon: '21' }).success, false);
  assert.equal(aerialQuerySchema.safeParse({ lat: '', lon: '19.94' }).success, false);
  assert.equal(widthSchema.safeParse('200').data, 200);
  assert.equal(widthSchema.safeParse('210').success, false);
  assert.equal(widthSchema.safeParse('5000').success, false);
});

test('WMS URL keeps ":" and "," unencoded (GUGiK rejects them encoded)', () => {
  const url = wmsUrl('https://example.test/WMS', aerialBbox(place, 130), 960, 720);
  assert.match(url, /SRS=EPSG:3857&BBOX=[\d.]+,[\d.]+,[\d.]+,[\d.]+&WIDTH=960&HEIGHT=720/);
  assert.doesNotMatch(url, /%3A|%2C/);
});

const stop = (id: string, name: string, code: string, p: { lat: number; lon: number }): Stop => ({ id, name, code, wheelchair: '', ...p });
const inputs = (): OverlayInputs => ({
  entrances: [
    { id: '1', ...offset(30, 0), tags: { entrance: 'yes', wheelchair: 'no' }, editedAt: null },
    { id: '2', ...offset(10, 0), tags: { entrance: 'main', wheelchair: 'yes', step_count: '0', automatic_door: 'button', 'door:width': '95 cm' }, editedAt: '2025-01-01' },
    { id: '3', ...offset(150, 0), tags: { entrance: 'yes' }, editedAt: null },
  ],
  stops: [
    { ...stop('A:1', 'Dworzec', '100-01', offset(0, 80)), lines: ['124', '304'] },
    { ...stop('T:1', 'Dworzec', '100-01', offset(3, 80)), lines: ['3', '13'] },
    stop('A:2', 'Dworzec', '100-02', offset(0, -60)),
  ],
  parking: [{ id: 'way:9', name: null, ...offset(-90, 0), disabledSpaces: 3, editedAt: null, fee: 'yes', capacity: 40 }],
  toilets: [{ objectId: 'osm-node-5', name: 'WC', ...offset(0, 400), sourceUrl: 'https://osm.test', editedAt: null }],
  markers: [{ kind: 'bench', ...offset(5, 5) }, { kind: 'kerb', ...offset(-5, 5) }, { kind: 'bench', ...offset(500, 0) }],
  lines: [{ id: 'way:7', kind: 'stairs', editedAt: null, points: [[offset(-20, 0).lat, offset(-20, 0).lon], [offset(-20, 10).lat, offset(-20, 10).lon]], handrail: 'yes', steps: 4 }],
});

test('pins are numbered entrances → stops → parking → toilets, nearest first, with facts from tags', () => {
  const o = buildOverlay(place, inputs());
  assert.deepEqual(o.pins.map(p => `${p.n}:${p.kind}`), ['1:entrance', '2:entrance', '3:stop', '4:stop', '5:parking']);
  const [first, second] = o.pins;
  assert.equal(first.wheelchair, 'yes');
  assert.equal(first.steps, 0);
  assert.equal(first.main, true);
  assert.equal(first.automaticDoor, true);
  assert.equal(first.sourceUrl, 'https://www.openstreetmap.org/node/2');
  assert.equal(second.wheelchair, 'no');
  assert.equal(first.compass, 'e');
  // The far entrance (150 m) belongs to another building; the toilet 400 m away is outside the overlay.
  assert.ok(!o.pins.some(p => p.kind === 'toilet'));
  // One platform listed by the bus and tram feeds is a single pin with both modes.
  const platform = o.pins.find(p => p.kind === 'stop' && p.platform === '01')!;
  assert.deepEqual(platform.modes, ['tram', 'bus']);
  assert.deepEqual(platform.lines, ['3', '13', '124', '304']);
  assert.equal(first.doorWidth, 95);
  const parking = o.pins.find(p => p.kind === 'parking')!;
  assert.equal(parking.fee, 'yes');
  assert.equal(parking.capacity, 40);
  assert.equal(o.pins.find(p => p.kind === 'parking')!.disabledSpaces, 3);
  assert.equal(o.markers.length, 2);
});

test('with no stop nearby the nearest one within 500 m is still listed (outside the photo)', () => {
  const o = buildOverlay(place, { ...inputs(), stops: [stop('A:9', 'Daleki', '9-01', offset(0, 350)), stop('A:8', 'Za daleko', '8-01', offset(0, 900))] });
  const stops = o.pins.filter(p => p.kind === 'stop');
  assert.deepEqual(stops.map(s => s.name), ['Daleki']);
  assert.equal(inFrame(project(stops[0], aerialBbox(place, 320))), false);
});

test('summary counts what is in the current frame', () => {
  const overlay = { ...buildOverlay(place, inputs()), osmObtainedAt: null, transitObtainedAt: null };
  const s = overlaySummary(overlay, aerialBbox(place, 130));
  assert.deepEqual(s.stepFree.map(p => p.n), [1]);
  assert.deepEqual(s.notAccessible.map(p => p.n), [2]);
  assert.equal(s.stop?.platform, '02');
  assert.equal(s.stairs, 1);
  assert.equal(s.stairsWithRail, 1);
  assert.equal(s.benches, 1);
  assert.equal(s.kerbs, 1);
});

test('AI sentences: measurements, invented pins, mislabelled pins and raw tags are dropped', () => {
  const kinds = ['entrance', 'entrance', 'stop', 'stop', 'parking'] as const;
  const k = [...kinds];
  assert.equal(cleanSentence('Od przystanku [3] chodnikiem do wejścia [1].', k), 'Od przystanku [3] chodnikiem do wejścia [1].');
  assert.equal(cleanSentence('From stop [4] cross the square to entrances [1] or [2].', k), 'From stop [4] cross the square to entrances [1] or [2].');
  assert.equal(cleanSentence('Od przystanku [1] idź prosto.', k), '');
  assert.equal(cleanSentence('Wejście [9] jest od podwórza.', k), '');
  assert.equal(cleanSentence('Chodnik ma ok. 3 m szerokości.', k), '');
  assert.equal(cleanSentence('Do wejścia prowadzą 4 stopnie.', k), '');
  assert.equal(cleanSentence('Rampa o nachyleniu 8%.', k), '');
  assert.equal(cleanSentence('Wejście [1] ma wheelchair=yes.', k), '');
  assert.equal(cleanSentence('  Szeroki   plac przed [1]. ', k), 'Szeroki plac przed [1].');
});

test('AI sentences: guarantees are dropped', () => {
  const k: ('entrance' | 'stop')[] = ['entrance', 'stop'];
  assert.equal(cleanSentence('Wejście [1] jest w pełni dostępne.', k), '');
  assert.equal(cleanSentence('Dojdziesz tu na pewno bez problemu.', k), '');
  assert.equal(cleanSentence('This entrance is fully accessible.', k), '');
  assert.equal(cleanSentence('Der Eingang ist garantiert stufenlos.', k), '');
  assert.equal(cleanSentence('Wysiądź na przystanku [2] i idź wschodnim chodnikiem.', k), 'Wysiądź na przystanku [2] i idź wschodnim chodnikiem.');
});

const raw = (over: Partial<RawAnalysis['recommendation']> = {}, rest: Partial<RawAnalysis> = {}): RawAnalysis => ({
  recommendation: { entrance: 1, approachFrom: 3, why: 'Jedyne wejście oznaczone w mapach jako bez stopni.', steps: ['Wysiądź na przystanku [3].', 'Idź chodnikiem do wejścia [1].'], avoid: [], ask: [], ...over },
  today: [],
  observations: [],
  ...rest,
});
const pinsOf = (...list: [AerialPin['kind'], AerialPin['wheelchair']?][]) => list.map(([kind, wheelchair]) => ({ kind, wheelchair }));

test('recommendation: entrance and arrival pins must exist and have the right kind', () => {
  const bbox = aerialBbox(place, 200);
  const pins = pinsOf(['entrance', 'yes'], ['entrance', 'no'], ['stop'], ['parking']);
  const ok = sanitiseAnalysis(raw(), bbox, pins).recommendation!;
  assert.equal(ok.entrance, 1);
  assert.equal(ok.approachFrom, 3);
  assert.equal(ok.why, 'Jedyne wejście oznaczone w mapach jako bez stopni.');
  assert.equal(ok.steps.length, 2);
  // A stop given as the entrance, an entrance given as the arrival point, a pin that doesn't exist.
  const wrong = sanitiseAnalysis(raw({ entrance: 3, approachFrom: 1 }), bbox, pins).recommendation!;
  assert.equal(wrong.entrance, null);
  assert.equal(wrong.approachFrom, null);
  assert.equal(wrong.why, '', 'no entrance, no reason');
  assert.equal(sanitiseAnalysis(raw({ entrance: 9, approachFrom: 4 }), bbox, pins).recommendation!.entrance, null);
  assert.equal(sanitiseAnalysis(raw({ entrance: 9, approachFrom: 4 }), bbox, pins).recommendation!.approachFrom, 4);
  // Nothing grounded left: no recommendation at all.
  assert.equal(sanitiseAnalysis(raw({ entrance: null, steps: ['Idź 50 m prosto.'] }), bbox, pins).recommendation, null);
});

test('recommendation: an entrance tagged inaccessible is never suggested for step-free needs', () => {
  const bbox = aerialBbox(place, 200);
  const pins = pinsOf(['entrance', 'yes'], ['entrance', 'no'], ['stop']);
  const input = raw({ entrance: 2, steps: ['Wysiądź na przystanku [3].', 'Wejdź wejściem [2] od ulicy.'], avoid: ['schody od rynku', 'wejście [1] od podwórza'] });
  const forWheelchair = sanitiseAnalysis(input, bbox, pins, { stepFree: true }).recommendation!;
  assert.equal(forWheelchair.entrance, null);
  assert.deepEqual(forWheelchair.steps, ['Wysiądź na przystanku [3].']);
  assert.deepEqual(forWheelchair.avoid, ['schody od rynku', 'wejście [1] od podwórza']);
  // Walking: the same entrance may be suggested.
  assert.equal(sanitiseAnalysis(input, bbox, pins).recommendation!.entrance, 2);
  assert.equal(needsStepFree({ ...defaultPreferences, mobility: 'wheelchair' }), true);
  assert.equal(needsStepFree({ ...defaultPreferences, mobility: 'stroller' }), true);
  assert.equal(needsStepFree({ ...defaultPreferences, mobility: 'crutches' }), false);
  assert.equal(needsStepFree(null), false);
});

test('recommendation: steps, avoid and ask are cleaned, deduplicated and capped', () => {
  const bbox = aerialBbox(place, 200);
  const pins = pinsOf(['entrance', 'yes'], ['entrance', 'unknown'], ['stop']);
  const r = sanitiseAnalysis(
    raw({
      steps: ['Wysiądź na przystanku [3].', 'Wysiądź na przystanku [3].', 'Przejdź 20 m chodnikiem.', 'Przejdź przez jezdnię na przejściu.', 'Idź do wejścia [1] od dziedzińca.', 'Wejdź wejściem [1].', 'Zadzwoń dzwonkiem przy drzwiach.'],
      avoid: ['bruk', 'torowisko poza przejściem', 'schody (4 stopnie)', 'wejście [2]', 'schody od rynku'],
      ask: ['Zapytaj o dzwonek przy wejściu [1].', 'Zapytaj, czy przejście jest w pełni dostępne.', 'Sprawdź próg przy drzwiach.'],
    }),
    bbox,
    pins,
  ).recommendation!;
  assert.deepEqual(r.steps, ['Wysiądź na przystanku [3].', 'Przejdź przez jezdnię na przejściu.', 'Idź do wejścia [1] od dziedzińca.', 'Wejdź wejściem [1].']);
  assert.deepEqual(r.avoid, ['bruk', 'torowisko poza przejściem', 'wejście [2]']);
  assert.deepEqual(r.ask, ['Zapytaj o dzwonek przy wejściu [1].', 'Sprawdź próg przy drzwiach.']);
});

test('AI observations: inside the frame, known kinds, no duplicates, mapped back to coordinates', () => {
  const bbox = aerialBbox(place, 200);
  const result = sanitiseAnalysis(
    raw(
      {},
      {
        observations: [
          { x: 0.5, y: 0.25, kind: 'crossing', label: 'przejście przez jezdnię' },
          { x: 0.501, y: 0.251, kind: 'crossing', label: 'to samo przejście' },
          { x: 1.4, y: 0.5, kind: 'square', label: 'poza kadrem' },
          { x: 0.2, y: 0.8, kind: 'elevator', label: 'winda' },
          { x: 0.3, y: 0.3, kind: 'steps', label: 'schody 12 stopni' },
          { x: 0.7, y: 0.6, kind: 'tracks', label: 'torowisko' },
        ],
        today: ['Po deszczu bruk przy przystanku [3] bywa śliski.', 'Dziś jest 2 °C.'],
      },
    ),
    bbox,
    pinsOf(['entrance'], ['entrance'], ['stop']),
  );
  assert.deepEqual(result.observations.map(o => `${o.id}:${o.kind}`), ['A:crossing', 'B:tracks']);
  const a = result.observations[0];
  const pos = project(a, bbox);
  near(pos.x, 0.5, 0.001);
  near(pos.y, 0.25, 0.001);
  assert.deepEqual(result.today, ['Po deszczu bruk przy przystanku [3] bywa śliski.']);
});

const keyFor = (over: Partial<AnalysisKey> = {}): AnalysisKey => ({ ...place, widthM: 130, name: 'Test', locale: 'pl', objectId: null, preferences: 'none', weather: 'none', reports: 'none', ...over });

test('analysis cache round-trips per place, frame, language, needs, weather and reports', async () => {
  const key = keyFor();
  assert.equal(await cachedAnalysis(key), null);
  const analysis = { recommendation: { entrance: 1, approachFrom: 3, why: '', steps: ['Od przystanku [3] prosto.'], avoid: [], ask: [] }, today: [], observations: [], widthM: 130, basedOn: { mobility: null, weather: null, reports: 0 }, createdAt: '2026-10-03T00:00:00.000Z' };
  await storeAnalysis(key, analysis);
  assert.deepEqual(await cachedAnalysis(key), analysis);
  for (const over of [{ locale: 'en' }, { widthM: 200 }, { preferences: 'wheelchair.1.0.0.1.1.0.12' }, { weather: 'rain:mild:calm' }, { reports: 'abc' }]) {
    assert.equal(await cachedAnalysis(keyFor(over)), null, JSON.stringify(over));
    assert.notEqual(analysisHash(keyFor(over)), analysisHash(key));
  }
});

test('auto frame fits entrances, the nearest stop, parking and toilet within reason', () => {
  assert.equal(fitWidth(place, []), 80);
  // A stop 60 m south needs (60 + margin) × 2 × 4/3 ≈ 208 m of width.
  assert.equal(fitWidth(place, [offset(0, -60)]), 250);
  assert.equal(fitWidth(place, [offset(45, 0)]), 130);
  assert.equal(fitWidth(place, [offset(2000, 0)]), 400);
  const overlay = { ...buildOverlay(place, inputs()), osmObtainedAt: null, transitObtainedAt: null };
  const w = autoWidth(overlay);
  // The way in is framed: the two nearest entrances and the nearest stop and parking within a short walk.
  // The auto frame opens close-up (at most 200 m); further pins are reached by panning and listed in text.
  const bbox = aerialBbox(place, w);
  const near = (kind: string, max: number, count = 1) => overlay.pins.filter(p => p.kind === kind && p.distance <= max).sort((a, b) => a.distance - b.distance).slice(0, count);
  for (const pin of [...near('entrance', 100, 2), ...near('stop', 120), ...near('parking', 100)]) assert.ok(inFrame(project(pin, bbox), 0), `pin ${pin.n} outside ${w} m frame`);
  assert.ok(w <= 200);
});

test('weather: WMO codes map to walking conditions; buckets are coarse; bad payloads are ignored', () => {
  assert.equal(conditionOf(0, 15), 'clear');
  assert.equal(conditionOf(3, 15), 'cloudy');
  assert.equal(conditionOf(61, 8), 'rain');
  assert.equal(conditionOf(61, -1), 'ice');
  assert.equal(conditionOf(66, 2), 'ice');
  assert.equal(conditionOf(73, -3), 'snow');
  assert.equal(conditionOf(95, 20), 'storm');
  const w = parseOpenMeteo({ current: { time: '2026-10-03T21:00', temperature_2m: 15.4, precipitation: 0, weather_code: 1, wind_speed_10m: 4 } }, '2026-10-03T19:00:00Z')!;
  assert.deepEqual(w, { temperature: 15, precipitation: 0, wind: 4, condition: 'clear', time: '2026-10-03T21:00', obtainedAt: '2026-10-03T19:00:00Z' });
  assert.equal(weatherBucket(w), 'clear:mild:calm');
  assert.equal(weatherBucket({ ...w, temperature: 16 }), weatherBucket(w));
  assert.equal(weatherBucket({ ...w, temperature: -2, condition: 'ice' }), 'ice:freezing:calm');
  assert.equal(weatherBucket(null), 'none');
  assert.equal(parseOpenMeteo({ error: true }), null);
  assert.equal(parseOpenMeteo({ current: { temperature_2m: 'x', weather_code: 1 } }), null);
});

const report = (id: string, p: { lat: number; lon: number }, extra: Partial<Report> = {}): Report => ({
  id, locationId: `point:${p.lat}:${p.lon}`, location: { id: 'x', name: 'x', source: 'map', ...p }, photoPath: null, obtainedAt: `2026-09-${id.padStart(2, '0')}T10:00:00.000Z`,
  confirmedAt: null, status: 'unverified', source: 'user',
  observation: { kind: 'stairs', description: 'Schody bez poręczy, kontakt jan@example.com, tel. +48 600 100 200', direction: 'unknown', handrail: 'no', surface: 'unknown', uncertainty: '' },
  ...extra,
});

test('reports near the place: within the radius, newest first, without e-mails or phone numbers', () => {
  const list = [report('1', offset(20, 0)), report('2', offset(0, 400)), report('3', offset(-50, 30), { type: 'blocked', comment: 'Winda nie działała', cityStatus: 'in_review' })];
  const near = reportsNear(place, list);
  assert.deepEqual(near.map(r => r.date), ['2026-09-03', '2026-09-01']);
  assert.equal(near[0].type, 'blocked');
  assert.equal(near[0].cityStatus, 'in_review');
  assert.match(near[0].text, /Winda nie działała/);
  for (const r of near) assert.doesNotMatch(r.text, /jan@example\.com|600 100 200/);
  assert.notEqual(reportsDigest(list, place), reportsDigest(list.slice(1), place));
  assert.equal(reportsDigest([report('2', offset(0, 400))], place), 'none');
});

test('needs: only advice-relevant preference fields go into the cache key; prompt describes mobility', () => {
  assert.equal(preferencesKey(null), 'none');
  assert.equal(preferencesKey(defaultPreferences), preferencesKey({ ...defaultPreferences, showToilets: true }));
  assert.notEqual(preferencesKey(defaultPreferences), preferencesKey({ ...defaultPreferences, mobility: 'wheelchair' }));
  assert.match(preferencesForPrompt({ ...defaultPreferences, mobility: 'wheelchair' }), /na wózku/);
  assert.match(preferencesForPrompt({ ...defaultPreferences, mobility: 'crutches', avoidStairs: false, avoidDown: true }), /o kulach.*w dół/);
  assert.equal(preferencesForPrompt(null), 'nie podano');
});
