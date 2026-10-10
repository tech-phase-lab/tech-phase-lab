import test from 'node:test';
import assert from 'node:assert/strict';
import {PreferencesError,requestPreferences} from '../lib/resolute/preferences-client.ts';

const saved={locale:'en',timezone:'America/New_York',configured:true};
test('settings client reads and writes only the same-origin preferences API',async()=>{
 const calls=[];const fetcher=async(url,options)=>{calls.push([url,options]);return Response.json(saved);};
 assert.deepEqual(await requestPreferences(undefined,undefined,fetcher),saved);
 assert.deepEqual(await requestPreferences({locale:'en',timezone:'America/New_York'},undefined,fetcher),saved);
 assert.equal(calls.length,2);
 for(const [url,o] of calls){assert.equal(url,'/api/resolute/preferences');assert.equal(o.cache,'no-store');
  assert.equal(o.credentials,'same-origin');assert.equal(o.redirect,'error');}
 assert.equal(calls[0][1].method,'GET');assert.equal(calls[1][1].method,'PUT');
 assert.deepEqual(JSON.parse(calls[1][1].body),{locale:'en',timezone:'America/New_York'});
});

test('client never claims a save succeeded on a missing, invalid or mismatched response',async()=>{
 for(const value of [{locale:null,timezone:null,configured:false},{...saved,timezone:'Asia/Tokyo'},
  {...saved,configured:false},{...saved,token:'unexpected'},{}]){
  await assert.rejects(requestPreferences({locale:'en',timezone:'America/New_York'},undefined,async()=>Response.json(value)),
   e=>e instanceof PreferencesError && e.kind==='unavailable');
 }
 assert.deepEqual(await requestPreferences(undefined,undefined,async()=>Response.json({locale:null,timezone:null,configured:false})),
  {locale:null,timezone:null,configured:false});
});

test('authentication and input failures are distinct; failed writes are never automatically retried',async()=>{
 for(const [status,kind] of [[401,'signed-out'],[400,'invalid'],[503,'unavailable']]){
  let calls=0;
  await assert.rejects(requestPreferences({locale:'ja',timezone:'Asia/Tokyo'},undefined,async()=>{
   calls++;return Response.json({error:'private'}, {status});}),e=>e.kind===kind);
  assert.equal(calls,1);
 }
 let calls=0;
 await assert.rejects(requestPreferences({locale:'fr',timezone:'UTC'},undefined,async()=>{calls++;}),e=>e.kind==='invalid');
 assert.equal(calls,0);
});

test('network failures, redirects, HTML and invalid JSON stay generic and never reveal secrets',async()=>{
 for(const fetcher of [async()=>{throw Error('secret-key');},
  async()=>new Response('<html>login</html>',{headers:{'Content-Type':'text/html'}}),
  async()=>new Response('{',{headers:{'Content-Type':'application/json'}})]){
  await assert.rejects(requestPreferences(undefined,undefined,fetcher),e=>e.kind==='unavailable'&&!e.message.includes('secret'));
 }
});
