import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createProtectionPublisher,protectionObjectKey,encryptProtection,decryptProtection,ProtectionUnavailable} from '../lib/resolute/protection-ledger.ts';
import {createProtectionBarrier} from '../lib/resolute/protection-outbox.ts';
import {protectionRuntime} from '../lib/resolute/protection-runtime.ts';
import {createPlanStore,PlanConflict} from '../lib/resolute/plan-database.ts';
import {createNotificationStore} from '../lib/resolute/notification-database.ts';
const key=Buffer.alloc(32,7),at='2026-10-19T06:00:00.000Z';
const event={version:1,userId:'user_buyer',revision:2,kind:'delete',at};
function objects(){const files=new Map();return {files,async putIfAbsent(k,b){if(files.has(k))throw Error('precondition');files.set(k,b);},async read(k){if(!files.has(k))throw Error('missing');return files.get(k);}};}
test('real authenticated encryption hides identity; corruption, wrong key and moved objects fail closed',()=>{
 const object=protectionObjectKey(event,key),cipher=encryptProtection(event,key);
 assert.ok(!object.includes(event.userId));assert.ok(!cipher.includes(Buffer.from(event.userId)));
 assert.deepEqual(decryptProtection(cipher,key,object),event);
 assert.notDeepEqual(cipher,encryptProtection(event,key));
 const corrupted=Buffer.from(cipher);corrupted[35]^=1;
 for(const [body,k,name] of [[corrupted,key,object],[cipher,Buffer.alloc(32,8),object],[cipher,key,object+'x']])assert.throws(()=>decryptProtection(body,k,name),ProtectionUnavailable);
});
test('lost PUT reply, duplicate retries and concurrent publication converge on one verified immutable event',async()=>{
 const store=objects();const put=store.putIfAbsent.bind(store);store.putIfAbsent=async(...a)=>{await put(...a);throw Error('lost reply');};
 const publish=createProtectionPublisher(store,key);
 const receipts=await Promise.all([publish(event),publish(event),publish(event)]);
 assert.equal(new Set(receipts).size,1);assert.equal(store.files.size,1);
 await assert.rejects(()=>publish({...event,at:'2026-10-19T07:00:00.000Z'}),ProtectionUnavailable);
});
test('missing gate or incomplete config never starts a production publisher',()=>{
 assert.throws(()=>protectionRuntime({}),ProtectionUnavailable);
 assert.throws(()=>protectionRuntime({RESOLUTE_PROTECTION_ENABLED:'true'}));
});
async function database(){
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const data=await boot.dumpDataDir();await boot.close();
 const db=new PGlite({database:'resolute',loadDataDir:data});
 await db.exec('CREATE ROLE resolute_plan_writer;CREATE ROLE resolute_notification_writer');
 for(const f of ['001_entitlements.sql','002_plans.sql','003_plan_answers_fx.sql','004_notification_settings.sql','005_notification_outbox.sql','017_notification_suppressions.sql','018_protection_outbox.sql'])await db.exec(readFileSync(new URL('../db/resolute/'+f,import.meta.url),'utf8'));
 await db.exec(`GRANT USAGE ON SCHEMA resolute TO resolute_plan_writer,resolute_notification_writer;
 GRANT SELECT ON resolute.entitlements TO resolute_plan_writer,resolute_notification_writer;
 GRANT SELECT,INSERT,UPDATE ON resolute.plans TO resolute_plan_writer;
 GRANT SELECT,INSERT ON resolute.plan_deletions TO resolute_plan_writer;
 GRANT SELECT,INSERT,UPDATE ON resolute.notification_settings TO resolute_notification_writer;
 INSERT INTO resolute.entitlements(clerk_user_id,product_id,kind,starts_at,source) VALUES('user_buyer','resolute_v1','use','2020-01-01','purchase');`);
 const pool={async connect(){return {async query(sql,args){const r=await db.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0};},release(){}};}};
 return {db,pool};
}
test('committed delete stays pending on upload failure; GET cannot claim completion; retry drains without a second delete',async()=>{
 const {db,pool}=await database();const storage=objects();let offline=true;
 const publish=createProtectionPublisher(storage,key);
 const barrier=createProtectionBarrier(async e=>{if(offline)throw Error('secret url');return publish(e);});
 const plan=createPlanStore(pool,'legacy',barrier);
 try{
  await db.exec('SET ROLE resolute_plan_writer');
  await assert.rejects(()=>plan('user_buyer','DELETE',{baseRevision:0,plan:null}),ProtectionUnavailable);
  const row=(await db.query('SELECT * FROM resolute.protection_outbox')).rows[0];
  assert.equal(row.kind,'delete');assert.equal(row.published_at,null);assert.equal(row.attempts,1);
  assert.equal((await db.query('SELECT revision,plan FROM resolute.plans')).rows[0].revision,1);
  await assert.rejects(()=>plan('user_buyer','GET'),ProtectionUnavailable);
  await assert.rejects(()=>db.exec('DELETE FROM resolute.protection_outbox'),e=>e.code==='42501');
  await assert.rejects(()=>db.exec("UPDATE resolute.protection_outbox SET kind='alerts_off'"),e=>e.code==='42501');
  offline=false;
  await db.exec("UPDATE resolute.protection_outbox SET next_attempt_at='-infinity'");
  await assert.rejects(()=>plan('user_buyer','DELETE',{baseRevision:0,plan:null}),PlanConflict);
  assert.deepEqual(await plan('user_buyer','GET'),{plan:null,revision:1});assert.equal(storage.files.size,1);
  assert.ok((await db.query('SELECT published_at FROM resolute.protection_outbox')).rows[0].published_at);
 }finally{await db.close();}
});
test('notification stop writes transactional durable retry record; retry publishes the same OFF state',async()=>{
 const {db,pool}=await database();const storage=objects();let offline=true;
 const publish=createProtectionPublisher(storage,key);const barrier=createProtectionBarrier(async e=>{if(offline)throw Error('offline');return publish(e);});
 const settings=createNotificationStore(pool,'legacy',barrier);
 const off={deliveryHourJst:7,alertsEnabled:false,morningEnabled:false,watchItems:[],surgeCapPct:null};
 try{
  await db.exec('SET ROLE resolute_notification_writer');
  await assert.rejects(()=>settings('user_buyer','PUT',{settings:off,baseRevision:0}),ProtectionUnavailable);
  assert.equal((await db.query('SELECT * FROM resolute.protection_outbox')).rows.length,2);
  await assert.rejects(()=>settings('user_buyer','GET'),ProtectionUnavailable);
  offline=false;await db.exec("UPDATE resolute.protection_outbox SET next_attempt_at='-infinity'");
  assert.deepEqual(await settings('user_buyer','GET'),{settings:off,revision:1});assert.equal(storage.files.size,2);
  await db.exec('RESET ROLE;ALTER TABLE resolute.protection_outbox RENAME TO missing_outbox');
  // A broken transactional journal prevents the setting mutation itself.
  await assert.rejects(()=>db.query("UPDATE resolute.notification_settings SET revision=2,updated_at=NOW()"));
  assert.equal((await db.query('SELECT revision FROM resolute.notification_settings')).rows[0].revision,1);
 }finally{await db.close();}
});

test('retry worker is off by default; bounded batches continue past one failing user without logging identities',async()=>{
 const {main,retryProtectionBatch}=await import('../services/resolute-api/protection-retry.mjs');
 assert.deepEqual(await main({}),{event:'RESOLUTE_PROTECTION_RETRY_DISABLED'});
 let released=0;const seen=[];const pool={async connect(){return {async query(sql){return sql.includes('count(*)')?{rows:[{pending:'1',due:'0'}]}:{rows:[{clerk_user_id:'user_one'},{clerk_user_id:'user_two'}]};},release(){released++;}};}};
 const result=await retryProtectionBatch(pool,async(_client,user)=>{seen.push(user);if(user==='user_one')throw Error('secret');});
 assert.deepEqual(result,{checked:2,completed:1,failed:1,remainingBatch:0,pending:1,dueRemaining:0});assert.equal(released,1);assert.equal(seen.length,2);
 assert.ok(!JSON.stringify(result).includes('user_'));
 await assert.rejects(()=>retryProtectionBatch(pool,async()=>{},{limit:101}));
});

test('a successful limited retry still reports unselected and delayed events',async()=>{
 const {retryProtectionBatch}=await import('../services/resolute-api/protection-retry.mjs');
 const db=new PGlite();let released=0;
 try{
  await db.exec(`CREATE SCHEMA resolute;CREATE TABLE resolute.protection_outbox
   (clerk_user_id text,published_at timestamptz,next_attempt_at timestamptz);
   INSERT INTO resolute.protection_outbox VALUES
    ('user_a',NULL,NOW()),('user_b',NULL,NOW()),('user_c',NULL,NOW()+INTERVAL '1 day');`);
  const client={query:(sql,args)=>db.query(sql,args),release(){released++;}};
  const pool={async connect(){return client;}};
  const publish=async(c,user)=>{await c.query('UPDATE resolute.protection_outbox SET published_at=NOW() WHERE clerk_user_id=$1',[user]);};
  const first=await retryProtectionBatch(pool,publish,{limit:1});
  assert.deepEqual(first,{checked:1,completed:1,failed:0,remainingBatch:0,pending:2,dueRemaining:1});
  const second=await retryProtectionBatch(pool,publish,{limit:1});
  assert.equal(second.pending,1);assert.equal(second.dueRemaining,0);
  const delayed=await retryProtectionBatch(pool,publish,{limit:1});
  assert.equal(delayed.checked,0);assert.equal(delayed.pending,1);
  assert.equal(released,3);
 }finally{await db.close();}
});
