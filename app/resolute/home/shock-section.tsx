"use client";
import {useState,type CSSProperties} from 'react';
import {noStarsLabel,type RiskArticle,type RiskFeed,type RizelQuote} from '@/lib/resolute/risk';
import {storyImpact,type ImpactMember} from '@/lib/resolute/impact';
import {ShockBadge,ImpactGauge,ShockTableView,starColor} from '../features/shock-card';
import {RISK_PREVIEW_DETAILS} from '@/lib/resolute/risk-preview';
import {FirstLineMeter,useFirstLine} from '../news/first-line-meter';
import s from './reference.module.css';

/** The RIZEL line the feed assigned to a story. The frontend proxy passes approved lines to members only once
 * RESOLUTE_RIZEL_LINE_PUBLISHED is on (owner accounts always; lib/resolute/rizel-line.ts), so an empty list hides the line.
 * Display samples never show one. */
export function assignedQuote(feed:RiskFeed,article:RiskArticle,sample:boolean):RizelQuote|undefined{
 return !sample&&article.quoteId?feed.quotes.find(q=>q.id===article.quoteId&&q.approved):undefined;
}
const headline=(a:RiskArticle,locale:'ja'|'en',sample:boolean)=>sample?(RISK_PREVIEW_DETAILS[a.id]?.[locale==='en'?'homeEn':'homeJa']??a[locale].title):a[locale].title;

/** リゼルの一言 under a home story: the line's title only (the reasons are on the detail). Absent when no line is assigned. A story's own
 * note (owner pick) is the whole title, its line breaks shown. */
export function RizelSay({quote,locale}:{quote:RizelQuote|undefined;locale:'ja'|'en'}){
 if(!quote)return null;
 return <div className={s.say}><img src="/rizel-avatar.webp" alt="" width={40} height={40}/><div><small>{locale==='en'?'A word from RIZEL':'リゼルの一言'}</small><p style={{whiteSpace:'pre-line'}}>{quote[locale].title}</p></div></div>;
}

/** Phone (owner, Nov 26 spec §3): each story as one card, top to bottom: headline, ★ badge and stars, あなたへの影響, the small table,
 * リゼルの一言 (only when there is one). The left edge is red for ★4–5, gold for ★1–3. */
export function ShockList({feed,locale,sample,member}:{feed:RiskFeed;locale:'ja'|'en';sample:boolean;member?:ImpactMember}){
 return <ul className={s.news}>{feed.articles.map(a=><li key={a.id} className={s.shockItem} style={{'--c':starColor(a.stars)} as CSSProperties}>
  <span className={s.headline}>{headline(a,locale,sample)}</span>
  {a.stars!==null?<ShockBadge stars={a.stars} locale={locale}/>:<span className={s.waiting}>{noStarsLabel(a,locale)}</span>}
  <ImpactGauge impact={member?storyImpact(a.impact,member):undefined} locale={locale}/>
  <ShockTableView market={a.market} locale={locale}/>
  <RizelSay quote={assignedQuote(feed,a,sample)} locale={locale}/>
 </li>)}</ul>;
}

/** PC (owner, Nov 26 spec §5): up to three cards side by side, each top to bottom: headline, ★, あなたへの影響, table, リゼルの一言,
 * 「くわしく ▾」. Subgrid rows keep the ★ row, the impact row, the table and the line above リゼル level across the cards (a one-line
 * and a two-line headline never shift the rows below), and the cards end at the same height, also with one or two cards. */
export function ShockCards({feed,locale,sample,member}:{feed:RiskFeed;locale:'ja'|'en';sample:boolean;member?:ImpactMember}){
 const en=locale==='en',[open,setOpen]=useState<string|null>(null);
 const article=feed.articles.find(a=>a.id===open)??null,quote=article?assignedQuote(feed,article,sample):undefined;
 const firstLine=useFirstLine(!!article&&!sample);
 return <>
  <div className={s.shockGrid}>{feed.articles.slice(0,3).map(a=>{
   const q=assignedQuote(feed,a,sample),isOpen=a.id===open;
   return <article key={a.id} className={s.shockCard} data-open={isOpen||undefined} style={{'--c':starColor(a.stars)} as CSSProperties}>
    <h3 className={s.cardHead}>{headline(a,locale,sample)}</h3>
    {a.stars!==null?<ShockBadge stars={a.stars} locale={locale}/>:<span className={s.waiting}>{noStarsLabel(a,locale)}</span>}
    <ImpactGauge impact={member?storyImpact(a.impact,member):undefined} locale={locale}/>
    <div className={s.tableCell}><ShockTableView market={a.market} locale={locale}/></div>
    <div className={s.sayCell}><RizelSay quote={q} locale={locale}/></div>
    <button type="button" className={s.moreBtn} data-shock-more aria-expanded={isOpen} aria-controls="shock-detail" onClick={()=>setOpen(isOpen?null:a.id)}>{isOpen?(en?'Close ▴':'閉じる ▴'):(en?'Details ▾':'くわしく ▾')}</button>
   </article>;})}</div>
  {article?<div id="shock-detail" className={s.shockPanel} lang={locale}>
   <div className={s.panelImpact}><ImpactGauge impact={member?storyImpact(article.impact,member):undefined} locale={locale}/></div>
   <dl>{[[en?'Source':'出どころ',article[locale].source],[en?'Date':'日付',article[locale].date],[en?'What happened':'内容',article[locale].content]].map(([k,v],i)=><div key={k} className={i===2?s.wideCell:undefined}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
   {firstLine?<div className={s.panelMeter}><FirstLineMeter view={firstLine} locale={locale}/></div>:null}
   {quote?.[locale].reasons.length?<div className={s.panelSay}><small>{en?'A word from RIZEL':'リゼルの一言'}</small><p style={{whiteSpace:'pre-line'}}>{quote[locale].title}</p><ul>{quote[locale].reasons.slice(0,3).map((t,i)=><li key={i}>{t}</li>)}</ul></div>:null}
  </div>:null}
 </>;
}
