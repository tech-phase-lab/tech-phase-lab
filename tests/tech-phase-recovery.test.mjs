import test from 'node:test';
import assert from 'node:assert/strict';
import {runOwnerRecovery,runSandboxRecovery} from '../services/tech-phase-billing/recovery.mjs';
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

test('recovery cancels rejected bodies and releases readers without retrying mutations',async()=>{
 for(const [type,code,payload,closed] of [
  ['text/html',200,'private proxy detail',false],
  ['application/jsonp',200,JSON.stringify(status()),false],
  ['application/json',503,'private upstream detail',false],
  ['application/json',200,'malformed',true],
  ['application/json',200,'x'.repeat(16385),false],
 ]) {
  let calls=0,cancelled=0;
  const response=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(payload));if(closed)c.close();},cancel(){cancelled++;}}),{status:code,headers:{'content-type':type}});
  await assert.rejects(runOwnerRecovery(env,async()=>{calls++;return response;}),{message:'RECOVERY_UNAVAILABLE'});
  assert.equal(calls,1);assert.equal(response.body.locked,false);assert.equal(cancelled,closed?0:1);
 }
 const responses=[];
 const result=await runOwnerRecovery(env,async url=>{
  const response=Response.json(url.endsWith('/status')?status():{environment:'sandbox',status:'payment-pending'},{headers:{'content-type':'Application/JSON; charset=utf-8'}});
  responses.push(response);return response;
 });
 assert.equal(result.outcome,'payment-pending');assert.equal(responses.length,3);
 assert.ok(responses.every(response=>!response.body.locked));
});

test('invalid expiry cannot trigger reconciliation and a changed contract is not reported as recovered',async()=>{
 for(const proExpiresAt of [0,2026,null,[],{},'not-a-date']) {
  let calls=0;
  await assert.rejects(runOwnerRecovery(env,async()=>{calls++;return Response.json({...status('pro'),proExpiresAt});}),/INVALID_RECOVERY_STATUS/);
  assert.equal(calls,1);
 }
 let calls=0;
 await assert.rejects(runOwnerRecovery(env,async url=>{
  calls++;
  if(url.endsWith('/reconcile'))return Response.json({environment:'sandbox',status:'verified'});
  return Response.json(calls===1?status():{...status('pro'),subscription:{id:'00000000-0000-4000-8000-000000000002',state:'active'}});
 }),/RECOVERY_CONTRACT_CHANGED/);
 assert.equal(calls,3);
});

test('watchdog reports a late review hold even when reconciliation returned verified',async()=>{
 for(const alreadyHeld of [false,true]) {
  let calls=0;
  const result=await runOwnerRecovery(env,async url=>{
   calls++;
   if(url.endsWith('/reconcile'))return Response.json({environment:'sandbox',status:'verified'});
   return Response.json({...status(),reviewRequired:calls===1?alreadyHeld:true});
  });
  assert.deepEqual(result,{outcome:'review-required',plan:'free',state:'active',changed:!alreadyHeld});
  assert.equal(calls,3);
 }
 for(const value of [{...status(),reviewRequired:'true'},{...status(),reviewRequired:null},{...status(),subscription:null,reviewRequired:true}]) {
  let calls=0;
  await assert.rejects(runOwnerRecovery(env,async()=>{calls++;return Response.json(value);}),/INVALID_RECOVERY_STATUS/);
  assert.equal(calls,1);
 }
});

const cohort={...env,TECH_PHASE_BILLING_SANDBOX_TEST_USERS:'["user_extra","user_last"]'};
test('cohort recovery checks each identity sequentially once and logs only counts',async()=>{
 const calls=[];let active=0;
 const result=await runSandboxRecovery(cohort,async(url,options)=>{
  assert.equal(active++,0);await Promise.resolve();active--;
  const member=options.headers['X-Tech-Phase-User'];calls.push([member,url.split('/').at(-1)]);
  assert.ok(options.signal);assert.equal(options.redirect,'error');
  return Response.json(url.endsWith('/status')?{...status('pro'),reviewRequired:member==='user_owner'}:{environment:'sandbox',status:'verified'});
 });
 assert.deepEqual(result,{outcome:'completed',total:3,checked:3,failed:0,unprocessed:0,reviewRequired:1,changed:0});
 assert.deepEqual(calls,['user_owner','user_extra','user_last'].flatMap(member=>['status','reconcile','status'].map(action=>[member,action])));
 assert.doesNotMatch(JSON.stringify(result),/user_|00000000|Bearer/);
});
test('one ambiguous reconciliation failure does not retry or prevent later member checks',async()=>{
 const calls=[];
 const result=await runSandboxRecovery(cohort,async(url,options)=>{
  const member=options.headers['X-Tech-Phase-User'];calls.push([member,url.split('/').at(-1)]);
  if(member==='user_owner'&&url.endsWith('/reconcile'))throw Error('private-provider-token');
  return Response.json(url.endsWith('/status')?status():{environment:'sandbox',status:'payment-pending'});
 });
 assert.deepEqual(result,{outcome:'partial-failure',total:3,checked:3,failed:1,unprocessed:0,reviewRequired:0,changed:0});
 assert.equal(calls.length,8);assert.equal(calls.filter(([m,a])=>m==='user_owner'&&a==='reconcile').length,1);
 assert.equal(calls.at(-1)[0],'user_last');
});
test('invalid allowlists and runtime gates fail before any network activity',async()=>{
 const never=()=>assert.fail('no network');
 for(const raw of ['null','{}','["user_x","user_x"]','["bad"]','[42]','x'.repeat(1025),JSON.stringify(Array.from({length:6},(_,i)=>`user_${i}`))])
  await assert.rejects(runSandboxRecovery({...cohort,TECH_PHASE_BILLING_SANDBOX_TEST_USERS:raw},never),/CONFIG/);
 for(const patch of [{TECH_PHASE_PAYPAL_ENV:'live'},{TECH_PHASE_BILLING_RECOVERY_BRANCH:'main'},{TECH_PHASE_BILLING_OWNER_ID:''},{TECH_PHASE_BILLING_SERVICE_TOKEN:''}])
  await assert.rejects(runSandboxRecovery({...cohort,...patch},never),/CONFIG/);
 assert.deepEqual(await runSandboxRecovery({...cohort,TECH_PHASE_BILLING_RECOVERY_ENABLED:'false'},never),{outcome:'disabled'});
});
test('missing cohort preserves owner behavior and listing owner never doubles reconciliation',async()=>{
 for(const raw of [undefined,'','[]','["user_owner"]']) {
  let calls=0;
  const result=await runSandboxRecovery({...env,TECH_PHASE_BILLING_SANDBOX_TEST_USERS:raw},async()=>{calls++;return Response.json({...status(),subscription:null});});
  assert.deepEqual(result,{outcome:'no-provider-contract'});assert.equal(calls,1);
 }
});
test('batch cancellation aborts the current request and prevents starting remaining members',async()=>{
 const controller=new AbortController();let calls=0;
 const result=await runSandboxRecovery(cohort,async(url,options)=>{
  calls++;controller.abort();assert.equal(options.signal.aborted,true);options.signal.throwIfAborted();
 },controller.signal);
 assert.deepEqual(result,{outcome:'partial-failure',total:3,checked:1,failed:1,unprocessed:2,reviewRequired:0,changed:0});
 assert.equal(calls,1);
 const stopped=await runSandboxRecovery(cohort,()=>assert.fail('no calls after deadline'),controller.signal);
 assert.equal(stopped.checked,0);assert.equal(stopped.unprocessed,3);
});
