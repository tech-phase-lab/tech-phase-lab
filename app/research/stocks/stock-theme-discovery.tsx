"use client";
import { useState } from "react";
import type { Language } from "@/lib/research/data";
import styles from "./stock-theme-discovery.module.css";
const themes = [
  {id:"memory", ja:"メモリ", en:"Memory", stocks:[["MU","Micron"],["SNDK","SanDisk"],["WDC","Western Digital"],["STX","Seagate"]]},
  {id:"cloud", ja:"AIクラウド", en:"AI cloud", stocks:[["NBIS","Nebius"],["CRWV","CoreWeave"],["IREN","IREN"]]},
  {id:"chips", ja:"AI半導体", en:"AI chips", stocks:[["NVDA","NVIDIA"],["AMD","AMD"],["AVGO","Broadcom"],["MRVL","Marvell"]]},
  {id:"optical", ja:"光通信", en:"Optical links", stocks:[["LITE","Lumentum"],["COHR","Coherent"],["CRDO","Credo"]]},
  {id:"power", ja:"電力・冷却", en:"Power & cooling", stocks:[["VRT","Vertiv"],["GEV","GE Vernova"],["BE","Bloom Energy"],["VST","Vistra"]]},
  {id:"security", ja:"サイバーセキュリティ", en:"Cybersecurity", stocks:[["CRWD","CrowdStrike"],["PANW","Palo Alto Networks"],["ZS","Zscaler"],["FTNT","Fortinet"]]},
  {id:"gold", ja:"金鉱山", en:"Gold miners", stocks:[["NEM","Newmont"],["AEM","Agnico Eagle"],["KGC","Kinross Gold"]]},
  {id:"software", ja:"ソフトウェア", en:"Software", stocks:[["MSFT","Microsoft"],["CRM","Salesforce"],["NOW","ServiceNow"],["ADBE","Adobe"]]},
  {id:"space", ja:"宇宙関連", en:"Space", stocks:[["RKLB","Rocket Lab"],["ASTS","AST SpaceMobile"],["IRDM","Iridium"]]},
];
export default function StockThemeDiscovery({lang,onSelect}:{lang:Language;onSelect:(ticker:string)=>void}) {
 const [id,setId]=useState("memory");
 const selected=themes.find(theme=>theme.id===id)!;
 return <section className={styles.root} aria-labelledby="stock-themes-title">
  <div className={styles.heading}><h2 id="stock-themes-title">{lang==="ja"?"テーマから探す":"Explore by theme"}</h2>
   <select value={id} onChange={event=>setId(event.target.value)} aria-label={lang==="ja"?"銘柄のテーマ":"Stock theme"}>{themes.map(theme=><option key={theme.id} value={theme.id}>{theme[lang]}</option>)}</select>
  </div>
  <ul className={styles.stocks}>{selected.stocks.map(([ticker,name])=><li key={ticker}><button onClick={()=>onSelect(ticker)}><strong>{ticker}</strong><span>{name}</span><span className={styles.open} aria-hidden="true">›</span></button></li>)}</ul>
 </section>;
}
