import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {billingReturn,billingSummary,sandboxApproval,billingRequest} from '../lib/membership/billing-client.ts';
const id='00000000-0000-4000-8000-000000000001';
test('checkout waits for server status and displays persisted review state in both languages',()=>{
 const require=createRequire(import.meta.url);
 const source=readFileSync(new URL('../app/research/account/billing/screen.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const m={exports:{}};let language='ja',seed=null,stateIndex=0;
 new Function('require','module','exports',compiled)(name=>{
  if(name.endsWith('.module.css'))return {default:{}};
  if(name==='next/link')return {default:({children,...props})=>createElement('a',props,children)};
  if(name==='../../research-tool-shell')return {default:({children})=>children};
  if(name==='../../use-research-language')return {useResearchLanguage:()=>[language,()=>{}]};
  if(name==='../../identity-provider')return {useIdentityRefresh:()=>async()=>{}};
  if(name==='@/lib/membership/billing-client')return {billingRequest:()=>assert.fail('render must not fetch')};
  if(name==='react')return {...require(name),useState:initial=>{
   const index=stateIndex++;return require(name).useState(seed&&Object.hasOwn(seed,index)?seed[index]:initial);
  }};
  return require(name);
 },m,m.exports);
 for(language of ['ja','en']){
  stateIndex=0;
  const html=renderToStaticMarkup(createElement(m.exports.default));
  assert.match(html,/PayPal Sandbox/);assert.match(html,/aria-busy="true"/);
  assert.doesNotMatch(html,/<fieldset|<select|type="checkbox"/);
  assert.match(html,/<button[^>]*disabled/);
 }
 for(language of ['ja','en'])for(const reviewRequired of [false,true]){
  stateIndex=0;seed={0:true,1:{environment:'sandbox',plan:'free',proExpiresAt:null,reviewRequired,subscription:{id,currency:'JPY',state:'active'}},5:false,7:'verified'};
  const html=renderToStaticMarkup(createElement(m.exports.default));
  const notice=language==='ja'?'この契約のお支払いは運営側での確認が必要です。':'Payment for this subscription needs review.';
  assert.equal(html.includes(notice),reviewRequired);
  assert.equal(html.includes(language==='ja'?'支払いの照合が完了しました。':'Payment reconciliation finished.'),!reviewRequired);
  assert.match(html,/FREE/);assert.doesNotMatch(html,/<select/);
 }
 for(language of ['ja','en'])for(const confirmation of [null,id,'00000000-0000-4000-8000-000000000002']) {
  stateIndex=0;seed={0:true,1:{environment:'sandbox',plan:'free',proExpiresAt:null,subscription:{id,currency:'JPY',state:'active'}},4:confirmation,5:false};
  const html=renderToStaticMarkup(createElement(m.exports.default));
  const label=language==='ja'?'テスト契約を解約':'Cancel test subscription';
  const button=html.match(new RegExp(`<button([^>]*)>${label}</button>`));
  assert.ok(button);assert.equal(button[1].includes('disabled'),confirmation!==id);
  assert.equal(/type="checkbox"[^>]*checked/.test(html),confirmation===id);
 }
});
test('PayPal return data never implies payment and approval navigation is Sandbox-only',()=>{
 assert.deepEqual(billingReturn('?billing='+id+'&cancel=1'),{id,cancelled:true});
 assert.equal(billingReturn('?billing='+id+'&billing='+id).id,null);
 assert.equal(billingReturn('?billing=../../other').id,null);
 const good='https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-ABCDEFGHIJKL';
 assert.equal(sandboxApproval(good),good);
 for(const bad of [good.replace('www.sandbox','www'),good+'&redirect=https://evil.test',good+'#x',good.replace('https:','http:'),'javascript:alert(1)',good.replace('www.sandbox','evil@www.sandbox')])assert.throws(()=>sandboxApproval(bad));
});
test('billing status parser rejects malformed access or another environment',()=>{
 const good={environment:'sandbox',plan:'free',proExpiresAt:null,subscription:{id,currency:'JPY',state:'approval_pending'}};
 assert.deepEqual(billingSummary(good),good);
 for(const bad of [{...good,environment:'live'},{...good,plan:'active'},{...good,plan:'pro'},{...good,proExpiresAt:'2026-11-20T00:00:00Z'},{...good,proExpiresAt:'tomorrow'},{...good,subscription:{id:'other',currency:'JPY',state:'active'}}])assert.throws(()=>billingSummary(bad));
 assert.equal(billingSummary({...good,plan:'pro',proExpiresAt:'2026-11-20T00:00:00Z'}).plan,'pro');
 assert.equal(billingSummary({...good,reviewRequired:true}).reviewRequired,true);
 for(const reviewRequired of ['true',1,null,{}])assert.throws(()=>billingSummary({...good,reviewRequired}));
 assert.throws(()=>billingSummary({...good,subscription:null,reviewRequired:true}));
});
test('browser handles paused-site HTML and malformed or oversized JSON without retries',async()=>{
 const original=globalThis.fetch;
 try {
  for(const [type,payload,closed] of [['text/html','private proxy response',false],['application/json','null',true],['application/json','[]',true],['application/json','invalid',true],['application/json','x'.repeat(16385),false]]) {
   let calls=0,cancelled=0;
   const response=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(payload));if(closed)c.close();},cancel(){cancelled++;}}),{status:503,headers:{'content-type':type}});
   globalThis.fetch=async()=>{calls++;return response;};
   await assert.rejects(billingRequest('status'),{message:'billing-unavailable'});
   assert.equal(calls,1);assert.equal(response.body.locked,false);assert.equal(cancelled,closed?0:1);
  }
 } finally {globalThis.fetch=original;}
});
test('browser reads chunked JSON including multibyte content and releases the reader',async()=>{
 const original=globalThis.fetch;
 try {
  const expected={environment:'sandbox',label:'確認済み'};
  const bytes=new TextEncoder().encode(JSON.stringify(expected));
  const response=new Response(new ReadableStream({start(c){for(const byte of bytes)c.enqueue(new Uint8Array([byte]));c.close();}}),{headers:{'content-type':'Application/JSON; charset=utf-8'}});
  globalThis.fetch=async()=>response;
  assert.deepEqual(await billingRequest('status'),expected);assert.equal(response.body.locked,false);
 } finally {globalThis.fetch=original;}
});
test('browser mutations use same-origin POST once and never retry ambiguous provider errors',async()=>{
 const original=globalThis.fetch;let calls=0;
 try {
  globalThis.fetch=async(url,options)=>{
   calls++;assert.equal(url,'/api/research/billing/sandbox/create');assert.equal(options.method,'POST');
   assert.equal(options.credentials,'same-origin');assert.equal(options.redirect,'error');
   assert.deepEqual(JSON.parse(options.body),{currency:'JPY',acceptedTerms:'sandbox-v1'});
   return Response.json({error:'billing-unavailable'},{status:503});
  };
  await assert.rejects(billingRequest('create',{currency:'JPY',acceptedTerms:'sandbox-v1'}),/billing-unavailable/);
  assert.equal(calls,1);
 } finally {globalThis.fetch=original;}
});
test('cancellation requires explicit completion and never retries malformed successful responses',async()=>{
 const original=globalThis.fetch;
 try {
  for(const result of [{},{status:'pending'},{status:'active'},{status:true},{status:'CANCELLED'},{error:'billing-unavailable'}]) {
   let calls=0;
   globalThis.fetch=async(url,options)=>{
    calls++;assert.equal(url,'/api/research/billing/sandbox/cancel');
    assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{id});
    return Response.json(result);
   };
   await assert.rejects(billingRequest('cancel',{id}),/billing-unavailable/);
   assert.equal(calls,1);
  }
  globalThis.fetch=async()=>Response.json({status:'cancelled'});
  assert.deepEqual(await billingRequest('cancel',{id}),{status:'cancelled'});
 } finally {globalThis.fetch=original;}
});
test('checkout and reconciliation require usable protocol evidence before the UI reports progress',async()=>{
 const original=globalThis.fetch;
 const approvalUrl='https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-ABCDEFGHIJKL';
 const access={environment:'sandbox',plan:'pro',proExpiresAt:'2026-11-20T00:00:00Z'};
 try {
  const invalid=[
   ['create',{}],['create',{id}],['create',{id,status:'APPROVAL_PENDING'}],
   ['create',{id,approvalUrl:''}],['create',{id:'other',approvalUrl}],
   ['create',{id,approvalUrl:approvalUrl.replace('www.sandbox','www')}],
   ['reconcile',{}],['reconcile',{status:'verified'}],
   ['reconcile',{...access,status:'unknown'}],['reconcile',{...access,status:'verified',environment:'live'}],
   ['reconcile',{...access,status:'verified',proExpiresAt:null}],
  ];
  for(const [action,result] of invalid) {
   let calls=0;globalThis.fetch=async()=>{calls++;return Response.json(result);};
   await assert.rejects(billingRequest(action,{id}),/billing-unavailable/);assert.equal(calls,1);
  }
  for(const [action,result] of [
   ['create',{id,approvalUrl}],['create',{id,status:'ACTIVE',approvalUrl:null}],
   ['reconcile',{...access,status:'verified'}],
   ['reconcile',{environment:'sandbox',plan:'free',proExpiresAt:null,status:'payment-pending'}],
   ['reconcile',{environment:'sandbox',plan:'free',proExpiresAt:null,status:'review-required'}],
  ]) {
   globalThis.fetch=async()=>Response.json(result);assert.deepEqual(await billingRequest(action,{id}),result);
  }
 } finally {globalThis.fetch=original;}
});
test('billing page gates preview and exact owner before rendering checkout',async()=>{
 const require=createRequire(import.meta.url),old=process.env.VERCEL_ENV;
 let user=null,authCalls=0;
 const source=readFileSync(new URL('../app/research/account/billing/page.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const m={exports:{}};
 new Function('require','module','exports',compiled)(name=>{
  if(name==='@clerk/nextjs/server')return {auth:async()=>{authCalls++;return {userId:user};}};
  if(name==='next/navigation')return {notFound:()=>{throw Error('404');},redirect:path=>{throw Error('REDIRECT:'+path);}};
  if(name==='@/lib/membership/entitlements')return {OWNER_ACCOUNT_ID:'owner'};
  if(name==='./screen')return {default:function Screen(){}};
  return require(name);
 },m,m.exports);
 try {
  process.env.VERCEL_ENV='production';await assert.rejects(m.exports.default(),/404/);assert.equal(authCalls,0);
  process.env.VERCEL_ENV='preview';await assert.rejects(m.exports.default(),/REDIRECT:\/research\/account/);
  user='another-admin';await assert.rejects(m.exports.default(),/404/);
  user='owner';assert.ok(await m.exports.default());
 } finally {if(old===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=old;}
});
