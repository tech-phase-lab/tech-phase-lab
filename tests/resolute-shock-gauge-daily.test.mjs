import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {prepareDailyReview,selectDailyCandidates} from '../services/resolute-api/rizel-daily-review.mjs';
import {validateGeneration,japaneseCopyText} from '../services/resolute-api/risk-job.mjs';
import {isDailyRunHour,latestRiskDate,dailyRunStart,SUMMARY_QUESTION} from '../lib/resolute/risk.ts';
import {RISK_POLICY} from '../lib/resolute/risk-policy.ts';

// Owner, Nov 21: run the Shock Gauge every weekday morning. The run waits for the thermometer (about 08:00 JST), so a story
// from the previous U.S. session gets its stars in the same run instead of "waiting for the market" for a day.
const now=new Date('2026-10-14T23:20:00Z'); // Thursday 08:20 JST
const body='AI semiconductor companies warned of possible earnings declines over several months. The reported risk affects the sector, and the company said revenue would be $5 billion.';
const item=(n,publishedAt,extra={})=>({title:`AI semiconductor risk warning ${n}`,url:`https://example.com/news-${n}`,publishedAt,bodyEn:body,...extra});
const moves={'2026-10-14':{sox:{previousDate:'2026-10-13',changePercent:-3.2,typicalPercent:1.6,up:4,down:36,total:40},nas100:{previousDate:'2026-10-13',changePercent:-1.1,typicalPercent:0.7,up:40,down:60,total:100},fear:{level:24,previousLevel:22}}};
// Nov 25: the index follows the headline's scope, and one story per index and close / per company is kept.
const titled=(n,publishedAt,title)=>({...item(n,publishedAt),title:`${title} ${n}`});
const TITLES={market:'Nasdaq slides as Treasury yields jump',semisA:'Chip stocks drop after export rules tighten',semisB:'Semiconductor stocks fall as memory prices weaken',semisC:'Chipmakers tumble on AI order delays'};

test('the morning run is 08:00 JST on weekdays, after the thermometer stores the previous close',()=>{
 assert.equal(RISK_POLICY.runHourJst,8);
 assert.equal(isDailyRunHour(now),true);
 assert.equal(isDailyRunHour(new Date('2026-10-14T22:20:00Z')),false); // 07:20 JST: before the thermometer
 assert.equal(isDailyRunHour(new Date('2026-10-16T23:20:00Z')),false); // Saturday
 assert.equal(latestRiskDate(new Date('2026-10-14T22:59:00Z')),'2026-10-14');
 assert.equal(latestRiskDate(new Date('2026-10-14T23:00:00Z')),'2026-10-15');
 assert.equal(new Date(dailyRunStart('2026-10-15')).toISOString(),'2026-10-14T23:00:00.000Z');
});

test('Japanese copy: dollar amounts in Japanese units, 「ドル」 not 「米ドル」, nothing right after a closing parenthesis',()=>{
 assert.equal(japaneseCopyText('売上高は$5 billionになると発表しました。',body),'売上高は50億ドルになると発表しました。');
 assert.equal(japaneseCopyText('株価は$120で取引を終えました。','Shares closed at $120.'),'株価は120ドルで取引を終えました。');
 assert.equal(japaneseCopyText('投資額は20米ドルです。','It costs $20.'),'投資額は20ドルです。');
 assert.equal(japaneseCopyText('法案を提出しました（審議中）。次の採決は未定です。','A bill was filed.'),'法案を提出しました（審議中）次の採決は未定です。');
 assert.equal(japaneseCopyText('売上高は$115.8でした。','Revenue was $115.8 billion.'),null,'a lost scale is never shown');
 assert.equal(japaneseCopyText('売上高は115.8 billionドルでした。','Revenue was $115.8 billion.'),'売上高は1,158億ドルでした。');
 assert.equal(japaneseCopyText('出荷は115.8 billion個でした。','It shipped 115.8 billion units.'),null,'no currency: not converted, so not shown');
 assert.equal(japaneseCopyText('売上高は5 bnでした。','Revenue was 5 bn.'),null,'an English scale left in Japanese is never shown');
});

test('a Japanese amount counts as a source figure only when it is the exact unit shift of the source amount',()=>{
 const candidate={id:'a'.repeat(64),url:'https://example.com/a',title:'AI chipmaker warns',body,publishedAt:'2026-10-14T15:00:00.000Z',tickers:[]};
 const copy=(ja)=>({publishable:true,ja:{title:'AI半導体企業が業績悪化を警告',source:'会社発表',content:ja,date:'2026-10-14'},en:{title:'AI chipmaker warns',source:'Company',content:'Revenue would be $5 billion.',date:'2026-10-14'}});
 const ok=validateGeneration(copy('売上高は50億ドルになると発表しました。'),candidate);
 assert.equal(ok.ja.content,'売上高は50億ドルになると発表しました。\n'+SUMMARY_QUESTION.ja);
 assert.equal(validateGeneration(copy('売上高は$5 billionになると発表しました。'),candidate).ja.content,ok.ja.content);
 const why={};
 assert.equal(validateGeneration(copy('売上高は60億ドルになると発表しました。'),candidate,why),null);assert.equal(why.reason,'new-number');
 // The Tokyo calendar date of the same instant is a source date (Nov 20 21:30 UTC is Nov 21 in Tokyo).
 const late={...candidate,publishedAt:'2026-10-14T21:30:00.000Z'},dated=c=>({...copy('売上高は50億ドルになると発表しました。'),ja:{...copy('').ja,content:'売上高は50億ドルになると発表しました。',date:c}});
 assert.ok(validateGeneration(dated('2026年10月15日'),late));
 assert.equal(validateGeneration(dated('2026年10月16日'),late),null);
 assert.equal(validateGeneration({publishable:false},candidate,why),null);assert.equal(why.reason,'not-publishable');
});

test('market-wide first; one story per session (the best explainer holds it); single companies fill what is left',()=>{
 // now = Wed Oct 14 19:20 New York. Owner, Nov 25: only the move AFTER publication counts.
 // 9: chip sector at 09:00 (before the open) → Oct 14 (known). 3 (11:00), 4 (10:00) during hours, 8 (17:40) after → Oct 15.
 // 1, 2, 5: single companies without a measurable ticker (never starred, fill what is left).
 const feed={ok:true,enabled:true,items:[item(1,'2026-10-14T21:30:00Z'),item(2,'2026-10-14T21:20:00Z'),titled(3,'2026-10-14T15:00:00Z',TITLES.semisA),titled(4,'2026-10-14T14:00:00Z',TITLES.market),
  {...item(5,'2026-10-14T21:10:00Z'),title:'Acme warns of AI semiconductor risk 5'},titled(8,'2026-10-14T21:40:00Z',TITLES.semisB),titled(9,'2026-10-14T13:00:00Z',TITLES.semisC)]};
 const limits={stories:3,attempts:5};
 const plain=selectDailyCandidates(feed,now,{limits});
 // Oct 15: market-wide 4 holds the session; chip-sector 3 and 8 on the same session wait in reserve. Oct 14: 9.
 assert.deepEqual(plain.selected.map(c=>c.title.slice(-1)),['4','9','1']);
 assert.deepEqual(plain.reserve.map(c=>c.title.slice(-1)),['8','3','2','5']);
 const ordered=selectDailyCandidates(feed,now,{moves,limits});
 assert.deepEqual(ordered.selected.map(c=>c.title.slice(-1)),['4','9','1']);
 assert.equal(ordered.diagnostics.knownMove,1);assert.equal(ordered.diagnostics.repeated,3);assert.equal(ordered.diagnostics.sessionsHeld,2);
 assert.deepEqual(ordered.diagnostics.scopes,{market:1,semis:3,company:3});
});

async function setup(){const db=new PGlite();await db.exec('CREATE ROLE resolute_rizel_writer');await db.exec(await readFile(new URL('../db/resolute/013_rizel_daily_review.sql',import.meta.url),'utf8'));return db;}
const verified=c=>validateGeneration({publishable:true,ja:{title:'AI半導体企業が業績悪化を警告',source:'会社発表',content:'売上高は50億ドルになると発表しました。',date:'2026-10-14'},en:{title:'AI chipmaker warns',source:'Company',content:'Revenue would be $5 billion.',date:'2026-10-14'}},c);

test('the morning run shows stars from the known session, replaces a rejected story from reserve on the same session, and never exceeds the attempt bound',async()=>{
 const db=await setup(),saved=[],tried=[];let asked=[];
 // 7: chip sector at 06:00 New York (before the open) → Oct 14, known. 2 (market), 3 and 1 (chip sector): Oct 15, waiting.
 const feed={ok:true,enabled:true,items:[titled(1,'2026-10-14T21:30:00Z',TITLES.semisC),titled(2,'2026-10-14T15:00:00Z',TITLES.market),titled(3,'2026-10-14T14:00:00Z',TITLES.semisA),titled(7,'2026-10-14T10:00:00Z',TITLES.semisB),
  {...item(4,'2026-10-14T13:00:00Z'),title:'Acme warns of AI semiconductor risk 4'},{...item(5,'2026-10-14T12:00:00Z'),title:'Globex cuts AI chip outlook 5'}]};
 const publishPool={query:async(sql,args)=>{if(sql.includes('INSERT INTO resolute.risk_days'))saved.push(JSON.parse(args[2]));return {rows:[]};}};
 try{
  const result=await prepareDailyReview({enabled:true,now,selectionPool:db,budgetPool:publishPool,publishPool,readFeed:async()=>feed,
   readMoves:async s=>{asked.push(s);return moves;},
   summarize:async c=>{tried.push(c.title.slice(-1));return c.title.endsWith('2')?null:verified(c);},
   select:async x=>({state:'selected',publication:'withheld',articleId:x.article.id,articleRevision:'r'})});
  assert.equal(result.state,'ready');assert.equal(result.count,3);assert.equal(result.waitingForMarket,1);
  // 2 (market-wide, holds Oct 15) is rejected: Oct 15 goes to the next chip-sector story on it (1), never to a second story.
  assert.deepEqual(tried,['2','7','4','1']);assert.equal(result.diagnostics.attempts,4);
  // The Oct 14 story shows both indices; the stronger (TP半導体40 2.0×, 36/40: ★3) sets its stars. 4 is single-company news.
  assert.deepEqual(saved[0].map(a=>[a.market.index,a.market.session,a.market.reading?.sox?.changePercent??null,a.market.reading?.nas100?.changePercent??null,a.stars]),[['sox','2026-10-14',-3.2,-1.1,3],['company',null,null,null,null],['sox','2026-10-15',null,null,null]]);
  assert.ok(asked.some(s=>s.includes('2026-10-14')));
 }finally{await db.close();}
});

test('every candidate failing the checks still fails the day closed, after at most the bounded number of model calls',async()=>{
 const db=await setup();let calls=0;
 const feed={ok:true,enabled:true,items:[1,2,3,4,5,6,7].map(n=>item(n,`2026-10-14T1${n}:00:00Z`))};
 try{
  await assert.rejects(prepareDailyReview({enabled:true,now,selectionPool:db,readFeed:async()=>feed,summarize:async()=>{calls++;return null;}}),e=>e.message==='PRIVATE_DAILY_REVIEW_FAILED'&&e.code==='NO_VERIFIED_OUTPUT');
  assert.equal(calls,Math.min(feed.items.length,RISK_POLICY.dailyAttempts));
  assert.equal((await db.query('SELECT state FROM resolute_rizel_daily_runs')).rows[0].state,'failed');
 }finally{await db.close();}
});

test('a failed snapshot read only drops the ordering; the day is still checked and saved',async()=>{
 const db=await setup(),saved=[];
 const publishPool={query:async(sql,args)=>{if(sql.includes('INSERT INTO resolute.risk_days'))saved.push(JSON.parse(args[2]));if(sql.includes('FROM resolute.risk_days'))throw Error('db');return {rows:[]};}};
 let reads=0;
 try{
  const result=await prepareDailyReview({enabled:true,now,selectionPool:db,budgetPool:publishPool,publishPool,readFeed:async()=>({ok:true,enabled:true,items:[titled(1,'2026-10-14T21:30:00Z',TITLES.semisA)]}),
   readMoves:async()=>{reads++;if(reads===1)throw Error('down');return {};},summarize:async c=>verified(c),select:async()=>{throw Error('must not select a waiting story');}});
  assert.equal(result.state,'ready');assert.equal(result.waitingForMarket,1);
  assert.equal(result.diagnostics.market.earlierDays,'failed');assert.equal(result.diagnostics.market.ordering,'failed');
  assert.equal(saved[0][0].stars,null);
 }finally{await db.close();}
});

test('a bearish chip-stock headline is a candidate (real Nov 20 example); it is measured on the next session, not on the move before it',()=>{
 // Fri Nov 20 14:33 New York, during regular hours: Friday's −10.4% had mostly happened already. Measured on Mon Nov 23.
 const feed={ok:true,enabled:true,items:[{title:'A massive bearish trade just happened in the chip stocks',url:'https://example.com/chips',publishedAt:'2026-11-20T19:33:31Z',bodyEn:'The biggest options trade of the day was a bearish bet on the SMH. Traders are targeting an additional 8% decline.'}]};
 const friday={'2026-11-20':{sox:{previousDate:'2026-11-19',changePercent:-10.4,typicalPercent:2.11,up:0,down:40,total:40},nas100:{previousDate:'2026-11-19',changePercent:-4.6,typicalPercent:0.88,up:8,down:92,total:100}}};
 const r=selectDailyCandidates(feed,new Date('2026-11-22T23:20:00Z'),{moves:friday});
 assert.equal(r.selected.length,1);assert.equal(r.diagnostics.knownMove,0);assert.deepEqual(r.sessions,['2026-11-23']);
 const monday={'2026-11-23':{sox:{previousDate:'2026-11-20',changePercent:-3,typicalPercent:2.2,up:4,down:36,total:40}}};
 assert.equal(selectDailyCandidates(feed,new Date('2026-11-22T23:20:00Z'),{moves:monday}).diagnostics.knownMove,1);
});
