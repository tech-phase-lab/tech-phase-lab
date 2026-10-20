import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';
import {authConfig} from '../services/resolute-api/auth.mjs';
import {createHandler} from '../services/resolute-api/handler.mjs';
import {createApiServer} from '../services/resolute-api/http-server.mjs';
import {createWriter} from '../services/resolute-protection/server.mjs';
import {createPlanStore} from '../lib/resolute/plan-database.ts';
import {createNotificationStore} from '../lib/resolute/notification-database.ts';
import {createPlanRoutes} from '../lib/resolute/plan-route.ts';
import {createNotificationRoutes} from '../lib/resolute/notification-route.ts';
import {fetchResolutePlan} from '../lib/resolute/plan-transport.ts';
import {fetchNotificationSettings} from '../lib/resolute/notification-http.ts';
import {createProtectionPublisher} from '../lib/resolute/protection-ledger.ts';
import {protectionGatewayObjects} from '../lib/resolute/protection-runtime.ts';
import {createProtectionBarrier} from '../lib/resolute/protection-outbox.ts';
import {emptyPlanAnswers} from '../lib/resolute/plan-answers.ts';

const migrations=['001_entitlements.sql','002_plans.sql','003_plan_answers_fx.sql','004_notification_settings.sql','005_notification_outbox.sql','017_notification_suppressions.sql','018_protection_outbox.sql','019_storage_permissions.sql'];
const origin='https://preview.example.test',issuer='https://fixture.clerk.accounts.dev';
const plan={schemaVersion:1,answersVersion:1,answers:emptyPlanAnswers(),fx:{thresholdYen:null,usdJpy:null,note:'synthetic'},currency:'JPY',monthlyLivingCost:250000,savingsMonths:12,reserveMonths:6,nearTermExpense:0,financialAssets:10000000,investedAmount:3000000,investable:8500000,tolerancePct:20,toleranceDrop:600000,perStockCapPct:20,buyMode:'steps',buyLines:[{dropPct:10,amount:100000},{dropPct:20,amount:100000}],buyBudgetPct:10,allocation:'equal',noBuyConditions:[],haltConditions:[],ruleType:'undecided'};
const enabled={deliveryHourJst:7,alertsEnabled:true,morningEnabled:true,watchItems:[{symbol:'MU',referencePrice:100}],surgeCapPct:null};
const stopped={...enabled,alertsEnabled:false,morningEnabled:false};

async function database(name){
 const boot=new PGlite();await boot.exec(`CREATE DATABASE ${name}`);const data=await boot.dumpDataDir();await boot.close();
 const db=new PGlite({database:name,loadDataDir:data});
 await db.exec('CREATE ROLE resolute_plan_writer NOLOGIN NOINHERIT;CREATE ROLE resolute_notification_writer NOLOGIN NOINHERIT');
 for(const file of migrations){
  let sql=readFileSync(new URL('../db/resolute/'+file,import.meta.url),'utf8');
  // Embedded fixture only: install the same schema in the isolated replay DB.
  if(name==='resolute_restore_test')sql=sql.replaceAll("'resolute'","'resolute_restore_test'");
  await db.exec(sql);
 }
 return db;
}
function pool(db,role){
 return {async connect(){await db.exec(`SET ROLE ${role}`);return {
  async query(sql,args){const r=await db.query(sql,args);return {...r,rowCount:sql.trimStart().startsWith('SELECT')?r.rows.length:r.affectedRows};},
  release(){},
 };}};
}
function replay(records,key){
 const result=spawnSync('python3',['-c',`import io,json,sys
from scripts.resolute import protection,protection_events as events
payload=json.load(sys.stdin)
class Objects:
 def __init__(self): self.files={k:bytes.fromhex(v) for k,v in payload['records']}
 def put_object(self,**kw): self.files[kw['Key']]=kw['Body']
 def get_object(self,**kw): return {'Body':io.BytesIO(self.files[kw['Key']])}
 def get_paginator(self,op): return self
 def paginate(self,**kw): return [{'IsTruncated':False,'Contents':[{'Key':k,'Size':len(v),'ETag':str(len(v))} for k,v in self.files.items() if k.startswith(kw['Prefix'])]}]
s3=Objects();key=bytes.fromhex(payload['key']);pin=events.seal_manifest(s3,'fixture',key,protection)
ledger=events.load_manifest(s3,'fixture',key,pin,protection)
print(protection.restore_sql(ledger))`],{input:JSON.stringify({key:key.toString('hex'),records:[...records].map(([k,v])=>[k,v.toString('hex')])}),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);return result.stdout;
}

test('signed session through browser routes, scoped DB, HTTP writer and Python replay preserves deletion and stops across a stale snapshot',async t=>{
 const db=await database('resolute');t.after(()=>db.close());
 const restored=await database('resolute_restore_test');t.after(()=>restored.close());
 const records=new Map();let offline=false;
 const key=randomBytes(32),writerToken=randomBytes(48).toString('base64url');
 const writer=createWriter({key,token:writerToken,objects:{
  async putIfAbsent(name,body){if(offline||records.has(name))throw Error('unavailable');records.set(name,body);},
  async read(name){if(offline||!records.has(name))throw Error('unavailable');return records.get(name);},
 }});
 writer.listen(0,'127.0.0.1');await once(writer,'listening');
 t.after(()=>new Promise(resolve=>{writer.close(resolve);writer.closeAllConnections();}));
 const barrier=createProtectionBarrier(createProtectionPublisher(protectionGatewayObjects(`http://127.0.0.1:${writer.address().port}`,writerToken),key));
 const serviceToken=randomBytes(48).toString('base64url');
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const config=authConfig({RESOLUTE_API_SERVICE_TOKEN:serviceToken,RESOLUTE_CLERK_ISSUER:issuer,RESOLUTE_CLERK_AUTHORIZED_PARTIES:JSON.stringify([origin]),RESOLUTE_CLERK_JWT_PUBLIC_KEY:publicKey.export({type:'spki',format:'pem'})});
 const jwt=user=>{
  const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid:'fixture'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({iss:issuer,azp:origin,sub:user,sid:'sess_fixture',exp:now+300,iat:now-1,nbf:now-1})).toString('base64url');
  return `${header}.${payload}.${sign('RSA-SHA256',Buffer.from(`${header}.${payload}`),privateKey).toString('base64url')}`;
 };
 let session=jwt('user_buyer');
 const handler=createHandler(config,async()=>{throw Error('unexpected entitlement route');},undefined,createPlanStore(pool(db,'resolute_plan_writer'),'legacy',barrier),createNotificationStore(pool(db,'resolute_notification_writer'),'legacy',barrier));
 const api=createApiServer(handler);
 api.listen(0,'127.0.0.1');await once(api,'listening');
 t.after(()=>new Promise(resolve=>{api.close(resolve);api.closeAllConnections();}));
 const apiBase=`http://127.0.0.1:${api.address().port}`;
 // Only remap the deployment origin; requests cross a real socket and the
 // same Node HTTP bridge as production. Production HTTPS validation is intact.
 const transport=(url,init)=>{
  assert.equal(url.origin,'https://api.up.railway.app');
  assert.equal(init.redirect,'error');
  return fetch(apiBase+url.pathname+url.search,init);
 };
 const denied=await fetch(apiBase+'/internal/v1/plan',{headers:{Authorization:`Bearer ${session}`}});
 assert.equal(denied.status,401);await denied.body?.cancel();
 const plans=createPlanRoutes({session:async()=>session,forward:(token,method,mutation)=>fetchResolutePlan(token,'https://api.up.railway.app',serviceToken,method,mutation,transport)});
 const notifications=createNotificationRoutes({session:async()=>session,forward:(token,method,mutation)=>fetchNotificationSettings(token,'https://api.up.railway.app',serviceToken,method,mutation,transport)});
 const call=(routes,method,body)=>routes[method](new Request(origin+'/api/resolute/fixture',{method,headers:{origin,'content-type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body)}));
 await db.exec("INSERT INTO resolute.entitlements(clerk_user_id,product_id,kind,starts_at,source) VALUES('user_buyer','resolute_v1','use','2020-01-01','purchase')");
 session='invalid.signature.token';assert.equal((await call(plans,'GET')).status,401);
 session=jwt('user_other');assert.equal((await call(plans,'GET')).status,403);
 session=jwt('user_buyer');
 assert.equal((await call(plans,'PUT',{baseRevision:0,plan})).status,200);
 assert.equal((await call(notifications,'PUT',{baseRevision:0,settings:enabled})).status,200);
 await db.exec('RESET ROLE');
 await db.exec("INSERT INTO resolute.notification_outbox(idempotency_key,clerk_user_id,kind,delivery_date_jst,payload) VALUES('fixture','user_buyer','alerts','2026-10-19','{}')");
 // Copy the actual API-written rows as the stale fixture, before either stop/delete.
 for(const table of ['plans','notification_settings','notification_outbox']){
  const rows=(await db.query(`SELECT * FROM resolute.${table}`)).rows;
  for(const row of rows){const columns=Object.keys(row);await restored.query(`INSERT INTO resolute.${table}(${columns.join(',')}) VALUES(${columns.map((_,i)=>'$'+(i+1)).join(',')})`,columns.map(k=>row[k] instanceof Date?row[k].toISOString():typeof row[k]==='object'&&row[k]!==null?JSON.stringify(row[k]):row[k]));}
 }
 assert.equal(records.size,0);
 offline=true;
 assert.equal((await call(plans,'DELETE',{baseRevision:1})).status,503);
 assert.equal((await call(notifications,'PUT',{baseRevision:1,settings:stopped})).status,503);
 assert.equal((await call(plans,'GET')).status,503);
 await db.exec('RESET ROLE');
 assert.equal((await db.query('SELECT plan FROM resolute.plans')).rows[0].plan,null);
 assert.equal((await db.query('SELECT count(*)::int n FROM resolute.protection_outbox WHERE published_at IS NULL')).rows[0].n,1);
 offline=false;await db.exec("UPDATE resolute.protection_outbox SET next_attempt_at='-infinity'");
 assert.equal((await call(plans,'GET')).status,200);
 assert.equal((await call(notifications,'PUT',{baseRevision:1,settings:stopped})).status,200);
 assert.equal(records.size,3);
 const response=await call(plans,'GET');assert.deepEqual(await response.json(),{plan:null,revision:2});
 await db.exec('RESET ROLE');
 assert.equal((await db.query('SELECT count(*)::int n FROM resolute.protection_outbox WHERE published_at IS NOT NULL')).rows[0].n,3);
 assert.equal((await restored.query('SELECT plan FROM resolute.plans')).rows[0].plan.fx.note,'synthetic');
 assert.equal((await restored.query('SELECT settings FROM resolute.notification_settings')).rows[0].settings.alertsEnabled,true);
 assert.equal((await restored.query('SELECT count(*)::int n FROM resolute.notification_outbox')).rows[0].n,1);
 const sql=replay(records,key);
 for(let pass=0;pass<2;pass++){
  await restored.exec(sql);
  assert.deepEqual((await restored.query('SELECT plan,revision FROM resolute.plans')).rows[0],{plan:null,revision:2});
  const settings=(await restored.query('SELECT settings,revision FROM resolute.notification_settings')).rows[0];
  assert.deepEqual(settings,{settings:stopped,revision:2});
  assert.equal((await restored.query('SELECT count(*)::int n FROM resolute.notification_outbox')).rows[0].n,0);
 }
 // Authenticated ciphertext must also remain intact at recovery time.
 const [name,body]=records.entries().next().value;records.set(name,Buffer.from(body).fill(0,32));
 assert.throws(()=>replay(records,key));
});
