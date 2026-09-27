"use client";

import { useEffect, useState } from "react";
import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import styles from "./market.module.css";

type MacroQuote = { id: string; date?: string; value?: number; previous?: number; previousDate?: string; unavailable?: boolean };

function MacroCards({ ja }: { ja: boolean }) {
  const [quotes, setQuotes] = useState<MacroQuote[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/research/macro", { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error("Unavailable");
      return response.json();
    }).then(data => setQuotes(data.items)).catch(() => { if (!controller.signal.aborted) setQuotes([]); });
    return () => controller.abort();
  }, []);
  const series = [
    { id: "DCOILWTICO", name: ja ? "WTI原油" : "WTI Crude", unit: ja ? "現物 · ドル／バレル" : "Spot · USD/barrel" },
    { id: "DGS10", name: ja ? "米国10年債" : "U.S. 10-Year", unit: ja ? "利回り" : "Yield" },
    { id: "DGS30", name: ja ? "米国30年債" : "U.S. 30-Year", unit: ja ? "利回り" : "Yield" },
  ];
  return <section className={styles.macro} aria-label={ja ? "原油・米国債利回り" : "Oil and Treasury yields"}>
    <div className={styles.macroHeading}><h2>{ja ? "原油・米国債" : "Oil & Treasuries"}</h2><span>{ja ? "日次データ" : "Daily data"}</span></div>
    <div className={styles.macroGrid}>{series.map(item => {
      const quote = quotes?.find(quote => quote.id === item.id);
      const value = quote?.value;
      const oil = item.id === "DCOILWTICO";
      const change = value !== undefined && quote?.previous !== undefined ? value - quote.previous : null;
      return <article className={styles.macroCard} key={item.id}>
        <a href={`https://fred.stlouisfed.org/series/${item.id}`} target="_blank" rel="noopener noreferrer">{item.name}<span aria-hidden="true">↗</span></a>
        <p className={styles.macroUnit}>{item.unit}</p>
        <p className={styles.macroValue}>{value === undefined ? "—" : `${oil ? "$" : ""}${value.toFixed(2)}${oil ? "" : "%"}`}</p>
        <p className={styles.macroChange}>{change === null ? (quotes === null ? (ja ? "読込中…" : "Loading…") : (ja ? "取得できませんでした" : "Data unavailable")) : `${ja ? "前回比" : "Change"} ${change > 0 ? "+" : ""}${oil ? change.toFixed(2) + " USD" : (change * 100).toFixed(0) + " bp"}`}</p>
        {quote?.date && <time dateTime={quote.date}>{quote.date}</time>}
      </article>;
    })}</div>
    <p className={styles.note}>{ja ? "出典：FRED（FRB・EIA）。掲載日付時点の値です。" : "Source: FRED (Federal Reserve / EIA). Values as of the dates shown."}</p>
  </section>;
}

export default function MarketPage() {
  const [lang, setLang] = useResearchLanguage();
  const [candles, setCandles] = useState(true);
  const [symbol, setSymbol] = useState("FOREXCOM:SPXUSD");
  const ja = lang === "ja";
  const groups = [
    { name: ja ? "指数" : "Indices", options: [["FOREXCOM:SPXUSD", "S&P 500 · CFD"], ["FOREXCOM:NSXUSD", "Nasdaq 100 · CFD"], ["FOREXCOM:DJI", "Dow 30 · CFD"]] },
    { name: ja ? "債券ETF" : "Bond ETFs", options: [["NASDAQ:SHY", "SHY · 1–3Y"], ["NASDAQ:IEF", "IEF · 7–10Y"], ["NASDAQ:TLT", "TLT · 20+Y"]] },
    { name: ja ? "為替" : "Forex", options: [["FX:USDJPY", "USD / JPY"], ["FX:EURUSD", "EUR / USD"], ["FX:EURJPY", "EUR / JPY"]] },
  ];
  const selectedGroup = groups.find(group => group.options.some(([value]) => value === symbol))!;
  return <ResearchToolShell lang={lang} setLang={setLang} title={ja ? "マーケット" : "Markets"} description="">
    <div className={styles.controls}>
      <div className={styles.categories} role="group" aria-label={ja ? "市場の種類" : "Market category"}>{groups.map(group => <button key={group.name} aria-pressed={group === selectedGroup} onClick={() => setSymbol(group.options[0][0])}>{group.name}</button>)}</div>
      <div className={styles.modes}><button aria-pressed={candles} onClick={() => setCandles(true)}>{ja ? "ローソク足" : "Candlesticks"}</button><button aria-pressed={!candles} onClick={() => setCandles(false)}>{ja ? "ライン" : "Line"}</button></div>
      <select aria-label={ja ? "チャートの対象" : "Chart symbol"} value={symbol} onChange={event => setSymbol(event.target.value)}>
        {selectedGroup.options.map(([value,label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </div>
    <section className={styles.panel} aria-label={ja ? "市場の動き" : "Market overview"}>
      <iframe key={`${lang}-${candles}-${symbol}`} src={`/research/market/widget?v=6&lang=${lang}&chart=1&style=${candles ? "candles" : "line"}&symbol=${encodeURIComponent(symbol)}`} title={ja ? "指数・債券ETF・為替のチャートと価格" : "Indices, bond ETFs and forex charts and quotes"} className={styles.widget} />
    </section>
    <MacroCards ja={ja} />
    <a className={styles.treasury} href="https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve" target="_blank" rel="noopener noreferrer">{ja ? "米国債利回り · 米財務省の公式データ" : "Treasury yields · Official U.S. Treasury data"} ↗</a>
    <p className={styles.note}>{ja ? "指数はCFD参考値、債券はETF価格です。ETFは遅延配信。" : "Indices are indicative CFDs; bonds show ETF prices with delayed quotes."}</p>
  </ResearchToolShell>;
}
