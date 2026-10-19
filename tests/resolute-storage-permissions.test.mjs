import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {prepareStoragePermissions,main} from '../scripts/resolute/provision-storage-permissions.mjs';
import {verifyStoragePermissions} from '../scripts/resolute/storage-permissions.mjs';
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
