import test from "node:test";
import assert from "node:assert/strict";
import { extractFinancials } from "../lib/research/comparison.ts";
import { normalizeTwelveComparison } from "../lib/research/twelve-data-comparison.ts";
import { freshEnough } from "../lib/research/fresh-enough.ts";

// A small company's facts as the SEC publishes them: revenue per quarter, cash flow only year-to-date (AAOI, Nov 14).
const NOW = Date.parse("2026-11-14T03:00:00Z");
const fact = (start, end, val, accn, filed, form = "10-Q") => ({ start, end, val, accn, filed, form });
const Q1 = "0000000001-26-000001", Q2 = "0000000001-26-000002", Q3 = "0000000001-26-000003", FY = "0000000001-26-000000";
function facts({ capexTag = "PaymentsToAcquireOtherPropertyPlantAndEquipment", q3Capex = true, investing = false } = {}) {
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
    ...(capexTag ? { [capexTag]: usd([
      fact("2026-01-01", "2026-06-30", 330, Q2, "2026-08-06"),
      ...(q3Capex ? [fact("2026-01-01", "2026-09-30", 700, Q3, "2026-11-05")] : []),
    ]) } : {}),
    ...(investing ? { NetCashProvidedByUsedInInvestingActivities: usd([fact("2025-01-01", "2025-12-31", -50, FY, "2026-02-20", "10-K")]) } : {}),
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

test("a company that never tags capital spending counts it as zero, said on screen; otherwise nothing is guessed", () => {
  const none = extractFinancials("ABNB", "1", facts({ capexTag: null, investing: true }), NOW);
  assert.equal(none.capexNotReported, true);
  assert.equal(none.quarterFcfMargin, -3);   // operating cash -6 on revenue 200, capital spending 0
  // Without a tagged investing section the statement may simply be untagged: left empty.
  const untagged = extractFinancials("ABNB", "1", facts({ capexTag: null }), NOW);
  assert.equal(untagged.capexNotReported, undefined);
  assert.equal(untagged.quarterFcfMargin, null);
  // It stopped tagging an immaterial amount before this annual report: still zero. A material amount before: left empty.
  const stopped = (val) => { const f = facts({ capexTag: null, investing: true }); f.facts["us-gaap"].PaymentsToAcquirePropertyPlantAndEquipment = { units: { USD: [fact("2024-01-01", "2024-12-31", val, "0000000001-25-000000", "2025-02-20", "10-K")] } }; return extractFinancials("APP", "1", f, NOW); };
  assert.equal(stopped(3).quarterFcfMargin, -3);
  assert.equal(stopped(30).quarterFcfMargin, null);
  // A company that does tag capex, but not this quarter, is still left empty (never zero).
  const missing = extractFinancials("AAOI", "1", facts({ q3Capex: false, investing: true }), NOW);
  assert.equal(missing.capexNotReported, undefined);
  assert.equal(missing.quarterFcfMargin, null);
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

import { fillFromProvider } from "../lib/research/comparison-fill.ts";
test("an empty factor is taken from the provider only for the same quarter, and listed; the filing's own figures are never replaced", () => {
  const sec = { ...company("A", 20, 4), quarterFcfMargin: null, quarterOperatingMargin: 12 };
  sec.twelveData = { ...sec.twelveData, margins: [] };
  const provider = { ...company("A", 20, 4), quarterFcfMargin: 7, quarterOperatingMargin: 99 };
  const filled = fillFromProvider(sec, provider, NOW);
  assert.equal(filled.quarterFcfMargin, 7);
  assert.equal(filled.quarterOperatingMargin, 12);              // the filing's figure stays
  assert.equal(filled.twelveData.margins.length, 4);
  assert.deepEqual(filled.supplemented.sort(), ["cash", "stability"].sort().concat(filled.supplemented.includes("financial") ? ["financial"] : []).sort());
  const older = { ...provider, quarterRevenue: { ...provider.quarterRevenue, end: "2026-06-30" } };
  assert.equal(fillFromProvider(sec, older, NOW), sec);           // another quarter: nothing borrowed
});

test("banks: financial strength from cash against debt; growth against the previous quarter when there was no revenue a year earlier", () => {
  const bank = { ...company("B", 20, 4), twelveData: undefined, quarterRevenueGrowth: null, quarterRevenueQoq: 12,
    balance: { end: "2026-09-30", currentRatio: null, cash: { value: 50 }, debtCurrent: null, debtNoncurrent: null, debtTotal: { value: 100, source: "total" } } };
  const scores = Object.fromEntries(comparisonScores(bank, NOW).map(s => [s.id, s.value]));
  assert.equal(scores.financial, 5);          // 10 x min(50/100, 1)
  assert.equal(scores.growth, 6.2);           // 5 + 12/10
});

test("a quarter with two revenue lines uses the annual figure's own line (Applied Digital: total revenue, not contract revenue)", () => {
  const f = facts();
  const rev = f.facts["us-gaap"].RevenueFromContractWithCustomerExcludingAssessedTax.units.USD;
  f.facts["us-gaap"].Revenues = { units: { USD: rev.map(r => ({ ...r, val: r.start === "2026-07-01" ? 260 : r.val })) } };
  f.facts["us-gaap"].RevenueFromContractWithCustomerExcludingAssessedTax.units.USD = rev.filter(r => r.form === "10-Q");
  const c = extractFinancials("APLD", "1", f, NOW);
  assert.equal(c.revenue.tag, "Revenues");
  assert.equal(c.quarterRevenue.tag, "Revenues");
  assert.equal(c.quarterRevenue.value, 260);
});
