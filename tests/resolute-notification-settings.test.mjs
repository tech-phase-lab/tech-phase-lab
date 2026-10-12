import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {defaultNotificationSettings,parseNotificationSettings,parseNotificationMutation} from '../lib/resolute/notification-settings.ts';
import {createNotificationStore,NotificationAccessDenied,NotificationConflict} from '../lib/resolute/notification-database.ts';
import {createNotificationOutboxJob} from '../lib/resolute/notification-outbox.ts';
import {createNotificationRoutes} from '../lib/resolute/notification-route.ts';
import {requestNotificationSettings,NotificationClientError} from '../lib/resolute/notification-client.ts';
import {fetchNotificationSettings} from '../lib/resolute/notification-http.ts';
import {createHandler} from '../services/resolute-api/handler.mjs';
import {prepareNotificationSlot,jstSlot,NOTIFICATION_CRON_UTC} from '../lib/resolute/notification-job.ts';
import {emptyPlanAnswers} from '../lib/resolute/plan-answers.ts';
const defaults=defaultNotificationSettings();
const settings={...defaults,alertsEnabled:true,watchItems:[{symbol:'AAA',referencePrice:100}],surgeCapPct:50};
const rights=[{kind:'use',startsAt:'2026-01-01T00:00:00.000Z',expiresAt:null,revokedAt:null},{kind:'alerts',startsAt:'2026-01-01T00:00:00.000Z',expiresAt:'2028-01-01T00:00:00.000Z',revokedAt:null}];
const plan={schemaVersion:1,answersVersion:1,answers:emptyPlanAnswers(),fx:{thresholdYen:null,usdJpy:null,note:''},currency:'JPY',monthlyLivingCost:250000,savingsMonths:12,reserveMonths:6,nearTermExpense:0,financialAssets:10000000,investedAmount:3000000,investable:8500000,tolerancePct:20,toleranceDrop:600000,perStockCapPct:20,buyMode:'steps',buyLines:[{dropPct:10,amount:100000},{dropPct:20,amount:100000}],buyBudgetPct:10,allocation:'equal',noBuyConditions:[],haltConditions:[],ruleType:'undecided'};
const inputs={locale:'en',preferencesConfigured:true,recipientVerified:true,unsubscribed:false,marketDate:'2027-02-03',closes:[{symbol:'AAA',date:'2027-02-03',close:80,isFinal:true}]};
const context={...inputs,settings,entitlements:rights,plan,state:{},lastConfirmedAlert:null};
const now=new Date('2027-02-03T22:00:00.000Z');

test('notification settings validate four JST hours, explicit consent, limits and no identity/email fields',()=>{
 assert.equal(defaults.deliveryHourJst,7);assert.equal(defaults.morningEnabled,false);assert.equal(defaults.alertsEnabled,false);
 for(const hour of [7,8,9,10])assert.equal(parseNotificationSettings({...settings,deliveryHourJst:hour}).deliveryHourJst,hour);
 for(const patch of [{deliveryHourJst:11},{deliveryHourJst:'7'},{morningEnabled:'true'},{email:'secret@example.test'},{clerkUserId:'user_other'},
 {watchItems:[]},{watchItems:[{symbol:'AAA',referencePrice:NaN}]},{watchItems:[{symbol:'AAA',referencePrice:0}]},
 {watchItems:[{symbol:'AAA',referencePrice:1.234}]},{watchItems:[...settings.watchItems,...settings.watchItems]},
 {watchItems:[{symbol:'<script>',referencePrice:1}]},{surgeCapPct:0},{surgeCapPct:1000.1},{surgeCapPct:1.23}])assert.throws(()=>parseNotificationSettings({...settings,...patch}));
 assert.throws(()=>parseNotificationMutation({settings,baseRevision:-1}));
 assert.throws(()=>parseNotificationMutation({settings,baseRevision:0,userId:'user_other'}));
});
test('JST slots cross UTC midnight and do not depend on DST or display timezone',()=>{
 assert.equal(NOTIFICATION_CRON_UTC,'0 0,1,22,23 * * *');
 for(const date of ['2027-02-03','2027-07-03'])for(const hour of [7,8,9,10]){
  const clock=new Date(`${date}T${String(hour).padStart(2,'0')}:00:00+09:00`);
  assert.equal(jstSlot(clock).hour,hour);
  const c={...context,marketDate:date.slice(0,8)+'02',closes:[{...inputs.closes[0],date:date.slice(0,8)+'02'}],settings:{...settings,deliveryHourJst:hour}};
  assert.equal(prepareNotificationSlot('user_buyer',clock,c).length,1);
  assert.equal(prepareNotificationSlot('user_buyer',new Date(clock.getTime()-1),c).length,0);
 }
 assert.deepEqual(jstSlot(now),{date:'2027-02-04',hour:7});
});
test('send gates require both RESOLUTE rights, verified recipient, saved locale, consent and a plan',()=>{
 for(const patch of [{entitlements:[]},{entitlements:[rights[0]]},{recipientVerified:false},{preferencesConfigured:false},{unsubscribed:true},{plan:null},
 {entitlements:[rights[0],{...rights[1],expiresAt:now.toISOString()}]},
 {entitlements:[{...rights[0],revokedAt:'2027-02-01T00:00:00.000Z'},rights[1]]},
 {settings:{...settings,alertsEnabled:false}},{settings:{...settings,deliveryHourJst:8}}])assert.deepEqual(prepareNotificationSlot('user_buyer',now,{...context,...patch}),[]);
});
test('non-final and missing prices stay unnotified and can trigger at the next chosen slot',()=>{
 const original=JSON.stringify(context.state);
 assert.deepEqual(prepareNotificationSlot('user_buyer',now,{...context,closes:[{...inputs.closes[0],isFinal:false}]}),[]);
 assert.deepEqual(prepareNotificationSlot('user_buyer',now,{...context,closes:[]}),[]);
 assert.equal(JSON.stringify(context.state),original);
 const next=prepareNotificationSlot('user_buyer',new Date('2027-02-04T22:00:00Z'),context);
 assert.equal(next[0].digest.payload.date,'2027-02-03');assert.equal(next[0].key,'user_buyer:2027-02-05:alerts');
 assert.throws(()=>prepareNotificationSlot('user_buyer',now,{...context,closes:[...inputs.closes,...inputs.closes]}),/Ambiguous/);
});
test('follow-up is off initially and only due the next JST day after a confirmed alert, at the shared hour',()=>{
 const c={...context,lastConfirmedAlert:{id:'old',acceptedAt:'2027-02-02T22:05:00Z'}};
 assert.equal(prepareNotificationSlot('user_buyer',now,c).filter(t=>t.kind==='morning').length,0);
 const on={...c,settings:{...settings,morningEnabled:true}};
 const tasks=prepareNotificationSlot('user_buyer',now,on);assert.equal(tasks.filter(t=>t.kind==='morning').length,1);assert.equal(tasks[0].sourceAlertId,'old');
 for(const acceptedAt of ['2027-02-03T22:00:00Z','2027-02-01T22:00:00Z','broken'])assert.equal(prepareNotificationSlot('user_buyer',now,{...on,lastConfirmedAlert:{id:'old',acceptedAt}}).filter(t=>t.kind==='morning').length,0);
});
async function database(){
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const data=await boot.dumpDataDir();await boot.close();const db=new PGlite({database:'resolute',loadDataDir:data});
 for(const name of ['001_entitlements.sql','002_plans.sql','003_plan_answers_fx.sql','004_notification_settings.sql','005_notification_outbox.sql'])await db.exec(readFileSync(new URL('../db/resolute/'+name,import.meta.url),'utf8'));
 await db.exec(`CREATE ROLE resolute_notification_writer;GRANT USAGE ON SCHEMA resolute TO resolute_notification_writer;GRANT SELECT ON resolute.entitlements TO resolute_notification_writer;GRANT SELECT,INSERT,UPDATE ON resolute.notification_settings TO resolute_notification_writer;`);
 await db.query("INSERT INTO resolute.entitlements(clerk_user_id,product_id,kind,starts_at,expires_at,source) VALUES('user_buyer','resolute_v1','use','2026-01-01',NULL,'purchase'),('user_buyer','resolute_v1','alerts','2026-01-01','2028-01-01','purchase')");
 let tail=Promise.resolve();
 const pool=(role)=>({async connect(){let unlock;const previous=tail;tail=new Promise(r=>unlock=r);await previous;return {async query(sql,args){const result=await db.query(sql,args);if(sql==='BEGIN'&&role)await db.exec('SET LOCAL ROLE '+role);return {...result,rowCount:result.rows.length||result.affectedRows||0};},release(){unlock();}};}});
 return {db,pool};
}
test('Postgres settings persist across reads, serialize conflicts and enforce separate ownership and role',async()=>{
 const {db,pool}=await database();const store=createNotificationStore(pool('resolute_notification_writer'));
 try{
  assert.deepEqual(await store('user_buyer','GET'),{settings:defaults,revision:0});
  await assert.rejects(()=>store('user_other','GET'),NotificationAccessDenied);
  const saved=await store('user_buyer','PUT',{settings,baseRevision:0});assert.equal(saved.revision,1);
  assert.deepEqual((await store('user_buyer','GET')).settings,settings);
  const outcomes=await Promise.allSettled([store('user_buyer','PUT',{settings:{...settings,deliveryHourJst:8},baseRevision:1}),store('user_buyer','PUT',{settings:{...settings,morningEnabled:true},baseRevision:1})]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);assert.ok(outcomes.find(x=>x.status==='rejected').reason instanceof NotificationConflict);
  await db.exec('SET ROLE resolute_notification_writer');await assert.rejects(()=>db.exec('UPDATE resolute.entitlements SET revoked_at=CURRENT_TIMESTAMP'),e=>e.code==='42501');await db.exec('RESET ROLE');
  await db.exec("UPDATE resolute.entitlements SET revoked_at=CURRENT_TIMESTAMP WHERE kind='use'");await assert.rejects(()=>store('user_buyer','GET'),NotificationAccessDenied);
 }finally{await db.close();}
});
test('durable queue commits state once, duplicate leaves new lines pending, and only confirmed mail causes follow-up',async()=>{
 const {db,pool}=await database();let clock=now;let feed=structuredClone(inputs);
 try{
  const store=createNotificationStore(pool());await store('user_buyer','PUT',{settings:{...settings,morningEnabled:true},baseRevision:0});
  await db.query("INSERT INTO resolute.plans(clerk_user_id,revision,plan,created_at,updated_at) VALUES('user_buyer',1,$1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",[JSON.stringify(plan)]);
  const job=createNotificationOutboxJob(pool(),async()=>feed,()=>clock);
  feed.closes[0].isFinal=false;assert.deepEqual(await job('user_buyer'),[]);assert.equal((await db.query('SELECT * FROM resolute.notification_state')).rows.length,0);
  feed.closes[0].isFinal=true;feed.closes[0].close=89;assert.deepEqual(await job('user_buyer'),[{kind:'alerts',status:'queued'}]);
  feed.closes[0].close=79;assert.deepEqual(await job('user_buyer'),[{kind:'alerts',status:'duplicate'}]);
  assert.deepEqual((await db.query('SELECT notified FROM resolute.notification_state')).rows[0].notified.AAA.lines,[10]);
  assert.equal((await db.query('SELECT * FROM resolute.notification_outbox')).rows.length,1);
  clock=new Date('2027-02-04T22:00:00Z');
  assert.deepEqual(await job('user_buyer'),[{kind:'alerts',status:'queued'}]); // Unconfirmed queue does not produce morning mail.
  await db.query("UPDATE resolute.notification_outbox SET accepted_at='2027-02-03T22:01:00Z' WHERE delivery_date_jst='2027-02-04'");
  assert.deepEqual(await job('user_buyer'),[{kind:'morning',status:'queued'}]);
  assert.deepEqual(await job('user_buyer'),[{kind:'morning',status:'duplicate'}]);
  const payloads=(await db.query('SELECT payload FROM resolute.notification_outbox')).rows;assert.ok(!JSON.stringify(payloads).includes('monthlyLivingCost'));
  await db.exec('ALTER TABLE resolute.notification_state RENAME TO unavailable_state');
  await assert.rejects(()=>job('user_buyer'));await db.exec('ALTER TABLE resolute.unavailable_state RENAME TO notification_state');
 }finally{await db.close();}
});
const req=(method,body,origin='https://app.test')=>new Request('https://app.test/api/resolute/notification-settings',{method,headers:{Origin:origin,'Content-Type':'application/json'},body:method==='PUT'?JSON.stringify(body):undefined});
test('HTTP proxies enforce auth, origin, body limit, shape and fail closed without secret disclosure',async()=>{
 let calls=0;const routes=createNotificationRoutes({session:async()=>'jwt',forward:async()=>{calls++;return {status:200,body:{settings,revision:1}};}});
 assert.equal((await routes.PUT(req('PUT',{settings,baseRevision:0},'https://evil.test'))).status,403);
 assert.equal((await routes.PUT(req('PUT',{settings:{...settings,email:'x'},baseRevision:0}))).status,400);
 assert.equal((await routes.PUT(req('PUT',{settings:'x'.repeat(9000),baseRevision:0}))).status,413);assert.equal(calls,0);
 assert.equal((await routes.PUT(req('PUT',{settings,baseRevision:0}))).status,200);
 const denied=createNotificationRoutes({session:async()=>null,forward:async()=>{throw Error('no');}});assert.equal((await denied.GET(req('GET'))).status,401);
 const failed=createNotificationRoutes({session:async()=>{throw Error('postgres://secret');},forward:async()=>{}});assert.deepEqual(await(await failed.GET(req('GET'))).json(),{error:'NOTIFICATION_UNAVAILABLE'});
 const handler=createHandler({},async()=>{},async()=>'user_buyer',undefined,async()=>{throw new NotificationConflict({settings,revision:4});});
 const forward=await fetchNotificationSettings('jwt','https://resolute.up.railway.app','x'.repeat(43),'PUT',{settings,baseRevision:0},async(url,init)=>handler(new Request(url,init)));
 assert.equal(forward.status,409);assert.equal(forward.body.revision,4);
 const unavailable=createHandler({},async()=>{},async()=>'user_buyer');assert.equal((await unavailable(new Request('https://service/internal/v1/notification-settings'))).status,503);
});
test('browser never retries uncertain saves and rejects mismatched success snapshots',async()=>{
 for(const status of [401,403,409,429,503]){let calls=0;await assert.rejects(()=>requestNotificationSettings({settings,baseRevision:0},undefined,async()=>{calls++;return Response.json({error:'no'},{status});}),e=>e instanceof NotificationClientError&&e.status===status);assert.equal(calls,1);}
 await assert.rejects(()=>requestNotificationSettings({settings,baseRevision:0},undefined,async()=>Response.json({settings,revision:0})));
 await assert.rejects(()=>requestNotificationSettings({settings,baseRevision:0},undefined,async()=>Response.json({settings:{...settings,deliveryHourJst:8},revision:1})));
 assert.equal((await requestNotificationSettings({settings,baseRevision:0},undefined,async()=>Response.json({settings,revision:1}))).revision,1);
});

test('dispatch rechecks time, revision, purchase, expiry and opt-out; disabled/duplicate never acknowledges',async()=>{
 const {dispatchNotification}=await import('../lib/resolute/notification-dispatch.ts');
 const task={key:'user_buyer:2027-02-04:alerts',kind:'alerts',deliveryDateJst:'2027-02-04',settingsRevision:1,ruleKey:'rule',acceptedAt:null};
 const current={settings,revision:1,ruleKey:'rule',entitlements:rights,recipientVerified:true,preferencesConfigured:true,unsubscribed:false,planExists:true};
 let sends=0,acks=0;
 const deps={deliveryEnabled:true,now:()=>now,read:async()=>current,send:async()=>{sends++;return 'accepted';},acknowledge:async()=>{acks++;}};
 assert.equal(await dispatchNotification(task,{...deps,deliveryEnabled:false}),'disabled');
 for(const patch of [{revision:2},{ruleKey:'changed'},{recipientVerified:false},{unsubscribed:true},{planExists:false},{settings:{...settings,deliveryHourJst:8}},
 {entitlements:[rights[0],{...rights[1],expiresAt:now.toISOString()}]}])assert.equal(await dispatchNotification(task,{...deps,read:async()=>({...current,...patch})}),'suppressed');
 assert.equal(sends,0);assert.equal(acks,0);
 assert.equal(await dispatchNotification(task,{...deps,send:async()=>'duplicate'}),'duplicate');assert.equal(acks,0);
 assert.equal(await dispatchNotification(task,deps),'accepted');assert.equal(sends,1);assert.equal(acks,1);
 assert.equal(await dispatchNotification({...task,acceptedAt:now.toISOString()},deps),'already-accepted');assert.equal(sends,1);
});
