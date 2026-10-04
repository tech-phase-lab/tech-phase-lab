import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyFinancials} from '../lib/research/comparison.ts';
import {comparisonScores,compositeScore,radarPoint,quarterlyHighlights,quarterlyTakeaway} from '../lib/research/comparison-scorecard.ts';
const now=Date.parse('2026-10-03T13:00Z');
const fact={value:100,unit:'USD',start:'2026-04-01',end:'2026-06-30',filed:'2026-08-01',accession:'0000000001-26-000001',tag:'Revenues',basis:'us-gaap'};
const company=(extra={})=>({...emptyFinancials('AAA','unavailable'),status:'ready',quarterRevenue:fact,quarterRevenueGrowth:20,quarterOperatingMargin:25,...extra});
const score=(c,id)=>comparisonScores(c,now).find(s=>s.id===id).value;
test('seven reference scores use quarterly facts and never fabricate valuation or annual substitutes',()=>{
 const c=company();assert.equal(comparisonScores(c,now).length,7);assert.equal(score(c,'growth'),7);assert.equal(score(c,'profitability'),5);
 assert.equal(score(c,'valuation'),null);assert.equal(score(c,'cash'),null);
 const annual=company({quarterRevenue:null,revenue:fact,revenueGrowth:1000,operatingMargin:100});assert.ok(comparisonScores(annual,now).every(s=>s.value===null));
});
test('signs, outliers, stale quarters and missing current balance remain distinct from unknown scores',()=>{
 assert.equal(score(company({quarterRevenueGrowth:-50}),'growth'),0);assert.equal(score(company({quarterRevenueGrowth:1000}),'growth'),10);
 assert.equal(score(company({quarterOperatingMargin:-30}),'profitability'),0);
 assert.equal(score(company({quarterRevenue:{...fact,end:'2025-12-31'}}),'growth'),null);
 assert.equal(score(company({quarterRevenue:{...fact,end:'2026-12-31'}}),'growth'),null);
 assert.equal(score(company({dataWarnings:[{ja:'',en:'Figures from the quarterly filing for 2026-09-30 are unavailable.'}]}),'growth'),null);
 assert.equal(score(company({balance:{end:'2026-06-30',currentRatio:2,cash:fact,debtCurrent:null,debtNoncurrent:null}}),'financial'),null);
 assert.equal(score(company({balance:{end:'2025-12-31',currentRatio:2,cash:fact,debtCurrent:fact,debtNoncurrent:fact}}),'financial'),null);
});
test('missing price, stability and industry inputs cannot create a composite or a radar zero',()=>{
 const scores=comparisonScores(company(),now);
 assert.equal(score(company(),'momentum'),null);assert.equal(score(company(),'stability'),null);
 assert.equal(compositeScore(scores),null);assert.equal(compositeScore([]),null);
 assert.equal(compositeScore([{value:8},{value:6}]),7);
 assert.equal(radarPoint(null,0,7),null);assert.equal(radarPoint(0,0,7),'150.00,150.00');
 assert.equal(radarPoint(10,0,7),'150.00,60.00');assert.equal(radarPoint(11,0,7),null);
 assert.equal(score(company({quarterFcfMargin:-25}),'cash'),0);
 assert.equal(score(company({fcfMargin:40}),'cash'),null);
});
test('concise strengths and weaknesses do not label losses, negative growth or funding gaps as positives',()=>{
 const h=quarterlyHighlights(company({quarterRevenueGrowth:-10,quarterOperatingMargin:-20,quarterFcfMargin:-10}),'ja',now);
 assert.deepEqual(h.strengths,[]);assert.match(h.weaknesses[0],/売上減少 -10.0%/);assert.match(h.weaknesses[1],/営業赤字/);
 const summary=quarterlyTakeaway([company(),company({ticker:'BBB',quarterRevenueGrowth:40,quarterOperatingMargin:10})],'ja',now);
 assert.match(summary,/売上成長率はBBB/);assert.match(summary,/営業利益率はAAA/);assert.doesNotMatch(summary,/割安|買い/);
});

test('measurements preserve signs and do not expose stale or failed-source data as current', async()=>{
 const {comparisonMetric}=await import('../lib/research/comparison-scorecard.ts');
 assert.equal(comparisonMetric(company({quarterRevenueGrowth:-12.34}),'growth','ja',now),'売上前年比 -12.3%');
 assert.equal(comparisonMetric(company({quarterOperatingMargin:0}),'profitability','en',now),'Operating margin 0.0%');
 assert.equal(comparisonMetric(company({status:'unavailable'}),'growth','ja',now),'最新値未確認');
 assert.ok(comparisonScores(company({status:'unavailable'}),now).every(s=>s.value===null));
 assert.equal(comparisonMetric(company({balance:{end:'2025-12-31',currentRatio:2}}),'financial','en',now),'Required data unavailable');
});
test('empty comparisons and different accounting bases cannot produce a winner',()=>{
 assert.doesNotMatch(quarterlyTakeaway([],'en',now),/leads|close/);
 const result=quarterlyTakeaway([company(),company({ticker:'BBB',quarterRevenue:{...fact,basis:'ifrs-full'},quarterRevenueGrowth:80})],'ja',now);
 assert.match(result,/会計基準/);assert.doesNotMatch(result,/上回/);
});
