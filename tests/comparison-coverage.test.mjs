// Stock Comparison coverage across the listed universe (Nov 19 audit, scripts/research/comparison-audit):
// - a share class (BRK-B) is asked from the provider as BRK.B (it answered 404 for the dashed form, production log Nov 19);
// - a Canadian bank's quarterly 6-K (fiscal year ending October 31) is read, including a document set whose contexts sit in another document;
// - an IFRS bank's total operating income stands as its revenue when it tags no other revenue line (HSBC);
// - the background job's statements turn among a minute's companies instead of always going to the same one.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { providerSymbol, sameProviderSymbol } from "../lib/research/provider-symbol.ts";
import { extractFinancials } from "../lib/research/comparison.ts";
import { buildSecMarketEvidence } from "../lib/research/sec-market-evidence.ts";
import { loadSecComparison, fiscalQuarterEnd } from "../lib/research/comparison-loader.ts";
import { comparisonScores, hasRecentQuarter } from "../lib/research/comparison-scorecard.ts";
import { statementOrder } from "../lib/research/twelve-warm-plan.ts";
import { comparisonExclusion, comparableEntries, tickersByCik } from "../lib/research/comparison-exclusions.ts";

test("share classes use the provider's dotted symbol; preferreds, warrants, units and rights are left as they are", () => {
  for (const [sec, provider] of [["BRK-B", "BRK.B"], ["BRK-A", "BRK.A"], ["LEN-B", "LEN.B"], ["HEI-A", "HEI.A"], ["PBR-A", "PBR.A"], ["MKC-V", "MKC.V"], ["BF-B", "BF.B"]]) assert.equal(providerSymbol(sec), provider);
  for (const same of ["MO", "GOOG", "CTA-PB", "ETI-P", "AAC-WT", "KCAC-UN", "NMZ-RI", "BRK.B"]) assert.equal(providerSymbol(same), same);
  assert.ok(sameProviderSymbol("BRK.B", "BRK-B")); assert.ok(sameProviderSymbol("BRK-B", "BRK-B"));
  assert.ok(!sameProviderSymbol("BRK.A", "BRK-B")); assert.ok(!sameProviderSymbol(undefined, "MO"));
});

const NOW = Date.parse("2026-11-13T12:00:00Z");
const mu = () => ({ ...extractFinancials("MU", "723125", JSON.parse(readFileSync(new URL("./fixtures/sec-companyfacts-MU.json", import.meta.url), "utf8")), NOW), quarterDilutedShares: 1.13e9 });
const series = (symbol) => ({ adjust: "splits", retrievedAt: "2026-11-13T11:00:00Z", payload: { meta: { symbol, interval: "1day", currency: "USD" }, status: "ok",
  values: [{ datetime: "2026-11-12", close: "120" }, { datetime: "2026-08-12", close: "100" }] } });

test("a share class's price series answered under the provider's symbol gives momentum, but no price-to-sales from the share count", () => {
  const own = buildSecMarketEvidence(mu(), series("MU"), undefined, NOW);
  assert.ok(own.momentum); assert.ok(own.statistics?.priceToSales > 0, "a single-class company keeps price-to-sales from the filing");
  const cls = buildSecMarketEvidence({ ...mu(), ticker: "BRK-B" }, series("BRK.B"), undefined, NOW);
  assert.ok(Math.abs(cls.momentum.changePct - 20) < 1e-9);
  // The diluted count spans every class (one BRK-A is worth 1,500 BRK-B): the close of one class times it is not the market value.
  assert.equal(cls.statistics, null);
  assert.equal(buildSecMarketEvidence({ ...mu(), ticker: "BRK-B" }, series("BRK.A"), undefined, NOW).momentum, null);
});

test("a 6-K at a fiscal quarter end: calendar quarters, and month ends three, six or nine months after the annual year end", () => {
  for (const end of ["2026-03-31", "2026-06-30", "2026-09-30", "2026-12-31"]) assert.ok(fiscalQuarterEnd(end));
  for (const end of ["2026-01-31", "2026-04-30", "2026-07-31"]) assert.ok(fiscalQuarterEnd(end, "2025-10-31"), end);
  assert.ok(!fiscalQuarterEnd("2026-07-31"));                 // no annual report to anchor the fiscal year
  assert.ok(!fiscalQuarterEnd("2026-08-31", "2025-10-31"));    // a monthly 6-K, not a quarter
  assert.ok(!fiscalQuarterEnd("2026-07-30", "2025-10-31"));    // not a month end
  assert.ok(!fiscalQuarterEnd("2025-10-31", "2025-10-31"));
});

// ---------- a Canadian bank (fiscal year ends October 31), quarterly 6-K as an inline XBRL document set ----------
const CIK = "927971", ANNUAL = "0000927971-25-000140", Q1 = "0000927971-26-000020", Q3 = "0000927971-26-000108";
const fact = (val, end, accn, form, filed, start) => ({ val, end, accn, form, filed, ...(start ? { start } : {}) });
// The SEC's companyfacts stops at the first quarter (it had not taken the later 6-Ks in, Nov 19).
const companyfacts = () => ({ cik: Number(CIK), facts: { "ifrs-full": {
  Revenue: { units: { CAD: [fact(35000e6, "2025-10-31", ANNUAL, "40-F", "2025-12-04", "2024-11-01"), fact(9000e6, "2026-01-31", Q1, "6-K", "2026-02-25", "2025-11-01")] } },
  ProfitLossBeforeTax: { units: { CAD: [fact(9500e6, "2025-10-31", ANNUAL, "40-F", "2025-12-04", "2024-11-01"), fact(2500e6, "2026-01-31", Q1, "6-K", "2026-02-25", "2025-11-01")] } },
} } });
const folder = "https://www.sec.gov/Archives/edgar/data/927971/000092797126000108/";
const submissions = { cik: Number(CIK), filings: { recent: {
  accessionNumber: [Q3, "0000927971-26-000099", Q1, ANNUAL], form: ["6-K", "6-K", "6-K", "40-F"], filingDate: ["2026-08-26", "2026-08-10", "2026-02-25", "2025-12-04"],
  reportDate: ["2026-07-31", "2026-08-10", "2026-01-31", "2025-10-31"], primaryDocument: ["bmo-20260731.htm", "d1.htm", "bmo-20260131.htm", "d40f.htm"],
  isInlineXBRL: [1, 0, 1, 1], items: ["", "", "", ""],
} } };
const context = (id, start, end) => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000927971</xbrli:identifier></xbrli:entity><xbrli:period>${start ? `<xbrli:startDate>${start}</xbrli:startDate><xbrli:endDate>${end}</xbrli:endDate>` : `<xbrli:instant>${end}</xbrli:instant>`}</xbrli:period></xbrli:context>`;
// The primary document holds only the header (contexts and units); the statements are in bmo-20260731_d2.htm.
const header = `<html><body><ix:header><ix:resources>${context("c-1", "2026-05-01", "2026-07-31")}${context("c-2", "2025-05-01", "2025-07-31")}
  <xbrli:unit id="cad"><xbrli:measure>iso4217:CAD</xbrli:measure></xbrli:unit></ix:resources></ix:header><p>Cover</p></body></html>`;
const ix = (name, ctx, value) => `<ix:nonFraction name="ifrs-full:${name}" contextRef="${ctx}" unitRef="cad" decimals="-6" scale="6" format="ixt:num-dot-decimal">${value}</ix:nonFraction>`;
const statementsDoc = `<html><body><table><tr><td>Total revenue</td><td>${ix("Revenue", "c-1", "9,700")}</td><td>${ix("Revenue", "c-2", "8,900")}</td></tr>
  <tr><td>Income before taxes</td><td>${ix("ProfitLossBeforeTax", "c-1", "2,900")}</td><td>${ix("ProfitLossBeforeTax", "c-2", "2,400")}</td></tr></table></body></html>`;
function upstream(log = []) {
  return async (url) => {
    log.push(url);
    if (url.includes("/companyfacts/")) return JSON.stringify(companyfacts());
    if (url.includes("/submissions/")) return JSON.stringify(submissions);
    if (url === `${folder}bmo-20260731.htm`) return header;
    if (url === `${folder}index.json`) return JSON.stringify({ directory: { item: [{ name: "bmo-20260731.htm", size: "876518" }, { name: "bmo-20260731_d2.htm", size: "2971673" }, { name: "R2.htm", size: "115256" }] } });
    if (url === `${folder}bmo-20260731_d2.htm`) return statementsDoc;
    throw new Error(`unexpected ${url}`);
  };
}

test("a Canadian bank: the July quarter's 6-K is read, its contexts from the header document of the same document set", async () => {
  const log = [];
  const c = await loadSecComparison("BMO", CIK, upstream(log), NOW);
  assert.ok(log.includes(`${folder}bmo-20260731_d2.htm`));
  assert.equal(c.status, "ready"); assert.equal(c.periodMonths, undefined);
  assert.equal(c.quarterRevenue.start, "2026-05-01"); assert.equal(c.quarterRevenue.end, "2026-07-31"); assert.equal(c.quarterRevenue.unit, "CAD");
  assert.equal(c.quarterRevenue.value, 9700e6);
  assert.ok(Math.abs(c.quarterRevenueGrowth - (9700 / 8900 - 1) * 100) < 1e-9);
  assert.ok(Math.abs(c.quarterOperatingMargin - 2900 / 9700 * 100) < 1e-9);
  assert.deepEqual(c.dataWarnings, []);
  assert.ok(hasRecentQuarter(c, NOW));
  const scores = Object.fromEntries(comparisonScores(c, NOW).map(s => [s.id, s.value]));
  for (const id of ["growth", "profitability"]) assert.notEqual(scores[id], null, id);
});

test("an IFRS bank whose only revenue line is total operating income (HSBC) has figures; a stated revenue line still wins", () => {
  const A = "0001089113-26-000010";
  const hsbc = (extra = {}) => ({ cik: 1089113, facts: { "ifrs-full": {
    RevenueAndOperatingIncome: { units: { USD: [fact(68.27e9, "2025-12-31", A, "20-F", "2026-02-26", "2025-01-01"), fact(65.85e9, "2024-12-31", A, "20-F", "2026-02-26", "2024-01-01")] } },
    ProfitLossFromOperatingActivities: { units: { USD: [fact(28.0e9, "2025-12-31", A, "20-F", "2026-02-26", "2025-01-01")] } },
    ...extra,
  } } });
  const c = extractFinancials("HSBC", "1089113", hsbc(), NOW);
  assert.equal(c.status, "ready"); assert.equal(c.revenue.value, 68.27e9); assert.equal(c.revenue.basis, "ifrs-full");
  assert.ok(Math.abs(c.revenueGrowth - (68.27 / 65.85 - 1) * 100) < 1e-9);
  const stated = extractFinancials("HSBC", "1089113", hsbc({ Revenue: { units: { USD: [fact(50e9, "2025-12-31", A, "20-F", "2026-02-26", "2025-01-01")] } } }), NOW);
  assert.equal(stated.revenue.value, 50e9);
});

test("the statements turn among a minute's companies, one a day, so none is skipped for good", () => {
  const due = ["A", "B", "C", "D", "E"], day = 86_400_000, base = Math.floor(NOW / day) * day;
  const firsts = Array.from({ length: 5 }, (_, i) => statementOrder(due, base + i * day)[0]);
  assert.deepEqual([...firsts].sort(), due);
  for (let i = 0; i < 5; i++) assert.deepEqual([...statementOrder(due, base + i * day)].sort(), due);
  assert.deepEqual(statementOrder(["A"], NOW), ["A"]); assert.deepEqual(statementOrder([], NOW), []);
});

test("revenue and other operating income comes after a sales line (argenx: sales of goods is the revenue)", () => {
  const A = "0001697862-26-000032";
  const argx = extractFinancials("ARGX", "1697862", { cik: 1697862, facts: { "ifrs-full": {
    RevenueFromSaleOfGoods: { units: { USD: [fact(4.151e9, "2025-12-31", A, "20-F", "2026-03-19", "2025-01-01"), fact(2.186e9, "2024-12-31", A, "20-F", "2026-03-19", "2024-01-01")] } },
    RevenueAndOperatingIncome: { units: { USD: [fact(4.248e9, "2025-12-31", A, "20-F", "2026-03-19", "2025-01-01"), fact(2.252e9, "2024-12-31", A, "20-F", "2026-03-19", "2024-01-01")] } },
  } } }, NOW);
  assert.equal(argx.status, "ready"); assert.equal(argx.revenue.value, 4.151e9); assert.equal(argx.revenue.tag, "RevenueFromSaleOfGoods");
});

test("a half-year: twelve-month revenue is the fiscal year plus this half minus the same half a year earlier; a half without its comparative is not used", () => {
  const FY = "0000000001-26-000001", H1 = "0000000001-26-000020";
  const facts = (withPrior) => ({ cik: 1, facts: { "us-gaap": {
    Revenues: { units: { USD: [fact(400e6, "2025-12-31", FY, "20-F", "2026-04-01", "2025-01-01"), fact(350e6, "2024-12-31", FY, "20-F", "2026-04-01", "2024-01-01"),
      fact(240e6, "2026-06-30", H1, "6-K", "2026-09-01", "2026-01-01"), ...(withPrior ? [fact(180e6, "2025-06-30", H1, "6-K", "2026-09-01", "2025-01-01")] : [])] } },
  } } });
  const half = extractFinancials("HALF", "1", facts(true), NOW);
  assert.equal(half.periodMonths, 6); assert.equal(half.quarterRevenue.value, 240e6);
  assert.equal(half.quarterRevenueTtm, 400e6 + 240e6 - 180e6);
  // Only this half's sales (Ohmyhome's exhibit): no growth or margin could come from it, so the fiscal year stays the period.
  const alone = extractFinancials("HALF", "1", facts(false), NOW);
  assert.equal(alone.periodMonths, 12); assert.equal(alone.quarterRevenue.value, 400e6);
});

// ---------- what the comparison does not offer (owner, Nov 19: option A) ----------
const lists = JSON.parse(readFileSync(new URL("../lib/research/comparison-exclusions.json", import.meta.url), "utf8"));
const dir = [
  { ticker: "AACI", cik: 2092897, name: "Armada Acquisition Corp. III", exchange: "Nasdaq" }, { ticker: "AACIU", cik: 2092897, name: "Armada Acquisition Corp. III", exchange: "Nasdaq" },
  { ticker: "AACIW", cik: 2092897, name: "Armada Acquisition Corp. III", exchange: "Nasdaq" },
  { ticker: "SPY", cik: 884394, name: "SPDR S&P 500 ETF TRUST", exchange: "NYSE" }, { ticker: "GLD", cik: 1222333, name: "SPDR GOLD TRUST", exchange: "NYSE" },
  { ticker: "CTA-PB", cik: 30554, name: "EIDP, Inc.", exchange: "NYSE" }, { ticker: "OPEN", cik: 1801169, name: "Opendoor Technologies Inc.", exchange: "Nasdaq" },
  { ticker: "OPENW", cik: 1801169, name: "Opendoor Technologies Inc.", exchange: "Nasdaq" }, { ticker: "KCAC-UN", cik: 1, name: "K Acquisition", exchange: "NYSE" },
  { ticker: "NMZ-RI", cik: 2, name: "Nuveen", exchange: "NYSE" },
  // Ordinary shares that must stay: share classes, a five-letter ticker without a four-letter sibling, a mortgage REIT named "Trust", a foreign filer.
  { ticker: "BRK-B", cik: 1067983, name: "BERKSHIRE HATHAWAY INC", exchange: "NYSE" }, { ticker: "MKC-V", cik: 63754, name: "MCCORMICK & CO INC", exchange: "NYSE" },
  { ticker: "GOOGL", cik: 1652044, name: "Alphabet Inc.", exchange: "Nasdaq" }, { ticker: "MO", cik: 764180, name: "ALTRIA GROUP, INC.", exchange: "NYSE" },
  { ticker: "ADAM", cik: 1273685, name: "ADAMAS TRUST, INC.", exchange: "Nasdaq" }, { ticker: "BTI", cik: 1303523, name: "British American Tobacco p.l.c.", exchange: "NYSE" },
];
test("SPACs, funds, preferreds, warrants, units and rights are not offered; ordinary shares and share classes are", () => {
  const sib = tickersByCik(dir), kind = t => comparisonExclusion(dir.find(e => e.ticker === t), sib, lists);
  assert.deepEqual(Object.fromEntries(["AACI", "AACIU", "AACIW", "SPY", "GLD", "CTA-PB", "OPENW", "KCAC-UN", "NMZ-RI"].map(t => [t, kind(t)])),
    { AACI: "spac", AACIU: "unit", AACIW: "warrant", SPY: "fund", GLD: "fund", "CTA-PB": "preferred", OPENW: "warrant", "KCAC-UN": "unit", "NMZ-RI": "right" });
  for (const t of ["BRK-B", "MKC-V", "GOOGL", "OPEN", "MO", "ADAM", "BTI"]) assert.equal(kind(t), null, t);
  // A SPAC that completed its merger has the operating company's name: offered again without a new list.
  assert.equal(comparisonExclusion({ ...dir[0], name: "Merged Operating Co." }, sib, lists), null);
  assert.deepEqual(comparableEntries(dir, lists).map(e => e.ticker), ["OPEN", "BRK-B", "MKC-V", "GOOGL", "MO", "ADAM", "BTI"]);
});

test("a Nasdaq warrant, unit or right beside a shorter base ticker of the same company is not offered (Nov 20: MOBBW beside MOB)", () => {
  const e = (ticker, cik, name, exchange = "Nasdaq") => ({ ticker, cik, name, exchange });
  const entries = [e("MOB", 1898643, "Mobilicom Ltd"), e("MOBBW", 1898643, "Mobilicom Ltd"), e("HTZ", 1657853, "HERTZ GLOBAL HOLDINGS, INC"),
    e("HTZWW", 1657853, "HERTZ GLOBAL HOLDINGS, INC"), e("GEN", 849399, "Gen Digital Inc."), e("GENVR", 849399, "Gen Digital Inc."),
    e("ZKP", 3, "Lafayette Digital Acquisition Corp. I"), e("ZKPU", 3, "Lafayette Digital Acquisition Corp. I"),
    // Kept: a share class (GOOGL beside GOOG), a ticker ending in W without a shorter sibling, an NYSE note (PMTW beside PMT) and three letters too many.
    e("GOOG", 1652044, "Alphabet Inc."), e("GOOGL", 1652044, "Alphabet Inc."), e("SNOW", 1640147, "Snowflake Inc.", "NYSE"), e("PMT", 4, "PennyMac", "NYSE"),
    e("PMTW", 4, "PennyMac", "NYSE"), e("AB", 5, "X"), e("ABCDW", 5, "X")];
  const sib = tickersByCik(entries), kind = t => comparisonExclusion(entries.find(x => x.ticker === t), sib, lists);
  assert.deepEqual(["MOBBW", "HTZWW", "GENVR", "ZKPU"].map(kind), ["warrant", "warrant", "right", "unit"]);
  for (const t of ["MOB", "HTZ", "GEN", "GOOG", "GOOGL", "SNOW", "PMT", "PMTW", "ABCDW"]) assert.equal(kind(t), null, t);
});

test("a Nasdaq preferred or note beside a shorter base ticker of the same company is not offered; GOOGL is (Nov 20 review: BRKRP)", () => {
  const e = (ticker, cik, name, exchange = "Nasdaq") => ({ ticker, cik, name, exchange });
  const entries = [e("BRKR", 1109354, "BRUKER CORP"), e("BRKRP", 1109354, "BRUKER CORP"), e("AGNC", 1423689, "AGNC Investment Corp."),
    e("AGNCM", 1423689, "AGNC Investment Corp."), e("AGNCN", 1423689, "AGNC Investment Corp."), e("AGNCO", 1423689, "AGNC Investment Corp."),
    e("AGNCP", 1423689, "AGNC Investment Corp."), e("ACGL", 947484, "ARCH CAPITAL GROUP LTD."), e("ACGLO", 947484, "ARCH CAPITAL GROUP LTD."),
    e("HBAN", 49196, "HUNTINGTON BANCSHARES INC /MD/"), e("HBANP", 49196, "HUNTINGTON BANCSHARES INC /MD/"), e("CHTR", 1091667, "CHARTER COMMUNICATIONS, INC. /MO/"),
    e("CHTRP", 1091667, "CHARTER COMMUNICATIONS, INC. /MO/"), e("ZION", 109380, "ZIONS BANCORPORATION"), e("ZIONP", 109380, "ZIONS BANCORPORATION"),
    e("SMCI", 1375365, "Super Micro Computer, Inc."), e("SMCIP", 1375365, "Super Micro Computer, Inc."), e("META", 1326801, "Meta Platforms, Inc."),
    e("METAM", 1326801, "Meta Platforms, Inc."), e("GOOG", 1652044, "Alphabet Inc."), e("GOOGL", 1652044, "Alphabet Inc."), e("GOOGN", 1652044, "Alphabet Inc."),
    e("BHF", 1685040, "Brighthouse Financial, Inc."), e("BHFAP", 1685040, "Brighthouse Financial, Inc."),
    // Kept: a ticker ending in P, O, N or M with no shorter sibling, and an NYSE ticker (its preferreds carry the -P suffix).
    e("ADAM", 1273685, "ADAMAS TRUST, INC."), e("SNOW", 1640147, "Snowflake Inc.", "NYSE"), e("SNO", 1640147, "Snowflake Inc.", "NYSE"), e("ON", 1097864, "ON SEMICONDUCTOR CORP")];
  const sib = tickersByCik(entries), kind = t => comparisonExclusion(entries.find(x => x.ticker === t), sib, lists);
  const excluded = ["BRKRP", "AGNCM", "AGNCN", "AGNCO", "AGNCP", "ACGLO", "HBANP", "CHTRP", "ZIONP", "SMCIP", "METAM", "GOOGN", "BHFAP"];
  for (const t of excluded) assert.equal(kind(t), "preferred", t);
  for (const t of ["BRKR", "AGNC", "ACGL", "HBAN", "CHTR", "ZION", "SMCI", "META", "GOOG", "GOOGL", "BHF", "ADAM", "SNOW", "SNO", "ON"]) assert.equal(kind(t), null, t);
  assert.deepEqual(comparableEntries(entries, lists).filter(x => excluded.includes(x.ticker)), []);
});

test("crypto, commodity and currency funds whose income reads as revenue are not offered; operating companies in those codes are", () => {
  // Nov 19: SOLC and SUIS (staking rewards booked as revenue) showed neither a strength nor a weakness; the same kind of fund is left out.
  const funds = [{ ticker: "SOLC", cik: 2041869, name: "Canary Marinade Solana ETF" }, { ticker: "SUIS", cik: 2060703, name: "Canary Staked SUI ETF" },
    { ticker: "IAU", cik: 1278680, name: "ISHARES GOLD TRUST" }, { ticker: "UVXY", cik: 1415311, name: "ProShares Trust II" }, { ticker: "FETH", cik: 2000046, name: "Fidelity Ethereum Fund" }];
  const companies = [{ ticker: "ANTA", cik: 2044255, name: "Antalpha Platform Holding Co" }, { ticker: "XRPN", cik: 2092592, name: "Evernorth Holdings Inc." },
    { ticker: "HSDT", cik: 1610853, name: "Solana Co" }, { ticker: "ABTC", cik: 1755953, name: "American Bitcoin Corp." }];
  const entries = [...funds, ...companies].map(e => ({ ...e, exchange: "Nasdaq" })), sib = tickersByCik(entries);
  for (const e of entries.slice(0, funds.length)) assert.equal(comparisonExclusion(e, sib, lists), "fund", e.ticker);
  for (const e of entries.slice(funds.length)) assert.equal(comparisonExclusion(e, sib, lists), null, e.ticker);
});

test("the comparison's search asks for its own scope; a direct request for an excluded ticker is an unknown company, as before", () => {
  for (const file of ["../app/research/compare/screen.tsx", "../app/research/compare/ticker-search.tsx"])
    assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), /\/api\/research\/stocks\?scope=compare&q=/);
  const route = readFileSync(new URL("../app/api/research/stocks/route.ts", import.meta.url), "utf8");
  assert.match(route, /searchParams\.get\("scope"\) === "compare" \? searchDirectory\(comparableEntries\(entries, COMPARISON_EXCLUSIONS\), query, limit\) : searchDirectory\(entries, query, limit\)/);
  const server = readFileSync(new URL("../lib/research/comparison-server.ts", import.meta.url), "utf8");
  assert.match(server, /return entry && !excluded \? \{/);
  assert.match(server, /\(await excludedEntry\(ticker\)\)\.excluded\) return \{ needs: false, checkedAt \}/);
  // The route answers an unresolved company with its existing error; nothing new is said on screen.
  assert.match(readFileSync(new URL("../app/api/research/compare/route.ts", import.meta.url), "utf8"), /error: "unknown-company"/);
});
