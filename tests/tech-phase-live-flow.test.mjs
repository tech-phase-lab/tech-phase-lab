import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {billingStore} from '../services/tech-phase-billing/store.mjs';
import {checkoutService} from '../services/tech-phase-billing/checkout.mjs';
import {reconciliationService,monthlyBoundary} from '../services/tech-phase-billing/settlement.mjs';
import {webhookService} from '../services/tech-phase-billing/webhook.mjs';
import {liveBackend,liveGateway} from '../services/tech-phase-billing/live-transport.mjs';
import {liveMember,liveHandler} from '../services/tech-phase-billing/live-http.mjs';
import {liveMembership} from '../services/tech-phase-billing/live-membership.mjs';
import {liveConfig,createPaypal,approvalUrl,RETURN_URL} from '../services/tech-phase-billing/paypal.mjs';
import {liveDatabaseConfig} from '../services/tech-phase-billing/database-config.mjs';
const origin='https://billing.tech-phase-fixture.com';
const environment=()=>({VERCEL_ENV:'production',TECH_PHASE_PAYPAL_ENV:'live',TECH_PHASE_BILLING_LIVE_ENABLED:'true',TECH_PHASE_BILLING_LIVE_ENTITLEMENTS_ENABLED:'true',TECH_PHASE_BILLING_LIVE_SALES_ENABLED:'true',TECH_PHASE_BILLING_LIVE_WEBHOOK_ENABLED:'true',TECH_PHASE_BILLING_LIVE_ORIGIN:origin,TECH_PHASE_BILLING_LIVE_SERVICE_URL:'https://fixture.up.railway.app',TECH_PHASE_BILLING_LIVE_SERVICE_TOKEN:'fixture_'.repeat(8),TECH_PHASE_BILLING_RUNTIME:'railway-live',TECH_PHASE_BILLING_LIVE_BRANCH:'codex/research-preview',RAILWAY_GIT_BRANCH:'codex/research-preview',TECH_PHASE_PAYPAL_LIVE_CLIENT_ID:'fixture',TECH_PHASE_PAYPAL_LIVE_CLIENT_SECRET:'fixture',TECH_PHASE_PAYPAL_LIVE_WEBHOOK_ID:'fixture',TECH_PHASE_PAYPAL_LIVE_PLAN_JPY:'P-'+'J'.repeat(24),TECH_PHASE_PAYPAL_LIVE_PLAN_USD:'P-'+'U'.repeat(24)});
test('Live checkout isolates two members through duplicate webhooks and refund', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE ROLE tech_phase_billing_live_writer');
    const migration=readFileSync(new URL('../db/tech-phase/005_billing_live.sql',import.meta.url),'utf8');
    await db.exec(migration);await db.exec(migration);
    const store=billingStore({query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})},'live');
    const owner = 'user_owner', member = 'user_Member2';
    const env=environment();
    const plans = {JPY: 'P-' + 'J'.repeat(24), USD: 'P-' + 'U'.repeat(24)};
    const contracts = new Map();
    let identity = owner, validSignature = true, creations = 0;
    const paypal = {
      async create({id, currency}) {
        creations++;
        const providerId = currency === 'JPY' ? 'I-JPYAAAAAAAAA' : 'I-USDAAAAAAAAA';
        const start = new Date(Date.now() - 1000).toISOString();
        const amount = {currency_code: currency, value: currency === 'JPY' ? '2980' : '20.00'};
        contracts.set(providerId, {id: providerId, custom_id: id, plan_id: plans[currency], status: 'ACTIVE', start_time: start,
          billing_info: {last_payment: {amount, time: start}, outstanding_balance: {currency_code: currency, value: '0'},
            failed_payments_count: 0, next_billing_time: monthlyBoundary(start, 1),
            cycle_executions: [{tenure_type: 'REGULAR', sequence: 1, cycles_completed: 1}]}});
        return {id: providerId, approvalUrl: 'https://www.paypal.com/webapps/billing/subscriptions?ba_token=BA-ABCDEFGHIJKL'};
      },
      async get(id) { assert.ok(contracts.has(id)); return contracts.get(id); },
      async transactions(id) {
        const row = contracts.get(id);
        return {transactions: [{id: 'TX-' + row.billing_info.last_payment.amount.currency_code, status: 'COMPLETED',
          time: row.start_time, amount_with_breakdown: {gross_amount: row.billing_info.last_payment.amount}}]};
      },
      async verify() { return validSignature; },
    };
    const reconciliation = reconciliationService({store, paypal, plans});
    const services = {store, reconciliation, checkout: checkoutService({store, paypal, termsVersion: 'pro-live-v1'}),
      webhook: webhookService({store, paypal, reconciliation, ownerId: owner, allowedUser: liveMember})};
    const backend = liveBackend({env, ownerId: owner, services: async () => services});
    const gateway = liveGateway({env, ownerId: owner, identity: async () => identity,
      fetcher: (url, options) => backend(new Request(url, options))});
    async function call(action, body, expected = 200) {
      const response = await gateway(new Request(origin + '/api/' + action, {
        method: body ? 'POST' : 'GET', headers: {origin, 'content-type': 'application/json', 'x-tech-phase-user': owner},
        ...(body ? {body: JSON.stringify(body)} : {}),
      }), action);
      assert.equal(response.status, expected, action);
      return response.json();
    }
    async function notify(event, expected = 200) {
      const response = await backend(new Request('https://fixture.up.railway.app/webhooks/paypal/live', {
        method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(event),
      }));
      assert.equal(response.status, expected);
      return response.json();
    }
    const first = await call('create', {currency: 'JPY', acceptedTerms: 'pro-live-v1'});
    identity = member;
    const second = await call('create', {currency: 'USD', acceptedTerms: 'pro-live-v1'});
    assert.notEqual(first.id, second.id);
    assert.equal((await call('status')).plan, 'free', 'provider ACTIVE alone must not grant access');
    await call('reconcile', {id: first.id}, 404);
    await call('cancel', {id: first.id}, 404);
    for (const id of contracts.keys()) {
      const event = {id: 'WH-' + id, event_type: 'PAYMENT.SALE.COMPLETED', resource: {billing_agreement_id: id, user_id: 'user_Forged'}};
      assert.equal((await notify(event)).status, 'verified');
      assert.equal((await notify(event)).status, 'verified');
    }
    assert.equal((await call('status')).subscription.id, second.id);
    assert.equal((await call('status')).plan, 'pro');
    identity = owner;
    const before = await call('status');
    assert.equal(before.subscription.id, first.id);
    assert.equal(before.plan, 'pro');
    const refund = {id: 'WH-USD-REFUND', event_type: 'PAYMENT.SALE.REFUNDED', resource: {sale_id: 'TX-USD'}};
    validSignature = false;
    await notify(refund, 401);
    identity = member;
    assert.equal((await call('status')).plan, 'pro');
    validSignature = true;
    for (let n = 0; n < 2; n++) assert.equal((await notify(refund)).status, 'review-required');
    const held = await call('status');
    assert.equal(held.plan, 'free');
    assert.equal(held.reviewRequired, true);
    await notify({id: 'WH-USD-LATE', event_type: 'PAYMENT.SALE.COMPLETED', resource: {billing_agreement_id: 'I-USDAAAAAAAAA'}});
    assert.deepEqual(await call('status'), held, 'late completion must not undo a refund');
    identity = owner;
    assert.deepEqual(await call('status'), before, 'other member refund must not change owner access');
    identity = 'user_NotEnrolled';
    assert.equal((await call('status')).plan,'free');
    assert.equal(creations, 2);
    assert.equal((await liveMembership(env,member,(url,options)=>backend(new Request(url,options)))).plan,'free');
    assert.equal((await liveMembership(env,owner,(url,options)=>backend(new Request(url,options)))).plan,'pro');
    await db.exec('SET ROLE tech_phase_billing_live_writer');
    assert.equal((await store.entitlement(owner)).plan,'pro');
    await assert.rejects(db.exec('DELETE FROM tech_phase_billing_live.payments'),/permission denied/);
    await db.exec('RESET ROLE');
  }finally{await db.close();}
});
test('Live guards block wrong origin, identity, environment and disabled notifications without services',async()=>{
 const env=environment();let calls=0;const services=async()=>{calls++;throw Error();};
 const handler=liveHandler({env,identity:async()=>null,services});
 env.TECH_PHASE_BILLING_LIVE_WEBHOOK_ENABLED='false';
 assert.equal((await handler(new Request(origin,{method:'POST'}),'webhook')).status,503);
 assert.equal((await handler(new Request(origin),'status')).status,401);
 assert.equal((await handler(new Request(origin,{method:'POST',headers:{origin:'https://foreign.test'}}),'create')).status,403);
 env.TECH_PHASE_BILLING_LIVE_SALES_ENABLED='false';
 const gateway=liveGateway({env,identity:async()=> 'user_First',fetcher:services});
 assert.equal((await gateway(new Request(origin,{method:'POST',headers:{origin}}),'create')).status,503);
 env.RAILWAY_GIT_BRANCH='wrong';assert.equal((await liveBackend({env,services})(new Request(origin+'/live/status'))).status,503);
 assert.equal(calls,0);
});
test('Live entitlement rejects stale/malformed access and never falls back to metadata',async()=>{
 const env=environment();let calls=0;const bad=async()=>{calls++;throw Error('secret');};
 assert.equal(await liveMembership({...env,VERCEL_ENV:'preview'},'user_First',bad),null);
 assert.equal(await liveMembership({...env,TECH_PHASE_BILLING_LIVE_ENTITLEMENTS_ENABLED:'false'},'user_First',bad),null);
 assert.equal(calls,0);await assert.rejects(liveMembership(env,'user_First',bad),/^Error: BILLING_ENTITLEMENT_UNAVAILABLE$/);
 for(const result of [{environment:'sandbox',plan:'pro',proExpiresAt:'2099-01-01'},{environment:'live',plan:'pro',proExpiresAt:null},{environment:'live',plan:'free',proExpiresAt:'2099-01-01'}])await assert.rejects(liveMembership(env,'user_First',async()=>Response.json(result)),/BILLING_ENTITLEMENT_UNAVAILABLE/);
 assert.deepEqual(await liveMembership(env,'user_First',async()=>Response.json({environment:'live',plan:'pro',proExpiresAt:'2020-01-01'})),{plan:'free',accessExpiresAt:0});
});
test('Live PayPal and DB config reject mixed environments before network access',()=>{
 const config=liveConfig(environment());
 for(const change of [{base:'https://api-m.sandbox.paypal.com'},{environment:'sandbox'},{environment:'__proto__'},{returnUrl:RETURN_URL}])assert.throws(()=>createPaypal({...config,...change},()=>assert.fail('network')));
 for(const key of ['CLIENT_ID','CLIENT_SECRET','WEBHOOK_ID','PLAN_JPY','PLAN_USD']){const env=environment();delete env['TECH_PHASE_PAYPAL_LIVE_'+key];assert.throws(()=>liveConfig(env));}
 const remote={id:'I-ABCDEFGHIJKL',links:[{rel:'approve',href:'https://www.paypal.com/webapps/billing/subscriptions?ba_token=BA-ABCDEFGHIJKL'}]};
 assert.throws(()=>approvalUrl(remote));assert.equal(approvalUrl(remote,'live'),remote.links[0].href);
 assert.throws(()=>liveDatabaseConfig(environment()));
 const env={...environment(),TECH_PHASE_BILLING_LIVE_DATABASE_URL:'postgres://tech_phase_billing_live_writer:fixture@postgres.railway.internal/tech_phase_billing_live'};
 assert.deepEqual(liveDatabaseConfig(env).ssl,{rejectUnauthorized:true});
 assert.throws(()=>liveDatabaseConfig({...env,TECH_PHASE_BILLING_LIVE_DATABASE_URL:env.TECH_PHASE_BILLING_LIVE_DATABASE_URL.replaceAll('_live','_sandbox')}));
});
test('Live provider uses dedicated endpoint and immutable credentials for creation and signature verification',async()=>{
 const env=environment(),config=liveConfig(env),calls=[],id='00000000-0000-4000-8000-000000000001';
 const paypal=createPaypal(config,async(url,options)=>{
  calls.push({url,options});assert.equal(new URL(url).origin,'https://api-m.paypal.com');
  if(url.endsWith('/token'))return Response.json({access_token:'fixture',expires_in:300});
  if(url.includes('/plans/'))return Response.json({id:config.plans.JPY,status:'ACTIVE',billing_cycles:[{tenure_type:'REGULAR',sequence:1,total_cycles:0,frequency:{interval_unit:'MONTH',interval_count:1},pricing_scheme:{fixed_price:{currency_code:'JPY',value:'2980'}}}],payment_preferences:{auto_bill_outstanding:false}});
  if(url.includes('verify-webhook'))return Response.json({verification_status:'SUCCESS'});
  return Response.json({id:'I-ABCDEFGHIJKL',custom_id:id,plan_id:config.plans.JPY,links:[{rel:'approve',href:'https://www.paypal.com/webapps/billing/subscriptions?ba_token=BA-ABCDEFGHIJKL'}]});
 });
 await paypal.create({id,currency:'JPY'});
 assert.equal(JSON.parse(calls.at(-1).options.body).application_context.return_url,origin+'/research/account/billing?billing='+id);
 const headers=new Headers({'paypal-transmission-id':'fixture','paypal-transmission-time':'2026-10-24T00:00:00Z','paypal-auth-algo':'SHA256withRSA','paypal-transmission-sig':'fixture','paypal-cert-url':'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-test'});
 const n=calls.length;assert.equal(await paypal.verify(headers,{}),false);assert.equal(calls.length,n);
 headers.set('paypal-cert-url','https://api.paypal.com/v1/notifications/certs/CERT-test');assert.equal(await paypal.verify(headers,{}),true);
 assert.equal(JSON.parse(calls.at(-1).options.body).webhook_id,config.webhookId);
});
test('failed rollback discards the billing client and preserves the original error',async()=>{
 for(const rollbackFails of [false,true]){
  const original=Error('fixture write failure');const released=[];
  const pool={async connect(){return {async query(sql){if(sql==='BEGIN')return {};if(sql==='ROLLBACK'){if(rollbackFails)throw Error('rollback failure');return {};}throw original;},release(error){released.push(error);}};}};
  await assert.rejects(billingStore(pool).reserve('user_First','JPY','sandbox-v1'),error=>error===original);
  assert.equal(released.length,1);
  assert.equal(released[0]?.message,rollbackFails?'BILLING_TRANSACTION_FAILED':undefined);
 }
});
