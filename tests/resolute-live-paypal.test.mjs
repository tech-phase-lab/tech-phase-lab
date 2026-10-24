import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {livePaypalConfig, paypalConfig, createPaypal, approvalUrl} from '../services/resolute-api/payments/paypal.mjs';
import {livePaymentConfiguration} from '../services/resolute-api/payments/live-services.mjs';
import {paymentEngine} from '../services/resolute-api/payments/engine.mjs';
import {paymentStore} from '../services/resolute-api/payments/store.mjs';
const env=()=>({RESOLUTE_PAYPAL_LIVE_ENABLED:'true',RESOLUTE_PAYPAL_LIVE_CLIENT_ID:'live-id',
 RESOLUTE_PAYPAL_LIVE_CLIENT_SECRET:'live-secret',RESOLUTE_PAYPAL_LIVE_MERCHANT_ID:'MERCHANT1234',
 RESOLUTE_PAYPAL_LIVE_WEBHOOK_ID:'WH-live',RESOLUTE_LIVE_SITE_ORIGIN:'https://shop.example.org',
 RESOLUTE_PAYMENT_LIVE_DB_URL:'postgresql://resolute_payment_live_writer:fixture@postgres.railway.internal/resolute',
 RESOLUTE_ENTITLEMENT_SOURCE:'live',RESOLUTE_PAYMENT_CLERK_SECRET_KEY:'fixture'});

test('live preparation refuses absent gates, missing dedicated credentials and mixed DB credentials',()=>{
 assert.throws(()=>livePaypalConfig({}));
 for(const key of Object.keys(env())) {
  const e=env();delete e[key];assert.throws(()=>livePaymentConfiguration(e),key);
 }
 assert.throws(()=>paypalConfig({...env(),RESOLUTE_PAYPAL_ENV:'live'}));
 for(const role of ['postgres','resolute_api_reader','resolute_payment_sandbox_writer']) {
  const e=env();e.RESOLUTE_PAYMENT_LIVE_DB_URL=e.RESOLUTE_PAYMENT_LIVE_DB_URL.replace('resolute_payment_live_writer',role);
  assert.throws(()=>livePaymentConfiguration(e));
 }
 const legacy=env();legacy.RESOLUTE_ENTITLEMENT_SOURCE='legacy';assert.throws(()=>livePaymentConfiguration(legacy));
 for(const origin of ['http://shop.example.org','https://user:secret@shop.example.org','https://shop.example.org/a',
  'https://shop.example.org?redirect=x','https://shop.example.org#x','https://localhost','https://127.0.0.1',
  'https://preview.vercel.app','https://db.internal','https://shop.example.org:1234']) {
  assert.throws(()=>livePaypalConfig({...env(),RESOLUTE_LIVE_SITE_ORIGIN:origin}),origin);
 }
 const config=livePaymentConfiguration(env());assert.equal(config.paypal.base,'https://api-m.paypal.com');
 assert.equal(config.paypal.returnUrl,'https://shop.example.org/resolute/checkout');
 assert.throws(()=>createPaypal({...config.paypal,base:'https://evil.test'}));
});

test('live PayPal uses only live approval/cert hosts and server callback; Sandbox certs never reach the network',async()=>{
 const config=livePaypalConfig(env()),calls=[];
 const api=createPaypal(config,async(url,options)=>{
  calls.push({url,options});assert.equal(options.redirect,'error');
  assert.ok(url.startsWith('https://api-m.paypal.com/'));
  return Response.json(url.endsWith('/token')?{access_token:'test-token',expires_in:300}:{verification_status:'SUCCESS'});
 });
 const headers=new Headers({'paypal-transmission-id':'t','paypal-transmission-time':'2026-10-19T00:00:00Z',
  'paypal-auth-algo':'SHA256withRSA','paypal-transmission-sig':'sig'});
 for(const host of ['api.sandbox.paypal.com','api-m.sandbox.paypal.com','api.paypal.com.evil.test']) {
  headers.set('paypal-cert-url',`https://${host}/v1/notifications/certs/test`);
  assert.equal(await api.verify(headers,{id:'test'}),false);
 }
 assert.equal(calls.length,0);
 headers.set('paypal-cert-url','https://api.paypal.com/v1/notifications/certs/test');
 assert.equal(await api.verify(headers,{id:'test'}),true);
 assert.equal(JSON.parse(calls[1].options.body).webhook_id,'WH-live');
 await api.create({id:'local-order',quote:{currency:'JPY',value:'7980',language:'ja',kind:'initial',sku:'resolute_v1:initial'}});
 const context=JSON.parse(calls.at(-1).options.body).payment_source.paypal.experience_context;
 assert.equal(context.return_url,'https://shop.example.org/resolute/checkout?order=local-order&lang=ja');
 const id='PAYPAL123456',remote=href=>({id,links:[{rel:'approve',href}]});
 assert.equal(approvalUrl(remote(`https://www.paypal.com/checkoutnow?token=${id}`),id,'live'),`https://www.paypal.com/checkoutnow?token=${id}`);
 for(const href of [`https://www.sandbox.paypal.com/checkoutnow?token=${id}`,`https://www.paypal.com/checkoutnow?token=${id}&extra=1`])
  assert.throws(()=>approvalUrl(remote(href),id,'live'));
});

test('closed sales prevent order and capture calls but verified refunds remain processable on the live ledger',async()=>{
 const bootstrap=new PGlite();await bootstrap.exec('CREATE DATABASE resolute');
 const data=await bootstrap.dumpDataDir();await bootstrap.close();
 const db=new PGlite({database:'resolute',loadDataDir:data});
 try {
  await db.exec(readFileSync(new URL('../db/resolute/014_payments_live.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../db/resolute/010_payments_sandbox.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../db/resolute/015_payments_live_role.sql',import.meta.url),'utf8'));
  const role=(await db.query("SELECT rolcanlogin,rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='resolute_payment_live_writer'")).rows[0];
  assert.deepEqual(role,{rolcanlogin:false,rolsuper:false,rolcreatedb:false,rolcreaterole:false});
  await db.exec(`INSERT INTO resolute_payments_live.orders
    (id,user_id,request_key,capture_key,quote,paypal_id,capture_id,state,created_at,expires_at,paid_at)
    VALUES ('00000000-0000-4000-8000-000000000001','user_test','00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003','{"product":"resolute_v1","kind":"initial","currency":"JPY","minor":7980}',
    'PAYPAL123456','CAPTURE12345','paid','2026-10-19Z','2026-10-20Z','2026-10-19Z');
    INSERT INTO resolute_payments_live.grants VALUES
    ('00000000-0000-4000-8000-000000000001','user_test','initial','2026-10-19Z','2027-10-19Z','active');
    INSERT INTO resolute_payments_live.audit(order_id,code) VALUES ('00000000-0000-4000-8000-000000000001','LIVE_ACCESS_GRANTED');
    SET ROLE resolute_payment_live_writer`);
  const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(sql,args);
  const store=paymentStore({query,connect:async()=>({query,release(){}})},{environment:'live'});
  let captureCalls=0,createCalls=0;
  const paypal={verify:async()=>true,create:async()=>{createCalls++;},capture:async()=>{captureCalls++;},
    captureDetails:async id=>({id,status:'REFUNDED',amount:{currency_code:'JPY',value:'7980'},supplementary_data:{related_ids:{order_id:'PAYPAL123456'}}})};
  const engine=paymentEngine({store,paypal,environment:'live',merchantId:'MERCHANT1234',getUser:async()=>{throw Error('not needed');},canCharge:()=>false});
  await assert.rejects(engine.create('user_test',{}),/PAYMENT_DISABLED/);
  await assert.rejects(engine.capture('user_test',{orderId:'00000000-0000-4000-8000-000000000001'}),/PAYMENT_DISABLED/);
  assert.equal(createCalls,0);assert.equal(captureCalls,0);
  const event={id:'REFUND-live',event_type:'PAYMENT.CAPTURE.REFUNDED',resource:{links:[{rel:'up',href:'https://api.paypal.com/v2/payments/captures/CAPTURE12345'}]}};
  const wrongHost=structuredClone(event);wrongHost.id='WRONG-HOST';wrongHost.resource.links[0].href=wrongHost.resource.links[0].href.replace('api.paypal.com','api.sandbox.paypal.com');
  await assert.rejects(engine.webhook(new Headers(),wrongHost),/INVALID_EVENT/);
  await engine.webhook(new Headers(),event);await engine.webhook(new Headers(),event);
  assert.equal((await store.get('00000000-0000-4000-8000-000000000001')).state,'revoked');
  assert.equal((await db.query('SELECT state FROM resolute_payments_live.grants')).rows[0].state,'revoked');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM resolute_payments_live.audit WHERE code='PAYMENT.CAPTURE.REFUNDED'")).rows[0].n,1);
  for(const sql of ['SELECT * FROM resolute_payments_sandbox.orders', 'DELETE FROM resolute_payments_live.orders','TRUNCATE resolute_payments_live.orders CASCADE',
   "UPDATE resolute_payments_live.audit SET code='FAKE'",'DELETE FROM resolute_payments_live.events',
   'UPDATE resolute_payments_live.alert_outbox SET delivered_at=now()',
   'CREATE TABLE resolute_payments_live.extra(id int)']) await assert.rejects(db.exec(sql),/permission denied/);

  let open=true, lookups=0, closedOnLookup=Infinity, captureCount=0;
  const paidIds=new Set();let nextOrder=0;
  const provider={create:async()=>({id:`LIVEORDER${++nextOrder}`}),
    approval:async id=>`https://www.paypal.com/checkoutnow?token=${id}`,
    capture:async order=>{captureCount++;paidIds.add(order.paypal_id);},
    get:async id=>{
      const o=await store.findPaypal(id),amount={currency_code:o.quote.currency,value:o.quote.value};
      return {id,intent:'CAPTURE',status:paidIds.has(id)?'COMPLETED':'APPROVED',purchase_units:[{
        reference_id:o.id,custom_id:o.id,invoice_id:o.id,payee:{merchant_id:'MERCHANT1234'},amount,
        items:[{sku:o.quote.sku,quantity:'1',unit_amount:amount}],
        payments:{captures:[{id:`LIVECAPTURE${id}`,status:'COMPLETED',final_capture:true,amount,create_time:'2026-10-19T12:00:00Z'}]}}]};
    }};
  const purchasing=paymentEngine({store,paypal:provider,environment:'live',merchantId:'MERCHANT1234',
    now:()=>Date.parse('2026-10-19T12:00:00Z'),canCharge:()=>open,getUser:async id=>{
      if(++lookups===closedOnLookup)open=false;
      return {id,primaryEmailAddressId:'email1',emailAddresses:[{id:'email1',verification:{status:'verified'}}],privateMetadata:{}};
    }});
  const purchase=await purchasing.create('user_liveBuyer',{kind:'initial',language:'en',requestKey:randomUUID()});
  assert.equal(purchase.sandbox,false);assert.equal(purchase.quote.currency,'USD');assert.equal(purchase.quote.value,'59.00');
  assert.equal((await purchasing.capture('user_liveBuyer',{orderId:purchase.orderId})).state,'paid');
  assert.equal((await purchasing.capture('user_liveBuyer',{orderId:purchase.orderId})).state,'already-paid');
  assert.equal(captureCount,1);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM resolute_payments_live.audit WHERE order_id=$1 AND code='LIVE_ACCESS_GRANTED'",[purchase.orderId])).rows[0].n,1);
  const stopped=await purchasing.create('user_liveStopped',{kind:'initial',language:'ja',requestKey:randomUUID()});
  closedOnLookup=lookups+2; // Close sales during the final authoritative member recheck.
  await assert.rejects(purchasing.capture('user_liveStopped',{orderId:stopped.orderId}),/PAYMENT_DISABLED/);
  assert.equal(captureCount,1);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM resolute_payments_live.grants WHERE order_id=$1',[stopped.orderId])).rows[0].n,0);
 } finally {await db.close();}
});
