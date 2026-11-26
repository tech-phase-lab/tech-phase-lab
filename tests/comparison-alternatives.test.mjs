// Company-type metrics (owner, Nov 26: IMUX, a drug developer with no sales, showed no growth, profitability, cash or stability at all).
// A company with no revenue in the last twelve months is compared on its cash runway, net-income trend, R&D share and share dilution; a bank,
// insurer, broker or BDC without a debt figure or free cash flow on its capital ratio and ROE. Every figure comes from the filing's own facts,
// every score is on a fixed scale of the company's own figure, and a company scores the same whoever it is compared with.
import test from "node:test";
import assert from "node:assert/strict";
import { extractFinancials } from "../lib/research/comparison.ts";
import { comparisonScores, comparisonMetric, comparisonAvailability } from "../lib/research/comparison-scorecard.ts";
import { ALTERNATIVE_SCALES, standaloneQuarters } from "../lib/research/comparison-alternatives.ts";

const now = Date.parse("2026-11-26T12:00:00Z");
const f = (val, start, end, accn, form = "10-Q", filed) => ({ val, ...(start ? { start } : {}), end, accn, form, filed: filed ?? addDays(end, 40) });
function addDays(d, n) { return new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10); }
const unit = values => ({ units: { USD: values } });
const shares = values => ({ units: { shares: values } });

/** IMUX's own figures (10-Q for Sep 30, 2026 and the filings before it, as the SEC's company facts list them), simplified to the tags read. */
function drugDeveloper({ ticker = "IMUX", cik = "1280776", lastRevenue = null } = {}) {
  const A = "0001280776-26-000021", B = "0001280776-26-000018", Cq = "0001280776-26-000010", K = "0001280776-26-000005", P = "0001280776-25-000017";
  const ocf = [f(-23_000_000, "2026-01-01", "2026-03-31", Cq), f(-48_500_000, "2026-01-01", "2026-06-30", B), f(-72_000_000, "2026-01-01", "2026-09-30", A),
    f(-95_969_000, "2025-01-01", "2025-12-31", K, "10-K"), f(-72_000_000, "2025-01-01", "2025-09-30", P)];
  const ni = [f(-30_000_000, "2026-07-01", "2026-09-30", A), f(-31_000_000, "2026-04-01", "2026-06-30", B), f(-33_296_000, "2026-01-01", "2026-03-31", Cq),
    f(-34_000_000, "2025-10-01", "2025-12-31", K, "10-K"), f(-27_000_000, "2025-07-01", "2025-09-30", P), f(-26_000_000, "2025-04-01", "2025-06-30", P),
    f(-25_047_000, "2025-01-01", "2025-03-31", P), f(-25_000_000, "2024-10-01", "2024-12-31", P, "10-K")];
  return { cik: Number(cik), entityName: ticker, facts: {
    "us-gaap": {
      CashAndCashEquivalentsAtCarryingValue: unit([f(81_963_000, null, "2026-09-30", A), f(90_000_000, null, "2025-12-31", K, "10-K")]),
      ShortTermInvestments: unit([f(50_000_000, null, "2026-09-30", A)]),
      AssetsCurrent: unit([f(140_000_000, null, "2026-09-30", A)]), LiabilitiesCurrent: unit([f(20_000_000, null, "2026-09-30", A)]),
      StockholdersEquity: unit([f(104_473_000, null, "2026-09-30", A)]), Assets: unit([f(150_000_000, null, "2026-09-30", A)]),
      LiabilitiesNoncurrent: unit([f(5_000_000, null, "2026-09-30", A)]),
      NetCashProvidedByUsedInOperatingActivities: unit(ocf), NetIncomeLoss: unit(ni),
      ResearchAndDevelopmentExpense: unit([f(23_948_000, "2026-07-01", "2026-09-30", A)]), OperatingExpenses: unit([f(43_369_000, "2026-07-01", "2026-09-30", A)]),
      WeightedAverageNumberOfSharesOutstandingBasic: shares([f(42_797_370, "2026-07-01", "2026-09-30", A), f(19_389_776, "2025-07-01", "2025-09-30", A)]),
      ...(lastRevenue ? { Revenues: unit([f(lastRevenue, "2019-01-01", "2019-12-31", "0001280776-20-000001", "10-K")]) } : {}),
    } } };
}

test("a drug developer's runway, net-loss trend, R&D share and dilution, read from its filings and scored on fixed scales", () => {
  const c = extractFinancials("IMUX", "1280776", drugDeveloper(), now);
  assert.equal(c.preRevenue, true);
  const m = c.preRevenueMetrics;
  assert.equal(m.liquid, 131_963_000);                       // cash 81.963m + short-term investments 50m
  assert.equal(m.burn.quarters, 4);                          // Q4 2025 (FY − 9M), Q1, Q2 (YTD differences), Q3
  assert.equal(Math.round(m.burn.perQuarter), 23_992_250);   // (23.969 + 23 + 25.5 + 23.5) ÷ 4
  assert.deepEqual([m.netIncome.now, m.netIncome.before, m.netIncome.basis], [-128_296_000, -103_047_000, "quarters"]);
  assert.equal(m.rd.share.toFixed(1), "55.2");
  assert.equal(m.dilution.pct.toFixed(1), "120.7");          // 42.80m vs 19.39m, both in the Sep 30, 2026 10-Q (split-restated)
  const scores = Object.fromEntries(comparisonScores(c, now).map(s => [s.id, s.value]));
  assert.deepEqual({ growth: scores.growth, profitability: scores.profitability, cash: scores.cash, stability: scores.stability },
    { growth: 2.5, profitability: null, cash: 6.9, stability: 0 });
  assert.equal(comparisonMetric(c, "cash", "ja", now), "資金の持ち期間 約17か月");
  assert.equal(comparisonMetric(c, "growth", "ja", now), "直近4四半期の赤字が前年より24.5%拡大");
  // No revenue, no margin: profitability is not scored; the R&D share is shown as a fact (owner's review, Nov 26).
  assert.equal(comparisonMetric(c, "profitability", "ja", now), "売上なし（研究開発費は費用の55%）");
  assert.equal(comparisonMetric(c, "stability", "ja", now), "株数の増加 前年比+120.7%");
  assert.match(comparisonAvailability(c, "ja", now), /資金の持ち期間/);
});

test("a company whose sales stopped years ago is compared like a drug developer (ALXO: last revenue 2020)", () => {
  const c = extractFinancials("ALXO", "1280776", drugDeveloper({ ticker: "ALXO", lastRevenue: 5_000_000 }), now);
  assert.equal(c.preRevenue, true);
  assert.ok(comparisonScores(c, now).filter(s => ["growth", "cash", "stability"].includes(s.id)).every(s => s.value !== null));
});

test("the scales are fixed: the same figure always gives the same score", () => {
  const S = ALTERNATIVE_SCALES;
  assert.deepEqual([0, 12, 24, 60].map(months => S.runway({ months, cashPositive: false })), [0, 5, 10, 10]);
  assert.equal(S.runway({ months: null, cashPositive: true }), 10);
  assert.deepEqual([-50, 0, 50].map(S.lossTrend), [0, 5, 10]);
  assert.deepEqual([0, 40, 80, 100].map(S.rdIntensity), [0, 5, 10, 10]);
  assert.deepEqual([-10, 0, 25, 50, 200].map(S.dilution), [10, 10, 5, 0, 0]);
  assert.deepEqual([2, 6, 10, 45].map(p => S.capitalRatio(p, true)), [0, 5, 10, 10]);   // a bank's scale (reviewer, Nov 26)
  assert.deepEqual([0, 10, 20, 45].map(p => S.capitalRatio(p)), [0, 5, 10, 10]);            // every other financial firm (third review: NLY)
  assert.deepEqual([-15, 0, 15].map(S.roe), [0, 5, 10]);
});

test("a company-type score depends on the company alone, never on the companies beside it", () => {
  const imux = () => extractFinancials("IMUX", "1280776", drugDeveloper(), now);
  const alone = comparisonScores(imux(), now);
  // Scores are a function of one company's figures: computing others first, or in any order, changes nothing.
  for (const other of [drugDeveloper({ ticker: "ALXO", lastRevenue: 5_000_000 }), drugDeveloper({ ticker: "XYZ" })]) {
    extractFinancials("OTHER", "1280776", other, now);
    assert.deepEqual(comparisonScores(imux(), now), alone);
  }
});

test("a standalone quarter is a direct three-month figure, a year-to-date difference or a fiscal year minus nine months", () => {
  const q = standaloneQuarters([f(-10, "2026-01-01", "2026-03-31", "a"), f(-25, "2026-01-01", "2026-06-30", "b"), f(-40, "2025-01-01", "2025-12-31", "c", "10-K"),
    f(-30, "2025-01-01", "2025-09-30", "d")]);
  assert.deepEqual(Object.fromEntries(q), { "2026-03-31": -10, "2026-06-30": -15, "2025-12-31": -10 });
});

test("a bank without a debt figure is scored on equity ÷ assets and ROE, said as such", () => {
  const A = "0000000001-26-000010", B = "0000000001-26-000005", P = "0000000001-25-000030";
  const q = (v, s, e, a) => f(v, s, e, a);
  const payload = { cik: 1, facts: { "us-gaap": {
    InterestIncomeExpenseNet: unit([q(90, "2026-07-01", "2026-09-30", A), q(80, "2025-07-01", "2025-09-30", A), q(85, "2026-04-01", "2026-06-30", B), q(82, "2026-01-01", "2026-03-31", B), q(300, "2025-01-01", "2025-12-31", P, "10-K"), q(78, "2024-01-01", "2024-12-31", P, "10-K")]),
    NoninterestIncome: unit([q(10, "2026-07-01", "2026-09-30", A), q(10, "2025-07-01", "2025-09-30", A), q(10, "2026-04-01", "2026-06-30", B), q(10, "2026-01-01", "2026-03-31", B), q(40, "2025-01-01", "2025-12-31", P, "10-K"), q(10, "2024-01-01", "2024-12-31", P, "10-K")]),
    IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: unit([q(40, "2026-07-01", "2026-09-30", A)]),
    NetIncomeLoss: unit([q(30, "2026-07-01", "2026-09-30", A), q(28, "2026-04-01", "2026-06-30", B), q(27, "2026-01-01", "2026-03-31", B), q(25, "2025-10-01", "2025-12-31", P, "10-K")]),
    CashAndCashEquivalentsAtCarryingValue: unit([f(500, null, "2026-09-30", A)]), Assets: unit([f(10_000, null, "2026-09-30", A)]),
    StockholdersEquity: unit([f(1_000, null, "2026-09-30", A)]), Deposits: unit([f(8_000, null, "2026-09-30", A)]),
  } } };
  const c = extractFinancials("BANK", "1", payload, now, undefined, undefined, undefined, "6022");
  const s = Object.fromEntries(comparisonScores(c, now).map(x => [x.id, x.value]));
  assert.equal(c.sectorMetrics.capitalRatio, 10);
  assert.equal(s.financial, 10);                                // equity ÷ assets 10% on the bank scale (2% = 0, 10% = 10)
  assert.equal(comparisonMetric(c, "financial", "ja", now), "自己資本比率 10.0%");
  assert.equal(c.sectorMetrics.roe.basis, "quarters");          // 30 + 28 + 27 + 25 over equity 1,000
  assert.equal(comparisonMetric(c, "cash", "ja", now), "ROE +11.0%");
});
