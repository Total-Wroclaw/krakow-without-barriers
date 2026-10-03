import { z } from 'zod';
// A service envelope covering Kraków; it is not an administrative-boundary claim.
export const pointSchema=z.object({lat:z.number().min(49.94).max(50.2),lon:z.number().min(19.75).max(20.25)});
export const placeSchema=pointSchema.extend({id:z.string().max(120),name:z.string().min(1).max(300),source:z.string().max(150)});
export type Point=z.infer<typeof pointSchema>;
export type CityPlace=z.infer<typeof placeSchema>;
/** Barrier detail for kind 'kerb' (a point) or 'surface' (a stretch of way); only produced for wheelchair/pushchair mobility. */
export type BarrierKind='kerbRaised'|'kerbUnknown'|'kerbRolled'|'step'|'nodeNoWheelchair'|'sett'|'rough'|'steep'|'narrow'|'noWheelchair'|'impassable';
export type CityFact={id:string;kind:'stairs'|'bench'|'entrance'|'kerb'|'surface'|'toilet';title:string;lat:number;lon:number;tags:Record<string,string>;direction:'up'|'down'|'unknown';editedAt:string|null;obtainedAt:string;confirmedAt:null;status:'osm';sourceUrl:string;barrier?:BarrierKind;/** Metres along the route, for 'surface' stretches. */length?:number;/** Bench chosen as a planned rest stop after this many minutes of walking. */restAfterMinutes?:number;/** Explore object id for 'toilet' facts. */objectId?:string};
export type Stop={id:string;name:string;code:string;lat:number;lon:number;wheelchair:string};
export const initialFrom:CityPlace={id:'landmark:dworzec',name:'Dworzec Główny · plac Jana Nowaka-Jeziorańskiego',lat:50.06583,lon:19.94756,source:'Punkt orientacyjny · współrzędne startowe do wyboru'};
export const initialTo:CityPlace={id:'landmark:plac-centralny',name:'Plac Centralny · Nowa Huta',lat:50.07207,lon:20.03764,source:'Punkt orientacyjny · współrzędne startowe do wyboru'};
