import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRecoveryHandler, filePermit } from '../services/resolute-recovery/handler.mjs';
import { authConfig } from '../services/resolute-api/auth.mjs';
import { OWNER_ACCOUNT_ID } from '../lib/membership/entitlements.ts';
const origin='https://preview.example.test',issuer='https://fixture.clerk.accounts.dev';
const secret='s'.repeat(64), now=()=>Date.now();
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const config=authConfig({RESOLUTE_API_SERVICE_TOKEN:secret,RESOLUTE_CLERK_ISSUER:issuer,
 RESOLUTE_CLERK_AUTHORIZED_PARTIES:JSON.stringify([origin]),RESOLUTE_CLERK_JWT_PUBLIC_KEY:publicKey.export({type:'spki',format:'pem'})});
function jwt(user,change={}){
 const time=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
 const payload=Buffer.from(JSON.stringify({iss:issuer,azp:origin,sub:user,sid:'sess_fixture',exp:time+60,nbf:time-1,iat:time-1,...change})).toString('base64url');
 return `${header}.${payload}.${sign('RSA-SHA256',Buffer.from(`${header}.${payload}`),privateKey).toString('base64url')}`;
}
const proof=()=>({...Object.fromEntries(['isolatedDatabase','staleBackupVerified','independentReadback','firstReplay','secondReplay','planErased','notificationsStopped','pendingQueueEmpty'].map(k=>[k,true])),productionTouched:false,mailSent:false,livePayment:false,aiCalled:false});
const request=(body={requestId:randomUUID()},token=jwt(OWNER_ACCOUNT_ID),service=secret)=>new Request('https://isolated.up.railway.app/internal/v1/recovery-check',{method:'POST',headers:{authorization:`Bearer ${token}`,'x-resolute-service-token':service,'content-type':'application/json'},body:JSON.stringify(body)});
const options=()=>({config,enabled:true,until:new Date(now()+600000).toISOString(),claim:async()=>true,execute:async()=>proof()});

test('coordinator verifies actual signatures, issuer, party, owner and service credential before claiming',async()=>{
 let claims=0;const run=createRecoveryHandler({...options(),claim:async()=>{claims++;return true;}});
 for(const [token,service,status] of [['invalid.jwt.signature',secret,401],[jwt(OWNER_ACCOUNT_ID), 'wrong',401],
  [jwt('user_other'),secret,403],[jwt(OWNER_ACCOUNT_ID,{exp:1}),secret,401],
  [jwt(OWNER_ACCOUNT_ID,{azp:'https://other.example.test'}),secret,401],[jwt(OWNER_ACCOUNT_ID,{iss:'https://other.clerk.accounts.dev'}),secret,401]]){
  assert.equal((await run(request(undefined,token,service))).status,status);
 }
 assert.equal(claims,0);assert.equal((await run(request())).status,200);assert.equal(claims,1);
});
test('disabled and expired coordinator performs no authentication or work',async()=>{
 for(const change of [{enabled:false},{until:'invalid'},{until:new Date(now()-1).toISOString()},{until:new Date(now()+7200000).toISOString()}]){
  const run=createRecoveryHandler({...options(),...change,verify:()=>{throw Error('must not authenticate');}});
  assert.equal((await run(request())).status,404);
 }
});
test('only a bounded nonce is accepted; arbitrary execution inputs cannot consume the permit',async()=>{
 let calls=0;const run=createRecoveryHandler({...options(),claim:async()=>{calls++;return true;}});
 for(const body of [null,{},[],{requestId:'bad'},{requestId:randomUUID(),sql:'select'},{requestId:'x'.repeat(1000)}])
  assert.notEqual((await run(request(body))).status,200);
 assert.equal(calls,0);assert.equal((await run(request())).status,200);
});
test('concurrent requests consume one permit and a lost or failed run cannot be repeated',async()=>{
 let release,calls=0;const pending=new Promise(resolve=>{release=resolve;});
 const run=createRecoveryHandler({...options(),execute:async()=>{calls++;await pending;throw Error('secret log');}});
 const first=run(request());
 // Wait until execution begins, without assuming authentication is synchronous.
 // Bounded by time, not by a tick count: signature verification can take longer than 100 ticks on a busy machine.
 for(const deadline=Date.now()+5000;calls===0&&Date.now()<deadline;)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls,1);assert.equal((await run(request())).status,409);release();
 assert.deepEqual(await (await first).json(),{error:'RECOVERY_CHECK_UNAVAILABLE'});
 assert.equal((await run(request())).status,409);assert.equal(calls,1);
});
test('exclusive private permit survives coordinator reconstruction and never contains a token',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'resolute-permit-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'consumed.json'),id=randomUUID();
 const first=createRecoveryHandler({...options(),claim:filePermit(path)});
 assert.equal((await first(request({requestId:id}))).status,200);
 const restarted=createRecoveryHandler({...options(),claim:filePermit(path),execute:()=>{throw Error('must not run');}});
 assert.equal((await restarted(request())).status,409);
 assert.equal((await stat(path)).mode&0o777,0o600);
 assert.deepEqual(JSON.parse(await readFile(path,'utf8')),{requestId:id});
});
test('incomplete or unsafe evidence fails closed and extra fields never reach the browser',async()=>{
 for(const name of Object.keys(proof())){
  const run=createRecoveryHandler({...options(),execute:async()=>({...proof(),[name]:undefined})});
  assert.equal((await run(request())).status,503);
 }
 const id=randomUUID(),run=createRecoveryHandler({...options(),execute:async()=>({...proof(),rawLogs:'secret'})});
 const response=await run(request({requestId:id})),report=await response.json();
 assert.equal(response.status,200);assert.equal(report.requestId,id);assert.equal(report.checks.authenticatedSession,true);
 assert.equal(report.rawLogs,undefined);assert.equal(response.headers.get('cache-control'),'private, no-store');
});
test('expiry during authentication or execution cannot start late or report success',async()=>{
 const start=now();let clock=start,executions=0;
 const opts={...options(),until:new Date(start+1000).toISOString(),now:()=>clock};
 const authExpired=createRecoveryHandler({...opts,verify:async()=>{clock=start+2000;return OWNER_ACCOUNT_ID;},execute:async()=>{executions++;return proof();}});
 assert.equal((await authExpired(request())).status,404);assert.equal(executions,0);
 clock=start;const run=createRecoveryHandler({...opts,execute:async()=>{clock=start+2000;return proof();}});
 assert.equal((await run(request())).status,503);
});
