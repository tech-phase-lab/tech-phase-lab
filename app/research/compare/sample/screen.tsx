"use client";
import { useState } from "react";
import Link from "next/link";
import type { ComparisonResult } from "@/lib/research/comparison";
import { overallComparison } from "@/lib/research/comparison-scorecard";
import DetailPanels from "../detail-panels";
import ResearchToolShell from "../../research-tool-shell";
import { useResearchLanguage } from "../../use-research-language";
import { CompanyScoreCard, ScoreOverview } from "../comparison-visuals";
import styles from "../styles.module.css";

export default function SampleScreen({sample}:{sample:ComparisonResult}) {
  const [lang,setLang]=useResearchLanguage(),[count,setCount]=useState(2),ja=lang==="ja";
  const companies=sample.companies.slice(0,count),now=Date.parse(sample.generatedAt);
  const assessment=overallComparison(companies,lang,now);
  return <ResearchToolShell lang={lang} setLang={setLang} title={ja?"銘柄比較PRO":"Compare stocks PRO"} description="" showTools={false} showHeading={false}>
    <div className={styles.results}>
      <Link href="/research/compare" className={styles.backToCompare}>{ja?"▶ 銘柄比較PROに戻る":"▶ Back to Compare stocks PRO"}</Link>
      <div className={styles.scoreViewSwitch} role="group" aria-label={ja?"比較する社数":"Number of companies"}>
        {[2,3].map(n=><button key={n} type="button" aria-pressed={count===n} onClick={()=>setCount(n)}>{ja?`${n}社で比較`:`Compare ${n}`}</button>)}
      </div>
      <section className={styles.conclusion}>
        <p className={styles.eyebrow}>{ja?"結果":"RESULTS"}</p>
        <h2>{assessment.title}</h2>
        <p>{assessment.description}</p>
      </section>
      <div className={styles.companyCards}>{companies.map((c,i)=><CompanyScoreCard colorIndex={i} key={c.ticker} company={c} lang={lang} now={now}/>)}</div>
      <ScoreOverview companies={companies} lang={lang} now={now}/>
      <DetailPanels lang={lang}>
        {companies.map(c=><section key={c.ticker}><h3>{c.name}（{c.ticker}）</h3><ul>{c.preparedAnalysis?.items.map(item=><li key={item.id}><strong data-kind={item.kind}>{item.short[lang]}</strong><p>{item.detail[lang]}</p></li>)}</ul></section>)}
      </DetailPanels>
      <small className={styles.sampleFootnote}>{ja?"表示確認用の架空データ":"Fictional data for preview"}</small>
    </div>
  </ResearchToolShell>;
}
