import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {prepareStoragePermissions,main} from '../scripts/resolute/provision-storage-permissions.mjs';
import {checkStorageReadiness,main as readinessMain} from '../scripts/resolute/check-storage-readiness.mjs';
import {verifyStoragePermissions} from '../scripts/resolute/storage-permissions.mjs';
import {checkStorageRuntime,main as runtimeMain} from '../scripts/resolute/check-storage-runtime.mjs';
async function fixture(){
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const data=await boot.dumpDataDir();await boot.close();
 const db=new PGlite({database:'resolute',loadDataDir:data});
 await db.exec(`CREATE ROLE resolute_api_reader NOINHERIT;
  CREATE SCHEMA resolute_payments_live;
  CREATE TABLE resolute_payments_live.orders(secret text);
  CREATE VIEW resolute_payments_live.entitlement_periods AS SELECT 1 AS placeholder;
  CREATE SCHEMA resolute_payments_sandbox;
  CREATE TABLE resolute_payments_sandbox.orders(secret text);`);
 for(const f of ['001_entitlements.sql','002_plans.sql','003_plan_answers_fx.sql','004_notification_settings.sql','005_notification_outbox.sql','016_live_entitlement_readers.sql','017_notification_suppressions.sql','018_protection_outbox.sql']){
  await db.exec(readFileSync(new URL('../db/resolute/'+f,import.meta.url),'utf8'));
 }
 const client={query:async(sql,args)=>args?db.query(sql,args):(await db.exec(sql)).at(-1)};
 return {db,client};
}
test('runtime check is inert and rejects admin, foreign host and ambiguous login expectations before connecting',async()=>{
 assert.deepEqual(await runtimeMain({}),{event:'RESOLUTE_STORAGE_RUNTIME_DISABLED'});
 const base={RESOLUTE_CHECK_STORAGE_RUNTIME:'true',RESOLUTE_STORAGE_CHECK_DB_URL:'postgresql://resolute_plan_writer:disposable@postgres.railway.internal/resolute',RESOLUTE_STORAGE_EXPECTED_LOGIN_ROLES:'["resolute_plan_writer"]'};
 for(const patch of [
  {RESOLUTE_STORAGE_CHECK_DB_URL:'postgresql://postgres:disposable@postgres.railway.internal/resolute'},
  {RESOLUTE_STORAGE_CHECK_DB_URL:'postgresql://resolute_plan_writer:disposable@other.internal/resolute'},
  {RESOLUTE_STORAGE_EXPECTED_LOGIN_ROLES:'[]'},
  {RESOLUTE_STORAGE_EXPECTED_LOGIN_ROLES:'["postgres"]'},
  {RESOLUTE_STORAGE_EXPECTED_LOGIN_ROLES:'["resolute_plan_writer","resolute_plan_writer"]'},
 ])await assert.rejects(()=>runtimeMain({...base,...patch}),/INVALID_RUNTIME_SCOPE/);
});
test('runtime audit requires the scoped session and rejects overprivilege or unexpected LOGIN',async()=>{
 const role='resolute_plan_writer';
 for(const [setup,expectedRoles,unsafe] of [
  ['', [role], false],
  ['GRANT SELECT(secret) ON resolute_payments_live.orders TO resolute_plan_writer', [role], true],
  ['ALTER ROLE resolute_notification_writer LOGIN', [role], true],
  ['ALTER ROLE resolute_notification_writer LOGIN', [role,'resolute_notification_writer'], false],
 ]){
  const {db,client}=await fixture();
  try{
   await prepareStoragePermissions(client);
   await db.exec('ALTER ROLE resolute_plan_writer LOGIN');
   await assert.rejects(()=>verifyStoragePermissions(client),/UNSAFE/);
   await db.exec('SET ROLE resolute_plan_writer');
   await assert.rejects(()=>checkStorageRuntime(client,role,[role]),/INVALID_RUNTIME_IDENTITY/);
   await db.exec('RESET ROLE');
   if(setup)await db.exec(setup);
   await db.exec('SET SESSION AUTHORIZATION resolute_plan_writer');
   if(unsafe)await assert.rejects(()=>checkStorageRuntime(client,role,expectedRoles),/UNSAFE/);
   else{
    const result=await checkStorageRuntime(client,role,expectedRoles);
    assert.equal(result.loginsEnabled,true);assert.equal(result.readOnly,true);
    assert.equal(result.rolesVerified,3);assert.equal(result.activation,false);
    assert.equal(result.recoveryFenceVerified,false);
   }
  }finally{await db.close();}
 }
});
test('storage preparation is off by default and rejects wrong database scope before connecting',async()=>{
 assert.deepEqual(await main({}),{event:'RESOLUTE_STORAGE_PREPARE_DISABLED'});
 await assert.rejects(()=>main({RESOLUTE_PREPARE_STORAGE_PERMISSIONS:'true',RESOLUTE_SETUP_DB_URL:'postgresql://user@wrong.internal/resolute'}),/INVALID_STORAGE_SCOPE/);
});
test('exact scoped grants work; writer and retry roles cannot read other data or mutate event identity',async()=>{
 const {db,client}=await fixture();
 try{
  assert.deepEqual(await prepareStoragePermissions(client),{rolesVerified:3,loginsEnabled:false,rawPaymentAccess:false,deliveryAccess:false});
  await prepareStoragePermissions(client); // Repeatable grants with the same audit.
  await db.exec(`SET ROLE resolute_plan_writer;
   INSERT INTO resolute.plans(clerk_user_id,revision,deleted_at) VALUES('user_fixture',1,NOW());
   INSERT INTO resolute.plan_deletions VALUES('user_fixture',1,NOW());
   RESET ROLE;SET ROLE resolute_notification_writer;
   INSERT INTO resolute.notification_settings VALUES('user_fixture','{"deliveryHourJst":7,"morningEnabled":false,"alertsEnabled":false,"watchItems":[]}',1,NOW());
   RESET ROLE;SET ROLE resolute_protection_writer;`);
  assert.equal((await db.query('SELECT * FROM resolute.protection_outbox')).rows.length,3);
  await db.exec("UPDATE resolute.protection_outbox SET attempts=attempts+1");
  for(const sql of ['SELECT * FROM resolute.plans','SELECT * FROM resolute.notification_outbox','SELECT * FROM resolute_payments_live.orders',"UPDATE resolute.protection_outbox SET kind='delete'",'DELETE FROM resolute.protection_outbox']){
   await assert.rejects(()=>db.exec(sql),e=>e.code==='42501');
  }
 }finally{await db.close();}
});
test('unsafe existing roles, PUBLIC/column access and escalation paths reject and roll back all new grants',async t=>{
 for(const [name,sql] of [
  ['login','ALTER ROLE resolute_plan_writer LOGIN'],
  ['admin','ALTER ROLE resolute_notification_writer CREATEROLE'],
  ['membership','CREATE ROLE elevated;GRANT elevated TO resolute_plan_writer'],
  ['assumable dormant role','CREATE ROLE other_login LOGIN;GRANT resolute_plan_writer TO other_login'],
  ['public raw data','GRANT SELECT ON resolute_payments_live.orders TO PUBLIC'],
  ['system-like user schema','CREATE SCHEMA pgshadow;CREATE TABLE pgshadow.private_data(secret text);GRANT SELECT ON pgshadow.private_data TO resolute_plan_writer'],
  ['column-only leak','GRANT SELECT(secret) ON resolute_payments_sandbox.orders TO resolute_plan_writer'],
  ['event identity write','GRANT UPDATE(kind) ON resolute.protection_outbox TO resolute_plan_writer'],
  ['grant option','GRANT SELECT ON resolute.protection_outbox TO resolute_plan_writer WITH GRANT OPTION'],
  ['schema DDL','GRANT CREATE ON SCHEMA public TO resolute_plan_writer'],
  ['maintenance','GRANT MAINTAIN ON resolute.plans TO resolute_plan_writer'],
  ['definer escalation',"CREATE FUNCTION public.escalate() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'"],
 ])await t.test(name,async()=>{
  const {db,client}=await fixture();
  try{
   await db.exec(sql);await assert.rejects(()=>prepareStoragePermissions(client));
   const {rows:[row]}=await db.query("SELECT has_table_privilege('resolute_plan_writer','resolute.plans','INSERT') AS allowed");
   assert.equal(row.allowed,false);
  }finally{await db.close();}
 });
});
test('audit fails when a required grant disappears after preparation',async()=>{
 const {db,client}=await fixture();
 try{
  await prepareStoragePermissions(client);
  await db.exec('REVOKE UPDATE(attempts) ON resolute.protection_outbox FROM resolute_protection_writer');
  await assert.rejects(()=>verifyStoragePermissions(client),/UNSAFE/);
 }finally{await db.close();}
});

test('readiness is dormant by default and validates connection scope before I/O',async()=>{
 assert.deepEqual(await readinessMain({}),{event:'RESOLUTE_STORAGE_READINESS_DISABLED'});
 await assert.rejects(()=>readinessMain({RESOLUTE_CHECK_STORAGE_READINESS:'true',RESOLUTE_SETUP_DB_URL:'postgresql://user@wrong.internal/resolute'}),/INVALID_STORAGE_SCOPE/);
});
test('read-only readiness detects backlog including delayed receipts without changing rows',async()=>{
 const {db,client}=await fixture();
 try{
  await prepareStoragePermissions(client);
  const empty=await checkStorageReadiness(client);
  assert.equal(empty.dormantChecksPassed,true);
  assert.equal(empty.recoveryFenceVerified,false);assert.equal(empty.activation,false);
  await db.exec("INSERT INTO resolute.plan_deletions VALUES('user_readiness',1,NOW()); UPDATE resolute.protection_outbox SET next_attempt_at=NOW()+interval '1 day'");
  const before=await db.query('SELECT * FROM resolute.protection_outbox');
  const result=await checkStorageReadiness(client);
  assert.equal(result.pendingProtection,1);assert.equal(result.dueProtection,0);
  assert.equal(result.dormantChecksPassed,false);
  assert.deepEqual(await db.query('SELECT * FROM resolute.protection_outbox'),before);
  const live={query:(sql,args)=>sql.includes('FROM pg_stat_activity')?Promise.resolve({rows:[{sessions:'1'}]}):client.query(sql,args)};
  assert.equal((await checkStorageReadiness(live)).activeScopedSessions,1);
  await db.exec('DELETE FROM resolute.protection_outbox');
  assert.equal((await checkStorageReadiness(live)).dormantChecksPassed,false);
  await db.exec('ALTER ROLE resolute_plan_writer LOGIN');
  await assert.rejects(()=>checkStorageReadiness(client),/UNSAFE/);
  // Error must close its read-only transaction, allowing the operator connection to continue.
  await db.exec('CREATE TABLE public.after_readiness_failure(id int)');
 }finally{await db.close();}
});
