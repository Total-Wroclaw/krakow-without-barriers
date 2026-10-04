// Contract for the "Odkrywaj" (explore places) tab and partner-provided accessibility data.
import type { Locale } from './i18n/locales';

export type ObjectCategory = 'museum' | 'landmark' | 'culture' | 'office' | 'toilet' | 'hotel' | 'food' | 'health' | 'park' | 'parking' | 'other';

export type FeatureValue = 'yes' | 'limited' | 'no' | 'unknown';

/** Concrete barrier/amenity facts. Never collapsed into a single "accessible" badge. */
export type FeatureKey =
  | 'step_free_entrance'
  | 'entrance_steps'
  | 'ramp'
  | 'lift'
  | 'stair_lift'
  | 'door_width'
  | 'automatic_door'
  | 'accessible_toilet'
  | 'disabled_parking'
  | 'seating'
  | 'sign_language'
  | 'hearing_loop'
  | 'staff_assistance'
  | 'difficult_building'
  | 'surface';

export type AccessFeature = {
  key: FeatureKey;
  value: FeatureValue;
  /** Original wording or measured value, e.g. "3 stopnie", "90 cm", "podjazd od podwórka". */
  detail?: string;
  /** Which ObjectSource says this. */
  sourceId: string;
};

export type SourceStatus = 'map' | 'city' | 'partner' | 'unverified' | 'example';

export type ObjectSource = {
  id: string;
  kind: 'osm' | 'city' | 'partner' | 'user';
  label: string;
  url?: string;
  obtainedAt: string;
  /** Date the accessibility information was confirmed on site, if anyone did (OSM: check_date:wheelchair). */
  confirmedAt: string | null;
  /** A general survey date (OSM check_date): the place was checked, not necessarily its accessibility. */
  checkedAt?: string | null;
  /** Last edit at the source (e.g. OSM edit time); not a field confirmation. */
  editedAt?: string | null;
  status: SourceStatus;
  /** Free-text content of the source: an unverified user report's description, or the original wording of a list. */
  note?: string;
  /** Set when the source describes one entrance of the building rather than the whole place. */
  part?: 'entrance';
};

export type PartnerInfo = {
  promoted: boolean;
  plan: 'free' | 'partner';
  tagline?: string;
  website?: string;
  /** True for clearly labelled demonstration partners. */
  example: boolean;
};

export type PlaceObjectSummary = {
  id: string;
  name: string;
  category: ObjectCategory;
  /** Localised category label. */
  categoryLabel: string;
  lat: number;
  lon: number;
  address?: string;
  /** Overall wheelchair tag exactly as given by the best source; 'unknown' when absent. */
  wheelchair: FeatureValue;
  /** Up to 4 most relevant known features for list rows. */
  highlights: AccessFeature[];
  /** Number of features with known values (yes/limited/no). */
  knownCount: number;
  hasConflict: boolean;
  partner?: PartnerInfo;
  distance?: number;
};

export type PlaceObject = PlaceObjectSummary & {
  features: AccessFeature[];
  sources: ObjectSource[];
  /** Feature keys where sources disagree. */
  conflicts: FeatureKey[];
  website?: string;
  openingHours?: string;
  description?: string;
};

export type ObjectQuery = {
  category?: ObjectCategory;
  q?: string;
  lat?: number;
  lon?: number;
  limit?: number;
  locale?: Locale;
  /** Only objects with at least one known (yes/limited/no) feature. */
  withData?: boolean;
  /** Paging for infinite scroll. */
  offset?: number;
  /** Visible map area [west, south, east, north] (degrees): only objects inside it are listed. */
  bbox?: [number, number, number, number];
  /** Map centre to rank by (nearest first); lat/lon stay the user's point for the shown distances. */
  center?: { lat: number; lon: number };
};

/** The visible map area, reported by the map after it stops moving. `user` is false for camera moves the app makes. */
export type MapViewport = {
  bbox: [number, number, number, number];
  center: { lat: number; lon: number };
  zoom: number;
  user: boolean;
};

export type ObjectPage = {
  objects: PlaceObjectSummary[]; total: number; nextOffset: number | null;
  /** With a bbox: how many objects match the same search outside it (for "search all of Kraków"). */
  outside?: number;
};
