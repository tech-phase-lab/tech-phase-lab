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
        <h2 id="tech-phase-market-title"><span>{ticker}</span><small>{exchangeLabel}</small></h2>
        <p className={styles.company}>{name}</p>
      </div>
      {onToggleFavorite && <button type="button" className={styles.favoriteStar} onClick={onToggleFavorite} aria-pressed={favorite} aria-label={t(favorite ? "お気に入りから解除" : "お気に入りに追加", favorite ? "Remove from favorites" : "Add to favorites")} title={t(favorite ? "お気に入りから解除" : "お気に入りに追加", favorite ? "Remove from favorites" : "Add to favorites")}><svg width="18" height="18" viewBox="0 0 24 24" fill={favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2-4.5-4.4 6.3-.9Z" /></svg><span>{t(favorite ? "登録済み" : "お気に入り", favorite ? "Saved" : "Favorite")}</span></button>}
    </header>

    <div className={styles.chartSlot}>
      <TradingViewChart ticker={ticker} exchange={exchange} lang={lang} />
    </div>

  </section>;
}
