"use client";

import { useEffect, useId, useRef, useState } from "react";
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
    <div className={`${styles.embed} ${polish.embed} ${kind === "chart" ? styles.chartEmbed : styles.compactEmbed}`} ref={hostRef} aria-label={`${symbol} TradingView ${kind}`} />
    {kind === "chart" && !failed && <div className={styles.chartHelp}><span>{lang === "ja" ? "チャートが空白の場合は再読み込みしてください。" : "If the chart is blank, try reloading it."}</span><button type="button" onClick={() => setAttempt((current) => current + 1)}>{lang === "ja" ? "チャートを再読み込み" : "Reload chart"}</button></div>}
    {failed && <div className={styles.error} role="status"><span>{lang === "ja" ? "株価表示の読み込みに時間がかかっています。" : "The market view is taking longer than expected to load."}</span><button type="button" onClick={() => { setFailed(false); setAttempt((current) => current + 1); }}>{lang === "ja" ? "再読み込み" : "Retry"}</button></div>}
  </>;
}

export function TradingViewChart({ ticker, exchange, lang }: { ticker: string; exchange: string; lang: "ja" | "en" }) {
  const symbol = tradingViewSymbol(ticker, exchange);
  return <TradingViewPanels key={`${symbol}:${lang}`} symbol={symbol} lang={lang} />;
}

function TradingViewPanels({ symbol, lang }: { symbol: string; lang: "ja" | "en" }) {
  const [view, setView] = useState<WidgetKind>("compact");
  const [chartOpened, setChartOpened] = useState(false);
  const id = useId();

  return <section className={`${styles.market} ${polish.market}`} aria-labelledby="market-chart-title">
    <div className={`${styles.heading} ${polish.heading}`}>
      <h2 id="market-chart-title">MARKET SNAPSHOT</h2>
    </div>
    <div className={`${styles.viewTabs} ${polish.viewTabs}`} role="tablist" aria-label={lang === "ja" ? "株価表示を切り替え" : "Switch price display"}>
      <button id={`${id}-quote-tab`} aria-controls={`${id}-quote-panel`} type="button" role="tab" aria-selected={view === "compact"} onClick={() => setView("compact")}>{lang === "ja" ? "株価" : "Quote"}</button>
      <button id={`${id}-chart-tab`} aria-controls={`${id}-chart-panel`} type="button" role="tab" aria-selected={view === "chart"} onClick={() => { setChartOpened(true); setView("chart"); }}>{lang === "ja" ? "12か月チャート" : "12-month chart"}</button>
    </div>
    {/* Keep each iframe mounted and full-width when inactive. display:none would
        give responsive widgets a zero-width container during tab switches. */}
    <div className={styles.panels}>
      <div id={`${id}-quote-panel`} role="tabpanel" aria-labelledby={`${id}-quote-tab`} className={styles.panel} data-active={view === "compact"} aria-hidden={view !== "compact"} inert={view !== "compact"}>
        <TradingViewEmbed kind="compact" symbol={symbol} lang={lang} />
      </div>
      <div id={`${id}-chart-panel`} role="tabpanel" aria-labelledby={`${id}-chart-tab`} className={styles.panel} data-active={view === "chart"} aria-hidden={view !== "chart"} inert={view !== "chart"}>
        {chartOpened && <TradingViewEmbed kind="chart" symbol={symbol} lang={lang} />}
      </div>
    </div>
    <div className={`${styles.note} ${polish.note}`}><p>{lang === "ja" ? "TradingViewの市場データです。遅延があるため、Tech Phaseの速報判定には使用しません。" : "Market data is provided by TradingView. Because it may be delayed, it is not used for Tech Phase alert decisions."}</p><a href={`https://www.tradingview.com/symbols/${symbol.replace(":", "-").replace(".", "-")}/`} target="_blank" rel="noreferrer">{lang === "ja" ? "TradingViewで確認 ↗" : "Open in TradingView ↗"}</a></div>
  </section>;
}
