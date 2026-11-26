"use client";
import {useState,type CSSProperties} from 'react';
import {shockTable,type RiskMarket} from '@/lib/resolute/risk';
import {IMPACT_LABELS,type Impact} from '@/lib/resolute/impact';
import {hasLogo,logoSrc} from '@/app/research/watchlist/stock-logo';
import c from './shock-card.module.css';

/** The Shock Gauge card's parts (owner, Nov 26 spec §3–5), the same on the phone list, the phone detail page and the PC cards:
 * the ★ badge with five stars, あなたへの影響, and the small 終値 / 一番下げた時 table. Red for ★4–5, gold for ★1–3. */
export const starColor=(stars:number|null)=>stars!==null&&stars>=4?'#ff5a64':'#d8b36a';

export function ShockBadge({stars,locale}:{stars:number;locale:'ja'|'en'}){
 return <div className={c.badgeRow} style={{'--c':starColor(stars)} as CSSProperties}>
  <b className={c.badge}>★{stars}</b>
  <span className={c.stars} role="img" aria-label={locale==='en'?`${stars} of 5 stars`:`5段階中${stars}`}>{'★'.repeat(stars)}<i>{'★'.repeat(5-stars)}</i></span>
 </div>;
}

const KIND={ja:{held:'保有',watch:'ウォッチリスト'},en:{held:'Held',watch:'Watchlist'}} as const;
function Logo({ticker,kind,locale}:{ticker:string;kind:'held'|'watch';locale:'ja'|'en'}){
 const [open,setOpen]=useState(false),label=KIND[locale][kind];
 return <button type="button" className={c.logo} title={label} aria-label={`${ticker} ${label}`} aria-expanded={open} onClick={()=>setOpen(v=>!v)} onBlur={()=>setOpen(false)}>
  {/* eslint-disable-next-line @next/next/no-img-element */}
  {hasLogo(ticker)?<img src={logoSrc(ticker)} alt="" width={20} height={20}/>:<span>{ticker.slice(0,2)}</span>}
  {open?<span className={c.tip} role="status">{label}</span>:null}
 </button>;
}
/** あなたへの影響: the label, up to three of the member's own related stocks (tap or hover: 保有 / ウォッチリスト), the level on the
 * right, a blue → yellow → orange → red gauge with a white needle and 小 中 大 特大 under it. No reasons. Nothing in the watchlist
 * or holdings: a grey gauge, no needle, 「―」 and the link to fill the watchlist. */
export function ImpactGauge({impact,locale}:{impact:Impact|undefined;locale:'ja'|'en'}){
 const en=locale==='en',labels=IMPACT_LABELS[locale],empty=!impact||impact.level===null;
 return <div className={c.impact} data-empty={empty||undefined}>
  <div className={c.impactHead}><span className={c.impactLabel}>{en?'Impact on you':'あなたへの影響'}</span>
   <span className={c.logos}>{!empty?impact.logos.map(l=><Logo key={l.ticker} ticker={l.ticker} kind={l.kind} locale={locale}/>):null}</span>
   <span className={c.level} data-level={empty?undefined:impact.level}>{empty?"―":labels[impact.level]}</span></div>
  <div className={c.bar} aria-hidden="true">{!empty?<i className={c.needle} style={{left:`${impact.position}%`}}/>:null}</div>
  <div className={c.scale} aria-hidden="true">{labels.map(l=><span key={l}>{l}</span>)}</div>
  {empty&&impact?.level===null?<p className={c.emptyNote}>{en?'Add stocks to your watchlist to see the impact on you.':'ウォッチリストに銘柄を入れると、あなたへの影響が分かります'}<a href="/research/watchlist">{en?'Add →':'入れる →'}</a></p>:null}
 </div>;
}
/** The two-column table. The close in white; the intraday low in red (the high on an up day in green). Never wraps a number. */
export function ShockTableView({market,locale}:{market:RiskMarket;locale:'ja'|'en'}){
 const t=shockTable(market,locale);if(!t)return null;
 return <table className={c.table}><thead><tr><th scope="col"><span className={c.sr}>{locale==='en'?'Index':'指標'}</span></th><th scope="col">{t.close}</th><th scope="col">{t.extreme}</th></tr></thead>
  <tbody>{t.rows.map(r=><tr key={r.label}><th scope="row">{r.label}</th><td>{r.close}</td><td data-tone={r.tone??undefined}>{r.extreme}</td></tr>)}</tbody></table>;
}
