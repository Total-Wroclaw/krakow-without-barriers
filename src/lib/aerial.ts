// Aerial view of a place: sourced facts to draw on the orthophoto (OSM entrances, stairs, rough surfaces,
// kerbs, benches; ZTP stops with lines; OSM parking; accessible toilets), the grounded context given to the
// model (facts, earlier user reports, the place's Explore facts, today's needs, weather) and validation of
// what the model returns.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { compass, distance, inFrame, OVERLAY_RADIUS, project, unproject, type Bbox } from './aerial-geo';
import { lineMiddle, observationKinds, type AerialAnalysis, type AerialLine, type AerialMarker, type AerialObservation, type AerialOverlay, type AerialPin, type ObservationKind, type Weather, type Wheelchair } from './aerial-types';
import { handrail } from './data';
import { widthCm } from './objects';
import { runtimeDir } from './server';
import type { Point, Stop } from './city-types';
import type { PlaceObject } from './explore-types';
import type { WalkGraph } from './routing';
import type { Preferences, Report } from './schemas';

/** Limits keep the photo readable: the nearest few of each kind. */
const LIMITS = { entrance: 6, stop: 6, parking: 4, toilet: 2, bench: 40, kerb: 40, step: 20, line: 70 } as const;
/** Entrances further than this from the place's point most likely belong to other buildings. */
const ENTRANCE_RADIUS = 100;
/** When no stop is in the frame, the nearest ones within this radius are still listed (outside the photo). */
const FAR_STOP_RADIUS = 500;
/** Same stop name closer than this is one physical platform. */
const SAME_PLATFORM = 15;
/** Earlier user reports within this distance are given to the model. */
export const REPORT_RADIUS = 150;

export type OverlayInputs = {
  /** Entrance ids of the place's own building, when known: then only those are shown. */
  ownEntrances?: string[] | null;
  entrances: { id: string; lat: number; lon: number; tags: Record<string, string>; editedAt: string | null }[];
  stops: (Stop & { lines?: string[] })[];
  parking: { id: string; name: string | null; lat: number; lon: number; disabledSpaces: number | null; editedAt: string | null; fee?: 'yes' | 'no' | 'unknown'; capacity?: number | null }[];
  toilets: { objectId: string; name: string | null; lat: number; lon: number; sourceUrl: string; editedAt: string | null; value?: 'yes' | 'limited' }[];
  markers: AerialMarker[];
  lines: AerialLine[];
};

const yesNo = (v: string | undefined): Wheelchair => (v === 'yes' || v === 'designated' ? 'yes' : v === 'limited' ? 'limited' : v === 'no' ? 'no' : 'unknown');
const osmUrl = (id: string) => `https://www.openstreetmap.org/${id.replace(':', '/')}`;
const nearestFirst = <T extends Point>(place: Point, list: T[], radius: number, limit: number) =>
  list.map(item => ({ item, d: distance(place, item) })).filter(x => x.d <= radius).sort((a, b) => a.d - b.d).slice(0, limit);
const byLineNumber = (a: string, b: string) => a.localeCompare(b, 'pl', { numeric: true });

/**
 * Numbered pins in a fixed order (entrances, stops, parking, toilets), nearest first within each kind,
 * so ① is always the nearest mapped entrance and numbers don't change while the user moves the map.
 */
export function buildOverlay(place: Point, input: OverlayInputs): Omit<AerialOverlay, 'osmObtainedAt' | 'transitObtainedAt'> {
  const pins: AerialPin[] = [];
  const add = (pin: Omit<AerialPin, 'n' | 'distance' | 'compass'>) =>
    pins.push({ ...pin, n: pins.length + 1, distance: Math.round(distance(place, pin)), compass: compass(place, pin) });

  // When the place's building is known, only its entrances are pins: a neighbour's door would only mislead.
  const own = input.ownEntrances?.length ? new Set(input.ownEntrances.map(id => id.replace(/^node[:/]/, ''))) : null;
  const entrances = own ? input.entrances.filter(e => own.has(e.id.replace(/^node[:/]/, ''))) : input.entrances;
  for (const { item: e } of nearestFirst(place, entrances, ENTRANCE_RADIUS, LIMITS.entrance)) {
    const steps = /^\d+$/.test(e.tags.step_count ?? '') ? Number(e.tags.step_count) : undefined;
    const ramp = e.tags['ramp:wheelchair'] === 'yes' || e.tags.ramp === 'yes' ? true : e.tags.ramp === 'no' ? false : undefined;
    const door = widthCm(e.tags['door:width'] ?? e.tags.width);
    add({
      kind: 'entrance', lat: e.lat, lon: e.lon, name: e.tags.name ?? e.tags.ref ?? null, sourceUrl: osmUrl(`node:${e.id.replace(/^node[:/]/, '')}`), editedAt: e.editedAt,
      wheelchair: yesNo(e.tags.wheelchair), main: e.tags.entrance === 'main', ofPlace: !!own,
      ...(steps !== undefined ? { steps } : {}), ...(ramp !== undefined ? { ramp } : {}), ...(door ? { doorWidth: door } : {}),
      ...(e.tags.automatic_door && e.tags.automatic_door !== 'no' ? { automaticDoor: true } : {}),
    });
  }

  // Each platform is its own pin (they stand on different sides of a street); the same platform
  // listed by several GTFS feeds (bus, tram, agglomeration) is merged into one.
  const platforms: { stop: Stop; modes: Set<'tram' | 'bus'>; lines: Set<string> }[] = [];
  for (const s of input.stops) {
    const mode = s.id.startsWith('T:') ? 'tram' : 'bus';
    let same = platforms.find(p => p.stop.name === s.name && distance(p.stop, s) < SAME_PLATFORM);
    if (!same) platforms.push((same = { stop: s, modes: new Set(), lines: new Set() }));
    same.modes.add(mode);
    for (const line of s.lines ?? []) same.lines.add(line);
  }
  const located = platforms.map(p => ({ ...p, lat: p.stop.lat, lon: p.stop.lon }));
  let stops = nearestFirst(place, located, OVERLAY_RADIUS, LIMITS.stop);
  if (!stops.length) stops = nearestFirst(place, located, FAR_STOP_RADIUS, 2);
  for (const { item: { stop: s, modes, lines } } of stops) {
    add({
      kind: 'stop', lat: s.lat, lon: s.lon, name: s.name, sourceUrl: 'https://gtfs.ztp.krakow.pl/', editedAt: null,
      modes: (['tram', 'bus'] as const).filter(m => modes.has(m)), ...(s.code ? { platform: s.code.split('-').pop() } : {}),
      ...(lines.size ? { lines: [...lines].sort(byLineNumber).slice(0, 16) } : {}),
      wheelchair: s.wheelchair === '1' ? 'yes' : s.wheelchair === '2' ? 'no' : 'unknown',
    });
  }
  for (const { item: p } of nearestFirst(place, input.parking, OVERLAY_RADIUS, LIMITS.parking)) {
    add({ kind: 'parking', lat: p.lat, lon: p.lon, name: p.name, sourceUrl: osmUrl(p.id), editedAt: p.editedAt, disabledSpaces: p.disabledSpaces, fee: p.fee ?? 'unknown', capacity: p.capacity ?? null });
  }
  for (const { item: t } of nearestFirst(place, input.toilets, OVERLAY_RADIUS, LIMITS.toilet)) {
    add({ kind: 'toilet', lat: t.lat, lon: t.lon, name: t.name, sourceUrl: t.sourceUrl, editedAt: t.editedAt, wheelchair: t.value ?? 'yes' });
  }

  const markers = (['bench', 'kerb', 'step'] as const).flatMap(kind => nearestFirst(place, input.markers.filter(m => m.kind === kind), OVERLAY_RADIUS, LIMITS[kind]).map(x => x.item));
  return { place: { lat: place.lat, lon: place.lon }, pins, markers, lines: input.lines.slice(0, LIMITS.line) };
}

const roughSurfaces = new Set(['sett', 'cobblestone', 'unhewn_cobblestone', 'cobblestone:flattened', 'gravel', 'pebblestone', 'unpaved', 'ground', 'dirt', 'grass', 'sand', 'woodchips', 'grass_paver', 'stepping_stones']);
/** Rough surface on a way people walk along or cross (streets paved with setts count too). */
const roughWay = (tags: Record<string, string>) => roughSurfaces.has(tags.surface) || ['bad', 'very_bad', 'horrible', 'very_horrible', 'impassable'].includes(tags.smoothness);

/** Stairs and rough pedestrian surfaces around the place from the walking graph, as polylines. */
export function graphLines(g: WalkGraph, place: Point, radius = OVERLAY_RADIUS): AerialLine[] {
  const ways = new Map<number, number>();
  for (const node of g.nodeGrid.within(place, radius)) {
    for (let e = g.offsets[node]; e < g.offsets[node + 1]; e++) {
      const w = g.edgeWay[e];
      if (!ways.has(w)) ways.set(w, distance(place, { lat: g.lat[node], lon: g.lon[node] }));
    }
  }
  const out: { line: AerialLine; d: number }[] = [];
  for (const [w, d] of ways) {
    const way = g.ways[w];
    const stairs = way.tags.highway === 'steps';
    if (!stairs && !roughWay(way.tags)) continue;
    // Keep only the part of the way near the photo; long paths through parks are trimmed.
    const points: [number, number][] = [];
    for (const id of way.nodes) {
      const i = g.index.get(id);
      if (i === undefined) continue;
      const p = { lat: g.lat[i], lon: g.lon[i] };
      if (distance(place, p) <= radius * 1.6) points.push([Math.round(p.lat * 1e6) / 1e6, Math.round(p.lon * 1e6) / 1e6]);
    }
    if (points.length < 2) continue;
    const id = `way:${way.id.replace(/^way[:/]/, '')}`;
    const steps = /^\d+$/.test(way.tags.step_count ?? '') ? Number(way.tags.step_count) : undefined;
    const line: AerialLine = stairs
      ? { id, kind: 'stairs', points, editedAt: way.editedAt, handrail: handrail(way.tags), ...(steps !== undefined ? { steps } : {}), ...(way.tags.ramp === 'yes' || way.tags['ramp:wheelchair'] === 'yes' ? { ramp: true } : {}) }
      : { id, kind: 'rough', points, editedAt: way.editedAt, ...(way.tags.surface ? { surface: way.tags.surface } : {}) };
    out.push({ line, d });
  }
  // Stairs first: they matter more than surfaces when the limit is reached.
  return out.sort((a, b) => Number(b.line.kind === 'stairs') - Number(a.line.kind === 'stairs') || a.d - b.d).map(x => x.line);
}

/** Raised kerbs, single steps and benches near the place. */
export function graphMarkers(g: WalkGraph, place: Point, radius = OVERLAY_RADIUS): AerialMarker[] {
  const markers: AerialMarker[] = [];
  for (const node of g.nodeGrid.within(place, radius)) {
    const tags = g.barrierNodes.get(node)?.tags;
    if (!tags) continue;
    if (tags.kerb === 'raised' || tags.kerb === 'normal') markers.push({ kind: 'kerb', lat: g.lat[node], lon: g.lon[node] });
    else if (tags.barrier === 'step') markers.push({ kind: 'step', lat: g.lat[node], lon: g.lon[node] });
  }
  for (const i of g.benchGrid.within(place, radius)) markers.push({ kind: 'bench', lat: g.benches[i].lat, lon: g.benches[i].lon });
  return markers;
}

let transitDate: string | null | undefined;
function transitObtainedAt() {
  if (transitDate !== undefined) return transitDate;
  try {
    transitDate = (JSON.parse(readFileSync(path.join(/* turbopackIgnore: true */ process.cwd(), 'data/transit-metadata.json'), 'utf8')) as { obtainedAt?: string }).obtainedAt ?? null;
  } catch {
    transitDate = null;
  }
  return transitDate;
}

let linesByStop: Map<string, string[]> | null | undefined;
/** Line numbers departing from each GTFS stop: one pass over the timetable per process (~1 s), then memory. */
function stopLines() {
  if (linesByStop !== undefined) return linesByStop;
  try {
    const file = process.env.KROK_TRANSIT_DB ?? path.join(runtimeDir, 'transit.sqlite');
    if (!existsSync(file)) return (linesByStop = null);
    const db = new DatabaseSync(file, { readOnly: true });
    const rows = db.prepare('SELECT DISTINCT c.from_id AS stop, r.name AS line FROM connections c JOIN trips t ON t.id = c.trip JOIN routes r ON r.id = t.route').all() as { stop: string; line: string }[];
    db.close();
    linesByStop = new Map();
    for (const { stop, line } of rows) {
      const list = linesByStop.get(stop);
      if (list) list.push(line);
      else linesByStop.set(stop, [line]);
    }
  } catch {
    linesByStop = null;
  }
  return linesByStop;
}

const overlays = new Map<string, AerialOverlay>();

/** Overlay for a (rounded) point. Each source is optional: a missing dataset only removes its pins. */
export async function overlayAt(place: Point): Promise<AerialOverlay> {
  const key = `${place.lat},${place.lon}`;
  const hit = overlays.get(key);
  if (hit) return hit;
  const [{ cityGraph }, { transitStops }, { parkingsNear }, { accessibleToilets, ownEntrancesAt }] = await Promise.all([import('./city-graph'), import('./transit'), import('./parking'), import('./objects')]);
  const safe = <T,>(f: () => T[]): T[] => {
    try {
      return f();
    } catch {
      return [];
    }
  };
  const g = (() => {
    try {
      return cityGraph();
    } catch {
      return null;
    }
  })();
  const near = <T extends Point>(list: T[]) => list.filter(x => Math.abs(x.lat - place.lat) < 0.01 && Math.abs(x.lon - place.lon) < 0.015);
  const lines = stopLines();
  const overlay: AerialOverlay = {
    ...buildOverlay(place, {
      ownEntrances: (() => {
        try {
          return ownEntrancesAt(place);
        } catch {
          return null;
        }
      })(),
      entrances: g ? g.entranceGrid.within(place, ENTRANCE_RADIUS).map(i => g.entrances[i]) : [],
      stops: safe(() => near(transitStops()).map(s => ({ ...s, lines: lines?.get(s.id) ?? [] }))),
      parking: safe(() => parkingsNear(place, OVERLAY_RADIUS, { disabledOnly: true })),
      toilets: safe(() => near(accessibleToilets())),
      markers: g ? graphMarkers(g, place) : [],
      lines: g ? graphLines(g, place) : [],
    }),
    osmObtainedAt: g?.obtainedAt ?? null,
    transitObtainedAt: transitObtainedAt(),
  };
  if (overlays.size > 300) overlays.clear();
  overlays.set(key, overlay);
  return overlay;
}

// ---------- Context for the model ----------

/** Where a point is in the analysed photo, or the compass direction when outside it. */
function at(p: Point, bbox: Bbox, place: Point) {
  const pos = project(p, bbox);
  return inFrame(pos, 0) ? `x=${pos.x.toFixed(2)}, y=${pos.y.toFixed(2)}` : `poza kadrem, ${compass(place, p).toUpperCase()}`;
}

/** Pins with their sourced facts and image positions, for the model (Polish; the model answers in the user's language). */
export function pinsForPrompt(overlay: AerialOverlay, bbox: Bbox) {
  return overlay.pins.map(pin => {
    const facts: string[] = [];
    if (pin.kind === 'entrance') {
      facts.push(`wejście${pin.main ? ' główne' : ''} ${pin.ofPlace ? 'do budynku tego miejsca' : 'w okolicy (nie wiadomo, czy do tego miejsca; może należeć do sąsiedniego budynku)'}`, `wheelchair=${pin.wheelchair}`);
      if (pin.steps !== undefined) facts.push(`step_count=${pin.steps}`);
      if (pin.ramp !== undefined) facts.push(`ramp=${pin.ramp ? 'yes' : 'no'}`);
      if (pin.doorWidth) facts.push(`door:width=${pin.doorWidth}cm`);
      if (pin.automaticDoor) facts.push('automatic_door=yes');
    } else if (pin.kind === 'stop') {
      facts.push(`przystanek ${JSON.stringify(pin.name)} (${pin.modes?.map(m => (m === 'tram' ? 'tramwaj' : 'autobus')).join(', ')})`);
      if (pin.wheelchair && pin.wheelchair !== 'unknown') facts.push(`wheelchair_boarding=${pin.wheelchair}`);
    } else if (pin.kind === 'parking') {
      facts.push(`parking z miejscami dla osób z niepełnosprawnością${pin.disabledSpaces ? ` (${pin.disabledSpaces})` : ''}`);
    } else {
      facts.push('dostępna toaleta');
    }
    return `[${pin.n}] ${facts.join(', ')}; ${at(pin, bbox, overlay.place)}`;
  });
}

/** Stairs, surfaces and kerbs in or near the frame (unnumbered; the model may describe them, not number them). */
export function linesForPrompt(overlay: AerialOverlay, bbox: Bbox) {
  const stairs = overlay.lines
    .filter(l => l.kind === 'stairs')
    .slice(0, 8)
    .map(l => `schody: ${at(lineMiddle(l, overlay.place), bbox, overlay.place)}, handrail=${l.handrail ?? 'unknown'}${l.steps !== undefined ? `, step_count=${l.steps}` : ''}${l.ramp ? ', ramp=yes' : ''}`);
  const surfaces = [...new Set(overlay.lines.filter(l => l.kind === 'rough' && l.surface).map(l => l.surface))];
  const kerbs = overlay.markers.filter(m => m.kind !== 'bench' && inFrame(project(m, bbox), 0)).length;
  return [
    ...stairs,
    ...(surfaces.length ? [`nierówne nawierzchnie w pobliżu (OSM surface): ${surfaces.join(', ')}`] : []),
    ...(kerbs ? [`wysokie krawężniki lub stopnie zmapowane w kadrze: ${kerbs}`] : []),
  ];
}

const personal = [/[\w.+-]+@[\w-]+\.[\w.]+/g, /(?:\+?\d[\s-]?){7,}/g];
/** Free text from a report without e-mails or phone numbers, shortened. */
const scrub = (text: string, max = 180) => personal.reduce((t, re) => t.replace(re, '[…]'), text).replace(/\s+/g, ' ').trim().slice(0, max);

export type ReportSummary = { kind: string; type: 'barrier' | 'blocked'; text: string; date: string; cityStatus: string; distance: number };

/** Earlier user reports near the place, newest first: kind, short description, date, city status. No ids, photos or names. */
export function reportsNear(place: Point, reports: Report[], radius = REPORT_RADIUS): ReportSummary[] {
  return reports
    .filter(r => r.location && distance(place, r.location) <= radius)
    .sort((a, b) => b.obtainedAt.localeCompare(a.obtainedAt))
    .slice(0, 6)
    .map(r => ({
      kind: r.observation.kind,
      type: r.type ?? 'barrier',
      text: scrub([r.observation.description, r.comment].filter(Boolean).join(' — ')),
      date: r.obtainedAt.slice(0, 10),
      cityStatus: r.cityStatus ?? 'new',
      distance: Math.round(distance(place, r.location!)),
    }));
}

/** Short stable digest so a new or changed report produces a new reading. */
export function reportsDigest(reports: Report[], place: Point) {
  const near = reports.filter(r => r.location && distance(place, r.location) <= REPORT_RADIUS).map(r => `${r.id}:${r.editedAt ?? ''}:${r.cityStatus ?? ''}`).sort();
  return near.length ? createHash('sha256').update(near.join('|')).digest('hex').slice(0, 12) : 'none';
}

/** The place's Explore facts (features with their source kind), shortened. */
export function objectForPrompt(o: PlaceObject | null) {
  if (!o) return [];
  const source = new Map(o.sources.map(s => [s.id, s.kind]));
  return o.features.slice(0, 14).map(f => `${f.key}=${f.value}${f.detail ? ` (${f.detail.slice(0, 80)})` : ''} [źródło: ${source.get(f.sourceId) ?? 'nieznane'}]`);
}

const mobilityText: Record<Preferences['mobility'], string> = {
  walk: 'pieszo, wolniej niż zwykle',
  crutches: 'o kulach (schody bez poręczy, długie biegi schodów, wysokie krawężniki i śliska nawierzchnia są trudne)',
  wheelchair: 'na wózku (schody i stopnie wykluczają przejście bez rampy; ważne są obniżone krawężniki, równa nawierzchnia, wejście bez stopni)',
  stroller: 'z wózkiem dziecięcym (schody i stopnie są przeszkodą, bruk i wysokie krawężniki utrudniają)',
};

/** Today's needs as plain sentences the model can tailor to. */
export function preferencesForPrompt(p: Preferences | null) {
  if (!p) return 'nie podano';
  return [
    `porusza się ${mobilityText[p.mobility]}`,
    p.avoidStairs ? 'unika schodów' : p.avoidUp ? 'unika schodów w górę' : p.avoidDown ? 'unika schodów w dół' : null,
    p.preferHandrails ? 'woli schody z poręczą' : null,
    p.restEvery ? `potrzebuje odpoczynku co ${p.restEvery} min marszu` : p.preferRest ? 'woli miejsca do odpoczynku po drodze' : null,
    `chce iść pieszo najwyżej ok. ${p.maxDistance} m`,
  ].filter(Boolean).join('; ');
}

/** Only fields that change the advice go into cache keys. */
export const preferencesKey = (p: Preferences | null) =>
  p ? [p.mobility, +p.avoidStairs, +p.avoidUp, +p.avoidDown, +p.preferHandrails, +p.preferRest, p.restEvery, Math.round(p.maxDistance / 100)].join('.') : 'none';

const conditionText: Record<Weather['condition'], string> = { clear: 'pogodnie', cloudy: 'pochmurno', fog: 'mgła', rain: 'deszcz', ice: 'możliwe oblodzenie / marznący opad', snow: 'śnieg', storm: 'burza' };
export function weatherForPrompt(w: Weather | null) {
  if (!w) return 'nieznana';
  const temp = w.temperature <= 0 ? 'mróz' : w.temperature <= 5 ? 'zimno' : w.temperature >= 25 ? 'upał' : 'umiarkowanie';
  return `${conditionText[w.condition]}, ${temp}${w.precipitation > 0 ? ', pada teraz' : ''}${w.wind >= 40 ? ', silny wiatr' : ''}`;
}

// ---------- Validation of the model's answer ----------

/** A photo cannot support measurements: any sentence claiming one is dropped. */
const measured = /\d\s*(cm|mm|m\b|metr|%|°|stopni|stopnie|stopień|steps?|Stufen?|min)/i;
/** Pin references like [3]; numbers inside them are not measurements. */
const reference = /\[(\d{1,2})\]/g;

/** Words naming a pin kind in pl/en/de, to catch "stop [3]" when [3] is an entrance. */
const kindWords: [AerialPin['kind'], RegExp][] = [
  ['stop', /przystan|\bstops?\b|haltestelle/gi],
  ['entrance', /wej[śs]ci|entrance|eingang/gi],
  ['parking', /parking|parkplatz|car park/gi],
  ['toilet', /toalet|toilet|\bwc\b/gi],
];

/** The kind named right before position `at` (same clause, ~30 characters), if any. */
function namedKind(text: string, at: number) {
  const window = text.slice(Math.max(0, at - 30), at);
  let best: { kind: AerialPin['kind']; index: number } | null = null;
  for (const [kind, words] of kindWords) {
    for (const m of window.matchAll(words)) if (!best || m.index > best.index) best = { kind, index: m.index };
  }
  return best?.kind ?? null;
}

/** Promises the data cannot back ("fully accessible", "no problem"): such a sentence is dropped. */
const guarantee = /gwarant|na pewno|bez (żadnego |żadnych )?problem|w pełni dostępn|całkowicie dostępn|guarantee|definitely|certainly|no problem|without (any )?problem|fully accessible|garantier|auf jeden fall|ohne (jedes |jegliche )?problem|vollständig barrierefrei|uneingeschränkt barrierefrei/i;

/**
 * A sentence as the model wrote it, or '' when it must not be shown: it claims a measurement, refers to a pin
 * that doesn't exist, calls a pin something it isn't, promises accessibility or quotes raw tags.
 */
export function cleanSentence(text: string, pinKinds: AerialPin['kind'][]) {
  const sentence = text.trim().replace(/\s+/g, ' ');
  for (const m of sentence.matchAll(reference)) {
    const kind = pinKinds[Number(m[1]) - 1];
    if (!kind) return '';
    const named = namedKind(sentence, m.index);
    if (named && named !== kind) return '';
  }
  if (measured.test(sentence.replace(reference, ''))) return '';
  if (guarantee.test(sentence)) return '';
  // Raw OSM tags ("wheelchair=yes") are for the model, not for people.
  if (sentence.includes('=')) return '';
  return sentence;
}

export type RawAnalysis = {
  recommendation: { entrance: number | null; approachFrom: number | null; why: string; steps: string[]; avoid: string[]; ask: string[] };
  today: string[];
  observations: { x: number; y: number; kind: string; label: string }[];
};

/** Needs for which an entrance tagged "not accessible" must never be recommended. */
export const needsStepFree = (p: Preferences | null) => !!p && (p.mobility === 'wheelchair' || p.mobility === 'stroller');

/**
 * Keep only what the model can honestly say: a recommended entrance that is a mapped entrance (and not one tagged
 * inaccessible when the person needs step-free access), arrival from a mapped stop or parking, sentences without
 * measurements, guarantees or invented pins, and observations inside the frame, with a known kind, not stacked.
 */
export function sanitiseAnalysis(
  raw: RawAnalysis,
  bbox: Bbox,
  pins: Pick<AerialPin, 'kind' | 'wheelchair'>[],
  options: { stepFree?: boolean } = {},
): Pick<AerialAnalysis, 'recommendation' | 'today' | 'observations'> {
  const kinds = pins.map(p => p.kind);
  const rejected = new Set<number>();
  const pinOf = (n: number | null, allowed: AerialPin['kind'][]) => {
    if (n === null || !Number.isInteger(n)) return null;
    const pin = pins[n - 1];
    if (!pin || !allowed.includes(pin.kind)) return null;
    return pin;
  };
  // Entrances the person should not be sent to: tagged inaccessible while they need a step-free way in.
  if (options.stepFree) pins.forEach((p, i) => p.kind === 'entrance' && p.wheelchair === 'no' && rejected.add(i + 1));
  const usable = (s: string) => ![...s.matchAll(reference)].some(m => rejected.has(Number(m[1])));
  const sentences = (list: string[], max: number, min = 8) =>
    [...new Set(list.map(s => cleanSentence(s, kinds)).filter(s => s.length >= min && usable(s)))].slice(0, max);

  const r = raw.recommendation;
  const entrance = pinOf(r.entrance, ['entrance']) && !rejected.has(r.entrance!) ? r.entrance : null;
  const approachFrom = pinOf(r.approachFrom, ['stop', 'parking']) ? r.approachFrom : null;
  const steps = sentences(r.steps, 4);
  const why = entrance !== null ? (sentences([r.why], 1)[0] ?? '') : '';
  const recommendation = entrance === null && !steps.length ? null : { entrance, approachFrom, why, steps, avoid: sentences(r.avoid, 3, 4), ask: sentences(r.ask, 3, 4) };

  const kept: AerialObservation[] = [];
  for (const o of raw.observations) {
    if (!Number.isFinite(o.x) || !Number.isFinite(o.y) || !inFrame(o)) continue;
    if (!(observationKinds as readonly string[]).includes(o.kind)) continue;
    const label = cleanSentence(o.label, kinds).replace(reference, '').trim().slice(0, 80);
    if (label.length < 3) continue;
    const point = unproject(o, bbox);
    if (kept.some(k => distance(k, point) < 8)) continue;
    kept.push({ id: String.fromCharCode(65 + kept.length), kind: o.kind as ObservationKind, label, lat: Math.round(point.lat * 1e6) / 1e6, lon: Math.round(point.lon * 1e6) / 1e6 });
    if (kept.length === 6) break;
  }
  return { recommendation, today: sentences(raw.today, 2), observations: kept };
}

/**
 * Applies the second look: each observation moves to where the close-up found it, or is dropped when the close-up
 * did not confirm it (null). Results leaving the frame or landing on top of another are dropped; letters are
 * reassigned so the map and the list stay A, B, C…
 */
export function applyRefinement(observations: AerialObservation[], found: (Point | null)[], bbox: Bbox): AerialObservation[] {
  const kept: AerialObservation[] = [];
  observations.forEach((o, i) => {
    const point = found[i];
    if (!point || !inFrame(project(point, bbox))) return;
    if (kept.some(k => distance(k, point) < 8)) return;
    kept.push({ ...o, id: String.fromCharCode(65 + kept.length), lat: Math.round(point.lat * 1e6) / 1e6, lon: Math.round(point.lon * 1e6) / 1e6 });
  });
  return kept;
}

// ---------- Analysis cache ----------
/** Bump when the prompt or the validation changes, so old readings are not served. */
const ANALYSIS_VERSION = 9;
export type AnalysisKey = { lat: number; lon: number; widthM: number; name: string; locale: string; objectId: string | null; preferences: string; weather: string; reports: string };

/** File name for a reading: everything that changes the text is part of the hash. */
export function analysisHash(key: AnalysisKey) {
  return createHash('sha256').update(JSON.stringify([ANALYSIS_VERSION, key.lat, key.lon, key.widthM, key.name, key.locale, key.objectId, key.preferences, key.weather, key.reports])).digest('hex').slice(0, 24);
}

async function analysisFile(key: AnalysisKey) {
  return path.join(runtimeDir, 'aerial', 'analysis', `${analysisHash(key)}.json`);
}

/** A stored reading for these conditions, if any. */
export async function cachedAnalysis(key: AnalysisKey): Promise<AerialAnalysis | null> {
  try {
    return JSON.parse(await readFile(await analysisFile(key), 'utf8')) as AerialAnalysis;
  } catch {
    return null;
  }
}

export async function storeAnalysis(key: AnalysisKey, analysis: AerialAnalysis) {
  const file = await analysisFile(key);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(analysis));
  await rename(tmp, file);
}
