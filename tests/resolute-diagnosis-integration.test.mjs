import test from 'node:test';
import assert from 'node:assert/strict';
import {calcAmounts,diagnose,pickAdvice} from '../lib/resolute/diagnosis.ts';
import {calculatePlanAmounts} from '../lib/resolute/plan-calculation.ts';
import {questions,emptyDiagnosisDraft,selectAnswer,numericLimits,validateQuestion,draftToPlan,draftToInput,draftFromPlan,questionCopy,isQuestionVisible} from '../lib/resolute/diagnosis-form.ts';
import {PLAN_ANSWER_OPTIONS,parsePlanAnswers,emptyPlanAnswers} from '../lib/resolute/plan-answers.ts';
import {parsePlan,parsePlanSnapshot} from '../lib/resolute/plan-data.ts';
import {requestPlan,PlanClientError} from '../lib/resolute/plan-client.ts';
import {EN_TYPES,EN_ADVICE,localizeDiagnosis} from '../lib/resolute/diagnosis-copy.ts';
export function answered(over={}) {
 const d=emptyDiagnosisDraft();
 Object.assign(d.answers,{q01:'3to5',q02:'l25',q03:'stable',q04:'m6',q05:'m6',q06:'none',q07:'input',q08:'input',q09:'y10plus',q10:'rarely',q11:'p20',q12:'no',q13:'wait',q14:'never',q15:'hold',q16:'steady',q17:'monthly',q18:'weekly',q19:'never',q20:'stock',q21:['tech_semis'],q22:'p20',q23:'p10to30',q24:'steps3',q25:'d10',q26:'b5',q27:'equal',q28:['cash_low'],q29:['over_tolerance'],q30:'ignore',...over});
 d.numbers={q07:'10000000',q08:'3000000'};return d;
}
const stamped=p=>({...p,createdAt:'2026-10-12T00:00:00.000Z',updatedAt:'2026-10-12T00:00:00.000Z'});
const response=(status,body)=>Response.json(body,{status});
test('all 30 final question IDs and every JA/EN option agree with the storage contract',()=>{
 assert.equal(questions.length,30);
 for(const q of questions){assert.deepEqual(q.o.map(o=>o.id),[...PLAN_ANSWER_OPTIONS[q.id]]);
  const en=questionCopy(q,'en');assert.equal(en.options.length,q.o.length);assert.ok(en.text);
  assert.ok(!/[\u3040-\u30ff\u4e00-\u9fff]/u.test(en.text+en.options.map(o=>o.label).join('')));
 }
 assert.deepEqual(PLAN_ANSWER_OPTIONS.q01,['first','1to3','3to5','5to7','7to10','10plus']);
 assert.ok(PLAN_ANSWER_OPTIONS.q25.includes('unknown'));assert.ok(PLAN_ANSWER_OPTIONS.q26.includes('b5'));
 assert.throws(()=>parsePlanAnswers({...emptyPlanAnswers(),q01:'3plus'}));
});
test('supplied arithmetic agrees with server calculation at boundaries, unknowns and decimal precision',()=>{
 for(const financialAssets of [null,0,1,10000000,1e12])for(const investedAmount of [null,0,3,3000000,1e12])
 for(const monthlyLivingCost of [0,1,250000,1e12])for(const reserveMonths of [0,0.1,2.5,120])
 for(const pct of [null,0,0.1,33.3,99.9,100]){
  const i={...draftToInput(answered()),financialAssets,investedAmount,monthlyLivingCost,reserveMonths,tolerancePct:pct,buyBudgetPct:pct};
  const expected=calculatePlanAmounts({currency:'JPY',financialAssets,investedAmount,monthlyLivingCost,reserveMonths,tolerancePct:pct,buyBudgetPct:pct,nearTermExpense:i.nearTermExpense});
  const {perStockCapAmount,...actual}=calcAmounts(i);assert.deepEqual(actual,expected);assert.ok(perStockCapAmount===null||Number.isSafeInteger(perStockCapAmount));
 }
});
test('fully answered questionnaire produces a valid PUT body with exact amounts and 5% budget',()=>{
 const p=draftToPlan(answered());assert.equal(p.investable,8500000);assert.equal(p.toleranceDrop,600000);
 assert.equal(p.buyBudgetPct,5);assert.deepEqual(p.buyLines,[{dropPct:10,amount:50000},{dropPct:20,amount:50000},{dropPct:30,amount:50000}]);
 assert.equal(p.firstDropPct,10);assert.equal(p.ruleType,'undecided');assert.deepEqual(parsePlan(p),p);
 assert.deepEqual(draftToPlan(draftFromPlan(p)),p);
});
test('unknown first threshold retains the intended mode with no invented price or amount',()=>{
 const p=draftToPlan(answered({q25:'unknown'}));assert.equal(p.buyMode,'steps');assert.equal(p.firstDropPct,null);assert.deepEqual(p.buyLines,[]);
 assert.deepEqual(parsePlan(p),p);assert.throws(()=>parsePlan({...p,firstDropPct:10}));assert.match(diagnose(draftToInput(answered({q25:'unknown'}))).rows[3].rule,/まだ決めて/);
});
test('unknown investment base preserves a custom first threshold even when lines cannot be calculated',()=>{
 const d=answered({q07:'unknown',q08:'not_yet',q25:'custom'});d.numbers.q25='12.3';
 const p=draftToPlan(d);assert.equal(p.investable,null);assert.equal(p.toleranceDrop,null);assert.equal(p.firstDropPct,12.3);assert.deepEqual(p.buyLines,[]);
 assert.deepEqual(draftToPlan(draftFromPlan(p)),p);
});
test('zero base is a real zero, and pending-line relaxation never permits malformed concrete lines',()=>{
 const d=answered({q07:'input',q08:'not_yet'});d.numbers.q07='0';const p=draftToPlan(d);
 assert.equal(p.investable,0);assert.equal(p.buyLines.length,3);assert.equal(p.buyLines[0].amount,0);
 const known=draftToPlan(answered());assert.throws(()=>parsePlan({...known,buyLines:[]}));
 assert.throws(()=>parsePlan({...known,firstDropPct:12}));assert.throws(()=>parsePlan({...known,firstDropPct:100}));
});
test('changing parent answers clears hidden answers and numeric drafts; none is a separate mode',()=>{
 let d=answered();d.numbers.q25='5';d=selectAnswer(d,'q24','none');
 assert.equal(d.answers.q25,null);assert.equal(d.answers.q26,null);assert.equal(d.answers.q27,null);assert.equal(d.numbers.q25,undefined);
 const p=draftToPlan(d);assert.equal(p.buyMode,'none');assert.equal(p.buyBudgetPct,null);assert.equal(p.allocation,null);assert.deepEqual(p.buyLines,[]);
 d=selectAnswer(d,'q20','fund_etf');assert.equal(d.answers.q21,null);assert.equal(isQuestionVisible('q21',d.answers),false);
});
test('input precision, empty values and maximum stage levels are rejected before calculating results',()=>{
 for(const [id,values] of [['q02',['','-1','0.1','1000000000001','NaN','Infinity']],['q25',['0','25','25.01','100']]]){
  const d=answered({q24:'steps4',[id]:'custom'});const q=questions.find(q=>q.id===id);
  for(const value of values){d.numbers[id]=value;assert.throws(()=>validateQuestion(q,d),undefined,id+':'+value);}
 }
 const d=answered({q25:'custom',q24:'steps4'});d.numbers.q25='24.9';assert.equal(draftToPlan(d).buyLines.at(-1).dropPct,99.6);
 assert.equal(numericLimits(questions.find(q=>q.id==='q25'),d.answers).max,24.9);
});
test('free conditions are bounded, remain text, and both predefined and free conditions reach the result',()=>{
 const d=answered();d.noBuyConditions=['<script>private</script>'];const p=draftToPlan(d);
 assert.equal(p.noBuyConditions[0],'<script>private</script>');
 assert.ok(diagnose(draftToInput(d)).rows[4].rule.includes('貯金が減ったとき'));
 d.noBuyConditions=['a'.repeat(101)];assert.throws(()=>draftToPlan(d));d.noBuyConditions=Array(11).fill('a');assert.throws(()=>draftToPlan(d));
});
test('advice respects selected brakes and does not infer a cap violation from an ambiguous over-50 band',()=>{
 const d=answered({q23:'gt50',q22:'custom'});d.numbers.q22='80';const i=draftToInput(d);
 assert.ok(!pickAdvice(i,calcAmounts(i)).some(a=>a.id==='top_over_cap'));
 assert.ok(!pickAdvice(i,calcAmounts(i)).some(a=>a.id==='no_brakes'));
 i.perStockCapPct=50;assert.ok(pickAdvice(i,calcAmounts(i)).some(a=>a.id==='top_over_cap'));
});
test('all 10 types, 23 advice messages and seven result cards have English without changing numeric results',()=>{
 assert.equal(Object.keys(EN_TYPES).length,10);assert.equal(Object.keys(EN_ADVICE).length,23);
 const i=draftToInput(answered()),r=diagnose(i),en=localizeDiagnosis(r,i,'en');
 assert.deepEqual(en.amounts,r.amounts);assert.deepEqual(en.buyLines,r.buyLines);assert.equal(en.type,r.type);
 assert.equal(en.rows.length,7);assert.deepEqual(en.advice.map(a=>a.id),r.advice.map(a=>a.id));
 for(const type of Object.keys(EN_TYPES))assert.ok(localizeDiagnosis({...r,type},i,'en').typeDetail.length>50);
 for(const text of Object.values(EN_ADVICE).map(fn=>fn(i,r.amounts)))assert.ok(!/[\u3040-\u30ff\u4e00-\u9fff]/u.test(text));
});
test('USD plans retain cents through editing and display dollars in both languages',()=>{
 const d=answered({q02:'custom'});d.currency='USD';d.numbers={q02:'2500.15',q07:'100000.99',q08:'30000.01'};
 const p=draftToPlan(d);assert.equal(p.monthlyLivingCost,250015);assert.equal(p.financialAssets,10000099);assert.equal(p.investedAmount,3000001);
 assert.deepEqual(draftToPlan(draftFromPlan(p)),p);
 const input=draftToInput(d),r=diagnose(input);
 for(const locale of ['ja','en']){const text=localizeDiagnosis(r,input,locale);assert.match(text.rows[0].rule,/US\$/);assert.doesNotMatch(text.rows[0].rule,/円|¥/);}
 for(const value of ['1.001','10000000000.01','NaN']){d.numbers.q07=value;assert.throws(()=>draftToPlan(d));}
 assert.deepEqual(questionCopy(questions.find(q=>q.id==='q02'),'en','USD').options.map(x=>x.id),['custom']);
});
test('plan client sends one same-origin PUT with revision and validates confirmed save',async()=>{
 const p=draftToPlan(answered());let calls=0;
 const result=await requestPlan({plan:p,baseRevision:0},undefined,async(url,options)=>{
  calls++;assert.equal(url,'/api/resolute/plan');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');
  assert.equal(options.method,'PUT');assert.deepEqual(JSON.parse(options.body),{plan:p,baseRevision:0});
  return response(200,{plan:stamped(p),revision:1});});assert.equal(calls,1);assert.equal(result.revision,1);
});
test('client distinguishes conflict, outage, auth, rate limit and never retries a write',async()=>{
 const p=draftToPlan(answered());
 for(const [status,kind] of [[401,'signed-out'],[403,'denied'],[409,'conflict'],[429,'rate-limited'],[503,'unavailable']]){
  let calls=0;await assert.rejects(()=>requestPlan({plan:p,baseRevision:1},undefined,async()=>{calls++;return response(status,status===409?{plan:stamped(p),revision:3}:{error:'REDACTED'});}),e=>e instanceof PlanClientError&&e.kind===kind&&(status!==409||e.snapshot.revision===3));assert.equal(calls,1);
 }
 for(const body of [{plan:null,revision:2},{plan:stamped(p),revision:1},{plan:stamped(p),revision:3}])
  await assert.rejects(()=>requestPlan({plan:p,baseRevision:1},undefined,async()=>response(200,body)),/unavailable/);
 await assert.rejects(()=>requestPlan(undefined,undefined,async()=>new Response('x'.repeat(20000),{headers:{'content-type':'application/json'}})),/unavailable/);
 assert.equal(parsePlanSnapshot({plan:null,revision:9}).revision,9);
});

// Final adjustments must preserve independent notifications and custom purchase levels.
import {notebookResult,notebookEdits,adjustNotebook,notebookDocument} from '../lib/resolute/notebook.ts';
import {createReviewStore} from '../lib/resolute/review-store.ts';
test('notebook edits preserve custom lines, round trip answers and never mutate notification settings',async()=>{
 const store=createReviewStore(),p=draftToPlan(answered());p.buyLines[0].amount=12345;
 const saved=await store.requestPlan({plan:p,baseRevision:0});const before=await store.requestNotificationSettings();
 const edits={...notebookEdits(saved.plan),reserveMonths:'8.5',perStockCapPct:'12.5',noBuyConditions:'My own condition'};
 const updated=adjustNotebook(saved.plan,edits);assert.deepEqual(updated.buyLines,p.buyLines);assert.equal(updated.answers.q05,'custom');assert.equal(updated.answers.q22,'custom');
 assert.equal(draftFromPlan(updated).numbers.q05,'8.5');assert.equal(updated.investable,7875000);
 assert.match(notebookResult(updated,'en').rows[3].rule,/12,345/);
 await store.requestPlan({plan:updated,baseRevision:saved.revision});assert.deepEqual(await store.requestNotificationSettings(),before);
 await assert.rejects(store.requestPlan({plan:updated,baseRevision:saved.revision}),e=>e.kind==='conflict');
});
test('portable notebook escapes private text and has no scripts or external requests',()=>{
 const p=stamped(draftToPlan(answered()));p.noBuyConditions=['<script>alert("private")</script>'];
 const html=notebookDocument(p,'en');assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes("default-src 'none'"));assert.ok(!html.includes('https://'));
 for(const changes of [{reserveMonths:'120.1'},{perStockCapPct:'100.1'},{reserveMonths:''},{noBuyConditions:'x'.repeat(101)}])assert.throws(()=>adjustNotebook(p,{...notebookEdits(p),...changes}));
});

import {rulebookChapters,stopLossAmounts} from '../lib/resolute/rulebook.ts';
test('book uses stated behaviour, saved purchase lines and no FX chapter or invented exit threshold',()=>{
 const p=draftToPlan(answered({q10:'rarely',q19:'often',q15:'sell_some'}));
 p.buyLines[0].amount=12345;
 const chapters=rulebookChapters(p,'en'),text=JSON.stringify(chapters);
 assert.match(text,/impulse purchases/);assert.doesNotMatch(text,/Investing has kept you awake/);
 assert.match(text,/has not set when or how much/);assert.match(text,/exit level is not set yet/);
 assert.doesNotMatch(text,/USD\/JPY|Exchange rates/);assert.equal(stopLossAmounts(p),null);
 assert.deepEqual(chapters.flatMap(c=>c.lines??[]),p.buyLines);
 const sleep=rulebookChapters(draftToPlan(answered({q10:'often',q19:'never'})),'en');assert.match(JSON.stringify(sleep),/Investing has kept you awake/);
});
test('explicit exit percentage is independent of tolerance and survives quiz round trip',()=>{
 const p=draftToPlan(answered());const adjusted=adjustNotebook(p,{...notebookEdits(p),stopLossPct:'25.5'});
 assert.equal(adjusted.tolerancePct,20);assert.equal(adjusted.stopLossPct,25.5);
 assert.deepEqual(stopLossAmounts(adjusted),{base:3000000,loss:765000,value:2235000});
 assert.equal(draftToPlan(draftFromPlan(adjusted)).stopLossPct,25.5);
 assert.equal(adjustNotebook(adjusted,{...notebookEdits(adjusted),stopLossPct:''}).stopLossPct,null);
 for(const value of [0,-1,100,25.55,Infinity,'20'])assert.throws(()=>parsePlan({...p,stopLossPct:value}));
 assert.equal(stopLossAmounts({...p,stopLossPct:20,investedAmount:null,investable:null}),null);
 assert.equal(stopLossAmounts({...p,stopLossPct:20,investedAmount:0,investable:0}),null);
});
test('all custom rules appear across readable chapters and the offline book has local page navigation',()=>{
 const p=stamped(draftToPlan(answered()));p.noBuyConditions=Array.from({length:10},(_,i)=>`Personal condition ${i}`);
 const chapters=rulebookChapters(p,'en'),hold=chapters.filter(c=>c.id.startsWith('hold-off'));
 assert.ok(hold.every(c=>c.paragraphs.length<=3));for(const condition of p.noBuyConditions)assert.ok(hold.some(c=>c.paragraphs.includes(condition)));
 const html=notebookDocument(p,'en');assert.match(html,/href="#page-1"/);assert.doesNotMatch(html,/USD\/JPY|<script|https:\/\//);
});
