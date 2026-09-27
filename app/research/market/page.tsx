"use client";

import { useState } from "react";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import styles from "./market.module.css";

export default function MarketPage() {
  const [lang, setLang] = useResearchLanguage();
  const [candles, setCandles] = useState(false);
  const [symbol, setSymbol] = useState("FOREXCOM:SPXUSD");
  const ja = lang === "ja";
  return <ResearchToolShell lang={lang} setLang={setLang} title={ja ? "マーケット" : "Markets"} description={ja ? "主要指数・債券・為替" : "Indices, bonds & currencies"}>
    <div className={styles.controls}>
      <div className={styles.modes}><button aria-pressed={!candles} onClick={() => setCandles(false)}>{ja ? "一覧" : "Overview"}</button><button aria-pressed={candles} onClick={() => setCandles(true)}>{ja ? "ローソク足" : "Candlesticks"}</button></div>
      {candles && <select aria-label={ja ? "チャートの対象" : "Chart symbol"} value={symbol} onChange={event => setSymbol(event.target.value)}>
        {[ ["FOREXCOM:SPXUSD","S&P 500 · CFD"], ["FOREXCOM:NSXUSD","Nasdaq 100 · CFD"], ["FOREXCOM:DJI","Dow 30 · CFD"], ["NASDAQ:SHY", "SHY · 1–3Y"], ["NASDAQ:IEF","IEF · 7–10Y"], ["NASDAQ:TLT","TLT · 20+Y"], ["FX:USDJPY","USD / JPY"], ["FX:EURUSD","EUR / USD"], ["FX:EURJPY","EUR / JPY"] ].map(([value,label]) => <option key={value} value={value}>{label}</option>)}
      </select>}
    </div>
    <section className={styles.panel} aria-label={ja ? "市場の動き" : "Market overview"}>
      <iframe key={`${lang}-${candles}-${symbol}`} src={`/research/market/widget?v=4&lang=${lang}${candles ? `&chart=1&symbol=${encodeURIComponent(symbol)}` : ""}`} title={ja ? "指数・債券ETF・為替のチャートと価格" : "Indices, bond ETFs and forex charts and quotes"} className={styles.widget} />
    </section>
    <a className={styles.treasury} href="https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve" target="_blank" rel="noopener noreferrer">{ja ? "米国債利回り · 米財務省の公式データ" : "Treasury yields · Official U.S. Treasury data"} ↗</a>
    <p className={styles.note}>{ja ? "指数はCFD参考値、債券はETF価格です。ETFは遅延配信。" : "Indices are indicative CFDs; bonds show ETF prices with delayed quotes."}</p>
  </ResearchToolShell>;
}
