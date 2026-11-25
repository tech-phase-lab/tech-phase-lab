import test from 'node:test';
import assert from 'node:assert/strict';
import {storySession,applyMarketReaction,candidateMarket,readSessionMoves,measureStock} from '../lib/resolute/risk-market.ts';
import {storyScope,storyTicker} from '../lib/resolute/risk-scope.ts';
import {industryOf,namedCompanies} from '../lib/resolute/risk-companies.ts';
import {marketStars,companyQualifies,formatReading,readingParts,noStarsLabel,parseRiskArticle,parseRiskMarket,starsFromShock} from '../lib/resolute/risk.ts';
import {stockShock} from '../lib/resolute/thermometer-basket.ts';
import {safeThermometerSnapshot,safeShockStocks} from '../lib/resolute/thermometer-runtime.ts';
import {selectDailyCandidates,previewSelection,breaksCurrentRules,repeatsTaken} from '../services/resolute-api/rizel-daily-review.mjs';
import {validateGeneration} from '../services/resolute-api/risk-job.mjs';
import {hash} from '../services/resolute-api/risk-store.mjs';

// Owner, Nov 25 (after 「SK hynixを巡る調査を開始」 got ★5 from Monday Nov 23's market-wide RALLY):
// TP大型株100 +6.0% (7.9×, 89/99 up), TP半導体40 +14.7% (6.5×, 40/40 up), TP恐怖指数 +19%. The story came out Monday afternoon (ET),
// so the window from Friday's close held a move that had happened before the news.
const MON='2026-11-23',TUE='2026-11-24';
const rally={sox:{previousDate:'2026-11-20',changePercent:14.7,typicalPercent:2.26,up:40,down:0,total:40},nas100:{previousDate:'2026-11-20',changePercent:6.0,typicalPercent:0.76,up:89,down:10,total:99},fear:{level:47.6,previousLevel:40}};
// Tue Nov 24 as the thermometer measured it (tests/resolute-shock-gauge-rare-stars.test.mjs) plus the rostered stocks' own moves.
const tuesday={sox:{previousDate:MON,changePercent:-8.51,typicalPercent:2.24,up:1,down:39,total:40},nas100:{previousDate:MON,changePercent:-1.47,typicalPercent:0.744,up:52,down:47,total:99},fear:{level:41.15,previousLevel:41.33},
 stocks:{SKHY:{previousDate:MON,changePercent:-11.2,typicalPercent:3.1},AAPL:{previousDate:MON,changePercent:-4.5,typicalPercent:1.1},MU:{previousDate:MON,changePercent:-1.2,typicalPercent:2.9}}};
const moves={[MON]:rally,[TUE]:tuesday};
const body='The U.S. Commerce Department opened an investigation into SK hynix over chip exports to China, the company said, adding it would cooperate with the review of its memory shipments.';
const copy={publishable:true,ja:{title:'SKハイニックスを巡る調査を開始',source:'Example Wire',content:'米商務省がSKハイニックスの対中輸出を巡る調査を始めました。',date:'2026年11月24日'},en:{title:'U.S. opens probe into SK hynix',source:'Example Wire',content:'The U.S. Commerce Department opened an investigation into SK hynix over chip exports.',date:'November 23, 2026'}};
const story=(title,publishedAt,extra={})=>({id:hash(title+publishedAt),url:`https://news.example/${hash(title).slice(0,10)}`,title,body,publishedAt,source:'report',tickers:[],...extra});

test('timing: only the move AFTER publication counts — before the open that session, during or after regular hours the next one',()=>{
 for(const [at,expected] of [
  ['2026-11-23T14:00:00Z',MON], // Mon 09:00 New York: before the open → Monday
  ['2026-11-23T14:29:59Z',MON], // 09:29:59
  ['2026-11-23T14:30:00Z',TUE], // exactly 09:30: the session has started → Tuesday
  ['2026-11-23T19:00:00Z',TUE], // Mon 14:00, during regular hours → Tuesday (never Monday's move)
  ['2026-11-23T21:30:00Z',TUE], // after the close
  ['2026-11-21T15:00:00Z',MON], // Saturday → Monday
  ['2026-11-25T22:00:00Z','2026-11-27'], // Wed evening, Thanksgiving Thursday is closed → Friday (early close)
  ['2026-11-27T15:00:00Z','2026-11-30'], // during Friday's short session → Monday
  ['2028-01-05T15:00:00Z',null],['bad',null]])assert.equal(storySession(new Date(at)),expected,at);
});

test('replay of Nov 23: the Monday-afternoon SK hynix story never gets Monday\'s rally',()=>{
 const c=story('US opens probe into SK hynix over chip exports','2026-11-23T19:00:00.000Z');
 // A headline naming one company is company news even with "chip exports" in it (it had been read as the chip sector).
 assert.equal(storyScope(c.title),'company');assert.equal(storyScope(copy.ja.title),'company');assert.equal(storyTicker(c),'SKHY');assert.equal(industryOf('SKHY'),'sox');
 const article=validateGeneration(copy,c);
 assert.deepEqual(article.market,{index:'company',session:TUE,reading:null,company:{ticker:'SKHY',basket:'sox'}});
 assert.equal(noStarsLabel(article,'ja'),'市場の反応待ち');
 // With only Monday measured, it keeps waiting: Monday's +14.7% is never credited to it.
 assert.equal(applyMarketReaction(article,{[MON]:rally}).stars,null);
 assert.equal(applyMarketReaction(article,{[MON]:rally}).market.reading,null);
 // Tuesday: SKHY −11.2% (3.6× its usual 3.1%) and TP半導体40 −8.5% (3.8×, 39/40 down) → the chip basket's ★4.
 const filled=applyMarketReaction(article,moves);
 assert.equal(filled.market.reading.from,MON);assert.deepEqual(filled.market.reading.company,{changePercent:-11.2,multiple:3.6});
 assert.equal(filled.stars,4);assert.equal(parseRiskArticle(filled).stars,4);
 // The same story as a market-wide headline published at the same time also measures Tuesday, not the rally.
 const market=story('Stocks rally as tech megacaps surge','2026-11-23T19:00:00.000Z');
 assert.equal(candidateMarket(market).session,TUE);
 // Under the old rule (first close after the news) it would have been Monday: ★5 from the rally.
 assert.equal(starsFromShock({changePercent:6,multiple:7.9,same:89,total:99,fearChange:19}),5);
});

test('single-company news gets stars only when BOTH the company and its industry basket moved strongly, the same way',()=>{
 const c=story('Apple shares slide after iPhone orders are cut','2026-11-23T21:00:00.000Z',{tickers:['AAPL']});
 const waiting=validateGeneration({...copy,ja:{...copy.ja,title:'アップル株が下落'},en:{...copy.en,title:'Apple shares slide'}},{...c,body:'Apple shares slid after reports that iPhone orders were cut by suppliers, the report said.'});
 assert.deepEqual(waiting.market.company,{ticker:'AAPL',basket:'nas100'});
 // AAPL −4.5% (4.1×) but TP大型株100 only −1.5% (2.0×) … that is ≥1.5×: industry moved too → stars from TP大型株100 (47/99 down: ★2).
 const both=applyMarketReaction(waiting,moves);assert.equal(companyQualifies(both.market),true);assert.equal(both.stars,2);
 assert.deepEqual(formatReading(both.market,'ja'),['AAPL −4.5%（いつもの4.1倍）','TP大型株100 −1.5%（いつもの2.0倍・47/99社が下落）','恐怖指数 0%']);
 assert.deepEqual(readingParts(both.market,'en')[0],{text:'AAPL −4.5%',detail:' (4.1× usual)'});
 // Only the company moved: the industry basket at 1.0× → no stars, shown as single-company news.
 const calmIndustry={[TUE]:{...tuesday,nas100:{...tuesday.nas100,changePercent:-0.74}}};
 const alone=applyMarketReaction(waiting,calmIndustry);
 assert.equal(companyQualifies(alone.market),false);assert.equal(alone.stars,null);assert.equal(noStarsLabel(alone,'ja'),'個別企業のニュース（★はつけません）');
 assert.deepEqual(formatReading(alone.market,'ja'),[]);
 // Only the industry moved: MU −1.2% (0.4×) on a −8.5% chip day → no stars.
 const mu=validateGeneration({...copy,ja:{...copy.ja,title:'マイクロンの調査'},en:{...copy.en,title:'Micron probe'}},{...story('Micron faces probe over memory exports','2026-11-23T21:00:00.000Z',{tickers:['MU']}),body:'Micron said it faces a probe over memory exports, the report said.'});
 assert.equal(applyMarketReaction(mu,moves).stars,null);
 // Opposite directions never count.
 const opposite={[TUE]:{...tuesday,stocks:{AAPL:{previousDate:MON,changePercent:4.5,typicalPercent:1.1}}}};
 assert.equal(applyMarketReaction(waiting,opposite).stars,null);
 // A company the thermometer does not price is never measured.
 const other=validateGeneration(copy,story('Cipher Digital Stock Falls 11% as Nvidia Selloff Weighs','2026-11-23T21:00:00.000Z',{tickers:['CIFR','NVDA'],body}));
 assert.deepEqual(other?.market??{index:'company',session:null,reading:null},{index:'company',session:null,reading:null});
 // Stored shape round-trips; the stock line needs its company.
 assert.deepEqual(parseRiskMarket(both.market),both.market);
 assert.throws(()=>parseRiskMarket({...both.market,company:{ticker:'aapl',basket:'nas100'}}));
 assert.throws(()=>parseRiskMarket({index:'sox',session:TUE,reading:{...both.market.reading}}));
});

test('up days stay eligible; the fear rise counts on down days only, and the card never shows the fear line on an up day',()=>{
 const m={index:'nas100',session:MON,reading:{from:'2026-11-20',nas100:{changePercent:6,multiple:7.9,same:89,total:99},sox:{changePercent:14.7,multiple:6.5,same:40,total:40},fearChange:19}};
 assert.equal(marketStars(m),5);
 // ★5 up = ≥5× and ≥80% up, whatever the fear index does.
 assert.equal(marketStars({...m,reading:{...m.reading,fearChange:-5}}),5);
 assert.equal(marketStars({...m,reading:{...m.reading,fearChange:null}}),5);
 // The same move DOWN still needs the fear rise for ★5.
 const down={...m,reading:{...m.reading,nas100:{...m.reading.nas100,changePercent:-6},sox:{...m.reading.sox,changePercent:-14.7},fearChange:5}};
 assert.equal(marketStars(down),4);assert.equal(marketStars({...down,reading:{...down.reading,fearChange:19}}),5);
 // Card lines (home, detail and PC panel all use readingParts): sign and 上昇 show the direction; no 「恐怖指数」 line.
 assert.deepEqual(formatReading(m,'ja'),['TP大型株100 +6.0%（いつもの7.9倍・89/99社が上昇）','TP半導体40 +14.7%（いつもの6.5倍・40/40社が上昇）']);
 assert.deepEqual(formatReading(m,'en'),['TP Large Cap 100 +6.0% (7.9× usual · 89/99 up)','TP Semiconductor 40 +14.7% (6.5× usual · 40/40 up)']);
 assert.ok(!readingParts(m,'ja').some(l=>l.text.startsWith('恐怖指数')));
 assert.deepEqual(formatReading(down,'ja').at(-1),'恐怖指数 +5%');
});

const feedOf=items=>({ok:true,enabled:false,items:[],officialUpdates:[],reportUpdates:items,reportCoverage:{configured:true,marketLane:true}});
const row=(title,publishedAt,{tickers=[],lane='company'}={})=>({title,bodyEn:`${title}. Shares of semiconductor and technology companies fell after the report, and the decline weighed on the market across the session.`,
 url:`https://news.example/${encodeURIComponent(title).slice(0,80)}`,publishedAt,publisher:'Example Wire',tickers,lane,sentiment:'negative'});
test('at most 3 stories, never two with stars on the same session: the best explainer keeps the move',()=>{
 const runAt=new Date('2026-11-24T23:20:00Z'); // Wed Nov 25 08:20 JST: Tuesday's close is known
 const items=[
  row('Chip stocks tumble as export curbs widen','2026-11-24T12:00:00.000Z',{tickers:['NVDA','AMD']}), // 07:00 ET → Tue
  row('Semiconductor stocks fall after China retaliates','2026-11-24T13:00:00.000Z',{tickers:['NVDA']}), // 08:00 ET → Tue
  row('Nasdaq falls as Treasury yields climb','2026-11-24T11:00:00.000Z',{lane:'market'}), // 06:00 ET → Tue
  row('US opens probe into SK hynix over chip exports','2026-11-23T19:00:00.000Z',{tickers:['SKHY']}), // Mon 14:00 → Tue
  row('Apple shares slide after iPhone orders are cut','2026-11-24T15:00:00.000Z',{tickers:['AAPL']}), // Tue 10:00 → Wed
  row('Stocks drop as inflation worries return','2026-11-24T21:00:00.000Z',{lane:'market'}), // Tue 16:00 → Wed
 ];
 const {selected,reserve,diagnostics}=selectDailyCandidates(feedOf(items),runAt,{moves});
 assert.ok(selected.length<=3);
 const preview=previewSelection({selected,reserve,diagnostics},moves);
 // Tue: the chip-sector headlines and SK hynix (SKHY 3.6× with TP半導体40 3.8×) all explain it at ★4, the market-wide headline only
 // at TP大型株100's ★2. Every headline names a cause, so the ranking decides: chip-sector news before single-company news, the newer
 // first. Wed (not measured yet): the market-wide story holds it.
 const sessions=preview.selected.filter(p=>p.marketStars!==null||p.reading===null&&p.session).map(p=>p.session);
 assert.equal(new Set(sessions).size,sessions.length,'no session twice');
 assert.deepEqual(preview.selected.map(p=>[p.title.split(' ').slice(0,2).join(' '),p.session,p.marketStars]),[
  ['Stocks drop','2026-11-25',null],['Semiconductor stocks',TUE,4],['US opens',null,null]]);
 // The SK hynix story lost Tuesday to the chip-sector story (same fit, market and chip-sector news first): shown without stars.
 assert.equal(preview.selected[2].starred,false);
 // The others on Tuesday wait in reserve; picking one of them next to the chip story would repeat the move.
 for(const t of ['Chip stocks','Nasdaq falls'])assert.ok(repeatsTaken(reserve.find(c=>c.title.startsWith(t)),selected),t);
 assert.equal(diagnostics.sessionsHeld,2);
});

test('when the company explains the session better than the market-wide headline, the company keeps it',()=>{
 const runAt=new Date('2026-11-24T23:20:00Z');
 const items=[row('Nasdaq falls as Treasury yields climb','2026-11-24T11:00:00.000Z',{lane:'market'}),
  row('US opens probe into SK hynix over chip exports','2026-11-23T19:00:00.000Z',{tickers:['SKHY']})];
 const {selected,reserve,diagnostics}=selectDailyCandidates(feedOf(items),runAt,{moves});
 const preview=previewSelection({selected,reserve,diagnostics},moves);
 // TP大型株100 fits the market headline with ★2; SK hynix passes the two-move test with TP半導体40's ★4.
 assert.deepEqual(preview.selected.map(p=>[p.index,p.company??null,p.session,p.marketStars]),[['company','SKHY',TUE,4]]);
 assert.deepEqual(reserve.map(c=>c.title),['Nasdaq falls as Treasury yields climb']);
});

test('stored days: a story measured on the move before it, or two stars on one session, break the rules',()=>{
 const base=(title,publishedAt,market,stars)=>({id:hash(title),url:'https://news.example/'+hash(title).slice(0,8),publishedAt,market,stars,quoteId:null,
  ja:{title,source:'x',content:'本文\nこのニュースで、あなたのルールの条件に当てはまるものはありますか？',date:'2026年11月23日'},en:{title,source:'x',content:'Body\nDoes anything in this news meet a condition in your rules?',date:'November 23, 2026'}});
 const rallyReading={from:'2026-11-20',nas100:{changePercent:6,multiple:7.9,same:89,total:99},sox:{changePercent:14.7,multiple:6.5,same:40,total:40},fearChange:19};
 // The stored 11/25 SK hynix story: Monday 14:00 ET, measured on Monday's rally (the old rule).
 assert.equal(breaksCurrentRules([base('SKハイニックスを巡る調査を開始','2026-11-23T19:00:00.000Z',{index:'sox',session:MON,reading:rallyReading},5)]),true);
 const tueReading={from:MON,nas100:{changePercent:-1.5,multiple:2,same:47,total:99},sox:{changePercent:-8.5,multiple:3.8,same:39,total:40},fearChange:0};
 const ok=base('Chip stocks tumble','2026-11-24T12:00:00.000Z',{index:'sox',session:TUE,reading:tueReading},4);
 assert.equal(breaksCurrentRules([ok]),false);
 assert.equal(breaksCurrentRules([ok,base('Nasdaq falls','2026-11-24T11:00:00.000Z',{index:'nas100',session:TUE,reading:tueReading},4)]),true);
});

test('the thermometer keeps each rostered stock\'s own move for the stored snapshot only (never served to the site)',async()=>{
 // 61 daily closes alternating ±2%, then −10% on the session: usual move 2%, so 5×.
 const near=[];let close=100;for(let i=0;i<62;i++){near.push({date:new Date(Date.UTC(2026,8,1)+i*86400000).toISOString().slice(0,10),close});close*=i%2?1.02:0.98;}
 const day=near.at(-1).date,next=new Date(Date.parse(day)+86400000).toISOString().slice(0,10),gap=new Date(Date.parse(day)+9*86400000).toISOString().slice(0,10);
 const shock=stockShock([...near,{date:next,close:near.at(-1).close*0.9}],next);
 assert.equal(shock.previousDate,day);assert.ok(Math.abs(shock.changePercent+10)<0.001);assert.ok(Math.abs(shock.typicalPercent-2)<0.01);
 assert.equal(stockShock(near,next),null,'no close on the session');
 assert.equal(stockShock([...near,{date:gap,close:90}],gap),null,'previous close more than 7 days before: never guessed');
 assert.equal(stockShock([...near.slice(-20),{date:next,close:90}],next),null,'no full typical-move window');
 assert.equal(measureStock({previousDate:day,changePercent:-10,typicalPercent:2}).multiple,5);
 const stocks={[TUE]:{SKHY:{date:TUE,previousDate:MON,changePercent:-11.2,typicalPercent:3.1},bad:{date:TUE,previousDate:MON,changePercent:1,typicalPercent:1},MU:{date:MON,previousDate:'2026-11-20',changePercent:1,typicalPercent:1}}};
 assert.deepEqual(safeShockStocks(stocks,TUE),{[TUE]:{SKHY:{date:TUE,previousDate:MON,changePercent:-11.2,typicalPercent:3.1}}});
 const absent={status:'unavailable',reason:'not-configured'};
 assert.equal('shockStocks' in safeThermometerSnapshot({asOf:TUE,nas100:absent,sox:absent,vix:absent,shockStocks:stocks},TUE),false);
 // The Shock Gauge reader picks them up with the session's shock.
 const reading=await readSessionMoves({query:async()=>({rows:[{session:TUE,shock:{[TUE]:{sox:{...tuesday.sox,date:TUE},nas100:null,fear:null}},stocks}]})},[TUE]);
 assert.deepEqual(reading[TUE].stocks,{SKHY:{previousDate:MON,changePercent:-11.2,typicalPercent:3.1}});
 assert.deepEqual(namedCompanies('ASX listing as Nvidia and SK hynix rally'),['NVDA','SKHY']);
});
