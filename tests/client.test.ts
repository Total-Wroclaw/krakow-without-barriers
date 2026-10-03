import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postJson } from '../src/lib/client';
test('AI/network timeout gives a recoverable error',async()=>{const original=globalThis.fetch;globalThis.fetch=async(_url,init)=>new Promise((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')));});try{await assert.rejects(()=>postJson('/api/ai',{},5),/Przekroczono czas/);}finally{globalThis.fetch=original;}});
test('provider outage keeps a safe message without accepting a draft',async()=>{const original=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({error:'AI jest niedostępne. Uzupełnij ręcznie.'}),{status:503});try{await assert.rejects(()=>postJson('/api/ai',{}),/Uzupełnij ręcznie/);}finally{globalThis.fetch=original;}});
