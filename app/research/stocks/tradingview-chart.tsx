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
  const viewportRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

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
      : "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.textContent = JSON.stringify(kind === "compact" ? {
      symbol,
      width: "100%",
      locale: lang === "ja" ? "ja" : "en",
      colorTheme: "dark",
      isTransparent: true,
    } : {
      symbol,
      interval: "D",
      range: "12M",
      timezone: "exchange",
      locale: lang === "ja" ? "ja" : "en",
      theme: "dark",
      backgroundColor: "rgba(16, 24, 32, 1)",
      autosize: true,
      style: "3",
      withdateranges: false,
      hide_top_toolbar: true,
      hide_side_toolbar: true,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });
    const observer = new MutationObserver(() => {
      if (host.querySelector("iframe")) {
        window.clearTimeout(timeout);
        setFailed(false);
      }
    });
    const timeout = window.setTimeout(() => {
      if (!host.querySelector("iframe")) setFailed(true);
    }, 15_000);
    observer.observe(host, { childList: true, subtree: true });
    script.onerror = () => { window.clearTimeout(timeout); setFailed(true); };
    host.appendChild(script);

    return () => { observer.disconnect(); window.clearTimeout(timeout); host.replaceChildren(); };
  }, [attempt, kind, lang, symbol]);

  return <>
    {kind === "compact" && <div className={styles.quoteNavigation}>
      <p>{lang === "ja" ? "横にスワイプして、決算日・時価総額・配当利回りを確認できます。" : "Swipe horizontally to see earnings, market cap and dividend yield."}</p>
      <div>
        <button type="button" onClick={() => viewportRef.current?.scrollTo({ left: 0, behavior: "smooth" })}>{lang === "ja" ? "← 株価" : "← Price"}</button>
        <button type="button" onClick={() => viewportRef.current?.scrollTo({ left: viewportRef.current.scrollWidth, behavior: "smooth" })}>{lang === "ja" ? "指標 →" : "Metrics →"}</button>
      </div>
    </div>}
    <div className={`${styles.embed} ${polish.embed} ${kind === "compact" ? styles.quoteViewport : ""}`} ref={viewportRef} role={kind === "compact" ? "region" : undefined} aria-label={`${symbol} TradingView ${kind}`} tabIndex={kind === "compact" ? 0 : undefined}>
      <div className={kind === "chart" ? styles.chartEmbed : styles.compactEmbed} ref={hostRef} />
    </div>
    {failed && <div className={styles.error} role="status"><span>{lang === "ja" ? "株価表示の読み込みに時間がかかっています。" : "The market view is taking longer than expected to load."}</span><button type="button" onClick={() => { setFailed(false); setAttempt((current) => current + 1); }}>{lang === "ja" ? "再読み込み" : "Retry"}</button></div>}
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
    <div className={`${styles.note} ${polish.note}`}><p>{lang === "ja" ? "TradingViewの市場データです。遅延があるため、Tech Phaseの速報判定には使用しません。" : "Market data is provided by TradingView. Because it may be delayed, it is not used for Tech Phase alert decisions."}</p><a href={`https://www.tradingview.com/symbols/${symbol.replace(":", "-").replace(".", "-")}/`} target="_blank" rel="noreferrer">{lang === "ja" ? "TradingViewで確認 ↗" : "Open in TradingView ↗"}</a></div>
  </section>;
}
