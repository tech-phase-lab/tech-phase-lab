"use client";
import {useEffect,useState} from 'react';
import {reviewScenarioFeed} from '@/lib/resolute/review-scenarios';
import {useReview} from '../review-context';
import {latestRiskDate,parseRiskFeed} from '@/lib/resolute/risk';
import {requestRisk} from '@/lib/resolute/risk-client';
import type {RiskFeed} from '@/lib/resolute/risk';
import {RISK_POLICY} from '@/lib/resolute/risk-policy';
import {recall,remember} from '@/lib/resolute/view-memory';
/** The feed this tab already loaded, only while it is still the current Shock Gauge day (a feed kept overnight is not shown). */
function currentFeed(){const f=recall<RiskFeed>('risk');return f&&(f.date===null||f.date===latestRiskDate())?f:null;}
/** Shock Gauge feed (衝撃度チェッカー). The feed already loaded in this tab is shown at once and refreshed behind it (no "Loading…" between pages). */
export function useRisk(){const review=useReview(),reviewing=review!==null,scenario=review?.scenario??'sample';const [feed,setFeed]=useState<RiskFeed|null>(()=>reviewing?null:currentFeed()),[status,setStatus]=useState(()=>!reviewing&&currentFeed()?'ready':'loading');useEffect(()=>{if(reviewing&&scenario!=='live')return;const c=new AbortController();let busy=false;async function load(){if(busy)return;busy=true;try{const f=reviewing?await fetch("/api/resolute/risk/owner",{cache:"no-store",signal:c.signal}).then(async r=>{if(!r.ok)throw Error("failed");return parseRiskFeed((await r.json()).feed,{shownOnly:false});}):await requestRisk(c.signal);if(!c.signal.aborted){if(!reviewing)remember('risk',f);setFeed(f);setStatus('ready');}}catch(e){if(!c.signal.aborted){setFeed(null);setStatus(e instanceof Error&&e.message==='denied'?'denied':'failed');}}finally{busy=false;}}void load();const id=setInterval(()=>void load(),60000);return()=>{c.abort();clearInterval(id);};},[reviewing,scenario]);const fixture=reviewing?reviewScenarioFeed(scenario):null;return fixture?{feed:fixture,status:'ready'}:{feed,status};}
export function riskStatus(en:boolean,status:string,state?:string){const t=RISK_POLICY.status,l=en?'en':'ja';return status==='denied'?(en?'You need active access to RESOLUTE alerts.':'有効な通知利用権が必要です'):status==='loading'?(en?'Loading the news…':'ニュースを読み込んでいます…'):state==='preparing'?t.preparing[l]:state==='stopped'?t.stopped[l]:state==='ready'?t.quiet[l]:t.failed[l];}
