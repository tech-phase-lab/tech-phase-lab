import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createReportReader,withReportReader,reportMaxPages,REPORT_PAGE_ITEMS,REPORT_MAX_PAGES_CAP} from '../services/resolute-api/rizel-report-source.mjs';
import {prepareDailyReview,selectDailyCandidates,dailyLimits,candidateScore} from '../services/resolute-api/rizel-daily-review.mjs';
import {validateGeneration,generate,SUMMARY_INSTRUCTIONS,windowHours} from '../services/resolute-api/risk-job.mjs';
import {RISK_POLICY} from '../lib/resolute/risk-policy.ts';

// Nov 24 (JST) run: 294 items inspected, the Stock News read stopped at 200 rows (one page per lane, about four hours of the
// 30-hour window), five attempts all went to the newest stories and all five came back 'not-publishable': "none-today".
const fixture=JSON.parse(await readFile(new URL('./fixtures/resolute-daily-2026-11-24.json',import.meta.url),'utf8'));
const now=new Date(fixture.runAt);
const at=minutes=>new Date(now.getTime()-minutes*60000);
const filler=(lane,i)=>({title:lane==='market'?`Markets open mixed as investors await data ${i}`:`Chipmaker shares steady ahead of conference ${i}`,
 text:'Shares were little changed in morning trading as investors awaited presentations at an industry conference later this week. '.repeat(2),
 news_url:`https://publisher.example/${lane}/filler-${i}`,source_name:'Example Wire',date:at(1+i*2.5).toUTCString(),sentiment:'Neutral',type:'Article',
 ...(lane==='company'?{tickers:[fixture.roster.split(',')[i%7]]}:{})});
const storyRow=s=>({title:s.title,text:s.text,news_url:`https://publisher.example/${s.lane}/${s.key}`,source_name:'Example News',date:at(s.minutesBefore).toUTCString(),
 sentiment:s.sentiment,type:'Article',...(s.lane==='company'?{tickers:s.tickers}:{})});
// 35 hours of rows per lane, newest first (a busy morning: 100 rows cover about four hours).
const rows=lane=>[...Array.from({length:840},(_,i)=>filler(lane,i)),...fixture.stories.filter(s=>s.lane===lane).map(storyRow)]
 .sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
const lanes={company:rows('company'),market:rows('market')};
const kindOf=title=>fixture.stories.find(s=>s.title===title)?.kind??'filler';

function provider({refuseAfter=Infinity}={}){
 const calls=[];
 const fetcher=async url=>{
  const lane=url.pathname==='/api/v1/category'?'market':'company',page=Number(url.searchParams.get('page'));
  calls.push(`${lane}:${page}`);
  if(page>refuseAfter)return Response.json({message:'page limit'},{status:403});
  return Response.json({data:lanes[lane].slice((page-1)*REPORT_PAGE_ITEMS,page*REPORT_PAGE_ITEMS)});
 };
 const reports=createReportReader({enabled:true,token:'synthetic-provider-token',tickers:fixture.roster,marketWide:true,fetcher});
 return {calls,read:withReportReader(async()=>({ok:true,enabled:false,items:[],officialUpdates:[]}),reports)};
}
const since=now.getTime()-windowHours(now)*3600000;
// A stand-in for the model: it withholds opinion pieces and quiet stories, and writes facts-only copy for real downside news.
const judge=(log=[])=>async(c,pool,when,fetcher,{why})=>{
 log.push(c.title);
 if(kindOf(c.title)!=='realistic'){why.reason='not-publishable';return null;}
 const day=c.publishedAt.slice(0,10);
 return validateGeneration({publishable:true,ja:{title:'半導体関連株の下落',source:c.publisher??'報道',content:'関連株の下落を報じました。',date:day},
  en:{title:c.title,source:c.publisher??'Report',content:c.title+'.',date:day}},c,why);
};
async function setup(){const db=new PGlite();await db.exec('CREATE ROLE resolute_rizel_writer');await db.exec(await readFile(new URL('../db/resolute/013_rizel_daily_review.sql',import.meta.url),'utf8'));return db;}
const quietPool=()=>{const saved=[];return {saved,query:async(sql,args)=>{if(sql.includes('INSERT INTO resolute.risk_days'))saved.push({state:args[1],articles:JSON.parse(args[2])});return {rows:[]};}};};
const select=async x=>({state:'selected',publication:'withheld',articleId:x.article.id,articleRevision:'r'});

test('reproduces Nov 24: one page per lane reaches about four hours back, every story tried is withheld, none-today',async()=>{
 const {read,calls}=provider();
 const onePage=async()=>read(); // the old read: no window, one page per lane
 const db=await setup(),pool=quietPool(),tried=[];
 try{
  const result=await prepareDailyReview({enabled:true,now,selectionPool:db,budgetPool:pool,publishPool:pool,readFeed:onePage,
   readMoves:async()=>fixture.moves,summarize:judge(tried),select,limits:{stories:3,attempts:5}});
  assert.deepEqual(calls,['company:1','market:1']);
  assert.equal(result.state,'none-today');assert.equal(result.diagnostics.reportCount,200);
  assert.equal(result.diagnostics.reportPossiblyTruncated,true);assert.equal(result.diagnostics.coverageComplete,false);
  assert.ok(Date.parse(result.diagnostics.reportOldestPublishedAt)>now.getTime()-5*3600000,'only about four of the 30 hours were read');
  assert.deepEqual(result.diagnostics.withheld,{'not-publishable':5});
  assert.ok(tried.every(t=>kindOf(t)==='opinion'));
 }finally{await db.close();}
});

test('the daily read pages back to the window start: the whole 30 hours is covered in about 16 provider calls',async()=>{
 const {read,calls}=provider();
 const feed=await read({since});
 const pages=calls.length;
 assert.ok(pages>=14&&pages<=18,`calls: ${pages}`);
 assert.equal(feed.reportCoverage.possiblyTruncated,false);
 assert.ok(Date.parse(feed.reportCoverage.oldestPublishedAt)<=since);
 const {selected,reserve,diagnostics}=selectDailyCandidates(feed,now,{moves:fixture.moves});
 assert.equal(diagnostics.coverageComplete,true);assert.equal(diagnostics.reportPages,pages);
 const titles=[...selected,...reserve].map(c=>c.title);
 for(const s of fixture.stories.filter(s=>s.kind==='realistic'))assert.ok(titles.includes(s.title),s.key);
 assert.ok(!titles.includes(fixture.stories.find(s=>s.key==='old').title),'outside the window');
});

test('ranking: market-wide news first, then single-company news, opinion pieces last; one story per company',()=>{
 const {selected,reserve,diagnostics}=selectDailyCandidates({ok:true,enabled:false,items:[],officialUpdates:[],reportUpdates:[...lanes.company,...lanes.market].map(r=>({
  title:r.title,bodyEn:r.text,url:r.news_url,publishedAt:new Date(r.date).toISOString(),publisher:r.source_name,tickers:r.tickers??[],lane:r.tickers?'company':'market',
  ...(r.sentiment?{sentiment:r.sentiment.toLowerCase()}:{})})),reportCoverage:{configured:true,marketLane:true}},now,{moves:fixture.moves,limits:{stories:3,attempts:12}});
 assert.ok(diagnostics.knownMove>=4);
 const order=[...selected,...reserve].map(c=>kindOf(c.title));
 const lastReal=order.lastIndexOf('realistic'),firstOpinion=order.indexOf('opinion');
 assert.ok(firstOpinion===-1||lastReal<firstOpinion,order.join(','));
 assert.deepEqual(order.slice(0,3),['realistic','realistic','realistic']);
 // Nov 25: the market-wide story (Nasdaq futures, TP大型株100) leads, then the chip-sector one (memory chip prices, TP半導体40),
 // then single-company news; one story per index and close, one per company.
 assert.deepEqual(selected.map(c=>c.title),['Nasdaq futures drop as Treasury yields jump on inflation worries','Micron cuts production forecast as memory chip prices weaken','Broadcom shares slide after customer delays AI chip orders']);
 assert.deepEqual(diagnostics.scopes,{market:3,semis:2,company:6});
 assert.equal(new Set(selected.map(c=>c.tickers[0]??'market')).size,3);
 // The ASML story has no downside keyword in its headline: the provider's Negative sentiment and the roster admit it.
 assert.ok([...selected,...reserve].some(c=>c.title.startsWith('ASML')));
 assert.ok(candidateScore({title:'3 AI Stocks to Buy as Chip Shares Drop',headlineDownside:true,tickers:['NVDA']})<candidateScore({title:'Micron cuts production forecast',headlineDownside:true,providerNegative:true,tickers:['MU']}));
});

test('the Nov 24 morning, rerun with the fixes, publishes three different stories: market-wide and chip-sector ones with stars on their own index, one company without',async()=>{
 const {read}=provider();
 const db=await setup(),pool=quietPool(),tried=[];
 try{
  const result=await prepareDailyReview({enabled:true,now,selectionPool:db,budgetPool:pool,publishPool:pool,readFeed:read,
   readMoves:async()=>fixture.moves,summarize:judge(tried),select});
  assert.equal(result.state,'ready');assert.equal(result.count,3);assert.equal(result.waitingForMarket,0);assert.equal(result.companyNews,1);
  assert.equal(result.diagnostics.coverageComplete,true);assert.equal(result.diagnostics.attempts,3);
  assert.ok(tried.every(t=>kindOf(t)==='realistic'));
  assert.equal(pool.saved.length,1);assert.equal(pool.saved[0].state,'ready');
  const [market,semis,company]=pool.saved[0].articles;
  assert.deepEqual([market.market,market.stars],[{index:'nas100',session:fixture.knownSession,changePercent:-1.3},2]);
  assert.deepEqual([semis.market,semis.stars],[{index:'sox',session:fixture.knownSession,changePercent:-2.4},2]);
  assert.deepEqual([company.market,company.stars],[{index:'company',session:null,changePercent:null},null]);
 }finally{await db.close();}
});

test('a page the plan refuses ends the paging without failing the day; the lane stays marked as possibly truncated',async()=>{
 const {read,calls}=provider({refuseAfter:3});
 const feed=await read({since});
 assert.deepEqual(calls,['company:1','company:2','company:3','company:4','market:1','market:2','market:3','market:4']);
 assert.equal(feed.reportCoverage.possiblyTruncated,true);
 assert.equal(selectDailyCandidates(feed,now).diagnostics.coverageComplete,false);
 const first=provider({refuseAfter:0});
 await assert.rejects(first.read({since}),e=>e.message==='REPORT_SOURCE_UNAVAILABLE');
});

test('limits are configurable by environment within hard caps',()=>{
 assert.deepEqual(dailyLimits({}),{stories:RISK_POLICY.dailyStories,attempts:RISK_POLICY.dailyAttempts});
 assert.deepEqual(dailyLimits({RESOLUTE_RIZEL_DAILY_ATTEMPTS:'8',RESOLUTE_RIZEL_DAILY_STORIES:'2'}),{stories:2,attempts:8});
 assert.deepEqual(dailyLimits({RESOLUTE_RIZEL_DAILY_ATTEMPTS:'99',RESOLUTE_RIZEL_DAILY_STORIES:'x'}),{stories:RISK_POLICY.dailyStories,attempts:RISK_POLICY.dailyAttempts});
 assert.deepEqual(dailyLimits({RESOLUTE_RIZEL_DAILY_ATTEMPTS:'1',RESOLUTE_RIZEL_DAILY_STORIES:'4'}),{stories:4,attempts:4});
 assert.equal(reportMaxPages(undefined),30);assert.equal(reportMaxPages('12'),12);assert.equal(reportMaxPages('0'),30);assert.equal(reportMaxPages('41'),30);
 assert.throws(()=>createReportReader({enabled:true,token:'t',tickers:'NVDA',maxPages:REPORT_MAX_PAGES_CAP+1}));
});

test('the judge is told what qualifies: a short summary is enough, a reported share fall counts, opinion pieces do not; publisher is passed',async()=>{
 for(const phrase of ['short news summary','that is enough','shares fell','analyst downgrade','export restrictions','stocks to buy','publisher given in the input','too unclear'])assert.ok(SUMMARY_INSTRUCTIONS.includes(phrase),phrase);
 // The non-advisory rules stay.
 for(const phrase of ['Never write: any outlook or prediction','buying or selling timing','Do not add facts, numbers or converted units'])assert.ok(SUMMARY_INSTRUCTIONS.includes(phrase),phrase);
 const env={key:process.env.RESOLUTE_OPENAI_API_KEY,limit:process.env.RESOLUTE_AI_MONTHLY_LIMIT_USD};
 process.env.RESOLUTE_OPENAI_API_KEY='test-key';process.env.RESOLUTE_AI_MONTHLY_LIMIT_USD='2';
 try{
  let sent;
  const fetcher=async(url,init)=>{sent=JSON.parse(init.body);return Response.json({status:'completed',usage:{input_tokens:900,output_tokens:400},
   output:[{content:[{type:'output_text',text:JSON.stringify({publishable:false,ja:{title:'',source:'',content:'',date:''},en:{title:'',source:'',content:'',date:''}})}]}]});};
  const candidate={id:'a'.repeat(64),url:'https://publisher.example/x',title:'Nvidia shares fall 3%',body:'Nvidia shares fell 3% on Monday.',publishedAt:'2026-11-23T17:20:00.000Z',source:'report',publisher:'Example News',tickers:['NVDA']};
  const why={};
  assert.equal(await generate(candidate,{query:async()=>({rows:[{reserved_usd:0.1}]})},now,fetcher,{log:()=>{},why}),null);
  const input=JSON.parse(sent.input);
  assert.equal(input.publisher,'Example News');assert.deepEqual(input.tickers,['NVDA']);assert.equal(why.reason,'not-publishable');
 }finally{for(const [k,v] of [['RESOLUTE_OPENAI_API_KEY',env.key],['RESOLUTE_AI_MONTHLY_LIMIT_USD',env.limit]])if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
