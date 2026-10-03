/** Opt-in live API smoke check. No inputs, outputs, or credentials are logged. */
import assert from 'node:assert/strict';
import sharp from 'sharp';
import OpenAI from 'openai';
import { apiKey } from '../src/lib/server';
import { draftPreferences, draftPhoto } from '../src/lib/ai';
import { defaultPreferences, preferencesSchema, observationSchema } from '../src/lib/schemas';
try {
 const key=apiKey();assert.ok(key,'Server credential missing');
 const model=process.env.OPENAI_MODEL??'gpt-5.6-luna';
 const client=new OpenAI({apiKey:key,timeout:20000,maxRetries:0});
 const models=await client.models.list();assert.ok(models.data.some(m=>m.id===model),'Configured model not available');
 console.log('Configured documented model is available.');
 const base={...defaultPreferences,avoidStairs:false,avoidDown:false,avoidUp:false};
 const preferences=await draftPreferences('Dzisiaj omijam schody w dół, w górę mogę iść. Maksymalnie 600 metrów i chcę ławki po drodze.',base);
 preferencesSchema.parse(preferences.preferences);assert.equal(preferences.preferences.avoidDown,true);assert.equal(preferences.preferences.avoidUp,false);assert.equal(preferences.preferences.maxDistance,600);
 console.log('Natural-language preferences: validated, directional needs preserved.');
 const svg='<svg width="600" height="400" xmlns="http://www.w3.org/2000/svg"><rect width="600" height="400" fill="#ddd"/><path d="M0 390H90V330H180V270H270V210H360V150H450V90H540V30H600" fill="none" stroke="#444" stroke-width="16"/><path d="M50 270L560 0" stroke="#333" stroke-width="8"/><text x="15" y="30" font-size="18">Synthetic test illustration</text></svg>';
 const photo=await sharp(Buffer.from(svg)).jpeg().toBuffer();
 const observation=await draftPhoto(`data:image/jpeg;base64,${photo.toString('base64')}`);
 observationSchema.parse(observation);assert.equal(observation.direction,'unknown');assert.ok(observation.uncertainty.length>0);
 console.log('Single-photo draft: validated on synthetic fixture; direction remains unknown. No report saved.');
} catch(e){
 const error=e as {status?:number;name?:string};
 console.error(JSON.stringify({check:'live-ai',passed:false,status:error.status??null,type:error.name??'Error'}));process.exitCode=1;
}
