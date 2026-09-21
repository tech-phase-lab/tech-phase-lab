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
      <div><strong>{t("株価カードと12か月チャート", "Quote card and 12-month chart")}</strong><p>{t("TradingViewの15分遅延データを表示しています。Tech Phaseの速報判定には使用しません。", "TradingView data delayed by 15 minutes is shown below. It is not used for Tech Phase alerts.")}</p></div>
    </div>

    <div className={styles.chartSlot}>
      <TradingViewChart ticker={ticker} exchange={exchange} lang={lang} />
    </div>

    <dl className={styles.connectionStrip}>
      <div><dt>{t("現在の表示", "Current view")}</dt><dd>TradingView</dd></div>
      <div><dt>{t("独自価格フィード", "Custom price feed")}</dt><dd>{t("未接続", "Not connected")}</dd></div>
      <div><dt>{t("外部通知", "External alerts")}</dt><dd>{t("停止中", "Off")}</dd></div>
    </dl>

    <p className={styles.licenseNote}>{t("参考株価はTradingViewで確認できます。速報は公式発表と契約済みニュースを対象にします。未契約の数値や推定値は表示しません。", "Reference prices are available through TradingView. Alerts use official releases and licensed news. Unlicensed or estimated values are not shown.")}</p>
  </section>;
}
