import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
let source=readFileSync(new URL('../app/api/research/account/deletion/route.ts',import.meta.url),'utf8')
 .replace("import {accountIdentity,reply,accountError,input} from '@/lib/account/server';",`const accountIdentity=async()=>{if(!globalThis.__deletion.user)throw Error('sign-in');return globalThis.__deletion.user;};
 const reply=(v,status=200)=>Response.json(v,{status});const accountError=()=>reply({error:'sign-in'},401);
 const input=async()=>{};`)
 .replace("import {readDeletionCheck} from '@/lib/account/deletion';",'const readDeletionCheck=async()=>{globalThis.__deletion.calls++;return globalThis.__deletion.check;};')
 .replace("import {isOwnerAccount} from '@/lib/membership/entitlements';",'const isOwnerAccount=id=>id==="owner";');
const route=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
test('deletion route blocks signed-out and owner without querying billing',async()=>{
 for(const user of [null,'owner']){
  globalThis.__deletion={user,calls:0};const result=await route.GET();
  assert.equal(result.status,user?200:401);assert.equal(globalThis.__deletion.calls,0);
  if(user)assert.equal((await result.json()).reason,'owner-account');
 }
});
test('all-contract evidence updates the reason but never enables unfinished deletion',async()=>{
 for(const [check,reason] of [[{verification:'verified',autoRenew:true},'auto-renew-active'],[{verification:'unavailable',autoRenew:null},'contract-unverified'],[{verification:'verified',autoRenew:false,proAccessLostAtDeletion:'2026-11-30T00:00:00.000Z'},'deletion-orchestration-unavailable']]){
  globalThis.__deletion={user:'user_Buyer',calls:0,check};
  const get=await(await route.GET()).json();assert.equal(get.reason,reason);assert.equal(get.canDelete,false);
  assert.equal(get.proAccessLostAtDeletion,check.proAccessLostAtDeletion??null);
  const result=await route.DELETE(new Request('https://site.test/api/research/account/deletion',{method:'DELETE'}));
  assert.equal(result.status,409);assert.equal((await result.json()).canDelete,false);
 }
});

let client=readFileSync(new URL('../lib/account/deletion.ts',import.meta.url),'utf8')
 .replace("import 'server-only';",'')
 .replace("import {liveTransportConfig} from '@/services/tech-phase-billing/live-transport.mjs';",'const liveTransportConfig=()=>({url:"https://fixture.up.railway.app",token:"fixture",origin:"https://site.test"});const fetch=(...args)=>globalThis.__deletion.fetch(...args);')
 .replace("import {bounded} from '@/services/tech-phase-billing/transport.mjs';",`import {bounded} from '${new URL('../services/tech-phase-billing/transport.mjs',import.meta.url)}';`)
 .replace("import {unknownDeletionCheck} from '@/services/tech-phase-billing/account-deletion-check.mjs';",`import {unknownDeletionCheck} from '${new URL('../services/tech-phase-billing/account-deletion-check.mjs',import.meta.url)}';`);
const api=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(client)).toString('base64'));
test('old backend, malformed evidence and timeouts remain unavailable; response fields are whitelisted',async()=>{
 for(const reply of [()=>new Response('old backend',{status:404}),()=>Response.json({verification:'verified',autoRenew:false,reason:'auto-renew-active'}),()=>{throw Error('secret');}]){
  globalThis.__deletion={fetch:async()=>reply()};assert.equal((await api.readDeletionCheck('user_Buyer')).verification,'unavailable');
 }
 globalThis.__deletion={fetch:async(url,options)=>{
  assert.equal(url,'https://fixture.up.railway.app/live/deletion-check');assert.equal(options.headers['X-Tech-Phase-User'],'user_Buyer');assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');
  return Response.json({verification:'verified',autoRenew:false,reason:'no-renewing-contract',proAccessLostAtDeletion:'bad-date',token:'secret'});
 }};
 assert.deepEqual(await api.readDeletionCheck('user_Buyer'),{verification:'verified',autoRenew:false,reason:'no-renewing-contract',proAccessLostAtDeletion:null});
});
