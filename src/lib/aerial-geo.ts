// Geometry shared by the aerial view's server (crop, overlay, AI) and client (map frame, pins).
// The GUGiK WMS crop is requested in EPSG:3857, so a point maps linearly into the image in Web Mercator.
import type { Point } from './city-types';

/** Allowed ground widths of the analysed frame, in metres (4:3). Steps keep crops and analyses cacheable. */
export const AERIAL_WIDTHS = [80, 100, 130, 160, 200, 250, 320, 400] as const;
export type AerialWidth = (typeof AERIAL_WIDTHS)[number];
export const DEFAULT_WIDTH: AerialWidth = 130;
export const IMAGE_SIZE = { width: 960, height: 720 } as const;
/** Overlay facts are gathered within this radius (half-diagonal of the widest frame) of the place. */
export const OVERLAY_RADIUS = 250;
/** Margin around the points a frame must show, so pins are not cut at the edge. */
const FRAME_PADDING = 18;

const R = 20037508.34;
export type Bbox = [minX: number, minY: number, maxX: number, maxY: number];

/** Request coordinates are rounded to ~1 m so crops, overlays and analyses share cache entries. */
export function roundPoint(p: Point): Point {
  return { lat: Math.round(p.lat * 1e5) / 1e5, lon: Math.round(p.lon * 1e5) / 1e5 };
}

function mercator({ lat, lon }: Point) {
  return { x: (lon * R) / 180, y: (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) * R) / Math.PI };
}

function inverseMercator(x: number, y: number): Point {
  return { lat: (Math.atan(Math.exp((y * Math.PI) / R)) * 360) / Math.PI - 90, lon: (x * 180) / R };
}

/** Web Mercator bbox of a 4:3 frame `widthM` ground metres wide centred on `center`. */
export function aerialBbox(center: Point, widthM: number): Bbox {
  // Mercator metres are stretched by 1/cos(lat) relative to ground metres.
  const scale = 1 / Math.cos((center.lat * Math.PI) / 180);
  const { x, y } = mercator(center);
  const dx = (widthM * scale) / 2;
  const dy = (widthM * 0.75 * scale) / 2;
  return [x - dx, y - dy, x + dx, y + dy];
}

/** South-west and north-east corners of the frame, for maps. */
export function frameCorners(center: Point, widthM: number): [Point, Point] {
  const b = aerialBbox(center, widthM);
  return [inverseMercator(b[0], b[1]), inverseMercator(b[2], b[3])];
}

/**
 * Smallest frame step centred on the place that shows all `points` with a margin, clamped to 80–400 m.
 * Points further away simply stay outside (they are still listed in text).
 */
export function fitWidth(center: Point, points: Point[]): AerialWidth {
  const k = Math.cos((center.lat * Math.PI) / 180);
  let need = 0;
  for (const p of points) {
    const east = Math.abs(p.lon - center.lon) * 111_320 * k + FRAME_PADDING;
    const north = Math.abs(p.lat - center.lat) * 111_320 + FRAME_PADDING;
    need = Math.max(need, 2 * east, (2 * north * 4) / 3);
  }
  return AERIAL_WIDTHS.find(w => w >= need) ?? AERIAL_WIDTHS[AERIAL_WIDTHS.length - 1];
}

export const isAerialWidth = (w: number): w is AerialWidth => (AERIAL_WIDTHS as readonly number[]).includes(w);

/** Position of a point in the frame as fractions (0..1 from the left / top edge). */
export function project(point: Point, bbox: Bbox) {
  const { x, y } = mercator(point);
  return { x: (x - bbox[0]) / (bbox[2] - bbox[0]), y: (bbox[3] - y) / (bbox[3] - bbox[1]) };
}

/** Inverse of `project`: a fractional image position back to coordinates. */
export function unproject(pos: { x: number; y: number }, bbox: Bbox): Point {
  return inverseMercator(bbox[0] + pos.x * (bbox[2] - bbox[0]), bbox[3] - pos.y * (bbox[3] - bbox[1]));
}

/** Inside the frame, keeping a small margin so a pin is never cut in half at the edge. */
export function inFrame(pos: { x: number; y: number }, margin = 0.02) {
  return pos.x >= margin && pos.x <= 1 - margin && pos.y >= margin && pos.y <= 1 - margin;
}

const compassPoints = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;
export type Compass = (typeof compassPoints)[number];

/** Eight-point compass direction from `from` to `to`. */
export function compass(from: Point, to: Point): Compass {
  const dx = (to.lon - from.lon) * Math.cos((from.lat * Math.PI) / 180);
  const dy = to.lat - from.lat;
  const deg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return compassPoints[Math.round(deg / 45) % 8];
}

/** Straight-line distance in metres (equirectangular; plenty for a few hundred metres). */
export function distance(a: Point, b: Point) {
  const x = (((b.lon - a.lon) * Math.PI) / 180) * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const y = ((b.lat - a.lat) * Math.PI) / 180;
  return 6371000 * Math.hypot(x, y);
}
