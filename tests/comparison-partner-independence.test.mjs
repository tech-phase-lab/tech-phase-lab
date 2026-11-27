import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTwelveFinancials } from "../lib/research/twelve-data-financials.ts";
import { comparisonScores, comparisonMetric, overallComparison } from "../lib/research/comparison-scorecard.ts";
import { applyValueCheck, valueFigureScore, valueFigureText } from "../lib/research/comparison-value.ts";
import { parseValueSnapshot } from "../lib/research/value-check.ts";

/** Owner, Nov 26: NVDA scored 1.9 for valuation against AMD (every company switched to P/S because AMD had no forward P/E) and about 8
 *  against MU. Every factor of a company must be the same whoever it is compared with. */
const now = Date.parse("2026-10-04T10:00:00Z"), at = new Date(now).toISOString();
const ENDS = ["2026-08-31", "2026-05-31", "2026-02-28", "2025-11-30", "2025-08-31"];
function company(ticker, { growth, margin, forwardPE, change, ratio = 2, cash = 100, debt = 50, fcf = 20 }) {
  const revenue = 100 * (1 + growth / 100);
  return { ...buildTwelveFinancials({ ticker, retrievedAt: at, accountingBasis: "us-gaap",
    income: { meta: { symbol: ticker, currency: "USD", period: "Quarterly" }, income_statement: ENDS.map((fiscal_date, i) => ({ fiscal_date, quarter: [4, 3, 2, 1, 4][i], year: i < 4 ? 2026 : 2025,
      sales: i === 4 ? 100 : revenue, operating_income: (i === 4 ? 100 : revenue) * margin / 100, eps_diluted: 2 })) },
    cashFlow: { meta: { symbol: ticker, currency: "USD", period: "Quarterly" }, cash_flow: [{ fiscal_date: ENDS[0], quarter: 4, year: 2026,
      operating_activities: { operating_cash_flow: revenue * fcf / 100 + 10 }, investing_activities: { capital_expenditures: -10 } }] },
    statistics: { retrievedAt: at, payload: { meta: { symbol: ticker, currency: "USD" }, statistics: { valuations_metrics: { forward_pe: forwardPE },
      financials: { most_recent_quarter: ENDS[0], balance_sheet: { current_ratio_mrq: ratio, total_cash_mrq: cash, total_debt_mrq: debt } } } } },
    series: { retrievedAt: at, adjust: "splits", payload: { meta: { symbol: ticker, currency: "USD", interval: "1day" }, values: [{ datetime: "2026-10-02", close: String(100 + change) }, { datetime: "2026-07-03", close: "100" }] } },
  }, now), ticker, name: ticker, peer: "chips", caution: { ja: "", en: "" } };
}
// AMD has no forward P/E (the case that switched every company to P/S before); OUTX is outside Treasure Hunt's list.
const base = {
  NVDA: company("NVDA", { growth: 106, margin: 66, forwardPE: 42.5, change: -34.5 }),
  AMD: company("AMD", { growth: 45, margin: 21, forwardPE: null, change: -14.8 }),
  MU: company("MU", { growth: 46, margin: 33, forwardPE: 11.5, change: 20, ratio: 2.5 }),
  OUTX: company("OUTX", { growth: 10, margin: 5, forwardPE: 25, change: 3 }),
};
// The list as the monitor sends it (parsed exactly as the route reads it).
const snapshot = parseValueSnapshot({ ok: true, basis: "trailing", asOf: "2026-10-02", computedAt: "2026-10-02T22:00:00Z",
  universes: { tech: { total: 3, items: [], changes: { in: [], out: [] }, excluded: {} }, all: { total: 3, items: [], changes: { in: [], out: [] }, excluded: {} } },
  values: { NVDA: { score: 36, exact: 35.8, pe: 40.1, ps: 31.5, peNow: 42.5, psNow: 21.3, basis: "pe-ps", period: null },
    AMD: { score: 8, exact: 8.2, pe: null, ps: 8.2, peNow: null, psNow: 9.1, basis: "ps", period: null },
    MU: { score: -12, exact: -12.4, pe: -10.0, ps: -14.8, peNow: 11.5, psNow: 3.2, basis: "pe-ps", period: "listed" } } });
const compare = tickers => applyValueCheck(tickers.map(t => structuredClone(base[t])), snapshot, now);
const view = c => Object.fromEntries(comparisonScores(c, now).map(s => [s.id, { value: s.value, ja: comparisonMetric(c, s.id, "ja", now), en: comparisonMetric(c, s.id, "en", now) }]));
const points = c => c.preparedAnalysis.items.map(i => `${i.id}:${i.kind}:${i.short.ja}:${i.short.en}`).sort();

for (const [subject, partners] of [["NVDA", [["AMD"], ["MU"], ["OUTX"], ["AMD", "MU"], ["MU", "OUTX"]]], ["MU", [["NVDA"], ["AMD"], ["OUTX"], ["NVDA", "AMD"]]], ["AMD", [["NVDA"], ["MU"], ["OUTX"]]]]) {
  test(`${subject}: every factor's score, figure and strength/weakness points are the same whoever it is compared with`, () => {
    const seen = partners.map(others => { const c = compare([subject, ...others])[0]; return { view: view(c), points: points(c) }; });
    const also = partners.map(others => compare([...others, subject]).at(-1)); // its position in the comparison does not matter either
    for (const s of seen.slice(1)) { assert.deepEqual(s.view, seen[0].view); assert.deepEqual(s.points, seen[0].points); }
    for (const c of also) { assert.deepEqual(view(c), seen[0].view); assert.deepEqual(points(c), seen[0].points); }
    assert.equal(Object.keys(seen[0].view).length, 7);
  });
}

test("valuation is Treasure Hunt's figure: NVDA 8.6 / 36% below, AMD 5.8 / 8% below (P/S alone), MU 3.8 / 12% above its average since listing (上場後の平均), OUTX 未取得", () => {
  const [nvda, amd, mu, out] = compare(["NVDA", "AMD", "MU", "OUTX"]).map(view);
  assert.deepEqual(nvda.valuation, { value: 8.6, ja: "5年平均より36%安い", en: "36% below its 5-year average" });
  assert.deepEqual(amd.valuation, { value: 5.8, ja: "5年平均より8%安い", en: "8% below its 5-year average" });
  assert.deepEqual(mu.valuation, { value: 3.8, ja: "上場後の平均より12%高い", en: "12% above its average since listing" });
  assert.deepEqual(out.valuation, { value: null, ja: "未取得", en: "Unavailable" });
  // The conversion and the wording at the edges.
  const f = (score, exact = score, period = null) => ({ score, exact, pe: null, ps: score, peNow: null, psNow: 1, basis: "ps", period, asOf: "2026-10-02" });
  assert.deepEqual([f(0), f(50), f(-50), f(80), f(-120)].map(valueFigureScore), [5, 10, 0, 10, 0]);
  assert.equal(valueFigureText(f(0, 0.4), "ja"), "5年平均と同じ水準");
  assert.equal(valueFigureText(f(0, -0.4, "data"), "en"), "In line with its average over the available filings");
  assert.equal(valueFigureText(f(1, 0.6, "data"), "ja"), "決算データのある期間の平均より1%安い");
});

test("an out-of-universe company leaves valuation out for everyone, and the verdict still renders on the six other factors", () => {
  const companies = compare(["NVDA", "OUTX"]);
  const result = overallComparison(companies, "ja", now);
  assert.match(result.title, /が優位|拮抗/);
  assert.equal(result.note, "総合点は、全社にそろう6項目の平均です。");
  // Without the list at all (the monitor unreachable): every valuation is 未取得, nothing else changes.
  const none = applyValueCheck(["NVDA", "AMD"].map(t => structuredClone(base[t])), null, now);
  assert.ok(none.every(c => comparisonScores(c, now).find(s => s.id === "valuation").value === null));
  assert.equal(overallComparison(none, "en", now).note, "Overall scores average the 6 factors every company has.");
});

test("momentum is never listed as a strength or weakness; when both fell, the smaller fall is said in the owner's words", () => {
  const [nvda, amd] = compare(["NVDA", "AMD"]);
  for (const c of [nvda, amd]) assert.ok(!c.preparedAnalysis.items.some(i => i.id === "momentum"), c.ticker);
  const ja = overallComparison([nvda, amd], "ja", now).description, en = overallComparison([nvda, amd], "en", now).description;
  assert.match(ja, /AMDは株価の下げがNVDAより小さく、約3か月で14\.8%の下落です。/);
  assert.match(en, /AMD has fallen less than NVDA, down 14\.8% over about three months\./);
  assert.doesNotMatch(ja, /株価の勢い/); assert.doesNotMatch(en, /price momentum/);
  // A rising price is still scored, but not listed (owner, Nov 27: a 3-month price move is not a business strength or weakness).
  const [mu] = compare(["MU", "NVDA"]);
  assert.ok(comparisonScores(mu, now).find(s => s.id === "momentum").value === 7);
  assert.ok(!mu.preparedAnalysis.items.some(i => i.id === "momentum"));
});

test("the compare route reads every company on its own: no step that changes one company's figures because of another", () => {
  const route = readFileSync(new URL("../app/api/research/compare/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /applyValuationBasis|valuationBasis/);
  assert.match(route, /applyValueCheck\(await Promise\.all\(selected\.map/);
  const scorecard = readFileSync(new URL("../lib/research/comparison-scorecard.ts", import.meta.url), "utf8");
  assert.doesNotMatch(scorecard, /valuationBasis|psScore|11-stats\.forwardPE/);
  // The pending-report sentence is gone in both languages.
  const visuals = readFileSync(new URL("../app/research/compare/comparison-visuals.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(visuals, /四半期報告書の提出待ち|await the quarterly report|previousQuarterShown/);
});

// ---- Fallbacks (owner, Nov 26): a company with no revenue yet (P/B, balance sheet), a recent listing ----
import { extractFinancials } from "../lib/research/comparison.ts";
import { comparisonAvailability, hasRecentBalance } from "../lib/research/comparison-scorecard.ts";
import { preparePreRevenueAnalysis } from "../lib/research/comparison-analysis.ts";
import { valueFigureCurrent, VALUE_LABELS, valueAsOfLine } from "../lib/research/comparison-value.ts";

const instant = (val, end = "2026-08-31", filed = "2026-09-20", form = "10-Q", accn = "0000000001-26-000010") => ({ val, end, filed, form, accn, fy: 2026, fp: "Q3" });
/** A drug developer before its first sale: a balance sheet, no revenue at all. */
function preRevenueFacts() {
  const usd = rows => ({ units: { USD: rows } });
  return { cik: 1280776, entityName: "Example Bio", facts: { "us-gaap": {
    CashAndCashEquivalentsAtCarryingValue: usd([instant(150e6), instant(120e6, "2026-05-31", "2026-06-20", "10-Q", "0000000001-26-000005")]),
    AssetsCurrent: usd([instant(180e6)]), LiabilitiesCurrent: usd([instant(30e6)]), Assets: usd([instant(200e6)]), Liabilities: usd([instant(35e6)]),
    LiabilitiesNoncurrent: usd([instant(5e6)]), StockholdersEquity: usd([instant(165e6)]),
  } } };
}
const bio = () => {
  const c = extractFinancials("XBIO", "1280776", preRevenueFacts(), now);
  return { ...c, ticker: "XBIO", name: "Example Bio", peer: "bio", caution: { ja: "", en: "" }, preparedAnalysis: preparePreRevenueAnalysis(c, now),
    twelveData: { ...base.AMD.twelveData, statistics: null, margins: [], momentum: { from: "2026-07-03", to: "2026-10-02", changePct: -12 } } };
};
base.XBIO = bio();
const fallback = parseValueSnapshot({ ok: true, basis: "trailing", asOf: "2026-10-02", computedAt: "2026-10-02T22:00:00Z",
  universes: { tech: { total: 1, items: [], changes: { in: [], out: [] }, excluded: {} }, all: { total: 1, items: [], changes: { in: [], out: [] }, excluded: {} } },
  values: { NVDA: [36, 35.8, "pe-ps", null], AMD: [8, 8.2, "ps", null], MU: [-12, -12.4, "pe-ps", "listed"], XBIO: [32, 31.6, "pb", null] } });
const compareAll = tickers => applyValueCheck(tickers.map(t => structuredClone(base[t])), fallback, now);

test("a company with no revenue yet: financial strength from its latest balance sheet, honest 「売上がまだ無い」 lines, a P/B valuation, and a verdict", () => {
  const c = base.XBIO;
  assert.equal(c.status, "ready"); assert.equal(c.preRevenue, true); assert.equal(c.balance.end, "2026-08-31");
  assert.ok(hasRecentBalance(c, now));
  const [nvda, xbio] = compareAll(["NVDA", "XBIO"]);
  const v = view(xbio);
  assert.equal(v.financial.value, 10); assert.equal(v.financial.ja, "流動比率 6.00倍・借入なし");
  // Its filing here has no cash flow, net income, R&D or share count: each company-type metric (comparison-alternatives.ts) says which figure
  // is missing, instead of a bare 「売上がまだ無い」.
  assert.deepEqual(Object.fromEntries(["growth", "profitability", "cash", "stability"].map(id => [id, [v[id].value, v[id].ja]])), {
    growth: [null, "比べる前年の純損益が未開示"], profitability: [null, "売上なし（利益率なし）"], cash: [null, "営業CFの記載なし"], stability: [null, "前年同期の株数が未開示"] });
  assert.deepEqual(v.valuation, { value: 8.2, ja: "純資産倍率（PBR）が5年平均より32%安い", en: "P/B 32% below its 5-year average" });
  assert.equal(comparisonAvailability(xbio, "ja", now), "売上がまだ無い会社です。資金の持ち期間・赤字の推移・株数の増加で比べます。売上が無いため利益率は出しません。");
  assert.ok(xbio.preparedAnalysis.items.some(i => i.id === "financial" && i.kind === "strength"));
  assert.ok(xbio.preparedAnalysis.items.some(i => i.id === "valuation" && i.short.ja === "PBRが5年平均より32%安い"));
  const verdict = overallComparison([nvda, xbio], "ja", now);
  assert.doesNotMatch(verdict.title, /揃っていません/);
  assert.match(verdict.description, /^売上がまだ無い会社を含みます。/);
  assert.equal(verdict.note, "総合点は、全社にそろう3項目の平均です。");
});

for (const [subject, partners] of [["XBIO", [["NVDA"], ["AMD"], ["MU"], ["OUTX"], ["NVDA", "AMD"]]], ["NVDA", [["XBIO"], ["AMD"], ["MU", "XBIO"]]], ["MU", [["XBIO"], ["NVDA"]]]]) {
  test(`fallbacks: ${subject}'s factors are the same whoever it is compared with (P/B, balance-only and listed-period companies included)`, () => {
    const seen = partners.map(others => view(compareAll([subject, ...others])[0]));
    const reversed = partners.map(others => view(compareAll([...others, subject]).at(-1)));
    for (const s of [...seen.slice(1), ...reversed]) assert.deepEqual(s, seen[0]);
  });
}

test("the period and P/B wordings, the age limit and the date line", () => {
  const f = (score, basis, period, asOf = "2026-10-02") => ({ score, exact: score, basis, period, asOf });
  assert.equal(valueFigureText(f(-15, "pe-ps", "listed"), "ja"), "上場後の平均より15%高い");
  assert.equal(valueFigureText(f(-15, "pe-ps", "listed"), "en"), "15% above its average since listing");
  assert.equal(valueFigureText(f(20, "pb", "data"), "ja"), "純資産倍率（PBR）が決算データのある期間の平均より20%安い");
  assert.equal(valueFigureText(f(0, "pb", null), "en"), "P/B in line with its 5-year average");
  // An old figure (the monitor stopped) is 未取得, never shown as current.
  assert.ok(valueFigureCurrent(f(10, "ps", null, "2026-09-27"), now));
  assert.ok(!valueFigureCurrent(f(10, "ps", null, "2026-09-25"), now));
  const [old] = applyValueCheck([structuredClone(base.NVDA)], { values: { NVDA: f(36, "pe-ps", null, "2026-09-20") } }, now);
  assert.equal(comparisonScores(old, now).find(s => s.id === "valuation").value, null);
  assert.equal(comparisonMetric(old, "valuation", "ja", now), "未取得");
  assert.equal(valueAsOfLine(compareAll(["NVDA", "AMD"]), "ja", now), "割安性は10/2の終値で計算");
  assert.equal(valueAsOfLine(compareAll(["NVDA", "AMD"]), "en", now), "Valuation as of the Oct 2 close");
  assert.equal(VALUE_LABELS.traitLines, 1, "option A (two lines) waits for the owner");
});

test("momentum wording: a flat price is never a fall, and a smaller fall is not repeated as the caution", () => {
  const flat = company("FLAT", { growth: 20, margin: 30, forwardPE: 20, change: -0.04 }), down = company("DOWN", { growth: 10, margin: 10, forwardPE: 20, change: -5 });
  const pair = applyValueCheck([flat, down], { values: {} }, now);
  for (const lang of ["ja", "en"]) assert.doesNotMatch(overallComparison(pair, lang, now).description, /下落です|has fallen less/);
  // Both fell, and the leader fell less: its fall is said once, never again as "however, ... fell".
  const a = company("AAA", { growth: 60, margin: 40, forwardPE: 20, change: -5 }), b = company("BBB", { growth: 10, margin: 10, forwardPE: 20, change: -20 });
  const both = applyValueCheck([a, b], { values: {} }, now);
  const ja = overallComparison(both, "ja", now).description, en = overallComparison(both, "en", now).description;
  assert.match(ja, /AAAは株価の下げがBBBより小さく、約3か月で5\.0%の下落です。/);
  assert.doesNotMatch(ja, /ただし、AAAは株価が/);
  assert.match(en, /AAA has fallen less than BBB, down 5\.0% over about three months\./);
  assert.doesNotMatch(en, /However, AAA's share price fell/);
});
