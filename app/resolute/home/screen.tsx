"use client";
import {useEffect,useState,type CSSProperties} from 'react';
import ToolShell from '../tool-shell';
import {ReviewLink as Link,useReview,useNotificationClient} from '../review-context';
import {useRisk,riskStatus} from '../features/use-risk';
import {RISK_PREVIEW_DETAILS} from '@/lib/resolute/risk-preview';
import {validateSnapshot} from '@/lib/resolute/transport';
import s from './reference.module.css';
type Snapshot=ReturnType<typeof validateSnapshot>;
const colors=['','#7fb6e0','#e0c070','#f0a24a','#ee7a3c','#ff4d55'];
export default function HomeScreen({identityReady=true}:{identityReady?:boolean}) {
 return <ToolShell home identityReady={identityReady}>{(locale,_deny,entitlement)=><Home locale={locale} entitlement={entitlement}/>}</ToolShell>;
}
export function Home({locale,entitlement}:{locale:'ja'|'en';entitlement:Snapshot|null}) {
 const en=locale==='en',review=useReview(),live=useRisk();
 const {feed,status}=live;
 const available=status==='ready'&&feed?.state==='ready';
 const high=available&&feed.articles.some(a=>a.stars>=4);
 const displaySample=!!review&&review.scenario!=='live';
 const previewExpired=review?.scenario==='expired';
 const locked=previewExpired||!review&&entitlement!==null&&!entitlement.canReceiveNotifications;
 const requestSettings=useNotificationClient();
 const [morning,setMorning]=useState<boolean|null>(null),[date,setDate]=useState<string|null>(null);
 const [offer,setOffer]=useState<{ja:number;en:number}|null>(null);
 useEffect(()=>{const c=new AbortController();let busy=false;
  const load=async()=>{if(busy)return;busy=true;try{const next=await requestSettings(undefined,c.signal);if(!c.signal.aborted)setMorning(next.settings.morningEnabled);}catch{if(!c.signal.aborted)setMorning(null);}finally{busy=false;}};
  void load();const timer=setInterval(()=>void load(),60000);return()=>{c.abort();clearInterval(timer);};
 },[requestSettings]);
 useEffect(()=>{const update=()=>setDate(new Intl.DateTimeFormat(en?'en-US':'ja-JP',{dateStyle:'full',timeZone:'Asia/Tokyo'}).format(new Date()));update();const timer=setInterval(update,60000);return()=>clearInterval(timer);},[en]);
 useEffect(()=>{if(!locked||review)return;const c=new AbortController();void fetch('/api/resolute/renewal-offer',{cache:'no-store',credentials:'same-origin',signal:c.signal}).then(async r=>{if(!r.ok)throw Error();const v=await r.json();if((v.ja===5980&&v.en===39)||(v.ja===3980&&v.en===29))setOffer(v);}).catch(()=>{});return()=>c.abort();},[locked,review]);
 const displayOffer=previewExpired?{ja:5980,en:39}:offer;
 const expiry=displaySample?'2028-01-15T00:00:00+09:00':entitlement?.alerts.expiresAt;
 const tiles=[
  ['notebook','迷った日の一冊','Your rulebook','ルールを一冊に','Your rules in one place','M24 12c-4-3-10-4-17-3v26c7-1 13 0 17 3 4-3 10-4 17-3V9c-7-1-13 0-17 3zM24 12v26'],
  ['wall','ルールのお守り','Rules wallpaper','壁紙をつくる','Make your wallpaper','M15 12h18a3 3 0 0 1 3 3v22a3 3 0 0 1-3 3H15a3 3 0 0 1-3-3V15a3 3 0 0 1 3-3zM12 20h24M24 6v6M20 6h8M24 26l3 3-3 3-3-3z'],
  ['simulation','資産シミュ','Portfolio simulator','下落と上昇を試す','Explore ups and downs','M8 8v32h32M13 31l8-9 7 5 11-14M33 13h6v6'],
  ['tax','税金の目安','Tax estimate','手取りの目安','Estimate what you keep','M17 15l7 10 7-10M17 25h14M17 31h14M24 25v10'],
 ];
 return <div className={s.root}><div className={s.wrap}>
  <h1><svg className={s.anc} viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="9" r="4"/><path d="M24 13v28M17 19h14M9 31c0 7 7 11 15 11s15-4 15-11M5 33l4-4 4 4M35 33l4-4 4 4"/></svg><span>RESOLUTE</span></h1>
  <div className={s.date}>{date??'—'}</div>
  <section className={s.sec}><div className={s.lab}>TODAY</div>
   <div className={`${s.card} ${high&&!locked?s.high:''}`}><div className={s.row}><h2>{en?'Today’s news risk':'今日の危険度'}</h2>{!locked&&available&&feed.articles.length>0?<Link className={s.more} href="/resolute/news">{en?`See all ${feed.articles.length} →`:`${feed.articles.length}件すべて見る →`}</Link>:null}</div>
    {locked?<div className={s.lock}><p>🔒 {en?'The news risk checker is included while your alerts access is active.':'危険度チェッカーは、アラートの利用期間中に見られます。'}</p><p className={s.sub}>{en?'Renew for another year of daily news risk updates.':'更新すると、また毎朝の危険度を確認できます。'}</p><button className={s.primary} disabled>{en?'Renew for one year':'1年分を更新する'}{displayOffer?`　${en?'$'+displayOffer.en:displayOffer.ja.toLocaleString('ja-JP')+'円'}`:''}</button><p className={s.sub}>{en?'Renewal checkout is not open yet.':'更新の受付は準備中です。'}</p></div>:<>
     {available&&feed.articles.length>0?<><ul className={s.news}>{feed.articles.slice(0,2).map(a=><li key={a.id} style={{'--c':colors[a.stars]} as CSSProperties}><span className={s.headline}>{displaySample?(RISK_PREVIEW_DETAILS[a.id]?.[en?'homeEn':'homeJa']??a[locale].title):a[locale].title}</span><b aria-label={`${a.stars}/5`}>{Array.from({length:a.stars},(_,i)=><i key={i} aria-hidden="true">★</i>)}<span aria-hidden="true">{'☆'.repeat(5-a.stars)}</span></b></li>)}</ul><div className={`${s.today} ${high?s.warn:''}`}>{en?'What to do today: ':'今日やること: '}{high?<Link href="/resolute/notebook">{en?'Reread your rules':'ルールを読み返す'}</Link>:displaySample?<Link href="/resolute/notebook">{en?'Check your first price level':'最初のラインを確認する'}</Link>:(en?'Nothing for now':'なし')}</div></>:<p role="status">{riskStatus(en,status,feed?.state)}</p>}
     {displaySample?<p className={s.notice}>{feed?.date} · {en?'Display sample':'表示見本'}</p>:null}
    </>}
   </div>
   <div className={s.card}><div className={s.row}><h2>{en?'Market gauge':'相場の温度計'}</h2><Link className={s.more} href="/resolute/thermometer">{en?'Details →':'くわしく →'}</Link></div><div className={`${s.temp} ${displaySample?s.sample:''}`}><div className={s.big}>{displaySample?(en?'Very hot':'かなり熱い'):en?'Current reading not available yet':'現在の判定は準備中です'}</div>{displaySample?<small className={s.sampleLabel}>{en?'Display sample':'表示見本'}</small>:null}<div className={s.track} aria-hidden="true">{displaySample?<i className={s.needle}/>:null}</div><div className={s.scale}><span>{en?'Cool':'冷えている'}</span><span>{en?'Hot':'熱い'}</span></div></div></div>
  </section>
  <section className={s.sec}><div className={s.lab}>YOUR RULES</div><div className={s.grid}>{tiles.map(([path,ja,eng,sub,subEn,icon])=><Link key={path} className={s.tile} href={`/resolute/${path}`}><div className={s.t}><b>{en?eng:ja}</b><span>{en?subEn:sub}</span></div><svg viewBox="0 0 48 48" aria-hidden="true">{path==='tax'?<circle cx="24" cy="24" r="16"/>:null}<path d={icon}/></svg></Link>)}</div></section>
  <section className={s.sec}><div className={s.lab}>ALERTS</div><div className={s.list}>
   <Link className={s.item} href="/resolute/alerts"><div><b>{en?'Closing-price alerts':'終値アラート'}</b><span>{expiry?`${en?'Access until ':'利用期限 '}${new Intl.DateTimeFormat(en?'en-US':'ja-JP',{dateStyle:'long',timeZone:'Asia/Tokyo'}).format(new Date(expiry))}`:(en?'Access period not available':'利用期限は未確認です')}</span>{displaySample?<small className={s.sampleLabel}>{en?'Display sample':'表示見本'}</small>:null}</div><i>{en?'Settings →':'設定 →'}</i></Link>
   <Link className={s.item} href="/resolute/tonight"><div><b>{en?'When the market tumbles':'暴落の夜に開く'}</b><span>{en?'A moment to breathe':'今夜のひと息'}</span></div><i>{en?'Open →':'開く →'}</i></Link>
   <Link className={s.item} href="/resolute/morning"><div><b>{en?'A note the next morning':'翌朝のひとこと'}</b><span>{en?'One note the morning after an alert':'アラートの翌朝に1通'}</span></div><i>{morning===null?'—':morning?(en?'On':'オン'):(en?'Off':'オフ')}</i></Link>
  </div></section>
  <footer className={s.foot}><Link href="/resolute/diagnosis">{en?'Retake the quiz':'診断をやり直す'}</Link><p className={s.disc}>{en?'For information only. This is not investment advice.':'情報の提供であり、投資助言ではありません。'}</p></footer>
 </div></div>;
}
