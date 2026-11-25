import {RISK_POLICY} from './risk-policy.ts';
/** Shock Gauge (衝撃度チェッカー) data. Stars come only from the related TP index's actual move (risk-policy.ts);
 * the model writes factual copy and never assigns stars or actions. File/identifier names keep the historic "risk" prefix. */
export type RiskIndex=keyof typeof RISK_POLICY.indices;
/** session: the first U.S. close after the news (ET date); changePercent: that close vs the previous close, rounded to 0.1.
 * index 'company': news about one company. No index measures it, so it never gets stars (session and move stay null). */
export type RiskMarket={index:RiskIndex|'company';session:string|null;changePercent:number|null};
export type RiskCopy={title:string;source:string;content:string;date:string};
export type RiskArticle={id:string;url:string;publishedAt:string;market:RiskMarket;stars:number|null;ja:RiskCopy;en:RiskCopy;quoteId:string|null};
export type RizelQuote={id:string;ja:{title:string;reasons:string[]};en:{title:string;reasons:string[]};minStars:number;maxStars:number;approved:boolean};
export type RiskFeed={state:'ready'|'failed'|'stopped'|'preparing';date:string|null;articles:RiskArticle[];quotes:RizelQuote[]};
/** Lawyer-reviewed disclaimer (Nov 2026, section 6). EN follows the Terms of Service, Article 2(2). */
export const RIZEL_DISCLAIMER={ja:'本サービスと本商品は、情報の提供とご自身で決めたルールの管理を目的としたもので、特定の銘柄の売買や売買の時期をすすめるものではありません。投資の判断は、ご自身でおこなってください。',en:'This service and this product are for providing information and helping you manage the rules you set for yourself. They do not recommend buying or selling any particular stock, or when to buy or sell. Investment decisions are yours to make.'};
/** Every summary ends with this question (lawyer review, Nov 2026). */
export const SUMMARY_QUESTION={ja:'このニュースで、あなたのルールの条件に当てはまるものはありますか？',en:'Does anything in this news meet a condition in your rules?'};
export const RISK_INDICES=Object.keys(RISK_POLICY.indices) as RiskIndex[];
/** Rounded to 0.1 so the stars always agree with the number shown next to them. */
export function roundMove(changePercent:number){if(!Number.isFinite(changePercent)||Math.abs(changePercent)>=100)throw Error('INVALID_MOVE');const r=Math.sign(changePercent)*Math.round(Math.abs(changePercent)*10)/10;return Object.is(r,-0)?0:r;}
/** The published rule: absolute move, rounded to 0.1, against that index's thresholds (risk-policy.ts). */
export function starsFromMove(changePercent:number,index:RiskIndex){const size=Math.abs(roundMove(changePercent));const t=RISK_POLICY.stars.thresholds[index];if(!t)throw Error('INVALID_INDEX');return 1+t.filter(n=>size>=n).length;}
const pct=(n:number)=>`${n}%`;
/** The star criteria as published in the app, generated from the thresholds so the text always matches the rule. */
export function starCriteria(locale:'ja'|'en'){
 const line=(index:RiskIndex)=>{const t=RISK_POLICY.stars.thresholds[index],name=RISK_POLICY.indices[index][locale];
  return locale==='ja'?`${name}：${pct(t[0])}未満★1、${t.map((n,i)=>`${pct(n)}以上★${i+2}`).join('、')}`:`${name}: under ${pct(t[0])} ★1, ${t.map((n,i)=>`${pct(n)} or more ★${i+2}`).join(', ')}`;};
 return locale==='ja'
  ?`★の基準：市場全体のニュースは${RISK_POLICY.indices.nas100.ja}、半導体のニュースは${RISK_POLICY.indices.sox.ja}で測り、ニュースのあと最初の米国市場の終値が前日の終値から何%動いたか（上げ下げを問わず、小数第1位まで）で決めます。${line('nas100')}。${line('sox')}。1社だけのニュースには★をつけません。`
  :`How stars are set: market-wide news is measured on ${RISK_POLICY.indices.nas100.en} and semiconductor news on ${RISK_POLICY.indices.sox.en}, by how far the index closed from the previous close at the first U.S. close after the news (up or down, to one decimal place). ${line('nas100')}. ${line('sox')}. News about a single company gets no stars.`;
}
/** What is shown in place of stars: single-company news, or still waiting for the first close. Null when there are stars. */
export function noStarsLabel(article:{stars:number|null;market:RiskMarket},locale:'ja'|'en'){if(article.stars!==null)return null;return article.market.index==='company'?RISK_POLICY.company[locale]:RISK_POLICY.waiting[locale];}
/** Waiting stories (no stars yet) never trigger the "reread your rules" action. */
export const riskAction=(stars:number|null)=>{if(stars===null)return 'none';if(!Number.isInteger(stars)||stars<1||stars>5)throw Error('INVALID_STARS');return stars>=RISK_POLICY.reviewMinStars?'review':'none';};
/** "TP半導体40 −3.2%" / "TP Semiconductor 40 −3.2%" (true minus sign). Null while waiting. */
export function formatMove(market:RiskMarket,locale:'ja'|'en'){if(market.changePercent===null||market.index==='company')return null;const v=roundMove(market.changePercent),sign=v>0?'+':v<0?'−':'';return `${RISK_POLICY.indices[market.index][locale]} ${sign}${Math.abs(v).toFixed(1)}%`;}
export function riskDate(now=new Date()){return new Date(now.getTime()+9*3600000).toISOString().slice(0,10);}
/** True during the weekday morning run hour (JST). */
export function isDailyRunHour(now=new Date()){const jst=new Date(now.getTime()+9*3600000);return ![0,6].includes(jst.getUTCDay())&&jst.getUTCHours()===RISK_POLICY.runHourJst;}
/** Start of a day's morning run (ms). */
export const dailyRunStart=(day:string)=>Date.parse(`${day}T${String(RISK_POLICY.runHourJst).padStart(2,'0')}:00:00+09:00`);
export function latestRiskDate(now=new Date()){const d=new Date(now.getTime()+9*3600000);if(d.getUTCHours()<RISK_POLICY.runHourJst)d.setUTCDate(d.getUTCDate()-1);while([0,6].includes(d.getUTCDay()))d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);}
export function parseRiskCopy(v:unknown):RiskCopy{if(!v||typeof v!=='object')throw Error('INVALID_COPY');const x=v as Record<string,unknown>;for(const k of ['title','source','content','date'])if(typeof x[k]!=='string'||!(x[k] as string).trim()||[...x[k] as string].length>700||/[<>\u0000]/.test(x[k] as string))throw Error('INVALID_COPY');return {title:x.title as string,source:x.source as string,content:x.content as string,date:x.date as string};}
const validSession=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
export function parseRiskMarket(v:unknown):RiskMarket{const x=v as RiskMarket;if(!x||typeof x!=='object')throw Error('INVALID_MARKET');
 if(x.index==='company'){if(x.session!==null||x.changePercent!==null)throw Error('INVALID_MARKET');return {index:'company',session:null,changePercent:null};}
 if(!RISK_INDICES.includes(x.index))throw Error('INVALID_MARKET');
 if(x.changePercent===null){if(x.session!==null&&!validSession(x.session))throw Error('INVALID_MARKET');return {index:x.index,session:x.session,changePercent:null};}
 if(!validSession(x.session)||typeof x.changePercent!=='number'||roundMove(x.changePercent)!==x.changePercent)throw Error('INVALID_MARKET');return {index:x.index,session:x.session,changePercent:x.changePercent};}
/** Stars always follow the CURRENT published rule for the stored move (Nov 25: thresholds per index), so a stored day shows
 * the stars the published criteria give; a story without a move has no stars. A RIZEL line chosen for other stars is dropped. */
export function parseRiskArticle(v:unknown):RiskArticle{if(!v||typeof v!=='object')throw Error('INVALID_ARTICLE');const x=v as RiskArticle;if(!/^[a-f0-9]{64}$/.test(x.id)||!Number.isFinite(Date.parse(x.publishedAt)))throw Error('INVALID_ARTICLE');const u=new URL(x.url);if(u.protocol!=='https:'||u.username||u.password||u.href.length>2048)throw Error('INVALID_URL');
 const market=parseRiskMarket(x.market);if(x.stars!==null&&(!Number.isInteger(x.stars)||x.stars<1||x.stars>5))throw Error('INVALID_STARS');
 const stars=market.changePercent===null||market.index==='company'?null:starsFromMove(market.changePercent,market.index);
 if(x.quoteId!==null&&!/^[a-z0-9_-]{1,60}$/.test(x.quoteId))throw Error('INVALID_QUOTE');return {id:x.id,url:x.url,publishedAt:x.publishedAt,market,stars,ja:parseRiskCopy(x.ja),en:parseRiskCopy(x.en),quoteId:stars!==null&&stars===x.stars?x.quoteId:null};}
/** Rows written before the Shock Gauge (rubric stars, no market move) are never shown. */
export const isLegacyRiskArticle=(v:unknown)=>!!v&&typeof v==='object'&&!('market' in v);
export function parseQuote(v:unknown):RizelQuote{const x=v as RizelQuote;if(!x||!/^[a-z0-9_-]{1,60}$/.test(x.id)||typeof x.approved!=='boolean'||!Number.isInteger(x.minStars)||!Number.isInteger(x.maxStars)||x.minStars<1||x.maxStars>5||x.minStars>x.maxStars)throw Error('INVALID_QUOTE');for(const locale of ['ja','en'] as const){const c=x[locale];if(!c||typeof c.title!=='string'||!c.title.trim()||c.title.length>200||!Array.isArray(c.reasons)||c.reasons.length>5||!c.reasons.every(t=>typeof t==='string'&&t.length<=400))throw Error('INVALID_QUOTE');}return x;}
export function parseRiskFeed(v:unknown):RiskFeed{const x=v as RiskFeed;if(!x||!['ready','failed','stopped','preparing'].includes(x.state)||!(x.date===null||/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&Number.isFinite(Date.parse(x.date+'T00:00:00Z')))||!Array.isArray(x.articles)||x.articles.length>3||!Array.isArray(x.quotes)||x.quotes.length>100)throw Error('INVALID_FEED');const articles=x.articles.map(parseRiskArticle),quotes=x.quotes.map(parseQuote).filter(q=>q.approved);if(new Set(articles.map(a=>a.id)).size!==articles.length||x.state!=='ready'&&articles.length)throw Error('INVALID_FEED');return{state:x.state,date:x.date,articles,quotes};}
