import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createNewsReader,withSourceRetry,SOURCE_RETRY_DELAYS_MS} from '../services/resolute-api/rizel-news-source.mjs';
import {createReportReader} from '../services/resolute-api/rizel-report-source.mjs';
import {prepareDailyReview,dailyReviewFailure} from '../services/resolute-api/rizel-daily-review.mjs';

// Owner, Nov 16: the daily review crashed at 07:01 JST (stage "source") while the research monitor was restarting.
const token='synthetic-reader-token-for-tests-only-1234';
const now=new Date('2026-10-14T22:01:00Z');
const feed={ok:true,enabled:true,items:[]};
const quiet=()=>{const lines=[],waits=[];return {lines,waits,options:{log:line=>lines.push(line),sleep:async ms=>{waits.push(ms);}}};};
const monitorDown=()=>{throw new TypeError('fetch failed');};

test('five attempts over about ten minutes',()=>{
 assert.equal(SOURCE_RETRY_DELAYS_MS.length+1,5);
 assert.equal(SOURCE_RETRY_DELAYS_MS.reduce((a,b)=>a+b,0),10*60000);
});

test('the monitor reader marks network errors, timeouts and 5xx as retryable, and a 4xx or bad body as final',async()=>{
 const reader=fetcher=>createNewsReader({origin:'https://monitor.example',token,fetcher});
 const cases=[[monitorDown,true],[async()=>{throw new DOMException('timed out','TimeoutError');},true],
  [async()=>new Response('bad gateway',{status:502}),true],[async()=>new Response('x',{status:503}),true],
  [async()=>new Response('no',{status:401}),false],[async()=>Response.json({ok:false}),false]];
 for(const [fetcher,retryable] of cases){
  await assert.rejects(reader(fetcher)(),error=>error.message==='SOURCE_UNAVAILABLE'&&error.retryable===retryable);
 }
});

test('the report reader keeps the retryable mark through its own error',async()=>{
 const reader=fetcher=>createReportReader({enabled:true,token:'t'.repeat(20),tickers:'NVDA',fetcher});
 await assert.rejects(reader(monitorDown)(),error=>error.message==='REPORT_SOURCE_UNAVAILABLE'&&error.retryable===true);
 await assert.rejects(reader(async()=>new Response('x',{status:500}))(),error=>error.retryable===true);
 await assert.rejects(reader(async()=>new Response('x',{status:403}))(),error=>error.retryable===false);
});

test('a short monitor restart is retried with backoff and each attempt is logged',async()=>{
 let calls=0;const {lines,waits,options}=quiet();
 const read=withSourceRetry(createNewsReader({origin:'https://monitor.example',token,fetcher:async()=>{
  calls++;if(calls===1)throw new TypeError('fetch failed');if(calls===2)return new Response('x',{status:503});
  return Response.json({ok:true,enabled:false,items:[],officialUpdates:[]});
 }}),options);
 assert.equal((await read()).ok,true);
 assert.deepEqual(read.stats,{attempts:3,exhausted:false});
 assert.deepEqual(waits,[60000,120000]);
 assert.deepEqual(lines.map(l=>[l.event,l.attempt,l.of,l.next]),[['RIZEL_DAILY_REVIEW_SOURCE_RETRY',1,5,'retry'],['RIZEL_DAILY_REVIEW_SOURCE_RETRY',2,5,'retry']]);
 assert.ok(!JSON.stringify(lines).includes(token));
});

test('a final (non-retryable) failure is not retried',async()=>{
 const {waits,options}=quiet();
 const read=withSourceRetry(createNewsReader({origin:'https://monitor.example',token,fetcher:async()=>new Response('x',{status:401})}),options);
 await assert.rejects(read(),/SOURCE_UNAVAILABLE/);
 assert.deepEqual(read.stats,{attempts:1,exhausted:false});assert.deepEqual(waits,[]);
 const outcome=dailyReviewFailure(Object.assign(Error('PRIVATE_DAILY_REVIEW_FAILED'),{stage:'source'}),read.stats);
 assert.equal(outcome.exitCode,1);assert.equal(outcome.line.event,'RIZEL_DAILY_REVIEW_FAILED');assert.equal(outcome.line.stage,'source');
});

async function setup(){const db=new PGlite();await db.exec('CREATE ROLE resolute_rizel_writer');await db.exec(await readFile(new URL('../db/resolute/013_rizel_daily_review.sql',import.meta.url),'utf8'));return db;}

test('the daily review recovers from a monitor restart and publishes as before',async()=>{
 const db=await setup();let calls=0;const {options}=quiet();
 const readFeed=withSourceRetry(async()=>{calls++;if(calls<3)throw Object.assign(Error('SOURCE_UNAVAILABLE'),{retryable:true});return feed;},options);
 try{
  const result=await prepareDailyReview({enabled:true,now,selectionPool:db,readFeed});
  assert.equal(result.state,'no-candidates');assert.equal(readFeed.stats.attempts,3);
  assert.equal((await db.query('SELECT state FROM resolute_rizel_daily_runs')).rows[0].state,'ready');
 }finally{await db.close();}
});

test('after five failed attempts the job records the failed day and exits 0 with source-unavailable-after-retries',async()=>{
 const db=await setup();const {lines,waits,options}=quiet();const saved=[];
 const readFeed=withSourceRetry(createNewsReader({origin:'https://monitor.example',token,fetcher:monitorDown}),options);
 const publishPool={query:async(sql,params)=>{saved.push(params);return {rows:[]};}};
 try{
  const error=await prepareDailyReview({enabled:true,now,selectionPool:db,readFeed,publishPool}).catch(e=>e);
  assert.equal(error.stage,'source');
  assert.deepEqual(readFeed.stats,{attempts:5,exhausted:true});
  assert.deepEqual(waits,SOURCE_RETRY_DELAYS_MS);
  assert.deepEqual(lines.map(l=>l.next),['retry','retry','retry','retry','give-up']);
  // What is stored is unchanged: the day is failed ("couldn't update"), never a quiet day.
  assert.equal((await db.query('SELECT state FROM resolute_rizel_daily_runs')).rows[0].state,'failed');
  assert.deepEqual(dailyReviewFailure(error,readFeed.stats),{exitCode:0,line:{event:'RIZEL_DAILY_REVIEW',state:'source-unavailable-after-retries',sourceAttempts:5}});
 }finally{await db.close();}
});

test('failures after the source stage still exit 1',()=>{
 for(const stage of ['storage','generation','readback',undefined]){
  const outcome=dailyReviewFailure(Object.assign(Error('x'),{stage}),{attempts:1,exhausted:false});
  assert.equal(outcome.exitCode,1);assert.equal(outcome.line.event,'RIZEL_DAILY_REVIEW_FAILED');assert.equal(outcome.line.stage,stage??'configuration');
 }
 assert.equal(dailyReviewFailure(Object.assign(Error('x'),{stage:'generation'}),{attempts:5,exhausted:true}).exitCode,1);
});
