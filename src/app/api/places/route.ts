import { z } from 'zod';
import { guard } from '@/lib/server';
import { pointSchema } from '@/lib/city-types';
import { reverseGeocode, searchPlaces } from '@/lib/places';
export const runtime='nodejs';
const coordinates={lat:z.coerce.number().pipe(pointSchema.shape.lat),lon:z.coerce.number().pipe(pointSchema.shape.lon)};
const schema=z.union([
 z.object({reverse:z.literal('1'),...coordinates}),
 z.object({q:z.string().trim().min(2).max(120),lat:coordinates.lat.optional(),lon:coordinates.lon.optional()}).refine(v=>(v.lat===undefined)===(v.lon===undefined)),
]);
const headers={'Cache-Control':'private, max-age=60'};
export async function GET(request:Request){
 const block=guard(request);if(block)return block;
 const parsed=schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
 if(!parsed.success)return Response.json({error:'Wpisz co najmniej 2 znaki albo podaj punkt w Krakowie.'},{status:400});
 try{
  const input=parsed.data;
  if('reverse' in input)return Response.json({place:reverseGeocode(input)},{headers});
  const near=input.lat!==undefined&&input.lon!==undefined?{lat:input.lat,lon:input.lon}:undefined;
  return Response.json({places:searchPlaces(input.q,near)},{headers});
 }catch{return Response.json({error:'Wyszukiwarka miejsc jest chwilowo niedostępna.'},{status:503});}
}
