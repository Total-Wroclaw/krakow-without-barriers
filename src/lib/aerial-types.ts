// Contract of the aerial view endpoints (shared by the server and the place card).
import { z } from 'zod';
import { distance, fitWidth, inFrame, isAerialWidth, project, type AerialWidth, type Bbox, type Compass } from './aerial-geo';

export const widthSchema = z.coerce.number().int().refine(isAerialWidth).transform(w => w as AerialWidth);
/** Query of the GET image/overlay endpoints: a point inside the Kraków service envelope. */
export const aerialQuerySchema = z.object({ lat: z.coerce.number().min(49.94).max(50.2), lon: z.coerce.number().min(19.75).max(20.25) });

export type Wheelchair = 'yes' | 'limited' | 'no' | 'unknown';

/** A numbered, sourced fact drawn on the photo. Numbers are stable for a place. */
export type AerialPin = {
  n: number;
  kind: 'entrance' | 'stop' | 'parking' | 'toilet';
  lat: number;
  lon: number;
  name: string | null;
  /** Straight-line metres from the place and the compass direction to the pin. */
  distance: number;
  compass: Compass;
  sourceUrl: string;
  editedAt: string | null;
  /** Entrance: wheelchair tag; toilet: yes/limited as stated by the source. */
  wheelchair?: Wheelchair;
  steps?: number;
  ramp?: boolean;
  automaticDoor?: boolean;
  /** Door width in cm as tagged. */
  doorWidth?: number;
  main?: boolean;
  /** Stop: tram and/or bus (from the GTFS feeds), platform code, line numbers serving it. */
  modes?: ('tram' | 'bus')[];
  platform?: string;
  lines?: string[];
  /** Parking: mapped disabled spaces (null when only "yes" is tagged), fee, total capacity. */
  disabledSpaces?: number | null;
  fee?: 'yes' | 'no' | 'unknown';
  capacity?: number | null;
};

/** Small unnumbered points: benches, raised kerbs and single steps on footways. */
export type AerialMarker = { kind: 'bench' | 'kerb' | 'step'; lat: number; lon: number };
/** Mapped stairs and rough surfaces (setts, cobbles, gravel) as polylines. */
export type AerialLine = {
  id: string;
  kind: 'stairs' | 'rough';
  points: [lat: number, lon: number][];
  editedAt: string | null;
  handrail?: 'yes' | 'no' | 'unknown';
  ramp?: boolean;
  steps?: number;
  surface?: string;
};

export type AerialOverlay = {
  place: { lat: number; lon: number };
  pins: AerialPin[];
  markers: AerialMarker[];
  lines: AerialLine[];
  /** When the OSM extract and the timetable were downloaded. */
  osmObtainedAt: string | null;
  transitObtainedAt: string | null;
};

export const observationKinds = ['crossing', 'tracks', 'square', 'path', 'parking', 'steps', 'works', 'other'] as const;
export type ObservationKind = (typeof observationKinds)[number];

/** Something visible on the photo, placed automatically. Unverified by definition. */
export type AerialObservation = { id: string; kind: ObservationKind; label: string; lat: number; lon: number };

export type WeatherCondition = 'clear' | 'cloudy' | 'fog' | 'rain' | 'ice' | 'snow' | 'storm';
/** Current weather in Kraków (Open-Meteo, CC BY 4.0). */
export type Weather = { temperature: number; precipitation: number; wind: number; condition: WeatherCondition; time: string; obtainedAt: string };

/**
 * How to get in, decided for today's needs. Pins are referenced by number and always exist with the right kind
 * (validated); sentences may reference pins as [n].
 */
export type AerialRecommendation = {
  /** The entrance to use (an entrance pin), or null when no mapped entrance can be recommended. */
  entrance: number | null;
  /** Where to arrive from (a stop or parking pin), or null. */
  approachFrom: number | null;
  /** One short sentence: why this entrance (as mapped), e.g. "marked step-free in OSM". */
  why: string;
  /** 2–4 short imperative steps from arrival to the door. */
  steps: string[];
  /** What to avoid on the way (stairs, setts, tram tracks, a stepped entrance). */
  avoid: string[];
  /** What to ask or check on arrival (staff, bell, threshold, lift). */
  ask: string[];
};

export type AerialAnalysis = {
  /** Null when the model could not give a grounded recommendation. */
  recommendation: AerialRecommendation | null;
  /** Notes for today (weather, recent user reports). */
  today: string[];
  observations: AerialObservation[];
  /** Width of the analysed frame. */
  widthM: number;
  /** What the reading took into account, shown to the user. */
  basedOn: { mobility: string | null; weather: WeatherCondition | null; reports: number };
  createdAt: string;
};

/**
 * Auto frame for a place: its entrances, the nearest stop (and a second one if close), the nearest accessible
 * parking and toilet when they are within a short walk. Same result on the server (analysis crop) and client (map).
 */
export function autoWidth(overlay: AerialOverlay): AerialWidth {
  const nearestOf = (kind: AerialPin['kind'], max: number, count = 1) => overlay.pins.filter(p => p.kind === kind && p.distance <= max).sort((a, b) => a.distance - b.distance).slice(0, count);
  // Frame the way in, not the whole block: the two nearest entrances and the nearest stop/parking/toilet
  // within a short walk. Everything else stays reachable by panning and is listed in text.
  const points = [...nearestOf('entrance', 100, 2), ...nearestOf('stop', 120), ...nearestOf('parking', 100), ...nearestOf('toilet', 100)];
  // Open close-up: busy places (stations) would otherwise zoom out until pins overlap.
  return Math.min(fitWidth(overlay.place, points), 200) as AerialWidth;
}

/** Facts worth reading first, all from the overlay (no AI). Stairs, surfaces and kerbs count the frame. */
export function overlaySummary(overlay: AerialOverlay, bbox: Bbox) {
  const visible = (p: { lat: number; lon: number }) => inFrame(project(p, bbox), 0);
  const entrances = overlay.pins.filter(p => p.kind === 'entrance');
  const nearest = (kind: AerialPin['kind']) => overlay.pins.filter(p => p.kind === kind).sort((a, b) => a.distance - b.distance)[0] ?? null;
  const stairs = overlay.lines.filter(l => l.kind === 'stairs' && l.points.some(([lat, lon]) => visible({ lat, lon })));
  return {
    stepFree: entrances.filter(p => p.wheelchair === 'yes' || p.wheelchair === 'limited'),
    notAccessible: entrances.filter(p => p.wheelchair === 'no'),
    unknownEntrances: entrances.filter(p => p.wheelchair === 'unknown'),
    stop: nearest('stop'),
    parking: nearest('parking'),
    toilet: nearest('toilet'),
    stairs: stairs.length,
    stairsWithRail: stairs.filter(l => l.handrail === 'yes').length,
    rough: overlay.lines.some(l => l.kind === 'rough' && l.points.some(([lat, lon]) => visible({ lat, lon }))),
    benches: overlay.markers.filter(m => m.kind === 'bench' && visible(m)).length,
    kerbs: overlay.markers.filter(m => m.kind !== 'bench' && visible(m)).length,
  };
}

/** Stairs that get a marker and a list entry: the nearest few (all of them stay drawn as lines). */
export function nearestStairs(overlay: AerialOverlay, limit = 8) {
  return overlay.lines
    .filter(l => l.kind === 'stairs')
    .map(line => ({ line, mid: lineMiddle(line, overlay.place) }))
    .sort((a, b) => a.mid.distance - b.mid.distance)
    .slice(0, limit);
}

/** Middle vertex of a polyline: where a stairs marker sits, and its distance from the place. */
export function lineMiddle(line: AerialLine, place: { lat: number; lon: number }) {
  const [lat, lon] = line.points[Math.floor((line.points.length - 1) / 2)];
  return { lat, lon, distance: Math.round(distance(place, { lat, lon })) };
}
