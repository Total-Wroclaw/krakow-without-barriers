// Drivable road graph (OSM) for taxi and car legs: compact CSR typed arrays, travel-time costs.
// Times are estimates from speed limits and road classes. There is no live traffic, no turn
// restrictions and no time-dependent access (e.g. the Old Town zone schedule).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Heap, metres, PointGrid } from './routing';
import type { Point } from './data';

export const ROAD_CLASSES = ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
  'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service'] as const;

/** Assumed limit (km/h) when `maxspeed` is not tagged. */
export const DEFAULT_SPEED: Record<(typeof ROAD_CLASSES)[number], number> = {
  motorway: 120, motorway_link: 60, trunk: 90, trunk_link: 50, primary: 50, primary_link: 40, secondary: 50, secondary_link: 40,
  tertiary: 50, tertiary_link: 30, unclassified: 40, residential: 30, living_street: 15, service: 15,
};

/**
 * Share of the limit actually driven on average in town (signals, junctions, traffic):
 * an estimate, not a measurement.
 */
export function urbanFactor(limit: number) {
  return limit <= 50 ? 0.65 : limit <= 80 ? 0.8 : 0.9;
}

/** Extra seconds when passing a node with traffic signals / a junction of three or more road arms. */
export const SIGNAL_DELAY = 15;
export const JUNCTION_DELAY = 4;
/** `access=destination|customers` roads are allowed but only used near the ends of a trip. */
const DESTINATION_FACTOR = 4;
const DESTINATION_PENALTY = 60;
/** Classes not used for picking someone up or dropping them off. */
const NO_STOPPING = new Set([0, 1, 2, 3]);

type RoadFile = {
  obtainedAt: string;
  sourceDate: string | null;
  classes: string[];
  names: string[];
  lat: number[];
  lon: number[];
  signals: number[];
  ways: { id: number[]; cls: number[]; oneway: number[]; maxspeed: number[]; dest: number[]; name: number[]; offsets: number[]; nodes: number[] };
};

export type RoadGraph = {
  obtainedAt: string;
  sourceDate: string | null;
  lat: Float64Array;
  lon: Float64Array;
  offsets: Int32Array;
  edgeFrom: Int32Array;
  edgeTo: Int32Array;
  edgeLength: Float32Array;
  /** Estimated driving seconds including the delay at the node entered. */
  edgeSeconds: Float32Array;
  /** Routing cost (seconds, destination-only roads penalised). */
  edgeCost: Float32Array;
  edgeWay: Int32Array;
  wayName: Int32Array;
  wayClass: Uint8Array;
  names: string[];
  /** Nodes where a car can stop: largest strongly connected component, not on motorway/trunk only. */
  stopGrid: PointGrid;
  /** Fastest speed in m/s over all edges (A* heuristic bound). */
  maxSpeed: number;
};

export function buildRoadGraph(file: RoadFile): RoadGraph {
  const n = file.lat.length;
  const lat = Float64Array.from(file.lat, v => v / 1e6);
  const lon = Float64Array.from(file.lon, v => v / 1e6);
  const w = file.ways;
  const wayCount = w.id.length;

  // Edge count first, to size typed arrays once.
  let m = 0;
  for (let i = 0; i < wayCount; i++) m += (w.offsets[i + 1] - w.offsets[i] - 1) * (w.oneway[i] === 0 ? 2 : 1);
  const from = new Int32Array(m);
  const to = new Int32Array(m);
  const way = new Int32Array(m);
  let k = 0;
  for (let i = 0; i < wayCount; i++) {
    for (let j = w.offsets[i] + 1; j < w.offsets[i + 1]; j++) {
      const a = w.nodes[j - 1];
      const b = w.nodes[j];
      if (w.oneway[i] >= 0) (from[k] = a), (to[k] = b), (way[k++] = i);
      if (w.oneway[i] <= 0) (from[k] = b), (to[k] = a), (way[k++] = i);
    }
  }

  // Junctions: nodes with three or more distinct neighbours.
  const degree = new Uint8Array(n);
  for (let e = 0; e < m; e++) if (degree[from[e]] < 255) degree[from[e]]++;
  const signal = new Uint8Array(n);
  for (const s of file.signals) signal[s] = 1;

  const offsets = new Int32Array(n + 1);
  for (let e = 0; e < m; e++) offsets[from[e] + 1]++;
  for (let i = 0; i < n; i++) offsets[i + 1] += offsets[i];
  const cursor = offsets.slice(0, n);
  const edgeFrom = new Int32Array(m);
  const edgeTo = new Int32Array(m);
  const edgeLength = new Float32Array(m);
  const edgeSeconds = new Float32Array(m);
  const edgeCost = new Float32Array(m);
  const edgeWay = new Int32Array(m);
  let maxSpeed = 1;
  for (let e = 0; e < m; e++) {
    const slot = cursor[from[e]]++;
    const wi = way[e];
    const cls = ROAD_CLASSES[w.cls[wi]];
    const limit = w.maxspeed[wi] || DEFAULT_SPEED[cls];
    const speed = (limit / 3.6) * urbanFactor(limit);
    if (speed > maxSpeed) maxSpeed = speed;
    const length = metres({ lat: lat[from[e]], lon: lon[from[e]] }, { lat: lat[to[e]], lon: lon[to[e]] });
    const delay = signal[to[e]] ? SIGNAL_DELAY : degree[to[e]] >= 3 ? JUNCTION_DELAY : 0;
    const seconds = length / speed + delay;
    edgeFrom[slot] = from[e];
    edgeTo[slot] = to[e];
    edgeLength[slot] = length;
    edgeSeconds[slot] = seconds;
    edgeCost[slot] = w.dest[wi] ? seconds * DESTINATION_FACTOR + DESTINATION_PENALTY : seconds;
    edgeWay[slot] = wi;
  }

  // Largest strongly connected component (iterative Kosaraju) so that both ends of a trip can be reached and left.
  const inOffsets = new Int32Array(n + 1);
  for (let e = 0; e < m; e++) inOffsets[edgeTo[e] + 1]++;
  for (let i = 0; i < n; i++) inOffsets[i + 1] += inOffsets[i];
  const inCursor = inOffsets.slice(0, n);
  const inEdges = new Int32Array(m);
  for (let e = 0; e < m; e++) inEdges[inCursor[edgeTo[e]]++] = e;

  const order = new Int32Array(n);
  let orderSize = 0;
  const visited = new Uint8Array(n);
  const stack = new Int32Array(n);
  const edgeCursor = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (visited[s]) continue;
    let top = 0;
    stack[top++] = s;
    visited[s] = 1;
    edgeCursor[s] = offsets[s];
    while (top) {
      const v = stack[top - 1];
      if (edgeCursor[v] < offsets[v + 1]) {
        const t = edgeTo[edgeCursor[v]++];
        if (!visited[t]) {
          visited[t] = 1;
          edgeCursor[t] = offsets[t];
          stack[top++] = t;
        }
      } else {
        order[orderSize++] = v;
        top--;
      }
    }
  }
  const component = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const s = order[i];
    if (component[s] >= 0) continue;
    const c = sizes.length;
    let size = 0;
    let top = 0;
    stack[top++] = s;
    component[s] = c;
    while (top) {
      const v = stack[--top];
      size++;
      for (let k2 = inOffsets[v]; k2 < inOffsets[v + 1]; k2++) {
        const u = edgeFrom[inEdges[k2]];
        if (component[u] < 0) {
          component[u] = c;
          stack[top++] = u;
        }
      }
    }
    sizes.push(size);
  }
  let main = 0;
  for (let c = 1; c < sizes.length; c++) if (sizes[c] > sizes[main]) main = c;
  const stoppable = new Uint8Array(n);
  for (let e = 0; e < m; e++) {
    if (component[edgeFrom[e]] !== main || component[edgeTo[e]] !== main || NO_STOPPING.has(w.cls[edgeWay[e]])) continue;
    stoppable[edgeFrom[e]] = 1;
    stoppable[edgeTo[e]] = 1;
  }

  return {
    obtainedAt: file.obtainedAt,
    sourceDate: file.sourceDate,
    lat,
    lon,
    offsets,
    edgeFrom,
    edgeTo,
    edgeLength,
    edgeSeconds,
    edgeCost,
    edgeWay,
    wayName: Int32Array.from(w.name),
    wayClass: Uint8Array.from(w.cls),
    names: file.names,
    stopGrid: new PointGrid(lat, lon, 0.002, i => stoppable[i] === 1),
    maxSpeed,
  };
}

let cached: RoadGraph | null | undefined;

/** The citywide road graph, loaded once per process; null when the extract is missing. */
export function roadGraph(): RoadGraph | null {
  if (cached !== undefined) return cached;
  const file = path.join(/* turbopackIgnore: true */ process.cwd(), 'data/krakow-roads.json.gz');
  cached = existsSync(file) ? buildRoadGraph(JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as RoadFile) : null;
  return cached;
}

/** Nearest node where a car can stop, within `radius` metres, or -1. */
export function roadNearest(g: RoadGraph, point: Point, radius: number) {
  return g.stopGrid.nearest(point, radius);
}

export function roadPoint(g: RoadGraph, node: number): Point {
  return { lat: g.lat[node], lon: g.lon[node] };
}

/** Name of a road at a node (first named outgoing way), or null. */
export function roadName(g: RoadGraph, node: number) {
  for (let e = g.offsets[node]; e < g.offsets[node + 1]; e++) {
    const name = g.wayName[g.edgeWay[e]];
    if (name >= 0) return g.names[name];
  }
  return null;
}

export type Drive = { edges: number[]; seconds: number; distance: number };

function trace(g: RoadGraph, previous: Int32Array, start: number, end: number): Drive {
  const edges: number[] = [];
  for (let node = end; node !== start; node = g.edgeFrom[previous[node]]) edges.push(previous[node]);
  edges.reverse();
  let seconds = 0;
  let distance = 0;
  for (const e of edges) {
    seconds += g.edgeSeconds[e];
    distance += g.edgeLength[e];
  }
  return { edges, seconds, distance };
}

/** Fastest drive between two nodes (A* on estimated time), or null. */
export function fastestDrive(g: RoadGraph, start: number, end: number): Drive | null {
  if (start === end) return { edges: [], seconds: 0, distance: 0 };
  const n = g.lat.length;
  const cost = new Float64Array(n).fill(Infinity);
  const previous = new Int32Array(n).fill(-1);
  const end0 = roadPoint(g, end);
  const r = Math.PI / 180;
  const kx = (6371000 * r * Math.cos(end0.lat * r) * 0.995) / g.maxSpeed;
  const ky = (6371000 * r * 0.995) / g.maxSpeed;
  const heuristic = (i: number) => Math.hypot((g.lon[i] - end0.lon) * kx, (g.lat[i] - end0.lat) * ky);
  const heap = new Heap();
  cost[start] = 0;
  heap.push(start, heuristic(start));
  while (heap.size) {
    const node = heap.pop();
    if (node === end) break;
    const base = cost[node];
    if (heap.lastCost > base + heuristic(node) + 1e-6) continue;
    for (let e = g.offsets[node]; e < g.offsets[node + 1]; e++) {
      const next = base + g.edgeCost[e];
      const t = g.edgeTo[e];
      if (next < cost[t]) {
        cost[t] = next;
        previous[t] = e;
        heap.push(t, next + heuristic(t));
      }
    }
  }
  return previous[end] === -1 ? null : trace(g, previous, start, end);
}

/** Fastest drives from one node to several targets (one Dijkstra, stops when all are settled). */
export function drivesTo(g: RoadGraph, start: number, targets: number[]): Map<number, Drive> {
  const n = g.lat.length;
  const cost = new Float64Array(n).fill(Infinity);
  const previous = new Int32Array(n).fill(-1);
  const pending = new Set(targets);
  const result = new Map<number, Drive>();
  if (pending.delete(start)) result.set(start, { edges: [], seconds: 0, distance: 0 });
  const heap = new Heap();
  cost[start] = 0;
  heap.push(start, 0);
  while (heap.size && pending.size) {
    const node = heap.pop();
    const base = cost[node];
    if (heap.lastCost > base + 1e-6) continue;
    if (pending.delete(node)) result.set(node, trace(g, previous, start, node));
    for (let e = g.offsets[node]; e < g.offsets[node + 1]; e++) {
      const next = base + g.edgeCost[e];
      const t = g.edgeTo[e];
      if (next < cost[t]) {
        cost[t] = next;
        previous[t] = e;
        heap.push(t, next);
      }
    }
  }
  return result;
}

/** [lat, lon] geometry of a drive, optionally framed by the exact start/end points. */
export function driveGeometry(g: RoadGraph, drive: Drive, start: number): [number, number][] {
  const nodes = drive.edges.length ? [g.edgeFrom[drive.edges[0]], ...drive.edges.map(e => g.edgeTo[e])] : [start];
  return nodes.map(i => [g.lat[i], g.lon[i]]);
}
