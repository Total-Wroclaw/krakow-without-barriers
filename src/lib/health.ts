// Data freshness and service health, for monitoring (GET /api/health) and the "About" dialog.
// Reads only snapshot metadata and file stats: no secrets, no user data, cheap enough to poll.
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { apiKey, runtimeDir } from './server';

export type SourceHealth = {
  id: 'osm' | 'places' | 'roads' | 'objects' | 'cityVenues' | 'transit';
  /** When we downloaded it. */
  obtainedAt: string | null;
  /** Date of the data itself, when the source states it (e.g. the OSM replication timestamp). */
  sourceDate: string | null;
  ageDays: number | null;
  /** Older than the refresh plan allows (see docs/DATA-SOURCES.md). */
  stale: boolean;
  /** Timetable: last date any service runs. */
  validUntil?: string | null;
};
export type Health = { status: 'ok' | 'degraded'; checkedAt: string; sources: SourceHealth[]; storage: boolean; ai: boolean };

/** Days a snapshot may age before it counts as stale: OSM weekly refresh, UMK list weekly, GTFS daily. */
const MAX_AGE: Record<SourceHealth['id'], number> = { osm: 14, places: 14, roads: 14, objects: 14, cityVenues: 14, transit: 7 };
const root = () => /* turbopackIgnore: true */ process.cwd();

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path.join(root(), file), 'utf8'));
  } catch {
    return null;
  }
}

function source(id: SourceHealth['id'], obtainedAt: unknown, sourceDate: unknown, now: number): SourceHealth {
  const obtained = typeof obtainedAt === 'string' ? obtainedAt : null;
  const stated = typeof sourceDate === 'string' ? sourceDate : null;
  const basis = stated ?? obtained;
  const ageDays = basis ? Math.floor((now - Date.parse(basis)) / 86_400_000) : null;
  return { id, obtainedAt: obtained, sourceDate: stated, ageDays, stale: ageDays === null || ageDays > MAX_AGE[id] };
}

/** The timetable baked into the image knows its own download time and the last day it has service. */
function transit(now: number): SourceHealth {
  const file = process.env.KROK_TRANSIT_DB ?? path.join(runtimeDir, 'transit.sqlite');
  if (!existsSync(file)) return { id: 'transit', obtainedAt: null, sourceDate: null, ageDays: null, stale: true, validUntil: null };
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const meta = JSON.parse((db.prepare('SELECT body FROM metadata LIMIT 1').get() as { body: string } | undefined)?.body ?? '{}') as { obtainedAt?: string };
      const last = (db.prepare('SELECT max(date) AS d FROM exceptions WHERE type = 1').get() as { d: string | null }).d;
      const validUntil = last ? `${last.slice(0, 4)}-${last.slice(4, 6)}-${last.slice(6, 8)}` : null;
      const health = source('transit', meta.obtainedAt, null, now);
      // A timetable that ends within two days is as bad as an old one.
      const ending = validUntil !== null && Date.parse(validUntil) - now < 2 * 86_400_000;
      return { ...health, stale: health.stale || ending, validUntil };
    } finally {
      db.close();
    }
  } catch {
    return { id: 'transit', obtainedAt: null, sourceDate: null, ageDays: null, stale: true, validUntil: null };
  }
}

let cached: { at: number; health: Health } | undefined;

export function health(now = Date.now()): Health {
  if (cached && now - cached.at < 5 * 60_000) return cached.health;
  const city = readJson('data/city-metadata.json');
  const places = readJson('data/places-metadata.json');
  const roads = readJson('data/roads-metadata.json');
  const objects = readJson('data/objects-metadata.json');
  const venues = readJson('data/krakow-city-venues.json') as { source?: { obtainedAt?: string } } | null;
  const sources = [
    source('osm', city?.obtainedAt, city?.sourceDate, now),
    source('places', places?.obtainedAt, places?.sourceDate, now),
    source('roads', roads?.obtainedAt, roads?.sourceDate, now),
    source('objects', objects?.obtainedAt, objects?.sourceDate, now),
    source('cityVenues', venues?.source?.obtainedAt, null, now),
    transit(now),
  ];
  let storage = false;
  try {
    accessSync(existsSync(runtimeDir) ? runtimeDir : path.dirname(runtimeDir), constants.W_OK);
    storage = true;
  } catch {}
  const result: Health = {
    status: sources.some(s => s.stale) || !storage ? 'degraded' : 'ok',
    checkedAt: new Date(now).toISOString(),
    sources,
    storage,
    ai: !!apiKey(),
  };
  cached = { at: now, health: result };
  return result;
}
