// Fourth independent review of PR #904 (Nov 26): each finding tested on the shape of the named company's own SEC facts.
import test from "node:test";
import assert from "node:assert/strict";
import { extractFinancials, overlappingLines } from "../lib/research/comparison.ts";
import { comparisonScores, comparisonMetric } from "../lib/research/comparison-scorecard.ts";
import { prepareComparisonAnalysis } from "../lib/research/comparison-analysis.ts";

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
const debtOf = (t, lines, liabilities = 1e12, sic) => {
  const facts = { RevenueFromContractWithCustomerExcludingAssessedTax: usd([year(4e9), ...q3(1e9, 9e8)]), OperatingIncomeLoss: usd([year(1e9), ...q3(2e8)]),
    CashAndCashEquivalentsAtCarryingValue: usd([at("2026-09-30", 1e9)]), Liabilities: usd([at("2026-09-30", liabilities)]),
    ...Object.fromEntries(Object.entries(lines).map(([tag, v]) => [tag, usd([at("2026-09-30", v)])])) };
  return ex(t, facts, sic).balance?.debtTotal ?? null;
};

test("H-1: one borrowing filed under overlapping lines is counted once (HYPD, NRXS, LSE, WAFD)", () => {
  assert.equal(debtOf("HYPD", { NotesPayable: 182_637, ShortTermBankLoansAndNotesPayable: 182_637 }).value, 182_637);
  assert.equal(debtOf("NRXS", { ShortTermBorrowings: 207_306, NotesPayableCurrent: 207_306 }).value, 207_306);
  assert.equal(debtOf("LSE", { LoansPayable: 3_068_046, LoansPayableCurrent: 3_068_046, ShortTermBorrowings: 3_068_046 }).value, 3_068_046);
  assert.equal(debtOf("WAFD", { AdvancesFromFederalHomeLoanBanks: 2_493_400_000, OtherLongTermDebt: 2_493_400_000 }, 1e12, "6021").value, 2_493_400_000);
});

test("H-1: the parts of a short-term borrowings total, or of a bank's borrowed funds, are not added to it (XYF ~2.4x, LZMH, PFS, CBAN, UFG)", () => {
  // XYF: short-term borrowings of RMB409.5m are its bank loans (208.5m) and non-bank loans (201.0m); cash of RMB1bn covers them about 2.4 times.
  const xyf = debtOf("XYF", { ShortTermBorrowings: 409_530_006, ShortTermBankLoansAndNotesPayable: 208_500_000, ShortTermNonBankLoansAndNotesPayable: 201_030_006 }, 1e12, "6199");
  assert.equal(xyf.value, 409_530_006);
  assert.equal(debtOf("LZMH", { ShortTermBorrowings: 57_043_000, ShortTermBankLoansAndNotesPayable: 52_108_000, OtherShortTermBorrowings: 4_935_000 }).value, 57_043_000);
  // PFS: borrowed funds of $2.39bn (its balance sheet) hold the advances, and the short-term and long-term borrowings; subordinated debentures beside.
  assert.equal(debtOf("PFS", { OtherBorrowings: 2_390_788_000, AdvancesFromFederalHomeLoanBanks: 1_981_530_000, OtherShortTermBorrowings: 2_340_000_000,
    OtherLongTermDebt: 52_000_000, SubordinatedDebt: 429_464_000 }, 22_982_968_000, "6035").value, 2_820_252_000);
  assert.equal(debtOf("CBAN", { OtherBorrowings: 263_200_000, AdvancesFromFederalHomeLoanBanks: 200_000_000, OtherLongTermDebt: 63_200_000 }, 1e12, "6022").value, 263_200_000);
  assert.equal(debtOf("UFG", { ShortTermBorrowings: 4_215_217, CommercialPaper: 3_000_000, LineOfCredit: 1_215_217 }).value, 4_215_217);
  // Separate lines stay separate: ONB's advances above its other borrowings; a credit line equal to the notes (third review, L-3).
  assert.equal(debtOf("ONB", { AdvancesFromFederalHomeLoanBanks: 5_484_611_000, OtherBorrowings: 1_408_438_000 }, 1e12, "6021").value, 6_893_049_000);
  assert.equal(debtOf("X", { NotesPayable: 500e6, LineOfCredit: 500e6 }).value, 1000e6);
  assert.deepEqual(overlappingLines([{ value: 100, total: true }, { value: 60, partOf: [100] }, { value: 100 }]), [100]);
});

test("H-2: the net-income stand-in for pre-tax income leaves out discontinued operations and a parent-only net income (AFCG)", () => {
  // AFCG: net income of $6.4m holds a $0.28-a-share gain on discontinued operations; total investment income $8.6m. It was a 79.5% margin.
  const facts = { GrossInvestmentIncomeOperating: usd([year(40e6), ...q3(8_565_440, 9e6)]), NetIncomeLoss: usd([year(20e6), ...q3(6_400_248)]),
    IncomeTaxExpenseBenefit: usd([year(1e6), ...q3(412_649)]),
    IncomeLossFromDiscontinuedOperationsNetOfTaxPerBasicShare: { units: { "USD/shares": [...q3(0.28)] } } };
  const afcg = ex("AFCG", facts, "0000");
  assert.notEqual(afcg.quarterOperatingIncome?.tag, "TechPhasePretaxIncome");
  assert.ok(!(afcg.quarterOperatingMargin > 50), "never the 79.5% of a disposal gain");
  // Income from continuing operations is the stand-in when filed.
  const cont = ex("AFCG", { ...facts, IncomeLossFromContinuingOperations: usd([year(15e6), ...q3(3_100_000)]) }, "0000");
  assert.equal(cont.quarterOperatingIncome.tag, "TechPhasePretaxIncome");
  assert.ok(Math.abs(cont.quarterOperatingIncome.value - 3_512_649) < 1);
  // Net income attributable to the parent beside a non-controlling interest is not added to the group's tax.
  const nci = ex("NCI", { Revenues: usd([year(40e6), ...q3(10e6, 9e6)]), NetIncomeLoss: usd([year(5e6), ...q3(1e6)]), IncomeTaxExpenseBenefit: usd([year(1e6), ...q3(0.3e6)]),
    NetIncomeLossAttributableToNoncontrollingInterest: usd([year(2e6), ...q3(0.5e6)]) }, "6311");
  assert.equal(nci.quarterOperatingIncome, null);
  const group = ex("NCI", { Revenues: usd([year(40e6), ...q3(10e6, 9e6)]), NetIncomeLoss: usd([year(5e6), ...q3(1e6)]), ProfitLoss: usd([year(7e6), ...q3(1.5e6)]),
    IncomeTaxExpenseBenefit: usd([year(1e6), ...q3(0.3e6)]), NetIncomeLossAttributableToNoncontrollingInterest: usd([year(2e6), ...q3(0.5e6)]) }, "6311");
  assert.ok(Math.abs(group.quarterOperatingIncome.value - 1.8e6) < 1);
});

test("M-1: an operating margin is kept beside a pre-tax loss that named non-operating items explain (PROP, SCM)", () => {
  // PROP: revenue $129.5m, costs $65.5m (49.4% operating margin), pre-tax loss $67.3m after $134.2m of derivative losses.
  const prop = ex("PROP", { RevenueFromContractWithCustomerExcludingAssessedTax: usd([year(400e6), ...q3(129_502_000, 77.7e6)]), CostsAndExpenses: usd([year(250e6), ...q3(65_534_000)]),
    [PRETAX]: usd([year(50e6), ...q3(-67_348_000)]), DerivativeGainLossOnDerivativeNet: usd([year(-50e6), ...q3(-134_196_000)]) }, "1311");
  assert.equal(prop.quarterOperatingIncome.tag, "TechPhaseDerivedOperatingIncome");
  assert.ok(Math.abs(prop.quarterOperatingMargin - 49.4) < 0.05);
  // SCM, an investment company: total investment income $22.4m less expenses of $15.2m (its interest included, never added back): 32.0%,
  // beside a pre-tax loss after $13.5m of unrealized losses. It was −27% (pre-tax) and, with the interest added back, 69%.
  const scm = ex("SCM", { GrossInvestmentIncomeOperating: usd([year(90e6), ...q3(22_396_449, 25e6)]), OperatingExpenses: usd([year(60e6), ...q3(15_237_036)]),
    InterestExpenseOperating: usd([year(33e6), ...q3(8_342_992)]), NetIncomeLoss: usd([year(10e6), ...q3(-6_373_879)]), IncomeTaxExpenseBenefit: usd([year(1e6), ...q3(307_096)]),
    UnrealizedGainLossOnInvestments: usd([year(-5e6), ...q3(-13_504_680)]) }, "");
  assert.ok(Math.abs(scm.quarterOperatingMargin - 31.97) < 0.05);
  // Without such items, a worked-out figure far above the pre-tax income is still a partial expense line: pre-tax is used.
  const partial = ex("PART", { Revenues: usd([year(400e6), ...q3(100e6, 90e6)]), OperatingExpenses: usd([year(100e6), ...q3(20e6)]), [PRETAX]: usd([year(30e6), ...q3(10e6)]) }, "3714");
  assert.equal(partial.quarterOperatingIncome.tag, "TechPhasePretaxIncome");
  // A financial firm's always is (C-1 of the third review).
  assert.equal(ex("AFL", { Revenues: usd([year(13e9), ...q3(3.271e9, 4.74e9)]), OperatingExpenses: usd([year(5e9), ...q3(1.33e9)]), [PRETAX]: usd([year(4e9), ...q3(0.5e9)]),
    DerivativeGainLossOnDerivativeNet: usd([year(-1e9), ...q3(-1.4e9)]) }, "6321").quarterOperatingIncome.tag, "TechPhasePretaxIncome");
});

const firmFacts = equity => ({ Revenues: usd([year(8e9), ...q3(2.052e9, 1.9e9)]), [PRETAX]: usd([year(2.8e9), ...q3(0.739e9)]),
  NetIncomeLoss: usd([year(2.2e9), ...q3(0.6e9)]), CashAndCashEquivalentsAtCarryingValue: usd([at("2026-09-30", 2e9)]),
  LongTermDebt: usd([at("2026-09-30", 12e9)]), StockholdersEquity: usd([at("2026-09-30", equity)]), Assets: usd([at("2026-09-30", 100e9)]), Liabilities: usd([at("2026-09-30", 100e9 - equity)]) });
test("M-2: lenders, brokers and dealers outside the bank and insurer codes are not scored on cash against debt (OPRT 6199, NAVI and GS 6211)", () => {
  for (const [t, sic, kind] of [["OPRT", "6199", "lender"], ["NAVI", "6211", "broker"], ["GS", "6211", "broker"], ["CME", "6200", "broker"]]) {
    const c = ex(t, firmFacts(6e9), sic);
    assert.equal(c.sectorKind, kind, t);
    const financial = comparisonScores(c, T).find(s => s.id === "financial");
    assert.equal(financial.kind, "sector", t);
    assert.equal(financial.value, 3, t);   // 6% on the 0-20% scale
    assert.match(comparisonMetric(c, "financial", "en", T), /^Equity ÷ assets/, t);
    assert.ok(!prepareComparisonAnalysis(c, T).items.some(i => i.id === "debt-cash" || i.id === "financial"), t);
  }
});

test("M-3: payment processors (6099) and health insurers (6324) are measured as ordinary companies (EEFT, UNH, CI, ELV)", () => {
  const ordinary = sic => ex("X", { Revenues: usd([year(400e9), ...q3(113e9, 100e9)]), OperatingIncomeLoss: usd([year(30e9), ...q3(6.5e9)]), [PRETAX]: usd([year(25e9), ...q3(5.5e9)]),
    NetCashProvidedByUsedInOperatingActivities: usd([year(20e9), ...q3(5e9)]), PaymentsToAcquirePropertyPlantAndEquipment: usd([year(3e9), ...q3(0.7e9)]),
    CashAndCashEquivalentsAtCarryingValue: usd([at("2026-09-30", 25e9)]), AssetsCurrent: usd([at("2026-09-30", 100e9)]), LiabilitiesCurrent: usd([at("2026-09-30", 120e9)]),
    LongTermDebt: usd([at("2026-09-30", 74e9)]), StockholdersEquity: usd([at("2026-09-30", 100e9)]), Assets: usd([at("2026-09-30", 300e9)]), Liabilities: usd([at("2026-09-30", 200e9)]) }, sic);
  for (const sic of ["6324", "6099"]) {
    const c = ordinary(sic);
    assert.equal(c.sectorKind, undefined, sic);
    assert.equal(c.financeSic, undefined, sic);
    assert.equal(c.quarterOperatingIncome.tag, "OperatingIncomeLoss", sic);   // never an insurer's pre-tax stand-in
    assert.ok(Math.abs(c.quarterFcfMargin - 3.8) < 0.05, sic);
    assert.match(comparisonMetric(c, "financial", "en", T), /^Current ratio/, sic);
  }
  // A property insurer and a bank keep their own yardsticks.
  assert.equal(ordinary("6331").sectorKind, "insurer");
  assert.equal(ordinary("6021").sectorKind, "bank");
});
