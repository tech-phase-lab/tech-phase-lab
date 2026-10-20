import test from 'node:test';
import assert from 'node:assert/strict';
import { billingGateway,billingBackend,transportConfig } from '../services/tech-phase-billing/transport.mjs';
const token='s'.repeat(48),ownerId='user_owner';
const env={VERCEL_ENV:'preview',TECH_PHASE_BILLING_SANDBOX_ENABLED:'true',TECH_PHASE_PAYPAL_ENV:'sandbox',TECH_PHASE_BILLING_SERVICE_TOKEN:token,TECH_PHASE_BILLING_SERVICE_URL:'https://pro-test.up.railway.app'};
const backendEnv={...env,TECH_PHASE_BILLING_RUNTIME:'railway-sandbox',RAILWAY_GIT_BRANCH:'codex/research-preview'};
const request=(action,body,headers={})=>new Request(`https://preview.example/api/${action}`,{method:body===undefined?'GET':'POST',headers:{origin:'https://preview.example','content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
test('public notification route keeps purchase closed and requires signature verification',async()=>{
 let calls=0;
 const config={...backendEnv,TECH_PHASE_BILLING_SANDBOX_ENABLED:'false',TECH_PHASE_BILLING_SANDBOX_WEBHOOK_ENABLED:'true'};
 const backend=billingBackend({env:config,ownerId,services:()=>({webhook:async(headers)=>{
  calls++;if(headers.get('paypal-transmission-sig')!=='valid-test-signature')throw Error('INVALID_SIGNATURE');
  return {status:'ignored'};
 }})});
 const notify=(path='/webhooks/paypal/sandbox',body='{}',headers={})=>new Request('https://internal.test'+path,{method:'POST',headers:{'content-type':'application/json',...headers},body});
 assert.equal((await backend(notify())).status,401);
 assert.equal((await backend(notify(undefined,'{}',{'paypal-transmission-sig':'valid-test-signature'}))).status,200);
 assert.equal((await backend(notify(undefined,'{"padding":"'+'x'.repeat(131072)+'"}'))).status,400);
 assert.equal((await backend(new Request('https://internal.test/webhooks/paypal/sandbox'))).status,405);
 for(const path of ['/webhooks/paypal/sandbox?extra=1','/webhooks/paypal/sandbox/','/sandbox/create','/sandbox/webhook'])assert.equal((await backend(notify(path))).status,401);
 assert.equal((await backend(notify('/sandbox/create','{}',{authorization:`Bearer ${token}`,'x-tech-phase-user':ownerId}))).status,503);
 for(const change of [{TECH_PHASE_BILLING_SANDBOX_WEBHOOK_ENABLED:'false'},{TECH_PHASE_PAYPAL_ENV:'live'},{RAILWAY_GIT_BRANCH:'main'}]){
  const guarded=billingBackend({env:{...config,...change},ownerId,services:()=>assert.fail('disabled route initialized services')});
  assert.equal((await guarded(notify())).status,503);
 }
 assert.equal(calls,2);
});
test('gateway verifies owner and origin then backend receives only trusted identity',async()=>{
 let user=ownerId,calls=0;
 const backend=billingBackend({env:backendEnv,ownerId,services:()=>({checkout:{start:async(...args)=>{calls++;return {args};}}})});
 const gateway=billingGateway({env,ownerId,identity:async()=>user,fetcher:async(url,options)=>{
  assert.equal(options.redirect,'error');assert.equal(options.headers.get('cookie'),null);
  assert.equal(options.headers.get('x-tech-phase-user'),ownerId);
  return backend(new Request(url,options));
 }});
 const r=await gateway(request('create',{currency:'JPY',acceptedTerms:'sandbox-v1'},{cookie:'private','x-tech-phase-user':'victim',authorization:'Bearer forged'}),'create');
 assert.equal(r.status,200);assert.deepEqual((await r.json()).args,[ownerId,'JPY','sandbox-v1']);
 user='other';assert.equal((await gateway(request('status'),'status')).status,403);
 user=null;assert.equal((await gateway(request('status'),'status')).status,401);user=ownerId;
 assert.equal((await gateway(request('create',{}, {origin:'https://evil.example'}),'create')).status,403);
 assert.equal(calls,1);
});
test('backend rejects direct callers and wrong deployment branch before service initialization',async()=>{
 let calls=0;const config={...backendEnv};const backend=billingBackend({env:config,ownerId,services:()=>{calls++;}});
 const req=auth=>new Request('https://internal.test/sandbox/status',{headers:{authorization:auth,'x-tech-phase-user':ownerId}});
 for(const auth of ['', 'Bearer forged'])assert.equal((await backend(req(auth))).status,401);
 config.RAILWAY_GIT_BRANCH='main';assert.equal((await backend(req(`Bearer ${token}`))).status,503);
 assert.equal(calls,0);
});
test('gateway and backend retain signed webhook verification and bound incoming data',async()=>{
 let verified=0;
 const backend=billingBackend({env:backendEnv,ownerId,services:()=>({webhook:async(headers,event)=>{assert.equal(headers.get('paypal-transmission-id'),'signed-id');assert.equal(event.id,'WH-1');verified++;return {status:'ignored'};}})});
 const gateway=billingGateway({env,ownerId,identity:async()=>assert.fail('webhooks do not use Clerk'),fetcher:(url,options)=>backend(new Request(url,options))});
 assert.equal((await gateway(request('webhook',{id:'WH-1'},{'paypal-transmission-id':'signed-id'}),'webhook')).status,200);
 assert.equal((await gateway(request('webhook',{padding:'x'.repeat(131073)}),'webhook')).status,400);
 assert.equal(verified,1);
});
test('transport refuses unsafe destinations and masks failures; readiness works with sales disabled',async()=>{
 for(const url of ['http://pro-test.up.railway.app','https://evil.example','https://pro-test.up.railway.app/path','https://name:pass@pro-test.up.railway.app','https://pro-test.up.railway.app?secret=1'])assert.throws(()=>transportConfig({...env,TECH_PHASE_BILLING_SERVICE_URL:url}));
 const gateway=billingGateway({env:{VERCEL_ENV:'preview'},ownerId,identity:async()=>ownerId,fetcher:()=>assert.fail('unconfigured')});
 const result=await gateway(request('readiness'),'readiness');assert.equal(result.status,200);assert.equal((await result.json()).configurationReady,false);
 const failure=billingGateway({env,ownerId,identity:async()=>ownerId,fetcher:()=>{throw Error('private-provider-secret');}});
 assert.deepEqual(await (await failure(request('status'),'status')).json(),{error:'billing-unavailable'});
});
