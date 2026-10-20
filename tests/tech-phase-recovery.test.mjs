import test from 'node:test';
import assert from 'node:assert/strict';
import {runOwnerRecovery} from '../services/tech-phase-billing/recovery.mjs';
const id='00000000-0000-4000-8000-000000000001';
const env={TECH_PHASE_BILLING_RECOVERY_ENABLED:'true',TECH_PHASE_PAYPAL_ENV:'sandbox',TECH_PHASE_BILLING_RECOVERY_BRANCH:'codex/research-preview',TECH_PHASE_BILLING_SERVICE_TOKEN:'s'.repeat(64),TECH_PHASE_BILLING_OWNER_ID:'user_owner'};
const status=(plan='free',state='active')=>({environment:'sandbox',plan,proExpiresAt:plan==='pro'?'2026-11-20T10:00:00.000Z':null,subscription:{id,state}});
test('watchdog is explicitly enabled only in Sandbox preview with configured service identity',async()=>{
 const never=()=>assert.fail('must not contact service');
 assert.deepEqual(await runOwnerRecovery({},never),{outcome:'disabled'});
 for(const patch of [{TECH_PHASE_PAYPAL_ENV:'live'},{TECH_PHASE_BILLING_RECOVERY_BRANCH:'main'},
  {TECH_PHASE_BILLING_SERVICE_TOKEN:''},{TECH_PHASE_BILLING_OWNER_ID:'untrusted'}])await assert.rejects(runOwnerRecovery({...env,...patch},never),/CONFIG/);
});
test('watchdog repairs missed payment once through existing reconciliation and logs no identifiers',async()=>{
 const calls=[];let plan='free';
 const fetcher=async(url,options)=>{
  calls.push(url);assert.equal(options.redirect,'error');assert.equal(options.headers['X-Tech-Phase-User'],'user_owner');
  assert.equal(new URL(url).hostname,'tech-phase-billing-sandbox-production.up.railway.app');
  if(url.endsWith('/status')){assert.equal(options.method,'GET');return Response.json(status(plan));}
  assert.ok(url.endsWith('/reconcile'));assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{id});
  plan='pro';return Response.json({environment:'sandbox',status:'verified'});
 };
 assert.deepEqual(await runOwnerRecovery(env,fetcher),{outcome:'verified',plan:'pro',state:'active',changed:true});
 assert.equal((await runOwnerRecovery(env,fetcher)).changed,false);
 assert.equal(calls.length,6);assert.ok(calls.every(x=>/\/(status|reconcile)$/.test(x)));
});
test('no contract or unfinished creation never triggers a purchase or reconciliation',async()=>{
 for(const subscription of [null,{id,state:'creating'}]){
  let calls=0;const result=await runOwnerRecovery(env,async()=>{calls++;return Response.json({...status(),subscription});});
  assert.equal(calls,1);assert.equal(result.outcome,'no-provider-contract');
 }
});
test('watchdog preserves cancelled paid access and reports review without granting it',async()=>{
 for(const outcome of ['verified','payment-pending','review-required']) {
  const result=await runOwnerRecovery(env,async url=>Response.json(url.endsWith('/status')?status('pro','cancelled'):{environment:'sandbox',status:outcome}));
  assert.deepEqual(result,{outcome,plan:'pro',state:'cancelled',changed:false});
 }
});
test('ambiguous provider error is not retried, and malformed or oversized status cannot drive mutations',async()=>{
 let calls=0;
 await assert.rejects(runOwnerRecovery(env,async url=>{calls++;return url.endsWith('/status')?Response.json(status()):Response.json({error:'billing-unavailable'},{status:503});}),/UNAVAILABLE/);
 assert.equal(calls,2);
 for(const value of [{...status(),environment:'live'},{...status(),subscription:{id:'../other',state:'active'}},{...status(),extra:'x'.repeat(17000)}]) {
  calls=0;await assert.rejects(runOwnerRecovery(env,async()=>{calls++;return Response.json(value);}));assert.equal(calls,1);
 }
});
