import { createHash } from "node:crypto";
import type { Financials } from "./comparison.ts";
import { comparisonScores, hasRecentQuarter } from "./comparison-scorecard.ts";

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
  if(valid("growth") && prior && c.quarterRevenueGrowth!==null && c.quarterRevenueGrowth!==0) {
    const growth=c.quarterRevenueGrowth, pct=`${growth>0?"+":""}${growth.toFixed(1)}%`;
    add("revenue-growth",growth>0?"strength":"weakness",
      copy(`${growth>0?"売上成長":"売上減少"} ${pct}`,`Revenue ${growth>0?"growth":"decline"} ${pct}`),
      copy(`売上高は前年同期の${amount(prior.value,prior.unit)}から${amount(q.value,q.unit)}へ。前年同期比${pct}。`,
        `Revenue changed from ${amount(prior.value,prior.unit)} in the prior-year quarter to ${amount(q.value,q.unit)}, ${pct} year over year.`));
  }
  if(valid("profitability") && c.quarterOperatingIncome && c.quarterOperatingMargin!==null && (c.quarterOperatingMargin>=15 || c.quarterOperatingMargin<0)) {
    const margin=c.quarterOperatingMargin, pct=`${margin.toFixed(1)}%`;
    add("operating-margin",margin<0?"weakness":"strength",
      copy(margin<0?`営業赤字（利益率 ${pct}）`:`営業利益率 ${pct}`,margin<0?`Operating loss (${pct} margin)`:`Operating margin ${pct}`),
      copy(`四半期の営業損益は${amount(c.quarterOperatingIncome.value,c.quarterOperatingIncome.unit)}。売上高に対する割合は${pct}。`,
        `Quarterly operating income was ${amount(c.quarterOperatingIncome.value,c.quarterOperatingIncome.unit)}, representing ${pct} of revenue.`));
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
      copy(`四半期の営業キャッシュフローから現金支出の設備投資を引いた金額は、売上高の${pct}。買収支出やリース等は網羅しません。`,
        `Quarterly operating cash flow less cash capital expenditure equaled ${pct} of revenue. This measure does not capture all acquisitions or leases.`));
  }
  return {version:1,method:"deterministic",sourceRevision:comparisonEvidenceRevision(c),preparedAt:new Date(now).toISOString(),
    processingMs:Math.round((performance.now()-started)*1000)/1000,periodEnd:q.end,sourceUrl:c.quarterSourceUrl,items};
}
/** Reuse only the saved analysis matching this exact evidence and a usable quarter. */
export function currentComparisonAnalysis(c: Financials, now=Date.now()) {
  const saved=c.preparedAnalysis;
  if(!saved || !hasRecentQuarter(c,now) || saved.version!==1 || saved.sourceRevision!==comparisonEvidenceRevision(c)
    || !Number.isFinite(Date.parse(saved.preparedAt)) || Date.parse(saved.preparedAt)>now
    || !comparisonScores(c,now).some(s=>s.value!==null)) return undefined;
  if(c.twelveData) {
    const scores=comparisonScores(c,now);
    const marketIds=["financial","valuation","stability","momentum"];
    return {...saved,items:saved.items.filter(item=>!marketIds.includes(item.id) && !["debt-cash","margin-decline"].includes(item.id) || scores.some(s=>s.id===(item.id==="debt-cash"?"financial":item.id==="margin-decline"?"stability":item.id) && s.value!==null))};
  }
  return saved;
}
