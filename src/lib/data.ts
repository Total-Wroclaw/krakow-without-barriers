// Generic OSM dataset types and display helpers. Client-safe: no Node or data imports.
export type Point = { lat: number; lon: number };
export type OsmNode = Point & { id: string; tags: Record<string, string>; editedAt: string | null };
export type Way = { id: string; nodes: string[]; tags: Record<string, string>; editedAt: string | null };
export type Dataset = {
  obtainedAt: string;
  url: string;
  bbox: number[];
  nodes: Record<string, OsmNode>;
  ways: Way[];
  features: OsmNode[];
  context: { kind: string; points: number[][]; holes?: number[][][] }[];
};

export const surfaceNames: Record<string, string> = {
  paving_stones: 'kostka brukowa',
  asphalt: 'asfalt',
  sett: 'bruk kamienny',
  concrete: 'beton',
  gravel: 'żwir',
  compacted: 'nawierzchnia utwardzona',
};

export const statusNames = {
  osm: 'Dane mapowe · bez weryfikacji terenowej',
  source: 'Informacja ze źródła · bez potwierdzenia terenowego',
  unverified: 'Niezweryfikowane zgłoszenie',
  example: 'Dane przykładowe',
};

export function handrail(tags: Record<string, string>): 'yes' | 'no' | 'unknown' {
  const keys = ['handrail', 'handrail:left', 'handrail:right', 'handrail:center', 'handrail:both'];
  if (keys.some(k => tags[k] === 'yes')) return 'yes';
  if (tags.handrail === 'no') return 'no';
  return 'unknown';
}

export function date(value: string | null | undefined) {
  return value
    ? new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeZone: 'Europe/Warsaw' }).format(new Date(value))
    : 'Nieznana';
}
