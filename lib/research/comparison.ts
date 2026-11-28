import { preRevenueMetrics, sectorMetrics } from "./comparison-alternatives.ts";
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
  debtTotal?: { value: number; source: "split" | "total" | "noncurrent" | "carrying" | "convertible" | "lines" | "none" } | null;
  /** Shareholders' equity at the same date from the same filing (the parent's own, else the total with minority interests), negative values
   * kept: MO, whose liabilities exceed its assets. Null when not reported once and unambiguously. Absent on older saved results. */
  equity?: Fact | null;
  /** Total assets at the same date from the same filing (the capital ratio of a bank, insurer or broker: equity ÷ assets). */
  assets?: Fact | null;
};
export type Financials = {
  /** The length of the latest period when it is not a quarter: 6 for a half-year interim report (a foreign filer reporting twice a year,
   *  BTI), 12 for a foreign filer whose filings carry annual figures only. Absent: a quarter, as before. Said on screen beside the figures. */
  periodMonths?: 6 | 12;
  twelveData?: import("./twelve-data-factors").TwelveFactorEvidence;
  /** Factors taken from the provider's statements for the same quarter because the filing left them empty (shown on the screen). */
  supplemented?: string[];
  /** Set when the supplemented factors come from the provider's previous quarter (it had not added the newest one yet): its end date. */
  supplementedFromQuarter?: string;
  /** False when the filing's own balance already scores financial strength: the provider's balance is then never used. */
  supplementedFinancialAllowed?: boolean;
  /** The end of the filing's balance sheet used for financial strength when the figures come from a newer quarter the provider already has
   *  but its statistics do not yet (comparison-server.ts): the previous quarter's balance, said on screen. */
  balanceFromQuarter?: string;
  /** True for a company with no revenue yet: only its latest balance sheet is read (financial strength), the revenue factors say so. */
  preRevenue?: true;
  /** True when the company never tags a capital-spending line (AirBnB, AppLovin: immaterial, folded into "other"), so free cash flow
   *  is operating cash flow with capital spending counted as zero. Said on screen. */
  capexNotReported?: boolean;
  /** The valuation from Treasure Hunt's list (lib/research/comparison-value.ts), set per comparison; null: not in the list (未取得). */
  valueCheck?: import("./comparison-value").ValueFigure | null;
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
  /** Why the filings give no current figures (comparison-loader.ts), said on screen instead of a bare "unverified". */
  gapReason?: { kind: "no-report" | "no-xbrl" | "stale" | "unreadable"; date?: string };
  /** The quarter's operating income exceeds its revenue line: the margin is withheld (a gain inside operating income, or a partial line). */
  marginWithheld?: true;
  /** The revenue is an IFRS bank's net interest plus net fee income only (IFRS_BANK_REVENUE), while its operating profit also holds trading
   *  and other income (HSBC: 70% "margin" for H1 2026): no margin and no margin series are scored, and the screen says why. */
  marginPartial?: true;
  /** With marginWithheld: the operating figure and the pre-tax income of the same period have opposite signs (a lender, NNI). */
  marginSign?: true;
  /** No growth is shown: the revenue line is only part of the revenue (marginPartial, or a bank's line below its operating income). */
  growthWithheld?: true;
  /** A bank (SIC 6000-6098), a lender or finance company (6100-6199), a broker, dealer or exchange (6200-6299) or an insurer (6300-6411),
   *  payment processors (6099) and health insurers (6324) aside: financial strength is its equity ratio, never cash against debt (its
   *  deposits, loans, customer balances and policy reserves are its business; reviewers, Nov 26: KEY, TRV, FVCB; OPRT, NAVI, GS). */
  sectorKind?: "bank" | "lender" | "broker" | "insurer";
  /** The filer's SEC industry code is a bank's, broker's or insurer's (6000-6799, not a REIT): no free-cash-flow score from any source. */
  financeSic?: true;
  /** No free-cash-flow margin is scored: a bank, broker or insurer (finance), or cash flow above the revenue itself (aboveRevenue: an
   *  upfront licence payment or customer deposits, ROIV 1,692%, LEXX on $5k of revenue). The screen says why. */
  fcfWithheld?: "finance" | "aboveRevenue";
  /** Pre-revenue because its newest quarter's revenue is filed as zero (it had revenue earlier). */
  zeroQuarter?: true;
  /** A pre-revenue company's balance sheet from an annual (12) or half-year (6) foreign report: its age limit (hasRecentBalance). */
  balanceMonths?: 6 | 12;
  /** Pre-revenue figures from the filings (comparison-alternatives.ts). */
  preRevenueMetrics?: import("./comparison-alternatives").PreRevenueMetrics;
  /** A bank's, insurer's, broker's or BDC's figures (finance SIC, or a company filing net investment income). */
  sectorMetrics?: import("./comparison-alternatives").SectorMetrics;
  /** "annual": quarterFcfMargin is the latest fiscal year's (the quarter's cash flows are not available). */
  fcfPeriod?: "annual";
  /** "annual": quarterMargins holds four fiscal years (a foreign filer reporting yearly or half-yearly), not four quarters. */
  marginPeriod?: "annual";
  /** Revenue of those same four consecutive quarters added up (for price-to-sales). Null unless all four are present. */
  quarterRevenueTtm?: number | null;
  /** Revenue growth against the quarter just before (%), for a company with no revenue a year earlier. */
  quarterRevenueQoq?: number | null;
  quarterFcfMargin?: number | null; quarterStockCompensationRatio?: number | null; quarterDilutedSharesGrowth?: number | null;
  /** Diluted weighted-average shares of that same quarter (for price-to-sales from the filing when the provider's statistics are not cached). */
  quarterDilutedShares?: number | null;
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
/** A bank's revenue worked out from the same filing: net interest income plus noninterest income (it tags no revenue line). */
export const BANK_REVENUE = "TechPhaseBankRevenue";
/** A lender or mortgage REIT that tags neither a revenue line nor noninterest income (AGNC, ADAM, AOMR): its net interest income, else its
 *  interest and dividend income. Only for a company whose SEC industry code is finance (SIC 6000-6799), so a drug developer's interest on
 *  its cash is never read as revenue (Nov 26 audit). */
export const LENDER_REVENUE = "TechPhaseLenderRevenue";
/** A landlord whose revenue is tagged only as lease income (AMH: OperatingLeaseLeaseIncome since 2021). Real estate SIC (6500-6599, 6798). */
export const LEASE_REVENUE = "TechPhaseLeaseRevenue";
/** An IFRS bank (20-F): net interest income plus net fee and commission income of the same period and filing. */
export const IFRS_BANK_REVENUE = "TechPhaseIfrsBankRevenue";
/** An IFRS filer's one revenue line that names what it sells (telecommunication services, sales of gold), when the period has no other. */
export const IFRS_SOLE_REVENUE = "TechPhaseIfrsSoleRevenue";
/** A company's own (extension) capital-spending line in its inline XBRL, named plainly as payments for property and equipment. */
export const EXTENSION_CAPEX = "TechPhaseExtensionCapex";
/** Codes inside the finance range whose companies run ordinary businesses (fourth review, Nov 26): payment processors (6099, "functions related
 *  to depository banking": EEFT) and health insurers (6324, "hospital and medical service plans": UNH, CI, ELV), whose operating income,
 *  free cash flow and cash against debt mean what they mean for any company. They are measured as ordinary companies. */
const ordinarySic = (sic?: string) => sic === "6099" || sic === "6324";
/** Which financial firm the filer is, by its SEC industry code (see Financials.sectorKind): a bank (6000-6098), a lender or finance company
 *  (6100-6199: consumer lenders and card issuers such as OPRT, SYF, AXP), a broker, dealer or exchange (6200-6299: GS, MS, SCHW, NAVI's
 *  6211) or an insurer (6300-6411). Not the ordinary businesses above. */
export function sectorKindOf(sic?: string): "bank" | "lender" | "broker" | "insurer" | undefined {
  if (!/^\d{4}$/.test(sic ?? "") || ordinarySic(sic)) return undefined;
  const n = Number(sic);
  return n >= 6000 && n <= 6099 ? "bank" : n >= 6100 && n <= 6199 ? "lender" : n >= 6200 && n <= 6299 ? "broker" : n >= 6300 && n <= 6411 ? "insurer" : undefined;
}
/** The SEC industry code of the filer (submissions "sic"), for the sector-only revenue lines above. */
const financeSic = (sic?: string) => /^\d{4}$/.test(sic ?? "") && Number(sic) >= 6000 && Number(sic) <= 6799 && !ordinarySic(sic);
const realEstateSic = (sic?: string) => /^\d{4}$/.test(sic ?? "") && (Number(sic) === 6798 || (Number(sic) >= 6500 && Number(sic) <= 6599));
/** Revenue lines used only when a period has no other revenue line: a bank's derived revenue; a business development company's total
 *  investment income (Ares Capital, Main Street); an IFRS filer's sales of goods (Novartis, Sanofi tag no total "Revenue"); an IFRS bank's
 *  total operating income (HSBC: its reported revenue, $65.9bn for 2024, tagged as revenue and operating income). */
const LAST_REVENUE_FALLBACK = "RevenueAndOperatingIncome";
// A gas or electric utility that tags only its regulated operating revenue (Southwest Gas, ONE Gas) uses that line when it has no total.
// An advisory firm that tags its revenue only as investment banking revenue (Moelis: $425.6m for Q3 2026, its total revenues line) uses it
// when the period has no other revenue line; after a lender's net interest income, so a bank's fee line is never read as its revenue.
const REVENUE_FALLBACKS: string[] = [BANK_REVENUE, "GrossInvestmentIncomeOperating", "RevenueFromSaleOfGoods", LENDER_REVENUE, "InvestmentBankingRevenue", LEASE_REVENUE, "RegulatedOperatingRevenue", IFRS_BANK_REVENUE, "InsuranceRevenue", IFRS_SOLE_REVENUE, LAST_REVENUE_FALLBACK];
const PRETAX_TAGS = ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"];
/** The same figure filed in full and rounded (differing by at most 0.05%) is one figure: the most precise row (fewest trailing zeros) alone.
 *  Rows that differ more are returned as they are, so the caller still holds them as a conflict. */
function roundedOnce<T extends { value: number }>(values: T[]): T[] {
  const amounts = values.map(f => f.value), top = Math.max(...amounts.map(Math.abs));
  if (values.length < 2 || new Set(amounts).size === 1) return values;
  if (top === 0 || (Math.max(...amounts) - Math.min(...amounts)) / top > 0.0005) return values;
  const precision = (n: number) => { let p = 0; while (p < 15 && n % 10 ** (p + 1) === 0) p++; return p; };   // trailing zeros: fewer = more precise
  return [[...values].sort((a, b) => precision(a.value) - precision(b.value))[0]];
}
/** Borrowing lines whose names overlap (short-term borrowings, notes and loans payable, commercial paper, a bank's borrowed funds and
 *  advances): lines that add up (within 0.5%) to a total filed beside them are its parts; a line marked as a part of a total that is filed
 *  and at least as large is inside it; and an amount equal (within 0.1%) to one already kept is the same borrowing filed twice, except for a
 *  line of its own kind (distinct: a credit line), which only ever counts as a part of a sum. The amounts to add are returned. */
/** True when `value` equals (within 0.5%) one of `lines` or the sum of two or three of them. */
export function matchesLines(value: number, lines: number[]): boolean {
  const near = (sum: number) => Math.abs(sum - value) <= 0.005 * Math.max(Math.abs(value), Math.abs(sum));
  const n = lines.length;
  for (let i = 0; i < n; i++) {
    if (near(lines[i])) return true;
    for (let j = i + 1; j < n; j++) {
      if (near(lines[i] + lines[j])) return true;
      for (let k = j + 1; k < n; k++) if (near(lines[i] + lines[j] + lines[k])) return true;
    }
  }
  return false;
}
export function overlappingLines(lines: { value: number | null; total?: boolean; partOf?: (number | null)[]; distinct?: boolean }[]): number[] {
  type Line = { value: number; total?: boolean; partOf?: (number | null)[]; distinct?: boolean };
  let kept = lines.filter((l): l is Line => l.value !== null);
  // Parts that add up to a total (CBAN: advances of $200.0m and other long-term debt of $63.2m beside borrowings of $263.2m; UFG: commercial
  // paper and a credit line beside short-term borrowings of $4.2m).
  for (const total of kept.filter(l => l.total && l.value > 0)) {
    const others = kept.filter(l => l !== total && l.value > 0 && l.value < total.value);
    let parts: Line[] | null = null;
    const pick = (from: number, chosen: Line[], size: number): Line[] | null => {
      if (chosen.length === size) return Math.abs(chosen.reduce((a, l) => a + l.value, 0) - total.value) <= 0.005 * total.value ? chosen : null;
      for (let i = from; i < others.length; i++) { const found = pick(i + 1, [...chosen, others[i]], size); if (found) return found; }
      return null;
    };
    for (let size = 2; size <= Math.min(3, others.length) && !parts; size++) parts = pick(0, [], size);
    if (parts) kept = kept.filter(l => !parts!.includes(l));
  }
  kept = kept.filter(l => !(l.partOf ?? []).some(t => t !== null && t > 0 && l.value <= t * 1.001));
  const same = (a: number, b: number) => Math.abs(a - b) <= 0.001 * Math.max(Math.abs(a), Math.abs(b));
  const out: Line[] = [];
  for (const l of kept) if (l.distinct || l.value === 0 || !out.some(o => !o.distinct && same(o.value, l.value))) out.push(l);
  return out.map(l => l.value);
}
type RawFact = { val: number; end: string; start?: string; accn: string; filed: string; form: string };
/** Adds figures the scorecard needs that a filing states in another form, period by period and filing by filing, never across filings:
 *  - operating income: gross profit − operating expenses; revenue − cost of revenue − operating expenses; revenue − total costs and expenses;
 *    revenue − operating expenses (only when the filing shows no cost-of-revenue line); last, pre-tax income under its own tag;
 *  - cash: cash including restricted cash, when the plain cash line is not tagged (GEV).
 * Only USD (or the filing's single currency) duration facts with a start; nothing is added where the stated tag exists. */
function supplementFacts(usGaap: Record<string, unknown>, sic?: string): Record<string, unknown> {
  const facts = { ...usGaap };
  const list = (tag: string): [string, RawFact[]][] => Object.entries(obj(obj(facts[tag]).units)).flatMap(([unit, values]) => Array.isArray(values) ? [[unit, values as RawFact[]]] : []);
  const key = (f: RawFact) => `${f.accn}|${f.start ?? ""}|${f.end}`;
  const index = (tags: string[]) => { const m = new Map<string, Map<string, RawFact>>(); for (const tag of tags) for (const [unit, values] of list(tag)) for (const f of values) { if (typeof f.val !== "number") continue; const u = m.get(unit) ?? new Map(); if (!u.has(key(f))) u.set(key(f), f); m.set(unit, u); } return m; };
  const add = (tag: string, unit: string, rows: RawFact[]) => { if (rows.length) facts[tag] = { units: { [unit]: rows } }; };
  // A bank tags no revenue line (Truist, most regional banks): its revenue is net interest income plus noninterest income of the same period
  // and filing. Used only where the filing has no revenue line of its own for that period (see REVENUE_FALLBACKS).
  const interest = index(["InterestIncomeExpenseNet"]), noninterest = index(["NoninterestIncome"]);
  const bankRows: Record<string, RawFact[]> = {};
  for (const [unit, rows] of interest) for (const [k, r] of rows) { const n = noninterest.get(unit)?.get(k); if (r.start && n && r.val + n.val > 0) (bankRows[unit] ??= []).push({ ...r, val: r.val + n.val }); }
  if (Object.keys(bankRows).length) facts[BANK_REVENUE] = { units: bankRows };
  // Sector-only lines (see LENDER_REVENUE, LEASE_REVENUE): the first tag the company uses, as filed, never a sum of different lines.
  const firstTag = (names: string[], target: string) => {
    for (const name of names) { const rows = list(name).filter(([, values]) => values.some(f => typeof f.val === "number" && f.val > 0 && f.start)); if (rows.length) { facts[target] = { units: Object.fromEntries(rows.map(([unit, values]) => [unit, values.filter(f => f.start)])) }; return; } }
  };
  if (financeSic(sic)) firstTag(["InterestIncomeExpenseNet", "InterestAndDividendIncomeOperating"], LENDER_REVENUE);
  // Net interest income is the revenue only of a lender whose expenses it covers (reviewer, Nov 26): where an operating-expense line of the
  // same period and filing exceeds it, the company earns most of its revenue elsewhere (Nelnet's servicing and education fees: −211%
  // "margin"; Bakkt's interest on cash beside $2.3bn of crypto revenue: −3,749%), and that period gets no lender revenue.
  if (facts[LENDER_REVENUE]) {
    // Lines without interest expense only: a lender's total costs and expenses include its interest, which net interest income is after.
    const expenses = index(["OperatingExpenses", "NoninterestExpense", "SellingGeneralAndAdministrativeExpense", "GeneralAndAdministrativeExpense"]);
    const kept = Object.fromEntries(Object.entries(obj(obj(facts[LENDER_REVENUE]).units)).map(([unit, values]) => [unit, (values as RawFact[]).filter(f => {
      const k = key(f);
      return ![...expenses.entries()].some(([u, rows]) => u === unit && (rows.get(k)?.val ?? -Infinity) > f.val);
    })]).filter(([, values]) => (values as RawFact[]).length));
    if (Object.keys(kept).length) facts[LENDER_REVENUE] = { units: kept }; else delete facts[LENDER_REVENUE];
  }
  if (realEstateSic(sic)) firstTag(["OperatingLeaseLeaseIncome", "OperatingLeasesIncomeStatementLeaseRevenue", "RealEstateRevenueNet"], LEASE_REVENUE);
  const stated = index(["OperatingIncomeLoss"]);
  // Totals first (reviewer, Nov 26: BRK's contract revenue less its total costs, divided by its total revenues, showed −16.2% for a +13.5%
  // operating margin): the operating figure is worked out from the same line the screen divides it by.
  const revenue = index(["Revenues", "RevenuesNetOfInterestExpense", "RegulatedAndUnregulatedOperatingRevenue", "SalesRevenueNet", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", BANK_REVENUE, "GrossInvestmentIncomeOperating", LENDER_REVENUE, "InvestmentBankingRevenue", LEASE_REVENUE, "RegulatedOperatingRevenue"]);
  const gross = index(["GrossProfit"]), opex = index(["OperatingExpenses"]), cost = index(["CostOfRevenue", "CostOfGoodsAndServicesSold"]), costs = index(["CostsAndExpenses"]);
  const sga = index(["SellingGeneralAndAdministrativeExpense"]), rnd = index(["ResearchAndDevelopmentExpense"]), interestOperating = index(["InterestExpenseOperating"]);
  const pretax = index(PRETAX_TAGS), investmentRevenue = index(["GrossInvestmentIncomeOperating"]);
  // Items outside operations named in the filing, by period (their sizes added): derivative, investment and disposal gains or losses,
  // impairments, debt extinguishment, other non-operating income and interest expense. Per-share and tax-effect lines are not counted.
  const nonOperating = new Map<string, Map<string, number>>();
  for (const tag of Object.keys(facts)) {
    if (!/(?:Derivative|Hedg|Investment|Sale|Disposal|Divestiture|Extinguishment|FairValue|ForeignCurrency).*Gain|Gain.*(?:Derivative|Hedg|Investment|Sale|Disposal|Extinguishment|FairValue)|GainsLosses|Impairment|NonoperatingIncomeExpense|^InterestExpense(?:Nonoperating|Debt)?$/.test(tag)
      || /PerShare|PerDiluted|PerBasic|Tax|Policy|TextBlock|Accumulated|Cumulative|Reclassification|Receivable|Payable|OtherComprehensive|Unrecognized|Deferred|Percentage|Assets?$|Liabilit/.test(tag)) continue;
    for (const [unit, values] of list(tag)) for (const f of values) {
      if (!f.start || typeof f.val !== "number") continue;
      const u = nonOperating.get(unit) ?? new Map<string, number>(); u.set(key(f), (u.get(key(f)) ?? 0) + Math.abs(f.val)); nonOperating.set(unit, u);
    }
  }
  // No pre-tax line (Allstate, Principal tag only net income and the tax): income from continuing operations plus income tax of the same
  // period and filing. Net income stands in only for a period with no discontinued operations (fourth review, Nov 26: AFCG's net income held
  // a $0.28-a-share gain on discontinued operations, a 79.5% "pre-tax margin"); net income attributable to the parent only when no
  // non-controlling interest is filed for the period, since the tax line is the whole group's.
  {
    const continuing = index(["IncomeLossFromContinuingOperations"]), profit = index(["ProfitLoss"]), parent = index(["NetIncomeLoss"]), tax = index(["IncomeTaxExpenseBenefit"]);
    const keysOf = (pattern: RegExp) => new Set(Object.keys(facts).filter(tag => pattern.test(tag)).flatMap(tag => list(tag).flatMap(([, values]) => values.filter(f => f.start && typeof f.val === "number" && f.val !== 0).map(key))));
    const discontinued = keysOf(/^(?:IncomeLossFromDiscontinuedOperation|DiscontinuedOperation(?:IncomeLoss|GainLoss))/), minority = keysOf(/^(?:NetIncomeLossAttributableToNoncontrollingInterest|NetIncomeLossAttributableToNonredeemableNoncontrollingInterest|NetIncomeLossAttributableToRedeemableNoncontrollingInterest|MinorityInterestInNetIncomeLossOfConsolidatedEntities)$/);
    for (const [unit, rows] of tax) for (const [k, t] of rows) {
      if (!t.start || pretax.get(unit)?.has(k)) continue;
      const own = parent.get(unit)?.get(k), group = profit.get(unit)?.get(k);
      const n = continuing.get(unit)?.get(k) ?? (discontinued.has(k) ? undefined : group ?? (own && !minority.has(k) ? own : undefined));
      if (n) { const u = pretax.get(unit) ?? new Map<string, RawFact>(); u.set(k, { ...n, val: n.val + t.val }); pretax.set(unit, u); }
    }
  }
  const derived: Record<string, RawFact[]> = {}, pre: Record<string, RawFact[]> = {};
  // A lender's net interest income is already net of interest expense: its operating result is its pre-tax income (reviewer, Nov 26), never
  // net interest income less every expense line.
  const others = index(["Revenues", "RevenuesNetOfInterestExpense", "RegulatedAndUnregulatedOperatingRevenue", "SalesRevenueNet", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", BANK_REVENUE, "GrossInvestmentIncomeOperating", "InvestmentBankingRevenue", LEASE_REVENUE, "RegulatedOperatingRevenue"]);
  // An insurer's "operating income" line is often its non-GAAP adjusted earnings (reviewer, Nov 26: MET): insurers (SIC 6300-6411) are scored
  // on pre-tax income only.
  const insurer = sectorKindOf(sic) === "insurer";
  if (insurer) delete facts.OperatingIncomeLoss;
  for (const [unit, rows] of revenue) for (const [k, r] of rows) {
    if (!r.start || (!insurer && stated.get(unit)?.has(k))) continue;
    if (insurer || !others.get(unit)?.has(k)) { const p = pretax.get(unit)?.get(k); if (p) (pre[unit] ??= []).push({ ...r, val: p.val }); continue; }
    const g = gross.get(unit)?.get(k), c = cost.get(unit)?.get(k), t = costs.get(unit)?.get(k);
    // An "operating expenses" line smaller than the selling, general and administrative or R&D line of the same period is only one item, not
    // the total (reviewer, Nov 26: CC's $2m line left SG&A out of its operating income); it is not used.
    const oRaw = opex.get(unit)?.get(k), part = Math.max(sga.get(unit)?.get(k)?.val ?? 0, rnd.get(unit)?.get(k)?.val ?? 0);
    const o = oRaw && oRaw.val >= part ? oRaw : undefined;
    // Interest classified inside the costs (Realty Income: InterestExpenseOperating, $334m in costs and expenses of $1,286m) is a financing
    // cost, not an operating one (reviewer, Nov 26): it is added back. Never for a finance company, whose interest is its cost of revenue.
    // Not for an investment company either (fourth review, Nov 26: SCM's borrowing cost added back made 69% of a 32% net investment margin).
    const interest = (!financeSic(sic) || realEstateSic(sic)) && !investmentRevenue.get(unit)?.has(k) ? interestOperating.get(unit)?.get(k)?.val ?? 0 : 0;
    const base = g && o ? g.val - o.val : c && o ? r.val - c.val - o.val : t ? r.val - t.val : o && !c && !g ? r.val - o.val : null;
    const value = base === null ? null : base + interest;
    const p = pretax.get(unit)?.get(k);
    // A worked-out figure that disagrees with the same period's pre-tax income in sign, or by more than a quarter of revenue, was built from
    // a partial expense line (reviewer, Nov 26: AFL's 59.3% beside 15.3% pre-tax, NAVI's 76.3% beside 4.1%): the pre-tax income is used.
    // Always for a financial firm. For any other company only when the worked-out figure is the higher one and the filing names no
    // non-operating item of that period that accounts for at least half the gap (fourth review, Nov 26: PROP's 49.4% operating margin
    // beside hedging losses of $134m, SCM's net investment income beside unrealized losses, were replaced by a pre-tax loss).
    const disagrees = value !== null && !!p && ((p.val !== 0 && Math.sign(value) !== Math.sign(p.val)) || Math.abs(value - p.val) > 0.25 * Math.abs(r.val));
    const implausible = disagrees && (financeSic(sic) || (value! > p!.val && (nonOperating.get(unit)?.get(k) ?? 0) < 0.5 * (value! - p!.val)));
    if (value !== null && Number.isFinite(value) && !implausible) { (derived[unit] ??= []).push({ ...r, val: value }); continue; }
    if (p) (pre[unit] ??= []).push({ ...r, val: p.val });
  }
  for (const [unit, rows] of Object.entries(derived)) add(DERIVED_OPERATING, unit, rows);
  // Pre-tax income only fills a period with no operating figure of any kind (KLAC stopped tagging one); the stability series never mixes the two.
  for (const [unit, rows] of Object.entries(pre)) add(DERIVED_PRETAX, unit, rows);
  // Cash: a filing that states only cash including restricted cash for a date (SBUX, GILD; PCAR's variant also counts held-for-sale units) has
  // that figure used for that date and filing; a date with the plain cash line keeps it.
  const plain = index(["CashAndCashEquivalentsAtCarryingValue"]);
  const broad = index(["CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsIncludingDisposalGroupAndDiscontinuedOperations"]);
  const cashRows: Record<string, RawFact[]> = Object.fromEntries([...plain].map(([unit, rows]) => [unit, [...rows.values()]]));
  for (const [unit, rows] of broad) for (const [k, f] of rows) if (!f.start && !plain.get(unit)?.has(k)) (cashRows[unit] ??= []).push(f);
  if (Object.values(cashRows).some(rows => rows.length)) facts.CashAndCashEquivalentsAtCarryingValue = { units: cashRows };
  return facts;
}
/** IFRS filers: pre-tax profit for a period that has revenue but no operating-profit line in the same filing (an IFRS bank or insurer presents
 *  no operating result). Labelled as a pre-tax margin, as for US filers; nothing is added where the operating line exists. */
function supplementIfrs(ifrs: Record<string, unknown>): Record<string, unknown> {
  const facts = { ...ifrs };
  // An IFRS bank tags no revenue line: net interest income plus net fee and commission income, same period, filing and currency (BBD, BSAC).
  {
    const keyOf = (unit: string, f: RawFact) => `${unit}|${f.accn}|${f.start ?? ""}|${f.end}`;
    const fees = new Map<string, RawFact>();
    for (const [unit, values] of Object.entries(obj(obj(facts.FeeAndCommissionIncomeExpense).units))) if (Array.isArray(values)) for (const f of values as RawFact[]) if (f.start && typeof f.val === "number") fees.set(keyOf(unit, f), f);
    const out: Record<string, RawFact[]> = {};
    for (const [unit, values] of Object.entries(obj(obj(facts.InterestRevenueExpense).units))) if (Array.isArray(values)) for (const f of values as RawFact[]) {
      const fee = f.start && typeof f.val === "number" ? fees.get(keyOf(unit, f)) : undefined;
      if (fee && f.val + fee.val > 0) (out[unit] ??= []).push({ ...f, val: f.val + fee.val });
    }
    if (Object.keys(out).length) facts[IFRS_BANK_REVENUE] = { units: out };
  }
  // An IFRS filer whose only revenue line names what it sells (Nov 28 audit: VIV's telecommunication services, R$59.6bn for 2025; BTG's sales
  // of gold; BWLP's transport services) had no revenue at all. Such a line is the period's revenue only when it is the one revenue line of
  // that period, filing and currency (no total, no sales of goods, no second kind of sale, no related party's).
  {
    const standard = ["Revenue", "RevenueFromContractsWithCustomers", "RevenueFromSaleOfGoods", IFRS_BANK_REVENUE, "InsuranceRevenue", "RevenueAndOperatingIncome"];
    const keyOf = (unit: string, f: RawFact) => `${unit}|${f.accn}|${f.start ?? ""}|${f.end}`;
    const taken = new Set(standard.flatMap(tag => Object.entries(obj(obj(facts[tag]).units)).flatMap(([unit, values]) => Array.isArray(values) ? (values as RawFact[]).map(f => keyOf(unit, f)) : [])));
    const byPeriod = new Map<string, { unit: string; tag: string; fact: RawFact }[]>();
    for (const tag of Object.keys(facts).filter(t => /^RevenueFrom(?:RenderingOf[A-Za-z]*Services|SaleOf(?!Goods)[A-Za-z]+)$/.test(t) && !/RelatedParty/.test(t)))
      for (const [unit, values] of Object.entries(obj(obj(facts[tag]).units))) if (Array.isArray(values)) for (const f of values as RawFact[]) {
        if (!f.start || typeof f.val !== "number" || f.val <= 0 || taken.has(keyOf(unit, f))) continue;
        const key = keyOf(unit, f), list = byPeriod.get(key) ?? [];
        list.push({ unit, tag, fact: f });
        byPeriod.set(key, list);
      }
    const out: Record<string, RawFact[]> = {};
    for (const lines of byPeriod.values()) if (new Set(lines.map(l => l.tag)).size === 1 && new Set(lines.map(l => l.fact.val)).size === 1) (out[lines[0].unit] ??= []).push(lines[0].fact);
    // A line the company no longer files (SLSR: $1.5m of copper sales in 2024, no revenue in its 2025 report) says nothing about its latest
    // year; it is not used at all, so a company with no revenue now stays measured as one.
    const newest = (rows: RawFact[]) => rows.reduce((m, f) => f.start && f.end > m ? f.end : m, "");
    const profitEnd = newest(Object.values(obj(obj(facts.ProfitLoss).units)).flatMap(v => Array.isArray(v) ? v as RawFact[] : []));
    if (Object.keys(out).length && newest(Object.values(out).flat()) >= profitEnd) facts[IFRS_SOLE_REVENUE] = { units: out };
  }
  const rows = (tag: string): [string, RawFact[]][] => Object.entries(obj(obj(facts[tag]).units)).flatMap(([unit, values]) => Array.isArray(values) ? [[unit, values as RawFact[]]] : []);
  const key = (unit: string, f: RawFact) => `${unit}|${f.accn}|${f.start ?? ""}|${f.end}`;
  const stated = new Set(rows("ProfitLossFromOperatingActivities").flatMap(([unit, values]) => values.map(f => key(unit, f))));
  const revenue = new Set(["Revenue", "RevenueFromContractsWithCustomers", "RevenueFromSaleOfGoods", IFRS_BANK_REVENUE, "InsuranceRevenue", IFRS_SOLE_REVENUE, "RevenueAndOperatingIncome"].flatMap(tag => rows(tag).flatMap(([unit, values]) => values.map(f => key(unit, f)))));
  const pre: Record<string, RawFact[]> = {};
  for (const [unit, values] of rows("ProfitLossBeforeTax")) for (const f of values) {
    if (typeof f.val === "number" && f.start && revenue.has(key(unit, f)) && !stated.has(key(unit, f))) (pre[unit] ??= []).push(f);
  }
  if (Object.keys(pre).length) facts[DERIVED_PRETAX] = { units: pre };
  return facts;
}
/** The currency a filing reports in: the one most of its monetary facts use. A foreign filer may add a convenience translation of a few lines
 *  (TSM's US dollars, a Japanese filer's dollars); that never outnumbers the native figures of the same filing. Null when no currency clearly
 *  dominates (twice the next one), and the figures are then held as before. */
export function dominantCurrency(facts: Record<string, unknown>, accession: string): string | null {
  const count = new Map<string, number>();
  for (const basis of ["us-gaap", "ifrs-full"]) for (const tag of Object.values(obj(facts[basis]))) for (const [unit, values] of Object.entries(obj(obj(tag).units))) {
    if (!/^[A-Z]{3}$/.test(unit) || !Array.isArray(values)) continue;
    const n = values.filter(v => obj(v).accn === accession).length;
    if (n) count.set(unit, (count.get(unit) ?? 0) + n);
  }
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]);
  return ranked.length && (ranked.length === 1 || ranked[0][1] >= 2 * ranked[1][1]) ? ranked[0][0] : null;
}
const tags = {
  "us-gaap": { revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenuesNetOfInterestExpense", "RegulatedAndUnregulatedOperatingRevenue", BANK_REVENUE, "GrossInvestmentIncomeOperating", LENDER_REVENUE, "InvestmentBankingRevenue", LEASE_REVENUE, "RegulatedOperatingRevenue"], operatingIncome: ["OperatingIncomeLoss", DERIVED_OPERATING, DERIVED_PRETAX], operatingCash: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"], capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireOtherPropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsToAcquireOtherProductiveAssets",
    // Capital spending under its own line (Nov 26 audit: REITs' capital improvements and development, machinery, oil and gas, software).
    // A non-cash disclosure (CapitalExpendituresIncurredButNotYetPaid) is never one of them.
    "PaymentsForCapitalImprovements", "PaymentsToAcquireMachineryAndEquipment", "PaymentsToDevelopRealEstateAssets", "PaymentsToAcquireOilAndGasPropertyAndEquipment",
    "PaymentsToExploreAndDevelopOilAndGasProperties", "PaymentsToAcquireMiningAssets", "PaymentsToDevelopSoftware", "PaymentsForSoftware", "PaymentsForConstructionInProcess",
    // The company's own capital-spending line, read from its inline filing (comparison-filings.ts: UFPT's ufpt:PaymentsToAcquirePropertyAndEquipmentNet).
    EXTENSION_CAPEX], cash: ["CashAndCashEquivalentsAtCarryingValue"], stockCompensation: ["ShareBasedCompensation"], dilutedShares: ["WeightedAverageNumberOfDilutedSharesOutstanding"] },
  // IFRS filers (20-F/40-F/6-K): the pre-tax line only where no operating line is tagged (banks, insurers), shown as a pre-tax margin as for US filers.
  "ifrs-full": { revenue: ["Revenue", "RevenueFromContractsWithCustomers", "RevenueFromSaleOfGoods", IFRS_BANK_REVENUE, "InsuranceRevenue", IFRS_SOLE_REVENUE, "RevenueAndOperatingIncome"], operatingIncome: ["ProfitLossFromOperatingActivities", DERIVED_PRETAX], operatingCash: ["CashFlowsFromUsedInOperatingActivities", "CashFlowsFromUsedInOperatingActivitiesContinuingOperations"], capex: ["PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities", "PurchaseOfPropertyPlantAndEquipment", "PurchaseOfPropertyPlantAndEquipmentIntangibleAssetsOtherThanGoodwillInvestmentPropertyAndOtherNoncurrentAssets"], cash: ["CashAndCashEquivalents"], stockCompensation: [], dilutedShares: ["AdjustedWeightedAverageShares"] },
} as const;
const REVENUE_TOTALS = ["Revenues", "Revenue", "RegulatedAndUnregulatedOperatingRevenue", "RevenuesNetOfInterestExpense"];
/** Standard consolidated facts. Annual and standalone-quarter periods remain separate. */
export function extractFinancials(ticker: string, cik: string, payload: unknown, now = Date.now(), reportingCurrency?: string, primaryRevenueTag?: string, quarterRevenueTag?: string, sic?: string): Financials {
  // A bank, broker or insurer (finance SIC, not a REIT): carried on every answer so that figures from the provider are withheld the same way
  // (reviewer, Nov 26: the provider's statements bypassed the filing's withholding).
  const result: Financials = { ...emptyFinancials(ticker, "unsupported", new Date(now).toISOString()), ...(financeSic(sic) && sic !== "6798" ? { financeSic: true as const } : {}),
    ...(sectorKindOf(sic) ? { sectorKind: sectorKindOf(sic)! } : {}) };
  const root = obj(payload);
  if (Number(root.cik) !== Number(cik)) return result;
  const rawFacts = obj(root.facts);
  const facts: Record<string, unknown> = { ...rawFacts, "us-gaap": supplementFacts(obj(rawFacts["us-gaap"]), sic), "ifrs-full": supplementIfrs(obj(rawFacts["ifrs-full"])) };
  // A bank's income statement line named "Revenues" can be a part of its revenue (First Horizon: $407m beside net interest income of $683m
  // and noninterest income of $276m in the same 10-Q): for a finance company with a derived bank revenue the statement's own line does not
  // narrow the choice; the larger derived total is taken (preferTotal).
  if (financeSic(sic) && (obj(facts["us-gaap"])[BANK_REVENUE] || obj(facts["ifrs-full"])[IFRS_BANK_REVENUE])) { primaryRevenueTag = undefined; quarterRevenueTag = undefined; }
  /** The form of each filing whose facts were read (a foreign filer's 20-F or 40-F lets its annual figures stand as the latest period). */
  const formOf = new Map<string, string>();
  // A fiscal year may also come from a 6-K: a Canadian filer furnishes its audited annual statements, tagged, on Form 6-K beside its 40-F
  // (CNI: its 2025 revenue is only in that 6-K); the period's own length (350-380 days) still decides that it is a year.
  // A quarter is 75 to 120 days: a 16-week fiscal quarter is 111 or 112 days (AAP, ACI, KR, CAVA; Nov 26 audit: their stability and cash
  // flow were empty because that quarter was dropped).
  // "half": a six-month interim period furnished on Form 6-K (a foreign filer that reports twice a year, such as BTI).
  function collect(basis: keyof typeof tags, names: readonly string[], instant = false, period: "annual" | "quarter" | "half" | "ytd9" | "ytd" = "annual", shares = false): (Fact & {filed:string;accession:string})[] {
    return names.flatMap(tag => Object.entries(obj(obj(obj(facts[basis])[tag]).units)).flatMap(([unit, values]) => {
      if ((shares ? unit !== "shares" : !/^[A-Z]{3}$/.test(unit)) || !Array.isArray(values)) return [];
      return values.flatMap(raw => {
        const f = obj(raw);
        if (typeof f.val !== "number" || !Number.isFinite(f.val) || typeof f.end !== "string" || typeof f.filed !== "string" || typeof f.accn !== "string" || !/^\d{10}-\d{2}-\d{6}$/.test(f.accn) || !(period === "quarter" ? ["10-Q", "10-Q/A", "6-K", "6-K/A", "8-K", "8-K/A"] : period === "half" ? ["6-K", "6-K/A"] : period === "ytd9" || period === "ytd" ? ["10-Q", "10-Q/A"] : ["10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A", "6-K", "6-K/A"]).includes(String(f.form))) return [];
        if (!Number.isFinite(day(f.end)) || !Number.isFinite(day(f.filed)) || day(f.filed) > now / 86400000 || day(f.end) > day(f.filed)) return [];
        const fact: Fact & {filed:string;accession:string} = { value: f.val, unit, start: typeof f.start === "string" ? f.start : null, end: f.end, filed: f.filed, accession: f.accn, tag, basis };
        if (instant ? fact.start !== null : duration(fact) < (period === "quarter" ? 75 : period === "half" ? 165 : period === "ytd9" ? 245 : period === "ytd" ? 160 : 350) || duration(fact) > (period === "quarter" ? 120 : period === "half" ? 200 : period === "ytd9" || period === "ytd" ? 290 : 380) || !Number.isFinite(duration(fact))) return [];
        formOf.set(f.accn, String(f.form));
        return [fact];
      });
    }));
  }
  const tagged = (tag: string | undefined) => (f: Fact) => !tag || `${f.basis}:${f.tag}` === tag;
  /** The balance sheet of one filing and date (`anchor`): cash, current assets and liabilities, debt in the first complete form the filing
   *  uses, and shareholders' equity. Used for the latest period with revenue and, for a company with no revenue yet, for its latest balance
   *  sheet alone (owner, Nov 26: financial strength must not depend on a revenue figure). */
  function balanceSnapshot(basis: keyof typeof tags, anchor: Fact & { filed: string | null; accession: string | null }, balancePeriod: "annual" | "quarter" | "half"): BalanceSnapshot {
    const unique = (values: Fact[]) => values.length && new Set(values.map(f => `${f.start}/${f.end}/${f.value}/${f.unit}`)).size === 1 ? values[0] : null;
    const filingUrl = (f: Fact) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accession!.replaceAll("-", "")}/${f.accession}-index.htm`;
    function balanceMetric(name: string): Fact | null {
      const ifrsNames: Record<string, string> = { CashAndCashEquivalentsAtCarryingValue: "CashAndCashEquivalents", AssetsCurrent: "CurrentAssets", LiabilitiesCurrent: "CurrentLiabilities" };
      const tag = basis === "us-gaap" ? name : ifrsNames[name] ?? (name.startsWith("ifrs:") ? name.slice(5) : undefined);
      if (!tag) return null;
      return unique(collect(basis, [tag], true, balancePeriod).filter(f => f.end === anchor.end && f.accession === anchor.accession && f.unit === anchor.unit && f.value >= 0));
    }
    const currentAssets = balanceMetric("AssetsCurrent"), currentLiabilities = balanceMetric("LiabilitiesCurrent");
    // Financial strength was "—" for most companies (MU, ALAB, CRDO, SNDK, BE, HIMS..., owner Nov 14) because only the split current/noncurrent
    // long-term debt pair counted. The first complete form the filing uses is taken; forms are never mixed.
    /** Borrowings filed under their own lines when no total form exists (Nov 26 audit: 506 companies tag LineOfCredit, NotesPayable,
     *  LoansPayable, SeniorNotes, SecuredDebt, ...): each family once, its total line or else its current plus non-current parts, then the
     *  families added. The classification families (senior, unsecured, secured, subordinated) can overlap the instrument families, so they
     *  are used only when no instrument family is filed, and unsecured and senior notes are never added to each other. Null when none. */
    function borrowingLines(m: (name: string) => Fact | null): number | null {
      const family = (total: string, ...parts: string[]) => { const t = m(total); if (t) return t.value; const p = parts.map(m).filter((f): f is Fact => !!f); return p.length ? p.reduce((a, f) => a + f.value, 0) : null; };
      const counted: number[] = [];
      const add = (value: number | null) => { if (value !== null) counted.push(value); };
      const notes = family("NotesPayable", "NotesPayableCurrent", "LongTermNotesPayable"), debtCurrent = family("DebtCurrent");
      const senior = family("SeniorNotes", "SeniorNotesCurrent", "SeniorLongTermNotes"), seniorCurrent = m("SeniorNotesCurrent")?.value ?? null;
      // When the current debt is the current part of the senior notes (TEVA: SeniorNotesCurrent = DebtCurrent = $4.0bn), the senior notes'
      // total stands in for it.
      const currentIsSenior = senior !== null && debtCurrent !== null && seniorCurrent === debtCurrent;
      // Families found unread in the third review's universe-wide scan (Nov 26): loans and notes payable to banks, other notes and loans,
      // notes and loans payable, short-term bank and non-bank loans, convertible debt, commercial paper at carrying value.
      // A sub-line (other notes, notes to banks; other loans, loans to banks) is a part of its parent total and is read only without it (PHM's
      // other notes payable of $25m are inside its notes payable of $1,809m).
      const loans = family("LoansPayable", "LoansPayableCurrent", "LongTermLoansPayable");
      const notesParts = notes !== null ? [] : [family("OtherNotesPayable", "OtherNotesPayableCurrent", "OtherLongTermNotesPayable"), family("NotesPayableToBank", "NotesPayableToBankCurrent", "NotesPayableToBankNoncurrent")];
      const loansParts = loans !== null ? [] : [family("OtherLoansPayable", "OtherLoansPayableCurrent", "OtherLoansPayableLongTerm"), family("LoansPayableToBank", "LoansPayableToBankCurrent", "LoansPayableToBankNoncurrent")];
      // Lines whose names overlap: one borrowing can be filed under several of them (fourth review, Nov 26: HYPD's notes payable and short-term
      // bank loans, NRXS's short-term borrowings and current notes, LSE's loans and short-term borrowings, WAFD's advances and other long-term
      // debt, each the same amount; XYF's and LZMH's short-term borrowings and their bank and non-bank parts; PFS's borrowed funds and the
      // advances, short-term and long-term borrowings inside them). Among these lines, an amount equal to one already counted is counted once,
      // and the parts of a total filed beside it are not added (see overlapping below).
      const shortTotal = m("ShortTermBorrowings")?.value ?? null, borrowedFunds = family("OtherBorrowings");
      const advances = family("AdvancesFromFederalHomeLoanBanks", "FederalHomeLoanBankAdvancesLongTerm", "FederalHomeLoanBankAdvancesShortTerm");
      const overlapping = overlappingLines([
        { value: notes }, { value: loans }, { value: shortTotal, total: true }, { value: borrowedFunds, total: true }, { value: advances, partOf: [borrowedFunds] },
        { value: family("OtherShortTermBorrowings"), partOf: [shortTotal, borrowedFunds] }, { value: family("ShortTermBankLoansAndNotesPayable"), partOf: [shortTotal] },
        { value: family("ShortTermNonBankLoansAndNotesPayable"), partOf: [shortTotal] },
        { value: family("CommercialPaper", "CommercialPaperAtCarryingValue", "CommercialPaperNoncurrent"), partOf: [shortTotal] }, { value: family("OtherLongTermDebt", "OtherLongTermDebtCurrent", "OtherLongTermDebtNoncurrent"), partOf: [borrowedFunds] },
        { value: family("LineOfCredit", "LongTermLineOfCredit"), distinct: true },
        ...notesParts.map(value => ({ value })), ...loansParts.map(value => ({ value })), { value: notes === null && loans === null ? family("NotesAndLoansPayable", "NotesAndLoansPayableCurrent") : null },
      ]);
      for (const value of [...overlapping,
        family("WarehouseAgreementBorrowings"), family("ConvertibleDebt", "ConvertibleDebtCurrent", "ConvertibleDebtNoncurrent"),
        currentIsSenior ? null : debtCurrent, family("FinanceLeaseLiability", "FinanceLeaseLiabilityCurrent", "FinanceLeaseLiabilityNoncurrent")]) add(value);
      const instruments = counted.length;
      // Senior and subordinated notes are added (RJF's $3.5bn of senior notes beside its advances; COLB's and HNVR's subordinated debt) unless
      // a notes-payable or current-debt line already holds them (reviewer, Nov 26: PHM's $1.78bn of senior notes inside its $1.81bn of notes
      // payable were counted twice). Unsecured and senior notes are never added to each other.
      const unsecured = family("UnsecuredDebt", "UnsecuredDebtCurrent", "UnsecuredLongTermDebt");
      const contains = (value: number) => !currentIsSenior && ((notes !== null && value <= notes) || (debtCurrent !== null && value <= debtCurrent));
      const classified = unsecured !== null && senior !== null ? Math.max(unsecured, senior) : unsecured ?? senior;
      if (classified !== null && (currentIsSenior || !contains(classified))) add(classified);
      // Secured debt (mortgage notes, secured financing) is its own line beside the others (L-1, Nov 28: ELS's $2.7bn, SLG's $2.5bn and CACC's
      // $5.4bn were dropped because a credit line was filed too; EQR's $1.6bn of mortgage notes beside its notes and commercial paper). It is
      // only a classification of the lines above when it equals one of them or the sum of two or three (AAT's secured note, WTFC's and HST's
      // other borrowings), and then not added again. Where adding it would take the debt above the total liabilities, it holds the other lines
      // (ICON: $34.8m of secured debt beside a $21.0m finance lease, $37.1m of liabilities): the larger of the two is the debt.
      const secured = family("SecuredDebt", "SecuredDebtCurrent", "SecuredLongTermDebt");
      if (secured !== null && (!instruments || !matchesLines(secured, counted.slice(0, instruments)))) {
        const before = counted.reduce((a, b) => a + b, 0), liabilities = m("Liabilities")?.value;
        if (instruments && liabilities !== undefined && before + secured > liabilities && Math.max(before, secured) <= liabilities) { counted.length = 0; add(Math.max(before, secured)); }
        else add(secured);
      }
      const subordinated = family("SubordinatedDebt", "SubordinatedDebtCurrent", "SubordinatedLongTermDebt") ?? family("JuniorSubordinatedNotes", "JuniorSubordinatedLongTermNotes");
      if (subordinated !== null && !contains(subordinated)) add(subordinated);
      return counted.length ? counted.reduce((a, b) => a + b, 0) : null;
    }
    /** Debt above the filing's total liabilities is a double count somewhere (reviewer, Nov 26: ATLC's notes and line of credit, $11.5bn
     *  against $6.9bn of liabilities): it is held as unknown, never shown. */
    function totalDebt(): BalanceSnapshot["debtTotal"] {
      const debt = debtForms(), liabilities = balanceMetric("Liabilities")?.value;
      return debt && liabilities !== undefined && debt.value > liabilities ? null : debt;
    }
    function debtForms(): BalanceSnapshot["debtTotal"] {
      if (basis !== "us-gaap") return ifrsDebt();
      // Short-term borrowings under whichever line the filing uses (SCHW and KEY: other short-term borrowings; NTES: short-term bank loans).
      const m = balanceMetric;
      const current = m("LongTermDebtCurrent"), noncurrent = m("LongTermDebtNoncurrent");
      // Short-term borrowings beside the long-term debt (L-1, Nov 28: the split form left them out, AAPL's $2.0bn of commercial paper, WMT's
      // $10.5bn and CEG's $5.2bn of short-term borrowings, NEE's $6.6bn of commercial paper and other short-term debt): short-term borrowings
      // under whichever line the filing uses (SCHW and KEY: other short-term borrowings; NTES: short-term bank loans), commercial paper and
      // current credit-line borrowings, each part of a short-term total filed beside it counted once (LIN: commercial paper $4.3bn and other
      // $0.3bn inside short-term borrowings of $4.6bn), and none that repeats the current long-term debt (ICE, DVN, LITE, DOV, BRO tag one line
      // as both).
      // A short-term borrowings figure equal to one of those lines is that line, not their total (LNT: its $704m of commercial paper is also
      // tagged as short-term borrowings in a note, beside $400m of other short-term borrowings on the balance sheet: $1,104m).
      const sameAmount = (a: number, b: number) => Math.abs(a - b) <= 0.001 * Math.max(Math.abs(a), Math.abs(b));
      const repeatsCurrent = (value: number | null) => value !== null && current !== null && noncurrent !== null && sameAmount(value, current.value) ? null : value;
      const shortParts = ["ShortTermBankLoansAndNotesPayable", "OtherShortTermBorrowings", "ShortTermNonBankLoansAndNotesPayable", "CommercialPaper", "LinesOfCreditCurrent"].map(name => m(name)?.value ?? null);
      const filedTotal = m("ShortTermBorrowings")?.value ?? null;
      // Within 1%: NOW's $2,086m of short-term borrowings is its $2,100m of commercial paper at carrying value.
      const shortTotal = filedTotal !== null && shortParts.some(v => v !== null && Math.abs(v - filedTotal) <= 0.01 * Math.max(v, filedTotal)) ? null : filedTotal;
      const short = overlappingLines([{ value: repeatsCurrent(shortTotal), total: true }, ...shortParts.map(v => ({ value: repeatsCurrent(v), partOf: [shortTotal] }))]).reduce((a, v) => a + v, 0);
      // The current debt line, where filed, is the whole current side (current maturities and short-term borrowings: PFE, BMY, EMR, BG).
      const debtCurrentLine = m("DebtCurrent");
      // Short-term borrowings that would take the debt above the total liabilities are inside the current debt already (RENX: $20.6m of
      // short-term borrowings within $21.1m of current debt, $32.3m of liabilities); the split figure alone is the debt then.
      const fits = (value: number) => { const liabilities = m("Liabilities")?.value; return liabilities === undefined || value <= liabilities; };
      if (current && noncurrent) {
        const split = noncurrent.value + (debtCurrentLine && debtCurrentLine.value >= current.value ? debtCurrentLine.value : current.value + short);
        return { value: fits(split) ? split : noncurrent.value + current.value, source: "split" };
      }
      const total = m("LongTermDebt");
      // A long-term debt total that is the secured plus unsecured debt (CPT: $4.2bn of notes payable, its $0.6bn of commercial paper inside
      // the unsecured notes), or those and the short-term lines (VMRK: $13.9bn unsecured, $2.0bn secured and $1.0bn of commercial paper make
      // its $17.0bn of notes payable), is all of the debt.
      const classifiedAll = (() => {
        const secured = m("SecuredDebt")?.value, unsecured = m("UnsecuredDebt")?.value;
        return !!total && secured !== undefined && unsecured !== undefined && [secured + unsecured, secured + unsecured + short].some(sum => Math.abs(sum - total.value) <= 0.005 * total.value);
      })();
      // Over the liabilities with every short-term line, the short-term borrowings line alone is tried, as before this audit (HKD: $176.8m of
      // bank loans and $83.3m of short-term borrowings are its $260.1m of current and long-term debt; its other short-term borrowings line is not).
      const shortLine = (m("ShortTermBorrowings") ?? m("ShortTermBankLoansAndNotesPayable") ?? m("OtherShortTermBorrowings"))?.value ?? 0;
      if (total) return { value: classifiedAll ? total.value : [total.value + short, total.value + shortLine].find(fits) ?? total.value, source: "total" };
      // The current debt line (current maturities and short-term borrowings) when no current part of long-term debt is filed (reviewer, Nov 26:
      // PG's $17.0bn, XOM's $4.5bn were left out); it already holds the short-term borrowings.
      const debtCurrent = current ? null : debtCurrentLine;
      const currentPart = (fallback: number) => current?.value ?? debtCurrent?.value ?? fallback;
      if (noncurrent) return { value: noncurrent.value + (debtCurrent ? debtCurrent.value : short), source: "noncurrent" };
      // Long-term notes and loans as the noncurrent line (reviewer, Nov 26: ORCL's $117.7bn, TEVA's $12.7bn), with the current part.
      const notesAndLoans = m("LongTermNotesAndLoans");
      if (notesAndLoans) return { value: notesAndLoans.value + currentPart(m("NotesPayableCurrent")?.value ?? short), source: "split" };
      const carrying = m("DebtInstrumentCarryingAmount");
      if (carrying) return { value: carrying.value + short, source: "carrying" };
      // One line for all debt and finance leases, current maturities included (JPMorgan, ConocoPhillips, United Rentals).
      const allDebt = m("LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities") ?? m("DebtAndCapitalLeaseObligations");
      if (allDebt) return { value: allDebt.value + short, source: "total" };
      const leaseCombined = m("LongTermDebtAndCapitalLeaseObligations");   // noncurrent debt and finance leases, with its current part (APH, LRCX)
      if (leaseCombined) return { value: leaseCombined.value + (m("LongTermDebtAndCapitalLeaseObligationsCurrent")?.value ?? debtCurrent?.value ?? short) + (m("LongTermDebtAndCapitalLeaseObligationsCurrent") ? short : 0), source: "total" };
      const combined = m("DebtLongtermAndShorttermCombinedAmount");
      if (combined) return { value: combined.value, source: "total" };
      const convertibleCurrent = m("ConvertibleDebtCurrent")?.value ?? m("ConvertibleNotesPayableCurrent")?.value ?? null;
      const convertible = m("ConvertibleDebtNoncurrent") ?? m("ConvertibleNotesPayable") ?? m("ConvertibleSeniorNotesPayable") ?? m("ConvertibleLongTermNotesPayable");
      if (convertible) return { value: convertible.value + (convertibleCurrent ?? 0) + short, source: "convertible" };
      if (convertibleCurrent !== null) return { value: convertibleCurrent + short, source: "convertible" };
      const lines = borrowingLines(m);
      if (lines !== null) return { value: lines, source: "lines" };
      // No form found: debt-free only if the filing reports no borrowing, loan or notes figure of any kind (investments in debt securities aside).
      if (!currentAssets || !currentLiabilities || anchor.accession === null) return null;
      // Debt tagged only by segment (GM: automotive and GM Financial, no consolidated line) leaves no borrowing tag at all. Large long-term
      // liabilities then mean the debt is there but untagged, never "debt-free": over a quarter of assets is held as unknown.
      const assets = m("Assets")?.value, equity = m("StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest")?.value ?? m("StockholdersEquity")?.value;
      const sides = m("LiabilitiesAndStockholdersEquity")?.value;
      const liabilities = m("Liabilities")?.value ?? (sides !== undefined && equity !== undefined ? sides - equity : undefined);   // MNST files no total
      const longTermLiabilities = m("LiabilitiesNoncurrent")?.value ?? (liabilities !== undefined ? liabilities - currentLiabilities.value : undefined);
      if (!assets || longTermLiabilities === undefined || longTermLiabilities > assets * 0.25) return null;
      const borrowing = /Debt|Borrowing|NotesPayable|LoansPayable|SeniorNotes|LineOfCredit|CreditFacility/;
      const notBorrowing = /OtherThan|Securities|AvailableForSale|HeldToMaturity|Investment|Receivable|Allowance|Derivative|Hedg|Equity|Discount|Premium|IssuanceCost|Unamortized|Extinguishment|Interest|Repayment|Proceeds|Payments|Maturit|FairValue|Covenant|Percentage|Rate|Valuation|Forgiveness|Conversion/;
      const usGaap = obj(facts["us-gaap"]);
      const mentioned = Object.keys(usGaap).some(tag => borrowing.test(tag) && !notBorrowing.test(tag)
        && Object.values(obj(obj(usGaap[tag]).units)).some(values => Array.isArray(values) && values.some(raw => obj(raw).accn === anchor.accession)));
      return mentioned ? null : { value: 0, source: "none" };
    }
    /** IFRS borrowings at the balance date (BTI): the total line, or its non-current and current parts from the same filing. Lease liabilities
     *  stay out, as for US filers. No "debt-free" inference: an IFRS filing without a borrowing line is left unknown. */
    function ifrsDebt(): BalanceSnapshot["debtTotal"] {
      const m = (tag: string) => balanceMetric(`ifrs:${tag}`);
      const total = m("Borrowings");
      if (total) return { value: total.value, source: "total" };
      const noncurrent = m("NoncurrentPortionOfNoncurrentBorrowings") ?? m("LongtermBorrowings");
      const current = m("CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings") ?? m("ShorttermBorrowings");
      if (noncurrent && current) return { value: noncurrent.value + current.value, source: "split" };
      // Debt-free on the same rule as a US filer (Nov 26 audit: 25 IFRS filers were left unknown): current assets and liabilities are
      // filed, no borrowing line of any kind is in the filing, and non-current liabilities are at most a quarter of total assets.
      if (!currentAssets || !currentLiabilities || anchor.accession === null) return null;
      const assets = m("Assets")?.value, nonCurrent = m("NoncurrentLiabilities")?.value;
      if (!assets || nonCurrent === undefined || nonCurrent > assets * 0.25) return null;
      const ifrs = obj(facts["ifrs-full"]);
      const mentioned = Object.keys(ifrs).some(tag => /Borrowing|Debt|Loans?Payable|NotesPayable|Bonds?Issued|Debentures/.test(tag) && !/Receivable|Investment|Securities|Interest|Repayment|Proceeds|Payments|FairValue|Rate|Equity/.test(tag)
        && Object.values(obj(obj(ifrs[tag]).units)).some(values => Array.isArray(values) && values.some(raw => obj(raw).accn === anchor.accession)));
      return mentioned ? null : { value: 0, source: "none" };
    }
    /** Shareholders' equity of the balance date, negative or not (balanceMetric keeps only values of zero or more, right for cash and debt). */
    function shareholdersEquity(): Fact | null {
      const names = basis === "us-gaap" ? ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"] : ["EquityAttributableToOwnersOfParent", "Equity"];
      for (const tag of names) {
        const found = collect(basis, [tag], true, balancePeriod).filter(f => f.end === anchor.end && f.accession === anchor.accession && f.unit === anchor.unit);
        if (found.length) return unique(found);
      }
      return null;
    }
    const balance: BalanceSnapshot = {
      end: anchor.end, filed: anchor.filed, sourceUrl: filingUrl(anchor),
      cash: balanceMetric("CashAndCashEquivalentsAtCarryingValue"), currentAssets, currentLiabilities,
      currentRatio: currentAssets && currentLiabilities && currentLiabilities.value > 0 ? currentAssets.value / currentLiabilities.value : null,
      debtCurrent: balanceMetric("LongTermDebtCurrent"), debtNoncurrent: balanceMetric("LongTermDebtNoncurrent"),
      shortBorrowings: balanceMetric("ShortTermBorrowings"), leaseCurrent: balanceMetric("OperatingLeaseLiabilityCurrent"), leaseNoncurrent: balanceMetric("OperatingLeaseLiabilityNoncurrent"),
      debtTotal: totalDebt(),
      equity: shareholdersEquity(),
      assets: balanceMetric(basis === "us-gaap" ? "Assets" : "ifrs:Assets"),
    };
    return balance;
  }
  // The statement's revenue line narrows the figures only while it carries the newest positive revenue (Denali's statement line is zero;
  // its collaboration revenue is tagged as contract revenue): otherwise it is not used, rather than falling back to an old year.
  const covers = (rows: Fact[], tag: string | undefined) => { const newest = rows.map(f => f.end).sort().at(-1); return !tag || !newest || rows.some(f => f.end === newest && tagged(tag)(f)); };
  const positiveAnnual = (Object.keys(tags) as (keyof typeof tags)[]).flatMap(b => collect(b, tags[b].revenue)).filter(f => f.value > 0);
  if (!covers(positiveAnnual, primaryRevenueTag)) primaryRevenueTag = undefined;
  const annualRevenues = positiveAnnual
    .filter(f => tagged(primaryRevenueTag)(f)).sort((a,b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
  // No annual report yet (a company listed this year files only 10-Qs; XOM's new holding company has filed under its own CIK since 2026):
  // the latest quarter stands alone and every annual figure stays empty. Before, such a company had no figures at all.
  const quarterOnly = !annualRevenues.length;
  const revenues = quarterOnly ? (Object.keys(tags) as (keyof typeof tags)[]).flatMap(b => collect(b, tags[b].revenue, false, "quarter"))
    .filter(f => f.value > 0).sort((a,b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed)) : annualRevenues;
  const latest = revenues[0];
  /** Any positive revenue-like duration fact (a sales, revenue, premiums, fees or interest-income line other than interest on the company's
   *  own cash) ending after `since` (a day number), in any standard taxonomy. */
  function revenueLikeSince(since: number): boolean {
    // Interest income counts only for a finance company: a drug developer's interest on its cash is tagged the same way (AARD, ALIS).
    const like = financeSic(sic) ? /Revenue|Sales|Premiums(?:Earned|Written)|FeeAndCommissionIncome|InterestAndDividendIncomeOperating|InterestIncomeOperating|InterestAndFeeIncome/ : /Revenue|Sales|Premiums(?:Earned|Written)|FeeAndCommissionIncome/;
    const not = financeSic(sic) ? /Cost|Deferred|Receivable|Unbilled|Remaining|Liabilit|Tax|ProForma|DisposalGroup|Payment|Proceeds|Expense|Gain|Loss|Percent|Unrealized|Investment|Milestone|Agreement|Arrangement|Shares|Stock/
      : /Cost|Deferred|Receivable|Unbilled|Remaining|Liabilit|Tax|ProForma|DisposalGroup|Payment|Proceeds|Expense|Gain|Loss|Percent|Unrealized|Investment|Milestone|Agreement|Arrangement|Shares|Stock|Interest|Credit|NotFromContract/;
    for (const b of ["us-gaap", "ifrs-full"]) for (const [tag, body] of Object.entries(obj(facts[b]))) {
      if (!like.test(tag.replace("AssessedTax", "")) || not.test(tag.replace("AssessedTax", ""))) continue;
      for (const values of Object.values(obj(obj(body).units))) if (Array.isArray(values) && values.some(v => { const f = obj(v); return typeof f.val === "number" && f.val > 0 && typeof f.start === "string" && typeof f.end === "string" && day(f.end) > since; })) return true;
    }
    return false;
  }
  /** A cost of revenue, cost of goods sold or gross profit above zero is proof of revenue even where no revenue line is read (reviewer,
   *  Nov 26: AQMS files cost of goods sold of $2.4m beside a revenue line of zero, AUC cost of revenue and gross profit with no revenue line):
   *  such a company is never called pre-revenue. `quarterEnd`: only a quarter-long figure ending that day. */
  function costProof(since: number, quarterEnd?: string): boolean {
    const names = ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfServices", "GrossProfit", "CostOfSales"];
    for (const b of ["us-gaap", "ifrs-full"]) for (const tag of names) for (const values of Object.values(obj(obj(obj(facts[b])[tag]).units))) {
      if (Array.isArray(values) && values.some(v => { const f = obj(v); if (typeof f.val !== "number" || f.val <= 0 || typeof f.start !== "string" || typeof f.end !== "string") return false;
        if (quarterEnd) { const d = day(f.end) - day(f.start); return f.end === quarterEnd && d >= 75 && d <= 120; }
        return day(f.end) > since; })) return true;
    }
    return false;
  }
  /** The newest balance sheet date with a cash figure (any period), for the pre-revenue test and the pre-revenue figures. */
  function newestBalance() {
    const cashTags = { "us-gaap": ["CashAndCashEquivalentsAtCarryingValue"], "ifrs-full": ["CashAndCashEquivalents"] } as Record<string, string[]>;
    const found = (Object.keys(tags) as (keyof typeof tags)[]).flatMap(b => [...collect(b, cashTags[b] ?? [], true, "quarter").map(f => ({ f, b, period: "quarter" as const })),
      ...collect(b, cashTags[b] ?? [], true).map(f => ({ f, b, period: "annual" as const }))])
      .filter(({ f }) => f.value >= 0 && (!reportingCurrency || f.unit === reportingCurrency))
      .sort((x, y) => y.f.end.localeCompare(x.f.end) || y.f.filed.localeCompare(x.f.filed));
    return found[0] ?? null;
  }
  // No revenue in the twelve months to the newest balance sheet (owner, Nov 26): a drug developer before its first sale, and a company whose
  // sales stopped years ago (ALXO's last revenue was 2020, APVO's 2022), which before had no figures at all because it once had revenue.
  const balanceNow = newestBalance();
  const newestRevenueEnd = [...positiveAnnual, ...(Object.keys(tags) as (keyof typeof tags)[]).flatMap(b => collect(b, tags[b].revenue, false, "quarter")).filter(f => f.value > 0)]
    .map(f => f.end).sort().at(-1);
  // Only when no revenue-like line of any kind is filed for that year either, and never for a bank, insurer or lender (finance SIC), whose
  // revenue may sit under lines the comparison does not read: "no revenue yet" must be true, not a gap in our tag list (BBD: interest
  // income only).
  const stale = !!latest && !!balanceNow && !!newestRevenueEnd && day(newestRevenueEnd) < day(balanceNow.f.end) - 365 && !financeSic(sic)
    && !revenueLikeSince(day(balanceNow.f.end) - 365) && !costProof(day(balanceNow.f.end) - 365);
  // Revenue filed only under a line the comparison does not read (APA's oil and gas revenue, VIV's and TLK's IFRS lines) is not "no revenue
  // yet": the company is left without a current period rather than labelled pre-revenue (Nov 26: they showed 「売上がまだ無い」).
  if (!latest && balanceNow && (revenueLikeSince(day(balanceNow.f.end) - 365) || costProof(day(balanceNow.f.end) - 365))) return result;
  // The newest quarter's revenue line is filed as zero (a drug developer whose collaboration payments ended: KYMR, TNGX, XENE): it is
  // compared like a pre-revenue company, and the screen says the latest quarter had no revenue (zeroQuarter), not "no revenue yet".
  const quarterRows = balanceNow ? (Object.keys(tags) as (keyof typeof tags)[]).flatMap(b => collect(b, tags[b].revenue, false, "quarter")).filter(f => f.end === balanceNow.f.end) : [];
  // A 10-Q that states only the year to date (Relay Therapeutics, Q3 2026: nine months $3.35m, the same as the six months before) filed no
  // revenue for the quarter: the same line, start and currency, unchanged from the previous report's year to date.
  const ytdPairs = balanceNow && !quarterRows.length ? (Object.keys(tags) as (keyof typeof tags)[]).flatMap(b => {
    const ytd = collect(b, tags[b].revenue, false, "ytd"), earlier = [...ytd, ...collect(b, tags[b].revenue, false, "quarter")];
    return ytd.filter(f => f.end === balanceNow.f.end).flatMap(f => earlier.filter(e => e.tag === f.tag && e.unit === f.unit && e.start === f.start && day(f.end) - day(e.end) >= 75 && day(f.end) - day(e.end) <= 120).map(e => f.value - e.value));
  }) : [];
  // A finance company (GPGI, SIC 6199, after selling its operations) counts only when no other revenue-like line is filed for that quarter.
  const zeroQuarter = (quarterRows.length > 0 ? quarterRows.every(f => f.value === 0) : ytdPairs.length > 0 && ytdPairs.every(v => v === 0))
    && (!financeSic(sic) || (!!balanceNow && !revenueLikeSince(day(balanceNow.f.end) - 1))) && !(balanceNow && costProof(0, balanceNow.f.end));
  if (!latest || stale || zeroQuarter) return preRevenue();
  /** No revenue yet: the latest balance sheet alone, so financial strength is still scored, and the company-type figures read from the same
   *  filings (comparison-alternatives.ts: runway, net-loss trend, R&D intensity, dilution). */
  function preRevenue(): Financials {
    const newest = balanceNow;
    if (!newest) return result;
    const balance = balanceSnapshot(newest.b, newest.f, newest.period);
    // A foreign filer's balance sheet comes from its annual report or half-year 6-K: its age limit is that period's (hasRecentBalance).
    const form = formOf.get(newest.f.accession) ?? "";
    const balanceMonths = /^(?:20-F|40-F)/.test(form) ? 12 as const : /^6-K/.test(form) ? 6 as const : undefined;
    const metrics = balance.cash ? preRevenueMetrics(facts, balance.cash.unit, balance.end, balance.cash.value) : undefined;
    return { ...result, status: "ready", preRevenue: true, ...(zeroQuarter ? { zeroQuarter: true } : {}), balance, ...(balanceMonths ? { balanceMonths } : {}), ...(metrics ? { preRevenueMetrics: metrics } : {}) };
  }
  // A verified reporting currency distinguishes native values from convenience
  // translations. Never fall back to an older year if the latest lacks it.
  // US GAAP "Revenues" (or, at banks and brokers, revenue net of interest expense) is the total line and contract revenue is a part of it
  // (Walmart's membership income, GM Financial, lease revenue at Applied Digital and IREN, SoFi's and AmEx's interest income). When both
  // are filed and the total is not below any part, the total is the revenue; a total below a part stays held.
  const preferTotal = <T extends Fact>(filed: T[]): T[] => {
    // Revenue including taxes collected for governments (excise duties) beside revenue excluding them (Cronos: $193.4m gross, $146.6m net
    // revenue for 2025; NRx): the net figure is the revenue, as the standard defines it; the gross line is set aside when it is not below it.
    const excluding = filed.filter(f => f.tag === "RevenueFromContractWithCustomerExcludingAssessedTax"), including = filed.filter(f => f.tag === "RevenueFromContractWithCustomerIncludingAssessedTax");
    const all = excluding.length && including.length && excluding.every(e => including.every(i => i.unit === e.unit && e.value <= i.value))
      ? filed.filter(f => f.tag !== "RevenueFromContractWithCustomerIncludingAssessedTax") : filed;
    // Total operating income comes last of all: it also holds other operating income, so a sales line beside it is the revenue (argenx:
    // sales of goods $4.15bn, revenue and other operating income $4.25bn for 2025).
    // Of the fallback lines, the first in REVENUE_FALLBACKS' order the period has (a lender's net interest income is never mixed with a
    // bank's derived revenue).
    // A bank (finance SIC) whose stated revenue line is only a part of its revenue (Western Alliance: contract revenue $51m, its fee income,
    // beside net interest plus noninterest income of $0.9bn): the derived bank revenue, when it is larger than every stated line.
    // The same for an IFRS bank (BBVA: "revenue and operating income" $127m beside net interest and fee income of billions) and for a landlord
    // whose contract revenue is only its service fees (Camden: $4m beside $0.4bn of lease income).
    for (const derived of [...(financeSic(sic) ? [BANK_REVENUE, IFRS_BANK_REVENUE] : []), ...(realEstateSic(sic) ? [LEASE_REVENUE] : [])]) {
      const rows = all.filter(f => f.tag === derived);
      const stated = all.filter(f => !REVENUE_FALLBACKS.includes(f.tag) || (f.tag === LAST_REVENUE_FALLBACK));
      if (rows.length && new Set(rows.map(f => f.value)).size === 1 && stated.length && stated.every(f => f.value < rows[0].value)) return rows;
    }
    // An IFRS bank that files its total operating income beside net interest and fee income (HSBC H1 2026: $37.7bn against $25.5bn): the
    // larger total is its revenue (reviewer, Nov 26), not the partial derived line.
    const ifrsBank = all.filter(f => f.tag === IFRS_BANK_REVENUE), ifrsTotal = all.filter(f => f.tag === LAST_REVENUE_FALLBACK);
    if (ifrsBank.length && ifrsTotal.length && new Set(ifrsTotal.map(f => f.value)).size === 1 && ifrsBank.every(f => f.value <= ifrsTotal[0].value)) return ifrsTotal;
    const stated = all.filter(f => !REVENUE_FALLBACKS.includes(f.tag)), first = REVENUE_FALLBACKS.find(tag => all.some(f => f.tag === tag));
    const rows = stated.length ? stated : all.filter(f => f.tag === first);
    // "Revenues" is the total whenever it is filed (Ameriprise files both); net-of-interest revenue only where it is the sole total.
    // IFRS: "Revenue" is the total and revenue from contracts with customers a part of it (BHP, Rio Tinto: other revenue such as
    // provisional pricing adjustments sits outside contract revenue); they were held as conflicting before.
    // A utility's total is its regulated and unregulated operating revenue (Xcel Energy tags no consolidated "Revenues" since 2019).
    const totalTag = REVENUE_TOTALS.find(tag => rows.some(f => f.tag === tag && (tag !== "Revenue" || f.basis === "ifrs-full")));
    const total = rows.filter(f => f.tag === totalTag), parts = rows.filter(f => !REVENUE_TOTALS.includes(f.tag));
    return total.length && total.length < rows.length && new Set(total.map(f => `${f.unit}/${f.value}`)).size === 1 && parts.every(f => f.unit === total[0].unit && f.value <= total[0].value) ? total : rows;
  };
  const latestRevenueRows = revenues.filter(f => f.end === latest.end && f.filed === latest.filed);
  // A foreign filer's convenience translation beside its native figures: the filing's own reporting currency is kept (the one most of its
  // facts use); with no clear majority the figures stay held.
  const currency = reportingCurrency ?? (new Set(latestRevenueRows.map(f => f.unit)).size > 1 ? dominantCurrency(facts, latest.accession) ?? undefined : undefined);
  const preferred = preferTotal(latestRevenueRows.filter(f => !currency || f.unit === currency));
  // One line filed both in full and rounded in the same report (AECOM's 10-K for fiscal 2026: $15,096,370 thousand on the statement,
  // $15,096.4 million in the segment note) is one figure, kept at its full precision (the same rule as unique() below).
  const sameDate = new Set(preferred.map(f => `${f.unit}/${f.basis}/${f.tag}`)).size === 1 ? roundedOnce(preferred) : preferred;
  const candidate = sameDate[0];
  if (!candidate) return result;
  // Ambiguous accounting basis or conflicting native values are still held.
  if (new Set(sameDate.map(f => `${f.unit}/${f.basis}`)).size !== 1 || new Set(sameDate.map(f => f.value)).size !== 1) return result;
  const revenue = candidate;
  const basis = revenue.basis as keyof typeof tags;
  const samePeriod = (f: Fact) => f.unit === revenue.unit && f.end === revenue.end && f.start === revenue.start && f.accession === revenue.accession;
  // The first tag the filing uses for the period, in order (AT&T tags operating cash flow only as "continuing operations"); tags are never mixed.
  function metric(key: "operatingIncome" | "operatingCash" | "capex" | "cash" | "stockCompensation") {
    for (const tag of tags[basis][key]) {
      const values = collect(basis, [tag], key === "cash").filter(f => key === "cash" ? f.unit === revenue.unit && f.end === revenue.end && f.accession === revenue.accession : samePeriod(f));
      if (values.length) return new Set(values.map(f => f.value)).size === 1 ? values[0] : null;
    }
    return null;
  }
  // Compare the prior year restated in the SAME filing/tag, not a stale pre-restatement filing.
  const prior = revenues.filter(f => f.tag === revenue.tag && f.basis === revenue.basis && f.unit === revenue.unit && f.accession === revenue.accession && day(revenue.end)-day(f.end) >= 350 && day(revenue.end)-day(f.end) <= 380 && Math.abs(duration(f)-duration(revenue)) <= 8);
  const previousRevenue = prior.length && new Set(prior.map(f => `${f.end}/${f.value}`)).size === 1 ? prior[0] : null;
  const operatingIncome = metric("operatingIncome"), operatingCash = metric("operatingCash"), cash = metric("cash");
  // Capital spending is tagged one of several ways (AAOI switched tags mid-year): the first tag the filing uses is taken, never a mix.
  const capexRaw = (() => { for (const tag of tags[basis].capex) { const values = collect(basis, [tag]).filter(samePeriod); if (values.length) return new Set(values.map(f => f.value)).size === 1 ? values[0] : null; } return null; })();
  // Some companies stopped tagging capital spending once it became immaterial (AirBnB since 2023, AppLovin since 2025: inside "other
  // investing"). Only then — no capex tag in this annual report or any later 10-Q, the last capex they tagged under 1% of revenue,
  // and the same annual report does tag its investing cash flow — is capital spending counted as zero.
  const capexFacts = (["annual", "ytd", "quarter"] as const).flatMap(period => collect(basis, tags[basis].capex, false, period));
  const lastCapex = [...capexFacts].sort((x, y) => y.filed.localeCompare(x.filed) || y.value - x.value)[0];
  // The last capital spending is set against the revenue of its own period (reviewer, Nov 26: UFPT's half-year capex was set against a full
  // year of revenue and called immaterial): the same filing's revenue for that period, else the annual revenue scaled to that length.
  const capexRevenue = lastCapex ? (revenues.find(f => f.accession === lastCapex.accession && f.start === lastCapex.start && f.end === lastCapex.end)?.value
    ?? revenue.value * Math.max(1, duration(lastCapex)) / Math.max(1, duration(revenue))) : 0;
  const capexEver = capexFacts.some(f => f.filed >= revenue.filed) || (!!lastCapex && lastCapex.value >= capexRevenue * 0.01);
  const investingTagged = basis === "us-gaap" && collect(basis, ["NetCashProvidedByUsedInInvestingActivities", "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations"]).some(samePeriod);
  const capexNotReported = !capexRaw && !capexEver && investingTagged;
  const zeroCapex = (like: Fact | null): Fact | null => capexNotReported && like ? { ...like, value: 0, tag: "capex-not-reported" } : null;
  const capex = capexRaw && capexRaw.value >= 0 ? capexRaw : zeroCapex(operatingCash);
  const stockCompensationRaw = metric("stockCompensation");
  const stockCompensation = stockCompensationRaw && stockCompensationRaw.value >= 0 ? stockCompensationRaw : null;
  // One figure, as filed once or several times: the same figure shown both in full and rounded (Eversource: $2,978,890 thousand on the
  // statement, $2,978.9 million in a note) is one figure, kept at its full precision; any other difference is a conflict and stays held.
  const unique = (values: Fact[]) => {
    if (!values.length || new Set(values.map(f => `${f.start}/${f.end}/${f.unit}`)).size !== 1) return null;
    const one = roundedOnce(values);
    return new Set(one.map(f => f.value)).size === 1 ? one[0] : null;
  };
  const shares = collect(basis, tags[basis].dilutedShares, false, "annual", true).filter(f => f.accession === revenue.accession && f.value > 0);
  const dilutedShares = unique(shares.filter(f => f.start === revenue.start && f.end === revenue.end));
  const previousDilutedShares = dilutedShares && previousRevenue ? unique(shares.filter(f => f.start === previousRevenue.start && f.end === previousRevenue.end && f.tag === dilutedShares.tag)) : null;
  // Only a directly reported standalone quarter AFTER the annual period. Never treat YTD as a quarter.
  // The quarter's own statement line first (NextEra's 10-Q tags another line than its 10-K), else the annual one, each only while it covers the newest quarter.
  const quarterCandidates = collect(basis, tags[basis].revenue, false, "quarter").filter(f => (quarterOnly ? f.end >= revenue.end : f.end > revenue.end) && f.unit === revenue.unit && f.value > 0);
  const quarterTag = [quarterRevenueTag, primaryRevenueTag].find(tag => tag && covers(quarterCandidates, tag));
  const quarters = quarterCandidates.filter(f => tagged(quarterTag)(f)).sort((a,b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
  const latestQuarter = quarters[0];
  const latestRows = latestQuarter ? quarters.filter(f => f.end === latestQuarter.end && f.filed === latestQuarter.filed) : [];
  // The quarter's own income statement names its revenue line (OXY: total revenue net of derivative losses sits below contract revenue, which
  // left the quarter held and the comparison on a stale year-end).
  const statementRows = quarterRevenueTag ? latestRows.filter(f => `${f.basis}:${f.tag}` === quarterRevenueTag) : [];
  // A utility whose annual figures use its operating revenues line keeps that line for the quarter (NextEra: contract revenue sits above it in a
  // note). Any other total below a part stays a conflict.
  let quarterRevenue = latestQuarter ? unique(statementRows.length ? statementRows : preferTotal(latestRows))
    ?? (revenue.tag === "RegulatedAndUnregulatedOperatingRevenue" ? unique(latestRows.filter(f => f.tag === revenue.tag)) : null) : null;
  // Right after a 10-K the fourth quarter has no filing of its own: it is the fiscal year minus the nine-month year-to-date of the same
  // year's third-quarter 10-Q (the same tag and unit, the YTD ending a quarter before the year end). Marked as derived; nothing is guessed.
  const fourth = (tag: string, wanted: Fact | null) => {
    if (!wanted) return null;
    // The same fiscal year's nine months: a 52/53-week year may start a few days before the calendar date its 10-Qs use (FUBO: the 10-K's
    // year runs from Sep 28, its 10-Qs' year-to-date from Oct 1), so the starts may differ by up to a week.
    const nineMonths = (name: string) => collect(basis, [name], false, "ytd9").filter(f => f.unit === wanted.unit && !!f.start && !!wanted.start && Math.abs(day(f.start) - day(wanted.start)) <= 7 && day(wanted.end) - day(f.end) >= 75 && day(wanted.end) - day(f.end) <= 120);
    let ytd = nineMonths(tag);
    // The 10-Qs may tag the same line under another name than the 10-K's total (BellRing: "Revenues" in the 10-K, contract revenue in its
    // 10-Qs). That name is used only when the annual report itself states it for the same year with the very same value.
    if (!ytd.length && wanted.accession) {
      const aliases = Object.keys(obj(facts[basis])).filter(name => name !== tag && Object.values(obj(obj(obj(facts[basis])[name]).units)).some(values => Array.isArray(values)
        && values.some(raw => { const r = obj(raw); return r.accn === wanted.accession && r.start === wanted.start && r.end === wanted.end && r.val === wanted.value; })));
      for (const name of aliases) { ytd = nineMonths(name); if (ytd.length) break; }
    }
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
  // A quarterly report that states its revenue only year-to-date (Golar LNG's 6-K: nine months to Sep 30, no three-month column): the quarter
  // is that year-to-date minus the year-to-date a quarter earlier of the same fiscal year (same line, start and currency), and the same
  // quarter a year earlier from the comparative columns of the same two reports. Nothing is derived across lines or across fiscal years.
  if (!quarterRevenue) {
    const rows = (names: readonly string[]) => names.flatMap(tag => Object.entries(obj(obj(obj(facts[basis])[tag]).units)).flatMap(([unit, values]) => !Array.isArray(values) || unit !== revenue.unit ? []
      : values.flatMap(raw => { const f = obj(raw); return typeof f.val === "number" && typeof f.start === "string" && typeof f.end === "string" && typeof f.filed === "string" && typeof f.accn === "string"
        && /^(?:10-Q|6-K)(?:\/A)?$/.test(String(f.form)) && day(f.filed) <= now / 86400000 ? [{ value: f.val, unit, start: f.start, end: f.end, filed: f.filed, accession: f.accn, tag, basis } as Fact & { filed: string; accession: string }] : []; })));
    const ytdQuarter = (names: readonly string[], end: string, accession?: string) => {
      const all = rows(names);
      const ytd = all.filter(f => f.end === end && (!accession || f.accession === accession) && duration(f) >= 160 && duration(f) <= 290).sort((a, b) => b.filed.localeCompare(a.filed))[0];
      if (!ytd) return null;
      const prior = all.filter(f => f.start === ytd.start && f.tag === ytd.tag && day(ytd.end) - day(f.end) >= 75 && day(ytd.end) - day(f.end) <= 120).sort((a, b) => b.filed.localeCompare(a.filed))[0];
      if (!prior) return null;
      const start = new Date((day(prior.end) + 1) * 86400000).toISOString().slice(0, 10);
      return { ...ytd, value: ytd.value - prior.value, start, derived: "ytd-minus-prior-ytd" as const };
    };
    const newestYtd = rows(tags[basis].revenue).filter(f => f.end > revenue.end && duration(f) >= 160 && duration(f) <= 290 && f.value > 0).sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed))[0];
    const q = newestYtd ? ytdQuarter([newestYtd.tag], newestYtd.end, newestYtd.accession) : null;
    if (q && q.value > 0) {
      quarterRevenue = q; derivedQuarter = q;
      const yearAgo = new Date((day(q.end) - 365) * 86400000).toISOString().slice(0, 10);
      const pEnd = rows([q.tag]).filter(f => f.accession === q.accession && Math.abs(day(f.end) - day(yearAgo)) <= 7 && duration(f) >= 160).map(f => f.end)[0];
      const p = pEnd ? ytdQuarter([q.tag], pEnd) : null;
      derivedPrevious = p && p.value > 0 ? p : null;
      const op = rows(tags[basis].operatingIncome.filter(t => t !== DERIVED_PRETAX && t !== DERIVED_OPERATING)).find(f => f.accession === q.accession && f.end === q.end && f.start === newestYtd!.start);
      derivedOperating = op ? ytdQuarter([op.tag], q.end, q.accession) : null;
    }
  }
  // A foreign filer that reports twice a year (BTI: the comparison showed no figures at all, owner Nov 18) has no quarter: its latest
  // six-month report on Form 6-K is the period compared, against the same half a year earlier from that report. A foreign filer whose filings
  // carry annual figures only (no tagged interim report after its 20-F/40-F) has its fiscal year as the latest period. Either is said on
  // screen (`periodMonths`); periods are never mixed, and a US filer without a quarter is left as before.
  let qp: "quarter" | "half" | "annual" = "quarter";
  if (!quarterRevenue) {
    const halves = collect(basis, tags[basis].revenue, false, "half").filter(f => f.end > revenue.end && f.unit === revenue.unit && f.value > 0 && (!primaryRevenueTag || `${f.basis}:${f.tag}` === primaryRevenueTag)).sort((a,b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
    const newest = halves[0] ? unique(preferTotal(halves.filter(f => f.end === halves[0].end && f.filed === halves[0].filed))) : null;
    // Only a half-year report that states the same half a year earlier: a 6-K exhibit with this half's sales alone (Ohmyhome) gives no growth
    // or margin, and the fiscal year stays the period compared, as before.
    const half = newest && collect(basis, [newest.tag], false, "half").some(f => f.accession === newest.accession && f.unit === newest.unit
      && day(newest.end) - day(f.end) >= 350 && day(newest.end) - day(f.end) <= 380) ? newest : null;
    if (half) { quarterRevenue = half; qp = "half"; }
    else if (/^(?:20-F|40-F|6-K)/.test(formOf.get(revenue.accession) ?? "")) { quarterRevenue = revenue; qp = "annual"; }
  }
  const annualPeriod = qp === "annual", ip = qp === "half" ? "half" : "quarter";
  const previousQuarterRevenue = annualPeriod ? previousRevenue : derivedPrevious ?? (quarterRevenue && !derivedQuarter ? unique(collect(basis, [quarterRevenue.tag], false, ip).filter(f => f.accession === quarterRevenue.accession && f.unit === quarterRevenue.unit && day(quarterRevenue.end)-day(f.end) >= 350 && day(quarterRevenue.end)-day(f.end) <= 380 && Math.abs(duration(quarterRevenue)-duration(f)) <= 8 && f.value > 0)) : null);
  const quarterOperatingIncome = annualPeriod ? operatingIncome : derivedQuarter ? derivedOperating : quarterRevenue ? unique(collect(basis, tags[basis].operatingIncome, false, ip).filter(f => f.accession === quarterRevenue.accession && f.unit === quarterRevenue.unit && f.start === quarterRevenue.start && f.end === quarterRevenue.end)) : null;
  const quarterMetric = (key: "operatingCash" | "capex" | "stockCompensation") => annualPeriod ? (key === "stockCompensation" ? stockCompensation : key === "operatingCash" ? operatingCash : capex) : quarterRevenue ? unique(collect(basis,tags[basis][key],false,ip).filter(f => f.accession===quarterRevenue.accession && f.unit===quarterRevenue.unit && f.start===quarterRevenue.start && f.end===quarterRevenue.end)) : null;
  // Cash-flow statements in a 10-Q are year-to-date only, so the second and third quarters had no cash figures (資金創出 stayed "—" for most
  // companies, owner Nov 14). The quarter is then this filing's year-to-date minus the year-to-date through the previous quarter (same start,
  // newest filing); a fourth quarter is the fiscal year minus nine months. Each tag is tried on its own, in order; tags are never mixed.
  function quarterCash(key: "operatingCash" | "capex"): Fact | null {
    if (!quarterRevenue || !quarterRevenue.start) return null;
    if (annualPeriod) return quarterMetric(key);
    for (const tag of tags[basis][key]) {
      const direct = unique(collect(basis,[tag],false,ip).filter(f => f.accession===quarterRevenue.accession && f.unit===quarterRevenue.unit && f.start===quarterRevenue.start && f.end===quarterRevenue.end));
      if (direct) return direct;
      if (ip === "half") continue;   // a half-year report states its six-month cash flows directly
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
  const quarterOperatingCash=quarterCash("operatingCash"), quarterCapex=quarterCash("capex") ?? zeroCapex(quarterOperatingCash), quarterCompensation=quarterMetric("stockCompensation");
  const quarterShares = annualPeriod ? dilutedShares : quarterRevenue ? unique(collect(basis,tags[basis].dilutedShares,false,ip,true).filter(f=>f.accession===quarterRevenue.accession && f.start===quarterRevenue.start && f.end===quarterRevenue.end && f.value>0)) : null;
  const previousQuarterShares = annualPeriod ? previousDilutedShares : quarterShares && previousQuarterRevenue ? unique(collect(basis,[quarterShares.tag],false,ip,true).filter(f=>f.accession===quarterShares.accession && f.start===previousQuarterRevenue.start && f.end===previousQuarterRevenue.end && f.value>0)) : null;
  // The last four standalone quarters' operating margins, for the stability factor. Each quarter needs both revenue and operating income;
  // a quarter reported twice with different values, or a gap in the sequence, leaves the whole series empty.
  // A fiscal year standing as the latest period is its own trailing twelve months; a half-year has no four-quarter series.
  let quarterRevenueTtm: number | null = annualPeriod ? revenue.value : null, quarterRevenueQoq: number | null = null;
  // A half-year right after the fiscal year: the last twelve months are that year, plus this half, minus the same half a year earlier (the
  // half-year report states it beside its own), same line and currency. Before, a half-year had no twelve-month revenue, so no price-to-sales.
  if (qp === "half" && quarterRevenue?.start && previousQuarterRevenue && !derivedQuarter && revenue.tag === quarterRevenue.tag && revenue.unit === quarterRevenue.unit
    && previousQuarterRevenue.unit === revenue.unit && previousQuarterRevenue.start === revenue.start && day(quarterRevenue.start) - day(revenue.end) === 1) {
    const ttm = revenue.value + quarterRevenue.value - previousQuarterRevenue.value;
    if (Number.isFinite(ttm) && ttm > 0) quarterRevenueTtm = ttm;
  }
  /** A foreign filer whose latest period is a fiscal year or a half-year has no four quarters: its last four consecutive fiscal years'
   *  operating margins (each as filed in its annual report, the same line kind and revenue line as the latest year) stand in, said as
   *  annual on screen (marginPeriod). Nov 26 audit: 849 foreign filers had no stability at all; 687 file four such years. */
  function annualMarginSeries(): { periodEnd: string; value: number }[] | null {
    const pretaxOnly = (annualPeriod ? quarterOperatingIncome : operatingIncome)?.tag === DERIVED_PRETAX;
    const names = pretaxOnly ? [DERIVED_PRETAX] : tags[basis].operatingIncome.filter(tag => tag !== DERIVED_PRETAX);
    const byEnd = (rows: Fact[]) => { const m = new Map<string, number | null>(); for (const f of rows) { const have = m.get(f.end); m.set(f.end, have === undefined || have === f.value ? f.value : null); } return m; };
    const newestFirst = (rows: (Fact & { filed: string })[]) => { const latest = new Map<string, string>(); for (const f of rows) if ((latest.get(f.end) ?? "") < f.filed) latest.set(f.end, f.filed); return rows.filter(f => latest.get(f.end) === f.filed); };
    const rev = byEnd(newestFirst(collect(basis, [revenue.tag]).filter(f => f.unit === revenue.unit)));
    const op = byEnd(newestFirst(collect(basis, names).filter(f => f.unit === revenue.unit)));
    const ends = [...rev.keys()].filter(end => end <= revenue.end && (rev.get(end) ?? 0) > 0 && typeof op.get(end) === "number").sort().reverse();
    if (ends[0] !== revenue.end) return null;
    const picked = [ends[0]];
    for (const end of ends.slice(1)) { const gap = day(picked.at(-1)!) - day(end); if (gap >= 340 && gap <= 400) picked.push(end); else if (gap > 400) break; if (picked.length === 4) break; }
    return picked.length === 4 ? picked.map(end => ({ periodEnd: end, value: op.get(end)! / rev.get(end)! * 100 })) : null;
  }
  function marginSeries(): { periodEnd: string; value: number }[] | null {
    if (!quarterRevenue || qp !== "quarter") return null;
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
    // Quarters may be 12 or 16 weeks long (PEP: a 16-week fourth quarter, about 112 days), so consecutive quarter ends are 70 to 120 days apart.
    // Revenue of four consecutive quarters for price-to-sales: needs revenue only, so a company without an operating line still has it.
    const revenueEnds = [...rev.keys()].filter(end => end <= quarterRevenue.end && (rev.get(end) ?? 0) > 0).sort().reverse();
    if (revenueEnds[0] === quarterRevenue.end) {
      const chain = [revenueEnds[0]];
      for (const end of revenueEnds.slice(1)) { const gap = day(chain.at(-1)!) - day(end); if (gap >= 70 && gap <= 120) chain.push(end); else if (gap > 120) break; if (chain.length === 4) break; }
      if (chain.length === 4) quarterRevenueTtm = chain.reduce((sum, end) => sum + rev.get(end)!, 0);
      if (chain.length >= 2) quarterRevenueQoq = (rev.get(chain[0])! / rev.get(chain[1])! - 1) * 100;
    }
    const ends = [...rev.keys()].filter(end => end <= quarterRevenue.end && (rev.get(end) ?? 0) > 0 && typeof op.get(end) === "number").sort().reverse();
    if (ends[0] !== quarterRevenue.end) return null;
    const picked = [ends[0]];
    for (const end of ends.slice(1)) { const gap = day(picked.at(-1)!) - day(end); if (gap >= 70 && gap <= 120) picked.push(end); if (picked.length === 4) break; }
    if (picked.length !== 4) return null;
    return picked.map(end => ({ periodEnd: end, value: op.get(end)! / rev.get(end)! * 100 }));
  }
  // Four quarters when the filings give them; otherwise four fiscal years, said as annual (a foreign filer reporting yearly or half-yearly, a
  // quarterly 6-K filer whose quarters are not all tagged, a US filer whose quarters break at a tag change).
  const quarterly = qp === "quarter" ? marginSeries() : null;
  const annualMargins = quarterly ? null : annualMarginSeries();
  const series = quarterly ?? annualMargins;
  // A margin above 100% in the series (income above revenue) makes the series unusable for stability, as above.
  const partialRevenue = revenue.tag === IFRS_BANK_REVENUE || quarterRevenue?.tag === IFRS_BANK_REVENUE;
  // A lender's or bank's operating figure whose sign disagrees with its own pre-tax income for the same period and filing (reviewer, Nov 26:
  // NNI's derived −$214m beside pre-tax +$81m) is no measure of its profit: the margin is withheld.
  const signCheck = quarterRevenue && quarterOperatingIncome && (quarterRevenue.tag === LENDER_REVENUE || quarterRevenue.tag === BANK_REVENUE) && quarterOperatingIncome.tag !== DERIVED_PRETAX
    ? collect(quarterRevenue.basis as keyof typeof tags, PRETAX_TAGS, false, "quarter").find(f => f.accession === quarterRevenue.accession && f.start === quarterRevenue.start && f.end === quarterRevenue.end) : undefined;
  // Only a line that is itself a partial measure of a financial firm's revenue (net interest, interest plus fees, revenue net of interest,
  // total operating income) counts as partial when the operating figure exceeds it. A stated sales line beside a larger operating figure (a
  // crypto treasury's or a REIT's gains, MSTR, CSR) is the real revenue: its growth stays, only its margin is withheld.
  const financialLine = [BANK_REVENUE, LENDER_REVENUE, IFRS_BANK_REVENUE, LAST_REVENUE_FALLBACK, "RevenuesNetOfInterestExpense"].includes(quarterRevenue?.tag ?? "");
  // A bank's, lender's, broker's or insurer's line (SIC 6000-6399) below its operating figure is a part too (FVCB: fee revenue of $0.6m beside
  // pre-tax income of $8.6m).
  // Not 6199 ("finance services", where the crypto treasuries file: MSTR) or 6221 (commodity trusts).
  const lenderSic = /^\d{4}$/.test(sic ?? "") && Number(sic) >= 6000 && Number(sic) <= 6399 && sic !== "6199" && sic !== "6221";
  const partialLine = partialRevenue || (financeSic(sic) && (financialLine || lenderSic) && !!quarterRevenue && !!quarterOperatingIncome && quarterOperatingIncome.value > quarterRevenue.value);
  const signDisagrees = !!signCheck && !!quarterOperatingIncome && Math.sign(signCheck.value) !== Math.sign(quarterOperatingIncome.value) && signCheck.value !== 0;
  const quarterMargins = series && series.every(m => m.value <= 100) && !partialRevenue ? series : null;
  const filingUrl = (f: Fact) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accession!.replaceAll("-", "")}/${f.accession}-index.htm`;
  // A single filing/date/currency for the entire balance snapshot. No fallback to older components.
  const balanceTags = basis === "us-gaap" ? ["CashAndCashEquivalentsAtCarryingValue", "AssetsCurrent", "LiabilitiesCurrent"] : ["CashAndCashEquivalents", "CurrentAssets", "CurrentLiabilities"];
  const quarterHasBalance = !annualPeriod && quarterRevenue && collect(basis,balanceTags,true,ip).some(f => f.end === quarterRevenue.end && f.accession === quarterRevenue.accession && f.unit === quarterRevenue.unit && f.value >= 0);
  const anchor = quarterHasBalance ? quarterRevenue! : revenue;
  const balancePeriod = quarterHasBalance ? ip : "annual";
  const balance = balanceSnapshot(basis, anchor, balancePeriod);
  // Free cash flow of the quarter; when its cash flows are not tagged or cannot be isolated (a 6-K filer, a broken year-to-date), the latest
  // fiscal year's own free cash flow margin, said as annual (fcfPeriod), only while that year is at most 500 days old.
  const quarterFcf = quarterRevenue && quarterOperatingCash && quarterCapex && quarterCapex.value>=0 ? (quarterOperatingCash.value-quarterCapex.value)/quarterRevenue.value*100 : null;
  const annualFcf = !quarterOnly && operatingCash && capex && capex.value >= 0 && now / 86400000 - day(revenue.end) <= 500 ? (operatingCash.value - capex.value) / revenue.value * 100 : null;
  // A bank's, broker's or insurer's operating cash flow moves with its lending, deposits and trading (HSBC 317%, MS −226% of revenue): no
  // free cash flow is scored; its cash generation is its return on equity (sectorMetrics). REITs (6798) keep theirs. Free cash flow above
  // the revenue itself is cash that is not revenue (an upfront payment, deposits): withheld too, never scored as cash generation.
  const fcfBasis = quarterFcf ?? annualFcf;
  const fcfWithheld = financeSic(sic) && sic !== "6798" ? "finance" as const : fcfBasis !== null && fcfBasis > 100 ? "aboveRevenue" as const : undefined;
  const sector = financeSic(sic) || collect(basis, ["NetInvestmentIncome"]).length > 0
    ? sectorMetrics(facts, revenue.unit, balance.end, balance.equity?.value ?? null, balance.assets?.value ?? null,
      // The net-investment-income margin is a business development company's (its revenue is total investment income), never an insurer's
      // (reviewer, Nov 26: ALL and PFG were scored on it).
      quarterRevenue && quarterRevenue.tag === "GrossInvestmentIncomeOperating" ? { start: quarterRevenue.start, accession: quarterRevenue.accession ?? null, revenue: quarterRevenue.value } : undefined)
    : null;
  const out: Financials = { ...result, status: "ready", ...(sector ? { sectorMetrics: sector } : {}), ...(capexNotReported ? { capexNotReported: true } : {}), ...(annualMargins ? { marginPeriod: "annual" as const } : {}), ...(qp !== "quarter" ? { periodMonths: qp === "half" ? 6 as const : 12 as const } : {}), balance, revenue, previousRevenue, operatingIncome, operatingCash, capex, cash,
    stockCompensation, stockCompensationRatio: stockCompensation ? stockCompensation.value / revenue.value * 100 : null,
    dilutedShares, previousDilutedShares, dilutedSharesGrowth: dilutedShares && previousDilutedShares ? (dilutedShares.value / previousDilutedShares.value - 1) * 100 : null,
    // No growth on a line that is only part of the revenue (reviewer, Nov 26: BBVA's growth on a $127m line): an IFRS bank's interest and
    // fee income, or a bank's line its operating income exceeds.
    quarterRevenue, previousQuarterRevenue, quarterOperatingIncome, quarterMargins, quarterRevenueTtm, quarterRevenueQoq: partialLine ? null : quarterRevenueQoq,
    quarterRevenueGrowth: !partialLine && quarterRevenue && previousQuarterRevenue ? (quarterRevenue.value / previousQuarterRevenue.value - 1) * 100 : null,
    ...(partialLine ? { growthWithheld: true as const } : {}),
    // An operating (or pre-tax) income above the revenue line (YUM, MSTR's bitcoin gains, a partial revenue line) is no margin to score: it
    // is withheld and the screen says why (marginWithheld).
    quarterOperatingMargin: !partialRevenue && !signDisagrees && quarterRevenue && quarterOperatingIncome && quarterOperatingIncome.value <= quarterRevenue.value ? quarterOperatingIncome.value / quarterRevenue.value * 100 : null,
    ...(partialRevenue ? { marginPartial: true as const } : signDisagrees ? { marginWithheld: true as const, marginSign: true as const } : quarterRevenue && quarterOperatingIncome && quarterOperatingIncome.value > quarterRevenue.value ? { marginWithheld: true as const } : {}),
    quarterSourceUrl: quarterRevenue ? filingUrl(quarterRevenue) : null,
    quarterFcfMargin: fcfWithheld ? null : fcfBasis,
    ...(fcfWithheld ? { fcfWithheld } : quarterFcf === null && annualFcf !== null ? { fcfPeriod: "annual" as const } : {}),
    quarterStockCompensationRatio: quarterRevenue && quarterCompensation && quarterCompensation.value>=0 ? quarterCompensation.value/quarterRevenue.value*100 : null,
    quarterDilutedSharesGrowth: quarterShares && previousQuarterShares ? (quarterShares.value/previousQuarterShares.value-1)*100 : null,
    // A fourth quarter has no quarterly share count in the annual report: the year's diluted average from that same report stands in.
    quarterDilutedShares: quarterShares ? quarterShares.value : quarterRevenue && dilutedShares && dilutedShares.end === quarterRevenue.end ? dilutedShares.value : null,
    revenueGrowth: previousRevenue ? (revenue.value / previousRevenue.value - 1) * 100 : null,
    operatingMargin: operatingIncome ? operatingIncome.value / revenue.value * 100 : null,
    fcfMargin: operatingCash && capex ? (operatingCash.value-capex.value) / revenue.value * 100 : null,
    sourceUrl: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${revenue.accession.replaceAll("-", "")}/${revenue.accession}-index.htm` };
  // Quarter only: the annual columns stay empty ("—"), never filled with the quarter's figures.
  return quarterOnly ? { ...out, revenue: null, previousRevenue: null, operatingIncome: null, operatingCash: null, capex: null, cash: null, revenueGrowth: null,
    operatingMargin: null, fcfMargin: null, stockCompensation: null, stockCompensationRatio: null, dilutedShares: null, previousDilutedShares: null, dilutedSharesGrowth: null } : out;
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
      conclusion = copy(`比較した年次実績では${top.ticker}の売上増減率（${top.revenueGrowth!.toFixed(1)}%）が最も高い。ただし、将来の成長力や割安さの順位ではありません。`, `${top.ticker} has the highest reported annual revenue change (${top.revenueGrowth!.toFixed(1)}%) in this comparison. This is not a ranking of future growth or value.`);
    }
  }
  return { companies, comparable, reasons, conclusion, generatedAt: new Date(now).toISOString() };
}
