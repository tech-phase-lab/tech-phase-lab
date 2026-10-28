import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {adminMfaAllowed} from '../lib/membership/admin-mfa.ts';
import {billingAbuse,deliverBillingAlerts} from '../services/tech-phase-billing/abuse.mjs';
import {liveHandler} from '../services/tech-phase-billing/live-http.mjs';
test('admin access requires enrollment plus a verified second-factor claim',()=>{
 for(const claims of [undefined,{}, {fva:[0,-1]},{fva:[0,'0']},{fva:[0,NaN]},{fva:[0,Infinity]},{fva:[0]}])assert.equal(adminMfaAllowed(true,claims),false);
 assert.equal(adminMfaAllowed(false,{fva:[0,0]}),false);
 assert.equal(adminMfaAllowed(true,{fva:[10,1]}),true);
});
test('shared billing limits survive new workers; alerts deduplicate and retry without payer PII',async()=>{
 const db=new PGlite();let now=Date.parse('2026-10-27T00:00:00Z');
 try{
  await db.exec('CREATE SCHEMA tech_phase_billing_live; CREATE ROLE tech_phase_billing_live_writer');await db.exec(readFileSync(new URL('../db/tech-phase/007_billing_security.sql',import.meta.url),'utf8'));
  await db.exec('SET ROLE tech_phase_billing_live_writer');
  const a=billingAbuse(db,{now:()=>now}),b=billingAbuse(db,{now:()=>now});
  const attempts=await Promise.allSettled(Array.from({length:12},(_,i)=>(i%2?a:b).attempt('user_memberA')));
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,5);assert.equal(attempts.filter(x=>x.status==='rejected'&&x.reason.message==='RATE_LIMITED').length,7);
  for(let n=0;n<6;n++)await a.failure('user_memberA');
  const events=(await db.query('SELECT * FROM tech_phase_billing_live.security_alerts')).rows;
  assert.equal(events.length,2);assert.ok(!JSON.stringify(events).includes('user_memberA'));
  assert.deepEqual(await deliverBillingAlerts(db,async()=>{throw Error('password=SECRET token=SECRET')},{now:()=>now}),{sent:0,failed:2});
  assert.deepEqual(await deliverBillingAlerts(db,async()=>{throw Error('should not run')},{now:()=>now}),{sent:0,failed:0});
  now+=301000;const sent=[];assert.deepEqual(await deliverBillingAlerts(db,async event=>sent.push(event),{now:()=>now}),{sent:2,failed:0});
  assert.equal(JSON.stringify(sent).includes('SECRET'),false);assert.equal(sent[0].actorRef.length,64);
  assert.deepEqual(await deliverBillingAlerts(db,async()=>{throw Error()},{now:()=>now}),{sent:0,failed:0});
  now+=600000;await b.attempt('user_memberA');await a.attempt('user_memberB');
 }finally{await db.close();}
});
test('checkout rate limits block PayPal calls but do not block verified webhook processing',async()=>{
 let paypal=0,webhooks=0;
 const env={VERCEL_ENV:'production',TECH_PHASE_PAYPAL_ENV:'live',TECH_PHASE_BILLING_LIVE_ENABLED:'true',TECH_PHASE_BILLING_LIVE_WEBHOOK_ENABLED:'true',TECH_PHASE_BILLING_LIVE_ENTITLEMENTS_ENABLED:'true',TECH_PHASE_BILLING_LIVE_SALES_ENABLED:'true',TECH_PHASE_BILLING_LIVE_ORIGIN:'https://techphase.testdomain.com'};
 const handler=liveHandler({env,identity:async()=> 'user_test',services:async()=>({abuse:{attempt:async()=>{throw Object.assign(Error('RATE_LIMITED'),{retryAfter:23})}},checkout:{start:async()=>paypal++},webhook:async()=>{webhooks++;return{status:'verified'}}})});
 const request=()=>new Request(env.TECH_PHASE_BILLING_LIVE_ORIGIN,{method:'POST',headers:{Origin:env.TECH_PHASE_BILLING_LIVE_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({currency:'JPY',acceptedTerms:'pro-live-v1'})});
 const result=await handler(request(),'create');assert.equal(result.status,429);assert.equal(result.headers.get('Retry-After'),'23');assert.equal(paypal,0);
 assert.equal((await handler(request(),'webhook')).status,200);assert.equal(webhooks,1);
});
test('billing errors count failed checkout without exposing exception contents',async()=>{
 let failures=0;
 const env={VERCEL_ENV:'production',TECH_PHASE_PAYPAL_ENV:'live',TECH_PHASE_BILLING_LIVE_ENABLED:'true',TECH_PHASE_BILLING_LIVE_ENTITLEMENTS_ENABLED:'true',TECH_PHASE_BILLING_LIVE_SALES_ENABLED:'true',TECH_PHASE_BILLING_LIVE_ORIGIN:'https://techphase.testdomain.com'};
 const handler=liveHandler({env,identity:async()=> 'user_test',services:async()=>({abuse:{attempt:async()=>{},failure:async()=>failures++},checkout:{start:async()=>{throw Error('password=SECRET bearer=TOKEN payer=EMAIL')}}})});
 const result=await handler(new Request(env.TECH_PHASE_BILLING_LIVE_ORIGIN,{method:'POST',headers:{Origin:env.TECH_PHASE_BILLING_LIVE_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({currency:'JPY',acceptedTerms:'pro-live-v1'})}),'create');
 assert.equal(result.status,503);assert.equal(failures,1);assert.equal(await result.text(),'{"error":"billing-unavailable"}');
});

test('membership integration withholds admin, owner preview and sandbox controls until MFA verifies',async()=>{
 const {transform}=await import('esbuild');
 let source=readFileSync(new URL('../lib/membership/server.ts',import.meta.url),'utf8')
  .replace('import "server-only";','')
  .replace('import {liveMembership} from "@/services/tech-phase-billing/live-membership.mjs";','const liveMembership=async()=>null;')
  .replace('import { cache } from "react";','const cache=fn=>fn;')
  .replace('import { auth, clerkClient } from "@clerk/nextjs/server";','const auth=async()=>globalThis.__mfaAuth;const clerkClient=async()=>({users:{getUser:async()=>globalThis.__mfaUser}});');
 for(const name of ['entitlements','admin-mfa'])source=source.replace(`"./${name}"`,JSON.stringify(new URL(`../lib/membership/${name}.ts`,import.meta.url).href));
 const {code}=await transform(source,{loader:'ts',format:'esm'});
 const {getMembership,getMembershipForUser}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const keys=['CLERK_SECRET_KEY','NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','TECH_PHASE_REQUIRE_ADMIN_MFA','VERCEL_ENV'],before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try {
  Object.assign(process.env,{CLERK_SECRET_KEY:'fixture',NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:'fixture',TECH_PHASE_REQUIRE_ADMIN_MFA:'true',VERCEL_ENV:'preview'});
  globalThis.__mfaAuth={userId:'user_admin',sessionClaims:{fva:[0,-1]}};globalThis.__mfaUser={twoFactorEnabled:true,privateMetadata:{role:'admin'}};
  let member=await getMembership();assert.equal(member.isAdmin,false);assert.equal(member.ownerMode,false);assert.equal(member.canTest,false);assert.equal(member.adminMfaRequired,true);
  globalThis.__mfaAuth.sessionClaims={fva:[0,0]};member=await getMembership();assert.equal(member.isAdmin,true);assert.equal(member.ownerMode,true);
  globalThis.__mfaUser.twoFactorEnabled=false;assert.equal((await getMembership()).isAdmin,false);
  assert.equal((await getMembershipForUser('user_admin')).isAdmin,false);
 }finally {for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}delete globalThis.__mfaAuth;delete globalThis.__mfaUser;}
});

test('PRO sandbox MFA gate blocks unverified admins while retaining authorized member tester identities',async()=>{
 const {transform}=await import('esbuild');
 const source=readFileSync(new URL('../lib/membership/billing-sandbox.ts',import.meta.url),'utf8')
  .replace('import "server-only";','')
  .replace('import { getMembership } from "./server";','const getMembership=async()=>globalThis.__sandboxMfaMember;')
  .replace('import { auth } from "@clerk/nextjs/server";','const auth=async()=>({userId:"user_legacy"});')
  .replace('import { OWNER_ACCOUNT_ID } from "./entitlements";','const OWNER_ACCOUNT_ID="user_owner";')
  .replace('import { billingGateway } from "@/services/tech-phase-billing/transport.mjs";','const billingGateway=options=>options.identity;');
 const {code}=await transform(source,{loader:'ts',format:'esm'});
 const {handleSandboxBilling}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
 const before=process.env.TECH_PHASE_REQUIRE_ADMIN_MFA;
 try {
  process.env.TECH_PHASE_REQUIRE_ADMIN_MFA='true';
  globalThis.__sandboxMfaMember={status:'signed-in',userId:'user_owner',isAdmin:false,adminMfaRequired:true};assert.equal(await handleSandboxBilling(),null);
  globalThis.__sandboxMfaMember={status:'signed-in',userId:'user_owner',isAdmin:true,adminMfaRequired:false};assert.equal(await handleSandboxBilling(),'user_owner');
  globalThis.__sandboxMfaMember={status:'signed-in',userId:'user_tester',isAdmin:false,adminMfaRequired:false};assert.equal(await handleSandboxBilling(),'user_tester');
  globalThis.__sandboxMfaMember={status:'signed-out'};assert.equal(await handleSandboxBilling(),null);
  delete process.env.TECH_PHASE_REQUIRE_ADMIN_MFA;assert.equal(await handleSandboxBilling(),'user_legacy');
 }finally {if(before===undefined)delete process.env.TECH_PHASE_REQUIRE_ADMIN_MFA;else process.env.TECH_PHASE_REQUIRE_ADMIN_MFA=before;delete globalThis.__sandboxMfaMember;}
});
