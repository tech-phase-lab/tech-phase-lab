import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {billingStore} from '../services/tech-phase-billing/store.mjs';
import {liveRecoveryQueue,runLiveRecovery} from '../services/tech-phase-billing/live-recovery.mjs';
const env={TECH_PHASE_PAYPAL_ENV:'live',TECH_PHASE_BILLING_RUNTIME:'railway-live',TECH_PHASE_BILLING_LIVE_BRANCH:'codex/research-preview',RAILWAY_GIT_BRANCH:'codex/research-preview',TECH_PHASE_BILLING_LIVE_RECOVERY_ENABLED:'true',TECH_PHASE_BILLING_LIVE_RECOVERY_LIMIT:'2'};
async function fixture(fn){
 const db=new PGlite();
 try{
  await db.exec('CREATE ROLE tech_phase_billing_live_writer');
  for(const file of ['005_billing_live.sql','006_live_recovery.sql','006_live_recovery.sql'])await db.exec(readFileSync(new URL('../db/tech-phase/'+file,import.meta.url),'utf8'));
  const pool={query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
  const store=billingStore(pool,'live'),queue=liveRecoveryQueue(pool);
  await fn({db,store,queue});
 }finally{await db.close();}
}
async function attach(store,n){const row=await store.reserve('user_Member'+n,'JPY','pro-live-v1');await store.attach('user_Member'+n,row.id,'I-'+String(n).padStart(12,'0'));return row;}
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
test('Live runner stops at time budget or cancellation and rejects cross-environment responses',async()=>{
 const controller=new AbortController();let claims=0,finishes=0;const outcomes=[];
 const services=async()=>({recoveryQueue:{async claim(){claims++;return {id:'fixture',user_id:'user_First'};},async finish(item,outcome){finishes++;outcomes.push(outcome);return true;}},reconciliation:{async reconcile(){controller.abort();return {environment:'sandbox',status:'verified'};}}});
 const result=await runLiveRecovery({env,services,signal:controller.signal,wait:async()=>{}});
 assert.equal(claims,1);assert.equal(finishes,1);assert.deepEqual(outcomes,['failed']);assert.equal(result.outcome,'partial-failure');
 let timeCalls=0;const bounded=await runLiveRecovery({env,services,now:()=>timeCalls++===0?0:180001,wait:async()=>{}});
 assert.equal(bounded.checked,0);assert.equal(bounded.outcome,'bounded');
});
