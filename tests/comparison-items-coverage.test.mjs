import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { emptyFinancials, comparisonAccess } from "../lib/research/comparison.ts";
import { prepareComparisonAnalysis, currentComparisonAnalysis, preparePreRevenueAnalysis, appendFilingFinancialItems, appendEquityItem } from "../lib/research/comparison-analysis.ts";
import { buildSecMarketEvidence } from "../lib/research/sec-market-evidence.ts";
import { appendMarketItems } from "../lib/research/twelve-data-financials.ts";
import { hasRecentBalance, hasRecentQuarter, comparisonAvailability, comparisonScores } from "../lib/research/comparison-scorecard.ts";
import { carryWithholding, fillFromProvider } from "../lib/research/comparison-fill.ts";
import { OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID } from "../lib/membership/entitlements.ts";

// All-ticker audit of the strengths and weaknesses (Nov 19, scripts/research/comparison-audit/summarize-items.py). Figures are each company's
// latest SEC filing as the comparison read it that day (10-Q, 10-K, a 20-F or 40-F annual report), in the filing's currency.
const NOW = Date.parse("2026-11-19T12:00:00Z");
const filings = {
  // US GAAP 10-K, software: financial strength 6.5 (current ratio 0.77, cash 4.36 billion against debt 4.77 billion).
  ADBE: { start: "2026-05-30", end: "2026-08-28", unit: "USD", basis: "us-gaap", tag: "OperatingIncomeLoss", rev: 6760e6, prev: 5988e6, op: 2354e6, fcf: 36.07, shares: -6.74, cash: 4359e6, ca: 9158e6, cl: 11888e6, debt: 4766e6 },
  // US GAAP 10-K, utility: current ratio 0.62, cash 33 million against debt 28.5 billion.
  DTE: { start: "2026-07-01", end: "2026-09-30", unit: "USD", basis: "us-gaap", tag: "OperatingIncomeLoss", rev: 3727e6, prev: 3527e6, op: 603e6, fcf: null, shares: 0.48, cash: 33e6, ca: 4226e6, cl: 6794e6, debt: 28529e6 },
  // IFRS 40-F, annual figures only (CGI): pre-tax margin 14.1%, financial strength 3.7.
  GIB: { start: "2024-10-01", end: "2025-09-30", unit: "CAD", basis: "ifrs-full", tag: "TechPhasePretaxIncome", rev: 15912673e3, prev: 14676152e3, op: 2242190e3, fcf: 13.31, shares: -2.67, cash: 864209e3, ca: 5053179e3, cl: 5102170e3, debt: 3637835e3, periodMonths: 12 },
  // US GAAP 20-F bank, annual (HDFC Bank): no current assets or liabilities, cash against debt alone (3.9).
  HDB: { start: "2025-04-01", end: "2026-03-31", unit: "INR", basis: "us-gaap", tag: null, rev: 2327345.3e6, prev: 2190128.1e6, op: null, fcf: 45.79, shares: 0.57, cash: 2547835.1e6, ca: null, cl: null, debt: 6469082.4e6, periodMonths: 12 },
};
const fact = (f, value, tag, end = f.end, start = null) => value === null ? null : ({ value, unit: f.unit, start, end, filed: "2026-11-05", accession: "0000000000-26-000001", tag, basis: f.basis });
function company(ticker, change = {}) {
  const f = { ...filings[ticker], ...change };
  const prevEnd = `${Number(f.end.slice(0, 4)) - 1}${f.end.slice(4)}`;
  return { ...emptyFinancials(ticker, "unavailable", new Date(NOW).toISOString()), status: "ready", ...(f.periodMonths ? { periodMonths: f.periodMonths } : {}),
    quarterRevenue: fact(f, f.rev, "Revenues", f.end, f.start), previousQuarterRevenue: fact(f, f.prev, "Revenues", prevEnd),
    quarterOperatingIncome: f.tag ? fact(f, f.op, f.tag, f.end, f.start) : null, quarterRevenueGrowth: (f.rev / f.prev - 1) * 100,
    quarterOperatingMargin: f.op === null ? null : f.op / f.rev * 100, quarterFcfMargin: f.fcf, quarterDilutedSharesGrowth: f.shares,
    quarterSourceUrl: "https://www.sec.gov/Archives/edgar/data/1/000000000026000001/0000000000-26-000001-index.htm", dataWarnings: f.warnings ?? [],
    balance: { end: f.end, filed: "2026-11-05", sourceUrl: "https://www.sec.gov/", cash: fact(f, f.cash, "CashAndCashEquivalentsAtCarryingValue"),
      currentAssets: fact(f, f.ca, "AssetsCurrent"), currentLiabilities: fact(f, f.cl, "LiabilitiesCurrent"), currentRatio: f.ca && f.cl ? f.ca / f.cl : null,
      debtCurrent: null, debtNoncurrent: null, shortBorrowings: null, leaseCurrent: null, leaseNoncurrent: null, debtTotal: { value: f.debt, source: "total" } } };
}
// The production path for a filing (comparison-server.ts): the filing's points, then the market factors on the same evidence.
function points(c) {
  const evidence = buildSecMarketEvidence(c, undefined, undefined, NOW);
  const withEvidence = evidence ? { ...c, twelveData: evidence } : c;
  const prepared = prepareComparisonAnalysis(withEvidence, NOW);
  if (prepared && evidence) appendMarketItems(prepared, evidence, c.quarterRevenue.end, c.quarterRevenue.unit, NOW);
  const of = kind => prepared.items.filter(i => i.kind === kind).map(i => i.short.ja);
  return { prepared, strengths: of("strength"), weaknesses: of("weakness") };
}

test("real filings from four groups: a scored balance with more debt than cash is a weakness, in the existing words", () => {
  // Before: ADBE, GIB and HDB showed no weakness at all (financial strength in the middle band gave no point, and "debt exceeds cash" needed 3 or less).
  assert.deepEqual(points(company("ADBE")).weaknesses, ["有利子負債が現金を上回る"]);
  assert.deepEqual(points(company("ADBE")).strengths, ["売上成長 +12.9%", "営業利益率 34.8%", "簡易FCF率 36.1%"]);
  assert.deepEqual(points(company("GIB")).weaknesses, ["有利子負債が現金を上回る"]);
  assert.deepEqual(points(company("HDB")).weaknesses, ["有利子負債が現金を上回る"]);
  assert.deepEqual(points(company("DTE")).weaknesses, ["流動比率 0.62倍", "有利子負債が現金を上回る"]);
  const debt = points(company("HDB")).prepared.items.find(i => i.id === "debt-cash");
  assert.match(debt.detail.ja, /^2026-03-31時点の現金は2547835100000 INR、有利子負債は6469082400000 INR。/);
  // A middle score itself is still not a point either way.
  for (const t of ["ADBE", "GIB", "HDB"]) assert.equal(points(company(t)).prepared.items.some(i => i.id === "financial"), false);
});

test("a financial-strength point is never contradicted by 'debt exceeds cash'; less debt than cash or unknown debt says nothing", () => {
  // Current ratio 3 (5 points) and cash half the debt (2.5 points): 7.5, a strength.
  const strong = points(company("ADBE", { ca: 3 * 11888e6, cash: 2383e6 }));
  assert.ok(strong.strengths.includes("流動比率 3.00倍"));
  assert.equal(strong.prepared.items.some(i => i.id === "debt-cash"), false);
  assert.equal(points(company("ADBE", { cash: 5000e6 })).prepared.items.some(i => i.id === "debt-cash"), false);
  const unknown = company("ADBE"); unknown.balance = { ...unknown.balance, debtTotal: null };
  assert.equal(prepareComparisonAnalysis(unknown, NOW).items.some(i => i.id === "debt-cash" || i.id === "financial"), false);
  // Called again on the same points (a provider-sourced company scoring its balance from the filing), nothing is added twice.
  const items = points(company("DTE")).prepared.items;
  assert.equal(appendFilingFinancialItems(items, company("DTE"), NOW).filter(i => i.id === "debt-cash").length, 1);
});

async function server(stubs) {
  const text = readFileSync(new URL("../lib/research/comparison-server.ts", import.meta.url), "utf8")
    .replace('import "server-only";', "")
    .replace('import { unstable_cache } from "next/cache";', "const unstable_cache = fn => async (...a) => fn(...a);")
    .replace(/import \{ comparisonCatalog \}[^;]*;/, "const comparisonCatalog = [];")
    .replace(/import providers from[^;]*;/, 'const providers = [{ ticker: "DTE", supplementalSources: [{ cik: "936340" }] }];')
    .replace(/import \{ parseSecDirectory \}[^;]*;/, "const parseSecDirectory = () => [];")
    .replace(/import \{ emptyFinancials \}[^;]*;/, "const emptyFinancials = globalThis.__items.emptyFinancials;")
    .replace(/import \{ prepareComparisonAnalysis, currentComparisonAnalysis, preparePreRevenueAnalysis \}[^;]*;/, "const { prepareComparisonAnalysis, currentComparisonAnalysis, preparePreRevenueAnalysis } = globalThis.__items;")
    .replace(/import \{ appendEquityItem, appendFilingFinancialItems \}[^;]*;/, "const { appendEquityItem, appendFilingFinancialItems } = globalThis.__items;")
    .replace(/import \{ loadSecComparison \}[^;]*;/, "const loadSecComparison = globalThis.__items.loadSecComparison;")
    .replace(/import \{ loadMarketInputs, loadTwelveComparisonState \}[^;]*;/, "const { loadMarketInputs, loadTwelveComparisonState } = globalThis.__items;")
    .replace(/import \{ releaseStatements \}[^;]*;/, "const releaseStatements = async () => null;")
    .replace(/import \{ freshEnough \}[^;]*;/, "const freshEnough = (cachedRead) => cachedRead();")
    .replace(/import \{ buildSecMarketEvidence \}[^;]*;/, "const buildSecMarketEvidence = globalThis.__items.buildSecMarketEvidence;")
    .replace(/import \{ appendMarketItems \}[^;]*;/, "const appendMarketItems = globalThis.__items.appendMarketItems;")
    .replace(/import \{ comparisonScores, hasRecentBalance, hasRecentQuarter \}[^;]*;/, "const { comparisonScores, hasRecentBalance, hasRecentQuarter } = globalThis.__items;")
    .replace(/import \{ fillFromProvider \}[^;]*;/, "const fillFromProvider = globalThis.__items.fillFromProvider;")
    .replace(/import \{ carryWithholding \}[^;]*;/, "const carryWithholding = globalThis.__items.carryWithholding;")
    .replace('"./comparison-exclusions"', JSON.stringify(new URL("../lib/research/comparison-exclusions.ts", import.meta.url).href))
    .replace(/import type \{ Financials \}[^;]*;/, "");
  globalThis.__items = { emptyFinancials, prepareComparisonAnalysis, currentComparisonAnalysis, appendFilingFinancialItems, appendEquityItem, buildSecMarketEvidence, appendMarketItems,
    hasRecentBalance, hasRecentQuarter, comparisonScores, fillFromProvider, carryWithholding, preparePreRevenueAnalysis, loadMarketInputs: async () => ({}), loadTwelveComparisonState: async () => ({ data: null, busy: false }), ...stubs };
  return import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(text)).toString("base64") + `#${Math.random()}`);
}
const withClock = async fn => { const real = Date.now; Date.now = () => NOW; try { return await fn(); } finally { Date.now = real; } };

test("a filing shown while a newer release is pending gets its points (before: 長所・短所の要点は未作成です, DTE and RJF)", () => withClock(async () => {
  // As the loader reads it: the newer release blocks the period, so the filing's own points are not prepared yet.
  const read = company("DTE", { warnings: [{ ja: "2026-11-06の新しい決算発表は数値の反映が未確認です。", en: "Figures from the newer earnings release on 2026-11-06 are not verified." }] });
  assert.equal(prepareComparisonAnalysis(read, NOW), undefined);
  const { loadComparisonFinancials } = await server({ loadSecComparison: async () => read });
  const c = await loadComparisonFinancials("DTE");
  assert.equal(c.previousQuarterShown, undefined); // the 「四半期報告書の提出待ち」 sentence is gone for good (owner, Nov 26)
  assert.equal(comparisonAvailability(c, "ja", NOW), null);
  assert.deepEqual(c.preparedAnalysis.items.map(i => `${i.kind}:${i.short.ja}`),
    ["strength:売上成長 +5.7%", "strength:営業利益率 16.2%", "weakness:流動比率 0.62倍", "weakness:有利子負債が現金を上回る"]);
}));

test("a provider-sourced company scoring its balance from the filing gets the balance points too", () => withClock(async () => {
  // The filing has no current quarter of its own but a balance for the provider's quarter; before, it scored financial strength 1.6 with no point.
  const sec = { ...company("DTE"), quarterRevenue: null, quarterRevenueGrowth: null, quarterOperatingMargin: null };
  const providerFigures = { ...company("DTE"), balance: null, quarterSourceUrl: "https://twelvedata.com/", dataWarnings: [] };
  providerFigures.preparedAnalysis = prepareComparisonAnalysis(providerFigures, NOW);
  assert.equal(providerFigures.preparedAnalysis.items.some(i => i.id === "financial"), false);
  const { loadComparisonFinancials } = await server({
    loadSecComparison: async () => sec,
    loadTwelveComparisonState: async () => ({ data: { financials: providerFigures, scores: comparisonScores(providerFigures, NOW) }, busy: false }),
  });
  const c = await loadComparisonFinancials("DTE");
  assert.equal(comparisonScores(c, NOW).find(s => s.id === "financial").value, 1.6);
  assert.deepEqual(c.preparedAnalysis.items.filter(i => i.kind === "weakness").map(i => i.short.ja), ["流動比率 0.62倍", "有利子負債が現金を上回る"]);
  assert.ok(currentComparisonAnalysis(providerFigures, NOW));
}));

test("the owner accounts keep the comparison", () => {
  for (const id of [OWNER_ACCOUNT_ID, PRODUCTION_OWNER_ACCOUNT_ID]) assert.equal(comparisonAccess({ status: "signed-in", plan: "free", userId: id, ownerAccount: true }, NOW), 200);
});
