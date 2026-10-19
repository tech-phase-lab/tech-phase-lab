import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecoveryCheck } from '../lib/resolute/recovery-check.ts';
import { OWNER_ACCOUNT_ID } from '../lib/membership/entitlements.ts';
const now=Date.parse('2026-10-20T00:00:00Z');
const env={VERCEL_ENV:'preview',RESOLUTE_RECOVERY_CHECK_ENABLED:'true',
 RESOLUTE_RECOVERY_CHECK_UNTIL:new Date(now+600000).toISOString(),
 RESOLUTE_RECOVERY_CHECK_URL:'https://isolated.up.railway.app',
 RESOLUTE_RECOVERY_CHECK_SERVICE_TOKEN:'s'.repeat(64),RESOLUTE_API_URL:'https://main.up.railway.app',RESOLUTE_API_SERVICE_TOKEN:'m'.repeat(64)};
const names=['authenticatedSession','isolatedDatabase','staleBackupVerified','independentReadback','firstReplay','secondReplay','planErased','notificationsStopped','pendingQueueEmpty'];
const proof=()=>({state:'verified',requestId:'fixture-id',verifiedAt:new Date(now).toISOString(),checks:Object.fromEntries(names.map(n=>[n,true])),productionTouched:false,mailSent:false,livePayment:false,aiCalled:false});
const origin='https://preview.example.test';
const input=(options={})=>new Request(origin+'/api/resolute/recovery-check',{method:'POST',headers:{origin,'x-resolute-recovery-check':'1'},...options});
function fixture(options={}) {
 const calls={session:0,token:0,request:0};
 const run=createRecoveryCheck({env,now:()=>now,id:()=>'fixture-id',
  session:async()=>{calls.session++;return {userId:OWNER_ACCOUNT_ID,getToken:async()=>{calls.token++;return 'signed.session.jwt';}};},
  request:async()=>{calls.request++;return Response.json(proof());},...options});
 return {run,calls};
}
test('recovery check remains disabled outside the explicit short preview window before identity or network access',async()=>{
 for(const change of [{VERCEL_ENV:'production'},{VERCEL_ENV:undefined},{RESOLUTE_RECOVERY_CHECK_ENABLED:undefined},
  {RESOLUTE_RECOVERY_CHECK_UNTIL:'bad'},{RESOLUTE_RECOVERY_CHECK_UNTIL:new Date(now).toISOString()},
  {RESOLUTE_RECOVERY_CHECK_UNTIL:new Date(now+3600001).toISOString()}]){
  const {run,calls}=fixture({env:{...env,...change}});
  assert.equal((await run(input())).status,404);assert.deepEqual(calls,{session:0,token:0,request:0});
 }
});
test('recovery check rejects cross-origin requests, selectors and supplied fixtures without executing',async()=>{
 const {run,calls}=fixture();
 for(const request of [input({method:'GET'}),input({headers:{origin:'https://attacker.test','x-resolute-recovery-check':'1'}}),
  input({headers:{origin}}),new Request(origin+'/api/resolute/recovery-check?user=other',{method:'POST',headers:{origin,'x-resolute-recovery-check':'1'}}),
  input({body:JSON.stringify({userId:OWNER_ACCOUNT_ID,sql:'anything'})})]) assert.notEqual((await run(request)).status,200);
 assert.deepEqual(calls,{session:0,token:0,request:0});
});
test('only the authenticated owner can obtain or forward a session',async()=>{
 for(const userId of [null,'user_other','admin','pro']){
  let tokens=0;const {run,calls}=fixture({session:async()=>({userId,getToken:async()=>{tokens++;return 'secret';}})});
  assert.equal((await run(input())).status,userId===null?401:403);assert.equal(tokens,0);assert.equal(calls.request,0);
 }
});
test('separate valid destination and credential are mandatory; no fallback to production',async()=>{
 for(const change of [{RESOLUTE_RECOVERY_CHECK_URL:undefined},{RESOLUTE_RECOVERY_CHECK_URL:'http://isolated.up.railway.app'},
  {RESOLUTE_RECOVERY_CHECK_URL:env.RESOLUTE_API_URL},{RESOLUTE_RECOVERY_CHECK_URL:'https://evil.test'},
  {RESOLUTE_RECOVERY_CHECK_URL:'https://isolated.up.railway.app:444'},
  {RESOLUTE_RECOVERY_CHECK_URL:'https://secret@isolated.up.railway.app'},
  {RESOLUTE_RECOVERY_CHECK_URL:'https://isolated.up.railway.app/path'},
  {RESOLUTE_RECOVERY_CHECK_URL:'https://isolated.up.railway.app/?x=1'},
  {RESOLUTE_RECOVERY_CHECK_URL:'https://isolated.up.railway.app/#x'},
  {RESOLUTE_API_URL:undefined},{RESOLUTE_RECOVERY_CHECK_SERVICE_TOKEN:env.RESOLUTE_API_SERVICE_TOKEN},
  {RESOLUTE_RECOVERY_CHECK_SERVICE_TOKEN:'short'}]){
  const {run,calls}=fixture({env:{...env,...change}});assert.equal((await run(input())).status,503);
  assert.deepEqual(calls,{session:0,token:0,request:0});
 }
});
test('owner forwarding uses a server session, one request, fresh nonce and a bounded redacted evidence response',async()=>{
 let sent=0;
 const {run}=fixture({request:async(url,init)=>{
  sent++;assert.equal(url.href,'https://isolated.up.railway.app/internal/v1/recovery-check');
  assert.equal(init.headers.Authorization,'Bearer signed.session.jwt');
  assert.equal(init.headers['X-Resolute-Service-Token'],env.RESOLUTE_RECOVERY_CHECK_SERVICE_TOKEN);
  assert.deepEqual(JSON.parse(init.body),{requestId:'fixture-id'});assert.equal(init.redirect,'error');
  assert.equal(init.cache,'no-store');assert.ok(init.signal instanceof AbortSignal);
  return Response.json({...proof(),privateKey:'never expose',rawLogs:'never expose'});
 }});
 const result=await run(input());assert.equal(result.status,200);assert.deepEqual(await result.json(),proof());
 assert.equal(result.headers.get('cache-control'),'private, no-store');assert.equal(sent,1);
});
test('missing, stale, unsafe or mismatched evidence and network failures cannot become success or retry',async()=>{
 const bad=[{requestId:'old-id'},{verifiedAt:new Date(now-6000).toISOString()},{verifiedAt:new Date(now+6000).toISOString()},
  {productionTouched:true},{mailSent:true},{livePayment:true},{aiCalled:true},{state:'ready'},
  ...names.map(name=>({checks:{...proof().checks,[name]:false}}))];
 const results=[...bad.map(value=>()=>Response.json({...proof(),...value})),()=>Response.json({}, {status:503}),
  ()=>new Response('secret'),()=>new Response('broken',{headers:{'content-type':'application/json'}}),
  ()=>new Response('x'.repeat(4097),{headers:{'content-type':'application/json'}}),()=>{throw Error('secret connection');}];
 for(const result of results){let attempts=0;const {run}=fixture({request:async()=>{attempts++;return result();}});
  const response=await run(input());assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'RECOVERY_CHECK_UNAVAILABLE'});assert.equal(attempts,1);}
});
test('expiration during authentication or execution and unavailable sessions fail closed',async()=>{
 for(const getToken of [async()=>null,async()=>{throw Error('secret');},async()=> 'x'.repeat(16385)]){
  const {run,calls}=fixture({session:async()=>({userId:OWNER_ACCOUNT_ID,getToken})});
  assert.equal((await run(input())).status,503);assert.equal(calls.request,0);
 }
 let time=now;const {run,calls}=fixture({now:()=>time,session:async()=>{time=now+600000;return {userId:OWNER_ACCOUNT_ID,getToken:async()=> 'token'};}});
 assert.equal((await run(input())).status,503);assert.equal(calls.request,0);
 time=now;const late=fixture({now:()=>time,request:async()=>{time=now+600000;return Response.json(proof());}});
 assert.equal((await late.run(input())).status,503);
});
