import test from "node:test";
import assert from "node:assert/strict";
import { extractFinancials } from "../lib/research/comparison.ts";
import { fillFromProvider } from "../lib/research/comparison-fill.ts";
import { comparisonScores, comparisonMetric } from "../lib/research/comparison-scorecard.ts";

// Nov 26 data-quality audit of every listed company: figures that were wrong, held or mislabelled, each rebuilt from the shape of the
// company's real SEC facts. Wrong numbers must never ship; a figure the filings cannot support is withheld with its reason.
const NOW = Date.parse("2026-11-26T03:00:00Z");
const fact = (start, end, val, accn, filed, form = "10-Q") => ({ start, end, val, accn, filed, form });
const instant = (end, val, accn, filed, form = "10-Q") => ({ end, val, accn, filed, form });
const FY = "0000000001-26-000000", Q1 = "0000000001-26-000001", Q2 = "0000000001-26-000002", Q3 = "0000000001-26-000003";
const usd = list => ({ units: { USD: list } });
const payload = facts => ({ cik: 1, facts: { "us-gaap": facts } });

test("the same revenue filed in full and rounded in one report is one figure at full precision (AECOM fiscal 2026)", () => {
  const c = extractFinancials("ACM", "1", payload({
    RevenueFromContractWithCustomerExcludingAssessedTax: usd([
      fact("2024-10-01", "2025-09-30", 16139622000, FY, "2026-11-18", "10-K"),
      fact("2025-10-01", "2026-09-30", 15096370000, FY, "2026-11-18", "10-K"),
      fact("2025-10-01", "2026-09-30", 15096400000, FY, "2026-11-18", "10-K"),   // the segment note, in millions
    ]),
    OperatingIncomeLoss: usd([fact("2025-10-01", "2026-09-30", 619697000, FY, "2026-11-18", "10-K"), fact("2024-10-01", "2025-09-30", 1026522000, FY, "2026-11-18", "10-K")]),
  }), NOW);
  assert.equal(c.status, "ready");
  assert.equal(c.revenue.value, 15096370000);
  // A real difference is still a conflict, never a pick.
  const held = extractFinancials("ACM", "1", payload({
    RevenueFromContractWithCustomerExcludingAssessedTax: usd([
      fact("2025-10-01", "2026-09-30", 15096370000, FY, "2026-11-18", "10-K"), fact("2025-10-01", "2026-09-30", 14000000000, FY, "2026-11-18", "10-K"),
    ]),
  }), NOW);
  assert.equal(held.revenue, null);
});

test("revenue net of excise taxes is the revenue when the gross line is filed beside it (Cronos, NRx)", () => {
  const c = extractFinancials("CRON", "1", payload({
    RevenueFromContractWithCustomerExcludingAssessedTax: usd([fact("2025-01-01", "2025-12-31", 146587000, FY, "2026-02-26", "10-K"), fact("2024-01-01", "2024-12-31", 117615000, FY, "2026-02-26", "10-K")]),
    RevenueFromContractWithCustomerIncludingAssessedTax: usd([fact("2025-01-01", "2025-12-31", 193363000, FY, "2026-02-26", "10-K"), fact("2024-01-01", "2024-12-31", 158000000, FY, "2026-02-26", "10-K")]),
  }), NOW);
  assert.equal(c.revenue.tag, "RevenueFromContractWithCustomerExcludingAssessedTax");
  assert.equal(c.revenue.value, 146587000);
});

test("an advisory firm's investment banking revenue is its revenue; a bank's fee line never is (Moelis)", () => {
  const ib = usd([
    fact("2025-01-01", "2025-12-31", 1516796000, FY, "2026-02-25", "10-K"), fact("2024-01-01", "2024-12-31", 1194000000, FY, "2026-02-25", "10-K"),
    fact("2026-07-01", "2026-09-30", 425577000, Q3, "2026-11-04"), fact("2025-07-01", "2025-09-30", 356892000, Q3, "2026-11-04"),
  ]);
  const c = extractFinancials("MC", "1", payload({ InvestmentBankingRevenue: ib }), NOW, undefined, undefined, undefined, "6211");
  assert.equal(c.quarterRevenue.value, 425577000);
  assert.equal(c.quarterRevenue.tag, "InvestmentBankingRevenue");
  // A bank filing net interest and noninterest income: its derived revenue, not the investment banking fees.
  const bank = extractFinancials("BANK", "1", payload({
    InvestmentBankingRevenue: ib,
    InterestIncomeExpenseNet: usd([fact("2026-07-01", "2026-09-30", 5000000000, Q3, "2026-11-04"), fact("2025-07-01", "2025-09-30", 4800000000, Q3, "2026-11-04"),
      fact("2025-01-01", "2025-12-31", 19000000000, FY, "2026-02-25", "10-K"), fact("2024-01-01", "2024-12-31", 18000000000, FY, "2026-02-25", "10-K")]),
    NoninterestIncome: usd([fact("2026-07-01", "2026-09-30", 2000000000, Q3, "2026-11-04"), fact("2025-07-01", "2025-09-30", 1900000000, Q3, "2026-11-04"),
      fact("2025-01-01", "2025-12-31", 7600000000, FY, "2026-02-25", "10-K"), fact("2024-01-01", "2024-12-31", 7000000000, FY, "2026-02-25", "10-K")]),
  }), NOW, undefined, undefined, undefined, "6021");
  assert.equal(bank.quarterRevenue.value, 7000000000);
});

const cash = list => ({ CashAndCashEquivalentsAtCarryingValue: usd(list) });

test("a quarter whose revenue is unchanged year to date had no revenue: compared like a company without sales (Relay Q3 2026)", () => {
  const c = extractFinancials("RLAY", "1", payload({
    Revenues: usd([
      fact("2025-01-01", "2025-12-31", 15355000, FY, "2026-02-26", "10-K"),
      fact("2026-01-01", "2026-03-31", 3000000, Q1, "2026-05-07"),
      fact("2026-01-01", "2026-06-30", 3350000, Q2, "2026-08-06"), fact("2026-04-01", "2026-06-30", 350000, Q2, "2026-08-06"),
      fact("2026-01-01", "2026-09-30", 3350000, Q3, "2026-11-05"),
    ]),
    ...cash([instant("2026-09-30", 600000000, Q3, "2026-11-05")]),
  }), NOW, undefined, undefined, undefined, "2836");
  assert.equal(c.preRevenue, true);
  assert.equal(c.zeroQuarter, true);
  // Revenue that grew in the year to date is a real quarter, not a zero one.
  const grew = extractFinancials("RLAY", "1", payload({
    Revenues: usd([
      fact("2025-01-01", "2025-12-31", 15355000, FY, "2026-02-26", "10-K"),
      fact("2026-01-01", "2026-06-30", 3350000, Q2, "2026-08-06"), fact("2026-01-01", "2026-09-30", 4350000, Q3, "2026-11-05"),
    ]),
    ...cash([instant("2026-09-30", 600000000, Q3, "2026-11-05")]),
  }), NOW, undefined, undefined, undefined, "2836");
  assert.notEqual(grew.zeroQuarter, true);
});

test("a finance-coded company whose revenue is filed as zero, with no other revenue line, has a zero quarter (GPGI)", () => {
  const facts = () => ({
    RevenueFromContractWithCustomerExcludingAssessedTax: usd([
      fact("2025-01-01", "2025-12-31", 59824000, FY, "2026-03-10", "10-K"),
      fact("2026-07-01", "2026-09-30", 0, Q3, "2026-11-10"), fact("2025-07-01", "2025-09-30", 0, Q3, "2026-11-10"),
    ]),
    ...cash([instant("2026-09-30", 5500000, Q3, "2026-11-10")]),
  });
  const c = extractFinancials("GPGI", "1", payload(facts()), NOW, undefined, undefined, undefined, "6199");
  assert.equal(c.zeroQuarter, true);
  // A lender with interest income in that quarter is not: its revenue sits under another line.
  const lender = extractFinancials("LEND", "1", payload({ ...facts(), InterestAndFeeIncomeLoansAndLeases: usd([fact("2026-07-01", "2026-09-30", 9000000, Q3, "2026-11-10")]) }),
    NOW, undefined, undefined, undefined, "6199");
  assert.notEqual(lender.zeroQuarter, true);
});

test("operating income above revenue is no margin: withheld with its reason (YUM, MSTR)", () => {
  const c = extractFinancials("MSTR", "1", payload({
    Revenues: usd([fact("2025-01-01", "2025-12-31", 470000000, FY, "2026-02-05", "10-K"), fact("2026-07-01", "2026-09-30", 120000000, Q3, "2026-11-03"), fact("2025-07-01", "2025-09-30", 116000000, Q3, "2026-11-03")]),
    OperatingIncomeLoss: usd([fact("2025-01-01", "2025-12-31", -1000000, FY, "2026-02-05", "10-K"), fact("2026-07-01", "2026-09-30", 20000000000, Q3, "2026-11-03")]),
  }), NOW);
  assert.equal(c.quarterOperatingMargin, null);
  assert.equal(c.marginWithheld, true);
});

test("a bank's free cash flow is never scored, nor cash flow above revenue; a REIT's own is (HSBC 317%, MS −226%, ROIV 1,692%)", () => {
  const facts = () => ({
    Revenues: usd([fact("2025-01-01", "2025-12-31", 400, FY, "2026-02-20", "10-K"), fact("2026-07-01", "2026-09-30", 100, Q3, "2026-11-05"), fact("2025-07-01", "2025-09-30", 90, Q3, "2026-11-05")]),
    NetCashProvidedByUsedInOperatingActivities: usd([fact("2026-07-01", "2026-09-30", 317, Q3, "2026-11-05")]),
    PaymentsToAcquirePropertyPlantAndEquipment: usd([fact("2026-07-01", "2026-09-30", 0, Q3, "2026-11-05")]),
  });
  const bank = extractFinancials("BANK", "1", payload(facts()), NOW, undefined, undefined, undefined, "6021");
  assert.equal(bank.quarterFcfMargin, null);
  assert.equal(bank.fcfWithheld, "finance");
  // REIT: the same figures are its own, but cash flow above revenue (317%) is withheld as not revenue's cash.
  const reit = extractFinancials("REIT", "1", payload(facts()), NOW, undefined, undefined, undefined, "6798");
  assert.equal(reit.quarterFcfMargin, null);
  assert.equal(reit.fcfWithheld, "aboveRevenue");
  assert.equal(comparisonMetric(reit, "cash", "ja", NOW), "営業CFが売上を超え算出せず");
  const plain = facts(); plain.NetCashProvidedByUsedInOperatingActivities = usd([fact("2026-07-01", "2026-09-30", 30, Q3, "2026-11-05")]);
  assert.equal(extractFinancials("REIT", "1", payload(plain), NOW, undefined, undefined, undefined, "6798").quarterFcfMargin, 30);
  // The provider's same quarter never puts back what the filing withholds, nor gives a margin above 100%.
  const provider = { ...reit, quarterFcfMargin: 317, quarterOperatingMargin: 140, fcfWithheld: undefined, marginWithheld: undefined };
  assert.equal(fillFromProvider(bank, { ...provider, status: "ready" }, NOW).quarterFcfMargin, null);
  const open = { ...reit, fcfWithheld: undefined };
  const filled = fillFromProvider({ ...open, quarterOperatingMargin: null }, { ...provider, status: "ready" }, NOW);
  assert.equal(filled.quarterFcfMargin, null);
  assert.equal(filled.quarterOperatingMargin, null);
  // Whatever the source, a margin above 100% is never scored.
  const scores = Object.fromEntries(comparisonScores({ ...plain, ...open, quarterOperatingMargin: 140, quarterFcfMargin: 150 }, NOW).map(x => [x.id, x.value]));
  assert.equal(scores.profitability, null);
  assert.equal(scores.cash, null);
});

test("an IFRS bank whose readable revenue is interest and fees only gets no margin beside a profit that holds its other income (HSBC)", () => {
  const ifrs = (end, start, nii, fee, op, accn, filed, form) => ({ start, end, nii, fee, op, accn, filed, form });
  const periods = [ifrs("2025-12-31", "2025-01-01", 32000, 13343, 27996, FY, "2026-02-25", "20-F"), ifrs("2024-12-31", "2024-01-01", 30000, 12301, 29397, FY, "2026-02-25", "20-F")];
  const row = (p, key) => ({ start: p.start, end: p.end, val: p[key], accn: p.accn, filed: p.filed, form: p.form });
  const usdRows = key => ({ units: { USD: periods.map(p => row(p, key)) } });
  const c = extractFinancials("HSBC", "1", { cik: 1, facts: { "ifrs-full": {
    InterestRevenueExpense: usdRows("nii"), FeeAndCommissionIncomeExpense: usdRows("fee"), ProfitLossFromOperatingActivities: usdRows("op"),
  } } }, NOW, undefined, undefined, undefined, "6029");
  assert.equal(c.revenue.tag, "TechPhaseIfrsBankRevenue");
  assert.equal(c.quarterOperatingMargin, null);
  assert.equal(c.marginPartial, true);
  assert.equal(comparisonMetric(c, "profitability", "ja", NOW), "売上が利息・手数料のみで算出せず");
});
