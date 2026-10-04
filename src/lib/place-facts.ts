// How a place card condenses its facts: one line per feature, a headline value per feature, statements grouped by
// value. Pure and client-safe. Honesty rules: conflicting sources stay visible, nothing missing is filled in, and
// entrance facts never override what a source says about the whole place.
import type { AccessFeature, FeatureKey, FeatureValue, ObjectSource, SourceStatus } from './explore-types';

/** The facts most accessibility decisions hinge on; always shown, as "no data" when no source mentions them. */
export const keyFactKeys: FeatureKey[] = ['step_free_entrance', 'accessible_toilet', 'lift', 'disabled_parking'];
/** Card order of the other facts. */
const ORDER: FeatureKey[] = ['step_free_entrance', 'entrance_steps', 'accessible_toilet', 'lift', 'ramp', 'stair_lift', 'door_width', 'difficult_building', 'automatic_door', 'disabled_parking', 'staff_assistance', 'sign_language', 'hearing_loop', 'seating', 'surface'];
/** For these keys "yes" is the barrier (e.g. steps at the entrance). */
export const barrierWhenYes = new Set<FeatureKey>(['entrance_steps', 'difficult_building']);
const PRIORITY: Record<SourceStatus, number> = { city: 0, map: 1, partner: 2, example: 2, unverified: 3 };

export type Tone = 'good' | 'warn' | 'bad' | 'unknown';
export function toneOf(key: FeatureKey, value: FeatureValue): Tone {
  if (value === 'unknown') return 'unknown';
  if (value === 'limited') return 'warn';
  return (barrierWhenYes.has(key) ? value === 'no' : value === 'yes') ? 'good' : 'bad';
}

/** What one or more sources say with the same value, e.g. "no" for three entrances. */
export type FactStatement = {
  value: FeatureValue;
  /** Distinct details in first-seen order, with how often each appeared. */
  details: { text: string; count: number }[];
  /** Statements without any detail. */
  bare: number;
  sources: ObjectSource[];
  /** All statements are about single entrances. */
  entrance: boolean;
};
export type FactGroup = {
  key: FeatureKey;
  /** Headline: the whole-place value of the most authoritative source, else the entrances' common value. */
  value: FeatureValue;
  tone: Tone;
  /** Whole-place sources say yes and no. */
  conflict: boolean;
  /** Entrances differ from each other or from the headline. */
  mixed: boolean;
  /** No source speaks for the whole place; the headline comes from entrances (with `mixed`: "depends on the entrance"). */
  byEntrance: boolean;
  statements: FactStatement[];
};

export function groupFacts(features: AccessFeature[], sources: ObjectSource[]): FactGroup[] {
  const byId = new Map(sources.map(s => [s.id, s]));
  const keys = [...new Set(features.map(f => f.key))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return keys.map(key => {
    const facts = features.filter(f => f.key === key);
    const known = facts.filter(f => f.value !== 'unknown');
    const isEntrance = (f: AccessFeature) => byId.get(f.sourceId)?.part === 'entrance';
    const prio = (f: AccessFeature) => PRIORITY[byId.get(f.sourceId)?.status ?? 'unverified'];
    const whole = known.filter(f => !isEntrance(f)).sort((a, b) => prio(a) - prio(b));
    const doors = known.filter(isEntrance);
    const wholeValues = new Set(whole.map(f => f.value));
    const doorValues = new Set(doors.map(f => f.value));
    const conflict = wholeValues.has('yes') && wholeValues.has('no');
    const value: FeatureValue = whole[0]?.value ?? (doorValues.size === 1 ? doors[0].value : doors.length ? 'limited' : 'unknown');
    const mixed = !conflict && (doorValues.size > 1 || (!!whole.length && [...doorValues].some(v => v !== value)));
    // Statements: grouped by value (and whole place vs entrance), best value for the user first within the order seen.
    const statements: FactStatement[] = [];
    for (const f of [...whole, ...doors, ...facts.filter(x => x.value === 'unknown')]) {
      const entrance = isEntrance(f);
      let s = statements.find(x => x.value === f.value && x.entrance === entrance);
      if (!s) statements.push((s = { value: f.value, details: [], bare: 0, sources: [], entrance }));
      const source = byId.get(f.sourceId);
      if (source && !s.sources.includes(source)) s.sources.push(source);
      if (!f.detail) s.bare++;
      else {
        const d = s.details.find(x => x.text === f.detail);
        if (d) d.count++;
        else s.details.push({ text: f.detail, count: 1 });
      }
    }
    return { key, value, tone: conflict || mixed ? 'warn' : toneOf(key, value), conflict, mixed, byEntrance: !whole.length && !!doors.length, statements };
  });
}

/** Sources gathered for the provenance area: map data in one entry (place + entrances), every other source as is. */
export type SourceGroup = { status: SourceStatus; main: ObjectSource; entrances: ObjectSource[]; editedAt: string | null; confirmedAt: string | null; checkedAt: string | null };
export function groupSources(sources: ObjectSource[]): SourceGroup[] {
  const out: SourceGroup[] = [];
  const latest = (a: string | null, b: string | null | undefined) => (!b ? a : !a || b > a ? b : a);
  for (const s of sources) {
    if (s.kind === 'user') continue;
    const osm = s.kind === 'osm' ? out.find(g => g.main.kind === 'osm') : undefined;
    if (osm) {
      if (s.part === 'entrance') osm.entrances.push(s);
      osm.editedAt = latest(osm.editedAt, s.editedAt);
      osm.confirmedAt = latest(osm.confirmedAt, s.confirmedAt);
      osm.checkedAt = latest(osm.checkedAt, s.checkedAt);
      continue;
    }
    out.push({ status: s.status, main: s, entrances: s.part === 'entrance' ? [s] : [], editedAt: s.editedAt ?? null, confirmedAt: s.confirmedAt, checkedAt: s.checkedAt ?? null });
  }
  return out.sort((a, b) => PRIORITY[a.status] - PRIORITY[b.status]);
}
