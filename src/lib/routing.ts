// Generic pedestrian graph over an OSM dataset: compact typed-array storage,
// grid spatial index, preference-aware costs and A* / bounded Dijkstra search.
import { handrail, type Dataset, type OsmNode, type Point, type Way } from './data';
import type { Preferences } from './schemas';

export function metres(a: Point, b: Point) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Compass bearing in degrees (0 = north, clockwise). */
export function bearing(a: Point, b: Point) {
  const r = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

export type Direction = 'up' | 'down' | 'unknown';

/** Materialised edge, created only for edges on a returned path. */
export type Edge = {
  index: number;
  from: string;
  to: string;
  way: Way;
  distance: number;
  /** Stair/incline direction relative to the direction of travel. */
  direction: Direction;
  benchNearby: boolean;
};

const UP = 1;
const DOWN = 2;
const BENCH = 4;
const STEPS = 8;
const PEDESTRIAN = 16;
const HANDRAIL = 32;

const pedestrianHighways = new Set(['footway', 'path', 'steps', 'pedestrian', 'living_street']);

export type Mobility = Preferences['mobility'];

/** Per-way surface/passage properties relevant to wheels (wheelchair, pushchair). */
export const ROUGH = 1;
export const VERY_ROUGH = 2;
export const IMPASSABLE = 4;
export const NARROW = 8;
export const STEEP = 16;
export const NO_WHEELCHAIR = 32;
/** Steps with an integrated wheelchair ramp (`ramp:wheelchair=yes`). */
export const RAMP_WHEELCHAIR = 64;
/** Steps with some ramp or rails (`ramp=yes`): usable with a pushchair, not proven for a wheelchair. */
export const RAMP_ANY = 128;
export const SETT = 256;
/** Stairs with more than LONG_FLIGHT_STEPS steps (`step_count`): tiring on crutches. */
export const LONG_FLIGHT = 512;
export const LONG_FLIGHT_STEPS = 15;

/** Per-node barriers met when passing through the node. */
export const KERB_RAISED = 1;
export const KERB_UNKNOWN = 2;
export const KERB_ROLLED = 4;
export const STEP_BARRIER = 8;
export const NODE_NO_WHEELCHAIR = 16;

const settSurfaces = new Set(['sett', 'cobblestone', 'unhewn_cobblestone', 'cobblestone:flattened']);
const roughSurfaces = new Set(['sett', 'cobblestone', 'cobblestone:flattened', 'gravel', 'pebblestone', 'unpaved', 'rock']);
const veryRoughSurfaces = new Set(['unhewn_cobblestone', 'ground', 'dirt', 'earth', 'grass', 'sand', 'mud', 'stepping_stones', 'grass_paver', 'woodchips']);
const stepLikeBarriers = new Set(['step', 'stile', 'turnstile', 'full-height_turnstile', 'kissing_gate']);

/** Width in metres from `width` (m or cm), or null. */
export function widthMetres(value: string | undefined) {
  if (!value) return null;
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(cm|m)?\s*$/.exec(value);
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  return m[2] === 'cm' ? n / 100 : n;
}

/** Absolute gradient in percent from a numeric `incline` (%, ° or plain), or null. */
export function inclinePercent(value: string | undefined) {
  if (!value) return null;
  const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(%|°)?\s*$/.exec(value);
  if (!m) return null;
  const n = Math.abs(parseFloat(m[1].replace(',', '.')));
  return m[2] === '°' ? Math.tan((n * Math.PI) / 180) * 100 : n;
}

export function wayMobility(tags: Record<string, string>) {
  let bits = 0;
  const surface = tags.surface;
  if (surface && settSurfaces.has(surface)) bits |= SETT;
  if (surface && veryRoughSurfaces.has(surface)) bits |= VERY_ROUGH;
  else if (surface && roughSurfaces.has(surface)) bits |= ROUGH;
  const smoothness = tags.smoothness;
  if (smoothness === 'impassable') bits |= IMPASSABLE;
  else if (['very_bad', 'horrible', 'very_horrible'].includes(smoothness)) bits |= VERY_ROUGH;
  else if (smoothness === 'bad') bits |= ROUGH;
  if (bits & VERY_ROUGH) bits &= ~ROUGH;
  if (['footway', 'path', 'steps'].includes(tags.highway)) {
    const width = widthMetres(tags.width);
    if (width !== null && width > 0 && width < 0.9) bits |= NARROW;
  }
  if (tags.highway !== 'steps') {
    const incline = inclinePercent(tags.incline);
    if (tags.incline === 'steep' || (incline !== null && incline > 6)) bits |= STEEP;
  }
  if (tags.wheelchair === 'no') bits |= NO_WHEELCHAIR;
  if (tags.highway === 'steps') {
    const steps = Number(tags.step_count);
    if (Number.isFinite(steps) && steps > LONG_FLIGHT_STEPS) bits |= LONG_FLIGHT;
    if (tags['ramp:wheelchair'] === 'yes') bits |= RAMP_WHEELCHAIR;
    if (tags.ramp === 'yes' || tags['ramp:wheelchair'] === 'yes') bits |= RAMP_ANY;
  }
  return bits;
}

export function nodeBarrier(tags: Record<string, string>) {
  let bits = 0;
  const kerb = tags.kerb;
  if (kerb === 'raised' || kerb === 'normal') bits |= KERB_RAISED;
  else if (kerb === 'rolled') bits |= KERB_ROLLED;
  else if (kerb === 'yes' || (tags.barrier === 'kerb' && !kerb)) bits |= KERB_UNKNOWN;
  if (stepLikeBarriers.has(tags.barrier)) bits |= STEP_BARRIER;
  if (tags.wheelchair === 'no') bits |= NODE_NO_WHEELCHAIR;
  return bits;
}

/** Wheelchair or pushchair: kerbs, surfaces and ramps decide the route. */
export function onWheels(mobility: Mobility | undefined): mobility is 'wheelchair' | 'stroller' {
  return mobility === 'wheelchair' || mobility === 'stroller';
}

/** Stairs a person can use with today's mobility (wheels need an integrated ramp; on foot or crutches any stairs). */
export function stairsPassable(tags: Record<string, string>, mobility: Mobility) {
  if (!onWheels(mobility)) return true;
  const bits = wayMobility(tags);
  return mobility === 'wheelchair' ? (bits & RAMP_WHEELCHAIR) !== 0 : (bits & RAMP_ANY) !== 0;
}

/** Grid spatial index over points stored in parallel lat/lon arrays. */
export class PointGrid {
  private cells = new Map<number, number[]>();

  constructor(
    readonly lat: ArrayLike<number>,
    readonly lon: ArrayLike<number>,
    readonly cell = 0.001,
    include: (i: number) => boolean = () => true,
  ) {
    for (let i = 0; i < lat.length; i++) {
      if (!include(i)) continue;
      const key = this.key(Math.floor(lat[i] / cell), Math.floor(lon[i] / cell));
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(i);
      else this.cells.set(key, [i]);
    }
  }

  private key(row: number, col: number) {
    return row * 100_000 + col;
  }

  /** Indices within `radius` metres, unsorted. */
  within(point: Point, radius: number): number[] {
    const dLat = radius / 111_320;
    const dLon = radius / (111_320 * Math.cos((point.lat * Math.PI) / 180));
    const result: number[] = [];
    const rowEnd = Math.floor((point.lat + dLat) / this.cell);
    const colEnd = Math.floor((point.lon + dLon) / this.cell);
    for (let row = Math.floor((point.lat - dLat) / this.cell); row <= rowEnd; row++) {
      for (let col = Math.floor((point.lon - dLon) / this.cell); col <= colEnd; col++) {
        for (const i of this.cells.get(this.key(row, col)) ?? []) {
          if (metres(point, { lat: this.lat[i], lon: this.lon[i] }) <= radius) result.push(i);
        }
      }
    }
    return result;
  }

  nearest(point: Point, radius: number): number {
    let best = -1;
    let bestDistance = Infinity;
    for (const i of this.within(point, radius)) {
      const d = metres(point, { lat: this.lat[i], lon: this.lon[i] });
      if (d < bestDistance) {
        best = i;
        bestDistance = d;
      }
    }
    return best;
  }
}

function featureGrid(features: OsmNode[]) {
  return new PointGrid(Float64Array.from(features, f => f.lat), Float64Array.from(features, f => f.lon));
}

export type WalkGraph = {
  obtainedAt: string;
  ids: string[];
  index: Map<string, number>;
  lat: Float64Array;
  lon: Float64Array;
  ways: Way[];
  /** CSR adjacency: outgoing edges of node n are offsets[n]..offsets[n+1]. */
  offsets: Int32Array;
  edgeFrom: Int32Array;
  edgeTo: Int32Array;
  edgeLength: Float64Array;
  edgeWay: Int32Array;
  edgeFlags: Uint8Array;
  /** Wheel-relevant way properties per edge (ROUGH, NARROW, ... bits). */
  edgeMobility: Uint16Array;
  /** Barriers per node (KERB_RAISED, STEP_BARRIER, ... bits). */
  nodeBarrier: Uint8Array;
  /** Source records of nodes with a barrier bit, for facts. */
  barrierNodes: Map<number, OsmNode>;
  /** Incoming edge ids of node n are inEdges[inOffsets[n]..inOffsets[n+1]]. */
  inOffsets: Int32Array;
  inEdges: Int32Array;
  /** 1 for nodes in the largest connected component. */
  connected: Uint8Array;
  nodeGrid: PointGrid;
  benches: OsmNode[];
  benchGrid: PointGrid;
  entrances: OsmNode[];
  entranceGrid: PointGrid;
};

function inclineDirection(tags: Record<string, string>): Direction {
  const incline = tags.incline;
  if (incline === 'up') return 'up';
  if (incline === 'down') return 'down';
  if (tags.highway === 'steps' && incline && /^-?\d/.test(incline) && parseFloat(incline) !== 0) {
    return parseFloat(incline) > 0 ? 'up' : 'down';
  }
  return 'unknown';
}

const blockedNode = (n: OsmNode) =>
  ['no', 'private'].includes(n.tags.access) || ['no', 'private'].includes(n.tags.foot) || ['wall', 'fence'].includes(n.tags.barrier);

export function buildGraph(data: Dataset): WalkGraph {
  const benches = data.features.filter(f => f.tags.amenity === 'bench');
  const entrances = data.features.filter(f => f.tags.entrance && !['garage', 'service', 'emergency', 'no'].includes(f.tags.entrance));
  const benchGrid = featureGrid(benches);

  const index = new Map<string, number>();
  const ids: string[] = [];
  const lats: number[] = [];
  const lons: number[] = [];
  const nodeOf = (id: string) => {
    let i = index.get(id);
    if (i === undefined) {
      i = ids.length;
      index.set(id, i);
      ids.push(id);
      lats.push(data.nodes[id].lat);
      lons.push(data.nodes[id].lon);
    }
    return i;
  };

  const from: number[] = [];
  const to: number[] = [];
  const length: number[] = [];
  const wayOf: number[] = [];
  const flags: number[] = [];
  const wayBits = new Uint16Array(data.ways.length);

  data.ways.forEach((way, w) => {
    wayBits[w] = wayMobility(way.tags);
    const steps = way.tags.highway === 'steps';
    const forward = inclineDirection(way.tags);
    const oneway = way.tags['oneway:foot'] ?? (steps ? way.tags.oneway : undefined);
    const base = (steps ? STEPS : 0) | (pedestrianHighways.has(way.tags.highway) ? PEDESTRIAN : 0) | (handrail(way.tags) === 'yes' ? HANDRAIL : 0);
    for (let i = 1; i < way.nodes.length; i++) {
      const a = data.nodes[way.nodes[i - 1]];
      const b = data.nodes[way.nodes[i]];
      if (!a || !b || blockedNode(a) || blockedNode(b)) continue;
      const ai = nodeOf(a.id);
      const bi = nodeOf(b.id);
      const d = metres(a, b);
      const directions: [number, number, Direction][] = [];
      if (oneway !== '-1') directions.push([ai, bi, forward]);
      if (oneway !== 'yes') directions.push([bi, ai, forward === 'up' ? 'down' : forward === 'down' ? 'up' : 'unknown']);
      for (const [f, t, direction] of directions) {
        from.push(f);
        to.push(t);
        length.push(d);
        wayOf.push(w);
        flags.push(base | (direction === 'up' ? UP : direction === 'down' ? DOWN : 0));
      }
    }
  });

  const n = ids.length;
  const m = from.length;
  const lat = Float64Array.from(lats);
  const lon = Float64Array.from(lons);

  // Bench proximity per node (either end of an edge within 25 m of a bench).
  const benchNode = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (benchGrid.within({ lat: lat[i], lon: lon[i] }, 25).length) benchNode[i] = 1;

  // Counting sort edges by source node into CSR order.
  const offsets = new Int32Array(n + 1);
  for (let e = 0; e < m; e++) offsets[from[e] + 1]++;
  for (let i = 0; i < n; i++) offsets[i + 1] += offsets[i];
  const cursor = offsets.slice(0, n);
  const edgeFrom = new Int32Array(m);
  const edgeTo = new Int32Array(m);
  const edgeLength = new Float64Array(m);
  const edgeWay = new Int32Array(m);
  const edgeFlags = new Uint8Array(m);
  const edgeMobility = new Uint16Array(m);
  for (let e = 0; e < m; e++) {
    const slot = cursor[from[e]]++;
    edgeFrom[slot] = from[e];
    edgeTo[slot] = to[e];
    edgeLength[slot] = length[e];
    edgeWay[slot] = wayOf[e];
    edgeFlags[slot] = flags[e] | (benchNode[from[e]] || benchNode[to[e]] ? BENCH : 0);
    edgeMobility[slot] = wayBits[wayOf[e]];
  }
  const barriers = new Uint8Array(n);
  const barrierNodes = new Map<number, OsmNode>();
  for (let i = 0; i < n; i++) {
    const source = data.nodes[ids[i]];
    const tags = source?.tags;
    if (!tags || !(tags.kerb || tags.barrier || tags.wheelchair)) continue;
    barriers[i] = nodeBarrier(tags);
    if (barriers[i]) barrierNodes.set(i, source);
  }

  const inOffsets = new Int32Array(n + 1);
  for (let e = 0; e < m; e++) inOffsets[edgeTo[e] + 1]++;
  for (let i = 0; i < n; i++) inOffsets[i + 1] += inOffsets[i];
  const inCursor = inOffsets.slice(0, n);
  const inEdges = new Int32Array(m);
  for (let e = 0; e < m; e++) inEdges[inCursor[edgeTo[e]]++] = e;

  // Largest weakly connected component via union-find.
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (x: number) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let e = 0; e < m; e++) {
    const a = find(edgeFrom[e]);
    const b = find(edgeTo[e]);
    if (a !== b) parent[b] = a;
  }
  const sizes = new Int32Array(n);
  let root = 0;
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (++sizes[r] > sizes[root]) root = r;
  }
  const connected = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (find(i) === root) connected[i] = 1;

  return {
    obtainedAt: data.obtainedAt,
    ids,
    index,
    lat,
    lon,
    ways: data.ways,
    offsets,
    edgeFrom,
    edgeTo,
    edgeLength,
    edgeWay,
    edgeFlags,
    edgeMobility,
    nodeBarrier: barriers,
    barrierNodes,
    inOffsets,
    inEdges,
    connected,
    nodeGrid: new PointGrid(lat, lon, 0.001, i => connected[i] === 1),
    benches,
    benchGrid,
    entrances,
    entranceGrid: featureGrid(entrances),
  };
}

export function nodePoint(g: WalkGraph, node: number): Point {
  return { lat: g.lat[node], lon: g.lon[node] };
}

/** Nearest node of the main connected network within `radius` metres, or -1. */
export function nearest(g: WalkGraph, point: Point, radius = 100) {
  return g.nodeGrid.nearest(point, radius);
}

export function edgeAt(g: WalkGraph, e: number): Edge {
  const flags = g.edgeFlags[e];
  return {
    index: e,
    from: g.ids[g.edgeFrom[e]],
    to: g.ids[g.edgeTo[e]],
    way: g.ways[g.edgeWay[e]],
    distance: g.edgeLength[e],
    direction: flags & UP ? 'up' : flags & DOWN ? 'down' : 'unknown',
    benchNearby: (flags & BENCH) !== 0,
  };
}

function forbiddenFlags(flags: number, p: Preferences, mobility = 0) {
  if (!(flags & STEPS)) return false;
  if (p.mobility === 'wheelchair') return !(mobility & RAMP_WHEELCHAIR);
  if (p.mobility === 'stroller' && !(mobility & RAMP_ANY)) return true;
  if (p.avoidStairs) return true;
  if (p.avoidDown && !(flags & UP)) return true; // down or unknown
  if (p.avoidUp && !(flags & DOWN)) return true; // up or unknown
  return false;
}

/** Stairs that today's preferences exclude. Unknown direction never satisfies a directional exclusion. */
export function forbidden(edge: Edge, p: Preferences) {
  if (edge.way.tags.highway !== 'steps') return false;
  if (!stairsPassable(edge.way.tags, p.mobility)) return true;
  if (p.mobility === 'wheelchair') return false;
  return p.avoidStairs || (p.avoidDown && edge.direction !== 'up') || (p.avoidUp && edge.direction !== 'down');
}

/**
 * Extra cost for wheels (multiples of length for ways, fixed metres for node barriers).
 * Wheelchair: raised kerbs, step-like barriers, narrow (< 0.9 m), `wheelchair=no` and
 * impassable ways are excluded. Pushchair: the same things only cost more.
 */
const wheelCosts = {
  wheelchair: { rough: 2, veryRough: 5, steep: 3, narrow: Infinity, noWheelchair: Infinity, kerbRaised: Infinity, kerbUnknown: 60, kerbRolled: 30, step: Infinity, nodeNo: Infinity },
  stroller: { rough: 1, veryRough: 2.5, steep: 1, narrow: 0.5, noWheelchair: 1, kerbRaised: 40, kerbUnknown: 20, kerbRolled: 10, step: 80, nodeNo: 0 },
} as const;

function wheelCost(g: WalkGraph, e: number, mobility: 'wheelchair' | 'stroller', length: number) {
  const c = wheelCosts[mobility];
  const bits = g.edgeMobility[e];
  let factor = 0;
  if (bits) {
    if (bits & IMPASSABLE) return Infinity;
    if (bits & VERY_ROUGH) factor += c.veryRough;
    else if (bits & ROUGH) factor += c.rough;
    if (bits & STEEP) factor += c.steep;
    if (bits & NARROW) factor += c.narrow;
    if (bits & NO_WHEELCHAIR) factor += c.noWheelchair;
  }
  let fixed = 0;
  const node = g.nodeBarrier[g.edgeTo[e]];
  if (node) {
    if (node & KERB_RAISED) fixed += c.kerbRaised;
    else if (node & KERB_UNKNOWN) fixed += c.kerbUnknown;
    else if (node & KERB_ROLLED) fixed += c.kerbRolled;
    if (node & STEP_BARRIER) fixed += c.step;
    if (node & NODE_NO_WHEELCHAIR) fixed += c.nodeNo;
  }
  if (factor === Infinity || fixed === Infinity) return Infinity;
  return factor * length + fixed;
}

/**
 * Walking on crutches: stairs are allowed (subject to the stair preferences) but cost much more
 * without a known handrail and on long flights; rough surfaces and raised kerbs cost a little;
 * detours along footpaths are worth less than for walking (shorter is better).
 */
export const crutchCosts = { stairs: 1, noHandrail: 6, noHandrailFixed: 20, longFlight: 4, longFlightFixed: 30, rough: 1, veryRough: 2, steep: 1, kerbRaised: 15, step: 25, street: 0.1 } as const;

function crutchCost(g: WalkGraph, e: number, flags: number, length: number) {
  const c = crutchCosts;
  const bits = g.edgeMobility[e];
  let cost = 0;
  if (flags & STEPS) {
    cost += c.stairs * length;
    if (!(flags & HANDRAIL)) cost += c.noHandrail * length + c.noHandrailFixed;
    if (bits & LONG_FLIGHT) cost += c.longFlight * length + c.longFlightFixed;
  } else if (bits) {
    if (bits & IMPASSABLE) return Infinity;
    if (bits & VERY_ROUGH) cost += c.veryRough * length;
    else if (bits & ROUGH) cost += c.rough * length;
    if (bits & STEEP) cost += c.steep * length;
  }
  const node = g.nodeBarrier[g.edgeTo[e]];
  if (node & KERB_RAISED) cost += c.kerbRaised;
  if (node & STEP_BARRIER) cost += c.step;
  return cost;
}

/** Benches matter for routing when resting is preferred or rest stops are planned. */
export function wantsRest(p: Preferences) {
  return p.preferRest || (p.restEvery ?? 0) > 0;
}

/** Routing cost of an edge, Infinity when excluded. Cost is never below its length. */
export function edgeCost(g: WalkGraph, e: number, p: Preferences | null, penalise?: Uint8Array) {
  const length = g.edgeLength[e];
  let cost = length;
  if (p) {
    const flags = g.edgeFlags[e];
    if (forbiddenFlags(flags, p, g.edgeMobility[e])) return Infinity;
    if (onWheels(p.mobility)) {
      cost += wheelCost(g, e, p.mobility, length);
      if (cost === Infinity) return Infinity;
    } else if (p.mobility === 'crutches') {
      cost += crutchCost(g, e, flags, length);
      if (cost === Infinity) return Infinity;
    }
    if (!(flags & PEDESTRIAN)) cost += length * (p.mobility === 'crutches' ? crutchCosts.street : 0.3);
    if (wantsRest(p) && !(flags & BENCH)) cost += length * 0.25;
    if (p.preferHandrails && flags & STEPS && !(flags & HANDRAIL)) cost += length * 5;
  }
  if (penalise && penalise[g.edgeWay[e]]) cost += length * 3;
  return cost;
}

/** Binary min-heap of (node, cost) pairs. */
export class Heap {
  private nodes: number[] = [];
  private costs: number[] = [];

  get size() {
    return this.nodes.length;
  }

  push(node: number, cost: number) {
    let i = this.nodes.length;
    this.nodes.push(node);
    this.costs.push(cost);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.costs[p] <= cost) break;
      this.nodes[i] = this.nodes[p];
      this.costs[i] = this.costs[p];
      i = p;
    }
    this.nodes[i] = node;
    this.costs[i] = cost;
  }

  /** Removes the minimum; returns its node. Read `lastCost` for its cost. */
  lastCost = 0;
  pop(): number {
    const top = this.nodes[0];
    this.lastCost = this.costs[0];
    const node = this.nodes.pop()!;
    const cost = this.costs.pop()!;
    const size = this.nodes.length;
    if (size) {
      let i = 0;
      while (true) {
        let c = i * 2 + 1;
        if (c >= size) break;
        if (c + 1 < size && this.costs[c + 1] < this.costs[c]) c++;
        if (cost <= this.costs[c]) break;
        this.nodes[i] = this.nodes[c];
        this.costs[i] = this.costs[c];
        i = c;
      }
      this.nodes[i] = node;
      this.costs[i] = cost;
    }
    return top;
  }
}

/**
 * A* shortest path between two nodes. Returns edge ids in travel order,
 * [] when start === end, or null when unreachable under the preferences.
 */
export function shortestPath(g: WalkGraph, start: number, end: number, p: Preferences | null, penalise?: Uint8Array): number[] | null {
  if (start === end) return [];
  const n = g.ids.length;
  const cost = new Float64Array(n).fill(Infinity);
  const previous = new Int32Array(n).fill(-1);
  const r = Math.PI / 180;
  const kx = 6371000 * r * Math.cos(g.lat[end] * r) * 0.995;
  const ky = 6371000 * r * 0.995;
  const heuristic = (i: number) => Math.hypot((g.lon[i] - g.lon[end]) * kx, (g.lat[i] - g.lat[end]) * ky);
  const heap = new Heap();
  cost[start] = 0;
  heap.push(start, heuristic(start));
  while (heap.size) {
    const node = heap.pop();
    if (node === end) break;
    const base = cost[node];
    if (heap.lastCost > base + heuristic(node) + 1e-6) continue; // stale entry
    for (let e = g.offsets[node]; e < g.offsets[node + 1]; e++) {
      const c = edgeCost(g, e, p, penalise);
      if (c === Infinity) continue;
      const next = base + c;
      const t = g.edgeTo[e];
      if (next < cost[t]) {
        cost[t] = next;
        previous[t] = e;
        heap.push(t, next + heuristic(t));
      }
    }
  }
  if (previous[end] === -1) return null;
  const path: number[] = [];
  for (let node = end; node !== start; node = g.edgeFrom[previous[node]]) path.push(previous[node]);
  return path.reverse();
}

export type Reach = {
  /** Walked metres from the origin (or to the target for reverse searches). */
  distance: Map<number, number>;
  /** Edge ids in travel order between the search origin and `node`. */
  path(node: number): number[] | null;
};

/**
 * Bounded Dijkstra from `origin` (forward) or towards `origin` (reverse),
 * stopping once every target is settled or the cost exceeds `maxCost`.
 */
export function reach(g: WalkGraph, origin: number, p: Preferences | null, maxCost: number, targets: Set<number>, reverse = false): Reach {
  const cost = new Map<number, number>([[origin, 0]]);
  const distance = new Map<number, number>([[origin, 0]]);
  const via = new Map<number, number>();
  const settled = new Set<number>();
  const heap = new Heap();
  heap.push(origin, 0);
  let remaining = targets.size;
  while (heap.size && remaining > 0) {
    const node = heap.pop();
    if (settled.has(node)) continue;
    settled.add(node);
    if (targets.has(node)) remaining--;
    const base = cost.get(node)!;
    const start = reverse ? g.inOffsets[node] : g.offsets[node];
    const end = reverse ? g.inOffsets[node + 1] : g.offsets[node + 1];
    for (let k = start; k < end; k++) {
      const e = reverse ? g.inEdges[k] : k;
      const c = edgeCost(g, e, p);
      if (c === Infinity) continue;
      const next = base + c;
      if (next > maxCost) continue;
      const other = reverse ? g.edgeFrom[e] : g.edgeTo[e];
      if (next < (cost.get(other) ?? Infinity)) {
        cost.set(other, next);
        distance.set(other, distance.get(node)! + g.edgeLength[e]);
        via.set(other, e);
        heap.push(other, next);
      }
    }
  }
  for (const node of [...distance.keys()]) if (!settled.has(node)) distance.delete(node);
  return {
    distance,
    path(node) {
      if (!settled.has(node)) return null;
      const edges: number[] = [];
      while (node !== origin) {
        const e = via.get(node)!;
        edges.push(e);
        node = reverse ? g.edgeTo[e] : g.edgeFrom[e];
      }
      return reverse ? edges : edges.reverse();
    },
  };
}
