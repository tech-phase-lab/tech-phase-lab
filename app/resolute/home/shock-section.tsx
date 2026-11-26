"use client";
import {useState,type CSSProperties} from 'react';
import {formatCause,noStarsLabel,readingParts,type RiskArticle,type RiskFeed,type RizelQuote} from '@/lib/resolute/risk';
import {RISK_PREVIEW_DETAILS} from '@/lib/resolute/risk-preview';
import {ShockStars,STAR_COLORS} from '../features/shock-gauge';
import {FirstLineMeter,useFirstLine} from '../news/first-line-meter';
import s from './reference.module.css';

/** The RIZEL line the feed assigned to a story. The frontend proxy passes approved lines to members only once
 * RESOLUTE_RIZEL_LINE_PUBLISHED is on (owner accounts always; lib/resolute/rizel-line.ts), so an empty list hides the line.
 * Display samples never show one. */
export function assignedQuote(feed:RiskFeed,article:RiskArticle,sample:boolean):RizelQuote|undefined{
 return !sample&&article.quoteId?feed.quotes.find(q=>q.id===article.quoteId&&q.approved):undefined;
}
const headline=(a:RiskArticle,locale:'ja'|'en',sample:boolean)=>sample?(RISK_PREVIEW_DETAILS[a.id]?.[locale==='en'?'homeEn':'homeJa']??a[locale].title):a[locale].title;

/** リゼルの一言 under a home story: the line's title only (the reasons are on the detail). Absent when no line is assigned. */
export function RizelSay({quote,locale}:{quote:RizelQuote|undefined;locale:'ja'|'en'}){
 if(!quote)return null;
 return <div className={s.say}><img src="/rizel-avatar.webp" alt="" width={40} height={40}/><div><small>{locale==='en'?'A word from RIZEL':'リゼルの一言'}</small><p>{quote[locale].title}</p></div></div>;
}

/** Phone: each story with its stars, index lines and リゼルの一言. */
export function ShockList({feed,locale,sample}:{feed:RiskFeed;locale:'ja'|'en';sample:boolean}){
 return <ul className={s.news}>{feed.articles.map(a=><li key={a.id} style={a.stars?{'--c':STAR_COLORS[a.stars]} as CSSProperties:undefined}>
  <span className={s.headline}>{headline(a,locale,sample)}</span><ShockStars article={a} locale={locale}/>
  <RizelSay quote={assignedQuote(feed,a,sample)} locale={locale}/>
 </li>)}</ul>;
}

/** PC (02/03): up to three cards side by side, the same height, their inner rows aligned (subgrid). 「くわしく ▾」 opens the
 * story's detail under the cards (出どころ・日付・内容・最初のラインまで, and the line's reasons); the open card glows red. */
export function ShockCards({feed,locale,sample}:{feed:RiskFeed;locale:'ja'|'en';sample:boolean}){
 const en=locale==='en',[open,setOpen]=useState<string|null>(null);
 const article=feed.articles.find(a=>a.id===open)??null,quote=article?assignedQuote(feed,article,sample):undefined;
 const firstLine=useFirstLine(!!article&&!sample);
 return <>
  <div className={s.shockGrid}>{feed.articles.slice(0,3).map(a=>{
   const why=formatCause(a,locale),lines=[...readingParts(a.market,locale),...(why?[{text:why}]:[])],q=assignedQuote(feed,a,sample),isOpen=a.id===open;
   return <article key={a.id} className={s.shockCard} data-open={isOpen||undefined} style={a.stars?{'--c':STAR_COLORS[a.stars]} as CSSProperties:undefined}>
    <div className={s.badgeRow}>{a.stars!==null?<><b className={s.badge}>★{a.stars}</b><span className={s.badgeStars} aria-label={`${a.stars}/5`}>{'★'.repeat(a.stars)}<i aria-hidden="true">{'★'.repeat(5-a.stars)}</i></span></>:<span className={s.waiting}>{noStarsLabel(a,locale)}</span>}</div>
    <h3 className={s.cardHead}>{headline(a,locale,sample)}</h3>
    <div className={s.readings}>{lines.map(l=><p key={l.text}><span>{l.text}</span>{l.detail?<span className={s.detail}>{l.detail}</span>:null}</p>)}</div>
    <div className={q?s.sayCell:undefined}><RizelSay quote={q} locale={locale}/></div>
    <button type="button" className={s.moreBtn} data-shock-more aria-expanded={isOpen} aria-controls="shock-detail" onClick={()=>setOpen(isOpen?null:a.id)}>{isOpen?(en?'Close ▴':'閉じる ▴'):(en?'Details ▾':'くわしく ▾')}</button>
   </article>;})}</div>
  {article?<div id="shock-detail" className={s.shockPanel} lang={locale}>
   <dl>{[[en?'Source':'出どころ',article[locale].source],[en?'Date':'日付',article[locale].date],[en?'What happened':'内容',article[locale].content]].map(([k,v],i)=><div key={k} className={i===2?s.wideCell:undefined}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
   {firstLine?<div className={s.panelMeter}><FirstLineMeter view={firstLine} locale={locale}/></div>:null}
   {quote?.[locale].reasons.length?<div className={s.panelSay}><small>{en?'A word from RIZEL':'リゼルの一言'}</small><p>{quote[locale].title}</p><ul>{quote[locale].reasons.slice(0,3).map((t,i)=><li key={i}>{t}</li>)}</ul></div>:null}
  </div>:null}
 </>;
}
