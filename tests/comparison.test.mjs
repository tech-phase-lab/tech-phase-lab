import {buildReviewedTrial} from "../lib/research/comparison-trial.ts";
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFinancials, buildComparison, emptyFinancials, validateComparisonTickers, comparisonAccess } from '../lib/research/comparison.ts';
const now = Date.parse('2026-09-29T00:00:00Z');
const accn = '0000000001-26-000001';
const entry = (val, start='2025-01-01', end='2025-12-31', extra={}) => ({val, start, end, filed:'2026-02-01', accn, form:'10-K', ...extra});
function payload() {return {cik:1,facts:{'us-gaap':{
 RevenueFromContractWithCustomerExcludingAssessedTax:{units:{USD:[entry(120),entry(100,'2024-01-01','2024-12-31')]}},
 OperatingIncomeLoss:{units:{USD:[entry(30)]}},
 NetCashProvidedByUsedInOperatingActivities:{units:{USD:[entry(40)]}},
 PaymentsToAcquirePropertyPlantAndEquipment:{units:{USD:[entry(10)]}},
 CashAndCashEquivalentsAtCarryingValue:{units:{USD:[entry(50,undefined,'2025-12-31',{start:undefined})]}}
}}};}
const parse = p=>extractFinancials('AAA','0000000001',p,now);
const company = (ticker, financials=parse(payload()), peer='compute') => ({...financials,ticker,name:ticker,peer,caution:{ja:'確認',en:'Review'}});
test('select exactly two or three distinct supported tickers; normalize case',()=>{
 assert.deepEqual(validateComparisonTickers([' aaa ','BBB'],['AAA','BBB','CCC']),['AAA','BBB']);
 for(const value of [[],['AAA'],['AAA','AAA'],['AAA','ZZZ'],['AAA','BBB','CCC','DDD'],['AAA',1],null]) assert.equal(validateComparisonTickers(value,['AAA','BBB','CCC','DDD']),null);
});
test('entitlement fails closed for free, signed-out, unavailable and expired members',()=>{
 assert.equal(comparisonAccess({status:'signed-in',plan:'pro',accessExpiresAt:now+1},now),200);
 assert.equal(comparisonAccess({status:'signed-in',plan:'pro',accessExpiresAt:now},now),403);
 assert.equal(comparisonAccess({status:'signed-in',plan:'pro'},now),403);
 assert.equal(comparisonAccess({status:'signed-in',plan:'free',accessExpiresAt:now+1},now),403);
 assert.equal(comparisonAccess({status:'signed-out',plan:'pro'},now),401);
 assert.equal(comparisonAccess({status:'unavailable',plan:'pro'},now),503);
});
test('annual same-filing values produce growth, margin and simple FCF with provenance',()=>{
 const r=parse(payload()); assert.equal(r.status,'ready'); assert.ok(Math.abs(r.revenueGrowth-20)<1e-8);
 assert.equal(r.operatingMargin,25); assert.equal(r.fcfMargin,25); assert.equal(r.cash.value,50);
 assert.equal(r.previousRevenue.accession,r.revenue.accession); assert.match(r.sourceUrl,/0000000001-26-000001-index.htm$/);
});
test('ignore future filings, quarterly/YTD values, and other companies',()=>{
 const p=payload(); const a=p.facts['us-gaap'].RevenueFromContractWithCustomerExcludingAssessedTax.units.USD;
 a.push(entry(999,'2026-01-01','2026-06-30',{form:'10-Q',filed:'2026-07-01'}));
 a.push(entry(999,'2026-01-01','2026-12-31',{filed:'2027-02-01'}));
 assert.equal(parse(p).revenue.value,120); p.cik=2;assert.equal(parse(p).status,'unsupported');
});
test('restatement does not combine prior-year values from another filing',()=>{
 const p=payload();p.facts['us-gaap'].RevenueFromContractWithCustomerExcludingAssessedTax.units.USD[1].accn='0000000001-25-000001';
 assert.equal(parse(p).revenueGrowth,null);
});
test('currency ambiguity and conflicting revenue tags hold the comparison',()=>{
 let p=payload();p.facts['us-gaap'].RevenueFromContractWithCustomerExcludingAssessedTax.units.EUR=[entry(80)];assert.equal(parse(p).status,'unsupported');
 p=payload();p.facts['us-gaap'].Revenues={units:{USD:[entry(119)]}};assert.equal(parse(p).status,'unsupported');
});
test('missing, differently dated or negative capex is not treated as zero',()=>{
 const p=payload();delete p.facts['us-gaap'].PaymentsToAcquirePropertyPlantAndEquipment;assert.equal(parse(p).fcfMargin,null);
 p.facts['us-gaap'].PaymentsToAcquirePropertyPlantAndEquipment={units:{USD:[entry(-10)]}};assert.equal(parse(p).fcfMargin,null);
 p.facts['us-gaap'].OperatingIncomeLoss.units.USD[0].start='2025-02-01';assert.equal(parse(p).operatingMargin,null);
});
test('no winner when third company is unavailable, periods stale, or business differs',()=>{
 const a=company('AAA'),b=company('BBB');
 for(const companies of [[a,b,company('CCC',emptyFinancials('CCC','unavailable'))],[a,company('CCC',parse(payload()),'cloud')],[{...a,revenue:{...a.revenue,end:'2023-12-31'}},b]]) {
  const r=buildComparison(companies,now);assert.equal(r.comparable,false);assert.ok(r.reasons.length);assert.doesNotMatch(r.conclusion.en,/highest/);
 }
});
test('relative annual growth conclusion never labels a stock cheap or a buy',()=>{
 const a=company('AAA');const b=company('BBB');a.revenueGrowth=30;
 const r=buildComparison([a,b],now);assert.equal(r.comparable,true);assert.match(r.conclusion.en,/AAA.*highest reported annual/);assert.match(r.conclusion.en,/not a ranking of future growth or value/);
});

test('actual API rejects non-PRO before fetching data, validates selection, and rechecks expiry',async()=>{
 const {readFileSync}=await import('node:fs');const {stripTypeScriptTypes}=await import('node:module');
 globalThis.__comparisonTest={member:{status:'signed-out',plan:'free'},calls:0,catalog:[company('AAA'),company('BBB'),company('CCC')],buildReviewedTrial,buildComparison,comparisonAccess,validateComparisonTickers,load:async ticker=>{globalThis.__comparisonTest.calls++;return parse(payload());}};
 const source=readFileSync(new URL('../app/api/research/compare/route.ts',import.meta.url),'utf8')
  .replace('import { buildReviewedTrial } from "@/lib/research/comparison-trial";','const {buildReviewedTrial}=globalThis.__comparisonTest;')
  .replace('import { getMembership } from "@/lib/membership/server";','const getMembership=async()=>globalThis.__comparisonTest.member;')
  .replace('import { comparisonCatalog } from "@/lib/research/comparison-catalog";','const comparisonCatalog=globalThis.__comparisonTest.catalog;')
  .replace('import { buildComparison, comparisonAccess, validateComparisonTickers } from "@/lib/research/comparison";','const {buildComparison,comparisonAccess,validateComparisonTickers}=globalThis.__comparisonTest;')
  .replace('import { loadComparisonFinancials, resolveComparisonCompany } from "@/lib/research/comparison-server";','const loadComparisonFinancials=(ticker)=>globalThis.__comparisonTest.load(ticker); const resolveComparisonCompany=async ticker=>globalThis.__comparisonTest.catalog.find(c=>c.ticker===ticker) || null;');
 try {
  const {GET}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
  const request=new Request('https://example.com/api/research/compare?tickers=AAA,BBB');
  for(const [member,status] of [[{status:'signed-out',plan:'free'},401],[{status:'signed-in',plan:'free'},403],[{status:'signed-in',plan:'pro',accessExpiresAt:Date.now()-1},403],[{status:'unavailable',plan:'free'},503]]){
   globalThis.__comparisonTest.member=member; const response=await GET(request);assert.equal(response.status,status);assert.equal((await response.json()).result,undefined);assert.equal(globalThis.__comparisonTest.calls,0);assert.equal((await GET(new Request("https://example.com/api/research/compare?tickers=MU,SNDK&trial=mu-sndk-20261004"))).status,status);
  }
  globalThis.__comparisonTest.member={status:'signed-in',plan:'pro',accessExpiresAt:Date.now()+30000};
  assert.equal((await GET(new Request('https://example.com/api/research/compare?tickers=AAA,AAA'))).status,400);
  assert.equal((await GET(new Request('https://example.com/api/research/compare?tickers=AAA,UNKNOWN'))).status,400);
  const trialResponse=await GET(new Request("https://example.com/api/research/compare?tickers=MU,SNDK&trial=mu-sndk-20261004"));assert.equal(trialResponse.status,200);assert.equal((await trialResponse.json()).result.companies[0].referenceEvaluation.factors.length,7);
  globalThis.__comparisonTest.catalog.push(company('EXTRA'));
  assert.equal((await GET(new Request('https://example.com/api/research/compare?tickers=AAA,EXTRA'))).status,200);
  const response=await GET(request);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);assert.equal(response.headers.get('vary'),'Cookie');assert.equal((await response.json()).result.companies.length,2);
  globalThis.__comparisonTest.load=async()=>{globalThis.__comparisonTest.member.accessExpiresAt=Date.now()-1;return parse(payload());};
  assert.equal((await GET(request)).status,403);
 } finally {delete globalThis.__comparisonTest;}
});


test('comparison endpoint runs through the verified Clerk middleware',async()=>{
 const {readFileSync}=await import('node:fs');
 const proxy=readFileSync(new URL('../proxy.ts',import.meta.url),'utf8');
 assert.match(proxy,/"\/api\/research\/compare"/);
});

test('standalone quarter excludes YTD and uses same-filing prior-year comparison',()=>{
 const p=payload(), f=p.facts['us-gaap'];
 const q=(v,start,end)=>entry(v,start,end,{form:'10-Q',filed:'2026-08-01',accn:'0000000001-26-000002'});
 f.RevenueFromContractWithCustomerExcludingAssessedTax.units.USD.push(q(50,'2026-04-01','2026-06-30'),q(40,'2025-04-01','2025-06-30'),q(90,'2026-01-01','2026-06-30'));
 f.OperatingIncomeLoss.units.USD.push(q(10,'2026-04-01','2026-06-30'),q(15,'2026-01-01','2026-06-30'));
 const r=parse(p);assert.equal(r.quarterRevenue.value,50);assert.equal(r.quarterRevenueGrowth,25);assert.equal(r.quarterOperatingMargin,20);assert.match(r.quarterSourceUrl,/0000000001-26-000002/);
 f.RevenueFromContractWithCustomerExcludingAssessedTax.units.USD.at(-2).accn='0000000001-25-000002';assert.equal(parse(p).quarterRevenueGrowth,null);
});
test('no quarter invented from cumulative, old, future or conflicting reports',()=>{
 const p=payload(),f=p.facts['us-gaap'];const a=f.RevenueFromContractWithCustomerExcludingAssessedTax.units.USD;
 a.push(entry(90,'2026-01-01','2026-06-30',{form:'10-Q',filed:'2026-08-01'}));assert.equal(parse(p).quarterRevenue,null);
 a.push(entry(20,'2025-04-01','2025-06-30',{form:'10-Q',filed:'2025-08-01'}));assert.equal(parse(p).quarterRevenue,null);
 a.push(entry(50,'2026-07-01','2026-09-30',{form:'10-Q',filed:'2026-11-01'}));assert.equal(parse(p).quarterRevenue,null);
 a.push(entry(50,'2026-04-01','2026-06-30',{form:'10-Q',filed:'2026-08-01'}));
 f.Revenues={units:{USD:[entry(51,'2026-04-01','2026-06-30',{form:'10-Q',filed:'2026-08-01'})]}};assert.equal(parse(p).quarterRevenue,null);
});
test('share compensation and diluted shares retain units, period and split-restated same-filing provenance',()=>{
 const p=payload(),f=p.facts['us-gaap'];f.ShareBasedCompensation={units:{USD:[entry(12)]}};
 f.WeightedAverageNumberOfDilutedSharesOutstanding={units:{shares:[entry(110),entry(100,'2024-01-01','2024-12-31')]}};
 let r=parse(p);assert.equal(r.stockCompensationRatio,10);assert.ok(Math.abs(r.dilutedSharesGrowth-10)<1e-8);assert.equal(r.dilutedShares.unit,'shares');
 f.WeightedAverageNumberOfDilutedSharesOutstanding.units.shares[1].accn='0000000001-25-000001';assert.equal(parse(p).dilutedSharesGrowth,null);
 f.ShareBasedCompensation.units.USD[0].start='2025-02-01';assert.equal(parse(p).stockCompensationRatio,null);
 f.WeightedAverageNumberOfDilutedSharesOutstanding.units.shares[0].val=0;assert.equal(parse(p).dilutedShares,null);
});

test('balance snapshot uses the same latest quarter filing and never fills missing debt from annual data',()=>{
 const p=payload(),f=p.facts['us-gaap'];
 const extra={form:'10-Q',filed:'2026-08-01',accn:'0000000001-26-000002'};
 f.RevenueFromContractWithCustomerExcludingAssessedTax.units.USD.push(entry(50,'2026-04-01','2026-06-30',extra));
 const instant=v=>entry(v,undefined,'2026-06-30',{...extra,start:undefined});
 f.AssetsCurrent={units:{USD:[instant(80)]}};f.LiabilitiesCurrent={units:{USD:[instant(100)]}};
 f.LongTermDebtCurrent={units:{USD:[entry(12,undefined,'2025-12-31',{start:undefined})]}};
 f.LongTermDebtNoncurrent={units:{USD:[instant(50)]}};
 let r=parse(p);assert.equal(r.balance.end,'2026-06-30');assert.equal(r.balance.currentRatio,.8);assert.equal(r.balance.cash,null);assert.equal(r.balance.debtCurrent,null);assert.equal(r.balance.debtNoncurrent.value,50);assert.equal(r.balance.shortBorrowings,null);assert.match(r.balance.sourceUrl,/0000000001-26-000002/);
 f.LiabilitiesCurrent.units.USD[0].val=0;assert.equal(parse(p).balance.currentRatio,null);
});
test('balance values reject currency, period, negative and conflicting values; explicit zero is retained',()=>{
 const p=payload(),f=p.facts['us-gaap'];const instant=v=>entry(v,undefined,'2025-12-31',{start:undefined});
 f.AssetsCurrent={units:{EUR:[instant(100)]}};f.LiabilitiesCurrent={units:{USD:[entry(20)]}};
 f.LongTermDebtCurrent={units:{USD:[instant(-3)]}};f.ShortTermBorrowings={units:{USD:[instant(0)]}};
 f.OperatingLeaseLiabilityCurrent={units:{USD:[instant(5),instant(6)]}};
 const b=parse(p).balance;assert.equal(b.currentAssets,null);assert.equal(b.currentLiabilities,null);assert.equal(b.currentRatio,null);assert.equal(b.debtCurrent,null);assert.equal(b.shortBorrowings.value,0);assert.equal(b.leaseCurrent,null);
});
