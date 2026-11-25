import type { CompanyIntroduction, CompanyIntroductionField } from "@/lib/research/company-introductions";
import type { CompanyNetwork } from "@/lib/research/company-network";
import { CompanyNetworkMap } from "./chain-map";
import { MergedSources } from "./source-list";
import styles from "./company-introduction.module.css";

const headings: [CompanyIntroductionField, string, string][] = [
  ["business", "何の会社？", "What does it do?"],
  ["revenue", "どこで稼ぐ？", "How does it make money?"],
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
    <section className={styles.liteRivals} data-topic="competition">
      <h3><span>05</span>{ja ? "競合は？" : "Who competes with it?"}</h3>
      {rivals.length > 0 ? <div>{rivals.map(entry => <span key={entry.ticker}>{entry.ticker}</span>)}</div> : <p>{ja ? "なし" : "None"}</p>}
    </section>
    <section className={styles.liteMap} data-topic="relationships">
      <h3><span>06</span>{ja ? "どこと繋がる？" : "Who does it work with?"}</h3>
      <p><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>{ja ? "準備中" : "Coming soon"}</p>
    </section>
  </div>;
}

/** `note`: the one closing note under 「出典」. The stock search page leaves it out because its footer carries the same note (owner, Nov 25). */
export function CompanyIntroductionPanel({ introduction, network, lang, note = true }: { introduction: CompanyIntroduction; network?: CompanyNetwork | null; lang: "ja" | "en"; note?: boolean }) {
  return <section className={styles.introduction} aria-label={lang === "ja" ? `${introduction.name}の企業紹介` : `About ${introduction.name}`}>
    <header><h2>{lang === "ja" ? "企業を知る" : "Get to know the company"}</h2></header>
    <dl className={styles.grid}>
      {headings.map(([field, ja, en], index) => <div key={field} className={styles.card} data-topic={field}>
        <dt><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{lang === "ja" ? ja : en}</dt>
        <dd>{introduction[lang][field]}</dd>
      </div>)}
    </dl>
    {/* One 「出典」 for the whole profile: the relationship map's sources and the profile's own, with its 確認日 (owner, Nov 25). */}
    <MergedSources lang={lang} reviewedOn={introduction.reviewedOn} note={note}
      extra={introduction.sources.map(source => ({ url: source.url, label: source.label, notes: [], rows: [] }))}>
      {network ? <CompanyNetworkMap key={network.root} graph={network} lang={lang} /> : !introduction[lang].relationships ? <LiteMaps introduction={introduction} lang={lang} /> : mapHeadings.some(([topic]) => introduction[lang][topic]) && <div className={styles.maps}>
        {mapHeadings.map(([topic, ja, en], index) => introduction[lang][topic] && <section key={topic} className={styles.mapCard} data-topic={topic}>
          <h3><span>0{index + 5}</span>{lang === "ja" ? ja : en}</h3><p>{introduction[lang][topic]}</p>
        </section>)}
      </div>}
    </MergedSources>
  </section>;
}
