import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {fixedTodayPlan} from '../lib/resolute/today-plan.ts';
import {validateTodayOutput,parseTodayPlan,allowedNumbers,unknownNumbers,HEADLINE_MAX_JA} from '../lib/resolute/today-plan-validate.ts';
import {chainedRatio,tpIndexLinks,closeRatio,estimateFromRatio,estimateIndex,estimateEligibility,estimateBaseSession,checkFacts,watchFacts,marketDirection,newsOf,gaugeOf,reachedLines} from '../lib/resolute/today-plan-facts.ts';
import {generateTodayPlan,runTodayPlanJob,estimateRatio,createTodayModel,TODAY_PLAN_MODEL} from '../services/resolute-api/today-plan-job.mjs';
import {createTodayPlanRead} from '../services/resolute-api/today-plan-read.mjs';
import {createHandler} from '../services/resolute-api/handler.mjs';
import {fetchTodayPlan,parseTodayPlanSnapshot} from '../lib/resolute/today-plan-transport.ts';
import {createReviewSamplePlan} from '../lib/resolute/review-sample.ts';
import {emptyDiagnosisDraft,draftToPlan} from '../lib/resolute/diagnosis-form.ts';
import {parsePlan} from '../lib/resolute/plan-data.ts';
import {OWNER_ACCOUNT_ID,PRODUCTION_OWNER_ACCOUNT_ID} from '../lib/membership/entitlements.ts';
import {OWNER_ISSUER,OWNER_ORIGIN,hasOwnerAccess,ownerAccessFromVerifiedSession,ownerAccessSnapshot} from '../lib/resolute/owner-access.ts';

// RESOLUTE「今日やること」 (owner, Nov 25): AI job, validator, §5 estimate, read API.
const sql=name=>readFileSync(new URL('../db/resolute/'+name,import.meta.url),'utf8');
const SESSION='2026-11-24',NOW=new Date('2026-11-24T23:40:00Z'); // 08:40 JST Nov 25, after the thermometer and the Shock Gauge selection
// The sample answers q21alt (Nov 25 substitute for q21), which is kept only while q20 is funds/ETF, bonds or gold.
const plan=(over={},answers={})=>{const p=createReviewSamplePlan();Object.assign(p.answers,answers);if(!['fund_etf','bond','gold'].includes(p.answers.q20))delete p.answers.q21alt;return {...p,...over};};
/** A real saved plan without q08 (built the way the diagnosis builds it). */
const planWithoutQ08=()=>{const d=emptyDiagnosisDraft();Object.assign(d.answers,createReviewSamplePlan().answers,{q08:'not_yet'});d.numbers={q07:'10000000'};return parsePlan(draftToPlan(d));};
const check=(id,state='ok')=>({id,state,label:{ja:'NVDA 買い増し',en:'NVDA buy-more'},rule:{ja:'基準から −10%',en:'−10% from reference'},today:{ja:'基準から −10.0%',en:'−10.0% from reference'}});
const good={headline:{ja:'決めた買い増しの日',en:'Your planned buy-more day'},body:{ja:['NVDAが基準から −10.0%で、買い増しのラインに届きました。','金額と、買わない条件を一冊で確かめます。'],en:['NVDA is −10.0% from your reference, at your buy-more line.','Check the amount and your no-buy conditions.']},
 checks:[{id:'buy:NVDA',label:{ja:'NVDA 買い増し',en:'NVDA buy-more'},rule:{ja:'基準から −10%',en:'−10% from reference'},today:{ja:'基準から −10.0%',en:'−10.0% from reference'}}]};
const ctx=(over={})=>({date:SESSION,direction:'down',checks:[check('buy:NVDA','reached')],estimate:null,inputs:[{close:180,fromReferencePct:-10,line:10}],...over});

test('validator: a clean output is used, and each check takes its state from the facts, never the model',()=>{
 const r=validateTodayOutput(good,ctx());
 assert.equal(r.ok,true);assert.equal(r.plan.source,'ai');assert.equal(r.plan.checks[0].state,'reached');
 assert.equal(r.plan.body.ja.split('\n').length,2);assert.equal(r.plan.estimate,null);
});
test('validator: every number must come from the inputs or the plan (number provenance)',()=>{
 const invented={...good,body:{...good.body,ja:['NVDAは12%下がりました。','ルールどおりです。']}};
 assert.deepEqual(validateTodayOutput(invented,ctx()),{ok:false,reason:'new-number'});
 // Full-width digits and thousands separators are normalized before comparing.
 assert.deepEqual(unknownNumbers('１８０ドル、1,000株',allowedNumbers({a:180,b:1000})),[]);
 assert.deepEqual(unknownNumbers('181',allowedNumbers({a:180})),['181']);
 assert.deepEqual(unknownNumbers('30%',allowedNumbers({a:30.0,b:'30.0'})),[]);
 const shown={...good,headline:{ja:'★4の日',en:'A ★4 day'}};
 assert.equal(validateTodayOutput(shown,ctx()).reason,'new-number');
 assert.equal(validateTodayOutput(shown,ctx({inputs:[{highestStars:4,close:180,fromReferencePct:-10,line:10}]})).ok,true);
});
test('validator: length, lines, check count, ellipsis, advice and direction',()=>{
 const r=(o,c)=>validateTodayOutput(o,ctx(c)).reason;
 assert.equal(r({...good,headline:{ja:'あ'.repeat(HEADLINE_MAX_JA+1),en:'x'}}),'headline-length');
 assert.equal(validateTodayOutput({...good,headline:{ja:'あ'.repeat(HEADLINE_MAX_JA),en:'x'}},ctx()).ok,true);
 assert.equal(r({...good,body:{ja:['一行だけ。'],en:['a','b']}}),'body-lines');
 assert.equal(r({...good,body:{ja:['1行目。','二','三','四','五'],en:['a','b']}}),'body-lines');
 assert.equal(r({...good,checks:[...good.checks,...good.checks,...good.checks,...good.checks]}),'too-many-checks');
 assert.equal(r({...good,checks:[{...good.checks[0],id:'buy:TSLA'}]}),'unknown-check');
 assert.equal(r({...good,checks:[good.checks[0],good.checks[0]]}),'unknown-check');
 assert.equal(r({...good,body:{...good.body,ja:['ルールを確かめます…','以上です。']}}),'ellipsis');
 assert.equal(r({...good,body:{...good.body,en:['Prices fell...','Check.']}}),'ellipsis');
 for(const advice of ['今が買い時です。','ここはチャンスです。','買うべき日です。'])assert.equal(r({...good,body:{...good.body,ja:[advice,'ルールどおりです。']}}),'advice');
 assert.equal(r({...good,body:{...good.body,en:['We recommend adding.','Check.']}}),'advice');
 assert.equal(r({...good,headline:{ja:'むやみに動かない',en:'Stay put'},checks:[]},{direction:'up'}),'direction');
 assert.equal(r({...good,headline:{ja:'浮かれて買い足さない',en:'No chasing'},checks:[]},{direction:'down'}),'direction');
 assert.equal(r(null),'shape');
});
test('the fallback is the one shared fixed plan (lib/resolute/today-plan.ts), and it passes the stored-shape check',()=>{
 const input=(o={})=>({date:SESSION,news:[{stars:4,changePercent:3.4}],thermometer:{index:'sox',band:2,changePercent:3.4},lines:{buyDropPct:10,stopLossPct:null,surgeCapPct:20},stocks:[{symbol:'NVDA',fromReferencePct:-4}],estimate:{allowedDropPct:30,estimatedChangePct:-12.3,remainingPct:17.7},...o});
 for(const o of [{},{news:[{stars:4,changePercent:-3}]},{news:[]},{stocks:[{symbol:'NVDA',fromReferencePct:-10.5}]},{stocks:[{symbol:'NVDA',fromReferencePct:22}]},
  {lines:{buyDropPct:10,stopLossPct:12,surgeCapPct:20}},{thermometer:{index:'sox',band:4,changePercent:3.4}},{estimate:null,stocks:[],thermometer:null}]){
  const plan=fixedTodayPlan(input(o));
  assert.deepEqual(parseTodayPlan(plan),plan);assert.equal(plan.source,'fixed');
 }
 assert.equal(fixedTodayPlan(input()).headline.ja,'浮かれて買い足さない');
 assert.equal(fixedTodayPlan(input({news:[{stars:4,changePercent:-3}]})).headline.ja,'むやみに動かない');
});
test('fallback: an output that fails twice becomes the fixed sentence; one regeneration is allowed; budget refusals stop at once',async()=>{
 const p=planWithoutQ08();
 const facts={date:SESSION,direction:'up',stars:4,shock:{state:'ready',items:[]},indexMoves:[],thermometer:{hot:false,stages:[]},watch:[],checks:[],estimate:null,reached:{stopLoss:false,buyMore:false,upTarget:false},
  todayInput:{date:'2026-11-25',news:[{stars:4,changePercent:2.1}],thermometer:null,lines:{buyDropPct:10,stopLossPct:null,surgeCapPct:null},stocks:[],estimate:null}};
 const ok={headline:{ja:'浮かれて買い足さない',en:"Don't chase the rally"},body:{ja:['大きく上がった日です。','ルールにない買い足しはしません。'],en:['A big up day.','Nothing beyond your rules.']},checks:[]};
 let calls=0;const bad=async()=>{calls++;return {output:{...ok,body:{...ok.body,ja:['77%上がりました。','以上。']}},usage:{input_tokens:1000,output_tokens:100}};};
 let r=await generateTodayPlan(facts,p,[],bad);
 assert.equal(calls,2);assert.equal(r.plan.source,'fixed');assert.equal(r.plan.headline.ja,'浮かれて買い足さない');assert.deepEqual(r.reasons,['new-number','new-number']);assert.equal(r.usage.length,2);
 calls=0;const second=async input=>{calls++;return {output:calls===1?{...ok,headline:{ja:'あ'.repeat(13),en:'x'}}:ok,usage:null,seen:assert.equal(!!input.previousAttemptRejected,calls===2)};};
 r=await generateTodayPlan(facts,p,[],second);assert.equal(r.plan.source,'ai');assert.deepEqual(r.reasons,['headline-length']);
 calls=0;r=await generateTodayPlan(facts,p,[],async()=>{calls++;throw Error('BUDGET_LIMIT');});
 assert.equal(calls,1);assert.equal(r.plan.source,'fixed');assert.deepEqual(r.reasons,['BUDGET_LIMIT']);
 r=await generateTodayPlan(facts,p,[],null);assert.equal(r.plan.source,'fixed');
 calls=0;r=await generateTodayPlan(facts,p,[],async()=>{calls++;throw Error('socket hang up postgres://secret');});
 assert.equal(calls,2);assert.deepEqual(r.reasons,['MODEL_UNAVAILABLE','MODEL_UNAVAILABLE']);
});

// §5 推定の下落
const shockDay=(date,previousDate,changePercent)=>({date,previousDate,changePercent,typicalPercent:1,up:20,down:20,total:40});
test('§5 index mapping: semis for tech stocks, large caps for other stocks and funds, TLT for bonds, gold for gold',()=>{
 assert.equal(estimateIndex({q20:'stock',q21:['tech_semis']}),'sox');
 assert.equal(estimateIndex({q20:'mixed',q21:['dividend','tech_semis']}),'sox');
 assert.equal(estimateIndex({q20:'stock',q21:['healthcare']}),'nas100');
 assert.equal(estimateIndex({q20:'fund_etf',q21:null}),'nas100');
 assert.equal(estimateIndex({q20:'bond',q21:null}),'TLT');
 assert.equal(estimateIndex({q20:'gold',q21:null}),'XAU/USD');
 assert.equal(estimateIndex({q20:null,q21:null}),null);
 assert.equal(estimateEligibility(planWithoutQ08()),'no-q08');
 assert.equal(estimateEligibility(plan({tolerancePct:null,toleranceDrop:null})),'no-tolerance');
 assert.equal(estimateEligibility(plan({},{q20:null})),'no-index');
 assert.equal(estimateEligibility(plan()),null);
 // The base is the last confirmed close when the plan was saved; re-taking the diagnosis (a new save) moves it.
 assert.equal(estimateBaseSession('2026-11-21T03:00:00Z'),'2026-11-20');
 assert.equal(estimateBaseSession('2026-11-24T23:00:00Z'),'2026-11-24');
});
test('§5 estimate math: chained TP index moves, close ratios, and the remaining distance to the line',()=>{
 const snapshots=[{session:'2026-11-23',snapshot:{asOf:'2026-11-23',moves:{nas100:{date:'2026-11-23',previousDate:'2026-11-20',changePercent:-10},sox:null}}},
  {session:'2026-11-24',snapshot:{asOf:'2026-11-24',shock:{'2026-11-24':{nas100:shockDay('2026-11-24','2026-11-23',-2),sox:null,fear:null}}}}];
 const links=tpIndexLinks(snapshots,'nas100');
 const ratio=chainedRatio(links,'2026-11-20',SESSION);
 assert.ok(Math.abs(ratio-0.9*0.98)<1e-12);
 const e=estimateFromRatio(plan(),ratio);
 assert.deepEqual(e,{allowedDropPct:30,estimatedChangePct:-11.8,remainingPct:18.2});
 assert.equal(chainedRatio(links,SESSION,SESSION),1);
 // A missing session breaks the chain: no estimate, never a guess.
 assert.equal(chainedRatio(tpIndexLinks(snapshots.slice(1),'nas100'),'2026-11-20',SESSION),null);
 assert.equal(chainedRatio(tpIndexLinks(snapshots,'sox'),'2026-11-20',SESSION),null);
 assert.equal(chainedRatio(links,'2026-11-19',SESSION),null);
 // Past the line: 0% left, and an exit level is judged on the estimate.
 assert.equal(estimateFromRatio(plan(),0.6).remainingPct,0);
 assert.equal(reachedLines([],plan({stopLossPct:11}),e).stopLoss,true);
 assert.equal(reachedLines([],plan({stopLossPct:20}),e).stopLoss,false);
 const bars=[{date:'2026-11-18',close:90},{date:'2026-11-20',close:100},{date:'2026-11-23',close:101},{date:SESSION,close:104}];
 assert.equal(closeRatio(bars,'2026-11-20',SESSION),1.04);
 assert.equal(closeRatio(bars,'2026-11-21',SESSION),1.04); // last bar on or before the base
 assert.equal(closeRatio(bars.slice(0,3),'2026-11-20',SESSION),null);
 assert.equal(closeRatio(bars.slice(2),'2026-11-01',SESSION),null);
 assert.equal(estimateFromRatio(plan(),null),null);
});
test('§5 no-data cases are reported with a fixed code (bond ETF / gold unreadable, TP chain broken)',async()=>{
 const noBars=async()=>[],noSnapshots=async()=>[];
 assert.deepEqual(await estimateRatio(plan({},{q20:'bond'}),'2026-11-21T03:00:00Z',SESSION,{readSnapshots:noSnapshots,bars:noBars}),{missing:'no-index-data',index:'TLT'});
 assert.deepEqual(await estimateRatio(plan({},{q20:'gold'}),'2026-11-21T03:00:00Z',SESSION,{readSnapshots:noSnapshots,bars:noBars}),{missing:'no-index-data',index:'XAU/USD'});
 assert.deepEqual(await estimateRatio(plan(),'2026-11-21T03:00:00Z',SESSION,{readSnapshots:noSnapshots,bars:noBars}),{missing:'no-index-data',index:'nas100'});
 assert.deepEqual(await estimateRatio(plan({},{q20:null}),'2026-11-21T03:00:00Z',SESSION,{readSnapshots:noSnapshots,bars:noBars}),{missing:'no-index'});
 assert.deepEqual(await estimateRatio(plan(),'2025-06-01T00:00:00Z',SESSION,{readSnapshots:noSnapshots,bars:noBars}),{missing:'no-base-session'});
 const gold=await estimateRatio(plan({},{q20:'gold'}),'2026-11-21T03:00:00Z',SESSION,{readSnapshots:noSnapshots,bars:async s=>s==='XAU/USD'?[{date:'2026-11-20',close:4000},{date:SESSION,close:3800}]:[]});
 assert.equal(gold.index,'XAU/USD');assert.ok(Math.abs(gold.ratio-0.95)<1e-12);
});
test('check facts: distance to the member\'s own lines from the reference price; reached ones first',()=>{
 const p=plan({stopLossPct:25});
 const watch=watchFacts({watchItems:[{symbol:'NVDA',referencePrice:200},{symbol:'AMD',referencePrice:100}],surgeCapPct:20},
  [{symbol:'NVDA',date:SESSION,close:179,previousClose:185},{symbol:'AMD',date:SESSION,close:121,previousClose:118},{symbol:'MU',date:SESSION,close:1,previousClose:1}],p,SESSION);
 assert.deepEqual(watch.map(w=>[w.symbol,w.fromReferencePct,w.dayChangePct,w.buyLine,w.upTarget?.reached]),
  [['NVDA',-10.5,-3.2,{dropPct:10,reached:true,distancePct:0},false],['AMD',21,2.5,{dropPct:10,reached:false,distancePct:31},true]]);
 const checks=checkFacts(watch,p,{allowedDropPct:30,estimatedChangePct:-12.3,remainingPct:17.7});
 assert.deepEqual(checks.map(c=>[c.id,c.state]),[['buy:NVDA','reached'],['up:AMD','reached'],['stop-loss','ok'],['up:NVDA','ok'],['buy:AMD','ok'],['tolerance','ok']]);
 assert.equal(checks.find(c=>c.id==='tolerance').today.ja,'約−12.3%（あと17.7%）');
 // Direction: the shared rule (the top-rated story's own index move), as the home card computes it.
 assert.equal(marketDirection([article]),'up');assert.equal(marketDirection([]),'flat');
 assert.deepEqual(newsOf([article]),[{stars:3,changePercent:3.4}]);
 assert.deepEqual(gaugeOf([article],snapshot),{index:'sox',band:4,changePercent:3.4});assert.equal(gaugeOf([],null),null);
});

// The job, end to end on the real migrations, with a mocked model.
const reading=index=>({status:'ready',version:'daily-close-v1',index,asOf:SESSION,referenceFrom:'2016-11-24',observations:2500,score:index==='sox'?90:50,band:index==='sox'?4:2,drawdownPercent:-1,deviationPercent:5,drawdownPercentile:90,deviationPercentile:90});
const snapshot={asOf:SESSION,nas100:reading('nas100'),sox:reading('sox'),vix:{status:'ready',asOf:SESSION,level:20,percentile:55},
 moves:{nas100:{date:SESSION,previousDate:'2026-11-23',changePercent:1.2},sox:{date:SESSION,previousDate:'2026-11-23',changePercent:3.4}},
 shock:{'2026-11-23':{nas100:shockDay('2026-11-23','2026-11-20',-1),sox:shockDay('2026-11-23','2026-11-20',-2),fear:null},[SESSION]:{nas100:shockDay(SESSION,'2026-11-23',1.2),sox:shockDay(SESSION,'2026-11-23',3.4),fear:null}}};
const article={id:'a'.repeat(64),url:'https://example.com/chips',publishedAt:'2026-11-24T14:00:00Z',stars:3,quoteId:null,
 market:{index:'sox',session:SESSION,reading:{from:'2026-11-23',nas100:{changePercent:1.2,multiple:1.2,same:60,total:100},sox:{changePercent:3.4,multiple:2.5,same:36,total:40},fearChange:-5}},
 ja:{title:'半導体株が大きく上昇',source:'Example',content:'半導体株が上がりました。',date:'2026-11-24'},en:{title:'Chip stocks rally',source:'Example',content:'Chip stocks rose.',date:'2026-11-24'}};
async function database(t){
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const data=await boot.dumpDataDir();await boot.close();
 const db=new PGlite({database:'resolute',loadDataDir:data});t.after(()=>db.close());
 for(const f of ['001_entitlements.sql','002_plans.sql','003_plan_answers_fx.sql','004_notification_settings.sql','009_risk.sql','014_payments_live.sql'])await db.exec(sql(f));
 await db.exec('SET search_path = resolute');await db.exec(readFileSync(new URL('../scripts/resolute/thermometer-schema.sql',import.meta.url),'utf8'));await db.exec('SET search_path = DEFAULT');
 await db.exec(sql('027_today_plans.sql'));await db.exec(sql('027_today_plans.sql')); // re-applying is harmless
 return db;
}
const members={owner:OWNER_ACCOUNT_ID,paid:'user_paid',free:'user_free',bond:'user_bond',plain:'user_plain'};
async function seed(db){
 await db.query('INSERT INTO resolute.resolute_thermometer_snapshots(session_date,snapshot) VALUES($1,$2::jsonb)',[SESSION,JSON.stringify(snapshot)]);
 await db.query("INSERT INTO resolute.risk_days(day,state,articles) VALUES('2026-11-25','ready',$1::jsonb)",[JSON.stringify([article])]);
 const save=async(id,p,at='2026-11-21T03:00:00Z')=>{const {answers,fx,...rest}=p;await db.query('INSERT INTO resolute.plans(clerk_user_id,revision,plan,created_at,updated_at) VALUES($1,1,$2::jsonb,$3,$3)',[id,JSON.stringify({...rest,answers,fx}),at]);};
 await save(members.owner,plan({},{q20:'stock',q21:['tech_semis']}));
 await save(members.paid,plan({stopLossPct:5}));
 await save(members.free,plan());
 await save(members.bond,plan({},{q20:'bond'}));
 await save(members.plain,planWithoutQ08());
 await db.query("INSERT INTO resolute.notification_settings(clerk_user_id,settings,revision,updated_at) VALUES($1,$2::jsonb,1,'2026-11-21T03:00:00Z')",
  [members.owner,JSON.stringify({deliveryHourJst:7,alertsEnabled:true,morningEnabled:false,watchItems:[{symbol:'NVDA',referencePrice:200,priceDay:'2026-11-20'}],surgeCapPct:null})]);
 for(const [i,id] of [members.paid,members.bond,members.plain].entries()){
  const n=String(i+1).padStart(2,'0');
  await db.query(`INSERT INTO resolute_payments_live.orders(id,user_id,request_key,capture_key,quote,capture_id,state,created_at,expires_at,paid_at)
   VALUES($1,$2,$3,$4,'{"product":"resolute_v1","kind":"initial"}',$5,'paid','2026-11-01','2026-11-02','2026-11-01')`,
   [`00000000-0000-4000-8000-0000000000${n}`,id,`00000000-0000-4000-8000-0000000001${n}`,`00000000-0000-4000-8000-0000000002${n}`,'CAPTURE'+n]);
  await db.query(`INSERT INTO resolute_payments_live.grants VALUES($1,$2,'initial','2026-11-01','2100-01-01','active')`,[`00000000-0000-4000-8000-0000000000${n}`,id]);
 }
}
const bars=async(symbol)=>symbol==='NVDA'?[{date:'2026-11-23',close:190},{date:SESSION,close:180}]:[];
test('job: one plan per entitled member per market date, the owner included; mocked model; fallback; §5; idempotent; plan deletion forgets them',async t=>{
 const db=await database(t);await seed(db);
 const inputs=[],lines=[];
 const model=async input=>{inputs.push(input);
  const nvda=input.checkCandidates.find(c=>c.id==='buy:NVDA');
  // The bond member's model output invents a number twice → fixed sentence.
  if(input.estimate===null&&input.plan.answers.q20==='bond')return {output:{headline:{ja:'買いすぎに気をつける',en:'Careful'},body:{ja:['温度計は熱いです。','上限は55%です。'],en:['Hot.','Cap 55%.']},checks:[]},usage:{input_tokens:2000,output_tokens:300}};
  return {output:{headline:{ja:nvda?'決めていた買い増しの日':'買いすぎに気をつける',en:'Today'},body:{ja:['TP半導体40は +3.4%でした。','決めたルールどおりに確かめます。'],en:['TP Semiconductor 40 +3.4%.','Check your own rules.']},
   checks:nvda?[{id:nvda.id,label:nvda.label,rule:nvda.rule,today:nvda.today}]:[]},usage:{input_tokens:2000,output_tokens:300}};};
 const report=await runTodayPlanJob({pool:db,now:NOW,model,bars,source:'live',log:l=>lines.push(l)});
 assert.equal(report.state,'done');assert.equal(report.session,SESSION);assert.equal(report.shock,'ready');
 assert.equal(report.members,5);assert.equal(report.notEntitled,1);assert.equal(report.ai,3);assert.equal(report.fixed,1);assert.equal(report.errors,0);
 assert.deepEqual(report.rejections,{'new-number':2});assert.equal(report.inputTokens,10000);assert.equal(report.outputTokens,1500);
 const rows=Object.fromEntries((await db.query('SELECT clerk_user_id,source,plan FROM resolute.today_plans ORDER BY clerk_user_id')).rows.map(r=>[r.clerk_user_id,r]));
 assert.equal(rows[members.free],undefined);
 const owner=parseTodayPlan(rows[members.owner].plan);
 assert.equal(owner.date,SESSION);assert.equal(owner.direction,'up');assert.equal(owner.headline.ja,'決めていた買い増しの日');
 assert.deepEqual(owner.checks.map(c=>c.state),['reached']);
 // TP半導体40 chained 11-20 → 11-23 (−2%) → 11-24 (+3.4%): +1.3% (rounded once).
 assert.deepEqual(owner.estimate,{allowedDropPct:30,estimatedChangePct:1.3,remainingPct:31.3});
 const paid=parseTodayPlan(rows[members.paid].plan);assert.equal(paid.estimate.estimatedChangePct,0.2);
 const bond=rows[members.bond];assert.equal(bond.source,'fixed');assert.equal(bond.plan.estimate,null);
 assert.equal(bond.plan.headline.ja,'買いすぎに気をつける'); // thermometer: TP半導体40 reads 熱い
 assert.equal(rows[members.plain].plan.estimate,null); // no q08: no estimate
 // The model saw the day's Shock Gauge, the thermometer stage, the watched close and the rulebook; never another member.
 const ownerInput=inputs.find(i=>i.watched.length);
 assert.equal(ownerInput.shockGauge.items[0].stars,3);assert.match(ownerInput.shockGauge.items[0].moves.ja[0],/TP半導体40　\+3\.4%/);
 assert.deepEqual(ownerInput.thermometer.map(s=>s.ja),['TP大型株100：平常','TP半導体40：熱い']);
 assert.deepEqual(ownerInput.watched[0],{symbol:'NVDA',close:180,dayChangePct:-5.3,fromReferencePct:-10,buyLine:{dropPct:10,reached:true,distancePct:0},upTarget:null});
 assert.equal(ownerInput.plan.rulebook.ja.length>3,true);
 // §5 no-data cases are logged with a code and a hash, never the id or amounts.
 const missing=lines.filter(l=>l.event==='RESOLUTE_TODAY_PLAN_ESTIMATE_MISSING');
 assert.deepEqual(missing.map(l=>[l.reason,l.index,l.q20]),[['no-index-data','TLT','bond']]);
 assert.doesNotMatch(JSON.stringify(lines),/user_|3000000/);
 assert.deepEqual(report.estimateMissing,{'no-index-data':1,'no-q08':1});
 // Idempotent: a second run calls nothing and changes nothing.
 const before=inputs.length,again=await runTodayPlanJob({pool:db,now:NOW,model,bars,source:'live',log:()=>{}});
 assert.equal(inputs.length,before);assert.equal(again.existing,4);
 // Recent headlines are passed so the words change from day to day.
 const next=new Date('2026-11-25T23:40:00Z');
 const snap2={...snapshot,asOf:'2026-11-25',nas100:{...reading('nas100'),asOf:'2026-11-25',referenceFrom:'2016-11-25'},sox:{...reading('sox'),asOf:'2026-11-25',referenceFrom:'2016-11-25'},vix:{status:'unavailable',reason:'provider-error'},moves:{nas100:{date:'2026-11-25',previousDate:SESSION,changePercent:-0.1},sox:null},shock:{}};
 await db.query("INSERT INTO resolute.resolute_thermometer_snapshots(session_date,snapshot) VALUES('2026-11-25',$1::jsonb)",[JSON.stringify(snap2)]);
 inputs.length=0;const third=await runTodayPlanJob({pool:db,now:next,model,bars,source:'live',onlyUserIds:[members.owner],log:()=>{}});
 assert.equal(third.members,1);assert.equal(third.shock,'unavailable');assert.deepEqual(inputs[0].recentHeadlines,['決めていた買い増しの日']);
 // Deleting the plan (the plan API's DELETE or member erasure) forgets the member's daily plans.
 await db.query("UPDATE resolute.plans SET plan=NULL,created_at=NULL,updated_at=NULL,deleted_at=now(),revision=2 WHERE clerk_user_id=$1",[members.owner]);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM resolute.today_plans WHERE clerk_user_id=$1',[members.owner])).rows[0].n,0);
 // No snapshot for the latest close yet: nothing is generated.
 assert.deepEqual(await runTodayPlanJob({pool:db,now:new Date('2026-11-27T23:40:00Z'),model,bars,log:()=>{}}),{state:'thermometer-not-ready',session:'2026-11-27'});
});
test('job roles: the writer reads its inputs and writes only its rows; the reader reads only plans',async t=>{
 const db=await database(t);
 await db.exec('SET ROLE resolute_today_plan_writer');
 await db.query("INSERT INTO resolute.today_plans(clerk_user_id,market_date,source,plan) VALUES('user_a','2026-11-24','fixed','{\"date\":\"2026-11-24\",\"source\":\"fixed\"}')");
 for(const table of ['plans','notification_settings','risk_days','risk_hidden','resolute_thermometer_snapshots','today_plan_budget'])await db.query(`SELECT * FROM resolute.${table} LIMIT 1`);
 await db.query('SELECT * FROM resolute_payments_live.entitlement_periods LIMIT 1');
 for(const bad of ['UPDATE resolute.plans SET plan=NULL','DELETE FROM resolute.risk_days','SELECT * FROM resolute.risk_candidates','SELECT * FROM resolute.risk_budget','SELECT * FROM resolute_payments_live.orders','UPDATE resolute.today_plans SET source=source'])
  await assert.rejects(db.query(bad),e=>e.code==='42501',bad);
 await db.exec('RESET ROLE');await db.exec('SET ROLE resolute_today_plan_reader');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM resolute.today_plans')).rows[0].n,1);
 for(const bad of ['SELECT * FROM resolute.plans','DELETE FROM resolute.today_plans','SELECT * FROM resolute.notification_settings'])await assert.rejects(db.query(bad),e=>e.code==='42501',bad);
 await db.exec('RESET ROLE');
 await assert.rejects(db.query("INSERT INTO resolute.today_plans(clerk_user_id,market_date,source,plan) VALUES('user_b','2026-11-24','ai','{\"date\":\"2026-11-23\",\"source\":\"ai\"}')"));
});
test('model request: the repo\'s gpt-5.4-mini, its own monthly bucket, bounded size, never stored at the provider',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE SCHEMA resolute; CREATE TABLE resolute.today_plan_budget(month text PRIMARY KEY,reserved_usd numeric(8,4) NOT NULL CHECK(reserved_usd>=0))');
 let sent;const fetcher=async(url,init)=>{sent={url,body:JSON.parse(init.body),auth:init.headers.Authorization};
  return Response.json({status:'completed',usage:{input_tokens:2000,output_tokens:300},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(good)}]}]});};
 const model=createTodayModel({apiKey:'synthetic',pool:db,fetcher,limit:30,now:()=>NOW});
 const r=await model({marketDate:SESSION});
 assert.equal(sent.url,'https://api.openai.com/v1/responses');assert.equal(sent.body.model,TODAY_PLAN_MODEL);assert.equal(TODAY_PLAN_MODEL,'gpt-5.4-mini');
 assert.equal(sent.body.store,false);assert.equal(sent.body.text.format.strict,true);assert.deepEqual(r.output,good);
 // Reserved 2 cents, settled to the real cost: 2000×$0.75/M + 300×$4.50/M = $0.00285 → 0.0029.
 assert.equal(Number((await db.query('SELECT reserved_usd FROM resolute.today_plan_budget')).rows[0].reserved_usd),0.0029);
 await assert.rejects(model({big:'あ'.repeat(9000)}),/AI_REQUEST_OUTSIDE_BUDGET/);
 const tiny=createTodayModel({apiKey:'synthetic',pool:db,fetcher,limit:0.01,now:()=>NOW});
 await assert.rejects(tiny({marketDate:SESSION}),/BUDGET_LIMIT/);
 await assert.rejects(createTodayModel({apiKey:'',pool:db,fetcher})({}),/MODEL_NOT_CONFIGURED/);
});

// Read endpoint and site transport.
const readerUrl='postgresql://resolute_today_plan_reader:fixture-only@postgres.railway.internal:5432/resolute';
const env={RESOLUTE_TODAY_PLAN_ENABLED:'true',RESOLUTE_TODAY_PLAN_READ_DATABASE_URL:readerUrl};
const stored={...fixedTodayPlan({date:SESSION,news:[{stars:3,changePercent:2}],thermometer:null,lines:{buyDropPct:10,stopLossPct:null,surgeCapPct:null},stocks:[],estimate:null}),date:SESSION};
const req=(method='GET',path='/internal/v1/today-plan')=>new Request('https://railway.test'+path,{method});
function readFixture(){
 let queries=0,pools=0;
 const poolFactory=config=>{pools++;assert.equal(config.max,1);assert.equal(new URL(config.connectionString).username,'resolute_today_plan_reader');
  return {query:async(sqlText,values)=>{queries++;return {rows:values[0]===members.free?[]:[{plan:values[1]===SESSION?stored:{...stored,date:values[1]}}]};}};};
 return {read:createTodayPlanRead(env,{poolFactory,clock:()=>NOW}),queries:()=>queries,pools:()=>pools};
}
test('read API: off by default, reader role only, entitlement before storage, owners always',async()=>{
 assert.equal(createTodayPlanRead({}),undefined);assert.equal(createTodayPlanRead({RESOLUTE_TODAY_PLAN_READ_DATABASE_URL:readerUrl}),undefined);
 assert.equal(createTodayPlanRead({...env,RESOLUTE_TODAY_PLAN_ENABLED:'1'}),undefined);
 assert.throws(()=>createTodayPlanRead({...env,RESOLUTE_TODAY_PLAN_READ_DATABASE_URL:readerUrl.replace('resolute_today_plan_reader','resolute_today_plan_writer')}));
 const f=readFixture();
 let res=await f.read(req(),'user_free_member',async()=>({canUseTools:false}));
 assert.equal(res.status,403);assert.equal(f.queries(),0);assert.equal(f.pools(),0);
 assert.equal((await f.read(req('POST'),'user_paid',async()=>({canUseTools:true}))).status,405);
 res=await f.read(req(),'user_paid',async()=>({canUseTools:true}));
 assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'private, no-store');assert.deepEqual(await res.json(),{plan:stored});
 // The preview owner account has no purchase and is never refused.
 res=await f.read(req(),OWNER_ACCOUNT_ID,async()=>({canUseTools:false}));assert.equal(res.status,200);assert.deepEqual((await res.json()).plan,stored);
 assert.deepEqual(await (await f.read(req(),members.free,async()=>({canUseTools:true}))).json(),{plan:null});
});
test('handler: session required, GET only, 503 when disabled, production owner with MFA allowed and without refused',async()=>{
 const f=readFixture(),none={canUseTools:false};
 const grant=ownerAccessFromVerifiedSession({sub:PRODUCTION_OWNER_ACCOUNT_ID,iss:OWNER_ISSUER,azp:OWNER_ORIGIN,fva:[0,0],exp:Math.floor(Date.now()/1000)+60});
 const handler=principal=>createHandler({},async(id,access)=>hasOwnerAccess(access,id)?ownerAccessSnapshot(access,id):none,async()=>principal,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,f.read);
 assert.equal((await handler({userId:PRODUCTION_OWNER_ACCOUNT_ID,ownerAccess:grant})(req())).status,200);
 assert.deepEqual(await (await handler({userId:PRODUCTION_OWNER_ACCOUNT_ID})(req())).json(),{error:'OWNER_MFA_REQUIRED'});
 assert.equal((await handler('user_paid')(req())).status,403);
 assert.equal((await handler(null)(req())).status,401);
 assert.equal((await handler('user_paid')(req('PUT'))).status,405);
 assert.equal((await handler('user_paid')(req('GET','/internal/v1/today-plan?date=2026-11-23'))).status,404);
 const disabled=createHandler({},async()=>({canUseTools:true}),async()=>'user_paid');
 let res=await disabled(req());assert.equal(res.status,503);assert.deepEqual(await res.json(),{error:'TODAY_PLAN_UNAVAILABLE'});
 const broken=createHandler({},async()=>{throw Error('postgres://secret');},async()=>'user_paid',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,f.read);
 res=await broken(req());assert.equal(res.status,503);assert.doesNotMatch(await res.text(),/secret/);
});
test('site transport: fixed HTTPS endpoint, member session, strict re-validation',async()=>{
 const secret='s'.repeat(64),base='https://resolute.up.railway.app/';
 const fetcher=async(url,options)=>{assert.equal(url.href,'https://resolute.up.railway.app/internal/v1/today-plan');assert.equal(options.redirect,'error');
  assert.equal(options.headers.Authorization,'Bearer verified');assert.equal(options.headers['X-Resolute-Service-Token'],secret);return Response.json({plan:stored});};
 assert.deepEqual(await fetchTodayPlan('verified',base,secret,fetcher),{status:200,body:{plan:stored}});
 assert.deepEqual((await fetchTodayPlan('verified',base,secret,async()=>new Response(null,{status:403}))).body,{error:'ACCESS_DENIED'});
 await assert.rejects(fetchTodayPlan('verified','https://evil.example/',secret,fetcher));
 await assert.rejects(fetchTodayPlan('verified',base,secret,async()=>Response.json({plan:{...stored,headline:{ja:'あ'.repeat(13),en:'x'}}})));
 await assert.rejects(fetchTodayPlan('verified',base,secret,async()=>Response.json({plan:stored,extra:1})));
 assert.deepEqual(parseTodayPlanSnapshot({plan:null}),{plan:null});
 const route=readFileSync(new URL('../app/api/resolute/today-plan/route.ts',import.meta.url),'utf8');
 assert.match(route,/todayPlanEnabled\(\)/);assert.match(route,/session\.getToken\(\)/);
});
