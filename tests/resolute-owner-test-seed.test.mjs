import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {main,testSettings} from '../scripts/resolute/owner-test-seed.mjs';
import {PRODUCTION_OWNER_ACCOUNT_ID as USER} from '../lib/membership/entitlements.ts';

const migrations=['001_entitlements.sql','002_plans.sql','003_plan_answers_fx.sql','004_notification_settings.sql','005_notification_outbox.sql','017_notification_suppressions.sql','018_protection_outbox.sql','019_storage_permissions.sql'];
const token=randomBytes(32).toString('hex'),keyHex=randomBytes(32).toString('hex');
const baseEnv=()=>({RESOLUTE_OWNER_TEST_SEED:'on',RESOLUTE_OWNER_TEST_SYMBOL:'NVDA',RESOLUTE_OWNER_TEST_REFERENCE_PRICE:'250.5',RESOLUTE_OWNER_TEST_HOUR:'8',
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

test('inert unless the mode is exactly on or off',async()=>{
 assert.deepEqual(await main({}),{event:'RESOLUTE_OWNER_TEST_SEED_DISABLED'});
 for(const value of ['ON','true','1','',' on'])assert.deepEqual(await main({...baseEnv(),RESOLUTE_OWNER_TEST_SEED:value}),{event:'RESOLUTE_OWNER_TEST_SEED_DISABLED'});
});
test('settings come from the environment and go through the API parser',()=>{
 assert.deepEqual(testSettings(baseEnv()),{deliveryHourJst:8,alertsEnabled:true,morningEnabled:true,watchItems:[{symbol:'NVDA',referencePrice:250.5}],surgeCapPct:null});
 for(const patch of [{RESOLUTE_OWNER_TEST_SYMBOL:'nvda'},{RESOLUTE_OWNER_TEST_SYMBOL:undefined},{RESOLUTE_OWNER_TEST_REFERENCE_PRICE:'0'},{RESOLUTE_OWNER_TEST_REFERENCE_PRICE:'1.234'},{RESOLUTE_OWNER_TEST_REFERENCE_PRICE:'abc'},{RESOLUTE_OWNER_TEST_HOUR:'6'},{RESOLUTE_OWNER_TEST_HOUR:'11'},{RESOLUTE_OWNER_TEST_HOUR:undefined}])
  assert.throws(()=>testSettings({...baseEnv(),...patch}),e=>e.stage==='config');
});
test('configuration guards stop before any connection (and customer saving must be off)',async()=>{
 const patches=[{RESOLUTE_OWNER_TEST_SYMBOL:'x y'},
  {RESOLUTE_PLAN_DB_URL:'postgresql://resolute_plan_writer:pw@example.com:5432/resolute'},
  {RESOLUTE_PLAN_DB_URL:'postgresql://postgres:pw@postgres.railway.internal:5432/resolute'},
  {RESOLUTE_NOTIFICATION_DB_URL:'postgresql://resolute_plan_writer:pw@postgres.railway.internal:5432/resolute'},
  {RESOLUTE_PROTECTION_WRITER_URL:'http://gateway-test.up.railway.app'},{RESOLUTE_PROTECTION_ENABLED:'false'},
  {RESOLUTE_PLAN_API_ENABLED:'true'},{RESOLUTE_NOTIFICATION_API_ENABLED:'true'}];
 for(const patch of patches){
  const gw=gateway();
  await assert.rejects(main({...baseEnv(),...patch},{fetch:gw.fetch}),e=>e.stage==='config');
  assert.equal(gw.calls.length,0);
 }
 // an id can only come from the code: a user override in the environment is ignored
 assert.ok(!/RESOLUTE_OWNER_TEST_USER/.test(readFileSync(new URL('../scripts/resolute/owner-test-seed.mjs',import.meta.url),'utf8').replace(/\/\*[\s\S]*?\*\//,'')));
});
test('on then off: seeds only the owner through the scoped roles, then removes the test data and publishes the stop events',async t=>{
 const db=await database();t.after(()=>db.close());const gw=gateway();
 await db.exec('RESET ROLE');
 await db.query("INSERT INTO resolute.notification_settings(clerk_user_id,settings,revision,updated_at) VALUES('user_other1',$1,1,now())",[JSON.stringify({deliveryHourJst:7,alertsEnabled:false,morningEnabled:false,watchItems:[],surgeCapPct:null})]);
 const on=await main(baseEnv(),{pools:pools(db),fetch:gw.fetch});
 assert.equal(on.event,'RESOLUTE_OWNER_TEST_SEED_ON_OK');assert.equal(on.customerSaving,false);
 await db.exec('RESET ROLE');
 const s=(await db.query("SELECT settings,revision::int AS r FROM resolute.notification_settings WHERE clerk_user_id=$1",[USER])).rows[0];
 assert.equal(s.r,1);assert.equal(s.settings.alertsEnabled,true);assert.equal(s.settings.morningEnabled,true);assert.equal(s.settings.deliveryHourJst,8);
 assert.equal((await db.query("SELECT revision::int AS r FROM resolute.plans WHERE clerk_user_id=$1",[USER])).rows[0].r,1);
 assert.equal((await db.query('SELECT count(*)::int n FROM resolute.entitlements')).rows[0].n,0);
 assert.equal((await db.query("SELECT count(*)::int n FROM resolute.plans WHERE clerk_user_id<>$1",[USER])).rows[0].n,0);
 // a second "on" refuses and publishes nothing
 const before=gw.calls.length;
 await assert.rejects(main(baseEnv(),{pools:pools(db),fetch:gw.fetch}),e=>e.stage==='already-present');
 assert.equal(gw.calls.length,before);
 const off=await main({...baseEnv(),RESOLUTE_OWNER_TEST_SEED:'off'},{pools:pools(db),fetch:gw.fetch});
 assert.equal(off.event,'RESOLUTE_OWNER_TEST_SEED_OFF_OK');assert.equal(off.testPlanDeleted,true);
 assert.deepEqual(off.events,[{kind:'alerts_off',revision:2,published:true},{kind:'delete',revision:2,published:true},{kind:'morning_off',revision:2,published:true}]);
 await db.exec('RESET ROLE');
 const s2=(await db.query("SELECT settings,revision::int AS r FROM resolute.notification_settings WHERE clerk_user_id=$1",[USER])).rows[0];
 assert.equal(s2.settings.alertsEnabled,false);assert.equal(s2.settings.morningEnabled,false);assert.deepEqual(s2.settings.watchItems,[]);assert.equal(s2.r,2);
 assert.equal((await db.query("SELECT plan IS NULL AS erased FROM resolute.plans WHERE clerk_user_id=$1",[USER])).rows[0].erased,true);
 assert.equal((await db.query("SELECT count(*)::int n FROM resolute.notification_settings WHERE clerk_user_id='user_other1'")).rows[0].n,1);
 const text=JSON.stringify([on,off]);for(const secret of [token,keyHex,USER,'railway.app','NVDA','250.5'])assert.ok(!text.includes(secret),secret);
});
test('on refuses when the owner already has any row (never overwrites real data)',async t=>{
 const db=await database();t.after(()=>db.close());const gw=gateway();
 await db.exec('RESET ROLE');
 await db.query("INSERT INTO resolute.notification_settings(clerk_user_id,settings,revision,updated_at) VALUES($1,$2,1,now())",[USER,JSON.stringify({deliveryHourJst:9,alertsEnabled:true,morningEnabled:false,watchItems:[{symbol:'MU',referencePrice:1}],surgeCapPct:null})]);
 await assert.rejects(main(baseEnv(),{pools:pools(db),fetch:gw.fetch}),e=>e.stage==='already-present');
 assert.equal(gw.calls.length,0);
 await db.exec('RESET ROLE');
 assert.equal((await db.query('SELECT count(*)::int n FROM resolute.plans')).rows[0].n,0);
});
test('off leaves a real (non-test) plan alone and stops when nothing was seeded',async t=>{
 const db=await database();t.after(()=>db.close());const gw=gateway();
 const offEnv={...baseEnv(),RESOLUTE_OWNER_TEST_SEED:'off'};
 await assert.rejects(main(offEnv,{pools:pools(db),fetch:gw.fetch}),e=>e.stage==='not-present');
 await main(baseEnv(),{pools:pools(db),fetch:gw.fetch});
 await db.exec('RESET ROLE');
 await db.query("UPDATE resolute.plans SET plan=jsonb_set(plan,'{fx,note}','\"real\"')");
 const off=await main(offEnv,{pools:pools(db),fetch:gw.fetch});
 assert.equal(off.testPlanDeleted,false);assert.deepEqual(off.events.map(e=>e.kind),['alerts_off','morning_off']);
 await db.exec('RESET ROLE');
 assert.equal((await db.query("SELECT plan IS NULL AS erased FROM resolute.plans WHERE clerk_user_id=$1",[USER])).rows[0].erased,false);
});
test('a gateway failure stops the job without retry loops',async t=>{
 const db=await database();t.after(()=>db.close());const gw=gateway({failPut:true});
 await main(baseEnv(),{pools:pools(db),fetch:gw.fetch}); // "on" publishes nothing
 await assert.rejects(main({...baseEnv(),RESOLUTE_OWNER_TEST_SEED:'off'},{pools:pools(db),fetch:gw.fetch}),e=>['settings-off','plan-delete','verify'].includes(e.stage));
 assert.ok(gw.calls.length<=6);
});
test('the job file contains no destructive SQL or key generation',()=>{
 const source=readFileSync(new URL('../scripts/resolute/owner-test-seed.mjs',import.meta.url),'utf8');
 for(const bad of [/DROP\s/i,/DELETE\s+FROM/i,/TRUNCATE/i,/randomBytes/,/generateKey/,/GRANT\s/i,/CREATE\s+ROLE/i])assert.ok(!bad.test(source),String(bad));
});
