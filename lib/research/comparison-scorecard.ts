import { periodMaxAgeDays, twelveExtraFactors, twelveFactorMetric } from "./twelve-data-factors.ts";
import { valueFigureCurrent, valueFigureScore, valueFigureText } from "./comparison-value.ts";
import type { Financials } from "./comparison.ts";
import { ALTERNATIVE_SCALES, lossTrendPct, runway } from "./comparison-alternatives.ts";
import { ALTERNATIVE_LABELS } from "./comparison-labels.ts";
export type ScoreId = "valuation" | "growth" | "profitability" | "financial" | "cash" | "stability" | "momentum";
export type ComparisonScore = { id: ScoreId; label: {ja:string;en:string}; value: number | null };
const clamp = (n:number) => Math.round(Math.max(0,Math.min(10,n))*10)/10;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
/** The latest period is current: a quarter, or for a foreign filer a half-year or fiscal year (`periodMonths`), each with its own age limit.
 * A foreign filer's fiscal year stands as its latest period only because no tagged interim report exists, so the notes saying so do not
 * block it; a check that could not be made still does. */
export function hasRecentQuarter(c: Financials, now = Date.now()): boolean {
  const annual = c.periodMonths === 12;
  return c.status === "ready" && !!c.quarterRevenue && now-Date.parse(c.quarterRevenue.end)>=0
    && now-Date.parse(c.quarterRevenue.end)<=periodMaxAgeDays(c.periodMonths)*86400000
    && !c.dataWarnings?.some(w=>(!annual && w.en.includes("quarterly filing")) || w.en.includes("earnings release") || w.en.includes("could not be checked"));
}
/** A company with no revenue yet whose latest balance sheet is current: the same age limit and filing checks as a quarter. Its financial
 *  strength is scored from that balance sheet (owner, Nov 26: requiring a revenue figure before reading the balance sheet was a bug). */
export function hasRecentBalance(c: Financials, now = Date.now()): boolean {
  return c.status === "ready" && !!c.preRevenue && !!c.balance && now-Date.parse(c.balance.end)>=0 && now-Date.parse(c.balance.end)<=periodMaxAgeDays(c.balanceMonths)*86400000
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
  // A half-year or a fiscal year beside a quarter is a different period, however close the end dates.
  return filingBases.size<=1 && spread<=100*86400000 && new Set(companies.map(c=>c.periodMonths ?? 3)).size===1;
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
  if(hasRecentBalance(c,now) && !hasRecentQuarter(c,now)) return (c.preRevenueMetrics ? (c.zeroQuarter ? ALTERNATIVE_LABELS.zeroQuarterNote : ALTERNATIVE_LABELS.preRevenueNote) : { ja: "売上がまだ無い会社です。財務と株価の項目で比べます。", en: "No revenue yet: compared on its balance sheet and share price." })[lang];
  if((c.status==="unsupported" || !c.quarterRevenue) && c.gapReason) return gapNote(c.gapReason)[lang];
  if(c.status==="unsupported" || !c.quarterRevenue) return ja ? "比較に使える四半期データが未取得です。" : "Comparable quarterly data is unavailable.";
  if(!hasRecentQuarter(c,now) && c.gapReason?.kind==="stale") return gapNote(c.gapReason)[lang];
  if(!hasRecentQuarter(c,now)) return ja ? "最新の四半期データを確認できていません。" : "The latest quarterly figures have not been verified.";
  if(!c.preparedAnalysis) return ja ? "長所・短所の要点は未作成です。" : "Strengths and weaknesses have not been prepared.";
  return null;
}
/** Reference scale, not an industry percentile or a buy recommendation.
 * A fiscal year's figure fills a missing quarterly cash or stability score only when the quarter's own is not filed, and is labelled as
 * annual on screen (fcfPeriod, marginPeriod; Nov 26). Quote/forecast
 * valuation stays unavailable until a licensed, timestamped feed is connected.
 */
export function comparisonScores(c: Financials, now = Date.now()): ComparisonScore[] {
  const recent = hasRecentQuarter(c, now), balanceOnly = !recent && hasRecentBalance(c, now);
  // No revenue a year earlier (a new product line, ACHR): growth against the previous quarter, labelled as such.
  const growth = recent && finite(c.quarterRevenueGrowth) ? clamp(5+c.quarterRevenueGrowth/10) : recent && finite(c.quarterRevenueQoq) ? clamp(5+c.quarterRevenueQoq/10) : null;
  // A margin above 100% (operating income above revenue) or free cash flow above revenue is no measure of the business: never scored,
  // whatever source gave it (the filing withholds them itself: marginWithheld, fcfWithheld; Nov 26 data-quality audit).
  const profitability = recent && finite(c.quarterOperatingMargin) && c.quarterOperatingMargin <= 100 ? clamp(c.quarterOperatingMargin/5) : null;
  const balance=c.balance;
  // Financial strength needs a current balance plus debt disclosures. Missing
  // debt is unknown, never zero; an annual snapshot cannot fill this score.
  const debt = balanceDebt(c);
  const balanced = (recent && balance && (balance.end===c.quarterRevenue?.end || balance.end===c.balanceFromQuarter) || balanceOnly) && balance?.cash && debt!==null;
  // Banks and brokers have no current assets or liabilities: cash against debt alone, on the full ten-point scale, labelled as such.
  const financial = balanced && finite(balance!.currentRatio) ? clamp(5*Math.min(balance!.currentRatio,2)/2 + 5*Math.min(balance!.cash!.value/Math.max(debt!,1),1))
    : balanced ? clamp(10*Math.min(balance!.cash!.value/Math.max(debt!,1),1)) : null;
  const cash = recent && finite(c.quarterFcfMargin) && c.quarterFcfMargin <= 100 ? clamp(5+c.quarterFcfMargin/5) : null;
  const extra=c.twelveData ? twelveExtraFactors(c.twelveData,now) : null;
  // Company-type metrics where the standard one has no meaning (comparison-alternatives.ts), each on its own fixed scale; a standard score
  // that exists is never replaced.
  const alt = alternativeScores(c, recent, balanceOnly);
  const scores: ComparisonScore[] = [
    {id:"financial",label:{ja:"財務健全性",en:"Financial strength"},value:recent ? extra?.financial ?? financial ?? alt.financial ?? null : balanceOnly ? financial : null},
    {id:"profitability",label:{ja:"収益性",en:"Profitability"},value:profitability ?? (alt.profitability ?? null)},
    // Treasure Hunt's figure (comparison-value.ts): the price against the company's own history, independent of the latest quarter.
    {id:"valuation",label:{ja:"割安性",en:"Valuation"},value:c.valueCheck && valueFigureCurrent(c.valueCheck,now) ? valueFigureScore(c.valueCheck) : null},
    {id:"stability",label:{ja:"安定性",en:"Stability"},value:recent ? extra?.stability ?? null : (alt.stability ?? null)},
    {id:"momentum",label:{ja:"株価モメンタム",en:"Price momentum"},value:extra?.momentum ?? null},
    {id:"growth",label:{ja:"成長性",en:"Growth"},value:growth ?? (alt.growth ?? null)},
    {id:"cash",label:{ja:"資金創出",en:"Cash generation"},value:cash ?? (alt.cash ?? null)},
  ];
  if(c.referenceEvaluation) return scores.map(s=>({...s,value:recent ? c.referenceEvaluation!.factors.find(f=>f.id===s.id)?.value ?? null : null}));
  return scores;
}

function gapNote(g: NonNullable<Financials["gapReason"]>) {
  const L = ALTERNATIVE_LABELS.gap;
  return g.kind === "stale" ? L.stale.note(g.date ?? "") : L[g.kind].note;
}
/** The company-type scores: for a pre-revenue company with a current balance sheet, runway, net-loss trend, R&D intensity and dilution
 *  (growth, profitability, cash, stability); for a bank, insurer, broker or BDC with a current period, capital ratio, ROE and net investment
 *  income margin where the standard figure is missing. Only the company's own figures (partner-independent). */
export function alternativeScores(c: Financials, recent: boolean, balanceOnly: boolean): Partial<Record<ScoreId, number | null>> {
  const S = ALTERNATIVE_SCALES;
  if (balanceOnly && c.preRevenueMetrics) {
    const m = c.preRevenueMetrics, trend = lossTrendPct(m);
    // Profitability has no stand-in: with no revenue there is no margin (the line says so and shows the R&D share as a fact).
    return { cash: S.runway(runway(m)), growth: trend === null ? null : S.lossTrend(trend), profitability: null,
      stability: m.dilution ? S.dilution(m.dilution.pct) : null };
  }
  const s = c.sectorMetrics;
  if (!recent || !s) return {};
  return { financial: finite(s.capitalRatio) ? S.capitalRatio(s.capitalRatio) : null, cash: s.roe ? S.roe(s.roe.pct) : null,
    profitability: finite(s.niiMargin) ? S.niiMargin(s.niiMargin) : null };
}
/** The line beside a company-type score (comparison-labels.ts), or null when the standard figure is shown. */
function alternativeMetric(c: Financials, id: ScoreId, lang: "ja"|"en", recent: boolean, balanceOnly: boolean): string | null {
  const alt = alternativeScores(c, recent, balanceOnly)[id];
  const L = ALTERNATIVE_LABELS;
  if (balanceOnly && c.preRevenueMetrics && id === "profitability") return L.noMargin(c.preRevenueMetrics.rd?.share ?? null)[lang];
  if (alt === null && balanceOnly && c.preRevenueMetrics && (id === "cash" || id === "growth" || id === "stability")) return L.missing[id][lang];
  if (alt === null || alt === undefined) return null;
  if (balanceOnly && c.preRevenueMetrics) {
    const m = c.preRevenueMetrics;
    if (id === "cash") { const r = runway(m); return (r.cashPositive ? L.runway.positive : L.runway.months(r.months!))[lang]; }
    if (id === "growth") return L.lossTrend(m.netIncome!.now, m.netIncome!.before, m.netIncome!.basis)[lang];
    if (id === "stability") return L.dilution(m.dilution!.pct)[lang];
    return null;
  }
  const s = c.sectorMetrics!;
  if (id === "financial") return L.capitalRatio(s.capitalRatio!)[lang];
  if (id === "cash") return L.roe(s.roe!.pct)[lang];
  if (id === "profitability") return L.niiMargin(s.niiMargin!)[lang];
  return null;
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
  const reference=c.referenceEvaluation?.factors.find(f=>f.id===id);
  if(id==="valuation" && !reference) return c.valueCheck && valueFigureCurrent(c.valueCheck,now) ? valueFigureText(c.valueCheck,lang) : missingReason(c,id,lang==="ja");
  // A company with no revenue yet: its balance sheet scores financial strength; the revenue factors say "no revenue yet", not "unverified".
  const balanceOnly=!hasRecentQuarter(c,now) && hasRecentBalance(c,now);
  if(balanceOnly && id!=="financial" && id!=="momentum") return alternativeMetric(c,id,lang,false,true) ?? missingReason(c,id,lang==="ja");
  if(!hasRecentQuarter(c,now) && !balanceOnly && !(id==="momentum" && c.twelveData && twelveExtraFactors(c.twelveData,now).momentum!==null)) {
    // A company with no figures at all says why (no report yet, no XBRL, reports stopped, revenue not readable) rather than "unverified".
    if(id!=="momentum" && c.gapReason && ((c.status==="unsupported" || !c.quarterRevenue) || c.gapReason.kind==="stale")) return ALTERNATIVE_LABELS.gap[c.gapReason.kind].line[lang];
    return lang==="ja" ? "最新値未確認" : "Latest value unverified";
  }
  if(reference) return reference.metric[lang];
  const ja=lang==="ja";
  const providerMetric=c.twelveData ? twelveFactorMetric(c.twelveData,id,lang,now) : null;
  if(providerMetric)return providerMetric;
  if(id==="growth" && finite(c.quarterRevenueGrowth)) return `${ja?"売上前年比":"Revenue growth (YoY)"} ${c.quarterRevenueGrowth>0?"+":""}${c.quarterRevenueGrowth.toFixed(1)}%`;
  if(id==="growth" && finite(c.quarterRevenueQoq)) return `${ja?"売上前四半期比":"Revenue growth (QoQ)"} ${c.quarterRevenueQoq>0?"+":""}${c.quarterRevenueQoq.toFixed(1)}%`;
  if(id==="profitability" && finite(c.quarterOperatingMargin) && c.quarterOperatingMargin <= 100) return `${c.quarterOperatingIncome?.tag==="TechPhasePretaxIncome" ? (ja?"税引前利益率":"Pre-tax margin") : (ja?"営業利益率":"Operating margin")} ${c.quarterOperatingMargin.toFixed(1)}%`;
  if(id==="cash" && finite(c.quarterFcfMargin) && c.quarterFcfMargin <= 100) return c.fcfPeriod==="annual" ? ALTERNATIVE_LABELS.annualFcf(c.quarterFcfMargin)[lang] : `${ja?"簡易FCF率":"Simple FCF margin"} ${c.quarterFcfMargin.toFixed(1)}%`;
  const ownBalance=c.balance?.end===c.quarterRevenue?.end || (!!c.balance && c.balance.end===c.balanceFromQuarter) || balanceOnly;
  if(id==="financial" && ownBalance && !finite(c.balance?.currentRatio) && c.balance?.cash && balanceDebt(c)!==null) {
    const debt=balanceDebt(c)!;
    return debt===0 ? (ja?"借入なし":"No borrowings") : `${ja?"現金÷有利子負債":"Cash ÷ debt"} ${(c.balance.cash.value/debt).toFixed(2)}${ja?"倍":"×"}`;
  }
  // The company-type metric whenever it is the one scored, i.e. the standard figure is missing (a bank without a debt figure: its capital
  // ratio, not a current ratio).
  if(comparisonScores({...c,sectorMetrics:undefined,preRevenueMetrics:undefined},now).find(s=>s.id===id)?.value===null) {
    const alternative=alternativeMetric(c,id,lang,hasRecentQuarter(c,now),false);
    if(alternative) return alternative;
  }
  if(id==="financial" && ownBalance && finite(c.balance?.currentRatio)) return `${ja?"流動比率":"Current ratio"} ${c.balance.currentRatio.toFixed(2)}${ja?"倍":"×"}${c.balance.debtTotal?.source==="none" ? (ja?"・借入なし":" · no borrowings") : ""}`;
  return missingReason(c,id,ja);
}

/** Why a factor has no score, in a few words (owner, Nov 14: a "—" should say why, not just that data is missing). */
function missingReason(c: Financials, id: ScoreId, ja: boolean): string {
  const r=(jaText:string,en:string)=>ja?jaText:en;
  const noRevenue=!c.quarterRevenue || c.quarterRevenue.value<=0;
  if(noRevenue && (id==="growth"||id==="profitability"||id==="cash"||id==="stability")) return r("売上がまだ無い会社です","No revenue yet");
  if(id==="growth") return r("前年同期の売上が未開示","Year-ago revenue not available");
  if(id==="profitability" && (c.marginWithheld || (finite(c.quarterOperatingMargin) && c.quarterOperatingMargin > 100))) return ALTERNATIVE_LABELS.marginWithheld[ja?"ja":"en"];
  if(id==="profitability") return r("営業利益の記載なし","No operating income reported");
  if(id==="cash" && (c.fcfWithheld==="aboveRevenue" || (finite(c.quarterFcfMargin) && c.quarterFcfMargin > 100))) return ALTERNATIVE_LABELS.fcfAboveRevenue[ja?"ja":"en"];
  if(id==="cash" && c.sectorMetrics && !c.sectorMetrics.roe && c.quarterFcfMargin===null) return ALTERNATIVE_LABELS.noRoe[ja?"ja":"en"];
  if(id==="cash") return r("キャッシュフロー未開示","Cash flow not available");
  if(id==="stability") return r("4四半期分の利益率がそろいません","Four quarters of margins not available");
  if(id==="financial") return r("借入の記載を読み取れません","Debt figures not readable");
  // Negative shareholders' equity and no revenue: no price multiple exists (P/B is negative), said as such rather than "unavailable".
  if(id==="valuation" && c.balance?.equity && c.balance.equity.value<0 && (!c.quarterRevenue || c.preRevenue)) return ALTERNATIVE_LABELS.negativeEquity[ja?"ja":"en"];
  if(id==="valuation") return r("未取得","Unavailable");
  if(id==="momentum") return r("株価の履歴が不足（上場直後など）","Not enough price history");
  return r("必要データ未取得","Data unavailable");
}

/** Missing factors must never improve the composite by being omitted. */
export function compositeScore(scores: ComparisonScore[]): number | null {
  if (!scores.length || scores.some(s => s.value === null)) return null;
  return Math.round(scores.reduce((sum,s) => sum + s.value!,0)/scores.length*10)/10;
}
/** The overall score on the factors every company in the comparison has (owner, Nov 15: "総合評価に必要なデータが揃っていません" made the
 *  comparison useless). A factor one company lacks is left out for all of them, so the totals stay on one yardstick; at least three factors
 *  are needed. `ids` says which factors were used. */
export function commonTotals(companies: Financials[], now=Date.now()): { ids: ScoreId[]; totals: (number|null)[] } {
  const sets=companies.map(c=>comparisonScores(c,now));
  const ids=(sets[0] ?? []).map(s=>s.id).filter(id=>sets.every(scores=>scores.find(s=>s.id===id)?.value!=null));
  if(ids.length<3) return { ids, totals: companies.map(()=>null) };
  return { ids, totals: sets.map(scores=>compositeScore(scores.filter(s=>ids.includes(s.id)))) };
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
  if(valid("profitability") && c.quarterOperatingMargin!<0) weaknesses.push(lang==="ja" ? `営業赤字 ${c.quarterOperatingMargin!.toFixed(1)}%` : `Operating loss ${c.quarterOperatingMargin!.toFixed(1)}%`);
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

// Plain words for each factor in the summary sentence (owner, Nov 15: "読みやすく、簡潔に").
const factorWords: Record<ScoreId,{ja:string;en:string}> = {
  financial:{ja:"財務の余力",en:"financial strength"}, profitability:{ja:"収益性",en:"profitability"}, valuation:{ja:"割安さ",en:"valuation"},
  stability:{ja:"安定性",en:"stability"}, momentum:{ja:"株価の勢い",en:"price momentum"}, growth:{ja:"成長性",en:"growth"}, cash:{ja:"資金を生む力",en:"cash generation"},
};
type AnalysisItem = NonNullable<Financials["preparedAnalysis"]>["items"][number];
/** One weakness bullet as a plain clause ("売上が43.5%減っています"), using only the figures in the bullet itself. */
export function cautionClause(item: AnalysisItem, lang: "ja"|"en"): string {
  const ja=lang==="ja", text=item.short[lang], numbers=[...text.matchAll(/[-+]?\d[\d,]*(?:\.\d+)?/g)].map(m=>m[0].replace(/^\+/,""));
  const abs=(n:string|undefined)=>n?.replace(/^-/,"");
  if(item.id==="revenue-growth" && numbers[0]) return ja ? `売上が${abs(numbers[0])}%減っています` : `its revenue fell ${abs(numbers[0])}%`;
  if(item.id==="margin-decline" && numbers.length>=2) return ja ? `営業利益率が${numbers[0]}%から${numbers[1]}%に下がっています` : `its operating margin fell from ${numbers[0]}% to ${numbers[1]}%`;
  if(item.id==="operating-margin" && numbers[0] && /税引前|Pre-tax/.test(text)) return ja ? `税引前で赤字（利益率 ${numbers[0]}%）です` : `its pre-tax margin was ${numbers[0]}%`;
  if(item.id==="operating-margin" && numbers[0]) return ja ? `営業赤字（営業利益率 ${numbers[0]}%）です` : `its operating margin was ${numbers[0]}%`;
  if(item.id==="momentum" && numbers.length) return ja ? `株価が約3か月で${abs(numbers.at(-1))}%下がっています` : `its share price fell ${abs(numbers.at(-1))}% over about three months`;
  if(item.id==="share-count" && numbers[0]) return ja ? `平均株式数が${abs(numbers[0])}%増えています` : `its average share count rose ${abs(numbers[0])}%`;
  if(item.id==="debt-cash") return ja ? "有利子負債が現金を上回っています" : "its debt exceeds its cash";
  if(item.id==="revenue-qoq" && numbers[0]) return ja ? `売上が前の四半期より${abs(numbers[0])}%減っています` : `its revenue fell ${abs(numbers[0])}% from the previous quarter`;
  if(item.id==="negative-equity") return ja ? "株主資本がマイナスです" : "its shareholders' equity is negative";
  if(item.id==="cash-generation" && numbers[0]) return ja ? `簡易FCFがマイナス（売上比 ${numbers[0]}%）です` : `its simple free cash flow is negative (${numbers[0]}% of revenue)`;
  return ja ? `${text}には注意が必要です` : `watch ${text}`;
}
const joinWords=(words:string[],ja:boolean)=>ja ? words.join("と") : words.join(" and ");
/** Equal-weight summary on the factors every company has. The scores are shown above it, so the sentence says who leads and why in plain words,
 * then one caution at most. Incomplete or incompatible evidence cannot produce a winner. `note` is the yardstick, for the caveats list.
 * The title is the big verdict under the small 「総合評価」/"Overall" label (owner, Nov 15), so it no longer starts with 「総合評価は」;
 * `leader` is the winner's ticker, set only when there is one. */
export function overallComparison(companies: (Financials & {ticker:string})[],lang:"ja"|"en",now=Date.now()): {title:string;description:string;note?:string;leader?:string} {
  const ja=lang==="ja",common=commonTotals(companies,now);
  const ranked=companies.map((c,i)=>({c,scores:comparisonScores(c,now).filter(s=>common.ids.includes(s.id)),total:common.totals[i]}));
  if(new Set(companies.map(c=>!!c.referenceEvaluation)).size>1 || ranked.some(r=>r.total===null))
    return {title:ja?"必要なデータが揃っていません":"There isn't enough data for an overall score",description:ja?`${companies.length}社に共通する項目が3つ未満のため、総合順位は出していません。`:"Fewer than three factors are available for every company, so no overall ranking is given."};
  const count=common.ids.length;
  const note=count<7 ? (ja?`総合点は、全社にそろう${count}項目の平均です。`:`Overall scores average the ${count} factors every company has.`) : undefined;
  const periods=comparableQuarters(companies,now) ? "" : companies.some(c=>!hasRecentQuarter(c,now) && hasRecentBalance(c,now))
    ? (ja?"売上がまだ無い会社を含みます。":"Includes a company with no revenue yet. ") : (ja?"決算期間が異なる会社を含みます。":"Reporting periods differ. ");
  ranked.sort((a,b)=>b.total!-a.total!);
  const best=ranked[0],next=ranked[1],gap=best.total!-next.total!;
  const value=(r:typeof best,id:ScoreId)=>r.scores.find(s=>s.id===id)!.value!;
  // The factors where `r` is ahead of every company in `others`, largest lead first. Price momentum is a strength only when the price rose
  // (owner, Nov 26: "AMDは株価の勢いが強みですが、株価が約3か月で14.8%下がっています"): a smaller fall is never called one.
  const change=(r:typeof best)=>r.c.twelveData?.momentum?.changePct ?? null;
  const rose=(r:typeof best)=>{const pct=change(r);return pct!==null && pct>0;};
  const rawEdges=(r:typeof best,others:typeof ranked)=>r.scores.map(s=>({id:s.id,lead:s.value!-Math.max(...others.map(o=>value(o,s.id)))}))
    .filter(s=>s.lead>0).sort((a,b)=>b.lead-a.lead);
  const edges=(r:typeof best,others:typeof ranked)=>rawEdges(r,others).filter(s=>s.id!=="momentum" || rose(r)).slice(0,2);
  // When every company fell, the one that fell least is described as such (owner's words), only in this summary.
  // A fall is at least 0.05% (reviewer, Nov 26: a flat price was written as 「0.0%の下落」).
  const allFell=ranked.every(o=>{const pct=change(o);return pct!==null && pct<=-0.05;}) && common.ids.includes("momentum");
  const fellLess=(r:typeof best,others:typeof ranked)=>{
    if(!allFell || !rawEdges(r,others).some(s=>s.id==="momentum")) return "";
    const pct=Math.abs(change(r)!).toFixed(1), names=others.map(o=>o.c.ticker);
    return ja?`${r.c.ticker}は株価の下げが${names.join("・")}より小さく、約3か月で${pct}%の下落です。`:`${r.c.ticker} has fallen less than ${names.join(" and ")}, down ${pct}% over about three months.`;
  };
  const words=(list:{id:ScoreId}[])=>joinWords(list.map(s=>factorWords[s.id][lang]),ja);
  const weakness=(r:typeof best)=>r.c.preparedAnalysis?.items.find(i=>i.kind==="weakness");
  if(gap<0.3) {
    const a=edges(best,[next]),b=edges(next,[best]);
    const split=a.length && b.length ? (ja?`${best.c.ticker}は${words(a.slice(0,1))}、${next.c.ticker}は${words(b.slice(0,1))}で上回ります。`:`${best.c.ticker} is ahead in ${words(a.slice(0,1))}, ${next.c.ticker} in ${words(b.slice(0,1))}.`) : "";
    return {title:ja?"拮抗":"Too close to call",description:ja?`${periods}総合点の差は0.3点未満で、はっきりした優劣はありません。${split}`:`${periods}The overall scores are within 0.3 points, so there is no clear leader. ${split}`.trim(),note};
  }
  const lead=edges(best,ranked.slice(1));
  const strongly=lead.length>0 && Math.min(...lead.map(s=>s.lead))>=3;
  const first=lead.length ? (ja?`${best.c.ticker}は${words(lead)}で${strongly?"大きく":""}上回ります。`:`${best.c.ticker} is ${strongly?"well ":""}ahead in ${words(lead)}.`)
    : (ja?`${best.c.ticker}は項目全体のバランスで上回ります。`:`${best.c.ticker} leads on the balance of the factors.`);
  // The runner-up: its own strength against the leader, and its weakness as the one caution; otherwise the leader's weakness.
  const leaderFellLess=fellLess(best,ranked.slice(1)), nextFellLess=leaderFellLess ? "" : fellLess(next,[best]);
  // A company whose smaller fall is already said never gets its fall again as the caution (reviewer, Nov 26: the sentence said it twice).
  const caution=(r:typeof best,said:boolean)=>said ? r.c.preparedAnalysis?.items.find(i=>i.kind==="weakness" && i.id!=="momentum") : weakness(r);
  const counter=edges(next,[best]).slice(0,1), nextWeak=caution(next,!!nextFellLess), bestWeak=caution(best,!!leaderFellLess);
  let second="";
  if(nextFellLess && !counter.length) second=nextFellLess;
  else if(counter.length && nextWeak) second=ja?`${next.c.ticker}は${words(counter)}が強みですが、${cautionClause(nextWeak,lang)}。`:`${next.c.ticker} is stronger in ${words(counter)}, but ${cautionClause(nextWeak,lang)}.`;
  else if(bestWeak) second=ja?`ただし、${best.c.ticker}は${cautionClause(bestWeak,lang)}。`:`However, ${cautionClause(bestWeak,lang).replace(/^its /,`${best.c.ticker}'s `).replace(/^watch /,`watch ${best.c.ticker}'s `)}.`;
  else if(counter.length) second=ja?`${next.c.ticker}は${words(counter)}で上回ります。`:`${next.c.ticker} is ahead in ${words(counter)}.`;
  if(leaderFellLess) second=ja?`${leaderFellLess}${second}`:`${leaderFellLess} ${second}`.trim();
  return {title:ja?`${best.c.ticker} が優位`:`${best.c.ticker} leads`,leader:best.c.ticker,description:ja?`${periods}${first}${second}`:`${periods}${first} ${second}`.trim(),note};
}
