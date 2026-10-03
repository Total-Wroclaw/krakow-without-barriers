import { z } from 'zod';
import { placeSchema } from './city-types';
export const preferencesSchema = z.object({
  avoidStairs: z.boolean(), avoidDown: z.boolean(), avoidUp: z.boolean(),
  preferHandrails: z.boolean(), preferRest: z.boolean(), maxDistance: z.number().int().min(100).max(3000),
  // How the person moves today. Not a diagnosis: a wheelchair or a child's pushchair changes which barriers matter.
  mobility: z.enum(['walk','wheelchair','stroller']),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const defaultPreferences: Preferences = { avoidStairs:true, avoidDown:true, avoidUp:false, preferHandrails:true, preferRest:true, maxDistance:1200, mobility:'walk' };
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
export type Report = { id:string; observation:Observation; locationId:string; photoPath:string|null; obtainedAt:string; confirmedAt:null; status:'unverified'; source:'user'; location?:z.infer<typeof placeSchema>; locationSource?:'gps'|'map'|'fact'; analysis?:'ai'|'failed'|'edited'; editedAt?:string };
export const emptyObservation:Observation = {kind:'stairs',description:'',direction:'unknown',handrail:'unknown',surface:'unknown',uncertainty:'Brak pomiarów i weryfikacji terenowej.'};
