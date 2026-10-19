import test from 'node:test';
import assert from 'node:assert/strict';
import {checkoutUrl,liveOrder,liveApprovalUrl,liveCheckoutRequest} from '../lib/resolute/live-checkout.ts';
import {paymentEngine} from '../services/resolute-api/payments/engine.mjs';
const id='8c6a2eed-fe12-4167-9dab-74a5481b3314';
const order={orderId:id,sandbox:false,state:'created',expiresAt:'2026-10-20T00:00:00Z',quote:{kind:'renewal',language:'ja',currency:'JPY',value:'5980',priceClass:'free'}};
test('language switches preserve order identity and do not encode a new currency or price',()=>{
 for(const lang of ['ja','en']) {
  const url=new URL(checkoutUrl(lang,id,true),'https://site.test');
  assert.deepEqual([...url.searchParams.keys()],['lang','order','cancel']);
  assert.equal(url.searchParams.get('order'),id);
  assert.equal(url.searchParams.get('lang'),lang);
 }
 assert.equal(liveOrder(order),order);
 for(const patch of [{sandbox:true},{quote:{...order.quote,currency:'USD'}},{quote:{...order.quote,value:'NaN'}},{approvalUrl:'https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL123456'}])
  assert.throws(()=>liveOrder({...order,...patch}));
 assert.equal(liveApprovalUrl('https://www.paypal.com/checkoutnow?token=PAYPAL123456'),'https://www.paypal.com/checkoutnow?token=PAYPAL123456');
 for(const u of ['https://evil.test/checkoutnow?token=PAYPAL123456','https://www.paypal.com/checkoutnow?token=PAYPAL123456&redirect=evil','https://user@www.paypal.com/checkoutnow?token=PAYPAL123456']) assert.equal(liveApprovalUrl(u),null);
});
test('live UI client uses only live endpoint and rejects Sandbox or unsuccessful responses',async()=>{
 const original=globalThis.fetch;let calls=0;
 try {
  globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'/api/resolute/live-payments/orders');assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');return Response.json(order);};
  assert.deepEqual(await liveCheckoutRequest('orders',{kind:'renewal',language:'ja',requestKey:id}),order);
  await assert.rejects(liveCheckoutRequest('../payments/orders'));assert.equal(calls,1);
  globalThis.fetch=async()=>Response.json({...order,sandbox:true});await assert.rejects(liveCheckoutRequest('orders'));
  globalThis.fetch=async()=>Response.json({error:'PAYMENT_DISABLED'},{status:503});await assert.rejects(liveCheckoutRequest('orders'),/PAYMENT_DISABLED/);
 } finally {globalThis.fetch=original;}
});
test('live reload can resume the same approval; viewing it never captures or changes ownership',async()=>{
 let approvals=0;
 const engine=paymentEngine({environment:'live',canCharge:()=>false,store:{get:async()=>({id,user_id:'user_owner',paypal_id:'PAYPAL123456',state:'created',quote:order.quote,expires_at:order.expiresAt})},
  paypal:{approval:async token=>{approvals++;assert.equal(token,'PAYPAL123456');return 'https://www.paypal.com/checkoutnow?token='+token;},capture:async()=>{throw Error('must not capture');}}});
 await assert.rejects(engine.status('user_other',id));assert.equal(approvals,0);
 const result=await engine.status('user_owner',id);assert.equal(result.sandbox,false);assert.ok(result.approvalUrl);assert.equal(approvals,1);
});
test('closed live screen renders no actionable PayPal link or enabled purchase control in either language',async()=>{
 const {build}=await import('esbuild');const {mkdtemp,rm}=await import('node:fs/promises');
 const {createRequire}=await import('node:module');const {join}=await import('node:path');
 const require=createRequire(import.meta.url);const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
 const dir=await mkdtemp(join(process.cwd(),'.checkout-render-'));
 try {
  const outfile=join(dir,'screen.cjs');
  await build({entryPoints:['app/resolute/checkout/live-screen.tsx'],outfile,bundle:true,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/jsx-runtime'],loader:{'.css':'empty'}});
  const Screen=require(outfile).default;
  for(const language of ['ja','en']) {
   const html=renderToStaticMarkup(React.createElement(Screen,{orderId:null,language,cancelled:false,salesEnabled:false}));
   assert.match(html,/disabled=""/);assert.doesNotMatch(html,/href="https:\/\/www\.paypal/);
   assert.match(html,language==='ja'?/購入の受付を停止/:/Checkout is currently closed/);
   assert.doesNotMatch(html,/Sandbox|テスト購入/);
  }
 } finally {await rm(dir,{recursive:true,force:true});}
});
