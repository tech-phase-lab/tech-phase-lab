import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {sandboxMemberAllowed} from '../services/tech-phase-billing/access.mjs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {billingReturn,billingSummary,sandboxApproval,billingRequest,verifyBillingReturn} from '../lib/membership/billing-client.ts';
const id='00000000-0000-4000-8000-000000000001';
test('checkout clears an earlier identity-loading error only after a successful status read',async()=>{
 const require=createRequire(import.meta.url);
 const source=readFileSync(new URL('../app/research/account/billing/screen.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const m={exports:{}},state=[],refs=[],calls=[];
 let stateIndex=0,refIndex=0,effect,identityLoaded=false,statusFails=false;
 const summary={environment:'sandbox',plan:'free',proExpiresAt:null,subscription:null};
 new Function('require','module','exports',compiled)(name=>{
  if(name==='react')return {...require(name),useState:initial=>{
   const index=stateIndex++;if(!(index in state))state[index]=initial;
   return [state[index],value=>{state[index]=value;}];
  },useRef:initial=>refs[refIndex++]??(refs[refIndex-1]={current:initial}),useEffect:callback=>{effect=callback;}};
  if(name==='../../identity-provider')return {useIdentityRefresh:()=>async()=>{if(!identityLoaded)throw Error('identity-loading');}};
  if(name==='../../use-research-language')return {useResearchLanguage:()=>['ja',()=>{}]};
  if(name==='@/lib/membership/billing-client')return {billingReturn:()=>({id:null}),billingSummary,billingRequest:async action=>{
   calls.push(action);if(action==='readiness')return {environment:'sandbox',enabled:true,configurationReady:true};
   if(statusFails)throw Error('billing-unavailable');return summary;
  }};
  if(name==='next/link'||name==='../../research-tool-shell'||name.endsWith('.module.css'))return {default:()=>null};
  return require(name);
 },m,m.exports);
 const previousWindow=globalThis.window;globalThis.window={location:{search:''}};
 const run=async()=>{stateIndex=0;refIndex=0;m.exports.default();const cleanup=effect();await new Promise(resolve=>setImmediate(resolve));return cleanup;};
 try {
  let cleanup=await run();assert.equal(state[6],'identity-loading');assert.equal(state[1],null);assert.deepEqual(calls,[]);cleanup();
  identityLoaded=true;statusFails=true;cleanup=await run();assert.equal(state[6],'billing-unavailable');assert.equal(state[1],null);assert.equal(state[0],false);cleanup();
  statusFails=false;cleanup=await run();assert.equal(state[6],'');assert.deepEqual(state[1],summary);assert.equal(state[0],true);assert.deepEqual(calls,['readiness','status','readiness','status']);cleanup();
 }finally{if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;}
});
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
 for(language of ['ja','en']) {
  stateIndex=0;seed={6:'identity-loading'};
  const waiting=renderToStaticMarkup(createElement(m.exports.default));
  assert.match(waiting,/role="status"/);assert.doesNotMatch(waiting,/role="alert"/);
  assert.ok(waiting.includes(language==='ja'?'ログイン状態を確認しています。':'Checking your sign-in status.'));
  assert.doesNotMatch(waiting,/<fieldset|<select|type="checkbox"/);
  stateIndex=0;seed={5:false,6:'billing-unavailable'};
  const failed=renderToStaticMarkup(createElement(m.exports.default));
  assert.match(failed,/role="alert"/);
  assert.ok(failed.includes(language==='ja'?'通信を確認できませんでした。':'Could not confirm the result.'));
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
test('billing page gates preview and enrolled Sandbox identity before rendering checkout',async()=>{
 const require=createRequire(import.meta.url);
 const keys=['VERCEL_ENV','TECH_PHASE_PAYPAL_ENV','TECH_PHASE_BILLING_SANDBOX_TEST_USERS'];
 const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 let user=null,authCalls=0;
 const source=readFileSync(new URL('../app/research/account/billing/page.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const m={exports:{}};
 new Function('require','module','exports',compiled)(name=>{
  if(name==='@clerk/nextjs/server')return {auth:async()=>{authCalls++;return {userId:user};}};
  if(name==='next/navigation')return {notFound:()=>{throw Error('404');},redirect:path=>{throw Error('REDIRECT:'+path);}};
  if(name==='@/lib/membership/entitlements')return {OWNER_ACCOUNT_ID:'owner'};
  if(name==='@/services/tech-phase-billing/access.mjs')return {sandboxMemberAllowed};
  if(name==='./screen')return {default:function Screen(){}};
  return require(name);
 },m,m.exports);
 try {
  process.env.VERCEL_ENV='production';await assert.rejects(m.exports.default(),/404/);assert.equal(authCalls,0);
  process.env.VERCEL_ENV='preview';await assert.rejects(m.exports.default(),/REDIRECT:\/research\/account/);
  user='another-admin';await assert.rejects(m.exports.default(),/404/);
  user='owner';assert.ok(await m.exports.default());
  user='user_Member2';await assert.rejects(m.exports.default(),/404/);
  process.env.TECH_PHASE_PAYPAL_ENV='sandbox';
  process.env.TECH_PHASE_BILLING_SANDBOX_TEST_USERS='["user_Member2"]';
  assert.ok(await m.exports.default());
  process.env.TECH_PHASE_PAYPAL_ENV='live';await assert.rejects(m.exports.default(),/404/);
  process.env.VERCEL_ENV='production';await assert.rejects(m.exports.default(),/404/);
 } finally {for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
});

const pendingReturnSummary={environment:'sandbox',plan:'free',proExpiresAt:null,subscription:{id,currency:'JPY',state:'approval_pending'}};
test('automatic return verification requires the saved contract and never creates or cancels',async()=>{
 for(const [returned,current] of [
  [{id:null,cancelled:false},pendingReturnSummary],
  [{id,cancelled:true},pendingReturnSummary],
  [{id:'00000000-0000-4000-8000-000000000002',cancelled:false},pendingReturnSummary],
  [{id,cancelled:false},{...pendingReturnSummary,subscription:null}],
  ...['creating','cancelled','expired'].map(state=>[{id,cancelled:false},{...pendingReturnSummary,subscription:{...pendingReturnSummary.subscription,state}}]),
  [{id,cancelled:false},{...pendingReturnSummary,reviewRequired:true}],
  [{id,cancelled:false},{...pendingReturnSummary,plan:'pro',proExpiresAt:'2026-11-21T00:00:00Z'}],
 ]) assert.equal(await verifyBillingReturn(returned,current,new AbortController().signal,()=>assert.fail('must not call')),null);
 const controller=new AbortController();controller.abort();
 assert.equal(await verifyBillingReturn({id,cancelled:false},pendingReturnSummary,controller.signal,()=>assert.fail('must not call')),null);
});
test('automatic verification trusts durable access, not reconcile success alone',async()=>{
 for(const [plan,reviewRequired,notice] of [['pro',false,'verified'],['free',false,'pending'],['free',true,'review']]) {
  const calls=[],summary={...pendingReturnSummary,plan,reviewRequired,proExpiresAt:plan==='pro'?'2026-11-21T00:00:00Z':null};
  const result=await verifyBillingReturn({id,cancelled:false},pendingReturnSummary,new AbortController().signal,async(action,body)=>{
   calls.push(action);if(action==='reconcile'){assert.deepEqual(body,{id});return {status:'verified'};}return summary;
  });
  assert.deepEqual(calls,['reconcile','status']);assert.deepEqual(result,{summary,notice});
 }
});
test('lost reconciliation response recovers paid access with one read and no mutation retry',async()=>{
 const paid={...pendingReturnSummary,plan:'pro',proExpiresAt:'2026-11-21T00:00:00Z'},calls=[];
 const result=await verifyBillingReturn({id,cancelled:false},pendingReturnSummary,new AbortController().signal,async action=>{
  calls.push(action);if(action==='reconcile')throw Error('billing-unavailable');return paid;
 });
 assert.equal(result.notice,'verified');assert.deepEqual(calls,['reconcile','status']);
});
test('automatic verification preserves manual review and rejects unavailable or changed status',async()=>{
 const controller=new AbortController();
 const reviewed=await verifyBillingReturn({id,cancelled:false},pendingReturnSummary,controller.signal,async action=>{
  if(action==='reconcile')throw Error('settlement-review-required');return pendingReturnSummary;
 });
 assert.equal(reviewed.notice,'review');
 for(const final of [null,{...pendingReturnSummary,subscription:null},{...pendingReturnSummary,subscription:{...pendingReturnSummary.subscription,id:'00000000-0000-4000-8000-000000000002'}}]) {
  await assert.rejects(verifyBillingReturn({id,cancelled:false},pendingReturnSummary,controller.signal,async action=>action==='reconcile'?{status:'verified'}:final),/billing-unavailable/);
 }
});
test('leaving the purchase page stops automatic verification without a second request',async()=>{
 const controller=new AbortController(),calls=[];
 const result=await verifyBillingReturn({id,cancelled:false},pendingReturnSummary,controller.signal,async action=>{
  calls.push(action);controller.abort();return {status:'verified'};
 });
 assert.equal(result,null);assert.deepEqual(calls,['reconcile']);
});

test('purchase screen automatically verifies a matching return only once across effect reruns',async()=>{
 const require=createRequire(import.meta.url),source=readFileSync(new URL('../app/research/account/billing/screen.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const m={exports:{}},state=[],refs=[],calls=[];let stateIndex=0,refIndex=0,effect,failFinalStatus=false;
 const request=async action=>{calls.push(action);if(failFinalStatus&&action==='status'&&calls.filter(x=>x==='status').length===2)throw Error('billing-unavailable');return action==='readiness'?{environment:'sandbox',enabled:true,configurationReady:true}:action==='reconcile'?{status:'payment-pending'}:pendingReturnSummary;};
 new Function('require','module','exports',compiled)(name=>{
  if(name==='react')return {...require(name),useState:initial=>{const i=stateIndex++;if(!(i in state))state[i]=initial;return [state[i],v=>{state[i]=v;}];},useRef:initial=>refs[refIndex++]??(refs[refIndex-1]={current:initial}),useEffect:callback=>{effect=callback;}};
  if(name==='../../identity-provider')return {useIdentityRefresh:()=>async()=>{}};
  if(name==='../../use-research-language')return {useResearchLanguage:()=>['ja',()=>{}]};
  if(name==='@/lib/membership/billing-client')return {billingReturn,billingSummary,billingRequest:request,verifyBillingReturn:(returned,current,signal)=>verifyBillingReturn(returned,current,signal,request)};
  if(name==='next/link'||name==='../../research-tool-shell'||name.endsWith('.module.css'))return {default:()=>null};
  return require(name);
 },m,m.exports);
 const previous=globalThis.window;globalThis.window={location:{search:'?billing='+id}};
 const run=async()=>{stateIndex=0;refIndex=0;m.exports.default();const cleanup=effect();await new Promise(r=>setImmediate(r));return cleanup;};
 try {
  let cleanup=await run();assert.deepEqual(calls,['readiness','status','reconcile','status']);assert.equal(state[7],'pending');assert.equal(state[5],false);cleanup();
  cleanup=await run();assert.equal(calls.filter(x=>x==='reconcile').length,1);assert.deepEqual(state[1],pendingReturnSummary);cleanup();
  refs.length=0;calls.length=0;failFinalStatus=true;
  cleanup=await run();assert.deepEqual(calls,['readiness','status','reconcile','status']);
  assert.equal(state[7],'');assert.equal(state[6],'billing-unavailable');assert.equal(state[5],false);assert.equal(state[1],null);cleanup();
 }finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});


test('subscription refresh removes stale payment notices and preserves durable review without mutations',async()=>{
 const require=createRequire(import.meta.url),source=readFileSync(new URL('../app/research/account/billing/screen.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const m={exports:{}},state=[],refs=[],calls=[];let index=0,refIndex=0,next,fail=false;
 new Function('require','module','exports',compiled)(name=>{
  if(name==='react')return {...require(name),useState:initial=>{const i=index++;if(!(i in state))state[i]=initial;return [state[i],v=>{state[i]=v;}];},useRef:initial=>refs[refIndex++]??(refs[refIndex-1]={current:initial}),useEffect:()=>{}};
  if(name==='../../identity-provider')return {useIdentityRefresh:()=>async()=>{}};
  if(name==='../../use-research-language')return {useResearchLanguage:()=>['ja',()=>{}]};
  if(name==='@/lib/membership/billing-client')return {billingSummary,billingRequest:async action=>{
   calls.push(action);assert.ok(['readiness','status'].includes(action),'refresh must never mutate');
   if(action==='readiness')return {environment:'sandbox',enabled:true,configurationReady:true};
   if(fail)throw Error('billing-unavailable');return next;
  }};
  if(name==='next/link'||name==='../../research-tool-shell'||name.endsWith('.module.css'))return {default:()=>null};
  return require(name);
 },m,m.exports);
 const button=node=>{
  if(!node||typeof node!=='object')return null;
  if(node.type==='button'&&node.props.children==='契約状況を再確認')return node;
  for(const child of [node.props?.children].flat(Infinity)){const found=button(child);if(found)return found;}
  return null;
 };
 for(const notice of ['pending','checking-payment','review','verified','cancelled'])for(const reviewRequired of [false,true]){
  state.length=0;state[0]=true;state[1]=pendingReturnSummary;state[5]=false;state[6]='';state[7]=notice;
  next={...pendingReturnSummary,plan:'pro',proExpiresAt:'2026-11-20T00:00:00Z',reviewRequired};
  index=0;refIndex=0;calls.length=0;
  const refresh=button(m.exports.default());assert.ok(refresh);refresh.props.onClick();
  await new Promise(r=>setImmediate(r));
  assert.equal(state[7],'','an earlier attempt must not describe the refreshed result');
  assert.deepEqual(state[1],next);assert.equal(state[6],'');assert.deepEqual(calls,['readiness','status']);
 }
 fail=true;state[5]=false;state[7]='verified';index=0;refIndex=0;
 button(m.exports.default()).props.onClick();await new Promise(r=>setImmediate(r));
 assert.equal(state[7],'');assert.equal(state[6],'billing-unavailable');assert.equal(state[1],null);
});

test('leaving checkout during identity refresh or an in-flight action prevents navigation and later work',async()=>{
 const require=createRequire(import.meta.url),source=readFileSync(new URL('../app/research/account/billing/screen.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const labels={refresh:'契約状況を再確認',create:'PayPalでテスト購入',reconcile:'支払いを確認',cancel:'テスト契約を解約'};
 const find=(node,label)=>{
  if(!node||typeof node!=='object')return null;
  if(node.type==='button'&&node.props.children===label)return node;
  for(const child of [node.props?.children].flat(Infinity)){const found=find(child,label);if(found)return found;}
  return null;
 };
 const prior=globalThis.window;
 try {
  for(const stage of ['identity','response'])for(const action of Object.keys(labels)) {
   if(stage==='response'&&action==='refresh')continue;
   const m={exports:{}},state=[],refs=[],calls=[],navigation=[];let index=0,refIndex=0,effect,release,identityCalls=0;
   const gate=new Promise(resolve=>{release=resolve;});
   const summary={...pendingReturnSummary,subscription:action==='create'?null:{...pendingReturnSummary.subscription,state:'active'}};
   const request=async name=>{
    calls.push(name);
    if(name==='readiness')return {environment:'sandbox',enabled:true,configurationReady:true};
    if(name==='status')return summary;
    if(stage==='response')await gate;
    return name==='create'?{id,approvalUrl:'https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=BA-ABCDEFGHIJKL'}:{status:name==='cancel'?'cancelled':'verified'};
   };
   new Function('require','module','exports',compiled)(name=>{
    if(name==='react')return {...require(name),useState:initial=>{const i=index++;if(!(i in state))state[i]=initial;return [state[i],v=>{state[i]=v;}];},useRef:initial=>refs[refIndex++]??(refs[refIndex-1]={current:initial}),useEffect:callback=>{effect=callback;}};
    if(name==='../../identity-provider')return {useIdentityRefresh:()=>async forced=>{if(forced){identityCalls++;if(stage==='identity')await gate;}}};
    if(name==='../../use-research-language')return {useResearchLanguage:()=>['ja',()=>{}]};
    if(name==='@/lib/membership/billing-client')return {billingReturn,billingSummary,sandboxApproval,billingRequest:request};
    if(name==='next/link'||name==='../../research-tool-shell'||name.endsWith('.module.css'))return {default:()=>null};
    return require(name);
   },m,m.exports);
   globalThis.window={location:{search:'',assign:url=>navigation.push(url)}};
   m.exports.default();const cleanup=effect();await new Promise(r=>setImmediate(r));
   state[3]=true;state[4]=id;index=0;refIndex=0;calls.length=0;
   const button=find(m.exports.default(),labels[action]);assert.ok(button,action);
   button.props.onClick();button.props.onClick();await new Promise(r=>setImmediate(r));
   assert.equal(identityCalls,1,'a double click must not start a second action');
   cleanup();const snapshot=structuredClone(state);release();await new Promise(r=>setImmediate(r));
   assert.deepEqual(calls,stage==='identity'?[]:[action],`${stage}: ${action} must stop at departure`);
   assert.deepEqual(navigation,[]);assert.deepEqual(state,snapshot,'no late UI updates after departure');
  }
 }finally{if(prior===undefined)delete globalThis.window;else globalThis.window=prior;}
});

test('manual response loss recovers only matching durable access or cancellation and never retries a mutation',async()=>{
 const require=createRequire(import.meta.url),source=readFileSync(new URL('../app/research/account/billing/screen.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const active={...pendingReturnSummary,subscription:{...pendingReturnSummary.subscription,state:'active'}};
 const pro={...active,plan:'pro',proExpiresAt:'2026-11-20T00:00:00Z'};
 const cancelled={...pro,subscription:{...pro.subscription,state:'cancelled'}};
 const cases=[
  ['reconcile',pro,Error('billing-unavailable'),'access-confirmed'],
  ['reconcile',pro,new TypeError('Failed to fetch'),'access-confirmed'],
  ['reconcile',pro,new DOMException('timed out','TimeoutError'),'access-confirmed'],
  ['reconcile',{...pro,reviewRequired:true},Error('billing-unavailable'),''],
  ['reconcile',pro,Error('settlement-review-required'),''],
  ['reconcile',active,Error('billing-unavailable'),''],
  ['reconcile',{...pro,subscription:{...pro.subscription,id:'00000000-0000-4000-8000-000000000002'}},Error('billing-unavailable'),''],
  ['reconcile',pro,Error('sign-in'),''],
  ['cancel',cancelled,Error('billing-unavailable'),'cancelled'],
  ['cancel',{...cancelled,reviewRequired:true},Error('billing-unavailable'),'cancelled'],
  ['cancel',pro,Error('billing-unavailable'),''],
  ['cancel',{...cancelled,subscription:{...cancelled.subscription,state:'expired'}},Error('billing-unavailable'),''],
  ['reconcile',null,Error('billing-unavailable'),''],
 ];
 const find=(node,label)=>{
  if(!node||typeof node!=='object')return null;
  if(node.type==='button'&&node.props.children===label)return node;
  for(const child of [node.props?.children].flat(Infinity)){const match=find(child,label);if(match)return match;}
  return null;
 };
 for(const [action,next,failure,notice] of cases){
  const m={exports:{}},calls=[],state=[true,active,'JPY',true,id,false,'',''];let index=0;
  new Function('require','module','exports',compiled)(name=>{
   if(name==='react')return {...require(name),useState:initial=>{const i=index++;if(!(i in state))state[i]=initial;return [state[i],v=>{state[i]=v;}];},useRef:initial=>({current:initial}),useEffect:()=>{}};
   if(name==='../../identity-provider')return {useIdentityRefresh:()=>async()=>{}};
   if(name==='../../use-research-language')return {useResearchLanguage:()=>['ja',()=>{}]};
   if(name==='@/lib/membership/billing-client')return {billingSummary,billingRequest:async name=>{calls.push(name);if(name===action)throw failure;if(name==='status')return next;assert.fail('unexpected request');}};
   if(name==='next/link'||name==='../../research-tool-shell'||name.endsWith('.module.css'))return {default:()=>null};
   return require(name);
  },m,m.exports);
  find(m.exports.default(),action==='cancel'?'テスト契約を解約':'支払いを確認').props.onClick();
  await new Promise(r=>setImmediate(r));
  assert.deepEqual(calls,[action,'status']);assert.equal(state[7],notice);
  assert.equal(state[6],notice?'':failure.message);assert.deepEqual(state[1],next);
  assert.equal(state[0],false,'readiness is not inferred from status recovery');
  if(notice==='cancelled')assert.equal(state[4],null);
 }
});
