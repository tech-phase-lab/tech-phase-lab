import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createNewsReader,withSourceRetry} from '../services/resolute-api/rizel-news-source.mjs';
import {createReportReader,withReportReader,REPORT_PAGE_ITEMS,REPORT_UPDATES_LIMIT} from '../services/resolute-api/rizel-report-source.mjs';
import {prepareDailyReview,dailyReviewFailure,selectDailyCandidates,safeErrorCode} from '../services/resolute-api/rizel-daily-review.mjs';
import {inspectCandidateFeed,FEED_LIMITS,FEED_CHECKS} from '../services/resolute-api/risk-job.mjs';

// Nov 12-16: every 07:01 JST run failed at stage "source" in seconds with no retry line. The read succeeded; the intake then
// rejected it because the company lane and the market-wide lane each return a full Stock News page (100 + 100 rows),
// while inspectCandidateFeed still allowed only one page (100) of reportUpdates.
const monitorToken='synthetic-reader-token-for-tests-only-1234';
const providerToken='synthetic-provider-token';
const now=new Date('2026-11-16T23:01:00Z'); // Tuesday 08:01 JST
const roster='NVDA,AMD,MU,TSM,ASML,AVGO,NBIS';
// Newest first, every 20 minutes: a full page reaches about 33 hours back, past the 24-hour weekday window.
const clock=i=>new Date(now.getTime()-(i+1)*20*60000).toUTCString();
// Benign, realistic rows: no downside headline, so the run is a verified quiet day once the feed is accepted.
const companyRow=i=>({title:`Chipmaker shares steady ahead of conference ${i}`,text:'Shares of the company were little changed in morning trading as investors awaited presentations at an industry conference later this week. '.repeat(2),
 news_url:`https://publisher.example/company/${i}`,source_name:'Example Wire',date:clock(i),tickers:[roster.split(',')[i%7]]});
const marketRow=i=>({title:`Markets open mixed as investors await data ${i}`,text:'Major indexes opened mixed on Monday as investors weighed upcoming economic data and corporate results for the remainder of the week. '.repeat(2),
 news_url:`https://publisher.example/market/${i}`,source_name:'Example Markets',date:clock(i)});
const monitorPayload={ok:true,enabled:false,items:[],officialUpdates:[]};

function productionReader({companyRows=REPORT_PAGE_ITEMS,marketRows=REPORT_PAGE_ITEMS}={}){
 const seen=[];
 const news=createNewsReader({origin:'https://monitor.example',token:monitorToken,fetcher:async()=>Response.json(monitorPayload)});
 const reports=createReportReader({enabled:true,token:providerToken,tickers:roster,marketWide:true,fetcher:async url=>{
  seen.push(url.pathname);
  const market=url.pathname==='/api/v1/category';
  return Response.json({data:Array.from({length:market?marketRows:companyRows},(_,i)=>market?marketRow(i):companyRow(i))});
 }});
 return {read:withReportReader(news,reports),seen};
}
const quiet=()=>{const lines=[];return {lines,options:{log:line=>lines.push(line),sleep:async()=>{}}};};
async function setup(){const db=new PGlite();await db.exec('CREATE ROLE resolute_rizel_writer');await db.exec(await readFile(new URL('../db/resolute/013_rizel_daily_review.sql',import.meta.url),'utf8'));return db;}

test('two full report lanes are 200 rows: more than the old one-page cap, within the new bound',async()=>{
 const {read,seen}=productionReader();
 const feed=await read();
 assert.deepEqual(seen,['/api/v1','/api/v1/category']);
 assert.equal(feed.reportUpdates.length,200);
 assert.ok(feed.reportUpdates.length>100,'the old reportUpdates cap (100) rejected every normal morning');
 assert.equal(REPORT_UPDATES_LIMIT,200);assert.equal(FEED_LIMITS.reportUpdates,REPORT_UPDATES_LIMIT);
 const {diagnostics}=selectDailyCandidates(feed,now);
 assert.equal(diagnostics.reportCount,200);assert.equal(diagnostics.inspected,200+diagnostics.officialCount);
 assert.equal(diagnostics.reportMarketLane,true);assert.equal(diagnostics.reportPossiblyTruncated,true);
});

test('the morning run with both full lanes completes instead of failing at stage source',async()=>{
 const db=await setup();const {lines,options}=quiet();const saved=[];
 const readFeed=withSourceRetry(productionReader().read,options);
 const publishPool={query:async(sql,params)=>{saved.push(params);return {rows:[]};}};
 try{
  const result=await prepareDailyReview({enabled:true,now,selectionPool:db,readFeed,publishPool});
  assert.equal(result.state,'no-candidates');assert.equal(result.diagnostics.reportCount,200);
  assert.equal(result.diagnostics.coverageComplete,true); // both lanes read and the pages reach back past the window start
  assert.deepEqual(readFeed.stats,{attempts:1,exhausted:false});assert.deepEqual(lines,[]);
  assert.equal((await db.query('SELECT state FROM resolute_rizel_daily_runs')).rows[0].state,'ready');
  assert.equal(saved.length,1);assert.equal(saved[0][1],'ready');
 }finally{await db.close();}
});

test('a feed above the bound still fails closed, and the log line names the check and counts only',async()=>{
 const db=await setup();const {lines,options}=quiet();
 const read=productionReader().read;
 const readFeed=withSourceRetry(async()=>{const feed=await read();return {...feed,reportUpdates:[...feed.reportUpdates,{...feed.reportUpdates[0],url:'https://publisher.example/extra?token=secret-ish'}]};},options);
 try{
  const error=await prepareDailyReview({enabled:true,now,selectionPool:db,readFeed}).catch(e=>e);
  assert.equal(error.message,'PRIVATE_DAILY_REVIEW_FAILED');assert.equal(error.stage,'source');
  assert.deepEqual(lines,[]); // the read succeeded: no retry line, exactly as in production
  const outcome=dailyReviewFailure(error,readFeed.stats);
  assert.equal(outcome.exitCode,1);
  assert.deepEqual(JSON.parse(JSON.stringify(outcome.line)),{event:'RIZEL_DAILY_REVIEW_FAILED',stage:'source',error:'SOURCE_LIMIT',check:'reports-over-limit',
   counts:{generalEnabled:false,generalCount:0,officialCount:outcome.line.counts.officialCount,reportCount:201,reportReturned:200,reportMarketLane:true},limit:200,sourceAttempts:1});
  assert.ok(Number.isSafeInteger(outcome.line.counts.officialCount));
  const text=JSON.stringify(outcome.line);
  for(const secret of [monitorToken,providerToken,'publisher.example','monitor.example','http'])assert.ok(!text.includes(secret));
  assert.equal((await db.query('SELECT state FROM resolute_rizel_daily_runs')).rows[0].state,'failed');
 }finally{await db.close();}
});

test('every shape and size check has its own code',()=>{
 const base={ok:true,enabled:true,items:[],officialUpdates:[]};
 const cases=[[null,'SOURCE_UNAVAILABLE','feed-not-ok'],[{...base,ok:false},'SOURCE_UNAVAILABLE','feed-not-ok'],
  [{...base,enabled:'yes'},'SOURCE_UNAVAILABLE','enabled-not-boolean'],[{...base,items:{}},'SOURCE_UNAVAILABLE','items-not-array'],
  [{...base,items:Array(501).fill(null)},'SOURCE_LIMIT','items-over-limit'],[{...base,reportUpdates:{}},'SOURCE_UNAVAILABLE','reports-not-array'],
  [{...base,reportUpdates:Array(201).fill(null)},'SOURCE_LIMIT','reports-over-limit'],[{...base,officialUpdates:{}},'SOURCE_UNAVAILABLE','official-not-array'],
  [{ok:true,enabled:false,items:[]},'SOURCE_UNAVAILABLE','general-disabled-without-official'],
  [{...base,items:Array(500).fill(null),officialUpdates:Array(400).fill(null),reportUpdates:Array(200).fill(null)},'SOURCE_LIMIT','raw-over-limit']];
 const seen=new Set();
 for(const [feed,message,check] of cases){
  assert.throws(()=>inspectCandidateFeed(feed,now,{allowDateOnly:true}),e=>e.message===message&&e.check===check);seen.add(check);
 }
 assert.deepEqual([...seen].sort(),[...FEED_CHECKS].sort());
 assert.equal(inspectCandidateFeed({...base,reportUpdates:Array(200).fill(null)},now).diagnostics.rejected.partial,200);
});

test('the failure line keeps only allow-listed codes',()=>{
 assert.equal(safeErrorCode(Error('INVALID_CLOCK')),'INVALID_CLOCK');
 assert.equal(safeErrorCode(new TypeError('fetch https://monitor.example/internal?token=x failed')),'UNLISTED:TypeError');
 assert.equal(safeErrorCode({message:'Bearer abc',name:'https://evil.example'}),'UNLISTED:unknown');
 const outcome=dailyReviewFailure(Object.assign(Error('PRIVATE_DAILY_REVIEW_FAILED'),{stage:'source',code:'SELECT * FROM x',check:'made-up',counts:{reportCount:'https://x',extra:1},limit:'1'}),{attempts:1,exhausted:false});
 assert.equal(outcome.line.error,'UNLISTED:Error');assert.equal(outcome.line.check,undefined);assert.equal(outcome.line.limit,undefined);
 assert.equal(outcome.line.counts.reportCount,null);assert.equal('extra' in outcome.line.counts,false);
 const config=dailyReviewFailure(Error('REPORT_SOURCE_CONFIG'),undefined);
 assert.equal(config.line.stage,'configuration');assert.equal(config.line.error,'REPORT_SOURCE_CONFIG');
});
