// Second independent review of PR #904 (Nov 26): every finding, each tested with the real company it was found on. The scorecard cases use the
// companies' Financials as the comparison built them from their SEC filings on Nov 26 (tests/fixtures/comparison-review-904.json); the
// extraction cases rebuild the shape of the company's own facts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { commonTotals, comparisonLeaders, comparisonScores, overallComparison } from "../lib/research/comparison-scorecard.ts";

const NOW = Date.parse("2026-11-26T16:30:00Z");
const real = JSON.parse(readFileSync(new URL("./fixtures/comparison-review-904.json", import.meta.url), "utf8"));
const co = t => ({ ...real[t], ticker: t });

test("C1: a pre-revenue company never leads, or ties with, NVDA on runway against free cash flow (ALDX, TIPT, SPRO)", () => {
  for (const t of ["ALDX", "TIPT", "SPRO"]) {
    const pair = [co("NVDA"), co(t)];
    const common = commonTotals(pair, NOW);
    // Only factors measured the same way for both count: growth, profitability, cash and stability are not.
    for (const id of ["growth", "cash", "stability", "profitability"]) assert.ok(!common.ids.includes(id), `${t} ${id}`);
    for (const lang of ["ja", "en"]) {
      const o = overallComparison(pair, lang, NOW);
      assert.equal(o.leader === t, false, `${t} must not lead`);
      assert.doesNotMatch(o.title, /拮抗|Too close/);
      assert.doesNotMatch(o.description, /資金を生む力/);
    }
    assert.deepEqual(comparisonLeaders(pair, "cash", NOW), [false, false]);
  }
});

test("C1: scores carry their yardstick; runway is never called cash generation", () => {
  const spro = comparisonScores(co("SPRO"), NOW);
  assert.ok(spro.filter(s => s.value !== null && s.id !== "financial" && s.id !== "momentum" && s.id !== "valuation").every(s => s.kind === "preRevenue"));
  assert.ok(comparisonScores(co("NVDA"), NOW).every(s => s.kind === undefined));
  const pre = overallComparison([co("SPRO"), co("TIPT")], "ja", NOW);
  assert.doesNotMatch(pre.description, /資金を生む力/);
});

test("C1: a bank on ROE and equity ratio is not ranked against a company on free cash flow and current ratio on those factors (HSBC vs NVDA)", () => {
  const pair = [co("NVDA"), co("HSBC")];
  const common = commonTotals(pair, NOW);
  assert.ok(!common.ids.includes("cash") && !common.ids.includes("financial"));
  const o = overallComparison(pair, "ja", NOW);
  assert.notEqual(o.leader, "HSBC");
});

// ---------- extraction: the shape of each company's own facts ----------
import { extractFinancials } from "../lib/research/comparison.ts";
import { companyRevenueTagged, loadSecComparison } from "../lib/research/comparison-loader.ts";
import { inlineFinancialFacts } from "../lib/research/comparison-filings.ts";
import { carryWithholding, fillFromProvider } from "../lib/research/comparison-fill.ts";
import { comparisonMetric } from "../lib/research/comparison-scorecard.ts";
import { prepareComparisonAnalysis } from "../lib/research/comparison-analysis.ts";
import { comparisonExclusion, tickersByCik } from "../lib/research/comparison-exclusions.ts";
import { ALTERNATIVE_LABELS } from "../lib/research/comparison-labels.ts";
import { sectorMetrics } from "../lib/research/comparison-alternatives.ts";

const T = Date.parse("2026-11-26T03:00:00Z");
const FY = "0000000001-26-000000", Q3 = "0000000001-26-000003", FY24 = "0000000001-25-000000";
const row = (start, end, val, accn, filed, form = "10-Q") => ({ start, end, val, accn, filed, form });
const at = (end, val, accn, filed, form = "10-Q") => ({ end, val, accn, filed, form });
const usd = list => ({ units: { USD: list } });
const gaap = facts => ({ cik: 1, facts: { "us-gaap": facts } });
const year = (val, accn = FY, end = "2025-12-31", start = "2025-01-01") => row(start, end, val, accn, "2026-02-20", "10-K");
const q3 = (val, prior) => [row("2026-07-01", "2026-09-30", val, Q3, "2026-11-05"), ...(prior === undefined ? [] : [row("2025-07-01", "2025-09-30", prior, Q3, "2026-11-05")])];

test("C2: cost of goods sold or gross profit above zero is proof of revenue: never pre-revenue (AQMS, AUC)", () => {
  const cash = { CashAndCashEquivalentsAtCarryingValue: usd([at("2026-09-30", 5e6, Q3, "2026-11-05")]) };
  const aqms = extractFinancials("AQMS", "1", gaap({ ...cash,
    RevenueFromContractWithCustomerExcludingAssessedTax: usd([year(4e6), ...q3(0, 0)]), CostOfGoodsAndServicesSold: usd(q3(2_407_000, 1_000_000)) }), T);
  assert.notEqual(aqms.preRevenue, true);
  const auc = extractFinancials("AUC", "1", gaap({ ...cash, CostOfRevenue: usd(q3(2_630_000)), GrossProfit: usd(q3(1_200_000)) }), T);
  assert.notEqual(auc.preRevenue, true);
});

test("C2: revenue filed only by segment, or as contract revenue, in the newest report is revenue (MTH, RERE)", () => {
  const ctx = (id, seg) => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">1</xbrli:identifier>${seg ? '<xbrli:segment><xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">us-gaap:ProductMember</xbrldi:explicitMember></xbrli:segment>' : ""}</xbrli:entity><xbrli:period><xbrli:startDate>2026-07-01</xbrli:startDate><xbrli:endDate>2026-09-30</xbrli:endDate></xbrli:period></xbrli:context>`;
  const mth = `${ctx("c1", true)}<ix:nonFraction name="us-gaap:Revenues" contextRef="c1" unitRef="usd" scale="3">1,580,000</ix:nonFraction>`;
  assert.equal(companyRevenueTagged(mth, "2026-09-30"), true);
  const rere = `${ctx("c2", false)}<ix:nonFraction name="us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax" contextRef="c2" unitRef="usd">2771293</ix:nonFraction>`;
  assert.equal(companyRevenueTagged(rere, "2026-09-30"), true);
  const auc = `${ctx("c3", false)}<ix:nonFraction name="us-gaap:CostOfRevenue" contextRef="c3" unitRef="usd">2630000</ix:nonFraction>`;
  assert.equal(companyRevenueTagged(auc, "2026-09-30"), true);
});

test("C2: a newest report that cannot be read leaves the company unreadable, never 'no revenue yet' (RERE's 26 MB 20-F)", async () => {
  const facts = { cik: 1838957, facts: { "us-gaap": { CashAndCashEquivalentsAtCarryingValue: usd([at("2025-12-31", 2e9, "0001193125-26-146260", "2026-04-08", "20-F")]),
    SellingAndMarketingExpense: usd([row("2025-01-01", "2025-12-31", 236_476_000, "0001193125-26-146260", "2026-04-08", "20-F")]) } } };
  const subs = { cik: 1838957, sic: "5900", filings: { recent: { accessionNumber: ["0001193125-26-146260"], form: ["20-F"], filingDate: ["2026-04-08"], reportDate: ["2025-12-31"],
    primaryDocument: ["rere-20251231.htm"], isInlineXBRL: [1], items: [""] } } };
  const c = await loadSecComparison("RERE", "1838957", async url => {
    if (url.includes("/companyfacts/")) return JSON.stringify(facts);
    if (url.includes("/submissions/")) return JSON.stringify(subs);
    throw new Error("sec-too-large");
  }, T);
  assert.notEqual(c.preRevenue, true);
  assert.equal(c.status, "unsupported");
  assert.equal(c.gapReason?.kind, "unreadable");
});

test("H1: net interest income is not the revenue of a company whose expenses exceed it; a lender is scored on pre-tax income (NNI, BKKT)", () => {
  const nni = extractFinancials("NNI", "1", gaap({
    InterestIncomeExpenseNet: usd([year(354_509_000), ...q3(101_395_000, 95_000_000)]),
    NoninterestExpense: usd([year(1_100_000_000), ...q3(315_318_000, 300_000_000)]),
    IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: usd([year(300_000_000), ...q3(81_000_000, 70_000_000)]),
  }), T, undefined, undefined, undefined, "6111");
  assert.equal(nni.quarterRevenue, null);   // no -211% "margin" on a partial line
  const lender = extractFinancials("CIM", "1", gaap({
    InterestIncomeExpenseNet: usd([year(266_419_000), ...q3(71_183_000, 65_000_000)]),
    OperatingExpenses: usd([year(150_000_000), ...q3(40_000_000, 38_000_000)]),
    IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: usd([year(-100_000_000), ...q3(-172_535_000, 20_000_000)]),
  }), T, undefined, undefined, undefined, "6798");
  assert.equal(lender.quarterOperatingIncome.tag, "TechPhasePretaxIncome");
  assert.equal(lender.quarterOperatingIncome.value, -172_535_000);
});

test("H1: an operating figure whose sign disagrees with the pre-tax income is withheld (a lender like NNI)", () => {
  const c = extractFinancials("NNI", "1", gaap({
    InterestIncomeExpenseNet: usd([year(354_509_000), ...q3(101_395_000, 95_000_000)]),
    OperatingIncomeLoss: usd([year(-50_000_000), ...q3(-20_000_000, 5_000_000)]),
    IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: usd([year(300_000_000), ...q3(81_000_000, 70_000_000)]),
  }), T, undefined, undefined, undefined, "6111");
  assert.equal(c.quarterOperatingMargin, null);
  assert.equal(c.marginSign, true);
  assert.equal(comparisonMetric(c, "profitability", "ja", T), ALTERNATIVE_LABELS.marginSign.ja);
});

const ifrs = facts => ({ cik: 1, facts: { "ifrs-full": facts } });
const H1 = "0001089113-26-000025";
const half = (val, prior) => [row("2026-01-01", "2026-06-30", val, H1, "2026-07-29", "6-K"), row("2025-01-01", "2025-06-30", prior, H1, "2026-07-29", "6-K")];
test("H2: an IFRS bank's total operating income is its revenue when larger than interest plus fees (HSBC: 37.742bn, +10.6%, 47.6%)", () => {
  const c = extractFinancials("HSBC", "1", ifrs({
    RevenueAndOperatingIncome: usd([year(68_274_000_000, FY, "2025-12-31"), ...half(37_742_000_000, 34_122_000_000)].map(f => f.form === "10-K" ? { ...f, form: "20-F" } : f)),
    InterestRevenueExpense: usd(half(17_000_000_000, 16_000_000_000)), FeeAndCommissionIncomeExpense: usd(half(8_510_000_000, 7_464_000_000)),
    ProfitLossFromOperatingActivities: usd([...half(17_963_000_000, 15_159_000_000)]),
  }), T, undefined, undefined, undefined, "6029");
  assert.equal(c.quarterRevenue.value, 37_742_000_000);
  assert.ok(Math.abs(c.quarterRevenueGrowth - 10.61) < 0.05);
  assert.ok(Math.abs(c.quarterOperatingMargin - 47.59) < 0.05);
  assert.notEqual(c.marginPartial, true);
});

test("H2: no growth on a line that is only part of a bank's revenue (BBVA's $127m line below its operating income)", () => {
  const c = extractFinancials("BBVA", "1", ifrs({
    RevenueAndOperatingIncome: usd([row("2025-01-01", "2025-12-31", 300e6, FY, "2026-02-25", "20-F"), ...half(127_000_000, 173_000_000)]),
    ProfitLossFromOperatingActivities: usd([row("2025-01-01", "2025-12-31", 18e9, FY, "2026-02-25", "20-F"), ...half(9_567_000_000, 9_000_000_000)]),
  }), T, undefined, undefined, undefined, "6029");
  assert.equal(c.quarterRevenueGrowth, null);
  assert.equal(c.growthWithheld, true);
  assert.equal(comparisonMetric(c, "growth", "ja", T), ALTERNATIVE_LABELS.growthWithheld.ja);
});

test("H3: the provider's statements never bring back what the filing withholds for a bank (HSBC through the provider path)", () => {
  const sec = { ticker: "HSBC", status: "ready", financeSic: true, fcfWithheld: "finance", marginPartial: true, sectorMetrics: { capitalRatio: 5.7, roe: { pct: 11.7, basis: "quarters" }, niiMargin: null } };
  const provider = { ...co("NVDA"), ticker: "HSBC", quarterFcfMargin: 317, quarterOperatingMargin: 70, quarterMargins: [] };
  const out = carryWithholding(provider, sec);
  assert.equal(out.quarterFcfMargin, null);
  assert.equal(out.quarterOperatingMargin, null);
  assert.equal(out.fcfWithheld, "finance");
  assert.deepEqual(out.twelveData?.margins ?? [], []);
  // The fill path: no FCF for a finance company, no growth where the filing withholds it.
  const filed = { ...co("NVDA"), financeSic: true, quarterFcfMargin: null, growthWithheld: true, quarterRevenueGrowth: null };
  const filled = fillFromProvider(filed, { ...co("NVDA"), status: "ready", quarterFcfMargin: 40, quarterRevenueGrowth: 12 }, T);
  assert.equal(filled.quarterFcfMargin, null);
  assert.equal(filled.quarterRevenueGrowth, null);
});

const balanceFacts = (lines, liabilities) => ({
  RevenueFromContractWithCustomerExcludingAssessedTax: usd([year(4e9), ...q3(1e9, 9e8)]), OperatingIncomeLoss: usd([year(1e9), ...q3(2e8)]),
  CashAndCashEquivalentsAtCarryingValue: usd([at("2026-09-30", 9.7e9, Q3, "2026-11-05")]),
  Liabilities: usd([at("2026-09-30", liabilities, Q3, "2026-11-05")]),
  ...Object.fromEntries(Object.entries(lines).map(([tag, v]) => [tag, usd([at("2026-09-30", v, Q3, "2026-11-05")])])),
});
test("H4: the same borrowing under two lines counts once; senior and subordinated notes are added; debt above liabilities is unknown (RJF, COLB, HNVR, ATLC)", () => {
  const debt = (t, lines, liabilities) => extractFinancials(t, "1", gaap(balanceFacts(lines, liabilities)), T).balance?.debtTotal ?? null;
  assert.equal(debt("RJF", { OtherBorrowings: 760e6, AdvancesFromFederalHomeLoanBanks: 760e6, SeniorNotes: 3522e6 }, 81226e6).value, 760e6 + 3522e6);
  assert.equal(debt("COLB", { OtherBorrowings: 3300e6, AdvancesFromFederalHomeLoanBanks: 3300e6, SubordinatedDebt: 696e6 }, 58056e6).value, 3300e6 + 696e6);
  assert.equal(debt("HNVR", { AdvancesFromFederalHomeLoanBanks: 59.84e6, ShortTermBorrowings: 59.84e6, SubordinatedDebt: 34.266e6 }, 2238.902e6).value, 59.84e6 + 34.266e6);
  assert.equal(debt("ATLC", { NotesPayable: 5752.3e6, LineOfCredit: 5747.172e6, SeniorNotes: 699.231e6 }, 6937.415e6), null);
});

test("M1: capital spending is set against revenue of its own period, and the company's own capex line is read (UFPT: 20.1%)", () => {
  const html = `<xbrli:context id="c"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2026-01-01</xbrli:startDate><xbrli:endDate>2026-09-30</xbrli:endDate></xbrli:period></xbrli:context><xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit><ix:nonFraction name="ufpt:PaymentsToAcquirePropertyAndEquipmentNet" contextRef="c" unitRef="usd" scale="3" format="ixt:num-dot-decimal">9,100</ix:nonFraction>`;
  const read = inlineFinancialFacts(html, "1", { accession: Q3, form: "10-Q", filed: "2026-11-06", end: "2026-09-30", url: "https://www.sec.gov/x", inline: true, earnings: false });
  assert.equal(read.facts["us-gaap"].TechPhaseExtensionCapex.units.USD[0].val, 9_100_000);
  // The last tagged capex (a half-year, $2.3m) against the half-year's revenue ($330m) is 0.7%... against a full year it looked like 0.3%.
  const facts = { RevenueFromContractWithCustomerExcludingAssessedTax: usd([year(620e6), row("2024-01-01", "2024-06-30", 300e6, FY24, "2024-08-05"), ...q3(172_434_000, 154_000_000)]),
    PaymentsToAcquirePropertyPlantAndEquipment: usd([row("2024-01-01", "2024-06-30", 6.5e6, FY24, "2024-08-05")]),
    NetCashProvidedByUsedInInvestingActivities: usd([year(-30e6)]), NetCashProvidedByUsedInOperatingActivities: usd([year(130e6)]) };
  const c = extractFinancials("UFPT", "1", gaap(facts), T);
  assert.notEqual(c.capexNotReported, true);   // 6.5m of 300m is 2.2% of its own half-year: material, not "not reported"
});

test("M2: a bank's or insurer's pre-tax margin is called pre-tax in the bullets, never an operating margin (TRV, FHN)", () => {
  const c = extractFinancials("TRV", "1", gaap({ Revenues: usd([year(46e9), ...q3(12.5e9, 11.8e9)]),
    IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: usd([year(6e9), ...q3(2.4e9, 1.9e9)]) }), T, undefined, undefined, undefined, "6331");
  assert.equal(c.quarterOperatingIncome.tag, "TechPhasePretaxIncome");
  const items = prepareComparisonAnalysis(c, T).items.filter(i => i.id === "operating-margin");
  assert.ok(items.length && items.every(i => /税引前/.test(i.short.ja) && /Pre-tax/.test(i.short.en)), JSON.stringify(items));
});

test("M3: a large bank's equity ratio is scored on a bank's scale and is never a weakness bullet (HSBC 5.7%)", () => {
  const hsbc = co("HSBC");
  const score = comparisonScores(hsbc, NOW).find(s => s.id === "financial");
  assert.equal(score.kind, "sector");
  assert.ok(score.value > 4 && score.value < 5);   // (5.7 - 2) / 8 x 10 = 4.6, was 2.9
  assert.ok(!(prepareComparisonAnalysis(hsbc, NOW)?.items ?? []).some(i => i.id === "financial"));
});

test("M4: a merged former SPAC is offered; a REIT's operating-partnership units are not (VRXA; ESBA, FISK, OGCP)", () => {
  const lists = JSON.parse(readFileSync(new URL("../lib/research/comparison-exclusions.json", import.meta.url), "utf8"));
  const rows = [{ ticker: "VRXA", cik: 2079109, name: "Veraxa Biotech AG - Post de-SPAC", exchange: "Nasdaq" },
    ...["ESBA", "FISK", "OGCP"].map(t => ({ ticker: t, cik: 1553079, name: "Empire State Realty OP, L.P.", exchange: "NYSE" })),
    { ticker: "ESRT", cik: 1541401, name: "Empire State Realty Trust, Inc.", exchange: "NYSE" }];
  const k = t => comparisonExclusion(rows.find(r => r.ticker === t), tickersByCik(rows), lists);
  assert.equal(k("VRXA"), null);
  for (const t of ["ESBA", "FISK", "OGCP"]) assert.equal(k(t), "unit", t);
  assert.equal(k("ESRT"), null);
  const script = readFileSync(new URL("../scripts/research/comparison-audit/instruments.py", import.meta.url), "utf8");
  assert.match(script, /DE_SPAC = re\.compile/);
  assert.match(script, /OP_UNITS = re\.compile/);
});

test("M5: Treasure Hunt's ranking and the comparison's list are read from two monitor answers; the ranking keeps production's 1.5 MB limit", async () => {
  const server = readFileSync(new URL("../lib/research/value-check-server.ts", import.meta.url), "utf8");
  assert.match(server, /readMonitor\("\/value-check", 1_500_000/);
  assert.match(server, /readMonitor\("\/value-check\/values", 4_000_000/);
  const service = readFileSync(new URL("../scripts/research/service.py", import.meta.url), "utf8");
  assert.match(service, /if path == "\/value-check\/values":/);
});

test("L1: an IFRS bank's ROE uses the owners' profit; a fiscal year's ROE says so", () => {
  const facts = { "ifrs-full": {
    ProfitLoss: { units: { USD: [row("2025-01-01", "2025-12-31", 25e9, FY, "2026-02-25", "20-F")] } },
    ProfitLossAttributableToOwnersOfParent: { units: { USD: [row("2025-01-01", "2025-12-31", 22e9, FY, "2026-02-25", "20-F")] } },
    EquityAttributableToOwnersOfParent: { units: { USD: [at("2025-12-31", 200e9, FY, "2026-02-25", "20-F")] } },
  } };
  const m = sectorMetrics(facts, "USD", "2026-06-30", 200e9, 3000e9);
  assert.equal(m.roe.basis, "year");
  assert.ok(Math.abs(m.roe.pct - 11) < 1e-9);   // 22bn / 200bn, not 25bn
  assert.equal(ALTERNATIVE_LABELS.roe(11, "year").ja, "ROE（年次） +11.0%");
});

test("L2: the R&D share says what it is a share of", () => {
  assert.equal(ALTERNATIVE_LABELS.noMargin(55, "operating-expenses").ja, "売上なし（研究開発費は費用の55%）");
  assert.equal(ALTERNATIVE_LABELS.noMargin(60, "rd-and-ga").ja, "売上なし（研究費は研究・管理費の60%）");
  assert.match(ALTERNATIVE_LABELS.noMargin(60, "rd-and-ga").en, /R&D\+G&A/);
});

test("L4: interest inside a REIT's costs is added back (O); a small 'operating expenses' item is not the total (CC); no current ratio without a score (NVS)", () => {
  const o = extractFinancials("O", "1", gaap({ Revenues: usd([year(6e9), ...q3(1_621_582_000, 1_470_000_000)]), CostsAndExpenses: usd([year(4.8e9), ...q3(1_286_378_000)]),
    InterestExpenseOperating: usd([year(1.2e9), ...q3(333_564_000)]) }), T, undefined, undefined, undefined, "6798");
  assert.equal(o.quarterOperatingIncome.value, 1_621_582_000 - 1_286_378_000 + 333_564_000);
  const cc = extractFinancials("CC", "1", gaap({ RevenueFromContractWithCustomerExcludingAssessedTax: usd([year(6e9), ...q3(1.54e9, 1.5e9)]), CostOfGoodsAndServicesSold: usd([year(4.8e9), ...q3(1.25e9)]),
    OperatingExpenses: usd([year(8e6), ...q3(2e6)]), SellingGeneralAndAdministrativeExpense: usd([year(800e6), ...q3(190e6)]),
    IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: usd([year(300e6), ...q3(222e6)]) }), T);
  assert.notEqual(cc.quarterOperatingIncome.value, 1.54e9 - 1.25e9 - 2e6);
  const nvs = { ...co("NVDA"), balance: { ...co("NVDA").balance, currentRatio: 0.86, debtTotal: null, debtCurrent: null, debtNoncurrent: null, shortBorrowings: null } };
  if (comparisonScores(nvs, NOW).find(s => s.id === "financial").value === null) assert.doesNotMatch(comparisonMetric(nvs, "financial", "ja", NOW), /流動比率/);
});

test("H2: a stated sales line beside a larger operating figure (a crypto treasury's gains) keeps its growth; a bank's fee line does not (MSTR, FVCB)", () => {
  const facts = rev => gaap({ RevenueFromContractWithCustomerExcludingAssessedTax: usd([year(rev * 4), ...q3(rev, rev * 0.9)]),
    OperatingIncomeLoss: usd([year(rev * 40), ...q3(rev * 100, rev)]) });
  const mstr = extractFinancials("MSTR", "1", facts(125_427_000), T, undefined, undefined, undefined, "6199");
  assert.ok(Number.isFinite(mstr.quarterRevenueGrowth));
  assert.equal(mstr.quarterOperatingMargin, null);
  const fvcb = extractFinancials("FVCB", "1", facts(577_000), T, undefined, undefined, undefined, "6022");
  assert.equal(fvcb.quarterRevenueGrowth, null);
  assert.equal(fvcb.growthWithheld, true);
});

test("C2: figures that are not the company's own revenue prove nothing: a related party's, an investee's, a discontinued operation's, a segment's costs (BCTX, LAR, TMCR, PRAX)", () => {
  const ctx = (id, axis, member) => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">1</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="${axis}">${member}</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>`;
  const fact = (name, id, v) => `<ix:nonFraction name="${name}" contextRef="${id}" unitRef="usd">${v}</ix:nonFraction>`;
  assert.equal(companyRevenueTagged(ctx("a", "srt:TitleOfIndividualAxis", "srt:OfficerMember") + fact("us-gaap:CostOfRevenue", "a", "2,521,246"), "2025-12-31"), false);
  assert.equal(companyRevenueTagged(ctx("b", "srt:ScheduleOfEquityMethodInvestmentEquityMethodInvesteeNameAxis", "lar:MineraExarMember") + fact("ifrs-full:Revenue", "b", "271,467"), "2025-12-31"), false);
  assert.equal(companyRevenueTagged(ctx("c", "us-gaap:IncomeStatementBalanceSheetAndAdditionalDisclosuresByDisposalGroupsIncludingDiscontinuedOperationsAxis", "tmcr:OilAndGasBusinessDiscontinuedOperationsMember") + fact("ifrs-full:RevenueFromRoyalties", "c", "1,118,283"), "2025-12-31"), false);
  assert.equal(companyRevenueTagged(ctx("d", "us-gaap:StatementBusinessSegmentsAxis", "prax:ReportableSegmentMember") + fact("us-gaap:CostOfGoodsAndServicesSold", "d", "14,337"), "2025-12-31"), false);
  // The company's own revenue by segment is proof (NRP's royalty segment).
  assert.equal(companyRevenueTagged(ctx("e", "us-gaap:StatementBusinessSegmentsAxis", "nrp:RoyaltyAndOtherMineralRightsMember") + fact("us-gaap:Revenues", "e", "46,989"), "2025-12-31"), true);
});

test("H1: a lender's total costs, which include its interest expense, never disqualify its net interest income (a mortgage REIT)", () => {
  const c = extractFinancials("REIT", "1", gaap({
    InterestIncomeExpenseNet: usd([year(300e6), ...q3(80e6, 75e6)]),
    CostsAndExpenses: usd([year(900e6), ...q3(240e6, 230e6)]),   // interest expense included
    NoninterestExpense: usd([year(100e6), ...q3(25e6, 24e6)]),
    IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: usd([year(200e6), ...q3(55e6, 50e6)]),
  }), T, undefined, undefined, undefined, "6798");
  assert.equal(c.quarterRevenue.value, 80e6);
  assert.equal(c.quarterOperatingIncome.tag, "TechPhasePretaxIncome");
});
