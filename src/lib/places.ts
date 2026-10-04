// Local place search (autocomplete) and reverse geocoding for the Kraków service envelope.
// Server-only: reads data/krakow-places.json.gz (OSM, ODbL) and GTFS stops from .runtime/transit.sqlite.
// `server-only` is not imported because tsx tests would resolve its throwing client entry.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import type { PlaceSuggestion } from './journey-types';
import type { Point } from './city-types';
import { distance as metres } from './aerial-geo';

type RawIndex = {
  areas: [string, number, number][];
  categories: string[];
  streets: [string, number, number, number][];
  addresses: [string, string, number, number, string, string, number, string][];
  pois: [string, number, number, number, number, string][];
};
type DocKind = 'street' | 'poi' | 'stop' | 'addresses' | 'area';
type Doc = {
  kind: DocKind;
  name: string;
  /** Folded name words in order. */
  words: string[];
  /** Folded context words (district, city) that may match but rank lower. */
  extra: string[];
  lat: number;
  lon: number;
  /** street/poi/area: index into raw arrays; addresses: unused. */
  ref: number;
  /** addresses: indices into raw.addresses sharing this street name. */
  members?: number[];
  /** stop: 'tram' | 'bus' | 'both'. */
  modes?: string;
};
type Index = {
  raw: RawIndex; docs: Doc[]; words: string[]; postings: Map<string, number[]>; extraWords: string[]; extraPostings: Map<string, number[]>; grid: Map<number, number[]>; gridAddresses: Map<number, number[]>;
  /** Address counts per coarse cell: [inside Kraków, outside] (see krakowCells). */
  cityCells: Map<number, [number, number]>;
  /** Per doc: 1 inside Kraków, 0 outside, -1 not computed yet. */
  inCity: Int8Array;
  /** Folded names of other towns/villages ("zabierzow", "wielka wies"); a query naming one turns off the Kraków preference. */
  towns: string[][];
};

const OSM_SOURCE = 'OpenStreetMap (ODbL)';
const GTFS_SOURCE = 'Rozkład ZTP Kraków (GTFS)';
const CENTRE = { lat: 50.0614, lon: 19.9366 };
const ENVELOPE = { minLat: 49.94, maxLat: 50.2, minLon: 19.75, maxLon: 20.25 };
// Street-type abbreviations. "ul." is dropped; "os.", "al.", "pl." are expanded and match softly
// (a name may or may not include "Osiedle", "Aleja", "Plac").
const ABBREVIATIONS: Record<string, string> = { ul: 'ulica', al: 'aleja', pl: 'plac', os: 'osiedle' };
const DROPPED = new Set(['ulica']);
const SOFT = new Set(['aleja', 'plac', 'osiedle']);
const KIND_BONUS: Record<DocKind, number> = { stop: 12, street: 10, area: 10, poi: 8, addresses: 0 };
// Search is Kraków-first: results inside the city get this bonus unless the query names another town.
const KRAKOW_BONUS = 15;
/** A few places everyone means by a short query ("rynek" → Rynek Główny). Folded names, Kraków only. */
const PROMINENT = new Set(['rynek glowny', 'wawel', 'sukiennice', 'planty', 'kazimierz', 'nowa huta', 'podgorze', 'blonia', 'kopiec kosciuszki', 'dworzec glowny', 'plac centralny imienia ronalda reagana']);
const PROMINENT_BONUS = 10;
// Coarse cells (~1.1 × 1.1 km) for the Kraków/outside classification.
const CITY_CELL_LAT = 0.01, CITY_CELL_LON = 0.015;
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
const cellKey = (lat: number, lon: number) => Math.floor(lat / CELL) * 100000 + Math.floor(lon / CELL);
const cityCellKey = (y: number, x: number) => y * 100000 + x;

/**
 * Whether an address is in Kraków: postcodes 30-xxx/31-xxx are Kraków, any other postcode or an
 * addr:city (the index keeps it only when it is not Kraków) is outside; otherwise unknown (null).
 */
function addressInKrakow(a: RawIndex['addresses'][number]): boolean | null {
  if (/^3[01]-/.test(a[4])) return true;
  if (a[4] || a[5]) return false;
  return null;
}
/**
 * Kraków membership of any point, without an admin boundary in the index: majority of classified
 * addresses in the surrounding 3×3 coarse cells (~3 km); no addresses around → within 7 km of the Rynek.
 */
function pointInKrakow(cells: Map<number, [number, number]>, lat: number, lon: number) {
  const cy = Math.floor(lat / CITY_CELL_LAT), cx = Math.floor(lon / CITY_CELL_LON);
  let inside = 0, outside = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const c = cells.get(cityCellKey(cy + dy, cx + dx));
    if (!c) continue;
    const w = dy === 0 && dx === 0 ? 3 : 1; // the point's own cell counts most
    inside += c[0] * w; outside += c[1] * w;
  }
  return inside + outside > 0 ? inside > outside : metres(CENTRE, { lat, lon }) < 7000;
}

function loadStops(): { name: string; lat: number; lon: number; modes: string }[] {
  const file = process.env.KROK_TRANSIT_DB ?? path.join(process.env.KROK_STORAGE_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), '.runtime'), 'transit.sqlite');
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
  // Districts, quarters, suburbs and villages (OSM place=*), one per name within 2 km.
  const seenAreas: { name: string; lat: number; lon: number }[] = [];
  raw.areas.forEach((a, i) => {
    const name = fold(a[0]);
    if (seenAreas.some(o => o.name === name && metres(o, { lat: a[1], lon: a[2] }) < 2000)) return;
    seenAreas.push({ name, lat: a[1], lon: a[2] });
    docs.push({ kind: 'area', name: a[0], words: words(a[0]), extra: [], lat: a[1], lon: a[2], ref: i });
  });
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
  docs.forEach((d, i) => { if (d.kind === 'addresses' || d.kind === 'area') return; const k = cellKey(d.lat, d.lon); const l = grid.get(k); if (l) l.push(i); else grid.set(k, [i]); });
  const gridAddresses = new Map<number, number[]>();
  raw.addresses.forEach((a, i) => { const k = cellKey(a[2], a[3]); const l = gridAddresses.get(k); if (l) l.push(i); else gridAddresses.set(k, [i]); });
  const cityCells = new Map<number, [number, number]>();
  for (const a of raw.addresses) {
    const inside = addressInKrakow(a);
    if (inside === null) continue;
    const k = cityCellKey(Math.floor(a[2] / CITY_CELL_LAT), Math.floor(a[3] / CITY_CELL_LON));
    const c = cityCells.get(k) ?? [0, 0];
    c[inside ? 0 : 1]++;
    cityCells.set(k, c);
  }
  // Other towns: addr:city values and areas outside Kraków, minus names that also exist inside Kraków (Kazimierz, Stare Miasto…).
  const krakowNames = new Set(raw.areas.filter(a => pointInKrakow(cityCells, a[1], a[2])).map(a => fold(a[0])));
  const townNames = new Set<string>();
  for (const a of raw.addresses) if (a[5]) townNames.add(fold(a[5]));
  for (const a of raw.areas) if (!pointInKrakow(cityCells, a[1], a[2])) townNames.add(fold(a[0]));
  const towns = [...townNames].filter(n => !krakowNames.has(n)).map(n => words(n)).filter(w => w.length && w.join('').length >= 3);
  cached = { raw, docs, words: [...postings.keys()].sort(), postings, extraWords: [...extraPostings.keys()].sort(), extraPostings, grid, gridAddresses, cityCells, inCity: new Int8Array(docs.length).fill(-1), towns };
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
function docSuggestion(raw: RawIndex, d: Doc & { inKrakow?: boolean }): PlaceSuggestion {
  if (d.kind === 'street') {
    const area = areaName(raw, raw.streets[d.ref][3]);
    return { id: `osm-street:${d.lat}:${d.lon}`, name: d.name, lat: d.lat, lon: d.lon, source: OSM_SOURCE, kind: 'street', detail: area ? `Ulica · ${area}` : 'Ulica' };
  }
  if (d.kind === 'poi') {
    const p = raw.pois[d.ref];
    const area = areaName(raw, p[4]);
    return { id: `osm:${p[5]}`, name: d.name, lat: d.lat, lon: d.lon, source: OSM_SOURCE, kind: 'poi', detail: [raw.categories[p[1]], area].filter(Boolean).join(' · ') };
  }
  if (d.kind === 'area') {
    // Shown as a named place; the client has no separate icon for areas.
    return { id: `area:${d.lat}:${d.lon}`, name: d.name, lat: d.lat, lon: d.lon, source: OSM_SOURCE, kind: 'poi', detail: d.inKrakow ? 'Część Krakowa' : 'Okolice Krakowa' };
  }
  const mode = d.modes === 'both' ? 'tramwaj i autobus' : d.modes === 'tram' ? 'tramwaj' : 'autobus';
  return { id: `stop:${d.name}:${d.lat.toFixed(4)}:${d.lon.toFixed(4)}`.slice(0, 120), name: d.name, lat: d.lat, lon: d.lon, source: GTFS_SOURCE, kind: 'stop', detail: `Przystanek · ${mode}` };
}

type Match = { nameHits: number; exactHits: number; extraHits: number; numbers: string[]; ordered: boolean };
/**
 * Assign every query token to a distinct name word (exact first, then prefix), else context word, else house number.
 * Soft tokens (expanded "os.", "al.", "pl.") only count when the name has them.
 */
function match(doc: Doc, tokens: string[], soft: boolean[] = []): Match | null {
  const used = new Array<boolean>(doc.words.length).fill(false);
  const assigned = new Array<number>(tokens.length).fill(-1);
  let exactHits = 0, nameHits = 0, extraHits = 0;
  tokens.forEach((t, ti) => { const wi = doc.words.findIndex((w, i) => !used[i] && w === t); if (wi >= 0) { used[wi] = true; assigned[ti] = wi; exactHits++; if (!soft[ti]) nameHits++; } });
  const numbers: string[] = [];
  for (let ti = 0; ti < tokens.length; ti++) {
    if (assigned[ti] >= 0) continue;
    const t = tokens[ti];
    if (soft[ti]) continue;
    const wi = doc.words.findIndex((w, i) => !used[i] && w.startsWith(t));
    if (wi >= 0) { used[wi] = true; assigned[ti] = wi; nameHits++; continue; }
    if (doc.extra.some(w => w.startsWith(t))) { extraHits++; continue; }
    if (isNumeric(t)) { numbers.push(t); continue; }
    if (t.length >= 4 && 'krakow'.startsWith(t)) continue; // "Kraków" is implied in this city-wide index.
    return null;
  }
  if (!nameHits) return null;
  const order = assigned.filter(a => a >= 0);
  // "Centrum A" is in order for "Osiedle Centrum A": a leading generic word may be skipped.
  const first = order[0] === 0 || (order[0] === 1 && SOFT.has(doc.words[0]));
  return { nameHits, exactHits, extraHits, numbers, ordered: first && order.every((a, i) => !i || a > order[i - 1]) };
}

/**
 * Folded query tokens. "ul." is dropped and "os."/"al."/"pl." expanded (soft) anywhere in the query, also mid-query
 * ("dluga ul. 10"); a bare "os"/"al"/"pl"/"ul" as the last token without a dot may still be a word being typed.
 */
function queryTokens(query: string): { tokens: string[]; soft: boolean[] } {
  const raw = fold(query).split(/(?=[^\p{L}\p{N}])|(?<=[^\p{L}\p{N}])/u);
  const parts: { word: string; dot: boolean }[] = [];
  raw.forEach((piece, i) => {
    if (!/^[\p{L}\p{N}]+$/u.test(piece)) return;
    parts.push({ word: piece, dot: raw[i + 1] === '.' });
  });
  const tokens: string[] = [];
  const soft: boolean[] = [];
  parts.forEach(({ word, dot }, i) => {
    const expanded = ABBREVIATIONS[word];
    const typing = i === parts.length - 1 && !dot;
    if (expanded && !(typing && parts.length > 1) && !(parts.length === 1 && !dot)) {
      if (DROPPED.has(expanded)) return;
      tokens.push(expanded); soft.push(true);
      return;
    }
    if (SOFT.has(word) || DROPPED.has(word)) {
      if (DROPPED.has(word) && parts.length > 1) return;
      tokens.push(word); soft.push(parts.length > 1);
      return;
    }
    tokens.push(word); soft.push(false);
  });
  // Only generic words ("os.", "plac"): search for them literally.
  if (tokens.length && soft.every(Boolean)) soft.fill(false);
  return { tokens, soft };
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
  const { tokens, soft } = queryTokens(query);
  if (!tokens.length) return [];
  const idx = index();
  const { raw, docs, words: sorted, postings, extraWords, extraPostings } = idx;
  // Candidate set from the most selective non-numeric, non-generic token (name or context words).
  const selective = tokens.filter((t, i) => !soft[i] && !isNumeric(t) && !(t.length >= 4 && 'krakow'.startsWith(t)));
  const seeds = selective.length ? selective : tokens.filter((_, i) => !soft[i]);
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
  // Prefer Kraków unless the query names another town ("rynek zabierzów", "długa 10 wieliczka").
  const townWords = namedTownWords(idx.towns, tokens);
  const preferKrakow = townWords.size === 0;
  const krakow = (id: number) => {
    if (idx.inCity[id] < 0) idx.inCity[id] = pointInKrakow(idx.cityCells, docs[id].lat, docs[id].lon) ? 1 : 0;
    return idx.inCity[id] === 1;
  };
  const hard = tokens.filter((t, i) => !soft[i] && !isNumeric(t));
  const phrase = tokens.filter(t => !isNumeric(t)).join(' ');
  const hardPhrase = hard.join(' ');
  const scored: { score: number; place: PlaceSuggestion }[] = [];
  for (const id of candidates ?? []) {
    const doc = docs[id];
    const m = match(doc, tokens, soft);
    if (!m) continue;
    const folded = doc.words.join(' ');
    const generic = SOFT.has(doc.words[0]) ? doc.words.slice(1).join(' ') : null;
    let quality = 40 + m.exactHits * 4 - m.extraHits * 15 + (m.ordered ? 15 : 0);
    if (phrase && (folded === phrase || (hardPhrase && generic === hardPhrase))) quality += 45;
    else if (phrase && (folded.startsWith(phrase) || (hardPhrase && generic?.startsWith(hardPhrase)))) quality += 30;
    quality -= (doc.words.length - m.nameHits - (generic !== null ? 1 : 0)) * 3 + Math.min(doc.name.length, 60) * 0.2;
    if (doc.kind === 'addresses') {
      if (!m.numbers.length) {
        // An osiedle is an addressing unit without a street ("os. Centrum A"): suggest the estate itself.
        if (doc.words[0] === 'osiedle') {
          const place = estateSuggestion(raw, doc, origin);
          const inside = pointInKrakow(idx.cityCells, place.lat, place.lon);
          const km = metres(origin, place) / 1000;
          scored.push({ score: quality + KIND_BONUS.street + (preferKrakow && inside ? KRAKOW_BONUS : 0) - distanceWeight * Math.log2(1 + km), place });
        }
        continue;
      }
      let shown = 0;
      for (const i of doc.members!) {
        const a = raw.addresses[i];
        const hit = houseNumberMatches(a[1], m.numbers);
        if (!hit) continue;
        const km = metres(origin, { lat: a[2], lon: a[3] }) / 1000;
        const inside = addressInKrakow(a) ?? pointInKrakow(idx.cityCells, a[2], a[3]);
        // The group's context words mix all towns sharing the street name; reward the member in the named town.
        const inTown = townWords.size > 0 && [...words(a[5]), ...words(areaName(raw, a[6]) ?? '')].some(w => townWords.has(w));
        scored.push({ score: quality + 25 + hit * 10 - fold(a[1]).length + (preferKrakow && inside ? KRAKOW_BONUS : 0) + (inTown ? KRAKOW_BONUS : 0) - distanceWeight * Math.log2(1 + km), place: addressSuggestion(raw, i) });
        if (++shown > 200) break;
      }
      continue;
    }
    if (m.numbers.length && doc.kind !== 'street') continue;
    const km = metres(origin, doc) / 1000;
    const category = doc.kind === 'poi' ? raw.categories[raw.pois[doc.ref][1]] : '';
    if (MAJOR.has(category)) quality += 6; else if (MINOR.has(category)) quality -= 5;
    const inside = krakow(id);
    if (preferKrakow && inside) quality += KRAKOW_BONUS + (PROMINENT.has(folded) ? PROMINENT_BONUS : 0);
    scored.push({ score: quality + KIND_BONUS[doc.kind] - m.numbers.length * 30 - distanceWeight * Math.log2(1 + km), place: docSuggestion(raw, { ...doc, inKrakow: inside }) });
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

/**
 * True when the query qualifies a name with another town ("rynek zabierzow", "dluga 10 wieliczka").
 * A query that is only a town name ("rynek", "kazimierz") is not a qualifier: the town itself is still suggested.
 */
function namedTownWords(towns: string[][], tokens: string[]) {
  const out = new Set<string>();
  for (const town of towns) if (town.length < tokens.length && tokens.some((_, i) => town.every((w, j) => tokens[i + j] === w))) for (const w of town) out.add(w);
  return out;
}

/** An osiedle (address group) as one place: addresses near the one closest to the origin, averaged. */
function estateSuggestion(raw: RawIndex, doc: Doc, origin: Point): PlaceSuggestion {
  const members = doc.members!.map(i => raw.addresses[i]);
  let nearest = members[0];
  for (const a of members) if (metres(origin, { lat: a[2], lon: a[3] }) < metres(origin, { lat: nearest[2], lon: nearest[3] })) nearest = a;
  const group = members.filter(a => metres({ lat: a[2], lon: a[3] }, { lat: nearest[2], lon: nearest[3] }) < 1000);
  const lat = +(group.reduce((s, a) => s + a[2], 0) / group.length).toFixed(5);
  const lon = +(group.reduce((s, a) => s + a[3], 0) / group.length).toFixed(5);
  const area = areaName(raw, nearest[6]);
  const city = nearest[5] || (pointInKrakow(index().cityCells, lat, lon) ? 'Kraków' : '');
  return { id: `osm-estate:${lat}:${lon}`, name: doc.name, lat, lon, source: OSM_SOURCE, kind: 'street', detail: ['Osiedle', [area, city].filter((v, i, list) => v && list.indexOf(v) === i).join(', ')].filter(Boolean).join(' · ') };
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
