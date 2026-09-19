"use client";

import { useState } from "react";
import Link from "next/link";
import type { CompanyComparison, CompanyProfile } from "@/lib/research/companies";
import type { Language, ResearchEvent } from "@/lib/research/data";
import { compareMetrics, type Source } from "@/lib/research/quality";
import { dateLabel, valueLabel } from "@/lib/research/presentation";
import { useResearchLanguage } from "../use-research-language";
import base from "../research.module.css";
import styles from "./company.module.css";

function changeLabel(row: CompanyComparison, lang: Language) {
  const result = compareMetrics(row.current, row.previous);
  if (result.ok) return `${row.approximate ? lang === "ja" ? "約 " : "≈ " : ""}${result.value > 0 ? "+" : ""}${result.value.toFixed(1)}${result.unit === "pp" ? lang === "ja" ? "pt" : "pp" : "%"}`;
  if (result.reason === "non-positive-base") {
    const difference = row.current.value - row.previous.value;
    return `${difference > 0 ? "+" : ""}${valueLabel({ ...row.current, value: difference })}`;
  }
  return lang === "ja" ? "比較不可" : "Not comparable";
}

function EvidenceLinks({ ids, sources, lang }: { ids: string[]; sources: Source[]; lang: Language }) {
  return <span className={styles.evidence}>{ids.map((id, index) => {
    const source = sources.find((item) => item.id === id);
    return source ? <a key={id} href={source.url} target="_blank" rel="noreferrer" aria-label={`${lang === "ja" ? "原文" : "Source"}: ${source.title}`} title={`${source.title} · ${source.location}`}>
      {ids.length > 1 ? `${lang === "ja" ? "原文" : "Source"} ${index + 1}` : lang === "ja" ? "原文" : "Source"} ↗
    </a> : null;
  })}</span>;
}

export default function CompanyDashboard({ profile }: { profile: CompanyProfile }) {
  const [lang, setLang] = useResearchLanguage();
  const [topic, setTopic] = useState<ResearchEvent["kind"] | "all">("all");
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const kinds = { earnings: t("決算", "Earnings"), capacity: t("設備・電力", "Capacity"), financing: t("資金調達", "Funding"), partnership: t("提携", "Partnership") };
  const filtered = profile.events.filter((event) => topic === "all" || event.kind === topic);
  const availableTopics = [...new Set(profile.events.map((event) => event.kind))];
  const firstRow = profile.comparisons[0];
  const latestDate = profile.events[0].publishedOn;

  return <div className={base.app} lang={lang}>
    <a className={base.skip} href="#company-main">{t("本文へ移動", "Skip to content")}</a>
    <header className={base.header}>
      <Link href="/research" className={base.brand} aria-label="Tech Phase Research"><span className={base.mark}>TP<span /></span><span>TECH PHASE<small>RESEARCH</small></span></Link>
      <div className={base.headerRight}><span className={base.edition}>COMPANY RESEARCH <span>02</span></span><div className={base.languages} aria-label={t("言語", "Language")}>
        <button onClick={() => setLang("ja")} aria-pressed={lang === "ja"}>日本語</button><button onClick={() => setLang("en")} aria-pressed={lang === "en"}>EN</button>
      </div></div>
    </header>
    <main className={styles.main} id="company-main">
      <div className={styles.topline}>
        <Link href="/research" className={styles.back}>← {t("リサーチ一覧", "All research")}</Link>
        <nav aria-label={t("銘柄を選択", "Choose company")} className={styles.companySwitch}>
          {(["NBIS", "MU"] as const).map((ticker) => <Link key={ticker} href={`/research/companies/${ticker}`} aria-current={profile.ticker === ticker ? "page" : undefined}>{ticker}<span>{ticker === "MU" ? "Micron" : "Nebius"}</span></Link>)}
        </nav>
      </div>
      <div className={styles.preview}><strong>{t("過去資料の比較版", "HISTORICAL REVIEW")}</strong><span>{t("収録資料の最終発表日", "Latest included release")}: {latestDate} · {t("自動更新なし", "No automatic updates")}</span></div>
      <header className={styles.companyHeading}>
        <div><p className={styles.eyebrow}>{profile.sector[lang]}</p><h1>{profile.ticker} <span>{profile.name}</span></h1><p className={styles.focus}>{profile.focus[lang]}</p></div>
        <div className={styles.reviewed}><span>{t("資料照合日", "Source review")}</span><time dateTime={profile.reviewedOn}>{profile.reviewedOn}</time></div>
      </header>

      <nav className={styles.sectionNav} aria-label={t("ページ内の項目", "On this page")}>
        <a href="#comparison">{t("数値の変化", "Financial changes")}</a><a href="#targets">{t("会社見通し", "Guidance")}</a><a href="#checkpoints">{t("次の確認点", "What to watch")}</a><a href="#history">{t("発表の履歴", "Release history")}</a>
      </nav>

      <section className={styles.summary} aria-label={t("今回の比較", "Comparison overview")}>
        <div className={styles.revenueSummary}><span>{firstRow.label[lang]}</span><div><strong>{valueLabel(firstRow.current)}</strong><b>{changeLabel(firstRow, lang)}</b></div><p>{firstRow.current.period} / {firstRow.previous.period} {t("比", "comparison")}</p></div>
        <div className={styles.readingSummary}><span>{t("あわせて見ること", "READ ALONGSIDE GROWTH")}</span><p>{profile.ticker === "NBIS" ? t("売上は拡大。営業赤字の拡大と株式売却も、同じ画面で追う。", "Revenue grew. Track the wider operating loss and equity sales alongside it.") : t("粗利益率と調整後FCFは改善。Q4見通しの達成は、実績の収録後に判定する。", "Margins and adjusted cash flow improved. Q4 guidance needs a later actual-results check.")}</p><EvidenceLinks ids={profile.ticker === "NBIS" ? ["nbis-q1", "nbis-q2", "nbis-letter"] : ["mu-q3"]} sources={profile.sources} lang={lang} /></div>
      </section>

      <section id="comparison" className={styles.section}>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>01 / FINANCIAL CHANGES</p><h2>{t("前回から、数字はどう変わったか", "What changed in the numbers?")}</h2></div><span>{firstRow.previous.period} → {firstRow.current.period}</span></div>
        <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={t("数値比較表。狭い画面では横にスクロールできます", "Financial comparisons. Scroll horizontally on small screens")}>
          <table className={styles.comparisonTable}><caption>{t("金額のMは百万米ドル。実績とARRを区別し、同じ対象・基準で比較しています。", "M denotes USD millions. Actuals and ARR remain distinct; each row retains a consistent scope and basis.")}</caption>
            <thead><tr><th scope="col">{t("指標・定義", "Metric / definition")}</th><th scope="col">{firstRow.previous.period}</th><th scope="col">{firstRow.current.period}</th><th scope="col">{t("変化", "Change")}</th></tr></thead>
            <tbody>{profile.comparisons.map((row) => <tr key={row.id}>
              <th scope="row"><strong>{row.label[lang]}</strong><span className={styles.basis}>{row.current.scope} · {row.current.basis} · {row.current.kind === "run-rate" ? t("年換算指標", "Run-rate") : t("実績", "Actual")}</span><p>{row.note[lang]}</p></th>
              <td><span className={styles.number}>{valueLabel(row.previous)}</span><time dateTime={row.previous.periodEnd}>{row.previous.periodEnd}</time><EvidenceLinks ids={[row.previous.sourceId]} sources={profile.sources} lang={lang} /></td>
              <td><span className={styles.number}>{valueLabel(row.current)}</span><time dateTime={row.current.periodEnd}>{row.current.periodEnd}</time><EvidenceLinks ids={[row.current.sourceId]} sources={profile.sources} lang={lang} /></td>
              <td><strong className={styles.delta}>{changeLabel(row, lang)}</strong><small>{row.current.name === "operating-income" ? t("金額差・損失拡大", "Amount · loss widened") : row.current.unit === "percent" ? t("ポイント差", "Percentage points") : t("前四半期比", "Quarter-on-quarter")}</small></td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <section id="targets" className={styles.section}>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>02 / GUIDANCE TRACKER</p><h2>{profile.target.title[lang]}</h2></div><span>{profile.target.period[lang]}</span></div>
        <div className={styles.targetPanel}>
          <ol className={styles.targetHistory}>{profile.target.disclosures.map((item) => <li key={item.announcedOn}><span>{t("発表日", "Announced")} <time dateTime={item.announcedOn}>{item.announcedOn}</time></span><strong>{item.value[lang]}</strong><small>{t("会社見通し", "Company guidance")}</small><EvidenceLinks ids={[item.sourceId]} sources={profile.sources} lang={lang} /></li>)}</ol>
          <div className={styles.targetStatus}><span>{t("結果の確認", "OUTCOME CHECK")}</span><strong>{profile.target.observation[lang]}</strong><p>{profile.target.note[lang]}</p></div>
        </div>
      </section>

      <section id="checkpoints" className={styles.section}>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>03 / WHAT TO WATCH</p><h2>{t("次の発表で、確認すること", "Questions for the next release")}</h2></div></div>
        <p className={styles.sectionNote}>{t("収録資料をもとにした確認項目です。将来の悪化や達成を断定するものではありません。", "Research checkpoints based on the included documents, not predictions of deterioration or achievement.")}</p>
        <div className={styles.checkpoints}>{profile.checkpoints.map((item) => <article key={item.id} className={styles.checkpoint}>
          <span className={`${styles.status} ${item.status === "risk" ? styles.caution : ""}`}>{item.status === "risk" ? t("注意して追う", "Watch closely") : item.status === "pending" ? t("結果を追う", "Follow the outcome") : t("変化を確認", "Change observed")}</span>
          <h3>{item.title[lang]}</h3><p>{item.observation[lang]}</p><div className={styles.next}><span>{t("次の確認", "NEXT CHECK")}</span><p>{item.watch[lang]}</p></div><EvidenceLinks ids={item.sourceIds} sources={profile.sources} lang={lang} />
        </article>)}</div>
      </section>

      <section id="history" className={styles.section}>
        <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>04 / RELEASE HISTORY</p><h2>{t("発表を、時系列でつなぐ", "Connect the disclosures over time")}</h2></div><span aria-live="polite">{filtered.length} {t("件の記録", "research records")}</span></div>
        <p className={styles.sectionNote}>{t("日付は資料の発表日です。選んだ資料の記録で、すべてのニュースを網羅していません。", "Dates refer to publication. This is a selected research history, not a complete news feed.")}</p>
        {availableTopics.length > 1 && <div className={styles.topicFilters} role="group" aria-label={t("履歴を絞り込み", "Filter history")}><button aria-pressed={topic === "all"} onClick={() => setTopic("all")}>{t("すべて", "All")}</button>{availableTopics.map((kind) => <button key={kind} aria-pressed={topic === kind} onClick={() => setTopic(kind)}>{kinds[kind]}</button>)}</div>}
        <ol className={styles.timeline}>{filtered.map((event) => <li key={event.id}>
          <div className={styles.timelineDate}><time dateTime={event.publishedOn}>{dateLabel(event.publishedOn, lang)}</time><span>{kinds[event.kind]}</span></div>
          <article className={styles.timelineArticle}><h3>{event.title[lang]}</h3><p>{event.summary[lang]}</p>
            <details><summary>{t("事実と確認事項を開く", "Read facts and checkpoints")}</summary><div className={styles.timelineDetail}>
              <h4>{t("資料で確認できる事実", "Facts in the source")}</h4><ul>{event.facts.map((fact, index) => <li key={index}>{fact.text[lang]} <EvidenceLinks ids={fact.sourceIds} sources={profile.sources} lang={lang} /></li>)}</ul>
              <h4>{t("分析・解釈", "Interpretation")}</h4><p>{event.interpretation[lang]}</p><h4>{t("この発表だけでは分からないこと", "What this release does not establish")}</h4><p>{event.unknown[lang]}</p>
            </div></details>
          </article>
        </li>)}</ol>
      </section>

      <section className={styles.section} aria-labelledby="company-sources"><div className={styles.sectionHeading}><h2 id="company-sources">{t("使用した一次資料", "Primary sources used")}</h2></div><div className={styles.sourceList}>{profile.sources.map((source) => <a key={source.id} href={source.url} target="_blank" rel="noreferrer"><strong>{source.title} <span aria-hidden="true">↗</span></strong><span>{source.publisher} · {source.publishedOn}</span><small>{source.location}</small></a>)}</div></section>
      <footer className={styles.footer}><span>TECH PHASE RESEARCH</span><p>{t("株価・速報の配信は未接続。後日の訂正や新しい発表は自動反映していません。", "Live prices and news are not connected. Subsequent corrections and releases are not incorporated automatically.")}</p></footer>
    </main>
  </div>;
}
