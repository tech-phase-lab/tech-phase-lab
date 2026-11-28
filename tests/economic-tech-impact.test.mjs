import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { techImpact, techImpactCase, SENTENCES, RULE_OF } from "../lib/research/economic-tech-impact.ts";
import { releaseView } from "../lib/research/economic-release-view.ts";

const v = (value, decimals = 1, extra = {}) => ({ value, decimals, ...extra });
const n = value => ({ value, decimals: 0 });
const caseOf = (key, now, before) => techImpactCase(key, now, before);

test("prices (PCE, CPI): lower is a tailwind, higher a headwind, the same on screen neutral", () => {
  for (const key of ["pce", "cpi"]) {
    assert.equal(caseOf(key, v(0.3), v(0.5)), "tailwind");
    assert.equal(caseOf(key, v(0.6), v(0.4)), "headwind");
    assert.equal(caseOf(key, v(0.3), v(0.3)), "neutral");
    // the same at the displayed precision: 0.30 against 0.3 is the same number on screen
    assert.equal(caseOf(key, v(0.3, 2), v(0.3, 1)), "neutral");
    assert.equal(caseOf(key, v(-0.1), v(0.1)), "tailwind");
  }
  const ja = techImpact("pce", v(0.3), v(0.5), "ja");
  assert.deepEqual(ja, { badge: "tailwind", case: "tailwind", label: "ハイテク株にとって", badgeText: "追い風", text: "物価の伸びが前回より鈍化。利下げ期待と長期金利の低下を後押しする数字。" });
  const en = techImpact("pce", v(0.3), v(0.5), "en");
  assert.deepEqual([en.label, en.badgeText], ["For tech stocks", "Tailwind"]);
});

test("jobless claims: 250,000 or more, or 10% above the previous week, is a headwind; anything else neutral; never a tailwind", () => {
  assert.equal(caseOf("claims", n(189_000), n(202_000)), "neutral");
  assert.equal(techImpact("claims", n(189_000), n(202_000), "ja").text, "申請は少なく雇用は底堅い状態。景気には安心材料、利下げは遠のく方向。");
  assert.equal(caseOf("claims", n(250_000), n(249_000)), "headwind", "250,000 itself");
  assert.equal(caseOf("claims", n(249_000), n(248_000)), "neutral");
  assert.equal(caseOf("claims", n(220_000), n(200_000)), "headwind", "exactly 10% more");
  assert.equal(caseOf("claims", n(219_000), n(200_000)), "neutral", "9.5% more");
  assert.equal(caseOf("claims", n(180_000), n(240_000)), "neutral", "a fall is neutral, not a tailwind");
  assert.equal(SENTENCES.claims.tailwind, undefined);
});

test("jobs and ADP: a fall is a headwind; more than last time a tailwind unless at least twice the previous gain", () => {
  for (const key of ["jobs", "adp"]) {
    assert.equal(caseOf(key, n(-32_000), n(50_000)), "headwind");
    assert.equal(caseOf(key, n(80_000), n(60_000)), "tailwind");
    assert.equal(caseOf(key, n(165_000), n(60_000)), "neutral-surge", "2.75 times the previous gain");
    assert.equal(caseOf(key, n(120_000), n(60_000)), "neutral-surge", "exactly twice");
    assert.equal(caseOf(key, n(119_000), n(60_000)), "tailwind");
    assert.equal(caseOf(key, n(86_000), n(86_000)), "neutral", "the same");
    assert.equal(caseOf(key, n(86_400), n(86_000)), "neutral", "the same at the shown precision (8.6万 / 86K)");
    assert.equal(caseOf(key, n(29_000), n(133_000)), "neutral", "a smaller gain");
    assert.equal(caseOf(key, n(0), n(10_000)), "neutral", "zero is not a fall");
    assert.equal(caseOf(key, n(40_000), n(-20_000)), "tailwind", "after a fall the 2× test does not apply");
  }
  const surge = techImpact("jobs", n(165_000), n(60_000), "ja");
  assert.deepEqual([surge.badge, surge.badgeText], ["neutral", "中立"], "the surge is shown as 中立");
});

test("retail sales and GDP: below zero a headwind, above the previous a tailwind, else neutral", () => {
  for (const key of ["retail", "gdp"]) {
    assert.equal(caseOf(key, v(-0.3), v(0.5)), "headwind");
    assert.equal(caseOf(key, v(-0.3), v(-0.5)), "headwind", "below zero even when up");
    assert.equal(caseOf(key, v(0.8), v(0.5)), "tailwind");
    assert.equal(caseOf(key, v(0.2), v(0.8)), "neutral");
    assert.equal(caseOf(key, v(0.5), v(0.5)), "neutral");
    assert.equal(caseOf(key, v(0), v(-0.4)), "tailwind", "zero is not below zero");
  }
  assert.equal(techImpact("gdp", v(4.3), v(2.2), "ja").text, "景気の伸びが前回から加速。企業のIT投資や消費の支えになる数字。");
});

test("ISM: 50 or above and up a tailwind, below 50 and down a headwind, else neutral", () => {
  assert.equal(caseOf("ism", v(55.5), v(54.5)), "tailwind");
  assert.equal(caseOf("ism", v(50.0), v(49.2)), "tailwind", "50 itself counts as 50 or above");
  assert.equal(caseOf("ism", v(48.1), v(49.0)), "headwind");
  assert.equal(caseOf("ism", v(49.5), v(48.0)), "neutral", "below 50 but up");
  assert.equal(caseOf("ism", v(52.0), v(53.0)), "neutral", "above 50 but down");
  assert.equal(caseOf("ism", v(52.0), v(52.0)), "neutral");
});

test("FOMC: a cut a tailwind, a hike a headwind, a hold neutral", () => {
  assert.equal(caseOf("fomc", v(3.75, 2, { low: 3.5, action: "cut" }), null), "tailwind", "the decision needs no previous meeting");
  assert.equal(caseOf("fomc", v(4.0, 2, { low: 3.75, action: "hike" }), v(3.75, 2)), "headwind");
  assert.equal(caseOf("fomc", v(3.75, 2, { low: 3.5, action: "hold" }), v(3.75, 2)), "neutral");
  // a text that names no decision: the upper bound against the previous meeting's
  assert.equal(caseOf("fomc", v(3.75, 2), v(4.0, 2)), "tailwind");
  assert.equal(caseOf("fomc", v(4.0, 2), v(3.75, 2)), "headwind");
  assert.equal(caseOf("fomc", v(3.75, 2), v(3.75, 2)), "neutral");
  assert.equal(caseOf("fomc", v(3.75, 2), null), null);
});

test("no box: an indicator outside the table (PPI, an event), a missing number or a missing previous figure", () => {
  assert.equal(techImpact("ppi", v(0.3), v(1.4), "ja"), null, "PPI is not in the owner's table");
  assert.equal(techImpact("election", v(1), v(2), "ja"), null);
  assert.equal(techImpact("pce", null, v(0.5), "ja"), null);
  for (const key of ["pce", "cpi", "claims", "jobs", "adp", "retail", "gdp", "ism"]) assert.equal(techImpact(key, v(1), null, "ja"), null, key);
});

test("every cell has one sentence in both languages, about 40 characters, saying what the number means and never forecasting or recommending", () => {
  const cells = { prices: ["tailwind", "headwind", "neutral"], claims: ["headwind", "neutral"], jobs: ["tailwind", "headwind", "neutral", "neutral-surge"],
    retail: ["tailwind", "headwind", "neutral"], gdp: ["tailwind", "headwind", "neutral"], ism: ["tailwind", "headwind", "neutral"], fomc: ["tailwind", "headwind", "neutral"] };
  assert.deepEqual(new Set(Object.values(RULE_OF)), new Set(Object.keys(cells)));
  for (const [rule, cases] of Object.entries(cells)) {
    assert.deepEqual(Object.keys(SENTENCES[rule]).toSorted(), cases.toSorted(), rule);
    for (const found of cases) {
      const { ja, en } = SENTENCES[rule][found];
      assert.ok(ja.length >= 25 && ja.length <= 42, `${rule} ${found}: ${ja.length} characters`);
      // noun-ending fragments, each closed by 「。」, never 「です」 (owner, Nov 28)
      assert.match(ja, /^[^。]+。[^。]+。$/, `${rule} ${found}: two parts`);
      assert.doesNotMatch(ja, /です|ます/, `${rule} ${found}`);
      for (const part of ja.split("。").slice(0, 2)) assert.doesNotMatch(part, /[たるいうく]$/, `${rule} ${found}: 「${part}」 ends in a noun`);
      assert.match(en, /\.$/);
      assert.doesNotMatch(ja, /株価|買い|売り|上がる|下がる|上昇する|下落する|狙い目|チャンス/, `${rule} ${found}`);
      assert.doesNotMatch(en, /\b(buy|sell|rally|drop|soar|plunge|stock price|shares will)\b/i, `${rule} ${found}`);
    }
  }
});

const pce = (id, releasedAt, mom) => ({ id, releasedAt, title: { ja: "米国PCE物価指数（10月）", en: "U.S. PCE price index (October 2026)" },
  result: { ja: `前月比+${mom}%`, en: `+${mom}% from the previous month` }, detail: { ja: "", en: "" }, sourceName: "BEA", sourceUrl: "https://www.bea.gov/" });

test("the opened row: the box sits right under the number, from the view's own number and 前回; the collapsed row has no badge", () => {
  const row = pce("pce-2026-10", "2026-11-25T13:30:00Z", "0.3");
  const view = releaseView(row, [row], [], [], Date.parse("2026-11-28T00:00:00Z"), "ja");
  assert.equal(view.previous.display, "+0.5%", "the release's own stated September");
  assert.equal(techImpact(view.key, view.value, view.previous.value, "ja").badgeText, "追い風");
  const item = readFileSync(new URL("../app/research/calendar/economic-release-item.tsx", import.meta.url), "utf8");
  assert.match(item, /const impact = view\.display \? techImpact\(view\.key, view\.value, view\.previous\?\.value \?\? null, lang\) : null;/);
  const head = item.indexOf("calendarStyles.releaseHead"), box = item.indexOf("calendarStyles.techImpact"), bars = item.indexOf("calendarStyles.releaseBars}");
  assert.ok(head < box && box < bars, "between the number and the bars");
  const summary = item.slice(item.indexOf("<summary>"), item.indexOf("</summary>"));
  assert.doesNotMatch(summary, /impact/);
  const css = readFileSync(new URL("../app/research/calendar/event-calendar.module.css", import.meta.url), "utf8");
  const rules = css.split("\n").filter(line => line.includes(".techImpact")).join("\n");
  assert.match(rules, /border-radius/);
  assert.doesNotMatch(rules, /gold|#d4af37|#c9a227|#e0b84f|var\(--gold/i, "FREE screen: no gold");
});
