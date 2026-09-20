"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./tradingview-chart.module.css";
import polish from "./tradingview-polish.module.css";

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
      : "https://s3.tradingview.com/external-embedding/embed-widget-symbol-overview.js";
    script.textContent = JSON.stringify(kind === "compact" ? {
      symbol,
      width: "100%",
      locale: lang === "ja" ? "ja" : "en",
      colorTheme: "dark",
      isTransparent: true,
    } : {
      symbols: [[`${symbol}|12M`]],
      width: "100%",
      height: "100%",
      locale: lang === "ja" ? "ja" : "en",
      colorTheme: "dark",
      autosize: true,
      chartOnly: true,
      showVolume: false,
      showMA: false,
      hideDateRanges: false,
      hideMarketStatus: true,
      hideSymbolLogo: true,
      scalePosition: "right",
      scaleMode: "Normal",
      fontFamily: "-apple-system, BlinkMacSystemFont, Trebuchet MS, Roboto, sans-serif",
      fontSize: "10",
      noTimeScale: false,
      valuesTracking: "1",
      changeMode: "price-and-percent",
      chartType: "area",
      lineWidth: 2,
      lineType: 0,
      dateRanges: ["1d|1", "1m|30", "3m|60", "12m|1D", "60m|1W", "all|1M"],
      upColor: "#7de0b8",
      downColor: "#e58b82",
    });
    const observer = new MutationObserver(() => {
      if (host.querySelector("iframe")) window.clearTimeout(timeout);
    });
    const timeout = window.setTimeout(() => {
      if (!host.querySelector("iframe")) setFailed(true);
    }, 10_000);
    observer.observe(host, { childList: true, subtree: true });
    script.onerror = () => { window.clearTimeout(timeout); setFailed(true); };
    host.appendChild(script);

    return () => { observer.disconnect(); window.clearTimeout(timeout); host.replaceChildren(); };
  }, [kind, lang, symbol]);

  return <>
    <div hidden={failed} className={`${styles.embed} ${polish.embed} ${kind === "chart" ? styles.chartEmbed : styles.compactEmbed}`} ref={hostRef} aria-label={`${symbol} TradingView ${kind}`} />
    {failed && <div className={styles.error} role="status">{lang === "ja" ? "チャートを読み込めませんでした。TradingViewで直接確認できます。" : "The chart could not be loaded. You can open it directly on TradingView."}</div>}
  </>;
}

export function TradingViewChart({ ticker, exchange, lang }: { ticker: string; exchange: string; lang: "ja" | "en" }) {
  const [view, setView] = useState<WidgetKind>("compact");
  const symbol = tradingViewSymbol(ticker, exchange);

  return <section className={`${styles.market} ${polish.market}`} aria-labelledby="market-chart-title">
    <div className={`${styles.heading} ${polish.heading}`}>
      <h2 id="market-chart-title">MARKET SNAPSHOT</h2>
    </div>
    <div className={`${styles.viewTabs} ${polish.viewTabs}`} role="tablist" aria-label={lang === "ja" ? "株価表示を切り替え" : "Switch price display"}>
      <button type="button" role="tab" aria-selected={view === "compact"} onClick={() => setView("compact")}>{lang === "ja" ? "株価" : "Quote"}</button>
      <button type="button" role="tab" aria-selected={view === "chart"} onClick={() => setView("chart")}>{lang === "ja" ? "12か月チャート" : "12-month chart"}</button>
    </div>
    <TradingViewEmbed key={`${symbol}:${lang}:${view}`} kind={view} symbol={symbol} lang={lang} />
    <div className={`${styles.note} ${polish.note}`}><p>{lang === "ja" ? "TradingViewの市場データ（遅延）です。Tech Phaseの速報判定には使用しません。" : "Delayed market data from TradingView. It is not used for Tech Phase alert decisions."}</p><a href={`https://www.tradingview.com/symbols/${symbol.replace(":", "-").replace(".", "-")}/`} target="_blank" rel="noreferrer">{lang === "ja" ? "TradingViewで確認 ↗" : "Open in TradingView ↗"}</a></div>
  </section>;
}
