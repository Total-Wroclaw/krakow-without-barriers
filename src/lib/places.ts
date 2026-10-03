// Local place search (autocomplete) and reverse geocoding for the Kraków service envelope.
// Server-only: reads data/krakow-places.json.gz (OSM, ODbL) and GTFS stops from .runtime/transit.sqlite.
// `server-only` is not imported because tsx tests would resolve its throwing client entry.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import type { PlaceSuggestion } from './journey-types';
import type { Point } from './city-types';

type RawIndex = {
  areas: [string, number, number][];
  categories: string[];
  streets: [string, number, number, number][];
  addresses: [string, string, number, number, string, string, number, string][];
  pois: [string, number, number, number, number, string][];
};
type DocKind = 'street' | 'poi' | 'stop' | 'addresses';
type Doc = {
  kind: DocKind;
  name: string;
  /** Folded name words in order. */
  words: string[];
  /** Folded context words (district, city) that may match but rank lower. */
  extra: string[];
  lat: number;
  lon: number;
  /** street/poi: index into raw arrays; addresses: unused. */
  ref: number;
  /** addresses: indices into raw.addresses sharing this street name. */
  members?: number[];
  /** stop: 'tram' | 'bus' | 'both'. */
  modes?: string;
};
type Index = { raw: RawIndex; docs: Doc[]; words: string[]; postings: Map<string, number[]>; extraWords: string[]; extraPostings: Map<string, number[]>; grid: Map<number, number[]>; gridAddresses: Map<number, number[]> };

const OSM_SOURCE = 'OpenStreetMap (ODbL)';
const GTFS_SOURCE = 'Rozkład ZTP Kraków (GTFS)';
const CENTRE = { lat: 50.0614, lon: 19.9366 };
const ENVELOPE = { minLat: 49.94, maxLat: 50.2, minLon: 19.75, maxLon: 20.25 };
const STOPWORDS = new Set(['ul', 'ulica', 'al', 'os', 'pl']);
const KIND_BONUS: Record<DocKind, number> = { stop: 12, street: 10, poi: 8, addresses: 0 };
const CELL = 0.0025;
// Destinations people usually mean when several places share a name.
const MAJOR = new Set(['Dworzec', 'Dworzec autobusowy', 'Przystanek kolejowy', 'Szpital', 'Przychodnia', 'Uczelnia', 'Muzeum', 'Zamek', 'Wzgórze', 'Park', 'Galeria handlowa', 'Teatr', 'Kino', 'Kościół', 'Plac', 'Stadion', 'Urząd', 'Sąd', 'Cmentarz', 'Biblioteka', 'Targowisko', 'Zoo', 'Błonia', 'Centrum kultury', 'Pomnik', 'Poczta']);
const MINOR = new Set(['Budynek', 'Biuro', 'Parking', 'Handel', 'Bankomat', 'Ładowarka', 'Krzyż', 'Kapliczka', 'Grób', 'Firma IT']);

export function fold(text: string) {
  return text.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/\p{M}/gu, '');
}
export function words(text: string) {
  return fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
const isNumeric = (token: string) => /^\d/.test(token);
const inEnvelope = (lat: number, lon: number) => lat >= ENVELOPE.minLat && lat <= ENVELOPE.maxLat && lon >= ENVELOPE.minLon && lon <= ENVELOPE.maxLon;
function metres(a: Point, b: Point) {
  const x = ((b.lon - a.lon) * Math.PI / 180) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  const y = (b.lat - a.lat) * Math.PI / 180;
  return 6371000 * Math.hypot(x, y);
}
const cellKey = (lat: number, lon: number) => Math.floor(lat / CELL) * 100000 + Math.floor(lon / CELL);

function loadStops(): { name: string; lat: number; lon: number; modes: string }[] {
  const file = path.join(process.env.KROK_STORAGE_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), '.runtime'), 'transit.sqlite');
  if (!existsSync(file)) return [];
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const rows = db.prepare('SELECT id, name, lat, lon FROM stops').all() as { id: string; name: string; lat: number; lon: number }[];
    // One suggestion per stop name; same-name stops more than 1.5 km apart are separate places.
    const clusters = new Map<string, { lat: number; lon: number; n: number; tram: boolean; bus: boolean }[]>();
    for (const r of rows) {
      if (!r.name || !inEnvelope(r.lat, r.lon)) continue;
      const list = clusters.get(r.name) ?? [];
      let c = list.find(c => metres({ lat: c.lat / c.n, lon: c.lon / c.n }, r) < 1500);
      if (!c) { c = { lat: 0, lon: 0, n: 0, tram: false, bus: false }; list.push(c); }
      c.lat += r.lat; c.lon += r.lon; c.n++;
      if (r.id.startsWith('T:')) c.tram = true; else c.bus = true;
      clusters.set(r.name, list);
    }
    return [...clusters].flatMap(([name, list]) => list.map(c => ({ name, lat: +(c.lat / c.n).toFixed(6), lon: +(c.lon / c.n).toFixed(6), modes: c.tram && c.bus ? 'both' : c.tram ? 'tram' : 'bus' })));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

let cached: Index | undefined;
function index(): Index {
  if (cached) return cached;
  const raw = JSON.parse(gunzipSync(readFileSync(/* turbopackIgnore: true */ path.join(process.cwd(), 'data/krakow-places.json.gz'))).toString('utf8')) as RawIndex;
  const areaWords = raw.areas.map(a => words(a[0]));
  const docs: Doc[] = [];
  raw.streets.forEach((s, i) => docs.push({ kind: 'street', name: s[0], words: words(s[0]), extra: areaWords[s[3]] ?? [], lat: s[1], lon: s[2], ref: i }));
  raw.pois.forEach((p, i) => docs.push({ kind: 'poi', name: p[0], words: words(p[0]), extra: [...(areaWords[p[4]] ?? []), ...words(raw.categories[p[1]])], lat: p[2], lon: p[3], ref: i }));
  for (const s of loadStops()) docs.push({ kind: 'stop', name: s.name, words: words(s.name), extra: ['przystanek'], lat: s.lat, lon: s.lon, ref: -1, modes: s.modes });
  const groups = new Map<string, Doc>();
  raw.addresses.forEach((a, i) => {
    let g = groups.get(a[0]);
    if (!g) { g = { kind: 'addresses', name: a[0], words: words(a[0]), extra: [], lat: a[2], lon: a[3], ref: -1, members: [] }; groups.set(a[0], g); docs.push(g); }
    g.members!.push(i);
    for (const w of [...(areaWords[a[6]] ?? []), ...words(a[5])]) if (!g.extra.includes(w)) g.extra.push(w);
  });
  const postings = new Map<string, number[]>();
  const extraPostings = new Map<string, number[]>();
  const add = (map: Map<string, number[]>, w: string, i: number) => { const list = map.get(w); if (!list) map.set(w, [i]); else if (list[list.length - 1] !== i) list.push(i); };
  docs.forEach((d, i) => { for (const w of d.words) add(postings, w, i); for (const w of d.extra) add(extraPostings, w, i); });
  // Reverse-geocoding grids: named places and streets, and addresses separately.
  const grid = new Map<number, number[]>();
  docs.forEach((d, i) => { if (d.kind === 'addresses') return; const k = cellKey(d.lat, d.lon); const l = grid.get(k); if (l) l.push(i); else grid.set(k, [i]); });
  const gridAddresses = new Map<number, number[]>();
  raw.addresses.forEach((a, i) => { const k = cellKey(a[2], a[3]); const l = gridAddresses.get(k); if (l) l.push(i); else gridAddresses.set(k, [i]); });
  cached = { raw, docs, words: [...postings.keys()].sort(), postings, extraWords: [...extraPostings.keys()].sort(), extraPostings, grid, gridAddresses };
  return cached;
}

function lowerBound(list: string[], key: string) {
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid] < key) lo = mid + 1; else hi = mid; }
  return lo;
}
/** Doc ids having a word that starts with `prefix`. */
function prefixDocs(sorted: string[], map: Map<string, number[]>, prefix: string, into: Set<number>) {
  for (let i = lowerBound(sorted, prefix); i < sorted.length && sorted[i].startsWith(prefix); i++) for (const d of map.get(sorted[i])!) into.add(d);
}

function areaName(raw: RawIndex, i: number) { return i >= 0 ? raw.areas[i]?.[0] : undefined; }
function addressDetail(raw: RawIndex, a: RawIndex['addresses'][number]) {
  const area = areaName(raw, a[6]);
  const city = a[5] || 'Kraków';
  const locality = [a[4], city].filter(Boolean).join(' ');
  return [area && area !== city ? area : '', locality].filter(Boolean).join(', ');
}
function addressSuggestion(raw: RawIndex, i: number): PlaceSuggestion {
  const a = raw.addresses[i];
  return { id: `osm:${a[7]}`, name: `${a[0]} ${a[1]}`.slice(0, 300), lat: a[2], lon: a[3], source: OSM_SOURCE, kind: 'address', detail: addressDetail(raw, a) };
}
function docSuggestion(raw: RawIndex, d: Doc): PlaceSuggestion {
  if (d.kind === 'street') {
    const area = areaName(raw, raw.streets[d.ref][3]);
    return { id: `osm-street:${d.lat}:${d.lon}`, name: d.name, lat: d.lat, lon: d.lon, source: OSM_SOURCE, kind: 'street', detail: area ? `Ulica · ${area}` : 'Ulica' };
  }
  if (d.kind === 'poi') {
    const p = raw.pois[d.ref];
    const area = areaName(raw, p[4]);
    return { id: `osm:${p[5]}`, name: d.name, lat: d.lat, lon: d.lon, source: OSM_SOURCE, kind: 'poi', detail: [raw.categories[p[1]], area].filter(Boolean).join(' · ') };
  }
  const mode = d.modes === 'both' ? 'tramwaj i autobus' : d.modes === 'tram' ? 'tramwaj' : 'autobus';
  return { id: `stop:${d.name}:${d.lat.toFixed(4)}:${d.lon.toFixed(4)}`.slice(0, 120), name: d.name, lat: d.lat, lon: d.lon, source: GTFS_SOURCE, kind: 'stop', detail: `Przystanek · ${mode}` };
}

type Match = { nameHits: number; exactHits: number; extraHits: number; numbers: string[]; ordered: boolean };
/** Assign every query token to a distinct name word (exact first, then prefix), else context word, else house number. */
function match(doc: Doc, tokens: string[]): Match | null {
  const used = new Array<boolean>(doc.words.length).fill(false);
  const assigned = new Array<number>(tokens.length).fill(-1);
  let exactHits = 0, nameHits = 0, extraHits = 0;
  tokens.forEach((t, ti) => { const wi = doc.words.findIndex((w, i) => !used[i] && w === t); if (wi >= 0) { used[wi] = true; assigned[ti] = wi; exactHits++; nameHits++; } });
  const numbers: string[] = [];
  for (let ti = 0; ti < tokens.length; ti++) {
    if (assigned[ti] >= 0) continue;
    const t = tokens[ti];
    const wi = doc.words.findIndex((w, i) => !used[i] && w.startsWith(t));
    if (wi >= 0) { used[wi] = true; assigned[ti] = wi; nameHits++; continue; }
    if (doc.extra.some(w => w.startsWith(t))) { extraHits++; continue; }
    if (isNumeric(t)) { numbers.push(t); continue; }
    if (t.length >= 4 && 'krakow'.startsWith(t)) continue; // "Kraków" is implied in this city-wide index.
    return null;
  }
  if (!nameHits) return null;
  const order = assigned.filter(a => a >= 0);
  return { nameHits, exactHits, extraHits, numbers, ordered: order.every((a, i) => !i || a > order[i - 1]) && order[0] === 0 };
}

function houseNumberMatches(hn: string, numbers: string[]) {
  const parts = fold(hn).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const joined = parts.join('');
  if (numbers.length === 1) return joined.startsWith(numbers[0]) || parts.some(p => p.startsWith(numbers[0])) ? (joined === numbers[0] || parts[0] === numbers[0] ? 2 : 1) : 0;
  return numbers.every(n => parts.some(p => p.startsWith(n))) ? 1 : 0;
}

/**
 * Autocomplete over addresses, streets, named OSM places and GTFS stops.
 * Case/diacritic-insensitive word-prefix matching; numbers may match house numbers.
 */
export function searchPlaces(query: string, near?: Point, limit = 8): PlaceSuggestion[] {
  const all = words(query);
  if (!all.length) return [];
  // Drop "ul.", "al.", "os.", "pl." unless it is the only (or still being typed, last) token.
  const tokens = all.filter((t, i) => !(STOPWORDS.has(t) && all.length > 1 && i < all.length - 1));
  const { raw, docs, words: sorted, postings, extraWords, extraPostings } = index();
  // Candidate set from the most selective non-numeric token (name or context words).
  const selective = tokens.filter(t => !isNumeric(t) && !(t.length >= 4 && 'krakow'.startsWith(t)));
  const seeds = selective.length ? selective : tokens;
  let candidates: Set<number> | undefined;
  for (const t of seeds) {
    const set = new Set<number>();
    prefixDocs(sorted, postings, t, set);
    prefixDocs(extraWords, extraPostings, t, set);
    if (!candidates || set.size < candidates.size) candidates = set;
    if (candidates.size < 50) break;
  }
  const origin = near ?? CENTRE;
  const distanceWeight = near ? 6 : 3;
  const phrase = tokens.filter(t => !isNumeric(t)).join(' ');
  const scored: { score: number; place: PlaceSuggestion }[] = [];
  for (const id of candidates ?? []) {
    const doc = docs[id];
    const m = match(doc, tokens);
    if (!m) continue;
    const folded = doc.words.join(' ');
    let quality = 40 + m.exactHits * 4 - m.extraHits * 15 + (m.ordered ? 15 : 0);
    if (phrase && folded === phrase) quality += 45;
    else if (phrase && folded.startsWith(phrase)) quality += 30;
    quality -= (doc.words.length - m.nameHits) * 3 + Math.min(doc.name.length, 60) * 0.2;
    if (doc.kind === 'addresses') {
      if (!m.numbers.length) continue;
      let shown = 0;
      for (const i of doc.members!) {
        const a = raw.addresses[i];
        const hit = houseNumberMatches(a[1], m.numbers);
        if (!hit) continue;
        const km = metres(origin, { lat: a[2], lon: a[3] }) / 1000;
        scored.push({ score: quality + 25 + hit * 10 - fold(a[1]).length - distanceWeight * Math.log2(1 + km), place: addressSuggestion(raw, i) });
        if (++shown > 200) break;
      }
      continue;
    }
    if (m.numbers.length && doc.kind !== 'street') continue;
    const km = metres(origin, doc) / 1000;
    const category = doc.kind === 'poi' ? raw.categories[raw.pois[doc.ref][1]] : '';
    if (MAJOR.has(category)) quality += 6; else if (MINOR.has(category)) quality -= 5;
    scored.push({ score: quality + KIND_BONUS[doc.kind] - m.numbers.length * 30 - distanceWeight * Math.log2(1 + km), place: docSuggestion(raw, doc) });
  }
  scored.sort((a, b) => b.score - a.score);
  const out: PlaceSuggestion[] = [];
  const seen = new Set<string>();
  for (const { place } of scored) {
    const key = `${place.kind}|${place.name}|${place.detail}`;
    if (seen.has(key)) continue;
    // A named street that is also tagged as an attraction is one place for the user.
    if ((place.kind === 'poi' || place.kind === 'street') && out.some(o => (o.kind === 'poi' || o.kind === 'street') && o.kind !== place.kind && fold(o.name) === fold(place.name) && metres(o, place) < 300)) continue;
    seen.add(key); out.push(place);
    if (out.length >= limit) break;
  }
  return out;
}

/** Nearest address within 80 m, else nearest named place or street within 150 m. */
export function reverseGeocode(point: Point): PlaceSuggestion | null {
  const { raw, docs, grid, gridAddresses } = index();
  const cy = Math.floor(point.lat / CELL), cx = Math.floor(point.lon / CELL);
  let best = -1, bestDistance = 80;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const i of gridAddresses.get((cy + dy) * 100000 + cx + dx) ?? []) {
    const a = raw.addresses[i]; const d = metres(point, { lat: a[2], lon: a[3] });
    if (d < bestDistance) { bestDistance = d; best = i; }
  }
  if (best >= 0) return addressSuggestion(raw, best);
  bestDistance = 150;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const i of grid.get((cy + dy) * 100000 + cx + dx) ?? []) {
    const d = metres(point, docs[i]);
    if (d < bestDistance) { bestDistance = d; best = i; }
  }
  return best >= 0 ? docSuggestion(raw, docs[best]) : null;
}
