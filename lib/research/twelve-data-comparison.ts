import { createHash } from "node:crypto";

/** Offline ingestion boundary. No network calls, API key, or paid-feed activation. */
type Row = Record<string, unknown>;
type Copy = { ja: string; en: string };
export type TwelveComparisonSnapshot = {
  schema: 1; provider: "twelve-data"; ticker: string; currency: string;
  retrievedAt: string; periodEnd: string; releasedAt: null;
  fiscalYear: number; fiscalQuarter: number;
  revenue: number | null; operatingIncome: number | null; dilutedEps: number | null;
  revenueGrowthPct: number | null; operatingMarginPct: number | null;
  operatingCashFlow: number | null; signedCapex: number | null;
  freeCashFlow: number | null; freeCashFlowMarginPct: number | null;
  warnings: string[];
};
const object = (x: unknown): Row => x !== null && typeof x === "object" && !Array.isArray(x) ? x as Row : {};
// Never coerce null, an empty string or a boolean to zero, nor strip K/M/% suffixes.
export function twelveNumber(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(x.trim())) return null;
  const n = Number(x.trim());
  return Number.isFinite(n) ? n : null;
}
function date(x: unknown): string | null {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return null;
  const t = Date.parse(x);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === x ? x : null;
}
function integer(x: unknown, min: number, max: number): number | null {
  const n = twelveNumber(x);
  return n !== null && Number.isInteger(n) && n >= min && n <= max ? n : null;
}
function envelope(raw: unknown, ticker: string, key: string) {
  const root = object(raw), meta = object(root.meta);
  if (root.status === "error" || meta.symbol !== ticker || meta.period !== "Quarterly"
    || typeof meta.currency !== "string" || !/^[A-Z]{3}$/.test(meta.currency)
    || !Array.isArray(root[key])) throw Error(`invalid-twelve-${key}`);
  return { currency: meta.currency, rows: (root[key] as unknown[]).map(object) };
}
const percent = (a: number | null, b: number | null) => {
  if (a === null || b === null || b <= 0) return null;
  const value = a / b * 100;
  return Number.isFinite(value) ? value : null;
};
const consistent = (rows: Row[], key: string) => {
  const values = rows.map(row => twelveNumber(row[key]));
  return values.length && values.every(x => x === values[0]) ? values[0] : null;
};

/** Standard /income_statement and /cash_flow, period=quarterly, not consolidated endpoints.
 * fiscal_date is a period END, never a release date. Missing release dates remain null.
 * Reject a mismatched symbol/currency instead of accidentally comparing another security.
 */
export function normalizeTwelveComparison(ticker: string, income: unknown, cashFlow: unknown = null,
  now = Date.now()): TwelveComparisonSnapshot {
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker) || !Number.isFinite(now)) throw Error("invalid-comparison-input");
  const inc = envelope(income, ticker, "income_statement");
  const today = new Date(now).toISOString().slice(0, 10);
  const valid = inc.rows.filter(r => date(r.fiscal_date) && String(r.fiscal_date) <= today
    && integer(r.quarter, 1, 4) !== null && integer(r.year, 1900, 2200) !== null);
  // Do not silently fall back to an older, complete quarter when the latest has holes.
  valid.sort((a, b) => String(b.fiscal_date).localeCompare(String(a.fiscal_date)));
  const latest = valid[0];
  if (!latest) throw Error("twelve-quarter-unavailable");
  const end = String(latest.fiscal_date), quarter = Number(latest.quarter), year = Number(latest.year);
  const current = valid.filter(r => r.fiscal_date === end);
  if (current.some(r => Number(r.quarter) !== quarter || Number(r.year) !== year)) throw Error("twelve-conflicting-period");
  const prior = valid.filter(r => Number(r.quarter) === quarter && Number(r.year) === year - 1
    && Date.parse(end) - Date.parse(String(r.fiscal_date)) >= 350 * 86400000
    && Date.parse(end) - Date.parse(String(r.fiscal_date)) <= 380 * 86400000);
  const warnings: string[] = [];
  if (current.length > 1) warnings.push("duplicate-income-period");
  let revenue = consistent(current, "sales");
  if (revenue !== null && revenue < 0) { revenue = null; warnings.push("negative-revenue"); }
  const operatingIncome = consistent(current, "operating_income");
  const dilutedEps = consistent(current, "eps_diluted");
  const previousRevenue = new Set(prior.map(r => r.fiscal_date)).size === 1 ? consistent(prior, "sales") : null;
  let operatingCashFlow: number | null = null, signedCapex: number | null = null;
  if (cashFlow !== null) {
    try {
      const cf = envelope(cashFlow, ticker, "cash_flow");
      if (cf.currency !== inc.currency) throw Error("currency-mismatch");
      const rows = cf.rows.filter(r => r.fiscal_date === end && Number(r.quarter) === quarter && Number(r.year) === year);
      operatingCashFlow = consistent(rows.map(r => object(r.operating_activities)), "operating_cash_flow");
      signedCapex = consistent(rows.map(r => object(r.investing_activities)), "capital_expenditures");
      if (rows.length === 0) warnings.push("matching-quarter-cash-flow-unavailable");
      if (rows.length > 1) warnings.push("duplicate-cash-flow-period");
      // Standard TD cash-flow capex is a signed outflow. A positive value needs review;
      // abs() would hide reversed signs and must not be used here.
      if (signedCapex !== null && signedCapex > 0) { signedCapex = null; warnings.push("capex-sign-unverified"); }
    } catch { warnings.push("cash-flow-metadata-mismatch-or-unavailable"); }
  } else warnings.push("cash-flow-unavailable");
  const sum = operatingCashFlow !== null && signedCapex !== null ? operatingCashFlow + signedCapex : null;
  const freeCashFlow = sum !== null && Number.isFinite(sum) ? sum : null;
  const growth = revenue !== null && previousRevenue !== null ? percent(revenue - previousRevenue, previousRevenue) : null;
  return { schema: 1, provider: "twelve-data", ticker, currency: inc.currency, retrievedAt: new Date(now).toISOString(),
    periodEnd: end, releasedAt: null, fiscalYear: year, fiscalQuarter: quarter,
    revenue, operatingIncome, dilutedEps, revenueGrowthPct: growth, operatingMarginPct: percent(operatingIncome, revenue),
    operatingCashFlow, signedCapex, freeCashFlow, freeCashFlowMarginPct: percent(freeCashFlow, revenue), warnings };
}

/** Realized and forecast EPS are separate contracts: never substitute quarterly EPS for TTM EPS.
 * Quote/EPS currency, share basis (including ADR ratio) and split basis must be verified upstream.
 */
export function comparablePER(input: { price: unknown; eps: unknown; kind: "ttm" | "forward";
  priceCurrency: string; epsCurrency: string; sameShareBasis: boolean }) {
  const price = twelveNumber(input.price), eps = twelveNumber(input.eps);
  if (price === null || price <= 0 || eps === null || !input.sameShareBasis
    || !/^[A-Z]{3}$/.test(input.priceCurrency) || input.priceCurrency !== input.epsCurrency)
    return { kind: input.kind, value: null, status: "unavailable" as const };
  if (eps <= 0) return { kind: input.kind, value: null, status: "not-meaningful" as const };
  const value = price / eps;
  return { kind: input.kind, value: Number.isFinite(value) ? value : null,
    status: Number.isFinite(value) ? "ready" as const : "unavailable" as const };
}

export type PreparedTwelveComparison = {
  version: 1; revision: string; snapshot: TwelveComparisonSnapshot; preparedAt: string; processingMs: number;
  items: { id: string; kind: "strength" | "weakness"; short: Copy; detail: Copy }[];
};
export function twelveComparisonRevision(snapshot: TwelveComparisonSnapshot) {
  // An unchanged upstream response does not regenerate the same bilingual copy.
  const { retrievedAt: _retrievedAt, ...evidence } = snapshot;
  void _retrievedAt;
  return createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
}
export function prepareTwelveComparison(snapshot: TwelveComparisonSnapshot,
  previous?: PreparedTwelveComparison, now = Date.now()): PreparedTwelveComparison {
  const start = performance.now(), revision = twelveComparisonRevision(snapshot);
  if (previous?.version === 1 && previous.revision === revision
    && twelveComparisonRevision(previous.snapshot) === revision && Date.parse(previous.preparedAt) <= now)
    return { ...previous, snapshot };
  const items: PreparedTwelveComparison["items"] = [];
  const pct = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(1)}%`;
  const period = snapshot.periodEnd;
  if (snapshot.revenueGrowthPct !== null && snapshot.revenueGrowthPct !== 0) {
    const n = snapshot.revenueGrowthPct, v = pct(n);
    items.push({ id: "revenue-growth", kind: n > 0 ? "strength" : "weakness",
      short: { ja: `前年同期比売上 ${v}`, en: `Revenue YoY ${v}` },
      detail: { ja: `${period}期の四半期売上高は前年同期比${v}。`, en: `Revenue for the quarter ended ${period} changed ${v} year over year.` } });
  }
  if (snapshot.operatingMarginPct !== null && (snapshot.operatingMarginPct >= 15 || snapshot.operatingMarginPct < 0)) {
    const n = snapshot.operatingMarginPct, v = `${n.toFixed(1)}%`;
    items.push({ id: "operating-margin", kind: n < 0 ? "weakness" : "strength",
      short: { ja: `営業利益率 ${v}`, en: `Operating margin ${v}` },
      detail: { ja: `${period}期の四半期営業利益率は${v}。`, en: `Operating margin for the quarter ended ${period} was ${v}.` } });
  }
  if (snapshot.freeCashFlowMarginPct !== null && snapshot.freeCashFlowMarginPct !== 0) {
    const n = snapshot.freeCashFlowMarginPct, v = `${n.toFixed(1)}%`;
    items.push({ id: "cash-generation", kind: n > 0 ? "strength" : "weakness",
      short: { ja: `簡易FCF率 ${v}`, en: `Simple FCF margin ${v}` },
      detail: { ja: `${period}期の営業CFから設備投資支出を引いた金額は売上高の${v}。`, en: `Operating cash flow less cash capital expenditure for the quarter ended ${period} equaled ${v} of revenue.` } });
  }
  return { version: 1, revision, snapshot, preparedAt: new Date(now).toISOString(),
    processingMs: Math.round((performance.now() - start) * 1000) / 1000, items };
}
