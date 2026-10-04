// Deterministic parser for the UMK page "Dostępność budynków Urzędu Miasta Krakowa i MJO"
// (https://www.krakow.pl/getHtml?dok_id=2848) and the mapping of its phrases to FeatureKeys.
// Pure module: used by scripts/acquire-city-venues.ts and by tests. The original phrase is always kept as detail.
import type { FeatureKey, FeatureValue } from './explore-types';

export const UMK_SOURCE_URL = 'https://www.krakow.pl/getHtml?dok_id=2848';

type CityFeature = { key: FeatureKey; value: FeatureValue; detail: string };
export type ParsedVenue = { name: string; address: string; adaptations: string[]; features: CityFeature[]; unmapped: string[] };
export type CityVenue = ParsedVenue & {
  id: string;
  lat: number | null;
  lon: number | null;
  /** How the address was resolved (local OSM address index), or why it was not. */
  geocode: { status: 'resolved'; match: string; osmRef: string } | { status: 'unresolved'; reason: string };
};
export type CityVenuesFile = {
  v: 1;
  source: { url: string; title: string; obtainedAt: string; sha256: string; publisher: string };
  venues: CityVenue[];
  unresolved: string[];
};

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', oacute: 'ó', Oacute: 'Ó', bdquo: '„', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' };
function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === '#') return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10));
    return ENTITIES[code] ?? all;
  });
}
const plain = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
/** Trailing full stops are list punctuation on the page, not content. */
const tidy = (phrase: string) => phrase.replace(/[.;,\s]+$/, '').trim();

/** Ordered rules: first match wins per phrase; some phrases yield two facts. */
const RULES: { test: RegExp; facts: [FeatureKey, FeatureValue][] }[] = [
  { test: /brak możliwości wjazdu na wyższe piętra/i, facts: [['lift', 'no']] },
  { test: /budynek niedostosowany/i, facts: [['step_free_entrance', 'no'], ['difficult_building', 'yes']] },
  { test: /trudny architektonicznie|wiele ciągów schodowych/i, facts: [['difficult_building', 'yes']] },
  { test: /schodołaz/i, facts: [['stair_lift', 'yes']] },
  { test: /platforma/i, facts: [['stair_lift', 'yes']] },
  { test: /\bwind/i, facts: [['lift', 'yes']] },
  { test: /podjazd/i, facts: [['ramp', 'yes']] },
  { test: /wejście do budynku dostosowane/i, facts: [['step_free_entrance', 'yes']] },
  { test: /\bWC\b.*(przystosowane|dostosowane)/i, facts: [['accessible_toilet', 'yes']] },
  { test: /język(u|a)? migow/i, facts: [['sign_language', 'yes']] },
  { test: /zejścia urzędnika|wideofon/i, facts: [['staff_assistance', 'yes']] },
];
export function mapAdaptation(phrase: string): CityFeature[] {
  const rule = RULES.find(r => r.test.test(phrase));
  return rule ? rule.facts.map(([key, value]) => ({ key, value, detail: phrase })) : [];
}

/** Parse the page into venues. Throws if the structure is not recognised (so a changed page never overwrites good data). */
export function parseUmkHtml(html: string): ParsedVenue[] {
  const venues: ParsedVenue[] = [];
  // Each venue: <h5 ...>Name</h5> followed by <p><strong>adres:</strong> …</p> <p><strong>dostosowania:</strong> [inline]</p> [<ul><li>…</li></ul>]
  const sections = html.split(/<h5\b[^>]*>/i).slice(1);
  for (const section of sections) {
    const close = section.search(/<\/h5>/i);
    if (close < 0) continue;
    const name = plain(section.slice(0, close));
    const body = section.slice(close);
    const address = body.match(/<strong>\s*adres:\s*<\/strong>([\s\S]*?)<\/p>/i);
    if (!address) continue; // Introductory paragraph.
    const adaptationsBlock = body.match(/<strong>\s*dostosowania:\s*<\/strong>([\s\S]*?)<\/p>\s*(<ul>([\s\S]*?)<\/ul>)?/i);
    const adaptations: string[] = [];
    if (adaptationsBlock) {
      const inline = tidy(plain(adaptationsBlock[1]));
      if (inline) adaptations.push(inline);
      for (const li of (adaptationsBlock[3] ?? '').matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) { const phrase = tidy(plain(li[1])); if (phrase) adaptations.push(phrase); }
    }
    const features = adaptations.flatMap(mapAdaptation);
    venues.push({ name, address: plain(address[1]), adaptations, features, unmapped: adaptations.filter(p => !mapAdaptation(p).length) });
  }
  if (venues.length < 5 || !/Dostępność budynków Urzędu Miasta Krakowa/i.test(html)) throw new Error(`Unrecognised UMK page structure (${venues.length} venues)`);
  return venues;
}

/** "Ulica Wielicka 28 a" → "Wielicka 28a"; "Aleja X 10" → "Aleja X 10" (kept, the index has "aleja" in names). */
export function addressQuery(address: string) {
  return address.replace(/^ulica\s+/i, '').replace(/(\d+)\s+([a-z])\b/i, '$1$2').trim();
}

export function venueSlug(name: string) {
  return name.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}
