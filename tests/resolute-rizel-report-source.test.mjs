import test from 'node:test';
import assert from 'node:assert/strict';
import {createReportReader,withReportReader} from '../services/resolute-api/rizel-report-source.mjs';
import {checkIntake} from '../services/resolute-api/rizel-intake-check.mjs';
const token='synthetic-provider-token';
const now=new Date('2026-10-20T00:00:00Z');
const row={title:'AI shares recover during the session',text:'AI shares recovered during the session. Analysts said higher borrowing costs could delay investment in data centers and pressure semiconductor suppliers.',news_url:'https://publisher.example/news/ai-finance',source_name:'Example reporting',date:'Mon, 19 Oct 2026 12:38:00 +0000',tickers:['NVDA']};
const options={enabled:true,token,tickers:'NVDA,NBIS'};
test('reporting source is opt-in, GET-only, bounded and preserves publication and provenance',async()=>{
 let calls=0;
 assert.equal(createReportReader({fetcher:()=>{throw Error('must not fetch');}}),null);
 const reader=createReportReader({...options,fetcher:async(url,init)=>{
  calls++;assert.equal(url.origin,'https://stocknewsapi.com');assert.equal(url.pathname,'/api/v1');
  assert.equal(url.searchParams.get('page'),'1');assert.equal(url.searchParams.get('items'),'100');
  assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
  return Response.json({data:[row]});
 }});
 const result=await reader();assert.equal(calls,1);assert.equal(result.items[0].publishedAt,'2026-10-19T12:38:00.000Z');assert.equal(result.items[0].url,row.news_url);assert.equal(result.items[0].bodyEn,row.text);
 const readOfficial=async()=>({ok:true,enabled:false,items:[{...result.items[0],url:row.news_url+'/disabled',title:'NVIDIA warns of losses'}],officialUpdates:[]});
 const report=await checkIntake({now,readFeed:withReportReader(readOfficial,reader)});
 assert.equal(report.candidateCount,1);assert.equal(report.diagnostics.generalEnabled,false);assert.equal(report.diagnostics.reportCount,1);assert.equal(report.diagnostics.reportConfigured,true);
 assert.equal(report.aiCalls,0);assert.equal(report.writes,0);assert.equal(JSON.stringify(report).includes(token),false);
});
test('bad source configuration and corrupt/unavailable reporting fail closed without leaking query credentials',async()=>{
 for(const patch of [{token:''},{token:'bad token'},{tickers:''},{tickers:'NVDA,https://evil.test'},{tickers:'nvda'}])assert.throws(()=>createReportReader({...options,...patch}));
 for(const response of [Response.json({data:[row]},{status:429}),new Response('not json'),Response.json({error:'bad key'}),Response.json({data:Array(101).fill(row)}),...[
  {date:'Mon, 30 Feb 2026 12:38:00 +0000'}, {date:'2026-10-19'}, {date:'Mon, 19 Oct 2026 12:38:00'}, {news_url:'http://publisher.example/news'}, {news_url:'https://user:pass@publisher.example'}, {text:''}, {tickers:'NVDA'}
 ].map(patch=>Response.json({data:[{...row,...patch}]}))]){
  const reader=createReportReader({...options,fetcher:async()=>response});
  await assert.rejects(reader(),e=>e.message==='REPORT_SOURCE_UNAVAILABLE'&&!e.message.includes(token));
 }
 await assert.rejects(createReportReader({...options,fetcher:async()=>{throw Error('URL includes '+token);}})(),e=>e.message==='REPORT_SOURCE_UNAVAILABLE');
 await assert.rejects(withReportReader(async()=>({ok:true,enabled:false,items:[],officialUpdates:[]}),async()=>{throw Error('unavailable');})());
});
test('full reporting pages expose truncation and unrelated tickers are not admitted',async()=>{
 const full=await createReportReader({...options,fetcher:async()=>Response.json({data:Array(100).fill({...row,tickers:['AAPL']})})})();
 assert.equal(full.possiblyTruncated,true);assert.equal(full.returned,100);assert.deepEqual(full.items,[]);
});
