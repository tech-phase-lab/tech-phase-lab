import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {selectDailyCandidates,breaksCurrentRules,reselectStoredDay,previewSelection,repeatsTaken} from '../services/resolute-api/rizel-daily-review.mjs';
import {validateGeneration,SUMMARY_INSTRUCTIONS} from '../services/resolute-api/risk-job.mjs';
import {applyMarketReaction} from '../lib/resolute/risk-market.ts';
import {storyScope,isBarePriceMove,titleSimilarity} from '../lib/resolute/risk-scope.ts';
import {parseRiskArticle,readingStars,measureDay,fearChangeOf,causeStars,formatReading,formatCause,noStarsLabel} from '../lib/resolute/risk.ts';
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
// The Nov 24 close as the thermometer's formulas measure it (recomputed from the constituents' daily closes, Nov 25):
// TP半導体40 −8.51%, typical move 2.24% (3.8×), 39/40 down; TP大型株100 −1.47%, typical move 0.74% (2.0×), 47/99 down; TP恐怖指数 −0.4%.
const session='2026-11-24',moves={[session]:{sox:{previousDate:'2026-11-23',changePercent:-8.51,typicalPercent:2.24,up:1,down:39,total:40},nas100:{previousDate:'2026-11-23',changePercent:-1.47,typicalPercent:0.744,up:52,down:47,total:99},fear:{level:41.15,previousLevel:41.33}}};
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
 assert.deepEqual(preview.selected,[{title:TODAY.cipher.en,scope:'company',index:'company',session:null,reading:null,marketStars:null}]);
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
 // Both indices are measured for every story (owner, Nov 25): TP大型株100 −1.5% (2.0×, 47/99 down) ★2, TP半導体40 −8.5% (3.8×, 39 of 40
 // down) ★4; the stronger, ★4, is the market's star for both stories on that close. The company story has none.
 const preview=previewSelection({selected,reserve,diagnostics},moves);
 assert.deepEqual(preview.selected.map(p=>[p.index,p.marketStars]),[['nas100',4],['sox',4],['company',null]]);
 assert.deepEqual(formatReading({index:'nas100',session,reading:preview.selected[0].reading},'ja'),['TP大型株100 −1.5%（いつもの2.0倍・47/99社が下落）','TP半導体40 −8.5%（いつもの3.8倍・39/40社が下落）','恐怖指数 0%']);
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

const day=(nas,sox,fear)=>({from:'2026-01-01',nas100:nas?measureDay(nas):null,sox:sox?measureDay(sox):null,fearChange:fearChangeOf(fear)});
const OFF={kind:'one-off',ja:'システム障害',en:'system outage'},LAST={kind:'lasting',ja:'輸出規制の強化',en:'tighter export controls'};
test('owner anchors under the published rule (measured with the thermometer formulas on the constituents\' daily closes)',()=>{
 // Nov 20: TP大型株100 −4.7% (usual 0.74%: 6.3×, 81 of 99 down), TP半導体40 −10.4% (usual 2.11%: 4.9×, 40 of 40), fear +12% → ★5.
 const nov20=day({changePercent:-4.70,typicalPercent:0.744,up:18,down:81,total:99},{changePercent:-10.41,typicalPercent:2.114,up:0,down:40,total:40},{level:34.70,previousLevel:30.87});
 assert.equal(readingStars(nov20),5);assert.equal(causeStars(5,OFF),4);
 // Nov 24: TP半導体40 −8.5% (3.8×, 39 of 40) ★4; TP大型株100 −1.5% (2.0×, 47 of 99) ★2; fear 0% → ★4 for any market or chip story.
 const nov24=day({changePercent:-1.47,typicalPercent:0.744,up:52,down:47,total:99},{changePercent:-8.51,typicalPercent:2.24,up:1,down:39,total:40},{level:41.15,previousLevel:41.33});
 assert.equal(readingStars(nov24),4);assert.equal(causeStars(4,LAST),5);assert.equal(causeStars(4,null),4);
 // 2025-11-20, a calm market: TP大型株100 −2.9% is 4.7× its usual 0.62% with 88 of 97 down and fear +11% → ★4 (TP半導体40 −4.3%,
 // 3.1×, 38 of 38: ★4). If the article shows a one-off cause it is ★3; a lasting cause makes it ★5.
 const calm=day({changePercent:-2.9,typicalPercent:0.62,up:9,down:88,total:97},{changePercent:-4.3,typicalPercent:1.4,up:0,down:38,total:38},{level:22.2,previousLevel:20});
 assert.equal(readingStars(calm),4);assert.equal(causeStars(4,OFF),3);assert.equal(causeStars(4,LAST),5);
 // An ordinary day.
 assert.equal(readingStars(day({changePercent:-0.6,typicalPercent:0.9,up:40,down:60,total:100},null,{level:20,previousLevel:20})),1);
 assert.equal(causeStars(2,LAST),3,'a lasting cause never jumps to ★5 from a small move');
 assert.ok(titleSimilarity('Nvidia Falls 5.6% in Premarket','Nvidia Falls 3.1% in Premarket')>=0.5,'same headline with another number');
});

const copy={publishable:true,ja:{title:'Cipher Digital株が下落',source:'Example Wire',content:'Cipher Digitalの株価が下落しました。',date:'2026年11月24日'},en:{title:'Cipher Digital shares fell',source:'Example Wire',content:'Cipher Digital shares fell.',date:'November 24, 2026'}};
test('a single-company story is stored without stars and labelled as such; it never waits for a close',()=>{
 const c=row(TODAY.cipher.en,120,{tickers:TODAY.cipher.tickers});
 const article=validateGeneration(copy,{...c,id:hash(c.url),body:c.bodyEn,source:'report'});
 assert.deepEqual(article.market,{index:'company',session:null,reading:null});assert.equal(article.stars,null);
 assert.equal(noStarsLabel(article,'ja'),'個別企業のニュース（★はつけません）');assert.equal(noStarsLabel(article,'en'),'Single-company news (no stars)');
 assert.equal(parseRiskArticle(article).stars,null);
 assert.throws(()=>parseRiskArticle({...article,market:{index:'company',session,reading:null}}));
});

const stored=title=>({id:hash(title),url:`https://news.example/${hash(title).slice(0,8)}`,publishedAt:'2026-11-24T12:00:00.000Z',market:{index:'sox',session,changePercent:-8.5},stars:5,quoteId:null,
 ja:{title,source:'Example Wire',content:'本文\n'+'このニュースで、あなたのルールの条件に当てはまるものはありますか？',date:'2026年11月24日'},en:{title,source:'Example Wire',content:'Body\nDoes anything in this news meet a condition in your rules?',date:'November 24, 2026'}});
test('breaksCurrentRules: today\'s stored day (three ★5 on one TP半導体40 move, no measured shock) breaks the rules; a day saved by them does not',()=>{
 const days=[stored(TODAY.cipher.ja),stored(TODAY.pre56.ja),stored(TODAY.pre3.ja)];
 assert.equal(breaksCurrentRules(days),true);
 assert.equal(breaksCurrentRules(days.map(a=>({...a,stars:4}))),true,'still three stories on one index and close');
 const measured={index:'sox',session,reading:{from:'2026-11-23',nas100:null,sox:{changePercent:-8.5,multiple:3.8,same:39,total:40},fearChange:0}};
 assert.equal(breaksCurrentRules([{...days[0],market:measured,stars:4},{...days[1],market:{index:'company',session:null,reading:null},stars:null}]),false);
 assert.equal(breaksCurrentRules([{...days[0],market:measured,stars:5}]),true,'stars the rule does not give');
 assert.equal(breaksCurrentRules([{...days[0],market:measured,stars:3,cause:OFF}]),false,'a one-off cause, one step down');
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
  assert.deepEqual(day.articles.map(a=>[a.market.index,a.market.reading?.sox?.changePercent??null,a.stars]),[['nas100',-8.5,4],['sox',-8.5,4],['company',null,null]]);
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

test('the model reads the cause in the same call, from the article only; the cause line is checked and shown with the step',()=>{
 for(const phrase of ['classify the cause of the development, from the supplied text only','technical glitch','export controls','When the text does not state the cause, use unclear','no numbers and no evaluation'])assert.ok(SUMMARY_INSTRUCTIONS.includes(phrase),phrase);
 const c=row('Chip stocks tumble as Nvidia selloff spreads across AI hardware',600,{tickers:['NVDA']});
 const cand={...c,id:hash(c.url),body:c.bodyEn,source:'report'};
 const out=cause=>validateGeneration({...copy,ja:{...copy.ja,title:'半導体株が下落'},en:{...copy.en,title:'Chip stocks fell'},cause},cand);
 const measured=a=>applyMarketReaction(a,moves);
 // Lasting cause named in the text → ★4 on the Nov 24 close becomes ★5, and the line says why.
 const lasting=measured(out({kind:'lasting',ja:'輸出規制の強化',en:'tighter export controls'}));
 assert.equal(lasting.stars,5);assert.equal(formatCause(lasting,'ja'),'長引きやすい要因（輸出規制の強化）→ ★+1');
 const oneOff=measured(out({kind:'one-off',ja:'システム障害',en:'system outage'}));
 assert.equal(oneOff.stars,3);assert.equal(formatCause(oneOff,'en'),'Looks one-off (system outage) → ★−1');
 // Unclear, a figure, banned wording or a long phrase: no cause, the market's stars stand.
 for(const cause of [{kind:'unclear',ja:'',en:''},{kind:'one-off',ja:'3日間の障害',en:'3-day outage'},{kind:'one-off',ja:'一時的な売り',en:'temporary selling'},{kind:'lasting',ja:'あ'.repeat(21),en:'x'},undefined])
  {const a=measured(out(cause));assert.equal(a.stars,4,JSON.stringify(cause));assert.equal(a.cause,undefined);}
 // One company's story never carries a cause (it has no stars to move).
 const co=row(TODAY.cipher.en,120,{tickers:TODAY.cipher.tickers});
 assert.equal(validateGeneration({...copy,cause:{kind:'lasting',ja:'需要の減速',en:'slowing demand'}},{...co,id:hash(co.url),body:co.bodyEn,source:'report'}).cause,undefined);
});
