import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {prepareDailyReview} from '../services/resolute-api/rizel-daily-review.mjs';
import {RISK_VISUAL_FIXTURE} from '../lib/resolute/risk-preview.ts';
const now=new Date('2026-10-14T22:00:00Z');
const feed={ok:true,enabled:true,items:[{title:'AI semiconductor risk warning',url:'https://example.com/news',publishedAt:'2026-10-14T21:00:00Z',bodyEn:'AI semiconductor companies warned of possible earnings declines over several months. The reported risk affects the sector, but the impact remains uncertain.'}]};
async function setup(){const db=new PGlite();await db.exec('CREATE ROLE resolute_rizel_writer');await db.exec(await readFile(new URL('../db/resolute/013_rizel_daily_review.sql',import.meta.url),'utf8'));return db;}
test('private morning path claims once, passes no inferred evidence, and never writes a public feed',async()=>{
 const db=await setup();let calls=0,reads=0;
 const opts={enabled:true,now,selectionPool:db,budgetPool:{},readFeed:async()=>{reads++;return feed;},
 summarize:async c=>({...RISK_VISUAL_FIXTURE.articles[0],id:c.id,url:c.url,publishedAt:c.publishedAt}),
 select:async x=>{calls++;assert.deepEqual(x.evidence,[]);return {state:'selected',publication:'withheld',articleId:x.article.id,articleRevision:'private-v1'};}};
 try{
  assert.equal((await prepareDailyReview({...opts,enabled:false})).state,'disabled');
  assert.equal((await prepareDailyReview({...opts,now:new Date('2026-10-16T22:00:00Z')})).state,'outside-window');
  assert.equal((await prepareDailyReview({...opts,now:new Date('2026-10-14T21:59:00Z')})).state,'outside-window');
  assert.equal(reads,0);
  const result=await prepareDailyReview(opts);assert.equal(result.state,'ready');assert.equal(result.day,'2026-10-15');assert.equal(result.count,1);assert.equal(result.publication,'withheld');assert.equal(result.storageVerified,true);assert.equal(result.diagnostics.inspected,1);
  assert.equal((await prepareDailyReview(opts)).state,'already-claimed');assert.equal(calls,1);assert.equal(reads,1);
  const row=(await db.query('SELECT * FROM resolute_rizel_daily_runs')).rows[0];assert.equal(row.state,'ready');assert.equal(row.publication,'withheld');assert.equal(row.selection_refs.length,1);
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map(r=>r.tablename);assert.deepEqual(tables,['resolute_rizel_daily_runs']);
 }finally{await db.close();}
});
test('source outage and unsupported summaries fail closed without an automatic paid retry',async()=>{
 for(const unavailable of [true,false]){
  const db=await setup();let calls=0;
  const opts={enabled:true,now,selectionPool:db,readFeed:async()=>unavailable?{ok:false,enabled:false,items:[]}:feed,summarize:async()=>{calls++;return null;}};
  try{await assert.rejects(prepareDailyReview(opts),/PRIVATE_DAILY_REVIEW_FAILED/);assert.equal((await prepareDailyReview(opts)).state,'already-claimed');assert.equal(calls,unavailable?0:1);assert.equal((await db.query('SELECT state FROM resolute_rizel_daily_runs')).rows[0].state,'failed');}finally{await db.close();}
 }
});
test('empty intake is never reported as a generated-news success',async()=>{
 const db=await setup();try{const result=await prepareDailyReview({enabled:true,now,selectionPool:db,readFeed:async()=>({...feed,items:[]})});assert.equal(result.count,0);assert.equal(result.state,'no-candidates');assert.equal(result.storageVerified,true);assert.equal(result.diagnostics.inspected,0);}finally{await db.close();}
});

test('private daily review keeps a source date unchanged and excludes uncertain freshness',async()=>{
 const db=await setup(),seen=[];
 const dateItem={...feed.items[0],publishedAt:undefined,publishedOn:'2026-10-13'};
 try{
 const result=await prepareDailyReview({enabled:true,now,selectionPool:db,readFeed:async()=>({ok:true,enabled:false,items:[],officialUpdates:[dateItem,{...dateItem,url:'https://example.com/old',publishedOn:'2026-10-10'}]}),
 summarize:async c=>{seen.push(c.publishedAt);return {...RISK_VISUAL_FIXTURE.articles[0],id:c.id,url:c.url,publishedAt:c.publishedAt};},
 select:async x=>({state:'selected',publication:'withheld',articleId:x.article.id,articleRevision:'private-date'})});
 assert.deepEqual(seen,[]);assert.equal(result.count,0);assert.equal(result.state,'no-candidates');
 }finally{await db.close();}
});

test('zero output reports coverage and rejection reasons without model calls',async()=>{
 const db=await setup();let calls=0;
 try{
 const result=await prepareDailyReview({enabled:true,now,selectionPool:db,
  readFeed:async()=>({ok:true,enabled:false,items:[],officialUpdates:[
   {...feed.items[0],bodyEn:''},
   {...feed.items[0],title:'NVIDIA announces a new product',url:'https://example.com/positive'},
   {...feed.items[0],title:'AI risk warning',publishedAt:'2020-01-01T00:00:00Z',url:'https://example.com/old'}],analystUpdates:[{},{}]}),
  summarize:async()=>{calls++;throw Error('must not generate');}});
 assert.equal(result.state,'no-candidates');assert.equal(result.storageVerified,true);assert.equal(calls,0);
 assert.equal(result.diagnostics.generalEnabled,false);assert.equal(result.diagnostics.inspected,3);
 assert.equal(result.diagnostics.rejected.body,1);assert.equal(result.diagnostics.rejected.noDownsideHeadline,1);
 assert.equal(result.diagnostics.rejected.date,1);assert.equal(result.diagnostics.unconsumedAnalystCount,2);
 }finally{await db.close();}
});

test('missing or inconsistent saved result cannot be reported as verified',async()=>{
 for(const row of [null,{state:'ready',candidate_count:1,selection_refs:[],publication:'withheld'},
  {state:'ready',candidate_count:0,selection_refs:[],publication:'public'}]){
 const db=await setup();const pool={query:async(sql,args)=>sql.startsWith('SELECT state,candidate_count')?{rows:row?[row]:[]}:db.query(sql,args)};
 try{
 await assert.rejects(prepareDailyReview({enabled:true,now,selectionPool:pool,readFeed:async()=>({...feed,items:[]})}),error=>error.stage==='readback');
 assert.equal((await db.query('SELECT state FROM resolute_rizel_daily_runs')).rows[0].state,'failed');
 }finally{await db.close();}
 }
});

test('delayed previous-JST-day arrivals are excluded before any model or selection call',async()=>{
 const db=await setup();let calls=0;
 try{
 const result=await prepareDailyReview({enabled:true,now,selectionPool:db,readFeed:async()=>({...feed,items:[{...feed.items[0],publishedAt:'2026-10-14T14:59:59Z',observedAt:now.toISOString()}]}),summarize:async()=>{calls++;throw Error('must not generate');}});
 assert.equal(result.state,'no-candidates');assert.equal(calls,0);assert.equal(result.diagnostics.outsideDailyWindow,1);
 assert.equal((await db.query('SELECT candidate_count FROM resolute_rizel_daily_runs')).rows[0].candidate_count,0);
 }finally{await db.close();}
});
test('generated publication timestamp cannot replace the original clock',async()=>{
 const db=await setup();let selections=0;
 try{
 await assert.rejects(prepareDailyReview({enabled:true,now,selectionPool:db,readFeed:async()=>feed,summarize:async c=>({...RISK_VISUAL_FIXTURE.articles[0],id:c.id,url:c.url,publishedAt:now.toISOString()}),select:async()=>{selections++;}}),/PRIVATE_DAILY_REVIEW_FAILED/);
 assert.equal(selections,0);assert.equal((await db.query('SELECT state FROM resolute_rizel_daily_runs')).rows[0].state,'failed');
 }finally{await db.close();}
});
