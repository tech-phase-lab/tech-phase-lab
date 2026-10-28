import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { sandboxConfig, createPaypal, assertPlan, approvalUrl, RETURN_URL, offer } from '../services/tech-phase-billing/paypal.mjs';
import { billingStore } from '../services/tech-phase-billing/store.mjs';
import { checkoutService } from '../services/tech-phase-billing/checkout.mjs';
const id='00000000-0000-4000-8000-000000000001', sid='I-ABCDEFGHIJKL';
const env=()=>({TECH_PHASE_PAYPAL_ENV:'sandbox',TECH_PHASE_PAYPAL_CLIENT_ID:'fixture',TECH_PHASE_PAYPAL_CLIENT_SECRET:'fixture-secret',
 TECH_PHASE_PAYPAL_WEBHOOK_ID:'WH-fixture',TECH_PHASE_PAYPAL_PLAN_JPY:'P-'+'J'.repeat(24),TECH_PHASE_PAYPAL_PLAN_USD:'P-'+'U'.repeat(24)});
const plan=(currency='JPY')=>({id:sandboxConfig(env()).plans[currency],status:'ACTIVE',quantity_supported:false,
 billing_cycles:[{tenure_type:'REGULAR',sequence:1,total_cycles:0,frequency:{interval_unit:'MONTH',interval_count:1},
 pricing_scheme:{fixed_price:{currency_code:currency,value:offer(currency).value}}}],payment_preferences:{auto_bill_outstanding:false}});
const remote=(local=id)=>({id:sid,custom_id:local,plan_id:plan().id,status:'APPROVAL_PENDING',
 links:[{rel:'approve',href:'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-ABCDEFGHIJKL'}]});
const headers=()=>new Headers({'paypal-transmission-id':'test','paypal-transmission-time':'2026-10-20T00:00:00Z',
 'paypal-auth-algo':'SHA256withRSA','paypal-transmission-sig':'signature','paypal-cert-url':'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-test'});
function fixture(handler) {
 const calls=[];
 const api=createPaypal(sandboxConfig(env()),async(url,options)=>{
  calls.push({url,options});assert.ok(url.startsWith('https://api-m.sandbox.paypal.com/'));assert.equal(options.redirect,'error');
  if(url.endsWith('/token')) return Response.json({access_token:'fixture-token',expires_in:300});
  return handler(url,options);
 });
 return {api,calls};
}
test('Tech Phase Sandbox configuration never falls back to RESOLUTE or live credentials',()=>{
 for(const key of Object.keys(env())) { const e=env();delete e[key];assert.throws(()=>sandboxConfig(e),key); }
 assert.throws(()=>sandboxConfig({...env(),TECH_PHASE_PAYPAL_ENV:'live'}));
 assert.throws(()=>createPaypal({...sandboxConfig(env()),base:'https://api-m.paypal.com'}));
 assert.throws(()=>offer('__proto__'));assert.throws(()=>offer('EUR'));
});
test('both server prices require one infinite monthly fixed-price cycle with no extras',()=>{
 for(const currency of ['JPY','USD']) assert.equal(assertPlan(plan(currency),plan(currency).id,currency).minor,offer(currency).minor);
 for(const change of [p=>p.status='INACTIVE',p=>p.billing_cycles.push(p.billing_cycles[0]),p=>p.billing_cycles[0].frequency.interval_count=2,
  p=>p.billing_cycles[0].pricing_scheme.fixed_price.value='1',p=>p.billing_cycles[0].pricing_scheme.fixed_price.currency_code='USD',
  p=>p.payment_preferences.setup_fee={currency_code:'JPY',value:'1'},p=>p.quantity_supported=true,
  p=>p.payment_preferences.auto_bill_outstanding=true,p=>p.taxes={percentage:'10',inclusive:false}]) {
  const p=plan();change(p);assert.throws(()=>assertPlan(p,plan().id,'JPY'),/PLAN_MISMATCH/);
 }
});
test('create validates provider plan, uses durable request key and server-only return URLs',async()=>{
 const {api,calls}=fixture(async url=>Response.json(url.includes('/plans/')?plan():remote()));
 const result=await api.create({id,currency:'JPY',amount:'1',returnUrl:'https://evil.test'});
 assert.equal(result.id,sid);
 const req=calls.at(-1),body=JSON.parse(req.options.body);
 assert.equal(req.options.headers['PayPal-Request-Id'],id);assert.equal(body.plan_id,plan().id);assert.equal(body.custom_id,id);
 assert.equal(body.application_context.return_url,RETURN_URL+'?billing='+id);
 assert.deepEqual(body.plan.billing_cycles[0].pricing_scheme.fixed_price,{currency_code:'JPY',value:'2980'});
 assert.equal(body.application_context.user_action,'SUBSCRIBE_NOW');assert.equal(body.subscriber,undefined);
 assert.equal(calls.filter(c=>c.url.endsWith('/token')).length,1);
});
test('mismatched prices prevent subscription creation',async()=>{
 const {api,calls}=fixture(()=>Response.json({...plan(),billing_cycles:[]}));
 await assert.rejects(api.create({id,currency:'JPY'}),/PLAN_MISMATCH/);
 assert.equal(calls.some(c=>c.url.endsWith('/subscriptions')),false);
});
test('approval rejects non-PayPal, live, credentials, duplicate token and redirect parameters',()=>{
 assert.match(approvalUrl(remote()),/^https:\/\/www.sandbox.paypal.com/);
 for(const href of ['https://evil.test/',remote().links[0].href.replace('sandbox.',''),remote().links[0].href+'&return=https://evil.test',
 remote().links[0].href+'&ba_token=BA-OTHER123456',remote().links[0].href.replace('https://','https://user@')]) {
  const r=remote();r.links[0].href=href;assert.throws(()=>approvalUrl(r));
 }
});
test('cancellation handles empty 204 and input cannot inject a provider path',async()=>{
 const {api,calls}=fixture(()=>new Response(null,{status:204}));
 assert.equal(await api.cancel(sid),null);assert.match(calls.at(-1).url,/\/cancel$/);
 assert.throws(()=>api.get('../plans/P-test'));assert.throws(()=>api.cancel('I-test?x=1'));
});
test('webhook verification accepts only provider SUCCESS; hostile certificate never reaches network',async()=>{
 let result='FAILURE';const {api,calls}=fixture(()=>Response.json({verification_status:result}));
 const h=headers();h.set('paypal-cert-url','https://evil.test/cert');assert.equal(await api.verify(h,{id:'EV-1'}),false);assert.equal(calls.length,0);
 assert.equal(await api.verify(headers(),{id:'EV-1'}),false);result='SUCCESS';assert.equal(await api.verify(headers(),{id:'EV-1'}),true);
 assert.equal(JSON.parse(calls.at(-1).options.body).webhook_id,'WH-fixture');
});
test('provider failures do not reveal credentials or response data; token is refreshed after 401',async()=>{
 let fail=true;const {api,calls}=fixture(()=>fail?Response.json({secret:'private-buyer-data'},{status:401}):Response.json(remote()));
 await assert.rejects(api.get(sid),e=>e.message==='PAYPAL_UNAVAILABLE');fail=false;await api.get(sid);
 assert.equal(calls.filter(c=>c.url.endsWith('/token')).length,2);
});
test('parallel reads share token retrieval and bounded transaction range',async()=>{
 const {api,calls}=fixture(()=>Response.json({transactions:[]}));
 await Promise.all([api.get(sid),api.get(sid)]);assert.equal(calls.filter(c=>c.url.endsWith('/token')).length,1);
 await assert.rejects(api.transactions(sid,'invalid','2026-10-20'),/INVALID_PERIOD/);
 await assert.rejects(api.transactions(sid,'2026-01-01','2026-10-20'),/INVALID_PERIOD/);
 await api.transactions(sid,'2026-10-01','2026-10-20');assert.match(calls.at(-1).url,/start_time=/);
});
async function database(work) {
 const db=new PGlite();
 try {
  await db.exec(readFileSync(new URL('../db/tech-phase/001_billing_sandbox.sql',import.meta.url),'utf8'));
  const pool={query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
  await work(billingStore(pool),db);
 } finally {await db.close();}
}
test('durable checkout resumes after response loss; another member cannot cancel it',async()=>database(async(store,db)=>{
 let creates=0,cancels=0,providerStatus='ACTIVE',local;
 const paypal={create:async({id})=>{creates++;local=id;return {id:sid,approvalUrl:remote().links[0].href};},
  get:async()=>({...remote(local),status:providerStatus}),cancel:async()=>{cancels++;providerStatus='CANCELLED';throw Error('response lost');}};
 const svc=checkoutService({store,paypal,termsVersion:'sandbox-v1'});
 await assert.rejects(svc.start('user_a','JPY','old'),/TERMS_REQUIRED/);
 const first=await svc.start('user_a','JPY','sandbox-v1');await svc.start('user_a','JPY','sandbox-v1');assert.equal(creates,1);
 await assert.rejects(svc.cancel('user_b',first.id),/NOT_FOUND/);assert.equal(cancels,0);
 await assert.rejects(svc.cancel('user_a',first.id),/response lost/);
 assert.equal((await svc.cancel('user_a',first.id)).status,'cancelled');assert.equal(cancels,1);
 assert.equal((await db.query('SELECT state FROM tech_phase_billing_sandbox.subscriptions')).rows[0].state,'cancelled');
}));
test('JPY and USD cancellation recover a local save failure without repeating provider cancellation',()=>database(async(store,db)=>{
 for(const currency of ['JPY','USD'])for(const initialState of ['ACTIVE','SUSPENDED']) {
  const user=`user_${currency}_${initialState}`;
  const row=await store.reserve(user,currency,'sandbox-v1');
  const providerId=`I-${currency}${initialState}`;
  await store.attach(user,row.id,providerId);await store.providerState(user,row.id,initialState);
  const transactionId=`TX-${currency}-${initialState}`;
  await store.recordPayment({eventId:`WH-${transactionId}`,eventType:'PAYMENT.SALE.COMPLETED',id:row.id,transactionId,currency,minor:offer(currency).minor,paidAt:'2026-10-20T00:00:00Z'});
  let providerState=initialState,cancelCalls=0,fail=true;
  const paypal={get:async()=>({id:providerId,custom_id:row.id,status:providerState}),cancel:async()=>{cancelCalls++;providerState='CANCELLED';}};
  const svc=checkoutService({store:{...store,cancelled:async(...args)=>{
   if(fail){fail=false;throw Error('LOCAL_SAVE_FAILED');}
   return store.cancelled(...args);
  }},paypal,termsVersion:'sandbox-v1'});
  await assert.rejects(svc.cancel(user,row.id),/LOCAL_SAVE_FAILED/);
  assert.equal((await store.get(user,row.id)).state,initialState.toLowerCase());
  for(let retry=0;retry<2;retry++)assert.deepEqual(await svc.cancel(user,row.id),{status:'cancelled'});
  assert.equal(cancelCalls,1);assert.equal((await store.get(user,row.id)).state,'cancelled');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM tech_phase_billing_sandbox.payments WHERE subscription_id=$1',[row.id])).rows[0].n,1);
 }
}));
test('JPY and USD checkout reuse the durable key after provider response loss or local attach failure',async()=>database(async(store,db)=>{
 for(const currency of ['JPY','USD']) for(const failure of ['provider-response','local-attach']) {
  const user=`user_${currency}_${failure}`,requests=[],providerRows=new Map();
  let fail=true,attachCalls=0;
  const wrapped={...store,attach:async(...args)=>{
   attachCalls++;
   if(failure==='local-attach'&&fail){fail=false;throw Error('database unavailable');}
   return store.attach(...args);
  }};
  const paypal={create:async request=>{
   requests.push(request);
   if(!providerRows.has(request.id))providerRows.set(request.id,{
    id:`I-${currency}${failure==='local-attach'?'ATTACH':'REMOTE'}`,
    approvalUrl:remote().links[0].href,
   });
   if(failure==='provider-response'&&fail){fail=false;throw Error('response lost');}
   return providerRows.get(request.id);
  }};
  const svc=checkoutService({store:wrapped,paypal,termsVersion:'sandbox-v1'});
  await assert.rejects(svc.start(user,currency,'sandbox-v1'),/response lost|database unavailable/);
  const pending=(await db.query('SELECT * FROM tech_phase_billing_sandbox.subscriptions WHERE user_id=$1',[user])).rows;
  assert.equal(pending.length,1);assert.equal(pending[0].paypal_id,null);
  assert.equal(pending[0].state,'creating');
  const resumed=await svc.start(user,currency,'sandbox-v1');
  assert.equal(resumed.id,pending[0].id);
  assert.deepEqual(requests,[{id:resumed.id,currency},{id:resumed.id,currency}]);
  assert.equal(providerRows.size,1);assert.equal(attachCalls,failure==='local-attach'?2:1);
  const saved=(await db.query('SELECT * FROM tech_phase_billing_sandbox.subscriptions WHERE user_id=$1',[user])).rows;
  assert.equal(saved.length,1);assert.equal(saved[0].paypal_id,providerRows.get(resumed.id).id);
 }
 assert.equal((await db.query('SELECT count(*)::int AS n FROM tech_phase_billing_sandbox.payments')).rows[0].n,0);
}));
test('ledger deduplicates renewals and rolls back conflicts, cancellation retains payments',async()=>database(async(store,db)=>{
 const row=await store.reserve('user_a','USD','sandbox-v1');
 assert.equal((await store.reserve('user_a','USD','sandbox-v1')).id,row.id);
 await assert.rejects(store.reserve('user_a','JPY','sandbox-v1'),/EXISTING_SUBSCRIPTION/);
 await store.attach('user_a',row.id,sid);
 const payment={eventId:'WH-1',eventType:'PAYMENT.SALE.COMPLETED',id:row.id,transactionId:'TX-1',currency:'USD',minor:2000,paidAt:'2026-10-20T00:00:00Z'};
 assert.equal(await store.recordPayment(payment),true);assert.equal(await store.recordPayment(payment),false);
 assert.equal(await store.recordPayment({...payment,eventId:'WH-2'}),false);
 await assert.rejects(store.recordPayment({...payment,transactionId:'TX-forged'}),/EVENT_CONFLICT/);
 await assert.rejects(store.recordPayment({...payment,paidAt:'2026-10-21T00:00:00Z'}),/PAYMENT_CONFLICT/);
 await assert.rejects(store.recordPayment({...payment,eventId:'WH-bad',minor:1}),/MISMATCH/);
 await assert.rejects(store.recordPayment({...payment,eventId:'WH-conflict',paidAt:'2026-10-21T00:00:00Z'}),/CONFLICT/);
 await store.cancelled('user_a',row.id);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM tech_phase_billing_sandbox.payments')).rows[0].n,1);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM tech_phase_billing_sandbox.events')).rows[0].n,2);
}));
test('uncertain creation older than provider idempotency window requires reconciliation',async()=>database(async(store,db)=>{
 const row=await store.reserve('user_a','JPY','sandbox-v1');
 await db.query("UPDATE tech_phase_billing_sandbox.subscriptions SET created_at='2020-01-01Z' WHERE id=$1",[row.id]);
 const svc=checkoutService({store,paypal:{create(){throw Error('must not create');}},termsVersion:'sandbox-v1'});
 await assert.rejects(svc.start('user_a','JPY','sandbox-v1'),/RECONCILIATION_REQUIRED/);
}));

import { sandboxDatabaseConfig } from '../services/tech-phase-billing/database-config.mjs';
test('billing DB configuration requires a dedicated Sandbox database and writer',()=>{
 const key='TECH_PHASE_BILLING_SANDBOX_DATABASE_URL';
 const config={TECH_PHASE_PAYPAL_ENV:'sandbox',[key]:'postgresql://tech_phase_billing_sandbox_writer:fixture@db.example.org/tech_phase_billing_sandbox'};
 assert.deepEqual(sandboxDatabaseConfig(config).ssl,{rejectUnauthorized:true});
 for(const bad of [config[key].replace('/tech_phase_billing_sandbox','/resolute'),config[key].replace('sandbox_writer','live_writer'),
  config[key]+'?sslmode=disable',config[key]+'?options=unsafe',config[key]+'#fragment']) {
  assert.throws(()=>sandboxDatabaseConfig({...config,[key]:bad}));
 }
 assert.throws(()=>sandboxDatabaseConfig({DATABASE_URL:config[key]}));
 assert.throws(()=>sandboxDatabaseConfig({...config,TECH_PHASE_PAYPAL_ENV:'live'}));
});
