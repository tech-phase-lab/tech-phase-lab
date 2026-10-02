import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeResultNews } from '../lib/research/result-news.ts';
import { parseResultBriefs } from '../lib/research/market-results.ts';

// Synthetic reported values exercise attribution; they are not issuer facts.
const brief = {
  id:'1051',researchId:'x-result-1051',kind:'earnings',ticker:'MU',period:'Q4 2026',
  titleJa:'MU Q4 2026決算：売上高$54.23B',titleEn:'MU Q4 2026 earnings: Revenue $54.23B',
  facts:[{key:'revenue',ja:'売上高',en:'Revenue',value:'$54.23B'}],
  url:'https://x.com/wallstengine/status/2105387504291786928',publisher:'Wall St Engine',
  publishedAt:'2026-10-01T00:00:00Z',observedAt:'2026-10-01T00:00:15Z',publicAt:'2026-10-01T00:00:16Z',
  processingMs:1,sourceToDetectionMs:15000,detectionToPublicMs:1000,
};
const update = r => ({ id:r.id,researchId:r.kind==='earnings'?r.researchId:undefined,title:r.titleEn,translationJa:r.titleJa,
  url:r.url,publisher:r.publisher,tickers:[r.ticker],publishedAt:r.publishedAt,observedAt:r.observedAt,
  bodyJa:r.facts.map(f=>`${f.ja}：${f.value}`).join('\n'),bodyEn:r.facts.map(f=>`${f.en}: ${f.value}`).join('\n') });
const second = changes => ({...brief,id:'1052',researchId:'x-result-1052',url:'https://x.com/tipranks/status/12345',publisher:'TipRanks',...changes});
const merge = rows => mergeResultNews(rows.map(update), parseResultBriefs(rows));

test('MU syndicated replay creates one news row with one fact and both original sources',()=>{
  const rows=[brief,second({})], copy=structuredClone(rows);
  const [result]=merge(rows);
  assert.equal(merge(rows).length,1);
  assert.equal(result.sources.length,2);
  assert.deepEqual(new Set(result.sources.map(s=>s.url)),new Set(rows.map(r=>r.url)));
  assert.equal(result.bodyEn.split('\n').length,1);
  assert.match(result.bodyEn,/\$54\.23B/);
  for(const publisher of ['Wall St Engine','TipRanks']) assert.ok(result.bodyEn.includes(publisher));
  assert.deepEqual(rows,copy);
});

test('MU disagreement preserves conflicting numbers with attribution and a neutral headline',()=>{
  const other=second({facts:[{...brief.facts[0],value:'$54.24B'}],publishedAt:'2026-10-01T00:01:00Z'});
  const [result]=merge([brief,other]);
  assert.match(result.title,/source figures differ/);
  assert.match(result.translationJa,/数値の相違/);
  assert.match(result.bodyEn,/Revenue: \$54\.23B \(Wall St Engine\)/);
  assert.match(result.bodyEn,/Revenue: \$54\.24B \(TipRanks\)/);
  assert.equal(result.sources.length,2);
});

test('actual and adjusted earnings/guidance stay distinct without a false disagreement',()=>{
  const other=second({facts:[{key:'eps',ja:'調整後EPS',en:'Adjusted EPS',value:'$4.00'},
    {key:'guidance-revenue',ja:'会社見通し 売上高',en:'Guidance Revenue',value:'$60B'}]});
  const [result]=merge([brief,other]);
  assert.equal(result.bodyEn.split('\n').length,3);
  assert.equal(result.title.includes('figures differ'),false);
});

test('different quarters, days, tickers and corrected releases stay separate',()=>{
  for(const changes of [{period:'Q3 2026'},{publishedAt:'2026-10-02T00:01:00Z'},
    {ticker:'NVDA'},{titleEn:'Corrected MU Q4 2026 earnings'}]) assert.equal(merge([brief,second(changes)]).length,2);
  assert.equal(merge([brief,second({publishedAt:'2026-09-30T20:00:00-04:00'})]).length,1);
});

test('unrelated official stories and periodless posts are never merged by date',()=>{
  const official={...update(brief),id:'333',url:'https://example.test/new-product',researchId:undefined};
  assert.deepEqual(mergeResultNews([official],parseResultBriefs([brief])),[official]);
  assert.equal(merge([ {...brief,period:'Earnings'}, second({period:'Earnings'}) ]).length,2);
});

test('synthetic jobs replay combines equivalent releases, preserving disagreeing attributed values',()=>{
  const jobs={...brief,kind:'economic',ticker:'ECON',period:'SEPTEMBER JOBS REPORT',
    titleJa:'非農業部門雇用者数 +29K',titleEn:'Nonfarm payrolls +29K',
    facts:[{key:'nonfarm-payrolls',ja:'非農業部門雇用者数',en:'Nonfarm payrolls',value:'+29K'}]};
  const other={...jobs,id:'1052',researchId:'x-result-1052',publisher:'TipRanks',url:'https://x.com/tipranks/status/12345',
    facts:[{...jobs.facts[0],value:'+28K'}]};
  const [result]=merge([jobs,other]);
  assert.equal(merge([jobs,other]).length,1);
  assert.match(result.bodyEn,/\+29K \(Wall St Engine\)/);
  assert.match(result.bodyEn,/\+28K \(TipRanks\)/);
  assert.equal(result.researchId,undefined);
  assert.equal(merge([jobs,{...other,period:'OCTOBER JOBS REPORT'}]).length,2);
});

test('duplicate mappings do not duplicate sources or create a spurious merge',()=>{
  assert.deepEqual(mergeResultNews([update(brief),update(brief)],parseResultBriefs([brief])),[update(brief)]);
});

test('the bounded merged payload preserves all160 attributed facts without dropping its body',async()=>{
  const { publicNewsPayload }=await import('../lib/research/general-news.ts');
  const rows=Array.from({length:20},(_,i)=>({...brief,id:String(5000+i),researchId:`x-result-${5000+i}`,
    url:`https://x.com/tipranks/status/${5000+i}`,publisher:`Synthetic source ${i}`.padEnd(80,'x'),
    facts:Array.from({length:8},(_,j)=>({key:'revenue',ja:`合成検証項目${i}-${j}`.padEnd(80,'x'),
      en:`Synthetic metric ${i}-${j}`.padEnd(80,'x'),value:`$${100+i+j}`}))}));
  const resultBriefs=parseResultBriefs(rows), merged=mergeResultNews(rows.map(update),resultBriefs);
  assert.equal(merged.length,1);
  assert.equal(merged[0].bodyEn.split('\n').length,160);
  assert.ok(merged[0].bodyEn.length>12000&&merged[0].bodyEn.length<=40000);
  const feed=publicNewsPayload({ok:true,enabled:false,items:[],resultBriefs,officialUpdates:merged});
  assert.equal(feed.officialUpdates[0].bodyEn,merged[0].bodyEn);
  assert.equal(feed.officialUpdates[0].sources.length,20);
});
