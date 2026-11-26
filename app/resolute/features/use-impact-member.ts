"use client";
import {useEffect,useState} from 'react';
import {readRaw,parseStored} from '@/lib/portfolio/store';
import {favoriteListsKey,parseFavoriteLists} from '@/lib/research/favorite-lists';
import {favoriteStocksKey} from '@/lib/research/favorites';
import {heldWeights,type ImpactMember} from '@/lib/resolute/impact';
import {recall} from '@/lib/resolute/view-memory';

/** The member's side of あなたへの影響 (owner, Nov 26 spec §4), on this device only: the PRO asset tool's holdings (this browser's
 * storage; another device judges by the watchlist alone), the Tech Phase watchlist (the account's server copy when signed in,
 * otherwise this browser's), and the sector named in the diagnosis (q21). Nothing is sent anywhere. undefined while loading. */
const TICKER=/^[A-Z][A-Z0-9.]{0,9}$/;
const unionTickers=(doc:{lists?:{tickers?:unknown}[]}|null|undefined)=>[...new Set((doc?.lists??[]).flatMap(l=>Array.isArray(l?.tickers)?l.tickers:[]).filter((t):t is string=>typeof t==='string'&&TICKER.test(t)))];
function localWatch(){try{return unionTickers(parseFavoriteLists(localStorage.getItem(favoriteListsKey),localStorage.getItem(favoriteStocksKey)));}catch{return [];}}
export function useImpactMember(enabled=true):ImpactMember|undefined{
 const [member,setMember]=useState<ImpactMember|undefined>(undefined);
 useEffect(()=>{if(!enabled)return;const c=new AbortController();
  const held=heldWeights(parseStored(readRaw()));
  const q21=(recall<{plan?:{answers?:Record<string,unknown>}}>('plan')?.plan?.answers?.q21);
  const sector=typeof q21==='string'&&q21!=='other'?q21:null;
  void (async()=>{let watch=localWatch();
   try{const r=await fetch('/api/research/favorites',{cache:'no-store',credentials:'same-origin',signal:c.signal});if(r.ok){const v=await r.json();if(v?.document)watch=unionTickers(v.document);}}catch{/* this browser's copy */}
   if(!c.signal.aborted)setMember({held,watch,sector});})();
  return()=>c.abort();},[enabled]);
 return member;
}
