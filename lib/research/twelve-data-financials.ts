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
    prepared.sourceRevision=comparisonEvidenceRevision(result);
    result.preparedAnalysis=prepared;
  }
  return result;
}
export function prepareTwelveDisplay(bundle:TwelveComparisonBundle,now=Date.now()) {
  const financials=buildTwelveFinancials(bundle,now);
  return {version:1 as const,financials,scores:comparisonScores(financials,now),preparedAt:new Date(now).toISOString()};
}
