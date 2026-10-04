"use client";
import { useState } from "react";
import Link from "next/link";
import type { ComparisonResult } from "@/lib/research/comparison";
import { quarterlyTakeaway } from "@/lib/research/comparison-scorecard";
import { twelveFactorMethods } from "@/lib/research/twelve-data-factors";
import ResearchToolShell from "../../research-tool-shell";
import { useResearchLanguage } from "../../use-research-language";
import { CompanyScoreCard, ScoreOverview } from "../comparison-visuals";
import styles from "../styles.module.css";

export default function SampleScreen({sample}:{sample:ComparisonResult}) {
  const [lang,setLang]=useResearchLanguage(),[count,setCount]=useState(2),ja=lang==="ja";
  const companies=sample.companies.slice(0,count),now=Date.parse(sample.generatedAt);
  return <ResearchToolShell lang={lang} setLang={setLang} title={ja?"銘柄比較PRO · サンプル":"Compare stocks PRO · Sample"}
    description={ja?"架空の企業・数値を使った操作サンプルです。実際の株価・業績ではありません。":"Interactive sample with fictional companies and figures. These are not real stock prices or financial results."} showTools={false}>
    <div className={styles.results}>
      <Link href="/research/compare" className={styles.backToCompare}>{ja?"▶ 銘柄比較PROに戻る":"▶ Back to Compare stocks PRO"}</Link>
      <div className={styles.scoreViewSwitch} role="group" aria-label={ja?"比較する社数":"Number of companies"}>
        {[2,3].map(n=><button key={n} type="button" aria-pressed={count===n} onClick={()=>setCount(n)}>{ja?`${n}社で比較`:`Compare ${n}`}</button>)}
      </div>
      <section className={styles.conclusion}>
        <p className={styles.eyebrow}>{ja?"結果 · 架空データ":"RESULTS · FICTIONAL DATA"}</p>
        <h2>{quarterlyTakeaway(companies,lang,now)}</h2>
        <p>{ja?"成長・利益・割安性の違いを、下のグラフで比較できます。":"Compare growth, profitability and valuation in the charts below."}</p>
      </section>
      <div className={styles.companyCards}>{companies.map(c=><CompanyScoreCard key={c.ticker} company={c} lang={lang} now={now}/>)}</div>
      <ScoreOverview companies={companies} lang={lang} now={now}/>
      <details className={styles.analysisDetails}>
        <summary>{ja?"長所・短所の詳しい根拠":"Evidence behind strengths and weaknesses"}</summary>
        {companies.map(c=><section key={c.ticker}><h3>{c.name}（{c.ticker}）</h3><ul>{c.preparedAnalysis?.items.map(item=><li key={item.id}><strong data-kind={item.kind}>{item.short[lang]}</strong><p>{item.detail[lang]}</p></li>)}</ul></section>)}
      </details>
      <details className={styles.scoreMethod}><summary>{ja?"スコアの見方・サンプルについて":"Scoring and sample information"}</summary>
        <p>{ja?"すべて架空の入力値です。本番と同じ計算処理・表示部品を使用し、日時はサンプル作成時点に固定しています。Twelve Dataから取得した実データではありません。":"All input values are fabricated. This sample uses the production calculation and display components, with its evaluation date fixed. These are not live Twelve Data responses."}</p>
        <p>{ja?"成長性：売上前年比0%＝5点、50%＝10点。収益性：営業利益率0%＝0点、50%＝10点。資金創出：簡易FCF率0%＝5点、25%＝10点。各項目0〜10点の参考目盛りです。":"Growth: revenue YoY 0% = 5, 50% = 10. Profitability: operating margin 0% = 0, 50% = 10. Cash: simple FCF margin 0% = 5, 25% = 10. Each uses a 0–10 reference scale."}</p>
        {Object.entries(twelveFactorMethods).map(([id,method])=><p key={id}>{method[lang]}</p>)}
      </details>
    </div>
  </ResearchToolShell>;
}
