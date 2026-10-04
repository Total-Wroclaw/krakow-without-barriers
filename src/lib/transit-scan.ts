// Connection scan over a timetable window. Pure functions, no I/O.

export function activeServices(calendars: { service: string; start: string; end: string; days: string }[], exceptions: { service: string; type: number }[], date: string) {
  const day = (new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T12:00:00Z`).getUTCDay() + 6) % 7;
  const active = new Set(calendars.filter(c => c.start <= date && c.end >= date && c.days.split(',')[day] === '1').map(c => c.service));
  for (const e of exceptions) {
    if (e.type === 1) active.add(e.service);
    else active.delete(e.service);
  }
  return active;
}

export function gtfsTime(seconds: number) {
  const day = Math.floor(seconds / 86400);
  const within = ((seconds % 86400) + 86400) % 86400;
  return `${String(Math.floor(within / 3600)).padStart(2, '0')}:${String(Math.floor(within / 60) % 60).padStart(2, '0')}${day > 0 ? ` (+${day} dzień)` : ''}`;
}

/** Connections sorted by departure, with stops and trips interned to integers. */
export type ConnectionTable = {
  count: number;
  departure: Int32Array;
  arrival: Int32Array;
  from: Int32Array;
  to: Int32Array;
  trip: Int32Array;
  sequence: Int32Array;
  canBoard: Uint8Array;
  canAlight: Uint8Array;
  tripCount: number;
  stopCount: number;
};

/** Walking transfers between nearby stops: neighbours of s are targets[offsets[s]..offsets[s+1]]. */
export type Footpaths = { offsets: Int32Array; targets: Int32Array; seconds: Int32Array };

/** Build a ConnectionTable from rows with already-interned stop indices. GTFS pickup/drop-off type 1 means "not available". */
export function connectionTable(rows: { trip: number; from: number; to: number; departure: number; arrival: number; sequence: number; pickup: number; dropoff: number }[], tripCount: number, stopCount: number): ConnectionTable {
  const sorted = [...rows].sort((a, b) => a.departure - b.departure || a.trip - b.trip || a.sequence - b.sequence);
  const count = sorted.length;
  const table: ConnectionTable = {
    count,
    departure: new Int32Array(count),
    arrival: new Int32Array(count),
    from: new Int32Array(count),
    to: new Int32Array(count),
    trip: new Int32Array(count),
    sequence: new Int32Array(count),
    canBoard: new Uint8Array(count),
    canAlight: new Uint8Array(count),
    tripCount,
    stopCount,
  };
  sorted.forEach((c, i) => {
    table.departure[i] = c.departure;
    table.arrival[i] = c.arrival;
    table.from[i] = c.from;
    table.to[i] = c.to;
    table.trip[i] = c.trip;
    table.sequence[i] = c.sequence;
    table.canBoard[i] = c.pickup === 1 ? 0 : 1;
    table.canAlight[i] = c.dropoff === 1 ? 0 : 1;
  });
  return table;
}

/** Copy of a table keeping only connections where `keep(i)` is true (order preserved). */
function filterConnections(table: ConnectionTable, keep: (i: number) => boolean): ConnectionTable {
  const indices: number[] = [];
  for (let i = 0; i < table.count; i++) if (keep(i)) indices.push(i);
  const pick = <T extends Int32Array | Uint8Array>(source: T, target: T) => {
    indices.forEach((from, to) => (target[to] = source[from]));
    return target;
  };
  const count = indices.length;
  return {
    count,
    departure: pick(table.departure, new Int32Array(count)),
    arrival: pick(table.arrival, new Int32Array(count)),
    from: pick(table.from, new Int32Array(count)),
    to: pick(table.to, new Int32Array(count)),
    trip: pick(table.trip, new Int32Array(count)),
    sequence: pick(table.sequence, new Int32Array(count)),
    canBoard: pick(table.canBoard, new Uint8Array(count)),
    canAlight: pick(table.canAlight, new Uint8Array(count)),
    tripCount: table.tripCount,
    stopCount: table.stopCount,
  };
}

/**
 * Connections usable today. For a wheelchair, trips with GTFS wheelchair_accessible=2
 * (`tripAccess[trip] === 2`) are removed; unknown (0) and accessible (1) trips stay.
 */
export function usableConnections(table: ConnectionTable, tripAccess: Uint8Array, mobility: 'walk' | 'wheelchair' | 'stroller') {
  if (mobility !== 'wheelchair' || !tripAccess.includes(2)) return table;
  return filterConnections(table, i => tripAccess[table.trip[i]] !== 2);
}

export function emptyFootpaths(stopCount: number): Footpaths {
  return { offsets: new Int32Array(stopCount + 1), targets: new Int32Array(0), seconds: new Int32Array(0) };
}

type JourneyPart =
  | { kind: 'ride'; board: number; alight: number }
  | { kind: 'walk'; from: number; to: number; seconds: number };

export type ScanJourney = {
  boardings: number;
  startStop: number;
  endStop: number;
  accessSeconds: number;
  egressSeconds: number;
  /** Latest time to leave the origin and still make the first boarding (with buffer). */
  leave: number;
  arrival: number;
  parts: JourneyPart[];
};

type Record =
  | { kind: 'access'; stop: number; seconds: number }
  | { kind: 'ride'; board: number; alight: number; prev: Record }
  | { kind: 'walk'; from: number; to: number; seconds: number; prev: Record };

export type ScanOptions = {
  table: ConnectionTable;
  footpaths: Footpaths;
  /** Stop index -> walking seconds from the origin. */
  access: Map<number, number>;
  /** Stop index -> walking seconds to the destination. */
  egress: Map<number, number>;
  departure: number;
  maxBoardings?: number;
  /** Change time when staying at the same stop. */
  sameStopTransfer?: number;
  /** Buffer before the first boarding. */
  boardingBuffer?: number;
  /** Keep scanning this long after the best arrival to find journeys with fewer boardings. */
  slack?: number;
};

function firstAtOrAfter(values: Int32Array, count: number, target: number) {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Earliest-arrival connection scan with up to `maxBoardings` vehicles and
 * walking transfers via footpaths. Returns the Pareto set over boardings:
 * for each boarding count, the earliest arrival, kept only if it beats every
 * journey with fewer boardings. Sorted by boardings ascending.
 */
export function scan(options: ScanOptions): ScanJourney[] {
  const { table, footpaths, access, egress, departure } = options;
  const K = options.maxBoardings ?? 3;
  const sameStop = options.sameStopTransfer ?? 120;
  const buffer = options.boardingBuffer ?? 60;
  const slack = options.slack ?? 1200;
  const S = table.stopCount;

  const ready: Float64Array[] = [];
  const readyRec: (Record | undefined)[][] = [];
  const arrived: Float64Array[] = [];
  const boardConn: Int32Array[] = [];
  const boardPrev: (Record | undefined)[][] = [];
  for (let k = 0; k <= K; k++) {
    ready.push(new Float64Array(S).fill(Infinity));
    readyRec.push(new Array(S));
    arrived.push(new Float64Array(S).fill(Infinity));
    boardConn.push(new Int32Array(table.tripCount).fill(-1));
    boardPrev.push(new Array(table.tripCount));
  }
  for (const [stop, seconds] of access) {
    const time = departure + seconds + buffer;
    if (time < ready[0][stop]) {
      ready[0][stop] = time;
      readyRec[0][stop] = { kind: 'access', stop, seconds };
    }
  }
  const egressSeconds = new Float64Array(S).fill(Infinity);
  for (const [stop, seconds] of egress) egressSeconds[stop] = Math.min(egressSeconds[stop], seconds);

  const best = new Float64Array(K + 1).fill(Infinity);
  const bestRec: (Record | undefined)[] = new Array(K + 1);
  const bestEnd = new Int32Array(K + 1).fill(-1);
  let bestOverall = Infinity;

  for (let i = firstAtOrAfter(table.departure, table.count, departure); i < table.count; i++) {
    const dep = table.departure[i];
    if (dep > bestOverall + slack) break;
    const trip = table.trip[i];
    const from = table.from[i];
    const to = table.to[i];
    for (let k = 1; k <= K; k++) {
      if (boardConn[k][trip] === -1) {
        if (!table.canBoard[i] || ready[k - 1][from] > dep) continue;
        boardConn[k][trip] = i;
        boardPrev[k][trip] = readyRec[k - 1][from];
      }
      if (!table.canAlight[i]) continue;
      const arrival = table.arrival[i];
      if (arrival >= arrived[k][to]) continue;
      arrived[k][to] = arrival;
      const record: Record = { kind: 'ride', board: boardConn[k][trip], alight: i, prev: boardPrev[k][trip]! };
      const total = arrival + egressSeconds[to];
      if (total < best[k]) {
        best[k] = total;
        bestRec[k] = record;
        bestEnd[k] = to;
        if (total < bestOverall) bestOverall = total;
      }
      if (k === K) continue;
      if (arrival + sameStop < ready[k][to]) {
        ready[k][to] = arrival + sameStop;
        readyRec[k][to] = record;
      }
      for (let f = footpaths.offsets[to]; f < footpaths.offsets[to + 1]; f++) {
        const target = footpaths.targets[f];
        const time = arrival + footpaths.seconds[f];
        if (time < ready[k][target]) {
          ready[k][target] = time;
          readyRec[k][target] = { kind: 'walk', from: to, to: target, seconds: footpaths.seconds[f], prev: record };
        }
      }
    }
  }

  const journeys: ScanJourney[] = [];
  let bound = Infinity;
  for (let k = 1; k <= K; k++) {
    if (!(best[k] < bound)) continue;
    bound = best[k];
    const parts: JourneyPart[] = [];
    let record: Record | undefined = bestRec[k];
    let startStop = -1;
    let accessSeconds = 0;
    while (record) {
      if (record.kind === 'access') {
        startStop = record.stop;
        accessSeconds = record.seconds;
        break;
      }
      parts.push(record.kind === 'ride' ? { kind: 'ride', board: record.board, alight: record.alight } : { kind: 'walk', from: record.from, to: record.to, seconds: record.seconds });
      record = record.prev;
    }
    parts.reverse();
    const first = parts[0];
    if (first?.kind !== 'ride') continue;
    const endStop = bestEnd[k];
    journeys.push({
      boardings: parts.filter(p => p.kind === 'ride').length,
      startStop,
      endStop,
      accessSeconds,
      egressSeconds: egressSeconds[endStop],
      leave: table.departure[first.board] - accessSeconds - buffer,
      arrival: best[k],
      parts,
    });
  }
  return journeys;
}
