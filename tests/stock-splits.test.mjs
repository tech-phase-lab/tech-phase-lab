import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {SPLIT_OVERRIDES,createSplitLoader,etDay,mergeSplits,parseTwelveSplits,splitFactor,splitLabel} from '../lib/research/stock-splits.ts';
import {adjustWatchItems,createSettingsSplitAdjuster} from '../lib/resolute/notification-splits.ts';
import {createNotificationStore} from '../lib/resolute/notification-database.ts';
import {createNotificationOutboxJob} from '../lib/resolute/notification-outbox.ts';
import {prepareNotificationSlot} from '../lib/resolute/notification-job.ts';
import {judge} from '../lib/resolute/alert-judge.ts';
import {ownerAccessFromVerifiedAccount} from '../lib/resolute/owner-access.ts';
import {PRODUCTION_OWNER_ACCOUNT_ID} from '../lib/membership/entitlements.ts';
import {emptyPlanAnswers} from '../lib/resolute/plan-answers.ts';
import {capitalRows} from '../lib/research/capital-map.ts';
import {priceTargetSplitView} from '../lib/research/price-target-splits.ts';

const SNDK={SNDK:mergeSplits('SNDK',[])};
// Sandisk 8-K of 2026-11-19 (Item 5.03): 8-for-1 forward split, effective 4:01 p.m. ET Nov 19, split-adjusted trading from Nov 20.
test('the manual list carries SNDK 8-for-1 from 2026-11-20 with its SEC source', () => {
 const row=SPLIT_OVERRIDES.find(s=>s.ticker==='SNDK');
 assert.equal(row.date,'2026-11-20');assert.equal(row.ratio,8);assert.match(row.source,/sec\.gov\/Archives\/edgar\/data\/2023554\//);
 assert.equal(splitLabel(8),'8-for-1');assert.equal(splitLabel(0.125),'1-for-8');assert.equal(splitLabel(1.5),'3-for-2');
});
test('the factor counts only splits after the basis day and up to today; a manual row replaces the provider row near it', () => {
 assert.equal(splitFactor(SNDK.SNDK,'2026-11-19','2026-11-20'),8);
 assert.equal(splitFactor(SNDK.SNDK,'2026-11-20','2026-11-21'),1);
 assert.equal(splitFactor(SNDK.SNDK,'2026-11-19','2026-11-19'),1);
 assert.equal(splitFactor([{ticker:'X',date:'2026-01-05',ratio:2},{ticker:'X',date:'2026-06-01',ratio:3}],'2025-12-31','2026-12-31'),6);
 const provider=parseTwelveSplits({meta:{symbol:'SNDK'},splits:[{date:'2026-11-19',from_factor:8,to_factor:1},{date:'2020-01-02',from_factor:2,to_factor:1}]},'SNDK');
 assert.deepEqual(mergeSplits('SNDK',provider).map(s=>[s.date,s.ratio]),[['2020-01-02',2],['2026-11-20',8]]);
 assert.equal(etDay('2026-11-20T03:00:00Z'),'2026-11-19');
});
test('the loader reads the provider once per ticker and falls back to the manual list without a key or on failure', async () => {
 let calls=0;
 const request=async(url)=>{calls++;assert.equal(url.searchParams.get('range'),'full');return new Response(JSON.stringify({meta:{symbol:'NVDA'},splits:[{date:'2024-06-10',from_factor:10,to_factor:1}]}),{status:200});};
 const load=createSplitLoader({apiKey:'test',request});
 assert.deepEqual((await load(['NVDA','NVDA'])).NVDA.map(s=>s.ratio),[10]);await load(['NVDA']);assert.equal(calls,1);
 assert.deepEqual((await createSplitLoader({apiKey:undefined})(['SNDK'])).SNDK.map(s=>s.ratio),[8]);
 assert.deepEqual((await createSplitLoader({apiKey:'test',request:async()=>new Response('{}',{status:500})})(['SNDK'])).SNDK.map(s=>s.ratio),[8]);
});

const plan={schemaVersion:1,answersVersion:1,answers:emptyPlanAnswers(),fx:{thresholdYen:null,usdJpy:null,note:''},currency:'JPY',monthlyLivingCost:250000,savingsMonths:12,reserveMonths:6,nearTermExpense:0,financialAssets:10000000,investedAmount:3000000,investable:8500000,tolerancePct:20,toleranceDrop:600000,perStockCapPct:20,buyMode:'steps',buyLines:[{dropPct:10,amount:100000},{dropPct:20,amount:100000}],buyBudgetPct:10,allocation:'equal',noBuyConditions:[],haltConditions:[],ruleType:'undecided'};
const settings={deliveryHourJst:7,alertsEnabled:true,morningEnabled:false,watchItems:[{symbol:'SNDK',referencePrice:700},{symbol:'MU',referencePrice:100}],surgeCapPct:null};
const slot=new Date('2026-11-20T22:00:00Z'); // 07:00 JST Nov 21; the Nov 20 close is the first split-adjusted one.
const closes=[{symbol:'SNDK',date:'2026-11-20',close:79.24,isFinal:true},{symbol:'MU',date:'2026-11-20',close:95,isFinal:true}];

test('RESOLUTE line: a reference saved before the split is read ÷ 8, so the first adjusted close does not fire every line', () => {
 const adjusted=adjustWatchItems(settings,'2026-11-18T10:00:00Z',SNDK,slot);
 assert.deepEqual(adjusted.watchItems,[{symbol:'SNDK',referencePrice:87.5},{symbol:'MU',referencePrice:100}]);
 const lines=[10,20];
 // Unadjusted: $700 against $79.24 reads as an 88.6% drop: both lines would fire falsely.
 assert.deepEqual(judge([{...settings.watchItems[0],lines}],closes,{}).events[0].newLines,[10,20]);
 // Adjusted: −9.4% from $87.50, no line yet; the price lines are $78.75 and $70.
 assert.equal(judge([{...adjusted.watchItems[0],lines}],closes,{}).events.length,0);
 assert.deepEqual(lines.map(l=>adjusted.watchItems[0].referencePrice*(100-l)/100),[78.75,70]);
 assert.deepEqual(judge([{...adjusted.watchItems[0],lines}],[{...closes[0],close:78}],{}).events[0].newLines,[10]);
 // Saved on or after the split day: already on the new basis.
 assert.equal(adjustWatchItems({...settings,watchItems:[{symbol:'SNDK',referencePrice:87.5}]},'2026-11-20T15:00:00Z',SNDK,slot).watchItems[0].referencePrice,87.5);
 assert.equal(adjustWatchItems(settings,null,SNDK,slot),settings);
});
test('owner access is unchanged: the owner gets the same split-adjusted judgment without any purchase', async () => {
 const grant=ownerAccessFromVerifiedAccount({id:PRODUCTION_OWNER_ACCOUNT_ID,twoFactorEnabled:true,banned:false,locked:false},true,slot.getTime());
 const adjust=createSettingsSplitAdjuster(async symbols=>Object.fromEntries(symbols.map(s=>[s,mergeSplits(s,[])])),()=>slot);
 const base={ownerAccess:grant,entitlements:[],plan,locale:'ja',preferencesConfigured:true,recipientVerified:true,unsubscribed:false,marketDate:'2026-11-20',closes,state:{},lastConfirmedAlert:null};
 assert.deepEqual(prepareNotificationSlot(PRODUCTION_OWNER_ACCOUNT_ID,slot,{...base,settings:await adjust(settings,'2026-11-18T10:00:00Z')}),[]);
 const real=prepareNotificationSlot(PRODUCTION_OWNER_ACCOUNT_ID,slot,{...base,settings:await adjust(settings,'2026-11-18T10:00:00Z'),closes:[{...closes[0],close:70},closes[1]]});
 assert.equal(real.length,1);assert.deepEqual(real[0].digest.payload.items.map(i=>[i.symbol,i.referencePrice,i.newLines]),[['SNDK',87.5,[10,20]]]);
});

async function database(){
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const data=await boot.dumpDataDir();await boot.close();const db=new PGlite({database:'resolute',loadDataDir:data});
 for(const name of ['001_entitlements.sql','002_plans.sql','003_plan_answers_fx.sql','004_notification_settings.sql','005_notification_outbox.sql'])await db.exec(readFileSync(new URL('../db/resolute/'+name,import.meta.url),'utf8'));
 await db.query("INSERT INTO resolute.entitlements(clerk_user_id,product_id,kind,starts_at,expires_at,source) VALUES('user_buyer','resolute_v1','use','2026-01-01',NULL,'purchase'),('user_buyer','resolute_v1','alerts','2026-01-01','2028-01-01','purchase')");
 let tail=Promise.resolve();
 const pool=()=>({async connect(){let unlock;const previous=tail;tail=new Promise(r=>unlock=r);await previous;return {async query(sql,args){const result=await db.query(sql,args);return {...result,rowCount:result.rows.length||result.affectedRows||0};},release(){unlock();}};}});
 return {db,pool};
}
test('RESOLUTE store and job: the stored row is never rewritten; GET and the alert job read the reference on today\'s basis', async () => {
 const {db,pool}=await database();
 try{
  const adjust=createSettingsSplitAdjuster(async symbols=>Object.fromEntries(symbols.map(s=>[s,mergeSplits(s,[])])),()=>slot);
  const store=createNotificationStore(pool(),undefined,undefined,adjust);
  await store('user_buyer','PUT',{settings,baseRevision:0});
  await db.query("UPDATE resolute.notification_settings SET updated_at='2026-11-18T10:00:00Z'");
  await db.query("INSERT INTO resolute.plans(clerk_user_id,revision,plan,created_at,updated_at) VALUES('user_buyer',1,$1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",[JSON.stringify(plan)]);
  assert.deepEqual((await store('user_buyer','GET')).settings.watchItems,[{symbol:'SNDK',referencePrice:87.5},{symbol:'MU',referencePrice:100}]);
  assert.equal((await db.query('SELECT settings FROM resolute.notification_settings')).rows[0].settings.watchItems[0].referencePrice,700);
  const feed=async()=>({locale:'ja',preferencesConfigured:true,recipientVerified:true,unsubscribed:false,marketDate:'2026-11-20',closes});
  // Without the adjustment the first adjusted close queues a false alert; with it nothing is queued.
  assert.deepEqual(await createNotificationOutboxJob(pool(),feed,()=>slot,undefined,undefined,adjust)('user_buyer'),[]);
  assert.equal((await db.query('SELECT * FROM resolute.notification_outbox')).rows.length,0);
  assert.deepEqual(await createNotificationOutboxJob(pool(),feed,()=>slot)('user_buyer'),[{kind:'alerts',status:'queued'}]);
  // Saving what GET showed (after the split) is on the new basis and is not divided again.
  await db.query('DELETE FROM resolute.notification_outbox');await db.query('DELETE FROM resolute.notification_state');
  const shown=await store('user_buyer','GET');await store('user_buyer','PUT',{settings:shown.settings,baseRevision:shown.revision});
  assert.equal((await store('user_buyer','GET')).settings.watchItems[0].referencePrice,87.5);
 }finally{await db.close();}
});

const holding=(ticker,shares)=>({securityId:ticker,ticker,name:ticker,instrument:'stock',shares,value:shares*10});
test('Capital Map: a split between two disclosures is not a purchase', () => {
 const old={id:'a',asOf:'2026-09-30',publishedOn:'2026-11-14',complete:true,holdings:[holding('SNDK',100),holding('MU',100)]};
 const now={id:'b',asOf:'2026-12-31',publishedOn:'2027-02-14',complete:true,holdings:[holding('SNDK',800),holding('MU',120)]};
 const rows=capitalRows(now,old);
 assert.deepEqual(rows.map(r=>[r.ticker,r.change,r.shareChangePercent]).sort(),[['MU','increased',20],['SNDK','unchanged',0]]);
 assert.equal(capitalRows({...now,holdings:[holding('SNDK',1000)]},old).find(r=>r.ticker==='SNDK').shareChangePercent,25);
});
test('price targets: a pre-split action is also shown on today\'s basis; a pre-split old target is not read as an 87% cut', () => {
 const now=Date.parse('2026-11-21T00:00:00Z');
 assert.deepEqual(priceTargetSplitView({ticker:'SNDK',previous:1400,latest:1600,publishedAt:'2026-11-18T12:00:00Z'},now),{kind:'before-split',previous:175,latest:200,ratio:8,date:'2026-11-20'});
 assert.deepEqual(priceTargetSplitView({ticker:'SNDK',previous:1400,latest:180,publishedAt:'2026-11-20T12:00:00Z'},now),{kind:'previous-pre-split',previous:175,latest:180,ratio:8,date:'2026-11-20'});
 assert.equal(priceTargetSplitView({ticker:'SNDK',previous:175,latest:150,publishedAt:'2026-11-20T12:00:00Z'},now),null);
 assert.equal(priceTargetSplitView({ticker:'MU',previous:400,latest:450,publishedAt:'2026-11-18T12:00:00Z'},now),null);
 assert.equal(priceTargetSplitView({ticker:'SNDK',previous:1400,latest:1600,publishedAt:'2026-11-18T12:00:00Z'},Date.parse('2026-11-19T12:00:00Z')),null);
});
