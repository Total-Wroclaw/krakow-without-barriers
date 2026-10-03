// Car parks and disabled parking spaces from OSM (data/krakow-parking.json.gz), loaded once per process.
// Counts are as mapped; occupancy, opening hours and fees are not known.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { metres, PointGrid } from './routing';
import { serverMessages } from './i18n/server-messages';
import type { Locale } from './i18n/locales';
import type { Point } from './data';
import type { ParkingInfo } from './journey-types';

type RawParking = {
  id: string;
  name: string | null;
  lat: number;
  lon: number;
  capacity: number | null;
  /** capacity:disabled as tagged: count, 'yes', 'no' or null. */
  disabled: number | 'yes' | 'no' | null;
  /** Disabled spaces mapped as separate features inside the car park outline. */
  mappedDisabled: number;
  fee: 'yes' | 'no' | null;
  access: string | null;
  type: string | null;
  editedAt: string | null;
};

type RawSpace = { id: string; lat: number; lon: number; capacity: number; parking: number };

export type Parking = {
  id: string;
  kind: 'car_park' | 'disabled_space';
  name: string | null;
  lat: number;
  lon: number;
  capacity: number | null;
  /** Known number of disabled spaces, or null when only 'yes' or nothing is tagged. */
  disabledSpaces: number | null;
  disabled: 'yes' | 'no' | 'unknown';
  fee: 'yes' | 'no' | 'unknown';
  editedAt: string | null;
};

type ParkingData = { obtainedAt: string; list: Parking[]; grid: PointGrid };

let cached: ParkingData | null | undefined;

function normalise(p: RawParking): Parking {
  const tagged = typeof p.disabled === 'number' ? p.disabled : null;
  const count = Math.max(tagged ?? 0, p.mappedDisabled) || null;
  const disabled = count ? 'yes' : p.disabled === 'yes' ? 'yes' : p.disabled === 'no' || tagged === 0 ? 'no' : 'unknown';
  return {
    id: p.id,
    kind: 'car_park',
    name: p.name,
    lat: p.lat,
    lon: p.lon,
    capacity: p.capacity,
    disabledSpaces: count,
    disabled,
    fee: p.fee ?? 'unknown',
    editedAt: p.editedAt,
  };
}

function parkingData(): ParkingData | null {
  if (cached !== undefined) return cached;
  const file = path.join(/* turbopackIgnore: true */ process.cwd(), 'data/krakow-parking.json.gz');
  if (!existsSync(file)) return (cached = null);
  const raw = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as { obtainedAt: string; parkings: RawParking[]; spaces: RawSpace[] };
  const list = raw.parkings.map(normalise);
  // Disabled bays outside any mapped car park outline (often on-street) are parking places of their own.
  for (const s of raw.spaces) {
    if (s.parking >= 0) continue;
    list.push({ id: s.id, kind: 'disabled_space', name: null, lat: s.lat, lon: s.lon, capacity: s.capacity, disabledSpaces: s.capacity, disabled: 'yes', fee: 'unknown', editedAt: null });
  }
  cached = { obtainedAt: raw.obtainedAt, list, grid: new PointGrid(Float64Array.from(list, p => p.lat), Float64Array.from(list, p => p.lon), 0.003) };
  return cached;
}

export function hasDisabledSpaces(p: Parking) {
  return p.disabled === 'yes';
}

export function parkingInfo(p: Parking, locale: Locale = 'pl', distance?: number): ParkingInfo {
  const m = serverMessages(locale);
  return {
    id: p.id,
    name: p.name ?? (p.kind === 'disabled_space' ? m.places.disabledSpace : m.places.parking),
    lat: p.lat,
    lon: p.lon,
    disabledSpaces: p.disabledSpaces,
    fee: p.fee,
    sourceUrl: `https://www.openstreetmap.org/${p.id}`,
    editedAt: p.editedAt,
    kind: p.kind,
    disabled: p.disabled,
    capacity: p.capacity,
    ...(distance !== undefined ? { distance: Math.round(distance) } : {}),
  };
}

/** Raw parking records within `radius` metres, nearest first. */
export function parkingsNear(point: Point, radius: number, options: { disabledOnly?: boolean } = {}): (Parking & { distance: number })[] {
  const data = parkingData();
  if (!data) return [];
  return data.grid
    .within(point, radius)
    .map(i => ({ ...data.list[i], distance: metres(point, data.list[i]) }))
    .filter(p => !options.disabledOnly || hasDisabledSpaces(p))
    .sort((a, b) => a.distance - b.distance);
}

/**
 * Car parks and disabled bays near a point, nearest first (`distance` in straight-line metres).
 * `disabledOnly` keeps places with mapped disabled spaces (capacity:disabled > 0 / yes, or parking_space=disabled).
 */
export function parkingNear(point: Point, radius: number, options: { disabledOnly?: boolean; locale?: Locale; limit?: number } = {}): ParkingInfo[] {
  return parkingsNear(point, radius, options)
    .slice(0, options.limit ?? 50)
    .map(p => parkingInfo(p, options.locale, p.distance));
}

export function parkingAvailable() {
  return parkingData() !== null;
}
