import test from 'node:test';
import assert from 'node:assert/strict';
import {storySession,applyMarketReaction,candidateMarket,readSessionMoves,measureStock} from '../lib/resolute/risk-market.ts';
import {storyScope,storyTicker} from '../lib/resolute/risk-scope.ts';
import {industryOf,namedCompanies} from '../lib/resolute/risk-companies.ts';
import {marketStars,indexStars,formatReading,readingParts,noStarsLabel,parseRiskArticle,parseRiskMarket} from '../lib/resolute/risk.ts';
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
 // Tuesday: SKHY −11.2% (★5 on the stock row, 10% or more) and TP半導体40 −8.5% (★5, 8% or more) → ★5.
 const filled=applyMarketReaction(article,moves);
 assert.equal(filled.market.reading.from,MON);assert.deepEqual(filled.market.reading.company,{changePercent:-11.2,multiple:3.6});
 assert.equal(filled.stars,5);assert.equal(parseRiskArticle(filled).stars,5);
 // The same story as a market-wide headline published at the same time also measures Tuesday, not the rally.
 const market=story('Stocks rally as tech megacaps surge','2026-11-23T19:00:00.000Z');
 assert.equal(candidateMarket(market).session,TUE);
 // Under the old rule (first close after the news) it would have been Monday: ★5 from the rally.
 assert.equal(indexStars('nas100',{changePercent:6,multiple:7.9,same:89,total:99}),5);
});

test('single-company news (owner, Nov 26): the higher of the stock\'s row and its industry index\'s row; never against the headline',()=>{
 const c=story('Apple shares slide after iPhone orders are cut','2026-11-23T21:00:00.000Z',{tickers:['AAPL']});
 const waiting=validateGeneration({...copy,ja:{...copy.ja,title:'アップル株が下落'},en:{...copy.en,title:'Apple shares slide'}},{...c,body:'Apple shares slid after reports that iPhone orders were cut by suppliers, the report said.'});
 assert.deepEqual(waiting.market.company,{ticker:'AAPL',basket:'nas100'});
 // AAPL −4.5% (★3 on the stock row, 4–7%) and TP大型株100 −1.5% (★2) → ★3.
 const both=applyMarketReaction(waiting,moves);assert.equal(both.stars,3);
 assert.deepEqual(formatReading(both.market,'ja'),['AAPL　−4.5%','TP大型株100　−1.5%']);
 assert.deepEqual(readingParts(both.market,'en')[0],{text:'AAPL  −4.5%'});
 // Only the company moved: the stock's own row still gives ★3.
 const calmIndustry={[TUE]:{...tuesday,nas100:{...tuesday.nas100,changePercent:-0.74}}};
 assert.equal(applyMarketReaction(waiting,calmIndustry).stars,3);
 // Only the industry moved: MU −1.2% on a −8.5% chip day → TP半導体40's ★5.
 const mu=validateGeneration({...copy,ja:{...copy.ja,title:'マイクロンの調査'},en:{...copy.en,title:'Micron probe'}},{...story('Micron faces probe over memory exports','2026-11-23T21:00:00.000Z',{tickers:['MU']}),body:'Micron said it faces a probe over memory exports, the report said.'});
 assert.equal(applyMarketReaction(mu,moves).stars,5);
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
 // Up 5% or more on TP大型株100 is ★5, whatever the fear index does.
 assert.equal(marketStars({...m,reading:{...m.reading,fearChange:-5}}),5);
 assert.equal(marketStars({...m,reading:{...m.reading,fearChange:null}}),5);
 // Down: the fear index up 20% or more adds ★1 (TP大型株100 −4%: ★4 → ★5); never on the up day above.
 const down={...m,reading:{...m.reading,nas100:{...m.reading.nas100,changePercent:-4},sox:null,fearChange:5}};
 assert.equal(marketStars(down),4);assert.equal(marketStars({...down,reading:{...down.reading,fearChange:19}}),4);assert.equal(marketStars({...down,reading:{...down.reading,fearChange:20}}),5);
 assert.equal(marketStars({...m,reading:{...m.reading,nas100:{...m.reading.nas100,changePercent:4},sox:null,fearChange:40}}),4);
 // Card lines (home, detail and PC panel all use readingParts): sign and 上昇 show the direction; no 「恐怖指数」 line.
 assert.deepEqual(formatReading(m,'ja'),['TP大型株100　+6.0%','TP半導体40　+14.7%']);
 assert.deepEqual(formatReading(m,'en'),['TP Large Cap 100  +6.0%','TP Semiconductor 40  +14.7%']);
 assert.ok(!readingParts(m,'ja').some(l=>l.text.startsWith('恐怖指数')));
 assert.deepEqual(formatReading(down,'ja').at(-1),'恐怖指数　+5%');
});

test('market-wide headlines are market scope even with words before the move verb; "Shares of X" stays one company',()=>{
 for(const t of ['Stocks give back part of Monday rally as tariff worries return','U.S. stock futures slip after hot CPI report','Wall Street slides as Fed minutes show officials wary of cuts','Stock futures fall as jobless claims jump'])assert.equal(storyScope(t),'market',t);
 for(const t of ['Shares of Nvidia fall after export report','Micron cuts production forecast as memory chip prices weaken'])assert.equal(storyScope(t),'company',t);
});
const feedOf=items=>({ok:true,enabled:false,items:[],officialUpdates:[],reportUpdates:items,reportCoverage:{configured:true,marketLane:true}});
const row=(title,publishedAt,{tickers=[],lane='company'}={})=>({title,bodyEn:`${title}. Shares of semiconductor and technology companies fell after the report, and the decline weighed on the market across the session.`,
 url:`https://news.example/${encodeURIComponent(title).slice(0,80)}`,publishedAt,publisher:'Example Wire',tickers,lane,sentiment:'negative'});
test('at most 3 stories, never two with stars on the same session; market-wide news first whenever the market moved after it',()=>{
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
 // Tue: TP大型株100 moved −1.5% (2.0×: at least the ★2 line), so the market-wide story keeps Tuesday (owner: market-wide news
 // first) even though the chip headlines and SK hynix fit TP半導体40's ★4; its stars are the stronger index's, ★4.
 // Wed (not measured yet): the market-wide story holds it by the ranking. SK hynix is shown without stars.
 const sessions=preview.selected.filter(p=>p.marketStars!==null||p.reading===null&&p.session).map(p=>p.session);
 assert.equal(new Set(sessions).size,sessions.length,'no session twice');
 assert.deepEqual(preview.selected.map(p=>[p.title.split(' ').slice(0,2).join(' '),p.session,p.marketStars]),[
  ['Nasdaq falls',TUE,5],['Stocks drop','2026-11-25',null],['US opens',null,null]]);
 // The SK hynix story lost Tuesday to the chip-sector story (same fit, market and chip-sector news first): shown without stars.
 assert.equal(preview.selected[2].starred,false);
 // The others on Tuesday wait in reserve; picking one of them next to the chip story would repeat the move.
 for(const t of ['Chip stocks','Semiconductor stocks'])assert.ok(repeatsTaken(reserve.find(c=>c.title.startsWith(t)),selected),t);
 assert.equal(diagnostics.sessionsHeld,2);
});

test('when the market did not move after the market-wide headline, the company that explains the session keeps it',()=>{
 const runAt=new Date('2026-11-24T23:20:00Z');
 // TP大型株100 only −0.5% (0.7×, ★1): the market did not move; TP半導体40 −8.5% and SKHY −11.2% did.
 const calm={[TUE]:{...tuesday,nas100:{...tuesday.nas100,changePercent:-0.5}}};
 const items=[row('Nasdaq falls as Treasury yields climb','2026-11-24T11:00:00.000Z',{lane:'market'}),
  row('US opens probe into SK hynix over chip exports','2026-11-23T19:00:00.000Z',{tickers:['SKHY']})];
 const {selected,reserve,diagnostics}=selectDailyCandidates(feedOf(items),runAt,{moves:calm});
 const preview=previewSelection({selected,reserve,diagnostics},calm);
 // SK hynix: SKHY −11.2% and TP半導体40 −8.5%, both ★5 on the table.
 assert.deepEqual(preview.selected.map(p=>[p.index,p.company??null,p.session,p.marketStars]),[['company','SKHY',TUE,5]]);
 assert.deepEqual(reserve.map(c=>c.title),['Nasdaq falls as Treasury yields climb']);
});

test('stored days: a story measured on the move before it, or two stars on one session, break the rules',()=>{
 const base=(title,publishedAt,market,stars)=>({id:hash(title),url:'https://news.example/'+hash(title).slice(0,8),publishedAt,market,stars,quoteId:null,
  ja:{title,source:'x',content:'本文\nこのニュースで、あなたのルールの条件に当てはまるものはありますか？',date:'2026年11月23日'},en:{title,source:'x',content:'Body\nDoes anything in this news meet a condition in your rules?',date:'November 23, 2026'}});
 const rallyReading={from:'2026-11-20',nas100:{changePercent:6,multiple:7.9,same:89,total:99},sox:{changePercent:14.7,multiple:6.5,same:40,total:40},fearChange:19};
 // The stored 11/25 SK hynix story: Monday 14:00 ET, measured on Monday's rally (the old rule).
 assert.equal(breaksCurrentRules([base('SKハイニックスを巡る調査を開始','2026-11-23T19:00:00.000Z',{index:'sox',session:MON,reading:rallyReading},5)]),true);
 const tueReading={from:MON,nas100:{changePercent:-1.5,multiple:2,same:47,total:99},sox:{changePercent:-8.5,multiple:3.8,same:39,total:40},fearChange:0};
 const ok=base('Chip stocks tumble','2026-11-24T12:00:00.000Z',{index:'sox',session:TUE,reading:tueReading},5);
 assert.equal(breaksCurrentRules([ok]),false);
 assert.equal(breaksCurrentRules([ok,base('Nasdaq falls','2026-11-24T11:00:00.000Z',{index:'nas100',session:TUE,reading:tueReading},5)]),true);
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

test('a headline whose direction is clear gets no stars from a session that moved the other way',async()=>{
 const {headlineDirection}=await import('../lib/resolute/risk-scope.ts');
 for(const [t,d] of [['Stocks rally as chipmakers rebound after Friday rout','up'],['Chip stocks soar as Nvidia leads AI rebound','up'],['Nasdaq falls as Treasury yields climb','down'],
  ['Chip stocks tumble as export curbs widen','down'],['Stocks give back part of Monday rally as tariff worries return','down'],['Stocks end mixed ahead of Fed minutes',null],['US opens probe into SK hynix over chip exports',null]])assert.equal(headlineDirection(t),d,t);
 // Mon 11:00 ET "rally" story → measured on Tuesday, which fell (TP半導体40 −8.5%): no stars, and the label says why.
 const rally=story('Stocks rally as chipmakers rebound after Friday rout','2026-11-23T16:00:00.000Z');
 const market=candidateMarket(rally);assert.equal(market.headline,'up');assert.equal(market.session,TUE);
 const article=validateGeneration(copy,{...rally,body:'Stocks rallied on Monday as chipmakers rebounded after Friday rout, the report said, with the Nasdaq leading gains across the session.'});
 assert.equal(article.market.headline,'up');
 const filled=applyMarketReaction(article,moves);
 assert.notEqual(filled.market.reading,null);assert.equal(filled.stars,null);assert.equal(parseRiskArticle(filled).stars,null);
 // No extra text on screen (owner): the story is simply not shown — the feed drops it.
 const {parseRiskFeed}=await import('../lib/resolute/risk.ts');
 assert.deepEqual(parseRiskFeed({state:'ready',date:'2026-11-25',articles:[filled],quotes:[]}).articles,[]);
 assert.ok(!JSON.stringify((await import('../lib/resolute/risk-policy.ts')).RISK_POLICY).includes('見出しと逆'));
 // The same headline measured on an up session keeps its stars.
 assert.equal(applyMarketReaction(article,{[TUE]:{...tuesday,sox:{...tuesday.sox,changePercent:8.51,up:39,down:1},nas100:{...tuesday.nas100,changePercent:1.47,up:47,down:52}}}).stars,5);
 // Company news: the company's own move decides (a "soar" headline on a falling stock gets none).
 const soar=validateGeneration(copy,story('SK hynix shares soar after HBM deal','2026-11-23T19:00:00.000Z',{tickers:['SKHY']}));
 assert.equal(soar.market.headline,'up');assert.equal(applyMarketReaction(soar,moves).stars,null);
 // In the selection, a mismatched story never holds its session: the next story on it does.
 const runAt=new Date('2026-11-24T23:20:00Z');
 const items=[row('Stocks rally as chipmakers rebound after Friday rout','2026-11-24T12:00:00.000Z',{lane:'market'}),row('Chip stocks tumble as export curbs widen','2026-11-24T12:30:00.000Z',{tickers:['NVDA']})];
 const {selected,reserve,diagnostics}=selectDailyCandidates(feedOf(items),runAt,{moves});
 // The mismatched story takes no slot, not even in reserve; the next story fills it.
 assert.deepEqual(selected.map(c=>c.title),['Chip stocks tumble as export curbs widen']);
 assert.deepEqual(reserve.map(c=>c.title),[]);assert.equal(diagnostics.movedAgainst,1);
});

test('rally news reaches the intake on the same bar as downside news; positive sentiment alone does not',async()=>{
 const {inspectCandidateFeed,SUMMARY_INSTRUCTIONS}=await import('../services/resolute-api/risk-job.mjs');
 const now=new Date('2026-11-24T23:20:00Z'),at='2026-11-24T15:00:00.000Z';
 const item=(title,extra={})=>({title,bodyEn:`${title}. The report said the move followed the announcement and was among the largest of the session for technology companies.`,url:'https://news.example/'+encodeURIComponent(title).slice(0,60),publishedAt:at,...extra});
 const {candidates}=inspectCandidateFeed({ok:true,enabled:true,items:[item('Nvidia shares soar after raising its revenue outlook'),item('Stocks rally as Fed signals rate cuts'),
  item('Wall Street hits record high on cooling inflation'),item('Nvidia unveils new developer tools',{sentiment:'positive'}),item('Apple holds annual shareholder meeting')]},now);
 assert.deepEqual(candidates.map(c=>c.title).sort(),['Nvidia shares soar after raising its revenue outlook','Stocks rally as Fed signals rate cuts','Wall Street hits record high on cooling inflation']);
 assert.ok(candidates.every(c=>c.headlineUpside));
 assert.match(SUMMARY_INSTRUCTIONS,/A concrete sharp rise qualifies the same way/);
 assert.match(SUMMARY_INSTRUCTIONS,/opinion, ranking or promotional pieces/);
});

test('the terms §20-4 sentence is unchanged, word for word, in the terms and under the stars',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {RISK_POLICY}=await import('../lib/resolute/risk-policy.ts');
 const sentence='★は、ニュースのあとの実際の指標の動きと記事の内容から、一過性かどうかを吟味して算出した目安であり、今後の値動きや売買の時期を示すものではありません。';
 assert.equal(RISK_POLICY.note.ja,sentence);
 assert.ok((await readFile(new URL('../content/legal/terms.ja.md',import.meta.url),'utf8')).includes('衝撃度チェッカーの'+sentence));
});
