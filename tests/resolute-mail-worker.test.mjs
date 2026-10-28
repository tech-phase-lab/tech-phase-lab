import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createMailWorker} from '../lib/resolute/notification-mail-worker.ts';
const now=()=>new Date('2027-02-03T22:00:00Z');
function fixture(statuses){let active=false;const writes=[];return {writes,pool:{connect:async()=>{assert.equal(active,false,'release selection before delivery connection');active=true;return {query:async(sql,args)=>{
 if(sql.includes('LIMIT 26')){assert.deepEqual(args,['2027-02-04','7']);assert.match(sql,/kind IN/);return {rows:statuses.map((status,i)=>({clerk_user_id:'user_'+i,idempotency_key:'user_'+i+':2027-02-04:alerts',status}))};}
 writes.push(JSON.parse(args[2]));return {rows:[]};
 },release:()=>{active=false;}};}}};}
test('worker is disabled by default with zero I/O',async()=>{
 const result=await createMailWorker({connect:async()=>assert.fail('no DB')},{deliver:async()=>assert.fail('no mail')})();assert.equal(result.enabled,false);assert.equal(result.checked,0);
});
test('worker reconciles attempts without resending and continues past one user failure',async()=>{
 const f=fixture(['queued','attempting','queued','queued']),calls=[];
 const report=await createMailWorker(f.pool,{enabled:true,now,deliver:async(user,key,mode)=>{calls.push(mode);const c=await f.pool.connect();c.release();if(user==='user_2')throw Error('private secret');return user==='user_0'?'accepted':user==='user_1'?'reconciled':'suppressed';}})();
 assert.deepEqual(calls,['send','reconcile','send','send']);assert.equal(report.accepted,1);assert.equal(report.reconciled,1);assert.equal(report.errors,1);assert.equal(report.suppressed,1);assert.equal(f.writes.length,4);assert.ok(!JSON.stringify(report).includes('private'));
});
test('worker bounds selection and keeps unknown outcomes visible',async()=>{
 const f=fixture(Array(26).fill('attempting'));let count=0;
 const report=await createMailWorker(f.pool,{enabled:true,now,deliver:async(u,k,mode)=>{count++;assert.equal(mode,'reconcile');return 'uncertain';}})();
 assert.equal(count,25);assert.equal(report.incomplete,true);assert.equal(report.uncertain,25);
});
test('operator entry point defaults off and refuses missing prerequisites before DB access',()=>{
 for(const env of [{},{RESOLUTE_MAIL_DELIVERY_ENABLED:'true'}]){
  const r=spawnSync(process.execPath,['--experimental-strip-types','services/resolute-api/mail-worker.mjs'],{encoding:'utf8',env:{PATH:process.env.PATH,...env}});
  assert.equal(r.status,1);assert.deepEqual(JSON.parse(r.stdout),env.RESOLUTE_MAIL_DELIVERY_ENABLED?{error:'MAIL_WORKER_UNAVAILABLE'}:{enabled:false});
 }
});
test('sender migration grants only outbox receipts and leaves the identity unable to log in',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');const {readFileSync}=await import('node:fs');
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const data=await boot.dumpDataDir();await boot.close();const db=new PGlite({database:'resolute',loadDataDir:data});try{
  await db.exec("CREATE SCHEMA resolute; CREATE SCHEMA resolute_payments_live; CREATE TABLE resolute.plans(id text); CREATE TABLE resolute.notification_settings(id text,clerk_user_id text,settings jsonb); CREATE TABLE resolute.notification_outbox(idempotency_key text,kind text,payload jsonb,accepted_at timestamptz,clerk_user_id text,delivery_date_jst date,created_at timestamptz DEFAULT CURRENT_TIMESTAMP); CREATE TABLE resolute_payments_live.entitlement_periods(id text); INSERT INTO resolute.notification_outbox(idempotency_key,kind,payload,accepted_at) VALUES('fixture','alerts','{}',NULL)");
  const sql=readFileSync(new URL('../db/resolute/020_mail_sender_permissions.sql',import.meta.url),'utf8');await db.exec(sql);
  assert.equal((await db.query("SELECT rolcanlogin FROM pg_roles WHERE rolname='resolute_notification_sender'")).rows[0].rolcanlogin,false);
  await db.exec('SET ROLE resolute_notification_sender');await db.exec("SELECT * FROM resolute_payments_live.entitlement_periods; UPDATE resolute.notification_outbox SET payload='{}',accepted_at=CURRENT_TIMESTAMP");
  for(const statement of ["DELETE FROM resolute.notification_outbox","UPDATE resolute.notification_outbox SET idempotency_key='other'","INSERT INTO resolute.notification_outbox(payload) VALUES('{}')","UPDATE resolute.notification_settings SET id='other'"])await assert.rejects(()=>db.exec(statement),/permission denied/);
  await db.exec('RESET ROLE');
  await db.query('INSERT INTO resolute.notification_settings(clerk_user_id,settings) VALUES($1,$2)',['user_a',JSON.stringify({deliveryHourJst:7})]);
  for(const [key,kind,date,status] of [['due','alerts','2027-02-04','queued'],['old','alerts','2027-02-03','queued'],['uncertain','alerts','2027-02-03','attempting'],['morning','morning','2027-02-04',null]])await db.query('INSERT INTO resolute.notification_outbox(idempotency_key,clerk_user_id,kind,delivery_date_jst,payload) VALUES($1,$2,$3,$4,$5)',[key,'user_a',kind,date,JSON.stringify(status?{reservation:{status,provider:'resend'}}:{})]);
  const called=[];const report=await createMailWorker({connect:async()=>({query:(...args)=>db.query(...args),release:()=>{}})},{enabled:true,now,deliver:async(u,key,mode)=>{called.push([key,mode]);return mode==='send'?'accepted':'reconciled';}})();
  assert.deepEqual(called.sort(),[['due','send'],['morning','send'],['uncertain','reconcile']]);assert.equal(report.checked,3);
  await assert.rejects(()=>db.exec(sql),/already exists/);await db.exec('ROLLBACK');
 }finally{await db.close();}
});
