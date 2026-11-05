"use client";
import type { ComparisonResult } from "@/lib/research/comparison";
import { comparisonScores, comparisonMetric, comparisonLeaders, comparisonAvailability, hasRecentQuarter, radarPoint, compositeScore } from "@/lib/research/comparison-scorecard";
import styles from "./styles.module.css";
// The color of each company (owner, Nov 5): the first a yellowish gold, the second blue, the third a light purple.
const companyColors = ["#f2c36b", "#8da2ff", "#c9a0ff"];
const colorOf = (index: number, offset = 0) => companyColors[(index + offset) % companyColors.length];
function StatusChart({companies,lang,now,colorIndex=0}: {companies:ComparisonResult["companies"];lang:"ja"|"en";now:number;colorIndex?:number}) {
  const sets=companies.map(c=>comparisonScores(c,now)), factors=sets[0];
  const labels=lang==="ja" ? ["財務", "収益", "割安", "安定", "株価", "成長", "資金"] : ["Finance", "Profit", "Value", "Stability", "Momentum", "Growth", "Cash"];
  const available=sets.some(scores=>scores.some(s=>s.value!==null));
  return <div className={styles.statusChart}>
    <svg viewBox="0 0 300 300" role="img" aria-label={lang==="ja" ? "企業ステータス比較。未取得の項目は描画しません。" : "Company status comparison. Unavailable or unscored factors are not plotted."}>
      {[2,4,6,8,10].map(level=><polygon key={level} points={factors.map((_,i)=>radarPoint(level,i,factors.length)).join(" ")} fill="none" stroke="#33415f" strokeOpacity=".7"/>)}
      {factors.map((f,i)=>{const [x,y]=radarPoint(10,i,factors.length)!.split(","),angle=-Math.PI/2+i*2*Math.PI/factors.length;return <g key={f.id}><line x1="150" y1="150" x2={x} y2={y} stroke="#33415f" strokeOpacity=".6"/><text x={150+Math.cos(angle)*119} y={154+Math.sin(angle)*111} textAnchor="middle" fill="#aab6d3" fontSize="11">{labels[i]}</text></g>;})}
      {sets.map((scores,cIndex)=>{const color=colorOf(cIndex,colorIndex),points=scores.map((s,i)=>radarPoint(s.value,i,scores.length));return <g key={companies[cIndex].ticker} fill={color} stroke={color}>{points.every(p=>p!==null) && <polygon points={points.join(" ")} fillOpacity=".14" strokeWidth="1.8"/>}{points.map((point,i)=>point!==null && points[(i+1)%points.length]!==null ? <line key={`edge-${i}`} x1={point.split(",")[0]} y1={point.split(",")[1]} x2={points[(i+1)%points.length]!.split(",")[0]} y2={points[(i+1)%points.length]!.split(",")[1]} strokeWidth="1.8"/> : null)}{points.map((point,i)=>point===null ? null : <circle key={scores[i].id} cx={point.split(",")[0]} cy={point.split(",")[1]} r="4" fillOpacity=".85" strokeWidth="1"><title>{`${companies[cIndex].ticker} ${scores[i].label[lang]}: ${scores[i].value}/10`}</title></circle>)}</g>;})}
      {!available && <text x="150" y="154" textAnchor="middle" fill="#b2c2c7" fontSize="12">{lang==="ja" ? "データ未取得" : "Data unavailable"}</text>}
    </svg>
  </div>;
}
/** The overall score of each company, large; the higher one's frame is gold. Below them one sentence counts the factors each won (ties are not counted). */
function ScoreHeadline({companies,lang,now}: {companies:ComparisonResult["companies"];lang:"ja"|"en";now:number}) {
  const ja=lang==="ja", sets=companies.map(c=>comparisonScores(c,now)), totals=sets.map(scores=>compositeScore(scores));
  const known=totals.filter((total): total is number => total!==null), best=known.length ? Math.max(...known) : null;
  const leads=totals.map(total=>best!==null && total===best && known.some(other=>other<best));
  // Factors that every company has a score for; of those, the ones where one company is strictly the highest.
  const factors=sets[0].map((_,index)=>sets.map(scores=>scores[index].value)).filter(values=>values.every(value=>value!==null)) as number[][];
  const wins=companies.map((_,i)=>factors.filter(values=>values[i]>Math.max(...values.filter((_,j)=>j!==i))).length);
  const mostWins=Math.max(...wins);
  const byTotal=leads.indexOf(true), byWins=wins.filter(w=>w===mostWins).length===1 ? wins.indexOf(mostWins) : -1;
  const leader=byTotal>=0 ? byTotal : byWins;
  const sentence=leader>=0 && factors.length>0 && wins[leader]>0
    ? (ja ? `が${factors.length}項目中${wins[leader]}項目で${companies.length>2 ? "最も高い点でした" : "上回りました"}` : ` scored ${companies.length>2 ? "the highest" : "higher"} in ${wins[leader]} of ${factors.length} factors`) : null;
  return <section className={styles.headlineScores} aria-label={ja ? "総合評価の点数" : "Overall scores"}>
    <div className={styles.scoreBoxes} style={{gridTemplateColumns:`repeat(${companies.length},minmax(0,1fr))`}}>{companies.map((c,i)=><article key={c.ticker} className={styles.scoreBox} data-leader={leads[i]}>
      <p className={styles.boxTicker}><i style={{background:colorOf(i)}} aria-hidden="true"/>{c.ticker}</p>
      <p className={styles.boxName}>{c.name}</p>
      <p className={styles.boxScore}><b>{totals[i]===null ? "—" : totals[i]!.toFixed(1)}</b><small>/ 10</small></p>
    </article>)}</div>
    {sentence && <p className={styles.winLine}><b style={{color:colorOf(leader)}}>{companies[leader].ticker}</b>{sentence}</p>}
  </section>;
}
/** One figure with every company drawn over each other, in each company's color. Unscored factors are not drawn. */
function StatusOverlay({companies,lang,now}: {companies:ComparisonResult["companies"];lang:"ja"|"en";now:number}) {
  const ja=lang==="ja";
  return <section className={styles.overlayCard} aria-label={ja ? "ステータスを重ねて見る" : "Status overlay"}>
    <div className={styles.overlayHead}><h2>{ja ? "ステータスを重ねて見る" : "Status overlay"}</h2><small>{ja ? "参考スコア / 10" : "Reference score / 10"}</small></div>
    <StatusChart companies={companies} lang={lang} now={now}/>
    <div className={styles.overlayLegend}>{companies.map((c,i)=><span key={c.ticker}><i style={{background:colorOf(i)}} aria-hidden="true"/>{c.ticker}</span>)}</div>
    <p className={styles.snapshotNote}>{ja ? "未取得・評価保留は描画しません" : "Unavailable or unscored factors are not plotted"}</p>
  </section>;
}
function ScoreOverview({companies,lang,now}: {companies:ComparisonResult["companies"];lang:"ja"|"en";now:number}) {
  const scoreSets=companies.map(c=>comparisonScores(c,now)), factors=scoreSets[0], ja=lang==="ja";
  const columns={gridTemplateColumns:`repeat(${companies.length},minmax(0,1fr))`} as React.CSSProperties;
  return <section className={styles.scoreOverview} data-count={companies.length}><div className={styles.scoreHeading}><h2>{ja ? "比較スナップショット" : "Comparison snapshot"}</h2><small>{ja ? "参考スコア / 10" : "Reference score / 10"}</small></div>
    <div className={styles.snapLegend} style={columns}>{companies.map((c,i)=><span key={c.ticker}><i style={{background:colorOf(i)}} aria-hidden="true"/>{c.ticker}</span>)}</div>
    {factors.map((f,index)=><div className={styles.snapRow} key={f.id}>
      <p className={styles.snapLabel}>{f.label[lang]}</p>
      <div className={styles.snapCols} style={columns}>{companies.map((c,i)=>{const score=scoreSets[i][index];const winner=comparisonLeaders(companies,f.id,now)[i];
        // Both bars are drawn on tracks of the same width; only the higher score is coloured strongly.
        return <div key={c.ticker} className={styles.snapCell} data-winner={winner}>
          <div className={styles.snapValue}><span className={styles.scoreTrack} aria-hidden="true">{score.value!==null && <i data-company={i} style={{width:`${score.value*10}%`,background:winner ? colorOf(i) : undefined}}/>}</span><strong style={winner ? {color:colorOf(i)} : undefined}>{score.value===null ? "—" : score.value.toFixed(1)}</strong></div>
          <small className={styles.factorMetric}>{comparisonMetric(c,score.id,lang,now)}</small></div>;})}</div>
    </div>)}
    <p className={styles.snapshotNote}>{ja ? "— 未取得・評価保留（0点ではありません）" : "— Unavailable or unscored, not zero"}</p>
  </section>;
}
function CompanyScoreCard({company:c,lang,now,colorIndex=0}: {company:ComparisonResult["companies"][number];lang:"ja"|"en";now:number;colorIndex?:number}) {
  const items=hasRecentQuarter(c,now) ? c.preparedAnalysis?.items ?? [] : [], ja=lang==="ja";
  const availability=comparisonAvailability(c,lang,now);
  const highlights={strengths:items.filter(i=>i.kind==="strength").slice(0,4).map(i=>i.short[lang]),weaknesses:items.filter(i=>i.kind==="weakness").slice(0,4).map(i=>i.short[lang])};
  return <article className={styles.scoreCard}>
    <header className={styles.companyHeading}><h3 title={`${c.name}（${c.ticker}）`}><i style={{background:colorOf(colorIndex)}} aria-hidden="true"/><span>{c.name}</span><small>{c.ticker}</small></h3></header>
    {c.quarterRevenue && <p className={styles.periodLine}>{c.referenceEvaluation ? `${ja ? "決算発表" : "Released"} ${c.referenceEvaluation.announced}${ja ? "（米国）" : " (US)"} · ` : ""}{ja ? "対象期間" : "Reporting period"} {c.quarterRevenue.start ? `${c.quarterRevenue.start} – ` : ""}{c.quarterRevenue.end}</p>}
    {availability && <p className={styles.periodLine}>{availability}</p>}
    <div className={styles.companyProfile}>
      <div className={styles.traitBoxes}>
        <section className={styles.traitBox} aria-label={ja ? "長所" : "Strengths"}>
          <h4>{ja ? "長所" : "Strengths"}</h4>
          {highlights.strengths.length ? <ul>{highlights.strengths.map(item=><li key={item}>{item}</li>)}</ul> : <p>{availability ? "—" : ja ? "取得済みの数値では該当なし" : "None identified in available figures"}</p>}
        </section>
        <section className={`${styles.traitBox} ${styles.weaknessBox}`} aria-label={ja ? "短所" : "Weaknesses"}>
          <h4>{ja ? "短所" : "Weaknesses"}</h4>
          {highlights.weaknesses.length ? <ul>{highlights.weaknesses.map(item=><li key={item}>{item}</li>)}</ul> : <p>{availability ? "—" : ja ? "取得済みの数値では該当なし" : "None identified in available figures"}</p>}
        </section>
      </div>
      <section className={styles.companyStatus} aria-label={ja ? `${c.name}のステータス` : `${c.name} status`}>
        <StatusChart companies={[c]} lang={lang} now={now} colorIndex={colorIndex}/>
      </section>
    </div>
  </article>;
}

export { CompanyScoreCard, ScoreOverview, ScoreHeadline, StatusOverlay };
