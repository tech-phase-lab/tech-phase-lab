import {RISK_POLICY} from './risk-policy.ts';
/** Shock Gauge (衝撃度チェッカー) data. Stars come only from the related TP index's actual move (risk-policy.ts);
 * the model writes factual copy and never assigns stars or actions. File/identifier names keep the historic "risk" prefix. */
export type RiskIndex=keyof typeof RISK_POLICY.indices;
/** One index's measured shock (risk-policy.ts): its move in % (0.1), how many times its usual move (0.1), and how many of
 * its stocks moved the same way of those priced. */
export type RiskMeasure={changePercent:number;multiple:number;same:number;total:number};
/** Both indices measured over the same span (from the close of `from`), and TP恐怖指数's change over it in whole %. */
export type RiskReading={from:string;nas100:RiskMeasure|null;sox:RiskMeasure|null;fearChange:number|null};
/** session: the first U.S. close after the news (ET date). reading: both indices measured on that close (null = waiting).
 * index: the story's scope index, shown first; 'company' = one company's news, never measured (no stars). */
export type RiskMarket={index:RiskIndex|'company';session:string|null;reading:RiskReading|null};
/** The inputs of one level check. */
export type RiskShock={multiple:number;same:number;total:number;fearChange:number|null};
export type RiskCopy={title:string;source:string;content:string;date:string};
/** The model's reading of the CAUSE, from the article text only (owner, Nov 25): one-off (−1 star) or lasting (+1 star), with
 * the cause named in a few words. null = neither is clear (no change). */
export type RiskCause={kind:'one-off'|'lasting';ja:string;en:string};
export type RiskArticle={id:string;url:string;publishedAt:string;market:RiskMarket;stars:number|null;ja:RiskCopy;en:RiskCopy;quoteId:string|null;cause?:RiskCause|null};
export type RizelQuote={id:string;ja:{title:string;reasons:string[]};en:{title:string;reasons:string[]};minStars:number;maxStars:number;approved:boolean};
export type RiskFeed={state:'ready'|'failed'|'stopped'|'preparing';date:string|null;articles:RiskArticle[];quotes:RizelQuote[]};
/** Lawyer-reviewed disclaimer (Nov 2026, section 6). EN follows the Terms of Service, Article 2(2). */
export const RIZEL_DISCLAIMER={ja:'本サービスと本商品は、情報の提供とご自身で決めたルールの管理を目的としたもので、特定の銘柄の売買や売買の時期をすすめるものではありません。投資の判断は、ご自身でおこなってください。',en:'This service and this product are for providing information and helping you manage the rules you set for yourself. They do not recommend buying or selling any particular stock, or when to buy or sell. Investment decisions are yours to make.'};
/** Every summary ends with this question (lawyer review, Nov 2026). */
export const SUMMARY_QUESTION={ja:'このニュースで、あなたのルールの条件に当てはまるものはありますか？',en:'Does anything in this news meet a condition in your rules?'};
export const RISK_INDICES=Object.keys(RISK_POLICY.indices) as RiskIndex[];
/** Rounded to 0.1 so the stars always agree with the number shown next to them. */
export function roundMove(changePercent:number){if(!Number.isFinite(changePercent)||Math.abs(changePercent)>=100)throw Error('INVALID_MOVE');const r=Math.sign(changePercent)*Math.round(Math.abs(changePercent)*10)/10;return Object.is(r,-0)?0:r;}
/** The published rule (risk-policy.ts): the highest level whose every condition holds, else ★1. */
export function starsFromShock(shock:RiskShock){
 for(const level of RISK_POLICY.stars.levels){
  if(shock.multiple<level.multiple)continue;
  if(level.breadth!==null&&shock.same*100<level.breadth*shock.total)continue;
  if(level.fear!==null&&(shock.fearChange===null||shock.fearChange<level.fear))continue;
  return level.stars;
 }
 return 1;
}
const tenth=(n:number)=>Math.round(n*10)/10;
const wholePercent=(level:number,previous:number)=>{const v=Math.round(100*(level/previous-1));return Object.is(v,-0)?0:v;};
/** One index on the first close: the move, its multiple of the usual daily move (0.1), and the stocks that moved the same way. */
export function measureDay(reading:{changePercent:number;typicalPercent:number;up:number;down:number;total:number}):RiskMeasure{
 if(!(reading.typicalPercent>0)||!Number.isInteger(reading.total)||reading.total<1)throw Error('INVALID_SHOCK');
 const changePercent=roundMove(reading.changePercent);
 return {changePercent,multiple:tenth(Math.abs(reading.changePercent)/reading.typicalPercent),same:changePercent<0?reading.down:changePercent>0?reading.up:0,total:reading.total};
}
export const fearChangeOf=(fear:{level:number;previousLevel:number}|null)=>fear&&fear.level>0&&fear.previousLevel>0?wholePercent(fear.level,fear.previousLevel):null;
/** A reading's stars: the stronger of the two indices (each by the published levels), null when neither was measured. */
export function readingStars(r:RiskReading|null){
 if(!r)return null;const each=[r.nas100,r.sox].filter((m):m is RiskMeasure=>!!m).map(m=>starsFromShock({...m,fearChange:r.fearChange}));
 return each.length?Math.max(...each):null;
}
/** The market's stars: the stronger of the two indices on the story's first close; none for one company's news or while waiting. */
export const marketStars=(m:RiskMarket)=>m.index==='company'?null:readingStars(m.reading);
/** The stars shown: the market's stars, one lower when the cause looks one-off, one higher when it looks lasting, within 1–5.
 * A lasting cause can reach ★5 only from a market ★4 (never from the cause alone). */
export function causeStars(market:number|null,cause:RiskCause|null|undefined){
 if(market===null)return null;if(!cause)return market;
 return cause.kind==='one-off'?Math.max(1,market-1):Math.min(5,market+1);
}
/** The short, plain explanation behind the small 「i」 next to the stars (owner, Nov 25), above the exact levels (starCriteria). */
export function starSummary(locale:'ja'|'en'){const {nas100,sox}=RISK_POLICY.indices;return locale==='ja'
 ?`★は、ニュースのあとの${nas100.ja}と${sox.ja}の実際の動き（いつもの何倍動いたか・同じ向きに動いた会社の割合・恐怖指数）と、記事の内容から一過性かどうかを吟味して算出しています。1社だけのニュースには★をつけません。`
 :`Stars are calculated from how ${nas100.en} and ${sox.en} actually moved after the news (how many times their usual move, the share of stocks moving the same way, the fear index) and from the article, weighing whether the cause looks one-off. News about a single company gets no stars.`;}
/** The accessible name of the small 「i」 that opens the criteria. */
export const STAR_INFO_LABEL={ja:'★のつけ方',en:'How stars are set'} as const;
const wari=(n:number)=>n%10===0?`${n/10}割`:`${n}%`;
/** The star criteria as published in the app, in plain words, generated from the levels so the text always matches the rule. */
export function starCriteria(locale:'ja'|'en'){
 const {levels,typicalDays}=RISK_POLICY.stars,{nas100,sox}=RISK_POLICY.indices;
 if(locale==='ja'){
  const part=(l:typeof levels[number])=>[`いつもの${l.multiple}倍以上動いた`,l.breadth!==null?`${wari(l.breadth)}以上の会社が同じ向きに動いた`:null,l.fear!==null?`恐怖指数が${wari(l.fear)}以上上がった`:null].filter(Boolean).join('、');
  return [`★のつけ方`,
   `・ニュースのあと、アメリカの市場が閉まったときの値で、${nas100.ja}と${sox.ja}の両方を見ます。大きく動いたほうで★を決めます。`,
   ...levels.map(l=>`・★${l.stars}：${part(l)}`),`・★1：それより小さい動き`,
   `・「いつもの」は、市場が開いていた直前の${typicalDays}日の、1日の動きの大きさのまん中の値です。`,
   `・そのうえで、AIが記事の内容だけを読み、原因が一過性とみられるときは★を1つ下げ、長引きやすいとみられるときは1つ上げます。★5になるのは、市場の動きだけで★4以上のときだけです。どちらとも言えないときは変えません。`,
   `・1社だけのニュースには★をつけません。`].join('\n');
 }
 const part=(l:typeof levels[number])=>[`moved ${l.multiple} times its usual move or more`,l.breadth!==null?`${l.breadth}% or more of its stocks moved the same way`:null,l.fear!==null?`the fear index rose ${l.fear}% or more`:null].filter(Boolean).join(', ');
 return [`How stars are set`,
  `- After the news, we look at both ${nas100.en} and ${sox.en} at the U.S. market close. The bigger shock sets the stars.`,
  ...levels.map(l=>`- ★${l.stars}: ${part(l)}`),`- ★1: anything smaller`,
  `- "Usual" is the middle size of its daily moves over the previous ${typicalDays} trading days.`,
  `- Then AI reads only the article: if the cause looks one-off, the stars go down by one; if it looks lasting, up by one (★5 only when the market move alone is ★4 or more). If neither is clear, nothing changes.`,
  `- News about a single company gets no stars.`].join('\n');
}
/** What is shown in place of stars: single-company news, or still waiting for the first close. Null when there are stars. */
export function noStarsLabel(article:{stars:number|null;market:RiskMarket},locale:'ja'|'en'){if(article.stars!==null)return null;return article.market.index==='company'?RISK_POLICY.company[locale]:RISK_POLICY.waiting[locale];}
/** Waiting stories (no stars yet) never trigger the "reread your rules" action. */
export const riskAction=(stars:number|null)=>{if(stars===null)return 'none';if(!Number.isInteger(stars)||stars<1||stars>5)throw Error('INVALID_STARS');return stars>=RISK_POLICY.reviewMinStars?'review':'none';};
const signed=(n:number,digits:number)=>`${n>0?'+':n<0?'−':''}${Math.abs(n).toFixed(digits)}%`;
/** The lines under the stars, the story's index first, then the fear index. Each index line is split into the move and its
 * parenthetical, which the screens set in slightly smaller type so the line fits on one phone line (owner, Nov 25):
 * 「TP半導体40 −8.5%」+「（いつもの3.8倍・39/40社が下落）」, 「TP大型株100 −1.5%」+「（いつもの2.0倍・47/99社が下落）」, 「恐怖指数 0%」. */
export function readingParts(m:RiskMarket,locale:'ja'|'en'):{text:string;detail?:string}[]{
 const r=m.reading;if(!r||m.index==='company'||readingStars(r)===null)return [];
 const order:RiskIndex[]=m.index==='sox'?['sox','nas100']:['nas100','sox'];
 const lines:{text:string;detail?:string}[]=order.flatMap(i=>{const x=r[i];if(!x)return [];const name=RISK_POLICY.indices[i][locale],down=x.changePercent<0;
  return [{text:`${name} ${signed(x.changePercent,1)}`,detail:locale==='ja'?`（いつもの${x.multiple.toFixed(1)}倍・${x.same}/${x.total}社が${down?'下落':'上昇'}）`
   :` (${x.multiple.toFixed(1)}× usual · ${x.same}/${x.total} ${down?'down':'up'})`}];});
 if(r.fearChange!==null)lines.push({text:locale==='ja'?`恐怖指数 ${signed(r.fearChange,0)}`:`Fear index ${signed(r.fearChange,0)}`});
 return lines;
}
/** The story's own index move on its first close (the other index when its own was not measured); null while waiting. */
export function storyChange(m:RiskMarket):number|null{const r=m.reading;if(!r||m.index==='company')return null;const own=m.index==='sox'?r.sox:r.nas100,other=m.index==='sox'?r.nas100:r.sox;return (own??other)?.changePercent??null;}
/** Home (owner, Nov 25: 01 ホーム): on a day the story's index went UP, the fear index line is left out. */
export function homeReadingParts(m:RiskMarket,locale:'ja'|'en'){const parts=readingParts(m,locale);return (storyChange(m)??0)>0&&m.reading?.fearChange!=null?parts.slice(0,-1):parts;}
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
function parseMeasure(v:unknown):RiskMeasure|null{if(v===null)return null;const x=v as RiskMeasure;if(!x||typeof x!=='object'||!isTenth(x.changePercent,-99.9,999)||!isTenth(x.multiple,0,100)||!count(x.same)||!count(x.total)||x.total<1||x.same>x.total)throw Error('INVALID_SHOCK');return {changePercent:x.changePercent||0,multiple:x.multiple,same:x.same,total:x.total};}
function parseReading(v:unknown):RiskReading{const x=v as RiskReading;if(!x||typeof x!=='object'||!validSession(x.from)||!(x.fearChange===null||Number.isInteger(x.fearChange)&&Math.abs(x.fearChange)<1000))throw Error('INVALID_SHOCK');
 const r={from:x.from,nas100:parseMeasure(x.nas100??null),sox:parseMeasure(x.sox??null),fearChange:x.fearChange||(x.fearChange===null?null:0)};if(!r.nas100&&!r.sox)throw Error('INVALID_SHOCK');return r;}
/** A story stored before Nov 25 (one index's move, no measured shock) is read as still waiting: it is measured again. */
export function parseRiskMarket(v:unknown):RiskMarket{const x=v as RiskMarket;if(!x||typeof x!=='object')throw Error('INVALID_MARKET');
 if(x.index==='company'){if(x.session!==null||x.reading)throw Error('INVALID_MARKET');return {index:'company',session:null,reading:null};}
 if(!RISK_INDICES.includes(x.index)||!(x.session===null||validSession(x.session)))throw Error('INVALID_MARKET');
 if(!x.reading)return {index:x.index,session:x.session,reading:null};
 const reading=parseReading(x.reading);if(x.session===null||reading.from>=x.session)throw Error('INVALID_MARKET');
 return {index:x.index,session:x.session,reading};}
/** Stars always follow the CURRENT published rule for the stored readings (risk-policy.ts); a story without a reading has none.
 * A RIZEL line chosen for other stars is dropped. */
export function parseRiskArticle(v:unknown):RiskArticle{if(!v||typeof v!=='object')throw Error('INVALID_ARTICLE');const x=v as RiskArticle;if(!/^[a-f0-9]{64}$/.test(x.id)||!Number.isFinite(Date.parse(x.publishedAt)))throw Error('INVALID_ARTICLE');const u=new URL(x.url);if(u.protocol!=='https:'||u.username||u.password||u.href.length>2048)throw Error('INVALID_URL');
 const market=parseRiskMarket(x.market);if(x.stars!==null&&(!Number.isInteger(x.stars)||x.stars<1||x.stars>5))throw Error('INVALID_STARS');
 const cause=parseRiskCause(x.cause),stars=causeStars(marketStars(market),cause);
 if(x.quoteId!==null&&!/^[a-z0-9_-]{1,60}$/.test(x.quoteId))throw Error('INVALID_QUOTE');return {id:x.id,url:x.url,publishedAt:x.publishedAt,market,stars,ja:parseRiskCopy(x.ja),en:parseRiskCopy(x.en),quoteId:stars!==null&&stars===x.stars?x.quoteId:null,...(cause?{cause}:{})};}
/** Rows written before the Shock Gauge (rubric stars, no market move) are never shown. */
export const isLegacyRiskArticle=(v:unknown)=>!!v&&typeof v==='object'&&!('market' in v);
export function parseQuote(v:unknown):RizelQuote{const x=v as RizelQuote;if(!x||!/^[a-z0-9_-]{1,60}$/.test(x.id)||typeof x.approved!=='boolean'||!Number.isInteger(x.minStars)||!Number.isInteger(x.maxStars)||x.minStars<1||x.maxStars>5||x.minStars>x.maxStars)throw Error('INVALID_QUOTE');for(const locale of ['ja','en'] as const){const c=x[locale];if(!c||typeof c.title!=='string'||!c.title.trim()||c.title.length>200||!Array.isArray(c.reasons)||c.reasons.length>5||!c.reasons.every(t=>typeof t==='string'&&t.length<=400))throw Error('INVALID_QUOTE');}return x;}
export function parseRiskFeed(v:unknown):RiskFeed{const x=v as RiskFeed;if(!x||!['ready','failed','stopped','preparing'].includes(x.state)||!(x.date===null||/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&Number.isFinite(Date.parse(x.date+'T00:00:00Z')))||!Array.isArray(x.articles)||x.articles.length>3||!Array.isArray(x.quotes)||x.quotes.length>100)throw Error('INVALID_FEED');const articles=x.articles.map(parseRiskArticle),quotes=x.quotes.map(parseQuote).filter(q=>q.approved);if(new Set(articles.map(a=>a.id)).size!==articles.length||x.state!=='ready'&&articles.length)throw Error('INVALID_FEED');return{state:x.state,date:x.date,articles,quotes};}
