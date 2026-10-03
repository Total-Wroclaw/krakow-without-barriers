// Official GUGiK orthophoto (WMS, free reuse with attribution) around a point.
// The server only requests a fixed-size crop for coordinates inside Kraków; no arbitrary URLs.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { runtimeDir } from './server';
import type { Point } from './city-types';

const ORTHO_BASE = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS';
export const orthoServices = [`${ORTHO_BASE}/HighResolution`, `${ORTHO_BASE}/StandardResolution`];

/** GUGiK rejects percent-encoded ':' and ',' in WMS parameters, so the query is built by hand. */
export function wmsUrl(service: string, bbox: number[], width: number, height: number) {
  return `${service}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=Raster&STYLES=&SRS=EPSG:3857&BBOX=${bbox.map(v => v.toFixed(2)).join(',')}&WIDTH=${width}&HEIGHT=${height}&FORMAT=image/jpeg`;
}
const WIDTH_M = 240;
const HEIGHT_M = 180;
const cache = new Map<string, { at: number; jpeg: Buffer }>();

function mercator({ lat, lon }: Point) {
  const x = (lon * 20037508.34) / 180;
  const y = (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * 20037508.34) / Math.PI;
  return { x, y };
}

function orthoBbox(point: Point) {
  // Mercator metres are stretched by 1/cos(lat) relative to ground metres.
  const scale = 1 / Math.cos((point.lat * Math.PI) / 180);
  const { x, y } = mercator(point);
  const dx = (WIDTH_M * scale) / 2;
  const dy = (HEIGHT_M * scale) / 2;
  return [x - dx, y - dy, x + dx, y + dy];
}

export async function orthoCrop(point: Point) {
  const key = `${point.lat.toFixed(4)},${point.lon.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 86_400_000) return hit.jpeg;
  // Crops are also kept on disk so repeated aerial descriptions don't refetch the source.
  const file = path.join(runtimeDir, 'aerial', `${key.replace(',', '_')}.jpg`);
  try {
    const jpeg = await readFile(file);
    cache.set(key, { at: Date.now(), jpeg });
    return jpeg;
  } catch {}
  let jpeg: Buffer | null = null;
  for (const service of orthoServices) {
    const res = await fetch(wmsUrl(service, orthoBbox(point), 640, 480), { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'KazdyKrok/0.3' } }).catch(() => null);
    if (!res?.ok || !res.headers.get('content-type')?.startsWith('image/')) continue;
    // Decode to validate the image and normalise it before it reaches the model.
    jpeg = await sharp(Buffer.from(await res.arrayBuffer()), { limitInputPixels: 4_000_000 }).jpeg({ quality: 80 }).toBuffer();
    break;
  }
  if (!jpeg) throw new Error('Ortofotomapa jest niedostępna.');
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), jpeg });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, jpeg).catch(() => {});
  return jpeg;
}
