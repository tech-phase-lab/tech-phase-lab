import { TradingViewChart } from "./tradingview-chart";
import styles from "./market-workspace.module.css";

type MarketWorkspaceProps = {
  ticker: string;
  exchange: string;
  name: string;
  lang: "ja" | "en";
  favorite?: boolean;
  onToggleFavorite?: () => void;
};

export function MarketWorkspace({ ticker, exchange, name, lang, favorite, onToggleFavorite }: MarketWorkspaceProps) {
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const exchangeLabel = exchange === "Nasdaq" ? "NASDAQ" : exchange.toUpperCase();

  return <section className={styles.workspace} aria-labelledby="tech-phase-market-title">
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>TECH PHASE MARKET</p>
        <h2 id="tech-phase-market-title"><span>{ticker}</span>{onToggleFavorite && <button type="button" className={styles.favoriteStar} onClick={onToggleFavorite} aria-pressed={favorite} aria-label={t(favorite ? "お気に入りから解除" : "お気に入りに追加", favorite ? "Remove from favorites" : "Add to favorites")} title={t(favorite ? "お気に入りから解除" : "お気に入りに追加", favorite ? "Remove from favorites" : "Add to favorites")}>{favorite ? "★" : "☆"}</button>}<small>{exchangeLabel}</small></h2>
        <p className={styles.company}>{name}</p>
      </div>
      <span className={styles.referenceStatus}><i aria-hidden="true" />{t("参考株価を表示", "Reference market data")}</span>
    </header>

    <div className={styles.chartSlot}>
      <TradingViewChart ticker={ticker} exchange={exchange} lang={lang} />
    </div>

  </section>;
}
