import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {billingReturn,billingSummary,sandboxApproval,billingRequest} from '../lib/membership/billing-client.ts';
const id='00000000-0000-4000-8000-000000000001';
test('initial checkout render has no purchase or cancellation action before server status',()=>{
 const require=createRequire(import.meta.url);
 const source=readFileSync(new URL('../app/research/account/billing/screen.tsx',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const m={exports:{}};let language='ja';
 new Function('require','module','exports',compiled)(name=>{
  if(name.endsWith('.module.css'))return {default:{}};
  if(name==='next/link')return {default:({children,...props})=>createElement('a',props,children)};
  if(name==='../../research-tool-shell')return {default:({children})=>children};
  if(name==='../../use-research-language')return {useResearchLanguage:()=>[language,()=>{}]};
  if(name==='../../identity-provider')return {useIdentityRefresh:()=>async()=>{}};
  if(name==='@/lib/membership/billing-client')return {billingRequest:()=>assert.fail('render must not fetch')};
  return require(name);
 },m,m.exports);
 for(language of ['ja','en']){
  const html=renderToStaticMarkup(createElement(m.exports.default));
  assert.match(html,/PayPal Sandbox/);assert.match(html,/aria-busy="true"/);
  assert.doesNotMatch(html,/<fieldset|<select|type="checkbox"/);
  assert.match(html,/<button[^>]*disabled/);
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
 for(const bad of [{...good,environment:'live'},{...good,plan:'active'},{...good,proExpiresAt:'tomorrow'},{...good,subscription:{id:'other',currency:'JPY',state:'active'}}])assert.throws(()=>billingSummary(bad));
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
