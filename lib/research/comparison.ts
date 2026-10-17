import type { PreparedComparisonAnalysis } from "./comparison-analysis";
import type { Copy } from "./data";
export type ComparisonCompany = { ticker: string; name: string; peer: string; caution: Copy };
export type Fact = { value: number; unit: string; start: string | null; end: string; filed: string | null; accession: string | null; tag: string; basis: string };
export type BalanceSnapshot = {
  end: string; sourceUrl: string; filed: string | null;
  cash: Fact | null; currentAssets: Fact | null; currentLiabilities: Fact | null;
  currentRatio: number | null; debtCurrent: Fact | null; debtNoncurrent: Fact | null;
  shortBorrowings: Fact | null; leaseCurrent: Fact | null; leaseNoncurrent: Fact | null;
};
export type Financials = {
  twelveData?: import("./twelve-data-factors").TwelveFactorEvidence;
  referenceEvaluation?: import("./comparison-reference").ReferenceEvaluation;
  ticker: string; status: "ready" | "unavailable" | "unsupported"; retrievedAt: string;
  dataWarnings?: Copy[];
  preparedAnalysis?: PreparedComparisonAnalysis;
  revenue: Fact | null; previousRevenue: Fact | null; operatingIncome: Fact | null;
  operatingCash: Fact | null; capex: Fact | null; cash: Fact | null;
  revenueGrowth: number | null; operatingMargin: number | null; fcfMargin: number | null;
  stockCompensation: Fact | null; stockCompensationRatio: number | null;
  dilutedShares: Fact | null; previousDilutedShares: Fact | null; dilutedSharesGrowth: number | null;
  quarterRevenue: Fact | null; previousQuarterRevenue: Fact | null; quarterOperatingIncome: Fact | null;
  quarterRevenueGrowth: number | null; quarterOperatingMargin: number | null; quarterSourceUrl: string | null;
  quarterFcfMargin?: number | null; quarterStockCompensationRatio?: number | null; quarterDilutedSharesGrowth?: number | null;
  balance: BalanceSnapshot | null;
  sourceUrl: string | null;
};
export type ComparisonResult = { trial?: {id:string;description:Copy;notes:Copy}; companies: (ComparisonCompany & Financials)[]; comparable: boolean; reasons: Copy[]; conclusion: Copy; generatedAt: string };
const copy = (ja: string, en: string): Copy => ({ ja, en });
const obj = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const day = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(s) / 86400000 : NaN;
const duration = (f: Fact) => f.start ? day(f.end) - day(f.start) + 1 : 0;
export function emptyFinancials(ticker: string, status: "unavailable" | "unsupported", now = new Date().toISOString()): Financials {
  return { ticker, status, retrievedAt: now, revenue: null, previousRevenue: null, operatingIncome: null, operatingCash: null, capex: null, cash: null, revenueGrowth: null, operatingMargin: null, fcfMargin: null, stockCompensation: null, stockCompensationRatio: null, dilutedShares: null, previousDilutedShares: null, dilutedSharesGrowth: null,
    quarterRevenue: null, previousQuarterRevenue: null, quarterOperatingIncome: null, quarterRevenueGrowth: null, quarterOperatingMargin: null, quarterSourceUrl: null, balance: null, sourceUrl: null };
}
export function validateComparisonTickers(value: unknown, allowed: readonly string[]): string[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 3 || value.some(x => typeof x !== "string")) return null;
  const tickers = value.map(x => (x as string).trim().toUpperCase());
  return new Set(tickers).size === tickers.length && tickers.every(x => allowed.includes(x)) ? tickers : null;
}
export function comparisonAccess(member: { status: string; plan: string; accessExpiresAt?: number }, now = Date.now()): 200 | 401 | 403 | 503 {
  if (member.status === "unavailable") return 503;
  if (member.status !== "signed-in") return 401;
  return member.plan === "pro" && Number.isFinite(member.accessExpiresAt) && member.accessExpiresAt! > now ? 200 : 403;
}
const tags = {
  "us-gaap": { revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"], operatingIncome: ["OperatingIncomeLoss"], operatingCash: ["NetCashProvidedByUsedInOperatingActivities"], capex: ["PaymentsToAcquirePropertyPlantAndEquipment"], cash: ["CashAndCashEquivalentsAtCarryingValue"], stockCompensation: ["ShareBasedCompensation"], dilutedShares: ["WeightedAverageNumberOfDilutedSharesOutstanding"] },
  "ifrs-full": { revenue: ["Revenue", "RevenueFromContractsWithCustomers"], operatingIncome: ["ProfitLossFromOperatingActivities"], operatingCash: ["CashFlowsFromUsedInOperatingActivities"], capex: ["PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"], cash: ["CashAndCashEquivalents"], stockCompensation: [], dilutedShares: [] },
} as const;
/** Standard consolidated facts. Annual and standalone-quarter periods remain separate. */
export function extractFinancials(ticker: string, cik: string, payload: unknown, now = Date.now(), reportingCurrency?: string, primaryRevenueTag?: string): Financials {
  const result = emptyFinancials(ticker, "unsupported", new Date(now).toISOString());
  const root = obj(payload);
  if (Number(root.cik) !== Number(cik)) return result;
  const facts = obj(root.facts);
  function collect(basis: keyof typeof tags, names: readonly string[], instant = false, period: "annual" | "quarter" = "annual", shares = false): (Fact & {filed:string;accession:string})[] {
    return names.flatMap(tag => Object.entries(obj(obj(obj(facts[basis])[tag]).units)).flatMap(([unit, values]) => {
      if ((shares ? unit !== "shares" : !/^[A-Z]{3}$/.test(unit)) || !Array.isArray(values)) return [];
      return values.flatMap(raw => {
        const f = obj(raw);
        if (typeof f.val !== "number" || !Number.isFinite(f.val) || typeof f.end !== "string" || typeof f.filed !== "string" || typeof f.accn !== "string" || !/^\d{10}-\d{2}-\d{6}$/.test(f.accn) || !(period === "quarter" ? ["10-Q", "10-Q/A", "6-K", "6-K/A", "8-K", "8-K/A"] : ["10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"]).includes(String(f.form))) return [];
        if (!Number.isFinite(day(f.end)) || !Number.isFinite(day(f.filed)) || day(f.filed) > now / 86400000 || day(f.end) > day(f.filed)) return [];
        const fact: Fact & {filed:string;accession:string} = { value: f.val, unit, start: typeof f.start === "string" ? f.start : null, end: f.end, filed: f.filed, accession: f.accn, tag, basis };
        if (instant ? fact.start !== null : duration(fact) < (period === "quarter" ? 75 : 350) || duration(fact) > (period === "quarter" ? 105 : 380) || !Number.isFinite(duration(fact))) return [];
        return [fact];
      });
    }));
  }
  const revenues = (Object.keys(tags) as (keyof typeof tags)[]).flatMap(b => collect(b, tags[b].revenue))
    .filter(f => f.value > 0 && (!primaryRevenueTag || `${f.basis}:${f.tag}` === primaryRevenueTag)).sort((a,b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
  const latest = revenues[0];
  if (!latest) return result;
  // A verified reporting currency distinguishes native values from convenience
  // translations. Never fall back to an older year if the latest lacks it.
  const sameDate = revenues.filter(f => f.end === latest.end && f.filed === latest.filed && (!reportingCurrency || f.unit === reportingCurrency));
  const candidate = sameDate[0];
  if (!candidate) return result;
  // Ambiguous accounting basis or conflicting native values are still held.
  if (new Set(sameDate.map(f => `${f.unit}/${f.basis}`)).size !== 1 || new Set(sameDate.map(f => f.value)).size !== 1) return result;
  const revenue = candidate;
  const basis = revenue.basis as keyof typeof tags;
  const samePeriod = (f: Fact) => f.unit === revenue.unit && f.end === revenue.end && f.start === revenue.start && f.accession === revenue.accession;
  function metric(key: "operatingIncome" | "operatingCash" | "capex" | "cash" | "stockCompensation") {
    const values = collect(basis, tags[basis][key], key === "cash").filter(f => key === "cash" ? f.unit === revenue.unit && f.end === revenue.end && f.accession === revenue.accession : samePeriod(f));
    return values.length && new Set(values.map(f => f.value)).size === 1 ? values[0] : null;
  }
  // Compare the prior year restated in the SAME filing/tag, not a stale pre-restatement filing.
  const prior = revenues.filter(f => f.tag === revenue.tag && f.basis === revenue.basis && f.unit === revenue.unit && f.accession === revenue.accession && day(revenue.end)-day(f.end) >= 350 && day(revenue.end)-day(f.end) <= 380 && Math.abs(duration(f)-duration(revenue)) <= 8);
  const previousRevenue = prior.length && new Set(prior.map(f => `${f.end}/${f.value}`)).size === 1 ? prior[0] : null;
  const operatingIncome = metric("operatingIncome"), operatingCash = metric("operatingCash"), capexRaw = metric("capex"), cash = metric("cash");
  const capex = capexRaw && capexRaw.value >= 0 ? capexRaw : null;
  const stockCompensationRaw = metric("stockCompensation");
  const stockCompensation = stockCompensationRaw && stockCompensationRaw.value >= 0 ? stockCompensationRaw : null;
  const unique = (values: Fact[]) => values.length && new Set(values.map(f => `${f.start}/${f.end}/${f.value}/${f.unit}`)).size === 1 ? values[0] : null;
  const shares = collect(basis, tags[basis].dilutedShares, false, "annual", true).filter(f => f.accession === revenue.accession && f.value > 0);
  const dilutedShares = unique(shares.filter(f => f.start === revenue.start && f.end === revenue.end));
  const previousDilutedShares = dilutedShares && previousRevenue ? unique(shares.filter(f => f.start === previousRevenue.start && f.end === previousRevenue.end && f.tag === dilutedShares.tag)) : null;
  // Only a directly reported standalone quarter AFTER the annual period. Never treat YTD as a quarter.
  const quarters = collect(basis, tags[basis].revenue, false, "quarter").filter(f => f.end > revenue.end && f.unit === revenue.unit && f.value > 0 && (!primaryRevenueTag || `${f.basis}:${f.tag}` === primaryRevenueTag)).sort((a,b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
  const latestQuarter = quarters[0];
  const quarterRevenue = latestQuarter ? unique(quarters.filter(f => f.end === latestQuarter.end && f.filed === latestQuarter.filed)) : null;
  const previousQuarterRevenue = quarterRevenue ? unique(collect(basis, [quarterRevenue.tag], false, "quarter").filter(f => f.accession === quarterRevenue.accession && f.unit === quarterRevenue.unit && day(quarterRevenue.end)-day(f.end) >= 350 && day(quarterRevenue.end)-day(f.end) <= 380 && Math.abs(duration(quarterRevenue)-duration(f)) <= 8 && f.value > 0)) : null;
  const quarterOperatingIncome = quarterRevenue ? unique(collect(basis, tags[basis].operatingIncome, false, "quarter").filter(f => f.accession === quarterRevenue.accession && f.unit === quarterRevenue.unit && f.start === quarterRevenue.start && f.end === quarterRevenue.end)) : null;
  const quarterMetric = (key: "operatingCash" | "capex" | "stockCompensation") => quarterRevenue ? unique(collect(basis,tags[basis][key],false,"quarter").filter(f => f.accession===quarterRevenue.accession && f.unit===quarterRevenue.unit && f.start===quarterRevenue.start && f.end===quarterRevenue.end)) : null;
  const quarterOperatingCash=quarterMetric("operatingCash"), quarterCapex=quarterMetric("capex"), quarterCompensation=quarterMetric("stockCompensation");
  const quarterShares = quarterRevenue ? unique(collect(basis,tags[basis].dilutedShares,false,"quarter",true).filter(f=>f.accession===quarterRevenue.accession && f.start===quarterRevenue.start && f.end===quarterRevenue.end && f.value>0)) : null;
  const previousQuarterShares = quarterShares && previousQuarterRevenue ? unique(collect(basis,[quarterShares.tag],false,"quarter",true).filter(f=>f.accession===quarterShares.accession && f.start===previousQuarterRevenue.start && f.end===previousQuarterRevenue.end && f.value>0)) : null;
  const filingUrl = (f: Fact) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accession!.replaceAll("-", "")}/${f.accession}-index.htm`;
  // A single filing/date/currency for the entire balance snapshot. No fallback to older components.
  const balanceTags = basis === "us-gaap" ? ["CashAndCashEquivalentsAtCarryingValue", "AssetsCurrent", "LiabilitiesCurrent"] : ["CashAndCashEquivalents", "CurrentAssets", "CurrentLiabilities"];
  const quarterHasBalance = quarterRevenue && collect(basis,balanceTags,true,"quarter").some(f => f.end === quarterRevenue.end && f.accession === quarterRevenue.accession && f.unit === quarterRevenue.unit && f.value >= 0);
  const anchor = quarterHasBalance ? quarterRevenue! : revenue;
  const balancePeriod = quarterHasBalance ? "quarter" : "annual";
  function balanceMetric(name: string): Fact | null {
    const ifrsNames: Record<string, string> = { CashAndCashEquivalentsAtCarryingValue: "CashAndCashEquivalents", AssetsCurrent: "CurrentAssets", LiabilitiesCurrent: "CurrentLiabilities" };
    const tag = basis === "us-gaap" ? name : ifrsNames[name];
    if (!tag) return null;
    return unique(collect(basis, [tag], true, balancePeriod).filter(f => f.end === anchor.end && f.accession === anchor.accession && f.unit === anchor.unit && f.value >= 0));
  }
  const currentAssets = balanceMetric("AssetsCurrent"), currentLiabilities = balanceMetric("LiabilitiesCurrent");
  const balance: BalanceSnapshot = {
    end: anchor.end, filed: anchor.filed, sourceUrl: filingUrl(anchor),
    cash: balanceMetric("CashAndCashEquivalentsAtCarryingValue"), currentAssets, currentLiabilities,
    currentRatio: currentAssets && currentLiabilities && currentLiabilities.value > 0 ? currentAssets.value / currentLiabilities.value : null,
    debtCurrent: balanceMetric("LongTermDebtCurrent"), debtNoncurrent: balanceMetric("LongTermDebtNoncurrent"),
    shortBorrowings: balanceMetric("ShortTermBorrowings"), leaseCurrent: balanceMetric("OperatingLeaseLiabilityCurrent"), leaseNoncurrent: balanceMetric("OperatingLeaseLiabilityNoncurrent"),
  };
  return { ...result, status: "ready", balance, revenue, previousRevenue, operatingIncome, operatingCash, capex, cash,
    stockCompensation, stockCompensationRatio: stockCompensation ? stockCompensation.value / revenue.value * 100 : null,
    dilutedShares, previousDilutedShares, dilutedSharesGrowth: dilutedShares && previousDilutedShares ? (dilutedShares.value / previousDilutedShares.value - 1) * 100 : null,
    quarterRevenue, previousQuarterRevenue, quarterOperatingIncome,
    quarterRevenueGrowth: quarterRevenue && previousQuarterRevenue ? (quarterRevenue.value / previousQuarterRevenue.value - 1) * 100 : null,
    quarterOperatingMargin: quarterRevenue && quarterOperatingIncome ? quarterOperatingIncome.value / quarterRevenue.value * 100 : null,
    quarterSourceUrl: quarterRevenue ? filingUrl(quarterRevenue) : null,
    quarterFcfMargin: quarterRevenue && quarterOperatingCash && quarterCapex && quarterCapex.value>=0 ? (quarterOperatingCash.value-quarterCapex.value)/quarterRevenue.value*100 : null,
    quarterStockCompensationRatio: quarterRevenue && quarterCompensation && quarterCompensation.value>=0 ? quarterCompensation.value/quarterRevenue.value*100 : null,
    quarterDilutedSharesGrowth: quarterShares && previousQuarterShares ? (quarterShares.value/previousQuarterShares.value-1)*100 : null,
    revenueGrowth: previousRevenue ? (revenue.value / previousRevenue.value - 1) * 100 : null,
    operatingMargin: operatingIncome ? operatingIncome.value / revenue.value * 100 : null,
    fcfMargin: operatingCash && capex ? (operatingCash.value-capex.value) / revenue.value * 100 : null,
    sourceUrl: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${revenue.accession.replaceAll("-", "")}/${revenue.accession}-index.htm` };
}
export function buildComparison(companies: ComparisonResult["companies"], now = Date.now()): ComparisonResult {
  const reasons: Copy[] = [];
  if (companies.length < 2 || companies.length > 3) throw Error("invalid-company-count");
  if (companies.some(c => c.status !== "ready" || !c.revenue)) reasons.push(copy("一部の会社は比較可能な年次開示を取得できていません。", "Comparable annual filings are missing for some companies."));
  if (companies.some(c => c.dataWarnings?.length)) reasons.push(copy("新しい開示から未取得の数値があります。", "Some figures from newer filings are unavailable."));
  const revenues = companies.flatMap(c => c.revenue ? [c.revenue] : []);
  if (revenues.some(f => now / 86400000 - day(f.end) > 450)) reasons.push(copy("決算期末から450日超のデータが含まれます。最新性を確認するまで順位を付けません。", "Some fiscal year ends are over 450 days old. No ranking until freshness is verified."));
  if (new Set(companies.map(c => c.peer)).size > 1) reasons.push(copy("事業モデルが異なるため、単純な優劣は付けません。", "Different business models: no like-for-like ranking."));
  if (new Set(revenues.map(f => `${f.basis}/${f.unit}`)).size > 1) reasons.push(copy("会計基準・報告通貨が異なります。為替影響などの調整前は順位を付けません。", "Accounting bases or reporting currencies differ; adjustments are needed before ranking."));
  if (revenues.length && Math.max(...revenues.map(f => day(f.end))) - Math.min(...revenues.map(f => day(f.end))) > 100) reasons.push(copy("決算期末が100日超ずれており、異なる市場環境を含みます。", "Fiscal year ends differ by over 100 days and cover different market conditions."));
  if (revenues.length && Math.max(...revenues.map(duration)) - Math.min(...revenues.map(duration)) > 8) reasons.push(copy("集計期間の長さが異なります。", "Reporting period lengths differ."));
  const comparable = reasons.length === 0;
  let conclusion = copy("現時点で『どれが最も割安か』は判定保留です。下の実績比較と注意点から、違いを確認できます。", "The cheapest stock cannot be determined yet. Compare reported performance and caveats below.");
  if (comparable && companies.every(c => c.revenueGrowth !== null && Number.isFinite(c.revenueGrowth))) {
    const sorted = [...companies].sort((a,b) => b.revenueGrowth! - a.revenueGrowth!);
    if (sorted[0].revenueGrowth! - sorted[1].revenueGrowth! >= 0.1) {
      const top = sorted[0];
      conclusion = copy(`比較した年次実績では${top.ticker}の売上増減率が最も高い（${top.revenueGrowth!.toFixed(1)}%）。ただし、将来の成長力や割安さの順位ではありません。`, `${top.ticker} has the highest reported annual revenue change (${top.revenueGrowth!.toFixed(1)}%) in this comparison. This is not a ranking of future growth or value.`);
    }
  }
  return { companies, comparable, reasons, conclusion, generatedAt: new Date(now).toISOString() };
}
