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
const compare = tickers => applyValueCheck(tickers.map(t => structuredClone(base[t])), snapshot);
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

test("valuation is Treasure Hunt's figure: NVDA 8.6 / 36% below, AMD 5.8 / 8% below (P/S alone), MU 3.8 / 12% above its average since listing, OUTX 未取得", () => {
  const [nvda, amd, mu, out] = compare(["NVDA", "AMD", "MU", "OUTX"]).map(view);
  assert.deepEqual(nvda.valuation, { value: 8.6, ja: "5年平均より36%安い", en: "36% below its 5-year average" });
  assert.deepEqual(amd.valuation, { value: 5.8, ja: "5年平均より8%安い", en: "8% below its 5-year average" });
  assert.deepEqual(mu.valuation, { value: 3.8, ja: "上場来平均より12%高い", en: "12% above its average since listing" });
  assert.deepEqual(out.valuation, { value: null, ja: "未取得", en: "Unavailable" });
  // The conversion and the wording at the edges.
  const f = (score, exact = score, period = null) => ({ score, exact, pe: null, ps: score, peNow: null, psNow: 1, basis: "ps", period, asOf: "2026-10-02" });
  assert.deepEqual([f(0), f(50), f(-50), f(80), f(-120)].map(valueFigureScore), [5, 10, 0, 10, 0]);
  assert.equal(valueFigureText(f(0, 0.4), "ja"), "5年平均と同じ水準");
  assert.equal(valueFigureText(f(0, -0.4, "data"), "en"), "In line with its average over the available period");
  assert.equal(valueFigureText(f(1, 0.6, "data"), "ja"), "取得できた期間の平均より1%安い");
});

test("an out-of-universe company leaves valuation out for everyone, and the verdict still renders on the six other factors", () => {
  const companies = compare(["NVDA", "OUTX"]);
  const result = overallComparison(companies, "ja", now);
  assert.match(result.title, /が優位|拮抗/);
  assert.equal(result.note, "総合点は、全社にそろう6項目の平均です。");
  // Without the list at all (the monitor unreachable): every valuation is 未取得, nothing else changes.
  const none = applyValueCheck(["NVDA", "AMD"].map(t => structuredClone(base[t])), null);
  assert.ok(none.every(c => comparisonScores(c, now).find(s => s.id === "valuation").value === null));
  assert.equal(overallComparison(none, "en", now).note, "Overall scores average the 6 factors every company has.");
});

test("momentum is a strength only when the price rose; when both fell, the smaller fall is said in the owner's words", () => {
  const [nvda, amd] = compare(["NVDA", "AMD"]);
  for (const c of [nvda, amd]) assert.ok(!c.preparedAnalysis.items.some(i => i.id === "momentum" && i.kind === "strength"), c.ticker);
  const ja = overallComparison([nvda, amd], "ja", now).description, en = overallComparison([nvda, amd], "en", now).description;
  assert.match(ja, /AMDは株価の下げがNVDAより小さく、約3か月で14\.8%の下落です。/);
  assert.match(en, /AMD has fallen less than NVDA, down 14\.8% over about three months\./);
  assert.doesNotMatch(ja, /株価の勢い/); assert.doesNotMatch(en, /price momentum/);
  // A rising price is still called a strength.
  const [mu] = compare(["MU", "NVDA"]);
  assert.ok(comparisonScores(mu, now).find(s => s.id === "momentum").value === 7);
  assert.ok(mu.preparedAnalysis.items.some(i => i.id === "momentum" && i.kind === "strength"));
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
