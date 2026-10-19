import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { paymentStore } from '../services/resolute-api/payments/store.mjs';
import { quote } from '../services/resolute-api/payments/policy.mjs';
import { createLiveEntitlementReader, liveEntitlements } from '../services/resolute-api/payments/live-entitlements.mjs';

const at = year => `${year}-01-01T00:00:00.000Z`;
const row = (kind,start,end,state='active') => ({kind,starts_at:at(start),expires_at:at(end),state,order_state:'paid'});
test('live entitlement intervals preserve refund gaps and revoke all access with the initial purchase',()=>{
  const initial=row('initial',2020,2021), a=row('renewal',2021,2022), b=row('renewal',2022,2023);
  assert.equal(liveEntitlements([initial,a,b],at(2021)).alerts.expiresAt,at(2023));
  const gap=[initial,{...a,state:'revoked'},b];
  assert.equal(liveEntitlements(gap,at(2021)).canReceiveNotifications,false);
  assert.equal(liveEntitlements(gap,at(2021)).alerts.status,'scheduled');
  assert.equal(liveEntitlements(gap,at(2022)).canReceiveNotifications,true);
  assert.equal(liveEntitlements(gap,at(2023)).canUseTools,true);
  assert.equal(liveEntitlements(gap,at(2023)).canReceiveNotifications,false);
  for(const state of ['revoked','suspended','held']) {
    const result=liveEntitlements([{...initial,order_state:state},a,b],at(2021));
    assert.equal(result.canUseTools,false);assert.equal(result.canReceiveNotifications,false);
  }
  assert.equal(liveEntitlements([a],at(2021)).canUseTools,false);
});

test('isolated live ledger grants once, reads by owner, and reflects refund without projection copies',async()=>{
  const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');
  const data=await boot.dumpDataDir();await boot.close();
  const db=new PGlite({database:'resolute',loadDataDir:data});
  const pool={query:db.query.bind(db),connect:async()=>({query:db.query.bind(db),release(){}})};
  const store=paymentStore(pool,{environment:'live'}),read=createLiveEntitlementReader(pool);
  const user='user_livefixture',now=Date.parse(at(2020));
  try {
    await db.exec(readFileSync(new URL('../db/resolute/010_payments_sandbox.sql',import.meta.url),'utf8'));
    await db.exec(readFileSync(new URL('../db/resolute/014_payments_live.sql',import.meta.url),'utf8'));
    let order=await store.create(user,randomUUID(),rights=>quote('initial','ja',{pro:false},rights,now),now);
    order=await store.bind(order,'TESTORDER0001');
    order=await store.prepare(order,{proUntil:null},now,()=>{});
    const payment={captureId:'TESTCAPTURE0001',paidAt:new Date(now+1000).toISOString()};
    assert.equal(await store.paid(order,payment),'paid');
    assert.equal(await store.paid(order,payment),'already-paid');
    assert.equal((await read(user)).canUseTools,true);
    assert.equal((await read('user_other')).canUseTools,false);
    assert.equal((await db.query("SELECT count(*)::int n FROM resolute_payments_live.audit WHERE code='LIVE_ACCESS_GRANTED'")).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int n FROM resolute_payments_sandbox.grants')).rows[0].n,0);
    // Simulate a missing payment record: a lingering active grant must fail closed.
    await db.query('UPDATE resolute_payments_live.orders SET capture_id=NULL');
    assert.equal((await read(user)).canUseTools,false);
    await db.query('UPDATE resolute_payments_live.orders SET capture_id=$1',[payment.captureId]);
    await store.adverse(order.paypal_id,'revoked','PAYMENT.CAPTURE.REFUNDED','fixture-refund');
    assert.equal((await read(user)).canUseTools,false);
    assert.equal(await store.paid(order,payment),'review-required');
    assert.equal((await read(user)).canUseTools,false);
    await assert.rejects(store.access(user),/live entitlement reader/);
    await assert.rejects(read('invalid'),/identity/);
    assert.throws(()=>paymentStore(pool,{environment:'request_input'}));
  } finally {await db.close();}
});
