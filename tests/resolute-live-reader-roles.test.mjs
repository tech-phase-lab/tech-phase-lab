import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {readEntitlementSnapshot} from '../lib/resolute/entitlement-source.ts';
const sql=name=>readFileSync(new URL('../db/resolute/'+name,import.meta.url),'utf8');
const roles=['resolute_api_reader','resolute_plan_writer','resolute_notification_writer'];
test('live consumer grants are atomic, view-only and observe revocation without exposing raw payments',async()=>{
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const data=await boot.dumpDataDir();await boot.close();
 const db=new PGlite({database:'resolute',loadDataDir:data});
 try {
  await db.exec(sql('014_payments_live.sql'));
  await assert.rejects(db.exec(sql('016_live_entitlement_readers.sql')));
  await db.exec('ROLLBACK');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('resolute_plan_writer','resolute_notification_writer')")).rows[0].n,0);
  await db.exec('CREATE ROLE resolute_api_reader NOLOGIN');
  await db.exec(sql('016_live_entitlement_readers.sql'));
  await db.exec(sql('016_live_entitlement_readers.sql')); // retry grants are harmless
  await db.exec(`INSERT INTO resolute_payments_live.orders
   (id,user_id,request_key,capture_key,quote,capture_id,state,created_at,expires_at,paid_at)
   VALUES('00000000-0000-4000-8000-000000000001','user_buyer','00000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000003','{"product":"resolute_v1","kind":"initial"}','CAPTURE','paid','2000-01-01','2000-01-02','2000-01-01');
   INSERT INTO resolute_payments_live.grants VALUES('00000000-0000-4000-8000-000000000001','user_buyer','initial','2000-01-01','2100-01-01','active')`);
  for(const role of roles) {
   await db.exec('SET ROLE '+role);
   assert.equal((await readEntitlementSnapshot(db,'user_buyer','live')).view.canReceiveNotifications,true);
   assert.equal((await readEntitlementSnapshot(db,'user_other','live')).view.canUseTools,false);
   for(const table of ['orders','grants','events','audit','alert_outbox'])await assert.rejects(db.query('SELECT * FROM resolute_payments_live.'+table),e=>e.code==='42501');
   await assert.rejects(db.exec('DELETE FROM resolute_payments_live.entitlement_periods'),e=>e.code==='42501'||e.code==='55000');
   await assert.rejects(db.exec('CREATE TABLE resolute_payments_live.forbidden(id int)'),e=>e.code==='42501');
   await db.exec('RESET ROLE');
  }
  for(const state of ['suspended','revoked']) {
   await db.query('UPDATE resolute_payments_live.orders SET state=$1',[state]);
   for(const role of roles){await db.exec('SET ROLE '+role);assert.equal((await readEntitlementSnapshot(db,'user_buyer','live')).view.canUseTools,false);await db.exec('RESET ROLE');}
  }
  assert.equal((await db.query("SELECT bool_and(NOT rolcanlogin) AS dormant FROM pg_roles WHERE rolname=ANY($1)",[roles])).rows[0].dormant,true);
 }finally{await db.close();}
});
