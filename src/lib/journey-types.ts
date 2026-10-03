// Shared contract between the journey planner (server) and the UI.
// Times are seconds since midnight of `JourneyResult.date` in Europe/Warsaw.
import type { CityFact, CityPlace, Stop } from './city-types';

export type LegPoint = { name: string; lat: number; lon: number };

export type WalkStep = {
  instruction: string;
  distance: number;
  /** Fact shown inline in the directions list at this step (e.g. stairs). */
  factId?: string;
};

export type WalkLeg = {
  type: 'walk';
  from: LegPoint;
  to: LegPoint;
  distance: number;
  seconds: number;
  /** [lat, lon] pairs */
  geometry: [number, number][];
  steps: WalkStep[];
  /** Only facts relevant to today's preferences, de-cluttered. */
  facts: CityFact[];
  /** Departure time of this leg when part of a timed journey. */
  departure: number | null;
};

export type RideLeg = {
  type: 'ride';
  mode: 'tram' | 'bus';
  line: string;
  headsign: string;
  from: Stop;
  to: Stop;
  departure: number;
  arrival: number;
  geometry: [number, number][];
  /** Intermediate stops including from and to. */
  stops: Stop[];
  /** GTFS wheelchair_accessible: '1' yes, '2' no, other unknown. */
  wheelchair: string;
};

/** Car or taxi part of a journey (estimated from the OSM road graph, no live traffic). */
export type DriveLeg = {
  type: 'drive';
  mode: 'car' | 'taxi';
  from: LegPoint;
  to: LegPoint;
  distance: number;
  seconds: number;
  geometry: [number, number][];
  departure: number | null;
  /** Where the car is left (car mode only). */
  parking?: ParkingInfo;
};

export type ParkingInfo = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Spaces for disabled drivers when tagged (capacity:disabled or parking_space=disabled). */
  disabledSpaces: number | null;
  fee: 'yes' | 'no' | 'unknown';
  sourceUrl: string;
  editedAt: string | null;
  /** 'car_park' = amenity=parking; 'disabled_space' = a mapped disabled bay outside a mapped car park. */
  kind?: 'car_park' | 'disabled_space';
  /** Disabled spaces as tagged: count known, 'yes' without a count, 'no', or not tagged. */
  disabled?: 'yes' | 'no' | 'unknown';
  capacity?: number | null;
  /** Straight-line metres from the queried point (parkingNear). */
  distance?: number;
};

export type Leg = WalkLeg | RideLeg | DriveLeg;

/** How the trip may use vehicles. 'transit' = walking plus trams/buses. */
export type TransportMode = 'transit' | 'taxi' | 'car';

export type StairCounts = { up: number; down: number; unknown: number };

export type JourneyOption = {
  id: string;
  kind: 'walk' | 'transit' | 'taxi' | 'car';
  /** Short label, e.g. "Bez schodów" or "Najkrótsza". */
  label: string;
  legs: Leg[];
  departure: number | null;
  arrival: number | null;
  /** Total seconds door to door. */
  duration: number;
  walkingDistance: number;
  transfers: number;
  stairs: StairCounts;
  /** Number of resting places shown along the walking parts. */
  rests: number;
  /** True when the option respects today's stair preferences and distance limit. */
  fits: boolean;
  /**
   * Short, user-facing notes in the requested locale. Reasons it does not fit come first;
   * uncertainties (e.g. trip accessibility unknown, cobbles for a pushchair) may be listed
   * while `fits` is still true.
   */
  issues: string[];
};

export type JourneyResult = {
  from: CityPlace;
  to: CityPlace;
  date: string;
  options: JourneyOption[];
  /** Non-fatal problems (e.g. timetable unavailable). */
  errors: string[];
};

export type PlaceKind = 'address' | 'street' | 'poi' | 'stop' | 'current';

export type PlaceSuggestion = CityPlace & {
  kind: PlaceKind;
  /** Secondary line, e.g. district or "Przystanek · tramwaj". */
  detail?: string;
};
