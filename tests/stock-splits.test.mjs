import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {SPLIT_OVERRIDES,createSplitLoader,etDay,knownThroughDay,marketDayShift,mergeSplits,parseTwelveSplits,splitFactor,splitLabel} from '../lib/research/stock-splits.ts';
import {adjustWatchItems,createSettingsSplitAdjuster,splitWindowSymbols,stampPriceDays} from '../lib/resolute/notification-splits.ts';
import {createNotificationStore} from '../lib/resolute/notification-database.ts';
import {createNotificationOutboxJob} from '../lib/resolute/notification-outbox.ts';
import {createMailStopStore} from '../lib/resolute/notification-stop-store.ts';
import {prepareNotificationSlot} from '../lib/resolute/notification-job.ts';
import {parseNotificationSettings} from '../lib/resolute/notification-settings.ts';
import {judge} from '../lib/resolute/alert-judge.ts';
import {ownerAccessFromVerifiedAccount} from '../lib/resolute/owner-access.ts';
import {PRODUCTION_OWNER_ACCOUNT_ID} from '../lib/membership/entitlements.ts';
import {emptyPlanAnswers} from '../lib/resolute/plan-answers.ts';
import {capitalRows} from '../lib/research/capital-map.ts';
import {priceTargetSplitView} from '../lib/research/price-target-splits.ts';

const manual=symbols=>({splits:Object.fromEntries(symbols.map(s=>[s,mergeSplits(s,[])]))});
const SNDK=manual(['SNDK','MU']);
// Sandisk 8-K of 2026-11-19 (Item 5.03): 8-for-1 forward split, effective 4:01 p.m. ET Nov 19, split-adjusted trading from Nov 20.
test('the manual list carries SNDK 8-for-1 from 2026-11-20 with its SEC source, and APH 2024-06-12 which the provider lacks', () => {
 const row=SPLIT_OVERRIDES.find(s=>s.ticker==='SNDK');
 assert.equal(row.date,'2026-11-20');assert.equal(row.ratio,8);assert.match(row.source,/sec\.gov\/Archives\/edgar\/data\/2023554\//);
 assert.deepEqual(mergeSplits('APH',parseTwelveSplits({meta:{symbol:'APH'},splits:[{date:'2026-09-03',from_factor:2,to_factor:1},{date:'2021-03-05',from_factor:2,to_factor:1}]},'APH')).map(s=>s.date),['2021-03-05','2024-06-12','2026-09-03']);
 assert.equal(splitLabel(8),'8-for-1');assert.equal(splitLabel(0.125),'1-for-8');assert.equal(splitLabel(1.5),'3-for-2');
});
test('B4 (review A): spin-off adjustments the provider lists as splits are dropped; only small whole-number splits count', () => {
 const rows=(t,from,to)=>parseTwelveSplits({meta:{symbol:t},splits:[{date:'2025-10-30',from_factor:from,to_factor:to}]},t);
 for(const [t,from,to] of [['HON',1061,1000],['CMCSA',1067,1000],['DD',239,100],['GE',1281,1000],['X',104,100],['X',11,10.5]])assert.deepEqual(rows(t,from,to),[]);
 assert.deepEqual(rows('X',3,2).map(s=>s.ratio),[1.5]);assert.deepEqual(rows('X',1,20).map(s=>s.ratio),[0.05]);
});
test('B5 (review B): the same split listed twice within 10 days counts once (NVDA 2001-09-12 / 2001-09-17)', () => {
 const nv=parseTwelveSplits({meta:{symbol:'NVDA'},splits:[{date:'2001-09-17',from_factor:2,to_factor:1},{date:'2001-09-12',from_factor:2,to_factor:1},{date:'2000-06-27',from_factor:2,to_factor:1}]},'NVDA');
 assert.deepEqual(nv.map(s=>s.date),['2000-06-27','2001-09-17']);
 assert.equal(splitFactor(mergeSplits('NVDA',nv),'2001-09-01','2001-10-01'),2);
});
test('the factor counts only splits after the basis day and up to today; a manual row replaces the provider row near it', () => {
 assert.equal(splitFactor(SNDK.splits.SNDK,'2026-11-19','2026-11-20'),8);
 assert.equal(splitFactor(SNDK.splits.SNDK,'2026-11-20','2026-11-21'),1);
 assert.equal(splitFactor([{ticker:'X',date:'2026-01-05',ratio:2},{ticker:'X',date:'2026-06-01',ratio:3}],'2025-12-31','2026-12-31'),6);
 const provider=parseTwelveSplits({meta:{symbol:'SNDK'},splits:[{date:'2026-11-19',from_factor:8,to_factor:1},{date:'2020-01-02',from_factor:2,to_factor:1}]},'SNDK');
 assert.deepEqual(mergeSplits('SNDK',provider).map(s=>[s.date,s.ratio]),[['2020-01-02',2],['2026-11-20',8]]);
 assert.equal(etDay('2026-11-20T04:59:00Z'),'2026-11-19');assert.equal(etDay('2026-11-20T05:00:00Z'),'2026-11-20');
 assert.equal(marketDayShift('2026-11-20',1),'2026-11-23');assert.equal(marketDayShift('2026-11-23',-1),'2026-11-20');
});
test('B3: the loader keeps a provider answer a day, never keeps a failure (HTTP or a 429 error body) and marks failures incomplete', async () => {
 let calls=0,fail=true;
 const request=async(url)=>{calls++;assert.equal(url.searchParams.get('range'),'full');
  return fail?new Response(JSON.stringify({code:429,status:'error',message:'credits'}),{status:200}):new Response(JSON.stringify({meta:{symbol:'NVDA'},splits:[{date:'2024-06-10',from_factor:10,to_factor:1}]}),{status:200});};
 const load=createSplitLoader({apiKey:'test',request});
 let answer=await load(['NVDA']);assert.deepEqual(answer.splits.NVDA,[]);assert.equal('NVDA' in answer.through,false);
 fail=false;answer=await load(['NVDA','NVDA']);assert.deepEqual(answer.splits.NVDA.map(s=>s.ratio),[10]);assert.equal('NVDA' in answer.through,true);
 await load(['NVDA']);assert.equal(calls,2);
 const keyless=await createSplitLoader({apiKey:undefined})(['SNDK']);assert.deepEqual(keyless.splits.SNDK.map(s=>s.ratio),[8]);assert.equal(Object.keys(keyless.through).length,0);
 assert.equal((await createSplitLoader({apiKey:'test',request:async()=>new Response('{}',{status:500})})(['SNDK'])).through.SNDK,undefined);
});

const plan={schemaVersion:1,answersVersion:1,answers:emptyPlanAnswers(),fx:{thresholdYen:null,usdJpy:null,note:''},currency:'JPY',monthlyLivingCost:250000,savingsMonths:12,reserveMonths:6,nearTermExpense:0,financialAssets:10000000,investedAmount:3000000,investable:8500000,tolerancePct:20,toleranceDrop:600000,perStockCapPct:20,buyMode:'steps',buyLines:[{dropPct:10,amount:100000},{dropPct:20,amount:100000}],buyBudgetPct:10,allocation:'equal',noBuyConditions:[],haltConditions:[],ruleType:'undecided'};
const settings={deliveryHourJst:7,alertsEnabled:true,morningEnabled:false,watchItems:[{symbol:'SNDK',referencePrice:700},{symbol:'MU',referencePrice:100}],surgeCapPct:null};
const slot=new Date('2026-11-24T22:00:00Z'); // 07:00 JST Nov 25; judges the Nov 24 close (two market days after the split).
const closes=[{symbol:'SNDK',date:'2026-11-24',close:79.24,isFinal:true},{symbol:'MU',date:'2026-11-24',close:95,isFinal:true}];

test('RESOLUTE line: a reference from before the split is read ÷ 8 and carries its new day, so the adjusted closes do not fire every line', () => {
 const adjusted=adjustWatchItems(settings,'2026-11-18T10:00:00Z',SNDK,slot);
 assert.deepEqual(adjusted.watchItems,[{symbol:'SNDK',referencePrice:87.5,priceDay:'2026-11-24'},{symbol:'MU',referencePrice:100,priceDay:'2026-11-24'}]);
 const lines=[10,20];
 assert.deepEqual(judge([{...settings.watchItems[0],lines}],closes,{}).events[0].newLines,[10,20]); // unadjusted: false alerts
 assert.equal(judge([{...adjusted.watchItems[0],lines}],closes,{}).events.length,0);
 assert.deepEqual(lines.map(l=>adjusted.watchItems[0].referencePrice*(100-l)/100),[78.75,70]);
 assert.deepEqual(judge([{...adjusted.watchItems[0],lines}],[{...closes[0],close:78}],{}).events[0].newLines,[10]);
 // The item's own day wins over updated_at; a day on or after the split is already on the new basis.
 assert.equal(adjustWatchItems({...settings,watchItems:[{symbol:'SNDK',referencePrice:700,priceDay:'2026-11-19'}]},'2026-11-24T10:00:00Z',SNDK,slot).watchItems[0].referencePrice,87.5);
 assert.equal(adjustWatchItems({...settings,watchItems:[{symbol:'SNDK',referencePrice:87.5,priceDay:'2026-11-20'}]},'2026-11-18T10:00:00Z',SNDK,slot).watchItems[0].referencePrice,87.5);
 // Manual list only (provider failed): the day moves to the split, not to today.
 assert.equal(adjustWatchItems(settings,'2026-11-18T10:00:00Z',{splits:SNDK.splits,through:{}},slot).watchItems[0].priceDay,'2026-11-20');
 assert.deepEqual(parseNotificationSettings(adjusted),adjusted);
});
test('B6 (review F): an unrelated write (the mail stop) records the old day instead of freezing an unadjusted price', () => {
 const XYZ={splits:{XYZ:[{ticker:'XYZ',date:'2027-02-01',ratio:2}]}};
 const s={...settings,watchItems:[{symbol:'XYZ',referencePrice:500}]};
 const stopped=stampPriceDays(s,etDay('2027-01-05T00:00:00Z'),'2027-02-10');
 assert.equal(stopped.watchItems[0].priceDay,'2027-01-04');
 assert.equal(adjustWatchItems(stopped,'2027-02-10T00:00:00Z',XYZ,new Date('2027-03-01T15:00:00Z')).watchItems[0].referencePrice,250);
});
test('B6 (review G): a screen loaded before the split and saved after it keeps the day it loaded, so the price is still divided', () => {
 const loaded=adjustWatchItems({...settings,watchItems:[{symbol:'SNDK',referencePrice:755}]},'2026-11-01T00:00:00Z',SNDK,new Date('2026-11-19T15:00:00Z'));
 assert.equal(loaded.watchItems[0].priceDay,'2026-11-19');
 const saved=stampPriceDays(loaded,'2026-11-21','2026-11-21');
 assert.equal(adjustWatchItems(saved,'2026-11-21T05:00:00Z',SNDK,new Date('2026-11-22T15:00:00Z')).watchItems[0].referencePrice,94.38);
});
test('review v2 #5 (G old client): an item sent without a day keeps the stored day when symbol and price are unchanged; a changed price is today\'s', () => {
 const stored={settings:{...settings,watchItems:[{symbol:'SNDK',referencePrice:755,priceDay:'2026-11-19'},{symbol:'MU',referencePrice:100}]},savedAt:'2026-11-10T15:00:00Z'};
 const sent={...settings,watchItems:[{symbol:'SNDK',referencePrice:755},{symbol:'MU',referencePrice:100},{symbol:'NVDA',referencePrice:180}]};
 const saved=stampPriceDays(sent,'2026-11-21','2026-11-21',stored);
 assert.deepEqual(saved.watchItems.map(i=>i.priceDay),['2026-11-19','2026-11-10','2026-11-21']);
 assert.equal(adjustWatchItems(saved,'2026-11-21T15:00:00Z',SNDK,new Date('2026-11-25T15:00:00Z')).watchItems[0].referencePrice,94.38);
 assert.equal(stampPriceDays({...sent,watchItems:[{symbol:'SNDK',referencePrice:90}]},'2026-11-21','2026-11-21',stored).watchItems[0].priceDay,'2026-11-21');
});
test('review v2 #4 (G2): a cached answer read on the split day (row not listed yet) never moves the day past the day before it was read', () => {
 const s={...settings,watchItems:[{symbol:'XYZ',referencePrice:500,priceDay:'2027-01-05'}]};
 const shown=adjustWatchItems(s,null,{splits:{XYZ:[]},through:{XYZ:knownThroughDay('2027-02-01T15:00:00Z')}},new Date('2027-02-02T15:00:00Z'));
 assert.deepEqual(shown.watchItems[0],{symbol:'XYZ',referencePrice:500,priceDay:'2027-01-31'});
 const later=adjustWatchItems(stampPriceDays(shown,'2027-02-02','2027-02-02'),null,{splits:{XYZ:[{ticker:'XYZ',date:'2027-02-01',ratio:2}]}},new Date('2027-02-05T15:00:00Z'));
 assert.equal(later.watchItems[0].referencePrice,250);
});
test('RESOLUTE: nothing is judged for a symbol within one market day of its split', () => {
 assert.deepEqual(splitWindowSymbols(SNDK.splits,'2026-11-19'),['SNDK']);assert.deepEqual(splitWindowSymbols(SNDK.splits,'2026-11-20'),['SNDK']);
 assert.deepEqual(splitWindowSymbols(SNDK.splits,'2026-11-23'),['SNDK']);assert.deepEqual(splitWindowSymbols(SNDK.splits,'2026-11-24'),[]);
 assert.deepEqual(splitWindowSymbols(SNDK.splits,'2026-11-18'),[]);
});
test('owner access is unchanged: the owner gets the same split-adjusted judgment without any purchase', async () => {
 const grant=ownerAccessFromVerifiedAccount({id:PRODUCTION_OWNER_ACCOUNT_ID,twoFactorEnabled:true,banned:false,locked:false},true,slot.getTime());
 const adjust=createSettingsSplitAdjuster(async symbols=>manual(symbols),()=>slot);
 const {settings:shown}=await adjust(settings,'2026-11-18T10:00:00Z');
 const base={ownerAccess:grant,entitlements:[],plan,locale:'ja',preferencesConfigured:true,recipientVerified:true,unsubscribed:false,marketDate:'2026-11-24',closes,state:{},lastConfirmedAlert:null};
 assert.deepEqual(prepareNotificationSlot(PRODUCTION_OWNER_ACCOUNT_ID,slot,{...base,settings:shown}),[]);
 const real=prepareNotificationSlot(PRODUCTION_OWNER_ACCOUNT_ID,slot,{...base,settings:shown,closes:[{...closes[0],close:70},closes[1]]});
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
test('RESOLUTE store and job: the stored price is never rewritten by a split; GET, the job and a later stop all read it on today\'s basis', async () => {
 const {db,pool}=await database();
 try{
  const adjust=createSettingsSplitAdjuster(async symbols=>manual(symbols),()=>slot);
  const store=createNotificationStore(pool(),undefined,undefined,adjust,()=>new Date('2026-11-18T15:00:00Z'));
  await store('user_buyer','PUT',{settings,baseRevision:0});
  assert.deepEqual((await db.query('SELECT settings FROM resolute.notification_settings')).rows[0].settings.watchItems.map(i=>i.priceDay),['2026-11-18','2026-11-18']);
  // A legacy row (saved before price days existed) still uses its updated_at once.
  await db.query("UPDATE resolute.notification_settings SET settings=$1, updated_at='2026-11-18T10:00:00Z'",[JSON.stringify(settings)]);
  await db.query("INSERT INTO resolute.plans(clerk_user_id,revision,plan,created_at,updated_at) VALUES('user_buyer',1,$1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",[JSON.stringify(plan)]);
  assert.deepEqual((await store('user_buyer','GET')).settings.watchItems.map(i=>[i.symbol,i.referencePrice]),[['SNDK',87.5],['MU',100]]);
  assert.equal((await db.query('SELECT settings FROM resolute.notification_settings')).rows[0].settings.watchItems[0].referencePrice,700);
  const feed=(day,list)=>async()=>({locale:'ja',preferencesConfigured:true,recipientVerified:true,unsubscribed:false,marketDate:day,closes:list});
  assert.deepEqual(await createNotificationOutboxJob(pool(),feed('2026-11-24',closes),()=>slot,undefined,undefined,adjust)('user_buyer'),[]);
  assert.deepEqual(await createNotificationOutboxJob(pool(),feed('2026-11-24',closes),()=>slot)('user_buyer'),[{kind:'alerts',status:'queued'}]);
  await db.query('DELETE FROM resolute.notification_outbox');await db.query('DELETE FROM resolute.notification_state');
  // On the split day nothing is judged for SNDK, even a real-looking drop.
  const day=new Date('2026-11-20T22:00:00Z');
  const onSplit=createNotificationOutboxJob(pool(),feed('2026-11-20',[{...closes[0],date:'2026-11-20',close:10},{...closes[1],date:'2026-11-20'}]),()=>day,undefined,undefined,createSettingsSplitAdjuster(async s=>manual(s),()=>day));
  assert.deepEqual(await onSplit('user_buyer'),[]);
  // The mail stop moves updated_at but writes the old day into the items first.
  await createMailStopStore(pool(),async()=>{})('user_buyer');
  const stopped=(await db.query('SELECT settings,updated_at FROM resolute.notification_settings')).rows[0];
  assert.deepEqual(stopped.settings.watchItems.map(i=>[i.referencePrice,i.priceDay]),[[700,'2026-11-18'],[100,'2026-11-18']]);
  const later=createNotificationStore(pool(),undefined,undefined,adjust,()=>slot);
  assert.equal((await later('user_buyer','GET')).settings.watchItems[0].referencePrice,87.5);
  // Saving what GET showed keeps the stored original (700 on 11/18): it is not divided again and the rule key does not move.
  const shown=await later('user_buyer','GET');await later('user_buyer','PUT',{settings:{...shown.settings,alertsEnabled:true},baseRevision:shown.revision});
  assert.deepEqual((await db.query('SELECT settings FROM resolute.notification_settings')).rows[0].settings.watchItems.map(i=>[i.referencePrice,i.priceDay]),[[700,'2026-11-18'],[100,'2026-11-18']]);
  assert.equal((await later('user_buyer','GET')).settings.watchItems[0].referencePrice,87.5);
 }finally{await db.close();}
});

const holding=(ticker,shares)=>({securityId:ticker,ticker,name:ticker,instrument:'stock',shares,value:shares*10});
test('Capital Map: a split between two disclosures is not a purchase', () => {
 const old={id:'a',asOf:'2026-09-30',publishedOn:'2026-11-14',complete:true,holdings:[holding('SNDK',100),holding('MU',100)]};
 const now={id:'b',asOf:'2026-12-31',publishedOn:'2027-02-14',complete:true,holdings:[holding('SNDK',800),holding('MU',120)]};
 assert.deepEqual(capitalRows(now,old).map(r=>[r.ticker,r.change,r.shareChangePercent]).sort(),[['MU','increased',20],['SNDK','unchanged',0]]);
 assert.equal(capitalRows({...now,holdings:[holding('SNDK',1000)]},old).find(r=>r.ticker==='SNDK').shareChangePercent,25);
});
test('price targets: a pre-split action is also shown on today\'s basis; an old target is read as pre-split only from the firm\'s pre-split action', () => {
 const now=Date.parse('2026-11-21T00:00:00Z');
 const pre={ticker:'SNDK',firm:'Firm',previous:1200,latest:1400,publishedAt:'2026-11-18T12:00:00Z'};
 assert.deepEqual(priceTargetSplitView(pre,now),{kind:'before-split',previous:150,latest:175,ratio:8,date:'2026-11-20'});
 const after={ticker:'SNDK',firm:'Firm',previous:1400,latest:180,publishedAt:'2026-11-20T12:00:00Z'};
 assert.deepEqual(priceTargetSplitView(after,now,undefined,[pre,after]),{kind:'previous-pre-split',previous:175,latest:180,ratio:8,date:'2026-11-20'});
 assert.equal(priceTargetSplitView(after,now,undefined,[]),null);
 assert.equal(priceTargetSplitView(after,now,undefined,[{...pre,firm:'Other'}]),null);
 assert.equal(priceTargetSplitView({...pre,ticker:'MU'},now),null);
 assert.equal(priceTargetSplitView(pre,Date.parse('2026-11-19T12:00:00Z')),null);
});
test('review H: a real 35% cut after a 2-for-1 stays a cut', () => {
 const split=[{ticker:'X',date:'2027-01-05',ratio:2}];
 assert.equal(priceTargetSplitView({ticker:'X',firm:'F',previous:100,latest:65,publishedAt:'2027-01-10T15:00:00Z'},Date.parse('2027-01-11T00:00:00Z'),split,[{ticker:'X',firm:'F',previous:90,latest:100,publishedAt:'2027-01-08T15:00:00Z'}]),null);
});
test('review I: a reverse split converts a pre-split action upwards', () => {
 const v=priceTargetSplitView({ticker:'X',previous:2,latest:3,publishedAt:'2027-01-01T15:00:00Z'},Date.parse('2027-01-11T00:00:00Z'),[{ticker:'X',date:'2027-01-05',ratio:0.1}]);
 assert.deepEqual([v.previous,v.latest],[20,30]);
});

test('final review (a): the rule key hashes the stored price unchanged (no existing key moves), and a converted price sent back keeps the stored original', async () => {
 const {notificationRuleKey}=await import('../lib/resolute/notification-rule-key.ts');
 const {keepStoredOriginals}=await import('../lib/resolute/notification-splits.ts');
 const {createHash}=await import('node:crypto');
 const oldKey=s=>createHash('sha256').update(JSON.stringify({items:s.watchItems,lines:[],surge:s.surgeCapPct})).digest('hex');
 const base={deliveryHourJst:7,alertsEnabled:true,morningEnabled:false,surgeCapPct:null};
 const splits={splits:{...SNDK.splits,APH:mergeSplits('APH',[])}};
 // Existing rows (no price day): SNDK $94.38 saved 11/21, APH $300 saved 8/01, SNDK $754.99 saved 11/18 — all keep their key.
 for(const [symbol,price,savedAt] of [['SNDK',94.38,'2026-11-21T15:00:00Z'],['APH',300,'2026-08-01T15:00:00Z'],['SNDK',754.99,'2026-11-18T15:00:00Z']]){
  const row={...base,watchItems:[{symbol,referencePrice:price}]};
  assert.equal(notificationRuleKey(row,null),oldKey(row));
  // GET shows it on today's basis; the screen saves it back unchanged (only the delivery hour changed): the stored original is kept.
  const shown=adjustWatchItems(row,savedAt,splits,new Date('2026-11-25T15:00:00Z'));
  const kept=stampPriceDays(keepStoredOriginals({...shown,deliveryHourJst:8},{settings:row,savedAt},shown),'2026-11-25','2026-11-25',{settings:row,savedAt});
  assert.equal(kept.watchItems[0].referencePrice,price);
  assert.equal(notificationRuleKey(kept,null),notificationRuleKey(row,null));
  // And it is still converted when read, exactly as before the save.
  assert.deepEqual(adjustWatchItems(kept,'2026-11-25T15:00:00Z',splits,new Date('2026-11-25T15:00:00Z')).watchItems[0].referencePrice,shown.watchItems[0].referencePrice);
 }
 assert.deepEqual(adjustWatchItems({...base,watchItems:[{symbol:'SNDK',referencePrice:754.99}]},'2026-11-18T15:00:00Z',splits,new Date('2026-11-25T15:00:00Z')).watchItems[0].referencePrice,94.37);
 // A price day alone never changes the key; a new price does.
 const mu={...base,watchItems:[{symbol:'MU',referencePrice:100}]};
 assert.equal(notificationRuleKey({...mu,watchItems:[{symbol:'MU',referencePrice:100,priceDay:'2026-11-25'}]},null),oldKey(mu));
 const edited=keepStoredOriginals({...base,watchItems:[{symbol:'SNDK',referencePrice:80,priceDay:'2026-11-25'}]},{settings:{...base,watchItems:[{symbol:'SNDK',referencePrice:700}]},savedAt:'2026-11-18T15:00:00Z'},adjustWatchItems({...base,watchItems:[{symbol:'SNDK',referencePrice:700}]},'2026-11-18T15:00:00Z',splits,new Date('2026-11-25T15:00:00Z')));
 assert.deepEqual(edited.watchItems,[{symbol:'SNDK',referencePrice:80,priceDay:'2026-11-25'}]);
 assert.notEqual(notificationRuleKey(edited,null),oldKey({...base,watchItems:[{symbol:'SNDK',referencePrice:700}]}));
});
