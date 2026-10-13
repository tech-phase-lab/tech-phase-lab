import type { ReactNode } from "react";
import type { CompanyIntroduction } from "@/lib/research/company-introductions";
import type { CompanyNetwork } from "@/lib/research/company-network";
import { CompanyIntroductionPanel } from "./company-introduction";
import { TradingViewChart } from "./tradingview-chart";
import styles from "./market-workspace.module.css";

type MarketWorkspaceProps = {
  ticker: string;
  exchange: string;
  name: string;
  lang: "ja" | "en";
  favoriteControl?: ReactNode;
  network?: CompanyNetwork | null;
  introduction?: CompanyIntroduction | null;
};

export function MarketWorkspace({ ticker, exchange, name, lang, favoriteControl, introduction, network }: MarketWorkspaceProps) {
  const exchangeLabel = exchange === "Nasdaq" ? "NASDAQ" : exchange.toUpperCase();

  return <section className={styles.workspace} aria-labelledby="tech-phase-market-title">
    <header className={styles.header}>
      <div>
        <p className={styles.eyebrow}>TECH PHASE MARKET</p>
        <h2 id="tech-phase-market-title"><span>{ticker}</span><small>{exchangeLabel}</small></h2>
        <p className={styles.company}>{name}</p>
      </div>
      {favoriteControl}
    </header>

    <div className={styles.chartSlot}>
      <TradingViewChart ticker={ticker} exchange={exchange} lang={lang} />
    </div>

    {introduction && <CompanyIntroductionPanel introduction={introduction} network={network} lang={lang} />}
  </section>;
}
