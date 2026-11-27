import {RISK_POLICY} from './risk-policy.ts';
import {parseImpactHints,type ImpactHints} from './impact.ts';
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
export type RiskCopy={title:string;source:string;content:string;date:string};
/** The model's reading of the CAUSE, from the article text only (owner, Nov 25): one-off (−1 star) or lasting (+1 star), with
 * the cause named in a few words. null = neither is clear (no change). */
export type RiskCause={kind:'one-off'|'lasting';ja:string;en:string};
/** Why a story was chosen (owner, Nov 26): the AI reads the day (market-close wraps, the stories, both baskets' close and intraday
 * moves) and picks the stories that moved the market, with a short reason. It never sets the stars. source 'rule' = every AI
 * attempt failed and the selection's own order was used. */
export type RiskJudge={source:'ai'|'rule';reason:{ja:string;en:string}};
/** Who chose a published story and its ★ (owner, Nov 27): 'owner' = the owner ticked it and set the ★; 'auto' = the owner did not
 * answer by the deadline and the service published its own top picks with the suggested ★. A picked story keeps that ★ (the
 * measured move is shown next to it as information) and is shown even when its session has no measured numbers. */
export type RiskPick={source:'owner'|'auto'};
/** The story's RIZEL line (owner pick, Nov 27): by 'ai' = written for that story by the AI and checked with the RIZEL wording rules
 * (risk-copy-check.ts); by 'owner' = the owner's own text, published as written. */
export type RiskRizel={ja:string;en:string;by:'ai'|'owner'};
export type RiskArticle={id:string;url:string;publishedAt:string;market:RiskMarket;stars:number|null;ja:RiskCopy;en:RiskCopy;quoteId:string|null;cause?:RiskCause|null;judge?:RiskJudge;impact?:ImpactHints;pick?:RiskPick;rizel?:RiskRizel};
export type RizelQuote={id:string;ja:{title:string;reasons:string[]};en:{title:string;reasons:string[]};minStars:number;maxStars:number;approved:boolean};
export type RiskFeed={state:'ready'|'failed'|'stopped'|'preparing';date:string|null;articles:RiskArticle[];quotes:RizelQuote[]};
/** Lawyer-reviewed disclaimer (Nov 2026, section 6). EN follows the Terms of Service, Article 2(2). */
export const RIZEL_DISCLAIMER={ja:'本サービスと本商品は、情報の提供とご自身で決めたルールの管理を目的としたもので、特定の銘柄の売買や売買の時期をすすめるものではありません。投資の判断は、ご自身でおこなってください。',en:'This service and this product are for providing information and helping you manage the rules you set for yourself. They do not recommend buying or selling any particular stock, or when to buy or sell. Investment decisions are yours to make.'};
/** Every summary ends with this question (lawyer review, Nov 2026). */
export const SUMMARY_QUESTION={ja:'このニュースで、あなたのルールの条件に当てはまるものはありますか？',en:'Does anything in this news meet a condition in your rules?'};
export const RISK_INDICES=Object.keys(RISK_POLICY.indices) as RiskIndex[];
/** Rounded to 0.1 so the stars always agree with the number shown next to them. */
export function roundMove(changePercent:number){if(!Number.isFinite(changePercent)||Math.abs(changePercent)>=100)throw Error('INVALID_MOVE');const r=Math.sign(changePercent)*Math.round(Math.abs(changePercent)*10)/10;return Object.is(r,-0)?0:r;}
/** The owner's star table (Nov 26, final): stars from a move size in %, by fixed bands (RISK_POLICY.stars.bands). */
export function bandStars(movePercent:number,bands:readonly number[]){let stars=1;for(const b of bands)if(movePercent>=b)stars++;return Math.min(5,stars);}
const tenth=(n:number)=>Math.round(n*10)/10;
const wholePercent=(level:number,previous:number)=>{const v=Math.round(100*(level/previous-1));return Object.is(v,-0)?0:v;};
/** One index on the session: the close-to-close move, its multiple of the usual daily move (0.1, kept as data), the stocks that
 * moved the same way, and (when the thermometer measured it) the intraday extreme against the previous close. */
export function measureDay(reading:{changePercent:number;typicalPercent:number;up:number;down:number;total:number;intraday?:{changePercent:number;typicalPercent:number;same:number}|null}):RiskMeasure{
 if(!(reading.typicalPercent>0)||!Number.isInteger(reading.total)||reading.total<1)throw Error('INVALID_SHOCK');
 const changePercent=roundMove(reading.changePercent),i=reading.intraday;
 const intraday=i&&i.typicalPercent>0&&Number.isInteger(i.same)&&i.same>=0&&i.same<=reading.total?{changePercent:roundMove(i.changePercent),multiple:tenth(Math.abs(i.changePercent)/i.typicalPercent),same:i.same}:null;
 return {changePercent,multiple:tenth(Math.abs(reading.changePercent)/reading.typicalPercent),same:changePercent<0?reading.down:changePercent>0?reading.up:0,total:reading.total,...(intraday?{intraday}:{})};
}
/** The measured move of one index or stock (owner, Nov 26): the larger of |the close move| and |the largest intraday move against
 * the previous close| (a tie keeps the close). Its sign is the direction. */
export function strongestMove(m:{changePercent:number;intraday?:{changePercent:number}|number}){
 const intra=typeof m.intraday==='number'?m.intraday:m.intraday?.changePercent;
 return intra!==undefined&&Math.abs(intra)>Math.abs(m.changePercent)?{changePercent:intra,intraday:true}:{changePercent:m.changePercent,intraday:false};
}
/** One index's stars by the owner's table: TP大型株100 <1 / 1–2 / 2–3.5 / 3.5–5 / ≥5 %, TP半導体40 <1.6 / 1.6–3.2 / 3.2–5.6 /
 * 5.6–8 / ≥8 %, on its measured move. */
export const indexStars=(index:RiskIndex,m:RiskMeasure)=>bandStars(Math.abs(strongestMove(m).changePercent),RISK_POLICY.stars.bands[index]);
/** A stock's stars (single-stock news, its own move): <2 / 2–4 / 4–7 / 7–10 / ≥10 %. */
export const stockStars=(x:RiskStock)=>bandStars(Math.abs(strongestMove(x).changePercent),RISK_POLICY.stars.bands.stock);
/** The fear index rose 20% or more on the day: ★ +1 (★5 at most). */
/** The fear index rose 20% or more on a DOWN day: ★ +1 (★5 at most). Never on an up day (owner, Nov 26 spec §1). */
const withFear=(stars:number,fearChange:number|null,direction:number)=>direction<0&&fearChange!==null&&fearChange>=RISK_POLICY.stars.fearBump?Math.min(5,stars+1):stars;
export const fearChangeOf=(fear:{level:number;previousLevel:number}|null)=>fear&&fear.level>0&&fear.previousLevel>0?wholePercent(fear.level,fear.previousLevel):null;
/** A reading's stars: the higher of the two indices, +1 when the fear index rose 20% or more on a down day; null when neither
 * was measured. The day's direction is the sign of the index that set the stars (the first listed on a tie). */
export function readingStars(r:RiskReading|null){
 if(!r)return null;let best=0,dir=0;
 for(const i of RISK_INDICES){const m=r[i];if(!m)continue;const n=indexStars(i,m);if(n>best){best=n;dir=strongestMove(m).changePercent;}}
 return best?withFear(best,r.fearChange,dir):null;
}
/** Owner, Nov 25: a headline that clearly states a direction ("… rally", "… tumble") gets no stars from a session that moved the
 * other way (the move that set the stars: the stronger index, or the company's own stock), and is not shown at all (no extra
 * text on screen): the selection never picks it, a stored day drops it once its session is measured, and the feed hides it. */
export function directionMismatch(m:RiskMarket){
 const r=m.reading;if(!m.headline||!r)return false;
 const d=decidingMeasure({...m,headline:undefined}),x=m.index==='company'?(r.company?strongestMove(r.company):null):d?strongestMove(d):null;
 return !!x&&x.changePercent!==0&&(x.changePercent>0?'up':'down')!==m.headline;
}
/** The story's stars (owner, Nov 26 spec §1; the AI never changes them). Market-wide and chip-sector news: the higher of the two
 * indices. Single-company news: the higher of the stock's own row and its industry index's row. +1 when the fear index rose 20%
 * or more on a down day. None while waiting, without a measured stock for single-company news, or when the session moved
 * against the headline. */
export const marketStars=(m:RiskMarket)=>{
 if(directionMismatch(m)||!m.reading)return null;
 if(m.index!=='company')return readingStars(m.reading);
 const r=m.reading,stock=r.company,basket=m.company?r[m.company.basket]:null;
 if(!m.company||!stock)return null;
 const a=stockStars(stock),b=basket?indexStars(m.company.basket,basket):0;
 return withFear(Math.max(a,b),r.fearChange,a>=b?strongestMove(stock).changePercent:strongestMove(basket!).changePercent);
};
/** Up to three stories, the most stars first (owner, Nov 26 spec §1). */
export const byStars=<T extends {stars:number|null}>(list:readonly T[])=>[...list].sort((a,b)=>(b.stars??0)-(a.stars??0));
/** Shown to members (owner, Nov 26): only measured stories with stars. Waiting stories, single-stock news without a measured stock
 * and moves against the headline are not shown; fewer than three is fine, none is the quiet day. */
export const isShownStory=(a:{stars:number|null;market:RiskMarket;pick?:RiskPick})=>a.stars!==null&&(a.market.reading!==null||!!a.pick);
/** The short, plain explanation behind the small 「i」 next to the stars (owner, Nov 25), above the exact levels (starCriteria). */
export function starSummary(locale:'ja'|'en'){const {nas100,sox}=RISK_POLICY.indices;return locale==='ja'
 ?`★は、ニュースのあとの${nas100.ja}と${sox.ja}の動きで決めます。終値の動きと取引中のいちばん大きな動きのうち大きいほうで決め、2つの指標のうち★が多いほうをとります。恐怖指数が20%以上上がった日は★を1つ足します。どのニュースを載せるかは、毎朝AIが市場のまとめ記事とニュースを読んで選びます。`
 :`Stars come from how ${nas100.en} and ${sox.en} moved after the news: the larger of the close move and the largest move during trading, taking whichever index gives more stars. On a day the fear index rose 20% or more, one star is added. Each morning AI reads market wrap-ups and the news to choose which stories to show.`;}
/** The accessible name of the small 「i」 that opens the criteria. */
export const STAR_INFO_LABEL={ja:'★のつけ方',en:'How stars are set'} as const;
/** The star criteria as published in the app, in plain words, generated from the levels so the text always matches the rule. */
const pct=(n:number)=>`${n}%`;
const rowJa=(b:readonly number[])=>`★1 ${pct(b[0])}未満、★2 ${b[0]}〜${pct(b[1])}、★3 ${b[1]}〜${pct(b[2])}、★4 ${b[2]}〜${pct(b[3])}、★5 ${pct(b[3])}以上`;
const rowEn=(b:readonly number[])=>`★1 under ${pct(b[0])}, ★2 ${b[0]}–${pct(b[1])}, ★3 ${b[1]}–${pct(b[2])}, ★4 ${b[2]}–${pct(b[3])}, ★5 ${pct(b[3])} or more`;
/** The star criteria as published in the app, generated from the owner's table so the text always matches the rule. */
export function starCriteria(locale:'ja'|'en'){
 const {bands,fearBump}=RISK_POLICY.stars,{nas100,sox}=RISK_POLICY.indices;
 if(locale==='ja')return [`★のつけ方`,
  `・${nas100.ja}と${sox.ja}のそれぞれで、終値の動きと取引中のいちばん大きな動きのうち大きいほうで決めます。2つの指標のうち★が多いほうがその日の★です。`,
  `・${nas100.ja}：${rowJa(bands.nas100)}`,`・${sox.ja}：${rowJa(bands.sox)}`,
  `・1社だけのニュースは、その会社の株価の動きで決めます：${rowJa(bands.stock)}`,
  `・恐怖指数が前の日より${fearBump}%以上上がった日は、★を1つ足します。★5が上限です。`,
  `・ニュースが出る前に起きた動きは数えません。見出しと逆の向きに動いたニュースは載せません。`,
  `・どのニュースを載せるかは、毎朝AIが市場のまとめ記事とニュースを読み、市場を動かしたものを3つまで選びます。市場全体のニュースを優先します。★の数はAIでは変えません。`].join('\n');
 return [`How stars are set`,
  `- For each of ${nas100.en} and ${sox.en}, we take the larger of the close move and the largest move during trading. The day's stars are whichever index gives more.`,
  `- ${nas100.en}: ${rowEn(bands.nas100)}`,`- ${sox.en}: ${rowEn(bands.sox)}`,
  `- News about a single company uses that company's own stock: ${rowEn(bands.stock)}`,
  `- On a day the fear index rose ${fearBump}% or more from the day before, one star is added, up to ★5.`,
  `- A move that happened before the news is never counted. A story whose market moved against its headline is not shown.`,
  `- Each morning AI reads market wrap-ups and the news and picks up to three stories that moved the market, market-wide news first. AI never changes the stars.`].join('\n');
}
/** What is shown in place of stars: single-company news, or still waiting for the first close. Null when there are stars. */
export function noStarsLabel(article:{stars:number|null;market:RiskMarket},locale:'ja'|'en'){if(article.stars!==null)return null;const m=article.market;
 // A measurable company story waits for its session like any other; once measured without passing the test it is company news.
 return m.index==='company'&&!(m.company&&m.session&&!m.reading)?RISK_POLICY.company[locale]:RISK_POLICY.waiting[locale];}
/** Waiting stories (no stars yet) never trigger the "reread your rules" action. */
export const riskAction=(stars:number|null)=>{if(stars===null)return 'none';if(!Number.isInteger(stars)||stars<1||stars>5)throw Error('INVALID_STARS');return stars>=RISK_POLICY.reviewMinStars?'review':'none';};
const signed=(n:number,digits:number)=>`${n>0?'+':n<0?'−':''}${Math.abs(n).toFixed(digits)}%`;
/** The index whose move set the stars (the higher; on a tie the one listed first), or a company story's industry basket. */
export function decidingMeasure(m:RiskMarket):RiskMeasure|null{
 const r=m.reading;if(!r)return null;
 if(m.index==='company')return m.company?r[m.company.basket]:null;
 const order:RiskIndex[]=m.index==='sox'?['sox','nas100']:['nas100','sox'];let best:RiskMeasure|null=null,bestStars=0;
 for(const i of order){const x=r[i];if(!x)continue;const n=indexStars(i,x);if(n>bestStars){best=x;bestStars=n;}}
 return best;
}
/** The card's small table (owner, Nov 26 spec §3): two columns, 終値 and 一番下げた時 (一番上げた時 on an up day). The close in white,
 * the intraday extreme in red when below the previous close (green when above). Numbers with − and +, never ▼▲. Rows: the story's
 * index first (single-company news: the stock, then its industry index); for market-wide and chip-sector news on a down day the
 * fear index with its change in the close column and 「−」 in the other. No other text. */
export type ShockRow={label:string;close:string;extreme:string;tone:'down'|'up'|null;fear?:true};
export function shockTable(m:RiskMarket,locale:'ja'|'en'):{close:string;extreme:string;rows:ShockRow[]}|null{
 const r=m.reading;if(!r||(m.index==='company'&&(!m.company||!r.company)))return null;
 const ja=locale==='ja';
 const deciding=decidingMeasure(m),dir=m.index==='company'&&r.company?strongestMove(r.company).changePercent:deciding?strongestMove(deciding).changePercent:0;
 const row=(label:string,close:number,intra:number|undefined):ShockRow=>({label,close:signed(close,1),extreme:intra===undefined?'−':signed(intra,1),tone:intra===undefined||intra===0?null:intra<0?'down':'up'});
 const rows:ShockRow[]=[];
 if(m.index==='company'&&m.company&&r.company)rows.push(row(m.company.ticker,r.company.changePercent,r.company.intraday));
 const order:RiskIndex[]=m.index==='company'?[m.company!.basket]:m.index==='sox'?['sox','nas100']:['nas100','sox'];
 for(const i of order){const x=r[i];if(x)rows.push(row(RISK_POLICY.indices[i][locale],x.changePercent,x.intraday?.changePercent));}
 if(m.index!=='company'&&r.fearChange!==null&&dir<0)rows.push({label:ja?'恐怖指数':'Fear index',close:signed(r.fearChange,0),extreme:'−',tone:null,fear:true});
 return {close:ja?'終値':'Close',extreme:dir>0?(ja?'一番上げた時':'Intraday high'):(ja?'一番下げた時':'Intraday low'),rows};
}
/** The same numbers as text lines (owner mail, AI daily plan facts): 「TP大型株100　終値 −0.6%　一番下げた時 −4.6%」. */
export function readingParts(m:RiskMarket,locale:'ja'|'en'):{text:string;detail?:string}[]{
 const t=shockTable(m,locale);if(!t)return [];const gap=locale==='ja'?'\u3000':'  ';
 return t.rows.map(r=>({text:r.fear||r.extreme==='−'?`${r.label}${gap}${r.close}`:`${r.label}${gap}${t.close} ${r.close}${gap}${t.extreme} ${r.extreme}`}));
}
/** The same lines as plain text. */
export function formatReading(m:RiskMarket,locale:'ja'|'en'):string[]{return readingParts(m,locale).map(l=>l.text+(l.detail??''));}
const CAUSE_TEXT=/^[^<>\u0000\n]{1,40}$/;
export function parseRiskCause(v:unknown):RiskCause|null{if(v===null||v===undefined)return null;const x=v as RiskCause;if(!x||typeof x!=='object'||!['one-off','lasting'].includes(x.kind)||typeof x.ja!=='string'||typeof x.en!=='string'||!CAUSE_TEXT.test(x.ja.trim())||!CAUSE_TEXT.test(x.en.trim()))throw Error('INVALID_CAUSE');return {kind:x.kind,ja:x.ja.trim(),en:x.en.trim()};}
export function riskDate(now=new Date()){return new Date(now.getTime()+9*3600000).toISOString().slice(0,10);}
/** True during the weekday morning run hour (JST): the automatic selection (rizel-daily-review.mjs). */
export function isDailyRunHour(now=new Date()){const jst=new Date(now.getTime()+9*3600000);return ![0,6].includes(jst.getUTCDay())&&jst.getUTCHours()===RISK_POLICY.runHourJst;}
/** True during the publish run hour (JST) of the owner pick: every day (owner, Nov 27: weekends and U.S. holidays included). */
export function isPublishRunHour(now=new Date()){return new Date(now.getTime()+9*3600000).getUTCHours()===RISK_POLICY.runHourJst;}
/** Start of a day's morning run (ms). */
export const dailyRunStart=(day:string)=>Date.parse(`${day}T${String(RISK_POLICY.runHourJst).padStart(2,'0')}:00:00+09:00`);
/** The latest day whose morning run has started (every day, owner Nov 27; risk-store falls back to Friday on a weekend day with no row). */
export function latestRiskDate(now=new Date()){const d=new Date(now.getTime()+9*3600000);if(d.getUTCHours()<RISK_POLICY.runHourJst)d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);}
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
 const cause=parseRiskCause(x.cause),judge=parseRiskJudge(x.judge),impact=parseImpactHints(x.impact),pick=parseRiskPick(x.pick),rizel=parseRiskRizel(x.rizel),stars=pick?x.stars:marketStars(market);
 if(pick&&x.stars===null)throw Error('INVALID_STARS');
 if(x.quoteId!==null&&!/^[a-z0-9_-]{1,60}$/.test(x.quoteId))throw Error('INVALID_QUOTE');return {id:x.id,url:x.url,publishedAt:x.publishedAt,market,stars,ja:parseRiskCopy(x.ja),en:parseRiskCopy(x.en),quoteId:stars!==null&&stars===x.stars?x.quoteId:null,...(cause?{cause}:{}),...(judge?{judge}:{}),...(impact?{impact}:{}),...(pick?{pick}:{}),...(rizel?{rizel}:{})};}
export function parseRiskPick(v:unknown):RiskPick|null{if(v===null||v===undefined)return null;const x=v as RiskPick;if(!x||typeof x!=='object'||!['owner','auto'].includes(x.source))throw Error('INVALID_PICK');return {source:x.source};}
const RIZEL_TEXT=/^[^<>\u0000\n]{1,160}$/;
export function parseRiskRizel(v:unknown):RiskRizel|null{if(v===null||v===undefined)return null;const x=v as RiskRizel;if(!x||typeof x!=='object'||typeof x.ja!=='string'||typeof x.en!=='string'||!RIZEL_TEXT.test(x.ja.trim())||!RIZEL_TEXT.test(x.en.trim())||!['ai','owner'].includes(x.by))throw Error('INVALID_RIZEL');return {ja:x.ja.trim(),en:x.en.trim(),by:x.by};}
const REASON_TEXT=/^[^<>\u0000]{1,160}$/;
export function parseRiskJudge(v:unknown):RiskJudge|null{if(v===null||v===undefined)return null;const x=v as RiskJudge;
 if(!x||typeof x!=='object'||!['ai','rule'].includes(x.source)||!x.reason||typeof x.reason.ja!=='string'||typeof x.reason.en!=='string'||!REASON_TEXT.test(x.reason.ja)||!REASON_TEXT.test(x.reason.en))throw Error('INVALID_JUDGE');
 return {source:x.source,reason:{ja:x.reason.ja,en:x.reason.en}};}
/** Rows written before the Shock Gauge (rubric stars, no market move) are never shown. */
export const isLegacyRiskArticle=(v:unknown)=>!!v&&typeof v==='object'&&!('market' in v);
export function parseQuote(v:unknown):RizelQuote{const x=v as RizelQuote;if(!x||!/^[a-z0-9_-]{1,60}$/.test(x.id)||typeof x.approved!=='boolean'||!Number.isInteger(x.minStars)||!Number.isInteger(x.maxStars)||x.minStars<1||x.maxStars>5||x.minStars>x.maxStars)throw Error('INVALID_QUOTE');for(const locale of ['ja','en'] as const){const c=x[locale];if(!c||typeof c.title!=='string'||!c.title.trim()||c.title.length>200||!Array.isArray(c.reasons)||c.reasons.length>5||!c.reasons.every(t=>typeof t==='string'&&t.length<=400))throw Error('INVALID_QUOTE');}return x;}
/** shownOnly (default): the member feed keeps only measured stories with stars (isShownStory). The owner's own view passes false. */
export function parseRiskFeed(v:unknown,{shownOnly=true}:{shownOnly?:boolean}={}):RiskFeed{const x=v as RiskFeed;if(!x||!['ready','failed','stopped','preparing'].includes(x.state)||!(x.date===null||/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&Number.isFinite(Date.parse(x.date+'T00:00:00Z')))||!Array.isArray(x.articles)||x.articles.length>3||!Array.isArray(x.quotes)||x.quotes.length>100)throw Error('INVALID_FEED');const articles=x.articles.map(parseRiskArticle).filter(a=>!shownOnly||isShownStory(a)),sorted=shownOnly&&!articles.some(a=>a.pick)?byStars(articles):articles,quotes=x.quotes.map(parseQuote).filter(q=>q.approved);if(new Set(articles.map(a=>a.id)).size!==articles.length||x.state!=='ready'&&articles.length)throw Error('INVALID_FEED');return{state:x.state,date:x.date,articles:sorted,quotes};}
