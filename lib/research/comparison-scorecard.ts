import { twelveExtraFactors, twelveFactorMetric } from "./twelve-data-factors.ts";
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
  return bases.every(Boolean) && new Set(bases).size===1 && Math.max(...ends)-Math.min(...ends)<=100*86400000;
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
  const growth = recent && finite(c.quarterRevenueGrowth) ? clamp(5+c.quarterRevenueGrowth/10) : null;
  const profitability = recent && finite(c.quarterOperatingMargin) ? clamp(c.quarterOperatingMargin/5) : null;
  const balance=c.balance;
  // Financial strength needs a current balance plus debt disclosures. Missing
  // debt is unknown, never zero; an annual snapshot cannot fill this score.
  const financial = recent && balance && balance.end===c.quarterRevenue?.end && finite(balance.currentRatio) && balance.cash && balance.debtCurrent && balance.debtNoncurrent
    ? clamp(5*Math.min(balance.currentRatio,2)/2 + 5*Math.min(balance.cash.value/Math.max(balance.debtCurrent.value+balance.debtNoncurrent.value,1),1)) : null;
  const cash = recent && finite(c.quarterFcfMargin) ? clamp(5+c.quarterFcfMargin/5) : null;
  const extra=c.twelveData ? twelveExtraFactors(c.twelveData,now) : null;
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

/** Display actual measurements beside the reference bars, including unscored factors. */
export function comparisonMetric(c: Financials, id: ScoreId, lang: "ja"|"en", now=Date.now()): string {
  if(!hasRecentQuarter(c,now) && !(id==="momentum" && c.twelveData && twelveExtraFactors(c.twelveData,now).momentum!==null)) return lang==="ja" ? "最新値未確認" : "Latest value unverified";
  const reference=c.referenceEvaluation?.factors.find(f=>f.id===id);
  if(reference) return reference.metric[lang];
  const ja=lang==="ja";
  const providerMetric=c.twelveData ? twelveFactorMetric(c.twelveData,id,lang,now) : null;
  if(providerMetric)return providerMetric;
  if(id==="growth" && finite(c.quarterRevenueGrowth)) return `${ja?"売上前年比":"Revenue YoY"} ${c.quarterRevenueGrowth>0?"+":""}${c.quarterRevenueGrowth.toFixed(1)}%`;
  if(id==="profitability" && finite(c.quarterOperatingMargin)) return `${ja?"営業利益率":"Operating margin"} ${c.quarterOperatingMargin.toFixed(1)}%`;
  if(id==="cash" && finite(c.quarterFcfMargin)) return `${ja?"簡易FCF率":"Simple FCF margin"} ${c.quarterFcfMargin.toFixed(1)}%`;
  if(id==="financial" && c.balance?.end===c.quarterRevenue?.end && finite(c.balance?.currentRatio)) return `${ja?"流動比率":"Current ratio"} ${c.balance.currentRatio.toFixed(2)}${ja?"倍":"×"}`;
  return ja ? "必要データ未取得" : "Required data unavailable";
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
