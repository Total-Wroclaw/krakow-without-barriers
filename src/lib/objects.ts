// "Odkrywaj" catalogue: places with concrete accessibility facts from several sources, never merged into one badge.
// Server-only (reads data files and SQLite). Sources:
//   OSM extract (data/krakow-objects.json.gz) · UMK list (data/krakow-city-venues.json) · partners (SQLite) · user reports (SQLite).
// Each fact keeps its source; conflicting sources are shown side by side; missing facts stay missing.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AccessFeature, FeatureKey, FeatureValue, ObjectCategory, ObjectPage, ObjectQuery, ObjectSource, PartnerInfo, PlaceObject, PlaceObjectSummary } from './explore-types';
import type { CityVenuesFile } from './city-venues';
import { locales, type Locale } from './i18n/locales';
import type { Report } from './schemas';
import type { CityFact } from './city-types';
import { publicPhotoPath } from './report-photos';
import { fold, words } from './places';

// ---------- Types of raw inputs ----------
export type OsmEntrance = { id: string; d: number; ts: string | null; t: Record<string, string> };
export type OsmRecord = { id: string; also?: string[]; c: ObjectCategory; k: string; n: string | null; la: number; lo: number; ts: string | null; t: Record<string, string>; e: OsmEntrance[] };
export type OsmFile = { obtainedAt: string; sourceDate: string | null; objects: OsmRecord[] };
export type PartnerFeatureInput = { key: FeatureKey; value: FeatureValue; detail?: string };
/** Stored partner submission. contactEmail is private: it never leaves this module. */
export type PartnerRecord = {
  id: string; name: string; category: ObjectCategory; lat: number; lon: number; address?: string; website?: string;
  contactEmail: string; features: PartnerFeatureInput[]; description?: string; promote: boolean; plan: 'free' | 'partner';
  existingObjectId?: string; obtainedAt: string; example?: boolean; tagline?: string;
};
export type CatalogInput = { osm?: OsmFile | null; city?: CityVenuesFile | null; partners?: PartnerRecord[]; reports?: Report[] };

// ---------- Labels ----------
const CATEGORY_LABELS: Record<ObjectCategory, Record<Locale, string>> = {
  museum: { pl: 'Muzeum', en: 'Museum', de: 'Museum' },
  landmark: { pl: 'Zabytek i atrakcja', en: 'Landmark', de: 'Sehenswürdigkeit' },
  culture: { pl: 'Kultura', en: 'Culture', de: 'Kultur' },
  office: { pl: 'Urząd', en: 'Public office', de: 'Behörde' },
  toilet: { pl: 'Toaleta', en: 'Toilet', de: 'Toilette' },
  hotel: { pl: 'Nocleg', en: 'Accommodation', de: 'Unterkunft' },
  food: { pl: 'Gastronomia', en: 'Food and drink', de: 'Essen und Trinken' },
  health: { pl: 'Zdrowie', en: 'Health', de: 'Gesundheit' },
  park: { pl: 'Park', en: 'Park', de: 'Park' },
  parking: { pl: 'Parking', en: 'Parking', de: 'Parkplatz' },
  other: { pl: 'Inne', en: 'Other', de: 'Sonstiges' },
};
export const categoryLabel = (category: ObjectCategory, locale: Locale = 'pl') => CATEGORY_LABELS[category]?.[locale] ?? CATEGORY_LABELS.other[locale];
const UNNAMED_TOILET: Record<Locale, string> = { pl: 'Toaleta publiczna', en: 'Public toilet', de: 'Öffentliche Toilette' };
const LABELS = {
  osm: { pl: 'OpenStreetMap', en: 'OpenStreetMap', de: 'OpenStreetMap' },
  osmEntrance: { pl: 'OpenStreetMap — wejście', en: 'OpenStreetMap — entrance', de: 'OpenStreetMap — Eingang' },
  city: { pl: 'Urząd Miasta Krakowa — wykaz dostępności budynków', en: 'Kraków City Hall — building accessibility list', de: 'Stadtverwaltung Krakau — Verzeichnis barrierefreier Gebäude' },
  partner: { pl: 'Dane właściciela obiektu (niezweryfikowane w terenie)', en: 'Venue owner data (not verified on site)', de: 'Angaben des Betreibers (nicht vor Ort geprüft)' },
  example: { pl: 'Dane demonstracyjne — nie dotyczą prawdziwego miejsca', en: 'Demo data — not a real venue', de: 'Demodaten — kein echter Ort' },
  user: { pl: 'Zgłoszenie użytkownika (niezweryfikowane)', en: 'User report (unverified)', de: 'Nutzermeldung (nicht geprüft)' },
};
const OBSERVATION_LABELS: Record<Report['observation']['kind'], Record<Locale, string>> = {
  stairs: { pl: 'schody', en: 'stairs', de: 'Treppe' }, entrance: { pl: 'wejście', en: 'entrance', de: 'Eingang' }, bench: { pl: 'ławka', en: 'bench', de: 'Sitzbank' },
  surface: { pl: 'nawierzchnia', en: 'surface', de: 'Belag' }, other: { pl: 'inne', en: 'other', de: 'Sonstiges' },
};
const ENTRANCE_KIND: Record<string, string> = { main: 'główne', service: 'służbowe', secondary: 'boczne', emergency: 'awaryjne', exit: 'wyjście', staircase: 'klatka schodowa', yes: '' };

// ---------- OSM tags → features ----------
const yesNo = (v: string | undefined): FeatureValue | undefined => {
  if (v === undefined) return undefined;
  const x = v.trim().toLowerCase();
  if (x === 'yes' || x === 'designated') return 'yes';
  if (x === 'limited' || x === 'partial') return 'limited';
  if (x === 'no') return 'no';
  if (x === 'unknown') return 'unknown';
  return undefined;
};
/** Parse OSM width ("0.9", "90 cm", "0,9 m") to centimetres. */
export function widthCm(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.replace(',', '.').match(/^\s*(\d+(?:\.\d+)?)\s*(cm|m)?\s*$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const cm = m[2]?.toLowerCase() === 'cm' || (!m[2] && n > 10) ? n : n * 100;
  return cm >= 40 && cm <= 600 ? Math.round(cm) : null;
}
/** Polish door clear width requirement for accessible buildings is 90 cm; 80–89 cm passes many but not all wheelchairs. */
export function doorWidthValue(cm: number): FeatureValue { return cm >= 90 ? 'yes' : cm >= 80 ? 'limited' : 'no'; }
const stepsPl = (n: number) => `${n} ${n === 1 ? 'stopień' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'stopnie' : 'stopni'}`;
const description = (t: Record<string, string>, key = 'wheelchair:description') => t[`${key}:pl`] ?? t[key] ?? t[`${key}:en`];

/** Facts stated on the object itself. Only explicit tags produce facts. */
export function osmObjectFeatures(t: Record<string, string>, category: ObjectCategory, sourceId: string): AccessFeature[] {
  const out: AccessFeature[] = [];
  const push = (key: FeatureKey, value: FeatureValue | undefined, detail?: string) => { if (value) out.push({ key, value, sourceId, ...(detail ? { detail: detail.slice(0, 300) } : {}) }); };
  const wheelchair = yesNo(t.wheelchair);
  // On a toilet, wheelchair=* describes the toilet itself.
  if (category === 'toilet') push('accessible_toilet', wheelchair ?? yesNo(t['toilets:wheelchair']), description(t));
  else {
    push('step_free_entrance', wheelchair, description(t));
    push('accessible_toilet', yesNo(t['toilets:wheelchair']), description(t, 'toilets:wheelchair:description'));
  }
  if (t.step_count && /^\d+$/.test(t.step_count)) { const n = Number(t.step_count); push('entrance_steps', n > 0 ? 'yes' : 'no', stepsPl(n)); }
  push('ramp', yesNo(t['ramp:wheelchair']) ?? yesNo(t.ramp));
  push('lift', yesNo(t.elevator));
  const cm = widthCm(t['door:width']);
  if (cm) push('door_width', doorWidthValue(cm), `${cm} cm`);
  if (t.automatic_door) push('automatic_door', t.automatic_door === 'no' ? 'no' : 'yes', t.automatic_door === 'yes' || t.automatic_door === 'no' ? undefined : t.automatic_door);
  push('hearing_loop', yesNo(t.hearing_loop));
  const disabledParking = t['capacity:disabled'];
  if (disabledParking && /^\d+$/.test(disabledParking)) push('disabled_parking', Number(disabledParking) > 0 ? 'yes' : 'no', `${disabledParking} miejsc`);
  else push('disabled_parking', yesNo(disabledParking));
  return out;
}
/** Facts from an entrance node (wheelchair, step_count, ramp, width, automatic door). */
export function osmEntranceFeatures(e: OsmEntrance, sourceId: string): AccessFeature[] {
  const t = e.t;
  const kind = ENTRANCE_KIND[t.entrance] ?? t.entrance ?? '';
  const where = [`wejście${kind ? ` ${kind}` : ''}`, e.d > 0 ? `ok. ${Math.round(e.d)} m od punktu obiektu` : ''].filter(Boolean).join(', ');
  const out: AccessFeature[] = [];
  const push = (key: FeatureKey, value: FeatureValue | undefined, detail?: string) => { if (value) out.push({ key, value, sourceId, detail: [where, detail].filter(Boolean).join(': ').slice(0, 300) }); };
  push('step_free_entrance', yesNo(t.wheelchair), description(t));
  if (t.step_count && /^\d+$/.test(t.step_count)) { const n = Number(t.step_count); push('entrance_steps', n > 0 ? 'yes' : 'no', stepsPl(n)); }
  push('ramp', yesNo(t['ramp:wheelchair']) ?? yesNo(t.ramp));
  const cm = widthCm(t['door:width'] ?? t.width);
  if (cm) push('door_width', doorWidthValue(cm), `${cm} cm`);
  if (t.automatic_door) push('automatic_door', t.automatic_door === 'no' ? 'no' : 'yes', t.automatic_door === 'yes' || t.automatic_door === 'no' ? undefined : t.automatic_door);
  return out;
}

// ---------- Internal record ----------
type Rec = {
  id: string; name: string | null; names: Partial<Record<Locale, string>>; aliases: string[];
  category: ObjectCategory; lat: number; lon: number; address?: string; website?: string; openingHours?: string; description?: string;
  osmIds: string[]; sources: (ObjectSource & { labelKey: keyof typeof LABELS | 'userObservation'; note?: string; observation?: Report['observation']['kind'] })[];
  features: AccessFeature[]; partner?: PartnerInfo;
  /** Precomputed folded search words. */
  searchName: string[]; searchExtra: string[];
};
const osmUrl = (id: string) => `https://www.openstreetmap.org/${id.replace(':', '/')}`;
export const objectId = (osmId: string) => `osm-${osmId.replace(':', '-')}`;
function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const x = ((b.lon - a.lon) * Math.PI / 180) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  const y = (b.lat - a.lat) * Math.PI / 180;
  return 6371000 * Math.hypot(x, y);
}
function osmAddress(t: Record<string, string>) {
  const street = t['addr:street'] ?? t['addr:place'];
  if (!street || !t['addr:housenumber']) return undefined;
  return `${street} ${t['addr:housenumber']}`;
}

function fromOsm(o: OsmRecord, obtainedAt: string): Rec {
  const sid = `osm:${o.id}`;
  const rec: Rec = {
    id: objectId(o.id), name: o.n, names: { ...(o.t['name:en'] ? { en: o.t['name:en'] } : {}), ...(o.t['name:de'] ? { de: o.t['name:de'] } : {}) }, aliases: [],
    category: o.c, lat: o.la, lon: o.lo, address: osmAddress(o.t), website: o.t.website ?? o.t['contact:website'], openingHours: o.t.opening_hours,
    osmIds: [o.id, ...(o.also ?? [])],
    sources: [{ id: sid, kind: 'osm', label: LABELS.osm.pl, labelKey: 'osm', url: osmUrl(o.id), obtainedAt, editedAt: o.ts, confirmedAt: o.t['check_date:wheelchair'] ?? null, checkedAt: o.t.check_date ?? null, status: 'map' }],
    features: osmObjectFeatures(o.t, o.c, sid), searchName: [], searchExtra: [],
  };
  for (const e of o.e) {
    const esid = `osm:${e.id}`;
    const facts = osmEntranceFeatures(e, esid);
    if (!facts.length) continue;
    rec.sources.push({ id: esid, kind: 'osm', label: LABELS.osmEntrance.pl, labelKey: 'osmEntrance', url: osmUrl(e.id), obtainedAt, editedAt: e.ts, confirmedAt: e.t['check_date:wheelchair'] ?? null, checkedAt: e.t.check_date ?? null, status: 'map' });
    rec.features.push(...facts);
  }
  return rec;
}

const GENERIC_NAME_WORDS = new Set(['urzad', 'miasta', 'krakowa', 'krakow', 'wydzial', 'zarzad', 'miejski', 'miejskie', 'w', 'i', 'im', 'dla', 'oddzial', 'krakowie', 'budynek', 'ul', 'ulica']);
const significant = (name: string) => words(name).filter(w => w.length >= 3 && !GENERIC_NAME_WORDS.has(w));
/** Names share a distinctive word, or one contains the other. */
export function similarNames(a: string, b: string) {
  const fa = fold(a), fb = fold(b);
  if (fa.includes(fb) || fb.includes(fa)) return true;
  const sb = new Set(significant(b));
  return significant(a).some(w => sb.has(w));
}
const ADDRESS_NOISE = new Set(['ulica', 'ul', 'aleja', 'al', 'plac', 'pl', 'osiedle', 'os', 'rynek']);
function addressKey(address: string) {
  const w = words(address).filter(x => !ADDRESS_NOISE.has(x));
  const number = w.find(x => /^\d/.test(x));
  const street = w.filter(x => !/^\d/.test(x)).pop();
  return number && street ? `${street} ${number}` : null;
}
/** Same street (last name word) and same first house number, ignoring "ulica"/"al." prefixes and first names. */
export const sameAddress = (a?: string, b?: string) => !!a && !!b && addressKey(a) !== null && addressKey(a) === addressKey(b);

// ---------- Catalogue ----------
type Grid = Map<number, number[]>;
const CELL = 0.002;
const cellKey = (lat: number, lon: number) => Math.floor(lat / CELL) * 100000 + Math.floor(lon / CELL);
export type Catalog = { recs: Rec[]; byId: Map<string, Rec>; byOsm: Map<string, Rec>; grid: Grid };
function nearby(cat: Catalog, p: { lat: number; lon: number }, radius: number) {
  const out: { rec: Rec; d: number }[] = [];
  const cy = Math.floor(p.lat / CELL), cx = Math.floor(p.lon / CELL);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const i of cat.grid.get((cy + dy) * 100000 + cx + dx) ?? []) {
    const d = metres(p, cat.recs[i]); if (d <= radius) out.push({ rec: cat.recs[i], d });
  }
  return out.sort((a, b) => a.d - b.d);
}
function index(recs: Rec[]): Catalog {
  const byId = new Map<string, Rec>(), byOsm = new Map<string, Rec>(), grid: Grid = new Map();
  recs.forEach((r, i) => {
    byId.set(r.id, r);
    for (const o of r.osmIds) byOsm.set(o, r);
    const k = cellKey(r.lat, r.lon); const l = grid.get(k); if (l) l.push(i); else grid.set(k, [i]);
  });
  return { recs, byId, byOsm, grid };
}
function addRec(cat: Catalog, r: Rec) {
  cat.recs.push(r); cat.byId.set(r.id, r);
  const k = cellKey(r.lat, r.lon); const l = cat.grid.get(k); if (l) l.push(cat.recs.length - 1); else cat.grid.set(k, [cat.recs.length - 1]);
}
function finishSearch(r: Rec) {
  r.searchName = [...words(r.name ?? UNNAMED_TOILET.pl), ...Object.values(r.names).flatMap(n => words(n!)), ...r.aliases.flatMap(words)];
  r.searchExtra = [...words(r.address ?? ''), ...words(categoryLabel(r.category, 'pl')), ...words(categoryLabel(r.category, 'en'))];
}

function attachCity(cat: Catalog, file: CityVenuesFile) {
  for (const v of file.venues) {
    if (v.lat === null || v.lon === null) continue; // Unresolved address: listed in the data file, never placed on a guessed point.
    const sid = `city:${v.id}`;
    // The list's original wording stays with its source; the facts carry each phrase as their detail.
    const source = { id: sid, kind: 'city' as const, label: LABELS.city.pl, labelKey: 'city' as const, url: file.source.url, obtainedAt: file.source.obtainedAt, confirmedAt: null, editedAt: null, status: 'city' as const, note: `${v.name}: ${v.adaptations.join('; ')}`.slice(0, 300) };
    const features = v.features.map(f => ({ ...f, sourceId: sid }));
    // Same place: OSM object within 60 m with a similar name, or an OSM office at the same address within 150 m.
    const match = nearby(cat, v as { lat: number; lon: number }, 150).find(({ rec, d }) => (d <= 60 && !!rec.name && similarNames(rec.name, v.name)) || (rec.category === 'office' && sameAddress(rec.address, v.address)));
    if (match) {
      const rec = match.rec;
      rec.sources.push(source); rec.features.push(...features);
      if (!rec.name || !similarNames(rec.name, v.name)) rec.aliases.push(v.name);
      rec.address ??= v.address;
      continue;
    }
    // Several city units can share one building (e.g. Powstania Warszawskiego 10): they stay separate entries.
    addRec(cat, { id: `city-${v.id}`, name: v.name, names: {}, aliases: [], category: 'office', lat: v.lat, lon: v.lon, address: v.address, osmIds: [], sources: [source], features, searchName: [], searchExtra: [] });
  }
}

export const DEMO_PARTNER: PartnerRecord = {
  id: 'demo-hotel', name: 'Hotel Przykładowy (dane demonstracyjne)', category: 'hotel', lat: 50.06325, lon: 19.94135,
  address: 'Adres przykładowy — to nie jest prawdziwy hotel', contactEmail: 'demo@example.invalid',
  description: 'Przykład, jak obiekt partnerski opisuje dostępność. Wszystkie dane są demonstracyjne i nie dotyczą żadnego prawdziwego miejsca.',
  tagline: 'Przykładowa wizytówka partnera', promote: true, plan: 'partner', example: true, obtainedAt: '2026-10-03T00:00:00.000Z',
  features: [
    { key: 'step_free_entrance', value: 'yes', detail: 'Wejście główne bez progu (przykład)' },
    { key: 'entrance_steps', value: 'no', detail: '0 stopni (przykład)' },
    { key: 'door_width', value: 'yes', detail: '95 cm (przykład)' },
    { key: 'automatic_door', value: 'yes', detail: 'Drzwi przesuwne na czujnik (przykład)' },
    { key: 'lift', value: 'yes', detail: 'Winda 110 × 140 cm do wszystkich pięter (przykład)' },
    { key: 'accessible_toilet', value: 'yes', detail: 'Łazienka przystosowana w 2 pokojach i przy recepcji (przykład)' },
    { key: 'disabled_parking', value: 'yes', detail: '2 miejsca przy wejściu (przykład)' },
    { key: 'hearing_loop', value: 'yes', detail: 'Pętla indukcyjna przy recepcji (przykład)' },
    { key: 'staff_assistance', value: 'yes', detail: 'Pomoc personelu przez całą dobę (przykład)' },
    { key: 'seating', value: 'yes', detail: 'Miejsca do odpoczynku w holu (przykład)' },
    { key: 'surface', value: 'yes', detail: 'Równe płyty przed wejściem (przykład)' },
  ],
};
export const DEMO_PARTNER_OBJECT_ID = `partner-${DEMO_PARTNER.id}`;

function partnerInfo(p: PartnerRecord): PartnerInfo {
  // In the prototype promotion needs the paid "partner" plan; billing and verification are future work.
  return { promoted: p.promote && p.plan === 'partner', plan: p.plan, example: !!p.example, ...(p.website ? { website: p.website } : {}), ...(p.tagline ? { tagline: p.tagline } : {}) };
}
function attachPartner(cat: Catalog, p: PartnerRecord) {
  const sid = `partner:${p.id}`;
  const status = p.example ? 'example' as const : 'partner' as const;
  const source = { id: sid, kind: 'partner' as const, label: (p.example ? LABELS.example : LABELS.partner).pl, labelKey: p.example ? 'example' as const : 'partner' as const, ...(p.website ? { url: p.website } : {}), obtainedAt: p.obtainedAt, confirmedAt: null, editedAt: p.obtainedAt, status };
  const features = p.features.map(f => ({ key: f.key, value: f.value, sourceId: sid, ...(f.detail ? { detail: f.detail } : {}) }));
  const existing = p.existingObjectId ? cat.byId.get(p.existingObjectId) : undefined;
  if (existing) {
    existing.sources.push(source); existing.features.push(...features);
    existing.partner = partnerInfo(p);
    existing.website ??= p.website;
    if (p.description) existing.description = existing.description ? `${existing.description}\n${p.description}` : p.description;
    return existing;
  }
  const rec: Rec = { id: `partner-${p.id}`, name: p.name, names: {}, aliases: [], category: p.category, lat: p.lat, lon: p.lon, address: p.address, website: p.website, description: p.description, osmIds: [], sources: [source], features, partner: partnerInfo(p), searchName: [], searchExtra: [] };
  addRec(cat, rec);
  return rec;
}

function attachReports(cat: Catalog, reports: Report[]) {
  for (const r of reports) {
    const target = (/^(node|way):\d+$/.test(r.locationId) ? cat.byOsm.get(r.locationId) : undefined)
      ?? (r.location ? nearby(cat, r.location, 30)[0]?.rec : undefined);
    if (!target) continue;
    // Conservative: user reports are listed as unverified sources with their own description, not turned into facts.
    target.sources.push({ id: `user:${r.id}`, kind: 'user', label: LABELS.user.pl, labelKey: 'userObservation', observation: r.observation.kind, note: r.observation.description.slice(0, 300), ...(publicPhotoPath(r) ? { url: publicPhotoPath(r)! } : {}), obtainedAt: r.obtainedAt, confirmedAt: null, editedAt: r.editedAt ?? null, status: 'unverified' });
  }
}

/** Build a catalogue from explicit inputs (used by the lazy singleton and by tests). */
export function buildCatalog(input: CatalogInput): Catalog {
  const obtained = input.osm?.obtainedAt ?? new Date(0).toISOString();
  const cat = index((input.osm?.objects ?? []).map(o => fromOsm(o, obtained)));
  if (input.city) attachCity(cat, input.city);
  for (const p of input.partners ?? []) attachPartner(cat, p);
  if (input.reports?.length) attachReports(cat, input.reports);
  for (const r of cat.recs) finishSearch(r);
  return cat;
}

// ---------- Presentation ----------
const RANK: FeatureKey[] = ['step_free_entrance', 'entrance_steps', 'accessible_toilet', 'lift', 'ramp', 'stair_lift', 'door_width', 'difficult_building', 'automatic_door', 'disabled_parking', 'staff_assistance', 'sign_language', 'hearing_loop', 'seating', 'surface'];
const SOURCE_PRIORITY: Record<string, number> = { city: 0, map: 1, partner: 2, example: 2, unverified: 3 };
const known = (f: AccessFeature) => f.value !== 'unknown';
export function conflictsOf(features: AccessFeature[]): FeatureKey[] {
  const values = new Map<FeatureKey, Set<FeatureValue>>();
  for (const f of features) { if (!known(f)) continue; const s = values.get(f.key) ?? new Set(); s.add(f.value); values.set(f.key, s); }
  return RANK.filter(k => { const s = values.get(k); return !!s && s.has('yes') && s.has('no'); });
}
function summaryOf(r: Rec, locale: Locale, origin?: { lat: number; lon: number }): PlaceObjectSummary & { conflicts: FeatureKey[] } {
  const statusOf = new Map(r.sources.map(s => [s.id, s.status]));
  const prio = (f: AccessFeature) => SOURCE_PRIORITY[statusOf.get(f.sourceId) ?? 'unverified'] ?? 9;
  const sorted = [...r.features].sort((a, b) => RANK.indexOf(a.key) - RANK.indexOf(b.key) || prio(a) - prio(b));
  const highlights: AccessFeature[] = [];
  for (const f of sorted) if (known(f) && !highlights.some(h => h.key === f.key) && highlights.length < 4) highlights.push(f);
  // Overall wheelchair value as stated by the best source for step-free entrance (city > map object > map entrance > partner).
  const entranceSources = new Set(r.sources.filter(s => s.labelKey === 'osmEntrance').map(s => s.id));
  const rank = (f: AccessFeature) => prio(f) * 2 + (entranceSources.has(f.sourceId) ? 1 : 0);
  const entrance = r.features.filter(f => f.key === 'step_free_entrance' && known(f)).sort((a, b) => rank(a) - rank(b))[0];
  // Different entrances of one building legitimately differ (e.g. steps at the front, ramp from the yard), so entrance-node
  // facts are shown as details but do not create conflicts; conflicts are between whole-object claims of different sources.
  const conflicts = conflictsOf(r.features.filter(f => !entranceSources.has(f.sourceId)));
  const toiletValue = r.category === 'toilet' ? r.features.find(f => f.key === 'accessible_toilet')?.value : undefined;
  const name = r.names[locale] ?? r.name ?? UNNAMED_TOILET[locale];
  return {
    id: r.id, name, category: r.category, categoryLabel: categoryLabel(r.category, locale), lat: r.lat, lon: r.lon,
    ...(r.address ? { address: r.address } : {}),
    wheelchair: entrance?.value ?? toiletValue ?? 'unknown', highlights,
    knownCount: new Set(r.features.filter(known).map(f => f.key)).size,
    hasConflict: conflicts.length > 0, conflicts,
    ...(r.partner ? { partner: r.partner } : {}),
    ...(origin ? { distance: Math.round(metres(origin, r)) } : {}),
  };
}
function fullOf(r: Rec, locale: Locale): PlaceObject {
  const { conflicts, ...summary } = summaryOf(r, locale);
  return {
    ...summary, conflicts, features: r.features,
    sources: r.sources.map(({ labelKey, observation, note, ...s }) => ({
      ...s, ...(labelKey === 'osmEntrance' ? { part: 'entrance' as const } : {}),
      label: labelKey === 'userObservation' ? `${LABELS.user[locale]}: ${OBSERVATION_LABELS[observation ?? 'other'][locale]}` : LABELS[labelKey][locale],
      ...(note ? { note } : {}),
    })),
    ...(r.website ? { website: r.website } : {}), ...(r.openingHours ? { openingHours: r.openingHours } : {}), ...(r.description ? { description: r.description } : {}),
  };
}

/** "west,south,east,north" in degrees: the visible map area. */
export const bboxParamSchema = z.string().max(120)
  .transform(v => v.split(',').map(x => (x.trim() ? Number(x) : NaN)))
  .pipe(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-90).max(90)]))
  .refine(([w, s, e, n]) => w < e && s < n);
/** "lat,lon" in degrees: the map centre that results are ranked around. */
export const centerParamSchema = z.string().max(60)
  .transform(v => v.split(',').map(x => (x.trim() ? Number(x) : NaN)))
  .pipe(z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]))
  .transform(([lat, lon]) => ({ lat, lon }));
const knownKeys = (r: Rec) => new Set(r.features.filter(known).map(f => f.key)).size;
/** Without a map area, promoted partners are lifted only when within this distance of the ranking point (if given). */
const PROMOTION_RADIUS = 5000;

// Web Mercator position in [0, 1]²: quadtree cells are then map tiles, fixed to the world, so picks stay put when the map pans.
const mercX = (lon: number) => (lon + 180) / 360;
const mercY = (lat: number) => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
/** Finer quadtree levels visited after the coarsest; 2^8 cells across the area is finer than any two distinct pins. */
const SPREAD_LEVELS = 8;
/**
 * Order for browsing a map area, like the labels of a map app: the first places are spread over the whole area,
 * later ones fill in. `items` must come best first. Pass 0 takes the best item of each map tile about the size of
 * the area, pass 1 the best not-yet-picked item of each tile one zoom level finer that holds no pick yet, and so
 * on; what is left follows in rank order. Within a pass picks keep rank order. Deterministic for the same items
 * and area, so offset paging never repeats or skips; zooming out spreads picks over a wider area automatically.
 */
export function spreadOrder<T extends { lat: number; lon: number }>(items: T[], bbox: [number, number, number, number]): T[] {
  if (items.length < 3) return items;
  const span = Math.max(mercX(bbox[2]) - mercX(bbox[0]), mercY(bbox[1]) - mercY(bbox[3]), 1e-9);
  const z0 = Math.max(0, Math.min(24, Math.floor(Math.log2(1 / span))));
  const pos = items.map(i => ({ x: mercX(i.lon), y: mercY(i.lat) }));
  const picked = new Uint8Array(items.length);
  const order: number[] = [];
  for (let level = 0; level <= SPREAD_LEVELS && order.length < items.length; level++) {
    const n = 2 ** (z0 + level);
    const x0 = Math.floor(mercX(bbox[0]) * n), y0 = Math.floor(mercY(bbox[3]) * n);
    // Small relative cell numbers keep keys exact at any zoom.
    const key = (i: number) => (Math.floor(pos[i].x * n) - x0 + 1) * 1_000_003 + (Math.floor(pos[i].y * n) - y0 + 1);
    const taken = new Set<number>();
    for (const i of order) taken.add(key(i));
    for (let i = 0; i < items.length; i++) {
      if (picked[i]) continue;
      const k = key(i);
      if (taken.has(k)) continue;
      taken.add(k); picked[i] = 1; order.push(i);
    }
  }
  for (let i = 0; i < items.length; i++) if (!picked[i]) order.push(i);
  return order.map(i => items[i]);
}
export function queryCatalog(cat: Catalog, query: ObjectQuery): PlaceObjectSummary[] {
  return queryCatalogPage(cat, query).objects;
}
/** One page of results; the order is total (ties broken by id), so pages never overlap or skip. */
export function queryCatalogPage(cat: Catalog, query: ObjectQuery): ObjectPage {
  const locale = query.locale ?? 'pl';
  const limit = Math.min(Math.max(Math.floor(query.limit ?? 30), 1), 100);
  const offset = Math.max(Math.floor(query.offset ?? 0), 0);
  const origin = query.lat !== undefined && query.lon !== undefined ? { lat: query.lat, lon: query.lon } : undefined;
  // Ranking point: the map centre when given (browsing the visible area), else the user's point.
  const rank = query.center ?? origin;
  const tokens = words(query.q ?? '');
  const bbox = query.bbox;
  let outside = 0;
  const scored: { r: Rec; score: number; d: number; k: number }[] = [];
  for (const r of cat.recs) {
    if (query.category && r.category !== query.category) continue;
    const k = knownKeys(r);
    if (query.withData && !k) continue;
    let score = 0;
    if (tokens.length) {
      let ok = true;
      for (const t of tokens) {
        if (r.searchName.some(w => w === t)) score += 3;
        else if (r.searchName.some(w => w.startsWith(t))) score += 2;
        else if (r.searchExtra.some(w => w.startsWith(t))) score += 1;
        else { ok = false; break; }
      }
      if (!ok) continue;
    }
    if (bbox && !(r.lon >= bbox[0] && r.lat >= bbox[1] && r.lon <= bbox[2] && r.lat <= bbox[3])) { outside++; continue; }
    scored.push({ r, score, d: rank ? metres(rank, r) : 0, k });
  }
  // A visible map area already limits how far away a promoted partner can be.
  const promoted = (x: { r: Rec; d: number }) => !!x.r.partner?.promoted && (!rank || !!bbox || x.d <= PROMOTION_RADIUS);
  // With a text query: relevance, then distance. Without: objects with more known facts first, then distance,
  // so "no data" entries do not crowd the top. Browsing a visible map area: the best places spread over the
  // whole area (spreadOrder), places with facts before those without. Promoted partners always lead (flagged).
  const byData = (a: { k: number }, b: { k: number }) => b.k - a.k;
  const byDistance = (a: { d: number }, b: { d: number }) => (rank ? a.d - b.d : 0);
  const browsing = !!bbox && !tokens.length;
  scored.sort((a, b) => Number(promoted(b)) - Number(promoted(a))
    || (tokens.length ? b.score - a.score || byDistance(a, b) || byData(a, b)
      : browsing ? byData(a, b) || b.r.sources.length - a.r.sources.length || Number(!a.r.name) - Number(!b.r.name) : byData(a, b) || byDistance(a, b))
    || (browsing ? 0 : (a.r.name ?? '').localeCompare(b.r.name ?? '', 'pl'))
    || (a.r.id < b.r.id ? -1 : a.r.id > b.r.id ? 1 : 0));
  let ordered = scored;
  if (browsing) {
    const tier = (x: { r: Rec; d: number; k: number }) => (promoted(x) ? 0 : x.k ? 1 : 2);
    ordered = [0, 1, 2].flatMap(n => spreadOrder(scored.filter(x => tier(x) === n).map(x => ({ ...x, lat: x.r.lat, lon: x.r.lon })), bbox));
  }
  const objects = ordered.slice(offset, offset + limit).map(x => { const { conflicts: _c, ...s } = summaryOf(x.r, locale, origin); return s; });
  const next = offset + limit;
  return { objects, total: ordered.length, nextOffset: next < ordered.length ? next : null, ...(bbox ? { outside } : {}) };
}

// ---------- Accessible toilets for the journey planner ----------
export type AccessibleToilet = {
  objectId: string; name: string | null; lat: number; lon: number;
  /** 'yes' = accessible, 'limited' = partly accessible (as stated by the source). */
  value: 'yes' | 'limited'; sourceUrl: string; editedAt: string | null; obtainedAt: string;
  status: CityFact['status']; sourceLabel: string; confirmedAt: string | null;
};
/**
 * Toilets a wheelchair user can rely on: a toilet with wheelchair=yes|limited, or any place whose source states
 * an accessible toilet (toilets:wheelchair=yes, city list, partner). Unknown toilets are never included, and a
 * place where any source says "no" is left out.
 */
export function accessibleToiletsOf(cat: Catalog): AccessibleToilet[] {
  const out: AccessibleToilet[] = [];
  for (const r of cat.recs) {
    // Demonstration declarations must never become operational amenities, even after Explore
    // has loaded the partner overlay. Keep real sources when a place also has an example source.
    const sources = new Map(r.sources.filter(s => s.status !== 'example').map(s => [s.id, s]));
    const facts = r.features.filter(f => f.key === 'accessible_toilet' && sources.has(f.sourceId));
    if (!facts.length || facts.some(f => f.value === 'no')) continue;
    const isToilet = r.category === 'toilet';
    const best = facts.find(f => f.value === 'yes') ?? (isToilet ? facts.find(f => f.value === 'limited') : undefined);
    if (!best) continue;
    const source = sources.get(best.sourceId)!;
    out.push({
      objectId: r.id, name: r.name, lat: r.lat, lon: r.lon, value: best.value === 'yes' ? 'yes' : 'limited',
      sourceUrl: source.url ?? '', editedAt: source.editedAt ?? null, obtainedAt: source.obtainedAt,
      status: source.kind === 'osm' ? 'osm' : source.kind === 'user' ? 'unverified' : source.kind,
      sourceLabel: source.label, confirmedAt: source.confirmedAt,
    });
  }
  return out;
}
let toiletCache: { cat: Catalog; toilets: AccessibleToilet[] } | undefined;
let baseCatalog: Catalog | undefined;
/**
 * Synchronous access for the planner: the latest full catalogue if Explore has loaded it (with partners),
 * otherwise OSM + city data only. Recomputed only when the catalogue changes.
 */
export function accessibleToilets(): AccessibleToilet[] {
  const cat = cached?.cat ?? (baseCatalog ??= buildCatalog(loadBase()));
  if (toiletCache?.cat !== cat) toiletCache = { cat, toilets: accessibleToiletsOf(cat) };
  return toiletCache.toilets;
}
/**
 * Ids of the OSM entrance nodes on or inside the building of the catalogued place at this point, or null when no
 * catalogued place is there or its building has no mapped entrances (then nearby entrances may belong to anyone).
 */
export function ownEntrancesAt(place: { lat: number; lon: number }, within = 20): string[] | null {
  const osm = loadBase().osm;
  if (!osm) return null;
  const metres = (r: OsmRecord) => Math.hypot((r.la - place.lat) * 111_320, (r.lo - place.lon) * 111_320 * Math.cos((place.lat * Math.PI) / 180));
  let best: { r: OsmRecord; d: number } | null = null;
  for (const r of osm.objects) {
    if (Math.abs(r.la - place.lat) > 0.001 || !r.e.some(e => e.d === 0)) continue;
    const d = metres(r);
    if (d <= within && (!best || d < best.d)) best = { r, d };
  }
  return best ? best.r.e.filter(e => e.d === 0).map(e => e.id.replace(/^node[:/]/, '')) : null;
}
export function getFromCatalog(cat: Catalog, id: string, locale: Locale = 'pl'): PlaceObject | null {
  const r = cat.byId.get(id);
  return r ? fullOf(r, locale) : null;
}

// ---------- Partner submissions ----------
const featureKeys = ['step_free_entrance', 'entrance_steps', 'ramp', 'lift', 'stair_lift', 'door_width', 'automatic_door', 'accessible_toilet', 'disabled_parking', 'seating', 'sign_language', 'hearing_loop', 'staff_assistance', 'difficult_building', 'surface'] as const satisfies readonly FeatureKey[];
const categories = ['museum', 'landmark', 'culture', 'office', 'toilet', 'hotel', 'food', 'health', 'park', 'parking', 'other'] as const satisfies readonly ObjectCategory[];
export const partnerSubmissionSchema = z.object({
  name: z.string().trim().min(2).max(160),
  category: z.enum(categories),
  lat: z.number().min(49.94).max(50.2),
  lon: z.number().min(19.75).max(20.25),
  address: z.string().trim().max(200).optional(),
  website: z.url({ protocol: /^https?$/ }).max(300).optional(),
  contactEmail: z.email().max(200),
  features: z.array(z.object({ key: z.enum(featureKeys), value: z.enum(['yes', 'limited', 'no', 'unknown']), detail: z.string().trim().max(200).optional() })).max(30)
    .refine(list => new Set(list.map(f => f.key)).size === list.length, 'Each feature key may appear once.'),
  description: z.string().trim().max(600).optional(),
  promote: z.boolean(),
  plan: z.enum(['free', 'partner']),
  existingObjectId: z.string().max(120).optional(),
  /** Interface language of the form: language of error messages and of the returned object. Not stored. */
  locale: z.enum(locales).optional(),
}).strict();
export type PartnerSubmission = z.infer<typeof partnerSubmissionSchema>;
export class PartnerInputError extends Error {}

type FieldMessages = Record<'location' | 'unknown' | 'other', string> & Partial<Record<string, string>>;
const LOCATION_FIELDS = new Set(['lat', 'lon']);

/** One localised message per invalid top-level field; unknown keys are listed by name. */
export function partnerFieldErrors(error: z.ZodError, messages: FieldMessages) {
  const out = new Map<string, string>();
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) out.set([...issue.path, key].join('.'), messages.unknown);
      continue;
    }
    const field = String(issue.path[0] ?? '');
    if (out.has(field)) continue;
    const message = LOCATION_FIELDS.has(field) ? messages.location : messages[field] ?? messages.other;
    out.set(field, message);
  }
  return [...out].map(([path, message]) => ({ path, message }));
}

// ---------- Lazy singleton over files + SQLite ----------
type Base = { osm: OsmFile | null; city: CityVenuesFile | null };
let base: Base | undefined;
let cached: { cat: Catalog; at: number } | undefined;
const OVERLAY_TTL = 15_000;
function loadBase(): Base {
  if (base) return base;
  const root = /* turbopackIgnore: true */ process.cwd();
  const osmFile = path.join(root, 'data/krakow-objects.json.gz');
  const cityFile = path.join(root, 'data/krakow-city-venues.json');
  base = {
    osm: existsSync(osmFile) ? JSON.parse(gunzipSync(readFileSync(osmFile)).toString('utf8')) as OsmFile : null,
    city: existsSync(cityFile) ? JSON.parse(readFileSync(cityFile, 'utf8')) as CityVenuesFile : null,
  };
  return base;
}
async function store() { return import('./server'); }
function ensurePartnerTable(db: import('node:sqlite').DatabaseSync) {
  db.exec('CREATE TABLE IF NOT EXISTS partner_objects (id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at TEXT NOT NULL)');
}
async function catalog(): Promise<Catalog> {
  if (cached && Date.now() - cached.at < OVERLAY_TTL) return cached.cat;
  const { db, listReports } = await store();
  ensurePartnerTable(db());
  const partners = (db().prepare('SELECT body FROM partner_objects ORDER BY rowid').all() as { body: string }[]).map(r => JSON.parse(r.body) as PartnerRecord);
  const demo = process.env.KROK_DEMO_PARTNER === '0' ? [] : [DEMO_PARTNER];
  // The base (OSM + city) is parsed once; rebuilding records from it with the overlay takes a few ms.
  const cat = buildCatalog({ ...loadBase(), partners: [...demo, ...partners], reports: listReports() });
  cached = { cat, at: Date.now() };
  return cat;
}
export async function listObjects(query: ObjectQuery): Promise<PlaceObjectSummary[]> { return queryCatalog(await catalog(), query); }
export async function listObjectPage(query: ObjectQuery): Promise<ObjectPage> { return queryCatalogPage(await catalog(), query); }
export async function getObject(id: string, locale: Locale = 'pl'): Promise<PlaceObject | null> { return getFromCatalog(await catalog(), id, locale); }
/** Validate and store a partner submission; returns the public object (contact e-mail is never included). */
export async function savePartnerObject(input: unknown, locale: Locale = 'pl'): Promise<PlaceObject> {
  const { locale: formLocale, ...data } = partnerSubmissionSchema.parse(input);
  if (formLocale) locale = formLocale;
  if (data.existingObjectId && !(await catalog()).byId.has(data.existingObjectId)) throw new PartnerInputError('existingObjectId');
  const record: PartnerRecord = { ...data, id: randomUUID(), obtainedAt: new Date().toISOString() };
  const { db } = await store();
  ensurePartnerTable(db());
  db().prepare('INSERT INTO partner_objects (id, body, created_at) VALUES (?, ?, ?)').run(record.id, JSON.stringify(record), record.obtainedAt);
  cached = undefined;
  const object = await getObject(data.existingObjectId ?? `partner-${record.id}`, locale);
  if (!object) throw new Error('Partner object not found after save');
  return object;
}
