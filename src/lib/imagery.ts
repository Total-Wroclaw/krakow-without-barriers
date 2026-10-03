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

/** Square close-up for the second look at an observation: sharper than the frame, with a labelled pixel grid. */
export const PATCH = { widthM: 50, px: 512 } as const;

export function patchBbox(center: Point): Bbox {
  const b = aerialBbox(center, PATCH.widthM);
  const cy = (b[1] + b[3]) / 2;
  const half = (b[2] - b[0]) / 2;
  return [b[0], cy - half, b[2], cy + half];
}

export async function orthoPatch(center: Point) {
  const bbox = patchBbox(center);
  const { px } = PATCH;
  for (const service of orthoServices) {
    const res = await fetch(wmsUrl(service, bbox, px, px), { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': 'KazdyKrok/0.3' } }).catch(() => null);
    if (!res?.ok || !res.headers.get('content-type')?.startsWith('image/')) continue;
    const step = px / 8;
    const grid: string[] = [];
    const label = (x: number, y: number, text: number, anchor: string) =>
      `<text x="${x}" y="${y}" font-size="12" font-family="Arial, Helvetica, sans-serif" font-weight="bold" fill="#fff" stroke="#000" stroke-width="3" paint-order="stroke" text-anchor="${anchor}">${text}</text>`;
    for (let v = step; v < px; v += step) {
      grid.push(`<line x1="${v}" y1="0" x2="${v}" y2="${px}" stroke="#fff" stroke-opacity="0.3"/><line x1="0" y1="${v}" x2="${px}" y2="${v}" stroke="#fff" stroke-opacity="0.3"/>`);
      grid.push(label(v, 12, v, 'middle'), label(2, v + 4, v, 'start'));
    }
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}">${grid.join('')}</svg>`);
    return sharp(Buffer.from(await res.arrayBuffer()), { limitInputPixels: 4_000_000 }).composite([{ input: svg }]).jpeg({ quality: 85 }).toBuffer();
  }
  throw new Error('Ortofotomapa jest niedostępna.');
}
