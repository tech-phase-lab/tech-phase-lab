import test from 'node:test';
import assert from 'node:assert/strict';
import {createPreferencesHandlers,parsePreferences,readPreferences} from '../lib/resolute/preferences.ts';

const origin='https://preview.example.test';
const request=(value,extra={})=>new Request(origin+'/api/resolute/preferences',{
 method:'PUT',headers:{origin,'Content-Type':'application/json',...extra},body:JSON.stringify(value)});
const valid={locale:'en',timezone:'America/New_York'};

test('preferences require supported language and an IANA zone; missing settings stay unconfigured',()=>{
 assert.deepEqual(readPreferences({plan:'pro'}),{locale:null,timezone:null,configured:false});
 assert.deepEqual(parsePreferences({locale:'ja',timezone:'Asia/Tokyo'}),{locale:'ja',timezone:'Asia/Tokyo'});
 assert.deepEqual(parsePreferences({locale:'en',timezone:'UTC'}),{locale:'en',timezone:'UTC'});
 for(const value of [null,[],{}, {...valid,locale:'fr'},{...valid,timezone:'+09:00'},
  {...valid,timezone:'Invalid/Timezone'},{...valid,timezone:' Asia/Tokyo'},
  {...valid,userId:'user_other'},{...valid,plan:'pro'},{...valid,alerts:true}])assert.equal(parsePreferences(value),null);
});

test('settings read and save use the authenticated account and expose only preference fields',async()=>{
 const calls=[];
 const stored={...valid,other:'preserved',plan:'pro',email:'private@example.test'};
 const handlers=createPreferencesHandlers({authenticatedUser:async()=> 'user_self',
  read:async id=>{calls.push(['read',id]);return stored;},
  save:async(id,p)=>{calls.push(['save',id,p]);return {...stored,...p};}});
 let r=await handlers.GET();assert.deepEqual(await r.json(),{...valid,configured:true});
 r=await handlers.PUT(request({locale:'ja',timezone:'Asia/Tokyo'}));assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{locale:'ja',timezone:'Asia/Tokyo',configured:true});
 assert.deepEqual(calls,[['read','user_self'],['save','user_self',{locale:'ja',timezone:'Asia/Tokyo'}]]);
 assert.equal(r.headers.get('cache-control'),'private, no-store');
});

test('unauthenticated, cross-origin and arbitrary-metadata writes never reach storage',async()=>{
 let calls=0;let userId=null;
 const handlers=createPreferencesHandlers({authenticatedUser:async()=>userId,
  read:async()=>{calls++;return {};},save:async()=>{calls++;return valid;}});
 assert.equal((await handlers.GET()).status,401);
 assert.equal((await handlers.PUT(request(valid))).status,401);
 userId='user_self';
 assert.equal((await handlers.PUT(request(valid,{origin:'https://evil.example'}))).status,403);
 assert.equal((await handlers.PUT(request(valid,{origin:''}))).status,403);
 assert.equal((await handlers.PUT(request(valid,{'Content-Type':'text/plain'}))).status,415);
 assert.equal((await handlers.PUT(request({...valid,userId:'user_other'}))).status,400);
 assert.equal((await handlers.PUT(request({...valid,privateMetadata:{plan:'pro'}}))).status,400);
 assert.equal(calls,0);
});

test('oversize streaming bodies and malformed JSON are rejected without a metadata update',async()=>{
 let writes=0;
 const handlers=createPreferencesHandlers({authenticatedUser:async()=> 'user_self',read:async()=>({}),
  save:async()=>{writes++;return valid;}});
 assert.equal((await handlers.PUT(request({...valid,timezone:'x'.repeat(2000)}))).status,413);
 const chunks=[new TextEncoder().encode('x'.repeat(700)),new TextEncoder().encode('x'.repeat(700))];
 const stream=new ReadableStream({pull(c){if(chunks.length)c.enqueue(chunks.shift());else c.close();}});
 const streaming=new Request(origin+'/api/resolute/preferences',{method:'PUT',
  headers:{origin,'Content-Type':'application/json'},body:stream,duplex:'half'});
 assert.equal((await handlers.PUT(streaming)).status,413);
 const malformed=new Request(origin+'/api/resolute/preferences',{method:'PUT',
  headers:{origin,'Content-Type':'application/json'},body:'{'});
 assert.equal((await handlers.PUT(malformed)).status,400);assert.equal(writes,0);
});

test('provider failures and unconfirmed saves return private 503 without credential details',async()=>{
 const handlers=createPreferencesHandlers({authenticatedUser:async()=> 'user_self',
  read:async()=>{throw Error('secret-provider-token');},save:async()=>({})});
 for(const r of [await handlers.GET(),await handlers.PUT(request(valid))]){
  assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'PREFERENCES_UNAVAILABLE'});
  assert.equal(r.headers.get('cache-control'),'private, no-store');
 }
});
