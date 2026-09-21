import { TradingViewChart } from "./tradingview-chart";
import styles from "./market-workspace.module.css";

type MarketWorkspaceProps = {
  ticker: string;
  exchange: string;
  name: string;
  lang: "ja" | "en";
};

export function MarketWorkspace({ ticker, exchange, name, lang }: MarketWorkspaceProps) {
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const exchangeLabel = exchange === "Nasdaq" ? "NASDAQ" : exchange.toUpperCase();

  return <section className={styles.workspace} aria-labelledby="tech-phase-market-title">
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>TECH PHASE MARKET</p>
        <h2 id="tech-phase-market-title"><span>{ticker}</span><small>{exchangeLabel}</small></h2>
        <p className={styles.company}>{name}</p>
      </div>
      <span className={styles.referenceStatus}><i aria-hidden="true" />{t("参考株価を表示", "Reference market data")}</span>
    </header>

    <div className={styles.marketNotice} role="status">
      <span aria-hidden="true">TP</span>
      <div><strong>{t("株価カードと12か月チャート", "Quote card and 12-month chart")}</strong><p>{t("TradingViewの参考データを表示しています。遅延する場合があり、Tech Phaseの速報判定には使用しません。", "Reference data from TradingView is shown below. It may be delayed and is not used for Tech Phase alerts.")}</p></div>
    </div>

    <div className={styles.chartSlot}>
      <TradingViewChart ticker={ticker} exchange={exchange} lang={lang} />
    </div>

    <dl className={styles.connectionStrip}>
      <div><dt>{t("現在の表示", "Current view")}</dt><dd>TradingView</dd></div>
      <div><dt>{t("独自価格フィード", "Custom price feed")}</dt><dd>{t("契約確認中", "Under review")}</dd></div>
      <div><dt>{t("外部通知", "External alerts")}</dt><dd>{t("停止中", "Off")}</dd></div>
    </dl>

    <p className={styles.licenseNote}>{t("価格配信契約の確認後、許諾済みデータを独自画面へ接続します。未契約の数値や推定値は表示しません。", "Licensed data will be connected to the custom view after display rights are confirmed. Unlicensed or estimated values are never shown.")}</p>
  </section>;
}
