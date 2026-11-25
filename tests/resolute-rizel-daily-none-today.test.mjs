import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {prepareDailyReview,selectDailyCandidates,dailyReviewFailure} from '../services/resolute-api/rizel-daily-review.mjs';
import {RISK_POLICY} from '../lib/resolute/risk-policy.ts';

// Owner, Nov 23: "nothing qualified today" is a normal day, not a crash. The Nov 23 (JST) run tried five stories, the model
// judged all five outside the brief ('not-publishable'), and the job exited 1, so Railway mailed "deployment crashed".
const now=new Date('2026-10-14T23:20:00Z'); // Thursday 08:20 JST
const body='AI semiconductor companies warned of possible earnings declines over several months. The reported risk affects the sector, and the company said revenue would be $5 billion.';
const item=(n,publishedAt)=>({title:`AI semiconductor risk warning ${n}`,url:`https://example.com/news-${n}`,publishedAt,bodyEn:body});
const seven={ok:true,enabled:true,items:[1,2,3,4,5,6,7].map(n=>item(n,`2026-10-14T1${n}:00:00Z`))};
async function setup(){const db=new PGlite();await db.exec('CREATE ROLE resolute_rizel_writer');await db.exec(await readFile(new URL('../db/resolute/013_rizel_daily_review.sql',import.meta.url),'utf8'));return db;}
const recorder=saved=>({query:async(sql,args)=>{if(sql.includes('INSERT INTO resolute.risk_days'))saved.push({state:args[1],articles:JSON.parse(args[2])});return {rows:[]};}});

test('every tried story judged not-publishable is a quiet day: saved as ready with no stories, exit 0',async()=>{
 const db=await setup(),saved=[];let calls=0;const publishPool=recorder(saved);
 try{
  const result=await prepareDailyReview({enabled:true,now,selectionPool:db,budgetPool:publishPool,publishPool,readFeed:async()=>seven,
   summarize:async(c,pool,at,fetcher,{why})=>{calls++;why.reason='not-publishable';return null;}});
  assert.equal(result.state,'none-today');assert.equal(result.count,0);assert.equal(result.storageVerified,true);
  const bound=Math.min(seven.items.length,RISK_POLICY.dailyAttempts);
  assert.equal(calls,bound);
  assert.deepEqual(result.diagnostics.withheld,{'not-publishable':bound});
  assert.deepEqual(saved,[{state:'ready',articles:[]}],'the app shows 「今日は、気にするニュースはありません」');
  assert.equal((await db.query('SELECT state FROM resolute_rizel_daily_runs')).rows[0].state,'ready');
 }finally{await db.close();}
});

test('a story that qualified but failed the copy checks still fails the day closed and exits 1',async()=>{
 const db=await setup(),saved=[];let calls=0;const publishPool=recorder(saved);
 try{
  let failure;
  await assert.rejects(prepareDailyReview({enabled:true,now,selectionPool:db,budgetPool:publishPool,publishPool,readFeed:async()=>seven,
   summarize:async(c,pool,at,fetcher,{why})=>{calls++;why.reason=calls===3?'new-number':'not-publishable';return null;}}),
   e=>{failure=e;return e.code==='NO_VERIFIED_OUTPUT'&&e.stage==='generation';});
  assert.deepEqual(saved.map(s=>s.state),['failed']);
  assert.equal(dailyReviewFailure(failure).exitCode,1);
 }finally{await db.close();}
});

test('a summarizer that gives no reason is never read as a quiet day',async()=>{
 const db=await setup();
 try{
  await assert.rejects(prepareDailyReview({enabled:true,now,selectionPool:db,readFeed:async()=>seven,summarize:async()=>null}),e=>e.code==='NO_VERIFIED_OUTPUT');
 }finally{await db.close();}
});

test('genuine failures still exit 1: a source that refuses the read, a database error',()=>{
 assert.equal(dailyReviewFailure({stage:'source',code:'REPORT_SOURCE_UNAVAILABLE'},{attempts:1,exhausted:false}).exitCode,1);
 assert.equal(dailyReviewFailure({stage:'storage',code:'UNLISTED:Error'}).exitCode,1);
});

test('known-move ordering looks at every story in the window, not only the newest five (Monday after a weekend)',async()=>{
 const monday=new Date('2026-11-22T23:20:00Z'); // Monday 08:20 JST; Friday Nov 20's close is known
 const weekend=[1,2,3,4,5,6].map(n=>item(`w${n}`,`2026-11-21T1${n}:00:00Z`));
 // Nov 25: one story per index and close, so Friday's two are a market-wide and a chip-sector story.
 const friday=[{...item('f1','2026-11-20T18:00:00Z'),title:'Nasdaq slides as AI semiconductor risk warning spreads f1'},{...item('f2','2026-11-20T17:00:00Z'),title:'Chip stocks drop on AI semiconductor risk warning f2'}];
 const feed={ok:true,enabled:true,items:[...weekend,...friday]};
 const first=selectDailyCandidates(feed,monday);
 assert.ok(first.sessions.includes('2026-11-20'),'Friday stories are read for their close');
 const ordered=selectDailyCandidates(feed,monday,{moves:{'2026-11-20':{sox:{changePercent:-2.1},nas100:{changePercent:-1}}}});
 assert.deepEqual(ordered.selected.slice(0,2).map(c=>c.title.split(' ').pop()),['f1','f2']);
 assert.equal(ordered.diagnostics.knownMove,2);
 const db=await setup();const asked=[];
 try{
  await prepareDailyReview({enabled:true,now:monday,selectionPool:db,readFeed:async()=>feed,readMoves:async s=>{asked.push(...s);return {};},
   summarize:async(c,pool,at,fetcher,{why})=>{why.reason='not-publishable';return null;}});
  assert.ok(asked.includes('2026-11-20'),'the thermometer is asked for Friday\'s close');
 }finally{await db.close();}
});
