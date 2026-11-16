"use client";
import { useMemo, useState } from "react";
import { overallComparison } from "@/lib/research/comparison-scorecard";
import { COMPARE_TICKERS, compareNow, compareSample } from "@/lib/research/pro-experience-sample-data";
import { CompanyScoreCard, ScoreHeadline, VerdictHeading, ScoreOverview, StatusOverlay } from "../../compare/comparison-visuals";
import DetailPanels from "../../compare/detail-panels";
import compareStyles from "../../compare/styles.module.css";
import styles from "./samples.module.css";

/** Two of NVDA, AMD, INTC and ARM (no other stock can be chosen); the result is the PRO comparison's own result page, from saved figures. */
export default function CompareSample({ lang }: { lang: "ja" | "en" }) {
  const ja = lang === "ja";
  const [picked, setPicked] = useState<string[]>(["NVDA", "AMD"]);
  const toggle = (ticker: string) => setPicked(current => current.includes(ticker) ? current.filter(t => t !== ticker)
    // A third choice replaces the earlier of the two.
    : current.length >= 2 ? [current[1], ticker] : [...current, ticker]);
  // Shown in the order of the four, so a pair always looks the same.
  const ordered = useMemo(() => COMPARE_TICKERS.filter(t => picked.includes(t)), [picked]);
  const result = compareSample(ordered);
  const now = compareNow;
  const assessment = result ? overallComparison(result.companies, lang, now) : null;
  return <div className={styles.compare}>
    <p className={styles.pickLabel}>{ja ? "2つ選んでください" : "Choose two"}</p>
    <div className={styles.pills} role="group" aria-label={ja ? "比較する銘柄" : "Stocks to compare"}>
      {COMPARE_TICKERS.map(ticker => <button key={ticker} type="button" className={styles.pill} aria-pressed={picked.includes(ticker)} onClick={() => toggle(ticker)}>{ticker}</button>)}
    </div>
    {!result || !assessment ? <p className={styles.waiting}>{ja ? "もう1つ選ぶと、結果が開きます。" : "Choose one more to see the result."}</p>
      : <div className={`${compareStyles.results} ${compareStyles.resultView} ${styles.compareResult}`}>
        <VerdictHeading title={assessment.title} leader={assessment.leader} companies={result.companies} lang={lang} now={now} />
        <ScoreHeadline companies={result.companies} lang={lang} now={now} />
        <StatusOverlay companies={result.companies} lang={lang} now={now} />
        <section className={compareStyles.explain}><p>{assessment.description}</p>{assessment.note && <details><summary>{ja ? "比較条件・注意点" : "Comparison caveats"}</summary><ul><li>{assessment.note}</li></ul></details>}</section>
        <ScoreOverview companies={result.companies} lang={lang} now={now} missingNote={false} />
        <h2 className={compareStyles.companiesHeading}>{ja ? "会社ごとの長所と短所" : "Strengths and weaknesses by company"}</h2>
        <div className={compareStyles.companyCards}>{result.companies.map((c, i) => <CompanyScoreCard colorIndex={i} key={c.ticker} company={c} lang={lang} now={now} />)}</div>
        <DetailPanels lang={lang}>
          {result.companies.filter(c => c.preparedAnalysis?.items.length).map(c => <section key={c.ticker}>
            <h3>{c.name}（{c.ticker}）</h3>
            <small>{ja ? "決算期末" : "Period ended"} {c.preparedAnalysis!.periodEnd}</small>
            <ul>{c.preparedAnalysis!.items.map(item => <li key={item.id}><strong data-kind={item.kind}>{item.short[lang]}</strong><p>{item.detail[lang]}</p></li>)}</ul>
          </section>)}
        </DetailPanels>
      </div>}
  </div>;
}
