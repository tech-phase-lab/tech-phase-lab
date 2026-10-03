import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { emptyFinancials } from '../lib/research/comparison.ts';
import { prepareComparisonAnalysis, currentComparisonAnalysis, comparisonEvidenceRevision } from '../lib/research/comparison-analysis.ts';
const now=Date.parse('2026-10-04T01:00:00Z');
const fact={value:120,unit:'USD',start:'2026-04-01',end:'2026-06-30',filed:'2026-08-01',accession:'0000000001-26-000002',tag:'Revenues',basis:'us-gaap'};
const company=(extra={})=>({...emptyFinancials('AAA','unavailable',new Date(now).toISOString()),status:'ready',quarterRevenue:fact,previousQuarterRevenue:{...fact,value:100,start:'2025-04-01',end:'2025-06-30'},quarterOperatingIncome:{...fact,value:30,tag:'OperatingIncomeLoss'},quarterRevenueGrowth:20,quarterOperatingMargin:25,quarterSourceUrl:'https://www.sec.gov/Archives/edgar/data/1/000000000126000002/',...extra});
test('saved bilingual points retain actual figures, signs, period and evidence',()=>{
 const c=company(), p=prepareComparisonAnalysis(c,now);
 assert.equal(p.method,'deterministic');assert.equal(p.periodEnd,fact.end);assert.equal(p.sourceUrl,c.quarterSourceUrl);
 assert.match(p.items[0].short.ja,/\+20.0%/);assert.match(p.items[0].short.en,/\+20.0%/);
 assert.match(p.items[0].detail.ja,/100 USD.*120 USD/);assert.match(p.items[0].detail.en,/100 USD.*120 USD/);
 assert.match(p.items[1].detail.en,/30 USD.*25.0%/);assert.ok(Number.isFinite(p.processingMs));
 assert.deepEqual(currentComparisonAnalysis({...c,preparedAnalysis:p},now),p);
});
test('negative growth, operating losses, negative cash and share-count growth never become strengths',()=>{
 const p=prepareComparisonAnalysis(company({quarterRevenue:{...fact,value:80},quarterRevenueGrowth:-20,quarterOperatingIncome:{...fact,value:-8},quarterOperatingMargin:-10,quarterFcfMargin:-5,quarterDilutedSharesGrowth:12}),now);
 assert.equal(p.items.length,4);assert.ok(p.items.every(i=>i.kind==='weakness'));
 assert.match(p.items[0].short.ja,/-20.0%/);assert.match(p.items[1].detail.en,/-8 USD/);
 assert.match(p.items[2].short.en,/\+12.0%/);assert.match(p.items[3].short.en,/-5.0%/);
});
test('missing, stale, future or superseded quarters cannot acquire prepared points',()=>{
 for(const change of [{quarterRevenue:null},{status:'unavailable'},{quarterSourceUrl:null},{quarterRevenue:{...fact,end:'2025-12-31'}},{quarterRevenue:{...fact,end:'2027-01-01'}},{dataWarnings:[{ja:'',en:'Figures from the newer earnings release are not verified.'}]}]) assert.equal(prepareComparisonAnalysis(company(change),now),undefined);
 assert.ok(!prepareComparisonAnalysis(company({previousQuarterRevenue:null,quarterOperatingIncome:null}),now).items.length);
});
test('revision changes for corrections, currencies, quarters and warnings but not retrieval time',()=>{
 const c=company(), preparedAnalysis=prepareComparisonAnalysis(c,now), saved={...c,preparedAnalysis};
 assert.equal(comparisonEvidenceRevision(c),comparisonEvidenceRevision({...c,retrievedAt:'2026-10-04T02:00Z'}));
 for(const change of [{ticker:'BBB'},{quarterRevenue:{...fact,value:121}},{quarterRevenue:{...fact,unit:'TWD'}},{quarterOperatingMargin:24},{dataWarnings:[{ja:'',en:'New filings could not be checked.'}]}]) assert.equal(currentComparisonAnalysis({...saved,...change},now),undefined);
 assert.equal(currentComparisonAnalysis(saved,Date.parse('2027-04-01')),undefined);
 assert.equal(currentComparisonAnalysis(saved,now-1),undefined);
});
test('actual cached financial loader prepares once per refresh and reuses saved payload',async()=>{
 let loads=0, prepares=0;const cache=new Map();let current=company();
 const state={
  providers:[{ticker:'AAA',supplementalSources:[{cik:'1'}]}],catalog:[],emptyFinancials,
  load:async()=>{loads++;return current;},prepare:c=>{prepares++;return prepareComparisonAnalysis(c,now);},read:c=>currentComparisonAnalysis(c,now),
  cache:fn=>async(...args)=>{const key=JSON.stringify(args);if(!cache.has(key))cache.set(key,await fn(...args));return structuredClone(cache.get(key));},
 };
 globalThis.__preparedComparison=state;
 let source=readFileSync(new URL('../lib/research/comparison-server.ts',import.meta.url),'utf8');
 source=source.replace(/^import .*;\n/gm,'');
 source='const {providers,catalog:comparisonCatalog,emptyFinancials,load:loadSecComparison,prepare:prepareComparisonAnalysis,read:currentComparisonAnalysis,cache:unstable_cache}=globalThis.__preparedComparison; const parseSecDirectory=()=>[];\n'+source;
 try {
  const mod=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
  const a=await mod.loadComparisonFinancials('AAA'), b=await mod.loadComparisonFinancials('AAA');
  assert.equal(loads,1);assert.equal(prepares,1);assert.deepEqual(a.preparedAnalysis,b.preparedAnalysis);
  current=company({quarterRevenue:{...fact,value:130},quarterRevenueGrowth:30});cache.clear();
  const updated=await mod.loadComparisonFinancials('AAA');assert.equal(loads,2);assert.equal(prepares,2);
  assert.notEqual(a.preparedAnalysis.sourceRevision,updated.preparedAnalysis.sourceRevision);assert.match(updated.preparedAnalysis.items[0].short.en,/\+30.0%/);
 } finally {delete globalThis.__preparedComparison;}
});
