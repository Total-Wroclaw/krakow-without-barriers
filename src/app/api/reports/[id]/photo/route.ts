import { db } from '@/lib/server';
export const runtime='nodejs';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;const row=db().prepare('SELECT photo FROM reports WHERE id=?').get(id) as {photo:Uint8Array|null}|undefined;if(!row?.photo)return new Response(null,{status:404});return new Response(new Uint8Array(row.photo),{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
