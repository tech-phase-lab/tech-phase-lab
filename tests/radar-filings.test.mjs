import assert from "node:assert/strict";
import test from "node:test";
import { radarFacts } from "../lib/research/radar-facts.ts";
import { filingLag, filedPeriod, latestPeriodic, parseStatementTables, parseXbrlInstance, recentFilings, staleItems, statementsEnd, supplementFacts } from "../lib/research/radar-filings.ts";
import { refreshChunk } from "../lib/research/radar-refresh.ts";

// Nov 18 (owner: "本当に見てる？"): Nebius reported Q3 2026 in a 6-K (no XBRL) and the radar kept its 2025 year; Arista and Applied
// Optoelectronics stopped a quarter or three behind on a renamed capital-spending line; Constellation's 10-Q was not in the company facts.

const NOW = Date.parse("2026-11-18T12:00:00Z");
const fy = (tag, val, form = "20-F") => ({ start: "2025-01-01", end: "2025-12-31", val, form, filed: "2026-04-30", accn: "A-20F" });
const at = (val, end = "2025-12-31", form = "20-F") => ({ end, val, form, filed: "2026-04-30", accn: "A-20F" });
const facts = tags => ({ facts: { "us-gaap": Object.fromEntries(Object.entries(tags).map(([tag, rows]) => [tag, { units: { USD: rows } }])) } });
/** A foreign filer's last annual report (dollars, us-gaap), as the company facts hold it. */
const annual = () => facts({
  Revenues: [fy("Revenues", 529_800_000)],
  NetCashProvidedByUsedInOperatingActivities: [fy("", 384_800_000)],
  PaymentsToAcquirePropertyPlantAndEquipment: [fy("", 4_066_000_000)],
  CashAndCashEquivalentsAtCarryingValue: [at(3_678_100_000)],
  LongTermDebtCurrent: [at(24_500_000)], LongTermDebtNoncurrent: [at(4_103_200_000)], OperatingLeaseLiability: [at(845_400_000)],
});

const cell = text => `<td style="x"><p><font>${text}</font></p></td>`;
const row = (...cells) => `<tr>${cells.map(cell).join("")}</tr>`;
/** The shape of Nebius's exhibit 99.2: the scale above each table, split header cells, a Notes column, (brackets) and — for nil. */
const exhibit = `<html><body>
<p>INDEX</p><table>${row("Balance sheets", "F-2")}</table>
<p>UNAUDITED CONDENSED CONSOLIDATED BALANCE SHEETS (In millions of U.S. dollars (&#8220;$&#8221;), except share data)</p>
<table>${row("", "", "As of")}${row("", "", "December 31,", "September 30,")}${row("", "Notes", "2025", "2026")}${row("ASSETS")}
${row("Cash and cash equivalents", "4", "3,678.1", "7,425.6")}${row("Debt, current", "12", "24.5", "187.5")}
${row("Operating lease liabilities, non-current", "8", "760.5", "1,768.8")}${row("Debt, non-current", "12", "4,103.2", "14,003.3")}</table>
<p>UNAUDITED CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS (In millions of U.S. dollars (&#8220;$&#8221;))</p>
<table>${row("", "Three months ended September 30,", "Nine months ended September 30,")}${row("", "Notes", "2025", "2026", "2025", "2026")}
${row("Revenues", "", "146.1", "980.8", "302.1", "1,962.1")}${row("Income / (loss) from operations", "", "(130.2)", "50.4", "(361.7)", "(253.5)")}</table>
<p>UNAUDITED CONDENSED CONSOLIDATED STATEMENTS OF CASH FLOWS (In millions of U.S. dollars)</p>
<table>${row("", "Nine months ended September 30,")}${row("", "Notes", "2025", "2026")}
${row("Net cash provided by / (used in) operating activities – continuing operations", "", "(432.4)", "4,231.1")}
${row("Net cash provided by / (used in) operating activities", "", "(449.5", ")", "4,231.1")}
${row("Purchases of property and equipment and intangible assets", "", "(2,010.0)", "(15,430.7)")}
${row("Investment in Toloka", "", "(42.7)", "&#8212;")}</table>
<p>8. LEASES (In millions of U.S. dollars)</p>
<table>${row("", "December 31, 2025", "September 30, 2026")}${row("Total operating lease liabilities", "845.4", "1,881.5")}</table>
</body></html>`;

const usd = (data, tag) => data.facts["us-gaap"][tag].units.USD;

test("a 6-K exhibit's statements become facts: instants, the year to date, brackets as negatives, the notes column ignored", () => {
  const extra = parseStatementTables(exhibit, "2026-11-12", "A-6K", annual());
  const cash = usd(extra, "CashAndCashEquivalentsAtCarryingValue");
  assert.deepEqual(cash.map(r => [r.end, r.val, r.form]), [["2025-12-31", 3_678_100_000, "6-K"], ["2026-09-30", 7_425_600_000, "6-K"]]);
  const ocf = usd(extra, "NetCashProvidedByUsedInOperatingActivities");
  assert.deepEqual(ocf.map(r => [r.start, r.end, r.val]), [["2025-01-01", "2025-09-30", -449_500_000], ["2026-01-01", "2026-09-30", 4_231_100_000]],
    "the total, not the continuing-operations line; a bracket in its own cell still makes it negative");
  assert.deepEqual(usd(extra, "Revenues").map(r => [r.start, r.end, r.val]),
    [["2025-07-01", "2025-09-30", 146_100_000], ["2026-07-01", "2026-09-30", 980_800_000], ["2025-01-01", "2025-09-30", 302_100_000], ["2026-01-01", "2026-09-30", 1_962_100_000]]);
  assert.equal(usd(extra, "PaymentsToAcquirePropertyPlantAndEquipment")[1].val, 15_430_700_000, "capital spending is kept as a positive amount");
  assert.equal(usd(extra, "OperatingLeaseLiability")[1].val, 1_881_500_000);
  assert.equal(statementsEnd(extra), "2026-09-30");
});

test("with the 6-K the radar moves to the filed quarter on a trailing-year basis", () => {
  const before = radarFacts(annual(), NOW);
  assert.equal(before.latest.end, "2025-12-31");
  const merged = parseStatementTables(exhibit, "2026-11-12", "A-6K", annual());
  const all = facts({});
  for (const [tag, body] of Object.entries(annual().facts["us-gaap"])) all.facts["us-gaap"][tag] = { units: { USD: [...body.units.USD] } };
  for (const [tag, body] of Object.entries(merged.facts["us-gaap"])) (all.facts["us-gaap"][tag] ??= { units: { USD: [] } }).units.USD.push(...body.units.USD);
  const after = radarFacts(all, NOW);
  assert.equal(after.latest.end, "2026-09-30"); assert.equal(after.latest.basis, "ttm");
  const revenue = 529.8 + 1962.1 - 302.1, ocf = 384.8 + 4231.1 + 449.5;
  assert.ok(Math.abs(after.latest.revenue - revenue * 1e6) < 1);
  assert.ok(Math.abs(after.latest.ocfMargin - ocf / revenue * 100) < 1e-9);
  assert.ok(Math.abs(after.latest.cover - 7425.6 / (187.5 + 14003.3 + 1881.5)) < 1e-9);
  assert.equal(after.previous.end, "2025-12-31");
});

test("another currency, or no stated scale, is not read", () => {
  assert.deepEqual(parseStatementTables(exhibit.replaceAll("U.S. dollars", "euros"), "2026-11-12", "A", annual()).facts, {});
  assert.deepEqual(parseStatementTables(exhibit.replace(/\(In millions[^)]*\)[^)]*\)/g, "").replace(/\(In millions of U.S. dollars\)/g, ""), "2026-11-12", "A", annual()).facts, {});
});

const instance = `<xbrl><context id="c-1"><entity><identifier>1</identifier></entity><period><startDate>2026-01-01</startDate><endDate>2026-09-30</endDate></period></context>
<context id="c-2"><entity><identifier>1</identifier><segment><xbrldi:explicitMember dimension="dei:LegalEntityAxis">x:SubMember</xbrldi:explicitMember></segment></entity><period><instant>2026-09-30</instant></period></context>
<context id="c-3"><entity><identifier>1</identifier></entity><period><instant>2026-09-30</instant></period></context>
<unit id="usd"><measure>iso4217:USD</measure></unit><unit id="eur"><measure>iso4217:EUR</measure></unit>
<us-gaap:Revenues contextRef="c-1" unitRef="usd" decimals="-6">18626000000</us-gaap:Revenues>
<us-gaap:CashAndCashEquivalentsAtCarryingValue contextRef="c-3" unitRef="usd" decimals="-6">603000000</us-gaap:CashAndCashEquivalentsAtCarryingValue>
<us-gaap:CashAndCashEquivalentsAtCarryingValue contextRef="c-2" unitRef="usd" decimals="-6">52000000</us-gaap:CashAndCashEquivalentsAtCarryingValue>
<us-gaap:LongTermDebt contextRef="c-3" unitRef="eur">5</us-gaap:LongTermDebt></xbrl>`;

test("an XBRL instance gives the whole company's dollar facts (no subsidiary member, no other currency)", () => {
  const data = parseXbrlInstance(instance, "10-Q", "2026-11-09", "B-10Q");
  assert.deepEqual(usd(data, "CashAndCashEquivalentsAtCarryingValue"), [{ end: "2026-09-30", val: 603_000_000, form: "10-Q", filed: "2026-11-09", accn: "B-10Q" }]);
  assert.deepEqual(usd(data, "Revenues")[0], { start: "2026-01-01", end: "2026-09-30", val: 18_626_000_000, form: "10-Q", filed: "2026-11-09", accn: "B-10Q" });
  assert.equal(data.facts["us-gaap"].LongTermDebt, undefined);
});

const submissions = forms => ({ filings: { recent: {
  form: forms.map(f => f[0]), accessionNumber: forms.map(f => f[1]), filingDate: forms.map(f => f[2]), reportDate: forms.map(f => f[3] ?? ""),
  primaryDocument: forms.map(f => f[4] ?? "doc.htm"), isXBRL: forms.map(f => f[5] ?? 0),
} } });
const archive = (cik, accn, name) => `https://www.sec.gov/Archives/edgar/data/${cik}/${accn.replace(/-/g, "")}/${name}`;
const fetcher = files => { const seen = []; const fn = async url => { seen.push(url); if (!(url in files)) throw Error("404"); return files[url]; }; fn.seen = seen; return fn; };

test("a foreign filer's newest 6-K statements are read; the filing it reports is the 6-K's period", async () => {
  const subs = submissions([["4", "0-4", "2026-11-17"], ["6-K", "0001-26-2", "2026-11-12", "2026-11-12", "nbis-6k.htm"], ["20-F", "A-20F", "2026-04-30", "2025-12-31", "f.htm", 1]]);
  assert.equal(latestPeriodic(recentFilings(subs)).form, "20-F");
  const fetchText = fetcher({
    [archive(1513845, "0001-26-2", "index.json")]: JSON.stringify({ directory: { item: [{ name: "nbis-6k.htm", size: 19000 }, { name: "nbis-ex99d1.htm", size: 28000 }, { name: "nbis-ex99d2.htm", size: 1_700_000 }] } }),
    [archive(1513845, "0001-26-2", "nbis-ex99d2.htm")]: exhibit,
  });
  const result = await supplementFacts("1513845", annual(), subs, fetchText);
  assert.deepEqual(result.filing, { form: "6-K", period: "2026-09-30", filed: "2026-11-12" });
  assert.equal(result.unread, null);
  assert.equal(radarFacts(result.facts, NOW).latest.end, "2026-09-30");
  assert.equal(fetchText.seen.length, 2, "the index and the largest exhibit only");
  assert.deepEqual(await filedPeriod("1513845", subs, fetchText), { form: "6-K", period: "2026-09-30", filed: "2026-11-12" });
});

test("a 6-K with statements that cannot be read is reported, never guessed", async () => {
  const subs = submissions([["6-K", "0001-26-2", "2026-11-12"], ["20-F", "A-20F", "2026-04-30", "2025-12-31", "f.htm", 1]]);
  const fetchText = fetcher({
    [archive(1513845, "0001-26-2", "index.json")]: JSON.stringify({ directory: { item: [{ name: "ex99.htm", size: 50_000 }] } }),
    [archive(1513845, "0001-26-2", "ex99.htm")]: "<p>Condensed balance sheets and statements of cash flows are attached as images.</p>",
  });
  const result = await supplementFacts("1513845", annual(), subs, fetchText);
  assert.equal(result.unread, "6k-unread");
  assert.equal(filingLag(radarFacts(result.facts, NOW).latest.end, result, NOW), "6k-unread");
});

test("a 10-Q the company facts do not hold yet is read from the filing's own XBRL instance; one they hold is not fetched", async () => {
  const base = facts({ CashAndCashEquivalentsAtCarryingValue: [{ end: "2026-06-30", val: 1, form: "10-Q", filed: "2026-08-06", accn: "B-0" }] });
  const subs = submissions([["10-Q", "B-10Q", "2026-11-09", "2026-09-30", "ceg-20260930.htm", 1], ["10-Q", "B-0", "2026-08-06", "2026-06-30", "q2.htm", 1]]);
  const fetchText = fetcher({
    [archive(1868275, "B-10Q", "index.json")]: JSON.stringify({ directory: { item: [{ name: "ceg-20260930_cal.xml", size: 1 }, { name: "ceg-20260930_htm.xml", size: 3_700_000 }] } }),
    [archive(1868275, "B-10Q", "ceg-20260930_htm.xml")]: instance,
  });
  const result = await supplementFacts("1868275", base, subs, fetchText);
  assert.deepEqual(result.filing, { form: "10-Q", period: "2026-09-30", filed: "2026-11-09" });
  assert.equal(usd(result.facts, "CashAndCashEquivalentsAtCarryingValue").length, 2);
  assert.equal(usd(base, "CashAndCashEquivalentsAtCarryingValue").length, 1, "the company facts given are not changed");
  const held = facts({ CashAndCashEquivalentsAtCarryingValue: [{ end: "2026-09-30", val: 1, form: "10-Q", filed: "2026-11-09", accn: "B-10Q" }] });
  const none = fetcher({});
  await supplementFacts("1868275", held, subs, none);
  assert.deepEqual(none.seen, []);
  const broken = await supplementFacts("1868275", base, subs, fetcher({}));
  assert.equal(broken.unread, "xbrl-unread");
});

test("behind means a later quarter filed more than two days ago; a 52/53-week quarter end is the same period", () => {
  const filing = { form: "10-Q", period: "2026-09-30", filed: "2026-11-12" };
  assert.equal(filingLag("2025-12-31", { filing }, Date.parse("2026-11-13T12:00:00Z")), null, "within two days of filing");
  assert.equal(filingLag("2025-12-31", { filing }, NOW), "behind");
  assert.equal(filingLag("2026-09-27", { filing }, NOW), null);
  assert.equal(filingLag(null, { filing }, NOW), "missing");
  assert.equal(filingLag("2026-09-30", { filing: null }, NOW), null);
  assert.deepEqual(staleItems([{ ticker: "NBIS", stored: "2025-12-31", filing: { form: "6-K", period: "2026-09-30", filed: "2026-11-12" } },
    { ticker: "NVDA", stored: "2026-07-26", filing: { form: "10-Q", period: "2026-07-26", filed: "2026-08-26" } },
    { ticker: "X", stored: null, filing: null, unreadable: true }], NOW).map(i => `${i.ticker}:${i.code}`), ["NBIS:behind", "X:sec-unreadable"]);
});

// ---- radar-facts: the derivation itself ----
let n = 0;
const r = (start, end, val, form = "10-Q", filed) => ({ ...(start ? { start } : {}), end, val, form, filed: filed ?? `2026-0${1 + (n++ % 9)}-15` });
const quarterly = capexTags => facts({
  Revenues: [r("2025-01-01", "2025-12-31", 1000, "10-K", "2026-02-17"), r("2025-01-01", "2025-09-30", 700, "10-Q", "2025-11-05"), r("2026-01-01", "2026-09-30", 900, "10-Q", "2026-11-04"),
    r("2026-07-01", "2026-09-30", 320, "10-Q", "2026-11-04")],
  NetCashProvidedByUsedInOperatingActivities: [r("2025-01-01", "2025-12-31", 400, "10-K", "2026-02-17"), r("2025-01-01", "2025-09-30", 300, "10-Q", "2025-11-05"), r("2026-01-01", "2026-09-30", 450, "10-Q", "2026-11-04")],
  ...capexTags,
  CashAndCashEquivalentsAtCarryingValue: [r(null, "2025-12-31", 500, "10-K", "2026-02-17"), r(null, "2026-09-30", 600, "10-Q", "2026-11-04")],
  OperatingLeaseLiability: [r(null, "2025-12-31", 100, "10-K", "2026-02-17"), r(null, "2026-09-30", 100, "10-Q", "2026-11-04")],
});

test("capital spending named differently in the 10-K and the 10-Qs (Arista) still gives the trailing year of the newest quarter", () => {
  const data = quarterly({
    PaymentsToAcquirePropertyPlantAndEquipment: [r("2025-01-01", "2025-09-30", 82, "10-Q", "2025-11-05"), r("2026-01-01", "2026-09-30", 185, "10-Q", "2026-11-04")],
    PaymentsToAcquireProductiveAssets: [r("2025-01-01", "2025-12-31", 120, "10-K", "2026-02-17")],
  });
  const result = radarFacts(data, NOW);
  assert.equal(result.latest.end, "2026-09-30"); assert.equal(result.latest.basis, "ttm");
  assert.equal(result.latest.revenue, 1200, "of a filing's quarter and year to date, the year to date is used");
  assert.equal(result.latest.ocfMargin, 550 / 1200 * 100);
  assert.equal(result.latest.fcfMargin, (550 - (120 + 185 - 82)) / 1200 * 100);
});

test("an IFRS filer in dollars is read; one in another currency says so", () => {
  const ifrs = { facts: { "ifrs-full": {
    Revenue: { units: { USD: [r("2025-01-01", "2025-12-31", 200, "20-F", "2026-03-01")] } },
    CashFlowsFromUsedInOperatingActivities: { units: { USD: [r("2025-01-01", "2025-12-31", 50, "20-F", "2026-03-01")] } },
    PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities: { units: { USD: [r("2025-01-01", "2025-12-31", 20, "20-F", "2026-03-01")] } },
    CashAndCashEquivalents: { units: { USD: [r(null, "2025-12-31", 80, "20-F", "2026-03-01")] } },
    Borrowings: { units: { USD: [r(null, "2025-12-31", 40, "20-F", "2026-03-01")] } },
  } } };
  const result = radarFacts(ifrs, NOW);
  assert.equal(result.latest.end, "2025-12-31"); assert.equal(result.latest.ocfMargin, 25); assert.equal(result.latest.cover, 2);
  const euros = { facts: { "ifrs-full": { CashAndCashEquivalents: { units: { EUR: [r(null, "2025-12-31", 80, "20-F")] } } } } };
  assert.equal(radarFacts(euros, NOW).reason, "currency");
});

test("the refresh lists companies still behind their filing, by ticker and code", async () => {
  let t = Date.parse("2026-11-18T23:00:00Z");
  const behind = { latest: { end: "2025-12-31", basis: "annual", revenue: 1, ocfMargin: 1, fcfMargin: 1, cover: 1, revenueGrowth: null }, previous: null, filing: { form: "6-K", period: "2026-09-30", filed: "2026-11-12" } };
  const current = { ...behind, filing: { form: "20-F", period: "2025-12-31", filed: "2026-04-30" } };
  const report = await refreshChunk(0, { now: () => t, sleep: async ms => { t += ms; }, budgetMs: 1e12, load: async ticker => ticker === "NBIS" ? behind : current, save: async () => true });
  assert.deepEqual(report.stale, ["NBIS:behind"]);
});
