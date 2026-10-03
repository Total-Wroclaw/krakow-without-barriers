import { z } from 'zod';
import { placeSchema } from './city-types';
export const preferencesSchema = z.object({
  avoidStairs: z.boolean(), avoidDown: z.boolean(), avoidUp: z.boolean(),
  preferHandrails: z.boolean(), preferRest: z.boolean(), maxDistance: z.number().int().min(100).max(3000),
  // How the person moves today. Not a diagnosis: a wheelchair or a child's pushchair changes which barriers matter.
  mobility: z.enum(['walk','crutches','wheelchair','stroller']),
  // Rest stop every N minutes of walking (0 = off). Planner looks for a bench near each mark.
  restEvery: z.number().int().min(0).max(30),
  // Show accessible toilets along the walking parts and near the destination.
  showToilets: z.boolean(),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences: Preferences = { avoidStairs:true, avoidDown:true, avoidUp:false, preferHandrails:true, preferRest:true, maxDistance:1200, mobility:'walk', restEvery:0, showToilets:false };
export const observationSchema = z.object({
  kind: z.enum(['stairs','entrance','bench','surface','other']),
  description: z.string().trim().min(3).max(800),
  direction: z.enum(['up','down','unknown']),
  handrail: z.enum(['yes','no','unknown']),
  surface: z.enum(['paving_stones','asphalt','sett','gravel','unknown']),
  uncertainty: z.string().max(400),
});
export type Observation = z.infer<typeof observationSchema>;
export const reportInputSchema = z.object({
  observation: observationSchema, locationId:z.string().min(1).max(100),
  location: placeSchema.optional(), photo: z.string().max(4_500_000).nullable(), confirmed:z.literal(true),
});
export type Report = { id:string; observation:Observation; locationId:string; photoPath:string|null; obtainedAt:string; confirmedAt:null; status:'unverified'; source:'user'; location?:z.infer<typeof placeSchema>; locationSource?:'gps'|'map'|'fact'; analysis?:'ai'|'failed'|'edited'|'comment'; editedAt?:string;
  /** 'barrier' = something on the way; 'blocked' = it stopped me from getting where I wanted. */
  type?:'barrier'|'blocked'; comment?:string; destination?:string;
  /** Workflow for the city office dashboard. */
  cityStatus?:CityStatus; cityNote?:string; cityUpdatedAt?:string;
  /** All photos, first one included (its path equals photoPath). analysis = AI description of that photo, if any. */
  photos?:ReportPhoto[];
  /** Audit trail of city status/note changes, oldest first. */
  cityHistory?:CityHistoryEntry[] };
export const cityStatuses=['new','in_review','forwarded','resolved','rejected'] as const;
export type CityStatus=typeof cityStatuses[number];
/** AI check for people, faces or licence plates on a report photo. */
export const photoPeople=['none','present','unclear'] as const;
export type PhotoPeople=typeof photoPeople[number];
export const photoVisibilities=['public','hidden'] as const;
export type PhotoVisibility=typeof photoVisibilities[number];
/**
 * Stored: path is always set; visibility decides public serving (missing = hidden, privacy by default).
 * Public view (publicReport): hidden photos are { id, createdAt, hidden: true, reason: 'privacy' } without path or analysis.
 */
export type ReportPhoto={id:string;path?:string;createdAt:string;analysis?:Observation;
  /** AI result; absent when AI failed or for photos from before the check. */
  people?:PhotoPeople;
  visibility?:PhotoVisibility;
  /** Set when the city office decided visibility. */
  reviewedAt?:string;
  hidden?:true; reason?:'privacy'};
/** photo: set when the entry records a photo decision instead of a status/note change. */
export type CityHistoryEntry={at:string;status:CityStatus;note:string;photo?:{id:string;visibility:PhotoVisibility}};
export const emptyObservation:Observation = {kind:'stairs',description:'',direction:'unknown',handrail:'unknown',surface:'unknown',uncertainty:'Brak pomiarów i weryfikacji terenowej.'};
