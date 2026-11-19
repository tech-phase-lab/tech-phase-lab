// Stock Comparison for every ticker (owner, Nov 18: MO vs BTI showed "必要なデータが揃っていません" and almost no BTI points).
// Small synthetic filings for each cause found by the audit (scripts/research/comparison-audit): a half-year IFRS filer whose 6-K is a cover
// page, an annual-only 20-F filer, a convenience translation, a company with no annual report yet, a bank, a utility, IFRS total revenue,
// and the "N社に共通する項目" sentence for two companies.
import test from "node:test";
import assert from "node:assert/strict";
import { extractFinancials, buildComparison } from "../lib/research/comparison.ts";
import { loadSecComparison } from "../lib/research/comparison-loader.ts";
import { inlineFinancialFacts } from "../lib/research/comparison-filings.ts";
import { comparisonScores, hasRecentQuarter, comparableQuarters, overallComparison } from "../lib/research/comparison-scorecard.ts";
import { buildSecMarketEvidence } from "../lib/research/sec-market-evidence.ts";
import { prepareComparisonAnalysis } from "../lib/research/comparison-analysis.ts";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const fact = (val, end, accn, form, filed, start) => ({ val, end, accn, form, filed, ...(start ? { start } : {}) });

// ---------- a half-year IFRS filer (BTI) ----------
const BTI_CIK = "1303523", ANNUAL = "0001303523-26-000017", HALF = "0001303523-26-000025";
const btiFacts = () => ({ cik: Number(BTI_CIK), facts: { "ifrs-full": {
  Revenue: { units: { GBP: [fact(25610e6, "2025-12-31", ANNUAL, "20-F", "2026-02-13", "2025-01-01"), fact(25867e6, "2024-12-31", ANNUAL, "20-F", "2026-02-13", "2024-01-01")] } },
  ProfitLossFromOperatingActivities: { units: { GBP: [fact(9997e6, "2025-12-31", ANNUAL, "20-F", "2026-02-13", "2025-01-01")] } },
  CashAndCashEquivalents: { units: { GBP: [fact(3827e6, "2025-12-31", ANNUAL, "20-F", "2026-02-13")] } },
} } });
const folder = "https://www.sec.gov/Archives/edgar/data/1303523/000130352326000025/";
const submissions = { cik: Number(BTI_CIK), filings: { recent: {
  accessionNumber: [HALF, ANNUAL], form: ["6-K", "20-F"], filingDate: ["2026-07-30", "2026-02-13"], reportDate: ["2026-06-30", "2025-12-31"],
  primaryDocument: ["bti-20260630_d2.htm", "bti-20251231.htm"], isInlineXBRL: [1, 1], items: ["", ""],
} } };
const context = (id, start, end) => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0001303523</xbrli:identifier></xbrli:entity><xbrli:period>${start ? `<xbrli:startDate>${start}</xbrli:startDate><xbrli:endDate>${end}</xbrli:endDate>` : `<xbrli:instant>${end}</xbrli:instant>`}</xbrli:period></xbrli:context>`;
const ix = (name, ctx, value) => `<ix:nonFraction name="ifrs-full:${name}" contextRef="${ctx}" unitRef="GBP" decimals="-6" scale="6" format="ixt:num-dot-decimal">${value}</ix:nonFraction>`;
const statements = `<html><body><ix:header><ix:resources>${context("h1", "2026-01-01", "2026-06-30")}${context("h0", "2025-01-01", "2025-06-30")}${context("b1", null, "2026-06-30")}
  <xbrli:unit id="GBP"><xbrli:measure>iso4217:GBP</xbrli:measure></xbrli:unit></ix:resources></ix:header>
  <table><tr><td>Revenue</td><td>${ix("Revenue", "h1", "12,235")}</td><td>${ix("Revenue", "h0", "12,069")}</td></tr>
  <tr><td>Profit from operations</td><td>${ix("ProfitLossFromOperatingActivities", "h1", "4,266")}</td><td>${ix("ProfitLossFromOperatingActivities", "h0", "5,069")}</td></tr></table>
  <table><tr><td>Net cash from operating activities</td><td>${ix("CashFlowsFromUsedInOperatingActivities", "h1", "3,400")}</td></tr>
  <tr><td>Purchases of property, plant and equipment</td><td>${ix("PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities", "h1", "132")}</td></tr></table>
  <table><tr><td>Cash</td><td>${ix("CashAndCashEquivalents", "b1", "2,518")}</td></tr><tr><td>Current assets</td><td>${ix("CurrentAssets", "b1", "13,000")}</td></tr>
  <tr><td>Current liabilities</td><td>${ix("CurrentLiabilities", "b1", "15,568")}</td></tr><tr><td>Borrowings (non-current)</td><td>${ix("LongtermBorrowings", "b1", "31,500")}</td></tr>
  <tr><td>Borrowings (current)</td><td>${ix("ShorttermBorrowings", "b1", "3,563")}</td></tr></table></body></html>`;
function upstream(log = []) {
  return async (url) => {
    log.push(url);
    if (url.includes("/companyfacts/")) return JSON.stringify(btiFacts());
    if (url.includes("/submissions/")) return JSON.stringify(submissions);
    if (url === `${folder}bti-20260630_d2.htm`) return "<html><body>Cover page of the half-year report (no tagged figures)</body></html>";
    if (url === `${folder}index.json`) return JSON.stringify({ directory: { item: [{ name: "bti-20260630_d2.htm", size: "18303" }, { name: "R2.htm", size: "90000" }, { name: "bti-20260630.htm", size: "4699549" }, { name: "bti-20260630_g1.jpg", size: "12524" }] } });
    if (url === `${folder}bti-20260630.htm`) return statements;
    throw new Error(`unexpected ${url}`);
  };
}

test("BTI: a half-year 6-K whose primary document is a cover page is read from its statements document and compared as a half-year", async () => {
  const log = [];
  const c = await loadSecComparison("BTI", BTI_CIK, upstream(log), NOW);
  assert.ok(log.includes(`${folder}bti-20260630.htm`), "the statements document is read");
  assert.equal(c.status, "ready"); assert.equal(c.periodMonths, 6);
  assert.equal(c.quarterRevenue.start, "2026-01-01"); assert.equal(c.quarterRevenue.end, "2026-06-30"); assert.equal(c.quarterRevenue.unit, "GBP");
  assert.ok(Math.abs(c.quarterRevenueGrowth - (12235 / 12069 - 1) * 100) < 1e-9);
  assert.ok(Math.abs(c.quarterOperatingMargin - 4266 / 12235 * 100) < 1e-9);
  assert.ok(Math.abs(c.quarterFcfMargin - (3400 - 132) / 12235 * 100) < 1e-9);
  // IFRS borrowings: non-current plus current from the same half-year balance sheet.
  assert.equal(c.balance.end, "2026-06-30"); assert.deepEqual(c.balance.debtTotal, { value: 35063e6, source: "split" });
  assert.deepEqual(c.dataWarnings, []);
  assert.ok(hasRecentQuarter(c, NOW));
  const scores = Object.fromEntries(comparisonScores(c, NOW).map(s => [s.id, s.value]));
  for (const id of ["growth", "profitability", "cash", "financial"]) assert.notEqual(scores[id], null, id);
  assert.equal(scores.stability, null); // four quarters of margins cannot come from half-years
  // The text names the period as a half-year, not a quarter.
  const analysis = prepareComparisonAnalysis(c, NOW);
  assert.ok(analysis.items.every(i => !i.detail.ja.includes("四半期の")));
  // A half-year stays current for 270 days, then needs the next report.
  assert.equal(hasRecentQuarter(c, Date.parse("2027-03-20T00:00:00Z")), true);
  assert.equal(hasRecentQuarter(c, Date.parse("2027-04-01T00:00:00Z")), false);
});

test("MO vs BTI: an overall verdict on the factors both have; a half-year beside a quarter is said to be a different period", async () => {
  const bti = { ...(await loadSecComparison("BTI", BTI_CIK, upstream(), NOW)), ticker: "BTI", name: "BAT", peer: "BTI", caution: { ja: "", en: "" } };
  const q = (val, start, end, accn = "0000764180-26-000114") => ({ val, start, end, accn, form: "10-Q", filed: "2026-10-29" });
  const moFacts = { cik: 764180, facts: { "us-gaap": {
    RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [fact(23279e6, "2025-12-31", "0000764180-26-000017", "10-K", "2026-02-25", "2025-01-01"), q(6132e6, "2026-07-01", "2026-09-30"), q(6069e6, "2025-07-01", "2025-09-30")] } },
    OperatingIncomeLoss: { units: { USD: [q(3313e6, "2026-07-01", "2026-09-30")] } },
    NetCashProvidedByUsedInOperatingActivities: { units: { USD: [q(3050e6, "2026-07-01", "2026-09-30")] } },
    PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: [q(51e6, "2026-07-01", "2026-09-30")] } },
  } } };
  const mo ={ ...extractFinancials("MO", "764180", moFacts, NOW), ticker: "MO", name: "Altria", peer: "MO", caution: { ja: "", en: "" } };
  assert.equal(mo.periodMonths, undefined); assert.ok(hasRecentQuarter(mo, NOW));
  assert.equal(comparableQuarters([mo, bti], NOW), false); // 3 months against 6 months
  const overall = overallComparison(buildComparison([mo, bti], NOW).companies, "ja", NOW);
  assert.notEqual(overall.title, "必要なデータが揃っていません");
  assert.match(overall.description, /^決算期間が異なる会社を含みます。/);
});

test("the 'not enough common factors' sentence counts the companies actually compared", () => {
  const empty = t => ({ ...extractFinancials(t, "1", { cik: 1, facts: {} }, NOW), ticker: t });
  assert.equal(overallComparison([empty("AAA"), empty("BBB")], "ja", NOW).description, "2社に共通する項目が3つ未満のため、総合順位は出していません。");
  assert.equal(overallComparison([empty("AAA"), empty("BBB"), empty("CCC")], "ja", NOW).description, "3社に共通する項目が3つ未満のため、総合順位は出していません。");
});

test("a 20-F filer with no tagged interim report: its fiscal year is the latest period, current for 500 days", () => {
  const A = "0000937966-26-000010";
  const facts = { cik: 937966, facts: { "us-gaap": {
    Revenues: { units: { EUR: [fact(32.7e9, "2025-12-31", A, "20-F", "2026-02-11", "2025-01-01"), fact(28.3e9, "2024-12-31", A, "20-F", "2026-02-11", "2024-01-01")] } },
    OperatingIncomeLoss: { units: { EUR: [fact(10.6e9, "2025-12-31", A, "20-F", "2026-02-11", "2025-01-01")] } },
  } } };
  const c = extractFinancials("ASML", "937966", facts, NOW);
  assert.equal(c.periodMonths, 12); assert.equal(c.quarterRevenue.end, "2025-12-31");
  assert.ok(Math.abs(c.quarterRevenueGrowth - (32.7 / 28.3 - 1) * 100) < 1e-9);
  assert.ok(hasRecentQuarter(c, NOW)); assert.equal(hasRecentQuarter(c, Date.parse("2027-05-20T00:00:00Z")), false);
  // A US 10-K filer without a quarter is not given this fallback.
  const us = structuredClone(facts); for (const tag of Object.values(us.facts["us-gaap"])) for (const f of tag.units.EUR) f.form = "10-K";
  assert.equal(extractFinancials("XYZ", "937966", us, NOW).quarterRevenue, null);
});

test("no annual report yet (a new listing, or XOM's new holding company): the latest quarter stands alone, annual columns stay empty", () => {
  const Q = "0002115436-26-000020", q = (val, start, end) => ({ val, start, end, accn: Q, form: "10-Q", filed: "2026-11-02" });
  const facts = { cik: 2115436, facts: { "us-gaap": {
    Revenues: { units: { USD: [q(113164e6, "2026-07-01", "2026-09-30"), q(90000e6, "2025-07-01", "2025-09-30")] } },
    OperatingIncomeLoss: { units: { USD: [q(12000e6, "2026-07-01", "2026-09-30")] } },
  } } };
  const c = extractFinancials("XOM", "2115436", facts, NOW);
  assert.equal(c.status, "ready"); assert.equal(c.revenue, null); assert.equal(c.revenueGrowth, null);
  assert.equal(c.quarterRevenue.value, 113164e6); assert.ok(Math.abs(c.quarterRevenueGrowth - (113164 / 90000 - 1) * 100) < 1e-9);
  assert.ok(hasRecentQuarter(c, NOW));
});

test("a bank's revenue is net interest income plus noninterest income of the same period; a stated revenue line still wins", () => {
  const A = "0000092230-26-000005", a = (val, start, end) => fact(val, end, A, "10-K", "2026-02-20", start);
  const facts = { cik: 92230, facts: { "us-gaap": {
    InterestIncomeExpenseNet: { units: { USD: [a(14423e6, "2025-01-01", "2025-12-31"), a(14091e6, "2024-01-01", "2024-12-31")] } },
    NoninterestIncome: { units: { USD: [a(5896e6, "2025-01-01", "2025-12-31"), a(-813e6, "2024-01-01", "2024-12-31")] } },
  } } };
  const c = extractFinancials("TFC", "92230", facts, NOW);
  assert.equal(c.revenue.value, 20319e6); assert.equal(c.previousRevenue.value, 13278e6);
  const stated = structuredClone(facts); stated.facts["us-gaap"].Revenues = { units: { USD: [a(20500e6, "2025-01-01", "2025-12-31")] } };
  assert.equal(extractFinancials("TFC", "92230", stated, NOW).revenue.value, 20500e6);
});

test("a utility's total is its regulated and unregulated operating revenue; IFRS Revenue is the total above contract revenue", () => {
  const A = "0000072903-26-000009", a = (val, start = "2025-01-01", end = "2025-12-31") => fact(val, end, A, "10-K", "2026-02-25", start);
  const xel = { cik: 72903, facts: { "us-gaap": {
    RegulatedAndUnregulatedOperatingRevenue: { units: { USD: [a(14.2e9)] } },
    RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [a(13.9e9)] } },
  } } };
  assert.equal(extractFinancials("XEL", "72903", xel, NOW).revenue.value, 14.2e9);
  const B = "0001193125-26-354647", b = val => fact(val, "2026-06-30", B, "20-F", "2026-08-18", "2025-07-01");
  const bhp = { cik: 811809, facts: { "ifrs-full": { Revenue: { units: { USD: [b(58760e6)] } }, RevenueFromContractsWithCustomers: { units: { USD: [b(57495e6)] } } } } };
  const r = extractFinancials("BHP", "811809", bhp, NOW);
  assert.equal(r.revenue.value, 58760e6); assert.equal(r.periodMonths, 12);
});

test("an income statement titled 'earnings' (Devon) still names the total revenue line", () => {
  const filing = { accession: "0001193125-26-451216", form: "10-Q", filed: "2026-11-06", end: "2026-09-30", url: "https://example.invalid/dvn.htm", inline: true };
  const ctx = `<xbrli:context id="q"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0001090012</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2026-07-01</xbrli:startDate><xbrli:endDate>2026-09-30</xbrli:endDate></xbrli:period></xbrli:context><xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>`;
  const v = (name, value) => `<ix:nonFraction name="us-gaap:${name}" contextRef="q" unitRef="usd" scale="6" format="ixt:num-dot-decimal">${value}</ix:nonFraction>`;
  const html = `<html><body>${ctx}<table><tr><td>Oil, gas and NGL sales</td><td>${v("RevenueFromContractWithCustomerExcludingAssessedTax", "7,774")}</td></tr><tr><td>Total revenues</td><td>${v("Revenues", "6,860")}</td></tr><tr><td>Net earnings</td><td>1</td></tr><tr><td>Basic</td><td>Diluted</td></tr></table></body></html>`;
  assert.equal(inlineFinancialFacts(html, "1090012", filing).primaryRevenueTag, "us-gaap:Revenues");
});

test("a convenience translation does not hold the figures: the filing's own currency is used", () => {
  const A = "0001094517-26-000011", a = val => fact(val, "2026-03-31", A, "20-F", "2026-06-20", "2025-04-01");
  const facts = { cik: 1094517, facts: { "ifrs-full": {
    Revenue: { units: { JPY: [a(48e12), fact(45e12, "2025-03-31", A, "20-F", "2026-06-20", "2024-04-01")], USD: [a(320e9)] } },
    ProfitLossFromOperatingActivities: { units: { JPY: [a(4.8e12)] } },
    CashAndCashEquivalents: { units: { JPY: [fact(9e12, "2026-03-31", A, "20-F", "2026-06-20")] } },
  } } };
  const c = extractFinancials("TM", "1094517", facts, NOW);
  assert.equal(c.revenue.unit, "JPY"); assert.equal(c.revenue.value, 48e12);
});

test("an amendment that adds only Part III (MO's 10-K/A) is not read as the annual report and raises no warning", async () => {
  const K = "0000764180-26-000017", KA = "0000764180-26-000077";
  const facts = { cik: 764180, facts: { "us-gaap": { RevenueFromContractWithCustomerExcludingAssessedTax: { units: { USD: [fact(23279e6, "2025-12-31", K, "10-K", "2026-02-25", "2025-01-01")] } } } } };
  const subs = { cik: 764180, filings: { recent: { accessionNumber: [KA, K], form: ["10-K/A", "10-K"], filingDate: ["2026-05-27", "2026-02-25"], reportDate: ["2025-12-31", "2025-12-31"],
    primaryDocument: ["mo-20251231.htm", "mo-20251231.htm"], isInlineXBRL: [1, 1], items: ["", ""] } } };
  const read = [];
  const c = await loadSecComparison("MO", "764180", async url => { read.push(url); if (url.includes("/companyfacts/")) return JSON.stringify(facts); if (url.includes("/submissions/")) return JSON.stringify(subs); throw new Error(url); }, NOW);
  assert.equal(read.length, 2); assert.equal(c.revenue.value, 23279e6);
  assert.ok(!c.dataWarnings.some(w => w.en.includes("annual filing")));
});

test("a company with no current figures still gets price momentum; forward P/E of a listing quoted in another currency is kept", () => {
  const series = { adjust: "splits", retrievedAt: "2026-11-18T11:00:00Z", payload: { meta: { symbol: "XYZ", interval: "1day", currency: "USD" }, status: "ok", values: [{ datetime: "2026-11-17", close: "110" }, { datetime: "2026-08-17", close: "100" }] } };
  const none = { ...extractFinancials("XYZ", "1", { cik: 1, facts: {} }, NOW), ticker: "XYZ" };
  const evidence = buildSecMarketEvidence(none, series, undefined, NOW);
  assert.ok(evidence.momentum); assert.equal(evidence.statistics, null);
  assert.equal(comparisonScores({ ...none, twelveData: evidence }, NOW).find(s => s.id === "momentum").value, 6);
  const statistics = { retrievedAt: "2026-11-18T10:00:00Z", payload: { meta: { symbol: "BTI", currency: "USD" }, statistics: { valuations_metrics: { forward_pe: "10.5", market_capitalization: "130000000000" } } } };
  const bti = { status: "ready", ticker: "BTI", retrievedAt: "2026-11-18T09:00:00Z", periodMonths: 6, quarterRevenue: { value: 12235e6, unit: "GBP", start: "2026-01-01", end: "2026-06-30", filed: "2026-07-30", accession: HALF, tag: "Revenue", basis: "ifrs-full" }, quarterRevenueTtm: 25e9 };
  const e = buildSecMarketEvidence(bti, undefined, statistics, NOW);
  assert.equal(e.statistics.forwardPE, 10.5); assert.equal(e.statistics.priceToSales, null); // a US dollar market value over sterling revenue is not used
  assert.equal(e.periodMonths, 6);
});
