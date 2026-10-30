import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
let source=readFileSync(new URL('../lib/account/server.ts',import.meta.url),'utf8');
source=source.replace("import 'server-only';",'')
 .replace("import {auth,clerkClient} from '@clerk/nextjs/server';",'const auth=async()=>globalThis.__accountTest.auth; const clerkClient=async()=>globalThis.__accountTest.client;')
 .replace("import {getMembership} from '@/lib/membership/server';",'const getMembership=async()=>globalThis.__accountTest.member;')
 .replace("import {isOwnerAccount} from '@/lib/membership/entitlements';",'const isOwnerAccount=id=>id==="owner";')
 .replace("import {liveTransportConfig} from '@/services/tech-phase-billing/live-transport.mjs';",'const liveTransportConfig=()=>{throw Error("not-configured");};')
 .replace("import {bounded} from '@/services/tech-phase-billing/transport.mjs';",`import {bounded} from '${new URL('../services/tech-phase-billing/transport.mjs',import.meta.url)}';`)
 .replace("import {unknownContract} from '@/services/tech-phase-billing/account-view.mjs';",`import {unknownContract} from '${new URL('../services/tech-phase-billing/account-view.mjs',import.meta.url)}';`)
 .replace("import {selectedIcon} from './profile';",'const selectedIcon=(value,owner)=>owner?"owner":value??"initial";');
const api=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
test('owner routes require approved identity AND server MFA/admin permission',async()=>{
 for(const member of [{status:'signed-out'},{status:'signed-in',userId:'owner',isAdmin:false},{status:'signed-in',userId:'other-admin',isAdmin:true},{status:'signed-in',userId:'buyer',plan:'pro'}]){
  globalThis.__accountTest={member};await assert.rejects(api.ownerIdentity,/owner-required/);
 }
 globalThis.__accountTest={member:{status:'signed-in',userId:'owner',isAdmin:true}};assert.equal(await api.ownerIdentity(),'owner');
});
test('identity comes only from server session, signed out denied',async()=>{
 globalThis.__accountTest={auth:{userId:null}};await assert.rejects(api.accountIdentity,/sign-in/);
 globalThis.__accountTest={auth:{userId:'buyer'}};assert.equal(await api.accountIdentity(),'buyer');
});
test('profile mutations reject cross-origin, missing origin, invalid JSON and oversize body',async()=>{
 const request=(origin,body='{}',type='application/json')=>new Request('https://site.test/api/research/account/profile',{method:'PATCH',headers:{...(origin?{origin}:{}),'content-type':type},body});
 for(const origin of [null,'https://evil.test','null'])await assert.rejects(api.input(request(origin)));
 await assert.rejects(api.input(request('https://site.test','{}','text/plain')));
 await assert.rejects(api.input(request('https://site.test','invalid')));
 await assert.rejects(api.input(request('https://site.test','x'.repeat(3000))));
 assert.deepEqual(await api.input(request('https://site.test','{"icon":"fire"}')),{icon:'fire'});
});
test('provider error content is suppressed and account responses cannot be cached publicly',()=>{
 const response=api.accountError(Error('password=secret-token'));
 assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'private, no-store');
 return response.text().then(body=>assert.doesNotMatch(body,/secret-token|password/));
});
