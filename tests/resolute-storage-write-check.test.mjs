import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';

const sql=readFileSync(new URL('../scripts/resolute/check-storage-write.sql',import.meta.url),'utf8');
const runner=fileURLToPath(new URL('../scripts/resolute/check-storage-write.sh',import.meta.url));
const tables=['plans','plan_deletions','notification_settings','notification_suppressions','protection_outbox'];
const identity='user_storagecheck20261020rollback';
async function fixture(){
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const data=await boot.dumpDataDir();await boot.close();
 const db=new PGlite({database:'resolute',loadDataDir:data});
 await db.exec('CREATE ROLE resolute_plan_writer NOLOGIN NOINHERIT;CREATE ROLE resolute_notification_writer NOLOGIN NOINHERIT;CREATE SCHEMA resolute_payments_live;CREATE TABLE resolute_payments_live.orders(secret text);CREATE VIEW resolute_payments_live.entitlement_periods AS SELECT 1 AS placeholder');
 for(const file of ['001_entitlements.sql','002_plans.sql','003_plan_answers_fx.sql','004_notification_settings.sql','005_notification_outbox.sql','017_notification_suppressions.sql','018_protection_outbox.sql','019_storage_permissions.sql'])await db.exec(readFileSync(new URL('../db/resolute/'+file,import.meta.url),'utf8'));
 return db;
}
async function absent(db){for(const table of tables)assert.equal((await db.query(`SELECT count(*)::int AS n FROM resolute.${table} WHERE clerk_user_id=$1`,[identity])).rows[0].n,0);}
test('exact operational SQL exercises three scoped roles twice and leaves no synthetic rows or login changes',async()=>{
 const db=await fixture();
 try{
  for(let pass=0;pass<2;pass++){
   const results=await db.exec(sql);
   assert.deepEqual(results.at(-1).rows,[{event:'RESOLUTE_SCOPED_ROLLBACK_OK',committed_rows:0,activation:false}]);
   await absent(db);
  }
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('resolute_plan_writer','resolute_notification_writer','resolute_protection_writer') AND rolcanlogin")).rows[0].n,0);
 }finally{await db.close();}
});
test('a mid-flight scoped privilege failure rolls back plan writes, deletion and queued history',async()=>{
 const db=await fixture();
 try{
  await db.exec('REVOKE INSERT ON resolute.notification_settings FROM resolute_notification_writer');
  await assert.rejects(()=>db.exec(sql),error=>error.code==='42501');
  // PGlite holds the session open; explicitly model psql disconnect rollback.
  await db.exec('ROLLBACK');await absent(db);
  await db.exec('CREATE TABLE public.after_failed_probe(id int)');
 }finally{await db.close();}
});
test('dormancy and collision checks reject without deleting pre-existing data',async()=>{
 const db=await fixture();
 try{
  await db.exec('ALTER ROLE resolute_plan_writer LOGIN');
  await assert.rejects(()=>db.exec(sql),/STORAGE_NOT_DORMANT/);await db.exec('ROLLBACK');await absent(db);
  await db.exec('ALTER ROLE resolute_plan_writer NOLOGIN');
  await db.query('INSERT INTO resolute.plans(clerk_user_id,revision,deleted_at) VALUES($1,9,NOW())',[identity]);
  await assert.rejects(()=>db.exec(sql),/PROBE_ID_ALREADY_EXISTS/);await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT revision FROM resolute.plans WHERE clerk_user_id=$1',[identity])).rows[0].revision,9);
 }finally{await db.close();}
});
test('wrong database refuses before any schema or row operation',async()=>{
 const db=new PGlite();
 try{await assert.rejects(()=>db.exec(sql),/WRONG_DATABASE/);await db.exec('ROLLBACK');}
 finally{await db.close();}
});
test('runner is disabled by default, refuses other containers/arguments, isolates local psql and propagates failure',()=>{
 const dir=mkdtempSync(join(tmpdir(),'resolute-psql-stub-'));
 try{
  const stub=join(dir,'psql');
  writeFileSync(stub,'#!/bin/sh\nprintf "args:%s\\n" "$@"\nprintf "env:%s|%s|%s|%s\\n" "${PGHOSTADDR-unset}" "${PGPASSWORD-unset}" "${PGSERVICE-unset}" "${PGOPTIONS-unset}"\nexit 42\n');chmodSync(stub,0o700);
  const env={PATH:dir+':'+process.env.PATH,RESOLUTE_CHECK_STORAGE_WRITE:'true',RAILWAY_SERVICE_ID:'69531581-732c-478b-afee-a971cf25ee4c',RAILWAY_PROJECT_ID:'0872be15-db75-4e5a-ae0f-881911fb442d',RAILWAY_ENVIRONMENT_ID:'3a80776d-15a3-4ca1-bd0c-e0c915ccf73b',PGHOSTADDR:'remote.invalid',PGPASSWORD:'must-not-transfer',PGSERVICE:'remote',PGOPTIONS:'-c statement_timeout=0'};
  const run=(patch={},args=[])=>spawnSync('sh',[runner,...args],{env:{...env,...patch},encoding:'utf8'});
  const disabled=run({RESOLUTE_CHECK_STORAGE_WRITE:''});assert.equal(disabled.status,0);assert.match(disabled.stdout,/ROLLBACK_DISABLED/);assert.doesNotMatch(disabled.stdout,/args:/);
  for(const name of ['RAILWAY_SERVICE_ID','RAILWAY_PROJECT_ID','RAILWAY_ENVIRONMENT_ID']){const result=run({[name]:'other'});assert.equal(result.status,1);assert.match(result.stderr,/WRONG_CONTAINER/);assert.doesNotMatch(result.stdout,/args:/);}
  assert.match(run({},['--host=remote']).stderr,/ARGUMENTS_FORBIDDEN/);
  const result=run();assert.equal(result.status,42);assert.match(result.stdout,/args:--host=\/var\/run\/postgresql/);assert.match(result.stdout,/args:--dbname=resolute/);assert.match(result.stdout,/args:--no-password/);assert.match(result.stdout,/args:--set=ON_ERROR_STOP=1/);assert.match(result.stdout,/env:unset\|unset\|unset\|unset/);assert.doesNotMatch(result.stdout,/ROLLBACK_OK|must-not-transfer|remote.invalid/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
