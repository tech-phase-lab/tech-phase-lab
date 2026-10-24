import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {authenticate,authConfig} from '../services/resolute-api/auth.mjs';
import {createHandler} from '../services/resolute-api/handler.mjs';
import {fetchResoluteEntitlements,validateSnapshot,ResoluteRateLimited} from '../lib/resolute/transport.ts';

const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const secret='s'.repeat(64),issuer='https://example.clerk.accounts.dev',origin='https://preview.example.test';
const config=authConfig({RESOLUTE_API_SERVICE_TOKEN:secret,RESOLUTE_CLERK_ISSUER:issuer,
 RESOLUTE_CLERK_AUTHORIZED_PARTIES:JSON.stringify([origin]),
 RESOLUTE_CLERK_JWT_PUBLIC_KEY:publicKey.export({type:'spki',format:'pem'})});
function token(overrides={},key=privateKey){
 const now=Math.floor(Date.now()/1000);
 const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:'test'})).toString('base64url');
 const p=Buffer.from(JSON.stringify({iss:issuer,azp:origin,sub:'user_test',sid:'sess_test',
   exp:now+60,iat:now-1,nbf:now-1,...overrides})).toString('base64url');
 return `${h}.${p}.${sign('RSA-SHA256',Buffer.from(`${h}.${p}`),key).toString('base64url')}`;
}
const headers=t=>new Headers({Authorization:`Bearer ${t}`,'X-Resolute-Service-Token':secret});
const missing={productId:'resolute_v1',asOf:'2026-10-10T00:00:00.000Z',
 use:{status:'missing',startsAt:null,expiresAt:null},alerts:{status:'missing',startsAt:null,expiresAt:null},
 canUseTools:false,canReceiveNotifications:false};

test('Railway requires service secret and a signed, current, allowed Clerk session',async()=>{
 assert.equal(await authenticate(headers(token()),config),'user_test');
 for(const claims of [{iss:'https://attacker.test'},{azp:'https://attacker.test'},{azp:undefined},
   {sid:undefined},{sub:'user_bad\' OR 1=1'},{exp:1},{nbf:Math.floor(Date.now()/1000)+60},
   {iat:Math.floor(Date.now()/1000)+60},{sts:'pending'}])
   assert.equal(await authenticate(headers(token(claims)),config),null);
 const other=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey;
 assert.equal(await authenticate(headers(token({},other)),config),null);
 const bad=headers(token());bad.set('X-Resolute-Service-Token','bad');
 assert.equal(await authenticate(bad,config),null);
 assert.equal(await authenticate(new Headers(),config),null);
 assert.throws(()=>authConfig({...config,RESOLUTE_CLERK_ISSUER:issuer}));
});
test('internal endpoint scopes identity, rejects selectors and methods, and bounds rate',async()=>{
 const reads=[];const handler=createHandler(config,async id=>{reads.push(id);return missing});
 const request=(suffix='',options={})=>new Request('https://railway.test/internal/v1/entitlements'+suffix,
   {headers:headers(token()),...options});
 assert.equal((await handler(new Request('https://railway.test/internal/v1/entitlements'))).status,401);
 assert.equal((await handler(request('?userId=user_victim'))).status,404);
 assert.equal((await handler(request('',{method:'POST'}))).status,405);
 let res=await handler(request());assert.equal(res.status,200);assert.deepEqual(reads,['user_test']);
 assert.deepEqual(await res.json(),missing);assert.equal(res.headers.get('cache-control'),'private, no-store');
 for(let i=1;i<60;i++)assert.equal((await handler(request())).status,200);
 res=await handler(request());assert.equal(res.status,429);assert.equal(res.headers.get('retry-after'),'60');
 const failed=createHandler(config,async()=>{throw Error('postgres://secret')});
 res=await failed(request());assert.equal(res.status,503);assert.deepEqual(await res.json(),{error:'ENTITLEMENT_UNAVAILABLE'});
});
test('Vercel transport forwards JWT only to fixed HTTPS endpoint, retries reads and fails closed',async()=>{
 let count=0;
 const fetcher=async(url,options)=>{
  assert.equal(url.href,'https://resolute.up.railway.app/internal/v1/entitlements');
  assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
  assert.equal(options.headers.Authorization,'Bearer verified');
  assert.equal(options.headers['X-Resolute-Service-Token'],secret);
  count++;return count===1?new Response('',{status:502}):Response.json({...missing,privateField:'hidden'});
 };
 assert.deepEqual(await fetchResoluteEntitlements('verified','https://resolute.up.railway.app',secret,fetcher),missing);
 assert.equal(count,2);
 for(const url of ['http://resolute.up.railway.app','https://evil.test','https://resolute.up.railway.app/?id=1'])
  await assert.rejects(()=>fetchResoluteEntitlements('verified',url,secret,fetcher));
 for(const result of [Response.json(missing,{status:401}),Response.json(missing,{status:403}),
   Response.json({...missing,canUseTools:true}),Response.json({...missing,productId:'other'}),
   new Response('x'.repeat(8193),{headers:{'Content-Type':'application/json'}}),
   new Response('not-json',{headers:{'Content-Type':'application/json'}})])
  await assert.rejects(()=>fetchResoluteEntitlements('verified','https://resolute.up.railway.app',secret,async()=>result));
 await assert.rejects(()=>fetchResoluteEntitlements('verified','https://resolute.up.railway.app',secret,
   async()=>new Response('',{status:429})),ResoluteRateLimited);
 assert.throws(()=>validateSnapshot({...missing,alerts:{status:'active',startsAt:null,expiresAt:null}}));
});
