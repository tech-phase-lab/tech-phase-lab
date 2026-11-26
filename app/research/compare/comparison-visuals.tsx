"use client";
import type { ComparisonResult } from "@/lib/research/comparison";
import { comparisonScores, comparisonMetric, comparisonLeaders, comparisonAvailability, hasRecentBalance, hasRecentQuarter, radarPoint, commonTotals } from "@/lib/research/comparison-scorecard";
import { VALUE_LABELS, valueAsOfLine, valueCheckItem } from "@/lib/research/comparison-value";
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
/** The factors every company has a score for, and for each company how many of them it is strictly the highest on (ties are not counted). */
function factorWins(companies:ComparisonResult["companies"],now:number) {
  const sets=companies.map(c=>comparisonScores(c,now));
  const factors=sets[0].map((_,index)=>sets.map(scores=>scores[index].value)).filter(values=>values.every(value=>value!==null)) as number[][];
  return {count:factors.length,wins:companies.map((_,i)=>factors.filter(values=>values[i]>Math.max(...values.filter((_,j)=>j!==i))).length)};
}
/** The overall score of each company, large; the higher one's frame is gold. */
function ScoreHeadline({companies,lang,now}: {companies:ComparisonResult["companies"];lang:"ja"|"en";now:number}) {
  const ja=lang==="ja", totals=commonTotals(companies,now).totals;
  const known=totals.filter((total): total is number => total!==null), best=known.length ? Math.max(...known) : null;
  const leads=totals.map(total=>best!==null && total===best && known.some(other=>other<best));
  return <section className={styles.headlineScores} aria-label={ja ? "総合評価の点数" : "Overall scores"}>
    <div className={styles.scoreBoxes} style={{gridTemplateColumns:`repeat(${companies.length},minmax(0,1fr))`}}>{companies.map((c,i)=><article key={c.ticker} className={styles.scoreBox} data-leader={leads[i]}>
      <p className={styles.boxTicker}><i style={{background:colorOf(i)}} aria-hidden="true"/>{c.ticker}</p>
      <p className={styles.boxName}>{c.name}</p>
      <p className={styles.boxScore}><b>{totals[i]===null ? "—" : totals[i]!.toFixed(1)}</b><small>/ 10</small></p>
    </article>)}</div>
  </section>;
}
/** Rough width of a text in em: a Japanese character is one em, any other about 0.58. */
const textWidth=(text:string)=>[...text].reduce((w,ch)=>w+(ch.charCodeAt(0)>0x2e80 ? 1 : 0.58),0);
/** The verdict above the score cards (owner, Nov 15): the small gold 「総合評価」 label, the big 「LLY が優位」 with only the winner's code in its
 * colour and glow, a short gold bar, then the count of factors won (「6項目中4項目で上回りました」, the code not repeated). With no winner (a close
 * result) the count names the company that won the most factors; without enough data, or for a saved trial result, the title is shown alone. */
function VerdictHeading({title,leader,companies,lang,now}: {title:string;leader?:string;companies:ComparisonResult["companies"];lang:"ja"|"en";now:number}) {
  const ja=lang==="ja", index=leader ? companies.findIndex(c=>c.ticker===leader) : -1;
  const {count,wins}=factorWins(companies,now), most=Math.max(...wins);
  // The winner of the verdict; with no verdict, the one company that won the most factors, if there is one.
  const counted=index>=0 ? index : wins.filter(w=>w===most).length===1 ? wins.indexOf(most) : -1;
  const many=companies.length>2, won=counted>=0 ? wins[counted] : 0;
  const tail=ja ? `${count}項目中${won}項目で${many ? "最も高い点でした" : "上回りました"}` : `${many ? "Highest" : "Ahead"} on ${won} of ${count} factors`;
  const sub=counted>=0 && count>0 && won>0 ? (index>=0 ? tail : ja ? `${companies[counted].ticker}が${tail}` : `${companies[counted].ticker}: ${tail.replace(/^./,ch=>ch.toLowerCase())}`) : null;
  const color=index>=0 ? colorOf(index) : "";
  const parts=index>=0 ? title.split(leader!) : [title];
  return <section className={styles.conclusion} aria-label={ja ? "総合評価" : "Overall"} data-verdict={index>=0 ? "leader" : textWidth(title)*34>320 ? "long" : "short"}>
    <p className={styles.verdictLabel}>{ja ? "総合評価" : "Overall"}</p>
    <h2 className={styles.verdictTitle}>{index>=0 ? <>{parts[0]}<span className={styles.leadTicker} style={{color,textShadow:`0 0 16px ${color}8c`}}>{leader}</span>{parts.slice(1).join(leader!)}</> : title}</h2>
    <span className={styles.verdictBar} aria-hidden="true"/>
    {sub && <p className={styles.verdictSub}>{sub}</p>}
  </section>;
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
    {valueAsOfLine(companies,lang,now) && <p className={styles.snapshotNote}>{valueAsOfLine(companies,lang,now)}</p>}
  </section>;
}
/** Bullets saved before Nov 15 used long forms; they are shown in the short form that fits one line at 360px. */
export const compactTrait=(text:string)=>text.replace(/^営業赤字（利益率 (.+)）$/,"営業赤字 $1").replace(/^Operating loss \((.+) margin\)$/,"Operating loss $1")
  .replace(/^~3-month price return /,"3-month price ");
/** One item is one line (owner, Nov 15: 「ここは1行固定」): 12px, or 11px when long for the 184px column; anything longer ends in "…". */
const fitSize=(text:string)=>textWidth(text)*12>146 ? "small" : "normal";
function CompanyScoreCard({company:c,lang,now,colorIndex=0}: {company:ComparisonResult["companies"][number];lang:"ja"|"en";now:number;colorIndex?:number}) {
  // Without a current quarter (no revenue yet) the quarter's points are not shown; the valuation point, which does not depend on it, is.
  const valuation=valueCheckItem(c.valueCheck);
  // The valuation point is written from the figure at display time, so its wording (VALUE_LABELS) is the same wherever it was prepared.
  const prepared=(hasRecentQuarter(c,now) || hasRecentBalance(c,now)) && c.preparedAnalysis ? c.preparedAnalysis.items : null;
  const items=prepared ? prepared.flatMap(i=>i.id!=="valuation" ? [i] : valuation ? [valuation] : []) : valuation ? [valuation] : [], ja=lang==="ja";
  const availability=comparisonAvailability(c,lang,now);
  const highlights={strengths:items.filter(i=>i.kind==="strength").slice(0,4).map(i=>compactTrait(i.short[lang])),weaknesses:items.filter(i=>i.kind==="weakness").slice(0,4).map(i=>compactTrait(i.short[lang]))};
  return <article className={styles.scoreCard}>
    <header className={styles.companyHeading}><h3><i style={{background:colorOf(colorIndex)}} aria-hidden="true"/><span>{c.name}</span><small>{c.ticker}</small></h3></header>
    {c.quarterRevenue && <p className={styles.periodLine}>{c.referenceEvaluation ? `${ja ? "決算発表" : "Released"} ${c.referenceEvaluation.announced}${ja ? "（米国）" : " (US)"} · ` : ""}{ja ? "対象期間" : "Reporting period"} {c.quarterRevenue.start ? `${c.quarterRevenue.start} – ` : ""}{c.quarterRevenue.end}</p>}
    {availability && <p className={styles.periodLine}>{availability}</p>}
    {c.quarterRevenue && c.periodMonths && <p className={styles.periodLine}>{c.periodMonths === 6 ? (ja ? "半期（6か月）の決算です。この会社は四半期の数値を開示していません。" : "Half-year results: this company does not report quarterly figures.") : (ja ? "年度（12か月）の決算です。提出書類に年次決算後の四半期の数値がありません。" : "Full-year results: the filings carry no quarterly figures after the annual report.")}</p>}
    {c.capexNotReported && <p className={styles.periodLine}>{ja ? "設備投資の記載が決算書にないため、0として資金創出を計算しています。" : "The filings show no capital spending line, so free cash flow counts it as zero."}</p>}
    {!!c.supplemented?.length && <p className={styles.periodLine}>{ja ? `一部の項目（${c.supplemented.map(id=>({growth:"成長",profitability:"収益",cash:"資金",stability:"安定",financial:"財務",momentum:"株価",valuation:"割安",market:"株価"} as Record<string,string>)[id] ?? id).join("・")}）は${c.supplementedFromQuarter ? `、データ提供元に最新の四半期がまだ無いため、前の四半期（${c.supplementedFromQuarter.slice(0,4)}年${Number(c.supplementedFromQuarter.slice(5,7))}月期）の数値です。` : "同じ四半期のデータ提供元の数値です。"}` : `Some factors (${c.supplemented.join(", ")}) use the data provider's figures for ${c.supplementedFromQuarter ? `the previous quarter (to ${c.supplementedFromQuarter}), as the newest one is not in yet` : "the same quarter"}.`}</p>}
    <div className={styles.companyProfile}>
      <div className={styles.traitBoxes}>
        <section className={styles.traitBox} aria-label={ja ? "長所" : "Strengths"}>
          <h4>{ja ? "長所" : "Strengths"}</h4>
          {highlights.strengths.length ? <ul>{highlights.strengths.map(item=><li key={item} title={item} data-fit={fitSize(item)} data-lines={VALUE_LABELS.traitLines}>{item}</li>)}</ul> : <p>{availability ? "—" : ja ? "該当なし" : "None"}</p>}
        </section>
        <section className={`${styles.traitBox} ${styles.weaknessBox}`} aria-label={ja ? "短所" : "Weaknesses"}>
          <h4>{ja ? "短所" : "Weaknesses"}</h4>
          {highlights.weaknesses.length ? <ul>{highlights.weaknesses.map(item=><li key={item} title={item} data-fit={fitSize(item)} data-lines={VALUE_LABELS.traitLines}>{item}</li>)}</ul> : <p>{availability ? "—" : ja ? "該当なし" : "None"}</p>}
        </section>
      </div>
      <section className={styles.companyStatus} aria-label={ja ? `${c.name}のステータス` : `${c.name} status`}>
        <StatusChart companies={[c]} lang={lang} now={now} colorIndex={colorIndex}/>
      </section>
    </div>
  </article>;
}

export { VerdictHeading, CompanyScoreCard, ScoreOverview, ScoreHeadline, StatusOverlay };
