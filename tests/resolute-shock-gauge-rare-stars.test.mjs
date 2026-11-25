import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {selectDailyCandidates,breaksCurrentRules,reselectStoredDay,previewSelection,repeatsTaken} from '../services/resolute-api/rizel-daily-review.mjs';
import {validateGeneration} from '../services/resolute-api/risk-job.mjs';
import {storyScope,isBarePriceMove,titleSimilarity} from '../lib/resolute/risk-scope.ts';
import {parseRiskArticle,starsFromMove,noStarsLabel} from '../lib/resolute/risk.ts';
import {hash} from '../services/resolute-api/risk-store.mjs';

// Owner, Nov 25 (JST): the first public Shock Gauge day listed three NVIDIA stories, each ★★★★★ with 「TP半導体40 −8.5%」:
// 「Cipher Digital株が11%超下落、NVIDIAの売りがAIインフラ株を圧迫」「Nvidiaがプレマーケットで5.6%下落」「Nvidia株がプレマーケットで3%以上下落しました」.
// 「星5なんて滅多に出なくて良い」「NVDA3つもいらん」「市場全体での動きにしてほしかった」.
const TODAY={
 cipher:{en:'Cipher Digital Stock Falls Over 11% as Nvidia Selloff Weighs on AI Infrastructure Names',ja:'Cipher Digital株が11%超下落、NVIDIAの売りがAIインフラ株を圧迫',tickers:['CIFR','NVDA']},
 pre56:{en:'Nvidia Falls 5.6% in Premarket',ja:'Nvidiaがプレマーケットで5.6%下落',tickers:['NVDA']},
 pre3:{en:'Nvidia Stock Drops More Than 3% in Premarket Trading',ja:'Nvidia株がプレマーケットで3%以上下落しました',tickers:['NVDA']},
};
const runAt=new Date('2026-11-24T23:20:00Z'); // Wednesday Nov 25, 08:20 JST
const session='2026-11-24',moves={[session]:{sox:{changePercent:-8.5},nas100:{changePercent:-1.8}}};
const body=t=>`${t}. Shares of AI infrastructure companies fell as investors sold Nvidia after the report; the decline extended into the session and weighed on semiconductor names across the market.`;
const row=(title,minutesBefore,{tickers=[],lane='company',sentiment='negative'}={})=>({title,bodyEn:body(title),url:`https://news.example/${encodeURIComponent(title).slice(0,80)}`,
 publishedAt:new Date(runAt.getTime()-minutesBefore*60000).toISOString(),publisher:'Example Wire',tickers,lane,sentiment});
const feedOf=items=>({ok:true,enabled:false,items:[],officialUpdates:[],reportUpdates:items,reportCoverage:{configured:true,marketLane:true}});

test('today\'s three stories under the new rules: the two bare premarket recaps are dropped, Cipher Digital is single-company news without stars',()=>{
 for(const t of [TODAY.pre56,TODAY.pre3])for(const title of [t.en,t.ja]){assert.equal(storyScope(title),'company',title);assert.equal(isBarePriceMove(title),true,title);}
 for(const title of [TODAY.cipher.en,TODAY.cipher.ja]){assert.equal(storyScope(title),'company',title);assert.equal(isBarePriceMove(title),false,title);}
 const feed=feedOf([row(TODAY.pre56.en,240,{tickers:TODAY.pre56.tickers}),row(TODAY.pre3.en,300,{tickers:TODAY.pre3.tickers}),row(TODAY.cipher.en,120,{tickers:TODAY.cipher.tickers})]);
 const {selected,diagnostics}=selectDailyCandidates(feed,runAt,{moves});
 assert.deepEqual(selected.map(c=>c.title),[TODAY.cipher.en]);
 assert.equal(diagnostics.barePriceMove,2);
 const preview=previewSelection({selected,reserve:[],diagnostics},moves);
 assert.deepEqual(preview.selected,[{title:TODAY.cipher.en,scope:'company',index:'company',session:null,move:null,stars:null}]);
});

test('a day with market-wide and chip-sector news: three different stories, each on its own index, never three ★ on one move',()=>{
 const items=[
  row(TODAY.pre56.en,240,{tickers:['NVDA']}),row(TODAY.pre3.en,300,{tickers:['NVDA']}),row(TODAY.cipher.en,120,{tickers:TODAY.cipher.tickers}),
  row('Nvidia shares slide as investors question AI spending',500,{tickers:['NVDA']}),
  row('Chip stocks tumble as Nvidia selloff spreads across AI hardware',600,{tickers:['NVDA','AMD','AVGO']}),
  row('Semiconductor stocks fall after report of wider China export curbs',700,{tickers:['NVDA','AMD']}),
  row('Nasdaq falls as Treasury yields climb ahead of Fed minutes',650,{lane:'market'}),
  row('Stocks slip as investors weigh hotter inflation data',800,{lane:'market'}),
  row('3 AI Stocks to Buy After the Sell-Off',60,{tickers:['NVDA'],sentiment:'positive'}),
 ];
 const {selected,reserve,diagnostics}=selectDailyCandidates(feedOf(items),runAt,{moves});
 assert.deepEqual(selected.map(c=>c.title),['Nasdaq falls as Treasury yields climb ahead of Fed minutes','Chip stocks tumble as Nvidia selloff spreads across AI hardware','Nvidia shares slide as investors question AI spending']);
 // A headline that gives the cause ranks above a price-move recap ("… Falls Over 11% …") among single-company news.
 // Stars per story from its own index: TP大型株100 −1.8% ★2, TP半導体40 −8.5% ★4 (not ★5), the company story none.
 const preview=previewSelection({selected,reserve,diagnostics},moves);
 assert.deepEqual(preview.selected.map(p=>[p.index,p.move,p.stars]),[['nas100',-1.8,2],['sox',-8.5,4],['company',null,null]]);
 // The second chip-sector story and the second market story repeat a move already shown: reserve only.
 assert.ok(repeatsTaken(reserve.find(c=>c.title.startsWith('Semiconductor stocks')),selected));
 assert.ok(repeatsTaken(reserve.find(c=>c.title.startsWith('Stocks slip')),selected));
 // One story per company: a second Nvidia story is not shown next to another Nvidia story.
 const nvda=selected.find(c=>c.title.startsWith('Nvidia shares slide'));
 assert.ok(repeatsTaken(nvda,[{title:'Nvidia warns on China sales',tickers:['NVDA'],publishedAt:runAt.toISOString()}]));
 assert.ok(!repeatsTaken(reserve.find(c=>c.title===TODAY.cipher.en),[nvda]),'another company is not a repeat');
 assert.equal(diagnostics.barePriceMove,2);
 assert.ok(reserve.at(-1).title.startsWith('3 AI Stocks'),'opinion pieces go last');
});

test('the published rule: TP半導体40 −8.5% is ★4, ★5 only from −10%; TP大型株100 −5.4% (Nov 20) is ★5',()=>{
 assert.equal(starsFromMove(-8.5,'sox'),4);assert.equal(starsFromMove(-7,'sox'),4);assert.equal(starsFromMove(-10,'sox'),5);
 assert.equal(starsFromMove(-5.4,'nas100'),5);assert.equal(starsFromMove(-1.8,'nas100'),2);
 assert.ok(titleSimilarity('Nvidia Falls 5.6% in Premarket','Nvidia Falls 3.1% in Premarket')>=0.5,'same headline with another number');
});

const copy={publishable:true,ja:{title:'Cipher Digital株が下落',source:'Example Wire',content:'Cipher Digitalの株価が下落しました。',date:'2026年11月24日'},en:{title:'Cipher Digital shares fell',source:'Example Wire',content:'Cipher Digital shares fell.',date:'November 24, 2026'}};
test('a single-company story is stored without stars and labelled as such; it never waits for a close',()=>{
 const c=row(TODAY.cipher.en,120,{tickers:TODAY.cipher.tickers});
 const article=validateGeneration(copy,{...c,id:hash(c.url),body:c.bodyEn,source:'report'});
 assert.deepEqual(article.market,{index:'company',session:null,changePercent:null});assert.equal(article.stars,null);
 assert.equal(noStarsLabel(article,'ja'),'個別企業のニュース（★はつけません）');assert.equal(noStarsLabel(article,'en'),'Single-company news (no stars)');
 assert.equal(parseRiskArticle(article).stars,null);
 assert.throws(()=>parseRiskArticle({...article,market:{index:'company',session,changePercent:-8.5}}));
});

const stored=title=>({id:hash(title),url:`https://news.example/${hash(title).slice(0,8)}`,publishedAt:'2026-11-24T12:00:00.000Z',market:{index:'sox',session,changePercent:-8.5},stars:5,quoteId:null,
 ja:{title,source:'Example Wire',content:'本文\n'+'このニュースで、あなたのルールの条件に当てはまるものはありますか？',date:'2026年11月24日'},en:{title,source:'Example Wire',content:'Body\nDoes anything in this news meet a condition in your rules?',date:'November 24, 2026'}});
test('breaksCurrentRules: today\'s stored day (three ★5 on one TP半導体40 move) breaks the rules; a day saved by them does not',()=>{
 const day=[stored(TODAY.cipher.ja),stored(TODAY.pre56.ja),stored(TODAY.pre3.ja)];
 assert.equal(breaksCurrentRules(day),true);
 assert.equal(breaksCurrentRules(day.map(a=>({...a,stars:4}))),true,'still three stories on one index and close');
 assert.equal(breaksCurrentRules([{...day[0],stars:4},{...day[1],market:{index:'company',session:null,changePercent:null},stars:null}]),false);
 assert.equal(breaksCurrentRules([]),false);
});

async function databases(){
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const dump=await boot.dumpDataDir();await boot.close();
 const risk=new PGlite({database:'resolute',loadDataDir:dump});
 for(const f of ['001_entitlements.sql','009_risk.sql'])await risk.exec(await readFile(new URL('../db/resolute/'+f,import.meta.url),'utf8'));
 const rizel=new PGlite();await rizel.exec('CREATE ROLE resolute_rizel_writer');await rizel.exec(await readFile(new URL('../db/resolute/013_rizel_daily_review.sql',import.meta.url),'utf8'));
 return {risk,rizel};
}
test('one-off re-selection of today: gated by RESOLUTE_SHOCK_GAUGE_RESELECT_DAY, replays the 08:20 run, replaces the day once',async()=>{
 const {risk,rizel}=await databases();
 const old=[stored(TODAY.cipher.ja),stored(TODAY.pre56.ja),stored(TODAY.pre3.ja)];
 await risk.query("INSERT INTO resolute.risk_days(day,state,articles) VALUES('2026-11-25','ready',$1)",[JSON.stringify(old)]);
 await rizel.query("INSERT INTO public.resolute_rizel_daily_runs(day,state,started_at,candidate_count) VALUES('2026-11-25','ready','2026-11-24T23:20:00Z',3)");
 const later=new Date('2026-11-25T03:00:00Z'); // 12:00 JST
 // A story published after the morning run is never read by the replay.
 const items=[row(TODAY.pre56.en,240,{tickers:['NVDA']}),row(TODAY.cipher.en,120,{tickers:TODAY.cipher.tickers}),
  row('Chip stocks tumble as Nvidia selloff spreads across AI hardware',600,{tickers:['NVDA','AMD']}),row('Nasdaq falls as Treasury yields climb ahead of Fed minutes',650,{lane:'market'}),
  {...row('Wall Street slides as tech selloff deepens',0,{lane:'market'}),publishedAt:'2026-11-25T02:00:00.000Z'}];
 const tried=[];
 const options={publishPool:risk,selectionPool:rizel,budgetPool:risk,readFeed:async()=>feedOf(items),readMoves:async()=>moves,
  summarize:async c=>{tried.push(c.title);return validateGeneration({...copy,ja:{...copy.ja,title:c.title.slice(0,90)},en:{...copy.en,title:c.title.slice(0,90)}},c);},
  select:async x=>({state:'selected',publication:'withheld',articleId:x.article.id,articleRevision:'r'})};
 try{
  assert.deepEqual(await reselectStoredDay({...options,env:{},realNow:later}),{state:'reselect-off'});
  assert.equal((await reselectStoredDay({...options,env:{RESOLUTE_SHOCK_GAUGE_RESELECT_DAY:'2026-11-24'},realNow:later})).state,'reselect-not-today');
  assert.equal((await reselectStoredDay({...options,env:{RESOLUTE_SHOCK_GAUGE_RESELECT_DAY:'2026-11-25'},realNow:new Date('2026-11-24T23:40:00Z')})).state,'reselect-not-today','not during the morning run');
  const env={RESOLUTE_SHOCK_GAUGE_RESELECT_DAY:'2026-11-25'};
  const result=await reselectStoredDay({...options,env,realNow:later});
  assert.equal(result.state,'reselected-ready');assert.equal(result.count,3);
  assert.ok(!tried.some(t=>t.startsWith('Wall Street slides')),'only what the morning run could read');
  assert.ok(!tried.includes(TODAY.pre56.en),'bare premarket recap dropped');
  const day=(await risk.query("SELECT state,articles FROM resolute.risk_days WHERE day='2026-11-25'")).rows[0];
  assert.equal(day.state,'ready');
  assert.deepEqual(day.articles.map(a=>[a.market.index,a.market.changePercent,a.stars]),[['nas100',-1.8,2],['sox',-8.5,4],['company',null,null]]);
  assert.equal(breaksCurrentRules(day.articles),false);
  // The flag left in place never runs it again.
  const calls=tried.length;
  assert.equal((await reselectStoredDay({...options,env,realNow:new Date('2026-11-25T05:00:00Z')})).state,'reselect-not-needed');
  assert.equal(tried.length,calls);
 }finally{await risk.close();await rizel.close();}
});

test('a failed re-selection leaves the stored day as it was',async()=>{
 const {risk,rizel}=await databases();
 const old=[stored(TODAY.cipher.ja),stored(TODAY.pre56.ja)];
 await risk.query("INSERT INTO resolute.risk_days(day,state,articles) VALUES('2026-11-25','ready',$1)",[JSON.stringify(old)]);
 await rizel.query("INSERT INTO public.resolute_rizel_daily_runs(day,state,started_at,candidate_count) VALUES('2026-11-25','ready','2026-11-24T23:20:00Z',2)");
 try{
  await assert.rejects(reselectStoredDay({env:{RESOLUTE_SHOCK_GAUGE_RESELECT_DAY:'2026-11-25'},realNow:new Date('2026-11-25T03:00:00Z'),publishPool:risk,selectionPool:rizel,budgetPool:risk,
   readFeed:async()=>feedOf([row(TODAY.cipher.en,120,{tickers:TODAY.cipher.tickers})]),readMoves:async()=>moves,summarize:async()=>null}),e=>e.message==='PRIVATE_DAILY_REVIEW_FAILED');
  const day=(await risk.query("SELECT state,articles FROM resolute.risk_days WHERE day='2026-11-25'")).rows[0];
  assert.equal(day.state,'ready');assert.deepEqual(day.articles,old);
 }finally{await risk.close();await rizel.close();}
});
