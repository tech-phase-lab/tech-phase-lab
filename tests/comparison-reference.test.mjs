import test from 'node:test';
import assert from 'node:assert/strict';
import input from '../fixtures/research/mu-sndk-20261004.json' with {type:'json'};
import {evaluateReference} from '../lib/research/comparison-reference.ts';
import {buildReviewedTrial} from '../lib/research/comparison-trial.ts';
import {comparisonScores} from '../lib/research/comparison-scorecard.ts';
test('reviewed actual dataset has seven factors with unsupported judgments left unscored and correct company-column ordering',()=>{
 const r=buildReviewedTrial(['SNDK','MU']);assert.deepEqual(r.companies.map(c=>c.ticker),['SNDK','MU']);
 for(const c of r.companies){const scores=comparisonScores(c,Date.parse(input.asOf));assert.equal(scores.length,7);assert.equal(scores.filter(s=>s.value===null).length,2);assert.ok(scores.filter(s=>s.value!==null).every(s=>Number.isFinite(s.value)&&s.value>=0&&s.value<10));assert.equal(scores.find(s=>s.id==="valuation").value,null);assert.equal(scores.find(s=>s.id==="stability").value,null);}
 assert.equal(buildReviewedTrial(['MU','MU']),null);assert.equal(buildReviewedTrial(['MU','TSM']),null);
 const mu=r.companies[1];assert.equal(mu.quarterRevenue.value,54229000000);assert.equal(mu.referenceEvaluation.announced,'2026-09-30');assert.equal(mu.quarterRevenue.end,'2026-09-03');assert.equal(mu.preparedAnalysis.method,'reviewed');
});
test('quarter reconciliation, dates and cash-flow definitions remain distinct',()=>{
 const [mu,sndk]=input.companies;
 assert.equal(mu.revenues.reduce((a,b)=>a+b,0),133188);assert.equal(sndk.revenues.reduce((a,b)=>a+b,0),20248);
 assert.equal(mu.operatingIncomes.reduce((a,b)=>a+b,0),99340);assert.equal(sndk.operatingIncomes.reduce((a,b)=>a+b,0),12389);
 assert.equal(mu.operatingCash-mu.capex,32863);assert.equal(sndk.operatingCash-sndk.capex,7083);assert.notEqual(sndk.adjustedFcf,7083);
 const s=evaluateReference(sndk,input.benchmark);assert.match(s.find(x=>x.id==='momentum').metric.ja,/-6.5pt/);
});
test('incomplete evidence cannot silently become a zero or a complete score',()=>{
 const c=input.companies[0];for(const bad of [{cash:NaN},{rev:0},{capex:-1},{operatingIncomes:[1,2]},{historyStart:0},{revenues:[1,2,3,4]}])assert.throws(()=>evaluateReference({...c,...bad},input.benchmark));
 const negative=evaluateReference({...c,prior:c.rev*2},input.benchmark).find(f=>f.id==='growth');assert.ok(negative.value<5);assert.doesNotMatch(negative.metric.ja,/\+-/);
});
