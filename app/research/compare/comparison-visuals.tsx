"use client";
import type { ComparisonResult } from "@/lib/research/comparison";
import { comparisonScores, comparisonMetric, comparisonLeaders, comparisonAvailability, hasRecentQuarter, radarPoint } from "@/lib/research/comparison-scorecard";
import styles from "./styles.module.css";
const companyColors = ["#f0949b", "#9ed8c3", "#a5badf"];
function StatusChart({companies,lang,now,colorIndex=0}: {companies:ComparisonResult["companies"];lang:"ja"|"en";now:number;colorIndex?:number}) {
  const sets=companies.map(c=>comparisonScores(c,now)), factors=sets[0];
  const labels=lang==="ja" ? ["財務", "収益", "割安", "安定", "株価", "成長", "資金"] : ["Finance", "Profit", "Value", "Stability", "Momentum", "Growth", "Cash"];
  const available=sets.some(scores=>scores.some(s=>s.value!==null));
  return <div className={styles.statusChart}>
    <div className={styles.statusLegend}>{companies.map((c,i)=><span key={c.ticker} style={{color:companyColors[(i+colorIndex)%companyColors.length]}}>{c.ticker}</span>)}</div>
    <svg viewBox="0 0 300 300" role="img" aria-label={lang==="ja" ? "企業ステータス比較。未取得の項目は描画しません。" : "Company status comparison. Unavailable or unscored factors are not plotted."}>
      {[2,4,6,8,10].map(level=><polygon key={level} points={factors.map((_,i)=>radarPoint(level,i,factors.length)).join(" ")} fill="none" stroke="#435b60" strokeOpacity=".55"/>)}
      {factors.map((f,i)=>{const [x,y]=radarPoint(10,i,factors.length)!.split(","),angle=-Math.PI/2+i*2*Math.PI/factors.length;return <g key={f.id}><line x1="150" y1="150" x2={x} y2={y} stroke="#435b60" strokeOpacity=".5"/><text x={150+Math.cos(angle)*119} y={154+Math.sin(angle)*111} textAnchor="middle" fill="#b3c6c4" fontSize="11">{labels[i]}</text></g>;})}
      {sets.map((scores,cIndex)=>{const points=scores.map((s,i)=>radarPoint(s.value,i,scores.length));return <g key={companies[cIndex].ticker} fill="#90cbb6" stroke="#90cbb6">{points.every(p=>p!==null) && <polygon points={points.join(" ")} fillOpacity=".12" strokeWidth="1.6"/>}{points.map((point,i)=>point!==null && points[(i+1)%points.length]!==null ? <line key={`edge-${i}`} x1={point.split(",")[0]} y1={point.split(",")[1]} x2={points[(i+1)%points.length]!.split(",")[0]} y2={points[(i+1)%points.length]!.split(",")[1]} strokeWidth="1.6"/> : null)}{points.map((point,i)=>point===null ? null : <circle key={scores[i].id} cx={point.split(",")[0]} cy={point.split(",")[1]} r={4+cIndex} fillOpacity=".7" strokeWidth="1"><title>{`${companies[cIndex].ticker} ${scores[i].label[lang]}: ${scores[i].value}/10`}</title></circle>)}</g>;})}
      {!available && <text x="150" y="154" textAnchor="middle" fill="#b2c2c7" fontSize="12">{lang==="ja" ? "データ未取得" : "Data unavailable"}</text>}
    </svg>
    <p className={styles.snapshotNote}>{lang==="ja" ? "未取得・評価保留は描画しません" : "Unavailable or unscored factors are not plotted"}</p>
  </div>;
}
function ScoreOverview({companies,lang,now}: {companies:ComparisonResult["companies"];lang:"ja"|"en";now:number}) {
  const scoreSets=companies.map(c=>comparisonScores(c,now)), factors=scoreSets[0], ja=lang==="ja";
  return <section className={styles.scoreOverview}><div className={styles.scoreHeading}><h2>{ja ? "比較スナップショット" : "Comparison snapshot"}</h2><small>{ja ? "参考スコア / 10" : "Reference score / 10"}</small></div>
    <table className={styles.snapshotTable} style={{"--companies":companies.length} as React.CSSProperties}><caption className={styles.srOnly}>{ja ? "各項目の企業別スコア" : "Company scores by factor"}</caption>
      <thead><tr><th scope="col">{ja ? "項目" : "Factor"}</th>{companies.map((c,i)=><th key={c.ticker} scope="col" data-company={i}><span className={styles.snapshotTicker}>{c.ticker}</span></th>)}</tr></thead>
      <tbody>{factors.map((f,index)=><tr key={f.id}><th scope="row">{f.label[lang]}</th>{companies.map((c,i)=>{const score=scoreSets[i][index];const winner=comparisonLeaders(companies,f.id,now)[i];return <td key={c.ticker} data-winner={winner}><div className={styles.snapshotValue}><span className={styles.scoreTrack} aria-hidden="true">{score.value!==null && <i data-company={i} style={{width:`${score.value*10}%`}}/>}</span><strong>{score.value===null ? "—" : score.value.toFixed(1)}</strong></div><small className={styles.factorMetric}>{comparisonMetric(c,score.id,lang,now)}</small></td>;})}</tr>)}</tbody>
    </table><p className={styles.snapshotNote}>{ja ? "— 未取得・評価保留（0点ではありません）" : "— Unavailable or unscored, not zero"}</p>
  </section>;
}
function CompanyScoreCard({company:c,lang,now,colorIndex=0}: {company:ComparisonResult["companies"][number];lang:"ja"|"en";now:number;colorIndex?:number}) {
  const items=hasRecentQuarter(c,now) ? c.preparedAnalysis?.items ?? [] : [], ja=lang==="ja";
  const availability=comparisonAvailability(c,lang,now);
  const highlights={strengths:items.filter(i=>i.kind==="strength").slice(0,4).map(i=>i.short[lang]),weaknesses:items.filter(i=>i.kind==="weakness").slice(0,4).map(i=>i.short[lang])};
  return <article className={styles.scoreCard}>
    <header className={styles.companyHeading}><h3 style={{color:companyColors[colorIndex%companyColors.length]}} title={`${c.name}（${c.ticker}）`}>{c.name}（{c.ticker}）</h3><span>{c.referenceEvaluation ? `${ja ? "決算発表" : "Released"} ${c.referenceEvaluation.announced}${ja ? "（米国）" : " (US)"}` : c.quarterRevenue ? `${ja ? "決算期末" : "Period ended"} ${c.quarterRevenue.end}` : ja ? "四半期未取得" : "Quarter unavailable"}</span></header>
    {c.quarterRevenue && <p className={styles.periodLine}>{ja ? "対象期間" : "Reporting period"} {c.quarterRevenue.start ? `${c.quarterRevenue.start} – ` : ""}{c.quarterRevenue.end}</p>}
    {availability && <p className={styles.periodLine}>{availability}</p>}
    <div className={styles.companyProfile}>
      <div className={styles.traitBoxes}>
        <section className={styles.traitBox} aria-label={ja ? "長所" : "Strengths"}>
          <h4>{ja ? "長所" : "Strengths"}</h4>
          {highlights.strengths.length ? <ul>{highlights.strengths.map(item=><li key={item} title={item}>{item}</li>)}</ul> : <p>{availability ? "—" : ja ? "取得済みの数値では該当なし" : "None identified in available figures"}</p>}
        </section>
        <section className={`${styles.traitBox} ${styles.weaknessBox}`} aria-label={ja ? "短所" : "Weaknesses"}>
          <h4>{ja ? "短所" : "Weaknesses"}</h4>
          {highlights.weaknesses.length ? <ul>{highlights.weaknesses.map(item=><li key={item} title={item}>{item}</li>)}</ul> : <p>{availability ? "—" : ja ? "取得済みの数値では該当なし" : "None identified in available figures"}</p>}
        </section>
      </div>
      <section className={styles.companyStatus} aria-label={ja ? `${c.name}のステータス` : `${c.name} status`}>
        <h4>{ja ? "ステータス" : "Status"}<small>{ja ? "参考スコア / 10" : "Reference score / 10"}</small></h4>
        <StatusChart companies={[c]} lang={lang} now={now} colorIndex={colorIndex}/>
      </section>
    </div>
  </article>;
}

export { CompanyScoreCard, ScoreOverview };
