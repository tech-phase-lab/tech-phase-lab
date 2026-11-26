import { createHash } from "node:crypto";
import type { Financials } from "./comparison.ts";
import { balanceDebt, comparisonMetric, comparisonScores, hasRecentBalance, hasRecentQuarter } from "./comparison-scorecard.ts";
import { twelveExtraFactors, twelveFactorMethods } from "./twelve-data-factors.ts";

type Copy = { ja: string; en: string };
export type PreparedComparisonAnalysis = {
  version: 1; method: "deterministic" | "reviewed"; sourceRevision: string;
  preparedAt: string; processingMs: number; periodEnd: string; sourceUrl: string;
  items: { id: string; kind: "strength" | "weakness"; short: Copy; detail: Copy }[];
};
// The timestamp is deliberately excluded: unchanged evidence has the same revision.
export function comparisonEvidenceRevision(c: Financials) {
  return createHash("sha256").update(JSON.stringify([
    c.ticker,c.status,c.quarterRevenue,c.previousQuarterRevenue,c.quarterOperatingIncome,
    c.quarterRevenueGrowth,c.quarterOperatingMargin,c.quarterFcfMargin,
    c.quarterDilutedSharesGrowth,c.quarterSourceUrl,c.balance,c.dataWarnings ?? [],c.twelveData ?? null,
  ])).digest("hex");
}
const copy = (ja:string,en:string):Copy => ({ja,en});
const amount = (value:number,unit:string) => `${value.toLocaleString("en-US",{maximumFractionDigits:20})} ${unit}`;
/** Runs once per financial cache refresh, never calls an LLM or external service. */
export function prepareComparisonAnalysis(c: Financials, now=Date.now()): PreparedComparisonAnalysis | undefined {
  const started=performance.now();
  if(c.status!=="ready" || !c.quarterRevenue || !c.quarterSourceUrl || !hasRecentQuarter(c,now)) return undefined;
  const scores=comparisonScores(c,now);
  const valid=(id:string)=>scores.some(s=>s.id===id && s.value!==null);
  if(!scores.some(s=>s.value!==null)) return undefined;
  const items:PreparedComparisonAnalysis["items"]=[];
  const add=(id:string,kind:"strength"|"weakness",short:Copy,detail:Copy)=>items.push({id,kind,short,detail});
  const q=c.quarterRevenue, prior=c.previousQuarterRevenue;
  // A foreign filer's half-year or fiscal year (periodMonths) is named as such, not as a quarter.
  const span=c.periodMonths===6 ? {ja:"半期",en:"Half-year"} : c.periodMonths===12 ? {ja:"年度",en:"Annual"} : {ja:"四半期",en:"Quarterly"};
  if(valid("growth") && prior && c.quarterRevenueGrowth!==null && c.quarterRevenueGrowth!==0) {
    const growth=c.quarterRevenueGrowth, pct=`${growth>0?"+":""}${growth.toFixed(1)}%`;
    add("revenue-growth",growth>0?"strength":"weakness",
      copy(`${growth>0?"売上成長":"売上減少"} ${pct}`,`Revenue ${growth>0?"growth":"decline"} ${pct}`),
      copy(`売上高は前年同期の${amount(prior.value,prior.unit)}から${amount(q.value,q.unit)}へ。前年同期比${pct}。`,
        `Revenue changed from ${amount(prior.value,prior.unit)} in the prior-year ${c.periodMonths===6 ? "half" : c.periodMonths===12 ? "year" : "quarter"} to ${amount(q.value,q.unit)}, ${pct} year over year.`));
  }
  // No revenue a year earlier: growth is scored against the quarter just before (comparisonScores), and said as such here too. A quarter
  // only: a half-year or a fiscal year has no previous quarter.
  if(valid("growth") && !Number.isFinite(c.quarterRevenueGrowth) && !c.periodMonths && Number.isFinite(c.quarterRevenueQoq) && c.quarterRevenueQoq!==0) {
    const growth=c.quarterRevenueQoq!, pct=`${growth>0?"+":""}${growth.toFixed(1)}%`;
    add("revenue-qoq",growth>0?"strength":"weakness",copy(`売上前四半期比 ${pct}`,`Revenue ${pct} QoQ`),
      copy(`売上高は前の四半期から${pct}。前年同期の売上がないため、前の四半期と比べています。季節による増減を含みます。`,
        `Revenue changed ${pct} from the previous quarter. There is no revenue a year earlier, so it is compared with the quarter before; seasonal swings are included.`));
  }
  if(valid("profitability") && c.quarterOperatingIncome && c.quarterOperatingMargin!==null && (c.quarterOperatingMargin>=15 || c.quarterOperatingMargin<0)) {
    const margin=c.quarterOperatingMargin, pct=`${margin.toFixed(1)}%`;
    add("operating-margin",margin<0?"weakness":"strength",
      copy(margin<0?`営業赤字 ${pct}`:`営業利益率 ${pct}`,margin<0?`Operating loss ${pct}`:`Operating margin ${pct}`),
      copy(`${span.ja}の営業損益は${amount(c.quarterOperatingIncome.value,c.quarterOperatingIncome.unit)}。売上高に対する割合は${pct}。`,
        `${span.en} operating income was ${amount(c.quarterOperatingIncome.value,c.quarterOperatingIncome.unit)}, representing ${pct} of revenue.`));
  }
  if(valid("growth") && Number.isFinite(c.quarterDilutedSharesGrowth) && c.quarterDilutedSharesGrowth!>5) {
    const pct=`+${c.quarterDilutedSharesGrowth!.toFixed(1)}%`;
    add("share-count","weakness",copy(`平均株式数 ${pct}`,`Average shares ${pct}`),
      copy(`希薄化後の平均株式数は前年同期比${pct}。発行済株式数や新株発行数そのものとは異なります。`,
        `Diluted weighted-average shares increased ${pct} year over year. This is not the period-end shares outstanding or the number of newly issued shares.`));
  }
  if(valid("cash") && Number.isFinite(c.quarterFcfMargin) && c.quarterFcfMargin!==0) {
    const positive=c.quarterFcfMargin!>0, pct=`${c.quarterFcfMargin!.toFixed(1)}%`;
    add("cash-generation",positive?"strength":"weakness",copy(`簡易FCF率 ${pct}`,`Simple FCF margin ${pct}`),
      copy(`${span.ja}の営業キャッシュフローから現金支出の設備投資を引いた金額は、売上高の${pct}。買収支出やリース等は網羅しません。`,
        `${span.en} operating cash flow less cash capital expenditure equaled ${pct} of revenue. This measure does not capture all acquisitions or leases.`));
  }
  appendFilingFinancialItems(items,c,now);
  appendEquityItem(items,c);
  return {version:1,method:"deterministic",sourceRevision:comparisonEvidenceRevision(c),preparedAt:new Date(now).toISOString(),
    processingMs:Math.round((performance.now()-started)*1000)/1000,periodEnd:q.end,sourceUrl:c.quarterSourceUrl,items};
}
/** Financial strength scored from the filing's own balance (current ratio, cash against debt): the same thresholds and the same words as when
 * the provider's statistics score it (appendMarketItems). Before, only the provider's score could become a point, so a weak balance read from
 * the filing (MO: current ratio 0.58, debt 24.1 billion against cash 2.7 billion; BTI 0.84) left both companies with no weakness (Nov 19).
 * "Debt exceeds cash" follows the provider's rule too (debt larger than cash on a scored balance), except beside a financial-strength point
 * (score 7 or more), which it would contradict. Before, it needed a score of 3 or less, so a middling balance such as PEP's (score 3.4, debt
 * 51.9 billion against cash 10.7 billion) gave no weakness at all while the provider's figures would have said it (all-ticker audit, Nov 19).
 * Also used when a provider-sourced company scores its balance from the filing (comparison-server.ts). */
export function appendFilingFinancialItems(items:PreparedComparisonAnalysis["items"],c:Financials,now=Date.now()) {
  const q=balanceAnchor(c);
  const financial=comparisonScores(c,now).find(s=>s.id==="financial")?.value ?? null;
  const providerFinancial=c.twelveData ? twelveExtraFactors(c.twelveData,now).financial : null;
  if(!q || providerFinancial!==null || financial===null || items.some(i=>i.id==="financial" || i.id==="debt-cash")) return items;
  if(financial<=3 || financial>=7) items.push({id:"financial",kind:financial>=7?"strength":"weakness",short:copy(comparisonMetric(c,"financial","ja",now),comparisonMetric(c,"financial","en",now)),detail:twelveFactorMethods.financial});
  const debt=balanceDebt(c), cash=c.balance?.cash?.value;
  if(financial<7 && debt!==null && cash!==undefined && debt>cash) items.push(debtCashItem(q.end,cash,debt,q.unit));
  return items;
}
/** Negative shareholders' equity, read from the filing's balance for the very period shown (MO: liabilities above assets after years of
 * buybacks, Nov 20). Only a reported figure counts: equity that is missing, from another date or in another currency says nothing. */
export function appendEquityItem(items:PreparedComparisonAnalysis["items"],c:Financials) {
  const q=balanceAnchor(c), equity=c.balance?.equity;
  if(!q || !equity || c.balance!.end!==q.end || equity.end!==q.end || equity.unit!==q.unit || !(equity.value<0) || items.some(i=>i.id==="negative-equity")) return items;
  items.push({id:"negative-equity",kind:"weakness",short:copy("株主資本がマイナス","Negative shareholders' equity"),
    detail:copy(`${equity.end}時点の株主資本は${amount(equity.value,equity.unit)}で、負債が資産を上回っています。自社株買いや累積損失など、原因はこの数値だけでは特定できません。`,
      `Shareholders' equity was ${amount(equity.value,equity.unit)} as of ${equity.end}: liabilities exceed assets. This figure alone does not establish the cause, such as buybacks or accumulated losses.`)});
  return items;
}
/** The period a balance point is dated and priced in: the quarter shown, or for a company with no revenue yet its latest balance sheet. */
function balanceAnchor(c:Financials):{end:string;unit:string}|null {
  if(c.quarterRevenue) return c.quarterRevenue;
  const unit=c.balance?.cash?.unit ?? c.balance?.equity?.unit;
  return c.preRevenue && c.balance && unit ? {end:c.balance.end,unit} : null;
}
/** A company with no revenue yet (owner, Nov 26): the points its latest balance sheet gives (financial strength, debt against cash,
 *  negative equity). The revenue factors have none to give. */
export function preparePreRevenueAnalysis(c:Financials,now=Date.now()):PreparedComparisonAnalysis|undefined {
  if(!c.preRevenue || !c.balance || !hasRecentBalance(c,now)) return undefined;
  const items=appendEquityItem(appendFilingFinancialItems([],c,now),c);
  return {version:1,method:"deterministic",sourceRevision:comparisonEvidenceRevision(c),preparedAt:new Date(now).toISOString(),processingMs:0,
    periodEnd:c.balance.end,sourceUrl:c.balance.sourceUrl,items};
}
/** "Debt exceeds cash", from the provider's statistics or the filing's own balance, in the same words. */
export function debtCashItem(periodEnd:string,cash:number,debt:number,currency:string):PreparedComparisonAnalysis["items"][number] {
  return {id:"debt-cash",kind:"weakness",short:copy("有利子負債が現金を上回る","Debt exceeds cash"),
    detail:copy(`${periodEnd}時点の現金は${cash} ${currency}、有利子負債は${debt} ${currency}。返済期限・借換余力は別途確認が必要で、これだけで資金繰り難とは判断しません。`,
      `Cash was ${cash} ${currency} versus debt of ${debt} ${currency} as of ${periodEnd}. Maturities and refinancing capacity require separate review; this alone does not establish liquidity distress.`)};
}
/** Reuse only the saved analysis matching this exact evidence and a usable quarter. */
export function currentComparisonAnalysis(c: Financials, now=Date.now()) {
  const saved=c.preparedAnalysis;
  if(!saved || !(hasRecentQuarter(c,now) || hasRecentBalance(c,now)) || saved.version!==1 || saved.sourceRevision!==comparisonEvidenceRevision(c)
    || !Number.isFinite(Date.parse(saved.preparedAt)) || Date.parse(saved.preparedAt)>now
    || !comparisonScores(c,now).some(s=>s.value!==null)) return undefined;
  if(c.twelveData) {
    const scores=comparisonScores(c,now);
    const marketIds=["financial","valuation","stability","momentum"];
    return {...saved,items:saved.items.filter(item=>!marketIds.includes(item.id) && !["debt-cash","margin-decline"].includes(item.id) || scores.some(s=>s.id===(item.id==="debt-cash"?"financial":item.id==="margin-decline"?"stability":item.id) && s.value!==null))};
  }
  return saved;
}
