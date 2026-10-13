import type { CompanyIntroduction, CompanyIntroductionField, CompanyConnection } from "@/lib/research/company-introductions";
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

function ConnectionNode({ entry, lang }: { entry: CompanyConnection; lang: "ja" | "en" }) {
  const name = lang === "ja" ? entry.nameJa ?? entry.name : entry.name;
  const contents = <>
    <span className={styles.nodeIdentity}>
      {entry.ticker && <strong className={styles.ticker}>{entry.ticker}</strong>}
      <span className={styles.nodeName}>{name}</span>
    </span>
    <span className={styles.relation}>{entry.label[lang]}</span>
  </>;
  return <li className={styles.branch} data-role={entry.role} data-kind={entry.kind}>
    {entry.ticker
      ? <a className={styles.node} href={`/research/stocks?q=${encodeURIComponent(entry.ticker)}`} aria-label={`${name} (${entry.ticker}) — ${entry.label[lang]} — ${lang === "ja" ? "銘柄を検索" : "Search stock"}`}>{contents}<span className={styles.nodeArrow} aria-hidden="true">›</span></a>
      : <div className={styles.node}>{contents}</div>}
  </li>;
}

export function CompanyIntroductionPanel({ introduction, lang }: { introduction: CompanyIntroduction; lang: "ja" | "en" }) {
  return <section className={styles.introduction} aria-label={lang === "ja" ? `${introduction.name}の企業紹介` : `About ${introduction.name}`}>
    <header><h2>{lang === "ja" ? "企業を知る" : "Know the company"}</h2><span>{introduction.name}</span></header>
    <dl className={styles.grid}>
      {headings.map(([field, ja, en], index) => <div key={field} className={styles.card} data-topic={field}>
        <dt><span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{lang === "ja" ? ja : en}</dt>
        <dd>{introduction[lang][field]}</dd>
      </div>)}
    </dl>
    <div className={styles.maps}>
      {mapHeadings.map(([topic, ja, en], index) => <section key={topic} className={styles.mapCard} data-topic={topic} aria-label={lang === "ja" ? ja : en}>
        <h3><span aria-hidden="true">0{index + 5}</span>{lang === "ja" ? ja : en}</h3>
        <div className={styles.network}>
          <div className={styles.hub}><strong>{introduction.tickers[0]}</strong><span>{introduction.name}</span></div>
          <ul className={styles.branches}>
            {introduction.maps[topic].map(entry => <ConnectionNode key={entry.ticker ?? entry.name} entry={entry} lang={lang} />)}
          </ul>
        </div>
        <details className={styles.mapExplanation}>
          <summary>{lang === "ja" ? "関係の説明・出典" : "Context & sources"}</summary>
          <p>{introduction[lang][topic]}</p>
          <ul>{introduction.maps[topic].map(entry => <li key={entry.ticker ?? entry.name}>
            <span>{lang === "ja" ? entry.nameJa ?? entry.name : entry.name}</span>
            {entry.sourceIndexes.map(sourceIndex => <a key={sourceIndex} href={introduction.sources[sourceIndex].url} target="_blank" rel="noreferrer">{lang === "ja" ? "出典" : "Source"}{entry.sourceIndexes.length > 1 ? ` ${sourceIndex + 1}` : ""} ↗</a>)}
          </li>)}</ul>
        </details>
      </section>)}
    </div>
    <details className={styles.sources}>
      <summary>{lang === "ja" ? "出典・確認日" : "Sources & review date"}</summary>
      <p>{lang === "ja" ? "内容確認" : "Reviewed"}: <time dateTime={introduction.reviewedOn}>{introduction.reviewedOn}</time></p>
      <ul>{introduction.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a></li>)}</ul>
    </details>
  </section>;
}
