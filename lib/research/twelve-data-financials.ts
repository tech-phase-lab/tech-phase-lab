import { emptyFinancials, type Fact, type Financials } from "./comparison.ts";
import { comparisonScores } from "./comparison-scorecard.ts";
import { prepareComparisonAnalysis, comparisonEvidenceRevision } from "./comparison-analysis.ts";
import { normalizeTwelveComparison, prepareTwelveComparison } from "./twelve-data-comparison.ts";
import { normalizeTwelveFactors, twelveExtraFactors, twelveFactorMetric, twelveFactorMethods } from "./twelve-data-factors.ts";

export type TwelveComparisonBundle = {
  ticker:string; retrievedAt:string; income:unknown; cashFlow?:unknown;
  statistics?:{payload:unknown;retrievedAt:string};
  series?:{payload:unknown;adjust:"splits";retrievedAt:string};
  accountingBasis?:"us-gaap"|"ifrs-full";
};
/** Production response shape, consumed by the existing radar/bars/cards without a redesign.
 * Does not send requests or mutate provider data. No forged SEC accession or release date.
 */
export function buildTwelveFinancials(bundle:TwelveComparisonBundle,now=Date.now()):Financials {
  const retrieved=Date.parse(bundle.retrievedAt);
  if(!Number.isFinite(retrieved) || retrieved>now)throw Error("invalid-twelve-retrieval-time");
  const s=normalizeTwelveComparison(bundle.ticker,bundle.income,bundle.cashFlow??null,retrieved);
  const evidence=normalizeTwelveFactors(s,bundle.income,bundle.statistics,bundle.series,now);
  const sourceUrl="https://twelvedata.com/";
  const fact=(value:number|null,tag:string,end=s.periodEnd):Fact|null=>value===null ? null : ({value,unit:s.currency,
    start:null,end,filed:null,accession:null,tag,basis:bundle.accountingBasis??"twelve-standardized"});
  const result:Financials={...emptyFinancials(bundle.ticker,"unavailable",bundle.retrievedAt),
    status:"ready",twelveData:evidence,quarterRevenue:fact(s.revenue,"sales"),
    previousQuarterRevenue:s.previousPeriodEnd ? fact(s.previousRevenue,"sales",s.previousPeriodEnd) : null,
    quarterOperatingIncome:fact(s.operatingIncome,"operating_income"),
    quarterRevenueGrowth:s.revenueGrowthPct,quarterOperatingMargin:s.operatingMarginPct,
    quarterFcfMargin:s.freeCashFlowMarginPct,quarterSourceUrl:sourceUrl};
  const prepared=prepareComparisonAnalysis(result,now);
  if(prepared) {
    // The provider's quarter dates have no start dates; use explicit quarter-ended descriptions.
    const base=prepareTwelveComparison(s,undefined,now);
    const extras=twelveExtraFactors(evidence,now);
    prepared.items=base.items;
    for(const id of ["financial","valuation","stability","momentum"] as const) {
      const value=extras[id];
      if(value===null || value>3 && value<7)continue;
      const ja=twelveFactorMetric(evidence,id,"ja",now)!,en=twelveFactorMetric(evidence,id,"en",now)!;
      prepared.items.push({id,kind:value>=7?"strength":"weakness",short:{ja,en},detail:twelveFactorMethods[id]});
    }
    const addRisk=(id:string,ja:string,en:string,detailJa:string,detailEn:string)=>{
      prepared.items=prepared.items.filter(item=>item.id!==id);
      prepared.items.push({id,kind:"weakness",short:{ja,en},detail:{ja:detailJa,en:detailEn}});
    };
    const margins=evidence.margins;
    if(extras.stability!==null && margins.length===4 && margins[0].value<margins[1].value-0.1) {
      const a=margins[1].value.toFixed(1),b=margins[0].value.toFixed(1);
      addRisk("margin-decline",`営業利益率 ${a}→${b}%`,`Operating margin ${a}→${b}%`,
        `${margins[1].periodEnd}期から${margins[0].periodEnd}期に営業利益率が低下。原因はこの数値だけでは特定できません。`,
        `Operating margin declined from the quarter ended ${margins[1].periodEnd} to ${margins[0].periodEnd}. These figures alone do not establish the cause.`);
    }
    const stats=evidence.statistics;
    if(extras.financial!==null && stats && stats.totalDebt!>stats.totalCash!) {
      addRisk("debt-cash","有利子負債が現金を上回る","Debt exceeds cash",
        `${s.periodEnd}時点の現金は${stats.totalCash} ${s.currency}、有利子負債は${stats.totalDebt} ${s.currency}。返済期限・借換余力は別途確認が必要で、これだけで資金繰り難とは判断しません。`,
        `Cash was ${stats.totalCash} ${s.currency} versus debt of ${stats.totalDebt} ${s.currency} as of ${s.periodEnd}. Maturities and refinancing capacity require separate review; this alone does not establish liquidity distress.`);
    }
    if(extras.momentum!==null && evidence.momentum!.changePct<0) {
      const pct=evidence.momentum!.changePct.toFixed(1);
      addRisk("momentum",`約3か月の株価 ${pct}%`,`~3-month price return ${pct}%`,
        `${evidence.momentum!.from}〜${evidence.momentum!.to}の分割調整済み株価が${pct}%。将来の下落を予測するものではありません。`,
        `Split-adjusted price return from ${evidence.momentum!.from} to ${evidence.momentum!.to} was ${pct}%. This does not predict future declines.`);
    }
    prepared.sourceRevision=comparisonEvidenceRevision(result);
    result.preparedAnalysis=prepared;
  }
  return result;
}
export function prepareTwelveDisplay(bundle:TwelveComparisonBundle,now=Date.now()) {
  const financials=buildTwelveFinancials(bundle,now);
  return {version:1 as const,financials,scores:comparisonScores(financials,now),preparedAt:new Date(now).toISOString()};
}
