import test from "node:test";
import assert from "node:assert/strict";
import { extractFinancials } from "../lib/research/comparison.ts";
import { normalizeTwelveComparison } from "../lib/research/twelve-data-comparison.ts";
import { freshEnough } from "../lib/research/fresh-enough.ts";

// A small company's facts as the SEC publishes them: revenue per quarter, cash flow only year-to-date (AAOI, Nov 14).
const NOW = Date.parse("2026-11-14T03:00:00Z");
const fact = (start, end, val, accn, filed, form = "10-Q") => ({ start, end, val, accn, filed, form });
const Q1 = "0000000001-26-000001", Q2 = "0000000001-26-000002", Q3 = "0000000001-26-000003", FY = "0000000001-26-000000";
function facts({ capexTag = "PaymentsToAcquireOtherPropertyPlantAndEquipment", q3Capex = true } = {}) {
  const usd = list => ({ units: { USD: list } });
  return { cik: 1, facts: { "us-gaap": {
    RevenueFromContractWithCustomerExcludingAssessedTax: usd([
      fact("2025-01-01", "2025-12-31", 400, FY, "2026-02-20", "10-K"),
      fact("2025-07-01", "2025-09-30", 100, Q3, "2026-11-05"),
      fact("2026-07-01", "2026-09-30", 200, Q3, "2026-11-05"),
    ]),
    OperatingIncomeLoss: usd([fact("2025-01-01", "2025-12-31", -40, FY, "2026-02-20", "10-K"), fact("2026-07-01", "2026-09-30", -2, Q3, "2026-11-05")]),
    NetCashProvidedByUsedInOperatingActivities: usd([
      fact("2026-01-01", "2026-03-31", -80, Q1, "2026-05-07"),
      fact("2026-01-01", "2026-06-30", -70, Q2, "2026-08-06"),
      fact("2026-01-01", "2026-09-30", -76, Q3, "2026-11-05"),
    ]),
    [capexTag]: usd([
      fact("2026-01-01", "2026-06-30", 330, Q2, "2026-08-06"),
      ...(q3Capex ? [fact("2026-01-01", "2026-09-30", 700, Q3, "2026-11-05")] : []),
    ]),
  } } };
}

test("second/third quarter cash flow is this year-to-date minus the previous one; capex under another tag is found", () => {
  const c = extractFinancials("AAOI", "1", facts(), NOW);
  assert.equal(c.quarterRevenue.end, "2026-09-30");
  // operating cash -76 - (-70) = -6; capex 700 - 330 = 370; FCF -376 on revenue 200
  assert.equal(c.quarterFcfMargin, -188);
});

test("a missing year-to-date figure leaves cash generation empty, never a guess", () => {
  const c = extractFinancials("AAOI", "1", facts({ q3Capex: false }), NOW);
  assert.equal(c.quarterFcfMargin, null);
});

test("the provider's stated free cash flow is used only when it has no capex line", () => {
  const income = { meta: { symbol: "POET", currency: "USD", period: "Quarterly" }, income_statement: [
    { fiscal_date: "2026-06-30", quarter: 2, year: 2026, sales: 570, operating_income: -14000 },
    { fiscal_date: "2025-06-30", quarter: 2, year: 2025, sales: 268, operating_income: -7400 },
  ] };
  const flow = (capex, free) => ({ meta: { symbol: "POET", currency: "USD", period: "Quarterly" }, cash_flow: [
    { fiscal_date: "2026-06-30", quarter: 2, year: 2026, operating_activities: { operating_cash_flow: -12270 }, investing_activities: capex === undefined ? {} : { capital_expenditures: capex }, free_cash_flow: free },
  ] });
  assert.equal(normalizeTwelveComparison("POET", income, flow(undefined, -15344)).freeCashFlow, -15344);
  assert.equal(normalizeTwelveComparison("POET", income, flow(-100, -15344)).freeCashFlow, -12370);
  assert.equal(normalizeTwelveComparison("POET", income, flow(100, -15344)).freeCashFlow, null);   // capex sign unverified: no fallback
  assert.equal(normalizeTwelveComparison("POET", income, flow(undefined, -12270)).freeCashFlow, -12270);   // no spending at all
  assert.equal(normalizeTwelveComparison("POET", income, flow(undefined, -10000)).freeCashFlow, null);     // above operating cash: not trusted
  assert.equal(normalizeTwelveComparison("POET", income, flow(undefined, 5)).freeCashFlow, null);   // above operating cash: not trusted
});

test("a cached entry older than allowed is read again now; a fresh one is served as is", async () => {
  const now = () => NOW;
  let direct = 0;
  const read = async () => { direct++; return { retrievedAt: new Date(NOW).toISOString(), v: "new" }; };
  const old = await freshEnough(async () => ({ retrievedAt: new Date(NOW - 3 * 86400_000).toISOString(), v: "old" }), read, 2 * 3600_000, undefined, now);
  assert.equal(old.v, "new"); assert.equal(direct, 1);
  const fresh = await freshEnough(async () => ({ retrievedAt: new Date(NOW - 600_000).toISOString(), v: "cached" }), read, 2 * 3600_000, undefined, now);
  assert.equal(fresh.v, "cached"); assert.equal(direct, 1);
});

import { applyValuationBasis, comparisonScores, overallComparison } from "../lib/research/comparison-scorecard.ts";
const company = (ticker, forwardPE, priceToSales) => ({
  ticker, status: "ready", retrievedAt: new Date(NOW).toISOString(),
  quarterRevenue: { value: 100, unit: "USD", start: "2026-07-01", end: "2026-09-30", filed: "2026-11-05", accession: Q3, tag: "Revenues", basis: "us-gaap" },
  quarterRevenueGrowth: 20, quarterOperatingMargin: 10, quarterFcfMargin: 5,
  balance: null, preparedAnalysis: { items: [{ id: "valuation", kind: "strength", short: { ja: "予想PER", en: "Forward P/E" }, detail: { ja: "", en: "" } }] },
  twelveData: { version: 1, periodEnd: "2026-09-30", retrievedAt: new Date(NOW).toISOString(), margins: ["2026-09-30","2026-06-30","2026-03-31","2025-12-31"].map(periodEnd => ({ periodEnd, value: 10 })),
    momentum: { from: "2026-08-14", to: "2026-11-13", changePct: 10 },
    statistics: { retrievedAt: new Date(NOW).toISOString(), quarterEnd: "2026-09-30", forwardPE, trailingPE: null, currentRatio: 2, totalCash: 10, totalDebt: 0, priceToSales } },
});
const valuation = c => comparisonScores(c, NOW).find(s => s.id === "valuation").value;

test("valuation: forward P/E when every company has one; price-to-sales for all when any company has none", () => {
  const both = applyValuationBasis([company("A", 20, 4), company("B", 30, 8)], NOW);
  assert.deepEqual(both.map(valuation), [7, 5]);                    // unchanged: forward P/E
  assert.equal(both[0].valuationBasis, undefined);
  const mixed = applyValuationBasis([company("A", 20, 4), company("B", null, 8)], NOW);
  assert.deepEqual(mixed.map(valuation), [5, 3]);                   // both on PSR: 4x -> 5, 8x -> 3
  assert.ok(mixed.every(c => c.valuationBasis === "ps"));
  assert.ok(!mixed[0].preparedAnalysis.items.some(i => i.short.ja.includes("予想PER")));   // the bullet follows the yardstick
  assert.notEqual(overallComparison(mixed, "ja", NOW).title, "総合評価に必要なデータが揃っていません");
  const missing = applyValuationBasis([company("A", 20, 4), company("B", null, null)], NOW);
  assert.deepEqual(missing.map(valuation), [7, null]);              // no yardstick for everyone: left as before, never zero
});

test("financial strength reads debt in the form the filing uses; a filing with no borrowing figure at all is debt-free; unreadable stays empty", () => {
  const withBalance = extra => {
    const f = facts();
    const usd = list => ({ units: { USD: list } });
    const at = (val) => [{ end: "2026-09-30", val, accn: Q3, filed: "2026-11-05", form: "10-Q" }];
    Object.assign(f.facts["us-gaap"], { CashAndCashEquivalentsAtCarryingValue: usd(at(50)), AssetsCurrent: usd(at(300)), LiabilitiesCurrent: usd(at(100)) });
    for (const [tag, val] of Object.entries(extra)) f.facts["us-gaap"][tag] = usd(at(val));
    return extractFinancials("AAOI", "1", f, NOW).balance.debtTotal;
  };
  assert.deepEqual(withBalance({ LongTermDebtCurrent: 10, LongTermDebtNoncurrent: 90 }), { value: 100, source: "split" });
  assert.deepEqual(withBalance({ LongTermDebt: 80, ShortTermBorrowings: 5 }), { value: 85, source: "total" });
  assert.deepEqual(withBalance({ ConvertibleDebtNoncurrent: 70 }), { value: 70, source: "convertible" });
  assert.deepEqual(withBalance({ AvailableForSaleSecuritiesDebtSecurities: 900 }), { value: 0, source: "none" });   // owning bonds is not borrowing
  assert.equal(withBalance({ LineOfCredit: 40 }), null);                                                       // borrowing we cannot add up: no score
});

test("operating income is worked out from the same filing's own lines; pre-tax only where no operating figure exists, and labelled as such", () => {
  const base = () => { const f = facts(); delete f.facts["us-gaap"].OperatingIncomeLoss; return f; };
  const usd = list => ({ units: { USD: list } });
  const q = val => [fact("2026-07-01", "2026-09-30", val, Q3, "2026-11-05")];
  let f = base(); Object.assign(f.facts["us-gaap"], { GrossProfit: usd(q(80)), OperatingExpenses: usd(q(50)) });
  assert.equal(extractFinancials("AAOI", "1", f, NOW).quarterOperatingMargin, 15);          // (80 - 50) / 200
  f = base(); Object.assign(f.facts["us-gaap"], { CostsAndExpenses: usd(q(190)) });
  assert.equal(extractFinancials("AAOI", "1", f, NOW).quarterOperatingMargin, 5);           // (200 - 190) / 200
  f = base(); Object.assign(f.facts["us-gaap"], { IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: usd(q(30)) });
  const pre = extractFinancials("AAOI", "1", f, NOW);
  assert.equal(pre.quarterOperatingMargin, 15);
  assert.equal(pre.quarterOperatingIncome.tag, "TechPhasePretaxIncome");
});
