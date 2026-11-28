// Stock Comparison audit of Nov 28 (PR #904's deferred L-1 and L-2, and the all-company static audit): each fix tested on the shape of the
// named company's own SEC facts or filing.
import test from "node:test";
import assert from "node:assert/strict";
import { extractFinancials, matchesLines } from "../lib/research/comparison.ts";
import { inlineFinancialFacts, inlineFinancialFactsText } from "../lib/research/comparison-filings.ts";
import { loadSecComparison } from "../lib/research/comparison-loader.ts";

const T = Date.parse("2026-11-28T03:00:00Z");
const FY = "0000000001-26-000000", Q3 = "0000000001-26-000003";
const row = (start, end, val, accn, filed, form = "10-Q") => ({ start, end, val, accn, filed, form });
const at = (end, val) => ({ end, val, accn: Q3, filed: "2026-11-05", form: "10-Q" });
const usd = list => ({ units: { USD: list } });
const gaap = facts => ({ cik: 1, facts: { "us-gaap": facts } });
const year = val => row("2025-01-01", "2025-12-31", val, FY, "2026-02-20", "10-K");
const q3 = (val, prior) => [row("2026-07-01", "2026-09-30", val, Q3, "2026-11-05"), ...(prior === undefined ? [] : [row("2025-07-01", "2025-09-30", prior, Q3, "2026-11-05")])];
const debtOf = (t, lines, liabilities = 1e12) => {
  const facts = { RevenueFromContractWithCustomerExcludingAssessedTax: usd([year(4e9), ...q3(1e9, 9e8)]), OperatingIncomeLoss: usd([year(1e9), ...q3(2e8)]),
    CashAndCashEquivalentsAtCarryingValue: usd([at("2026-09-30", 1e9)]), Liabilities: usd([at("2026-09-30", liabilities)]),
    ...Object.fromEntries(Object.entries(lines).map(([tag, v]) => [tag, usd([at("2026-09-30", v)])])) };
  return extractFinancials(t, "1", gaap(facts), T).balance?.debtTotal ?? null;
};

test("L-1: commercial paper and short-term borrowings are added to the split long-term debt (AAPL, WMT, CEG, NEE)", () => {
  assert.equal(debtOf("AAPL", { LongTermDebtCurrent: 9_906e6, LongTermDebtNoncurrent: 68_208e6, CommercialPaper: 1_997e6 }).value, 80_111e6);
  assert.equal(debtOf("WMT", { LongTermDebtCurrent: 3_470e6, LongTermDebtNoncurrent: 36_462e6, ShortTermBorrowings: 10_479e6 }).value, 50_411e6);
  assert.equal(debtOf("NEE", { LongTermDebtCurrent: 3_837e6, LongTermDebtNoncurrent: 93_948e6, CommercialPaper: 5_360e6, OtherShortTermBorrowings: 1_258e6 }).value, 104_403e6);
  // Current credit-line borrowings (IDXX's $474m revolver beside $75m of current notes).
  assert.equal(debtOf("IDXX", { LongTermDebtCurrent: 75e6, LongTermDebtNoncurrent: 300e6, LinesOfCreditCurrent: 474e6 }).value, 849e6);
});

test("L-1: short-term lines are counted once: parts of a total, a total that is one part, a repeat of the current debt (LIN, ADI, LNT, ICE)", () => {
  // LIN: commercial paper $4,321m and other $324m are the $4,645m of short-term borrowings.
  assert.equal(debtOf("LIN", { LongTermDebtCurrent: 1_464e6, LongTermDebtNoncurrent: 20_593e6, ShortTermBorrowings: 4_645e6, CommercialPaper: 4_321e6, OtherShortTermBorrowings: 324e6 }).value, 26_702e6);
  // ADI: commercial paper inside a larger short-term total.
  assert.equal(debtOf("ADI", { LongTermDebtCurrent: 1_343e6, LongTermDebtNoncurrent: 9_744e6, ShortTermBorrowings: 1_681e6, CommercialPaper: 340e6 }).value, 12_768e6);
  // LNT: the note's "short-term borrowings" of $704m is its commercial paper; other short-term borrowings of $400m are a second line.
  assert.equal(debtOf("LNT", { LongTermDebtCurrent: 374e6, LongTermDebtNoncurrent: 11_085e6, ShortTermBorrowings: 704e6, CommercialPaper: 704e6, OtherShortTermBorrowings: 400e6 }).value, 12_563e6);
  // ICE files its short-term debt line under both names.
  assert.equal(debtOf("ICE", { LongTermDebtCurrent: 2_959e6, LongTermDebtNoncurrent: 20_345e6, ShortTermBorrowings: 2_959e6 }).value, 23_304e6);
});

test("L-1: commercial paper at face beside the same borrowing at carrying value counts once; short-term lines never break the liabilities bound (NOW, RENX)", () => {
  assert.equal(debtOf("NOW", { LongTermDebt: 5_438e6, ShortTermBorrowings: 2_086e6, CommercialPaper: 2_100e6 }, 18_734e6).value, 7_538e6);
  // RENX: $20.6m of short-term borrowings inside $21.1m of current debt; with them the debt would pass its $32.3m of liabilities.
  assert.equal(debtOf("RENX", { LongTermDebtCurrent: 21_083_357, LongTermDebtNoncurrent: 2_942_080, LongTermDebt: 24_025_437, ShortTermBorrowings: 20_571_608 }, 32_278_210).value, 24_025_437);
  // ICON: secured debt that cannot sit beside its finance lease within the liabilities holds it.
  assert.equal(debtOf("ICON", { SecuredDebtCurrent: 2_280_000, SecuredLongTermDebt: 32_479_000, FinanceLeaseLiability: 21_042_000 }, 37_066_000).value, 34_759_000);
});

test("L-1: the current debt line, where filed, is the whole current side; it is never added to its own parts (EMR, BMY, IFF)", () => {
  assert.equal(debtOf("EMR", { LongTermDebtCurrent: 766e6, LongTermDebtNoncurrent: 7_508e6, DebtCurrent: 4_667e6, CommercialPaper: 3_901e6 }).value, 12_175e6);
  assert.equal(debtOf("BMY", { LongTermDebtCurrent: 768e6, LongTermDebtNoncurrent: 41_849e6, DebtCurrent: 1_028e6, ShortTermBorrowings: 1_028e6, ShortTermBankLoansAndNotesPayable: 260e6 }).value, 42_877e6);
  assert.equal(debtOf("IFF", { LongTermDebtCurrent: 1_538e6, LongTermDebtNoncurrent: 4_735e6, DebtCurrent: 1_538e6, CommercialPaper: 539e6 }).value, 6_273e6);
});

test("L-1: commercial paper is added to a long-term debt total, unless that total is all of the classified debt (PH, HUBB, CPT, VMRK)", () => {
  assert.equal(debtOf("PH", { LongTermDebt: 14_640e6, CommercialPaper: 2_800e6, DebtCurrent: 1_906e6 }).value, 17_440e6);
  assert.equal(debtOf("HUBB", { LongTermDebt: 4_806e6, CommercialPaper: 313e6, OtherShortTermBorrowings: 1e6 }).value, 5_120e6);
  // CPT: $4,228m of notes payable = $307m secured + $3,922m unsecured, the commercial paper inside the unsecured notes.
  assert.equal(debtOf("CPT", { LongTermDebt: 4_228.3e6, NotesPayable: 4_228.3e6, SecuredDebt: 306.8e6, UnsecuredDebt: 3_921.5e6, CommercialPaper: 600e6 }).value, 4_228.3e6);
  // VMRK: $13,941m unsecured, $2,039m secured and $1,021m of commercial paper are its $17,002m of notes payable.
  assert.equal(debtOf("VMRK", { LongTermDebt: 17_002e6, NotesPayable: 17_002e6, SecuredDebt: 2_039e6, UnsecuredDebt: 13_941e6, CommercialPaper: 1_021e6 }).value, 17_002e6);
});

test("L-1: secured debt beside other borrowing lines is added, unless it repeats one of them or their sum (ELS, SLG, CACC, AAT, HST)", () => {
  assert.equal(debtOf("ELS", { SecuredDebt: 2_731.3e6, LineOfCredit: 138e6, UnsecuredDebt: 438.1e6 }).value, 3_307.4e6);
  assert.equal(debtOf("CACC", { SecuredDebt: 5_406.3e6, LineOfCredit: 227.2e6 }).value, 5_633.5e6);
  assert.equal(debtOf("SLG", { SecuredDebt: 2_491.8e6, LineOfCredit: 814e6, SeniorNotes: 1_142.7e6, FinanceLeaseLiability: 108.5e6 }).value, 4_557e6);
  // AAT's secured note is its notes payable ($74.9m net, $75.0m gross); HST's secured debt is its other borrowings.
  assert.equal(debtOf("AAT", { SecuredDebt: 74.917e6, NotesPayable: 75e6, UnsecuredDebt: 1_613.6e6 }).value, 75e6 + 1_613.6e6);
  assert.equal(debtOf("HST", { SecuredDebt: 93e6, OtherBorrowings: 93e6, LineOfCredit: 999e6, SeniorNotes: 3_992e6 }).value, 5_084e6);
  // A secured figure that is the sum of two counted lines is their classification.
  assert.equal(debtOf("X", { SecuredDebt: 700e6, LineOfCredit: 200e6, WarehouseAgreementBorrowings: 500e6 }).value, 700e6);
  // Still bounded by total liabilities: secured debt that cannot sit beside the other lines holds them, else the debt is unknown.
  assert.equal(debtOf("X", { SecuredDebt: 2_000e6, LineOfCredit: 500e6 }, 2_200e6).value, 2_000e6);
  assert.equal(debtOf("X", { SecuredDebt: 2_000e6, LineOfCredit: 500e6 }, 1_900e6), null);
});

test("Audit: unsecured term loans below the senior notes are a line of their own; an unsecured total holds the notes (DLR, EXR, SUI)", () => {
  // DLR's 10-Q balance sheet: revolver $1,640m, unsecured term loans $424m, unsecured senior notes $15,809m, secured and other $1,620m.
  assert.equal(debtOf("DLR", { LineOfCredit: 1_640_466e3, UnsecuredDebt: 424_364e3, SeniorNotes: 15_809_482e3, SecuredDebt: 1_620_303e3 }, 26_284_010e3).value, 19_494_615e3);
  assert.equal(debtOf("EXR", { LineOfCredit: 1_424e6, OtherNotesPayable: 1_070e6, UnsecuredDebt: 1_496e6, SeniorNotes: 9_416e6 }, 15_201e6).value, 13_406e6);
  assert.equal(debtOf("SUI", { UnsecuredDebt: 1_788.4e6, SeniorNotes: 1_788.4e6, LoansPayable: 1_950.2e6 }).value, 1_950.2e6 + 1_788.4e6);
  assert.equal(debtOf("X", { UnsecuredDebt: 5_000e6, SeniorNotes: 4_000e6 }).value, 5_000e6);
});

test("matchesLines: one line, or the sum of two or three, within 0.5%", () => {
  assert.equal(matchesLines(100, [100.4]), true);
  assert.equal(matchesLines(100, [60, 40]), true);
  assert.equal(matchesLines(100, [50, 30, 20.3]), true);
  assert.equal(matchesLines(100, [50, 30]), false);
  assert.equal(matchesLines(100, []), false);
});

// ---- inline XBRL documents ----
const ctx = (id, start, end, cik = "1", member) => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">${cik}</xbrli:identifier>${member ? `<xbrli:segment><xbrldi:explicitMember dimension="srt:ProductOrServiceAxis">${member}</xbrldi:explicitMember></xbrli:segment>` : ""}</xbrli:entity><xbrli:period>${start ? `<xbrli:startDate>${start}</xbrli:startDate><xbrli:endDate>${end}</xbrli:endDate>` : `<xbrli:instant>${end}</xbrli:instant>`}</xbrli:period></xbrli:context>`;
const units = `<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit><xbrli:unit id="cny"><xbrli:measure>iso4217:CNY</xbrli:measure></xbrli:unit><xbrli:unit id="sh"><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unit>`;
const fact = (name, context, value, attrs = "") => `<ix:nonFraction name="${name}" contextRef="${context}" unitRef="usd" decimals="-3" ${/format=/.test(attrs) ? "" : 'format="ixt:num-dot-decimal" '}${attrs}>${value}</ix:nonFraction>`;
const FILING = { accession: FY, form: "20-F", filed: "2026-04-08", end: "2025-12-31", url: "https://www.sec.gov/Archives/edgar/data/1/000000000126000000/x-20251231.htm", inline: true, earnings: false };
const canon = r => JSON.stringify({ p: r.primaryRevenueTag ?? null, f: Object.fromEntries(Object.entries(r.facts).sort().map(([b, t]) => [b, Object.fromEntries(Object.entries(t).sort().map(([n, v]) => [n, Object.fromEntries(Object.entries(v.units).sort().map(([u, vals]) => [u, vals.map(x => `${x.start ?? ""}/${x.end}/${x.val}`).sort()]))]))])) });
const sample = [
  `<html><body><div style="display:none"><ix:header><ix:resources>`, ctx("y", "2025-01-01", "2025-12-31"), ctx("p", "2024-01-01", "2024-12-31"), ctx("b", null, "2025-12-31"),
  ctx("o", "2025-01-01", "2025-12-31", "2"), ctx("s", "2025-01-01", "2025-12-31", "1", "us-gaap:ProductMember"), units, `</ix:resources></ix:header></div>`,
  `<table><tr><td>Revenues</td><td>`, fact("us-gaap:Revenues", "y", "1,234", 'scale="6"'), `</td><td>`, fact("us-gaap:Revenues", "p", "1,100", 'scale="6"'), `</td></tr>`,
  `<tr><td>Net income</td><td>`, fact("us-gaap:NetIncomeLoss", "y", "<span>45</span>", 'scale="6" sign="-"'), `</td></tr><tr><td>Basic and diluted</td></tr></table>`,
  `<p>Cash `, fact("us-gaap:CashAndCashEquivalentsAtCarryingValue", "b", "1.234,5", 'scale="3" format="ixt:num-comma-decimal"'), `</p>`,
  // Nested facts (COP: one share count for two dates), an excluded fragment, a nil fact, another company's context, a segment, a zero dash.
  `<p>`, `<ix:nonFraction name="us-gaap:CommonStockSharesAuthorized" contextRef="b" unitRef="sh" decimals="0" format="ixt:num-dot-decimal"><ix:nonFraction name="us-gaap:CommonStockSharesAuthorized" contextRef="y" unitRef="sh" decimals="0" format="ixt:num-dot-decimal">2,500,000,000</ix:nonFraction></ix:nonFraction>`, `</p>`,
  fact("us-gaap:OperatingIncomeLoss", "y", "12<ix:exclude>3</ix:exclude>"), fact("us-gaap:GrossProfit", "y", "", 'xsi:nil="true"'),
  fact("us-gaap:Revenues", "o", "999"), fact("us-gaap:Revenues", "s", "500"), fact("us-gaap:LongTermDebt", "b", "&#8212;", 'format="ixt:fixed-zero"'),
  `<p>Capital spending `, fact("abc:PaymentsToAcquirePropertyAndEquipmentNet", "y", "77", 'scale="6"'), ` &amp; more</p></body></html>`,
].join("");

test("L-2: the text reader gives the tree reader's facts, primary revenue line included (nested facts, signs, scales, formats, exclusions)", () => {
  const tree = inlineFinancialFacts(sample, "1", FILING), text = inlineFinancialFactsText(sample, "1", FILING);
  assert.equal(canon(text), canon(tree));
  assert.equal(text.primaryRevenueTag, "us-gaap:Revenues");
  assert.equal(text.facts["us-gaap"].NetIncomeLoss.units.USD[0].val, -45e6);
  assert.equal(text.facts["us-gaap"].CashAndCashEquivalentsAtCarryingValue.units.USD[0].val, 1_234_500);
  assert.equal(text.facts["us-gaap"].CommonStockSharesAuthorized.units.shares.length, 2);
  assert.equal(text.facts["us-gaap"].TechPhaseExtensionCapex.units.USD[0].val, 77e6);
  assert.equal(text.facts["us-gaap"].Revenues.units.USD.length, 2, "never another company's or a segment's revenue");
  // The header kept in another document of the set (BMO's 6-K).
  const [header, body] = [sample.slice(0, sample.indexOf("<table>")), sample.slice(sample.indexOf("<table>"))];
  assert.equal(canon(inlineFinancialFactsText(body, "1", FILING, header)), canon(inlineFinancialFacts(body, "1", FILING, header)));
});

const subs = (form, doc, end = "2025-12-31", filed = "2026-04-08") => ({ cik: 1, sic: "6021", filings: { recent: { accessionNumber: [FY], form: [form], filingDate: [filed], reportDate: [end], primaryDocument: [doc], isInlineXBRL: [1], items: [""] } } });
const staleFacts = { cik: 1, facts: { "us-gaap": { Revenues: usd([row("2024-01-01", "2024-12-31", 1.1e9, "0000000001-25-000000", "2025-04-01", "20-F")]) } } };

test("L-2: a 20-F document over 20 MB is read (KB, SHG, WF, KEP and six more): its annual figures replace the year before", async () => {
  const big = sample + `<!--${"x".repeat(21_000_000)}-->`;
  const c = await loadSecComparison("KB", "1", async (url, limit) => {
    if (url.includes("/companyfacts/")) return JSON.stringify(staleFacts);
    if (url.includes("/submissions/")) return JSON.stringify(subs("20-F", "x-20251231.htm"));
    if (url.endsWith("x-20251231.htm")) { assert.ok(limit >= big.length, "the document is fetched in full"); return big; }
    throw new Error("unexpected " + url);
  }, T);
  assert.equal(c.revenue?.end, "2025-12-31");
  assert.equal(c.revenue?.value, 1_234e6);
  assert.ok(!(c.dataWarnings ?? []).some(w => w.en.includes("annual filing")), JSON.stringify(c.dataWarnings));
});

test("L-2: a failed look for a filing's statements document keeps the primary document's facts (WF's 2025 20-F in the audit)", async () => {
  // Revenue under a line the quick check does not know sends the loader to the folder index for another document; that index fails.
  const doc = sample.replaceAll("us-gaap:Revenues", "us-gaap:RegulatedOperatingRevenue");
  let looked = false;
  const c = await loadSecComparison("WF", "1", async url => {
    if (url.includes("/companyfacts/")) return JSON.stringify(staleFacts);
    if (url.includes("/submissions/")) return JSON.stringify(subs("20-F", "x-20251231.htm"));
    if (url.endsWith("x-20251231.htm")) return doc;
    looked = true;
    throw new Error("index unreachable");
  }, T);
  assert.ok(looked);
  assert.equal(c.revenue?.end, "2025-12-31");
  assert.equal(c.revenue?.value, 1_234e6);
});

test("L-2: revenue tagged only as product and service parts is their sum; a third part or a consolidated line adds nothing (RERE)", () => {
  const doc = (extra = "") => [`<ix:header>`, ctx("y", "2025-01-01", "2025-12-31"), ctx("p", "2024-01-01", "2024-12-31"),
    ctx("yp", "2025-01-01", "2025-12-31", "1", "us-gaap:ProductMember"), ctx("ys", "2025-01-01", "2025-12-31", "1", "us-gaap:ServiceMember"),
    ctx("pp", "2024-01-01", "2024-12-31", "1", "us-gaap:ProductMember"), ctx("ps", "2024-01-01", "2024-12-31", "1", "us-gaap:ServiceMember"),
    ctx("yo", "2025-01-01", "2025-12-31", "1", "rere:OtherMember"), units, `</ix:header>`,
    ...[["yp", "19,379,932"], ["ys", "1,668,324"], ["pp", "14,844,416"], ["ps", "1,483,745"]].map(([c, v]) => fact("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", c, v, 'scale="3"').replace('unitRef="usd"', 'unitRef="cny"')),
    // The convenience translation into dollars is a second currency, summed on its own.
    fact("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "yp", "2,771,293", 'scale="3"'), fact("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "ys", "238,567", 'scale="3"'),
    fact("us-gaap:OperatingIncomeLoss", "y", "456,175", 'scale="3"').replace('unitRef="usd"', 'unitRef="cny"'), extra].join("");
  for (const read of [inlineFinancialFacts, inlineFinancialFactsText]) {
    const rows = read(doc(), "1", FILING).facts["us-gaap"].RevenueFromContractWithCustomerExcludingAssessedTax.units;
    assert.deepEqual(rows.CNY.map(r => [r.end, r.val]).sort(), [["2024-12-31", 16_328_161_000], ["2025-12-31", 21_048_256_000]]);
    assert.deepEqual(rows.USD.map(r => r.val), [3_009_860_000]);
    // A third member on the axis: product and service are not the whole.
    const third = read(doc(fact("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "yo", "5", 'scale="3"').replace('unitRef="usd"', 'unitRef="cny"')), "1", FILING).facts["us-gaap"].RevenueFromContractWithCustomerExcludingAssessedTax.units.CNY;
    assert.deepEqual(third.map(r => r.end), ["2024-12-31"]);
    // A consolidated revenue line of that period: nothing is made up.
    const stated = read(doc(fact("us-gaap:Revenues", "y", "21,048,256", 'scale="3"').replace('unitRef="usd"', 'unitRef="cny"')), "1", FILING).facts["us-gaap"];
    assert.ok(!(stated.RevenueFromContractWithCustomerExcludingAssessedTax?.units.CNY ?? []).some(r => r.end === "2025-12-31"));
  }
  const c = extractFinancials("RERE", "1", { cik: 1, facts: inlineFinancialFacts(doc(), "1", FILING).facts }, T);
  assert.equal(c.revenue.value, 21_048_256_000);
  assert.ok(Math.abs(c.revenueGrowth - 28.906) < 0.01, String(c.revenueGrowth));
});

test("Audit: an income statement whose net line reads 'Net (loss) income' names its revenue line: the total below the sales line (CRC)", () => {
  const filing = { accession: Q3, form: "10-Q", filed: "2026-11-03", end: "2026-09-30", url: "https://www.sec.gov/x", inline: true, earnings: false };
  const doc = [ctx("q", "2026-07-01", "2026-09-30"), units, `<table><tr><td>Oil, natural gas and NGL sales</td><td>`,
    fact("us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", "q", "1,002", 'scale="6"'), `</td></tr><tr><td>Total operating revenues</td><td>`,
    fact("us-gaap:Revenues", "q", "421", 'scale="6"'), `</td></tr><tr><td>NET (LOSS) INCOME</td></tr><tr><td>Net (loss) income per share Basic</td><td>Diluted</td></tr></table>`].join("");
  for (const read of [inlineFinancialFacts, inlineFinancialFactsText]) assert.equal(read(doc, "1", filing).primaryRevenueTag, "us-gaap:Revenues");
});

test("Audit: an IFRS filer's one revenue line that names what it sells is its revenue; never beside a total or a second kind (VIV, BTG)", () => {
  const ifrs = lines => ({ cik: 1, facts: { "ifrs-full": Object.fromEntries(Object.entries(lines).map(([tag, rows]) => [tag, { units: { BRL: rows } }])) } });
  const fy = (start, end, val) => row(start, end, val, FY, "2026-03-01", "20-F");
  const both = [fy("2025-01-01", "2025-12-31", 59_595e6), fy("2024-01-01", "2024-12-31", 55_845e6)];
  const viv = extractFinancials("VIV", "1", ifrs({ RevenueFromRenderingOfTelecommunicationServices: both, ProfitLossFromOperatingActivities: [fy("2025-01-01", "2025-12-31", 10_000e6)] }), T);
  assert.equal(viv.revenue?.value, 59_595e6);
  assert.ok(Math.abs(viv.revenueGrowth - 6.715) < 0.01, String(viv.revenueGrowth));
  // Beside a stated total, the total stands; two kinds of sale and no total: nothing is guessed.
  assert.equal(extractFinancials("X", "1", ifrs({ Revenue: [fy("2025-01-01", "2025-12-31", 70_000e6)], RevenueFromRenderingOfTelecommunicationServices: both }), T).revenue?.value, 70_000e6);
  const two = extractFinancials("X", "1", ifrs({ RevenueFromSaleOfGold: both, RevenueFromRenderingOfTransportServices: [fy("2025-01-01", "2025-12-31", 1e9)] }), T);
  assert.notEqual(two.revenue?.value, 59_595e6);
  // SLSR: copper sales in 2024 only, no revenue in its 2025 report: the old line is not its revenue.
  const slsr = extractFinancials("SLSR", "1", ifrs({ RevenueFromSaleOfCopper: [fy("2024-01-01", "2024-12-31", 1.5e6)], ProfitLoss: [fy("2025-01-01", "2025-12-31", -80e6), fy("2024-01-01", "2024-12-31", -60e6)] }), T);
  assert.equal(slsr.revenue, null);
});

test("Audit: a foreign filer's fiscal year or half-year is named as such in the growth notes, never a quarter", async () => {
  const { periodName } = await import("../lib/research/comparison-labels.ts");
  assert.deepEqual(periodName(12), { ja: "年度", en: "fiscal year" });
  assert.deepEqual(periodName(6), { ja: "半期", en: "half-year" });
  assert.deepEqual(periodName(3), { ja: "四半期", en: "quarter" });
  assert.deepEqual(periodName(undefined), { ja: "四半期", en: "quarter" });
});
