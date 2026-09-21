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

function TradingViewEmbed({ kind, symbol, lang, attempt }: { kind: WidgetKind; symbol: string; lang: "ja" | "en"; attempt: number }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(220);
  const [failedAttempt, setFailedAttempt] = useState<number | null>(null);

  useEffect(() => {
    function receiveSize(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow) return;
      const data = event.data;
      if (data?.type !== "tech-phase-widget-size" || !Number.isFinite(data.height) || data.height < 100 || data.height > 2400) return;
      if (kind === "compact") setHeight(Math.max(220, Math.ceil(data.height) + 2));
    }
    window.addEventListener("message", receiveSize);
    return () => window.removeEventListener("message", receiveSize);
  }, [kind]);

  const src = `/research/stocks/widget?${new URLSearchParams({ symbol, kind, lang, attempt: String(attempt) })}`;

  return <>
    <div className={`${styles.embed} ${polish.embed} ${kind === "chart" ? styles.chartEmbed : styles.compactEmbed}`} style={kind === "compact" ? { height } : undefined}>
      <iframe key={src} ref={frameRef} src={src} title={`${symbol} TradingView ${kind}`} className={styles.widgetFrame} onError={() => setFailedAttempt(attempt)} />
    </div>
    {failedAttempt === attempt && <p className={styles.error} role="status">{lang === "ja" ? "表示を読み込めませんでした。再読み込みボタンをお試しください。" : "Unable to load the market view. Please use the reload button."}</p>}
  </>;
}

export function TradingViewChart({ ticker, exchange, lang }: { ticker: string; exchange: string; lang: "ja" | "en" }) {
  const symbol = tradingViewSymbol(ticker, exchange);
  return <TradingViewPanels key={`${symbol}:${lang}`} symbol={symbol} lang={lang} />;
}

function TradingViewPanels({ symbol, lang }: { symbol: string; lang: "ja" | "en" }) {
  const [view, setView] = useState<WidgetKind>("compact");
  const [chartOpened, setChartOpened] = useState(false);
  const [attempts, setAttempts] = useState({ compact: 0, chart: 0 });
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
        <TradingViewEmbed kind="compact" symbol={symbol} lang={lang} attempt={attempts.compact} />
      </div>
      <div id={`${id}-chart-panel`} role="tabpanel" aria-labelledby={`${id}-chart-tab`} className={styles.panel} data-active={view === "chart"} aria-hidden={view !== "chart"} inert={view !== "chart"}>
        {chartOpened && <TradingViewEmbed kind="chart" symbol={symbol} lang={lang} attempt={attempts.chart} />}
      </div>
    </div>
    <div className={styles.reloadControl}>
      <button type="button" onClick={() => setAttempts((current) => ({ ...current, [view]: current[view] + 1 }))}><span aria-hidden="true">▶</span>{lang === "ja" ? (view === "chart" ? "チャートを再読み込みする" : "株価・指標を再読み込みする") : "Reload market view"}</button>
    </div>
    <div className={`${styles.note} ${polish.note}`}>
      <p>{lang === "ja" ? "TradingViewの遅延データです。" : "Delayed market data provided by TradingView."}<br />{lang === "ja" ? "Tech Phaseの速報判定には使用しません。" : "Not used for Tech Phase alert decisions."}</p>
      <a href={`https://www.tradingview.com/symbols/${symbol.replace(":", "-").replace(".", "-")}/`} target="_blank" rel="noreferrer">{lang === "ja" ? "TradingViewで確認 ↗" : "Open in TradingView ↗"}</a>
    </div>
  </section>;
}
