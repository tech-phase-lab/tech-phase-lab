import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { paymentStore } from '../services/resolute-api/payments/store.mjs';
import { paymentEngine } from '../services/resolute-api/payments/engine.mjs';
import { paymentHttp } from '../services/resolute-api/payments/http.mjs';
import { guestIdentity, authenticateGuest } from '../services/resolute-api/payments/guest.mjs';
import { createLiveEntitlementReader } from '../services/resolute-api/payments/live-entitlements.mjs';
import { checkoutUrl } from '../lib/resolute/live-checkout.ts';

const now=Date.parse('2026-10-27T06:00:00Z');
const account=id=>({id,primaryEmailAddressId:'email_verified',emailAddresses:[{id:'email_verified',verification:{status:'verified'}}],privateMetadata:{plan:'pro',proExpiresAt:'2029-01-01T00:00:00Z'}});
const secret='s'.repeat(43),token=randomBytes(32).toString('hex'),guest=guestIdentity(token);
test('guest ownership requires a random capability through the authenticated service, not an order ID or email',()=>{
 for(const value of [undefined,null,'',randomUUID(),'payer@example.test','A'.repeat(64),token+'a']) assert.equal(guestIdentity(value),null);
 assert.match(guest,/^guest_[a-f0-9]{64}$/);assert.ok(!guest.includes(token));
 const headers=new Headers({'x-resolute-guest-token':token});
 assert.equal(authenticateGuest(headers,{serviceToken:secret}),null);
 headers.set('x-resolute-service-token',secret);
 assert.equal(authenticateGuest(headers,{serviceToken:secret}),guest);
 assert.equal(new URL(checkoutUrl('en',randomUUID(),false,true),'https://site.test').searchParams.get('guest'),'1');
});

test('guest payment lifecycle uses the verified live ledger without premature or duplicate access',async t=>{
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const data=await boot.dumpDataDir();await boot.close();
 const db=new PGlite({database:'resolute',loadDataDir:data});t.after(()=>db.close());
 for(const file of ['014_payments_live.sql','021_guest_payments.sql']) await db.exec(await readFile(new URL('../db/resolute/'+file,import.meta.url),'utf8'));
 const query=db.query.bind(db),pool={query,connect:async()=>({query,release(){}})},store=paymentStore(pool,{environment:'live'});
 const access=createLiveEntitlementReader(pool);
 let charge=true,allow=true,captures=0,clock=now,banned=false;
 const states=new Map();
 const paypal={
  create:async()=>{const id='ORDER'+randomBytes(8).toString('hex').toUpperCase();states.set(id,'APPROVED');return {id};},
  approval:async id=>'https://www.paypal.com/checkoutnow?token='+id,
  capture:async order=>{captures++;states.set(order.paypal_id,'COMPLETED');},
  get:async id=>{
   const o=await store.findPaypal(id),amount={currency_code:o.quote.currency,value:o.quote.value};
   return {id,intent:'CAPTURE',status:states.get(id),purchase_units:[{reference_id:o.id,custom_id:o.id,invoice_id:o.id,
    payee:{merchant_id:'MERCHANT1234'},amount,items:[{sku:o.quote.sku,quantity:'1',unit_amount:amount}],
    payments:{captures:[{id:'CAP'+id,status:'COMPLETED',final_capture:true,amount,create_time:new Date(now+1000).toISOString()}]}}]};
  },
 };
 const engine=paymentEngine({store,paypal,environment:'live',merchantId:'MERCHANT1234',getUser:async id=>({...account(id),banned}),
  now:()=>clock,canCharge:()=>charge,allowGuest:()=>allow});
 const body=()=>({kind:'initial',language:'ja',requestKey:randomUUID()});
 let first;
 await t.test('initial purchase is normal price, renewal and disabled guest sales are rejected',async()=>{
  allow=false;await assert.rejects(engine.create(guest,body()),/AUTH_REQUIRED/);allow=true;
  await assert.rejects(engine.create(guest,{...body(),kind:'renewal'}),/AUTH_REQUIRED/);
  const request=body();first=await engine.create(guest,request);
  assert.equal(first.quote.value,'7980');assert.equal(first.quote.priceClass,'launch');assert.equal(first.claimRequired,true);
  assert.equal((await engine.create(guest,request)).orderId,first.orderId);
  await assert.rejects(engine.status(guestIdentity('b'.repeat(64)),first.orderId),/ORDER_NOT_FOUND/);
  await assert.rejects(engine.claim('user_buyer',guest,{orderId:first.orderId}),/PAYMENT_REVIEW_REQUIRED/);
 });
 await t.test('capture retry grants no rights until account claim; payment is captured only once',async()=>{
  assert.equal((await engine.capture(guest,{orderId:first.orderId})).state,'paid');
  assert.equal((await engine.capture(guest,{orderId:first.orderId})).state,'already-paid');assert.equal(captures,1);
  assert.equal((await query('SELECT * FROM resolute_payments_live.grants')).rows.length,0);
  assert.equal((await access('user_buyer')).canUseTools,false);
 });
 await t.test('claim needs verified account and secret; stays available when new sales stop',async()=>{
  charge=false;clock=now+7*86400000;
  banned=true;await assert.rejects(engine.claim('user_buyer',guest,{orderId:first.orderId}),/VERIFIED_ACCOUNT_REQUIRED/);banned=false;
  await assert.rejects(engine.claim('user_buyer',guestIdentity('c'.repeat(64)),{orderId:first.orderId}),/ORDER_NOT_FOUND/);
  assert.equal((await engine.claim('user_buyer',guest,{orderId:first.orderId})).state,'claimed');
  const grant=(await query('SELECT * FROM resolute_payments_live.grants')).rows[0];
  assert.equal(new Date(grant.starts_at).toISOString(),'2026-10-27T06:00:01.000Z');
  assert.equal(new Date(grant.expires_at).toISOString(),'2027-10-27T06:00:01.000Z');
  assert.equal((await access('user_buyer')).canUseTools,true);
  assert.equal((await engine.status(guest,first.orderId)).claimRequired,false);
  assert.equal((await engine.claim('user_buyer',guest,{orderId:first.orderId})).state,'already-claimed');
  await assert.rejects(engine.claim('user_thief',guest,{orderId:first.orderId}),/ORDER_NOT_FOUND/);
  assert.equal((await query('SELECT * FROM resolute_payments_live.grants')).rows.length,1);
 });
 await t.test('refund after claim revokes rights and cannot be reversed by claim retry or delayed completion',async()=>{
  const order=await store.get(first.orderId);
  await store.adverse(order.paypal_id,'revoked','PAYMENT.CAPTURE.REFUNDED','REFUND1');
  await assert.rejects(engine.claim('user_buyer',guest,{orderId:first.orderId}),/PAYMENT_REVIEW_REQUIRED/);
  assert.equal(await store.paid(order,{captureId:order.capture_id,paidAt:order.paid_at}),'review-required');
  assert.equal((await access('user_buyer')).canUseTools,false);
 });
 await t.test('refund or dispute before claim never creates an active grant',async()=>{
  charge=true;clock=now;
  for(const state of ['revoked','suspended']) {
   const g=guestIdentity(randomBytes(32).toString('hex')),o=await engine.create(g,body());
   await engine.capture(g,{orderId:o.orderId});
   const raw=await store.get(o.orderId);await store.adverse(raw.paypal_id,state,'ADVERSE','EVENT'+state);
   await assert.rejects(engine.claim('user_next',g,{orderId:o.orderId}),/PAYMENT_REVIEW_REQUIRED/);
   assert.equal((await access('user_next')).canUseTools,false);
  }
 });
 await t.test('another paid guest order cannot duplicate an existing initial account entitlement',async()=>{
  const orders=[];
  for(let i=0;i<2;i++) {
   const g=guestIdentity(randomBytes(32).toString('hex')),o=await engine.create(g,body());
   await engine.capture(g,{orderId:o.orderId});orders.push({g,o});
  }
  await engine.claim('user_single',orders[0].g,{orderId:orders[0].o.orderId});
  await assert.rejects(engine.claim('user_single',orders[1].g,{orderId:orders[1].o.orderId}),/ALREADY_PURCHASED/);
  assert.equal((await store.get(orders[1].o.orderId)).user_id,orders[1].g);
 });
 await t.test('guest HTTP namespace cannot read account access or audit; claim still needs account auth',async()=>{
  const handler=paymentHttp({engine,store,enabled:true,environment:'live',allowedUsers:null,
   authenticate:async()=>null,authenticateGuest:h=>authenticateGuest(h,{serviceToken:secret}),guestEnabled:()=>true});
  const headers={'x-resolute-service-token':secret,'x-resolute-guest-token':token};
  for(const path of ['guest/access','guest/audit','guest/claim']) {
   const result=await handler(new Request('https://api.test/internal/v1/live-payments/'+path,{headers}));assert.equal(result.status,404);
  }
  const result=await handler(new Request('https://api.test/internal/v1/live-payments/claim',{method:'POST',headers,body:JSON.stringify({orderId:first.orderId})}));
  assert.equal(result.status,401);
  const denied=await handler(new Request('https://api.test/internal/v1/live-payments/guest/orders/'+first.orderId,{headers:{'x-resolute-guest-token':token}}));
  assert.equal(denied.status,401);
 });
});
