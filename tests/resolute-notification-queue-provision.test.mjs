import test from 'node:test';
import assert from 'node:assert/strict';
import {main,provisionNotificationQueue} from '../scripts/resolute/provision-notification-queue.mjs';

test('queue role provisioning does nothing unless explicitly enabled',async()=>{
 assert.deepEqual(await main({}),{event:'RESOLUTE_NOTIFICATION_QUEUE_PROVISION_DISABLED'});
});
test('queue role provisioning refuses a wrong database scope or weak password',async()=>{
 const base={RESOLUTE_PROVISION_NOTIFICATION_QUEUE:'true',RESOLUTE_SETUP_DB_URL:'postgresql://u:p@postgres.railway.internal:5432/resolute',RESOLUTE_NOTIFICATION_QUEUE_PASSWORD:'a'.repeat(64)};
 for(const patch of [{RESOLUTE_SETUP_DB_URL:'postgresql://u:p@example.com:5432/resolute'},{RESOLUTE_SETUP_DB_URL:'postgresql://u:p@postgres.railway.internal:5432/other'},{RESOLUTE_NOTIFICATION_QUEUE_PASSWORD:'short'}])
  await assert.rejects(main({...base,...patch}),/Invalid setup scope/);
});
const SCHEMA=`CREATE SCHEMA resolute; CREATE SCHEMA resolute_payments_live;
 CREATE TABLE resolute.plans(clerk_user_id text,revision int); CREATE TABLE resolute.entitlements(clerk_user_id text,kind text);
 CREATE TABLE resolute.notification_settings(clerk_user_id text,settings jsonb,revision int);
 CREATE TABLE resolute.notification_state(clerk_user_id text PRIMARY KEY,rule_key text NOT NULL,notified jsonb NOT NULL);
 CREATE TABLE resolute.notification_outbox(idempotency_key text PRIMARY KEY,clerk_user_id text NOT NULL,kind text NOT NULL,delivery_date_jst date NOT NULL,payload jsonb NOT NULL,created_at timestamptz DEFAULT now(),accepted_at timestamptz);
 CREATE TABLE resolute_payments_live.entitlement_periods(id text);`;
async function db(){
 const {PGlite}=await import('@electric-sql/pglite');
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const data=await boot.dumpDataDir();await boot.close();
 return new PGlite({database:'resolute',loadDataDir:data});
}
test('queue role gets only the queue grants, probes roll back, and a second run stops',async()=>{
 const d=await db();
 try{
  await d.exec(SCHEMA);
  await provisionNotificationQueue(d,'b'.repeat(64));
  assert.equal((await d.query("SELECT rolcanlogin,rolsuper,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname='resolute_notification_queue'")).rows[0].rolcanlogin,true);
  assert.equal((await d.query('SELECT count(*)::int AS n FROM resolute.notification_outbox')).rows[0].n,0);
  assert.equal((await d.query('SELECT count(*)::int AS n FROM resolute.notification_state')).rows[0].n,0);
  assert.equal((await d.query("SELECT to_regclass('resolute.queue_probe') AS t")).rows[0].t,null);
  await assert.rejects(provisionNotificationQueue(d,'c'.repeat(64)),/Role already exists/);
 }finally{await d.close();}
});
test('missing tables or a weak password stop before any role is created',async()=>{
 const d=await db();
 try{
  await d.exec('CREATE SCHEMA resolute; CREATE SCHEMA resolute_payments_live;');
  await assert.rejects(provisionNotificationQueue(d,'b'.repeat(64)),/Required table missing/);
  await assert.rejects(provisionNotificationQueue(d,'weak'),/Invalid setup scope/);
  assert.equal((await d.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname='resolute_notification_queue'")).rows[0].n,0);
 }finally{await d.close();}
});
