import {RISK_POLICY} from './risk-policy.ts';
/** Shock Gauge (衝撃度チェッカー) data. Stars come only from the related TP index's actual move (risk-policy.ts);
 * the model writes factual copy and never assigns stars or actions. File/identifier names keep the historic "risk" prefix. */
export type RiskIndex=keyof typeof RISK_POLICY.indices;
/** One index's measured shock (risk-policy.ts): its move in % (0.1), how many times its usual move (0.1), and how many of
 * its stocks moved the same way of those priced. */
export type RiskMeasure={changePercent:number;multiple:number;same:number;total:number;intraday?:RiskIntraday};
/** The session's intraday extreme against the previous close (owner, Nov 26: a −4.5% intraday fall that recovered by the close
 * is a shock): its move in % (0.1, signed: the deeper of the fall and the rise), how many times the usual intraday extreme
 * (0.1), and how many of the stocks went that far beyond the previous close by more than the usual intraday extreme. */
export type RiskIntraday={changePercent:number;multiple:number;same:number};
/** One company's own move on the session (single-company news): its move in % (0.1) and how many times its usual move (0.1). */
export type RiskStock={changePercent:number;multiple:number;intraday?:number};
/** Both indices measured over the same span (from the close of `from`), and TP恐怖指数's change over it in whole %.
 * company: the story's company on that session (single-company news only; null when its stock was not priced). */
export type RiskReading={from:string;nas100:RiskMeasure|null;sox:RiskMeasure|null;fearChange:number|null;company?:RiskStock|null};
/** session: the U.S. session whose close-to-close move is credited to the story (risk-market.ts storySession: the same session
 * for news before the regular open, otherwise the next full session). reading: both indices measured on it (null = waiting).
 * index: the story's scope index, shown first; 'company' = one company's news. company (single-company news only): the
 * rostered ticker and its industry basket; without it the story is never measured (no stars). */
export type RiskMarket={index:RiskIndex|'company';session:string|null;reading:RiskReading|null;company?:{ticker:string;basket:RiskIndex};headline?:'up'|'down'};
/** The inputs of one level check. changePercent: the move's direction (the fear condition applies to a down move only). */
export type RiskShock={changePercent:number;multiple:number;same:number;total:number;fearChange:number|null};
export type RiskCopy={title:string;source:string;content:string;date:string};
/** The model's reading of the CAUSE, from the article text only (owner, Nov 25): one-off (−1 star) or lasting (+1 star), with
 * the cause named in a few words. null = neither is clear (no change). */
export type RiskCause={kind:'one-off'|'lasting';ja:string;en:string};
/** The day's judgement (owner, Nov 26): the AI reads the day (market-close wraps, the stories, both baskets' close and intraday
 * moves, the fear index on a down day) and gives each picked story ★1–5 with a short reason. source 'rule' = every AI attempt
 * failed and the numeric rule (with intraday extremes) was used. */
export type RiskJudge={stars:number;source:'ai'|'rule';reason:{ja:string;en:string}};
export type RiskArticle={id:string;url:string;publishedAt:string;market:RiskMarket;stars:number|null;ja:RiskCopy;en:RiskCopy;quoteId:string|null;cause?:RiskCause|null;judge?:RiskJudge};
export type RizelQuote={id:string;ja:{title:string;reasons:string[]};en:{title:string;reasons:string[]};minStars:number;maxStars:number;approved:boolean};
export type RiskFeed={state:'ready'|'failed'|'stopped'|'preparing';date:string|null;articles:RiskArticle[];quotes:RizelQuote[]};
/** Lawyer-reviewed disclaimer (Nov 2026, section 6). EN follows the Terms of Service, Article 2(2). */
export const RIZEL_DISCLAIMER={ja:'本サービスと本商品は、情報の提供とご自身で決めたルールの管理を目的としたもので、特定の銘柄の売買や売買の時期をすすめるものではありません。投資の判断は、ご自身でおこなってください。',en:'This service and this product are for providing information and helping you manage the rules you set for yourself. They do not recommend buying or selling any particular stock, or when to buy or sell. Investment decisions are yours to make.'};
/** Every summary ends with this question (lawyer review, Nov 2026). */
export const SUMMARY_QUESTION={ja:'このニュースで、あなたのルールの条件に当てはまるものはありますか？',en:'Does anything in this news meet a condition in your rules?'};
export const RISK_INDICES=Object.keys(RISK_POLICY.indices) as RiskIndex[];
/** Rounded to 0.1 so the stars always agree with the number shown next to them. */
export function roundMove(changePercent:number){if(!Number.isFinite(changePercent)||Math.abs(changePercent)>=100)throw Error('INVALID_MOVE');const r=Math.sign(changePercent)*Math.round(Math.abs(changePercent)*10)/10;return Object.is(r,-0)?0:r;}
/** The published rule (risk-policy.ts): the highest level whose every condition holds, else ★1.
 * The fear condition counts on a DOWN move only (owner, Nov 25): TP恐怖指数 is realized volatility and rises on a big up day
 * too, so on an up move ★5 needs only ≥5× and ≥80% of constituents up. TP恐怖指数 itself is not changed. */
export function starsFromShock(shock:RiskShock){
 for(const level of RISK_POLICY.stars.levels){
  if(shock.multiple<level.multiple)continue;
  if(level.breadth!==null&&shock.same*100<level.breadth*shock.total)continue;
  if(level.fear!==null&&shock.changePercent<0&&(shock.fearChange===null||shock.fearChange<level.fear))continue;
  return level.stars;
 }
 return 1;
}
const tenth=(n:number)=>Math.round(n*10)/10;
const wholePercent=(level:number,previous:number)=>{const v=Math.round(100*(level/previous-1));return Object.is(v,-0)?0:v;};
/** One index on the session: the close-to-close move, its multiple of the usual daily move (0.1), the stocks that moved the
 * same way, and (when the thermometer measured it) the intraday extreme against the previous close. */
export function measureDay(reading:{changePercent:number;typicalPercent:number;up:number;down:number;total:number;intraday?:{changePercent:number;typicalPercent:number;same:number}|null}):RiskMeasure{
 if(!(reading.typicalPercent>0)||!Number.isInteger(reading.total)||reading.total<1)throw Error('INVALID_SHOCK');
 const changePercent=roundMove(reading.changePercent),i=reading.intraday;
 const intraday=i&&i.typicalPercent>0&&Number.isInteger(i.same)&&i.same>=0&&i.same<=reading.total?{changePercent:roundMove(i.changePercent),multiple:tenth(Math.abs(i.changePercent)/i.typicalPercent),same:i.same}:null;
 return {changePercent,multiple:tenth(Math.abs(reading.changePercent)/reading.typicalPercent),same:changePercent<0?reading.down:changePercent>0?reading.up:0,total:reading.total,...(intraday?{intraday}:{})};
}
/** The measured move of one index (owner, Nov 26): the stronger of the close-to-close move and the intraday extreme, each by the
 * published levels (a tie keeps the close). Its sign is the day's direction for that index. */
export function strongestMove(m:RiskMeasure,fearChange:number|null){
 const close={changePercent:m.changePercent,multiple:m.multiple,same:m.same,total:m.total,intraday:false};
 if(!m.intraday)return close;
 const intra={changePercent:m.intraday.changePercent,multiple:m.intraday.multiple,same:m.intraday.same,total:m.total,intraday:true};
 const a=starsFromShock({...close,fearChange}),b=starsFromShock({...intra,fearChange});
 return b>a||b===a&&intra.multiple>close.multiple?intra:close;
}
/** One index's stars: its strongest move by the published levels. */
export const measureStars=(m:RiskMeasure,fearChange:number|null)=>starsFromShock({...strongestMove(m,fearChange),fearChange});
export const fearChangeOf=(fear:{level:number;previousLevel:number}|null)=>fear&&fear.level>0&&fear.previousLevel>0?wholePercent(fear.level,fear.previousLevel):null;
/** A reading's stars: the stronger of the two indices (each by the published levels), null when neither was measured. */
export function readingStars(r:RiskReading|null){
 if(!r)return null;const each=[r.nas100,r.sox].filter((m):m is RiskMeasure=>!!m).map(m=>measureStars(m,r.fearChange));
 return each.length?Math.max(...each):null;
}
/** Single-company news (owner, Nov 25): true when, on the story's session, the company's own stock moved at least
 * companyTest.minMultiple times its usual move AND its industry basket at least companyTest.industryMinMultiple times, the same
 * way. Earnings or a downgrade can move a whole industry; one stock moving alone is not a market shock. */
export function companyQualifies(m:RiskMarket){
 const r=m.reading,stock=r?.company,measure=m.company&&r?r[m.company.basket]:null;
 if(m.index!=='company'||!stock||!measure||!r)return false;
 const basket=strongestMove(measure,r.fearChange);
 const {minMultiple,industryMinMultiple}=RISK_POLICY.companyTest,dir=Math.sign(stock.changePercent);
 return dir!==0&&dir===Math.sign(basket.changePercent)&&stock.multiple>=minMultiple&&basket.multiple>=industryMinMultiple;
}
/** Owner, Nov 25: a headline that clearly states a direction ("… rally", "… tumble") gets no stars from a session that moved the
 * other way (the move that set the stars: the stronger index, or the company's own stock), and is not shown at all (no extra
 * text on screen): the selection never picks it, a stored day drops it once its session is measured, and the feed hides it. */
export function directionMismatch(m:RiskMarket){
 const r=m.reading;if(!m.headline||!r)return false;
 const d=decidingMeasure({...m,headline:undefined}),x=m.index==='company'?r.company:d?strongestMove(d,r.fearChange):null;
 return !!x&&x.changePercent!==0&&(x.changePercent>0?'up':'down')!==m.headline;
}
/** The market's stars: the stronger of the two indices on the story's session. Single-company news: its industry basket's stars,
 * only when it passes the two-move test (companyQualifies). None while waiting, or when the session moved against the headline. */
export const marketStars=(m:RiskMarket)=>{
 if(directionMismatch(m))return null;
 let s:number|null;
 if(m.index!=='company')s=readingStars(m.reading);
 else{if(!m.company||!m.reading||!companyQualifies(m))return null;const basket=m.reading[m.company.basket];s=basket?measureStars(basket,m.reading.fearChange):null;}
 return s;
};
/** True when the story's session moved at least the ★2 line (1.5× a normal day, the close or the intraday extreme). Below it the
 * day was quiet for that story: nothing may lift it above ★1 (owner, Nov 26: the AI's +1 never lifts a no-move story). */
export const marketMoved=(m:RiskMarket)=>{const s=readingStars(m.reading);return s!==null&&s>=RISK_POLICY.minMarketStars;};
/** The stars shown. With the day's judgement: the judged stars, capped at ★1 when the market did not move. Without it (stored
 * before Nov 26): the rule's stars with the cause step. */
export function storyStars(market:RiskMarket,cause:RiskCause|null|undefined,judge:RiskJudge|null|undefined){
 if(judge){if(!market.reading)return null;return marketMoved(market)?judge.stars:1;}
 return causeStars(marketStars(market),cause);
}
/** Shown to members (owner, Nov 26): only measured stories with stars. Waiting stories, moves below the ★2 line, single-company
 * news without stars and moves against the headline are not shown; fewer than three is fine, none is the quiet day. */
export const isShownStory=(a:{stars:number|null;market:RiskMarket})=>a.stars!==null&&a.market.reading!==null;
/** The stars shown: the market's stars, one lower when the cause looks one-off, one higher when it looks lasting, within 1–5.
 * A lasting cause can reach ★5 only from a market ★4 (never from the cause alone). */
export function causeStars(market:number|null,cause:RiskCause|null|undefined){
 if(market===null)return null;if(!cause)return market;
 // Owner, Nov 26: a lasting cause never lifts a story whose market did not move (below the ★2 line).
 return cause.kind==='one-off'?Math.max(1,market-1):market<RISK_POLICY.minMarketStars?market:Math.min(5,market+1);
}
/** The short, plain explanation behind the small 「i」 next to the stars (owner, Nov 25), above the exact levels (starCriteria). */
export function starSummary(locale:'ja'|'en'){const {nas100,sox}=RISK_POLICY.indices;return locale==='ja'
 ?`★は、毎朝AIが、前の日のアメリカ市場の動き（${nas100.ja}と${sox.ja}の終値と取引中の動き、下落の日の恐怖指数、1社だけのニュースはその会社の株価）と、市場のまとめ記事やニュースを読んで、市場を実際に動かしたニュースを選び、5段階でつけています。`
 :`Every morning AI reads how the U.S. market moved the day before (${nas100.en} and ${sox.en} at the close and during trading, the fear index on a down day, and the company's own stock for single-company news) together with market wrap-ups and the news, picks the stories that actually moved the market, and rates them on five levels.`;}
/** The accessible name of the small 「i」 that opens the criteria. */
export const STAR_INFO_LABEL={ja:'★のつけ方',en:'How stars are set'} as const;
/** The star criteria as published in the app, in plain words, generated from the levels so the text always matches the rule. */
export function starCriteria(locale:'ja'|'en'){
 const {typicalDays}=RISK_POLICY.stars;
 if(locale==='ja')return [`★のつけ方`,
  `・毎朝、AIがその日の市場のまとめ記事とニュース、指標の動きを読み、市場を実際に動かしたニュースを3つまで選びます。市場全体のニュースを優先します。`,
  `・★5：歴史に残るほどの衝撃`,`・★4：とても大きく、広い範囲の動き`,`・★3：多くの会社がそろって大きく動いた`,`・★2：ふだんの日より明らかに大きい動き`,`・★1：小さな動き`,
  `・取引中に大きく動いて終値にかけて戻した日も、衝撃として数えます。`,
  `・ニュースが出る前に起きた動きは、そのニュースの★には数えません。`,
  `・市場がほとんど動かなかったときのニュースは、★1までです。`,
  `・AIが判定できなかった日は、指標の動きの基準（ふだんの1日の値動きの何倍か・同じ向きに動いた会社の割合・下落の日の恐怖指数）でつけます。ふだんの1日の値動きは、直前の${typicalDays}日の、1日の動きの大きさのまん中の値です。`].join('\n');
 return [`How stars are set`,
  `- Every morning AI reads the day's market wrap-ups, the news and the index moves, and picks up to three stories that actually moved the market. Market-wide news comes first.`,
  `- ★5: a historic shock`,`- ★4: a very large, broad move`,`- ★3: most stocks moved sharply together`,`- ★2: clearly bigger than a normal day`,`- ★1: a small move`,
  `- A day that swung hard during trading and recovered by the close still counts as a shock.`,
  `- A move that happened before the news came out is never counted for it.`,
  `- News on a day the market barely moved gets ★1 at most.`,
  `- On a day the AI judgement is unavailable, the index-move rule is used (times a normal day's move, the share of stocks moving the same way, the fear index on a down day). A normal day's move is the middle size of the daily moves over the previous ${typicalDays} trading days.`].join('\n');
}
/** What is shown in place of stars: single-company news, or still waiting for the first close. Null when there are stars. */
export function noStarsLabel(article:{stars:number|null;market:RiskMarket},locale:'ja'|'en'){if(article.stars!==null)return null;const m=article.market;
 // A measurable company story waits for its session like any other; once measured without passing the test it is company news.
 return m.index==='company'&&!(m.company&&m.session&&!m.reading)?RISK_POLICY.company[locale]:RISK_POLICY.waiting[locale];}
/** Waiting stories (no stars yet) never trigger the "reread your rules" action. */
export const riskAction=(stars:number|null)=>{if(stars===null)return 'none';if(!Number.isInteger(stars)||stars<1||stars>5)throw Error('INVALID_STARS');return stars>=RISK_POLICY.reviewMinStars?'review':'none';};
const signed=(n:number,digits:number)=>`${n>0?'+':n<0?'−':''}${Math.abs(n).toFixed(digits)}%`;
/** The index whose move set the stars (the stronger; on a tie the one listed first), or the company story's industry basket. */
export function decidingMeasure(m:RiskMarket):RiskMeasure|null{
 const r=m.reading;if(!r)return null;
 if(m.index==='company')return m.company?r[m.company.basket]:null;
 const order:RiskIndex[]=m.index==='sox'?['sox','nas100']:['nas100','sox'];let best:RiskMeasure|null=null,bestStars=0;
 for(const i of order){const x=r[i];if(!x)continue;const n=measureStars(x,r.fearChange);if(n>bestStars){best=x;bestStars=n;}}
 return best;
}
/** The lines under the stars (owner, Nov 26; approved mock-up): no parentheses and no multiples or company counts. Per index two
 * lines: 「TP大型株100　−0.6%」 and, smaller and muted, 「取引中は −4.6% まで下落」 / 「取引中は +3.1% まで上昇」 — the second only
 * when the intraday extreme differs from the close by INTRADAY_GAP points or more. Single-company news: 「NVDA　−3.1%」 (same second
 * line) and then its industry basket. The fear index 「恐怖指数　+12%」 on a down day only. The story's index comes first. */
export function readingParts(m:RiskMarket,locale:'ja'|'en'):{text:string;detail?:string}[]{
 const r=m.reading;if(!r||(m.index==='company'&&!m.company))return [];
 const ja=locale==='ja',gap=ja?'\u3000':'  ';
 const second=(close:number,intra:number|undefined)=>{
  if(intra===undefined||Math.abs(intra-close)<INTRADAY_GAP||intra===0)return {};
  return {detail:ja?`取引中は ${signed(intra,1)} まで${intra<0?'下落':'上昇'}`:`Intraday ${intra<0?'low':'high'} ${signed(intra,1)}`};
 };
 const order:RiskIndex[]=m.index==='company'?[m.company!.basket]:m.index==='sox'?['sox','nas100']:['nas100','sox'];
 const lines:{text:string;detail?:string}[]=[];
 if(m.index==='company'&&m.company&&r.company)lines.push({text:`${m.company.ticker}${gap}${signed(r.company.changePercent,1)}`,...second(r.company.changePercent,r.company.intraday)});
 for(const i of order){const x=r[i];if(!x)continue;lines.push({text:`${RISK_POLICY.indices[i][locale]}${gap}${signed(x.changePercent,1)}`,...second(x.changePercent,x.intraday?.changePercent)});}
 const deciding=decidingMeasure(m),dir=deciding?strongestMove(deciding,r.fearChange).changePercent:0;
 if(r.fearChange!==null&&dir<0)lines.push({text:ja?`恐怖指数${gap}${signed(r.fearChange,0)}`:`Fear index${gap}${signed(r.fearChange,0)}`});
 return lines;
}
/** The second line appears only when the intraday extreme and the close differ by at least this many points. */
export const INTRADAY_GAP=1;
/** The same lines as plain text: 「TP半導体40 −8.5%（いつもの3.8倍・39/40社が下落）」「TP大型株100 −1.5%（いつもの2.0倍・47/99社が下落）」「恐怖指数 0%」. */
export function formatReading(m:RiskMarket,locale:'ja'|'en'):string[]{return readingParts(m,locale).map(l=>l.text+(l.detail??''));}
/** The cause line under the stars: 「一過性とみられる要因（システム障害）→ ★−1」 / 「長引きやすい要因（輸出規制の強化）→ ★+1」. */
export function formatCause(article:{stars:number|null;market:RiskMarket;cause?:RiskCause|null},locale:'ja'|'en'){
 const c=article.cause,base=marketStars(article.market);if(!c||base===null||article.stars===null)return null;
 const step=article.stars-base,mark=step>0?'★+1':step<0?'★−1':locale==='ja'?'★はそのまま':'stars unchanged';
 return locale==='ja'?`${c.kind==='one-off'?'一過性とみられる要因':'長引きやすい要因'}（${c.ja}）→ ${mark}`:`${c.kind==='one-off'?'Looks one-off':'Likely to last'} (${c.en}) → ${mark}`;
}
const CAUSE_TEXT=/^[^<>\u0000\n]{1,40}$/;
export function parseRiskCause(v:unknown):RiskCause|null{if(v===null||v===undefined)return null;const x=v as RiskCause;if(!x||typeof x!=='object'||!['one-off','lasting'].includes(x.kind)||typeof x.ja!=='string'||typeof x.en!=='string'||!CAUSE_TEXT.test(x.ja.trim())||!CAUSE_TEXT.test(x.en.trim()))throw Error('INVALID_CAUSE');return {kind:x.kind,ja:x.ja.trim(),en:x.en.trim()};}
export function riskDate(now=new Date()){return new Date(now.getTime()+9*3600000).toISOString().slice(0,10);}
/** True during the weekday morning run hour (JST). */
export function isDailyRunHour(now=new Date()){const jst=new Date(now.getTime()+9*3600000);return ![0,6].includes(jst.getUTCDay())&&jst.getUTCHours()===RISK_POLICY.runHourJst;}
/** Start of a day's morning run (ms). */
export const dailyRunStart=(day:string)=>Date.parse(`${day}T${String(RISK_POLICY.runHourJst).padStart(2,'0')}:00:00+09:00`);
export function latestRiskDate(now=new Date()){const d=new Date(now.getTime()+9*3600000);if(d.getUTCHours()<RISK_POLICY.runHourJst)d.setUTCDate(d.getUTCDate()-1);while([0,6].includes(d.getUTCDay()))d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);}
export function parseRiskCopy(v:unknown):RiskCopy{if(!v||typeof v!=='object')throw Error('INVALID_COPY');const x=v as Record<string,unknown>;for(const k of ['title','source','content','date'])if(typeof x[k]!=='string'||!(x[k] as string).trim()||[...x[k] as string].length>700||/[<>\u0000]/.test(x[k] as string))throw Error('INVALID_COPY');return {title:x.title as string,source:x.source as string,content:x.content as string,date:x.date as string};}
const validSession=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const count=(v:unknown)=>Number.isInteger(v)&&(v as number)>=0&&(v as number)<=500;
const isTenth=(v:unknown,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max&&Math.round(v*10)/10===v;
function parseMeasure(v:unknown):RiskMeasure|null{if(v===null)return null;const x=v as RiskMeasure;if(!x||typeof x!=='object'||!isTenth(x.changePercent,-99.9,999)||!isTenth(x.multiple,0,100)||!count(x.same)||!count(x.total)||x.total<1||x.same>x.total)throw Error('INVALID_SHOCK');
 const i=x.intraday;if(i!==undefined&&(!i||typeof i!=='object'||!isTenth(i.changePercent,-99.9,999)||!isTenth(i.multiple,0,100)||!count(i.same)||i.same>x.total))throw Error('INVALID_SHOCK');
 return {changePercent:x.changePercent||0,multiple:x.multiple,same:x.same,total:x.total,...(i?{intraday:{changePercent:i.changePercent||0,multiple:i.multiple,same:i.same}}:{})};}
function parseStock(v:unknown):RiskStock|null{if(v===null||v===undefined)return null;const x=v as RiskStock;if(!x||typeof x!=='object'||!isTenth(x.changePercent,-99.9,999)||!isTenth(x.multiple,0,100)||x.intraday!==undefined&&!isTenth(x.intraday,-99.9,999))throw Error('INVALID_SHOCK');return {changePercent:x.changePercent||0,multiple:x.multiple,...(x.intraday!==undefined?{intraday:x.intraday||0}:{})};}
function parseReading(v:unknown,company=false):RiskReading{const x=v as RiskReading;if(!x||typeof x!=='object'||!validSession(x.from)||!(x.fearChange===null||Number.isInteger(x.fearChange)&&Math.abs(x.fearChange)<1000))throw Error('INVALID_SHOCK');
 const r:RiskReading={from:x.from,nas100:parseMeasure(x.nas100??null),sox:parseMeasure(x.sox??null),fearChange:x.fearChange||(x.fearChange===null?null:0)};if(!r.nas100&&!r.sox)throw Error('INVALID_SHOCK');
 if(company)r.company=parseStock(x.company);else if(x.company!==undefined)throw Error('INVALID_SHOCK');return r;}
const COMPANY_TICKER=/^[A-Z][A-Z0-9.]{0,9}$/;
/** A story stored before Nov 25 (one index's move, no measured shock) is read as still waiting: it is measured again.
 * Single-company news stored before Nov 25 (no company) stays unmeasured company news. */
export function parseRiskMarket(v:unknown):RiskMarket{const x=v as RiskMarket;if(!x||typeof x!=='object')throw Error('INVALID_MARKET');
 if(x.headline!==undefined&&x.headline!=='up'&&x.headline!=='down')throw Error('INVALID_MARKET');const m=parseMarketBody(x);return x.headline&&m.session?{...m,headline:x.headline}:m;}
function parseMarketBody(x:RiskMarket):RiskMarket{
 if(x.index==='company'){
  if(x.company===undefined){if(x.session!==null||x.reading)throw Error('INVALID_MARKET');return {index:'company',session:null,reading:null};}
  const c=x.company;if(!c||typeof c!=='object'||typeof c.ticker!=='string'||!COMPANY_TICKER.test(c.ticker)||!RISK_INDICES.includes(c.basket)||!(x.session===null||validSession(x.session)))throw Error('INVALID_MARKET');
  const company={ticker:c.ticker,basket:c.basket};
  if(!x.reading)return {index:'company',session:x.session,reading:null,company};
  const reading=parseReading(x.reading,true);if(x.session===null||reading.from>=x.session)throw Error('INVALID_MARKET');
  return {index:'company',session:x.session,reading,company};}
 if(!RISK_INDICES.includes(x.index)||!(x.session===null||validSession(x.session)))throw Error('INVALID_MARKET');
 if(!x.reading)return {index:x.index,session:x.session,reading:null};
 const reading=parseReading(x.reading);if(x.session===null||reading.from>=x.session)throw Error('INVALID_MARKET');
 return {index:x.index,session:x.session,reading};}
/** Stars always follow the CURRENT published rule for the stored readings (risk-policy.ts); a story without a reading has none.
 * A RIZEL line chosen for other stars is dropped. */
export function parseRiskArticle(v:unknown):RiskArticle{if(!v||typeof v!=='object')throw Error('INVALID_ARTICLE');const x=v as RiskArticle;if(!/^[a-f0-9]{64}$/.test(x.id)||!Number.isFinite(Date.parse(x.publishedAt)))throw Error('INVALID_ARTICLE');const u=new URL(x.url);if(u.protocol!=='https:'||u.username||u.password||u.href.length>2048)throw Error('INVALID_URL');
 const market=parseRiskMarket(x.market);if(x.stars!==null&&(!Number.isInteger(x.stars)||x.stars<1||x.stars>5))throw Error('INVALID_STARS');
 const cause=parseRiskCause(x.cause),judge=parseRiskJudge(x.judge),stars=storyStars(market,cause,judge);
 if(x.quoteId!==null&&!/^[a-z0-9_-]{1,60}$/.test(x.quoteId))throw Error('INVALID_QUOTE');return {id:x.id,url:x.url,publishedAt:x.publishedAt,market,stars,ja:parseRiskCopy(x.ja),en:parseRiskCopy(x.en),quoteId:stars!==null&&stars===x.stars?x.quoteId:null,...(cause?{cause}:{}),...(judge?{judge}:{})};}
const REASON_TEXT=/^[^<>\u0000]{1,160}$/;
export function parseRiskJudge(v:unknown):RiskJudge|null{if(v===null||v===undefined)return null;const x=v as RiskJudge;
 if(!x||typeof x!=='object'||!Number.isInteger(x.stars)||x.stars<1||x.stars>5||!['ai','rule'].includes(x.source)||!x.reason||typeof x.reason.ja!=='string'||typeof x.reason.en!=='string'||!REASON_TEXT.test(x.reason.ja)||!REASON_TEXT.test(x.reason.en))throw Error('INVALID_JUDGE');
 return {stars:x.stars,source:x.source,reason:{ja:x.reason.ja,en:x.reason.en}};}
/** Rows written before the Shock Gauge (rubric stars, no market move) are never shown. */
export const isLegacyRiskArticle=(v:unknown)=>!!v&&typeof v==='object'&&!('market' in v);
export function parseQuote(v:unknown):RizelQuote{const x=v as RizelQuote;if(!x||!/^[a-z0-9_-]{1,60}$/.test(x.id)||typeof x.approved!=='boolean'||!Number.isInteger(x.minStars)||!Number.isInteger(x.maxStars)||x.minStars<1||x.maxStars>5||x.minStars>x.maxStars)throw Error('INVALID_QUOTE');for(const locale of ['ja','en'] as const){const c=x[locale];if(!c||typeof c.title!=='string'||!c.title.trim()||c.title.length>200||!Array.isArray(c.reasons)||c.reasons.length>5||!c.reasons.every(t=>typeof t==='string'&&t.length<=400))throw Error('INVALID_QUOTE');}return x;}
/** shownOnly (default): the member feed keeps only measured stories with stars (isShownStory). The owner's own view passes false. */
export function parseRiskFeed(v:unknown,{shownOnly=true}:{shownOnly?:boolean}={}):RiskFeed{const x=v as RiskFeed;if(!x||!['ready','failed','stopped','preparing'].includes(x.state)||!(x.date===null||/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&Number.isFinite(Date.parse(x.date+'T00:00:00Z')))||!Array.isArray(x.articles)||x.articles.length>3||!Array.isArray(x.quotes)||x.quotes.length>100)throw Error('INVALID_FEED');const articles=x.articles.map(parseRiskArticle).filter(a=>!shownOnly||isShownStory(a)),quotes=x.quotes.map(parseQuote).filter(q=>q.approved);if(new Set(articles.map(a=>a.id)).size!==articles.length||x.state!=='ready'&&articles.length)throw Error('INVALID_FEED');return{state:x.state,date:x.date,articles,quotes};}
