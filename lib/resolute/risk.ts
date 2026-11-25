import {RISK_POLICY} from './risk-policy.ts';
/** Shock Gauge (衝撃度チェッカー) data. Stars come only from the related TP index's actual move (risk-policy.ts);
 * the model writes factual copy and never assigns stars or actions. File/identifier names keep the historic "risk" prefix. */
export type RiskIndex=keyof typeof RISK_POLICY.indices;
/** session: the first U.S. close after the news (ET date); changePercent: that close vs the previous close, rounded to 0.1.
 * index 'company': news about one company. No index measures it, so it never gets stars (session and move stay null). */
export type RiskMarket={index:RiskIndex|'company';session:string|null;changePercent:number|null;shock:RiskShock|null};
/** The measured shock of that close (risk-policy.ts): multiple of the typical move (0.1), constituents that moved the same way of
 * those priced, TP恐怖指数 change in whole % (null when the fear index has no reading that day). */
export type RiskShock={multiple:number;same:number;total:number;fearChange:number|null};
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
/** Builds the stored shock from the thermometer's readings, rounded exactly as shown (so the stars match the numbers on screen). */
export function measureShock(changePercent:number,reading:{typicalPercent:number;up:number;down:number;total:number},fear:{level:number;previousLevel:number}|null):RiskShock{
 const move=roundMove(changePercent);
 if(!(reading.typicalPercent>0)||!Number.isInteger(reading.total)||reading.total<1)throw Error('INVALID_SHOCK');
 const multiple=Math.round(Math.abs(changePercent)/reading.typicalPercent*10)/10;
 const same=move<0?reading.down:move>0?reading.up:0;
 const fearChange=fear&&fear.previousLevel>0&&fear.level>0?Math.round(100*(fear.level/fear.previousLevel-1)):null;
 return {multiple,same,total:reading.total,fearChange:Object.is(fearChange,-0)?0:fearChange};
}
/** The star criteria as published in the app, generated from the levels so the text always matches the rule. */
export function starCriteria(locale:'ja'|'en'){
 const levels=RISK_POLICY.stars.levels,days=RISK_POLICY.stars.typicalDays,{nas100,sox}=RISK_POLICY.indices;
 const part=(l:typeof levels[number])=>locale==='ja'
  ?[`${l.multiple}倍以上`,l.breadth!==null?`${l.breadth}%以上`:null,l.fear!==null?`恐怖指数+${l.fear}%以上`:null].filter(Boolean).join('・')
  :[`${l.multiple}× or more`,l.breadth!==null?`${l.breadth}% or more`:null,l.fear!==null?`fear index +${l.fear}% or more`:null].filter(Boolean).join(', ');
 return locale==='ja'
  ?`★の決め方：市場全体のニュースは${nas100.ja}、半導体のニュースは${sox.ja}を、ニュースのあと最初の米国市場の終値で測ります。①ふだんの何倍動いたか（ふだん＝直前${days}営業日の1日の値動きの大きさの中央値）②構成銘柄のうち同じ向きに動いた割合 ③TP恐怖指数の上昇率。${levels.map(l=>`★${l.stars}：${part(l)}`).join('。')}。それ以外は★1。1社だけのニュースには★をつけません。`
  :`How stars are set: market-wide news is measured on ${nas100.en} and semiconductor news on ${sox.en}, at the first U.S. close after the news. (1) How many times its typical move the index moved (typical = the median size of its daily moves over the previous ${days} sessions). (2) The share of its stocks that moved the same way. (3) The rise in the TP Fear Index. ${levels.map(l=>`★${l.stars}: ${part(l)}`).join('. ')}. Otherwise ★1. News about a single company gets no stars.`;
}
/** What is shown in place of stars: single-company news, or still waiting for the first close. Null when there are stars. */
export function noStarsLabel(article:{stars:number|null;market:RiskMarket},locale:'ja'|'en'){if(article.stars!==null)return null;return article.market.index==='company'?RISK_POLICY.company[locale]:RISK_POLICY.waiting[locale];}
/** Waiting stories (no stars yet) never trigger the "reread your rules" action. */
export const riskAction=(stars:number|null)=>{if(stars===null)return 'none';if(!Number.isInteger(stars)||stars<1||stars>5)throw Error('INVALID_STARS');return stars>=RISK_POLICY.reviewMinStars?'review':'none';};
/** "TP半導体40 −3.2%" / "TP Semiconductor 40 −3.2%" (true minus sign). Null while waiting. */
/** "TP半導体40 −8.5%" / "TP Semiconductor 40 −8.5%" (true minus sign). Null while waiting. */
export function formatMove(market:RiskMarket,locale:'ja'|'en'){if(market.changePercent===null||market.index==='company')return null;const v=roundMove(market.changePercent),sign=v>0?'+':v<0?'−':'';return `${RISK_POLICY.indices[market.index][locale]} ${sign}${Math.abs(v).toFixed(1)}%`;}
/** What drove the stars, shown next to them: 「ふだんの3.2倍の下げ・40社中37社が下落・恐怖指数+18%」. Null while waiting. */
export function formatShock(market:RiskMarket,locale:'ja'|'en'){
 const s=market.shock;if(!s||market.changePercent===null)return null;const down=market.changePercent<0;
 const f=s.fearChange===null?null:`${s.fearChange>0?'+':s.fearChange<0?'−':''}${Math.abs(s.fearChange)}%`;
 return locale==='ja'
  ?[`ふだんの${s.multiple.toFixed(1)}倍の${down?'下げ':'上げ'}`,`${s.total}社中${s.same}社が${down?'下落':'上昇'}`,f?`恐怖指数${f}`:null].filter(Boolean).join('・')
  :[`${s.multiple.toFixed(1)}× its typical move`,`${s.same} of ${s.total} stocks ${down?'down':'up'}`,f?`fear index ${f}`:null].filter(Boolean).join(' · ');
}
export function riskDate(now=new Date()){return new Date(now.getTime()+9*3600000).toISOString().slice(0,10);}
/** True during the weekday morning run hour (JST). */
export function isDailyRunHour(now=new Date()){const jst=new Date(now.getTime()+9*3600000);return ![0,6].includes(jst.getUTCDay())&&jst.getUTCHours()===RISK_POLICY.runHourJst;}
/** Start of a day's morning run (ms). */
export const dailyRunStart=(day:string)=>Date.parse(`${day}T${String(RISK_POLICY.runHourJst).padStart(2,'0')}:00:00+09:00`);
export function latestRiskDate(now=new Date()){const d=new Date(now.getTime()+9*3600000);if(d.getUTCHours()<RISK_POLICY.runHourJst)d.setUTCDate(d.getUTCDate()-1);while([0,6].includes(d.getUTCDay()))d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);}
export function parseRiskCopy(v:unknown):RiskCopy{if(!v||typeof v!=='object')throw Error('INVALID_COPY');const x=v as Record<string,unknown>;for(const k of ['title','source','content','date'])if(typeof x[k]!=='string'||!(x[k] as string).trim()||[...x[k] as string].length>700||/[<>\u0000]/.test(x[k] as string))throw Error('INVALID_COPY');return {title:x.title as string,source:x.source as string,content:x.content as string,date:x.date as string};}
const validSession=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const count=(v:unknown)=>Number.isInteger(v)&&(v as number)>=0&&(v as number)<=500;
export function parseRiskShock(v:unknown):RiskShock{const x=v as RiskShock;if(!x||typeof x!=='object'||typeof x.multiple!=='number'||!Number.isFinite(x.multiple)||x.multiple<0||x.multiple>100||Math.round(x.multiple*10)/10!==x.multiple||!count(x.same)||!count(x.total)||x.total<1||x.same>x.total||!(x.fearChange===null||Number.isInteger(x.fearChange)&&Math.abs(x.fearChange)<1000))throw Error('INVALID_SHOCK');return {multiple:x.multiple,same:x.same,total:x.total,fearChange:Object.is(x.fearChange,-0)?0:x.fearChange};}
/** A stored close without its measured shock (rows saved before Nov 25) is read as still waiting: it is measured again. */
export function parseRiskMarket(v:unknown):RiskMarket{const x=v as RiskMarket;if(!x||typeof x!=='object')throw Error('INVALID_MARKET');
 if(x.index==='company'){if(x.session!==null||x.changePercent!==null||x.shock)throw Error('INVALID_MARKET');return {index:'company',session:null,changePercent:null,shock:null};}
 if(!RISK_INDICES.includes(x.index))throw Error('INVALID_MARKET');
 if(x.changePercent!==null&&!x.shock){if(x.session!==null&&!validSession(x.session))throw Error('INVALID_MARKET');return {index:x.index,session:x.session,changePercent:null,shock:null};}
 if(x.changePercent===null){if(x.session!==null&&!validSession(x.session))throw Error('INVALID_MARKET');return {index:x.index,session:x.session,changePercent:null,shock:null};}
 if(!validSession(x.session)||typeof x.changePercent!=='number'||roundMove(x.changePercent)!==x.changePercent)throw Error('INVALID_MARKET');return {index:x.index,session:x.session,changePercent:x.changePercent,shock:parseRiskShock(x.shock)};}
/** Stars always follow the CURRENT published rule for the stored shock (risk-policy.ts), so a stored day shows the stars the
 * published criteria give; a story without a measured shock has no stars. A RIZEL line chosen for other stars is dropped. */
export function parseRiskArticle(v:unknown):RiskArticle{if(!v||typeof v!=='object')throw Error('INVALID_ARTICLE');const x=v as RiskArticle;if(!/^[a-f0-9]{64}$/.test(x.id)||!Number.isFinite(Date.parse(x.publishedAt)))throw Error('INVALID_ARTICLE');const u=new URL(x.url);if(u.protocol!=='https:'||u.username||u.password||u.href.length>2048)throw Error('INVALID_URL');
 const market=parseRiskMarket(x.market);if(x.stars!==null&&(!Number.isInteger(x.stars)||x.stars<1||x.stars>5))throw Error('INVALID_STARS');
 const stars=market.shock===null?null:starsFromShock(market.shock);
 if(x.quoteId!==null&&!/^[a-z0-9_-]{1,60}$/.test(x.quoteId))throw Error('INVALID_QUOTE');return {id:x.id,url:x.url,publishedAt:x.publishedAt,market,stars,ja:parseRiskCopy(x.ja),en:parseRiskCopy(x.en),quoteId:stars!==null&&stars===x.stars?x.quoteId:null};}
/** Rows written before the Shock Gauge (rubric stars, no market move) are never shown. */
export const isLegacyRiskArticle=(v:unknown)=>!!v&&typeof v==='object'&&!('market' in v);
export function parseQuote(v:unknown):RizelQuote{const x=v as RizelQuote;if(!x||!/^[a-z0-9_-]{1,60}$/.test(x.id)||typeof x.approved!=='boolean'||!Number.isInteger(x.minStars)||!Number.isInteger(x.maxStars)||x.minStars<1||x.maxStars>5||x.minStars>x.maxStars)throw Error('INVALID_QUOTE');for(const locale of ['ja','en'] as const){const c=x[locale];if(!c||typeof c.title!=='string'||!c.title.trim()||c.title.length>200||!Array.isArray(c.reasons)||c.reasons.length>5||!c.reasons.every(t=>typeof t==='string'&&t.length<=400))throw Error('INVALID_QUOTE');}return x;}
export function parseRiskFeed(v:unknown):RiskFeed{const x=v as RiskFeed;if(!x||!['ready','failed','stopped','preparing'].includes(x.state)||!(x.date===null||/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&Number.isFinite(Date.parse(x.date+'T00:00:00Z')))||!Array.isArray(x.articles)||x.articles.length>3||!Array.isArray(x.quotes)||x.quotes.length>100)throw Error('INVALID_FEED');const articles=x.articles.map(parseRiskArticle),quotes=x.quotes.map(parseQuote).filter(q=>q.approved);if(new Set(articles.map(a=>a.id)).size!==articles.length||x.state!=='ready'&&articles.length)throw Error('INVALID_FEED');return{state:x.state,date:x.date,articles,quotes};}
