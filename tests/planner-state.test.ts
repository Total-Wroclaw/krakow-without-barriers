import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { decodePlace, departureDay, readDeparture, validDeparture, writeTrip } from '../src/lib/trip-sharing';
import { nearRoute } from '../src/lib/route-proximity';
import { I18nProvider, preferredLocale, useI18n } from '../src/lib/i18n/client';
import type { JourneyOption } from '../src/lib/journey-types';

const from = { id: 'start', lat: 50.061, lon: 19.94, name: 'Rynek, Kraków', source: 'test' };
const to = { ...from, id: 'end', lat: 50.055, name: 'Wawel' };

test('history and shared URLs round-trip a scheduled trip, including names with commas', () => {
  const params = new URLSearchParams('unrelated=keep');
  const when = { mode: 'at' as const, date: '2026-12-31', time: '23:59' };
  writeTrip(params, { from, to, transport: 'taxi', when });
  const restored = new URLSearchParams(params.toString());
  assert.deepEqual(readDeparture(restored), when);
  assert.equal(decodePlace(restored.get('from'))?.name, from.name);
  assert.equal(restored.get('mode'), 'taxi');
  assert.equal(restored.get('unrelated'), 'keep');
  writeTrip(params, { from, to, transport: 'transit', when: { mode: 'now' } });
  assert.equal(params.has('date'), false);
  assert.equal(params.has('time'), false);
  assert.equal(params.has('mode'), false);
  assert.deepEqual(readDeparture(params), { mode: 'now' });
});

test('malformed or partial departure links safely fall back to now', () => {
  for (const [date, time] of [['2026-02-30', '12:00'], ['2026-02-29', '12:00'], ['2026-10-04', '24:00'], ['2026-10-04', '12:60'], ['2026-10-04', ''], ['', '12:00'], ['2026-1-4', '12:00']]) {
    assert.equal(validDeparture(date, time), false);
    assert.deepEqual(readDeparture(new URLSearchParams({ date, time })), { mode: 'now' });
  }
  assert.equal(validDeparture('2028-02-29', '00:00'), true);
});

test('only the actual next day is labelled tomorrow; older/future links retain a calendar date', () => {
  const labels = { today: 'today', tomorrow: 'tomorrow' };
  assert.equal(departureDay('2026-12-31', '2026-12-31', 'en', labels), 'today');
  assert.equal(departureDay('2027-01-01', '2026-12-31', 'en', labels), 'tomorrow');
  assert.match(departureDay('2026-12-30', '2026-12-31', 'en', labels), /30 Dec 2026/);
  assert.match(departureDay('2027-01-02', '2026-12-31', 'en', labels), /2 Jan 2027/);
});

const route = (geometry: [number, number][], type = 'walk') => ({ legs: [{ type, geometry }] } as Pick<JourneyOption, 'legs'>);
test('a report beside the middle of a long segment belongs to the route', () => {
  const option = route([[50.061, 19.93], [50.061, 19.95]]);
  assert.equal(nearRoute({ location: { ...from, lat: 50.0612 } }, option), true);
  assert.equal(nearRoute({ location: { ...from, lat: 50.0615 } }, option), false);
  assert.equal(nearRoute({ location: { ...from, lon: 19.96 } }, option), false);
});

test('report proximity handles empty, single, repeated, and non-walking geometry', () => {
  assert.equal(nearRoute({ location: from }, route([])), false);
  assert.equal(nearRoute({ location: from }, route([[from.lat, from.lon]])), true);
  assert.equal(nearRoute({ location: from }, route([[from.lat, from.lon], [from.lat, from.lon]])), true);
  assert.equal(nearRoute({ location: to }, route([[from.lat, from.lon], [from.lat, from.lon]])), false);
  assert.equal(nearRoute({ location: from }, route([[from.lat, from.lon]], 'ride')), false);
  assert.equal(nearRoute({}, route([[from.lat, from.lon]])), false);
  assert.equal(nearRoute({ location: from }, undefined), false);
});

test('explicit embed locale wins over saved preferences and browser language', () => {
  assert.equal(preferredLocale('de', 'pl', 'en-GB'), 'de');
  assert.equal(preferredLocale('en', 'de', 'pl-PL'), 'en');
  assert.equal(preferredLocale(undefined, 'de', 'pl-PL'), 'de');
  assert.equal(preferredLocale(undefined, 'invalid', 'de-DE'), 'de');
});

test('the embedded planner context is translated in its first server render', () => {
  function Label() { const { t } = useI18n(); return createElement('p', null, t('time.now')); }
  const html = renderToStaticMarkup(createElement(I18nProvider, null,
    createElement(I18nProvider, { initialLocale: 'de', children: createElement(Label) })));
  assert.match(html, /lang="de"/);
  assert.match(html, /Jetzt/);
  assert.doesNotMatch(html, /Teraz/);
});
