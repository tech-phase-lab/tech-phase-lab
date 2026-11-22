import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createThermometerRead} from '../services/resolute-api/thermometer-read.mjs';
import {createHandler} from '../services/resolute-api/handler.mjs';
import {fetchThermometerSnapshot,parseThermometerResponse} from '../lib/resolute/thermometer-transport.ts';
import {PRODUCTION_OWNER_ACCOUNT_ID} from '../lib/membership/entitlements.ts';
import {OWNER_ISSUER,OWNER_ORIGIN,hasOwnerAccess,ownerAccessFromVerifiedSession,ownerAccessSnapshot} from '../lib/resolute/owner-access.ts';
// 相場の温度計 read path: Vercel → resolute-api → read-only reader role (no public DB proxy).
const now=new Date('2026-10-26T21:00:00Z');
const reading=index=>({status:'ready',version:'daily-close-v1',index,asOf:'2026-10-26',referenceFrom:'2016-10-26',observations:2500,score:50,band:2,drawdownPercent:-10,deviationPercent:5,drawdownPercentile:30,deviationPercentile:70});
const stored=()=>({asOf:'2026-10-26',nas100:reading('nas100'),sox:reading('sox'),vix:{status:'ready',asOf:'2026-10-26',level:20,percentile:55}});
const reader='postgresql://resolute_thermometer_reader:fixture-only@postgres.railway.internal:5432/resolute';
const env={RESOLUTE_THERMOMETER_READ_ENABLED:'1',RESOLUTE_THERMOMETER_READ_DATABASE_URL:reader};
const tools={canUseTools:true},none={canUseTools:false};
const req=(method='GET')=>new Request('https://railway.test/internal/v1/thermometer',{method});
async function fixture(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(await readFile(new URL('../scripts/resolute/thermometer-schema.sql',import.meta.url),'utf8'));
 await db.query('INSERT INTO resolute_thermometer_snapshots(session_date,snapshot) VALUES ($1,$2::jsonb)',['2026-10-26',JSON.stringify({...stored(),secret:'never forward'})]);
 let pools=0,queries=0;
 const poolFactory=config=>{pools++;assert.equal(config.max,1);assert.equal(new URL(config.connectionString).username,'resolute_thermometer_reader');
  return {query:async(...args)=>{queries++;return db.query(...args);}};};
 return {options:{poolFactory,clock:()=>now},pools:()=>pools,queries:()=>queries};
}
test('disabled unless the flag and the reader URL are both set; only the read-only role is accepted',()=>{
 assert.equal(createThermometerRead({}),undefined);
 assert.equal(createThermometerRead({RESOLUTE_THERMOMETER_READ_DATABASE_URL:reader}),undefined);
 assert.equal(createThermometerRead({...env,RESOLUTE_THERMOMETER_READ_ENABLED:'true'}),undefined);
 assert.equal(createThermometerRead({RESOLUTE_THERMOMETER_READ_ENABLED:'1'}),undefined);
 assert.throws(()=>createThermometerRead({...env,RESOLUTE_THERMOMETER_READ_DATABASE_URL:reader.replace('resolute_thermometer_reader','resolute_thermometer_writer')}));
 assert.throws(()=>createThermometerRead({...env,RESOLUTE_THERMOMETER_READ_DATABASE_URL:reader.replace('/resolute','/railway')}));
});
test('entitlement is checked before storage; the stored snapshot is sanitized and carries its expiry',async t=>{
 const f=await fixture(t),read=createThermometerRead(env,f.options);
 let res=await read(req(),'user_free',async()=>none);
 assert.equal(res.status,403);assert.equal(f.pools(),0);assert.equal(f.queries(),0);
 assert.equal((await read(req('POST'),'user_member',async()=>tools)).status,405);assert.equal(f.queries(),0);
 res=await read(req(),'user_member',async()=>tools);
 assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'private, no-store');
 const body=await res.json();
 assert.equal(body.asOf,'2026-10-26');assert.equal(body.nas100.status,'ready');assert.equal(body.secret,undefined);
 assert.equal(body.validUntil,Date.parse('2026-10-27T21:00:00Z'));
 await read(req(),'user_member',async()=>tools);assert.equal(f.pools(),1);
});
test('storage failure fails closed without leaking the error',async()=>{
 const read=createThermometerRead(env,{clock:()=>now,poolFactory:()=>({query:async()=>{throw Error('postgres://secret');}})});
 const body=await (await read(req(),'user_member',async()=>tools)).json();
 assert.equal(body.nas100.reason,'storage-unavailable');assert.doesNotMatch(JSON.stringify(body),/secret/);
});
test('handler routes GET only, requires a session, 503 when disabled, owner always allowed',async t=>{
 const f=await fixture(t),read=createThermometerRead(env,f.options);
 // The owner has no purchase: access comes from the MFA-verified production session (owner-access.ts).
 const grant=ownerAccessFromVerifiedSession({sub:PRODUCTION_OWNER_ACCOUNT_ID,iss:OWNER_ISSUER,azp:OWNER_ORIGIN,fva:[0,0],exp:Math.floor(Date.now()/1000)+60});
 const owner=createHandler({},async(id,access)=>hasOwnerAccess(access,id)?ownerAccessSnapshot(access,id):none,async()=>({userId:PRODUCTION_OWNER_ACCOUNT_ID,ownerAccess:grant}),undefined,undefined,undefined,undefined,undefined,undefined,undefined,read);
 assert.equal((await owner(req())).status,200);
 assert.equal((await owner(req('PUT'))).status,405);
 assert.equal((await owner(new Request('https://railway.test/internal/v1/thermometer?date=2026-10-23'))).status,404);
 const anonymous=createHandler({},async()=>tools,async()=>null,undefined,undefined,undefined,undefined,undefined,undefined,undefined,read);
 assert.equal((await anonymous(req())).status,401);assert.equal(f.queries(),1);
 const disabled=createHandler({},async()=>tools,async()=>'user_member');
 let res=await disabled(req());assert.equal(res.status,503);assert.deepEqual(await res.json(),{error:'THERMOMETER_UNAVAILABLE'});
 const broken=createHandler({},async()=>{throw Error('postgres://secret');},async()=>'user_member',undefined,undefined,undefined,undefined,undefined,undefined,undefined,read);
 res=await broken(req());assert.equal(res.status,503);assert.deepEqual(await res.json(),{error:'THERMOMETER_UNAVAILABLE'});
});
test('Vercel transport: fixed HTTPS endpoint, bounded body, re-validated snapshot, undefined on any failure',async()=>{
 const secret='s'.repeat(64),base='https://resolute.up.railway.app/',at=now.getTime();
 const answer={...stored(),validUntil:Date.parse('2026-10-27T21:00:00Z'),extra:'drop'};
 let calls=0;
 const fetcher=async(url,options)=>{calls++;
  assert.equal(url.href,'https://resolute.up.railway.app/internal/v1/thermometer');
  assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
  assert.equal(options.headers.Authorization,'Bearer verified');assert.equal(options.headers['X-Resolute-Service-Token'],secret);
  return Response.json(answer);};
 const ok=await fetchThermometerSnapshot('verified',base,secret,fetcher,()=>at);
 assert.equal(ok.nas100.status,'ready');assert.equal(ok.extra,undefined);assert.equal(ok.validUntil,answer.validUntil);
 for(const [b,s] of [[undefined,secret],[base,undefined],[base,'short'],['http://resolute.up.railway.app/',secret],['https://attacker.test/',secret],[base+'x',secret]])
  assert.equal(await fetchThermometerSnapshot('verified',b,s,fetcher,()=>at),undefined);
 assert.equal(calls,1);
 for(const response of [()=>new Response('{}',{status:403}),()=>Response.json({error:'THERMOMETER_UNAVAILABLE'},{status:503}),()=>new Response('x'.repeat(20000),{headers:{'content-type':'application/json'}}),()=>new Response('<html>'),()=>{throw Error('network');}])
  assert.equal(await fetchThermometerSnapshot('verified',base,secret,async()=>response(),()=>at),undefined);
});
test('response parsing drops missing dates, expired or implausible expiry',()=>{
 const at=now.getTime(),validUntil=Date.parse('2026-10-27T21:00:00Z');
 assert.equal(parseThermometerResponse({...stored(),validUntil},at).sox.status,'ready');
 for(const bad of [null,'x',{...stored()},{...stored(),validUntil:at},{...stored(),validUntil:at+12*86400000},{...stored(),asOf:'',validUntil},{...stored(),asOf:'2026-02-30',validUntil}])
  assert.equal(parseThermometerResponse(bad,at),undefined);
 assert.equal(parseThermometerResponse({...stored(),validUntil},Date.parse('2026-10-28T00:00:00Z')),undefined);
 const partial={...stored(),validUntil,sox:{status:'unavailable',reason:'provider-error'}};
 assert.deepEqual(parseThermometerResponse(partial,at).sox,{status:'unavailable',reason:'provider-error'});
});
