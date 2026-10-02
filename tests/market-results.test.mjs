import test from 'node:test';
import assert from 'node:assert/strict';
import {parseResultBriefs,resultEvents} from '../lib/research/market-results.ts';
import {publicNewsPayload} from '../lib/research/general-news.ts';
import {publicEvent} from '../lib/research/access.ts';
import {evidenceIssues} from '../lib/research/quality.ts';
const brief={id:'777',researchId:'x-result-777',kind:'earnings',ticker:'MU',period:'Q4 2026',
 titleJa:'MU決算：売上$54.23B',titleEn:'MU earnings: revenue $54.23B',
 facts:[{key:'revenue',ja:'売上高',en:'Revenue',value:'$54.23B'}],
 url:'https://x.com/wallstengine/status/12345',publisher:'Wall St Engine',
 publishedAt:'2026-10-01T00:00:00Z',observedAt:'2026-10-01T00:00:15Z',publicAt:'2026-10-01T00:00:16Z',
 processingMs:1,sourceToDetectionMs:15000,detectionToPublicMs:1000};
test('automatic factual results make bilingual articles without premium leakage',()=>{
 const [event]=resultEvents(parseResultBriefs([{...brief,privateSource:'SECRET'}]));
 assert.deepEqual(evidenceIssues(event),[]);
 assert.equal(event.summary.ja,brief.titleJa);
 assert.equal(event.summary.en,brief.titleEn);
 assert.deepEqual(publicEvent(event).interpretation,{ja:'',en:''});
 assert.equal(JSON.stringify(event).includes('SECRET'),false);
 for(const changes of [{url:'https://x.com/impostor/status/12345'},{facts:[{...brief.facts[0],value:'BUY NOW'}]},{researchId:'editor-secret'},{publicAt:'bad'}])assert.throws(()=>parseResultBriefs([{...brief,...changes}]));
});
test('macro results are not misrepresented as company earnings',()=>{
 assert.equal(resultEvents(parseResultBriefs([{...brief,kind:'economic',ticker:'ECON'}])).length,0);
});

test('employment result fields survive the public news contract in both languages',()=>{
 const facts=[{key:'nonfarm-payrolls',ja:'非農業部門雇用者数',en:'Nonfarm payrolls',value:'+29K'},
 {key:'unemployment-rate',ja:'失業率',en:'Unemployment rate',value:'4.2%'},
 {key:'hourly-earnings-yoy',ja:'平均時給（前年比）',en:'Average hourly earnings (YoY)',value:'3.0%'}];
 const r={...brief,kind:'economic',ticker:'ECON',period:'SEPTEMBER JOBS REPORT',facts,
 titleJa:'非農業部門雇用者数 +29K／失業率 4.2%／平均時給（前年比） 3.0%',
 titleEn:'Nonfarm payrolls +29K; Unemployment rate 4.2%; Average hourly earnings (YoY) 3.0%'};
 assert.deepEqual(parseResultBriefs([r])[0].facts,facts);
 assert.deepEqual(publicNewsPayload({ok:true,enabled:false,items:[],resultBriefs:[r]}).resultBriefs[0].facts,facts);
});

test('the public news consumer accepts result links only with a matching validated result',()=>{
 const update={id:brief.id,researchId:brief.researchId,title:brief.titleEn,translationJa:brief.titleJa,url:brief.url,publisher:brief.publisher,tickers:['MU'],observedAt:brief.observedAt,publishedAt:brief.publishedAt};
 const payload={ok:true,enabled:false,items:[],resultBriefs:[brief],officialUpdates:[update]};
 assert.equal(publicNewsPayload(payload).officialUpdates[0].researchId,brief.researchId);
 assert.throws(()=>publicNewsPayload({...payload,resultBriefs:[]}));
 assert.throws(()=>publicNewsPayload({...payload,officialUpdates:[{...update,url:'https://x.com/tipranks/status/9876'}]}));
});

test('disagreement retains all attributed posts without blending or hiding figures',()=>{
 const newer={...brief,id:'778',researchId:'x-result-778',publisher:'FabyΔ',url:'https://x.com/fabymetal4/status/12346',
   publishedAt:'2026-10-01T00:01:00Z',titleJa:'MU決算：売上$54.24B',titleEn:'MU earnings: revenue $54.24B',
   facts:[{key:'revenue',ja:'売上高',en:'Revenue',value:'$54.24B'},{key:'eps',ja:'調整後EPS',en:'Adjusted EPS',value:'$-1.21'}]};
 for(const order of [[brief,newer],[newer,brief]]){
   const [event]=resultEvents(parseResultBriefs(order));
   assert.equal(event.id,newer.researchId);
   assert.match(event.summary.ja,/数値の相違/);
   assert.match(event.summary.en,/source figures differ/);
   assert.equal(event.summary.ja.includes('FabyΔ')||event.summary.en.includes('FabyΔ'),false);
   assert.equal(event.sources[0].url,newer.url);
   assert.ok(event.facts.some(f=>f.text.ja.includes('$54.24B')&&f.text.en.includes('$54.24B (FabyΔ)')));
   assert.ok(event.facts.some(f=>f.text.ja.includes('$-1.21')&&f.text.en.includes('$-1.21')));
   assert.ok(event.facts.some(f=>f.text.en.includes('$54.23B')&&f.sourceIds.includes(brief.researchId)));
   assert.deepEqual(event.sources.map(s=>s.id),[newer.researchId,brief.researchId]);
   assert.deepEqual(evidenceIssues(event),[]);
   assert.equal(JSON.stringify(event).includes('確認中'),false);
 }
 assert.throws(()=>parseResultBriefs([{...brief,facts:[]}]));
});


test('identical syndicated earnings consolidate one fact with both sources',()=>{
 const syndicated={...brief,id:'779',researchId:'x-result-779',publisher:'TipRanks',url:'https://x.com/tipranks/status/12349'};
 const events=resultEvents(parseResultBriefs([brief,syndicated]));
 assert.equal(events.length,1);
 assert.equal(events[0].facts.length,1);
 assert.equal(events[0].facts[0].sourceIds.length,2);
 assert.equal(events[0].sources.length,2);
});

test('earnings period/day boundaries preserve genuine later and different-quarter releases',()=>{
 const nextDay={...brief,id:'779',researchId:'x-result-779',publishedAt:'2026-10-02T00:01:00Z',publicAt:'2026-10-02T00:02:00Z'};
 const otherPeriod={...brief,id:'780',researchId:'x-result-780',period:'Q3 2026'};
 assert.equal(resultEvents(parseResultBriefs([brief,nextDay,otherPeriod])).length,3);
 const sameInstant={...brief,id:'781',researchId:'x-result-781',url:'https://x.com/tipranks/status/12348',publishedAt:'2026-09-30T20:00:00-04:00'};
 assert.equal(resultEvents(parseResultBriefs([brief,sameInstant])).length,1);
});
