import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {main,USER_PATTERN} from '../scripts/resolute/acceptance-6b.mjs';

const USER='user_acceptance6bTest0001';
const migrations=['001_entitlements.sql','002_plans.sql','003_plan_answers_fx.sql','004_notification_settings.sql','005_notification_outbox.sql','017_notification_suppressions.sql','018_protection_outbox.sql','019_storage_permissions.sql'];
const token=randomBytes(32).toString('hex'),keyHex=randomBytes(32).toString('hex');
const baseEnv=()=>({RESOLUTE_ACCEPTANCE_6B:'true',RESOLUTE_ACCEPTANCE_6B_USER:USER,
 RESOLUTE_PLAN_DB_URL:'postgresql://resolute_plan_writer:pw@postgres.railway.internal:5432/resolute',
 RESOLUTE_NOTIFICATION_DB_URL:'postgresql://resolute_notification_writer:pw@postgres.railway.internal:5432/resolute',
 RESOLUTE_PROTECTION_ENABLED:'true',RESOLUTE_PROTECTION_WRITER_URL:'https://gateway-test.up.railway.app',
 RESOLUTE_PROTECTION_WRITER_TOKEN:token,RESOLUTE_PROTECTION_KEY_HEX:keyHex});
async function database(){
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const data=await boot.dumpDataDir();await boot.close();
 const db=new PGlite({database:'resolute',loadDataDir:data});
 await db.exec('CREATE ROLE resolute_plan_writer NOLOGIN NOINHERIT;CREATE ROLE resolute_notification_writer NOLOGIN NOINHERIT');
 for(const file of migrations)await db.exec(readFileSync(new URL('../db/resolute/'+file,import.meta.url),'utf8'));
 return db;
}
function pool(db,role){
 return {async connect(){await db.exec(`SET ROLE ${role}`);return {
  async query(sql,args){const r=await db.query(sql,args);return {...r,rowCount:sql.trimStart().startsWith('SELECT')?r.rows.length:r.affectedRows};},
  release(){},
 };}};
}
function gateway({failPut=false}={}){
 const objects=new Map(),calls=[];
 const fetch=async(url,init)=>{
  calls.push({method:init.method,url:String(url)});
  const name=String(url).split('/').at(-1);
  if(failPut&&init.method==='PUT')return new Response(null,{status:500});
  if(init.method==='PUT'){objects.set(name,Buffer.from(init.body));return new Response(null,{status:201});}
  return objects.has(name)?new Response(objects.get(name),{status:200}):new Response(null,{status:404});
 };
 return {fetch,objects,calls};
}
const pools=db=>({plan:pool(db,'resolute_plan_writer'),notification:pool(db,'resolute_notification_writer')});

test('inert unless the explicit flag is exactly true',async()=>{
 assert.deepEqual(await main({}),{event:'RESOLUTE_ACCEPTANCE_6B_DISABLED'});
 for(const value of ['TRUE','1','yes',''])assert.deepEqual(await main({...baseEnv(),RESOLUTE_ACCEPTANCE_6B:value}),{event:'RESOLUTE_ACCEPTANCE_6B_DISABLED'});
});
test('synthetic id pattern',()=>{
 for(const ok of ['user_acceptance1','user_acceptanceAbC123'])assert.ok(USER_PATTERN.test(ok));
 for(const bad of ['user_3LHR1K8f8zwyDcVzMg7ud6KB9Wb','user_acceptance','user_acceptance-1','user_acceptance'+'a'.repeat(101),'xuser_acceptance1','user_acceptance1\n'])assert.ok(!USER_PATTERN.test(bad));
});
test('configuration guards stop before any connection',async()=>{
 const patches=[{RESOLUTE_ACCEPTANCE_6B_USER:'user_3LHR1K8f8zwyDcVzMg7ud6KB9Wb'},{RESOLUTE_ACCEPTANCE_6B_USER:undefined},
  {RESOLUTE_PLAN_DB_URL:'postgresql://resolute_plan_writer:pw@example.com:5432/resolute'},
  {RESOLUTE_PLAN_DB_URL:'postgresql://resolute_plan_writer:pw@postgres.railway.internal:5432/other'},
  {RESOLUTE_PLAN_DB_URL:'postgresql://postgres:pw@postgres.railway.internal:5432/resolute'},
  {RESOLUTE_NOTIFICATION_DB_URL:'postgresql://resolute_plan_writer:pw@postgres.railway.internal:5432/resolute'},
  {RESOLUTE_NOTIFICATION_DB_URL:undefined},
  {RESOLUTE_PROTECTION_WRITER_URL:'http://gateway-test.up.railway.app'},{RESOLUTE_PROTECTION_WRITER_URL:'https://example.com'},
  {RESOLUTE_PROTECTION_ENABLED:'false'},{RESOLUTE_PROTECTION_ACCESS_KEY_ID:'x'},
  {RESOLUTE_PLAN_API_ENABLED:'true'},{RESOLUTE_NOTIFICATION_API_ENABLED:'true'}];
 for(const patch of patches){
  const gw=gateway();
  await assert.rejects(main({...baseEnv(),...patch},{fetch:gw.fetch}),e=>e.stage==='config');
  assert.equal(gw.calls.length,0);
 }
});
test('runs the full path through scoped roles, publishes three events and verifies them',async t=>{
 const db=await database();t.after(()=>db.close());const gw=gateway();
 const result=await main(baseEnv(),{pools:pools(db),fetch:gw.fetch});
 assert.equal(result.event,'RESOLUTE_ACCEPTANCE_6B_OK');assert.equal(result.customerSaving,false);assert.equal(result.objects,3);
 assert.deepEqual(result.events,[{kind:'alerts_off',revision:2,published:true},{kind:'delete',revision:2,published:true},{kind:'morning_off',revision:2,published:true}]);
 assert.equal(gw.objects.size,3);
 await db.exec('RESET ROLE');
 const text=JSON.stringify(result);for(const secret of [token,keyHex,USER,'railway.app'])assert.ok(!text.includes(secret));
 const plan=(await db.query("SELECT plan,revision::int AS r FROM resolute.plans WHERE clerk_user_id=$1",[USER])).rows[0];
 assert.equal(plan.plan,null);assert.equal(plan.r,2);
 const s=(await db.query("SELECT settings,revision::int AS r FROM resolute.notification_settings WHERE clerk_user_id=$1",[USER])).rows[0];
 assert.equal(s.settings.alertsEnabled,false);assert.equal(s.settings.morningEnabled,false);assert.equal(s.r,2);
 assert.equal((await db.query("SELECT count(*)::int n FROM resolute.protection_outbox WHERE published_at IS NOT NULL")).rows[0].n,3);
 // No entitlement row was created and no other user was touched.
 assert.equal((await db.query('SELECT count(*)::int n FROM resolute.entitlements')).rows[0].n,0);
 assert.equal((await db.query("SELECT count(*)::int n FROM resolute.plans WHERE clerk_user_id<>$1",[USER])).rows[0].n,0);
 // A second run refuses and publishes nothing more.
 const before=gw.calls.length;
 await assert.rejects(main(baseEnv(),{pools:pools(db),fetch:gw.fetch}),e=>e.stage==='already-present');
 assert.equal(gw.calls.length,before);
});
test('refuses when the synthetic id already has any row',async t=>{
 const db=await database();t.after(()=>db.close());const gw=gateway();
 await db.exec('RESET ROLE');
 await db.query("INSERT INTO resolute.notification_settings(clerk_user_id,settings,revision,updated_at) VALUES($1,$2,1,now())",[USER,JSON.stringify({deliveryHourJst:7,alertsEnabled:true,morningEnabled:true,watchItems:[{symbol:'MU',referencePrice:1}],surgeCapPct:null})]);
 await assert.rejects(main(baseEnv(),{pools:pools(db),fetch:gw.fetch}),e=>e.stage==='already-present');
 assert.equal(gw.calls.length,0);
 await db.exec('RESET ROLE');
 assert.equal((await db.query('SELECT count(*)::int n FROM resolute.plans')).rows[0].n,0);
});
test('a gateway failure stops the job without retry loops and a rerun is refused',async t=>{
 const db=await database();t.after(()=>db.close());const gw=gateway({failPut:true});
 await assert.rejects(main(baseEnv(),{pools:pools(db),fetch:gw.fetch}),e=>e.stage==='plan-delete');
 assert.ok(gw.calls.length<=4);
 await db.exec('RESET ROLE');
 assert.equal((await db.query('SELECT count(*)::int n FROM resolute.protection_outbox WHERE published_at IS NOT NULL')).rows[0].n,0);
 await assert.rejects(main(baseEnv(),{pools:pools(db),fetch:gw.fetch}),e=>e.stage==='already-present');
});
test('the job file contains no destructive SQL or key generation',()=>{
 const source=readFileSync(new URL('../scripts/resolute/acceptance-6b.mjs',import.meta.url),'utf8');
 for(const bad of [/DROP\s/i,/DELETE\s+FROM/i,/TRUNCATE/i,/randomBytes/,/generateKey/,/GRANT\s/i,/CREATE\s+ROLE/i])assert.ok(!bad.test(source),String(bad));
});
