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
  assert.deepEqual(await prepareDailyReview(opts),{state:'ready',day:'2026-10-15',count:1,publication:'withheld'});
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
test('fresh successful empty intake is distinguishable from failure',async()=>{
 const db=await setup();try{assert.equal((await prepareDailyReview({enabled:true,now,selectionPool:db,readFeed:async()=>({...feed,items:[]})})).count,0);}finally{await db.close();}
});
