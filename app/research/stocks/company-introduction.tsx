import type { CompanyIntroduction, CompanyIntroductionField } from "@/lib/research/company-introductions";
import type { CompanyNetwork } from "@/lib/research/company-network";
import { CompanyNetworkMap } from "./chain-map";
import styles from "./company-introduction.module.css";

const headings: [CompanyIntroductionField, string, string][] = [
  ["business", "何の会社？", "What does it do?"],
  ["revenue", "どこで稼ぐ？", "How does it earn?"],
  ["strength", "何が強い？", "What are its strengths?"],
  ["risks", "弱点は？", "What are the risks?"],
];
const mapHeadings = [
  ["competition", "競合は？", "Who competes with it?"],
  ["relationships", "どこと繋がる？", "Who does it work with?"],
] as const;

/** A company without a connection map: 05 shows the competitors its filing names as tickers, and 06 is a dimmed "coming soon" card
 * so an empty map is never read as "no partners" (owner, Oct 20). */
function LiteMaps({ introduction, lang }: { introduction: CompanyIntroduction; lang: "ja" | "en" }) {
  const ja = lang === "ja";
  const rivals = introduction.maps.competition.filter(entry => entry.kind === "company" && entry.ticker);
  return <div className={styles.lite}>
    {rivals.length > 0 && <section className={styles.liteRivals} data-topic="competition">
      <h3><span>05</span>{ja ? "競合は？" : "Who competes with it?"}</h3>
      <div>{rivals.map(entry => <span key={entry.ticker}>{entry.ticker}</span>)}</div>
    </section>}
    <section className={styles.liteMap} data-topic="relationships">
      <h3><span>06</span>{ja ? "どこと繋がる？" : "Who does it work with?"}</h3>
      <p>{ja ? "取引・提携のマップは準備中です。" : "The partner map is coming soon."}</p>
    </section>
  </div>;
}

export function CompanyIntroductionPanel({ introduction, network, lang }: { introduction: CompanyIntroduction; network?: CompanyNetwork | null; lang: "ja" | "en" }) {
  return <section className={styles.introduction} aria-label={lang === "ja" ? `${introduction.name}の企業紹介` : `About ${introduction.name}`}>
    <header><h2>{lang === "ja" ? "企業を知る" : "Know the company"}</h2></header>
    <dl className={styles.grid}>
      {headings.map(([field, ja, en], index) => <div key={field} className={styles.card} data-topic={field}>
        <dt><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{lang === "ja" ? ja : en}</dt>
        <dd>{introduction[lang][field]}</dd>
      </div>)}
    </dl>
    {network ? <CompanyNetworkMap key={network.root} graph={network} lang={lang} /> : !introduction[lang].relationships ? <LiteMaps introduction={introduction} lang={lang} /> : mapHeadings.some(([topic]) => introduction[lang][topic]) && <div className={styles.maps}>
      {mapHeadings.map(([topic, ja, en], index) => introduction[lang][topic] && <section key={topic} className={styles.mapCard} data-topic={topic}>
        <h3><span>0{index + 5}</span>{lang === "ja" ? ja : en}</h3><p>{introduction[lang][topic]}</p>
      </section>)}
    </div>}
    <details className={styles.sources}>
      <summary>{lang === "ja" ? "出典・確認日" : "Sources & review date"}</summary>
      <p>{lang === "ja" ? "内容確認" : "Reviewed"}: <time dateTime={introduction.reviewedOn}>{introduction.reviewedOn}</time></p>
      <ul>{introduction.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a></li>)}</ul>
    </details>
  </section>;
}
