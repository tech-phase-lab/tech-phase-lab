"use client";

import { useState } from "react";
import { TradingViewChart } from "./tradingview-chart";
import styles from "./market-workspace.module.css";

type MarketWorkspaceProps = {
  ticker: string;
  exchange: string;
  name: string;
  lang: "ja" | "en";
};

const ranges = ["1D", "1M", "3M", "1Y"];

export function MarketWorkspace({ ticker, exchange, name, lang }: MarketWorkspaceProps) {
  const [referenceOpen, setReferenceOpen] = useState(false);
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const exchangeLabel = exchange === "Nasdaq" ? "NASDAQ" : exchange.toUpperCase();

  return <section className={styles.workspace} aria-labelledby="tech-phase-market-title">
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>TECH PHASE MARKET</p>
        <h2 id="tech-phase-market-title"><span>{ticker}</span><small>{exchangeLabel}</small></h2>
        <p className={styles.company}>{name}</p>
      </div>
      <span className={styles.pendingStatus}><i aria-hidden="true" />{t("データ接続待ち", "Data connection pending")}</span>
    </header>

    <div className={styles.safetyNotice} role="status">
      <span aria-hidden="true">TP</span>
      <div><strong>{t("独自株価画面は準備済みです", "The custom market view is ready")}</strong><p>{t("価格配信契約の確認後、この画面へ許諾済みデータを接続します。未契約の数値や推定値は表示しません。", "Licensed market data will be connected here after display rights are confirmed. Unlicensed or estimated values are never shown.")}</p></div>
    </div>

    <div className={styles.marketGrid}>
      <article className={styles.quotePanel} aria-label={t(`${ticker}の株価カード`, `${ticker} quote card`)}>
        <div className={styles.panelLabel}><span>{t("現在値", "Last price")}</span><small>USD</small></div>
        <div className={styles.price}>—</div>
        <p className={styles.change}>{t("前日比", "Change")} <strong>—</strong></p>
        <dl className={styles.quoteMeta}>
          <div><dt>{t("市場状態", "Market")}</dt><dd>—</dd></div>
          <div><dt>{t("最終更新", "Updated")}</dt><dd>—</dd></div>
        </dl>
        <dl className={styles.metrics}>
          <div><dt>{t("始値", "Open")}</dt><dd>—</dd></div>
          <div><dt>{t("高値", "High")}</dt><dd>—</dd></div>
          <div><dt>{t("安値", "Low")}</dt><dd>—</dd></div>
          <div><dt>{t("出来高", "Volume")}</dt><dd>—</dd></div>
        </dl>
      </article>

      <article className={styles.chartPanel}>
        <div className={styles.chartHeader}><div><span>{t("価格推移", "Price history")}</span><small>{ticker} · USD</small></div><div className={styles.ranges} aria-label={t("チャート期間（データ接続後に利用可能）", "Chart range (available after data connection)")}>{ranges.map((range) => <button key={range} type="button" disabled>{range}</button>)}</div></div>
        <div className={styles.chartCanvas} role="img" aria-label={t("株価データ未接続のチャート領域", "Chart area awaiting market data")}>
          <div><strong>{t("チャートデータ未接続", "Chart data not connected")}</strong><p>{t("配信元と表示権の確認後に、許諾済みの履歴データを描画します。", "Licensed historical data will be drawn after the provider and display rights are approved.")}</p></div>
        </div>
      </article>
    </div>

    <dl className={styles.connectionStrip}>
      <div><dt>{t("データ提供元", "Provider")}</dt><dd>{t("契約確認中", "Under review")}</dd></div>
      <div><dt>{t("価格フィード", "Price feed")}</dt><dd>{t("停止中", "Off")}</dd></div>
      <div><dt>{t("外部通知", "External alerts")}</dt><dd>{t("停止中", "Off")}</dd></div>
    </dl>

    <details className={styles.reference} onToggle={(event) => setReferenceOpen(event.currentTarget.open)}>
      <summary><span>{t("TradingViewの参考チャートを開く", "Open the TradingView reference chart")}</span><small>{t("API接続前の参考表示です。速報判定には使いません。", "A reference view before API connection. It is not used for alert decisions.")}</small></summary>
      {referenceOpen && <TradingViewChart ticker={ticker} exchange={exchange} lang={lang} />}
    </details>
  </section>;
}
