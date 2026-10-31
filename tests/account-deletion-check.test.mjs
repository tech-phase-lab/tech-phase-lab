import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {accountDeletionCheck} from '../services/tech-phase-billing/account-deletion-check.mjs';
import {billingStore} from '../services/tech-phase-billing/store.mjs';
import {liveBackend} from '../services/tech-phase-billing/live-transport.mjs';

const user='user_Buyer';
const row=(id='old')=>({id,user_id:user,paypal_id:'I-ABCDEFGH'+id,currency:'JPY',state:'cancelled',updated_at:'2026-10-01'});
function fixture(rows=[row()],states=['CANCELLED']){
 return {plans:{JPY:'plan'},store:{deletionContracts:async()=>rows,summary:async()=>({proExpiresAt:'2026-11-30T00:00:00Z',reviewRequired:false})},
 paypal:{get:async id=>{const n=rows.findIndex(r=>r.paypal_id===id);return {id,custom_id:rows[n].id,plan_id:'plan',status:states[n]};}}};
}
test('historical active contract blocks deletion even when the selected/latest contract is cancelled',async()=>{
 const f=fixture([row('old'),row('latest')],['ACTIVE','CANCELLED']);
 const result=await accountDeletionCheck(f,user);
 assert.equal(result.autoRenew,true);assert.equal(result.reason,'auto-renew-active');
 assert.doesNotMatch(JSON.stringify(result),/I-ABCDEFGH|user_Buyer|latest/);
});
test('confirmed no contracts or all terminal contracts produce only read-only evidence, never canDelete',async()=>{
 for(const f of [fixture([]),fixture([row('a'),row('b')],['CANCELLED','EXPIRED'])]){
  const result=await accountDeletionCheck(f,user);
  assert.equal(result.autoRenew,false);assert.equal(result.verification,'verified');assert.equal('canDelete' in result,false);
 }
});
test('pending, suspended, unbound, foreign, provider errors, holds and oversized sets remain unverified',async()=>{
 const fixtures=['APPROVAL_PENDING','APPROVED','SUSPENDED','NEW_UNKNOWN'].map(s=>fixture([row()],[s]));
 fixtures.push(fixture([{...row(),paypal_id:null}]),fixture([{...row(),user_id:'user_Other'}]),fixture(Array.from({length:21},(_,i)=>row(String(i)))));
 const error=fixture();error.paypal.get=async()=>{throw Error('secret-token');};fixtures.push(error);
 const wrong=fixture();wrong.paypal.get=async()=>({id:row().paypal_id,custom_id:'other',plan_id:'plan',status:'CANCELLED'});fixtures.push(wrong);
 const hold=fixture();hold.store.summary=async()=>({reviewRequired:true});fixtures.push(hold);
 for(const f of fixtures){const result=await accountDeletionCheck(f,user);assert.equal(result.autoRenew,null);assert.equal(result.verification,'unavailable');assert.doesNotMatch(JSON.stringify(result),/secret-token/);}
});
test('new checkout or changed local contract during provider reads invalidates the check',async()=>{
 for(const later of [[row(),row('new')],[{...row(),state:'active'}],[]]){
  const f=fixture();let reads=0;f.store.deletionContracts=async()=>++reads===1?[row()]:later;
  assert.equal((await accountDeletionCheck(f,user)).verification,'unavailable');
 }
});
test('database inventory includes old rows and isolates members without mutating billing records',async()=>{
 const db=new PGlite();
 try{
  await db.exec('CREATE ROLE tech_phase_billing_live_writer');
  await db.exec(readFileSync(new URL('../db/tech-phase/005_billing_live.sql',import.meta.url),'utf8'));
  const store=billingStore({query:(...args)=>db.query(...args)},'live');
  for(const [i,who,state] of [[1,user,'cancelled'],[2,user,'active'],[3,'user_Other','active']])await db.query("INSERT INTO tech_phase_billing_live.subscriptions(id,user_id,currency,minor,terms_version,state) VALUES ($1,$2,'JPY',2980,'pro-live-v1',$3)",[`00000000-0000-4000-8000-00000000000${i}`,who,state]);
  const rows=await store.deletionContracts(user);assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.state),['cancelled','active']);assert.ok(rows.every(r=>r.user_id===user));
  assert.equal((await db.query('SELECT count(*)::int AS count FROM tech_phase_billing_live.subscriptions')).rows[0].count,3);
 }finally{await db.close();}
});
test('deletion evidence endpoint requires service authentication and is GET-only',async()=>{
 const env={TECH_PHASE_BILLING_RUNTIME:'railway-live',TECH_PHASE_BILLING_LIVE_BRANCH:'codex/research-preview',RAILWAY_GIT_BRANCH:'codex/research-preview',TECH_PHASE_BILLING_LIVE_SERVICE_TOKEN:'fixture_'.repeat(8),TECH_PHASE_BILLING_LIVE_ORIGIN:'https://billing.tech-phase-fixture.com',TECH_PHASE_PAYPAL_ENV:'live',TECH_PHASE_BILLING_LIVE_ENABLED:'true'};
 let calls=0;const backend=liveBackend({env,services:async()=>({accountDeletionCheck:async id=>{calls++;assert.equal(id,user);return {verification:'verified',autoRenew:false};}})});
 const headers={authorization:'Bearer '+env.TECH_PHASE_BILLING_LIVE_SERVICE_TOKEN,'x-tech-phase-user':user};
 const request=(h=headers,method='GET')=>new Request('https://fixture.up.railway.app/live/deletion-check',{headers:h,method});
 assert.equal((await backend(request({}))).status,401);
 assert.equal((await backend(request({...headers,'x-tech-phase-user':''}))).status,401);
 assert.equal((await backend(request(headers,'POST'))).status,405);assert.equal(calls,0);
 const result=await backend(request());assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'private, no-store');assert.equal(calls,1);
});
