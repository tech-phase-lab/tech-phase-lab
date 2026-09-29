import type { Copy } from "./data";
export type ComparisonCompany = { ticker: string; name: string; peer: string; caution: Copy };
export type Fact = { value: number; unit: string; start: string | null; end: string; filed: string; accession: string; tag: string; basis: string };
export type Financials = {
  ticker: string; status: "ready" | "unavailable" | "unsupported"; retrievedAt: string;
  revenue: Fact | null; previousRevenue: Fact | null; operatingIncome: Fact | null;
  operatingCash: Fact | null; capex: Fact | null; cash: Fact | null;
  revenueGrowth: number | null; operatingMargin: number | null; fcfMargin: number | null;
  sourceUrl: string | null;
};
export type ComparisonResult = { companies: (ComparisonCompany & Financials)[]; comparable: boolean; reasons: Copy[]; conclusion: Copy; generatedAt: string };
const copy = (ja: string, en: string): Copy => ({ ja, en });
const obj = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const day = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(s) / 86400000 : NaN;
const duration = (f: Fact) => f.start ? day(f.end) - day(f.start) + 1 : 0;
export function emptyFinancials(ticker: string, status: "unavailable" | "unsupported", now = new Date().toISOString()): Financials {
  return { ticker, status, retrievedAt: now, revenue: null, previousRevenue: null, operatingIncome: null, operatingCash: null, capex: null, cash: null, revenueGrowth: null, operatingMargin: null, fcfMargin: null, sourceUrl: null };
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
  "us-gaap": { revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"], operatingIncome: ["OperatingIncomeLoss"], operatingCash: ["NetCashProvidedByUsedInOperatingActivities"], capex: ["PaymentsToAcquirePropertyPlantAndEquipment"], cash: ["CashAndCashEquivalentsAtCarryingValue"] },
  "ifrs-full": { revenue: ["Revenue"], operatingIncome: ["ProfitLossFromOperatingActivities"], operatingCash: ["CashFlowsFromUsedInOperatingActivities"], capex: ["PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"], cash: ["CashAndCashEquivalents"] },
} as const;
/** Annual, consolidated standard facts only; never combine quarterly/YTD facts or currencies. */
export function extractFinancials(ticker: string, cik: string, payload: unknown, now = Date.now()): Financials {
  const result = emptyFinancials(ticker, "unsupported", new Date(now).toISOString());
  const root = obj(payload);
  if (Number(root.cik) !== Number(cik)) return result;
  const facts = obj(root.facts);
  function collect(basis: keyof typeof tags, names: readonly string[], instant = false): Fact[] {
    return names.flatMap(tag => Object.entries(obj(obj(obj(facts[basis])[tag]).units)).flatMap(([unit, values]) => {
      if (!/^[A-Z]{3}$/.test(unit) || !Array.isArray(values)) return [];
      return values.flatMap(raw => {
        const f = obj(raw);
        if (typeof f.val !== "number" || !Number.isFinite(f.val) || typeof f.end !== "string" || typeof f.filed !== "string" || typeof f.accn !== "string" || !/^\d{10}-\d{2}-\d{6}$/.test(f.accn) || !["10-K", "10-K/A", "20-F", "20-F/A"].includes(String(f.form))) return [];
        if (!Number.isFinite(day(f.end)) || !Number.isFinite(day(f.filed)) || day(f.filed) > now / 86400000 || day(f.end) > day(f.filed)) return [];
        const fact: Fact = { value: f.val, unit, start: typeof f.start === "string" ? f.start : null, end: f.end, filed: f.filed, accession: f.accn, tag, basis };
        if (instant ? fact.start !== null : duration(fact) < 350 || duration(fact) > 380 || !Number.isFinite(duration(fact))) return [];
        return [fact];
      });
    }));
  }
  const revenues = (Object.keys(tags) as (keyof typeof tags)[]).flatMap(b => collect(b, tags[b].revenue))
    .filter(f => f.value > 0).sort((a,b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
  const candidate = revenues[0];
  if (!candidate) return result;
  // Ambiguous reporting currency/accounting basis is not guessed.
  const sameDate = revenues.filter(f => f.end === candidate.end && f.filed === candidate.filed);
  if (new Set(sameDate.map(f => `${f.unit}/${f.basis}`)).size !== 1 || new Set(sameDate.map(f => f.value)).size !== 1) return result;
  const revenue = candidate;
  const basis = revenue.basis as keyof typeof tags;
  const samePeriod = (f: Fact) => f.unit === revenue.unit && f.end === revenue.end && f.start === revenue.start && f.accession === revenue.accession;
  function metric(key: "operatingIncome" | "operatingCash" | "capex" | "cash") {
    const values = collect(basis, tags[basis][key], key === "cash").filter(f => key === "cash" ? f.unit === revenue.unit && f.end === revenue.end && f.accession === revenue.accession : samePeriod(f));
    return values.length && new Set(values.map(f => f.value)).size === 1 ? values[0] : null;
  }
  // Compare the prior year restated in the SAME filing/tag, not a stale pre-restatement filing.
  const prior = revenues.filter(f => f.tag === revenue.tag && f.basis === revenue.basis && f.unit === revenue.unit && f.accession === revenue.accession && day(revenue.end)-day(f.end) >= 350 && day(revenue.end)-day(f.end) <= 380 && Math.abs(duration(f)-duration(revenue)) <= 8);
  const previousRevenue = prior.length && new Set(prior.map(f => `${f.end}/${f.value}`)).size === 1 ? prior[0] : null;
  const operatingIncome = metric("operatingIncome"), operatingCash = metric("operatingCash"), capexRaw = metric("capex"), cash = metric("cash");
  const capex = capexRaw && capexRaw.value >= 0 ? capexRaw : null;
  return { ...result, status: "ready", revenue, previousRevenue, operatingIncome, operatingCash, capex, cash,
    revenueGrowth: previousRevenue ? (revenue.value / previousRevenue.value - 1) * 100 : null,
    operatingMargin: operatingIncome ? operatingIncome.value / revenue.value * 100 : null,
    fcfMargin: operatingCash && capex ? (operatingCash.value-capex.value) / revenue.value * 100 : null,
    sourceUrl: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${revenue.accession.replaceAll("-", "")}/${revenue.accession}-index.htm` };
}
export function buildComparison(companies: ComparisonResult["companies"], now = Date.now()): ComparisonResult {
  const reasons: Copy[] = [];
  if (companies.length < 2 || companies.length > 3) throw Error("invalid-company-count");
  if (companies.some(c => c.status !== "ready" || !c.revenue)) reasons.push(copy("一部の会社は比較可能な年次開示を取得できていません。", "Comparable annual filings are missing for some companies."));
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
