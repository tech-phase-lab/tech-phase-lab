/** Company-type metrics for the Stock Comparison where the standard metric has no meaning (owner, Nov 26: "全く情報でてない… 全部直して";
 *  IMUX, a drug developer with no sales, showed nothing for growth, profitability, cash generation and stability).
 *
 *  Every figure here is read from the company's own filed XBRL facts (the SEC's company facts, merged with the inline filings the loader
 *  reads); nothing is estimated, and each score is on a fixed scale of the company's own figure, so a company scores the same whichever
 *  company it is compared with (tests/comparison-alternatives.test.mjs).
 *
 *  - No revenue in the last twelve months (pre-revenue, or sales that stopped):
 *      cash generation -> cash runway: (cash + short-term investments) ÷ the average quarterly operating cash outflow of up to four quarters;
 *      growth          -> net-loss trend: the last four quarters' net income against the four before (else the last two fiscal years);
 *      profitability   -> not scored (no revenue, no margin); the R&D share of operating expenses (else of R&D plus G&A) is shown as a fact;
 *      stability       -> share dilution: weighted-average shares of the latest period against the same period a year earlier, both as
 *                         presented in the same filing (its comparatives are restated for splits, so a reverse split is not a buyback).
 *  - Banks, insurers, brokers and BDCs (finance SIC), where current ratio and free cash flow say nothing:
 *      financial strength -> capital ratio (shareholders' equity ÷ total assets); cash generation -> return on equity (net income of the last
 *      four quarters, else the fiscal year, ÷ equity); a BDC's profitability -> net investment income ÷ total investment income. */

type Raw = { val: number; start?: string; end: string; filed: string; accn: string; form: string };
type Facts = Record<string, unknown>;
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const day = (s: string) => Date.parse(`${s}T00:00:00Z`) / 86_400_000;
const FORMS = new Set(["10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A", "40-F", "40-F/A", "6-K", "6-K/A", "10-KT"]);
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const clamp = (n: number) => Math.round(Math.max(0, Math.min(10, n)) * 10) / 10;

/** Values of the first of `names` the company files in `unit` (periodic reports only). */
function rows(facts: Facts, names: readonly string[], unit: string, instant: boolean): (Raw & { tag: string })[] {
  for (const basis of ["us-gaap", "ifrs-full"]) for (const tag of names) {
    const values = obj(obj(obj(facts[basis])[tag]).units)[unit];
    if (!Array.isArray(values)) continue;
    const out = (values as Raw[]).filter(f => f && finite(f.val) && typeof f.end === "string" && FORMS.has(f.form) && (instant ? !f.start : !!f.start)).map(f => ({ ...f, tag }));
    if (out.length) return out;
  }
  return [];
}
const duration = (f: { start?: string; end: string }) => f.start ? day(f.end) - day(f.start) : 0;
/** Standalone three-month values by period end: as filed (newest filing), or a year-to-date minus the year-to-date a quarter earlier of the
 *  same fiscal year (same start), or a fiscal year minus its nine months. Never mixed across tags. */
export function standaloneQuarters(values: Raw[]): Map<string, number> {
  const newest = new Map<string, Raw>();
  for (const f of values) { const k = `${f.start}|${f.end}`; const have = newest.get(k); if (!have || have.filed < f.filed) newest.set(k, f); }
  const spans = [...newest.values()];
  const out = new Map<string, number>();
  for (const f of spans) { const d = duration(f); if (d >= 75 && d <= 120) out.set(f.end, f.val); }
  for (const f of spans) {
    if (out.has(f.end) || duration(f) < 150) continue;
    const prior = spans.find(p => p.start === f.start && day(f.end) - day(p.end) >= 70 && day(f.end) - day(p.end) <= 125 && duration(p) >= 75);
    if (prior) out.set(f.end, f.val - prior.val);
  }
  return out;
}
/** Up to four consecutive quarter ends, newest first, each 70 to 125 days after the next. */
function chain(ends: string[], newest: string, n = 4): string[] {
  const sorted = ends.filter(e => e <= newest).sort().reverse();
  if (!sorted.length) return [];
  const out = [sorted[0]];
  for (const e of sorted.slice(1)) { const gap = day(out.at(-1)!) - day(e); if (gap >= 70 && gap <= 125) out.push(e); else if (gap > 125) break; if (out.length === n) break; }
  return out;
}

const SHORT_TERM = ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent", "ShorttermInvestments"];
const OCF = ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations", "CashFlowsFromUsedInOperatingActivities"];
// The owners' share first (reviewer, Nov 26): an IFRS filer's ProfitLoss includes non-controlling interests, while the equity ROE divides by is
// the owners' (EquityAttributableToOwnersOfParent); US GAAP NetIncomeLoss is already the parent's.
const NET_INCOME = ["NetIncomeLoss", "ProfitLossAttributableToOwnersOfParent", "ProfitLoss"];
const RD = ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost", "ResearchAndDevelopmentExpense"];
const OPEX = ["OperatingExpenses", "CostsAndExpenses"];
const GA = ["GeneralAndAdministrativeExpense", "SellingGeneralAndAdministrativeExpense", "AdministrativeExpense"];
const WEIGHTED = ["WeightedAverageNumberOfSharesOutstandingBasic", "WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageShares", "AdjustedWeightedAverageShares"];

export type PreRevenueMetrics = {
  balanceEnd: string; unit: string;
  /** Cash and cash equivalents plus short-term investments at the balance date. */
  liquid: number;
  /** Average quarterly operating cash outflow (positive = outflow) over `quarters` quarters, or a half-year/fiscal year ÷ 2 or 4. */
  burn: { perQuarter: number; quarters: number; months: 3 | 6 | 12 } | null;
  /** Net income: the last four quarters against the four before ("quarters"), or the last two fiscal years ("years"). */
  netIncome: { now: number; before: number; basis: "quarters" | "years"; end: string } | null;
  /** R&D share of spending for the latest period. */
  rd: { share: number; of: "operating-expenses" | "rd-and-ga"; end: string } | null;
  /** Weighted-average share count change against the same period a year earlier, from the same filing. */
  dilution: { pct: number; end: string } | null;
};

/** The pre-revenue figures at the balance date (`end`, in `unit`, the cash figure the balance sheet already holds). */
export function preRevenueMetrics(facts: Facts, unit: string, end: string, cash: number): PreRevenueMetrics {
  const sti = rows(facts, SHORT_TERM, unit, true).filter(f => f.end === end).sort((a, b) => b.filed.localeCompare(a.filed))[0];
  const liquid = cash + (sti ? sti.val : 0);
  const out: PreRevenueMetrics = { balanceEnd: end, unit, liquid, burn: null, netIncome: null, rd: null, dilution: null };
  // Burn.
  const ocf = rows(facts, OCF, unit, false);
  const q = standaloneQuarters(ocf), ends = chain([...q.keys()], end);
  if (ends.length && day(end) - day(ends[0]) <= 100) {
    out.burn = { perQuarter: -ends.reduce((a, e) => a + q.get(e)!, 0) / ends.length, quarters: ends.length, months: 3 };
  } else {
    for (const [lo, hi, k, months] of [[165, 200, 2, 6], [350, 380, 4, 12]] as const) {
      const pick = ocf.filter(f => duration(f) >= lo && duration(f) <= hi && day(end) - day(f.end) <= 200 && day(f.end) <= day(end)).sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed))[0];
      if (pick) { out.burn = { perQuarter: -pick.val / k, quarters: 1, months }; break; }
    }
  }
  // Net-income trend.
  const ni = rows(facts, NET_INCOME, unit, false);
  const nq = standaloneQuarters(ni), nEnds = chain([...nq.keys()], end, 8);
  if (nEnds.length === 8 && day(end) - day(nEnds[0]) <= 100) {
    out.netIncome = { now: nEnds.slice(0, 4).reduce((a, e) => a + nq.get(e)!, 0), before: nEnds.slice(4).reduce((a, e) => a + nq.get(e)!, 0), basis: "quarters", end: nEnds[0] };
  } else {
    const years = new Map<string, Raw>();
    for (const f of ni) if (duration(f) >= 350 && duration(f) <= 380 && (!years.get(f.end) || years.get(f.end)!.filed < f.filed)) years.set(f.end, f);
    const ys = [...years.keys()].sort().reverse();
    if (ys.length >= 2 && day(ys[0]) - day(ys[1]) >= 340 && day(ys[0]) - day(ys[1]) <= 400 && day(end) - day(ys[0]) <= 200)
      out.netIncome = { now: years.get(ys[0])!.val, before: years.get(ys[1])!.val, basis: "years", end: ys[0] };
  }
  // R&D intensity: the latest R&D period no older than the balance date's year.
  const rd = rows(facts, RD, unit, false).sort((a, b) => b.end.localeCompare(a.end) || duration(a) - duration(b) || b.filed.localeCompare(a.filed))[0];
  if (rd && day(end) - day(rd.end) <= 200 && rd.val >= 0) {
    const same = (names: string[]) => rows(facts, names, unit, false).filter(f => f.start === rd.start && f.end === rd.end).sort((a, b) => b.filed.localeCompare(a.filed))[0];
    const opex = same(OPEX), ga = same(GA);
    if (opex && opex.val > 0 && rd.val <= opex.val) out.rd = { share: rd.val / opex.val * 100, of: "operating-expenses", end: rd.end };
    else if (ga && rd.val + ga.val > 0) out.rd = { share: rd.val / (rd.val + ga.val) * 100, of: "rd-and-ga", end: rd.end };
  }
  // Dilution: latest period's weighted shares against the period a year earlier presented in the same filing.
  const w = rows(facts, WEIGHTED, "shares", false).filter(f => (duration(f) >= 75 && duration(f) <= 120) || (duration(f) >= 165 && duration(f) <= 200) || (duration(f) >= 350 && duration(f) <= 380));
  const top = [...w].sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed) || duration(a) - duration(b))[0];
  if (top && top.val > 0 && day(end) - day(top.end) <= 200) {
    const prior = w.filter(f => f.accn === top.accn && f.tag === top.tag && Math.abs(duration(f) - duration(top)) <= 10 && day(top.end) - day(f.end) >= 340 && day(top.end) - day(f.end) <= 390 && f.val > 0)[0];
    if (prior) out.dilution = { pct: (top.val / prior.val - 1) * 100, end: top.end };
  }
  return out;
}

export type SectorMetrics = {
  /** Shareholders' equity ÷ total assets at the balance date (%). */
  capitalRatio: number | null;
  /** Net income ÷ shareholders' equity (%): four quarters to the period end, else the fiscal year ending then. */
  roe: { pct: number; basis: "quarters" | "year" } | null;
  /** Net investment income ÷ total investment income for the period (%), a business development company. */
  niiMargin: number | null;
};
/** The figures of a bank, insurer, broker or BDC for the period ending `end` (in `unit`). */
export function sectorMetrics(facts: Facts, unit: string, end: string, equity: number | null, assets: number | null, period?: { start: string | null; accession: string | null; revenue: number }): SectorMetrics {
  const capitalRatio = equity !== null && assets !== null && assets > 0 ? equity / assets * 100 : null;
  // ROE pairs a profit with the equity it belongs to (reviewer, Nov 26): the parent's net income with the parent's equity (US GAAP), the
  // owners' profit with the owners' equity (IFRS), or, where a filer tags only its total profit (HSBC since 2023), the total profit with the
  // total equity including non-controlling interests. Never the total profit over the owners' equity.
  const pairs: [string[], string[]][] = [[["NetIncomeLoss"], ["StockholdersEquity"]], [["ProfitLossAttributableToOwnersOfParent"], ["EquityAttributableToOwnersOfParent"]],
    [["ProfitLoss"], ["StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "Equity"]]];
  const equityAt = (names: string[], date: string) => rows(facts, names, unit, true).filter(f => f.end === date).sort((a, b) => b.filed.localeCompare(a.filed))[0]?.val;
  const roeFor = (income: string[], equities: string[]): SectorMetrics["roe"] => {
    const ni = rows(facts, income, unit, false);
    if (!ni.length) return null;
    const own = equityAt(equities, end) ?? (income[0] === "NetIncomeLoss" ? equity ?? undefined : undefined);
    const q = standaloneQuarters(ni), ends = chain([...q.keys()], end);
    if (own && own > 0 && ends.length === 4 && ends[0] === end) return { pct: ends.reduce((a, e) => a + q.get(e)!, 0) / own * 100, basis: "quarters" };
    // Else the latest fiscal year (at most 500 days old): its profit over the equity at that same year end, both as filed.
    const year = ni.filter(f => duration(f) >= 350 && duration(f) <= 380 && f.end <= end && day(end) - day(f.end) <= 500).sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed))[0];
    const base = year ? (year.end === end ? own : equityAt(equities, year.end)) : undefined;
    return year && base && base > 0 ? { pct: year.val / base * 100, basis: "year" } : null;
  };
  let roe: SectorMetrics["roe"] = null;
  if (equity !== null && equity > 0) for (const [income, equities] of pairs) { roe = roeFor(income, equities); if (roe) break; }
  let niiMargin: number | null = null;
  if (period && period.revenue > 0 && period.accession) {
    const nii = rows(facts, ["NetInvestmentIncome"], unit, false).find(f => f.end === end && f.start === period.start && f.accn === period.accession);
    if (nii) niiMargin = nii.val / period.revenue * 100;
  }
  return { capitalRatio, roe, niiMargin };
}

/** The fixed scales (0-10), each of the company's own figure only. */
export const ALTERNATIVE_SCALES = {
  /** 0 months = 0, 24 months or more = 10; no operating cash outflow = 10. */
  runway: (r: { months: number | null; cashPositive: boolean }): number | null => r.cashPositive ? 10 : r.months === null ? null : clamp(r.months / 24 * 10),
  /** Change of net income against the earlier period, in % of the earlier loss: unchanged = 5, 50% smaller loss = 10, 50% larger = 0. */
  lossTrend: (pct: number) => clamp(5 + pct / 10),
  /** R&D share of spending: 0% = 0, 80% or more = 10. */
  rdIntensity: (share: number) => clamp(share / 8),
  /** Shares outstanding change: no increase (or fewer shares) = 10, +50% or more = 0. */
  dilution: (pct: number) => clamp(10 - Math.max(0, pct) / 5),
  /** Equity ÷ assets on a bank's scale (reviewer, Nov 26: at 20% for 10 points every large bank scored weak, HSBC 5.7% → 2.9): 2% = 0,
   *  10% or more = 10 (a well-capitalised bank holds about 6-10%; a BDC's or insurer's higher ratio scores 10). */
  capitalRatio: (pct: number) => clamp((pct - 2) * 10 / 8),
  /** Return on equity: 0% = 5, +15% = 10, −15% = 0. */
  roe: (pct: number) => clamp(5 + pct / 3),
  /** Net investment income margin, on the operating-margin scale (50% = 10). */
  niiMargin: (pct: number) => clamp(pct / 5),
};

/** Months of runway (null when no burn was found), and whether operating cash flow is positive (no outflow). */
export function runway(m: PreRevenueMetrics): { months: number | null; cashPositive: boolean } {
  if (!m.burn) return { months: null, cashPositive: false };
  if (m.burn.perQuarter <= 0) return { months: null, cashPositive: true };
  return { months: m.liquid / m.burn.perQuarter * 3, cashPositive: false };
}
/** Net-income change in % of the earlier figure's size (positive = a smaller loss or a larger profit). */
export function lossTrendPct(m: PreRevenueMetrics): number | null {
  const n = m.netIncome;
  return n && n.before !== 0 ? (n.now - n.before) / Math.abs(n.before) * 100 : null;
}
