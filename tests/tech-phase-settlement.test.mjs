import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { billingStore } from '../services/tech-phase-billing/store.mjs';
import { amountMinor,monthlyBoundary,verifiedPeriod,reconciliationService } from '../services/tech-phase-billing/settlement.mjs';
import { webhookService } from '../services/tech-phase-billing/webhook.mjs';
import { sandboxHandler } from '../services/tech-phase-billing/http.mjs';
const now=Date.parse('2026-10-20T00:00:01Z'), sid='I-ABCDEFGHIJKL', plans={JPY:'P-'+'J'.repeat(24),USD:'P-'+'U'.repeat(24)};
const local={id:'00000000-0000-4000-8000-000000000001',paypal_id:sid,user_id:'user_owner',currency:'JPY',minor:2980};
const money={currency_code:'JPY',value:'2980'};
function remote(row=local,count=1) {return {id:sid,custom_id:row.id,plan_id:plans.JPY,status:'ACTIVE',start_time:'2026-10-20T00:00:00Z',
 billing_info:{last_payment:{amount:money,time:monthlyBoundary('2026-10-20T00:00:00Z',count-1)},
  outstanding_balance:{currency_code:'JPY',value:'0'},failed_payments_count:0,
  next_billing_time:monthlyBoundary('2026-10-20T00:00:00Z',count),cycle_executions:[{tenure_type:'REGULAR',sequence:1,cycles_completed:count}]}};}
const payment=(count=1)=>({id:'TX-'+count,status:'COMPLETED',time:monthlyBoundary('2026-10-20T00:00:00Z',count-1),amount_with_breakdown:{gross_amount:money}});
async function database(work) {
 const db=new PGlite();
 try {
  for(const name of ['001_billing_sandbox.sql','002_paid_periods_sandbox.sql','003_provider_billing_clock.sql','004_dispute_holds_sandbox.sql'])await db.exec(readFileSync(new URL('../db/tech-phase/'+name,import.meta.url),'utf8'));
  const pool={query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
  await work(billingStore(pool),db);
 } finally {await db.close();}
}
test('monthly boundaries preserve month-end anchor and exact minor-unit money',()=>{
 assert.equal(monthlyBoundary('2026-01-31T03:04:05Z',1),'2026-02-28T03:04:05.000Z');
 assert.equal(monthlyBoundary('2026-01-31T03:04:05Z',2),'2026-03-31T03:04:05.000Z');
 assert.equal(monthlyBoundary('2028-01-31T00:00:00Z',1),'2028-02-29T00:00:00.000Z');
 assert.equal(amountMinor({currency_code:'USD',value:'20.00'},'USD'),2000);
 for(const value of ['2e1','20.001','-20',' 20','Infinity'])assert.equal(amountMinor({currency_code:'USD',value},'USD'),null);
 assert.equal(amountMinor({currency_code:'JPY',value:'2980.1'},'JPY'),null);
});
test('two members cannot exchange payments, periods, cancellations or review holds',()=>database(async(store,db)=>{
 const a=await store.reserve('member_a','JPY','sandbox-v1');
 const b=await store.reserve('member_b','JPY','sandbox-v1');
 await store.attach(a.user_id,a.id,'I-MEMBERAAAAAA');
 await store.attach(b.user_id,b.id,'I-MEMBERBBBBBB');
 assert.equal((await store.reserve(a.user_id,'JPY','sandbox-v1')).id,a.id);
 await assert.rejects(store.reserve(a.user_id,'USD','sandbox-v1'),/EXISTING_SUBSCRIPTION/);
 const period={periodStart:'2026-10-20T00:00:00Z',periodEnd:'2026-11-20T00:00:00Z'};
 const pay=(row,transactionId,eventId)=>({id:row.id,transactionId,eventId,eventType:'PAYMENT.SALE.COMPLETED',currency:'JPY',minor:2980,paidAt:period.periodStart});
 const paidA=pay(a,'TX-MEMBER-A','WH-MEMBER-A'),paidB=pay(b,'TX-MEMBER-B','WH-MEMBER-B');
 await store.recordPayment(paidA);await store.recordPayment(paidB);
 await store.grantPeriod(a.user_id,a.id,{...period,transactionId:paidA.transactionId});
 await store.grantPeriod(b.user_id,b.id,{...period,transactionId:paidB.transactionId});
 await assert.rejects(store.recordPayment({...paidA,id:b.id}),/EVENT_CONFLICT/);
 await assert.rejects(store.recordPayment({...paidA,id:b.id,eventId:'WH-CROSS-MEMBER'}),/PAYMENT_CONFLICT/);
 await assert.rejects(store.grantPeriod(b.user_id,b.id,{...period,transactionId:paidA.transactionId}),/PAYMENT_MISMATCH/);
 await assert.rejects(store.grantPeriod(b.user_id,a.id,{...period,transactionId:paidA.transactionId}),/PAYMENT_MISMATCH/);
 assert.equal(await store.get(b.user_id,a.id),null);
 assert.equal(await store.paidPeriod(b.user_id,a.id,paidA.transactionId),null);
 await assert.rejects(store.cancelled(b.user_id,a.id),/SUBSCRIPTION_NOT_FOUND/);
 await assert.rejects(store.hold(b.user_id,a.id,'DISPUTED'),/SUBSCRIPTION_NOT_FOUND/);
 assert.equal((await store.entitlement(a.user_id,now)).plan,'pro');
 assert.equal((await store.entitlement(b.user_id,now)).plan,'pro');
 await store.hold(a.user_id,a.id,'DISPUTED');
 // Late completion and repeated period evidence cannot undo the hold.
 await store.recordPayment({...paidA,eventId:'WH-A-REPLAY'});
 await store.grantPeriod(a.user_id,a.id,{...period,transactionId:paidA.transactionId});
 assert.equal((await store.entitlement(a.user_id,now)).plan,'free');
 assert.equal((await store.entitlement(b.user_id,now)).plan,'pro');
 await store.cancelled(b.user_id,b.id);
 assert.equal((await store.entitlement(b.user_id,Date.parse(period.periodEnd)-1)).plan,'pro');
 assert.equal((await store.entitlement(b.user_id,Date.parse(period.periodEnd))).plan,'free');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM tech_phase_billing_sandbox.payments')).rows[0].n,2);
 assert.equal((await db.query("SELECT count(*)::int AS n FROM tech_phase_billing_sandbox.events WHERE event_id='WH-CROSS-MEMBER'")).rows[0].n,0);
}));
test('subscription summary survives reload, binds owner and excludes provider/internal fields',()=>database(async(store)=>{
 assert.equal((await store.summary('user_owner')).subscription,null);
 const row=await store.reserve('user_owner','JPY','sandbox-v1');
 await store.attach(row.user_id,row.id,sid);
 const summary=await store.summary(row.user_id);
 assert.deepEqual(summary.subscription,{id:row.id,currency:'JPY',state:'approval_pending'});
 assert.equal(summary.plan,'free');
 assert.equal(summary.reviewRequired,false);
 await store.hold(row.user_id,row.id,'DISPUTED');
 assert.equal((await store.summary(row.user_id)).reviewRequired,true);
 assert.equal((await store.summary('other')).reviewRequired,false);
 assert.equal((await store.summary('other')).subscription,null);
 await store.cancelled(row.user_id,row.id);
 assert.equal((await store.summary(row.user_id)).subscription.state,'cancelled');
 const next=await store.reserve(row.user_id,'USD','sandbox-v1');
 assert.equal((await store.summary(row.user_id)).subscription.id,next.id);
 assert.equal((await store.summary(row.user_id)).reviewRequired,false);
}));
test('summary observes one snapshot when a hold arrives after its query and expires at the exact boundary',()=>database(async(store,db)=>{
 const row=await store.reserve('user_owner','JPY','sandbox-v1');
 const paid={eventId:'WH-summary',eventType:'PAYMENT.SALE.COMPLETED',id:row.id,transactionId:'TX-summary',currency:'JPY',minor:2980,paidAt:'2026-10-20T00:00:00Z'};
 await store.recordPayment(paid);
 await store.grantPeriod(row.user_id,row.id,{transactionId:paid.transactionId,periodStart:paid.paidAt,periodEnd:'2026-11-20T00:00:00Z'});
 const end=Date.parse('2026-11-20T00:00:00Z');
 assert.equal((await store.summary(row.user_id,end-1)).plan,'pro');
 assert.equal((await store.summary(row.user_id,end)).plan,'free');
 await assert.rejects(store.summary(row.user_id,NaN),/INVALID_TIME/);
 let calls=0,inject=true;
 const observing=billingStore({query:async(sql,args)=>{
  calls++;const result=await db.query(sql,args);
  if(inject&&sql.includes('max(period_end)')){inject=false;await store.hold(row.user_id,row.id,'DISPUTED');}
  return result;
 }});
 const before=await observing.summary(row.user_id,now);
 assert.equal(calls,1);assert.equal(before.plan,'pro');assert.equal(before.reviewRequired,false);
 const after=await observing.summary(row.user_id,now);
 assert.equal(calls,2);assert.equal(after.plan,'free');assert.equal(after.reviewRequired,true);
}));
test('only matching paid transaction, cycle, amount and schedule produces a PRO period',()=>{
 const result=verifiedPeriod(local,remote(),[payment()],plans,now);
 assert.equal(result.periodEnd,'2026-11-20T00:00:00.000Z');
 for(const mutate of [r=>r.custom_id='another',r=>r.plan_id=plans.USD,r=>r.status='APPROVED',r=>r.quantity='2',
 r=>r.billing_info.failed_payments_count=1,r=>r.billing_info.outstanding_balance.value='2980',
 r=>r.billing_info.next_billing_time='2026-12-20T00:00:00Z',r=>r.billing_info.cycle_executions[0].cycles_completed=2,
 r=>r.billing_info.last_payment.amount={currency_code:'JPY',value:'1'}]) {
  const r=remote();mutate(r);assert.throws(()=>verifiedPeriod(local,r,[payment()],plans,now),/REVIEW/);
 }
 for(const status of ['PENDING','DECLINED','REFUNDED','PARTIALLY_REFUNDED'])assert.throws(()=>verifiedPeriod(local,remote(),[{...payment(),status}],plans,now));
 assert.throws(()=>verifiedPeriod(local,remote(),[payment(),payment()],plans,now));
 assert.throws(()=>verifiedPeriod(local,remote(),[],plans,now));
 const cancelled=remote();cancelled.status='CANCELLED';delete cancelled.billing_info.next_billing_time;
 assert.throws(()=>verifiedPeriod(local,cancelled,[payment()],plans,now),/REVIEW/);
 assert.equal(verifiedPeriod(local,cancelled,[payment()],plans,now,result).periodEnd,result.periodEnd);
});
test('actual Sandbox billing clock settles once and survives cancellation without a guessed expiry',()=>database(async(store,db)=>{
 // Exercise the deployed least-privilege writer, not only the database owner.
 await db.exec(`CREATE ROLE billing_writer NOLOGIN;
  GRANT USAGE ON SCHEMA tech_phase_billing_sandbox TO billing_writer;
  GRANT SELECT,INSERT ON ALL TABLES IN SCHEMA tech_phase_billing_sandbox TO billing_writer;
  GRANT UPDATE ON tech_phase_billing_sandbox.subscriptions TO billing_writer;
  SET ROLE billing_writer;`);
 const row=await store.reserve('user_owner','JPY','sandbox-v1');await store.attach(row.user_id,row.id,sid);
 const r=remote(row);r.start_time='2026-10-20T06:17:10Z';
 r.billing_info.last_payment.time='2026-10-20T06:38:15Z';
 r.billing_info.next_billing_time='2026-11-20T10:00:00Z';
 const p={...payment(),time:'2026-10-20T06:38:15.000Z'};
 const clock=Date.parse('2026-10-20T06:46:00Z');
 const svc=reconciliationService({store,paypal:{get:async()=>structuredClone(r),transactions:async()=>({transactions:[p]})},plans,now:()=>clock});
 const first=await svc.reconcile(row.user_id,row.id);
 assert.equal(first.plan,'pro');assert.equal(first.proExpiresAt,'2026-11-20T10:00:00.000Z');
 await svc.reconcile(row.user_id,row.id);
 r.status='CANCELLED';delete r.billing_info.next_billing_time;
 assert.deepEqual(await svc.reconcile(row.user_id,row.id),first);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM tech_phase_billing_sandbox.periods')).rows[0].n,1);
 assert.equal(await store.paidPeriod('other',row.id,p.id),null);
 assert.equal(await store.paidPeriod(row.user_id,row.id,'OTHER-PAYMENT'),null);
 await assert.rejects(db.query('UPDATE tech_phase_billing_sandbox.payments SET minor=1'),/permission denied/);
 await assert.rejects(db.query('DELETE FROM tech_phase_billing_sandbox.periods'),/permission denied/);
 await db.exec('RESET ROLE');
 // Migration is safe to reapply to a paid ledger and retains bounded duration.
 await db.exec(readFileSync(new URL('../db/tech-phase/003_provider_billing_clock.sql',import.meta.url),'utf8'));
 assert.equal((await store.entitlement(row.user_id,clock)).proExpiresAt,first.proExpiresAt);
 for(const end of ['2026-11-15T06:17:10Z','2026-11-21T06:17:10Z']) {
  await assert.rejects(db.query('UPDATE tech_phase_billing_sandbox.periods SET period_end=$1 WHERE transaction_id=$2',[end,p.id]),/check constraint/);
 }
}));
test('actual USD first renewal on the next UTC date settles once and retains its verified expiry after cancellation',()=>database(async(store,db)=>{
 const row=await store.reserve('user_owner','USD','sandbox-v1');await store.attach(row.user_id,row.id,sid);
 const r=remote(row);r.plan_id=plans.USD;r.start_time='2026-10-20T15:23:54Z';
 r.billing_info.last_payment={amount:{currency_code:'USD',value:'20.0'},time:'2026-10-20T15:24:34Z'};
 r.billing_info.outstanding_balance={currency_code:'USD',value:'0.0'};
 r.billing_info.next_billing_time='2026-11-21T10:00:00Z';
 const p={id:'TX-USD-UTC',status:'COMPLETED',time:'2026-10-20T15:24:34.000Z',amount_with_breakdown:{gross_amount:{currency_code:'USD',value:'20.00'}}};
 const clock=Date.parse('2026-10-20T15:27:00Z');
 const svc=reconciliationService({store,paypal:{get:async()=>structuredClone(r),transactions:async()=>({transactions:[p]})},plans,now:()=>clock});
 const first=await svc.reconcile(row.user_id,row.id);
 assert.equal(first.status,'verified');assert.equal(first.proExpiresAt,'2026-11-21T10:00:00.000Z');
 assert.deepEqual(await svc.reconcile(row.user_id,row.id),first);
 for(const end of ['2026-11-21T15:23:54Z','2026-11-22T10:00:00Z']) {
  const copy=structuredClone(r);copy.billing_info.next_billing_time=end;
  assert.throws(()=>verifiedPeriod({...row,paypal_id:sid},copy,[p],plans,clock),/REVIEW/);
 }
 r.status='CANCELLED';delete r.billing_info.next_billing_time;
 assert.deepEqual(await svc.reconcile(row.user_id,row.id),first);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM tech_phase_billing_sandbox.payments')).rows[0].n,1);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM tech_phase_billing_sandbox.periods')).rows[0].n,1);
 assert.equal((await store.entitlement(row.user_id,Date.parse(first.proExpiresAt))).plan,'free');
}));
test('provider clock respects monthly dates, renewals and month-end anchors without loosening payment evidence',()=>{
 const r=remote(local,2);r.start_time='2026-01-31T06:17:10Z';
 r.billing_info.last_payment.time='2026-02-28T10:00:03Z';
 r.billing_info.next_billing_time='2026-03-31T10:00:00Z';
 const p={...payment(2),time:r.billing_info.last_payment.time},clock=Date.parse('2026-02-28T10:01:00Z');
 const verified=verifiedPeriod(local,r,[p],plans,clock);
 assert.equal(verified.periodStart,'2026-02-28T10:00:00.000Z');
 assert.equal(verified.periodEnd,'2026-03-31T10:00:00.000Z');
 for(const next of ['2026-03-30T10:00:00Z','2026-04-01T10:00:00Z','invalid','']) {
  const copy=structuredClone(r);copy.billing_info.next_billing_time=next;
  assert.throws(()=>verifiedPeriod(local,copy,[p],plans,clock),/REVIEW/);
 }
 for(const patch of [{status:'PENDING'},{amount_with_breakdown:{gross_amount:{currency_code:'JPY',value:'1'}}},
  {amount_with_breakdown:{gross_amount:{currency_code:'USD',value:'2980'}}}]) {
  assert.throws(()=>verifiedPeriod(local,r,[{...p,...patch}],plans,clock),/REVIEW/);
 }
});
test('reconciliation persists first purchase, renews once, expires, and preserves paid access on cancellation',()=>database(async(store,db)=>{
 const row=await store.reserve('user_owner','JPY','sandbox-v1');await store.attach(row.user_id,row.id,sid);
 let count=1,clock=now,status='ACTIVE';
 const paypal={get:async()=>({...remote(row,count),status}),transactions:async()=>({transactions:[payment(count)]})};
 const service=reconciliationService({store,paypal,plans,now:()=>clock});
 assert.equal((await store.entitlement(row.user_id,clock)).plan,'free');
 const first=await service.reconcile(row.user_id,row.id);assert.equal(first.plan,'pro');
 await service.reconcile(row.user_id,row.id);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM tech_phase_billing_sandbox.periods')).rows[0].n,1);
 status='CANCELLED';await service.reconcile(row.user_id,row.id);
 assert.equal((await store.entitlement(row.user_id,clock)).proExpiresAt,first.proExpiresAt);
 assert.equal((await store.entitlement(row.user_id,Date.parse(first.proExpiresAt))).plan,'free');
 // Separate renewal fixture uses the same provider contract; no manual expiry extension.
 count=2;clock=Date.parse('2026-11-20T00:00:01Z');
 assert.equal((await service.reconcile(row.user_id,row.id)).proExpiresAt,'2026-12-20T00:00:00.000Z');
 assert.equal((await store.get(row.user_id,row.id)).state,'cancelled');
 await assert.rejects(service.reconcile('user_other',row.id),/NOT_FOUND/);
}));
test('failed renewal and mixed provider snapshots cannot extend stored access',()=>database(async(store)=>{
 const row=await store.reserve('user_owner','JPY','sandbox-v1');await store.attach(row.user_id,row.id,sid);
 let r=remote(row),reads=0,mixed=false;
 const paypal={get:async()=>{reads++;return mixed&&reads%2===0?{...r,status:'CANCELLED'}:r;},transactions:async()=>({transactions:[payment()]})};
 const svc=reconciliationService({store,paypal,plans,now:()=>now});await svc.reconcile(row.user_id,row.id);
 const before=await store.entitlement(row.user_id,now);
 r=remote(row,2);r.billing_info.last_payment=remote(row).billing_info.last_payment;r.billing_info.failed_payments_count=1;
 await assert.rejects(svc.reconcile(row.user_id,row.id),/REVIEW/);
 assert.deepEqual(await store.entitlement(row.user_id,now),before);
 r=remote(row);mixed=true;await assert.rejects(svc.reconcile(row.user_id,row.id),/RETRY/);
}));
test('immutable period and sticky refund evidence survive duplicate and out-of-order completion',()=>database(async(store)=>{
 const row=await store.reserve('user_owner','JPY','sandbox-v1');await store.attach(row.user_id,row.id,sid);
 const paypal={get:async()=>remote(row),transactions:async()=>({transactions:[payment()]}),verify:async()=>true};
 const svc=reconciliationService({store,paypal,plans,now:()=>now});
 const webhook=webhookService({store,paypal,reconciliation:svc,ownerId:row.user_id});
 // Refund arrives before the first payment exists locally.
 await webhook(new Headers(),{id:'WH-refund',event_type:'PAYMENT.SALE.REFUNDED',resource:{sale_id:'TX-1'}});
 assert.equal((await svc.reconcile(row.user_id,row.id)).plan,'free');
 await assert.rejects(store.grantPeriod(row.user_id,row.id,{transactionId:'TX-1',periodStart:'2026-10-20Z',periodEnd:'2026-11-21Z'}));
 await webhook(new Headers(),{id:'WH-late',event_type:'PAYMENT.SALE.COMPLETED',resource:{billing_agreement_id:sid}});
 assert.equal((await store.entitlement(row.user_id,now)).plan,'free');
}));
test('payment write survives period-write interruption and next reconciliation repairs it exactly once',()=>database(async(store,db)=>{
 const row=await store.reserve('user_owner','JPY','sandbox-v1');await store.attach(row.user_id,row.id,sid);
 const original=store.grantPeriod;let fail=true;
 store.grantPeriod=async(...args)=>{if(fail)throw Error('interrupted');return original.apply(store,args);};
 const svc=reconciliationService({store,paypal:{get:async()=>remote(row),transactions:async()=>({transactions:[payment()]})},plans,now:()=>now});
 await assert.rejects(svc.reconcile(row.user_id,row.id),/interrupted/);
 assert.equal((await store.entitlement(row.user_id,now)).plan,'free');fail=false;
 assert.equal((await svc.reconcile(row.user_id,row.id)).plan,'pro');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM tech_phase_billing_sandbox.payments')).rows[0].n,1);
}));
test('unverified webhook never queries or changes billing records',async()=>{
 let calls=0;const webhook=webhookService({paypal:{verify:async()=>false},store:{findSubscription(){calls++;}},reconciliation:{},ownerId:'user_owner'});
 await assert.rejects(webhook(new Headers(),{id:'WH-test',event_type:'PAYMENT.SALE.COMPLETED',resource:{billing_agreement_id:sid}}),/SIGNATURE/);
 assert.equal(calls,0);
});
test('signed disputes remain held across early arrival, duplicate delivery, resolution and renewal',()=>database(async(store,db)=>{
 const row=await store.reserve('user_owner','JPY','sandbox-v1');await store.attach(row.user_id,row.id,sid);
 let count=1,clock=now,verified=true;
 const paypal={get:async()=>remote(row,count),transactions:async()=>({transactions:[payment(count)]}),verify:async()=>verified};
 const svc=reconciliationService({store,paypal,plans,now:()=>clock});
 const webhook=webhookService({store,paypal,reconciliation:svc,ownerId:row.user_id});
 const event={id:'WH-dispute',event_type:'CUSTOMER.DISPUTE.CREATED',resource:{dispute_id:'PP-D-fixture',
  disputed_transactions:[{seller_transaction_id:'TX-1',buyer_transaction_id:'BUYER-OTHER'}]}};
 verified=false;await assert.rejects(webhook(new Headers(),event),/INVALID_SIGNATURE/);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM tech_phase_billing_sandbox.adverse_transactions')).rows[0].n,0);
 verified=true;
 assert.equal((await webhook(new Headers(),event)).status,'ignored');
 const held=await svc.reconcile(row.user_id,row.id);
 assert.equal(held.plan,'free');assert.equal(held.status,'review-required');
 // A later cycle cannot bypass a tombstone received before any payment existed.
 count=2;clock=Date.parse('2026-11-20T00:00:01Z');
 assert.equal((await svc.reconcile(row.user_id,row.id)).plan,'free');
 for(const type of ['CUSTOMER.DISPUTE.CREATED','CUSTOMER.DISPUTE.UPDATED','CUSTOMER.DISPUTE.RESOLVED']) {
  assert.equal((await webhook(new Headers(),{...event,event_type:type})).status,'review-required');
  const result=await svc.reconcile(row.user_id,row.id);
  assert.equal(result.plan,'free');assert.equal(result.status,'review-required');
 }
 assert.equal((await db.query('SELECT count(*)::int AS n FROM tech_phase_billing_sandbox.adverse_transactions')).rows[0].n,1);
 assert.equal((await db.query('SELECT reason FROM tech_phase_billing_sandbox.review_holds')).rows[0].reason,'DISPUTED');
 // Migration is repeatable and cannot remove existing holds or payment history.
 await db.exec(readFileSync(new URL('../db/tech-phase/004_dispute_holds_sandbox.sql',import.meta.url),'utf8'));
 assert.equal((await store.entitlement(row.user_id,clock)).plan,'free');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM tech_phase_billing_sandbox.payments')).rows[0].n,2);
 paypal.get=async()=>({...remote(row,count),billing_info:{}});
 const missingProviderPayment=await svc.reconcile(row.user_id,row.id);
 assert.equal(missingProviderPayment.status,'review-required');
 assert.equal(missingProviderPayment.plan,'free');
}));
test('dispute retry completes an interrupted hold without restoring access or duplicating history',()=>database(async(store,db)=>{
 const row=await store.reserve('user_owner','JPY','sandbox-v1');
 const transactionId='TX-interrupted';
 await store.recordPayment({eventId:'WH-paid',eventType:'PAYMENT.SALE.COMPLETED',id:row.id,transactionId,currency:'JPY',minor:2980,paidAt:'2026-10-20T00:00:00Z'});
 await store.grantPeriod(row.user_id,row.id,{transactionId,periodStart:'2026-10-20T00:00:00Z',periodEnd:'2026-11-20T00:00:00Z'});
 assert.equal((await store.summary(row.user_id,now)).plan,'pro');
 let interrupt=true;
 const webhook=webhookService({store:{...store,hold:async(...args)=>{
  if(interrupt){interrupt=false;throw Error('DB_INTERRUPTED');}
  return store.hold(...args);
 }},paypal:{verify:async()=>true},reconciliation:{},ownerId:row.user_id});
 const event={id:'WH-retry',event_type:'CUSTOMER.DISPUTE.CREATED',resource:{dispute_id:'PP-D-retry',disputed_transactions:[{seller_transaction_id:transactionId}]}};
 await assert.rejects(webhook(new Headers(),event),/DB_INTERRUPTED/);
 const interrupted=await store.summary(row.user_id,now);
 assert.equal(interrupted.plan,'free');assert.equal(interrupted.reviewRequired,true);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM tech_phase_billing_sandbox.review_holds')).rows[0].n,0);
 for(let attempt=0;attempt<2;attempt++)assert.equal((await webhook(new Headers(),event)).status,'review-required');
 assert.equal((await store.summary(row.user_id,now)).plan,'free');
 for(const table of ['review_holds','adverse_transactions','payments','periods']) {
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM tech_phase_billing_sandbox.${table}`)).rows[0].n,1);
 }
}));
test('dispute validation checks the whole list before writes and never substitutes buyer IDs',async()=>{
 const calls=[];
 const webhook=webhookService({paypal:{verify:async()=>true},store:{holdTransaction:async id=>calls.push(id),findPayment:async()=>null},reconciliation:{},ownerId:'user_owner'});
 for(const resource of [{}, {dispute_id:'PP-D-1',disputed_transactions:[]},
  {dispute_id:'PP-D-1',disputed_transactions:[{buyer_transaction_id:'TX-1'}]},
  {dispute_id:'PP-D-1',disputed_transactions:[{seller_transaction_id:'TX-1'},{seller_transaction_id:'../bad'}]}]) {
  await assert.rejects(webhook(new Headers(),{id:'WH-1',event_type:'CUSTOMER.DISPUTE.CREATED',resource}),/INVALID_EVENT/);
  assert.deepEqual(calls,[]);
 }
 await webhook(new Headers(),{id:'WH-1',event_type:'CUSTOMER.DISPUTE.CREATED',resource:{dispute_id:'PP-D-1',disputed_transactions:[{seller_transaction_id:'TX-1'},{seller_transaction_id:'TX-1'},{seller_transaction_id:'TX-2'}]}});
 assert.deepEqual(calls,['TX-1','TX-2']);
});
test('owner Sandbox adverse notifications cannot hold known payments of another member',()=>database(async(store,db)=>{
 const rows=[];
 for(const user of ['user_owner','user_other']) {
  const row=await store.reserve(user,'JPY','sandbox-v1');rows.push(row);
  const transactionId=`TX-${user.replaceAll('_','-')}`;
  await store.recordPayment({eventId:`WH-${user}`,eventType:'PAYMENT.SALE.COMPLETED',id:row.id,transactionId,currency:'JPY',minor:2980,paidAt:'2026-10-20T00:00:00Z'});
  await store.grantPeriod(user,row.id,{transactionId,periodStart:'2026-10-20T00:00:00Z',periodEnd:'2026-11-20T00:00:00Z'});
 }
 const webhook=webhookService({store,paypal:{verify:async()=>true},reconciliation:{},ownerId:'user_owner'});
 for(const event_type of ['PAYMENT.SALE.REFUNDED','PAYMENT.SALE.REVERSED']) {
  assert.equal((await webhook(new Headers(),{id:'WH-other',event_type,resource:{sale_id:'TX-user-other',id:'TX-user-other'}})).status,'ignored');
 }
 const result=await webhook(new Headers(),{id:'WH-mixed',event_type:'CUSTOMER.DISPUTE.CREATED',resource:{dispute_id:'PP-D-mixed',
  disputed_transactions:[{seller_transaction_id:'TX-user-other'},{seller_transaction_id:'TX-user-owner'}]}});
 assert.equal(result.status,'review-required');
 assert.equal((await store.entitlement('user_owner',now)).plan,'free');
 assert.equal((await store.entitlement('user_other',now)).plan,'pro');
 assert.deepEqual((await db.query('SELECT transaction_id FROM tech_phase_billing_sandbox.adverse_transactions')).rows,[{transaction_id:'TX-user-owner'}]);
 assert.deepEqual((await db.query('SELECT subscription_id FROM tech_phase_billing_sandbox.review_holds')).rows,[{subscription_id:rows[0].id}]);
}));
test('hold migration blocks later paid cycles without blocking another member or deleting the ledger',()=>database(async(store,db)=>{
 const owner=await store.reserve('user_owner','JPY','sandbox-v1');
 const other=await store.reserve('user_other','JPY','sandbox-v1');
 for(const [row,transactionId,start,end] of [
  [owner,'TX-first','2026-10-20T00:00:00Z','2026-11-20T00:00:00Z'],
  [owner,'TX-renewal','2026-11-20T00:00:00Z','2026-12-20T00:00:00Z'],
  [other,'TX-other','2026-11-20T00:00:00Z','2026-12-20T00:00:00Z'],
 ]) {
  await store.recordPayment({eventId:`WH-${transactionId}`,eventType:'PAYMENT.SALE.COMPLETED',id:row.id,transactionId,currency:'JPY',minor:2980,paidAt:start});
  await store.grantPeriod(row.user_id,row.id,{transactionId,periodStart:start,periodEnd:end});
 }
 await store.holdTransaction('TX-first','REFUNDED');
 const clock=Date.parse('2026-11-21T00:00:00Z');
 // Reproduce the deployed old view before applying the additive migration.
 await db.exec(readFileSync(new URL('../db/tech-phase/002_paid_periods_sandbox.sql',import.meta.url),'utf8'));
 assert.equal((await store.entitlement(owner.user_id,clock)).plan,'pro');
 await db.exec(readFileSync(new URL('../db/tech-phase/004_dispute_holds_sandbox.sql',import.meta.url),'utf8'));
 assert.equal((await store.entitlement(owner.user_id,clock)).plan,'free');
 assert.equal((await store.entitlement(other.user_id,clock)).plan,'pro');
 assert.equal(await store.hasReviewHold(owner.user_id,owner.id),true);
 assert.equal(await store.hasReviewHold(other.user_id,other.id),false);
 assert.equal(await store.hasReviewHold(other.user_id,owner.id),false);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM tech_phase_billing_sandbox.payments')).rows[0].n,3);
}));
test('sandbox HTTP requires preview, owner identity, exact fields, origin and bounded input',async()=>{
 const env={VERCEL_ENV:'preview',TECH_PHASE_BILLING_SANDBOX_ENABLED:'true',TECH_PHASE_PAYPAL_ENV:'sandbox'};
 let user='user_owner',calls=0;
 const services=async()=>{calls++;return {store:{summary:async id=>({environment:'sandbox',user:id})},
  checkout:{start:async(...args)=>({args}),cancel:async()=>({status:'cancelled'})},reconciliation:{reconcile:async()=>({plan:'pro'})},webhook:async()=>({status:'ignored'})};};
 const handler=sandboxHandler({env,identity:async()=>user,ownerId:'user_owner',services});
 const req=(action,body,origin='https://example.test')=>new Request('https://example.test/api/'+action,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 for(const mode of ['production','development']) {env.VERCEL_ENV=mode;assert.equal((await handler(req('status'),'status')).status,503);}env.VERCEL_ENV='preview';
 user=null;assert.equal((await handler(req('status'),'status')).status,401);user='user_other';assert.equal((await handler(req('status'),'status')).status,403);
 assert.equal(calls,0);user='user_owner';
 assert.equal((await handler(req('create',{currency:'JPY',acceptedTerms:'sandbox-v1'},'https://evil.test'),'create')).status,403);
 assert.equal((await handler(req('create',{currency:'JPY',acceptedTerms:'sandbox-v1',userId:'victim'}),'create')).status,400);
 assert.equal((await handler(req('create',{currency:'JPY',acceptedTerms:'x'.repeat(3000)}),'create')).status,400);
 assert.equal((await handler(req('cancel',{id:'../other'}),'cancel')).status,400);
 const result=await handler(req('create',{currency:'JPY',acceptedTerms:'sandbox-v1'}),'create');
 assert.deepEqual((await result.json()).args,['user_owner','JPY','sandbox-v1']);
 assert.equal((await handler(req('status'),'status')).headers.get('Cache-Control'),'private, no-store');
});
