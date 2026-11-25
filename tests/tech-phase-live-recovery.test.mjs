import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {billingStore} from '../services/tech-phase-billing/store.mjs';
import {liveRecoveryQueue,runLiveRecovery} from '../services/tech-phase-billing/live-recovery.mjs';
// The consent tick time every checkout carries (lawyer review, Nov 24).
const CONSENT = '2025-01-01T00:00:00.000Z';
const env={TECH_PHASE_PAYPAL_ENV:'live',TECH_PHASE_BILLING_RUNTIME:'railway-live',TECH_PHASE_BILLING_LIVE_BRANCH:'codex/research-preview',RAILWAY_GIT_BRANCH:'codex/research-preview',TECH_PHASE_BILLING_LIVE_RECOVERY_ENABLED:'true',TECH_PHASE_BILLING_LIVE_RECOVERY_LIMIT:'2'};
async function fixture(fn){
 const db=new PGlite();
 try{
  await db.exec('CREATE ROLE tech_phase_billing_live_writer');
  for(const file of ['005_billing_live.sql','006_live_recovery.sql','006_live_recovery.sql','010_terms_consent.sql'])await db.exec(readFileSync(new URL('../db/tech-phase/'+file,import.meta.url),'utf8'));
  const pool={query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
  const store=billingStore(pool,'live'),queue=liveRecoveryQueue(pool);
  await fn({db,store,queue});
 }finally{await db.close();}
}
async function attach(store,n){const row=await store.reserve('user_Member'+n,'JPY','pro-live-v1','month',CONSENT);await store.attach('user_Member'+n,row.id,'I-'+String(n).padStart(12,'0'));return row;}
test('Live due queue is idempotent, bounds work, resumes after crash, and fences expired workers',async()=>fixture(async({db,store,queue})=>{
 await db.exec('SET ROLE tech_phase_billing_live_writer');
 const a=await attach(store,1);await store.attach('user_Member1',a.id,'I-000000000001');await attach(store,2);await attach(store,3);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM tech_phase_billing_live.recovery_queue')).rows[0].n,3);
 const now=Date.now()+1000;
 const first=await queue.claim(now),second=await queue.claim(now);
 assert.notEqual(first.id,second.id);
 assert.equal(await queue.finish(second,'verified',now+1),true);
 // A crashed worker's lease expires, while completed contracts stay deferred.
 const third=await queue.claim(now);assert.notEqual(third.id,first.id);await queue.finish(third,'verified',now+1);
 assert.equal(await queue.claim(now+100),null);
 const reclaimed=await queue.claim(now+300001);assert.equal(reclaimed.id,first.id);assert.notEqual(reclaimed.token,first.token);
 assert.equal(await queue.finish(first,'verified',now+300002),false);
 assert.equal(await queue.finish(reclaimed,'failed',now+300002),true);
 assert.equal(await queue.claim(now+300003),null);
 const retry=await queue.claim(now+360003);assert.equal(retry.id,first.id);assert.equal(retry.failures,1);
 await queue.finish(retry,'verified',now+360004);
 assert.equal(await queue.claim(now+360005),null);
 await assert.rejects(db.exec('DELETE FROM tech_phase_billing_live.recovery_queue'),/permission denied/);
}));
test('Live runner bounds batches, continues past failure and persists review holds without manufacturing payments',async()=>fixture(async({db,store,queue})=>{
 for(let n=1;n<=4;n++)await attach(store,n);
 const calls=[],time=Date.now()+1000;
 const services=async()=>({recoveryQueue:queue,reconciliation:{async reconcile(user,id){calls.push(id);if(calls.length===1)throw Error('private-provider-error');return {environment:'live',status:calls.length===2?'review-required':'verified'};}}});
 const first=await runLiveRecovery({env,services,now:()=>time,wait:async()=>{}});
 assert.equal(first.checked,2);assert.equal(first.failed,1);assert.equal(first.reviewRequired,1);assert.equal(first.outcome,'partial-failure');
 const second=await runLiveRecovery({env,services,now:()=>time,wait:async()=>{}});
 assert.equal(second.checked,2);assert.equal(new Set(calls).size,4);
 const third=await runLiveRecovery({env,services,now:()=>time,wait:async()=>{}});assert.equal(third.checked,0);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM tech_phase_billing_live.payments')).rows[0].n,0);
 assert.doesNotMatch(JSON.stringify(first),/user_|private|subscription|token/);
}));
test('Live recovery is off without explicit activation; invalid configs never initialize services',async()=>{
 let calls=0;const services=async()=>{calls++;throw Error();};
 assert.deepEqual(await runLiveRecovery({env:{},services}),{outcome:'disabled'});
 for(const change of [{TECH_PHASE_PAYPAL_ENV:'sandbox'},{TECH_PHASE_BILLING_RUNTIME:'railway-sandbox'},{RAILWAY_GIT_BRANCH:'wrong'},{TECH_PHASE_BILLING_LIVE_RECOVERY_LIMIT:'26'},{TECH_PHASE_BILLING_LIVE_RECOVERY_LIMIT:'0'},{TECH_PHASE_BILLING_LIVE_RECOVERY_LIMIT:'1.5'}])await assert.rejects(runLiveRecovery({env:{...env,...change},services}),/INVALID_RECOVERY_CONFIG/);
 assert.equal(calls,0);
});
test('missing unpaid pending provider application is retained for review without crash or grant',async()=>fixture(async({db,store,queue})=>{
 await attach(store,1);
 const time=Date.now()+1000;
 const services=async()=>({recoveryQueue:queue,reconciliation:{async reconcile(){throw Error('PAYPAL_SUBSCRIPTION_NOT_FOUND');}}});
 const result=await runLiveRecovery({env,services,now:()=>time,wait:async()=>{}});
 assert.equal(result.outcome,'completed');assert.equal(result.checked,1);assert.equal(result.reviewRequired,1);assert.equal(result.failed,0);
 const row=(await db.query('SELECT last_outcome,failures,next_attempt_at FROM tech_phase_billing_live.recovery_queue')).rows[0];
 assert.equal(row.last_outcome,'review-required');assert.equal(row.failures,0);
 assert.equal(new Date(row.next_attempt_at).getTime(),time+6*3600000);
 assert.equal((await db.query('SELECT state FROM tech_phase_billing_live.subscriptions')).rows[0].state,'approval_pending');
 assert.equal((await db.query('SELECT count(*)::int n FROM tech_phase_billing_live.payments')).rows[0].n,0);
 assert.equal((await db.query('SELECT count(*)::int n FROM tech_phase_billing_live.periods')).rows[0].n,0);
 assert.equal(await queue.claim(time+1),null);
 assert.ok(await queue.claim(time+6*3600000));
}));
test('active or previously paid missing contracts and transport errors still fail and alert',async()=>{
 for(const item of [{state:'active',has_payments:false},{state:'approval_pending',has_payments:true},{state:'cancelled',has_payments:true},{state:'approval_pending'}]){
  let claimed=false;const outcomes=[];
  const services=async()=>({recoveryQueue:{async claim(){if(claimed)return null;claimed=true;return item;},async finish(i,o){outcomes.push(o);return true;}},reconciliation:{async reconcile(){throw Error('PAYPAL_SUBSCRIPTION_NOT_FOUND');}}});
  const result=await runLiveRecovery({env,services,wait:async()=>{}});
  assert.equal(result.outcome,'partial-failure');assert.deepEqual(outcomes,['failed']);
 }
});
test('Live runner stops at time budget or cancellation and rejects cross-environment responses',async()=>{
 const controller=new AbortController();let claims=0,finishes=0;const outcomes=[];
 const services=async()=>({recoveryQueue:{async claim(){claims++;return {id:'fixture',user_id:'user_First'};},async finish(item,outcome){finishes++;outcomes.push(outcome);return true;}},reconciliation:{async reconcile(){controller.abort();return {environment:'sandbox',status:'verified'};}}});
 const result=await runLiveRecovery({env,services,signal:controller.signal,wait:async()=>{}});
 assert.equal(claims,1);assert.equal(finishes,1);assert.deepEqual(outcomes,['failed']);assert.equal(result.outcome,'partial-failure');
 let timeCalls=0;const bounded=await runLiveRecovery({env,services,now:()=>timeCalls++===0?0:180001,wait:async()=>{}});
 assert.equal(bounded.checked,0);assert.equal(bounded.outcome,'bounded');
});
test('a failed item is logged with an allowlisted code, PayPal stage/status and local state only (incident 2026-11-25)',async()=>{
 const {describeFailure}=await import('../services/tech-phase-billing/live-recovery.mjs');
 const provider=Object.assign(Error('PAYPAL_UNAVAILABLE'),{detail:{stage:'request',status:503}});
 const leaky=Object.assign(Error('user_Secret I-ABCDEFGHIJKL private-provider-body'),{detail:{stage:'token user_Secret',status:'503'}});
 const rows=[[provider,{state:'approval_pending',has_payments:false}],[leaky,{state:'weird',has_payments:'no'}]];
 let n=0;const outcomes=[];
 const services=async()=>({recoveryQueue:{async claim(){const r=rows[n++];return r?{id:'fixture-'+n,user_id:'user_Secret',token:'LEASEVALUE',state:r[1].state,has_payments:r[1].has_payments}:null;},async finish(i,o){outcomes.push(o);return true;}},
  reconciliation:{async reconcile(user,id){throw rows[Number(id.slice(8))-1][0];}}});
 const result=await runLiveRecovery({env:{...env,TECH_PHASE_BILLING_LIVE_RECOVERY_LIMIT:'5'},services,wait:async()=>{}});
 assert.equal(result.outcome,'partial-failure');assert.equal(result.failed,2);assert.deepEqual(outcomes,['failed','failed']);
 assert.deepEqual(result.errors,[{code:'PAYPAL_UNAVAILABLE',stage:'request',status:503,state:'approval_pending',paid:false},{code:'OTHER'}]);
 assert.doesNotMatch(JSON.stringify(result),/user_|I-[A-Z]|private|fixture|LEASEVALUE|token/);
 assert.deepEqual(describeFailure(Error('SETTLEMENT_REVIEW_REQUIRED'),{state:'active',has_payments:true}),{code:'SETTLEMENT_REVIEW_REQUIRED',state:'active',paid:true});
});
test('a successful or review-only run keeps the original log shape (no errors field)',async()=>fixture(async({store,queue})=>{
 await attach(store,1);const time=Date.now()+1000;
 const services=async()=>({recoveryQueue:queue,reconciliation:{async reconcile(){throw Error('PAYPAL_SUBSCRIPTION_NOT_FOUND');}}});
 const result=await runLiveRecovery({env,services,now:()=>time,wait:async()=>{}});
 assert.deepEqual(result,{outcome:'completed',checked:1,failed:0,reviewRequired:1,leaseLost:0,bounded:false});
}));
const DAY=86400000;
const age=(db,id,ms)=>db.query(`UPDATE tech_phase_billing_live.subscriptions SET created_at=now()-($2::text||' milliseconds')::interval WHERE id=$1`,[id,String(ms)]);
const stateOf=async(db,id)=>(await db.query('SELECT state FROM tech_phase_billing_live.subscriptions WHERE id=$1',[id])).rows[0].state;
const countOf=async(db,t)=>(await db.query(`SELECT count(*)::int n FROM tech_phase_billing_live.${t}`)).rows[0].n;
const failing=(queue,message,detail)=>async()=>({recoveryQueue:queue,reconciliation:{async reconcile(){throw Object.assign(Error(message),detail?{detail}:{});}}});
test('an abandoned sign-up (72h+, unapproved, unpaid) that PayPal does not know is closed as expired, never rechecked, and the member can start again',async()=>fixture(async({db,store,queue})=>{
 const row=await attach(store,1);await age(db,row.id,26*DAY);
 const time=Date.now()+1000;
 const result=await runLiveRecovery({env,services:failing(queue,'PAYPAL_SUBSCRIPTION_NOT_FOUND'),now:()=>time,wait:async()=>{}});
 assert.deepEqual(result,{outcome:'completed',checked:1,failed:0,reviewRequired:0,leaseLost:0,bounded:false,abandoned:1});
 assert.equal(await stateOf(db,row.id),'expired');
 assert.equal(await countOf(db,'payments'),0);assert.equal(await countOf(db,'periods'),0);assert.equal(await countOf(db,'recovery_queue'),1);
 assert.equal(await queue.claim(time+30*DAY),null,'a closed, never-paid sign-up is not claimed again');
 assert.equal((await store.entitlement('user_Member1')).plan,'free');
 const again=await store.reserve('user_Member1','JPY','pro-live-v1','month',CONSENT);
 assert.notEqual(again.id,row.id);assert.equal(again.state,'creating');
}));
test('PayPal unavailable for an abandoned sign-up is deferred (no alert, no change); a young, paid, held or active one still fails',async()=>fixture(async({db,store,queue})=>{
 const old=await attach(store,1);await age(db,old.id,4*DAY);
 const time=Date.now()+1000;
 const result=await runLiveRecovery({env,services:failing(queue,'PAYPAL_UNAVAILABLE',{stage:'request',status:503}),now:()=>time,wait:async()=>{}});
 assert.deepEqual(result,{outcome:'completed',checked:1,failed:0,reviewRequired:1,leaseLost:0,bounded:false,
  deferred:[{code:'PAYPAL_UNAVAILABLE',stage:'request',status:503,state:'approval_pending',paid:false}]});
 assert.equal(await stateOf(db,old.id),'approval_pending');
 const q=(await db.query('SELECT last_outcome,failures,next_attempt_at FROM tech_phase_billing_live.recovery_queue')).rows[0];
 assert.equal(q.last_outcome,'review-required');assert.equal(q.failures,0);assert.equal(new Date(q.next_attempt_at).getTime(),time+6*3600000);
 // After PayPal answers 404 at the next check, the sign-up closes.
 const later=time+6*3600000;
 const closed=await runLiveRecovery({env,services:failing(queue,'PAYPAL_SUBSCRIPTION_NOT_FOUND'),now:()=>later,wait:async()=>{}});
 assert.equal(closed.abandoned,1);assert.equal(await stateOf(db,old.id),'expired');
}));
test('never closes or defers a sign-up that is young, has a payment, an event, a review hold or is no longer pending',async()=>{
 const cases={
  young:async(db,id)=>age(db,id,70*3600000),
  paid:async(db,id)=>{await age(db,id,4*DAY);await db.query(`INSERT INTO tech_phase_billing_live.payments(transaction_id,subscription_id,currency,minor,paid_at) VALUES('TX-1',$1,'JPY',2980,now())`,[id]);},
  event:async(db,id)=>{await age(db,id,4*DAY);await db.query(`INSERT INTO tech_phase_billing_live.events(event_id,event_type,transaction_id,subscription_id) VALUES('E-1','PAYMENT.SALE.COMPLETED','TX-1',$1)`,[id]);},
  held:async(db,id)=>{await age(db,id,4*DAY);await db.query(`INSERT INTO tech_phase_billing_live.review_holds(subscription_id,reason) VALUES($1,'REFUNDED')`,[id]);},
  active:async(db,id)=>{await age(db,id,4*DAY);await db.query(`UPDATE tech_phase_billing_live.subscriptions SET state='active' WHERE id=$1`,[id]);},
 };
 for(const [name,prepare] of Object.entries(cases))for(const message of ['PAYPAL_SUBSCRIPTION_NOT_FOUND','PAYPAL_UNAVAILABLE'])await fixture(async({db,store,queue})=>{
  const row=await attach(store,1);await prepare(db,row.id);const before=await stateOf(db,row.id);
  const result=await runLiveRecovery({env,services:failing(queue,message),now:()=>Date.now()+1000,wait:async()=>{}});
  assert.equal(result.abandoned,undefined,name);assert.equal(result.deferred,undefined,name);
  assert.equal(await stateOf(db,row.id),before,name);
  const pendingUnpaid404=message==='PAYPAL_SUBSCRIPTION_NOT_FOUND'&&before==='approval_pending'&&name!=='paid';
  assert.equal(result.failed,pendingUnpaid404?0:1,`${name} ${message}`);
 });
});
test('closing re-checks in SQL: a payment or lost lease between claim and close keeps the sign-up open',async()=>fixture(async({db,store,queue})=>{
 const row=await attach(store,1);await age(db,row.id,4*DAY);
 const time=Date.now()+1000,item=await queue.claim(time);assert.equal(item.abandoned,true);
 await db.query(`INSERT INTO tech_phase_billing_live.payments(transaction_id,subscription_id,currency,minor,paid_at) VALUES('TX-2',$1,'JPY',2980,now())`,[row.id]);
 assert.equal(await queue.closeAbandoned(item,time),false);assert.equal(await stateOf(db,row.id),'approval_pending');
 await db.query('DELETE FROM tech_phase_billing_live.payments');
 assert.equal(await queue.closeAbandoned({...item,token:randomUUIDForTest()},time),false);
 assert.equal(await queue.closeAbandoned(item,time+300001),false,'expired lease');
 assert.equal(await queue.closeAbandoned(item,time),true);assert.equal(await stateOf(db,row.id),'expired');
}));
function randomUUIDForTest(){return '00000000-0000-4000-8000-000000000000';}
