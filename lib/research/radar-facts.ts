/** Financial Radar numbers from SEC "company facts" (standard us-gaap tags), tolerant of how companies name things.
 *
 *  - Free cash flow = operating cash flow - capital expenditure, as a share of revenue.
 *  - Staying power = cash and short-term investments / (borrowings + lease liabilities), at the balance date.
 *  - Flows use the latest fiscal year when the balance date is a year end, otherwise the trailing four quarters
 *    (last fiscal year + this year to date - last year's same period). Which one was used is recorded.
 *  - The previous earnings snapshot is computed the same way one filing earlier, so the movement (dotted line, arrows)
 *    comes from the same data and updates itself when a new filing appears.
 */
type Fact = { start?: string; end: string; val: number; form: string; filed: string };
type Unit = Record<string, Fact[]>;
export type CompanyFacts = { facts?: Record<string, Record<string, { units?: Record<string, unknown> }>> };

export type RadarSnapshot = {
  /** Balance date the snapshot is as of. */
  end: string;
  /** "annual" when a full fiscal year ends on that date, "ttm" for the trailing four quarters. */
  basis: "annual" | "ttm";
  revenue: number;
  /** Free cash flow as a percentage of revenue. */
  fcfMargin: number;
  /** Cash and short-term investments divided by borrowings plus lease liabilities. */
  cover: number;
  /** Revenue growth against the same period a year earlier, in percent; null when that year is not available. */
  revenueGrowth: number | null;
};
export type RadarFacts = { latest: RadarSnapshot | null; previous: RadarSnapshot | null; reason?: string };

const FORMS = new Set(["10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A", "40-F", "40-F/A"]);
const DAY = 86_400_000;
const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;
const near = (a: string, b: string, within: number) => Math.abs(day(a) - day(b)) <= within;
const shift = (date: string, days: number) => new Date((day(date) + days) * DAY).toISOString().slice(0, 10);

const REVENUE = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet"];
const OPERATING_CASH = ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"];
const CAPEX = ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsForCapitalImprovements", "PaymentsToAcquireOtherPropertyPlantAndEquipment", "PaymentsToAcquirePropertyPlantAndEquipmentAndIntangibleAssets"];
const CASH = ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash"];
const CASH_AND_INVESTMENTS = ["CashCashEquivalentsAndShortTermInvestments", "CashCashEquivalentsAndMarketableSecurities"];
const SHORT_INVESTMENTS = ["MarketableSecuritiesCurrent", "ShortTermInvestments", "DebtSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent", "AvailableForSaleSecuritiesCurrent", "OtherShortTermInvestments"];
const DEBT_TOTAL = ["DebtLongtermAndShorttermCombinedAmount", "LongTermDebt", "DebtAndCapitalLeaseObligations", "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities", "DebtInstrumentCarryingAmount"];
const DEBT_CURRENT = ["DebtCurrent", "LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent", "NotesPayableCurrent", "ConvertibleNotesPayableCurrent", "ConvertibleDebtCurrent"];
const DEBT_LONG = ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermNotesPayable", "ConvertibleNotesPayableNoncurrent", "ConvertibleDebtNoncurrent", "SeniorNotesNoncurrent", "NotesPayableNoncurrent", "LongTermLineOfCredit", "ConvertibleDebt", "ConvertibleNotesPayable", "SeniorNotes", "SecuredDebt"];
const SHORT_BORROWINGS = ["ShortTermBorrowings", "CommercialPaper", "LinesOfCreditCurrent", "ShortTermBankLoansAndNotesPayable"];
const LEASE_OPERATING = { total: ["OperatingLeaseLiability"], current: ["OperatingLeaseLiabilityCurrent"], long: ["OperatingLeaseLiabilityNoncurrent"] };
const LEASE_FINANCE = { total: ["FinanceLeaseLiability"], current: ["FinanceLeaseLiabilityCurrent"], long: ["FinanceLeaseLiabilityNoncurrent"] };

function series(data: CompanyFacts, tag: string): Fact[] {
  const units = data.facts?.["us-gaap"]?.[tag]?.units as Unit | undefined;
  const rows = units?.USD;
  if (!Array.isArray(rows)) return [];
  return rows.filter(row => row && typeof row.val === "number" && Number.isFinite(row.val) && typeof row.end === "string" && typeof row.filed === "string" && FORMS.has(row.form) && /^\d{4}-\d{2}-\d{2}$/.test(row.end));
}
/** Latest-filed value among facts that pass `accept`; a restated figure replaces the original. */
function pick(rows: Fact[], accept: (row: Fact) => boolean): Fact | null {
  let best: Fact | null = null;
  for (const row of rows) if (accept(row) && (!best || row.filed > best.filed)) best = row;
  return best;
}
const duration = (row: Fact) => row.start ? day(row.end) - day(row.start) + 1 : NaN;

/** One flow (revenue, cash flow) for the twelve months ending around `end`. */
function twelveMonths(data: CompanyFacts, tags: string[], end: string): { value: number; basis: "annual" | "ttm" } | null {
  for (const tag of tags) {
    const rows = series(data, tag).filter(row => row.start);
    const year = pick(rows, row => near(row.end, end, 9) && duration(row) >= 350 && duration(row) <= 380);
    if (year) return { value: year.val, basis: "annual" };
    const ytd = pick(rows, row => near(row.end, end, 4) && duration(row) >= 80 && duration(row) <= 290);
    if (!ytd?.start) continue;
    const priorYtd = pick(rows, row => near(row.end, shift(end, -365), 8) && near(row.start!, shift(ytd.start!, -365), 8) && Math.abs(duration(row) - duration(ytd)) <= 8);
    const priorYear = pick(rows, row => near(row.end, shift(ytd.start!, -1), 8) && duration(row) >= 350 && duration(row) <= 380);
    if (priorYtd && priorYear) return { value: priorYear.val + ytd.val - priorYtd.val, basis: "ttm" };
  }
  return null;
}
function instant(data: CompanyFacts, tags: string[], end: string): number | null {
  for (const tag of tags) {
    const row = pick(series(data, tag).filter(r => !r.start), r => r.end === end);
    if (row) return row.val;
  }
  return null;
}
const sumKnown = (values: (number | null)[]) => values.reduce<number>((sum, v) => sum + (v ?? 0), 0);

function cashAt(data: CompanyFacts, end: string): number | null {
  const combined = instant(data, CASH_AND_INVESTMENTS, end);
  if (combined !== null) return combined;
  const cash = instant(data, CASH, end);
  if (cash === null) return null;
  return cash + (instant(data, SHORT_INVESTMENTS, end) ?? 0);
}
const BORROWING_NAME = /^(?:DebtInstrument|LongTermDebt|ShortTermBorrow|NotesPayable|ConvertibleNotes|ConvertibleDebt|LineOfCredit|LinesOfCredit|CommercialPaper|SeniorNotes|SecuredDebt|DebtCurrent|DebtLongterm|ProceedsFromIssuanceOfDebt|ProceedsFromIssuanceOfLongTermDebt|RepaymentsOfDebt|RepaymentsOfLongTermDebt|ProceedsFromNotesPayable|ProceedsFromConvertibleDebt)/;
/** True when nothing was borrowed under any name in the year to `end`: such a company files no debt line, so an
 * absent line means no debt. */
function noRecentBorrowing(data: CompanyFacts, end: string): boolean {
  const from = shift(end, -400);
  const tags = Object.keys(data.facts?.["us-gaap"] ?? {});
  return !tags.some(tag => BORROWING_NAME.test(tag) && series(data, tag).some(row => Math.abs(row.val) > 0 && row.end >= from && row.end <= shift(end, 5)));
}
function leaseAt(data: CompanyFacts, kind: typeof LEASE_OPERATING, end: string): number {
  const total = instant(data, kind.total, end);
  if (total !== null) return total;
  return sumKnown([instant(data, kind.current, end), instant(data, kind.long, end)]);
}
/** Borrowings plus leases at the balance date; null when the balance sheet names no borrowing at all.
 * Companies use "LongTermDebt" both for the whole and for the non-current part, so it is only used as the long
 * part when no explicit non-current tag exists. */
function owedAt(data: CompanyFacts, end: string): number | null {
  const explicitCurrent = instant(data, ["DebtCurrent"], end);
  const current = explicitCurrent ?? (instant(data, DEBT_CURRENT.slice(1), end));
  const short = explicitCurrent === null ? instant(data, SHORT_BORROWINGS, end) : null; // DebtCurrent already holds them
  const long = instant(data, DEBT_LONG, end) ?? instant(data, DEBT_TOTAL, end);
  const operating = leaseAt(data, LEASE_OPERATING, end), finance = leaseAt(data, LEASE_FINANCE, end);
  const named = current !== null || long !== null || short !== null || operating > 0 || finance > 0;
  if (named) return sumKnown([current, short, long]) + operating + finance;
  // Nothing borrowed under any name for a year: a company with no debt files no debt line.
  return noRecentBorrowing(data, end) ? 0 : null;
}

function snapshotAt(data: CompanyFacts, end: string): RadarSnapshot | null {
  const cash = cashAt(data, end), owed = owedAt(data, end);
  if (cash === null || cash < 0 || owed === null || owed < 0) return null;
  const operating = twelveMonths(data, OPERATING_CASH, end), capex = twelveMonths(data, CAPEX, end);
  if (!operating || !capex) return null;
  for (const tag of REVENUE) {
    const now = twelveMonths(data, [tag], end);
    if (!now || now.value <= 0) continue;
    const before = twelveMonths(data, [tag], shift(end, -364));
    return {
      end, basis: now.basis, revenue: now.value,
      fcfMargin: (operating.value - Math.abs(capex.value)) / now.value * 100,
      cover: owed > 0 ? cash / owed : Number.POSITIVE_INFINITY,
      revenueGrowth: before && before.value > 0 ? (now.value / before.value - 1) * 100 : null,
    };
  }
  return null;
}

/** Latest snapshot and the one before it (the previous earnings), from one company-facts payload. */
export function radarFacts(data: unknown, now = Date.now()): RadarFacts {
  const root = data as CompanyFacts;
  const ends = new Set<string>();
  for (const tag of [...CASH, ...CASH_AND_INVESTMENTS]) for (const row of series(root, tag)) if (!row.start) ends.add(row.end);
  const candidates = [...ends].filter(end => day(end) <= now / DAY).sort().reverse().slice(0, 10);
  if (!candidates.length) return { latest: null, previous: null, reason: "no-balance-sheet" };
  let latest: RadarSnapshot | null = null, previous: RadarSnapshot | null = null;
  for (const end of candidates) {
    const snapshot = snapshotAt(root, end);
    if (!snapshot) { if (!latest && now / DAY - day(end) > 400) break; continue; }
    if (!latest) latest = snapshot;
    else if (day(latest.end) - day(end) >= 60) { previous = snapshot; break; }
  }
  if (!latest) return { latest: null, previous: null, reason: "not-derivable" };
  return { latest, previous };
}
