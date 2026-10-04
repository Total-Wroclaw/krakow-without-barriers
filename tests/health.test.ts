import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { mkdtempSync } from 'node:fs';
import path from 'node:path';

process.env.KROK_STORAGE_DIR ??= mkdtempSync(path.join(os.tmpdir(), 'krok-health-'));
const { health } = await import('../src/lib/health');

test('health lists every data source with its snapshot dates and flags stale ones', () => {
  const now = health();
  assert.deepEqual(now.sources.map(s => s.id), ['osm', 'places', 'roads', 'objects', 'cityVenues', 'transit']);
  const osm = now.sources[0];
  assert.ok(osm.obtainedAt && osm.sourceDate, 'OSM snapshot states its replication date');
  // A year later every snapshot is past its refresh window.
  const later = health(Date.parse(osm.sourceDate!) + 365 * 86_400_000);
  assert.equal(later.status, 'degraded');
  assert.ok(later.sources.filter(s => s.id !== 'transit' || s.obtainedAt).every(s => s.stale));
  assert.equal(typeof later.ai, 'boolean', 'only whether AI is configured, never the key');
  assert.ok(!JSON.stringify(later).includes('sk-'));
});
