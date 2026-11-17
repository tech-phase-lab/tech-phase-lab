// RESOLUTE ③④ by phone notification first (owner, Nov 17), on a real Postgres (PGlite) with the existing durable sender. The phone
// notice is tried first; the email goes only when no device accepted it. 「今日のお知らせ」 reads the delivered alert with the
// notification settings role once db/resolute/024 is applied.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {defaultNotificationSettings} from '../lib/resolute/notification-settings.ts';
import {createNotificationStore} from '../lib/resolute/notification-database.ts';
import {createNotificationOutboxJob} from '../lib/resolute/notification-outbox.ts';
import {createAlertDelivery} from '../lib/resolute/notification-delivery.ts';
import {withPushFirst} from '../lib/resolute/notification-push.ts';
import {createLatestAlertStore} from '../lib/resolute/latest-alert-database.ts';
import {emptyPlanAnswers} from '../lib/resolute/plan-answers.ts';

const settings={...defaultNotificationSettings(),alertsEnabled:true,morningEnabled:true,watchItems:[{symbol:'AAA',referencePrice:100}],surgeCapPct:50};
const inputs={locale:'en',preferencesConfigured:true,recipientVerified:true,unsubscribed:false,marketDate:'2027-02-03',closes:[{symbol:'AAA',date:'2027-02-03',close:80,isFinal:true}]};
const now=new Date('2027-02-03T22:00:00.000Z');

async function database(){
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const data=await boot.dumpDataDir();await boot.close();const db=new PGlite({database:'resolute',loadDataDir:data});
 for(const name of ['001_entitlements.sql','002_plans.sql','003_plan_answers_fx.sql','004_notification_settings.sql','005_notification_outbox.sql'])await db.exec(readFileSync(new URL('../db/resolute/'+name,import.meta.url),'utf8'));
 await db.exec(`CREATE ROLE resolute_notification_writer;GRANT USAGE ON SCHEMA resolute TO resolute_notification_writer;GRANT SELECT ON resolute.entitlements TO resolute_notification_writer;GRANT SELECT,INSERT,UPDATE ON resolute.notification_settings TO resolute_notification_writer;`);
 await db.query("INSERT INTO resolute.entitlements(clerk_user_id,product_id,kind,starts_at,expires_at,source) VALUES('user_buyer','resolute_v1','use','2026-01-01',NULL,'purchase'),('user_buyer','resolute_v1','alerts','2026-01-01','2028-01-01','purchase')");
 let tail=Promise.resolve();
 const pool=()=>({async connect(){let unlock;const previous=tail;tail=new Promise(r=>unlock=r);await previous;return {async query(sql,args){const result=await db.query(sql,args);return {...result,rowCount:result.rows.length||result.affectedRows||0};},release(){unlock();}};}});
 return {db,pool};
}
function plan(){
 return {schemaVersion:1,answersVersion:1,answers:emptyPlanAnswers(),fx:{thresholdYen:null,usdJpy:null,note:''},currency:'JPY',monthlyLivingCost:250000,savingsMonths:12,reserveMonths:6,nearTermExpense:0,financialAssets:10000000,investedAmount:3000000,investable:8500000,tolerancePct:20,toleranceDrop:600000,perStockCapPct:20,buyMode:'steps',buyLines:[{dropPct:10,amount:100000},{dropPct:20,amount:100000}],buyBudgetPct:10,allocation:'equal',noBuyConditions:[],haltConditions:[],ruleType:'undecided'};
}

for(const scenario of ['push-accepted','no-device','all-failed','monitor-down']) {
 test(`phone first, email only as the fallback: ${scenario}`,async()=>{
  const {db,pool}=await database();let clock=now;const mails=[],pushes=[];
  const key='user_buyer:2027-02-04:alerts';
  const mail={name:'resend',send:async(input)=>{mails.push(input);return {key:input.key,messageId:'mail-1',acceptedAt:clock.toISOString()};},lookup:async()=>null};
  const push={send:async(input)=>{pushes.push(input);if(scenario==='monitor-down')throw Error('down');
   return scenario==='push-accepted'?{devices:1,accepted:1,failed:0}:scenario==='all-failed'?{devices:2,accepted:0,failed:2}:{devices:0,accepted:0,failed:0};},
   lookup:async()=>({devices:0,accepted:0,failed:0})};
  const deliver=createAlertDelivery(pool(),{enabled:true,now:()=>clock,source:'legacy',publicOrigin:'https://app.test',
   recipient:async(userId)=>({userId,email:'buyer@example.test',verified:true,preferencesConfigured:true,unsubscribed:false,locale:'en'}),
   links:async()=>({planUrl:'https://app.test/resolute/notebook',unsubscribeUrl:'https://app.test/unsubscribe/x',doneUrl:'https://app.test/resolute/morning#done',skippedUrl:'https://app.test/resolute/morning#skipped',unsureUrl:'https://app.test/resolute/morning#unsure'}),
   provider:(client,id)=>withPushFirst(mail,push,id,()=>clock)});
  try{
   const store=createNotificationStore(pool());await store('user_buyer','PUT',{settings,baseRevision:0});
   await db.query("INSERT INTO resolute.plans(clerk_user_id,revision,plan,created_at,updated_at) VALUES('user_buyer',1,$1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",[JSON.stringify(plan())]);
   const job=createNotificationOutboxJob(pool(),async()=>inputs,()=>clock);
   await job('user_buyer');
   assert.equal(await deliver('user_buyer',key),'accepted');
   assert.equal(pushes.length,1);
   assert.equal(pushes[0].userId,'user_buyer');assert.equal(pushes[0].key,key);
   assert.equal(pushes[0].notice.title,'RESOLUTE');assert.equal(pushes[0].notice.url,'/resolute/alerts/latest');
   assert.equal(pushes[0].notice.body,'AAA reached the -20% level in your plan');
   assert.equal(mails.length,scenario==='push-accepted'?0:1);
   const row=(await db.query('SELECT accepted_at,payload FROM resolute.notification_outbox')).rows[0];
   assert.ok(row.accepted_at);assert.equal(row.payload.receipt.messageId,scenario==='push-accepted'?'web-push:1':'mail-1');
   assert.equal(await deliver('user_buyer',key),'already-accepted');assert.equal(pushes.length,1);
   // The delivered alert is what 「今日のお知らせ」 shows, read with the settings role once 024 is applied.
   const asWriter={query:async(sql,args)=>{await db.exec('SET ROLE resolute_notification_writer');try{return await db.query(sql,args);}finally{await db.exec('RESET ROLE');}}};
   await assert.rejects(()=>createLatestAlertStore(asWriter,'legacy')('user_buyer'),e=>e.code==='42501');
   await db.exec(readFileSync(new URL('../db/resolute/024_latest_alert_reader.sql',import.meta.url),'utf8'));
   const latest=await createLatestAlertStore(asWriter,'legacy')('user_buyer');
   assert.equal(latest.alert.date,'2027-02-03');assert.equal(latest.alert.items[0].symbol,'AAA');assert.deepEqual(latest.alert.items[0].newLines,[10,20]);
   assert.equal(await createLatestAlertStore(asWriter,'legacy')('user_other').catch(e=>e.constructor.name),'NotificationAccessDenied');
   // Next morning: the note follows the accepted alert (phone or email), and is itself a phone notice first.
   clock=new Date('2027-02-04T22:00:00Z');
   assert.deepEqual(await job('user_buyer'),[{kind:'morning',status:'queued'}]);
   assert.equal(await deliver('user_buyer','user_buyer:2027-02-05:morning'),'accepted');
   assert.deepEqual(pushes[1].notice,{title:'RESOLUTE',body:"How are you feeling after yesterday's alert?",url:'/resolute/morning'});
   assert.equal(mails.length,scenario==='push-accepted'?0:2);
  }finally{await db.close();}
 });
}
