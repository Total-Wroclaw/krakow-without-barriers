import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { reportInputSchema, type Report } from './schemas';
// Read only the authorised variable into server memory. Never write or log credentials.
export function apiKey(){
 if(process.env.OPENAI_API_KEY)return process.env.OPENAI_API_KEY;
 try{return parse(readFileSync(/* turbopackIgnore: true */ process.env.OPENAI_ENV_FILE??path.resolve(process.cwd(),'../.env'))).OPENAI_API_KEY;}catch{return undefined;}
}
export const runtimeDir=process.env.KROK_STORAGE_DIR??path.join(process.cwd(),'.runtime');
let database:DatabaseSync|undefined;
export function db(){
 if(!database){mkdirSync(runtimeDir,{recursive:true,mode:0o700});database=new DatabaseSync(path.join(runtimeDir,'reports.sqlite'));database.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, body TEXT NOT NULL, photo BLOB); CREATE TABLE IF NOT EXISTS report_photos (id TEXT PRIMARY KEY, report_id TEXT NOT NULL, photo BLOB NOT NULL, created_at TEXT NOT NULL, analysis TEXT); CREATE INDEX IF NOT EXISTS report_photos_report ON report_photos(report_id);');}
 return database;
}
export function listReports():Report[]{return (db().prepare('SELECT body FROM reports ORDER BY rowid DESC LIMIT 100').all() as {body:string}[]).map(r=>JSON.parse(r.body));}
export async function photoBytes(data:string){
 if(!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data))throw new Error('Nieobsługiwane zdjęcie. Wybierz JPEG, PNG lub WebP.');
 const bytes=Buffer.from(data.split(',')[1],'base64');if(bytes.length>3_000_000)throw new Error('Zdjęcie jest zbyt duże. Maksimum to 3 MB.');
 // Decoding validates the image and strips EXIF, including GPS. No original photo is stored.
 return sharp(bytes,{limitInputPixels:25_000_000}).rotate().resize({width:1400,height:1400,fit:'inside',withoutEnlargement:true}).jpeg({quality:82}).toBuffer();
}
/** Reports attach to an OSM way/node id or to a map point whose id matches its coordinates. */
export function validLocation(locationId:string,location?:{lat:number;lon:number}){
 if(/^(way|node):\d{1,15}$/.test(locationId))return true;
 return !!location&&locationId===`point:${location.lat}:${location.lon}`;
}
export async function saveReport(input:unknown):Promise<Report>{
 const parsed=reportInputSchema.parse(input);
 if(!validLocation(parsed.locationId,parsed.location))throw new Error('Wybierz punkt na mapie Krakowa.');
 const photo=parsed.photo?await photoBytes(parsed.photo):null;
 const id=randomUUID();const report:Report={id,observation:parsed.observation,locationId:parsed.locationId,photoPath:photo?`/api/reports/${id}/photo`:null,obtainedAt:new Date().toISOString(),confirmedAt:null,status:'unverified',source:'user',cityStatus:'new',...(parsed.location?{location:parsed.location}:{})};
 db().prepare('INSERT INTO reports (id,body,photo) VALUES (?,?,?)').run(id,JSON.stringify(report),photo);
 return report;
}
const limits=new Map<string,{count:number;until:number}>();
export function guard(request:Request,ai=false){
 const origin=request.headers.get('origin');
 if(origin){
  let originHost='';try{originHost=new URL(origin).host;}catch{}
  // Next may expose the internal listen address in request.url; Host identifies the browser-facing origin.
  if(originHost!==(request.headers.get('host')??new URL(request.url).host))return Response.json({error:'Żądanie pochodzi z innej strony.'},{status:403});
 }
 if(Number(request.headers.get('content-length')??0)>5_000_000)return Response.json({error:'Plik jest zbyt duży.'},{status:413});
 if(ai){const key=request.headers.get('x-forwarded-for')??'local';const now=Date.now();const value=limits.get(key);if(value&&value.until>now){if(value.count>=20)return Response.json({error:'Zbyt wiele zapytań. Spróbuj za minutę.'},{status:429});value.count++;}else{if(limits.size>1000)limits.clear();limits.set(key,{count:1,until:now+60_000});}}
 return null;
}
export async function boundedJson(request:Request){
 const text=await request.text();if(Buffer.byteLength(text)>5_000_000)throw new Error('Zbyt duże żądanie.');return JSON.parse(text);
}
