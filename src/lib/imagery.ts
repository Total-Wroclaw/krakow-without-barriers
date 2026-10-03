// Official GUGiK orthophoto (WMS, free reuse with attribution) around a point.
// The server only requests a fixed-size crop for coordinates inside Kraków; no arbitrary URLs.
import sharp from 'sharp';
import type { Point } from './city-types';

export const ORTHO_WMS = 'https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/StandardResolution';
const WIDTH_M = 240;
const HEIGHT_M = 180;
const cache = new Map<string, { at: number; jpeg: Buffer }>();

function mercator({ lat, lon }: Point) {
  const x = (lon * 20037508.34) / 180;
  const y = (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * 20037508.34) / Math.PI;
  return { x, y };
}

export function orthoUrl(point: Point, px = { w: 640, h: 480 }) {
  // Mercator metres are stretched by 1/cos(lat) relative to ground metres.
  const scale = 1 / Math.cos((point.lat * Math.PI) / 180);
  const { x, y } = mercator(point);
  const dx = (WIDTH_M * scale) / 2;
  const dy = (HEIGHT_M * scale) / 2;
  const params = new URLSearchParams({
    SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.1.1', LAYERS: 'Raster', STYLES: '', SRS: 'EPSG:3857',
    BBOX: [x - dx, y - dy, x + dx, y + dy].map(v => v.toFixed(1)).join(','), WIDTH: String(px.w), HEIGHT: String(px.h), FORMAT: 'image/jpeg',
  });
  return `${ORTHO_WMS}?${params}`;
}

export async function orthoCrop(point: Point) {
  const key = `${point.lat.toFixed(4)},${point.lon.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 86_400_000) return hit.jpeg;
  const res = await fetch(orthoUrl(point), { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'KazdyKrok-prototype/0.2' } });
  if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) throw new Error('Ortofotomapa jest niedostępna.');
  // Decode to validate the image and normalise it before it reaches the model.
  const jpeg = await sharp(Buffer.from(await res.arrayBuffer()), { limitInputPixels: 4_000_000 }).jpeg({ quality: 80 }).toBuffer();
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), jpeg });
  return jpeg;
}
