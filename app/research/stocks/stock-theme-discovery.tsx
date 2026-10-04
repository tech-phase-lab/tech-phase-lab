"use client";
import { useState } from "react";
import type { Language } from "@/lib/research/data";
import styles from "./stock-theme-discovery.module.css";
const themes = [
  {id:"all", ja:"すべて", en:"All themes", stocks:[["NVDA","NVIDIA"],["MSFT","Microsoft"],["AMZN","Amazon"],["JPM","JPMorgan Chase"],["LLY","Eli Lilly"],["XOM","Exxon Mobil"]]},
  {id:"finance", ja:"金融", en:"Financials", stocks:[["JPM","JPMorgan Chase"],["V","Visa"],["MA","Mastercard"]]},
  {id:"health", ja:"ヘルスケア", en:"Healthcare", stocks:[["LLY","Eli Lilly"],["JNJ","Johnson & Johnson"],["ABBV","AbbVie"]]},
  {id:"consumer", ja:"消費・小売", en:"Consumer & retail", stocks:[["AMZN","Amazon"],["COST","Costco"],["WMT","Walmart"],["PM","Philip Morris International"]]},
  {id:"energy", ja:"エネルギー", en:"Energy", stocks:[["XOM","Exxon Mobil"],["CVX","Chevron"],["COP","ConocoPhillips"]]},
  {id:"memory", ja:"メモリ", en:"Memory", stocks:[["MU","Micron"],["SKHY","SK hynix"],["DRAM","Roundhill Memory ETF"],["SNDK","SanDisk"],["WDC","Western Digital"],["STX","Seagate"]]},
  {id:"cloud", ja:"AIクラウド", en:"AI cloud", stocks:[["NBIS","Nebius"],["CRWV","CoreWeave"],["IREN","IREN"]]},
  {id:"chips", ja:"AI半導体", en:"AI chips", stocks:[["NVDA","NVIDIA"],["AMD","AMD"],["AVGO","Broadcom"],["MRVL","Marvell"],["CBRS","Cerebras"],["ARM","Arm"]]},
  {id:"manufacturing", ja:"半導体製造・検査", en:"Chip manufacturing & testing", stocks:[["ASML","ASML"],["TSM","TSMC"],["AEHR","Aehr Test Systems"]]},
  {id:"network", ja:"ネットワーク・接続", en:"Networking & connectivity", stocks:[["ALAB","Astera Labs"],["ANET","Arista Networks"],["APH","Amphenol"]]},
  {id:"optical", ja:"光通信", en:"Optical links", stocks:[["LITE","Lumentum"],["COHR","Coherent"],["CRDO","Credo"],["GLW","Corning"],["AAOI","Applied Optoelectronics"],["CIEN","Ciena"]]},
  {id:"power", ja:"電力・冷却", en:"Power & cooling", stocks:[["VRT","Vertiv"],["GEV","GE Vernova"],["BE","Bloom Energy"],["VST","Vistra"]]},
  {id:"security", ja:"サイバーセキュリティ", en:"Cybersecurity", stocks:[["CRWD","CrowdStrike"],["PANW","Palo Alto Networks"],["ZS","Zscaler"],["FTNT","Fortinet"]]},
  {id:"gold", ja:"金・金鉱山", en:"Gold & miners", stocks:[["NEM","Newmont"],["AEM","Agnico Eagle"],["KGC","Kinross Gold"],["GLDM","SPDR Gold MiniShares ETF"]]},
  {id:"software", ja:"ソフトウェア", en:"Software", stocks:[["MSFT","Microsoft"],["CRM","Salesforce"],["NOW","ServiceNow"],["ADBE","Adobe"],["PLTR","Palantir"],["APP","AppLovin"]]},
  {id:"space", ja:"宇宙関連", en:"Space", stocks:[["RKLB","Rocket Lab"],["ASTS","AST SpaceMobile"],["IRDM","Iridium"],["SPCX","SpaceX"],["PL","Planet Labs"]]},
  {id:"drones", ja:"ドローン", en:"Drones", stocks:[["AVAV","AeroVironment"],["ONDS","Ondas"],["RCAT","Red Cat"]]},
  {id:"quantum", ja:"量子コンピュータ", en:"Quantum computing", stocks:[["IONQ","IonQ"],["RGTI","Rigetti Computing"],["QBTS","D-Wave Quantum"]]},
];
const domains: Record<string,string> = {GLW:"corning.com",AAOI:"ao-inc.com",CIEN:"ciena.com",SPCX:"spacex.com",PL:"planet.com",PLTR:"palantir.com",APP:"applovin.com",CBRS:"cerebras.ai",ALAB:"asteralabs.com",ARM:"arm.com",ANET:"arista.com",ASML:"asml.com",TSM:"tsmc.com",PM:"pmi.com",APH:"amphenol.com",AEHR:"aehr.com",GLDM:"ssga.com",AVAV:"avinc.com",ONDS:"ondas.com",RCAT:"redcat.red",IONQ:"ionq.com",RGTI:"rigetti.com",QBTS:"dwavequantum.com",MU:"micron.com",SKHY:"skhynix.com",DRAM:"roundhillinvestments.com",NVDA:"nvidia.com",MSFT:"microsoft.com",AMZN:"amazon.com",JPM:"jpmorganchase.com",LLY:"lilly.com",XOM:"exxonmobil.com",V:"visa.com",MA:"mastercard.com",JNJ:"jnj.com",ABBV:"abbvie.com",COST:"costco.com",WMT:"walmart.com",CVX:"chevron.com",COP:"conocophillips.com",SNDK:"sandisk.com",WDC:"westerndigital.com",STX:"seagate.com",NBIS:"nebius.com",CRWV:"coreweave.com",IREN:"iren.com",AMD:"amd.com",AVGO:"broadcom.com",MRVL:"marvell.com",LITE:"lumentum.com",COHR:"coherent.com",CRDO:"credosemi.com",VRT:"vertiv.com",GEV:"gevernova.com",BE:"bloomenergy.com",VST:"vistracorp.com",CRWD:"crowdstrike.com",PANW:"paloaltonetworks.com",ZS:"zscaler.com",FTNT:"fortinet.com",NEM:"newmont.com",AEM:"agnicoeagle.com",KGC:"kinross.com",CRM:"salesforce.com",NOW:"servicenow.com",ADBE:"adobe.com",RKLB:"rocketlabcorp.com",ASTS:"ast-science.com",IRDM:"iridium.com"};
function StockLogo({ticker}:{ticker:string}) {
 const [failed,setFailed]=useState(false);
 return <span className={styles.logo} aria-hidden="true">{!failed && domains[ticker] ?
  // Site icons identify the company; the adjacent text remains the accessible name.
  // eslint-disable-next-line @next/next/no-img-element
  <img src={`https://www.google.com/s2/favicons?domain=${domains[ticker]}&sz=64`} width={24} height={24} alt="" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)} /> : ticker.slice(0,1)}</span>;
}
export default function StockThemeDiscovery({lang,onSelect}:{lang:Language;onSelect:(ticker:string)=>void}) {
 const [id,setId]=useState("all");
 const selected=themes.find(theme=>theme.id===id)!;
 return <section className={styles.root} aria-labelledby="stock-themes-title">
  <div className={styles.heading}><h2 id="stock-themes-title">{lang==="ja"?"テーマから探す":"Explore by theme"}</h2>
   <select value={id} onChange={event=>setId(event.target.value)} aria-label={lang==="ja"?"銘柄のテーマ":"Stock theme"}>{themes.map(theme=><option key={theme.id} value={theme.id}>{theme[lang]}</option>)}</select>
  </div>
  <ul className={styles.stocks}>{selected.stocks.map(([ticker,name])=><li key={ticker}><button onClick={()=>onSelect(ticker)}><StockLogo ticker={ticker} /><strong>{ticker}</strong><span>{name}</span><span className={styles.open} aria-hidden="true">›</span></button></li>)}</ul>
 </section>;
}
