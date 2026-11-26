import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {prepareDailyReview} from '../services/resolute-api/rizel-daily-review.mjs';
import {validateGeneration} from '../services/resolute-api/risk-job.mjs';
import {judgeDay,judgePool,judgeInput,validateJudgement,marketWraps,ruleJudgement,RULE_REASON,JUDGE_ATTEMPTS} from '../services/resolute-api/shock-judge.mjs';
import {ownerShockMailText,sendOwnerShockMail} from '../services/resolute-api/shock-owner-mail.mjs';
import {parseRiskArticle,parseRiskFeed,readingParts,formatReading,marketStars,storyStars} from '../lib/resolute/risk.ts';
import {duringSession,measureStock} from '../lib/resolute/risk-market.ts';
import {sessionIntraday,stockShock} from '../lib/resolute/thermometer-basket.ts';
import {calculateTemperature,THERMOMETER_VERSIONS} from '../lib/resolute/thermometer.ts';
import {parseStockHistories} from '../lib/resolute/thermometer-provider.ts';
import {PRODUCTION_OWNER_ACCOUNT_ID} from '../lib/membership/entitlements.ts';
import {hash} from '../services/resolute-api/risk-store.mjs';

const W='　';
// The owner's case (Nov 26): NASDAQ-100 fell more than 4.5% intraday and closed about −0.6%. Measured close-to-close only, the
// day read as quiet (TP大型株100 +0.2%, 0.2×) and the story got ★2 from a lasting cause. The intraday extreme now counts.
const S='2026-11-25',PREV='2026-11-24';
const moves={[S]:{nas100:{previousDate:PREV,changePercent:-0.6,typicalPercent:0.76,up:20,down:80,total:100,intraday:{changePercent:-4.6,typicalPercent:0.9,same:80}},
 sox:{previousDate:PREV,changePercent:-1.8,typicalPercent:2.2,up:10,down:30,total:40,intraday:{changePercent:-7.9,typicalPercent:2.6,same:36}},fear:{level:44.8,previousLevel:40},
 stocks:{NVDA:{previousDate:PREV,changePercent:-3.1,typicalPercent:1.9,intradayPercent:-9.4}}}};
const quiet={[S]:{nas100:{previousDate:PREV,changePercent:0.2,typicalPercent:0.76,up:57,down:43,total:100,intraday:{changePercent:-0.5,typicalPercent:0.9,same:10}},
 sox:{previousDate:PREV,changePercent:-0.1,typicalPercent:2.2,up:18,down:22,total:40},fear:{level:40,previousLevel:40}}};
const runAt=new Date('2026-11-25T23:20:00Z'); // Thu Nov 26 08:20 JST
const body=t=>`${t}. The report said the move weighed on technology shares across the session and investors sold chip stocks.`;
const row=(title,publishedAt,{tickers=[],lane='company'}={})=>({title,bodyEn:body(title),url:`https://news.example/${encodeURIComponent(title).slice(0,80)}`,publishedAt,publisher:'Example Wire',tickers,lane,sentiment:'negative'});
const feedOf=items=>({ok:true,enabled:false,items:[],officialUpdates:[],reportUpdates:items,reportCoverage:{configured:true,marketLane:true}});
const ITEMS=[
 row('Stocks tumble as Nvidia downgrade fears hit Wall Street','2026-11-25T13:00:00.000Z',{lane:'market'}), // Wed 08:00 ET → Wed
 row('S&P puts Nvidia AA rating on CreditWatch negative','2026-11-25T15:30:00.000Z',{tickers:['NVDA']}), // Wed 10:30 ET, during
 row('Chip stocks slide as memory prices weaken','2026-11-25T12:00:00.000Z',{tickers:['MU']}), // Wed 07:00 ET → Wed
 row('Stock market today: Dow, S&P 500, Nasdaq claw back from steep intraday losses','2026-11-25T21:10:00.000Z',{lane:'market'}),
];

test('the intraday extreme counts: a −4.6% intraday fall that closed −0.6% is a shock, not a quiet day',()=>{
 const market={index:'nas100',session:S,reading:{from:PREV,nas100:{changePercent:-0.6,multiple:0.8,same:80,total:100,intraday:{changePercent:-4.6,multiple:5.1,same:80}},sox:null,fearChange:12}};
 assert.equal(marketStars(market),5);
 assert.equal(marketStars({...market,reading:{...market.reading,nas100:{...market.reading.nas100,intraday:undefined}}}),1);
 // The card: two lines per index, no parentheses, the fear line on a down day.
 assert.deepEqual(readingParts(market,'ja'),[{text:`TP大型株100${W}−0.6%`,detail:'取引中は −4.6% まで下落'},{text:`恐怖指数${W}+12%`}]);
 // An up day: 「取引中は +x% まで上昇」, and no fear line.
 const up={index:'nas100',session:S,reading:{from:PREV,nas100:{changePercent:1.2,multiple:1.6,same:70,total:100,intraday:{changePercent:3.4,multiple:3.8,same:60}},sox:null,fearChange:9}};
 assert.deepEqual(readingParts(up,'ja'),[{text:`TP大型株100${W}+1.2%`,detail:'取引中は +3.4% まで上昇'}]);
 // Within one point of the close: no second line.
 assert.deepEqual(readingParts({...up,reading:{...up.reading,nas100:{...up.reading.nas100,intraday:{changePercent:2.0,multiple:2.2,same:50}}}},'ja'),[{text:`TP大型株100${W}+1.2%`}]);
 // Single-company: 「NVDA　−3.1%」 with the same second line, then its industry basket.
 const company={index:'company',session:S,company:{ticker:'NVDA',basket:'sox'},reading:{from:PREV,nas100:null,sox:{changePercent:-1.8,multiple:0.8,same:30,total:40,intraday:{changePercent:-7.9,multiple:3,same:36}},fearChange:12,company:measureStock({previousDate:PREV,changePercent:-3.1,typicalPercent:1.9,intradayPercent:-9.4})}};
 assert.deepEqual(formatReading(company,'ja'),[`NVDA${W}−3.1%取引中は −9.4% まで下落`,`TP半導体40${W}−1.8%取引中は −7.9% まで下落`,`恐怖指数${W}+12%`]);
 for(const l of [...readingParts(market,'ja'),...readingParts(company,'ja')])assert.ok(!/[()（）]|倍|社中/.test(l.text+(l.detail??'')),l.text);
});

test('the thermometer measures each basket\'s intraday extreme and each stock\'s own, from the daily bars\' high and low',()=>{
 const {series}=parseStockHistories({AAA:{values:[{datetime:'2026-11-25',close:'99',high:'101',low:'95'},{datetime:'2026-11-24',close:'100',high:'100',low:'100'}]}},['AAA']);
 assert.deepEqual(series.AAA[0],{date:'2026-11-25',close:99,high:101,low:95});
 const dates=[];for(let i=0;i<70;i++)dates.push(new Date(Date.UTC(2026,7,1)+i*86400000).toISOString().slice(0,10));
 const mk=k=>dates.map((date,i)=>{const close=100*(i%2?1.01:1);return i===dates.length-1?{date,close:100,high:100.5,low:95-k*0.1}:{date,close,high:close*1.005,low:close*0.995};});
 const basket={};for(let k=0;k<12;k++)basket['T'+k]=mk(k);
 const levels=dates.map(date=>({date,close:100}));
 const r=sessionIntraday(levels,basket,dates.at(-1));
 assert.equal(r.previousDate,dates.at(-2));assert.ok(r.changePercent<-4&&r.changePercent>-6,String(r.changePercent));assert.ok(r.typicalPercent>0.4&&r.typicalPercent<1.6);assert.equal(r.same,12);assert.equal(r.total,12);
 assert.equal(sessionIntraday(levels,basket,dates[10]),null,'no full window: never guessed');
 const s=stockShock(basket.T0,dates.at(-1));assert.ok(s.intradayPercent<-4);
});

test('the AI judges the day: retried with backoff, then its picks and stars are used; numbers are input only',async()=>{
 const pool=judgePool(ITEMS.map(i=>({...i,id:hash(i.url),body:i.bodyEn,tickers:i.tickers})),moves);
 assert.deepEqual(pool.map(p=>[p.candidate.title.split(' ')[0],p.market.session]),[['Stocks',S],['S&P',S],['Chip',S]]);
 assert.equal(duringSession(new Date('2026-11-25T15:30:00Z')),S);assert.equal(duringSession(new Date('2026-11-25T12:00:00Z')),null);
 const wraps=marketWraps(feedOf(ITEMS),runAt.getTime()-30*3600000,runAt.getTime());
 assert.deepEqual(wraps.map(w=>w.title),['Stock market today: Dow, S&P 500, Nasdaq claw back from steep intraday losses']);
 const input=judgeInput({day:'2026-11-26',pool,wraps});
 assert.equal(input.stories[0].tpLargeCap100.intradayExtremePercent,-4.6);assert.equal(input.stories[0].fearIndexChangePercent,12);
 let calls=0;const sleeps=[];
 const call=async()=>{calls++;if(calls<3)throw Error('MODEL_UNAVAILABLE');return {picks:[{key:'s1',stars:4,reasonJa:'取引中にTP大型株100が-4.6%まで下げた',reasonEn:'The market fell sharply during the day.'},{key:'s2',stars:3,reasonJa:'格付けの見通し引き下げでNVDAが急落',reasonEn:'Nvidia fell after the rating watch.'}]};};
 const j=await judgeDay({day:'2026-11-26',pool,wraps,call,sleep:async ms=>sleeps.push(ms)});
 assert.equal(j.attempts,3);assert.deepEqual(sleeps,[5000,20000]);assert.deepEqual(j.picks.map(p=>[p.candidate.title.split(' ')[0],p.stars]),[['Stocks',4],['S&P',3]]);
 // Every attempt failing: no picks, the caller falls back.
 const failed=await judgeDay({day:'2026-11-26',pool,wraps,call:async()=>{throw Error('MODEL_UNAVAILABLE');},sleep:async()=>{}});
 assert.equal(failed.picks,null);assert.equal(failed.attempts,JUDGE_ATTEMPTS);assert.equal(failed.failure,'MODEL_UNAVAILABLE');
 // Validators: unknown story, a number not in the input, banned wording, a sixth-plus pick.
 assert.equal(validateJudgement({picks:[{key:'s9',stars:3,reasonJa:'下落',reasonEn:'Fell.'}]},input),null);
 assert.equal(validateJudgement({picks:[{key:'s1',stars:3,reasonJa:'-12.3%まで下落',reasonEn:'Fell.'}]},input),null);
 assert.equal(validateJudgement({picks:[{key:'s1',stars:3,reasonJa:'一時的な下げ',reasonEn:'Fell.'}]},input),null);
 assert.equal(validateJudgement({picks:[{key:'s1',stars:6,reasonJa:'下落',reasonEn:'Fell.'}]},input),null);
 // The numeric fallback: the rule's stars with the intraday extreme, a fixed reason.
 // NVDA (1.6× its normal day) fails the two-move test: ★1 under the rule, never hidden.
 assert.deepEqual(ruleJudgement(pool).map(p=>[p.stars,p.reason]),[[5,RULE_REASON],[1,RULE_REASON],[5,RULE_REASON]]);
});

test('no lift: on a day the market did not move, a judged story is stored at ★1 at most; a quiet day still gets stars',()=>{
 const m={index:'nas100',session:S,reading:{from:PREV,nas100:{changePercent:0.2,multiple:0.3,same:57,total:100,intraday:{changePercent:-0.5,multiple:0.6,same:10}},sox:null,fearChange:0}};
 assert.equal(storyStars(m,null,{stars:3,source:'ai',reason:{ja:'x',en:'x'}}),1);
 assert.equal(storyStars(m,{kind:'lasting',ja:'取締役会の懸念',en:'board concerns'},null),1,'a lasting cause never lifts a quiet story');
 const moved={...m,reading:{...m.reading,nas100:{...m.reading.nas100,intraday:{changePercent:-4.6,multiple:5.1,same:80}}}};
 assert.equal(storyStars(moved,null,{stars:3,source:'ai',reason:{ja:'x',en:'x'}}),3);
});

async function setup(){const db=new PGlite();await db.exec('CREATE ROLE resolute_rizel_writer');await db.exec(await readFile(new URL('../db/resolute/013_rizel_daily_review.sql',import.meta.url),'utf8'));return db;}
const copy=c=>validateGeneration({publishable:true,ja:{title:c.title.slice(0,60),source:'Example Wire',content:'ニュースの内容です。',date:'2026年11月25日'},en:{title:c.title.slice(0,90),source:'Example Wire',content:'The news.',date:'November 25, 2026'}},c);
async function run(judge){
 const db=await setup(),saved=[],lines=[];
 const publishPool={query:async(sql,args)=>{if(sql.includes('INSERT INTO resolute.risk_days'))saved.push(JSON.parse(args[2]));return {rows:[]};}};
 try{
  const result=await prepareDailyReview({enabled:true,now:runAt,selectionPool:db,budgetPool:publishPool,publishPool,readFeed:async()=>feedOf(ITEMS),readMoves:async()=>moves,
   summarize:async c=>copy(c),select:async x=>({state:'selected',publication:'withheld',articleId:x.article.id,articleRevision:'r'}),judge,log:l=>lines.push(l)});
  return {result,saved,lines};
 }finally{await db.close();}
}
test('the morning run uses the AI\'s picks and stars; members see them with the card lines',async()=>{
 const judge=async({pool})=>({attempts:1,picks:[{...pool[1],stars:3,reason:{ja:'格付けの見通し引き下げでNVDAが急落',en:'Nvidia fell.'}},{...pool[0],stars:4,reason:{ja:'取引中に大きく下げた',en:'The market fell sharply.'}}]});
 const {result,saved}=await run(judge);
 assert.equal(result.state,'ready');assert.equal(result.diagnostics.judge.source,'ai');
 const feed=parseRiskFeed({state:'ready',date:'2026-11-26',articles:saved[0],quotes:[]});
 assert.deepEqual(feed.articles.map(a=>[a.ja.title.split(' ')[0],a.stars,a.judge.source]),[['S&P',3,'ai'],['Stocks',4,'ai']]);
 assert.deepEqual(formatReading(feed.articles[0].market,'ja'),[`NVDA${W}−3.1%取引中は −9.4% まで下落`,`TP半導体40${W}−1.8%取引中は −7.9% まで下落`,`恐怖指数${W}+12%`]);
});
test('every AI attempt failing: the numeric rule with intraday extremes gives the stars, and it is logged',async()=>{
 const {result,saved,lines}=await run(async()=>({picks:null,attempts:4,failure:'MODEL_UNAVAILABLE'}));
 assert.equal(result.state,'ready');assert.equal(result.diagnostics.judge.source,'rule');
 assert.ok(lines.some(l=>JSON.parse(l).event==='RIZEL_SHOCK_JUDGE_FALLBACK'));
 const articles=saved[0].map(parseRiskArticle);
 assert.ok(articles.length>=1&&articles.every(a=>a.stars>=1&&a.judge.source==='rule'));
});

test('owner mail: off by default; the stories, stars, the AI reason, the card lines, リゼルの一言 and the fallback flag',async()=>{
 const article=parseRiskArticle({id:'a'.repeat(64),url:'https://news.example/a',publishedAt:'2026-11-25T13:00:00.000Z',stars:4,quoteId:'calm',
  market:{index:'nas100',session:S,reading:{from:PREV,nas100:{changePercent:-0.6,multiple:0.8,same:80,total:100,intraday:{changePercent:-4.6,multiple:5.1,same:80}},sox:null,fearChange:12}},
  judge:{stars:4,source:'ai',reason:{ja:'取引中に大きく下げた',en:'Fell sharply.'}},ja:{title:'米国株が取引中に急落',source:'x',content:'本文\nこのニュースで、あなたのルールの条件に当てはまるものはありますか？',date:'2026年11月25日'},en:{title:'Stocks tumble',source:'x',content:'Body\nDoes anything in this news meet a condition in your rules?',date:'November 25, 2026'}});
 const quotes=[{id:'calm',approved:true,ja:{title:'一度大きく揺れた日は、自分のルールを先に確かめます。',reasons:[]},en:{title:'x',reasons:[]}}];
 const text=ownerShockMailText({day:'2026-11-26',articles:[article],quotes,fallback:false});
 for(const s of ['1. 米国株が取引中に急落','★4','判定の理由: 取引中に大きく下げた',`TP大型株100${W}−0.6%`,'  取引中は −4.6% まで下落',`恐怖指数${W}+12%`,'リゼルの一言: 一度大きく揺れた日は、自分のルールを先に確かめます。','AIがその日の市場の動きとニュースを読んで判定しました'])assert.ok(text.includes(s),s);
 assert.ok(ownerShockMailText({day:'2026-11-26',articles:[article],quotes,fallback:true}).includes('AIの判定に失敗したため'));
 const pool={query:async sql=>sql.includes('risk_days')?{rows:[{state:'ready',articles:[article]}]}:{rows:quotes.map(value=>({value}))}};
 assert.deepEqual(await sendOwnerShockMail({env:{},pool,day:'2026-11-26'}),{state:'off'});
 const sent=[],asked=[];
 const clerk={users:{getUser:async id=>{asked.push(id);return {primaryEmailAddress:{emailAddress:'owner@example.com'}};}}};
 const env={RESOLUTE_SHOCK_OWNER_MAIL_ENABLED:'true',RESOLUTE_RESEND_API_KEY:'re_test_key_123456',RESOLUTE_MAIL_FROM:'RESOLUTE <noreply@example.com>'.replace(/^.*<|>$/g,'')};
 const r=await sendOwnerShockMail({env,pool,day:'2026-11-26',clerk,fetcher:async(url,init)=>{sent.push({url:String(url),init});return new Response('{"id":"x"}',{status:200});}});
 assert.deepEqual(r,{state:'sent',stories:1,fallback:false});assert.deepEqual(asked,[PRODUCTION_OWNER_ACCOUNT_ID]);
 assert.equal(sent[0].url,'https://api.resend.com/emails');assert.equal(sent[0].init.headers['Idempotency-Key'],'resolute-shock-owner-2026-11-26');
 const mail=JSON.parse(sent[0].init.body);assert.deepEqual(mail.to,['owner@example.com']);assert.equal(mail.subject,'衝撃度チェッカー 2026-11-26');
});

test('thermometer v2: the reference is the whole history, so a 2008-like fall stays the far left and a smaller recent fall does not',()=>{
 // 19 years of a synthetic index: a 55% crash early (2008-like), steady growth, then a 25% drawdown at the end.
 const bars=[];let close=100;const start=Date.UTC(2007,0,1);
 for(let i=0;i<4900;i++){const t=start+i*86400000*1.45;const date=new Date(t).toISOString().slice(0,10);
  if(i>300&&i<560)close*=0.997;else if(i>4800)close*=0.997;else close*=1.0004;bars.push({date,close});}
 const asOf=bars.at(-1).date,r=calculateTemperature('sox',bars,asOf);
 assert.equal(r.status,'ready');assert.equal(r.version,'daily-close-v2');assert.ok(r.referenceFrom<'2008-06-01',r.referenceFrom);
 assert.ok(r.score>3,`today's ${r.drawdownPercent.toFixed(0)}% fall is not the 2008 floor (score ${r.score.toFixed(1)})`);
 assert.deepEqual([...THERMOMETER_VERSIONS],['daily-close-v1','daily-close-v2']);
});
