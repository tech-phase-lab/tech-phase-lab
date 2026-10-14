"use client";
import {useEffect,useState} from 'react';
import {useReview} from '../review-context';
import {parseRiskFeed} from '@/lib/resolute/risk';
import {requestRisk} from '@/lib/resolute/risk-client';
import type {RiskFeed} from '@/lib/resolute/risk';
export function useRisk(){const reviewing=useReview()!==null;const [feed,setFeed]=useState<RiskFeed|null>(null),[status,setStatus]=useState('loading');useEffect(()=>{const c=new AbortController();let busy=false;async function load(){if(busy)return;busy=true;try{const f=reviewing?await fetch("/api/resolute/risk/owner",{cache:"no-store",signal:c.signal}).then(async r=>{if(!r.ok)throw Error("failed");return parseRiskFeed((await r.json()).feed);}):await requestRisk(c.signal);if(!c.signal.aborted){setFeed(f);setStatus('ready');}}catch(e){if(!c.signal.aborted){setFeed(null);setStatus(e instanceof Error&&e.message==='denied'?'denied':'failed');}}finally{busy=false;}}void load();const id=setInterval(()=>void load(),60000);return()=>{c.abort();clearInterval(id);};},[reviewing]);return{feed,status};}
export function riskStatus(en:boolean,status:string,state?:string){return status==='denied'?(en?'You need active access to RESOLUTE alerts.':'有効な通知利用権が必要です'):status==='loading'?(en?'Loading the news…':'ニュースを読み込んでいます…'):state==='stopped'?(en?'News updates are paused.':'ニュースの公開を停止しています'):state==='ready'?(en?'No news needs your attention today.':'今日は、気にするニュースはありません'):(en?'We couldn’t update the news.':'ニュースを更新できていません');}
