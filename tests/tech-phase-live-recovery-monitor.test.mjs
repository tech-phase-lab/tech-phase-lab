import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryPing,runRecoveryJob} from '../services/tech-phase-billing/live-recovery-job.mjs';
const url='https://hc-ping.com/11111111-2222-3333-4444-555555555555';
const env={TECH_PHASE_PAYPAL_ENV:'live',TECH_PHASE_BILLING_RUNTIME:'railway-live',TECH_PHASE_BILLING_LIVE_RECOVERY_ENABLED:'true',TECH_PHASE_BILLING_LIVE_BRANCH:'codex/research-preview',RAILWAY_GIT_BRANCH:'codex/research-preview',TECH_PHASE_BILLING_LIVE_RECOVERY_MONITOR_PING_URL:url};
test('recovery heartbeat sends no billing data and rejects redirects and unsafe URLs',async()=>{
 const calls=[];const send=async(...args)=>{calls.push(args);return {ok:true,body:{cancel:async()=>{}}};};
 for(const phase of ['start','success','fail'])assert.equal(await recoveryPing(url,phase,send),'sent');
 assert.deepEqual(calls.map(c=>c[0]),[url+'/start',url,url+'/fail']);
 for(const [,opts] of calls){assert.equal(opts.body,'');assert.equal(opts.redirect,'error');assert.equal(opts.method,'POST');assert.ok(opts.signal);}
 for(const bad of ['http://hc-ping.com/x',url+'?secret=x',url+'/',url.replace('hc-ping.com','evil.example')])assert.equal(await recoveryPing(bad,'success',send),'failed');
 assert.equal(calls.length,3);
 assert.equal(await recoveryPing(url,'success',async()=>{throw Error('SECRET');}),'failed');
 assert.equal(await recoveryPing(url,'success',async()=>({ok:false})),'failed');
});
async function job({outcome='completed',throwRun=false,closeFails=false,pingFails=false,override={}}={}){
 const phases=[],logs=[];let ran=0,closed=0;
 const code=await runRecoveryJob({env:{...env,...override},runtime:{services(){},async close(){closed++;if(closeFails)throw Error('PRIVATE');}},
  run:async()=>{ran++;if(throwRun)throw Error('PRIVATE');return {outcome,checked:0};},
  ping:async(u,p)=>{if(!u)return 'disabled';phases.push(p);return pingFails?'failed':'sent';},log:s=>logs.push(s)});
 return {code,phases,logs,ran,closed};
}
test('successful and bounded batches send success after cleanup',async()=>{
 for(const outcome of ['completed','bounded']){const r=await job({outcome});assert.equal(r.code,0);assert.deepEqual(r.phases,['start','success']);assert.equal(r.closed,1);}
});
test('processing and cleanup failures signal failure without leaking errors',async()=>{
 for(const opts of [{outcome:'partial-failure'},{throwRun:true},{closeFails:true}]){const r=await job(opts);assert.equal(r.code,1);assert.deepEqual(r.phases,['start','fail']);assert.equal(r.closed,1);assert.doesNotMatch(r.logs.join(''),/PRIVATE/);}
});
test('monitor failure never prevents reconciliation or cleanup',async()=>{
 const r=await job({pingFails:true});assert.equal(r.code,1);assert.equal(r.ran,1);assert.equal(r.closed,1);
});
test('disabled or mismatched deployment cannot refresh a heartbeat',async()=>{
 for(const override of [{TECH_PHASE_BILLING_LIVE_RECOVERY_ENABLED:'false'},{RAILWAY_GIT_BRANCH:'main'},{TECH_PHASE_PAYPAL_ENV:'sandbox'}])assert.deepEqual((await job({override})).phases,[]);
});
