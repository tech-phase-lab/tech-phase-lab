"use client";

import Script from "next/script";
import { useCallback, useMemo, useRef, useState } from "react";
import styles from "./tradingview-chart.module.css";

type TradingViewWidgetConfig = {
  autosize: boolean;
  symbol: string;
  interval: string;
  timezone: string;
  theme: string;
  style: string;
  locale: string;
  allow_symbol_change: boolean;
  calendar: boolean;
  details: boolean;
  hide_side_toolbar: boolean;
  save_image: boolean;
  support_host: string;
  container_id: string;
};

declare global {
  interface Window {
    TradingView?: { widget: new (config: TradingViewWidgetConfig) => unknown };
  }
}

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

export function TradingViewChart({ ticker, exchange, name, lang }: { ticker: string; exchange: string; name: string; lang: "ja" | "en" }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const symbol = useMemo(() => tradingViewSymbol(ticker, exchange), [ticker, exchange]);
  const containerId = useMemo(() => `tradingview-chart-${ticker.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`, [ticker]);

  const mountWidget = useCallback(() => {
    if (!hostRef.current || !window.TradingView) return;
    hostRef.current.replaceChildren();
    const container = document.createElement("div");
    container.id = containerId;
    container.className = styles.canvas;
    hostRef.current.appendChild(container);
    new window.TradingView.widget({
      autosize: true,
      symbol,
      interval: "D",
      timezone: "Asia/Tokyo",
      theme: "dark",
      style: "1",
      locale: lang === "ja" ? "ja" : "en",
      allow_symbol_change: false,
      calendar: false,
      details: true,
      hide_side_toolbar: false,
      save_image: false,
      support_host: "https://www.tradingview.com",
      container_id: containerId,
    });
  }, [containerId, lang, symbol]);

  return <section className={styles.market} aria-labelledby="market-chart-title">
    <div className={styles.heading}>
      <div><p>MARKET SNAPSHOT</p><h2 id="market-chart-title">{ticker} {lang === "ja" ? "株価チャート" : "price chart"}</h2><span>{name}</span></div>
      <strong>{lang === "ja" ? "TradingView提供・遅延" : "TradingView · delayed"}</strong>
    </div>
    <Script id="tradingview-widget-loader" src="https://s3.tradingview.com/tv.js" strategy="lazyOnload" onReady={mountWidget} onError={() => setFailed(true)} />
    <div className={styles.host} ref={hostRef} aria-label={`${ticker} TradingView chart`} />
    {failed && <div className={styles.error} role="status">{lang === "ja" ? "チャートを読み込めませんでした。企業情報とSEC原文は引き続き利用できます。" : "The chart could not be loaded. Company data and SEC sources remain available."}</div>}
    <div className={styles.note}><p>{lang === "ja" ? "無料ウィジェットによる参考表示です。米国株はTradingView側の利用可能市場データを使い、正確な遅延時間は保証されません。売買判断やTech Phaseの速報処理には使用しません。" : "This is a reference display from the free widget. U.S. stocks use market data available to TradingView; the exact delay is not guaranteed. It is not used for trading decisions or Tech Phase alert processing."}</p><a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">{lang === "ja" ? "TradingViewで確認 ↗" : "Open in TradingView ↗"}</a></div>
  </section>;
}
