import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {PGlite} from '@electric-sql/pglite';

const at='2026-10-19T06:00:00.000Z';
const deletion=(userId,revision)=>({userId,revision,at});
const stop=(userId,revision,kind)=>({userId,revision,kind,at});
function sql(ledger){
 const r=spawnSync('python3',['-c','import json,sys;from scripts.resolute.protection import restore_sql;print(restore_sql(json.load(sys.stdin)))'],{input:JSON.stringify(ledger),encoding:'utf8'});
 assert.equal(r.status,0,r.stderr);return r.stdout;
}
async function database(name='resolute_restore_test'){
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');await boot.exec('CREATE DATABASE resolute_restore_test');
 const data=await boot.dumpDataDir();await boot.close();
 const source=new PGlite({database:'resolute',loadDataDir:data});
 for(const file of ['001_entitlements.sql','002_plans.sql','003_plan_answers_fx.sql','004_notification_settings.sql','005_notification_outbox.sql','017_notification_suppressions.sql'])
  await source.exec(readFileSync(new URL('../db/resolute/'+file,import.meta.url),'utf8'));
 // PGlite cannot switch databases on a live connection; export schema/data into the isolated DB.
 if(name==='resolute')return source;
 const dump=await source.dumpDataDir();await source.close();
 // PGlite uses one logical database per instance; copy fixtures through explicit reviewed SQL.
 const db=new PGlite({database:'resolute_restore_test',loadDataDir:dump});
 for(const file of ['001_entitlements.sql','002_plans.sql','003_plan_answers_fx.sql','004_notification_settings.sql','005_notification_outbox.sql','017_notification_suppressions.sql']){
  const migration=readFileSync(new URL('../db/resolute/'+file,import.meta.url),'utf8').replaceAll("current_database() <> 'resolute'","current_database() <> 'resolute_restore_test'");
  await db.exec(migration);
 }
 return db;
}
const settings={deliveryHourJst:7,alertsEnabled:true,morningEnabled:true,watchItems:[{symbol:'MU',referencePrice:100}],surgeCapPct:null};
async function set(db,user,revision,value=settings){await db.query('INSERT INTO resolute.notification_settings VALUES($1,$2,$3,$4)',[user,JSON.stringify(value),revision,at]);}

test('stops journal atomically with scoped settings writes and cannot be erased by writer',async()=>{
 const db=await database('resolute');
 try{
  await db.exec('CREATE ROLE setting_test;GRANT USAGE ON SCHEMA resolute TO setting_test;GRANT SELECT,INSERT,UPDATE ON resolute.notification_settings TO setting_test;SET ROLE setting_test');
  await set(db,'user_stop',1,{...settings,alertsEnabled:false});
  await assert.rejects(()=>db.exec('DELETE FROM resolute.notification_suppressions'),e=>e.code==='42501');
  await db.exec('RESET ROLE');
  assert.equal((await db.query('SELECT kind FROM resolute.notification_suppressions')).rows[0].kind,'alerts');
  await db.exec('ALTER TABLE resolute.notification_suppressions RENAME TO unavailable');
  await assert.rejects(()=>db.query('UPDATE resolute.notification_settings SET revision=2,settings=$1',[JSON.stringify({...settings,morningEnabled:false})]));
  assert.equal((await db.query('SELECT revision FROM resolute.notification_settings')).rows[0].revision,1);
 }finally{await db.close();}
});

test('isolated restore erases old answers, preserves later recreation and applies both channel stops before revision changes',async()=>{
 const db=await database();
 const ledger={version:1,deletions:[deletion('user_old',3),deletion('user_new',3),deletion('user_missing',2)],
 suppressions:[stop('user_stop',3,'alerts'),stop('user_stop',7,'morning'),stop('user_reconsent',3,'alerts'),stop('user_absent',2,'morning')]};
 try{
  for(const [user,rev] of [['user_old',1],['user_new',4]])await db.query(`INSERT INTO resolute.plans VALUES($1,$2,'{"answersVersion":1,"answers":{"q01":"private"},"fx":{"note":"private"}}',NOW(),NOW(),NULL)`,[user,rev]);
  await set(db,'user_stop',2);await set(db,'user_reconsent',4);
  await db.query("INSERT INTO resolute.notification_outbox(idempotency_key,clerk_user_id,kind,delivery_date_jst,payload) VALUES('stale','user_stop','alerts','2026-10-19','{}')");
  await db.exec(sql(ledger));await db.exec(sql(ledger));
  const plans=(await db.query('SELECT clerk_user_id,plan,revision FROM resolute.plans ORDER BY clerk_user_id')).rows;
  assert.equal(plans.find(r=>r.clerk_user_id==='user_old').plan,null);
  assert.equal(plans.find(r=>r.clerk_user_id==='user_missing').revision,2);
  assert.equal(plans.find(r=>r.clerk_user_id==='user_new').plan.answers.q01,'private');
  const rows=(await db.query('SELECT * FROM resolute.notification_settings')).rows;
  const stopped=rows.find(r=>r.clerk_user_id==='user_stop');assert.equal(stopped.revision,7);assert.equal(stopped.settings.alertsEnabled,false);assert.equal(stopped.settings.morningEnabled,false);
  assert.equal(rows.find(r=>r.clerk_user_id==='user_reconsent').settings.alertsEnabled,true);
  assert.equal(rows.find(r=>r.clerk_user_id==='user_absent').settings.alertsEnabled,false);
  assert.equal((await db.query('SELECT count(*)::int n FROM resolute.notification_outbox')).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int n FROM resolute.plan_deletions')).rows[0].n,3);
  assert.equal((await db.query('SELECT count(*)::int n FROM resolute.notification_suppressions')).rows[0].n,4);
 }finally{await db.close();}
});

test('restore refuses source DB and rolls back entirely if a required table is absent',async()=>{
 const ledger={version:1,deletions:[deletion('user_missing',2)],suppressions:[]};
 const source=await database('resolute');try{await assert.rejects(()=>source.exec(sql(ledger)),/Isolated restore/);await source.exec('ROLLBACK');assert.equal((await source.query('SELECT * FROM resolute.plans')).rows.length,0);}finally{await source.close();}
 const db=await database();try{
  await db.exec('DROP TABLE resolute.notification_outbox');await assert.rejects(()=>db.exec(sql(ledger)));await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT * FROM resolute.plans')).rows.length,0);
 }finally{await db.close();}
});

test('maintenance export rejects login-capable writers and works only with both writers fenced',async()=>{
 const db=await database('resolute');
 const r=spawnSync('python3',['-c','from scripts.resolute.protection import EXPORT_SQL;print(EXPORT_SQL)'],{encoding:'utf8'});assert.equal(r.status,0);
 try{
  await assert.rejects(()=>db.exec(r.stdout),/write-fenced/);await db.exec('ROLLBACK');
  await db.exec('CREATE ROLE resolute_plan_writer LOGIN;CREATE ROLE resolute_notification_writer NOLOGIN');
  await assert.rejects(()=>db.exec(r.stdout),/write-fenced/);await db.exec('ROLLBACK');
  await db.exec('ALTER ROLE resolute_plan_writer NOLOGIN');
  await set(db,'user_stopped',1,{...settings,alertsEnabled:false,morningEnabled:false});
  const results=await db.exec(r.stdout);
  const result=results.find(r=>r.rows?.[0]?.json_build_object);
  assert.equal(JSON.parse(result.rows[0].json_build_object).suppressions.length,2);
 }finally{await db.close();}
});

test('checkpoint cannot omit stops already present in the restored snapshot',async()=>{
 const db=await database();try{
  await set(db,'user_stopped',2,{...settings,alertsEnabled:false});
  await assert.rejects(()=>db.exec(sql({version:1,deletions:[],suppressions:[]})),/Incomplete or conflicting/);
  await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT revision FROM resolute.notification_settings')).rows[0].revision,2);
 }finally{await db.close();}
});
