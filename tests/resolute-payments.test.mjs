import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {identity,quote,verifyOrder,LAUNCH_END,addYear,minorUnits} from '../services/resolute-api/payments/policy.mjs';
import {paypalConfig,createPaypal,approvalUrl,SANDBOX_RETURN} from '../services/resolute-api/payments/paypal.mjs';
import {paymentEngine} from '../services/resolute-api/payments/engine.mjs';
import {paymentStore} from '../services/resolute-api/payments/store.mjs';
import {paymentHttp} from '../services/resolute-api/payments/http.mjs';
const now=Date.parse('2026-10-15T06:00:00Z');
const user=(meta={})=>({id:'user_test',primaryEmailAddressId:'email_1',emailAddresses:[{id:'email_1',verification:{status:'verified'}}],privateMetadata:meta});
const pro=()=>user({plan:'pro',proExpiresAt:'2028-01-01T00:00:00Z'});
const merchant='MERCHANT1234';
function remote(order,status='COMPLETED') {
 const amount={currency_code:order.quote.currency,value:order.quote.value};
 return {id:order.paypal_id,intent:'CAPTURE',status,purchase_units:[{reference_id:order.id,custom_id:order.id,invoice_id:order.id,
  payee:{merchant_id:merchant},amount,items:[{sku:order.quote.sku,quantity:'1',unit_amount:amount}],
  payments:{captures:[{id:'CAPTURE12345',status:'COMPLETED',final_capture:true,amount,create_time:new Date(now+1000).toISOString()}]}}]};
}
const sample=()=>({id:randomUUID(),paypal_id:'PAYPAL123456',quote:quote('initial','ja',identity(user(),now),{use:false},now),
 capture_checked_at:new Date(now).toISOString(),expires_at:new Date(now+900000).toISOString()});
test('server pricing covers every currency/price and the exact worldwide JST deadline',()=>{
 const member=identity(user(),now),p=identity(pro(),now);
 for(const [lang,launch,normal,free,discount] of [['ja',7980,9800,5980,3980],['en',5900,6900,3900,2900]]) {
  assert.equal(quote('initial',lang,member,{use:false},LAUNCH_END-1).minor,launch);
  assert.equal(quote('initial',lang,member,{use:false},LAUNCH_END).minor,normal);
  assert.equal(quote('renewal',lang,member,{use:true},now).minor,free);
  assert.equal(quote('renewal',lang,p,{use:true},now).minor,discount);
 }
 assert.equal(new Date(LAUNCH_END).toISOString(),'2027-02-28T15:00:00.000Z');
 assert.throws(()=>quote('renewal','ja',p,{use:false},now));
 assert.throws(()=>quote('initial','ja',p,{use:true},now));
 assert.throws(()=>quote('initial','fr',p,{use:false},now));
});
test('owner and preview claims cannot unlock PRO pricing; verified primary email is mandatory',()=>{
 for(const meta of [{role:'admin',ownerMode:true},{membershipPreview:{plan:'pro',proExpiresAt:'2099-01-01'}},{plan:'pro',proExpiresAt:new Date(now).toISOString()}])
  assert.equal(identity(user(meta),now).pro,false);
 assert.throws(()=>identity({...user(),banned:true},now));
 assert.throws(()=>identity({...user(),primaryEmailAddressId:'email_other'},now));
 assert.throws(()=>identity({...user(),emailAddresses:[]},now));
});
test('payment validation matches identifiers, product, exact amount, currency, merchant and completed capture',()=>{
 const o=sample(); assert.equal(verifyOrder(o,remote(o),merchant,true).captureId,'CAPTURE12345');
 for(const change of [r=>r.id='OTHERORDER12',r=>r.status='APPROVED',r=>r.purchase_units.push(r.purchase_units[0]),
  r=>r.purchase_units[0].custom_id='someone-else',r=>r.purchase_units[0].payee.merchant_id='OTHER',
  r=>r.purchase_units[0].items[0].sku='another-product',r=>r.purchase_units[0].items[0].quantity='2',
  r=>r.purchase_units[0].amount={currency_code:'JPY',value:'1'},
  r=>r.purchase_units[0].payments.captures[0].amount={currency_code:'USD',value:'79.80'},
  r=>r.purchase_units[0].payments.captures[0].final_capture=false,
  r=>r.purchase_units[0].payments.captures[0].status='PENDING',
  r=>r.purchase_units[0].payments.captures[0].create_time='2029-01-01T00:00:00Z']) {
  const r=remote(o);change(r);assert.throws(()=>verifyOrder(o,r,merchant,true));
 }
 assert.throws(()=>verifyOrder({...o,capture_checked_at:null},remote(o),merchant,true));
 assert.throws(()=>minorUnits('7.98e3','JPY'));assert.throws(()=>minorUnits('-7980','JPY'));
 assert.equal(minorUnits('7980.00','JPY'),7980);
 assert.equal(addYear('2028-02-29T06:00:00Z'),'2029-02-28T06:00:00.000Z');
});
test('PayPal adapter refuses live credentials and untrusted certificates without following redirects',async()=>{
 assert.throws(()=>paypalConfig({RESOLUTE_PAYPAL_ENV:'live'}));
 const calls=[];
 const api=createPaypal({base:'https://api-m.sandbox.paypal.com',clientId:'id',secret:'secret',merchantId:merchant,webhookId:'WH123'},async(url,options)=>{
  calls.push({url,options});assert.equal(options.redirect,'error');
  return Response.json(url.endsWith('/token')?{access_token:'token',expires_in:300}:{verification_status:'SUCCESS'});
 });
 const headers=new Headers({'paypal-transmission-id':'t','paypal-transmission-time':'2026-10-15T06:00:00Z','paypal-cert-url':'https://evil.test/key',
 'paypal-auth-algo':'SHA256withRSA','paypal-transmission-sig':'sig'});
 assert.equal(await api.verify(headers,{id:'e'}),false);assert.equal(calls.length,0);
 headers.set('paypal-cert-url','https://api.sandbox.paypal.com/v1/notifications/certs/CERT-example');
 assert.equal(await api.verify(headers,{id:'e'}),true);assert.equal(calls.length,2);
 assert.equal(JSON.parse(calls[1].options.body).webhook_id,'WH123');
});
async function fixture() {
 const bootstrap=new PGlite();await bootstrap.exec('CREATE DATABASE resolute');const data=await bootstrap.dumpDataDir();await bootstrap.close();
 const db=new PGlite({database:'resolute',loadDataDir:data});
 await db.exec(readFileSync(new URL('../db/resolute/010_payments_sandbox.sql',import.meta.url),'utf8'));
 // PGlite is single-session; production uses PostgreSQL advisory locks between sessions.
 const query=(sql,args)=>sql.includes('pg_advisory_xact_lock')?Promise.resolve({rows:[]}):db.query(sql,args);
 const store=paymentStore({query,connect:async()=>({query,release(){}})});
 let account=user(),captured=false,count=0,clock=now;
 const paypal={approval:async()=> 'https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL123456',create:async()=>({id:'PAYPAL123456'}),get:async()=>remote(await store.findPaypal('PAYPAL123456'),captured?'COMPLETED':'APPROVED'),
 capture:async()=>{count++;captured=true},captureDetails:async()=>({id:'CAPTURE12345',amount:{currency_code:'JPY',value:'7980'},
 status:'REFUNDED',supplementary_data:{related_ids:{order_id:'PAYPAL123456'}}}),verify:async()=>true};
 const engine=paymentEngine({store,paypal,merchantId:merchant,getUser:async()=>account,now:()=>clock});
 return {db,store,engine,paypal,setAccount:a=>{account=a},count:()=>count,setTime:t=>{clock=t}};
}
test('PostgreSQL ledger grants once, binds buyer, tolerates duplicate completion and never revives a refund',async()=>{
 const f=await fixture();
 try {
  const input={kind:'initial',language:'ja',requestKey:randomUUID()};
  const first=await f.engine.create('user_test',input),again=await f.engine.create('user_test',input);
  assert.equal(first.orderId,again.orderId);
  assert.equal((await f.store.access('user_test')).canUseTools,false);
  await assert.rejects(()=>f.engine.capture('user_other',{orderId:first.orderId}),/ORDER_NOT_FOUND/);
  await assert.rejects(()=>f.engine.create('user_test',{...input,amount:1}),/INVALID_PAYMENT_INPUT/);
  assert.equal((await f.engine.capture('user_test',{orderId:first.orderId})).state,'paid');
  assert.equal((await f.engine.capture('user_test',{orderId:first.orderId})).state,'already-paid');assert.equal(f.count(),1);
  const event={id:'EV-COMPLETED',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{id:'CAPTURE12345'}};
  await f.engine.webhook(new Headers(),event);await f.engine.webhook(new Headers(),event);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM resolute_payments_sandbox.grants')).rows[0].n,1);
  const access=await f.store.access('user_test');
  assert.equal(access.sandbox,true);assert.equal(access.canUseTools,true);
  assert.equal(access.canReceiveNotifications,true);
  assert.equal((await f.store.access('user_other')).canUseTools,false);
  await assert.rejects(()=>f.store.access("user_test' OR 1=1--"));
  const refund={id:'EV-REFUNDED',event_type:'PAYMENT.CAPTURE.REFUNDED',resource:{supplementary_data:{related_ids:{capture_id:'CAPTURE12345'}}}};
  await f.engine.webhook(new Headers(),refund);
  await f.engine.webhook(new Headers(),{...event,id:'EV-LATE-COMPLETE'});
  assert.equal((await f.store.get(first.orderId)).state,'revoked');
  assert.equal((await f.store.access('user_test')).canUseTools,false);
  assert.equal((await f.store.access('user_test')).canReceiveNotifications,false);
  assert.equal((await f.db.query('SELECT state FROM resolute_payments_sandbox.grants')).rows[0].state,'revoked');
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM resolute_payments_sandbox.alert_outbox')).rows[0].n,1);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='resolute' AND table_name='entitlements'")).rows[0].n,0);
 } finally {await f.db.close()}
});
test('capture response loss reconciles without charging a second time; false signatures cannot grant',async()=>{
 const f=await fixture();
 try {
  const first=await f.engine.create('user_test',{kind:'initial',language:'ja',requestKey:randomUUID()});
  const capture=f.paypal.capture;f.paypal.capture=async order=>{await capture(order);throw Error('connection lost')};
  await assert.rejects(()=>f.engine.capture('user_test',{orderId:first.orderId}));
  assert.equal((await f.engine.status('user_test',first.orderId)).state,'paid');assert.equal(f.count(),1);
  f.paypal.verify=async()=>false;
  await assert.rejects(()=>f.engine.webhook(new Headers(),{id:'FAKE',event_type:'PAYMENT.CAPTURE.COMPLETED'}),/INVALID_SIGNATURE/);
  assert.equal((await f.store.get(first.orderId)).state,'paid');
 } finally {await f.db.close()}
});
test('HTTP payment switch, verified identity, sandbox allowlist and bounded input fail closed',async()=>{
 const engine={create:async()=>({ok:true})};
 const req=()=>new Request('https://api.test/internal/v1/payments/orders',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 const handler=options=>paymentHttp({engine,store:{},enabled:true,allowedUsers:['user_owner'],authenticate:async()=> 'user_owner',...options});
 assert.equal((await handler({enabled:false})(req())).status,503);
 assert.equal((await handler({authenticate:async()=>null})(req())).status,401);
 assert.equal((await handler({authenticate:async()=> 'user_free'})(req())).status,403);
 assert.equal((await handler({})(req())).status,200);
 assert.equal((await handler({})(new Request('https://api.test/webhooks/paypal'))).status,405);
});
test('PRO expiration or downgrade before capture never charges the discounted order',async()=>{
 const f=await fixture();
 try {
  const initial=await f.engine.create('user_test',{kind:'initial',language:'ja',requestKey:randomUUID()});
  await f.engine.capture('user_test',{orderId:initial.orderId});
  f.setTime(now+2000);
  f.setAccount(pro());
  f.paypal.create=async()=>({id:'PAYPALRENEW12'});
  f.paypal.get=async()=>remote(await f.store.findPaypal('PAYPALRENEW12'),'APPROVED');
  const renewal=await f.engine.create('user_test',{kind:'renewal',language:'ja',requestKey:randomUUID()});
  assert.equal(renewal.quote.minor,3980);
  f.setAccount(user());
  await assert.rejects(()=>f.engine.capture('user_test',{orderId:renewal.orderId}),/PRICE_CHANGED/);
  assert.equal(f.count(),1);
 } finally {await f.db.close()}
});
test('dispute suspends a purchase and resolution remains held for review; completion cannot restore it',async()=>{
 const f=await fixture();
 try {
  const initial=await f.engine.create('user_test',{kind:'initial',language:'ja',requestKey:randomUUID()});
  await f.engine.capture('user_test',{orderId:initial.orderId});
  for(const type of ['CUSTOMER.DISPUTE.CREATED','CUSTOMER.DISPUTE.RESOLVED']) {
   await f.engine.webhook(new Headers(),{id:type,event_type:type,resource:{disputed_transactions:[{seller_transaction_id:'CAPTURE12345'}]}});
   assert.equal((await f.store.get(initial.orderId)).state,'suspended');
  }
  await f.engine.webhook(new Headers(),{id:'LATE',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{id:'CAPTURE12345'}});
  assert.equal((await f.db.query('SELECT state FROM resolute_payments_sandbox.grants')).rows[0].state,'suspended');
 } finally {await f.db.close()}
});
test('approval redirects are restricted to this Sandbox order and callbacks are server-owned',async()=>{
 const id='PAYPAL123456';
 const approved=href=>({id,links:[{rel:'payer-action',href}]});
 assert.equal(approvalUrl(approved(`https://www.sandbox.paypal.com/checkoutnow?token=${id}`),id),`https://www.sandbox.paypal.com/checkoutnow?token=${id}`);
 for(const href of ['https://www.paypal.com/checkoutnow?token='+id,'https://evil.test/checkoutnow?token='+id,
  'https://www.sandbox.paypal.com/checkoutnow?token=OTHERORDER12',
  `https://www.sandbox.paypal.com/checkoutnow?token=${id}&redirect=https://evil.test`,
  `https://user@www.sandbox.paypal.com/checkoutnow?token=${id}`]) assert.throws(()=>approvalUrl(approved(href),id));
 const calls=[];
 const api=createPaypal({base:'https://api-m.sandbox.paypal.com',clientId:'id',secret:'secret',merchantId:merchant},async(url,options)=>{
  calls.push({url,options}); return Response.json(url.endsWith('/token')?{access_token:'token',expires_in:300}:{id});
 });
 const order=sample(); await api.create(order);
 const body=JSON.parse(calls[1].options.body),context=body.payment_source.paypal.experience_context;
 assert.equal(context.user_action,'CONTINUE');assert.equal(context.shipping_preference,'NO_SHIPPING');
 assert.equal(context.return_url,`${SANDBOX_RETURN}?order=${order.id}&lang=ja`);
 assert.equal(context.cancel_url,`${context.return_url}&cancel=1`);
 assert.equal(body.purchase_units[0].amount.value,'7980');
});
test('opening the return status does not capture or grant; buyer binding applies to status',async()=>{
 const f=await fixture();
 try {
  const o=await f.engine.create('user_test',{kind:'initial',language:'ja',requestKey:randomUUID()});
  const status=await f.engine.status('user_test',o.orderId);
  assert.equal(status.state,'created');assert.equal(status.quote.value,'7980');assert.equal(f.count(),0);
  assert.equal((await f.db.query('SELECT count(*)::int AS n FROM resolute_payments_sandbox.grants')).rows[0].n,0);
  await assert.rejects(()=>f.engine.status('user_other',o.orderId),/ORDER_NOT_FOUND/);
 } finally {await f.db.close()}
});

// Multi-order provider double: exercise the real engine and SQL ledger. This is
// local verification, not evidence of a live PayPal approval or capture.
async function multiOrderFixture() {
 const f=await fixture(), captures=new Map();let sequence=0,clock=now,lookup=null;
 f.paypal.create=async()=>({id:`PAYPALTEST${++sequence}`});
 f.paypal.approval=async id=>`https://www.sandbox.paypal.com/checkoutnow?token=${id}`;
 f.paypal.capture=async order=>{captures.set(order.paypal_id,{id:`CAPTURETEST${sequence}`,time:clock});};
 f.paypal.get=async id=>{
  const r=remote(await f.store.findPaypal(id),captures.has(id)?'COMPLETED':'APPROVED');
  if(captures.has(id)) {
   r.purchase_units[0].payments.captures[0].id=captures.get(id).id;
   r.purchase_units[0].payments.captures[0].create_time=new Date(captures.get(id).time).toISOString();
  }
  return r;
 };
 const engine=paymentEngine({store:f.store,paypal:f.paypal,merchantId:merchant,getUser:async()=>lookup?lookup():user(),now:()=>clock});
 return {...f,engine,captures,account:fn=>{lookup=fn},clock:t=>{clock=t},
  purchase:async(kind,language)=>{
   const o=await engine.create('user_test',{kind,language,requestKey:randomUUID()});
   assert.equal((await engine.capture('user_test',{orderId:o.orderId})).state,'paid');return o;
  }};
}
for(const [language,currency,initial,free,discount] of [['ja','JPY','7980','5980','3980'],['en','USD','59.00','39.00','29.00']]) {
 test(`${language}: initial, FREE renewal and PRO renewal grant consecutive years without duplicate grants`,async()=>{
  const f=await multiOrderFixture();
  try {
   const first=await f.purchase('initial',language);
   assert.equal(first.quote.currency,currency);assert.equal(first.quote.value,initial);
   f.clock(now+2000);
   const renewal=await f.purchase('renewal',language);
   assert.equal(renewal.quote.value,free);assert.equal(renewal.quote.priceClass,'free');
   f.account(pro);f.clock(now+4000);
   const discounted=await f.purchase('renewal',language);
   assert.equal(discounted.quote.value,discount);assert.equal(discounted.quote.priceClass,'pro');
   f.account(user); // Losing PRO after payment must not cancel the purchased year.
   assert.equal((await f.engine.capture('user_test',{orderId:discounted.orderId})).state,'already-paid');
   const rows=(await f.db.query('SELECT kind,state,starts_at,expires_at FROM resolute_payments_sandbox.grants ORDER BY starts_at')).rows;
   assert.equal(rows.length,3);assert.equal(f.captures.size,3);
   for(let i=0;i<3;i++) {
    assert.equal(rows[i].state,'active');assert.equal(rows[i].kind,i?'renewal':'initial');
    assert.equal(new Date(rows[i].starts_at).toISOString(),`202${6+i}-10-15T06:00:00.000Z`);
    assert.equal(new Date(rows[i].expires_at).toISOString(),`202${7+i}-10-15T06:00:00.000Z`);
   }
  } finally {await f.db.close()}
 });
 test(`${language}: a PRO downgrade on the final identity lookup stops capture and records an alert`,async()=>{
  const f=await multiOrderFixture();
  try {
   await f.purchase('initial',language);f.clock(now+2000);f.account(pro);
   const o=await f.engine.create('user_test',{kind:'renewal',language,requestKey:randomUUID()});
   let calls=0;f.account(()=>++calls===1?pro():user());
   await assert.rejects(()=>f.engine.capture('user_test',{orderId:o.orderId}),/PRICE_CHANGED/);
   assert.equal(calls,2);assert.equal(f.captures.size,1);
   assert.equal((await f.db.query('SELECT count(*)::int AS n FROM resolute_payments_sandbox.grants')).rows[0].n,1);
   assert.equal((await f.db.query("SELECT count(*)::int AS n FROM resolute_payments_sandbox.audit WHERE code='CAPTURE_ELIGIBILITY_CHANGED'")).rows[0].n,1);
   assert.equal((await f.db.query('SELECT count(*)::int AS n FROM resolute_payments_sandbox.alert_outbox')).rows[0].n,1);
  } finally {await f.db.close()}
 });
 test(`${language}: injected prices and PRO claims cannot create orders; renewal requires a purchase`,async()=>{
  const f=await multiOrderFixture();
  try {
   const body={kind:'initial',language,requestKey:randomUUID()};
   for(const injected of [{amount:1},{currency:'USD'},{priceClass:'pro'},{plan:'pro'},{pro:true},{userId:'user_other'}])
    await assert.rejects(()=>f.engine.create('user_test',{...body,...injected}),/INVALID_PAYMENT_INPUT/);
   await assert.rejects(()=>f.engine.create('user_test',{...body,kind:'renewal'}),/INITIAL_PURCHASE_REQUIRED/);
   assert.equal((await f.db.query('SELECT count(*)::int AS n FROM resolute_payments_sandbox.orders')).rows[0].n,0);
  } finally {await f.db.close()}
 });
}
test('USD captured amount and currency mismatches never create a grant',async()=>{
 for(const badAmount of [{currency_code:'USD',value:'0.59'},{currency_code:'JPY',value:'5900'}]) {
  const f=await multiOrderFixture();
  try {
   const o=await f.engine.create('user_test',{kind:'initial',language:'en',requestKey:randomUUID()});
   const get=f.paypal.get;
   f.paypal.get=async id=>{const r=await get(id);if(r.status==='COMPLETED')r.purchase_units[0].payments.captures[0].amount=badAmount;return r};
   await assert.rejects(()=>f.engine.capture('user_test',{orderId:o.orderId}),/PAYMENT_MISMATCH/);
   assert.equal((await f.db.query('SELECT count(*)::int AS n FROM resolute_payments_sandbox.grants')).rows[0].n,0);
  } finally {await f.db.close()}
 }
});
