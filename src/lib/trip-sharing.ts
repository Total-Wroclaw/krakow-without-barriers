import type { CityPlace } from './city-types';
import type { TransportMode } from './journey-types';
import { formatDate } from './format';
import type { Locale } from './i18n/locales';

export type When = { mode: 'now' } | { mode: 'at'; date: string; time: string };

export function validDeparture(date: string, time: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Only today and the actual next calendar day get relative labels, including across midnight. */
export function departureDay(date: string, today: string, locale: Locale, labels: { today: string; tomorrow: string }) {
  if (date === today) return labels.today;
  if (date === addDays(today, 1)) return labels.tomorrow;
  return formatDate(`${date}T12:00:00Z`, locale);
}

export function readDeparture(params: URLSearchParams): When {
  const date = params.get('date') ?? '';
  const time = params.get('time') ?? '';
  return validDeparture(date, time) ? { mode: 'at', date, time } : { mode: 'now' };
}

const encodePlace = (p: CityPlace) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)},${p.name}`;
export function decodePlace(value: string | null): CityPlace | null {
  if (!value) return null;
  const [lat, lon, ...name] = value.split(',');
  const place = { id: `point:${lat}:${lon}`, name: name.join(',') || '—', lat: Number(lat), lon: Number(lon), source: 'link' };
  return Number.isFinite(place.lat) && Number.isFinite(place.lon) && place.lat > 49.94 && place.lat < 50.2 && place.lon > 19.75 && place.lon < 20.25 ? place : null;
}

/** Shared by history persistence and Share, so both restore exactly the same departure. */
export function writeTrip(params: URLSearchParams, trip: { from: CityPlace | null; to: CityPlace | null; transport: TransportMode; when: When }) {
  for (const key of ['from', 'to', 'mode', 'date', 'time']) params.delete(key);
  if (trip.from) params.set('from', encodePlace(trip.from));
  if (trip.to) params.set('to', encodePlace(trip.to));
  if (trip.transport !== 'transit') params.set('mode', trip.transport);
  if (trip.when.mode === 'at' && validDeparture(trip.when.date, trip.when.time)) {
    params.set('date', trip.when.date);
    params.set('time', trip.when.time);
  }
}
