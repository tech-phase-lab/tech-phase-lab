// Third independent review of PR #904 (Nov 26): each finding tested on the shape of the named company's own SEC facts.
import test from "node:test";
import assert from "node:assert/strict";
import { extractFinancials } from "../lib/research/comparison.ts";
import { comparisonScores, comparisonMetric } from "../lib/research/comparison-scorecard.ts";
import { prepareComparisonAnalysis } from "../lib/research/comparison-analysis.ts";
import { appendMarketItems } from "../lib/research/twelve-data-financials.ts";

const T = Date.parse("2026-11-26T03:00:00Z");
const FY = "0000000001-26-000000", Q3 = "0000000001-26-000003";
const row = (start, end, val, accn, filed, form = "10-Q") => ({ start, end, val, accn, filed, form });
const at = (end, val) => ({ end, val, accn: Q3, filed: "2026-11-05", form: "10-Q" });
const usd = list => ({ units: { USD: list } });
const gaap = facts => ({ cik: 1, facts: { "us-gaap": facts } });
const year = val => row("2025-01-01", "2025-12-31", val, FY, "2026-02-20", "10-K");
const q3 = (val, prior) => [row("2026-07-01", "2026-09-30", val, Q3, "2026-11-05"), ...(prior === undefined ? [] : [row("2025-07-01", "2025-09-30", prior, Q3, "2026-11-05")])];
const PRETAX = "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest";
const ex = (t, facts, sic) => extractFinancials(t, "1", gaap(facts), T, undefined, undefined, undefined, sic);

test("C-1: the operating figure is worked out from the total revenue line it is divided by; an insurer is scored on pre-tax (BRK, ITIC)", () => {
  // BRK: contract revenue $30bn inside total revenues of $105.6bn; costs and expenses $92.1bn; pre-tax $27.1bn.
  const brk = ex("BRK-B", { Revenues: usd([year(400e9), ...q3(105.647e9, 95e9)]), RevenueFromContractWithCustomerExcludingAssessedTax: usd([year(120e9), ...q3(30e9, 29e9)]),
    CostsAndExpenses: usd([year(350e9), ...q3(92.1e9)]), [PRETAX]: usd([year(70e9), ...q3(27.146e9)]) }, "6331");
  assert.equal(brk.quarterRevenue.tag, "Revenues");
  assert.ok(brk.quarterOperatingMargin > 0, "never the −16.2% of contract revenue less every cost");
  assert.equal(brk.quarterOperatingIncome.tag, "TechPhasePretaxIncome");
  assert.ok(Math.abs(brk.quarterOperatingMargin - 25.69) < 0.05);
  // A non-insurer with the same lines: total revenue less total costs (13.5%), within a quarter of revenue of its pre-tax income.
  const other = ex("BRKLIKE", { Revenues: usd([year(400e9), ...q3(105.647e9, 95e9)]), RevenueFromContractWithCustomerExcludingAssessedTax: usd([year(120e9), ...q3(30e9, 29e9)]),
    CostsAndExpenses: usd([year(350e9), ...q3(91.4e9)]), [PRETAX]: usd([year(70e9), ...q3(27.146e9)]) }, "3714");
  assert.equal(other.quarterOperatingIncome.tag, "TechPhaseDerivedOperatingIncome");
  assert.ok(Math.abs(other.quarterOperatingMargin - 13.49) < 0.05);
  const itic = ex("ITIC", { Revenues: usd([year(300e6), ...q3(81.895e6, 73e6)]), RevenueFromContractWithCustomerExcludingAssessedTax: usd([year(60e6), ...q3(15e6, 14e6)]),
    CostsAndExpenses: usd([year(250e6), ...q3(70.5e6)]), [PRETAX]: usd([year(50e6), ...q3(11.407e6)]) }, "6361");
  assert.ok(Math.abs(itic.quarterOperatingMargin - 13.93) < 0.05);
});

test("C-1: a worked-out figure far from the pre-tax income (a partial expense line) gives way to the pre-tax income (AFL, NAVI, OPRT)", () => {
  // NAVI-like lender with a partial 'operating expenses' line: 76.3% worked out against 4.1% pre-tax.
  const navi = ex("NAVI", { Revenues: usd([year(1.3e9), ...q3(317e6, 161e6)]), OperatingExpenses: usd([year(300e6), ...q3(75e6)]), [PRETAX]: usd([year(80e6), ...q3(13e6)]) }, "6111");
  assert.equal(navi.quarterOperatingIncome.tag, "TechPhasePretaxIncome");
  assert.ok(Math.abs(navi.quarterOperatingMargin - 4.1) < 0.05);
  const afl = ex("AFL", { Revenues: usd([year(13e9), ...q3(3.271e9, 4.74e9)]), OperatingExpenses: usd([year(5e9), ...q3(1.33e9)]), [PRETAX]: usd([year(4e9), ...q3(0.5e9)]) }, "6311");
  assert.ok(Math.abs(afl.quarterOperatingMargin - 15.29) < 0.05);
  const oprt = ex("OPRT", { Revenues: usd([year(1e9), ...q3(246.277e6, 238.7e6)]), RevenueFromContractWithCustomerExcludingAssessedTax: usd([year(80e6), ...q3(20e6, 19e6)]),
    CostsAndExpenses: usd([year(900e6), ...q3(211e6)]), [PRETAX]: usd([year(120e6), ...q3(34.584e6)]) }, "6141");
  assert.equal(oprt.quarterRevenue.tag, "Revenues");
  assert.ok(oprt.quarterOperatingMargin > 0);
});

const debtOf = (t, lines, liabilities = 1e12, sic) => {
  const facts = { RevenueFromContractWithCustomerExcludingAssessedTax: usd([year(4e9), ...q3(1e9, 9e8)]), OperatingIncomeLoss: usd([year(1e9), ...q3(2e8)]),
    CashAndCashEquivalentsAtCarryingValue: usd([at("2026-09-30", 1e9)]), Liabilities: usd([at("2026-09-30", liabilities)]),
    ...Object.fromEntries(Object.entries(lines).map(([tag, v]) => [tag, usd([at("2026-09-30", v)])])) };
  return ex(t, facts, sic).balance?.debtTotal ?? null;
};
test("H-1: senior notes inside notes payable, or behind the current debt, are not counted twice (PHM $1.81bn, TEVA $16.7bn)", () => {
  assert.equal(debtOf("PHM", { NotesPayable: 1_808_896_000, SeniorNotes: 1_783_504_000, LineOfCredit: 0 }).value, 1_808_896_000);
  assert.equal(debtOf("TEVA", { DebtCurrent: 4_038e6, LongTermDebtCurrent: 4_038e6, LongTermNotesAndLoans: 12_680e6, SeniorNotes: 16_786e6, SeniorNotesCurrent: 4_038e6 }).value, 16_718e6);
  // Without a long-term line, the senior total stands in for a current debt that is its current part.
  assert.equal(debtOf("TEVA", { DebtCurrent: 4_038e6, SeniorNotes: 16_786e6, SeniorNotesCurrent: 4_038e6 }).value, 16_786e6);
});

test("H-2: long-term notes and loans, and the current debt line, are read (ORCL $125.3bn, PG $38.9bn, XOM $34.3bn)", () => {
  assert.equal(debtOf("ORCL", { LongTermNotesAndLoans: 117_712e6, NotesPayableCurrent: 7_625e6 }).value, 125_337e6);
  assert.equal(debtOf("PG", { LongTermDebtNoncurrent: 21_897e6, DebtCurrent: 17_028e6 }).value, 38_925e6);
  assert.equal(debtOf("XOM", { LongTermDebtAndCapitalLeaseObligations: 29_727e6, DebtCurrent: 4_523e6 }).value, 34_250e6);
  // OPRT: warehouse borrowings are read; as a lender it is scored on its equity ratio, never cash against debt. Its secured debt ($94.8m of
  // asset-backed notes, a balance-sheet line of its own beside the $449.7m of secured financing) is added too (L-1, Nov 28).
  assert.equal(debtOf("OPRT", { WarehouseAgreementBorrowings: 449_718e3, SecuredDebt: 94_754e3 }).value, 449_718e3 + 94_754e3);
});

test("L-3: equal amounts in different instrument families are both counted; only a bank's borrowings filed twice count once", () => {
  assert.equal(debtOf("X", { NotesPayable: 500e6, LineOfCredit: 500e6 }).value, 1000e6);
  assert.equal(debtOf("RJF", { OtherBorrowings: 760e6, AdvancesFromFederalHomeLoanBanks: 760e6, SeniorNotes: 3522e6 }).value, 4282e6);
});

test("H-3: an insurer's adjusted 'operating income' is never its margin; insurers are not scored on a BDC's margin (MET, ALL, PFG)", () => {
  const met = ex("MET", { Revenues: usd([year(75e9), ...q3(20.522e9, 17.36e9)]), OperatingIncomeLoss: usd([year(9e9), ...q3(4.1e9)]), [PRETAX]: usd([year(6e9), ...q3(3e9)]) }, "6311");
  assert.equal(met.quarterOperatingIncome.tag, "TechPhasePretaxIncome");
  assert.ok(Math.abs(met.quarterOperatingMargin - 14.62) < 0.05);
  // ALL: no pre-tax line; net income plus income tax. Its net investment income is not a BDC's margin.
  const all = ex("ALL", { Revenues: usd([year(68e9), ...q3(17.348e9, 17.25e9)]), NetIncomeLoss: usd([year(8e9), ...q3(2.079e9)]), IncomeTaxExpenseBenefit: usd([year(2e9), ...q3(0.538e9)]),
    NetInvestmentIncome: usd([year(3e9), ...q3(0.9e9)]), StockholdersEquity: usd([at("2026-09-30", 30e9)]), Assets: usd([at("2026-09-30", 118e9)]),
    CashAndCashEquivalentsAtCarryingValue: usd([at("2026-09-30", 1e9)]) }, "6331");
  assert.equal(all.quarterOperatingIncome.value, 2.617e9);
  assert.equal(all.sectorMetrics?.niiMargin ?? null, null);
});

const bankFacts = equity => ({ Revenues: usd([year(8e9), ...q3(2.052e9, 1.9e9)]), [PRETAX]: usd([year(2.8e9), ...q3(0.739e9)]),
  NetIncomeLoss: usd([year(2.2e9), ...q3(0.6e9)]), CashAndCashEquivalentsAtCarryingValue: usd([at("2026-09-30", 2e9)]),
  LongTermDebt: usd([at("2026-09-30", 12e9)]), StockholdersEquity: usd([at("2026-09-30", equity)]), Assets: usd([at("2026-09-30", 100e9)]), Liabilities: usd([at("2026-09-30", 100e9 - equity)]) });
test("M-2: a bank's or insurer's financial strength is its equity ratio, never cash against debt, and no 'debt exceeds cash' point (KEY, TRV, FVCB)", () => {
  for (const [t, sic] of [["KEY", "6021"], ["TRV", "6331"], ["FVCB", "6022"]]) {
    const c = ex(t, bankFacts(9.2e9), sic);
    const financial = comparisonScores(c, T).find(s => s.id === "financial");
    assert.equal(financial.kind, "sector", t);
    assert.match(comparisonMetric(c, "financial", "ja", T), /^自己資本比率/, t);
    assert.ok(!prepareComparisonAnalysis(c, T).items.some(i => i.id === "debt-cash" || i.id === "financial"), t);
  }
});

test("M-1: the bank scale is for banks only; a mortgage REIT and an insurer use the 0-20% scale (NLY)", () => {
  const nly = ex("NLY", bankFacts(10.8e9), "6798");
  const kb = ex("KEY", bankFacts(10.8e9), "6021");
  const score = c => comparisonScores(c, T).find(s => s.id === "financial").value;
  assert.equal(score(kb), 10);              // (10.8 - 2) / 8 x 10, capped
  assert.notEqual(score(nly), 10);
  assert.equal(score(ex("TRV", bankFacts(10.8e9), "6331")), 5.4);   // 10.8 / 2
});

test("L-1: a fiscal-year margin series is said as fiscal years in the margin-decline point (JA and EN)", () => {
  const prepared = { items: [] };
  const evidence = { periodEnd: "2025-12-31", periodMonths: 12, marginPeriod: "annual", statistics: null, momentum: null,
    margins: [{ periodEnd: "2025-12-31", value: 10 }, { periodEnd: "2024-12-31", value: 14 }, { periodEnd: "2023-12-31", value: 13 }, { periodEnd: "2022-12-31", value: 12 }] };
  appendMarketItems(prepared, evidence, "2025-12-31", "USD", Date.parse("2026-03-01"));
  const item = prepared.items.find(i => i.id === "margin-decline");
  assert.ok(item, JSON.stringify(prepared.items));
  assert.match(item.detail.en, /fiscal year ended 2024-12-31 to the fiscal year ended 2025-12-31/);
  assert.match(item.detail.ja, /に終わる年度から/);
  assert.doesNotMatch(item.detail.en, /quarter/);
});

test("L-5: a free cash flow margin is a strength only where the score calls it one (SO's 0.4% is not)", () => {
  const facts = fcf => ({ RevenueFromContractWithCustomerExcludingAssessedTax: usd([year(28e9), ...q3(7.8e9, 7.3e9)]), OperatingIncomeLoss: usd([year(7e9), ...q3(2.4e9)]),
    NetCashProvidedByUsedInOperatingActivities: usd([row("2026-07-01", "2026-09-30", 3e9 + fcf, Q3, "2026-11-05")]), PaymentsToAcquirePropertyPlantAndEquipment: usd([row("2026-07-01", "2026-09-30", 3e9, Q3, "2026-11-05")]) });
  const so = ex("SO", facts(31.2e6), "4911");
  assert.ok(Math.abs(so.quarterFcfMargin - 0.4) < 0.01);
  assert.ok(!prepareComparisonAnalysis(so, T).items.some(i => i.id === "cash-generation"));
  const strong = ex("SO", facts(1.2e9), "4911");
  assert.ok(prepareComparisonAnalysis(strong, T).items.some(i => i.id === "cash-generation" && i.kind === "strength"));
});

test("H-2: borrowings under lines found unread in the universe-wide scan are read, and a sub-line is never added to its parent total (NTES, SBLK, PHM)", () => {
  assert.equal(debtOf("NTES", { ShortTermBankLoansAndNotesPayable: 912_959e3, LongTermLoansPayable: 5_471_458e3 }).value, 912_959e3 + 5_471_458e3);
  assert.equal(debtOf("SBLK", { LoansPayableToBankCurrent: 230_850e3, LoansPayableToBankNoncurrent: 11_209e3 }).value, 242_059e3);
  assert.equal(debtOf("PHM", { NotesPayable: 1_808_896_000, OtherNotesPayable: 25_392_000, SeniorNotes: 1_783_504_000 }).value, 1_808_896_000);
  assert.equal(debtOf("SCHW", { LongTermDebt: 24_565e6, OtherShortTermBorrowings: 14_213e6 }).value, 24_565e6 + 14_213e6);
});
