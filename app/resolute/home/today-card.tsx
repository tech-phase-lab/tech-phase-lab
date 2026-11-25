"use client";
import {useEffect,useState} from 'react';
import {ReviewLink as Link,useNotificationClient,usePlanClient} from '../review-context';
import {fixedTodayPlan,type TodayInput,type TodayPlan} from '@/lib/resolute/today-plan';
import {firstDropPct,FIRST_LINE_PRICE_MAX_AGE_MS} from '@/lib/resolute/first-line';
import {usableFavoriteQuote,type FavoriteQuote} from '@/lib/research/favorite-lists';
import {gaugeReading,type ThermometerSnapshot} from '@/lib/resolute/thermometer-view';
import type {RiskFeed} from '@/lib/resolute/risk';
import s from './reference.module.css';

type Lines=TodayInput['lines'];
type Member={lines:Lines;stocks:TodayInput['stocks']};
const round1=(n:number)=>Math.round(n*10)/10;

/** The member's own lines (saved plan + closing-price alert settings) and their alert stocks' moves from the reference prices they
 * set, read from the same member data the other RESOLUTE screens use and the site's shared quote copy. undefined while loading,
 * null when there is no saved plan (the card keeps 「ルールを決める」). A failed read leaves the lines out (never made up). */
function useMember(enabled:boolean,withPrices:boolean):Member|null|undefined{
 const requestSettings=useNotificationClient(),requestPlan=usePlanClient();
 const [member,setMember]=useState<Member|null|undefined>(undefined);
 useEffect(()=>{
  if(!enabled)return;
  const c=new AbortController();
  void (async()=>{
   let plan;
   try{plan=(await requestPlan(undefined,c.signal)).plan;}catch{if(!c.signal.aborted)setMember({lines:{buyDropPct:null,stopLossPct:null,surgeCapPct:null},stocks:[]});return;}
   if(c.signal.aborted)return;
   if(!plan){setMember(null);return;}
   const lines:Lines={buyDropPct:firstDropPct(plan.buyLines),stopLossPct:plan.stopLossPct??null,surgeCapPct:null};
   let stocks:TodayInput['stocks']=[];
   try{
    const settings=(await requestSettings(undefined,c.signal)).settings;
    lines.surgeCapPct=settings.surgeCapPct??null;
    const items=settings.watchItems.filter(i=>i.referencePrice>0);
    if(withPrices&&items.length){
     const tickers=[...new Set(items.map(i=>i.symbol))];
     const r=await fetch(`/api/research/market/quotes?tickers=${encodeURIComponent(tickers.join(','))}`,{signal:c.signal});
     if(r.ok){
      const body=await r.json() as {quotes?:Record<string,FavoriteQuote>};
      stocks=items.flatMap(i=>{const q=body.quotes?.[i.symbol];if(!usableFavoriteQuote(q,i.symbol))return [];const at=Date.parse(q.asOf);
       if(!Number.isFinite(at)||Date.now()-at>FIRST_LINE_PRICE_MAX_AGE_MS)return [];return [{symbol:i.symbol,fromReferencePct:round1((q.price/i.referencePrice-1)*100)}];});
     }
    }
   }catch{/* settings or prices unreachable: the plan's own lines still count, the stock rows stay out */}
   if(!c.signal.aborted)setMember({lines,stocks});
  })();
  return()=>c.abort();
 },[enabled,withPrices,requestPlan,requestSettings]);
 return enabled?member:undefined;
}

/** The fixed plan's input from the day's Shock Gauge feed, the market gauge and the member's lines. */
export function todayInput(feed:RiskFeed,snapshot:ThermometerSnapshot|undefined,member:Member):TodayInput{
 const news=feed.articles.map(a=>{const r=a.market.reading,own=a.market.index==='sox'?r?.sox:r?.nas100,other=a.market.index==='sox'?r?.nas100:r?.sox;
  return {stars:a.stars,changePercent:(own??other)?.changePercent??null};});
 const top=feed.articles.filter(a=>a.stars!==null).sort((a,b)=>(b.stars??0)-(a.stars??0))[0];
 const index=top?.market.index==='sox'?'sox':'nas100',reading=gaugeReading(snapshot,index);
 const thermometer=reading?{index,band:reading.band,changePercent:snapshot?.moves?.[index]?.changePercent??null}as const:null;
 return {date:feed.date??'',news,thermometer,lines:member.lines,stocks:member.stocks};
}

/** 今日やること (owner, Nov 25): the gold-bordered card at the top of TODAY. Gold headline, pale beige body, ✓ (green) / ! (gold)
 * checks, and 「一冊を開く」「今夜のひと息」. The content is the fixed plan (lib/resolute/today-plan.ts) until the AI plan exists. */
export default function TodayCard({locale,feed,snapshot,sample}:{locale:'ja'|'en';feed:RiskFeed;snapshot?:ThermometerSnapshot;sample:boolean}){
 const en=locale==='en',member=useMember(true,!sample);
 if(member===undefined)return null;
 if(member===null)return <div className={s.todayCard}><div className={s.todayEyebrow}>{en?'What to do today':'今日やること'}</div><p className={s.todayBody}>{en?'You haven’t set a rule for a day like this yet. ':'この日のためのルールがまだありません。'}<Link href="/resolute/diagnosis">{en?'Set your rules →':'ルールを決める →'}</Link></p></div>;
 return <TodayPlanView plan={fixedTodayPlan(todayInput(feed,snapshot,member))} locale={locale}/>;
}

export function TodayPlanView({plan,locale}:{plan:TodayPlan;locale:'ja'|'en'}){
 const en=locale==='en';
 return <div className={s.todayCard} lang={locale} data-direction={plan.direction}>
  <div className={s.todayEyebrow}>{en?'What to do today':'今日やること'}</div>
  <h2 className={s.todayHead}>{plan.headline[locale]}</h2>
  <p className={s.todayBody}>{plan.body[locale].split('\n').map((l,i)=><span key={i}>{l}</span>)}</p>
  {plan.checks.length?<ul className={s.checks}>{plan.checks.map((c,i)=><li key={i} data-state={c.state}>
   <i aria-hidden="true">{c.state==='ok'?'✓':'!'}</i>
   <div><small>{c.label[locale]}</small><b>{c.rule[locale].split('\n').map((l,j)=><span key={j}>{l}</span>)}</b></div>
   <span className={s.checkValue}>{c.today[locale]}</span>
  </li>)}</ul>:null}
  <div className={s.todayActions}><Link className={s.todayPrimary} href="/resolute/notebook">{en?'Open your rulebook →':'一冊を開く →'}</Link><Link className={s.todayGhost} href="/resolute/tonight">{en?'A moment to breathe':'今夜のひと息'}</Link></div>
 </div>;
}
