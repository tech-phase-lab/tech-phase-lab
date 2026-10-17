'use client';
import {useEffect,useState} from 'react';
import type {WatchEarningsFeed} from '@/lib/research/watch-earnings';
import {createNewsPoller} from '@/lib/research/news-poller';
import {observePageActivity} from '@/lib/research/page-activity';
export function useWatchEarnings(){
 const [feed,setFeed]=useState<WatchEarningsFeed|null>(null);
 const [failed,setFailed]=useState(false);
 const [seen,setSeen]=useState<{revision:string;at:string}|null>(null);
 useEffect(()=>{
  let expiry:ReturnType<typeof setTimeout>|undefined;
  const poller=createNewsPoller<WatchEarningsFeed>({
   load:async signal=>{const r=await fetch('/api/research/watch-earnings',{cache:'no-store',signal});if(!r.ok)throw Error('Unavailable');const v=await r.json();if(v.ok!==true)throw Error('Invalid feed');return v;},
   onSuccess:value=>{setFeed(value);setFailed(false);clearTimeout(expiry);if(value.accessExpiresAt>0)expiry=setTimeout(()=>setFeed(old=>old?{...old,snapshot:old.snapshot?{...old.snapshot,cards:null}:null}:old),Math.max(0,value.accessExpiresAt-Date.now()));},
   onFailure:()=>{setFailed(true);},
  });
  poller.start(0);const stop=observePageActivity(()=>poller.resume(),()=>poller.pause());
  return()=>{clearTimeout(expiry);stop();poller.stop();};
 },[]);
 const revision=feed?.snapshot?.revision;
 useEffect(()=>{if(!revision)return;const frame=requestAnimationFrame(()=>setSeen(old=>old?.revision===revision?old:{revision,at:new Date().toISOString()}));return()=>cancelAnimationFrame(frame);},[revision]);
 // The bundled baseline is FQ4 2026. Older backfills must never replace it.
 const live=feed?.snapshot&&feed.snapshot.periodOrder>=2026*4+4?feed.snapshot:null;
 return {live,failed,status:feed?.status,observedAt:seen?.revision===live?.revision?seen?.at:null};
}
