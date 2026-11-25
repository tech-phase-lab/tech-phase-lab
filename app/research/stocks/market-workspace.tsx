import type { ReactNode } from "react";
import type { CompanyIntroduction } from "@/lib/research/company-introductions";
import type { CompanyNetwork } from "@/lib/research/company-network";
import { CompanyIntroductionPanel } from "./company-introduction";
import { CompanyNetworkMap } from "./chain-map";
import { MergedSources } from "./source-list";
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
  /** 「15:16 時点」 / "As of 15:16", small under the quote card's right edge (stock search, owner Nov 25). */
  asOf?: ReactNode;
};

export function MarketWorkspace({ ticker, name, lang, introduction, network, asOf }: MarketWorkspaceProps) {
  return <section className={styles.workspace} aria-label={`${name} ${ticker}`}>

    <div className={styles.chartSlot}>
      <QuoteCard ticker={ticker} variant="dial" from="search" name={name} star />
      {asOf && <p className={styles.asOf}>{asOf}</p>}
    </div>

    {/* The stock search footer below carries the one note, so neither the profile nor the map repeats it (owner, Nov 25). */}
    {introduction && <CompanyIntroductionPanel introduction={introduction} network={network} lang={lang} note={false} />}
    {!introduction && network && <MergedSources lang={lang}><CompanyNetworkMap key={network.root} graph={network} lang={lang} /></MergedSources>}
  </section>;
}
