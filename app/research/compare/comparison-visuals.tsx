"use client";
import type { ComparisonResult } from "@/lib/research/comparison";
import { comparisonScores, comparisonMetric, comparisonLeaders, comparisonAvailability, hasRecentQuarter, radarPoint, compositeScore } from "@/lib/research/comparison-scorecard";
import styles from "./styles.module.css";
// The color of each company (owner, Nov 5): the first a yellowish gold, the second blue, the third a light purple.
const companyColors = ["#ffc247", "#4cc9f0", "#ff7ac6"];
const colorOf = (index: number, offset = 0) => companyColors[(index + offset) % companyColors.length];
function StatusChart({companies,lang,now,colorIndex=0}: {companies:ComparisonResult["companies"];lang:"ja"|"en";now:number;colorIndex?:number}) {
  const sets=companies.map(c=>comparisonScores(c,now)), factors=sets[0];
  const labels=lang==="ja" ? ["財務", "収益", "割安", "安定", "株価", "成長", "資金"] : ["Financials", "Profit", "Value", "Stability", "Momentum", "Growth", "Cash"];
  const available=sets.some(scores=>scores.some(s=>s.value!==null));
  return <div className={styles.statusChart}>
    <svg viewBox="8 30 284 240" role="img" aria-label={lang==="ja" ? "企業ステータス比較。未取得の項目は描画しません。" : "Company scores by factor. Factors without data or a score aren't shown."}>
      {/* Order of drawing: the light fills first, then the scale lines over them, then each company's outline and dots on top. */}
      {/* The shape is always one closed outline through every scored factor (owner, Nov 14: a broken line is not a chart). A factor without
          data is skipped, never drawn as zero; its label shows "—". */}
      {sets.map((scores,cIndex)=>{const points=scores.map((s,i)=>radarPoint(s.value,i,scores.length)).filter((p):p is string=>p!==null);return points.length>=3 ? <polygon key={`fill-${companies[cIndex].ticker}`} points={points.join(" ")} fill={colorOf(cIndex,colorIndex)} fillOpacity=".16" stroke="none"/> : null;})}
      {[2,4,6,8,10].map(level=><polygon key={level} points={factors.map((_,i)=>radarPoint(level,i,factors.length)).join(" ")} fill="none" stroke="#52628a" strokeWidth="1"/>)}
      {factors.map((f,i)=>{const [x,y]=radarPoint(10,i,factors.length)!.split(","),angle=-Math.PI/2+i*2*Math.PI/factors.length;return <line key={`axis-${f.id}`} x1="150" y1="150" x2={x} y2={y} stroke="#3f4d70" strokeWidth="1"/>;})}
      {factors.map((f,i)=>{const angle=-Math.PI/2+i*2*Math.PI/factors.length;return <text key={`label-${f.id}`} x={150+Math.cos(angle)*119} y={154+Math.sin(angle)*111} textAnchor="middle" fill="#a3abc4" fontSize={companies.length===1 ? 15 : 11}>{labels[i]}{sets.some(scores=>scores[i].value===null) ? " —" : ""}</text>;})}
      {sets.map((scores,cIndex)=>{const color=colorOf(cIndex,colorIndex),points=scores.map((s,i)=>radarPoint(s.value,i,scores.length)),scored=points.filter((p):p is string=>p!==null);return <g key={companies[cIndex].ticker} fill={color} stroke={color}>{scored.length>=3 ? <polygon points={scored.join(" ")} fill="none" strokeWidth="1.8" strokeLinejoin="round"/> : scored.length===2 ? <polyline points={scored.join(" ")} fill="none" strokeWidth="1.8"/> : null}{points.map((point,i)=>point===null ? null : <circle key={scores[i].id} cx={point.split(",")[0]} cy={point.split(",")[1]} r="4" fillOpacity=".85" strokeWidth="1"><title>{`${companies[cIndex].ticker} ${scores[i].label[lang]}: ${scores[i].value}/10`}</title></circle>)}</g>;})}
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
/** "総合評価は○○が優位": only the company's code takes its colour and a bold monospace face. */
function LeadTitle({title,companies}: {title:string;companies:ComparisonResult["companies"]}) {
  const index=companies.findIndex(c=>title.includes(c.ticker));
  if(index<0) return <>{title}</>;
  const [before,...rest]=title.split(companies[index].ticker);
  return <>{before}<b className={styles.leadTicker} style={{color:colorOf(index)}}>{companies[index].ticker}</b>{rest.join(companies[index].ticker)}</>;
}
/** One figure with every company drawn over each other, in each company's color. Unscored factors are not drawn. */
function StatusOverlay({companies,lang,now}: {companies:ComparisonResult["companies"];lang:"ja"|"en";now:number}) {
  const ja=lang==="ja";
  return <section className={styles.overlayCard} aria-label={ja ? "ステータスを重ねて見る" : "Score comparison"}>
    <div className={styles.overlayHead}><h2>{ja ? "ステータスを重ねて見る" : "Score comparison"}</h2><small>{ja ? "参考スコア / 10" : "Reference score (out of 10)"}</small></div>
    <StatusChart companies={companies} lang={lang} now={now}/>
    <div className={styles.overlayLegend}>{companies.map((c,i)=><span key={c.ticker}><i style={{background:colorOf(i)}} aria-hidden="true"/>{c.ticker}</span>)}</div>
    <p className={styles.snapshotNote}>{ja ? "未取得・評価保留は描画しません" : "Unavailable or unscored factors are not plotted"}</p>
  </section>;
}
function ScoreOverview({companies,lang,now}: {companies:ComparisonResult["companies"];lang:"ja"|"en";now:number}) {
  const scoreSets=companies.map(c=>comparisonScores(c,now)), factors=scoreSets[0], ja=lang==="ja";
  const columns={gridTemplateColumns:`repeat(${companies.length},minmax(0,1fr))`} as React.CSSProperties;
  return <section className={styles.scoreOverview} data-count={companies.length}><div className={styles.scoreHeading}><h2>{ja ? "比較スナップショット" : "Comparison snapshot"}</h2><small>{ja ? "参考スコア / 10" : "Reference score (out of 10)"}</small></div>
    <div className={styles.snapLegend} style={columns}>{companies.map((c,i)=><span key={c.ticker}><i style={{background:colorOf(i)}} aria-hidden="true"/>{c.ticker}</span>)}</div>
    {factors.map((f,index)=><div className={styles.snapRow} key={f.id}>
      <p className={styles.snapLabel}>{f.label[lang]}</p>
      <div className={styles.snapCols} style={columns}>{companies.map((c,i)=>{const score=scoreSets[i][index];const winner=comparisonLeaders(companies,f.id,now)[i];
        // Both bars are drawn on tracks of the same width; only the higher score is coloured strongly.
        return <div key={c.ticker} className={styles.snapCell} data-winner={winner}>
          <div className={styles.snapValue}><span className={styles.scoreTrack} aria-hidden="true">{score.value!==null && <i data-company={i} style={{width:`${score.value*10}%`,background:colorOf(i),opacity:winner ? 1 : .6}}/>}</span><strong style={winner ? {color:colorOf(i)} : undefined}>{score.value===null ? "—" : score.value.toFixed(1)}</strong></div>
          <small className={styles.factorMetric}>{comparisonMetric(c,score.id,lang,now)}</small></div>;})}</div>
    </div>)}
    <p className={styles.snapshotNote}>{ja ? "— 未取得・評価保留（0点ではありません）" : "— means data or a score isn't available. It doesn't mean zero."}</p>
  </section>;
}
/** One item stays on one line: 12px, or 11px when the sentence is too long for the 184px column (never cut with "…"). */
const fitSize=(text:string)=>[...text].reduce((w,ch)=>w+(ch.charCodeAt(0)>0x2e80 ? 1 : 0.58),0)*12>146 ? "small" : "normal";
function CompanyScoreCard({company:c,lang,now,colorIndex=0}: {company:ComparisonResult["companies"][number];lang:"ja"|"en";now:number;colorIndex?:number}) {
  const items=hasRecentQuarter(c,now) ? c.preparedAnalysis?.items ?? [] : [], ja=lang==="ja";
  const availability=comparisonAvailability(c,lang,now);
  const highlights={strengths:items.filter(i=>i.kind==="strength").slice(0,4).map(i=>i.short[lang]),weaknesses:items.filter(i=>i.kind==="weakness").slice(0,4).map(i=>i.short[lang])};
  return <article className={styles.scoreCard}>
    <header className={styles.companyHeading}><h3><i style={{background:colorOf(colorIndex)}} aria-hidden="true"/><span>{c.name}</span><small>{c.ticker}</small></h3></header>
    {c.quarterRevenue && <p className={styles.periodLine}>{c.referenceEvaluation ? `${ja ? "決算発表" : "Released"} ${c.referenceEvaluation.announced}${ja ? "（米国）" : " (US)"} · ` : ""}{ja ? "対象期間" : "Reporting period"} {c.quarterRevenue.start ? `${c.quarterRevenue.start} – ` : ""}{c.quarterRevenue.end}</p>}
    {availability && <p className={styles.periodLine}>{availability}</p>}
    <div className={styles.companyProfile}>
      <div className={styles.traitBoxes}>
        <section className={styles.traitBox} aria-label={ja ? "長所" : "Strengths"}>
          <h4>{ja ? "長所" : "Strengths"}</h4>
          {highlights.strengths.length ? <ul>{highlights.strengths.map(item=><li key={item} data-fit={fitSize(item)}>{item}</li>)}</ul> : <p>{availability ? "—" : ja ? "取得済みの数値では該当なし" : "None identified from the available data"}</p>}
        </section>
        <section className={`${styles.traitBox} ${styles.weaknessBox}`} aria-label={ja ? "短所" : "Weaknesses"}>
          <h4>{ja ? "短所" : "Weaknesses"}</h4>
          {highlights.weaknesses.length ? <ul>{highlights.weaknesses.map(item=><li key={item} data-fit={fitSize(item)}>{item}</li>)}</ul> : <p>{availability ? "—" : ja ? "取得済みの数値では該当なし" : "None identified from the available data"}</p>}
        </section>
      </div>
      <section className={styles.companyStatus} aria-label={ja ? `${c.name}のステータス` : `${c.name} status`}>
        <StatusChart companies={[c]} lang={lang} now={now} colorIndex={colorIndex}/>
      </section>
    </div>
  </article>;
}

export { LeadTitle, CompanyScoreCard, ScoreOverview, ScoreHeadline, StatusOverlay };
