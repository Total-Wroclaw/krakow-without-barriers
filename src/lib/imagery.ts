// Official GUGiK orthophoto (WMS, free reuse with attribution) around a point.
// The server only requests fixed-size crops (a few frame widths) for coordinates inside Kraków; no arbitrary URLs.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { runtimeDir } from './server';
import { aerialBbox, IMAGE_SIZE, type AerialWidth, type Bbox } from './aerial-geo';
import type { Point } from './city-types';

const ORTHO_BASE = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS';
export const orthoServices = [`${ORTHO_BASE}/HighResolution`, `${ORTHO_BASE}/StandardResolution`];

/** GUGiK rejects percent-encoded ':' and ',' in WMS parameters, so the query is built by hand. */
export function wmsUrl(service: string, bbox: number[], width: number, height: number) {
  return `${service}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=Raster&STYLES=&SRS=EPSG:3857&BBOX=${bbox.map(v => v.toFixed(2)).join(',')}&WIDTH=${width}&HEIGHT=${height}&FORMAT=image/jpeg`;
}
const memory = new Map<string, Buffer>();
const inflight = new Map<string, Promise<Buffer>>();

async function fetchCrop(bbox: Bbox) {
  for (const service of orthoServices) {
    const res = await fetch(wmsUrl(service, bbox, IMAGE_SIZE.width, IMAGE_SIZE.height), { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'KazdyKrok/0.3' } }).catch(() => null);
    if (!res?.ok || !res.headers.get('content-type')?.startsWith('image/')) continue;
    // Decode to validate the image and normalise it before it reaches the browser or the model.
    return sharp(Buffer.from(await res.arrayBuffer()), { limitInputPixels: 4_000_000 }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  }
  throw new Error('Ortofotomapa jest niedostępna.');
}

/** A 960 × 720 orthophoto crop `widthM` metres wide around a (rounded) point; cached in memory and on disk. */
export async function orthoCrop(point: Point, widthM: AerialWidth) {
  const key = `${point.lat.toFixed(5)}_${point.lon.toFixed(5)}_w${widthM}`;
  const hit = memory.get(key);
  if (hit) return hit;
  const file = path.join(runtimeDir, 'aerial', 'crops', `${key}.jpg`);
  let job = inflight.get(key);
  if (!job) {
    job = (async () => {
      const cached = await readFile(file).catch(() => null);
      if (cached) return cached;
      const jpeg = await fetchCrop(aerialBbox(point, widthM));
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, jpeg);
      await rename(tmp, file);
      return jpeg;
    })().finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  const jpeg = await job;
  if (memory.size > 120) memory.clear();
  memory.set(key, jpeg);
  return jpeg;
}

/**
 * The analysis copy of a crop: small hollow rings mark the listed pins so the model can tie its
 * description to them. Rings only (no text), so no fonts are needed on the server.
 */
export async function withPinRings(jpeg: Buffer, positions: { x: number; y: number }[]) {
  const { width, height } = IMAGE_SIZE;
  const rings = positions
    .map(p => `<circle cx="${(p.x * width).toFixed(1)}" cy="${(p.y * height).toFixed(1)}" r="13" fill="none" stroke="#ffffff" stroke-width="5"/><circle cx="${(p.x * width).toFixed(1)}" cy="${(p.y * height).toFixed(1)}" r="13" fill="none" stroke="#c4122f" stroke-width="2.5"/>`)
    .join('');
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${rings}</svg>`);
  return sharp(jpeg).composite([{ input: svg }]).jpeg({ quality: 80 }).toBuffer();
}
