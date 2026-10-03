// Disk cache for GUGiK orthophoto tiles (free reuse with attribution). Tiles are fetched once
// per z/x/y from the official WMS, validated, stored under .runtime/tiles and served with
// long browser-cache headers, so the satellite view stays fast and light on the source.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { orthoServices, wmsUrl } from './imagery';
import { runtimeDir } from './server';

const dir = path.join(runtimeDir, 'tiles', 'ortho');
const inflight = new Map<string, Promise<Buffer>>();
const R = 20037508.342789244;
// Kraków service envelope with a margin, so nearby context still renders.
const BOUNDS = { west: 19.6, east: 20.4, south: 49.85, north: 50.3 };

function lon2x(lon: number, z: number) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function lat2y(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

/** True when the tile is a sensible request for this app (zoom range and area). */
export function tileAllowed(z: number, x: number, y: number) {
  if (![z, x, y].every(Number.isInteger) || z < 8 || z > 19) return false;
  return x >= lon2x(BOUNDS.west, z) && x <= lon2x(BOUNDS.east, z) && y >= lat2y(BOUNDS.north, z) && y <= lat2y(BOUNDS.south, z);
}

export function tileBbox(z: number, x: number, y: number) {
  const size = (2 * R) / 2 ** z;
  const minX = -R + x * size;
  const maxY = R - y * size;
  return [minX, maxY - size, minX + size, maxY];
}

async function fetchTile(z: number, x: number, y: number) {
  let last: unknown;
  // HighResolution covers Kraków well; StandardResolution is the fallback (it has gaps).
  for (const service of orthoServices) {
    try {
      const res = await fetch(wmsUrl(service, tileBbox(z, x, y), 256, 256), { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'KazdyKrok/0.3 (tile cache)' } });
      if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) throw new Error(`GUGiK ${res.status}`);
      // Decode to make sure only valid images are cached.
      return await sharp(Buffer.from(await res.arrayBuffer()), { limitInputPixels: 1_000_000 }).jpeg({ quality: 82 }).toBuffer();
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

export async function orthoTile(z: number, x: number, y: number): Promise<{ jpeg: Buffer; hit: boolean }> {
  const file = path.join(dir, String(z), String(x), `${y}.jpg`);
  try {
    return { jpeg: await readFile(file), hit: true };
  } catch {}
  const key = `${z}/${x}/${y}`;
  let job = inflight.get(key);
  if (!job) {
    job = (async () => {
      const jpeg = await fetchTile(z, x, y);
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, jpeg);
      await rename(tmp, file);
      return jpeg;
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  return { jpeg: await job, hit: false };
}
