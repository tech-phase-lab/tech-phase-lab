"use client";
import {useEffect,useState} from 'react';
import {useNotificationClient,usePlanClient} from '../review-context';
import {firstLineView,firstDropPct,type FirstLinePrice,type FirstLineView} from '@/lib/resolute/first-line';
import {usableFavoriteQuote,type FavoriteQuote} from '@/lib/research/favorite-lists';
import {formatDisplay} from '@/lib/research/display-time';
import s from './reference.module.css';

/** Five minutes: the shared quote copy is one minute old at most while stocks trade, so this only keeps an open page current. */
const REFRESH_MS=300_000;
const usd=(n:number,en:boolean)=>new Intl.NumberFormat(en?'en-US':'ja-JP',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(n);

/** Reads the member's saved plan (first purchase level) and alert stocks (reference prices), then the site's shared quote copy for
 * those stocks only. Any missing piece leaves the view null (lib/resolute/first-line.ts). */
export function useFirstLine(enabled:boolean):FirstLineView|null{
 const requestSettings=useNotificationClient(),requestPlan=usePlanClient();
 const [view,setView]=useState<FirstLineView|null>(null);
 useEffect(()=>{
  if(!enabled)return;
  const c=new AbortController();let timer:ReturnType<typeof setInterval>|undefined;
  void (async()=>{
   try{
    const [settings,plan]=await Promise.all([requestSettings(undefined,c.signal),requestPlan(undefined,c.signal)]);
    const items=settings.settings.watchItems,buyLines=plan.plan?.buyLines;
    if(!items.length||firstDropPct(buyLines)===null)return;
    const tickers=[...new Set(items.map(i=>i.symbol))];
    const load=async()=>{
     try{
      const r=await fetch(`/api/research/market/quotes?tickers=${encodeURIComponent(tickers.join(','))}`,{signal:c.signal});
      if(!r.ok)throw Error('quotes');
      const body=await r.json() as {quotes?:Record<string,FavoriteQuote>};
      const prices:Record<string,FirstLinePrice>={};
      for(const t of tickers){const q=body.quotes?.[t];if(usableFavoriteQuote(q,t))prices[t]={price:q.price,asOf:q.asOf};}
      if(!c.signal.aborted)setView(firstLineView(items,buyLines,prices));
     }catch{/* keep what is on screen; a first failure leaves the row out */}
    };
    await load();
    if(!c.signal.aborted)timer=setInterval(()=>void load(),REFRESH_MS);
   }catch{/* no saved plan or alert stocks reachable: the row stays out */}
  })();
  return()=>{c.abort();if(timer)clearInterval(timer);};
 },[enabled,requestSettings,requestPlan]);
 return enabled?view:null;
}

export function FirstLineMeter({view,locale}:{view:FirstLineView;locale:'ja'|'en'}){
 const en=locale==='en',pct=`${Math.round(view.progress*1000)/10}%`;
 const when=formatDisplay(view.asOf,en?'en':'ja',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 return <div className={s.meter} data-testid="first-line">
  <div className={s.t}><span>{en?`${view.symbol}: until your first price level`:`${view.symbol} 最初のラインまで`}</span><b>{view.reached?(en?'Reached':'届いています'):(en?`${view.awayPct}% away`:`あと${view.awayPct}%`)}</b></div>
  <div className={s.track} aria-hidden="true"><i style={{width:pct}}/><u style={{left:`min(${pct}, calc(100% - 2px))`}}/></div>
  <div className={s.scale}><span>{en?`Now ${usd(view.price,en)}`:`現在 ${usd(view.price,en)}`}</span><span>{en?`First level −${view.dropPct}% ${usd(view.linePrice,en)}`:`最初のライン −${view.dropPct}% ${usd(view.linePrice,en)}`}</span></div>
  <small className={s.rnote}>{en?`Price as of ${when} · Data: Twelve Data`:`${when}時点の価格・提供: Twelve Data`}</small>
 </div>;
}
