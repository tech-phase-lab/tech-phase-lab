import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentHttp } from '../services/resolute-api/payments/http.mjs';
import { livePaymentRuntime } from '../services/resolute-api/payments/live-runtime.mjs';
const req=(path,method='GET') => new Request('https://internal.test'+path,{method,
  ...(method==='POST'?{headers:{'Content-Type':'application/json'},body:'{}'}:{})});

test('disabled live runtime never opens credentials or DB; Sandbox is a separate namespace',async()=>{
  let calls=0;
  const handler=livePaymentRuntime({}, {}, ()=>{calls++;throw Error('must not initialize');});
  for(const path of ['/internal/v1/live-payments/access','/internal/v1/live-payments/orders','/webhooks/paypal-live'])
    assert.equal((await handler(req(path))).status,503);
  for(const path of ['/internal/v1/payments/orders','/webhooks/paypal','/internal/v1/live-payments-other'])
    assert.equal(await handler(req(path)),null);
  assert.equal(calls,0);
});

test('live HTTP admits signed members, uses authenticated access identity, restricts audit and rejects overrides',async()=>{
  const calls=[];
  const make=user=>paymentHttp({environment:'live',enabled:true,allowedUsers:null,auditUsers:['owner'],
    authenticate:async()=>user,store:{auditList:async()=>{calls.push('audit');return [];}},
    access:async id=>{calls.push(id);return {canUseTools:true};},engine:{}});
  assert.equal((await make(null)(req('/internal/v1/live-payments/access'))).status,401);
  assert.equal((await make('member')(req('/internal/v1/live-payments/audit'))).status,403);
  assert.equal((await make('member')(req('/internal/v1/live-payments/access?user=owner'))).status,400);
  assert.equal((await make('member')(req('/internal/v1/live-payments/access'))).status,200);
  assert.equal((await make('owner')(req('/internal/v1/live-payments/audit'))).status,200);
  assert.deepEqual(calls,['member','audit']);
  assert.equal(await make('member')(req('/internal/v1/payments/access')),null);
  assert.equal(await make('member')(req('/webhooks/paypal','POST')),null);
});

test('verified live webhook remains routed while purchases are disabled; wrong method cannot invoke engine',async()=>{
  let calls=0;
  const handler=paymentHttp({environment:'live',enabled:false,allowedUsers:null,store:{},
    authenticate:async()=>{throw Error('webhook must use provider verification');},
    engine:{webhook:async()=>{calls++;return {verified:true};}}});
  assert.equal((await handler(req('/internal/v1/live-payments/orders','POST'))).status,503);
  assert.equal((await handler(req('/webhooks/paypal-live'))).status,405);
  assert.equal((await handler(req('/webhooks/paypal-live','POST'))).status,200);
  assert.equal(calls,1);
});

test('live frontend proxy fails closed and forwards only signed same-origin requests to fixed live namespace',async()=>{
  const {build}=await import('esbuild');
  const {mkdtemp,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {pathToFileURL}=await import('node:url');
  const dir=await mkdtemp(join(tmpdir(),'resolute-live-proxy-'));
  const keys=['RESOLUTE_PAYPAL_LIVE_ENABLED','RESOLUTE_LIVE_SALES_ENABLED','RESOLUTE_API_URL','RESOLUTE_API_SERVICE_TOKEN'];
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const originalFetch=globalThis.fetch;
  try {
    await build({entryPoints:['app/api/resolute/live-payments/[...action]/route.ts'],outfile:join(dir,'route.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'identity-fixture',setup(b){
      b.onResolve({filter:/^next\/headers$/},()=>({path:'cookies',namespace:'fixture'}));
      b.onResolve({filter:/^@clerk\/nextjs\/server$/},()=>({path:'clerk',namespace:'fixture'}));
      b.onResolve({filter:/^@\/lib\/membership\/entitlements$/},()=>({path:'member',namespace:'fixture'}));
      b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='cookies'?'export async function cookies(){return {get(){return undefined}}}':a.path==='clerk'?'export async function auth(){return {userId:"member",getToken:async()=>"signed-token"}}':'export const OWNER_ACCOUNT_ID="owner"'}));
    }}]});
    const route=await import(pathToFileURL(join(dir,'route.mjs')));
    const context={params:Promise.resolve({action:['orders']})};
    const post=(origin='https://site.test')=>new Request('https://site.test/api/resolute/live-payments/orders',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{}'});
    let calls=0;
    globalThis.fetch=async(url,options)=>{calls++;assert.equal(url.pathname,'/internal/v1/live-payments/orders');assert.equal(options.headers.Authorization,'Bearer signed-token');return Response.json({sandbox:false});};
    delete process.env.RESOLUTE_PAYPAL_LIVE_ENABLED;
    assert.equal((await route.POST(post(),context)).status,503);
    process.env.RESOLUTE_PAYPAL_LIVE_ENABLED='true';
    delete process.env.RESOLUTE_LIVE_SALES_ENABLED;
    assert.equal((await route.POST(post(),context)).status,503);
    process.env.RESOLUTE_LIVE_SALES_ENABLED='true';
    process.env.RESOLUTE_API_URL='https://fixed.up.railway.app';
    process.env.RESOLUTE_API_SERVICE_TOKEN='x'.repeat(43);
    assert.equal((await route.POST(post('https://other.test'),context)).status,403);
    assert.equal(calls,0);
    assert.equal((await route.POST(post(),context)).status,200);
    assert.equal(calls,1);
  } finally {
    globalThis.fetch=originalFetch;
    for(const k of keys) if(old[k]===undefined) delete process.env[k];else process.env[k]=old[k];
    await rm(dir,{recursive:true,force:true});
  }
});
