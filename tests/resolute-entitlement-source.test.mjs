import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { entitlementSource, readEntitlementSnapshot } from '../lib/resolute/entitlement-source.ts';
import { createPlanStore, PlanAccessDenied } from '../lib/resolute/plan-database.ts';
import { createNotificationStore, NotificationAccessDenied } from '../lib/resolute/notification-database.ts';
import { createNotificationOutboxJob } from '../lib/resolute/notification-outbox.ts';
import { defaultNotificationSettings } from '../lib/resolute/notification-settings.ts';

test('source accepts only explicit server modes',()=>{
  assert.equal(entitlementSource('legacy'),'legacy');assert.equal(entitlementSource('live'),'live');
  for(const value of ['','sandbox','LIVE','live; DROP TABLE']) assert.throws(()=>entitlementSource(value));
});
test('live API, plan, settings and outbox agree without using legacy grants',async()=>{
  const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const data=await boot.dumpDataDir();await boot.close();
  const db=new PGlite({database:'resolute',loadDataDir:data});
  const query=async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows||0};};
  const pool={query,connect:async()=>({query,release(){}})};
  const plans=createPlanStore(pool,'live'),settings=createNotificationStore(pool,'live');
  const read=()=>readEntitlementSnapshot(pool,'user_buyer','live');
  let sourceCalls=0;
  const job=createNotificationOutboxJob(pool,async()=>{sourceCalls++;throw Error('Must not fetch prices when access is denied');},()=>new Date(),'live');
  try {
    for(const f of ['001_entitlements.sql','002_plans.sql','003_plan_answers_fx.sql','004_notification_settings.sql','005_notification_outbox.sql','014_payments_live.sql'])
      await db.exec(readFileSync(new URL('../db/resolute/'+f,import.meta.url),'utf8'));
    await db.exec("INSERT INTO resolute.entitlements VALUES ('user_buyer','resolute_v1','use','2000-01-01',NULL,NULL,'admin',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
    assert.equal((await read()).view.canUseTools,false);
    await assert.rejects(plans('user_buyer','GET'),PlanAccessDenied);
    await assert.rejects(settings('user_buyer','GET'),NotificationAccessDenied);
    await db.exec(`INSERT INTO resolute_payments_live.orders
      (id,user_id,request_key,capture_key,quote,paypal_id,capture_id,state,created_at,expires_at,paid_at)
      VALUES ('00000000-0000-4000-8000-000000000001','user_buyer','00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003','{"product":"resolute_v1","kind":"initial"}','ORDER','CAPTURE','paid','2000-01-01','2000-01-02','2000-01-01');
      INSERT INTO resolute_payments_live.grants VALUES ('00000000-0000-4000-8000-000000000001','user_buyer','initial','2000-01-01','2100-01-01','active')`);
    assert.equal((await read()).view.canReceiveNotifications,true);
    assert.equal((await plans('user_buyer','GET')).revision,0);
    await settings('user_buyer','PUT',{settings:{...defaultNotificationSettings(),alertsEnabled:true,watchItems:[{symbol:"AAA",referencePrice:100}]},baseRevision:0});
    assert.equal((await settings('user_buyer','GET')).revision,1);
    assert.equal((await readEntitlementSnapshot(pool,'user_other','live')).view.canUseTools,false);
    // Expired alerts do not remove perpetual content/settings access.
    await db.exec("UPDATE resolute_payments_live.grants SET expires_at='2001-01-01'");
    assert.equal((await read()).view.canUseTools,true);
    assert.equal((await read()).view.canReceiveNotifications,false);
    assert.deepEqual(await job('user_buyer'),[]);assert.equal(sourceCalls,0);
    assert.equal((await settings('user_buyer','GET')).revision,1);
    await db.exec(`INSERT INTO resolute_payments_live.orders
      (id,user_id,request_key,capture_key,quote,paypal_id,capture_id,state,created_at,expires_at,paid_at)
      VALUES ('00000000-0000-4000-8000-000000000004','user_buyer','00000000-0000-4000-8000-000000000005',
      '00000000-0000-4000-8000-000000000006','{"product":"resolute_v1","kind":"renewal"}','ORDER2','CAPTURE2','paid','2000-01-01','2000-01-02','2000-01-01');
      INSERT INTO resolute_payments_live.grants VALUES ('00000000-0000-4000-8000-000000000004','user_buyer','renewal','2100-01-01','2101-01-01','active')`);
    assert.equal((await read()).view.alerts.status,'scheduled');
    assert.equal((await read()).view.canReceiveNotifications,false);
    await db.exec("CREATE ROLE entitlement_view_reader; GRANT USAGE ON SCHEMA resolute_payments_live TO entitlement_view_reader; GRANT SELECT ON resolute_payments_live.entitlement_periods TO entitlement_view_reader; SET ROLE entitlement_view_reader");
    assert.equal((await read()).view.canUseTools,true);
    await assert.rejects(db.query('SELECT * FROM resolute_payments_live.orders'),e=>e.code==='42501');
    await db.exec('RESET ROLE');
    // Order state alone is enough to block every reader even if a grant is stale.
    await db.exec("UPDATE resolute_payments_live.orders SET state='revoked'");
    assert.equal((await read()).view.canUseTools,false);
    await assert.rejects(plans('user_buyer','GET'),PlanAccessDenied);
    await assert.rejects(settings('user_buyer','GET'),NotificationAccessDenied);
    assert.deepEqual(await job('user_buyer'),[]);assert.equal(sourceCalls,0);
    // Owners can still delete their saved plan after entitlement loss.
    assert.equal((await plans('user_buyer','DELETE',{baseRevision:0,plan:null})).revision,1);
  } finally {await db.close();}
});
