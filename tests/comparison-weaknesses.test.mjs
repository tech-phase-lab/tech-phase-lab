import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyFinancials, comparisonAccess } from '../lib/research/comparison.ts';
import { prepareComparisonAnalysis, currentComparisonAnalysis } from '../lib/research/comparison-analysis.ts';
import { buildSecMarketEvidence } from '../lib/research/sec-market-evidence.ts';
import { appendMarketItems } from '../lib/research/twelve-data-financials.ts';
import { OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID } from '../lib/membership/entitlements.ts';

// Figures from each company's latest SEC filing as read on 2026-11-19 (10-Q, or BTI's half-year 6-K), in millions.
const now=Date.parse('2026-11-19T12:00:00Z');
const filings={
  MO:{start:'2026-07-01',end:'2026-09-30',unit:'USD',basis:'us-gaap',rev:6132,prev:6072,op:3313,fcf:48.9,cash:2697,ca:4798,cl:8290,debt:24061,margins:[54.0,51.3,54.5,46.3]},
  BTI:{start:'2026-01-01',end:'2026-06-30',unit:'GBP',basis:'ifrs-full',rev:12235,prev:12069,op:4266,fcf:26.7,cash:2518,ca:11923,cl:14278,debt:35063,periodMonths:6},
  KO:{start:'2026-07-04',end:'2026-10-02',unit:'USD',basis:'us-gaap',rev:13380,prev:12455,op:4465,fcf:34.0,cash:13454,ca:33326,cl:24209,debt:41546,margins:[33.4,34.9,32.9,23.5]},
  PEP:{start:'2026-06-14',end:'2026-09-05',unit:'USD',basis:'us-gaap',rev:25274,prev:23937,op:4260,fcf:18.5,cash:10675,ca:32559,cl:34529,debt:51881,margins:[16.9,15.0,13.8,8.0]},
  T:{start:'2026-07-01',end:'2026-09-30',unit:'USD',basis:'us-gaap',rev:32322,prev:30709,op:4095,fcf:16.9,cash:10767,ca:52345,cl:60275,debt:150144,margins:[12.7,22.3,18.4,19.9]},
  VZ:{start:'2026-07-01',end:'2026-09-30',unit:'USD',basis:'us-gaap',rev:34313,prev:33821,op:8650,fcf:22.7,cash:4495,ca:41511,cl:66271,debt:142344,margins:[25.2,24.0,23.1,22.0]},
  NVDA:{start:'2026-04-27',end:'2026-07-26',unit:'USD',basis:'us-gaap',rev:96221,prev:46743,op:63733,fcf:22.2,cash:22443,ca:197412,cl:43019,debt:33366,margins:[66.2,64.0,62.0,60.0]},
  AMD:{start:'2026-06-28',end:'2026-09-26',unit:'USD',basis:'us-gaap',rev:13377,prev:9246,op:2832,fcf:4.1,cash:7404,ca:39471,cl:14486,debt:7079,margins:[21.2,10.0,12.0,11.0]},
};
const fact=(f,value,tag,end=f.end,start=null)=>({value:value*1e6,unit:f.unit,start,end,filed:'2026-10-29',accession:'0000000000-26-000001',tag,basis:f.basis});
function company(ticker){
  const f=filings[ticker];
  return {...emptyFinancials(ticker,'unavailable',new Date(now).toISOString()),status:'ready',...(f.periodMonths ? {periodMonths:f.periodMonths} : {}),
    quarterRevenue:fact(f,f.rev,'Revenues',f.end,f.start),previousQuarterRevenue:fact(f,f.prev,'Revenues',`${Number(f.end.slice(0,4))-1}${f.end.slice(4)}`),
    quarterOperatingIncome:fact(f,f.op,'OperatingIncomeLoss',f.end,f.start),quarterRevenueGrowth:(f.rev/f.prev-1)*100,quarterOperatingMargin:f.op/f.rev*100,
    quarterFcfMargin:f.fcf,quarterDilutedSharesGrowth:-1,quarterSourceUrl:'https://www.sec.gov/Archives/edgar/data/1/000000000026000001/',
    quarterMargins:f.margins ? f.margins.map((value,i)=>({periodEnd:`2026-0${9-3*i}-30`,value})) : null,
    balance:{end:f.end,filed:'2026-10-29',sourceUrl:'https://www.sec.gov/',cash:fact(f,f.cash,'CashAndCashEquivalentsAtCarryingValue'),currentAssets:fact(f,f.ca,'AssetsCurrent'),
      currentLiabilities:fact(f,f.cl,'LiabilitiesCurrent'),currentRatio:f.ca/f.cl,debtCurrent:null,debtNoncurrent:null,shortBorrowings:null,leaseCurrent:null,leaseNoncurrent:null,
      debtTotal:{value:f.debt*1e6,source:'total'}}};
}
// The production path for a filing (comparison-server.ts): the filing's points, then the market factors on the same evidence.
function points(ticker){
  const c=company(ticker), evidence=buildSecMarketEvidence(c,undefined,undefined,now);
  const withEvidence=evidence ? {...c,twelveData:evidence} : c;
  const prepared=prepareComparisonAnalysis(withEvidence,now);
  if(prepared && evidence) appendMarketItems(prepared,evidence,c.quarterRevenue.end,c.quarterRevenue.unit,now);
  return {c:withEvidence,prepared,weaknesses:prepared.items.filter(i=>i.kind==='weakness').map(i=>i.short.ja),strengths:prepared.items.filter(i=>i.kind==='strength').map(i=>i.short.ja)};
}

test('MO and BTI: a weak balance read from the filing is a weakness for each, in the existing words',()=>{
  const mo=points('MO'), bti=points('BTI');
  assert.deepEqual(mo.weaknesses,['流動比率 0.58倍','有利子負債が現金を上回る']);
  assert.deepEqual(bti.weaknesses,['流動比率 0.84倍','有利子負債が現金を上回る']);
  const debt=mo.prepared.items.find(i=>i.id==='debt-cash');
  assert.match(debt.detail.ja,/^2026-09-30時点の現金は2697000000 USD、有利子負債は24061000000 USD。/);
  assert.equal(bti.prepared.items.find(i=>i.id==='debt-cash').detail.en.includes('2518000000 GBP versus debt of 35063000000 GBP'),true);
  for(const p of [mo,bti]) assert.equal(p.prepared.items.find(i=>i.id==='financial').detail.ja.startsWith('財務健全性：'),true);
  // The saved points are reused as they are for the same evidence.
  assert.deepEqual(currentComparisonAnalysis({...mo.c,preparedAnalysis:mo.prepared},now).items,mo.prepared.items);
});

test('other pairs: weak balances are flagged, strong ones are strengths, middling ones with more debt than cash say so',()=>{
  assert.deepEqual(points('T').weaknesses,['流動比率 0.87倍','有利子負債が現金を上回る','営業利益率 22.3→12.7%']);
  assert.deepEqual(points('VZ').weaknesses,['流動比率 0.63倍','有利子負債が現金を上回る']);
  // KO 5.1 and PEP 3.4 on financial strength: no score point either way, but debt above cash is said as the provider's figures say it
  // (before, PEP showed no weakness at all); KO keeps its margin decline.
  assert.deepEqual(points('KO').weaknesses,['有利子負債が現金を上回る','営業利益率 34.9→33.4%']);
  assert.deepEqual(points('PEP').weaknesses,['有利子負債が現金を上回る']);
  assert.equal(points('KO').prepared.items.some(i=>i.id==='financial'),false);
  // NVDA 8.4 and AMD 10: a strong balance is a strength, never "debt exceeds cash".
  assert.ok(points('NVDA').strengths.includes('流動比率 4.59倍'));assert.deepEqual(points('NVDA').weaknesses,[]);
  assert.ok(points('AMD').strengths.includes('流動比率 2.72倍'));assert.deepEqual(points('AMD').weaknesses,[]);
});

test('the provider\'s own financial score keeps its point; the filing never adds a second one',()=>{
  const c=company('MO'), evidence=buildSecMarketEvidence(c,undefined,undefined,now);
  const provider={...evidence,statistics:{retrievedAt:new Date(now-3600000).toISOString(),quarterEnd:c.quarterRevenue.end,forwardPE:null,trailingPE:null,currentRatio:0.58,totalCash:2697e6,totalDebt:24061e6,priceToSales:null}};
  const prepared=prepareComparisonAnalysis({...c,twelveData:provider},now);
  appendMarketItems(prepared,provider,c.quarterRevenue.end,c.quarterRevenue.unit,now);
  assert.equal(prepared.items.filter(i=>i.id==='financial').length,1);
  assert.equal(prepared.items.filter(i=>i.id==='debt-cash').length,1);
});

test('unknown debt is never a weakness, and the owner accounts keep the comparison',()=>{
  const c=company('MO');c.balance={...c.balance,debtTotal:null};
  assert.equal(prepareComparisonAnalysis(c,now).items.some(i=>i.id==='financial' || i.id==='debt-cash'),false);
  for(const id of [OWNER_ACCOUNT_ID,PRODUCTION_OWNER_ACCOUNT_ID]) assert.equal(comparisonAccess({status:'signed-in',plan:'free',userId:id,ownerAccount:true},now),200);
});
