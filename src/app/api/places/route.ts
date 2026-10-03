import { z } from 'zod';
import { guard } from '@/lib/server';
import { pointSchema } from '@/lib/city-types';
import { reverseGeocode, searchPlaces } from '@/lib/places';
import { apiMessages } from '@/lib/i18n/request-locale';
export const runtime='nodejs';
const locale=z.string().max(5).optional();
const coordinates={lat:z.coerce.number().pipe(pointSchema.shape.lat),lon:z.coerce.number().pipe(pointSchema.shape.lon)};
const schema=z.union([
 z.object({reverse:z.literal('1'),...coordinates,locale}),
 z.object({q:z.string().trim().min(2).max(120),lat:coordinates.lat.optional(),lon:coordinates.lon.optional(),locale}).refine(v=>(v.lat===undefined)===(v.lon===undefined)),
]);
const headers={'Cache-Control':'private, max-age=60'};
export async function GET(request:Request){
 const block=guard(request);if(block)return block;
 const parsed=schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
 if(!parsed.success)return Response.json({error:apiMessages(request).places.badQuery},{status:400});
 try{
  const input=parsed.data;
  if('reverse' in input)return Response.json({place:reverseGeocode(input)},{headers});
  const near=input.lat!==undefined&&input.lon!==undefined?{lat:input.lat,lon:input.lon}:undefined;
  return Response.json({places:searchPlaces(input.q,near)},{headers});
 }catch{return Response.json({error:apiMessages(request).places.unavailable},{status:503});}
}
