import { isOwnerAccount } from "../membership/entitlements.ts";
import type { PreparedComparisonAnalysis } from "./comparison-analysis";
import type { Copy } from "./data";
export type ComparisonCompany = { ticker: string; name: string; peer: string; caution: Copy };
export type Fact = { value: number; unit: string; start: string | null; end: string; filed: string | null; accession: string | null; tag: string; basis: string;
  /** Set when the figure is not a reported value but the fiscal year minus the nine-month year-to-date (a fourth quarter has no filing of its own). */
  derived?: "fy-minus-9m" | "ytd-minus-prior-ytd" };
export type BalanceSnapshot = {
  end: string; sourceUrl: string; filed: string | null;
  cash: Fact | null; currentAssets: Fact | null; currentLiabilities: Fact | null;
  currentRatio: number | null; debtCurrent: Fact | null; debtNoncurrent: Fact | null;
  shortBorrowings: Fact | null; leaseCurrent: Fact | null; leaseNoncurrent: Fact | null;
  /** Interest-bearing debt at the same date from the same filing, however the company tags it (split current/noncurrent, one total, a carrying
   * amount, convertible notes). "none": the filing has no borrowing or notes figure at all (a debt-free company such as CRDO or ALAB), shown as
   * such. Null: tagged in a way that cannot be added up safely. Absent on older saved results. */
  debtTotal?: { value: number; source: "split" | "total" | "noncurrent" | "carrying" | "convertible" | "none" } | null;
};
export type Financials = {
  twelveData?: import("./twelve-data-factors").TwelveFactorEvidence;
  /** "ps": this comparison scores valuation on price-to-sales for every company, because one of them has no forward P/E. Set per comparison. */
  valuationBasis?: import("./twelve-data-factors").ValuationBasis;
  referenceEvaluation?: import("./comparison-reference").ReferenceEvaluation;
  ticker: string; status: "ready" | "unavailable" | "unsupported"; retrievedAt: string;
  dataWarnings?: Copy[];
  /** Set only for this answer (never cached): the provider was too busy this minute and no other source had the company. */
  busy?: true;
  preparedAnalysis?: PreparedComparisonAnalysis;
  revenue: Fact | null; previousRevenue: Fact | null; operatingIncome: Fact | null;
  operatingCash: Fact | null; capex: Fact | null; cash: Fact | null;
  revenueGrowth: number | null; operatingMargin: number | null; fcfMargin: number | null;
  stockCompensation: Fact | null; stockCompensationRatio: number | null;
  dilutedShares: Fact | null; previousDilutedShares: Fact | null; dilutedSharesGrowth: number | null;
  quarterRevenue: Fact | null; previousQuarterRevenue: Fact | null; quarterOperatingIncome: Fact | null;
  quarterRevenueGrowth: number | null; quarterOperatingMargin: number | null; quarterSourceUrl: string | null;
  /** Operating margin of the last four consecutive quarters, newest first (a fourth quarter is fiscal year minus nine months). Null unless all four are present. */
  quarterMargins?: { periodEnd: string; value: number }[] | null;
  /** Revenue of those same four consecutive quarters added up (for price-to-sales). Null unless all four are present. */
  quarterRevenueTtm?: number | null;
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
type ComparisonMember = { status: string; plan: string; accessExpiresAt?: number; userId?: string; ownerAccount?: boolean };
/** The membership object must come from the server's verified identity, never request parameters. */
const comparisonOwner = (member: ComparisonMember) => member.status === "signed-in" && member.ownerAccount === true && isOwnerAccount(member.userId);
export function comparisonExpiresAt(member: ComparisonMember, now = Date.now()): number {
  return comparisonOwner(member) ? now + 3_600_000 : Number.isFinite(member.accessExpiresAt) ? member.accessExpiresAt! : 0;
}
export function comparisonAccess(member: ComparisonMember, now = Date.now()): 200 | 401 | 403 | 503 {
  if (member.status === "unavailable") return 503;
  if (member.status !== "signed-in") return 401;
  if (comparisonOwner(member)) return 200;
  return member.plan === "pro" && Number.isFinite(member.accessExpiresAt) && member.accessExpiresAt! > now ? 200 : 403;
}

/** Operating income worked out from the same filing's own lines, for a company that tags no OperatingIncomeLoss (COHR, ASTS, HOOD...). */
export const DERIVED_OPERATING = "TechPhaseDerivedOperatingIncome";
/** Pre-tax income, only for a company with no operating line at all (IBM, KLAC); shown as a pre-tax margin, never as an operating margin. */
export const DERIVED_PRETAX = "TechPhasePretaxIncome";
const PRETAX_TAGS = ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"];
type RawFact = { val: number; end: string; start?: string; accn: string; filed: string; form: string };
/** Adds figures the scorecard needs that a filing states in another form, period by period and filing by filing, never across filings:
 *  - operating income: gross profit − operating expenses; revenue − cost of revenue − operating expenses; revenue − total costs and expenses;
 *    revenue − operating expenses (only when the filing shows no cost-of-revenue line); last, pre-tax income under its own tag;
 *  - cash: cash including restricted cash, when the plain cash line is not tagged (GEV).
 * Only USD (or the filing's single currency) duration facts with a start; nothing is added where the stated tag exists. */
function supplementFacts(usGaap: Record<string, unknown>): Record<string, unknown> {
  const facts = { ...usGaap };
  const list = (tag: string): [string, RawFact[]][] => Object.entries(obj(obj(facts[tag]).units)).flatMap(([unit, values]) => Array.isArray(values) ? [[unit, values as RawFact[]]] : []);
  const key = (f: RawFact) => `${f.accn}|${f.start ?? ""}|${f.end}`;
  const index = (tags: string[]) => { const m = new Map<string, Map<string, RawFact>>(); for (const tag of tags) for (const [unit, values] of list(tag)) for (const f of values) { if (typeof f.val !== "number") continue; const u = m.get(unit) ?? new Map(); if (!u.has(key(f))) u.set(key(f), f); m.set(unit, u); } return m; };
  const add = (tag: string, unit: string, rows: RawFact[]) => { if (rows.length) facts[tag] = { units: { [unit]: rows } }; };
  const stated = index(["OperatingIncomeLoss"]);
  const revenue = index(["RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenues", "SalesRevenueNet"]);
  const gross = index(["GrossProfit"]), opex = index(["OperatingExpenses"]), cost = index(["CostOfRevenue", "CostOfGoodsAndServicesSold"]), costs = index(["CostsAndExpenses"]);
  const pretax = index(PRETAX_TAGS);
  const derived: Record<string, RawFact[]> = {}, pre: Record<string, RawFact[]> = {};
  for (const [unit, rows] of revenue) for (const [k, r] of rows) {
    if (!r.start || stated.get(unit)?.has(k)) continue;
    const g = gross.get(unit)?.get(k), o = opex.get(unit)?.get(k), c = cost.get(unit)?.get(k), t = costs.get(unit)?.get(k);
    const value = g && o ? g.val - o.val : c && o ? r.val - c.val - o.val : t ? r.val - t.val : o && !c && !g ? r.val - o.val : null;
    if (value !== null && Number.isFinite(value)) { (derived[unit] ??= []).push({ ...r, val: value }); continue; }
    const p = pretax.get(unit)?.get(k);
    if (p) (pre[unit] ??= []).push({ ...r, val: p.val });
  }
  for (const [unit, rows] of Object.entries(derived)) add(DERIVED_OPERATING, unit, rows);
  // Pre-tax income only fills a period with no operating figure of any kind (KLAC stopped tagging one); the stability series never mixes the two.
  for (const [unit, rows] of Object.entries(pre)) add(DERIVED_PRETAX, unit, rows);
  if (!facts.CashAndCashEquivalentsAtCarryingValue && facts.CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents)
    facts.CashAndCashEquivalentsAtCarryingValue = facts.CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents;
  return facts;
}
const tags = {
  "us-gaap": { revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenues", "SalesRevenueNet"], operatingIncome: ["OperatingIncomeLoss", DERIVED_OPERATING, DERIVED_PRETAX], operatingCash: ["NetCashProvidedByUsedInOperatingActivities"], capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireOtherPropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"], cash: ["CashAndCashEquivalentsAtCarryingValue"], stockCompensation: ["ShareBasedCompensation"], dilutedShares: ["WeightedAverageNumberOfDilutedSharesOutstanding"] },
  "ifrs-full": { revenue: ["Revenue", "RevenueFromContractsWithCustomers"], operatingIncome: ["ProfitLossFromOperatingActivities"], operatingCash: ["CashFlowsFromUsedInOperatingActivities"], capex: ["PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"], cash: ["CashAndCashEquivalents"], stockCompensation: [], dilutedShares: [] },
} as const;
/** Standard consolidated facts. Annual and standalone-quarter periods remain separate. */
export function extractFinancials(ticker: string, cik: string, payload: unknown, now = Date.now(), reportingCurrency?: string, primaryRevenueTag?: string): Financials {
  const result = emptyFinancials(ticker, "unsupported", new Date(now).toISOString());
  const root = obj(payload);
  if (Number(root.cik) !== Number(cik)) return result;
  const rawFacts = obj(root.facts);
  const facts: Record<string, unknown> = { ...rawFacts, "us-gaap": supplementFacts(obj(rawFacts["us-gaap"])) };
  function collect(basis: keyof typeof tags, names: readonly string[], instant = false, period: "annual" | "quarter" | "ytd9" | "ytd" = "annual", shares = false): (Fact & {filed:string;accession:string})[] {
    return names.flatMap(tag => Object.entries(obj(obj(obj(facts[basis])[tag]).units)).flatMap(([unit, values]) => {
      if ((shares ? unit !== "shares" : !/^[A-Z]{3}$/.test(unit)) || !Array.isArray(values)) return [];
      return values.flatMap(raw => {
        const f = obj(raw);
        if (typeof f.val !== "number" || !Number.isFinite(f.val) || typeof f.end !== "string" || typeof f.filed !== "string" || typeof f.accn !== "string" || !/^\d{10}-\d{2}-\d{6}$/.test(f.accn) || !(period === "quarter" ? ["10-Q", "10-Q/A", "6-K", "6-K/A", "8-K", "8-K/A"] : period === "ytd9" || period === "ytd" ? ["10-Q", "10-Q/A"] : ["10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A"]).includes(String(f.form))) return [];
        if (!Number.isFinite(day(f.end)) || !Number.isFinite(day(f.filed)) || day(f.filed) > now / 86400000 || day(f.end) > day(f.filed)) return [];
        const fact: Fact & {filed:string;accession:string} = { value: f.val, unit, start: typeof f.start === "string" ? f.start : null, end: f.end, filed: f.filed, accession: f.accn, tag, basis };
        if (instant ? fact.start !== null : duration(fact) < (period === "quarter" ? 75 : period === "ytd9" ? 245 : period === "ytd" ? 160 : 350) || duration(fact) > (period === "quarter" ? 105 : period === "ytd9" || period === "ytd" ? 290 : 380) || !Number.isFinite(duration(fact))) return [];
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
  const operatingIncome = metric("operatingIncome"), operatingCash = metric("operatingCash"), cash = metric("cash");
  // Capital spending is tagged one of several ways (AAOI switched tags mid-year): the first tag the filing uses is taken, never a mix.
  const capexRaw = (() => { for (const tag of tags[basis].capex) { const values = collect(basis, [tag]).filter(samePeriod); if (values.length) return new Set(values.map(f => f.value)).size === 1 ? values[0] : null; } return null; })();
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
  let quarterRevenue = latestQuarter ? unique(quarters.filter(f => f.end === latestQuarter.end && f.filed === latestQuarter.filed)) : null;
  // Right after a 10-K the fourth quarter has no filing of its own: it is the fiscal year minus the nine-month year-to-date of the same
  // year's third-quarter 10-Q (the same tag and unit, the YTD ending a quarter before the year end). Marked as derived; nothing is guessed.
  const fourth = (tag: string, wanted: Fact | null) => {
    if (!wanted) return null;
    const ytd = collect(basis, [tag], false, "ytd9").filter(f => f.unit === wanted.unit && f.start === wanted.start && day(wanted.end) - day(f.end) >= 75 && day(wanted.end) - day(f.end) <= 105);
    const best = ytd.sort((a, b) => b.filed.localeCompare(a.filed))[0];
    const same = best ? ytd.filter(f => f.filed === best.filed && f.end === best.end) : [];
    if (!best || new Set(same.map(f => f.value)).size !== 1) return null;
    const start = new Date((day(best.end) + 1) * 86400000).toISOString().slice(0, 10);
    return { value: wanted.value - best.value, unit: wanted.unit, start, end: wanted.end, filed: wanted.filed, accession: wanted.accession, tag: wanted.tag, basis: wanted.basis, derived: "fy-minus-9m" as const };
  };
  let derivedQuarter: Fact | null = null, derivedOperating: Fact | null = null, derivedPrevious: Fact | null = null;
  if (!quarterRevenue && (!primaryRevenueTag || `${revenue.basis}:${revenue.tag}` === primaryRevenueTag)) {
    const q = fourth(revenue.tag, revenue);
    if (q && q.value > 0) {
      derivedQuarter = q;
      // The year before: its fiscal year (restated in this 10-K) minus its own nine months (shown beside this year's in the Q3 10-Q).
      const p = previousRevenue ? fourth(previousRevenue.tag, previousRevenue) : null;
      derivedPrevious = p && p.value > 0 ? p : null;
      derivedOperating = operatingIncome ? fourth(operatingIncome.tag, operatingIncome) : null;
      quarterRevenue = derivedQuarter;
    }
  }
  const previousQuarterRevenue = derivedPrevious ?? (quarterRevenue && !derivedQuarter ? unique(collect(basis, [quarterRevenue.tag], false, "quarter").filter(f => f.accession === quarterRevenue.accession && f.unit === quarterRevenue.unit && day(quarterRevenue.end)-day(f.end) >= 350 && day(quarterRevenue.end)-day(f.end) <= 380 && Math.abs(duration(quarterRevenue)-duration(f)) <= 8 && f.value > 0)) : null);
  const quarterOperatingIncome = derivedQuarter ? derivedOperating : quarterRevenue ? unique(collect(basis, tags[basis].operatingIncome, false, "quarter").filter(f => f.accession === quarterRevenue.accession && f.unit === quarterRevenue.unit && f.start === quarterRevenue.start && f.end === quarterRevenue.end)) : null;
  const quarterMetric = (key: "operatingCash" | "capex" | "stockCompensation") => quarterRevenue ? unique(collect(basis,tags[basis][key],false,"quarter").filter(f => f.accession===quarterRevenue.accession && f.unit===quarterRevenue.unit && f.start===quarterRevenue.start && f.end===quarterRevenue.end)) : null;
  // Cash-flow statements in a 10-Q are year-to-date only, so the second and third quarters had no cash figures (資金創出 stayed "—" for most
  // companies, owner Nov 14). The quarter is then this filing's year-to-date minus the year-to-date through the previous quarter (same start,
  // newest filing); a fourth quarter is the fiscal year minus nine months. Each tag is tried on its own, in order; tags are never mixed.
  function quarterCash(key: "operatingCash" | "capex"): Fact | null {
    if (!quarterRevenue || !quarterRevenue.start) return null;
    for (const tag of tags[basis][key]) {
      const direct = unique(collect(basis,[tag],false,"quarter").filter(f => f.accession===quarterRevenue.accession && f.unit===quarterRevenue.unit && f.start===quarterRevenue.start && f.end===quarterRevenue.end));
      if (direct) return direct;
      if (derivedQuarter) {
        const annual = collect(basis,[tag]).filter(samePeriod);
        const q = annual.length && new Set(annual.map(f => f.value)).size === 1 ? fourth(tag, annual[0]) : null;
        if (q) return q;
        continue;
      }
      const ytd = unique(collect(basis,[tag],false,"ytd").filter(f => f.accession===quarterRevenue.accession && f.unit===quarterRevenue.unit && f.end===quarterRevenue.end && !!f.start && f.start < quarterRevenue.start!));
      if (!ytd) continue;
      const previousEnd = new Date((day(quarterRevenue.start) - 1) * 86400000).toISOString().slice(0, 10);
      const earlier = [...collect(basis,[tag],false,"quarter"), ...collect(basis,[tag],false,"ytd")].filter(f => f.unit===ytd.unit && f.start===ytd.start && f.end===previousEnd);
      const newest = earlier.map(f => f.filed).sort().at(-1);
      const prior = newest ? unique(earlier.filter(f => f.filed === newest)) : null;
      if (!prior) continue;
      return { ...ytd, value: ytd.value - prior.value, start: quarterRevenue.start, derived: "ytd-minus-prior-ytd" };
    }
    return null;
  }
  const quarterOperatingCash=quarterCash("operatingCash"), quarterCapex=quarterCash("capex"), quarterCompensation=quarterMetric("stockCompensation");
  const quarterShares = quarterRevenue ? unique(collect(basis,tags[basis].dilutedShares,false,"quarter",true).filter(f=>f.accession===quarterRevenue.accession && f.start===quarterRevenue.start && f.end===quarterRevenue.end && f.value>0)) : null;
  const previousQuarterShares = quarterShares && previousQuarterRevenue ? unique(collect(basis,[quarterShares.tag],false,"quarter",true).filter(f=>f.accession===quarterShares.accession && f.start===previousQuarterRevenue.start && f.end===previousQuarterRevenue.end && f.value>0)) : null;
  // The last four standalone quarters' operating margins, for the stability factor. Each quarter needs both revenue and operating income;
  // a quarter reported twice with different values, or a gap in the sequence, leaves the whole series empty.
  let quarterRevenueTtm: number | null = null;
  function marginSeries(): { periodEnd: string; value: number }[] | null {
    if (!quarterRevenue) return null;
    const perEnd = (names: readonly string[]) => {
      const out = new Map<string, number | null>();
      const add = (f: Fact) => { const have = out.get(f.end); out.set(f.end, have === undefined || have === f.value ? f.value : null); };
      const latestByEnd = new Map<string, (Fact & { filed: string })[]>();
      for (const f of collect(basis, names, false, "quarter")) latestByEnd.set(f.end, [...(latestByEnd.get(f.end) ?? []), f as Fact & { filed: string }]);
      for (const [, list] of latestByEnd) { const newest = list.map(f => f.filed).sort().at(-1); const same = list.filter(f => f.filed === newest && f.unit === revenue.unit); if (same.length) same.forEach(add); }
      for (const annual of collect(basis, names, false, "annual").filter(f => f.unit === revenue.unit)) {
        const q4 = fourth(annual.tag, annual);
        if (q4 && !out.has(q4.end)) out.set(q4.end, q4.value);
      }
      return out;
    };
    // The revenue tag of the latest quarter only (BE tags two revenue lines that differ slightly), and one kind of profit line: operating, or pre-tax.
    const pretaxOnly = quarterOperatingIncome?.tag === DERIVED_PRETAX;
    const rev = perEnd([quarterRevenue.tag]), op = perEnd(pretaxOnly ? [DERIVED_PRETAX] : tags[basis].operatingIncome.filter(tag => tag !== DERIVED_PRETAX));
    // Revenue of four consecutive quarters for price-to-sales: needs revenue only, so a company without an operating line still has it.
    const revenueEnds = [...rev.keys()].filter(end => end <= quarterRevenue.end && (rev.get(end) ?? 0) > 0).sort().reverse();
    if (revenueEnds[0] === quarterRevenue.end) {
      const chain = [revenueEnds[0]];
      for (const end of revenueEnds.slice(1)) { const gap = day(chain.at(-1)!) - day(end); if (gap >= 70 && gap <= 110) chain.push(end); else if (gap > 110) break; if (chain.length === 4) break; }
      if (chain.length === 4) quarterRevenueTtm = chain.reduce((sum, end) => sum + rev.get(end)!, 0);
    }
    const ends = [...rev.keys()].filter(end => end <= quarterRevenue.end && (rev.get(end) ?? 0) > 0 && typeof op.get(end) === "number").sort().reverse();
    if (ends[0] !== quarterRevenue.end) return null;
    const picked = [ends[0]];
    for (const end of ends.slice(1)) { const gap = day(picked.at(-1)!) - day(end); if (gap >= 70 && gap <= 110) picked.push(end); if (picked.length === 4) break; }
    if (picked.length !== 4) return null;
    return picked.map(end => ({ periodEnd: end, value: op.get(end)! / rev.get(end)! * 100 }));
  }
  const quarterMargins = marginSeries();
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
  // Financial strength was "—" for most companies (MU, ALAB, CRDO, SNDK, BE, HIMS..., owner Nov 14) because only the split current/noncurrent
  // long-term debt pair counted. The first complete form the filing uses is taken; forms are never mixed.
  function totalDebt(): BalanceSnapshot["debtTotal"] {
    if (basis !== "us-gaap") return null;
    const m = balanceMetric, short = m("ShortTermBorrowings")?.value ?? 0;
    const current = m("LongTermDebtCurrent"), noncurrent = m("LongTermDebtNoncurrent");
    if (current && noncurrent) return { value: current.value + noncurrent.value, source: "split" };   // the same figure as before
    const total = m("LongTermDebt");
    if (total) return { value: total.value + short, source: "total" };
    if (noncurrent) return { value: noncurrent.value + short, source: "noncurrent" };
    const carrying = m("DebtInstrumentCarryingAmount");
    if (carrying) return { value: carrying.value + short, source: "carrying" };
    const leaseCombined = m("LongTermDebtAndCapitalLeaseObligations");   // noncurrent debt and finance leases, with its current part (APH, LRCX)
    if (leaseCombined) return { value: leaseCombined.value + (m("LongTermDebtAndCapitalLeaseObligationsCurrent")?.value ?? 0) + short, source: "total" };
    const combined = m("DebtLongtermAndShorttermCombinedAmount");
    if (combined) return { value: combined.value, source: "total" };
    const convertibleCurrent = m("ConvertibleDebtCurrent")?.value ?? m("ConvertibleNotesPayableCurrent")?.value ?? null;
    const convertible = m("ConvertibleDebtNoncurrent") ?? m("ConvertibleNotesPayable") ?? m("ConvertibleSeniorNotesPayable") ?? m("ConvertibleLongTermNotesPayable");
    if (convertible) return { value: convertible.value + (convertibleCurrent ?? 0) + short, source: "convertible" };
    if (convertibleCurrent !== null) return { value: convertibleCurrent + short, source: "convertible" };
    // No form found: debt-free only if the filing reports no borrowing, loan or notes figure of any kind (investments in debt securities aside).
    if (!currentAssets || !currentLiabilities || anchor.accession === null) return null;
    const borrowing = /Debt|Borrowing|NotesPayable|LoansPayable|SeniorNotes|LineOfCredit|CreditFacility/;
    const notBorrowing = /Securities|AvailableForSale|HeldToMaturity|Investment|Receivable|Allowance|Derivative|Hedg|Equity|Discount|Premium|IssuanceCost|Unamortized|Extinguishment|Interest|Repayment|Proceeds|Payments|Maturit|FairValue|Covenant|Percentage|Rate|Valuation|Forgiveness|Conversion/;
    const usGaap = obj(facts["us-gaap"]);
    const mentioned = Object.keys(usGaap).some(tag => borrowing.test(tag) && !notBorrowing.test(tag)
      && Object.values(obj(obj(usGaap[tag]).units)).some(values => Array.isArray(values) && values.some(raw => obj(raw).accn === anchor.accession)));
    return mentioned ? null : { value: 0, source: "none" };
  }
  const balance: BalanceSnapshot = {
    end: anchor.end, filed: anchor.filed, sourceUrl: filingUrl(anchor),
    cash: balanceMetric("CashAndCashEquivalentsAtCarryingValue"), currentAssets, currentLiabilities,
    currentRatio: currentAssets && currentLiabilities && currentLiabilities.value > 0 ? currentAssets.value / currentLiabilities.value : null,
    debtCurrent: balanceMetric("LongTermDebtCurrent"), debtNoncurrent: balanceMetric("LongTermDebtNoncurrent"),
    shortBorrowings: balanceMetric("ShortTermBorrowings"), leaseCurrent: balanceMetric("OperatingLeaseLiabilityCurrent"), leaseNoncurrent: balanceMetric("OperatingLeaseLiabilityNoncurrent"),
    debtTotal: totalDebt(),
  };
  return { ...result, status: "ready", balance, revenue, previousRevenue, operatingIncome, operatingCash, capex, cash,
    stockCompensation, stockCompensationRatio: stockCompensation ? stockCompensation.value / revenue.value * 100 : null,
    dilutedShares, previousDilutedShares, dilutedSharesGrowth: dilutedShares && previousDilutedShares ? (dilutedShares.value / previousDilutedShares.value - 1) * 100 : null,
    quarterRevenue, previousQuarterRevenue, quarterOperatingIncome, quarterMargins, quarterRevenueTtm,
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
