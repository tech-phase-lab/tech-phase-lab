"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./tradingview-chart.module.css";

type WidgetKind = "compact" | "chart";

function tradingViewSymbol(ticker: string, exchange: string) {
  const prefix: Record<string, string> = {
    NASDAQ: "NASDAQ",
    NYSE: "NYSE",
    "NYSE AMERICAN": "AMEX",
    "NYSE ARCA": "AMEX",
    OTC: "OTC",
    CBOE: "CBOE",
  };
  const market = prefix[exchange.trim().toUpperCase()];
  return market ? `${market}:${ticker}` : ticker;
}

function TradingViewEmbed({ kind, symbol, lang }: { kind: WidgetKind; symbol: string; lang: "ja" | "en" }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    host.replaceChildren();
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    host.appendChild(widget);

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;
    script.src = kind === "compact"
      ? "https://s3.tradingview.com/external-embedding/embed-widget-symbol-info.js"
      : "https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js";
    script.textContent = JSON.stringify(kind === "compact" ? {
      symbol,
      width: "100%",
      locale: lang === "ja" ? "ja" : "en",
      colorTheme: "dark",
      isTransparent: true,
    } : {
      symbol,
      width: "100%",
      height: "100%",
      locale: lang === "ja" ? "ja" : "en",
      dateRange: "12M",
      colorTheme: "dark",
      trendLineColor: "rgba(125, 224, 184, 1)",
      underLineColor: "rgba(125, 224, 184, 0.28)",
      underLineBottomColor: "rgba(125, 224, 184, 0)",
      isTransparent: true,
      autosize: true,
      chartOnly: false,
      noTimeScale: false,
      allow_symbol_change: false,
    });
    script.onerror = () => setFailed(true);
    host.appendChild(script);

    return () => host.replaceChildren();
  }, [kind, lang, symbol]);

  return <>
    <div className={`${styles.embed} ${kind === "chart" ? styles.chartEmbed : styles.compactEmbed}`} ref={hostRef} aria-label={`${symbol} TradingView ${kind}`} />
    {failed && <div className={styles.error} role="status">{lang === "ja" ? "TradingViewを読み込めませんでした。SEC企業情報は引き続き利用できます。" : "TradingView could not be loaded. SEC company data remains available."}</div>}
  </>;
}

export function TradingViewChart({ ticker, exchange, name, lang }: { ticker: string; exchange: string; name: string; lang: "ja" | "en" }) {
  const [view, setView] = useState<WidgetKind>("compact");
  const symbol = tradingViewSymbol(ticker, exchange);

  return <section className={styles.market} aria-labelledby="market-chart-title">
    <div className={styles.heading}>
      <div><p>MARKET SNAPSHOT</p><h2 id="market-chart-title">{ticker} {lang === "ja" ? "マーケット情報" : "market snapshot"}</h2><span>{name}</span></div>
      <strong>{lang === "ja" ? "TradingView提供・遅延" : "TradingView · delayed"}</strong>
    </div>
    <div className={styles.viewTabs} role="tablist" aria-label={lang === "ja" ? "株価表示を切り替え" : "Switch price display"}>
      <button type="button" role="tab" aria-selected={view === "compact"} onClick={() => setView("compact")}>{lang === "ja" ? "小型の株価カード" : "Compact price card"}</button>
      <button type="button" role="tab" aria-selected={view === "chart"} onClick={() => setView("chart")}>{lang === "ja" ? "値動きチャート" : "Price chart"}</button>
    </div>
    <TradingViewEmbed key={`${symbol}:${lang}:${view}`} kind={view} symbol={symbol} lang={lang} />
    <div className={styles.note}><p>{lang === "ja" ? "市場データはTradingView提供。表示には遅延があり、Tech Phaseの速報判定とは独立しています。" : "Market data provided by TradingView. Displayed data is delayed and remains separate from Tech Phase alert decisions."}</p><a href={`https://www.tradingview.com/symbols/${symbol.replace(":", "-").replace(".", "-")}/`} target="_blank" rel="noreferrer">{lang === "ja" ? "TradingViewで確認 ↗" : "Open in TradingView ↗"}</a></div>
  </section>;
}
