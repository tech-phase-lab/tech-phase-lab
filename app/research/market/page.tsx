"use client";

import ResearchToolShell from "../research-tool-shell";
import { useResearchLanguage } from "../use-research-language";
import styles from "./market.module.css";

export default function MarketPage() {
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  return <ResearchToolShell lang={lang} setLang={setLang} title={ja ? "マーケット" : "Markets"} description={ja ? "主要指数・債券・為替" : "Indices, bonds & currencies"}>
    <section className={styles.panel} aria-label={ja ? "市場の動き" : "Market overview"}>
      <iframe key={lang} src={`/research/market/widget?v=3&lang=${lang}`} title={ja ? "指数・債券ETF・為替のチャートと価格" : "Indices, bond ETFs and forex charts and quotes"} className={styles.widget} />
    </section>
    <a className={styles.treasury} href="https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve" target="_blank" rel="noopener noreferrer">{ja ? "米国債利回り · 米財務省の公式データ" : "Treasury yields · Official U.S. Treasury data"} ↗</a>
    <p className={styles.note}>{ja ? "指数はCFD参考値、債券はETF価格です。ETFは遅延配信。" : "Indices are indicative CFDs; bonds show ETF prices with delayed quotes."}</p>
  </ResearchToolShell>;
}
