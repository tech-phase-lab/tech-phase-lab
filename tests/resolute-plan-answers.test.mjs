import test from 'node:test';
import assert from 'node:assert/strict';
import {PLAN_ANSWER_OPTIONS,emptyPlanAnswers,parsePlanAnswers,parsePlanFx} from '../lib/resolute/plan-answers.ts';
import {parsePlan} from '../lib/resolute/plan-data.ts';
import {createPlanRoutes} from '../lib/resolute/plan-route.ts';

const base={schemaVersion:1,answersVersion:1,answers:emptyPlanAnswers(),
 fx:{thresholdYen:null,usdJpy:null,note:''},currency:'JPY',monthlyLivingCost:150000,savingsMonths:0,
 reserveMonths:3,nearTermExpense:0,financialAssets:null,investedAmount:null,investable:null,
 tolerancePct:null,toleranceDrop:null,perStockCapPct:10,buyMode:'none',buyLines:[],buyBudgetPct:null,
 allocation:null,noBuyConditions:[],haltConditions:[],ruleType:'undecided'};

test('all 30 exact IDs, agreed options and null unanswered values round-trip without numeric answers',()=>{
 const empty=emptyPlanAnswers();assert.equal(Object.keys(empty).length,30);
 assert.deepEqual(parsePlanAnswers(empty),empty);
 for(const [id,options] of Object.entries(PLAN_ANSWER_OPTIONS))for(const option of options){
  const answers={...empty,[id]:['q21','q28','q29'].includes(id)?[option]:option};
  if(id==='q21')answers.q20='stock';
  if(['q25','q26','q27'].includes(id))answers.q24='steps2';
  assert.deepEqual(parsePlanAnswers(answers),answers);
 }
 const omitted={...empty};delete omitted.q30;
 for(const value of [null,[],{},omitted,{...empty,q31:null},{...empty,q01:1},
  {...empty,q02:150000},{...empty,q01:['first']},{...empty,q28:'cash_low'},
  {...empty,q28:[]},{...empty,q28:['cash_low','cash_low']},{...empty,q29:['PRIVATE_TEXT']},
  {...empty,q30:undefined}])assert.throws(()=>parsePlanAnswers(value),/INVALID_PLAN_ANSWERS/);
 const copy=parsePlanAnswers({...empty,q28:['cash_low']});copy.q28.push('over_cap');assert.equal(empty.q28,null);
});

test('hidden branches must be null; visible branches may remain unanswered',()=>{
 for(const patch of [{q20:'fund_etf',q21:['tech_semis']},{q21:['dividend']},
  {q24:'none',q25:'d5'},{q24:'none',q26:'b10'},{q24:'single',q27:'equal'},
  {q24:null,q25:'d5'},{q24:null,q26:'b10'},{q24:null,q27:'heavier'}])
  assert.throws(()=>parsePlanAnswers({...emptyPlanAnswers(),...patch}));
 assert.deepEqual(parsePlanAnswers({...emptyPlanAnswers(),q20:'mixed',q21:['finance','dividend'],
  q24:'steps4',q25:'custom',q26:'b30',q27:'heavier'}).q21,['finance','dividend']);
 assert.equal(parsePlanAnswers({...emptyPlanAnswers(),q24:'single'}).q25,null);
});

test('FX has independent rate and yen threshold precision, nulls and Unicode note limits',()=>{
 for(const value of [{thresholdYen:0.1,usdJpy:50,note:''},{thresholdYen:50,usdJpy:500,note:'🪙'.repeat(200)},
  {thresholdYen:null,usdJpy:150.25,note:'別入力'},{thresholdYen:7,usdJpy:null,note:''}])assert.deepEqual(parsePlanFx(value),value);
 for(const patch of [{thresholdYen:0},{thresholdYen:50.1},{thresholdYen:0.11},{thresholdYen:NaN},
  {usdJpy:49.99},{usdJpy:500.01},{usdJpy:100.001},{usdJpy:Infinity},{note:'🪙'.repeat(201)},
  {extra:'PRIVATE'},{usdJpy:undefined},{note:'\u0000'},{note:'\ud800'}])assert.throws(()=>parsePlanFx({...base.fx,...patch}),/INVALID_PLAN_FX/);
});

test('answers version, unknown assets and FX choice bindings are checked without classifying ruleType',()=>{
 assert.deepEqual(parsePlan(base),base);
 assert.equal(parsePlan({...base,ruleType:'scale_in',answers:{...base.answers,q16:'defensive'}}).ruleType,'scale_in');
 for(const patch of [{answersVersion:2},{answersVersion:undefined},{noBuyConditions:['\u0000']},{haltConditions:['\ud800']},
  {answers:{...base.answers,q07:'unknown'},financialAssets:100,investable:0},
  {answers:{...base.answers,q08:'not_yet'},investedAmount:0},
  {answers:{...base.answers,q30:'ignore'},fx:{...base.fx,thresholdYen:3}},
  {answers:{...base.answers,q30:'yen3'},fx:{...base.fx,thresholdYen:7}},
  {answers:{...base.answers,q30:'yen7'},fx:{...base.fx,thresholdYen:null}},
  {answers:{...base.answers,q30:'custom'},fx:base.fx}])assert.throws(()=>parsePlan({...base,...patch}),/INVALID_PLAN/);
 for(const [choice,threshold] of [['ignore',null],['yen3',3],['yen7',7],['custom',4.5]])
  assert.equal(parsePlan({...base,answers:{...base.answers,q30:choice},fx:{thresholdYen:threshold,usdJpy:155.01,note:''}}).fx.usdJpy,155.01);
 // Questionnaire representative values are UI inputs; subsequent tool edits remain valid.
 assert.equal(parsePlan({...base,answers:{...base.answers,q02:'l15'},monthlyLivingCost:123456}).monthlyLivingCost,123456);
});

test('private conditions and FX notes never appear in validation or unexpected-error responses or logs',async()=>{
 const PRIVATE='PRIVATE_FINANCIAL_NOTE';let forwarded=0;const logs=[];
 const original=console.log;console.log=(...args)=>logs.push(args);
 try{
  const routes=createPlanRoutes({session:async()=>'jwt',forward:async()=>{forwarded++;throw Error(PRIVATE);}});
  const send=plan=>routes.PUT(new Request('https://app.test/api/resolute/plan',{method:'PUT',
   headers:{Origin:'https://app.test','Content-Type':'application/json'},body:JSON.stringify({plan,baseRevision:0})}));
  const valid={...base,noBuyConditions:[PRIVATE],haltConditions:[PRIVATE],fx:{...base.fx,note:PRIVATE}};
  const failed=await send(valid);assert.equal(failed.status,503);assert.equal((await failed.text()).includes(PRIVATE),false);
  const invalid=await send({...valid,answers:{...base.answers,q01:PRIVATE}});assert.equal(invalid.status,400);
  assert.equal((await invalid.text()).includes(PRIVATE),false);
  const malformed=await routes.PUT(new Request('https://app.test/api/resolute/plan',{method:'PUT',
   headers:{Origin:'https://app.test','Content-Type':'application/json'},
   body:Buffer.concat([Buffer.from('{\"invalid\":\"'),Buffer.from([0xff]),Buffer.from('\"}')])}));
  assert.equal(malformed.status,400);assert.equal(forwarded,1);assert.deepEqual(logs,[]);
 }finally{console.log=original;}
});
