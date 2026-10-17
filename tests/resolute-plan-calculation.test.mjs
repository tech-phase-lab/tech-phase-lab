import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatePlanAmounts,assertPlanCalculatedAmounts,PlanCalculationError} from '../lib/resolute/plan-calculation.ts';

const normal={currency:'JPY',monthlyLivingCost:250000,reserveMonths:6,nearTermExpense:2000000,
 financialAssets:10000000,investedAmount:3000000,tolerancePct:20,buyBudgetPct:10};

test('agreed JPY examples distinguish unknown assets, unknown investments and zero investable funds',()=>{
 assert.deepEqual(calculatePlanAmounts(normal),{reserve:1500000,investable:6500000,investBase:3000000,
  toleranceDrop:600000,toleranceMonths:2.4,buyBudget:300000});
 assert.deepEqual(calculatePlanAmounts({...normal,financialAssets:null}),{reserve:1500000,investable:null,
  investBase:3000000,toleranceDrop:600000,toleranceMonths:2.4,buyBudget:300000});
 assert.deepEqual(calculatePlanAmounts({...normal,financialAssets:null,investedAmount:null}),{reserve:1500000,
  investable:null,investBase:null,toleranceDrop:null,toleranceMonths:null,buyBudget:null});
 assert.deepEqual(calculatePlanAmounts({...normal,financialAssets:3000000,investedAmount:null}),{reserve:1500000,
  investable:0,investBase:0,toleranceDrop:0,toleranceMonths:0,buyBudget:0});
});

test('decimal months and percentages are floored exactly, including binary floating-point boundaries',()=>{
 const result=calculatePlanAmounts({...normal,monthlyLivingCost:1450,reserveMonths:0.7,investedAmount:1000,
  tolerancePct:16.4,buyBudgetPct:16.4});
 assert.equal(result.reserve,1015);assert.equal(result.toleranceDrop,164);assert.equal(result.buyBudget,164);
 assert.equal(result.toleranceMonths,0.1);
 const maximum=calculatePlanAmounts({...normal,monthlyLivingCost:1e12,reserveMonths:120,financialAssets:1e12,
  nearTermExpense:1e12,investedAmount:1e12,tolerancePct:99.9,buyBudgetPct:100});
 assert.equal(maximum.reserve,120e12);assert.equal(maximum.investable,0);
 assert.equal(maximum.toleranceDrop,999000000000);assert.equal(maximum.buyBudget,1e12);
});

test('USD uses integer cents and floors fractional cents without conversion to yen',()=>{
 const result=calculatePlanAmounts({...normal,currency:'USD',monthlyLivingCost:12505,reserveMonths:2.5,
  nearTermExpense:0,financialAssets:100000,investedAmount:0,tolerancePct:2.5,buyBudgetPct:2.5});
 assert.equal(result.reserve,31262);assert.equal(result.investable,68738);
 assert.equal(result.toleranceDrop,1718);assert.equal(result.buyBudget,1718);
});

test('zero living cost hides month display; null percentages stay unknown and zero investments fall back',()=>{
 const result=calculatePlanAmounts({...normal,monthlyLivingCost:0,nearTermExpense:0,investedAmount:0,
  tolerancePct:0,buyBudgetPct:null});
 assert.equal(result.investBase,10000000);assert.equal(result.toleranceDrop,0);
 assert.equal(result.toleranceMonths,null);assert.equal(result.buyBudget,null);
 assert.equal(calculatePlanAmounts({...normal,financialAssets:null,investedAmount:0}).investBase,null);
 assert.equal(calculatePlanAmounts({...normal,tolerancePct:null}).toleranceDrop,null);
});

test('invalid money, precision, ranges and extra fields are rejected without private input in errors',()=>{
 for(const patch of [{currency:'EUR'},{monthlyLivingCost:0.1},{currency:'USD',investedAmount:0.5},
  {financialAssets:1e12+1},{nearTermExpense:-1},{financialAssets:NaN},{investedAmount:Infinity},
  {reserveMonths:120.1},{reserveMonths:0.01},{tolerancePct:100.1},{buyBudgetPct:0.01},
  {financialAssets:undefined},{answers:{secret:'PRIVATE'}}]){
  assert.throws(()=>calculatePlanAmounts({...normal,...patch}),e=>e instanceof PlanCalculationError &&
   e.code==='INVALID_CALCULATION_INPUT' && !e.message.includes('PRIVATE'));
 }
 for(const value of [null,[],{},'PRIVATE']) assert.throws(()=>calculatePlanAmounts(value),PlanCalculationError);
});

test('future server verification rejects tampered or missing derived amounts and preserves nulls',()=>{
 assert.equal(assertPlanCalculatedAmounts(normal,{investable:6500000,toleranceDrop:600000}).investBase,3000000);
 for(const claim of [{investable:6500001,toleranceDrop:600000},{investable:6500000,toleranceDrop:600001},
  {investable:6500000},null,{investable:6500000,toleranceDrop:600000,answers:'PRIVATE'}])
  assert.throws(()=>assertPlanCalculatedAmounts(normal,claim),e=>e.code==='CALCULATED_AMOUNTS_MISMATCH');
 const unknown={...normal,financialAssets:null,investedAmount:null};
 assert.equal(assertPlanCalculatedAmounts(unknown,{investable:null,toleranceDrop:null}).buyBudget,null);
 assert.throws(()=>assertPlanCalculatedAmounts(unknown,{investable:0,toleranceDrop:0}),PlanCalculationError);
});
