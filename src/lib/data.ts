// Generic OSM dataset types and tag helpers. Client-safe: no Node or data imports.
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

export function handrail(tags: Record<string, string>): 'yes' | 'no' | 'unknown' {
  const keys = ['handrail', 'handrail:left', 'handrail:right', 'handrail:center', 'handrail:both'];
  if (keys.some(k => tags[k] === 'yes')) return 'yes';
  if (tags.handrail === 'no') return 'no';
  return 'unknown';
}
