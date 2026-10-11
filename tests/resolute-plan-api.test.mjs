import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { parsePlan, parsePlanMutation } from '../lib/resolute/plan-data.ts';
import { createPlanStore, PlanAccessDenied, PlanConflict } from '../lib/resolute/plan-database.ts';
import { createPlanRoutes } from '../lib/resolute/plan-route.ts';
import { fetchResolutePlan } from '../lib/resolute/plan-transport.ts';
import { createHandler } from '../services/resolute-api/handler.mjs';

const plan = {schemaVersion:1,currency:'JPY',monthlyLivingCost:250000,savingsMonths:12,reserveMonths:6,
 nearTermExpense:2000000,financialAssets:10000000,investedAmount:3000000,investable:6500000,
 tolerancePct:20,toleranceDrop:600000,perStockCapPct:10,buyMode:'steps',
 buyLines:[{dropPct:10,amount:200000},{dropPct:20,amount:200000}],buyBudgetPct:10,
 allocation:'equal',noBuyConditions:['生活費を使わない'],haltConditions:[],ruleType:'scale_in'};
const request=(method,body,origin='https://app.test')=>new Request('https://app.test/api/resolute/plan',{
 method,headers:{Origin:origin,'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body)});

test('plan schema excludes answers/fx, timestamps and identity and verifies precise derived money',()=>{
 assert.deepEqual(parsePlan(plan),plan); // Buy total exceeds budget: allowed, UI warning only.
 for(const patch of [{answers:{}},{fx:{}},{createdAt:'2020-01-01'},{userId:'user_other'},
  {investable:6500001},{toleranceDrop:600001},{savingsMonths:600.1},{savingsMonths:0.01},
  {buyLines:[{dropPct:20,amount:1},{dropPct:10,amount:1}]},{buyLines:[{dropPct:10,amount:1},{dropPct:10,amount:1}]},
  {buyLines:[{dropPct:100,amount:1},{dropPct:101,amount:1}]},{buyMode:'none'},
  {noBuyConditions:['x'.repeat(101)]},{haltConditions:Array(11).fill('x')}])
  assert.throws(()=>parsePlan({...plan,...patch}),/INVALID_PLAN/);
 assert.equal(parsePlan({...plan,financialAssets:null,investable:null}).investable,null);
 assert.throws(()=>parsePlanMutation('DELETE',{baseRevision:-1}));
 assert.throws(()=>parsePlanMutation('DELETE',{baseRevision:0,plan}));
 assert.throws(()=>parsePlanMutation('PUT',{baseRevision:0,plan:{...plan,fx:null}}));
});

test('PostgreSQL create/update/delete/recreate preserve revision, ownership and revoked deletion',async()=>{
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const data=await boot.dumpDataDir();await boot.close();
 const db=new PGlite({database:'resolute',loadDataDir:data});
 // Separate leases serialize this single embedded connection. Production uses DB transaction locks.
 let tail=Promise.resolve();
 const pool={async connect(){let unlock;const previous=tail;tail=new Promise(r=>unlock=r);await previous;
  return {async query(sql,args){const r=await db.query(sql,args);return {...r,rowCount:sql.trimStart().startsWith('SELECT') ? r.rows.length : r.affectedRows};},release(){unlock();}};}};
 const store=createPlanStore(pool);
 try {
  for(const file of ['001_entitlements.sql','002_plans.sql'])await db.exec(readFileSync(new URL('../db/resolute/'+file,import.meta.url),'utf8'));
  await db.query(`INSERT INTO resolute.entitlements(clerk_user_id,product_id,kind,starts_at,source)
   VALUES('user_buyer','resolute_v1','use','2020-01-01','purchase')`);
  assert.deepEqual(await store('user_buyer','GET'),{plan:null,revision:0});
  await assert.rejects(()=>store('user_other','GET'),PlanAccessDenied);
  const saved=await store('user_buyer','PUT',{baseRevision:0,plan});assert.equal(saved.revision,1);
  assert.equal(saved.plan.createdAt,saved.plan.updatedAt);
  const outcomes=await Promise.allSettled([store('user_buyer','PUT',{baseRevision:1,plan}),store('user_buyer','DELETE',{baseRevision:1,plan:null})]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(outcomes.find(r=>r.status==='rejected').reason.snapshot.revision,2);
  const deleted=await store('user_buyer','DELETE',{baseRevision:2,plan:null});
  assert.deepEqual(deleted,{plan:null,revision:3});assert.deepEqual(await store('user_buyer','GET'),deleted);
  await assert.rejects(()=>store('user_buyer','PUT',{baseRevision:2,plan}),PlanConflict);
  const recreated=await store('user_buyer','PUT',{baseRevision:3,plan});assert.equal(recreated.revision,4);
  await db.query(`UPDATE resolute.entitlements SET revoked_at=CURRENT_TIMESTAMP WHERE clerk_user_id='user_buyer'`);
  await assert.rejects(()=>store('user_buyer','GET'),PlanAccessDenied);
  await assert.rejects(()=>store('user_buyer','PUT',{baseRevision:4,plan}),PlanAccessDenied);
  await assert.rejects(()=>store('user_buyer','DELETE',{baseRevision:3,plan:null}),e=>e instanceof PlanConflict && e.snapshot.plan===null && e.snapshot.revision===4);
  assert.deepEqual(await store('user_buyer','DELETE',{baseRevision:4,plan:null}),{plan:null,revision:5});
  assert.deepEqual(await store('user_buyer','DELETE',{baseRevision:5,plan:null}),{plan:null,revision:6});
  assert.deepEqual(await store('user_missing','DELETE',{baseRevision:0,plan:null}),{plan:null,revision:1});
  const tombstone=(await db.query("SELECT * FROM resolute.plans WHERE clerk_user_id='user_buyer'")).rows[0];
  assert.equal(tombstone.plan,null);assert.equal(tombstone.created_at,null);assert.equal(tombstone.updated_at,null);assert.ok(tombstone.deleted_at);
  const journal=await db.query('SELECT revision FROM resolute.plan_deletions ORDER BY clerk_user_id,revision');
  assert.equal(journal.rows.length,4);
  await db.exec('ALTER TABLE resolute.plan_deletions RENAME TO unavailable_ledger');
  await assert.rejects(()=>store('user_buyer','DELETE',{baseRevision:6,plan:null}));
  assert.equal((await db.query("SELECT revision FROM resolute.plans WHERE clerk_user_id='user_buyer'")).rows[0].revision,6);
  await db.exec('ALTER TABLE resolute.unavailable_ledger RENAME TO plan_deletions');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM resolute.entitlements')).rows[0].n,1);
  await assert.rejects(()=>db.query(`UPDATE resolute.plans SET plan='{"answers":{}}',created_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,deleted_at=NULL WHERE clerk_user_id='user_buyer'`));
 } finally {await db.close();}
});

test('browser route enforces origin, authentication, bounded JSON and no private error detail',async()=>{
 let calls=0;
 const routes=createPlanRoutes({session:async()=>'jwt',forward:async(token,method,mutation)=>{
  calls++;assert.equal(token,'jwt');assert.equal(method,'DELETE');assert.equal(mutation.baseRevision,7);
  return {status:409,body:{plan:null,revision:8}};
 }});
 assert.equal((await routes.DELETE(request('DELETE',{baseRevision:7},'https://evil.test'))).status,403);
 assert.equal((await routes.PUT(request('PUT',{baseRevision:0,plan:{...plan,answers:{}}}))).status,400);
 assert.equal((await routes.PUT(request('PUT',{baseRevision:0,plan:'x'.repeat(17000)}))).status,413);
 assert.equal(calls,0);
 const conflict=await routes.DELETE(request('DELETE',{baseRevision:7}));assert.equal(conflict.status,409);
 assert.deepEqual(await conflict.json(),{plan:null,revision:8});assert.match(conflict.headers.get('cache-control'),/no-store/);
 const loggedOut=createPlanRoutes({session:async()=>null,forward:async()=>{throw Error('must not forward');}});
 assert.equal((await loggedOut.GET(request('GET'))).status,401);
 const failed=createPlanRoutes({session:async()=>{throw Error('postgres://SECRET');},forward:async()=>{}});
 assert.deepEqual(await (await failed.GET(request('GET'))).json(),{error:'PLAN_UNAVAILABLE'});
});

test('Railway plan endpoint and Vercel transport preserve conflicts without retrying mutations',async()=>{
 const handler=createHandler({},async()=>{},async()=>'user_buyer',async(id,method,mutation)=>{
  assert.equal(id,'user_buyer');assert.equal(method,'DELETE');assert.equal(mutation.baseRevision,5);
  throw new PlanConflict({plan:null,revision:6});
 });
 const internal=new Request('https://railway.test/internal/v1/plan',{method:'DELETE',headers:{'Content-Type':'application/json'},body:'{"baseRevision":5}'});
 const response=await handler(internal);assert.equal(response.status,409);
 let count=0;
 const result=await fetchResolutePlan('jwt','https://resolute.up.railway.app','s'.repeat(64),'DELETE',{baseRevision:5,plan:null},async(url,options)=>{
  count++;assert.equal(url.pathname,'/internal/v1/plan');assert.equal(options.body,'{"baseRevision":5}');return response;
 });
 assert.equal(count,1);assert.deepEqual(result,{status:409,body:{plan:null,revision:6}});
 await assert.rejects(()=>fetchResolutePlan('jwt','https://resolute.up.railway.app','s'.repeat(64),'PUT',{baseRevision:0,plan},async()=>{count++;throw Error('lost');}));
 assert.equal(count,2);
 const denied=createHandler({},async()=>{},async()=>'user_buyer',async()=>{throw new PlanAccessDenied();});
 assert.equal((await denied(new Request('https://railway.test/internal/v1/plan'))).status,403);
});

test('isolated restore reapplies latest deletion markers and preserves newer recreated plans',async()=>{
 const {applyPlanDeletionLedger}=await import('../lib/resolute/plan-restore.ts');
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute_restore_test');const data=await boot.dumpDataDir();await boot.close();
 const db=new PGlite({database:'resolute_restore_test',loadDataDir:data});
 const pool={async connect(){return {query:(sql,args)=>db.query(sql,args),release(){}};}};
 try {
  await db.exec('CREATE SCHEMA resolute');
  const migration=readFileSync(new URL('../db/resolute/002_plans.sql',import.meta.url),'utf8');
  // Apply the identical table definitions without the production-database migration guard.
  await db.exec(migration.slice(migration.indexOf('CREATE TABLE'),migration.indexOf('-- Provision')));
  for(const [id,revision] of [['user_old',2],['user_recreated',7]])await db.query(`INSERT INTO resolute.plans
   (clerk_user_id,revision,plan,created_at,updated_at) VALUES($1,$2,$3,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,[id,revision,JSON.stringify(plan)]);
  const marker=(userId,revision)=>({userId,revision,deletedAt:'2026-10-12T00:00:00.000Z'});
  const ledger=[marker('user_old',1),marker('user_old',3),marker('user_recreated',5),marker('user_absent',4)];
  assert.deepEqual(await applyPlanDeletionLedger(pool,ledger),{usersChecked:3});
  const rows=(await db.query('SELECT clerk_user_id,revision,plan FROM resolute.plans ORDER BY clerk_user_id')).rows;
  assert.equal(rows[0].clerk_user_id,'user_absent');assert.equal(rows[0].plan,null);assert.equal(rows[0].revision,4);
  assert.equal(rows[1].plan,null);assert.equal(rows[1].revision,3);
  assert.deepEqual(rows[2].plan,plan);assert.equal(rows[2].revision,7);
  await applyPlanDeletionLedger(pool,ledger);
  assert.equal((await db.query('SELECT revision FROM resolute.plans WHERE clerk_user_id=\'user_recreated\'')).rows[0].revision,7);
  await assert.rejects(()=>applyPlanDeletionLedger(pool,[marker('user_old',9),{...marker('user_other',1),answers:{}}]));
  assert.equal((await db.query('SELECT revision FROM resolute.plans WHERE clerk_user_id=\'user_old\'')).rows[0].revision,3);
 } finally {await db.close();}
 const wrong=new PGlite();
 try {await assert.rejects(()=>applyPlanDeletionLedger({async connect(){return {query:(sql,args)=>wrong.query(sql,args),release(){}};}},[]),/Isolated/);}
 finally {await wrong.close();}
});
