"use client";
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {latestRiskDate} from '@/lib/resolute/risk';
import {forget} from '@/lib/resolute/view-memory';

/** Hidden this long (or into a new Shock Gauge day), the home is drawn again from the loader instead of showing what it had. */
export const HOME_STALE_AFTER_MS=10*60_000;

/** Coming back to the home (owner, Nov 26: the previous screen showed, then the current one replaced it). A home-screen app or a
 * tab that stayed open overnight still holds yesterday's home; its timers then swapped in today's news and plan in front of the
 * member. After a long absence, a new Shock Gauge day or a page restored from the back/forward cache, the home forgets what this
 * tab remembered (feed and 今日やること), asks the server for a fresh gauge snapshot, and is drawn again: the RESOLUTE loader,
 * then the final home, never the old one first. Returns a key that changes each time. */
export function useFreshHome(){
 const router=useRouter(),[epoch,setEpoch]=useState(0);
 useEffect(()=>{
  let hiddenAt:number|null=document.visibilityState==='hidden'?Date.now():null,day=latestRiskDate();
  const redraw=()=>{forget('risk');forget('today');router.refresh();setEpoch(e=>e+1);};
  const back=()=>{const now=Date.now(),today=latestRiskDate(new Date(now)),away=hiddenAt!==null&&now-hiddenAt>=HOME_STALE_AFTER_MS;
   hiddenAt=null;if(away||today!==day){day=today;redraw();}};
  const visibility=()=>{if(document.visibilityState==='hidden'){if(hiddenAt===null)hiddenAt=Date.now();}else back();};
  const pageshow=(e:PageTransitionEvent)=>{if(e.persisted){day=latestRiskDate();redraw();}};
  document.addEventListener('visibilitychange',visibility);window.addEventListener('focus',back);window.addEventListener('pageshow',pageshow);
  return()=>{document.removeEventListener('visibilitychange',visibility);window.removeEventListener('focus',back);window.removeEventListener('pageshow',pageshow);};
 },[router]);
 return epoch;
}
