import type { ReactNode } from "react";
import type { CompanyIntroduction } from "@/lib/research/company-introductions";
import type { CompanyNetwork } from "@/lib/research/company-network";
import { CompanyIntroductionPanel } from "./company-introduction";
import { CompanyNetworkMap } from "./chain-map";
import QuoteCard from "../price/quote-card";
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

export function MarketWorkspace({ ticker, name, lang, introduction, network }: MarketWorkspaceProps) {
  return <section className={styles.workspace} aria-label={`${name} ${ticker}`}>

    <div className={styles.chartSlot}>
      <QuoteCard ticker={ticker} variant="dial" from="search" name={name} star />
    </div>

    {introduction && <CompanyIntroductionPanel introduction={introduction} network={network} lang={lang} />}
    {!introduction && network && <CompanyNetworkMap key={network.root} graph={network} lang={lang} />}
  </section>;
}
