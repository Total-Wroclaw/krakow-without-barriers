import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { reportInputSchema, type Report } from './schemas';
import { clientIp } from './client-ip';
import { apiMessages } from './i18n/request-locale';
// Read only the authorised variable into server memory. Never write or log credentials.
export function apiKey(){
 if(process.env.OPENAI_API_KEY)return process.env.OPENAI_API_KEY;
 try{return parse(readFileSync(/* turbopackIgnore: true */ process.env.OPENAI_ENV_FILE??path.resolve(process.cwd(),'../.env'))).OPENAI_API_KEY;}catch{return undefined;}
}
export const runtimeDir=process.env.KROK_STORAGE_DIR??path.join(process.cwd(),'.runtime');
let database:DatabaseSync|undefined;
export function db(){
 if(!database){mkdirSync(runtimeDir,{recursive:true,mode:0o700});database=new DatabaseSync(path.join(runtimeDir,'reports.sqlite'));database.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, body TEXT NOT NULL, photo BLOB); CREATE TABLE IF NOT EXISTS report_photos (id TEXT PRIMARY KEY, report_id TEXT NOT NULL, photo BLOB NOT NULL, created_at TEXT NOT NULL, analysis TEXT); CREATE INDEX IF NOT EXISTS report_photos_report ON report_photos(report_id);');
  // Author edit token hash (SHA-256 hex); a separate column so it never ends up in the JSON body sent to clients.
  const columns=database.prepare('PRAGMA table_info(reports)').all() as {name:string}[];
  if(!columns.some(c=>c.name==='edit_hash'))database.exec('ALTER TABLE reports ADD COLUMN edit_hash TEXT');}
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
/** editTokenHash: SHA-256 of the author's edit token (see reports-server.ts), stored outside the public body. */
export async function saveReport(input:unknown,editTokenHash:string|null=null):Promise<Report>{
 const parsed=reportInputSchema.parse(input);
 if(!validLocation(parsed.locationId,parsed.location))throw new Error('Wybierz punkt na mapie Krakowa.');
 const photo=parsed.photo?await photoBytes(parsed.photo):null;
 const id=randomUUID();const report:Report={id,observation:parsed.observation,locationId:parsed.locationId,photoPath:photo?`/api/reports/${id}/photo`:null,obtainedAt:new Date().toISOString(),confirmedAt:null,status:'unverified',source:'user',cityStatus:'new',...(parsed.location?{location:parsed.location}:{})};
 db().prepare('INSERT INTO reports (id,body,photo,edit_hash) VALUES (?,?,?,?)').run(id,JSON.stringify(report),photo,editTokenHash);
 return report;
}
const limits=new Map<string,{count:number;until:number}>();
const SAFE_METHODS=new Set(['GET','HEAD','OPTIONS']);
function hostOf(value:string|null){if(!value)return null;try{return new URL(value).host;}catch{return null;}}
/**
 * Same-origin and size checks for API routes, plus the AI rate limit (20/min per client, see client-ip.ts).
 * - An Origin header must match Host (Next may expose the internal listen address in request.url; Host is the browser-facing origin).
 * - State-changing requests (not GET/HEAD/OPTIONS) without Origin are refused when Sec-Fetch-Site says cross-site/same-site.
 * - In production, state-changing requests must prove same origin: Origin or Referer matching Host, or Sec-Fetch-Site: same-origin.
 *   Browsers always send Origin on POST/PATCH/DELETE; scripts and tools must send `Origin: https://<host>`.
 *   Outside production (dev, tests) requests without these headers are accepted.
 */
export function guard(request:Request,ai=false){
 const m=apiMessages(request);
 const host=request.headers.get('host')??new URL(request.url).host;
 const origin=request.headers.get('origin');
 const forbidden=()=>Response.json({error:m.crossOrigin},{status:403});
 if(origin&&hostOf(origin)!==host)return forbidden();
 if(!origin&&!SAFE_METHODS.has(request.method)){
  const site=request.headers.get('sec-fetch-site');
  if(site==='cross-site'||site==='same-site')return forbidden();
  if(process.env.NODE_ENV==='production'&&site!=='same-origin'&&hostOf(request.headers.get('referer'))!==host)return forbidden();
 }
 if(Number(request.headers.get('content-length')??0)>5_000_000)return Response.json({error:m.tooLarge},{status:413});
 if(ai){const key=clientIp(request);const now=Date.now();const value=limits.get(key);if(value&&value.until>now){if(value.count>=20)return Response.json({error:m.rateLimited},{status:429});value.count++;}else{if(limits.size>1000)limits.clear();limits.set(key,{count:1,until:now+60_000});}}
 return null;
}
export async function boundedJson(request:Request){
 const text=await request.text();if(Buffer.byteLength(text)>5_000_000)throw new Error('Zbyt duże żądanie.');return JSON.parse(text);
}
