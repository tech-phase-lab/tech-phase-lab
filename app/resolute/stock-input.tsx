"use client";
import {useEffect,useId,useState} from "react";
import styles from "./diagnosis.module.css";
type Match={ticker:string;name:string};
export default function StockInput({value,onChange,index,en}:{value:string;onChange:(v:string)=>void;index:number;en:boolean}) {
 const id=useId();
 const [result,setResult]=useState<{query:string;items:Match[];failed:boolean}|null>(null);
 const [composing,setComposing]=useState(false);
 const query=value.trim();
 const needsSearch=!!query&&!/^[A-Z][A-Z0-9.-]{0,14}$/.test(query);
 useEffect(()=>{
  if(!needsSearch||composing)return;
  const controller=new AbortController();
  const timer=setTimeout(()=>{void fetch(`/api/research/stocks?q=${encodeURIComponent(query)}&limit=5`,{signal:controller.signal}).then(async response=>{
   if(!response.ok)throw Error();
   const data=await response.json();if(!data.ok||!Array.isArray(data.results))throw Error();
   if(!controller.signal.aborted)setResult({query,items:data.results.filter((x:Match)=>typeof x.ticker==="string"&&/^[A-Z][A-Z0-9.-]{0,14}$/.test(x.ticker)&&typeof x.name==="string").slice(0,5),failed:false});
  }).catch(()=>{if(!controller.signal.aborted)setResult({query,items:[],failed:true});});},350);
  return()=>{clearTimeout(timer);controller.abort();};
 },[query,needsSearch,composing]);
 const current=result?.query===query?result:null;
 return <div className={styles.stockLookup}><label htmlFor={id}>{en?"Symbol":"銘柄"}</label><div className={styles.stockEntry}>
  <input id={id} aria-label={`${en?"銘柄 / Symbol":"銘柄"} ${index+1}`} placeholder="NVDA" type="text" autoComplete="off" spellCheck={false} maxLength={80} value={value}
   onFocus={e=>e.currentTarget.select()} onClick={e=>e.currentTarget.select()}
   onCompositionStart={()=>setComposing(true)} onCompositionEnd={e=>{setComposing(false);onChange(e.currentTarget.value.normalize("NFKC").toUpperCase());}}
   onChange={e=>onChange(composing?e.target.value:e.target.value.normalize("NFKC").toUpperCase())}/>
  {value?<button type="button" className={styles.clearInput} aria-label={`${en?"Clear stock":"銘柄入力をクリア"} ${index+1}`} onClick={()=>onChange("")}>×</button>:null}
 </div>
 {needsSearch&&!composing?<div className={styles.stockSuggestions} role="group" aria-label={en?"Matching stocks":"銘柄の候補"}>
  {current?.items.map(item=><button key={item.ticker} type="button" onClick={()=>onChange(item.ticker)}><strong>{item.ticker}</strong><span>{item.name}</span></button>)}
  <p role="status">{!current?(en?"Searching…":"検索しています…"):current.items.length?(en?"Select the matching stock":"該当する銘柄を選んでください"):current.failed?(en?"Search is unavailable. Try again or enter a ticker.":"検索できませんでした。再入力するかティッカーを入力してください"):(en?"No match. Try another name or a ticker.":"見つかりませんでした。別の会社名かティッカーを入力してください")}</p>
 </div>:null}
 </div>;
}
