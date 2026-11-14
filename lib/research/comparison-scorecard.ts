import { twelveExtraFactors, twelveFactorMetric, twelveFactorMethods } from "./twelve-data-factors.ts";
import type { Financials } from "./comparison.ts";
export type ScoreId = "valuation" | "growth" | "profitability" | "financial" | "cash" | "stability" | "momentum";
export type ComparisonScore = { id: ScoreId; label: {ja:string;en:string}; value: number | null };
const clamp = (n:number) => Math.round(Math.max(0,Math.min(10,n))*10)/10;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
export function hasRecentQuarter(c: Financials, now = Date.now()): boolean {
  return c.status === "ready" && !!c.quarterRevenue && now-Date.parse(c.quarterRevenue.end)>=0
    && now-Date.parse(c.quarterRevenue.end)<=180*86400000
    && !c.dataWarnings?.some(w=>w.en.includes("quarterly filing") || w.en.includes("earnings release") || w.en.includes("could not be checked"));
}
/** Shared comparison conditions for both the conclusion and highlighted scores. */
export function comparableQuarters(companies: Financials[], now=Date.now()): boolean {
  if (companies.length < 2 || companies.some(c=>!hasRecentQuarter(c,now))) return false;
  const ends=companies.map(c=>Date.parse(c.quarterRevenue!.end));
  const bases=companies.map(c=>c.quarterRevenue!.basis);
  if(!bases.every(Boolean)) return false;
  const spread=Math.max(...ends)-Math.min(...ends);
  // Quarter ends up to 100 days apart, as before. The provider's standardized statements compare with an SEC filing (a foreign filer beside a
  // US one is ranked today); two different SEC accounting bases (US GAAP beside IFRS) still do not. Each company's source is shown beside its
  // numbers. On the 22 monitored companies' 231 pairs this rule loses no ranking that exists today (docs/SEC-FIRST-COMPARISON-VALIDATION-2026-11-13.md).
  const filingBases=new Set(bases.filter(b=>b!=="twelve-standardized"));
  return filingBases.size<=1 && spread<=100*86400000;
}
export function comparisonLeaders(companies: Financials[], id: ScoreId, now=Date.now()): boolean[] {
  const none=companies.map(()=>false);
  if(!comparableQuarters(companies,now) || new Set(companies.map(c=>!!c.referenceEvaluation)).size>1) return none;
  const values=companies.map(c=>comparisonScores(c,now).find(s=>s.id===id)?.value);
  if(!values.every(finite)) return none;
  const best=Math.max(...values);
  return values.map(value=>value===best && values.some(other=>other<best));
}
/** Data availability is a service state, never a company's strength or weakness. */
export function comparisonAvailability(c: Financials, lang: "ja"|"en", now=Date.now()): string | null {
  const ja=lang==="ja";
  if(c.busy) return ja ? "混み合っています。しばらくしてからもう一度お試しください。" : "The data service is busy right now. Please try again in a few minutes.";
  if(c.status==="unavailable") return ja ? "決算データを取得できませんでした。" : "Financial data could not be retrieved.";
  if(c.status==="unsupported" || !c.quarterRevenue) return ja ? "比較に使える四半期データが未取得です。" : "Comparable quarterly data is unavailable.";
  if(!hasRecentQuarter(c,now)) return ja ? "最新の四半期データを確認できていません。" : "The latest quarterly figures have not been verified.";
  if(!c.preparedAnalysis) return ja ? "長所・短所の要点は未作成です。" : "Strengths and weaknesses have not been prepared.";
  return null;
}
/** Reference scale, not an industry percentile or a buy recommendation.
 * Annual numbers never fill a missing quarterly score. Quote/forecast
 * valuation stays unavailable until a licensed, timestamped feed is connected.
 */
export function comparisonScores(c: Financials, now = Date.now()): ComparisonScore[] {
  const recent = hasRecentQuarter(c, now);
  // No revenue a year earlier (a new product line, ACHR): growth against the previous quarter, labelled as such.
  const growth = recent && finite(c.quarterRevenueGrowth) ? clamp(5+c.quarterRevenueGrowth/10) : recent && finite(c.quarterRevenueQoq) ? clamp(5+c.quarterRevenueQoq/10) : null;
  const profitability = recent && finite(c.quarterOperatingMargin) ? clamp(c.quarterOperatingMargin/5) : null;
  const balance=c.balance;
  // Financial strength needs a current balance plus debt disclosures. Missing
  // debt is unknown, never zero; an annual snapshot cannot fill this score.
  const debt = balanceDebt(c);
  const balanced = recent && balance && balance.end===c.quarterRevenue?.end && balance.cash && debt!==null;
  // Banks and brokers have no current assets or liabilities: cash against debt alone, on the full ten-point scale, labelled as such.
  const financial = balanced && finite(balance!.currentRatio) ? clamp(5*Math.min(balance!.currentRatio,2)/2 + 5*Math.min(balance!.cash!.value/Math.max(debt!,1),1))
    : balanced ? clamp(10*Math.min(balance!.cash!.value/Math.max(debt!,1),1)) : null;
  const cash = recent && finite(c.quarterFcfMargin) ? clamp(5+c.quarterFcfMargin/5) : null;
  const extra=c.twelveData ? twelveExtraFactors(c.twelveData,now,c.valuationBasis) : null;
  const scores: ComparisonScore[] = [
    {id:"financial",label:{ja:"財務健全性",en:"Financial strength"},value:recent ? extra?.financial ?? financial : null},
    {id:"profitability",label:{ja:"収益性",en:"Profitability"},value:profitability},
    {id:"valuation",label:{ja:"割安性",en:"Valuation"},value:recent ? extra?.valuation ?? null : null},
    {id:"stability",label:{ja:"安定性",en:"Stability"},value:recent ? extra?.stability ?? null : null},
    {id:"momentum",label:{ja:"株価モメンタム",en:"Price momentum"},value:extra?.momentum ?? null},
    {id:"growth",label:{ja:"成長性",en:"Growth"},value:growth},
    {id:"cash",label:{ja:"資金創出",en:"Cash generation"},value:cash},
  ];
  if(c.referenceEvaluation) return scores.map(s=>({...s,value:recent ? c.referenceEvaluation!.factors.find(f=>f.id===s.id)?.value ?? null : null}));
  return scores;
}

/** Interest-bearing debt from the filing's balance, in whatever complete form it was reported; null when unknown (never zero by default). */
export function balanceDebt(c: Financials): number | null {
  const b=c.balance;
  if(!b) return null;
  const own=b.debtTotal!==undefined ? (b.debtTotal ? b.debtTotal.value : null) : b.debtCurrent && b.debtNoncurrent ? b.debtCurrent.value+b.debtNoncurrent.value : null;
  if(own!==null) return own;
  // Debt tagged in a company's own way (ORCL): the provider's total debt for the very same quarter end, never another quarter's.
  const s=c.twelveData?.statistics;
  return s && s.quarterEnd===b.end && s.totalDebt!==null && s.totalDebt!==undefined && s.totalCash===null ? s.totalDebt : null;
}
/** Display actual measurements beside the reference bars, including unscored factors. */
export function comparisonMetric(c: Financials, id: ScoreId, lang: "ja"|"en", now=Date.now()): string {
  if(!hasRecentQuarter(c,now) && !(id==="momentum" && c.twelveData && twelveExtraFactors(c.twelveData,now,c.valuationBasis).momentum!==null)) return lang==="ja" ? "最新値未確認" : "Latest value unverified";
  const reference=c.referenceEvaluation?.factors.find(f=>f.id===id);
  if(reference) return reference.metric[lang];
  const ja=lang==="ja";
  const providerMetric=c.twelveData ? twelveFactorMetric(c.twelveData,id,lang,now,c.valuationBasis) : null;
  if(providerMetric)return providerMetric;
  if(id==="growth" && finite(c.quarterRevenueGrowth)) return `${ja?"売上前年比":"Revenue growth (YoY)"} ${c.quarterRevenueGrowth>0?"+":""}${c.quarterRevenueGrowth.toFixed(1)}%`;
  if(id==="growth" && finite(c.quarterRevenueQoq)) return `${ja?"売上前四半期比":"Revenue growth (QoQ)"} ${c.quarterRevenueQoq>0?"+":""}${c.quarterRevenueQoq.toFixed(1)}%`;
  if(id==="profitability" && finite(c.quarterOperatingMargin)) return `${c.quarterOperatingIncome?.tag==="TechPhasePretaxIncome" ? (ja?"税引前利益率":"Pre-tax margin") : (ja?"営業利益率":"Operating margin")} ${c.quarterOperatingMargin.toFixed(1)}%`;
  if(id==="cash" && finite(c.quarterFcfMargin)) return `${ja?"簡易FCF率":"Simple FCF margin"} ${c.quarterFcfMargin.toFixed(1)}%`;
  if(id==="financial" && c.balance?.end===c.quarterRevenue?.end && !finite(c.balance?.currentRatio) && c.balance?.cash && balanceDebt(c)!==null) {
    const debt=balanceDebt(c)!;
    return debt===0 ? (ja?"借入なし":"No borrowings") : `${ja?"現金÷有利子負債":"Cash ÷ debt"} ${(c.balance.cash.value/debt).toFixed(2)}${ja?"倍":"×"}`;
  }
  if(id==="financial" && c.balance?.end===c.quarterRevenue?.end && finite(c.balance?.currentRatio)) return `${ja?"流動比率":"Current ratio"} ${c.balance.currentRatio.toFixed(2)}${ja?"倍":"×"}${c.balance.debtTotal?.source==="none" ? (ja?"・借入なし":" · no borrowings") : ""}`;
  return ja ? "必要データ未取得" : "Data unavailable";
}

/** Valuation needs one yardstick for the whole comparison. Forward P/E as before when every company has one; when any company has none (a
 * loss-maker such as AAOI or POET, Nov 14) and every company has price-to-sales, all of them are scored on price-to-sales, so the factor and
 * the overall ranking are no longer empty. Otherwise nothing changes. The valuation bullet is rewritten to the same yardstick. */
export function applyValuationBasis<T extends Financials>(companies: T[], now=Date.now()): T[] {
  if(companies.length<2 || companies.some(c=>!!c.referenceEvaluation || !c.twelveData || !hasRecentQuarter(c,now))) return companies;
  if(companies.every(c=>twelveExtraFactors(c.twelveData!,now,"pe").valuation!==null)) return companies;
  if(!companies.every(c=>twelveExtraFactors(c.twelveData!,now,"ps").valuation!==null)) return companies;
  return companies.map(c=>{
    const value=twelveExtraFactors(c.twelveData!,now,"ps").valuation!;
    const prepared=c.preparedAnalysis ? {...c.preparedAnalysis,items:c.preparedAnalysis.items.filter(item=>item.id!=="valuation")} : c.preparedAnalysis;
    if(prepared && (value<=3 || value>=7)) {
      const ja=twelveFactorMetric(c.twelveData!,"valuation","ja",now,"ps")!,en=twelveFactorMetric(c.twelveData!,"valuation","en",now,"ps")!;
      prepared.items.push({id:"valuation",kind:value>=7?"strength":"weakness",short:{ja,en},detail:twelveFactorMethods.valuation});
    }
    return {...c,valuationBasis:"ps" as const,preparedAnalysis:prepared};
  });
}
/** Missing factors must never improve the composite by being omitted. */
export function compositeScore(scores: ComparisonScore[]): number | null {
  if (!scores.length || scores.some(s => s.value === null)) return null;
  return Math.round(scores.reduce((sum,s) => sum + s.value!,0)/scores.length*10)/10;
}
/** Null factors have no point, rather than a misleading zero at the center. */
export function radarPoint(value: number | null, index: number, count: number): string | null {
  if (value === null || !finite(value) || value < 0 || value > 10 || count < 3) return null;
  const angle=-Math.PI/2+index*2*Math.PI/count, radius=value*9;
  return `${(150+Math.cos(angle)*radius).toFixed(2)},${(150+Math.sin(angle)*radius).toFixed(2)}`;
}

export function quarterlyHighlights(c: Financials, lang: "ja"|"en", now=Date.now()) {
  const scores=comparisonScores(c,now);
  const valid=(id:ScoreId)=>scores.find(s=>s.id===id)?.value !== null;
  const strengths: string[]=[],weaknesses: string[]=[];
  if(valid("growth") && c.quarterRevenueGrowth!>0) strengths.push(lang==="ja" ? `売上成長 +${c.quarterRevenueGrowth!.toFixed(1)}%` : `Revenue growth +${c.quarterRevenueGrowth!.toFixed(1)}%`);
  if(valid("growth") && c.quarterRevenueGrowth!<0) weaknesses.push(lang==="ja" ? `売上減少 ${c.quarterRevenueGrowth!.toFixed(1)}%` : `Revenue decline ${c.quarterRevenueGrowth!.toFixed(1)}%`);
  if(valid("profitability") && c.quarterOperatingMargin!>=15) strengths.push(lang==="ja" ? `営業利益率 ${c.quarterOperatingMargin!.toFixed(1)}%` : `Operating margin ${c.quarterOperatingMargin!.toFixed(1)}%`);
  if(valid("profitability") && c.quarterOperatingMargin!<0) weaknesses.push(lang==="ja" ? `営業赤字（利益率 ${c.quarterOperatingMargin!.toFixed(1)}%）` : `Operating loss (${c.quarterOperatingMargin!.toFixed(1)}% margin)`);
  if(valid("growth") && finite(c.quarterDilutedSharesGrowth) && c.quarterDilutedSharesGrowth>5) weaknesses.push(lang==="ja" ? `平均株式数 +${c.quarterDilutedSharesGrowth!.toFixed(1)}%` : `Average shares +${c.quarterDilutedSharesGrowth!.toFixed(1)}%`);
  if(valid("cash") && c.quarterFcfMargin!<0) weaknesses.push(lang==="ja" ? "四半期の簡易FCFがマイナス" : "Negative quarterly simple FCF");
  return {strengths,weaknesses};
}
export function quarterlyTakeaway(companies: (Financials & {ticker:string})[], lang:"ja"|"en", now=Date.now()) {
  if(companies.length<2) return lang==="ja" ? "比較には2社以上のデータが必要です。" : "At least two companies are needed.";
  const usable=companies.filter(c=>comparisonScores(c,now).filter(s=>s.id==="growth" || s.id==="profitability").every(s=>s.value!==null) && finite(c.quarterRevenueGrowth) && finite(c.quarterOperatingMargin));
  if(usable.length!==companies.length) return lang==="ja" ? "選択した全社の直近四半期データが揃っていないため、優劣は判定できません。" : "Recent quarterly data is incomplete for the selected companies, so no leader can be determined.";
  if(!comparableQuarters(usable,now))
    return lang==="ja" ? "決算期間・会計基準が異なるため、数値を個別に確認してください。" : "Review figures individually: reporting periods or accounting bases differ.";
  const growth=[...usable].sort((a,b)=>b.quarterRevenueGrowth!-a.quarterRevenueGrowth!);
  const margins=[...usable].sort((a,b)=>b.quarterOperatingMargin!-a.quarterOperatingMargin!);
  const growthLead=growth.length>1 && growth[0].quarterRevenueGrowth!>growth[1].quarterRevenueGrowth!+.1;
  const marginLead=margins.length>1 && margins[0].quarterOperatingMargin!>margins[1].quarterOperatingMargin!+.1;
  if(!growthLead&&!marginLead) return lang==="ja" ? "売上成長率と営業利益率は近い水準です。" : "Revenue growth and operating margins are close.";
  const parts=[];
  if(growthLead)parts.push(lang==="ja" ? `売上成長率は${growth[0].ticker}` : `${growth[0].ticker} leads in revenue growth`);
  if(marginLead)parts.push(lang==="ja" ? `営業利益率は${margins[0].ticker}` : `${margins[0].ticker} leads in operating margin`);
  return lang==="ja" ? `${parts.join("、")}が上回っています。` : `${parts.join("; ")}.`;
}

/** Equal-weight seven-factor summary; incomplete or incompatible evidence cannot produce a winner. */
export function overallComparison(companies: (Financials & {ticker:string})[],lang:"ja"|"en",now=Date.now()) {
  const ja=lang==="ja",ranked=companies.map(c=>({c,scores:comparisonScores(c,now),total:compositeScore(comparisonScores(c,now))}));
  if(!comparableQuarters(companies,now) || new Set(companies.map(c=>!!c.referenceEvaluation)).size>1 || ranked.some(r=>r.total===null))
    return {title:ja?"総合評価に必要なデータが揃っていません":"There isn't enough data for an overall score",description:ja?"取得できた項目は下のスナップショットで比較できます。欠損を0点に置き換えず、総合順位は保留します。":"You can still compare the available factors below. Missing values don't mean zero, so we haven't assigned an overall ranking."};
  ranked.sort((a,b)=>b.total!-a.total!);
  const best=ranked[0],next=ranked[1],gap=best.total!-next.total!;
  const totals=ranked.map(r=>`${r.c.ticker} ${r.total!.toFixed(1)}/10`).join(" · ");
  if(gap<0.3)return {title:ja?"総合評価は拮抗":"Overall assessment is close",description:ja?`${totals}。7項目平均の差は0.3点未満で、明確な優位はありません。`:`${totals}. The seven-factor averages differ by less than 0.3 points, with no clear leader.`};
  const advantages=best.scores.map(s=>({...s,gap:s.value!-Math.max(...ranked.slice(1).map(r=>r.scores.find(f=>f.id===s.id)!.value!))})).filter(s=>s.gap>0).sort((a,b)=>b.gap-a.gap).slice(0,2).map(s=>s.label[lang]);
  const weak=best.c.preparedAnalysis?.items.find(i=>i.kind==="weakness")?.short[lang];
  const reason=advantages.length ? (ja?`${advantages.join("・")}の強さが総合点を押し上げています。`:`Strength in ${advantages.join(" and ")} supports the overall lead.`) : (ja?"7項目全体のバランスで上回ります。":"It leads on the balance of all seven factors.");
  return {title:ja?`総合評価は${best.c.ticker}が優位`:`${best.c.ticker} leads overall`,description:ja?`${totals}。${reason}${weak?`ただし、${weak}には注意が必要です。`:""}`:`${totals}. ${reason}${weak?` Key caution: ${weak}.`:""}`};
}
